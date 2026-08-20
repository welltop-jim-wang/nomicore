# 冲突门禁报告（设计后复审）

- 被审对象：SA1 设计文档 v1 `wiki/raw/task_vfsl-codegen-hardening_design.md`（首轮，无 SA2 反馈轮次）
- 冲突基准：`docs/adr/0001–0005` 全集 + `CONTEXT.md`（本会话前置门禁轮已 5/5 逐篇全读，本轮复用；ADR 无变更、无 superseded）
- 门禁类型：设计后复审（轻量——只裁设计与 ADR 决策一致性；全维度攻击评审属 SA2，设计优劣与实现质量不在本门禁）
- 关联产出：前置门禁报告 `task_vfsl-codegen-hardening_conflict_report.md`（Verdict clear，5 边缘项均 no-conflict）；相关决议文档已按规程追加「设计引入的新决策点」7 条（`_relevant_decisions.md`）

## Verdict

`clear`

## ADR 盘点

| 编号 | 标题 | 状态 | 相关 | 对照结论 |
|---|---|---|---|---|
| 0001 | VFSL 文本是 schema 的唯一真相源，只存在于文档与测试中 | accepted（含 2026-08-19 修订节） | 相关 | no-conflict：改动全部落在修订节放行的生成器层（`@nomicore/vfsl-codegen`，ADR-0005 §5 定位）；生成物保持纯类型文本（§3.2 type-only 单名导入、零运行时发射）——修订节「投影不参与运行时判定、不承担权威」保持；无机器标签、方言冻结、SchemaSource 纪律均未触（§2：FileSchemaSource → assertVfslDialect 不变；DENY 冻结 parse 层） |
| 0002 | nomicore 是全新 yjs-server 重写，authority 完全出范围 | accepted（无显式状态行；未被 supersede） | 无关 | no-conflict：不触 authority / 写入管线 / 旧系统兼容 |
| 0003 | 求值器与派生 schema——evaluate 接缝、ROOT 约定、联合表示、按名引用 | accepted | 部分相关 | no-conflict：evaluate/parse 契约零改动（DENY `packages/vfsl/src/**`，§2 输入契约冻结）；ROOT 保留名天然不在协议导出面（§4.4 免特判，与保留名契约一致）；21 E 码冻结被显式遵守（§4.6 否决「parse 层新 E 码」被否选项 1）；「ref→别名引用（按名）」映射经否决「静默改名」被否选项 2 而保持；「惰性积木合法」条款见冲突点 #4 |
| 0004 | vfsl-protocol 类型协议包——D1–D5 | accepted | 相关 | no-conflict：§8.3 六项映射逐项未触（§3.2 显式界定）、D5 逐行搬移不变（§3.5）、D1/D2/D4 未触；D3「零运行时代码」被双重遵守——协议包入 DENY（禁增删导出、禁运行时名单）+ 冻结名单外置生成器包（见冲突点 #2）；import 行裁决见冲突点 #1 |
| 0005 | 投影生成管线——SchemaSource 接缝、输入契约、生成物入仓 | accepted | 高度相关 | no-conflict：生成器输入仍为派生 schema（§4.4 守卫读 `derived.aliases`，非 IR）；docs 发射保持（§3.5 aliasDocs / rootDoc TSDoc，§3「派生 schema 必须携带 docs」条款满足）；头注机制不变（header.ts 入 DENY）；CI regen-diff 前提保持（§3.4 常量行 + 纯分段 join 确定性）；「生成文件入仓 + 同票原子提交」见冲突点 #6；`--check` 行为增强见冲突点 #5 |

## 冲突点

无 hard-violation、无 override-declared、无 evolution。以下为设计层逐条对照的边缘项，均裁 no-conflict（严重度列「—」表示非冲突）：

