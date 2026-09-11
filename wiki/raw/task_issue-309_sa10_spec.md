# SA10 Spec 符合性审查 — issue #309（v1-spec §5 与编写指南落地 M4 挂载锚位）

- Dispatch：`sa-673fe44d-c176-4850-8539-c8e3876693a5`（mabf-sa10 / spec-review / iteration 0）
- 被审对象：**已提交交付 commit `21c6aaaec672864aaa8630bdf3ea1f92a0d47521`**（`docs(vfsl): document four mount anchors`），其父 = Parent PR #305 权威 head `bbb93fbda3100b2da2a007a228af777cdc56d282`（#306/#307/#308 已合入）。
- 审查口径：独立 spec 符合性——只判断交付是否忠实满足 Issue 正文、适用 Owner 评论与验收标准，是否存在遗漏/部分实现/错误实现/scope creep，并登记 PR 必须披露的未达成项。不审通用架构风格（SA9 职责）；本轮未修改任何代码/设计/测试，未运行测试或服务（动态证据引自 SA7 报告值并标注；静态面全部本轮独立实测）。
- Issue #309 REST 评论：**无**（dispatch 前提「successful empty response」，与 SA6/SA8/设计/SA4 多方实测一致）——**无 owner-comment 要求**。需求全集 = Issue 正文（What to build + AC1–AC4）+ ADR 0019 Consequences + #306 预登记 O-3。

## 1. Verdict

**approve** —— 四条 AC 与 What-to-build 全部在接受的契约（SA6 §12 + 设计 §7 D1–D10，经 SA2 approve、SA8 三轮 clear 裁决）口径下达成；本轮对交付 commit 的独立静态复核（diff 逐 hunk、needle/配对/块数/逐字节比对、措辞残留扫描、注释-only 核对）与 SA3/SA4/SA7/SA8 证据链一致，未发现遗漏、部分实现、错误实现或未登记的 scope creep。PR 必须披露的口径裁定与范围外事项见 §5（无关键 AC partial/unmet；均为已裁决登记项或 MINOR）。

## 2. Reviewed inputs

| 输入 | 状态 | 本轮用途 |
|---|---|---|
| `wiki/raw/task_issue-309.md`（Host brief） | 存在（随交付 commit 入库） | Issue 正文 + AC1–AC4；Comments 空 |
| `docs/adr/0019-vfsl-union-member-docs.md`（accepted） | 存在 | 决策 1/2/3/6/9 与 Consequences（文档随实现 PR 落地义务） |
| `wiki/raw/task_issue-309_sa6_contract.md` | 存在 | 接受的验收契约：§12.1 冻结观察、§12.2 Suite D、§12.4 检查器同步、§12.8 边界裁定 |
| `wiki/raw/task_issue-309_design.md`（iteration 2） | 存在 | 冻结目标文本 D2/D5–D10、ALLOW/DENY、§15 复查清单 |
| `wiki/raw/task_issue-309_sa3_impl.md` / `_sa4_review.md`（approve）/ `_sa7_report.md`（approve）/ `_implementation_conflict_report.md`（SA8 iteration 3，clear） | 存在 | 上游实现/审查/验证/冲突复查证据链 |
| 交付 diff（`bbb93fb..21c6aaa`） | 本轮主审对象 | 26 文件：15 个 ALLOW 实现面文件 + 11 个本票 wiki 产物（新增入库） |

## 3. 需求逐条符合性判定

### 3.1 What to build（Issue 正文）

| 要求 | 交付证据（本轮独立实测） | 判 |
|---|---|---|
| v1-spec §5 挂载规则修订为四类锚位 | §5（L405-432）：「四类锚位：类型别名/属性/标记类型/联合成员（ADR-0019）」+ M4 子规则六条 + 单行/混合布局句 | ✅ |
| M4 子规则五要素（`\|` 锚位、首成员起点、连续同挂、坍缩维持 E305、夹缝与 M3 优先不对称注明） | 子规则 1-6 逐条在场：前导 `\|` 锚 / 首成员起始记号 / 连续同挂 / 坍缩两形态维持 E305「与既有行为逐字节一致（不升格挂别名节点）」/ 夹缝非标记 E305 + 标记成员挂 M3 / 标记优先不双挂 + 夹缝叠写不对称「显式注明」 | ✅ |
| 挂载示例补联合成员样本 | §5 首个 `vfsl` 围栏块（L449-460，多行前导 `\|` 布局，3 个成员 doc）+ `memberDocs`/发射位界线段（ADR-0019 决策 6 四发射位 + 两例外） | ✅ |
| 指南第 7/8 节补逐成员 doc 写法与示例 | §7：旧裸 Asset 块**原位整体替换**（块数 1→1，SA2-1 判词兑现；本轮独立清点 §7 `vfsl` 块 = 1，doc-`\|` 配对 = 2）+ 新写法句；§8：块内 Status 声明替换为逐字面量 doc（配对 = 2，块自带 ROOT）+ 写法句 | ✅ |
| 检查表同步 | 提交前检查表新增 M4 条目（联合/枚举 × 成员 × 文档注释 + 夹缝/坍缩 E305 提示；本轮命中 D4 谓词 = 1 条） | ✅ |
| 源码与测试注释「三锚位」清扫为四锚位 | D10 表 14 处逐处落地（本轮逐 hunk 比对吻合）；独立扫描 tracked − `wiki/` − `dist/` = **0 命中** | ✅ |
| 规格随实现同支累积 | 交付 commit 父 = PR #305 head（含 #306/#307/#308 实现），规范与实现同支 | ✅ |

