# SA8 前置门禁相关决策摘录 — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-f1408f90-e984-4905-8472-ed0955cce331`（mabf-sa8 / conflict-gate / iteration 0）
- 被审对象：task brief `wiki/raw/task_issue-309.md` + 已接受的 SA6 验收契约 `wiki/raw/task_issue-309_sa6_contract.md`
- 本文只摘录相关决策、条款与关联点；不重写原义、不做业务设计。冲突裁决见 `task_issue-309_conflict_report.md`。

## 1. 决策集合盘点

`docs/adr/` 现存 17 份 ADR（0001–0019，无 0013/0015 编号），全部为 accepted；无被 superseded 的整体废弃（0007 的 Runtime/open/read 条款由 0008 部分取代、0003/0016 的 docs 表/切片条款由 0019 显式修订——均属决策文本自述的修订，不产生失效约束）。与本任务相关：

| 决策 | 状态 | 相关条款 | 与 #309 的关联点 |
|---|---|---|---|
| **ADR 0019**（docs/adr/0019-vfsl-union-member-docs.md，accepted 2026-09-11，跟踪 issue #304） | accepted | 决策 1（M4 锚位规则：前导 `\|` 锚位 / 首成员起点锚位 / 连续 doc 同挂 / `\|` 夹缝不属 M4）；决策 2（单成员坍缩维持 E305，逐字节一致）；决策 3（M3 优先不双挂；夹缝不对称「spec 修订中显式注明」）；决策 4（IR `memberDocs` 条件键 + 指纹纪律）；决策 5（derived 条件稀疏表，修订 ADR 0003 docs 表条款 3→4 张）；决策 6（codegen 四发射位）；决策 7（投影 docs 切片第三来源，修订 ADR 0016，marker 在前 member 在后）；决策 8（纯文档性质）；决策 9（只增不改合规：语法只增 / 语义不改 / 错误码稳定；E305 消息正文枚举补「联合成员」，正文措辞不冻结）；Consequences（「v1-spec §5 挂载规则修订（四类锚位 + M4 子规则 + 挂载示例）随实现 PR 落地（避免『规格已改、实现未跟』的中间态）；schema-authoring-guide 第 7/8 节与检查表同步」） | #309 的全部授权来源与义务来源：文档面修订内容（决策 1/2/3 + 示例）、边界表述（决策 2/3/9.3）、落地时序（Consequences） |
| ADR 0003（docs/adr/0003-evaluator-derived-schema.md） | accepted（docs 表条款被 0019 修订） | 决策 2：ROOT 根别名约定（每模块恰一个 `ROOT`、map 形） | G16 陈旧期望 `AssetsDoc` 的对照基准：现行 v1-spec §10 fixture 已是 `type ROOT = YMap<…>`（本仓实测 `AssetsDoc` 在 v1-spec 中 0 命中） |
| ADR 0016（docs/adr/0016-readdata-semantic-schema-projection.md） | accepted（docs 切片条款被 0019 修订） | docs 切片两来源 → 三来源（0019 决策 7） | SA6 契约 E2 冻结观察（合并序 marker 前 member 后）的决策依据 |
| ADR 0001（docs/adr/0001-vfsl-single-source-of-truth.md） | accepted（2026-08-19 修订节） | 文档注释无机器标签、全部文档性质 | v1-spec §5 `@tag` 条款的口径；#309 不得引入机器语义 |
| ADR 0017（docs/adr/0017-schema-lifecycle-metadata-and-vfsl-fingerprint.md） | accepted | 指纹对比契约 | ADR 0019 决策 4 指纹纪律的上游（金样本常量不得改） |

## 2. 规范文档（语言规格）相关条款

