# SA9 Standards 审查报告 — issue #307（vfsl-codegen 联合成员 doc 四发射位）

> SA9（独立 Standards 审查者）standards-review 轮产物（**iteration 1**，F1 修正后复审）。
> dispatch `sa-cbc03fb8-d431-4840-9ec6-0cf64ad8351f`，role `mabf-sa9`，phase standards-review，iteration 1。
> **Worktree**：`/home/wangjian/nomicore-fix-issue-307`（branch `mabf/issue-307`）。
> **被审对象**：SA9 F1 注释级修正后的最终交付 diff —— `git rev-parse HEAD` 亲证 =
> `f63b0a5c2fa845aa64b1cf0c5eadb7057b5c20d2`（与派发指定的权威 Parent PR #305 head
> 逐字符一致）；`git status --porcelain -uall` 亲证恰为 3 个 modified src
> （`packages/vfsl-codegen/src/{emitter,docs,valuetype}.ts`，`git diff --numstat` =
> 18/5 + 79/6 + 23/3 = +120/−14，与 iteration 0 审查的同一份实现）+ 未跟踪的 SA6 契约测试
> `packages/vfsl-codegen/test/generate-union-member-docs.test.ts`（638 行，Host 预置）
> + 10 个 `wiki/raw/task_issue-307*` 管线产物。stash 空、索引无 staged。
> **Rebase 核验**：`git merge-base --is-ancestor 4d4208b HEAD` 亲证旧基线为现 HEAD 祖先；
> `git show f63b0a5 --stat` 亲证 Parent PR #305 head 仅触 `apps/yjs-server/src/lifecycle.ts`、
> `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`、`docs/integration/hub-peer-deployment.md`；
> `git diff 4d4208b HEAD -- packages/vfsl-codegen packages/vfsl domains` 亲证**零字节**——
> 基线增量与交付面零交集，rebase 无冲突且不可能扰动任何金样本/生成物字节。
> **Issue 反馈**：派发简报明示 REST 快照无评论（none applicable）；任务简报
> `wiki/raw/task_issue-307.md` `## Comments` 节为空，一致——无 owner 覆盖性输入。
> **输入产物（全部亲读）**：`task_issue-307.md`（简报 + AC1–AC4）、`…_conflict_report.md`
> （SA8 `clear`，W1/W2/B1–B3）、`…_design.md`（SA1，D1–D8/§11/§12）、`…_sa2_review.md`
> （approve，O1–O3）、`…_sa3_impl.md`（**iteration 1**：F1 逐字落实报告）、
> `…_sa4_review.md`（approve，N1–N3）、`…_sa6_contract.md`（approve，33 例 + W1/W2 钉死值
> + §12.4 五门）、`…_sa7_report.md`（approve，干净环境五门全绿 + 138 项 A/B 探针断言）、
> `…_sa10_spec.md`（approve，rebase 后最终 diff 的 AC 逐项核验 + §8 披露清单）。
> **审查方式（不采信上游自述，独立取证）**：交付 diff 逐 hunk 亲读（本轮重读全 diff，
> 与 iteration 0 记录逐行比对）；emitter.ts 改动段上下文（L225-260、L415-459）、
> docs.ts/valuetype.ts 全 diff、ADR 0019 决策 6/7/8 原文、`packages/vfsl/src/derived.ts`
> L75-92 DerivedSchema 八键形状、`index.ts` 公共面、契约测试 hash/mtime/mode 三重核对、
> `grep -rn "部分" packages/vfsl-codegen/src/`（零命中）、契约测试 skip/only/todo grep
> （零命中）、`git diff HEAD --check`（exit 0）、包目录实 ls（无探针残留）。
> **边界**：零业务代码/设计/测试改动；未运行测试、未启动服务（SA9 纪律）；零
> commit/push/PR/finalize；唯一写入 = 本文件。
> **职责面**：仅判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、
> 生命周期对称性、文件范围与测试质量标准；Issue 需求完整实现归属 SA10（已 approve），
> 不在本轮裁决。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **F1 已闭环**（§0）：iteration 0 唯一 MINOR 按 SA9 建议逐字修正，注释现与代码/W1 钉死值
  一致；修正为纯注释单点改动，零可执行语义变化。