### 3.2 验收标准（AC1–AC4）

| AC | 判定 | 证据 |
|---|---|---|
| **AC1** §5 挂载规则、边界行为与实现逐条一致（含 E305 既有场景不变的明确表述） | **met** | ① 每条行为性陈述锚定 SA6 §12.1 冻结观察（A1-A4/B1-B4/C1/C3/C5），SA7 探针在交付态逐字/逐位复现（含坍缩 E305@(2,10)×2、夹缝 E305@(2,16)/(4,5)、M3 优先不双挂、无 M4 惰性）；② 「既有场景不变」显式表述在场（L420-421/L423）；③ 机器契约：D1 20 needle 本轮实测 20/20 命中、G17 九元组 9/9、G10 13 项 13/13；④ E305 消息行（`semantic.ts:76` 四类枚举）零改动、前缀冻结段零 diff |
| **AC2** 指南枚举/联合示例使用逐成员 doc，检查表覆盖 M4 | **met** | §7/§8 示例均带逐成员 doc（自跟随核对：doc 原文去 `/**`/`*/` 逐字 = `Asset.<member 0/1>`、`Status.<member 0/1>` 实测在场，SA7 动态验证）；检查表 M4 条目在场；L212 挂载目标句四类化（「必须紧邻」全指南唯一命中） |
| **AC3** 全仓「三锚位」措辞无残留（dist 产物除外） | **met（按裁定作用域）** | tracked − `wiki/**` − `dist/**` 本轮独立扫描 0 命中（与 Suite D D5① 同判）。**作用域经设计 D1 + SA8 Required action 1 显式裁定**（wiki/raw 为历史证据，docs/AGENTS.md Authority L5；字面全域读法需 Owner 评论授权，而评论为空）——属必须披露项，见 §5-1 |
| **AC4** `git diff --check` 干净 | **met** | 本轮实测 `git diff bbb93fb..21c6aaa --check` exit 0 无输出；工作树干净 |

### 3.3 规范级与上游义务

| 义务 | 落实 | 判 |
|---|---|---|
| ADR 0019 Consequences（v1-spec §5 修订 + 指南 §7/§8 与检查表随实现 PR 落地） | §5/指南/检查表/exemplar/CONTEXT 同 commit 落地 | ✅ |
| #306 O-3（修订 §5 必须同支更新检查器与指南） | 检查器四处（docstring 四类化 + M4 契约句 / G10 need 12→13 / 新增 G17 九元组 / G16 `AssetsDoc→ROOT`）+ exemplar 三件套（§4 四类 bullet + M4 摘要 bullet 命中 G17 9 元组 + 附录 fixture = §10 逐字节副本——本轮独立比对 `True`） | ✅ |
| docs/AGENTS.md L9（术语变更登记 CONTEXT.md） | 「挂载锚位（mount anchor）」恰一条新增（+4 行，含发射位/界线限定与 _Avoid_ 行，不含旧措辞字样） | ✅ |
| docs/AGENTS.md L13（文档不得虚构实现行为） | 全部行为性陈述有 SA6 冻结观察 + SA7 运行时实测支撑；落地文本无「§7.3」悬空引用（本轮 0 命中） | ✅ |
| SA2-1 验收判词（§7 块 1→1 替换、D3 逐块谓词不弱化） | §7 恰 1 块、配对恰 2；落地测试 `blocks.length === 1` 机器化 + 逐块配对 ≥2，未弱化为按节聚合 | ✅ |
| SA8 冻结面 | 金样本常量 L33-36 逐字未动（本轮实读）；src 三文件注释-only（本轮核对：非注释改动行数 = 0，parser/ir 去注释逐字节相等，semantic 唯一差异行为块注释续行）；codegen/`domains/*/generated.ts` 零 diff；ADR 0019 仅 L60 一行；wiki tracked 历史文件零改写 | ✅ |

### 3.4 动态验证状态（引自 SA7 报告值，本轮不重跑）

