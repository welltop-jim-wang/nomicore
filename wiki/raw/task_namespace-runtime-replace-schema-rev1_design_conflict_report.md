# 冲突门禁报告（设计后复审）

- 被审对象：`wiki/raw/task_namespace-runtime-replace-schema-rev1_design.md`（SA1 修订设计，round 2 / rev1，213 行）
- 冲突基准：`docs/adr/` 全集 8 份 + `CONTEXT.md`（ADR 全量盘点沿用前置门禁 `task_namespace-runtime-replace-schema-rev1_conflict_report.md`，本报告不重复；`docs/adr/` 与 `CONTEXT.md` 本轮无改动，基准未漂移）
- 阶段：第 2 阶段 SA8 设计复审；全维度攻击评审属 SA2，实现质量属 SA4/SA7，本报告不裁

## Verdict

`clear`

## ADR 盘点（沿用前置门禁，本节仅列设计触点）

| 编号 | 状态 | 设计触点 | 对照结论 |
|---|---|---|---|
| 0008 | accepted | §2 D1–D8、§3、§4、§9 | 一致：回归 :69（第 3 条）；:73-75 事务机械/identity/零写入零触碰；:43/:45 槽序与快照纪律零触碰；:79-88 失败通道与 fatal 分类零漂移 |
| 0007 | accepted（Runtime/open/read 条款由 0008 取代；底层决策沿用） | §2 D1 失败透传、D3、§4 #5/#11 | 一致：validateLogicalSnapshot 纯 JSON 输入（:14）、零写入覆盖验证与构造失败（:54）语义保持 |
| 0001–0006 | accepted | 无触点（0003/0006 弱相关维持前置门禁结论） | 不触及 |
| CONTEXT.md | 术语基准 | 设计 D5/D6/D7 文档面修订 | 新文案与 0008:69/:75、「封闭对象」（:90-91）、「零写入」（:81-82）逐句一致；:17-19 旧条目系前置门禁已裁决的修改对象 |

## 冲突点

