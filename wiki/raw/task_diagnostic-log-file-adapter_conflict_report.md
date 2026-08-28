# 冲突门禁报告

- 被审对象：任务简报 `wiki/raw/task_diagnostic-log-file-adapter.md`（Issue #152，File diagnostic-log adapter，任务类型 feature）
- 门禁阶段：第 0 阶段前置门禁（任何 SA 派发之前）
- 冲突基准：`docs/adr/` 全集（11 个文件，全部逐个读取）+ `CONTEXT.md`
- 配套产出：`wiki/raw/task_diagnostic-log-file-adapter_relevant_decisions.md`（相关决议，全链复用）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 单一真相源 | accepted（含 2026-08-19 修订） | 中 | no-conflict。简报不新增 schema 文本（明示「不改 schema」）；内建冻结 record schema 的存在由 ADR-0012 明文决策（「writer 启动时编译一次内建 schema 并缓存」），且 0001 修订节已放行阶段态仓内 schema；「方言只增不改、未知 loud-fail」与简报 strict reader「不近似解释未知版本」同向。 |
| 0002 | nomicore 是重写、authority 出范围 | accepted | 无 | no-conflict。简报不触及 authority 规则体系。 |
| 0003 | 求值器与派生 schema | accepted | 弱 | no-conflict。本票消费 #148 已编译冻结 schema，不触及 evaluate/派生 schema 契约。 |
| 0004 | vfsl-protocol 类型投影 | accepted | 弱 | no-conflict。本票不触及类型投影包；ADR-0012 被否方案「只用 TypeScript 类型、不做 VFSL 验证」与简报「records pass the built-in VFSL schema … validation」同向。 |
| 0005 | 投影生成管线 | accepted | 弱 | no-conflict。SchemaSource 接缝纪律针对仓内脚手架 schema 消费方；本票消费内建冻结 schema，非该场景。 |
| 0006 | DocPersistence 与 doc 三条目布局 | accepted（含三次修订） | 中 | no-conflict。简报不改 DocPersistence 契约；ADR-0012 明文「不修改 ADR 0006 的 snapshot Persistence」，日志布局（`namespaces/{namespaceId}/…`）与 0006 的 `{rootDir}/users/{userId}/{namespaceId}.snapshot` 是独立目录空间；temp+rename 原子替换（current.json）正是 0006 已验证模式。 |
| 0007 | 逻辑验证与 Yjs Runtime Bridge | accepted（open/read 条款被 0008 取代） | 弱-中 | no-conflict。被取代条款不构成约束；仍生效的指纹格式条款（`sha256:v1:<hex>`）与 #148 交付的 envelope 指纹一致。 |
| 0008 | NamespaceRuntime 读写能力与单序列器 | accepted（含稳定码注册修订） | 中 | no-conflict。简报「non-interference with producer results」与 ADR-0011/0012「日志不得引入第二个业务排序机构、emitter 不被 await、不延长 write slot」同向；ADR-0012「多 Runtime generation 共享同一 writer queue」属 adapter 内部实现，不碰 0008 sequencer。 |
| 0009 | NamespaceRegistry、租约与 Host 生命周期 | accepted | 弱-中 | no-conflict。ADR-0012「日志启用与配置是本地旁路状态、初始化失败不影响 namespace create」与 0009 lifecycle 正交；shutdown 不无限等待日志与 0009 shutdown 纪律同向。 |
| 0010 | ——（文件不存在） | —— | —— | docs/adr/ 无 0010 文件；ADR-0011/0012 对「ADR 0010 trusted replication」的引用是背景引用，不在本门禁基准内。 |
| 0011 | Best-effort namespace 诊断变更日志 | accepted | 高 | no-conflict。简报「format, validation, queue, and storage failures remain confined to logger health」与 0011 隔离条款逐字同向；结局词表/阶段词表/数据保护/emitter seam 均由 #148 已冻结交付，本票不扩词表。 |
| 0012 | VFSL 校验的 JSONL 与 framed sidecar 诊断日志格式 | accepted | 最高（主规范） | no-conflict。简报五条 AC 逐条映射 ADR-0012 条款（见下），无任何背离；范围切分（#153/#154/#155 排除）不违反 ADR——0012 是终态规范，未规定票边界，且简报自设「除非 ADR 0012 明确归属本票」的保守条款。 |

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| （无） | —— | —— | —— | —— | 未发现任何直接违反、override 声明或未声明演进。 |