- **v1-spec §4（L277–280）**：错误 message「以冻结前缀格式传递……前缀（`VFSL-E` + 三位编号 + 冒号 + 单空格）是本规格冻结项，消息正文措辞不冻结。issue #5 起的测试应以前缀为断言锚」——E305 断言锚的冻结边界。
- **v1-spec §5（L390–424）**：现行「挂载规则……三类：类型别名（声明处）、属性（对象字段处）、标记类型（Marker 记号处）。连续多个文档注释按出现顺序全部挂载到同一后续节点……→ VFSL-E305」；挂载示例表 = 附录 fixture 7 条 doc，无联合成员样本——#309 的修订对象。
- **v1-spec §8（L461–471）**：方言演进「只增不改」（语法只增 / 语义不改 / 错误码稳定）；「本规格自身的修订同样只增不改。首次发布前的规格评审修订轮次不受本条约束（错误码编号随首次发布冻结）」。
- **v1-spec §10（L490+）**：参考 fixture 声明 `type ROOT = YMap<{…}>`（ROOT 约定正例形态）。
- **schema-authoring-guide**：L204「JSDoc 必须紧邻类型别名、对象字段或标记类型才能挂载」（三锚位句）；§7（L152）/§8（L166）示例无逐成员 doc；`## 提交前检查表`（L273）无 M4 条目——#309 的修订对象。

## 3. 模块 AGENTS 明确收录的决策

- **docs/AGENTS.md**：Authority——「Historical `wiki/raw/` artifacts are evidence, not normative contracts」；Editing——「update `CONTEXT.md` when introducing or changing a domain term」「Amend or supersede prior decisions explicitly instead of silently contradicting them」「When code behavior changes, update every normative document whose stated contract changed; documentation-only wording changes must not invent implementation behavior」；Verification——「search for stale terminology and contradicted decisions, and run `git diff --check`」。
- **packages/vfsl/AGENTS.md**：视 root CONTEXT.md、v1-spec、ADR 0001/0003/0007/0016 为规范；「Stable error codes, issue ordering, path reporting, envelope strictness, and fingerprint inputs are compatibility behavior」；「`schemasource.ts` is the intentional filesystem-bound seam」；公开 API 仅经 `src/index.ts`。

## 4. 已登记的前置门禁约束（wiki 证据，非独立决策权威）

- `wiki/raw/task_issue-306_design_conflict_report.md` **O-3（#309 范围，预登记）**：「`tests/acceptance/vfsl_spec_acceptance.py` 硬编码『挂载目标: 类型别名 / 属性 / 标记类型』……#309 修订 v1-spec §5 时必须同支更新该检查器与 schema-authoring-guide，否则 C-1 违反」；**O-5**：「v1-spec §5/编写指南在 #309 落地前仍写三锚位——分支中间态豁免由 C-1/C-5 覆盖（PR #305 收官门槛含 #309）」。其权威根可追溯到 ADR 0019 Consequences 与 v1-spec 的规范性（docs/AGENTS.md Authority），不依赖 wiki 自身。

## 5. CONTEXT.md 术语现状

CONTEXT.md 无「锚位 / 挂载 / M4 / 联合成员」条目（唯一相关处 L42 投影定义中的「文档注释表的相关切片」，与 ADR 0019 决策 7 相容）；「锚位」一词已是仓库既有词汇（ADR 0019 正文与源码注释），未被 CONTEXT.md 收录为术语。CONTEXT.md 收录语言级术语的先例：标记类型（L49）、判别联合（L115）。

## 6. 事实基线（SA8 独立复核，2026-09-11，HEAD `bbb93fb` / 分支 `mabf/issue-309`）

- 「三锚位」残留：tracked 文件（排除 `wiki/**`、`dist/`）**14 处 / 9 文件**，逐行号与 SA6 契约 §5.4 完全一致（含 `docs/adr/0019:60` 唯一规范文档命中）；`wiki/` 内另有 25 个 tracked 历史产物命中。
- v1-spec §5 现行文本、指南 L204/§7/§8/检查表、检查器 docstring（挂载目标三锚位）、G10 need 列表（12 项）、G16 L321 `AssetsDoc` 期望、exemplar §4（类型别名处/属性处/标记类型处）均与 SA6 契约引用逐字一致。
- Issue #309 REST：`comments: []`（无 Owner 追加要求；派发指令确认无 owner-comment 约束）。