| # | 严重度 | 条款 | 被审设计决策 | 裁决 | 依据 |
|---|---|---|---|---|---|
| 1 | — | ADR 0008:69「提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容」 | D1：删 `projectDeclaredRootKeys`（调用 :170 + 本体 :300-337），`snapshot = input.root.snapshot` 原样喂 `validateLogicalSnapshot` → `buildTopEntries`，未声明顶层键在 validate 响亮失败（`{kind:'fail', issues}`） | no-conflict | 逐字对齐：接收与校验之间零改造，「视为最终完整 snapshot → 验证 → detached 构造」三步即 D1 代码形态；失败走结果联合（:79）且发生在 transaction 前（:75）；顶层键复用 vfsl 封闭对象检查（与嵌套同一实现、path=[<k>]）不引入新 issue 通道 |
| 2 | — | ADR 0008:73-75（transaction 内原子替换、ROOT identity 保留、失败前置于 transaction、零写入、active tools 不变） | D3：④ ⑥ `verifySnapshotIntact` 喂原样 snapshot（取代 round 1「⑥ 必须喂 narrowed」） | no-conflict | ② 事务机械与双顶层 identity 零触碰（§4 #3）；:75 失败时序不变（validate/build 仍在 transaction 前，ok:false 不达 ②）。⑥ 属写后校验（E201 post-commit 通道），ADR 未规定其内部输入，无条款可违；「validate/build/⑥ 同一 (derived, snapshot) 对」恰是 :69「视为最终完整 snapshot」单形态纪律的相容实现——round 1 ⑥ 喂 narrowed（使提交内容 ≠ 调用方 snapshot 的已验证形态）反而与 :69 相悖。恒等性论证（全声明输入下投影为恒等映射、E201-C/D 可达集不扩张）属实现风险，归 SA2/SA4 复核 |
| 3 | — | ADR 0008:45 槽序 + :43 快照时点 | §4 #10、§9：`result.ok === false` → 槽内直接返回，S5.5 installActive / S6 notifyDirty 不执行；sequencer 槽体零触碰；R2-3 仅改测试输入，快照时点断言原样 | no-conflict | 失败不调 dirty notifier 与槽序（校验→构造→transaction→`await notifyDirty()`）一致；「取得槽后立即快照、之后只用内部快照」语义不变 |
| 4 | — | ADR 0008 §Fatal 与失败通道（:79-88）+ ADR 0007 失败边界（:54） | §3 E204 可达性论证：删投影后 γ 经 `buildTopEntries` 内 `makeRefResolver` 环守卫触发，同一 catch、同 phase/committed（E204 pre-commit-internal committed:false）、cause 链不变；§4 #11 fatal 三分类保持 | no-conflict | catch 面异常类别集合不变（被删 throw 源与 buildTopEntries 内 throw 同类同源）；branded fatal / 永久禁写保读 / post-commit 语义均未触碰。可达性实证属 SA4 验证面 |
| 5 | — | CONTEXT.md:17-19 现行「顶层声明域投影」条目 | 设计 D7：条目改写为「原样封闭校验」，`_Avoid_` 标记旧术语已废止；advisory R7 登记作废 | no-conflict（修改对象） | 前置门禁冲突点 #4 已裁决：该条目无 ADR 背书、与 0008:69 及「封闭对象」矛盾、系 round 1 偏差落档，是修改对象而非冲突源。新文案逐句对齐 0008:69（「完整最终 logical ROOT snapshot」「原样」「不投影、不剥离、不合并」）与「零写入」，`_Avoid_` 惯例与既有条目（如 ROOT 条目标注被否决方案）同款 |
| 6 | — | ADR 全集（无任何条款授权公共 API 剥离契约） | 设计 D6：`ReplaceSchemaInput.root` JSDoc「未声明顶层键被剥离且 ok:true」段改写为「未声明键一律响亮拒绝（顶层与嵌套同族）……零写入、SCHEMA/ROOT/active tools 不变」 | no-conflict | 新文案为 0008:69/:75 + Issue #91 AC3 的准确转述；被删旧文案恰是 round 1 hard-violation 的文档面，删除即消除 |

### 取代声明完备性核验（§0）

- **废止面逐一点名**：round 1 D7 语义本体、INV-S12、锚 15 投影读法、「⑥ 必须喂 narrowed」推论、「被剥离键 advisory 上报另立 issue」（R7）——全部显式废止 ✓。
- **代码面残留清零路径**：`narrowed` 字段（D2）、死注释（D5 逐处表）、孤儿 imports（D4），§6.2-3 提供残留自检 grep ✓。
- **历史档案处置**：round 1 wiki/raw 档案不改写、取代关系由本 rev1 文件显式声明（§0、§7 DENY）——与简报「不改写历史」一致 ✓。
- **ADR 面**：设计未声明推翻/演进任何 ADR，§7 DENY 冻结 `docs/adr/**` 并自认「回归 ADR 而非修改 ADR」——无 override-declared、无 evolution、无需 Jim 裁决 ✓。
- 唯一基准文件改动 = CONTEXT.md 术语条目（设计 D7），前置门禁已裁决为修改对象（见冲突点 #5）。

## 结论

**放行（clear）。** 重点核验四项全部通过：① D1 与 ADR 0008:69 逐字对齐（原样 snapshot → validateLogicalSnapshot → buildTopEntries，接收与校验之间零改造授权、零改造实现）；② D3 与 0008:73-75 相容（事务机械/失败时序零触碰，⑥ 喂原样系 :69 单形态纪律的相容实现，无 ADR 条款约束 ⑥ 内部输入）；③ D6/D7 文档面与 ADR 零抵触（新文案为 0008 条款的准确转述，被删旧文案即违规本体）；④ 取代声明完备（废止面逐一点名、残留清零有路径、ADR 冻结不动、历史档案不改写）。无 override、无演进、无条目需 Jim 裁决。D3 恒等论证与 §3 E204 可达性的实证正确性归 SA2 攻击评审与 SA4 实现验证，不在本门禁裁决范围。
