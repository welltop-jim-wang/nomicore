# SA2 攻击评审报告

**Date**: 2026-08-22（R0 首轮） / 2026-08-22（R1 复审） / 2026-08-22（R2 评审，见文末）
**Reviewer**: SA2（Wallfacer，全新视角，未携带 SA1 协商上下文）
**评审对象**: `wiki/raw/task_dsh-persistence-inspector_design.md`（SA1 R0 → R1 → R2）
**Verdict (R0)**: **reject**（1 CRITICAL + 1 HIGH 必须修订设计；3 MEDIUM/LOW 随修订一并落实）
**Verdict (R1 复审)**: **pass** —— 攻击点 1–7 全部落实且实证可复核；缺陷 3 修法 B 经 SA2 独立重跑验证可满足，SA6 R2 已按配方落盘（工作区未提交态，真红保持）。详见「R1 复审节」。
**Verdict (R2 评审，最终)**: **reject（窄幅）** —— §6.2 两阶段结算协议的**骨架经源码级复核与 SA2 独立原型确认成立**（原子性引理 / 武装不变式 / A-evict 信号 / 虚拟刻度不变式全部为真），但 §6.2 的 **pending 联言基线公式有实证缺陷**（照字面落地必红 + file n≥2 信号缺失），须一段修正后方可放行 SA3。修订范围仅限 §6.2 基线语义与前置声明，协议骨架不再重开。详见文末「R2 评审节」。

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

---

# R1 复审节（2026-08-22）

**复审对象**：`task_dsh-persistence-inspector_design.md`（SA1 R1 修订轮）
**复审范围**：按 R0 裁决约定——聚焦 §9 缺陷 3 修复配方与 §13 补据（P13–P18），架构决策 A–I 不重开（R0 已攻击确认维持）。
**复审方法**：设计文本逐条核对 + SA2 独立重跑关键配方（真实 `MemoryPersistence` + 逐字复刻 SA6 FakeTimer，脚本位于 /tmp 已删除，工作区零污染）+ 落盘 diff 核对。

## R1 攻击点落实复核表

| R0 攻击点 | 修订落点 | SA2 复核结论 |
|---|---|---|
| 1（CRITICAL）AC1-memory 第三缺陷 | §9 缺陷 3（新增，含源码级不可满足证明 + 黑帽双路排除 + 修法 A/B 论证选 B）；§13 P13/P14；§10/§12/决策 I 联动更新 | ✅ 落实。修法 B 配方 **SA2 独立重跑全部断言可满足**（见下「专项复核」）；SA6 R2 已按配方落盘（工作区未提交 diff 与配方逐行一致：load 前置、`toBe(doc)` 断言目标值原样、`not.toBe(handle)` 独立 lease、双 release 后 `isDestroyed===true` + `pending()===0` 反黑帽守卫、timer 提升为变量） |
| 2（HIGH）盘点表逐行挂证据 | §9 盘点表重写（8 行全挂 §13 编号，无「未验证」行）；§13 P15（AC4-service-memory 2-hop 精确核算）/P16（探针全场景 × 逐字 FakeTimer）；盘点纪律条款（SA4 检查项） | ✅ 落实。SA2 独立重跑 P15 场景逐字复现（见验证证据 ②）；P16/P17 引用输出与内核源码核对一致（退避翻倍 lifecycle.ts:456/383：500→1000→2000 cap 5000，P17 时间戳 1504/2004/3004 恰为该序列） |
| 3（MEDIUM）saveCounters 递增点 | 决策 C 重写（「仅在 resolve 之后 +1，reject 一律不计」）；§6.1 伪代码 then/catch 分流；§8 generation 语义补则（retry 成功 flush 与首发失败同代；`dirty g=n+1` 必在 `recovered` 后） | ✅ 落实。立法明确无歧义；P16 输出含 `dirty generation=2` 在 `recovered` 之后的锚（即 R0 红线测试 #3 的断言形态） |
| 4（MEDIUM）`failFirstFlushes>1` 欠定 | §5 S4 通用退避循环（探针自持退避镜像：初值 debounceMs，失败后 ×2 cap maxDirtyMs，镜像 lifecycle.ts:456）；n=1/2/3 序列展开 | ✅ 落实。循环终止条件正确（注入耗尽且 ready）；探针退避镜像与内核 `scheduleRetry` 的捕获-后翻倍时序一致（SA2 源码推演核对）；n=2 实测 P17 |
| 5（LOW）探针未显式走 Cordis | 决策 A 新增段：`const svc = requireDocPersistence(profile.ctx)`，全部调用经 `svc`，`svc === profile.persistence` 开场自检（不一致 → `probe-failed:service-identity`） | ✅ 落实 |
| 6（LOW）probe-failed reason 词表 | §6.2 封闭词表（6 模式，带 {docId}/{generation}/{step} 占位）；§8「无环境痕迹」禁令对成败 record 一律适用；原始错误走 stderr 永不进 record | ✅ 落实 |
| 7（INFO）「8 微任务」转述失真 | §6.3 勘误（testkit 每轮 3 微任务，testing.ts:126/129）；自建时钟排空数为自选参数，结算兜底 = settle(32) + file 真实等待 | ✅ 落实（SA2 已核 testing.ts:126/129 确为 3 次/轮） |
| （SA1 自查新增）R0 §7 伪代码 `memoryIo` 嵌套透传错误 | §7 伪代码勘误（展平 + `exactOptionalPropertyTypes` 条件展开）；§11 风险新行；§13 P18 | ✅ 属实且重要——**SA2 独立重跑复现**：嵌套传法 hook 触发 0 次（静默忽略），展平后 2 次（create-commit + flush）；`tsconfig.base.json` 确有 `exactOptionalPropertyTypes: true`，条件展开必要性成立 |

