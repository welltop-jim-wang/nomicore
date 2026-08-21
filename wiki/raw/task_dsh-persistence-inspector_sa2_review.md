# SA2 攻击评审报告

**Date**: 2026-08-22
**Reviewer**: SA2（Wallfacer，全新视角，未携带 SA1 协商上下文）
**评审对象**: `wiki/raw/task_dsh-persistence-inspector_design.md`（SA1 R0）
**Verdict**: **reject**（1 CRITICAL + 1 HIGH 必须修订设计；3 MEDIUM/LOW 随修订一并落实）

> 评审方法：以真实 P1–P3 代码（HEAD 工作区）为基准逐条核对设计断言，独立运行原型脚本
> 验证内核时序语义（脚本位于 /tmp，已删除，工作区零污染）；ADR 约束基准取自
> `task_dsh-persistence-inspector_relevant_decisions.md`。

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | SA6 AC1-memory 断言可满足性（§9 盘点表漏报第三缺陷） | `dsh-profile-acceptance.test.ts:129-132`：`await handle.release()` → `loadDoc` → `expect(loaded!.doc).toBe(doc)`。内核 `maybeEvict`（`lifecycle.ts:463-469`）对 clean entry（`savedGeneration === dirtyGeneration`，**含 0===0**）在最后一个 handle release 时**同步驱逐并 `doc.destroy()`**（release 路径 `lifecycle.ts:392-397`），随后的 `loadDoc` 从 mirror 还原**新实例**。实测（真实 `MemoryPersistence`）：release 后 `doc.isDestroyed === true`、`loaded.doc === doc` 为 **false**。P2 内核测试 `memory-persistence.test.ts:357-369` 明文断言此路径为 `not.toBe(oldDoc)` 的新实例——驱逐语义是 P2/P3 既定契约而非实现巧合。SA1 §9 盘点表却写「AC1 memory ✓ 可满足」，且 §13 十二行证据**无一覆盖 AC1-memory**（P8 只覆盖 AC1-file/AC3-file）。设计内部自相矛盾：§5 S1（「load h4 d2 新实例」）与 AC5 推演恰恰**依赖**这个驱逐语义。后果：SA3 按设计正确实现后 AC1-memory 仍红，任务被误判为实现缺陷；或诱导实现侧黑帽（profile 偷持 phantom handle 抑制驱逐）——那会同时打翻 AC2（`evicts.length>=2`）、AC5 与 ADR「release 后由持久层内部决定真实 evict」，与 §9 已排除的黑帽路径同类。 | §9 增补**缺陷 3**，走既有总控→SA6 协调通道（简报 §2 条款）。修法 A（对齐 P2 驱逐语义）：删同实例断言，改 `expect(loaded!.doc).not.toBe(doc)` + ROOT 内容等价断言；修法 B（对齐 cache-hit 语义，`memory-persistence.test.ts:305` 同款）：把 loadDoc 提到 release 之前断言 `toBe(doc)`。两法均不触碰 AC1 其余断言。§13 补一行可复跑依据（本报告「验证证据」节的命令即可）。 |
| 2 | **HIGH** | 「SA6 契约面逐项可满足」结论与 §13 证据覆盖面不闭合 | §1 自立规矩「关键机制全部在真实 P1–P3 代码上原型验证过（§13 逐条列出命令与输出）」，但 §9 盘点表 6 行中恰有 1 行（AC1 memory）无原型编号、无依据即判 ✓——这不是孤例风险而是**流程洞**：任何一行「✓」都可能未经验证。审查另确认 AC4-service-memory 的微任务深度核算同样无 §13 对应行（本报告独立推演其**可满足**：async hook 失败链 2 hop 落 degraded、恢复链 2 hop 落 ready，与 SA6 FakeTimer 每 callback 2 微任务排空兼容——但这是 SA2 替 SA1 补的作业）。 | 修订要求：§9 盘点表每一行必须挂 §13 证据编号，或显式标注「未验证 + 风险等级」；§13 按用例（而非仅按机制）补齐「内核时序 × FakeTimer 排空深度」复合假设的证据行。SA4 静态门禁应把「§9 行↔§13 行可对号」列为检查项。 |
| 3 | MEDIUM | §6.1 `saveCounters` 递增点未规定 → retry-flush 的 generation 在记录规范下欠定 | 伪代码只写 `const generation = saveCounters.get(key) ?? 0`，从未展示 saveCounters 在何处递增。决策 C 文字为「每次**成功**调用」，但 S4 t=1508 被拒的 saveDoc（`write-rejected`）若也被计数，retry 成功的 flush 事件会渲染为 `generation=2 ok=true` 而非 §5 时间线/决策 H 钉死的 `g1 ok=true`（retry 与首发同 generation）。现行 SA6 断言恰好区分不了两种实现（AC4 的 `okFlush` 只 `find` 第一个 `ok===true`），于是「两个都绿」的实现产出**不同 record**——直接削弱 §8「确定性硬规范」与 AC8 跨实现可复制性承诺。 | §6.1 明文：saveCounters 仅在 saveDoc **resolve 后**递增（reject 不计）；§8 记录规范补一句「retry 成功的 flush 行 generation 与首发失败行相同」。测试构想见「红线测试思路」#3。 |
| 4 | MEDIUM | `failFirstFlushes > 1` 的时间线未定义，CLI 契约面却接受任意 n | CLI `--fail-first-flushes <n>` 接受任意非负整数；内核 retry 退避 500→1000→2000…（cap 5000，`lifecycle.ts:456`）。§5 只给出 n=1 时间线（两处 `advanceBy(500)`）。n≥2 时固定 500ms 窗口推进**不会触发**第二次退避的 retry 计时器，探针将空转直至 waitFor 超时（file）或场景卡死（memory 侧表现为事件缺失）。 | 规定 S4 通用循环：每次 flush 尝试失败后按当前 `retryDelayMs`（探针自持镜像退避序列）推进，直至 `flushFailuresLeft === 0` 且观察到成功；虚拟时刻跟随退避序列，任意 n 的 record 仍确定。 |
| 5 | LOW | 探针获取 service 的路径未按简报措辞显式走 Cordis | 简报：「inspector **只经 Cordis 消费** `docPersistence`」。决策 A 说探针复用 profile 装配，但通篇未写探针从 `profile.ctx.get(DOC_PERSISTENCE_SERVICE)`（或 `requireDocPersistence`）取 service——这是「只经 Cordis 消费」在代码里唯一可验证的落点。 | 决策 A 或 §7 probe.ts 职责行加一句：探针所有 service 调用经 `ctx.get(DOC_PERSISTENCE_SERVICE)` 获取的实例发出（与 `profile.persistence` 同一身份）。 |
| 6 | LOW | `probe-failed` 尾行 reason 词表未规定，可能把环境痕迹带进 record | §6.2 waitFor 超时 → `probe-failed {reason}`。若 reason 内插 `err.message`（EISDIR/ENOENT 等含绝对路径的系统文本）或 rootDir，失败 record 也携带环境痕迹，与 §8「禁止出现 rootDir 绝对路径」冲突（该禁令未区分成败 record）。 | 规定 reason 为封闭枚举词表（如 `file-settle-timeout:{docId}:g{generation}`、`scenario-error:{step}`），原始错误走 stderr/`ok=false` 的结构化出口，不进 record。 |
| 7 | INFO | §6.3 转述失真 | 「与 testkit createTestTimer 同族：每次触发后 8 微任务」——`testing.ts:126/129` 实际为每轮 3 次 `await Promise.resolve()`。机制类比（到期序触发 + 微任务排空 + 探针侧 `settle(32)` 兜底）成立，数字错误；SA3 照抄注释会误以为需复刻 8。 | 改为只描述机制并修正数字，或删去具体次数。 |