- **0 BLOCKER / 0 MAJOR**。交付 diff 在模块责任、ADR 符合性、既有架构惯例、单一事实源、
  生命周期对称性、文件范围、测试质量七个 standards 面全部合规（§1–§7 复核维持）；
  rebase 落点与集成惯例核验成立（§8）。
- 0 项 MINOR 遗留；2 项 OBS（O1/O2）维持登记，均不阻断（§9）。

---

## 0. F1 修正核验（本轮核心）

**iteration 0 F1（MINOR）**：emitter.ts L243 闸门注释枚举「闸门闭合（无 M4 输入、M3 优先位、
**部分/全部成员无条目**、非 leaf 结构形）」中「部分成员无条目」与代码/W1 钉死值不符——
部分成员有条目时闸门**开启**（`.some((d) => d !== undefined)`，契约「W1 判据：部分成员有
doc → 全成员逐行多行」用例钉死）。建议：删「部分/」二字。

**本轮亲证（全部命中）**：

| 核验项 | 证据 | 结论 |
|---|---|---|
| 注释文本已修正 | emitter.ts L243 现读：「按位点独立。闸门闭合（无 M4 输入、M3 优先位、**全部成员无条目**、非 leaf 结构形）→ 既有单行路径逐字保留」——「部分/」二字已删，即 SA9 建议原文 | ✅ 已闭环 |
| 修正后注释与代码一致 | 闸门 L246-249：`node.kind === 'leaf' && memberCount > 0` + `Array.from({length: memberCount}, …memberDocsAt…).some((d) => d !== undefined)`——任一成员有非空条目即开闸；闭合 ⟺ 该位点全部成员无条目。枚举四项（无 M4 输入 → 表 undefined / M3 优先位 → 整键缺席 / 全部成员无条目 / 非 leaf 结构形 → `memberCount = 0` 或 leaf 条件不成立）与代码路径一一对应 | ✅ 准确 |
| 修正后注释与 W1 钉死值一致 | SA6 §12.2「部分成员有 doc → 全成员多行」「整键缺席永不切换」；同注释前两句 W1 判据原文（「存在非空条目……不按值侧 kind / 成员数量推测；按位点独立」）未动且正确 | ✅ |
| 同类失实措辞零残留 | `grep -rn "部分" packages/vfsl-codegen/src/` 亲跑零命中（exit 1） | ✅ |
| 改动确为注释级单点 | emitter.ts sha256 `63fd9150f34ac24896bb70abf0f95f9cbec39ebd6a2771472512ac82b88fc56f` 与 SA3 iteration-1 报告记录逐字符一致；diff numstat 仍 +120/−14（行内文本替换，行数不变）；全 diff 与 iteration 0 审查版逐行比对，唯一差异 = L243 该注释行文本 | ✅ 无夹带 |
| 契约测试未被连带触碰 | sha256 `b9c87b9ea0360f04362214a2eaeb769f5d03ec17ac11e158742edf1676189e64` 与 SA3/SA4/SA7 三处记录逐字符一致；mtime `2026-09-11 14:09:56`（实现改动前）未变；仍 mode 600 未跟踪（O1） | ✅ |
| 动态证据转移 | SA3 iteration-1 提供机械证明（`transpileModule` 去注释 JS 前后 sha256 相同 = 零可执行语义变化）+ 复跑五门全绿（包测试 95/95、包/根 typecheck、`generate --check`、根 `pnpm test` 316 文件 3351 例）；SA9 不复跑（纪律），证明方式对注释级改动充分且与真实入口核对一致 | ✅ 采信 |

**结论：F1 resolved。** 闸门闭合枚举现与代码语义（`.some()` 全假才闭合）和 W1 钉死值
（部分 doc 开闸）严格一致，无引入新失实。

## 1. 模块责任与包边界（AGENTS.md 链）——维持合规

