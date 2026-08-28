# Standards 轴终审报告 — issue #134（Phase 5 切片 3/4：expose trusted NamespaceLease ReplicationSession）

- **Date**: 2026-08-28
- **审查轴**: MABF 双轴终审 · Standards（工程标准 / code-review 视角；Spec 符合性由 Spec 轴承担，不在本报告范围）
- **审查对象**: `git diff ebc5419..HEAD`（666f9b1 实现 + 08b49fd SA6 口径修复；HEAD = 08b49fd）
- **上游档案**: design（R1）/ sa4_review / sa7_report / ac_checklist / sa3_impl / sa6_red
- **Conclusion**: **pass**（0 hard violation / 2 minor / 5 info，全部不阻断）

---

## 一、验证证据（本人亲跑，只读）

| 命令 | 结果 | 日志 |
|---|---|---|
| `pnpm --filter @nomicore/namespace-runtime --filter @nomicore/namespace-registry typecheck` | exit 0（两包 Done） | `.mabf-bg/standards-typecheck.log` |
| `npx vitest run <runtime-replication-session.test.ts> <registry-...-red.test.ts> <registry-...-surface.test-d.ts> --typecheck` | 3 文件 55/55 passed，Type Errors: no errors，exit 0 | `.mabf-bg/standards-vitest.log` |
| `git diff --check ebc5419..HEAD` | exit 0（零 whitespace 问题） | — |
| 跨文件引用抽验（见 §四.4） | 全部真实命中 | — |

---

## 二、逐维度结论

### 1. 代码质量 — ✅（2 minor / 2 info，均不阻断）

- **可读性/命名**：660 行新模块 `replication-session.ts` 以 banner 分节（公共类型面 → 扇出 → Host/WeakMap → 受保护常量 → core 工厂 → apply 槽 R1–R7 → 预演实现 → open 门序），每节职责单一、与设计 §4 小节一一对应；`runSessionApplySlot` 的 R1–R7 段落注释与代码逐段对齐（replication-session.ts:412–509），无注释-代码漂移。命名沿包内先例（`markWriteFatal`/`writeFatalMessage`/`refusal`）。
- **Duplicated Code 评估**（ judgement call，见发现 #5/#4）：十键形状存在三份结构副本 + 测试内一份字面副本——包边界纪律（registry 不得 import runtime internal；runtime 禁止反向依赖 registry，测试头注 lease.ts:10–11 显式声明）使物理合并不可行，且三方 `Equal` 真锁（lease.ts:423 自锁 + registry.ts:126–127 跨包真锁 + 测试 PublicCoreShape 自锁）使漂移在 typecheck 即红。判定为**受治理的重复**而非 smell 违规。scratch 投影比较（`protectedMapEqual`/`protectedPrimitiveEqual`，replication-session.ts:549–585）为本切片新逻辑，全仓无既有等价实现可复用（grep 确认）。
- **复杂度/死代码**：槽序线性（R1→R7 无嵌套分叉超过两层）；`close()` 幂等 same-promise 模式镜像 runtime.close（INV-C2）。魔法值零（全走冻结常量）；唯一「声明未引用」项是 `PEER_ALLOWED_META_KEYS` 占位常量（见 #6，注释自证为切片 6 演进位，非意外死代码）。

### 2. 仓库既有惯例一致性 — ✅

- **文件头注记风格**：新模块头注（包名 + issue + 设计文档锚 + 结构说明 + 导出面枚举）与 write.ts/schema-write.ts/replication-write.ts 同款；banner 分隔符 `───` 沿三写模块先例；既有文件头注的 issue 增量注记（lease.ts:3、internal.ts 头、write.ts:26）逐文件补记，格式一致。
- **错误注册纪律（append-only + message 单一真相源）**：`git diff --numstat` 实证 errors.ts 36+/0-、types.ts 135+/0-、index.ts 8+/0-——**纯加法零删改**；`WriteSlot` append-only 追加 `'replication-apply'`（write.ts:80），`markWriteFatal`/`writeFatalMessage` 的 if/else 重构经 rev1 字节锚测试零改动全绿佐证既有渲染逐字节不变；新码 `NSRT-FATAL-REPLICATION-APPLY-INTERNAL` 单点注册于 errors.ts，session 域六条 message 单点在 errors.ts、registry 侧五条单点在 types.ts，`NAMESPACE_LEASE_RELEASED` 复用既有 const——无双副本漂移面（INSTANCE_ID 双副本有互引注记治理，见 §四.4）。
- **结果联合/稳定码模式**：`OpenReplicationSessionResult`/`ReplicationSessionApplyResult` 与既有四写结果联合同构（`Readonly<{ok:false; code; message}>`，resolve 不 reject）；open 编排 ①–⑥ 顺序注释冻结（lease.ts:319–364）。
- **冻结对象纪律**：`RAW_PROTECTED_FIELDS`、`ROLE_PERMISSION_ISSUE`、`RELEASED_SESSION_OPEN_ISSUE`、`Object.freeze(session)`、`getStatus()` 全新深冻结（含 durability 子对象）——全量覆盖，无遗漏。
- **seam 命名与 @internal**：`openReplicationSessionCoreForRegistry` 沿 `createNamespaceRuntimeForRegistry` 命名范式；internal.ts 头注「值导出恰两键」与实际导出一致（seam 测试键集锁同步演进，且该测试文件头注本就声明「精确键集断言由实现时同步演进」——演进合规）；lease.ts 零 internal import（单消费者纪律由 registry-surface 测试守护），deps 注入落位有注释论证。
- **测试组织与命名**：describe 标题 ↔ AC-1..AC-7 / T-1..T-8 / 设计章节一一对应（grep 实证 9+9 个 describe 全部带设计锚）；fixture/helper 前置分区；`-red` 后缀沿 #132 `registry-phase5-replication-red.test.ts` 先例（红灯套件转绿保留名，头注解释红灯机制）；零 `.only`/`.skip`/`todo`/`FIXME`；零源码 grep 断言（readFileSync+toMatch 反模式扫描零命中）。