## §9 缺陷 3 修复配方专项复核（复审核心）

**修法 B 选择论证审查**——三点论证均成立且 SA2 认可取舍：

1. **断言语义零反转**：原断言 `expect(loaded!.doc).toBe(doc)` 的意图（同一 live Y.Doc）在 cache-hit 路径下为真，目标值逐字保留；修法 A 需把断言方向反转为 `not.toBe`，改动面更大。✓
2. **覆盖净增益**：「共享 doc、独立 handle」cache-hit 语义在 service 级此前无直接覆盖（AC2 仅经探针事件间接覆盖）；驱逐/新实例语义已被 AC2（`instanceCounts.size>=2`）、AC5、AC6（reload `not.toBe`）三方锚定，修法 A 属重复覆盖。✓
3. **反黑帽守卫原生嵌入**：尾部 `isDestroyed===true` + `pending()===0` 使 phantom-handle 邪路（R0 攻击点 1 指出的黑帽）立即爆红——把 R0 的「堵死黑帽」要求变成了测试自身的常驻断言。✓

**SA2 独立重跑（真实内核 + 逐字 SA6 FakeTimer）**——R2 落盘版 AC1-memory 全序列逐断言验证：

| 断言 | 结果 |
|---|---|
| `handle.doc === doc` / `owner` / `docId` | true / true / 'doc-alpha' ✓ |
| `loaded !== null` | true ✓ |
| **`loaded.doc === doc`（cache-hit，R0 不可满足项）** | **true ✓** |
| `loaded !== handle`（独立 lease） | true ✓ |
| 双 release 后 `doc.isDestroyed === true`（反黑帽） | true ✓ |
| `timer.pending() === 0`（反黑帽） | true ✓ |

**落盘核对**：工作区 `dsh-profile-acceptance.test.ts` 的 R2 diff 与 §9 修法 B 配方逐行一致；简报 §6「R2 修订记录」留痕完整（含修订后红灯仍成立的实跑证据）；红态复核（SA2 本轮实跑）仍为收集期 `Cannot find module '../src/index.js'` 真红。

## §13 P13–P18 补据复核

