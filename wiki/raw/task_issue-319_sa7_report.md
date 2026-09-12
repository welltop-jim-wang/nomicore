# SA7 动态验证报告 — Issue #319 number 值域收窄核心：validate 与 validate-patch 统一判定（ADR 0021）

- 角色：SA7（mabf-sa7）· 阶段 final-verification · 迭代 0 · one-shot dispatch `sa-c6e2dda3-835b-4a8b-9734-efcbecafee57`
- 验证对象：SA3 实现变更集（worktree `mabf/issue-319` @ HEAD `ff2dc64` 未提交 diff：6 modified + 2 新建测试）的**真实运行链路**——四值（NaN / +Infinity / -Infinity / -0）跨 validate 与 mutation/write 路径的拒绝、`-0` 经 runtime S3 处理后到达 vfsl 边界的拒绝点归属、拒绝传播与零写入、changelog 闭合行为
- 边界：SA7 只做动态验证与报告；未修改任何实现/设计/测试（收尾 `git status` 与实现零 diff，见 §Temporary Diagnostics）
- Issue #319 REST 评论：读取成功且为空数组——无 Owner 评论要求（与简报 / SA6 §2 / SA8 前置 §4 / SA8 复查 §2 / 设计 §4 / SA2 / SA3 / SA4 八方一致）

## 1. Inputs

| 输入 | 用途 |
| --- | --- |
| `wiki/raw/task_issue-319.md` | 验收面（AC1 validate 四值全拒+消息细分 / AC2 写路径同口径 / AC3 changelog 闭合 / AC4 冻结面 / AC5 全绿） |
| `wiki/raw/task_issue-319_design.md`（SA1 迭代 1，SA2 approve） | §8 数据流路线 R1–R4（本报告验证矩阵的路线权威）、D-B 联合报告锁定形态、D-C memo 风险、D-F Q6 runtime 端到端裁决 |
| `wiki/raw/task_issue-319_sa6_contract.md`（approve） | T1/T2 断言规格与消息规则①–④、探针 B2/B3/B4/E/F/G 旧行为基线（本报告的「旧实现」对照事实来源）、§15 Q6 runtime 端到端缺口 |
| `wiki/raw/task_issue-319_sa3_impl.md` | 实现声明（唯一生产改动 `validate.ts`；63 用例红转绿；mutation 探针敏感性） |
| `wiki/raw/task_issue-319_sa4_review.md`（approve） | §11 移交 SA7 的动态项：runtime 端到端 `-0` 写零写入/`validation/rejected`/doc 不变；全仓绿声称的动态复验 |
| `wiki/raw/task_issue-319_implementation_conflict_report.md`（SA8 复查 clear / requiresConflictRecheck=false） | 协议边界确认（override 已落文且未扩大；冻结面零 diff 已核——SA7 不再重复静态复查，只验证运行语义不越界） |
| 实现源码（只读） | `packages/vfsl/src/validate.ts`、`validate-patch.ts`、`packages/namespace-runtime/src/write.ts`（S3 `copyFrozen` L345 / R9 L205–209）、`diagnostic.ts`、`packages/doc-runtime/src/mutation-local.ts` |

## 2. Runtime environment

- Worktree：`/home/wangjian/nomicore-fix-issue-319`（branch `mabf/issue-319`，HEAD `ff2dc64`）；变更集 = SA3 枚举变更集原样（本报告收尾核对：6 modified + 2 新建测试 + wiki 输入，无其他 diff）。
- Node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7 / typescript 5.9.3；`NODE_OPTIONS=--conditions=nomicore-source`（源码直连，无构建依赖）。
- 动态驱动：既有测试套件（T1/T2/doc-runtime 迁移用例/namespace-runtime 写路径与诊断套件/changelog `input-capture`）+ 一枚**临时探针测试**（真实 Y.Doc + `createMemoryPersistence` + `realPersistenceScheduler` + `createNamespaceRuntimeWithSeam`（既有测试同族夹具）+ `createBoundedMemoryDiagnosticLog({inputPolicy:'full', updateCapture:true})`；探针文件已按协议删除，见 §7）。
- 无常驻服务、无端口占用、无外部网络依赖。