| 包 AGENTS 边界条款 | 本轮复核 | 判定 |
|---|---|---|
| Consume evaluator output; do not re-derive VFSL semantics | 成员边界信息仍**只**经 `memberDocsAt`（emitter.ts L430-433）按 `${path}.<member ${i}>` 索引查 derived 第四表；`structureOf`/值折叠/物化语义判定零触碰（diff 无该区 hunk）。F1 修正仅动注释，本面零变化 | ✅ |
| Keep output deterministic and byte-stable; `generate --check` must detect every stale file | 查键 only、绝不枚举表；成员循环全部按声明序数组；无定时器/随机/环境读取。F1 为注释改动，确定性/字节面不受影响（`--check` 对源码注释不敏感，生成物字节零影响） | ✅ |
| Preserve module augmentation and empty-domain behavior | 段③ 增广体装配、`emitInterfaceMember`、`emitObjectMembers` 零改动（diff 亲证） | ✅ |
| Fail loudly with stable diagnostics | 既有 throw 触发条件与顺序零变化；唯一新 throw 仍为 `projectUnionMembers` 内部误用守卫（valuetype.ts L76，响亮、正常输入不可达） | ✅ |
| Keep CLI filesystem concerns at the edge; emitter independently testable | `cli.ts`/`collect.ts`/`index.ts`/`header.ts`/`protocol-surface.ts` 零改动（git status 亲证） | ✅ |
| Verification（emitted types 变更 → 根 typecheck + test） | SA7 干净环境五门全绿 + SA3 iteration-1 修正后复跑五门全绿（95/95、双 typecheck exit 0、`--check` exit 0、根 3351/3351）；SA9 不复跑（纪律），证据链与真实入口逐项核对一致 | ✅ |
| 根 AGENTS「Typed Namespace writes 强制」 | 不适用——本任务无 namespace 写路径、无 schema.vfsl 变更 | ✅ |

## 2. ADR 与既有架构惯例符合性——维持合规

| 基准 | 本轮复核 | 判定 |
|---|---|---|
| ADR 0019 决策 6（直接规范来源，原文亲读 L106-130） | 四发射位逐位在场：位 1 `emitAlias` union×union 行装配（L230-238，doc 块在 `  \| ` 行上方、缩进与 `\|` 列对齐——与 ADR 决策 6.2 示例布局同构）；位 2 坍缩别名 W1 闸门 + 多行（L240-259）；位 3 `emitInner` case `'union'` 行内前缀（L331-333 区，经 `emitNode` 全覆盖）；位 4 case `'leaf'` enum/union 分段前缀。末段无发射位：case `'plain'` 仍走无 doc 感知的 `projectValue(value.element)`、case `'xml-fragment'` 仍不透明 `'string'`——结构性保证，无特判 | ✅ |
| ADR 0019 决策 6.2 / SA6 §12.2（W1 钉死值） | 判据 = `Name.<member N>`（N ∈ [0, 值侧成员数)）存在**非空**条目（`memberDocsAt` 空数组视同缺席，SA2 O1 落实）；不按值侧 kind/成员数量；按位点独立；部分 doc → 全成员多行且仅 doc 成员带 doc 行；整键缺席永不切换；非 leaf 结构形恒闭合（SA2 O2 落实）。**F1 修正后注释叙述与该判据完全一致** | ✅ |
| ADR 0019 决策 6 + SA6 §12.3（W2 钉死值） | 块位 = 既有 `tsdocLines`（join `'\n'`、2 空格基准）；行内位 = 新 `tsdocInline`（join `' '`）+ 尾单空格；渲染单源 `tsdocBlock` 逐字（默认 `/** ` 行尾空格保留、semicolonFree 剥除）；零新规范化 | ✅ |
| ADR 0019 决策 8（纯文档性质） | 纯注释字节发射；校验/物化/指纹/机器语义面零触碰（diff 无 packages/vfsl hunk） | ✅ |
| ADR 0005 D3/D4（纯发射器 + regen-diff 纪律） | `generateProjection` 签名零变化；`memberDocs: derived.memberDocs` 逐字引用不复制不规范化（L159-160）；无 doc 输入 → 四路径输出与 HEAD 逐字节等价（§3） | ✅ |
| ADR 0004（类型树形状 = 生成契约） | 类型形状零变化；契约 C12 双格式孤立 program `preEmitDiagnostics` 空断言锚定 | ✅ |
| ADR 0003（派生 schema 冻结形状，经 0019 决策 5 修订） | derived.ts L84-91 亲读：`memberDocs?: Record<string, string[]>` 第八键居末、条件稀疏；emitter「八槽」注释与实数一致；本 diff 只消费 | ✅ |
| 相似能力先例（#222 字段 doc 双模式、包内导出先例） | `tsdocBlock` 复用 semicolonFree 既有分支表达式；`projectUnionMembers`/`tsdocInline` 仅包内导出、`index.ts` 亲读仍仅 `generateProjection` + 选项类型 | ✅ |
| 代码注释惯例（中文、§/ADR/票据锚引） | F1 修正后的注释维持同文体（「#307 发射位 N（ADR 0019 决策 6.x）」「W1 判据（SA6 §12.2）」锚引不动）；修正本身提升了注释-代码一致性，方向正确 | ✅ |