SA7 在交付态实测：Suite D 7/7 绿；检查器双入口 22/22 GREEN ×2（G10 13 项 / G17 9 元组 / G16 ROOT）；Suite C 4 files/68 tests 绿；整仓 `pnpm test` 319 files/3383 tests 绿、Type Errors 无；`pnpm typecheck` / `pnpm generate --check` exit 0 且生成物零 diff；新测试文件经 vitest include / CI 分片磁盘枚举 / 整仓运行三重证实被收集。本轮静态面（needle、配对、块数、fixture 逐字节、措辞扫描、注释-only、diff 卫生）独立复核全部吻合，无下调事由。

## 4. 范围符合性与 scope creep 审查

交付 diff = 设计 ALLOW 15 项全部落地 + 本票 wiki 产物入库（11 个新增文件，与仓内 task_191/task_228 等历史产物同例）；DENY 面逐项零触碰（本轮扫描确认：codegen、`domains/*/generated.ts`、`domains/*/schema.vfsl`、其余 ADR、`.github/**`、package.json scripts、README/REPORT 均无改动）。超出四条 AC 字面的改动共三项，**均经契约链显式裁决登记，不构成未授权 scope creep**：

1. **G16 陈旧期望 `AssetsDoc→ROOT` 同票修复**（SA6 §11.5 预存在红的推荐处置；设计 D3；SA8 Required action 3）——修复后检查器双入口 22/22 可直接作判据；一行期望 + 消息同步，不弱化 G1-G15。
2. **CONTEXT.md 术语新增**（docs/AGENTS.md L9 强制义务；SA8 Required action 4）。
3. **新增 Suite D 契约测试**（SA6 §12.2 / 设计 G6 的主判据机器化，CI-wired）。

## 5. PR 必须披露项（未达成 / 口径裁定 / 范围外登记）

1. **AC3 作用域裁定（必须披露）**：AC3 字面为「全仓…（dist 产物除外）」，落地按裁定作用域 **tracked − `wiki/**` − `dist/**`** 清零（0 命中）；`wiki/**` 内 25 个历史证据追踪文件与本票自身 SA 产物合法保留旧词（docs/AGENTS.md Authority L5：wiki/raw 是证据非规范；改写 = 伪造审计轨迹）。字面全域读法需 Owner 评论授权（REST 评论为空，不存在授权来源），设计 D1 已显式记录该裁定。两读法的可验证差异仅 wiki 文件；D1–D4/G10/G17/AC1/AC2/AC4 不受影响。
2. **G16 修复同票进行**（见 §4-1）：超出 AC 字面的检查器维护项，PR 说明中应显式列出。
3. **指南 §6 内联示例未改动**：§6 值约束示例块含单行枚举 `type Status = "draft" | "published";`（无逐成员 doc）。Issue 正文将 AC2 范围限定为「第 7/8 节」，SA2 N8 已登记维持；PR 宜注明 §6 不在本票范围。
4. **历史悬空「§7.3」引用未清扫**（登记项，设计 §13 follow-up 4）：`docs/adr/0019:64` 与 `packages/vfsl/src/parser.ts:347` 的既有引用保持原样（ADR 登记修订路径冻结为仅 L60；该行不在 AC3 清单）；坍缩规则的规范表述自本票起以 v1-spec §5 自含陈述为权威。是否清扫由 Owner 另立文档卫生票裁决。
5. **Follow-up 未做（AC 未要求，登记沿用）**：B4 规格检查器接入 CI/package scripts（当前唯一引用在 exemplar 头注）；`.github/ci/test-durations.json` 未含新测试文件权重（分片器按全表平均装箱，功能正常）。
6. **MINOR 观察（不阻断，沿用 SA4 §12）**：新测试注释 L81/L86 含 U+200B 不可见字符（JSDoc 内嵌 `*/` 用途，功能无害）；指南 §7 双冒号引导句阅读节奏；D3b 取「必须紧邻」首现索引（失败形态仍为 loud 红）；D1/G17 为 presence 合取（与 SA6 冻结谓词同族）。

## 6. 时序义务状态

SA8 Required action 5 / 设计 §13：#309 须在 PR #305 收官合并前落地。交付 commit `21c6aaa` 已以 PR #305 head 为父完成提交——同支累积义务已兑现；最终合并次序属总控/Owner 裁决，非本票交付缺陷。

## 7. 结论

交付 commit `21c6aaaec672864aaa8630bdf3ea1f92a0d47521` 忠实满足 Issue #309 正文与 AC1–AC4（在接受的契约与裁定口径下），无遗漏、无部分实现、无错误实现、无未登记 scope creep；全部冻结面守住；§5 披露的六项均为已裁决登记项或 MINOR。**verdict = approve**。