## 3. Changed Data Flow Verification

（路线权威 = 设计 §8；「旧实现」基线取 SA6 探针 B2/B3/E/F/G 实测——同输入 `ok:true` 放行四值）

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| R2 全量校验（validateLogicalSnapshot → interpret → validateValue 新拒点） | 四值入裸 number 叶：`ok:true` → `ok:false` 单条收窄 issue | 探针直调公共面（schema `type ROOT = { n: number; a: string; };`） | NaN→`{"message":"期望 number（有限数且非 -0），实际 NaN","path":["n"]}`；+Infinity→`实际 Infinity`；-Infinity→`实际 -Infinity`；-0→`实际 -0`（各恰 1 条、path `['n']`） | 四值全拒 + 消息规则①–④（`-0` 尾 token 为 `-0` 非 `0`） | 逐值一致；`-0` 经 `Object.is` 单独识别（SA6 规则④ 的 `String(-0)="0"` 实现必红判据成立——尾 token 实测 `-0`） | pass |
| R2/R1 双路径同口径（validateSubtree 共享解释器） | validate 与 validate-patch 写路径同一判定 | 同进程内三接缝逐字面比对：`validateLogicalSnapshot` vs `validatePatch(derived,{n:1,…},['n'],v)` vs `applyMutationAtBoundary`（`planMutationBoundary(['n'],'set')` + `{op:'set',value:v}`） | 四值 × 三接缝消息**逐字节相同**（如 `-0`：三处均为 `期望 number（有限数且非 -0），实际 -0`） | 同口径零分叉 | 一致（AC2-1 的同字面判据在活链路复现） | pass |
| R1 普通写路径（mutateData → S3 快照 → S5 applyValidatedMutation → planMutationBoundary → applyMutationAtBoundary → validateSubtree 新拒点） | `-0` 经 runtime 处理（S3 `copyFrozen` 只挡非有限数）后**到达 vfsl 边界**并在该处被拒；NaN/±Inf 仍在 S3 被既有契约拦下 | 探针：真实 Y.Doc + memory persistence + runtime 写槽（`mutateData`），观测 update 事件计数 / `Y.encodeStateAsUpdate` 字节 / readData / getStatus | `-0`：resolve `{ok:false, issues:[{"message":"期望 number（有限数且非 -0），实际 -0","path":["n"]}]}`——**path `['n']` + 收窄消息即跳点归属证明**（若在 S3 拒则必为 `MUTATION_INPUT_NOT_PLAIN_DATA` @ `path:[]`，探针显式断言消息不含该稳定码）；NaN/±Inf：`{"message":"MUTATION_INPUT_NOT_PLAIN_DATA: 非有限 number（NaN）","path":[]}`（±Inf 同形）——S3 既有拒绝面保持 | `-0` 拒于 vfsl 边界且传播正确；NaN/±Inf 拒于 S3（不变路线，见 §4） | 逐值一致（跳点区分清晰；`-0` 是四值中唯一穿透 S3 到达新拒点者——与 SA6 §9-2 建模边界预言吻合） | pass |
| R1 零写入与拒绝传播 | 拒绝先于 detached 构造与事务；`{kind:'fail'}` → R9 `{ok:false, issues}` 透传 | 同上（update 计数 + state 字节 + 读面三证） | `-0` 拒后：update 事件 **0** 次；`Y.encodeStateAsUpdate` 字节与拒前**逐字节相同**；`readData(['n'])` 仍 `1`（旧值原封）；后续修正写 `SET_N(2)` → `ok:true`、恰 1 次 update、读回 `2`（R6 整值替换修复语义 / 恢复链完好） | 零 Yjs 写入；issues 引用零损透传到调用方；修正 payload 重提交即成功 | 一致 | pass |
| R3 changelog 观测闭合（写产物快照 → jcs → digest → 投影） | 合法写入不再触发数值分支 `capture:'unavailable'`；四值对合法写入结构性不可达 | 探针：runtime 装配真实 `createBoundedMemoryDiagnosticLog({inputPolicy:'full', updateCapture:true})` + clock，三笔连续写（合法 / `-0` / NaN）逐记录断言 | ① 合法写 `SET_N(42)`：attempt 记录 `stage:'transaction'`、`result:{kind:'committed',effect:'update'}`（inline yjs-update 载体，payloadLength 27 / crc32c 87de9312）、`input:{capture:'full', value:{op:'set',path:['n'],value:42}, digest:29b1a507…}`；② `-0` 拒写：`stage:'validation'`、`result:{kind:'rejected'}`、无顶层 code、`issues:{policy:'full',items:[{"message":"期望 number（有限数且非 -0），实际 -0","path":["n"]}]}`（**同源透传**）、`input:{capture:'full',…}`；③ NaN 拒写：`stage:'input-snapshot'`、`code:'MUTATION_INPUT_NOT_PLAIN_DATA'`、`result:{kind:'rejected'}`、`input:{capture:'unsafe-input'}`；全程 **0 条 `input-projection-failed` 健康事件**，doc 内容 `n=42`（四值未入 doc） | 合法写 committed+full 捕获无数值降级；拒绝以 rejected 记录如实可观测（INV-DIAG：拒绝绝不伪装 committed）；四值不出现在任何经写路径接受的 doc 内容面 | 一致。注记：`-0` 拒写记录的 `input.value` JSON 视图显示 `0`（RFC 8785 §3.2.2.3 归一，digest 82b879b3…）——这是 T2 AC3-4 锁定的机制锚在**观测输入快照**上的表现（digest 归一，非降级：capture 仍 `full`、零投影失败），且该输入是 mutation 形状而非 doc 内容；doc 内容面的数值分支对合法写入结构性不可达由 ② 的拒绝 + ① 的 full 无降级共同闭合 | pass |
| memo 序独立性（设计 D-C 新增必做项；设计声明「修正后 `{xs:[0,-0]}` → `['xs',1]` 拒；`{xs:[-0,0]}` → 仅 `['xs',0]` 拒」） | SameValueZero `-0≡0` 共键消歧（哨兵键）后判定互不污染 | 探针直调（v1 合法形 `type U = number \| string; type ROOT = { xs: U[]; };`） | `{xs:[0,-0]}` → 恰 2 条 issue **同在 `['xs',1]`**（D-B 锁定联合形态：汇总 `不匹配任何联合成员（any-of 全拒绝）：失败距离最小的成员为联合成员 1/2（距离 1）` + 下钻 `期望 number（有限数且非 -0），实际 -0`），无 `['xs',0]` issue；`{xs:[-0,0]}` → 仅 `['xs',0]`，`['xs',1]` 零 issue（合法 0 无伪报）；`{xs:[0,NaN]}` 对照 → 仅 `['xs',1]`（NaN 键无碰撞） | `-0` 不因 0 的 memo 命中被静默接受；0 不因 -0 的 contra 命中被伪报 | 一致（与 SA3 mutation 探针「移除 memoKey → ①④⑤ 红」的敏感性证据互补：哨兵键在位时序无关成立） | pass |