### 简报 AC ↔ ADR-0012 逐条映射（放行依据）

| 简报要求 | ADR-0012 对应条款 | 一致性 |
|---|---|---|
| AC1 immutable manifest（冻结 VFSL envelope + format policy）+ atomically replaceable current-stream locator | 「manifest.json 创建后不可变，至少保存…完整 record schema VFSL 四键信封；record、frame 与 schema 版本；…inline threshold 与 JSONL line 上限」；「current.json 使用 temp + rename 原子替换，只保存 format/version/streamId」 | 完全一致 |
| AC2 ≤阈值 padded standard Base64 + payloadLength + CRC32C；>阈值共享 NDCL v1 sidecar frame + 关联 JSONL 引用 | 「小于等于阈值时，以 RFC 4648 标准 Base64 内联，必须有正确 padding…；大于阈值时，append 到当前 segment 共享 .bin；inline 与 sidecar 均记录 payloadLength 与 CRC32C」；25-byte NDCL header；sidecar 引用形状 | 完全一致 |
| AC3 最终物理 record 在 append 前过内建 VFSL schema + storage 校验；sidecar frame 先于 JSONL 引用 append | 「构造最终 record → VFSL validation → storage validation → append JSONL」；sidecar 顺序以「append 完整 BIN frame → append JSONL」（BIN-first） | 完全一致 |
| AC4 strict reader 校验 JSON、VFSL、Base64、长度、CRC32C、frame 元数据、引用、offset、格式、stream sequence；不近似解释未知版本 | 「默认strict reader对每条record执行JSON parse、VFSL validation及storage/frame交叉校验」；storage validator 职责清单（严格 Base64 decode、length 一致、CRC、sequence/format/payloadType/length 一致、offset/segment/frame 边界与 stream 连续性）；「未知…使该stream为incompatible…不得近似解释」 | 完全一致 |
| AC5 测试覆盖 inline/sidecar round-trip、阈值边界、全部 result 分支、malformed 引用与 frame、schema-envelope mismatch、producer 结果不受干扰 | 验收门槛 1（inline round-trip）、2（frame 交叉验证）、3（恰 4KiB / 4KiB+1 边界）、4（各判别分支）、10（manifest envelope 不匹配新建 stream）、6（不改变业务结果） | 完全一致（子集） |
| 上下游事实：genesis 由 #152 adapter 内部构造、不改 schema | CONTEXT.md「genesis baseline record」术语已备案（设计 §10-J1）；ADR-0012「每个新 stream 尽力先记录…genesis baseline」 | 已备案，非冲突 |

## 结论

**Verdict：`clear`，放行。** 11 个 ADR 全量盘点，0 个冲突点；裁决分布：no-conflict × 11，override-declared × 0，evolution × 0，hard-violation × 0。

两条非阻塞注记（总控无需动作，供 SA1/SA2 关注，详见相关决议文档「门禁注记」节）：

1. **范围切分张力（非冲突）**：本票排除 #153（segment rolling / 打开与尾部恢复），但 ADR-0012 的「打开现有 stream 时 manifest fingerprint 匹配检查（不匹配 → 旧 stream 只读、新建 generation、不改旧 manifest）」与验收门槛 10 邻接本票 manifest/strict reader 范围。SA1 设计时须明确本票对「打开既有 stream」的支持边界，且任何切分不得违反 ADR-0012 已冻结条款。
2. **Genesis 构造**：adapter 内部构造 genesis baseline record、不改 schema——CONTEXT.md 已备案（设计 §10-J1），schema 已含 `recordKind: 'genesis-baseline'` 判别分支，本票不得扩词表、不得为 semantic emission 建第二份 VFSL（ADR-0012 明文禁令）。
