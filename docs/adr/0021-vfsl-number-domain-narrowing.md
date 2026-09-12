# ADR 0021：VFSL number 值域收窄（JSON 可忠实表示数）

日期：2026-09-11
状态：已接受
跟踪：issue #312

## 背景与动机

ADR 0008 L31 声明值域为「JSON-compatible plain value」，但 VFSL `number` 的运行时
判定是 `typeof value === 'number'`——**执行的值域比声明的值域大**：NaN、
+Infinity、-Infinity、-0 全部通过校验。由此形成三层口径错位（事实链均经实证，
见 issue #312 讨论）：

| 环节 | 载体 | NaN/±Infinity | -0 |
| --- | --- | --- | --- |
| VFSL validate | — | 放行（`typeof` 判定） | 放行 |
| Yjs 活文档 / 快照 / 复制 wire | lib0 二进制 | 忠实 | 忠实 |
| 诊断 changelog | canonical JSON（RFC 8785 JCS） | throw → 收编 `capture:'unavailable'`（观测降级） | 静默 → `"0"` |
| 一切 `JSON.stringify` 出口 | JSON 文本 | 静默 → `null`（number 变 null，类型变化） | 静默 → `0` |

错位组合出的实际风险：

- **-0 比 NaN 更隐蔽**：连 changelog 都不报错，JCS 直接输出 `"0"`；而系统内部相
  等判据是 SameValue（`-0 ≠ 0`，ADR 0010 R2-4）——同一个值，复制层认为「变
  了」，JSON 层认为「没变」；
- **观测性静默降级**：含 NaN 的 namespace，changelog full capture 退化为
  `unavailable`——恰好在最需要诊断的时刻失去诊断能力；
- **写得出、读不回**：NaN 经任何 JSON 出口变 `null`，再导入时反而 validate 失
  败（`number` 字段收到 `null`）；
- **契约二义性地雷**：读 ADR 0008 的人以为值域 JSON-safe，未来的 JSON 出口工具
  全部继承静默腐化。

核心权威链（Yjs 二进制快照与复制）对四值忠实存活，所以这不是核心数据丢失问题，
是**出口腐化 + 口径矛盾**问题。裁决方向（issue #312 讨论，owner 定夺）：在
**VFSL 语义层**收窄 `number` 合法输入范围，拒绝 NaN、+Infinity、-Infinity、-0。

## 决策

### 1. 收窄口径：number 家族只接受 JSON 可忠实表示数

`number` 的判定从 `typeof value === 'number'` 收窄为：

```
typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
```

- **NaN / +Infinity / -Infinity**：`Number.isFinite` 排除；
- **-0**：是有限数，`isFinite` 挡不住，须 `Object.is(v, -0)` 单独排除——`JSON.
  stringify(-0) === "0"`，-0 不是 JSON 可忠实表示值；
- 收窄后 number 值域 = **恰好 JSON 可忠实表示的数**，ADR 0008 L31 声明值域在语
  义层真正落地。

适用面：**全 number 家族统一基线**——裸 `number` 与 ADR 0020 的 `int` / `range`
叶子同一判定（0020 三形态的「自闭合排除非有限数」被吸收为本基线，且连 -0 一并
排除；`isInteger(-0)` 为 `true` 不再够）。本决策 **supersede ADR 0020 决策 9**
（「基线不动」），0020 文档已作显式标注。

### 2. schema 文本侧：`-0` 字面量解析期 E100 拒绝

运行时拒绝 -0 输入后，文本侧不留无存在理由的 -0 写法：`-0`（含 `-0.0` 等值
为 -0 的字面量）作为枚举成员或 `Int`/`Range` 端点 → **E100**，锚该字面量记号，
消息引导写 `0`。本决策**修订 ADR 0020 决策 3**（初稿「-0 合法，按 f64 与 0 严
格相等」，已作显式标注）。`0`、`0.0` 不受影响。

### 3. 错误消息形态：四值细分，消息文案不进冻结面

- `typeof` 非 number 的失配：维持现有「类型不匹配：期望 number，实际 X」；
- typeof 是 number 但为四值之一：新消息「期望 number（有限数且非 -0），实际
  NaN / Infinity / -Infinity / -0」——否则会出现「期望 number，实际 number」的
  自相矛盾消息（`jsonTypeOf(NaN)` 返回 `'number'`）；-0 必须经 `Object.is` 单
  独识别，避免 `String(-0) === "0"` 的误导；
- validate 与 validate-patch 两条写路径同口径；消息文案不进冻结面（既有先例：
  测试只断言前缀）。

### 4. 冻结合规：§8 增补「语义收窄例外」条款

本决策是**语义变更**（存量合法值变非法），比 ADR 0020 的保留名收窄更重，0020
的「保留名增补例外」覆盖不了。在 §8 增补第二类例外——