## 4. Preserved Data Flow Verification

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
| --- | --- | --- | --- | --- | --- |
| S3 输入快照对非有限数的既有拒绝（设计 B8：`copyFrozen` 只挡非有限数，NaN/±Inf 类 B 失败零写入） | NaN/±Inf 在 S3 以 `MUTATION_INPUT_NOT_PLAIN_DATA`（`path:[]`）拒绝；`-0` 穿透（本变更集不改 S3） | 探针：`mutateData` × NaN/+Inf/-Infinity | SA6 §5 探针 B/B2（旧实现同款 S3 行为：非有限数拒、`-0` 直通至 doc） | NaN→`MUTATION_INPUT_NOT_PLAIN_DATA: 非有限 number（NaN）`、±Inf 同形，均 `path:[]`、0 update、state 字节不变；`-0` **不**触发该码（走 vfsl 边界）——S3 谓词与消息逐字保持 | pass |
| typeof 失配消息兼容面（SA8 R2 / AGENTS.md 兼容行为） | 非 number 型入 number 叶维持 `类型不匹配：期望 number，实际 X` 逐字节 | 探针：`mutateData({op:'set',path:['n'],value:'oops'})` | 既有文案（SA6 §6 探针 A2 / H） | `[{"message":"类型不匹配：期望 number，实际 string","path":["n"]}]`、恰 1 条、零写入——runtime 活链路同字面 | pass |
| 有限数合法写全链 | `0 / 0.5 / -1 / 1e308 / 5e-324` 经 runtime 全链 ok:true 且读回同值 | 探针：`mutateData` 逐值 + readData | 旧实现放行（SA6 §6 正控） | 5 值全部 `ok:true` 且 `readData(['n']) === v`（含次正规 `5e-324`）；合法写面不受收窄波及 | pass |
| R4 读路径（schema-independent） | 存量 doc 中 `-0` 仍忠实读回；读不重编译不重校验 | 探针：直构存量 doc（`ROOT n=-0`；ADR 0021 决策 7 排除面种子，探针输入合法）+ runtime `readData` | 既有读行为（doc-runtime 读零 diff） | `readData(['n'])` → `ok:true` 且 `Object.is(value,-0)===true`；同内容的整快照重校验 `validateLogicalSnapshot` loud 拒（`期望 number（有限数且非 -0），实际 -0`）——ADR 0021 决策 5 的存量姿势实测在案（读回不拦、重校验点 loud） | pass |
| changelog 投影契约（`input-capture.test.ts`，ADR 0014 冻结） | 直投 `-0` 快照：内存视图保留 `-0`、JSON 视图 `0`、digest 归一；机制锚新旧同绿 | 既有套件重跑（AC3-5） | 基线绿（SA6 §4） | `packages/namespace-diagnostic-log/test/input-capture.test.ts` 26/26 绿（本报告 §9 命令 3） | pass |
| doc-runtime 写路径既有零写入管线 | 拒绝经 `{kind:'fail'}` 零写入通道（`mutation-local.ts` 四消费点零改动） | 既有套件重跑（`materialize-root` 59/59 含 R2b 迁移用例：直调拒 → materialize 同拒 + `issues` toEqual + 0 update + state 字节不变；`replace-root-content` 13/13 含 G3/G5 迁移用例） | 基线绿（SA6 §4：313/3298） | 72/72 绿（本报告 §9 命令 1/3） | pass |