### 3. 类型纪律 — ✅

- **exactOptionalPropertyTypes 合规**：三处新可选属性（`CreateNamespaceRegistryOptions.role`、`NamespaceRegistryInternalOptions.role`、`NamespaceRegistryTestingOverrides.role`）全部以 `!== undefined` 显式守卫后赋值（testing.ts:153–155、registry.ts:527–528），无 `prop?: T | undefined` 声明、无可选属性被赋 `undefined` 的写法。
- **类型导出面最小化**：registry index 仅 type-only 追加八类型（值导出面零变化，diff 纯加法实证）；runtime index 零改动；internal subpath 恰两值导出 + 六 type-only；`ReplicationSessionClosedError` 不进主入口（沿 `RuntimeReadDisabledError` 先例）。
- **Equal 断言锁正确使用**：`Equal`/`AssertTrue` 为类型级辅助（零运行时值）；lease.ts 侧断言收进 `LeaseTypeAssertions` 导出面（typecheck 即门）；registry.ts 跨包真锁落在 internal 唯一生产消费者文件（import 方向合法）；测试侧包内字面副本自锁且头注声明「不跨包 import registry」——SA2 R2 §5 禁令遵守。
- **verbatimModuleSyntax**：全部 type-only import 标注正确（typecheck exit 0 佐证）。

### 4. 可维护性 — ✅

- **660 行模块内聚性**：单一会话域（fanout/host/core/槽/预演/open 门全部只服务 session），无跨域杂项；若切片 6 接线后继续膨胀，banner 分节已给出天然拆分缝（预演实现、扇出可独立成模块）——当前不拆是合理粒度，非过度集中。
- **future slice 6/7 演进位**：`PEER_ALLOWED_META_KEYS` 空集占位、`observerFailures` 无界计数注记（熔断/背压属切片 6 队列属主）、ADR 0010 增补节「增量 scratch 检查留作后续演进，不得未评审预写」——演进位清晰且克制，无 premature abstraction（D-16 非目标面零提前实现，SA4 已核）。
- **注释跨文件引用真实性（逐条抽验）**：`packages/replication-protocol/src/constants.ts` `INSTANCE_ID_RE`（:38）与 lease.ts:136 常量**逐字一致**；ADR 0010 行号引用 L81/L94/L105/L121/L139/L156/L179 逐条 sed 核对全部命中所述内容；新代码零 `file.ts:行号` 式易腐引用（既有 3 处为先存代码）。

### 5. git 卫生 — ✅

