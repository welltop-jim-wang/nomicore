# 冲突门禁报告 — task_vfsl-validate-patch（issue #53，Phase 0 前置门禁）

被审对象：`wiki/raw/task_vfsl-validate-patch.md`（任务简报，H2 validatePatch 路径级写入校验 / 功能开发）
冲突基准：`docs/adr/` 全集 5 份（0001–0005，逐个全读）+ `CONTEXT.md`
总控加审参照（非冲突基准）：`docs/phases/phase-2-engine-gaps.md`、`docs/vfsl/v1-spec.md` §7
事实核验（非约束）：`packages/vfsl/src/validate.ts`（ValidateIssue:41 / resolveValues:122）、`packages/vfsl/src/resolve.ts`（resolveChain:67）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源 | accepted（2026-08-19 修订） | 弱 | 无冲突——纯运行时校验引擎件，兑现「坏数据进不来」；不触及 schema 文本入仓、codegen、机器标签、方言条款 |
| 0002 | nomicore 是重写，authority 出范围 | accepted | **是（管线形状依据）** | 无冲突——简报的两段判定（结构守卫 + 值校验）即「结构 → 值 → 单事务提交」的前两步判定核心；「单事务提交」与 yjs 明确留在 Phase 2 层（与 phase-2-gaps「不碰 yjs」纪律同向）；简报未引入任何 authority 式不变式 |
| 0003 | 求值器与派生 schema | accepted | **是（直接依据）** | 无冲突——结构守卫「任一成员出现即存在」逐字兑现 §3；AC「报失败距离最小成员 + 联合成员 i/N」逐字兑现 §3 no-match 诊断；resolve 双份收敛（resolveValues/resolveChain 合一）正是对齐 §4「解析动作由包内共享解析器完成」及后果「一切遍历经包内共享解析器」；简报不触碰派生 schema 形状（公共契约） |
| 0004 | vfsl-protocol 类型投影（D1–D5） | accepted | **是（D1/D2 词表）** | 无冲突——「数组三操作（insert/append/delete）= D1 词表的运行时面」与 D1 专用 API 条款一致；「下标越界为运行时错误（替换语义）」即 D1「越界归运行时校验」；「plain 下钻拒绝」即 D1「YPlainArray 只能整体替换」；「向 union 成员写入他成员字段 → 重建后 any-of 全拒绝」即 D2「当前成员是否允许该写入归运行时重建校验」的执行面；D3/D4/D5 为类型空间条款，本票不触及 |
| 0005 | 投影生成管线 | accepted | 无关 | 无冲突亦无关联——本票不触碰 SchemaSource / codegen / domains/ / CI regen-diff；列入仅为盘点完整性 |

CONTEXT.md 对照：「重建校验」「结构树」两条术语即简报两段判定的定义性出处（逐字吻合）；「零写入」由纯函数判定核心支撑、400/WS 语义按 phase-2-gaps 纪律留 Phase 2；「封闭对象」支撑「未知键路径拒绝」；「路径索引」Avoid 项（resolveChild 三级前缀匹配）未被要求复活。无冲突。

## 冲突点

| # | 严重度 | ADR 条款 | 被审对象要求 | 裁决 | 依据 |
|---|---|---|---|---|---|
| — | — | — | — | 无冲突点 | 全部对照项均为 no-conflict（明细如下） |

逐项对照记录（无冲突明细）：