## 5. State Machine Verification

本变更无状态机（同步纯函数；设计 §8）。有状态的可观察面 = runtime 写槽生命周期（S1–S7），按技能要求验证拒绝路径的状态与关键值：

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
| --- | --- | --- | --- | --- | --- |
| ready（schema ready / 无 fatal / rootWrite enabled） | `mutateData(SET_N(-0))` | S1/S2 gate 过 → S3 快照 ok（`-0` 有限）→ S4 schema ready → S5 领域校验拒 → R9 `{ok:false, issues}` → S7 槽释放；**不**进 S6（无事务无 dirty） | 拒绝 resolve 后：`status.fatal === null`、`rootWrite.enabled === true`、后续写 `SET_N(2)` 立即被接纳并成功（FIFO 槽已释放，无停滞） | 拒绝被误升格 fatal / 置位 fatalCause / 写能力被禁用 / 槽停滞（后续写永 pending）/ 伪 `ok:true` | pass |
| ready | `mutateData(SET_N(NaN))`（S3 拒） | S3 类 B 失败 → `{ok:false}`；槽释放；写能力保持 | 同上（`path:[]` 稳定码、零 update、后续写不受影响——与既有 `runtime-mutate-root-sa7-dynamic` DV-4 姿势同族） | 同上 | pass |
| 装配诊断日志的 ready runtime | 合法写 → `-0` 拒写 → NaN 拒写（三笔连续） | 每笔恰一条 attempt 记录，结局与业务事实一一对应（committed/rejected/rejected）；无缺记录、无伪装 | 3 记录按序：transaction/committed+update → validation/rejected（issues 同源）→ input-snapshot/rejected（稳定码）；零 `input-projection-failed` | 拒绝被伪装 committed（INV-DIAG 违约）/ 数值分支降级 `capture:'unavailable'` / 健康事件误发 | pass |
| 存量 `-0` doc 之上构造 runtime | P0 编译（schema 文本）→ ready → `readData` | 读面与校验面分离：读成功；重校验（调用方触发）loud 拒 | P0 ready（schema 编译与 doc 内容无关）；`readData(['n'])` ok 且值 `-0`；`validateLogicalSnapshot` 拒（决策 5） | P0 因 doc 内容失败 / 读面悄悄改值 / 读面开始重校验 | pass |