- **commit 划分**：666f9b1（实现 + 文档四件套 + SA3 测试 + 两处键集锁演进）/ 08b49fd（仅 SA6 红灯套件口径修复 + wiki 归档；**零 src 改动**，`git show --stat` 实证）——实现与测试校准分离，边界干净。
- **commit message**：conventional 前缀 + scope + (#134) 引用；666f9b1 正文含 BREAKING-CHANGE: None 显式声明与「值导出面/键集面不变」论证；08b49fd 逐条列四类口径修复并声明「断言语义零削弱」+ 全量数字。与近期 Phase 5 commit 惯例一致。
- **diff --check**：干净；**无意外文件**：无 lockfile/TASK.md/.bak（BLACKLIST 零命中）；wiki/raw 档案属白名单；registry-open.test.ts 单行键集演进已由 SA4 INFO-2 裁定（SA1 ALLOW 遗漏、零语义改动、有 #132 先例）。

---

## 三、发现清单（分级）

| # | 级别 | 位置 | 发现 | 处置 |
|---|---|---|---|---|
| 1 | minor | `packages/namespace-runtime/src/replication-session.ts:405` | `export async function runSessionApplySlot` 为**无外部消费者的导出**（全仓 grep 仅定义处 + 模块内调用 :336；测试文件未 import），且模块头注 :27–29 枚举的「模块级导出面（类型 + createSessionFanout + registerReplicationHost + openReplicationSessionCoreForRegistry）」不含它——代码与自述导出面不一致 | 不阻断（包内模块通道，不入 index/internal 键集锁，无公共面影响）。建议 SA3 下次触达该文件时去 `export` 或在头注补记 |
| 2 | minor | `CONTEXT.md:134`；`docs/phases/phase-5-websocket-replication.md:78` | 术语笔误：CONTEXT.md 新词条「**示例**静态角色 hub/peer」——全仓冻结词为「**实例**静态角色」（types.ts:319/550、testing.ts:56、lease.ts:190、registry.ts:234/747、ADR 0010 增补节 L236/L260 均用「实例」，仅此处一字之差）；phase-5:78「示例与生产/testing 同形」同源含混（设计原文为「生产 CreateNamespaceRegistryOptions.role 与 testing overrides 同形」） | 不阻断（语义可恢复、不影响代码行为）。建议下一个文档同步触点顺手修正为「实例」 |
| 3 | info | `packages/namespace-registry/src/lease.ts:136` | `INSTANCE_ID_PATTERN` 声明于唯一使用者 `parseOpenSessionOptions`（:121 引用）**之后**——运行时安全（调用晚于模块初始化，无 TDZ 风险），但与其自称先例（registry.ts `NAMESPACE_ID_PATTERN` :164 声明先于使用 :613）源序相反 | 不阻断。纯可读性；可上移至 parse 函数之前 |
| 4 | info | `packages/namespace-registry/src/registry.ts:122–125` | 新增本地 `Equal`/`AssertTrue` 与 lease.ts:373–376 既有副本（及测试文件副本）并存——沿每文件自含先例，非违规；若类型锁面继续增殖（切片 6/7），可考虑提包内 type-test util 收敛 | 不阻断 |
| 5 | info | types.ts / lease.ts:145–160 / replication-session.ts:108–119 | 十键 session 形状三份结构副本（公共声明 / lease 结构性描述 / runtime core）——Fowler DRY 视角的重复，但为包边界纪律的必要代价，且三方 Equal 真锁使其漂移编译期即红（转置封闭）。属「受治理的重复」，非 smell 违规 | 不阻断。维持现状；切片 6 若形状演进，三处 + 测试副本需同步改（Equal 锁会强制提醒） |
| 6 | info | `packages/namespace-runtime/src/replication-session.ts:219` | `PEER_ALLOWED_META_KEYS` 声明未引用（SA4 INFO-1 已录）——注释自证为切片 6 META 白名单演进位；standards 视角属「文档化占位」而非意外死代码 | 不阻断 |
| 7 | info | `packages/namespace-registry/src/registry.ts:46` | 新 import 行 128 字符（本 diff 唯一新增 ≥115 行）——仓库无 formatter 配置且基线已有 ≥115 行先例（如 registry.ts:226 139 字符），无成文行宽纪律 | 不阻断。纯观感；可仿邻近 type import 换行 |

**Hard violation（违反仓库明文纪律）：0。** 所有发现均不阻断。

---

## 四、正面记录（供后续切片参照的达标项）

1. append-only 纪律以 numstat 实证（errors/types/index 三文件 0 删改行）；行为等价重构以既有字节锚测试零改动全绿背书。
2. 冻结对象与单一真相源纪律全覆盖：常量、issue 对象、session/status/durability 逐层 freeze；message 产点唯一、插值仅闭集字面量。
3. 测试可追溯性样板：describe ↔ AC/T/O/INV 锚一一对应，头注载明契约来源、红灯翻转机制与确定性纪律（Yjs 新键纪律、受控 scheduler/随机源）。
4. 跨包引用治理样板：INSTANCE_ID 双副本互引注记 + ADR 行号逐条真实——新代码未引入 file:line 式易腐锚。
5. commit 卫生样板：实现/测试校准分离、BREAKING-CHANGE 显式声明、diff --check 干净、BLACKLIST 零命中。

---

## 五、回流建议（均非阻断）

- **→ SA3**（发现 #1/#3）：下次触达 replication-session.ts / lease.ts 时顺手收口死导出与常量源序。
- **→ 文档同步触点**（发现 #2）：CONTEXT.md「示例→实例」、phase-5 措辞澄清。
- **→ SA1**（沿用 SA4 INFO-2 裁定）：后续设计 ALLOW LIST 应显式收录「与 ALLOW 内文件机械耦合的键集锁测试」。