| 证据 | SA2 复核方式 | 结论 |
|---|---|---|
| P13（AC1-memory 证伪） | R0 轮 SA2 亲自实测（结果逐项一致：`isDestroyed: true` / `loaded.doc===doc: false`）+ P2 锚点 `memory-persistence.test.ts:366` 已核 | ✅ 可信 |
| P14（修法 B 可满足） | **本轮 SA2 独立重跑**（见上表） | ✅ 成立 |
| P15（AC4-service-memory 2-hop） | **本轮 SA2 独立重跑**：逐字 SA6 hook（`async () => { writes+=1; if(writes===2) throw }`）+ 逐字 FakeTimer，`advanceBy` 后**立即** `persistence-degraded` ✓ → 拒绝 ✓ → retry advance 后**立即** `ready` ✓ → resolve ✓（writes=3） | ✅ 成立（R0 由 SA2 推演代补的作业已由 SA1 以实测补齐且吻合） |
| P16（探针全场景 n=1） | 引用输出与内核源码行为核对一致；`dirty generation=2` 在 `recovered` 后的锚直接支撑攻击点 3 立法 | ✅ 形式与机制可信；绝对刻度（1504 vs §5 表 1508）差异已在 P16 声明为原型场景压缩，AC 断言不含绝对刻度（仅 `>=500` 与排序），无影响。建议 SA4 对真实实现重跑（红转绿即天然复核） |
| P17（n=2 退避循环） | 时间戳序列（+500/+1000/+2000）与内核退避源码（lifecycle.ts:383 初值、456 捕获-后翻倍 cap 5000）精确吻合 | ✅ 同上 |
| P18（memoryIo 展平） | **本轮 SA2 独立重跑复现**（嵌套 0 次 / 展平 2 次）+ `memory.ts:15-22` 源码 + `exactOptionalPropertyTypes: true` 已核 | ✅ 成立，R0 伪代码错误确认已修正 |

## 剩余观察项（非阻塞，不构成 reject 依据）

1. **（LOW，状态行滞后）**设计文档头部（第 9 行）、§9 缺陷 3 标题、§12 ALLOW 注记仍写「待总控协调 SA6 R2」——但 R2 修订**已在工作区落盘**（未提交 diff + 简报 §6 留痕）。属状态描述滞后于事实的一行文字，建议提交前同步为「已落盘（R2）」；不影响设计内容正确性。
2. **（INFO）**SA3 实现须照 §7 **R1 修订版**伪代码（memoryIo 展平 + 条件展开）执行，R0 版伪代码已作废——P18 已立法，此处仅作交接提醒。
3. **（INFO）**P16/P17 为设计期原型输出（脚本已删），SA4 活链路验证时以真实实现的红转绿与 AC8 双跑逐字节一致为最终闭环。

## R1 复审验证证据（SA2 实跑，2026-08-22）

```bash
# ① 修法 B 全序列 + P15 + P18（真实 MemoryPersistence + 逐字 SA6 FakeTimer；脚本 /tmp/sa2-r1/verify.mjs，已删）
cd /home/wangjian/nomicore-fix-issue-59 && pnpm exec tsx /tmp/sa2-r1/verify.mjs
#   → ① handle.doc===doc: true | loaded.doc===doc: true（R0 不可满足项现可满足）
#        loaded!==handle: true | 双release后 isDestroyed: true | pending: 0
#   → ② P15：首次 advance 后【立即】getStatus: persistence-degraded ✓
#        saveDoc 拒绝 ✓: persistence-degraded: writes are rejected until retry succeeds
#        retry advance 后【立即】getStatus: ready ✓ | 恢复可写 resolve ✓（writes = 3）
#   → ③ P18：嵌套 memoryIo 下 hook 触发次数: 0（静默忽略）| 展平后: 2（create-commit + flush）

# ② R2 落盘 diff 与配方一致性 + 流程留痕
git -C /home/wangjian/nomicore-fix-issue-59 diff HEAD -- packages/dsh-persistence/test/dsh-profile-acceptance.test.ts
#   → AC1-memory 用例：loadDoc 前移 + not.toBe(handle) + isDestroyed/pending 守卫 + timer 提升；
#     `expect(loaded!.doc).toBe(doc)` 断言目标值原样（diff 上下文逐字核对）
git -C /home/wangjian/nomicore-fix-issue-59 diff HEAD -- wiki/raw/task_dsh-persistence-inspector.md
#   → §6 R2 修订记录完整留痕（含修订后红灯仍成立实跑）
git -C /home/wangjian/nomicore-fix-issue-59 log --oneline -5
#   → 657b877（缺陷 1/2 SA6 R1 落盘）在案；R2 为工作区未提交态

# ③ R2 落盘后红态复核（真红非伪红）
cd /home/wangjian/nomicore-fix-issue-59 && pnpm exec vitest run \
  packages/dsh-persistence/test/dsh-profile-acceptance.test.ts --reporter=basic
#   → Test Files 1 failed（收集期 Cannot find module '../src/index.js'；修订后 10 用例随文件整体红灯）

# ④ 佐证静态核对
grep -n '"exactOptionalPropertyTypes"' tsconfig.base.json        # → 9: true
grep -n "not.toBe(oldDoc)" packages/persistence/test/memory-persistence.test.ts  # → 366（P2 契约锚点）
```