| # | 基准条款 | 简报要求 | 裁决 | 依据 |
|---|---|---|---|---|
| 1 | ADR-0002：「统一写入管线收敛为『结构 → 值 → 单事务提交』三步」；authority「完全排除在范围外，不保留接口」 | 「两段判定：结构守卫 + 值校验」；AC 无任何不变式规则 | no-conflict | 简报只做判定核心（前两步），第三步（单事务提交）留 server 层——与 phase-2-gaps「不碰 yjs」纪律互证；未引入 enum/range/conditional/state-machine 式校验 |
| 2 | ADR-0003 §3：「路径存在性为**任一成员出现即存在**」 | 「结构守卫——按结构树查路径存在性（ADR 0003『任一成员出现即存在』规则）」 | no-conflict | 逐字引用并执行该条款 |
| 3 | ADR-0003 §3：「no-match 诊断：报**失败距离最小**的成员（平局按声明序），消息标注『联合成员 i/N』」 | AC「重建后 any-of 全拒绝（报失败距离最小成员 + 『联合成员 i/N』）」 | no-conflict | AC 即条款的镜像复述 |
| 4 | ADR-0003 §3：「判别式缓存……**不得改变任何可观测行为（含错误输出）**——映射未命中回流同一诊断生成器」 | 「值校验……整体过子 schema（联合判别一致性由重建兜底）」+「复用 validate.ts 解释器」 | no-conflict | 重建校验复用 validateSnapshot 同一解释器/诊断生成器，缓存非契约性由共用路径天然保全；简报未提出任何绕开诊断生成器的机制 |
| 5 | ADR-0003 §4 + 后果：「解析动作由包内共享解析器完成」「一切遍历经包内共享解析器」 | 「复用 #31 的 validate.ts 解释器，不复制第三份——并顺手收敛 resolve 双份问题（resolveValues/resolveChain 合一）」；AC「resolve 循环收敛为一份（validateSnapshot 与 validatePatch 共用）」 | no-conflict | 收敛方向正是对该条款的对齐（现状双份为 #28/#31 评审留档的欠账，实读核实：validate.ts:122 与 resolve.ts:67 两份并存）；合一后的具体形态属 SA1 设计自由，不受本门禁裁决 |
| 6 | ADR-0003 §5：「`xml-fragment` 是结构树的**终态节点**……路径下钻守卫到此为止……运行时校验仅要求良构 XML」 | AC 列「leaf 下钻 / plain 下钻」拒绝，未单列 xml-fragment | no-conflict | 简报未提议允许下钻 xml 位——遗漏属验收清单完备性问题（观察 2），不构成对条款的违反；「按结构树查路径存在性」的总则已涵盖终态位 |
| 7 | ADR-0003 后果：「派生 schema 的形状变更须走设计修订流程（公共契约）」 | `validatePatch(derived, base, path, value)`——derived 为只读入参，纯函数不抛错 | no-conflict | 只消费不改形状；如 SA1 设计期提出形状变更，须自行走修订流程（已在相关决议文档明示） |
| 8 | ADR-0004 D1：「越界归运行时校验」「序列编辑……由专用 API 承载：appendToArray / insertIntoArray / deleteFromArray」「YPlainArray 只能整体替换」 | 「数组下标越界为运行时错误（替换语义）」「数组三操作变体（insert/append/delete，D1 词表的运行时面）」「plain 下钻 → 拒绝」 | no-conflict | 三操作即 D1 专用 API 的运行时判定面；越界语义逐字对齐；plain 整体替换=拒绝下钻。insert 的下标边界（末尾 append 位）无 ADR 冻结，属 SA1 设计自由 |
| 9 | ADR-0004 D2：「当前成员是否允许该写入归运行时重建校验——类型层查键空间与值类型，运行时查成员适配」 | AC「向 union 成员写入他成员字段 → 重建后 any-of 全拒绝」 | no-conflict | 简报执行的正是 D2 显式指派给运行时的职责；拒绝语义（any-of 全拒）与 ADR-0003 §3 匹配语义一致 |
| 10 | CONTEXT.md：「重建校验」「结构树」「零写入」「封闭对象」「整文档校验」「路径索引（Avoid: resolveChild 三级前缀匹配）」 | 两段判定、纯函数不抛错、未知键拒绝、全收集+上限与 validateSnapshot 一致 | no-conflict | 各术语逐条吻合（详见相关决议文档）；validatePatch 作为路径级入口与 validateSnapshot 并列，不破坏后者「单一入口」条款（CONTEXT 另设「重建校验」术语即为此形态）；无三级前缀匹配复活 |
| 11 | ADR-0001：「纯引擎仓库」「运行时校验兑付『坏数据进不来』」；ADR-0005：codegen/domains 面 | 纯引擎新增（phase-2-gaps「零新运行时依赖」纪律同向），不触碰投影管线 | no-conflict | 无 schema 文本入仓、无消费方绕行、无 0005 面改动 |

## 结论

**Verdict: clear** —— 任务简报与 ADR 全集（0001–0005）及 CONTEXT.md 无任何冲突点：0 hard-violation、0 evolution、0 override 声明需求。简报的核心条款（任一成员存在规则、失败距离最小诊断、重建校验、D1 三操作运行时面、解释器单一来源）均为既有决策的逐字执行或欠账收敛，放行。

补充观察（非阻塞，供总控/下游 SA 知悉）：

1. **参考指针混写**：简报「关键参考」把「设计文档 §7（统一写入管线）」指向 `docs/vfsl/v1-spec.md`——实读 v1-spec.md §7 为「信封形状」，非写入管线；「统一写入管线 §7」属 Feishu 设计文档（ADR 0003 关联节明引）。不构成 ADR 冲突（属参考元数据错误），但 SA1/SA3 应以 ADR 0003 §3/§4/§5 + CONTEXT「重建校验/结构树」为语义依据，勿把 v1-spec §7 当写入管线规格读。相关决议文档已作指正。
2. **xml-fragment 终态位未入 AC**：ADR 0003 §5 规定 xml-fragment 为终态节点（下钻守卫到此为止、值校验仅要求良构 XML）；简报 AC 的拒绝清单只列了 leaf/plain。建议 SA1 设计时把 xml 位并入终态拒绝矩阵，避免验收缺口。
3. **resolve 合一的范围纪律**：简报把 resolveValues/resolveChain 收敛作为「顺手」项挂入本票；phase-2-gaps 纪律亦明文要求。合一后的形态（两者现分别面向 ValueSchema 与 VfslType）属 SA1 设计自由；门禁只确认方向与 ADR 0003 §4「包内共享解析器」一致，且不得因此改动派生 schema 公共形状（如需变更 → 设计修订流程）。
4. **前置链完整**：`Blocked by: None`；validate.ts（#31 产物）与 ValidateIssue（validate.ts:41，经 index.ts:58 导出）实读在位，简报的事实性引用全部核实成立。
