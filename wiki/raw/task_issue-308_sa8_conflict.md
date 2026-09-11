# SA8 冲突门禁报告 — issue #308（readData 语义投影 docs 切片并入 memberDocs）

- Dispatch：`sa-d1327417-a979-43bb-bf7b-cf92692671b5`（mabf-sa8 / conflict-gate / iteration 0）
- 审查对象：issue #308 任务简报（Issue body；REST comments 为空 `[]`，无附加 Owner 要求）
- 门禁类型：前置门禁（SA 派发前：任务简报 vs 既有决策集）
- 裁决：**clear**（放行）—— 0 阻塞 / 2 低（文档-流程卫生，非实质决策冲突）/ 12 项逐条一致
- 证据基线：ADR 全集（docs/adr/，截至本支 HEAD `4d4208b`）+ 根 CONTEXT.md；规范面按 docs/AGENTS.md 与 packages/vfsl/AGENTS.md 纳入 docs/vfsl/v1-spec.md。代码仅用于前提可行性核实，不构成冲突基准。

## 1. 冲突基准与前提事实

| 项 | 事实 | 出处 |
|---|---|---|
| 任务来源 | #308「feat(vfsl): readData 语义投影 docs 切片并入 memberDocs」，OPEN，in-progress | `gh issue view 308`；`wiki/raw/task_issue-308.md`（task brief） |
| 评论面 | 空 `[]` —— 无附加 Owner 要求 | issue JSON `comments: []` |
| 前置阻塞 | #306（M4 解析 + IR/derived `memberDocs`）CLOSED + ci-passed，实现已合入本支（`4d4208b`，经 PR #313） | issue #306 状态；本 worktree `git log`（分支 `mabf/issue-308`） |
| 集成支 | PR #305 OPEN（`docs/issue-304-vfsl-union-member-docs`），本支含设计提交 `91c4add`（ADR 0019）+ #306 实现 | `gh pr view 305`；git log |
| 权威决策 | ADR 0019（2026-09-11，已接受）§7 即本票的母决策；§5 修订 ADR 0003 docs 表条款（三表→四表） | `docs/adr/0019-vfsl-union-member-docs.md` |
| 被修订方 | ADR 0016（2026-09-09，已接受）docs 切片条款（L35–36「fieldDocs/markerDocs 的相关切片」）与 L42「文档三表」措辞——正文**尚未**回写增补节 | `docs/adr/0016-readdata-semantic-schema-projection.md` |
| 实现现状 | `resolveSchemaAtPath` 两来源切片（`sliceDocs` L427–463）；值侧游走已产 `<member N>` 语法路径（L279–284）；`DerivedSchema.memberDocs?` 可选键已落（derived.ts:91） | `packages/vfsl/src/resolve-schema-at-path.ts`、`derived.ts` |
| detached 克隆 | 位于 namespace-runtime 组合边界（identity-memo 每读深拷贝），不在 vfsl 包 | `packages/namespace-runtime/src/read-schema-projection.ts:6-7` |

## 2. 逐条裁决（任务要求 vs 决策集）

| # | #308 要求 | 权威依据 | 裁决 |
|---|---|---|---|
| C1 | docs 切片并入 memberDocs 为第三来源 | ADR 0019 §7 原文（后法显式修订 ADR 0016 切片条款：两来源→三来源） | ✅ 一致（授权修订，非冲突） |
| C2 | 选键规则不变（脊柱 ∪ 终点子树后代 ∪ 闭包别名内部）；`<member N>` 天然落在既有规则内 | ADR 0016「投影体」（脊柱/终端子树后代/闭包别名内部）+ §7 同文；代码 want()（L436–445）已按该规则选键，值侧游走已产 `<member N>` 路径 | ✅ 一致 |
| C3 | 合并次序 field → marker → member 末位 | ADR 0019 §7：`docs[k] = [...fieldDocs[k], ...markerDocs[k], ...memberDocs[k]]` | ✅ 一致 |
| C4 | 空条目过滤不变 | ADR 0016 切片纪律 + ADR 0019 §7「空条目过滤不变」；现状代码 L450–456 已过滤 | ✅ 一致 |
| C5 | 投影四件套形状不变（valueSchema/aliases/docs/aliasDocs） | ADR 0016「投影体」；ADR 0019 §7 明示「投影返回形状…不变」；`ReadDataSchemaProjection`（L49–58） | ✅ 一致 |
| C6 | detached 克隆零改动 | ADR 0016「交付纪律」（克隆属 namespace-runtime 边界）+ ADR 0019 §7 同文；克隆器对 docs 表条目泛化深拷贝，新条目随表流过 | ✅ 一致 |
| C7 | AC：`<member N>` 键逐字成员 doc | ADR 0019 §5（「值 = 成员 doc 逐字继承」）+ §7 | ✅ 一致 |
| C8 | AC：marker 成员同时有 M3 doc 时 marker 前、member 后 | ADR 0019 §7（「实际合并 = marker 在前 member 在后」——fieldDocs 在 `<member N>` 键上恒无条目） | ✅ 一致 |
| C9 | AC：不使用 M4 的 schema 投影输出逐字节不变 | ADR 0019 §5 条件稀疏（无成员 doc ⇒ derived 无 memberDocs 键 ⇒ 派生物逐字节不变）+ §9「语义不改」；#306 已按条件稀疏落地 | ✅ 一致 |
| C10 | AC：packages/vfsl 测试（resolve-schema-at-path）+ typecheck 绿 | packages/vfsl/AGENTS.md 验证门槛（聚焦变更跑包级）；公共类型形状不变（四件套不动、memberDocs 可选键已由 #306 落地）→ 根级全量非硬门槛 | ✅ 一致（无门槛缺口） |
| C11 | Blocked by #306 | #306 CLOSED（ci-passed），实现已在本支 | ✅ 前置满足 |
| C12 | Parent：PR #305 | issue-tracker.md Ticket Parent 惯例（同支累积、收官人工合并）；本 worktree 分支持该结构 | ✅ 一致 |