## 3. 单一事实源与逐字节稳定性——维持成立

| 事实 | 权威源 | 本轮复核 |
|---|---|---|
| 联合成员分段 | `projectUnionMembers`（valuetype.ts L65-77） | `projectValue` 的 `case 'enum'`/`case 'union'` 合并 fall-through 到 `projectUnionMembers(...).join(' \| ')`——diff 双侧逐字比对，被删两 case 的 map 体原样搬入助手；`stack` 默认 `[]` 与旧调用点不传参两向一致。保形成立（F1 未触本文件外的任何代码行） |
| doc 块渲染 | `tsdocBlock`（docs.ts L28-32，模块私有） | `tsdocLines` = 同一 map + `join('\n')`（既有单块表达式原样搬移，早退保留）；`tsdocInline` 共用同块、零缩进 join `' '`。输出字节与 HEAD 相同 |
| doc 查键 | `memberDocsAt`（emitter.ts L430-433，亲读） | 四发射位 + 闸门探测全部经此单点；返回 `readonly string[]`；空数组视同缺席 |
| 无 doc 等价（D2–D5） | 装配代数等价 | `lines = ['  \| m0', …].join('\n')` ≡ 既有 `` `  \| ${members.join('\n  \| ')}` ``；空前缀 map + join 恒等；闸门闭合 fall-through 返回语句（L260）与 HEAD 逐字相同（diff 亲证该行未动） |
| `EmitTables.memberDocs` 类型 | `Record<string, string[]> \| undefined` 必填槽 | `exactOptionalPropertyTypes: true` 下必填 + `\| undefined` 是唯一正确写法，与 derived 可选键读取类型兼容 |

无第二份成员边界推导、无第二套渲染器、无表驱动遍历、无平行错误/降级通道（设计 A1–A6
否决路径均未采用，本轮 diff 复核亲证）。

## 4. 生命周期对称性——维持成立

纯函数、无状态、无缓存、无 IO——无 register/dispose、acquire/release 面，不适用且无新增
不对称。CLI 文件系统关注点保持在边缘（cli.ts/collect.ts 零改动）。`generate` → `--check`
同字节幂等纪律由既有机制承载、本 diff 零改动。F1 注释修正不引入任何生命周期面。✅

## 5. 文件范围（SA1 §11 ALLOW/DENY × git 亲证）——维持合规

| 项 | 本轮亲证 | 判定 |
|---|---|---|
| ALLOW 3 src | `git status`/`git diff --numstat` 恰为 emitter.ts（79/6）+ docs.ts（18/5）+ valuetype.ts（23/3）= +120/−14，逐 hunk 落在 ALLOW 描述内；本轮唯一增量（L243 注释）属 ALLOW 行 1 明文覆盖的「相关注释更新」 | ✅ |
| 契约测试（DENY 行 1，实现侧禁改） | sha256/mtime/mode 三重比对与 SA3/SA4/SA7 记录逐字一致，本轮修正未连带触碰 | ✅ |
| 其余 DENY（`packages/vfsl/**` 含 #308 面、`docs/vfsl/**` #309 面、cli/collect/index/header/protocol-surface、`domains/**`、协议包、其余测试） | git status 零命中；`packages/vfsl-codegen/` 目录实 ls 仅剩 AGENTS/package/README/src/test/tsconfig/node_modules——无探针/临时文件残留（SA3 本轮临时脚本在 `/tmp/sa3-f1/`，不在 worktree 内） | ✅ |
| 弹性条款（允许收拢 D6/D7 进 emitter） | 未行使——三文件分工与 ALLOW 逐行对应 | ✅ |
| git 操作面 | stash 空、索引无 staged、HEAD 仍 f63b0a5——本 diff 为未提交工作树状态，提交/合并归 Runner Host（B2 集成惯例） | ✅ |
| 根目录既有 tracked 杂物（`.scratch*/REPORT.md/tests/`） | HEAD 存量 tracked 文件，非本任务引入，零改动 | ✅ |

## 6. 测试质量标准——维持合规