> 语义收窄例外：缩小既有合法值域/文本域的变更，仅当满足下列全部条件时允许，
> 且须逐一经 ADR 显式裁决：(a) 收窄使执行语义与已声明的架构契约对齐（本次：
> ADR 0008 L31「JSON-compatible plain value」）；(b) 影响面与存量姿势在 ADR 中
> 显式记录（本次：决策 5）；(c) owner 显式裁决。

本决策为该条款首例（与 0020 的保留名增补首例并列，两个例外类别独立计数与裁决）。

### 5. 存量姿势：不侦察、不迁移、不自动修复（owner 裁决）

含四值的存量 doc 将在 rearm / 重校验触发点 loud 失败——**这被视为数据损坏信
号，符合 fail-closed 文化，不自动修复、不提供扫描工具、不做迁移**（owner 裁
决：本部署场景接受存量风险）。外部生态若有存量，需在发版说明中显式告知该
breaking 变化。

### 6. 指纹与 IR 零影响

纯运行时判定收窄：IR 形状、derived 两树、codegen 生成物、语义指纹
（`sha256:v1:`）全部不变。

### 7. 载体链影响：观测降级与出口腐化对合法写入结构性闭合

收窄落地后：合法写路径产出的 doc 不再可能含四值 → changelog 的 JCS 数值分支
`SnapshotContractViolation` 对合法写入结构性不可达（观测降级闭合）；任何 JSON
出口的 `NaN → null` / `-0 → 0` 变形对合法写入结构性不可达（出口腐化闭合）。
种子/直构面（`seedForTest`、手工 Yjs 构造）不在本收窄覆盖面——与既有「契约外
形态保守拒」姿势一致，由消费侧判据继续兜底。

## Considered Options

1. **运行时载体契约收窄（B 路线）**（拒绝）：不动 VFSL 语义，在 Namespace 写路
   径与 replication ingress 加非 JSON 可表示值拒绝。避免了冻结问题，但口径分裂
   保留在 spec 层（`number` 名义上仍是全 f64），且 ingress 拒绝引入混合版本
   peer 的同步阻断问题。owner 裁决选择语义层治本（本 ADR）。
2. **文档路牌（C 路线）**（拒绝）：维持现状、文档显式声明风险口径。零代码成
   本，但口径矛盾永存，观测降级与出口腐化照常发生。
3. **只拒非有限数、放行 -0**（拒绝）：`Number.isFinite` 单条件。`-0 → 0` 的
   JSON 边界变形依旧，问题只解决一半，且留下「为什么 NaN 拒而 -0 放行」的口径
   长尾。owner 裁决四值并拒。
4. **`-0` 字面量放行并规范化为 0**（拒绝）：无害但 spec 要多一条规范化规则，
   tokenizer/parser 多一条路径；loud 拒绝（决策 2）零歧义。
5. **存量侦察工具随 ADR 交付**（拒绝）：遍历持久化 snapshot 报含四值 doc 清
   单。owner 裁决本部署场景不需要（决策 5）。

## Consequences

### 正面

- 三层口径错位消除：ADR 0008 L31 声明值域、VFSL 执行语义、JSON 载体能力三者对
  齐为「JSON 可忠实表示数」；
- 观测降级与出口腐化对合法写入结构性闭合（决策 7）；「写得出、读不回」不对称
  消失；
- 与 ADR 0020 合并为单一基线：三约束形态不再需要「自闭合」特殊口径，number 家
  族心智统一；
- 指纹、IR、codegen 生成物零影响（决策 6）；无新增错误码（四值拒绝走 validate
  消息，文本侧 -0 复用 E100）。

### 负面 / 代价

- 语义收窄是 breaking 变化：外部生态若有依赖 NaN/±Infinity/-0 通过 `number` 校
  验的使用将被拒绝，发版说明必须显式告知；
- 含四值的存量 doc 在 rearm / 重校验时 loud 失败（决策 5 的既定姿势，需运维认
  知）；
- §8 例外条款增至两类（保留名增补 + 语义收窄），冻结纪律的维护成本上升——每
  类都须逐一 ADR 裁决防止滑坡；
- validate / validate-patch 判定与消息细分引入少量实现与测试增量。

### 测试矩阵要点

- validate：NaN / +Infinity / -Infinity / -0 入裸 `number` 全拒（消息细分正
  确，-0 经 `Object.is` 识别不被显示为 "0"）；`0`、`0.0`、有限小数正常放行；
- validate-patch：写路径同口径四值全拒；
- 三形态（ADR 0020 落地后）：四值入 `int` / `range` 叶子全拒（统一基线）；
- 文本侧（ADR 0020 字面量拓宽落地后）：`-0` / `-0.0` 字面量与端点 E100，锚位正
  确；
- 指纹与 IR：既有 fixture 逐字节不变；
- changelog：合法写入的 doc 不再触发数值分支 `capture:'unavailable'`（结构性闭
  合的锁定测试）。