## R1 复审最终裁决

**pass**。

- R0 全部 7 个攻击点已落实，关键项（修法 B、P15、P18）经 SA2 独立重跑验证；SA1 自查新增的 P18（memoryIo 展平）是真实且必要的修正，避免了 SA3 照 R0 伪代码实现出「注入缝静默失效」的缺陷。
- §9 盘点表逐行挂证据的纪律已建立；缺陷 3 修法 B 配方经独立验证可满足，SA6 R2 已按配方落盘且真红保持。
- 剩余事项均为非阻塞观察项：设计状态行与已落盘 R2 的一行同步（观察项 1）、SA3 照 §7 修订版伪代码实现的交接提醒（观察项 2）。
- **边界重申**：本 pass 仅表示设计通过攻击评审；实现正确性（红转绿、AC8 双跑逐字节一致、P16/P17 在真实实现上闭环）仍由 SA4/SA7 对实现与活链路验证，不因此免除。

---

# R2 评审节（2026-08-22）

**评审对象**：`task_dsh-persistence-inspector_design.md` R2 修订轮（SA7 F-FILE fail-needs-fix 回流后的 §6.2 两阶段结算协议重写 + 连带 §5/§8/§9/§11/§12 + §13 P19–P23）
**评审范围（按总控指令）**：聚焦 §6.2 新协议——① 三个条件 A 信号是否真为内核公共面的状态蕴含而非新时序猜测；② 时间线不变式论证是否闭合；③ 顺序规则是否有反例；④ DENY/AC8 是否保持。其余架构不重开。
**评审方法**：SA7 报告根因核对 + lifecycle.ts 源码逐行不变式复核（引用行号逐一验证）+ SA2 独立原型三组（A-arming/A-evict 吸收机理、失败腿 pending 基线算术、退避链武装追踪），原型位于 /tmp 已删除，工作区零污染。

## 一、四个焦点问题的裁定