契约测试 638 行本轮未被触碰（§5），iteration 0 的全文亲读结论维持：33 例实数核对
（3+4+7+4+3+6+2+2+2 = 33 ✓）；经公共入口（`parseVfsl`/`evaluate`/`generateProjection`/
CLI `spawnSync`/真实 tsc API）断言运行时行为；本轮 skip/only/todo grep 重跑零命中；
负控「键在场 + 字节缺席」配对、存量域 `toBe` 逐字节、仓根 `--check` 子进程、W2 双发
逐字节一致、CLI mkdtemp 卫生、入口真实性（vitest include/包 tsconfig include/CI 分片
磁盘枚举/ci.yml 三门）全部维持。F1 修正为零行为变化的注释改动，测试质量面无新输入。✅

## 7. 错误语义与失败面——维持合规

- 无新增 try/catch、无静默降级、无伪成功路径（本轮 diff 逐 hunk 亲证）。
- 既有 throw 触发条件与顺序零变化；SA2 O2 精化（闸门 `node.kind === 'leaf'`）使畸形坍缩
  配对仍走既有 desync——SA7 G6 动态证实与 HEAD 同一异常逐字相同。
- 唯一新 throw（`projectUnionMembers` 非联合形守卫）响亮、正常输入经两调用点分支条件
  不可达——与包 AGENTS「fail loudly」同向。✅

## 8. Rebase 与集成惯例（B2）核验——维持成立

- HEAD = 派发指定权威 Parent PR #305 head `f63b0a5c2fa845aa64b1cf0c5eadb7057b5c20d2` ✓
  （本轮 `git rev-parse HEAD` 重证）。
- f63b0a5 改动面（yjs-server root-lock 修复 + 集成文档）与本 diff 零交集（`git diff
  4d4208b HEAD -- packages/vfsl-codegen packages/vfsl domains` 本轮亲证**零字节**）——
  「rebase 无冲突」与事实一致；SA7 五门动态证据（采集于 4d4208b）对 rebase 后 diff 的
  转移性论证维持成立，F1 注释修正不削弱该论证（注释不进生成物字节）。
- 实现挂 #305 支系同支累积（branch `mabf/issue-307`），符合 ADR 0019 后果「Ticket Parent
  惯例」与 SA8 B2。✅

## 9. Findings

| ID | Severity | Finding | 建议 | 阻断 |
|---|---|---|---|---|
| F1 | ~~MINOR~~ **已闭环** | emitter.ts L243 闸门注释枚举与代码/W1 钉死值不符 | 已按 SA9 建议逐字修正（删「部分/」二字），§0 核验全部命中 | 否（已解决） |
| O1 | OBS | 契约测试文件权限位 600（其余测试 664）——SA4 N1 已登记；git 仅跟踪可执行位，入库无实质影响 | 无需动作 | 否 |
| O2 | OBS | 契约测试头注与金样本注引「实测 HEAD 4d4208b」为 rebase 前基线的历史记录；f63b0a5 未触 codegen 字节面（本轮 `git diff 4d4208b HEAD` 零字节亲证），锚引仍事实成立，非失实 | 无需动作 | 否 |

## 10. 收尾结论

SA9 iteration 0 的唯一 MINOR（F1，注释枚举措辞）已按建议逐字闭环：emitter.ts L243 闸门
闭合枚举现为「全部成员无条目」，与 `.some((d) => d !== undefined)` 代码语义及 SA6 §12.2
W1 钉死值严格一致；同类失实措辞零残留；修正为注释级单点改动，零可执行语义变化、零
范围夹带、契约测试未连带触碰。交付 diff 其余部分与 iteration 0 批准审定的实现逐字节
同源（diff numstat 不变、全 diff 逐行比对唯一差异即 F1 修正行），七个 standards 面复核
维持全部合规：模块责任正确（纯发射器只消费派生物）、ADR 0019 决策 6 四发射位与决策 8
纯文档性质逐条符合、单一事实源结构性成立（分段/渲染/查键三单源）、逐字节稳定性代数
复核成立、无发射位边界结构性保持、文件范围零越界、公共面零变化、测试质量全项合规、
rebase 落点与集成惯例核验成立。

**Verdict：`approve`**。`requiresConflictRecheck = false`——无公共 API/wire/schema/持久化/
状态机语义变化，无新生命周期所有权或失败语义，F1 修正未引入任何新冲突面。