## 6. Error and Cleanup Flow

- **错误分类**：四值拒绝全程走普通 `ValidateResult`/写结果联合（`ok:false` + issues），无 throw、无新错误码、无 fatal 置位；NaN/±Inf 维持 S3 类 B 分类（稳定码 + `path:[]`）——两类失败的分类边界在活链路清晰可辨（消息形态与 path 双重区分）。
- **部分完成**：零部分写入三证（0 update 事件 / state 字节逐字节不变 / 读面旧值）；detached 构造与事务从未启动（拒绝先于 S5 事务，探针断言消息不含 S3 码 + 0 update 共同证明拒点在事务之前）。
- **清理与恢复**：纯函数无清理责任；runtime 侧拒绝后槽正常释放（后续写立即成功）、无能力降级、无 fatal；修正 payload（`SET_N(2)`）重提交即成功——无「一次坏输入 → 永久禁写」复活类问题。
- **观测诚实性**：拒绝以 `rejected` 记录如实入 changelog（issues 同源引用透传，`-0` 的收窄消息原样在场）；合法写 `committed+update`；零投影失败、零健康事件误发。伪成功（拒绝伪装 committed）未出现。

## 7. Temporary Diagnostics

- **添加项**：临时探针测试一枚 `packages/namespace-runtime/test/tmp-sa7-319-livechain.test.ts`（12 用例；观测日志统一前缀 `[SA7-DATAFLOW]`，仅 route/关键值/顺序字段；无 secret、无 live 对象 dump、不改控制流）。复用既有夹具族（`createNamespaceRuntimeWithSeam` / `createMemoryPersistence` + `realPersistenceScheduler` / `createBoundedMemoryDiagnosticLog`），零生产文件触碰。
- **探针修订记录**（bring-up 期 2 处探针断言形状修正，非实现 finding）：① 联合成员位的报告形态按 D-B 锁定为「汇总 + 下钻」恰 2 条同 path（初版误期望单条）；② changelog 记录的 issues 为 `{policy:'full', items:[…]}` 投影形状（初版误当裸数组）。修正后 12/12 绿。
- **删除项**：探针文件已删除（`rm` 后 `ls | grep -c tmp-sa7` = 0）。
- **post-removal 验证**：删除后重跑关键场景（T1/T2/`input-capture`/doc-runtime 两文件/namespace-runtime 写路径与诊断三套件，`--typecheck`）＝ **8 files / 186 tests 全绿 / Type Errors no errors**——与探针在场时永久套件结果一致（仅少探针自身 12 条）；`pnpm typecheck` exit 0、`pnpm generate --check` exit 0。
- **残留检查**：`git diff | grep -c SA7-DATAFLOW` = 0；`git grep -l SA7-DATAFLOW -- packages docs apps domains` = 0 命中；`git diff --check` 干净；`git status --porcelain` 恰为 SA3 枚举变更集（6 modified + 2 新建测试 + wiki 输入）——**SA7 零实现改动**。探针输出已内嵌本报告（§3/§4 观测列），临时文件不入 artifactPaths。

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SA6 | AC1/AC2：四值全拒 + 消息规则①–④ + 双路径同字面（T1 契约） | T1 套件重跑 + 探针三接缝比对 | 51 用例绿；三接缝逐字节同 | 51/51 绿；四值 × 三接缝同字面（§3 行 1–2） | §9 命令 1/2；§3 观测列 | pass | 无 |
| SA6 | AC3：changelog 结构性闭合（T2 契约 + §15 Q6 runtime 端到端缺口） | T2 套件重跑 + 探针 runtime 级诊断链 | 12 用例绿；合法写无降级、四值不入 doc | 12/12 绿；runtime 级三记录闭合 + 0 `input-projection-failed`（§3 R3 行） | §9 命令 1/2/3 | pass | 无 |
| SA4 | §11 动态项：runtime 端到端 `-0` 写 → `validation/rejected` + doc 不变（D-F Q6 判冗余、SA7 活链路范围） | 探针（mutateData + 零写入三证 + 恢复写） | 拒绝 + 零写入 + 记录 rejected | 全部观察到位（§3 R1 两行 + §5 行 1） | §9 命令 2 | pass | 无 |
| SA4 | §11 动态项：SA3 声称的全仓绿/类型/生成物（315/3361/typecheck/generate） | SA7 独立复跑 `pnpm typecheck` + `pnpm generate --check` + 聚焦套件 | exit 0 ×2；聚焦全绿 | typecheck exit 0、generate --check exit 0、8 files/186 tests 绿（全仓套件不属 SA7 范围——以 SA3 证据 + 聚焦复跑采信） | §9 命令 3/4 | pass | 无 |
| Design | §8 R1：`-0` 穿透 S3 后在 vfsl 边界被拒（新拒点跳点归属） | 探针（path+消息形态区分 S3 与 vfsl 两跳） | `path:['n']` + 收窄消息（非 S3 码） | 观测吻合（§3 R1 行 1） | §9 命令 2 | pass | 无 |
| Design | §3/D-C：memo `-0/0` 相邻污染两类错误（静默接受/伪报） | 探针序矩阵 + SA3 mutation 探针（历史） | 序无关：`[0,-0]` 只拒 xs,1；`[-0,0]` 只拒 xs,0 | 观测吻合（§3 末行；D-B 联合形态恰 2 条同 path） | §9 命令 2 | pass | 无 |
| Design | §8 R4 + ADR 0021 决策 5：读面保持 / 存量重校验 loud | 探针（直构 `-0` doc 读回 + 重校验） | 读回 `-0`；重校验拒 | 观测吻合（§4 R4 行） | §9 命令 2 | pass | 无 |
| Design | §8 R3 注记：`-0` digest 与 0 归一（机制锚非红灯） | T2 AC3-4 + `input-capture` 套件 + 探针记录观测 | 机制保持（新旧同绿） | 26/26 + 12/12 绿；runtime 拒写记录 input JSON 视图归一为 `0` 且 capture 仍 full、零投影失败 | §9 命令 1/3 | pass | 无 |
| SA6（额外观察，非缺陷） | `-0` 拒写记录的观测输入快照 JSON 视图为 `0`（RFC 8785 归一） | 探针 | 机制锚表现（digest 归一，非降级） | `input.value` 显 `0`、digest 82b879b3…、capture full、0 事件——观测输入面（mutation 形状）的既有投影契约，doc 内容面不受影响 | §3 R3 注记 | 记录在案 | 无（ADR 0021 决策 7 既有姿势；发版说明 breaking 告知为运营 follow-up，设计 §13 在案） |