| 焦点 | 裁定 | 依据 |
|---|---|---|
| ① 条件 A 信号 = 状态蕴含？ | **成立**（附一处公式缺陷，见攻击点 R2-1） | **原子性引理**✓：`flush()` 的 try 尾（`savedGeneration/degraded` 赋值，lifecycle.ts:431-433）→ catch（:436-437）→ finally（:440 `flushing=false`、:444-447 重排、:449 `maybeEvict`）之间**无 await**——记账是 `io.write` 结算后的单个同步续体（单微任务），宏任务观察者（探针轮询定时器）只能看到记账前/后整体状态，无中间态。**武装不变式**✓：`scheduleFlush` 以 `entry.flushing` 早退（:400），`flushing=false` 全源码仅在 finally（:440）赋值 → 「已武装 ⟺ 前次记账完成」为状态蕴含。**A-evict**✓：`maybeEvict` 仅两调用点（:396 release 路径 / :449 记账 finally）→ evict 事件被观测 ⟹ 记账已运行；探针 teardown 晚于 A-evict 通过 ⟹ 症状 A 的拆监听竞态被闭合。**推论①**✓：degraded/ready 翻转只发生在记账块内（SA2 源码验证 + 失败/恢复腿均为状态翻转谓词）。 |
| ② 时间线不变式闭合？ | **闭合** | 「脏 saveDoc → 武装确认之间不推进虚拟时钟」使两路径（记账滞后→finally 重排以未动 now 武装；记账先行→saveDoc 直武装）落到**同一虚拟到期刻**——SA2 原型 A 独立复现：arming 等待 31ms 真实、虚拟 t 冻结 500，flush g2 落钉死刻 **t=1000**（=500+500），evict 与 release 同刻，等待期间虚拟时钟零移动、零事件 → record 不可见 → AC8 恢复的论证成立。SA2 原型 B/C 另独立复现旧协议停滞机理（窗口内 saveDoc → pending=0 → advance 无事可发）与前窗欠结算导致的**虚拟刻漂移**（retry 被武装在 1500 而非 1000——ab#4，恰为症状 B 机理的又一受控复现），反证语义谓词的必要性。 |
| ③ 顺序规则有反例？ | **规则方向正确，但存在两处未声明的边界**（攻击点 R2-1/R2-2） | 「A-arming 必须紧随后置 saveDoc」✓（成功且 saved===dirty 的窗口记账后不武装任何计时器——SA2 原型 B 恢复腿实测 pending=0——孤立 `pending>base` 等待必超时，P23 反例方向由 SA2 数据再证）。**但**：设计给出的 `pending>base` 基线公式本身在 advance 驱动腿上恒假（R2-1）；A-arming 的净零武装边界未声明（R2-2）。 |
| ④ DENY/AC8 保持？ | **保持** | 全部信号为公共面：`getStatus()`、提交态快照文件、**探针自有时钟**的 pending 内省、Yjs `destroyed` 公共事件、service 调用本身——`packages/persistence` 零改动（§12 DENY 完整）。AC8：协议零事件、等待期间虚拟时钟零移动（②），P23 60 跑逐字节一致；失败词表仍封闭（A 等待超时沿用 `file-settle-timeout:{docId}:g{gen}`）。候选①（契约面加 in-flight 观察口）的否决理由（连锁审计半径）成立。F-REJECT-LEAK 移交总控立 P3 跟进项的处置不越权、适当。 |

## 二、R2 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| R2-1 | **HIGH** | §6.2 pending 联言的**基线公式错误**（两处） | (a) **失败/恢复腿「可叠加 `pending>base` 联言作纵深防御」**：按字面（base 取 advance 前），首次失败腿 base=2（debounce+maxDirty）→ 记账完成后 pending=1（仅 retry）→ `1>2` **恒假**——若 SA3 照字面实现联言，file n=1 **每跑必超时**（不是 flaky，是确定红）；恢复腿更甚：成功且 `saved===dirty` 时 finally **不重排**（lifecycle.ts:444 条件不满足）→ 记账后 pending=0 → 联言恒假 → 恢复腿挂联言必超时。(b) **中间失败腿（n≥2）「`pending>base`，base 取 advance 前」**：advance 消耗 retry 计时器（FakeTimer 语义：触发即删除）→ base=1，记账后重排新 retry → pending=1 → `1>1` **恒假**——file 通道 n≥2 的中间失败腿**无任何可用信号**，是对 R1 攻击点 4「任意 n 确定」承诺在 file 通道上的回归（CLI 契约面接受任意 n）。SA2 原型 B 在真实 `FilePersistence` 上实证三组算术：`base=1 → pending>base false`；`base 取 advance 后（=0）→ pending(1)>0 true`；恢复后 `pending=0`。 | **统一修正为「触发动作返回点的同步基线」**：A-arming 保持 base 取 saveDoc 返回前（原文已正确——saveDoc 无 await 段同步武装，两路径皆 `2>0`）；**advance 驱动腿改 base 取 advanceBy 返回瞬间**（到期计时器已被同步消耗，此时可断言/记录 pending 值，随后 `waitFor(pending > base)`）；**恢复腿删除 pending 联言**（status 翻转本身已是完备记账证明——原子性引理推论①，无需第二信号）。修正后 n≥2 file 中间失败腿获得正确信号（advance 后 0 → 记账后 1）。§13 补一行实证（SA2 原型 B 命令即可）。 |
| R2-2 | MEDIUM | A-arming 的**净零武装边界**与 `pending()` 接口面未声明 | (a) 同一 doc 在一个 debounce 窗口内**两次 saveDoc** 时，`scheduleFlush` 对已存在的 debounce 计时器 clear+set 净零、maxDirty 已存在不新增 → pending 不增 → A-arming 等待超时。当前场景无此窗口（每脏写窗口恰一次 saveDoc 后必 advance 到 flush），但这是协议**前置条件**，未写入顺序规则——未来场景编辑（如「连续两次标脏验证 debounce 合并」）会静默踩雷。(b) `ProbeClock` 接口（§6.3）只有 `advanceBy` 扩展，`pending()` 是 A-arming 依赖的**新内省面**（SA6 FakeTimer 碰巧带有），自建时钟必须补且须钉死语义（「pending 不含已触发已删除的计时器」——SA6 FakeTimer 触发即删除，自建时钟须同语义，否则 R2-1 修正后的基线算术不成立）。 | §6.2 顺序规则补两条前置：「A-arming 基线期间该 doc 无既存未决 debounce/maxDirty 计时器对（每脏写窗口恰一次 saveDoc）」；§6.3 `ProbeClock` 补 `pending(): number` 声明与语义注记（含「已触发已删除不计」），自建时钟实现之。 |
| R2-3 | LOW | status 谓词的实例级语义前置未声明 | `getStatus()` 是**实例级**信号：失败/恢复腿的翻转谓词隐含「当前唯一 degraded 源是本 doc」。当前场景成立（S4 唯一降级源、探针全程持 handle、窗口串行、降级不驱逐——`maybeEvict` 的 saved!==dirty 前置保证 degraded entry 不被驱逐清空），但多 doc 并行降级的未来场景会使翻转谓词失真。 | §6.2 加一句前置声明（单降级源 + 窗口串行），标注未来扩展时的信号替换方向（per-doc 状态需内核公共面演进，届时另行 ADR/设计评审）。 |