## 协议假设依据审查

- **章节存在性**：✓ §13 存在，12 行假设各带类型与依据内容。
- **依据可验证性**：✓ 形式达标——P1/P2/P3/P4/P5/P6/P7/P9/P10 均附实测输出摘要，P11/P12 引用现有仓库事实（`packages/vfsl-codegen/src/cli.ts:19-20`、`core-dsh-boundary.test.ts:28`），无「应该/通常/预计」类无据推断，「实测验证」条目均附可重跑线索。
- **覆盖面**：✗ 有洞——§13 没有任何一行覆盖 **AC1-memory**（攻击点 1，实测已证伪 SA1 的 ✓ 结论）与 AC4-service-memory 的微任务深度（攻击点 2）。设计的「逐项可满足」结论（SA1 结论段「SA6 契约面（简报 §2）逐项可满足」）超出了证据能支撑的范围。
- 结论：形式 pass、覆盖面 **reject**（并入攻击点 1/2，须补据后再审）。

## 错误处理链路审查

- **静默失败**：未见。决策 E 配置冲突一律 loud TypeError；§6.1/§6.2 degraded/recovered 推断与 `getStatus()` 互检，不一致 → `probeFailed`；file 通道 waitFor 5s 真实上限 → loud 失败 + CLI 非零退出；探针场景异常走 finally `profile.dispose()` + `probe-failed {reason}` 行、不吞栈。链路闭环。
- **状态闭环**：✓ degraded 状态经事件（degraded/write-rejected/recovered）与 `getStatus()` 双通道交叉验证；write-rejected 来自真实 saveDoc 拒绝路径（`lifecycle.ts:200`），非探针臆造。
- **降级路径**：✓ 无伪降级。决策 D 把「不可推进时钟」当正常路径缺陷 loud assert（TypeError + 阻断）而非降级容错——符合 2026-05-07 三度立法精神；决策 E 同理。
- **虚假降级识别**：✓ 唯一的伪降级风险恰好是攻击点 1 的黑帽解法（profile 偷持 handle 让 AC1-memory「绿」）——那是把内核驱逐 bug 降级掩盖的教科书案例，本报告已要求在**测试侧**修复并在 §9 增补缺陷 3 堵死此路。file 通道 waitFor 超时走 probe-failed 而非跳过断言继续，亦非伪降级。

## 红线测试思路