## 9. Commands and Evidence

| # | Command | Result |
| --- | --- | --- |
| 1 | `NODE_OPTIONS=--conditions=nomicore-source pnpm vitest run packages/vfsl/test/validate-number-domain-narrowing.test.ts packages/namespace-diagnostic-log/test/write-path-number-domain-closure.test.ts packages/doc-runtime/test/materialize-root.test.ts packages/doc-runtime/test/replace-root-content.test.ts` | **4 files / 135 tests passed**（51+12+59+13）；T1/T2 与 D-H 迁移用例全绿 |
| 2 | 临时探针 `…/namespace-runtime/test/tmp-sa7-319-livechain.test.ts`（已删除）经同 runner | **12/12 passed / Type Errors no errors**；`[SA7-DATAFLOW]` 观测 35 条（内嵌 §3/§4） |
| 3 | 探针删除后：`… vitest run --typecheck`（T1、T2、`input-capture.test.ts`、doc-runtime 两文件、`runtime-mutate-root-sa7-dynamic`、`runtime-mutate-root-snapshotter-array`、`runtime-root-schema-diagnostic-sa7`） | **8 files / 186 tests passed / Type Errors no errors**（关键场景移除探针后结果不变） |
| 4 | `pnpm typecheck`；`pnpm generate --check` | **双 exit 0**（SA7 独立复跑；生成物/fixtures 零漂移） |
| 5 | `git status --porcelain`；`git diff \| grep -c SA7-DATAFLOW`；`git grep -l SA7-DATAFLOW -- packages docs apps domains`；`git diff --check` | 恰为 SA3 枚举变更集；0 / 0 命中 / 干净——SA7 零残留、零实现改动 |