## 三、协议骨架的正面确认（不再重开部分）

以下经 SA2 源码级复核 + 独立原型确认**成立**，R2 修订不须触及：条件 W/A 拆分（W 只证字节提交、不再当记账证据）；原子性引理与推论①②；武装不变式；A-arming 的「紧随后置 saveDoc」放置与 pre-saveDoc 基线；A-evict 的记账蕴含 + teardown 时序闭合 + reload 前置（保证 cache miss）；中间 release 无需等待（`maybeEvict` 的 handles>0 前置使 release 与 flushing 无关，SA2 源码验证）；窗口协议表对 n=0/n=1 全部 advance/release/load 的覆盖完备性（SA2 逐窗口枚举核对）；虚拟刻度不变式与 §5 钉死值逐字保持（含 n=0 的 events=28 / t=2008 / t=2009 锚）；DENY 零改动；AC8 恢复论证；P19–P23 证据链与内核源码一致性（P17/P22/P23 的时间戳序列与 lifecycle.ts:383/456 退避算术、SA2 原型 arms 日志吻合）；候选①否决理由；F-REJECT-LEAK 处置。

## 四、红线测试思路

1. **R2-1**：① `runPersistenceProbe({adapter:'file', failFirstFlushes:1})` 在 R2-1 修正后跑 ≥20 次：每次 ok=true、events=32、无 `file-settle-timeout`（若联言照旧字面实现，本测试第一跑即红——确定性超时，非 flaky）；② `--adapter file --fail-first-flushes 2` CLI：断言 ok=true、record 含**两条同 generation=1 的 ok=false**（t=1508/2008）+ `recovered`@3008 + `dirty generation=2` 在 recovered 后 + 同参双跑逐字节一致（当前 SA6/SA7 锚均未覆盖 file n≥2——本缺陷的回归口）；③ 恢复腿专项：断言恢复后 `pending===0`（成功不重排）且恢复腿谓词不含 pending 联言（设计文本断言即可）。
2. **R2-2**：包内自测——自建时钟 `pending()` 语义（武装后 >0、触发并消耗后归零）；「同窗口二次 saveDoc」的守护可暂以文档前置 + 场景断言（每窗口恰一次 saveDoc）承载，若未来场景需要连续标脏，须先给 A-arming 换信号。
3. **R2-3**：设计文本断言（单降阶源前置）；无新增测试需求。