| # | 严重度 | ADR 条款 | 设计决策 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | — | ADR-0004 后果：「类型树形状 = 生成契约：票 F 生成器的输出规格即本 ADR + 设计文档 §8.3 映射表（Record 通配层 / 标记→kind / Pattern→string / YXmlFragment→string / ref→别名引用 / docs→TSDoc 注释）」 | §3：任意合法域（含零别名域、0 字段 ROOT）恒定发射 import type 行，文本逐字冻结 | no-conflict | 与前置门禁边缘项 #2 同裁：import 行是模块级接线（名字绑定 + 模块性），不属 §8.3 映射表任何一项、不参与类型计算，类型树形状零变化（设计探针 §11-A/C：无碰撞基线 post-N1 零诊断、段③ 成员类型解析不变佐证）；设计 §3.2 显式采纳该边界，§8 对前置门禁提示 3 逐条回应 |
| 2 | — | ADR-0004 D3：「全部内容为类型空间产物……编译后为空模块，零依赖、零运行时代码」 | §4.1/§4.5：协议导出面 12 名冻结名单置于生成器包 `protocol-surface.ts`；§10 DENY `packages/vfsl-protocol/src/index.ts`（禁增删导出、禁加运行时名单） | no-conflict | 若在协议包内加可枚举运行时名单才构成 D3 违反；设计反向选择冻结快照 + SA6 checker 实测同步锚，协议包零改动。名单含 D3 文字未逐一列全的 5 名（`VfslKind`/`RootSchema`/`VfslValueOf`/`PathPatchValue`/`PathElementValue`）——D3 是包形态描述非穷举清单，以实测导出面为准不构成条款冲突（设计 §4.1「名单数据源纪律」） |
| 3 | — | ADR-0005 §3：「物化折叠、联合三分类、判别式检测只计算一次（单一真相），生成器是纯发射器」；ADR-0003 后果：「§4 错误表新增 E310/E311（19 → 21 码）」 | §4.3/§4.4：新增 `AliasProtocolExportCollisionError` + 发射前置守卫 `assertNoProtocolNameCollision`，独立码 `alias-protocol-export-collision` | no-conflict | 与前置门禁边缘项 #3/#4 同裁：守卫是对固定名单的集合成员测试，非语义分类重算，输入仍为派生 schema（§4.4）；响亮失败为管线既定模式（ADR-0005 §1 方言断言、§2 三键校验），且与既有三类发射期错误（UnsupportedRootShapeError 等）同构相邻。21 E 码冻结被显式遵守：设计 §4.6 否决「加 E312」，新码为 kebab 短语族，与 `VFSL-E<nnn>` 前缀/词形及接缝层闭合三码机械隔离（§4.3 三码族隔离表） |
| 4 | — | ADR-0003：「其余无人引用的别名是惰性积木——合法、不进数据面。」 | §4.2/§11-D：未引用（惰性积木）碰撞别名按声明名拦截（引用形态的超集；理由：未引用 `PathSchema` 仍 TS2440、其余名导出面遮蔽、演进安全） | no-conflict | 「合法」限定的是 parse/evaluate 接受性与数据面成员资格，未授予「生成器必须成功发射一切合法派生 schema」的义务；发射层对合法但不可投影输入的响亮拒绝是既有实践（三类发射期错误）且符合管线响亮失败纪律。声明形态超集的拦截域宽度属设计裁量，移交 SA2 攻击评审（非 ADR 冲突） |
| 5 | — | ADR-0005 §4：「CI `generate --check`：全量重新生成 → diff 为空；**源漂移与生成器逻辑漂移双抓**」 | §9：`--check` 对碰撞域行为 exit 0（历史 E5 实测）→ exit 2（有意行为增强，设计披露） | no-conflict | `--check` 同走生成路径（`collectProjections`），碰撞域本就不存在合法产物可作 diff 比较；内容缺陷判定先于 diff 比较与 §4「双抓」意图一致，且方向为响亮化（消除 exit 0 假绿），非静默化；§4 未冻结 `--check` 对非法输入的具体退出行为 |
| 6 | — | ADR-0005 §4：「生成文件入仓……头注 `GENERATED … DO NOT EDIT` + 源文本哈希」「schema 改动与重新生成同一原子提交」 | §3.1/§3.4：生成物布局规范化（零别名域双空行消除）；仓内零入仓生成物（find 实证）→ 再生成步骤空操作；SA3 见 `domains/` 出现即报阻塞 | no-conflict | 头注机制不变（header.ts 入 DENY，§3.1 样例头注四要素齐备）；确定性保持（常量行 + 纯分段 join，§3.4）；仓内零生成物 → 布局变化零迁移、原子提交要求空转成立，AC-5 `generate --check` 为机制兜底——即前置门禁边缘项 #5 的一致性要求在设计层的正确落实 |

## 结论

**Verdict: clear，放行。** SA1 设计 v1 与 ADR-0001（含修订节）至 0005 及 CONTEXT.md 全部硬性条款对照一致，无直接违反；前置门禁 5 项边缘裁决在设计层全部得到显式尊重（设计 §8 逐条回应三提示，§4.6 被否选项主动规避两类违反路径）。无 override-declared、无 evolution、无 hard-violation。

设计对约束的增强性遵守（记录供链路参考，非裁决）：

1. ADR-0003 21 E 码冻结：主动否决「parse 层新 E 码」，选发射层独立码族并给出三码族隔离表；
2. ADR-0004 D3：协议包入 DENY 双禁（增删导出 / 运行时名单），冻结名单外置生成器包 + checker 同步锚；
3. ADR-0004「ref→别名引用（按名）」：否决「静默改名规避碰撞」，改为响亮失败 + schema 作者改名指引；
4. ADR-0005 §4：仓内零生成物的再生成空操作论证 + SA3 见越界文件即报阻塞的处置。

移交 SA2 的观察（非冲突、非本门禁裁决，仅攻击面提示）：

- **AC-4 范围忠实度**：任务简报 Owner 裁定 3 与 AC-4 字面为「三处」消息串，设计同步替换第 4 处（emitter.ts:50 JSDoc 注释，零行为面，`grep -c = 0` 判据）——超出简报字面的最小扩scope 是否成立属 SA2 评审域；
- **拦截域宽度**（冲突点 #4）：声明形态超集（含未引用惰性别名）与 `--check` 行为增强（冲突点 #5）均已在设计 §4.2/§9 披露并给出理由，攻击评审在 SA2；
- **事实性小勘误**（不构成冲突，无 ADR 冻结 12 名清单）：设计 §4.1 称 D3 文字未列全者为 4 名（RootSchema/VfslValueOf/PathPatchValue/PathElementValue），按 D3 原文实为 5 名（另有 `VfslKind`）——不影响冻结名单本身（以实测 12 名为准），建议 SA2 顺手核对措辞。