**横向规范面核查（均无冲突）**：CONTEXT.md「语义 schema 投影」词条用「文档注释表的相关切片」表数不可知措辞，四表化后无需改词条；ADR 0008（经 0016 修订后的 D8 封口：derived 只经投影深拷贝进公共面）不受影响；ADR 0003 §3 any-of / §4 ref 按名保留不受影响（memberDocs 是派生顶层表，不进 ValueSchema 节点——别名闭包与终点合成 union 构造性不受扰动，C5 成立的机理）；ADR 0001/0019 §8 纯文档性质保持（成员 doc 只随投影下发，不进校验/物化）；ADR 0004/0005（类型投影/生成管线）属 #307 面非 #308 面；v1-spec §8「语义不改」由 C9 满足。

## 3. 发现项

### F1（低，非阻塞）— ADR 0016 正文未回写修订，票链无人认领该回写

ADR 0019 §7 已显式修订 ADR 0016 docs 切片条款，但 ADR 0016 正文两处仍为旧文：L35–36「fieldDocs/markerDocs 的相关切片」（两来源）与 L42「文档三表」。仓库惯例（docs/AGENTS.md「code behavior changes → update every normative document whose stated contract changed」；ADR 0008 先例：0016/0017/0018 的修订均以 dated 增补节回写 0008 正文）要求被修订 ADR 落增补节。现票链中 #307（codegen 四发射位）、#309（v1-spec §5 + 编写指南 + 「三锚位」措辞清扫）范围均不含 ADR 0016 回写；#308 正文括注「修订 ADR 0016 切片条款」但验收标准只列代码+测试。若 #308 落地而不回写，决策集字面自相矛盾持续到收官。对称问题：ADR 0019 §5 修订 ADR 0003 docs 表条款，ADR 0003 正文（54 行）同样无增补节（0003 正文并无 docs 表条款原文，回写为一句指针即可）。

**裁决**：实质权威无歧义（ADR 0019 后法显式修订，条款级 supersession 成立），不构成阻塞冲突；属文档对齐卫生。**建议**：把「ADR 0016 增补节（切片三来源 + L42 三表→四表措辞）」钉进 #308 交付（其括注已引该修订，最自然归属），或扩 #309 范围至 ADR 正文回写（连同 ADR 0003 指针）。

### F2（低，非阻塞）— 集成支中间态：实现先于规范正文

本支上 #306 已合入而 v1-spec §5 仍述三挂载位（v1-spec.md L405–408：类型别名/对象字段/标记类型；E305 条款 L372）；#308 合入后 ADR 0016 正文与代码亦将同类滞后。该中间态为 #304「交付结构」与 issue-tracker Ticket Parent 惯例的**明示设计**（同支累积、收官人工合并，避免「规格已改、实现未跟」污染 main），#309（blocked by #306+#307+#308）即规范落地票。非 #308 冲突；登记为 PR #305 收官门禁核对项（SA4 #306 审查已将同类项列为 C-5）。

### F3（信息，供 SA1/SA4，非冲突）— 实现一致性注记

1. `resolve-schema-at-path.ts` L104–117 可信域形状守卫**不得**把 `memberDocs` 加入必填键清单——ADR 0019 §5 条件附加：无成员 doc 的模块整键缺席（现状守卫不含该键，保持即可；守卫清单变更反而会破坏 C9 逐字节不变）。
2. 投影 docs 键序对「仅存在于 memberDocs 的键」的插入序未被任何 ADR 冻结（ADR 0016 只冻结键规约文法；代码注释的「表声明序扫描」为实现确定性行为）——SA1 布局自由度，第三遍扫描为自然选择。
3. 合并只在 docs 表层面发生、不触 ValueSchema/别名闭包/终点合成 union——C5「四件套形状不变」与 C6「克隆零改动」构造性成立（克隆器见 `packages/namespace-runtime/src/read-schema-projection.ts`）。

## 4. 结论

- **verdict：clear**。issue #308 的全部要求与既有决策集（ADR 全集 + CONTEXT.md，含 ADR 0019 §5/§7 对 ADR 0003/0016 的显式条款级修订）逐条一致，无阻塞冲突，无需 override，前置门禁放行。
- 冲突点数与分布：**0 阻塞 / 2 低（F1 文档回写缺口、F2 链上中间态，均非实质决策冲突）/ 12 项逐条一致 + 3 项实现注记（F3）**。
- 移交建议：F1 由总控在派发 SA1/SA3 时随票钉 scope（ADR 0016 增补节归属），F2 记入 PR #305 收官清单；两者均不改变本门禁裁决。