## 五、R2 评审验证证据（SA2 实跑，2026-08-22）

```bash
# ① 原型 A：A-arming/A-evict 吸收机理（真实 MemoryPersistence + 30ms 延迟钩子 = 确定性竞争窗口 + 逐字 SA6 FakeTimer）
cd /home/wangjian/nomicore-fix-issue-59 && pnpm exec tsx /tmp/sa2-r2/arming.mjs   # 脚本已删
#   → 旧协议：saveDoc 时 pending=0（scheduleFlush 早退），advance 后仍 0 → flush g2 永不发生（症状 B 受控复现）
#   → 新协议：arming 通过（真实等待 31ms）pending=2 虚拟t=500 → flush g2 落 t=1000（钉死刻 ✓）
#     release t=1000 → A-evict 等待 31ms → evict t=1000 与 release 同刻，等待期间虚拟时钟零移动 ✓

# ② 原型 B：失败腿 pending 基线算术（真实 FilePersistence + .tmp 目录阻塞 + 逐字 FakeTimer）
pnpm exec tsx /tmp/sa2-r2/baseline.mjs
#   → saveDoc 后 pending = 2 | 首次失败记账后 pending = 1（retry 已排）
#     「base 取 advance 前」: base=1, 记账后 pending=1 → pending>base = false（恒假 = 等待必超时）
#     「base 取 advance 后」: base=0, 记账后 pending=1 → pending>base = true（正确信号）
#     恢复后 pending = 0（saved===dirty → finally 不重排 → 恢复腿挂 pending 联言必超时）

# ③ 原型 C：退避链武装追踪 + A/B 六连跑（同进程）
pnpm exec tsx /tmp/sa2-r2/ab.mjs
#   → 六跑 arms 全部收敛 [maxDirty, debounce, retry#1@1000, retry#2@2000]——虚拟到期刻确定；
#     真实结算轮次方差 r2~r80+（固定轮数结算不可靠——印证设计「语义谓词而非固定轮数」的立法）
#   → ab#4：前窗记账未结算即 advance → retry 被武装在 t=1000→1500（漂移刻）而非 1000
#     ——症状 B 机理的又一受控复现，反证「每窗结算谓词先行」的必要性

# ④ 源码级不变式核对（静态）
sed -n '399,404p;419,451p;463,469p' packages/persistence/src/lifecycle.ts
#   → scheduleFlush 早退守卫(:400) / startFlush 单飞锁(:419) / 记账块无 await(:431→:440→:449) /
#     maybeEvict 双调用点(:396,:449)——与设计 §6.2 引用逐行一致
```

## 六、R2 评审最终裁决

**reject（窄幅）**。

- **协议骨架确认成立**：§6.2 两阶段结算协议（W + A-arming/A-evict/原子性引理）的三个条件 A 信号经 SA2 源码级复核均为内核公共面的**状态蕴含**而非时序猜测；虚拟刻度不变式闭合；DENY/AC8 保持。SA1 对 SA7 F-FILE 的根因理解与修复方向正确，P19–P23 证据链与内核行为吻合。
- **必须修订（放行 SA3 前）**：攻击点 R2-1（HIGH）——§6.2 两处 `pending>base` 基线公式按字面落地必红（失败/恢复腿联言恒假、file n≥2 中间失败腿无信号），统一修正为「触发动作返回点同步基线 + 恢复腿删联言」；R2-2（MEDIUM）——A-arming 净零武装前置 + `ProbeClock.pending()` 接口与语义声明；R2-3（LOW）——status 谓词单降级源前置声明。
- **修订范围**：仅 §6.2 一节内的基线定义/前置声明 + §6.3 接口补一行 + §13 补一行实证；协议骨架、窗口表、§5 钉死值、§8/§9/§11/§12 均不须动。修订后 SA2 复核仅限该节，预期直接 pass。
- **闭环提醒**：R2-1 修正后 SA4 复审须专项核对 SA3 落地的谓词形态（联言是否照字面实现——这是本缺陷的注入点）；SA7 复跑除 52 跑外建议补 file n=2 批次（当前锚只覆盖 n=0/1，见红线测试 #1②）。