1. **AC1-memory（攻击点 1，随 SA6 协调修订落盘）**：
   - 修法 A 形态：`createDoc → release → loadDoc`，断言 `loaded.doc !== doc`、`doc.isDestroyed === true`、`loaded.doc.getMap('ROOT').get('title')` 内容等价——这正是 P2 `memory-persistence.test.ts:357` 既有语义的 host 侧复述；
   - 修法 B 形态：`createDoc → loadDoc`（未 release）断言 `toBe(doc)`（cache-hit 同实例，P2:305 同款）再逐个 release。
   - 附带守卫：断言 profile 不持有隐藏 handle（`timer.pending()===0` 且 release 后 doc 即销毁），防止黑帽抑制驱逐。
2. **证据覆盖（攻击点 2）**：SA4 静态门禁把「§9 盘点表每行 ↔ §13 证据行可对号」列为检查项；任何后续「✓ 可满足」结论必须附可重跑命令与输出。
3. **saveCounters 递增点（攻击点 3）**：`runPersistenceProbe({ adapter:'memory', failFirstFlushes:1 })` 后断言 record 含 `flush doc-degraded generation=1 ok=true`（retry 同代先行）且 `dirty doc-degraded generation=2` 行序在 `recovered` 之后——两个断言合起来钉死「rejected saveDoc 不计数」。若走 SA6 协调新增断言成本高，至少落为 SA3 包内自测。
4. **failFirstFlushes=2（攻击点 4）**：探针/CLI 以 `failFirstFlushes:2` 运行，断言 `ok===true`、doc-degraded 事件含两条 `ok=false` 同 `generation=1`、`recovered` 的 t 落在第二次退避（≈ +1000ms 虚拟刻）之后、同参两跑 record 逐字节一致。
5. **Cordis 消费（攻击点 5）**：包内自测——探针运行期间对 `profile.ctx.get(DOC_PERSISTENCE_SERVICE)` 与探针实际调用对象做 identity 断言（恒等）。
6. **reason 词表（攻击点 6）**：人为制造 settle 超时（file 通道注入不可满足的快照期望），断言失败 record 不含 rootDir、`probe-failed` 行 reason 匹配封闭词表模式。

## 验证证据（SA2 实跑，2026-08-22）

```bash
# 1) 攻击点 1 实证：AC1-memory 同实例断言在真实内核下为假
#    脚本（/tmp/sa2-probe/ac1mem.mjs，已删除）：new MemoryPersistence() →
#    createDoc(user-a, doc-alpha, threeEntryDoc) → release → loadDoc
cd /home/wangjian/nomicore-fix-issue-59 && pnpm exec tsx /tmp/sa2-probe/ac1mem.mjs
#   → handle.doc === doc       : true
#     after release isDestroyed: true        ← release 即驱逐销毁（lifecycle.ts:463-469）
#     loaded !== null          : true
#     loaded.doc === doc       : false       ← SA6 断言要求 true → 不可满足

# 2) S3 异常路径旁证（同轮验证，脚本 s3.mjs，已删除）
#   → duplicate: thrown = DocDuplicateError | code = DOC_DUPLICATE | instanceof = true
#     meta-mismatch: message = "doc META.docId doc-other does not match requested docId doc-alpha"
#     mismatched doc survived: true          ← 设计 §5 S3 两行的内核行为均成立

# 3) 红绿格局复核（与简报 §5 R1-3 一致，本评审未改动任何文件）
cd /home/wangjian/nomicore-fix-issue-59 && pnpm exec vitest run \
  packages/dsh-persistence/test/ packages/persistence/test/core-dsh-boundary.test.ts --reporter=basic
#   → Test Files  2 failed | 1 passed (3)；Tests  6 failed | 4 passed (10)
#     两个红灯文件 + AC7 绿色守卫，与本轮评审基线一致

# 4) 内核驱逐语义的既定契约锚点（静态引用）
grep -n "not.toBe(oldDoc)" packages/persistence/test/memory-persistence.test.ts
#   → 366:  expect(restored!.doc).not.toBe(oldDoc)   （P2 明文：release 后 restore 是新实例）
```

## 裁决

**reject**。核心架构（决策 A–I：薄装配 + 双通道观察 + 自持模型 + 受控时钟 + loud 配置校验 + dispose 顺序）经攻击后依然成立，§9 缺陷 1/2 的实证与修复配方复核无误（R1 修订确已落盘于测试文件）。但：

1. **CRITICAL（攻击点 1）**：AC1-memory 存在第三条不可满足断言，SA1 §9 盘点误判「✓ 可满足」且 §13 无证据——必须按 §9 既有格式增补缺陷 3 并走总控→SA6 协调，否则 SA3 交付后验收面无法全绿，且会诱发违规黑帽。
2. **HIGH（攻击点 2）**：「逐项可满足」结论与证据覆盖面不闭合，盘点表须逐行挂证据。

SA1 修订上述两点（附攻击点 3–7 的低成本澄清）后提交 R1 复审；复审聚焦 §9 缺陷 3 的修复配方与 §13 补据，其余架构不再重开。`pass` 后仍须 SA4/SA7 对实现与活链路验证，本 pass 不替代。