## 10. Deviations

- 无实现面偏离发现；SA7 未修改任何实现/设计/测试。
- 探针 bring-up 期 2 处探针自身断言形状修正（联合位恰 2 条同 path 的 D-B 锁定形态；issues 投影 `{policy,items}` 形状）——修正后全绿，非实现缺陷（见 §7）。
- 全仓 `pnpm test`（315 files/3361）未由 SA7 重跑：SA7 技能不运行全仓回归；以 SA3 证据（含增量 3361−3298=63 恰为两枚新测试文件）+ 本报告聚焦复跑（186 tests + typecheck + generate 双 exit 0）采信。SA4 §11 表中「实现前红灯 32/31 转置笔误」属报告勘误项（O1），不影响动态结论。
- 环境事实核对：worktree 无根 `node_modules/@nomicore` 链接，测试经 vitest alias + `customConditions: nomicore-source` 解析源码（与 SA3 记录一致）。

## Verdict

**approve** ——

1. **变更数据流按设计发生**：四值在 validate 路径（恰 1 条、path 精确、消息规则①–④、`-0` 经 `Object.is` 识别）与全部写路径（三接缝逐字节同口径）全拒；`-0` 在 runtime S3 放行后**确实到达 vfsl 边界**（`path:['n']` + 收窄消息的跳点归属证明）并在新拒点被拒；memo `-0/0` 序独立性成立（无静默接受、无伪报）。
2. **拒绝传播与零写入正确**：`{ok:false, issues}` 同源透传至 lease 结果与 changelog `validation/rejected` 记录；0 update 事件 + state 字节不变 + 读面旧值三证齐全；拒绝后写槽正常释放、无 fatal、无能力降级、修正写立即恢复。
3. **changelog 闭合行为正确**：合法写 `committed+update` + `capture:'full'` + 零 `input-projection-failed`；四值对经写路径接受的 doc 内容结构性不可达；拒绝以 rejected 记录如实观测（INV-DIAG 无伪装）；机制锚（直投降级 / `-0` digest 归一）按 T2 与 `input-capture` 契约原样保持。
4. **不变路线保持**：S3 对 NaN/±Inf 的既有拒绝（稳定码/`path:[]`/零写入）、typeof 失配文案逐字节、有限数合法写全链、读路径 schema-independent（存量 `-0` 忠实读回 + 重校验点 loud = ADR 0021 决策 5 既定姿势）全部实测不变。
5. **临时诊断已清理**：探针删除后关键场景重跑结果一致（186/186 绿 + 双 exit 0），worktree 无 `[SA7-DATAFLOW]` 残留、恰为 SA3 枚举变更集；实现零改动。

SA4 verdict 为 approve，SA7 未发现可独立成立的下调事实；SA8 复查已 clear 且 `requiresConflictRecheck=false`，本报告无新增冲突面。
