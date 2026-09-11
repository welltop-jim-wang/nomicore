# SA2 设计攻击评审 — issue #308（readData 语义投影 docs 切片并入 memberDocs）

- Dispatch：`sa-ba0b68dd-db14-4681-bc2b-a2cfdcab3a45`（mabf-sa2 / design-review / iteration 1；原位更新 iteration 0 评审，原 dispatch `sa-10ce65aa-c9c9-45a6-9acf-a1b33bcbb098`）
- 审查对象：`wiki/raw/task_issue-308_design.md`（SA1 修订版，dispatch `sa-f9bce8dc-a34a-424e-b5a1-9397cdc5f8af`，iteration 1，原位修订 iteration 0 设计）
- 证据基线：worktree `/home/wangjian/nomicore-fix-issue-308`，分支 `mabf/issue-308`，HEAD `4d4208b`（实测核对）
- 裁决：**approve** —— iteration 0 唯一阻断项 F-SA2-1（D8 的 ADR 0016 修订机制）已按建议选项 (a) 落实并经本轮独立逐项复核（git 史、ADR 原文、SA8/SA6 上游文本、惯例先例全部对得上）；N-1–N-4 全部落实。代码面（D1–D7）锚点复验仍成立。0 BLOCKER / 0 MAJOR / 2 项新的非阻断观察。

---

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-308.md`（Issue #308 body；REST comments `[]`） | 已读 |
| SA1 设计（修订版） | `wiki/raw/task_issue-308_design.md`（iteration 1，含 §14 评审修订映射） | 已读（逐节） |
| SA6 验收契约 | `wiki/raw/task_issue-308_sa6_contract.md`（approve） | 已读 |
| SA8 冲突门禁 | `wiki/raw/task_issue-308_sa8_conflict.md`（clear；F1 原文重点复核） | 已读 |
| SA2 iteration 0 评审 | `wiki/raw/task_issue-308_sa2_review.md`（reject：F-SA2-1 MAJOR + N-1–N-4） | 已读（本文件前身，finding 闭环基准） |
| 源码锚点（复验） | `resolve-schema-at-path.ts`（L48–68/L54/L103–123/L279–284/L436–445/L447–464）、`derived.ts` L68–92、`evaluate.ts` L358–412（键模板 L407）、`read-schema-projection.ts`（L33/L42–59/L100–114/L210–220） | 已读，逐锚点核对 |
| ADR | `0016`（全文 98 行，实测行数）、`0019`（全文，决策 5/7 逐字核对）、`0007`（L62–75 修订节 + 模式句）、`0008`（L36 旧句在场 + 六个增补节结构） | 已读 |
| ADR 修订机制 git 史 | `6155b51`（numstat `13 0` 于 0008，纯新增节）、`2d9dce7`（`64 0`/`22 0`/`33 0` 于 0007/0008/0010，零删除）、以及全库 ADR 历史删除行扫描（`98de4ce`/`f06a384`/`8a0a4d0`/`46f7632`/`1c8b907`/`b155c73`/`5db6f83`/`b551791`/`68b886c`/`d7098ed` 逐个定性，见 §10 与 O-1） | 实测 |
| 消费面 grep | `resolveSchemaAtPath` 全库 grep（生产消费仅 namespace-runtime 一处）、`memberDocs` 于 registry/runtime src（0 命中） | 已做 |
| 配置 | `vitest.config.ts` include（`packages/*/test/**/*.test.ts`）、`packages/vfsl/AGENTS.md`、`packages/namespace-runtime/AGENTS.md`、`docs/AGENTS.md` | 已读 |

固定输入中 `task_issue-308_relevant_decisions.md` 不存在（SA8 冲突报告已内联相关决议），以 SA8 报告 + ADR 原文替代，无事实缺口。

## 2. Verdict

**approve**。iteration 0 的唯一阻断项 F-SA2-1（MAJOR：D8 以不实先例主张对 ADR 0016 正文原位改写）在修订版中按建议选项 (a) 完整落实：D8 改为 append-only dated 增补节、正文原文一字不动，删除了不实先例句并改为 git 实测事实，对 SA8 F1 建议形态与「矛盾持续到收官」引文的转述已按原文语义修正，§1/§6/§9/§11/§12/§13 六处联动同步自洽，且新增「ADR 0016 正文」DENY 禁区行与「diff 仅新增行」机械验收。本轮对上述每一项做了独立复核（不是采信设计自述）：`6155b51` 实测 `+13/0` 纯新增节、0008 正文 L36 旧句至今在场、`2d9dce7` 对 0007 `+64/0` 零删除、0007 L68–69 模式句逐字一致、0008 六个增补节标题/收尾句/放置形态与设计增补节规格同构（含「（日期，issue #N）」标题先例 `### 稳定码注册修订（2026-08-24，issue #93 …）`）。增补节三条款与 ADR 0019 决策 5/7 逐条语义对账无漂移。N-1–N-4 四项 MINOR/观察全部落实（复验见 §6）。代码面 D1–D7 锚点复验仍成立，无状态机/错误恢复/调用面/文件范围/验收设计缺口。剩余 2 项新的非阻断观察（O-1/O-2，见 §14），不构成阻断。

## 3. 需求覆盖

| Requirement | Design section | Assessment |
|---|---|---|
| AC1：联合/枚举路径投影 docs 携带 `<member N>` 逐字成员 doc | §7-D1（三源合并）/§7-D2（选键两腿）/§10（M1–M9、M8a/M8b） | ✅ 覆盖；伪代码与 SA6 §12.2/§12.3 期望逐条推演一致（含 `Mixed.<member 0>` 由 markerDocs 遍发射、内容经 `merged(k)` 得 `[' 载体甲 ',' 成员甲 ']`） |
| AC1：marker 前、member 后 | §7-D1 要点 1、§10 M7 行 | ✅ 单点合并表达式构造性保证；M7 逐字序断言锚定 |
| AC2：不用 M4 的投影输出逐字节不变 | §7-D3、§10（C1/C2/C3 + 无 `<member ` 子串断言） | ✅ 构造性论证成立：键缺席→第三遍整体跳过；`merged(k)` 对无 memberDocs 键等价于现表达式（源码 L447–457 现状复验）；键集/键序/内容不变 |
| AC3：packages/vfsl 测试 + typecheck 绿 | §10 验证命令（6 文件聚焦 run + 包 tsc + 根 typecheck）、§11 | ✅ vitest include `packages/*/test/**/*.test.ts` 本轮复验；满足 packages/vfsl/AGENTS.md 聚焦门槛（根级为超出项，无妨） |
| What-to-build：选键规则不变 | §7-D2 | ✅ `want()`/spine/V/闭包零改动（源码 L436–445 复验）；两腿覆盖论证与 SA6 §9.3 分离对照一致 |
| What-to-build：合并次序 field→marker→member 末位、空过滤不变 | §7-D1 | ✅ 与 ADR 0019 决策 7 原文逐字一致（本轮重读 L134–141 对账） |
| What-to-build：四件套形状不变、detached 克隆零改动 | §8/§11 DENY | ✅ `ReadDataSchemaProjection`（L49–58）不动；`detachReadSchemaProjection`/`cloneDocsRecord`（L106–114/L216–220）泛化深拷贝复验 |
| What-to-build 括注：「修订 ADR 0016 切片条款」 | §7-D8（append-only 增补节）/§11 ALLOW+DENY | ✅ **本轮解除 ⚠️**：机制改为全库一致的 append-only（F-SA2-1 闭环，见 §10/§13 映射） |
| Blocked by #306 已满足 / Parent PR #305 | §6 C11/C12 行 | ✅ HEAD `4d4208b`（#313 合入）实测 |

目标/非目标无静默扩大：深读（§7-D6 显式保持现状）、#307/#309 面显式排除（§1 非目标）。

## 4. Owner评论覆盖

Issue REST `comments: []`（简报与 SA6 §2 双重实测；本轮派发指令亦确认空）。无评论级要求，映射表为空；需求全集 = Issue body，已在 §3 逐条落点。

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA6 §5：16 路径旧实现红、红因全落 docs 合并处 | §3/§5 承接，§10 M1–M9 转写 | ✅ 红因矩阵与源码现状（memberDocs 23 键在场、sliceDocs 只扫两表）一致 |
| SA6 §9.3 两腿选键分离 | §7-D2 | ✅ |
| SA6 §9.4/§9.5 表剥离/合并序对照 | §7-D1/D3 | ✅ |
| SA6 §12.4 冻结摘要（表 1/2/3） | §10 C1/C2/C3/C8 转写 | ✅ |
| SA6 §15.1 深读不冻结 | §7-D6 显式不扩展 | ✅ |
| SA6 §15.2 ADR 0016 增补节同票 | §7-D8/§11 | ✅ **本轮解除 ⚠️**：SA6 §15.2 原文即「dated 增补节（两来源→三来源 + L42 三表→四表措辞）」，与修订后 D8 交付形态一致 |
| SA8 C1–C12 | §6 表逐行 | ✅ 全部落位 |
| SA8 F1（ADR 0016 回写缺口） | §7-D8/§11 ALLOW | ✅ **本轮解除 ⚠️**：设计转述「F1 建议的交付形态就是『ADR 0016 增补节（切片三来源 + L42 三表→四表措辞）』」「『矛盾持续到收官』指完全不回写路径」——与 SA8 F1 原文（L47「把『ADR 0016 增补节…』钉进 #308 交付」；L45「若 #308 落地而不回写，决策集字面自相矛盾持续到收官」）逐句对账一致，iteration 0 指出的两处误读已消除 |
| SA8 F2（集成支中间态） | §1 非目标/§12 残余 2 | ✅ 登记 #309，不扩 scope |
| SA8 F3.1 守卫不得加必填键 | §7-D4/§11 DENY | ✅ 必填清单（L106–115 六键）不动；剥离克隆照常解析（C6） |
| SA8 F3.2 键序自由度 | §7-D5 | ✅ 第三遍扫描 = 与既有两遍同构 |
| SA8 F3.3 合并只在 docs 表层面 | §7-D1/D2 | ✅ 改动局限 sliceDocs |
| ADR 0019 §5/§7 条款原文 | §7-D1/D8 转写 | ✅ 合并表达式、条件稀疏、「fieldDocs 在 `<member N>` 键上恒无条目」措辞逐字一致；增补节条款 2 引「决策 5」、条款 3 引「决策 7」的编号经 ADR 0019 原文核对正确（§5=决策 5、§7=决策 7） |

## 6. 设计内部一致性

| 检查项 | 结果 |
|---|---|
| D8 联动一致性 | ✅ §1 目标 4、§6 F1 行、§7-D8、§9 回滚句、§11 ALLOW（ADR 0016 行）+ 新增 DENY（ADR 0016 正文 L1–98）、§12 F1 行、§13 R4/R5 七处对 ADR 0016 交付物的描述全部为「末尾追加 dated 增补节 + 正文零改动 + diff 纯新增」，无残留的原位改写措辞 |
| 增补节规格自包含性与惯例同构 | ✅ 节题「### ADR 0019 修订：…（2026-09-11，issue #308）」与 0008 先例「### ADR 0016 修订：…（2026-09-09）」「### 稳定码注册修订（2026-08-24，issue #93 …）」同款；授权链段 + 编号条款「旧文 → 新文」+「除下列明示条款外，正文其余条款维持原文效力」保持句与 0007 #237 节（L64–69）/0008 各节同构 |
| 增补节条款 vs 被修订正文 | ✅ 条款 1 旧文 = ADR 0016 L35 注释原文；条款 2 旧文 = L42「文档三表」原句（截断于冒号前，引文式截断与 0008 先例一致）；三处旧措辞（L35–36/L42/L84）经全文重读确认无第四处遗漏（L84 经保持句显式处理） |
| 行号锚点抽验（复验） | ✅ L448–457（两遍循环体，L447 为 `const docs` 声明行——N-3 修订后准确）、L436–445（want）、L279–284（union 成员展开）、L103–123（守卫）、L54（接口注释）、derived.ts L84–91、evaluate.ts L363–369/L401–409（键模板 L407 `` `${path}.<member ${i}>` ``——N-2 修订后闭合尖括号正确）、read-schema-projection.ts L33/L54–58/L106–114/L216–220 全部命中 |
| 死引用/旧 API | 无；`InternalError` 复用 `./resolve.js` 既有导入属实 |
| 前后相反描述 | 无；iteration 0 的「三处自洽但机制错」问题随机制更换消失 |
| 只在附录承认未改正文 | 无；§14 修订映射与正文实际内容逐条对得上（F-SA2-1 五点、N-1/N-2/N-3/N-4 落点全部实测存在） |
| 「唯一生产消费者」声明（复验） | ✅ 全库 grep：`resolveSchemaAtPath` 生产消费仅 read-schema-projection.ts 一处（L33 导入/L56 调用）；index.ts L125 为导出面；validate-patch.ts 为反向被引用（注释提及） |

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| S1 | M4-free derived（无 memberDocs 键） | 任意读路径 | 输出与旧实现逐字节相同 | 无（D3 构造性论证 + C1/C2/C3 冻结） | — |
| S2 | derived 含 memberDocs 表 | 读联合/枚举路径（两腿任一） | docs 新增 `<member N>` 键、内容三源拼接 | 无（D1/D2 推演与 SA6 §12.2 逐条一致） | — |
| S3 | 手造 derived：memberDocs 键在场但 null/数组/非对象 | 任意可解析路径 | `InternalError`（不泄漏裸 TypeError） | 无（D4 守卫谓词覆盖 null/非 object/Array 三形，伪代码复核正确——`typeof null === 'object'` 故显式 null 分支必要且在场） | — |
| S4 | 手造 derived：memberDocs 在场畸形 + 路径解析失败 | 不可解析路径 | 两码结果联合（不额外 throw） | 无（**N-4 已闭环**：D4「守卫位置」段明确偏好守卫留在 `sliceDocs` 内——解析失败时 `sliceDocs` 不被调用，故结果为两码联合；与源码结构一致：`sliceDocs` 仅在 ok 路径调用） | — |
| S5 | 同输入重复调用/并发调用 | — | 逐字节确定 | 无（零 memo、正则缓存调用局部 L126；SA6 §7 实测） | — |
| S6 | C4 场景：`memberDocs['U.<member 0>']=[]` | 读 `['u']` | 空合并不得成键 | 无（第三遍 `content.length > 0` 过滤推演成立） | — |
| S7 | C5 场景：`memberDocs={'Unrelated.<member 0>':[…]}` | 契约路径全集 | 不泄漏 | 无（want() 整段 `===`/`startsWith(anchor+'.')` 判据核对） | — |
| S8 | 实现票顺手原位改写 ADR 0016 正文（破坏 append-only） | 文档交付 | 必须被验收拦下 | 无（§12 F1 行「git diff 仅新增行」机械可验 + §11 DENY 禁区行 + §13 R4 风险登记） | — |

无状态机面（纯函数、同步、零持久化）——设计 §8/§9 的「无状态机」声明与源码事实一致。

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E1 | memberDocs 在场但表级畸形 | D4：throw `InternalError`（窄 loud，不加必填清单） | 低——与 L104–105「不泄漏裸 TypeError」承诺、packages/vfsl/AGENTS.md 可信域例外句、evaluate 侧 `guardMemberDocs` 同族；生产不可达（derived 恒为 evaluate ok 产物） | — |
| E2 | memberDocs 条目级畸形（如条目为字符串） | 条目级照旧信任（D4 要点 4）——与 fieldDocs/markerDocs 条目同信任级（现状同姿势）；登记为 follow-up 4 | 诚实登记，非伪降级 | — |
| E3 | 静默 fallback 伪装成功 | 无：键缺席是合法形状（规格行为），非降级；正常路径不变量由 M/C 用例锚定 | — | — |
| E4 | 回滚残留 | 单文件 revert + 三测试文件删除 + ADR 0016 增补节 revert（纯新增节，删除即还原，无正文残留）；ADR 0016 文件末尾以换行结束（实测），追加/删除均为纯新增/纯删除 diff | — | — |
| E5 | InternalError 逃逸通道类别漂移 | D4 复用既有通道，read-schema-projection.ts 零 catch 结构不动（L54–58 复验） | — | — |

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `resolveSchemaAtPath` 返回 `docs`（ok 分支内容增量） | 无遗漏：唯一直接调用方 `projectReadDataSchema` 整体深拷贝透传（L54–58）；`NamespaceRuntime.readData` 透传；registry/typed-access 无 M4 输入（本轮 grep `memberDocs` 于两包 src 0 命中）；validate/validate-patch 不读 docs 表（ADR 0019 决策 8）；codegen 发射位属 #307 | 全库 grep + 源码复验 | — |
| `ReadDataSchemaProjection` 四件套/两枚失败码/`index.ts` 导出 | 零变化（§8）；test-d 类型面不涉内容 | resolve-schema-at-path.ts L48–68、index.ts L125 | — |
| 既有测试不变量（resolve-schema-at-path.test.ts L449–485 族） | 无：M4-free 夹具实现后前提不变仍绿；C9 禁改 | 测试源码 + 夹具核对（iteration 0） | — |
| ADR 0016 文档契约面（新增：本轮重点） | 无：增补节为纯新增登记，不改任何被引用条款的语义指向；「哪段文字在效力」判定方式与全库惯例一致（读 dated 节条款清单） | ADR 0016 全文 + git 史复验 | — |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| docs 三源切片 | vfsl resolver（`sliceDocs`，投影消费面 Owner） | `sliceDocs` 第三遍 | ✅ 落在事实 Owner；ADR 0019 决策 7 实现改动面明列点（Consequences L190 复验） |
| 表收集 | evaluate（#306 已落） | 不动 | ✅ |
| detached 深拷贝 | namespace-runtime 组合边界 | 不动（DENY） | ✅ |
| ADR 0016 条款回写 | append-only dated 增补节（全库条款级修订惯例） | §7-D8 | ✅ **本轮解除 ❌**：机制与惯例一致（iteration 0 F-SA2-1 闭环） |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| docs 表切片合并 | `sliceDocs` 两遍扫描 + 去重并入（L447–457） | 追加同构第三遍 + 单点 `merged()` 闭包 | 一致 | 同函数内同构扩展；`merged()` 消除重复合并表达式的漂移面 |
| 可信域 loud 守卫 | 六键在场检查（L106–115）+ evaluate `guardMemberDocs`（条件键在场才校验，L363–369） | D4：条件键在场且非 record → InternalError | 一致 | 与 evaluate 侧「缺席合法、在场才校验」口径同族 |
| **ADR 条款级修订记录** | 全库条款级修订均为 dated 增补节登记（git 实测：`6155b51` 对 0008 `+13/0`、`2d9dce7` 对 0007 `+64/0`/0008 `+22/0`/0010 `+33/0`、`d7098ed`/`46f7632`/`8a0a4d0` 等增补节全部纯新增）；0007 L68–69 模式句「owner 授权 + 显式修订节……除下列明示条款外，正文其余条款维持原文效力」；0008 各增补节同款保持句（#93/0017/0018 节实测含「除下列明示条款外，正文其余条款维持…」） | **D8（修订后）：仅在 ADR 0016 末尾追加 dated 增补节，条款改写逐条「旧文 → 新文」登记于节内，正文原文一字不动；diff 纯新增** | **一致** | 与最直接先例（ADR 0016 自己经 `6155b51` 修订 0008 D8 封口句的形态）完全同构；节题/授权链/保持句三要素齐备。SA2 F-SA2-1 建议选项 (a) 已完整采纳 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 成员 doc | derived.memberDocs 表（evaluate 产物） | 每次读现算的 docs 切片 | 无（零缓存、逐调用新鲜数组） |
| 选键/合并规则 | sliceDocs 单点（want()/merged()） | — | 无（D1 单点闭包消除三份复制风险） |
| ADR 0016 条款效力 | 正文 + dated 修订节条款清单（惯例统一判定方式） | — | 无（D8 明示不引入第二种判定方式） |

### 生命周期对称性

无 register/dispose、无后台任务、无订阅（纯函数）。不适用；§9 的回滚叙事与「无持久化残留」属实（增补节为纯新增，删除即还原）。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 第二套合并/过滤逻辑 | sliceDocs 现有两遍 | 并入同一 `merged()` 单点 | 无平行机制 ✅ |
| 新公共符号/导出 | index.ts 现有面 | 零新增 | ✅ |
| 新测试通道 | vitest include `packages/*/test/**/*.test.ts` | 三份新文件落 `packages/vfsl/test/` | ✅ 复用真实 runner 入口（include 本轮复验） |
| 第二种 ADR 修订风格 | append-only dated 增补节 | 同一机制（不再主张原位改写） | ✅ iteration 0 的 drift 风险消除 |

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW：`resolve-schema-at-path.ts` + ADR 0016 + 三份新测试文件 | 全部有 Issue/SA6/SA8 依据；ADR 0016 由 Issue 括注点名；ALLOW 行的 ADR 0016 描述已改为「末尾追加 dated 修订节…正文零改动…纯新增行」 | ✅ 无理由扩张 |
| **新增 DENY：ADR 0016 正文（L1–98 既有内容，含 L35–36/L42/L84 旧措辞）** | 文件实测 98 行；禁区行把 append-only 从机制描述升级为可检查的文件级约束 | ✅ 与正文一致、强化验收 |
| DENY 与正文冲突 | 无：正文未提议触碰任何 DENY 项（derived/管线/守卫必填清单/namespace-runtime/既有测试/index/codegen/v1-spec/CONTEXT/0019/0003/ADR 0016 正文） | ✅ |
| ADR 0003 指针回写不属本票 | Issue 括注只点名 ADR 0016；SA8 F1 的 #309 选项才连带 0003 指针；设计 §12 残余 1 显式移交 Controller 钉给 #309（或 #306 收尾） | ✅ 非掩盖（有显式路由） |
| follow-up 是否掩必要项 | 深读（SA6 明示不冻结）、fieldDocs mistype 存量加固（先于本票存在；git 史显示 `8a0a4d0` 类术语同步亦属独立变更）、规模（近线性实测） | ✅ 均非本票必要项 |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1（M1–M9） | 红契约逐字期望 + 前提断言，经公共入口 `parseVfsl→evaluate→resolveSchemaAtPath` | 无：断言观察行为而非源码文本；旧实现红由 SA6 §5/§13 实测背书 | — |
| AC1 合并序/选键/倾倒/泄漏（M7、腿分离、C4/C5） | §10 行行对应 SA6 敏感度矩阵 | 无 | — |
| AC2（C1/C2/C3/C8） | sha256 冻结摘要逐路径 + M4-free 面无 `<member ` 子串断言 | 无 | — |
| F3.1/F3.3（C6/C8） | 剥离克隆 ok:true；非 docs 摘要冻结 | 无 | — |
| 形状/确定性（C7） | 恰 5 键、两次调用全等、JSON 往返 | 无 | — |
| 存量回归（C9） | 既有测试零改动原样跑 | 无 | — |
| D4 守卫 | 可选辅助断言（`memberDocs: null` → InternalError），明示不得替代 M/C 用例；守卫位置偏好已定（sliceDocs 内） | 无 | — |
| **F1 文档交付（本轮重点）** | 增补节三条款与 ADR 0019 决策 5/7 逐条语义一致；权威指针正确；保持句含「考虑的备选为历史记录」；**`git diff` 对 ADR 0016 仅新增行（机械可验）**；`git diff --check` 干净 | 无：验收口径已从「原位修订 + 正文自洽」改为 append-only 机械判据，可执行且与 docs/AGENTS.md 验证义务（`git diff --check`）对齐 | — |
| 测试入口真实性 | 三份新文件落 `packages/vfsl/test/`，vitest include 必然收集（fixture 非 `.test.ts` 不收集、由包 tsconfig 覆盖） | 无（include 本轮复验） | — |

## 13. Required revisions

无。iteration 0 finding 闭环记录（保留稳定 ID 用于修订映射）：

| Finding ID | Severity（iter 0） | Resolution（iter 1 复验） | Status |
|---|---|---|---|
| F-SA2-1 | MAJOR | 设计 §7-D8 全节重写为 append-only（选项 a）：①不实先例句已删，证据改为 git 实测事实（本轮逐项复核 `6155b51 +13/0`、0008 L36 旧句在场、`2d9dce7` 零删除、0007 L68–69 模式句）；②增补节为 ADR 0016 唯一交付物、正文不动、DENY 新增正文禁区、§12 F1 机械验收「仅新增行」；③SA8 F1 转述按原文语义修正（本轮与 SA8 原文逐句对账一致）；④原位修订改记为否决备选①并如实注明选项 b 前提；⑤七处联动描述一致。接受条件「设计文本中不再存在与 git 史相悖的先例主张；D8/§6/§11/§12 描述与所选机制一致；对 SA8 F1 引用与原文语义一致」全部满足 | **已解决（闭环）** |
| N-1 | MINOR（并入 F-SA2-1 验收） | append-only 下 L84 随全文保留；增补节保持句显式声明「考虑的备选为决策时历史记录」——实测存在于增补节规格授权链段 | 已解决 |
| N-2 | MINOR | §2 键模板已闭合尖括号 `` `${path}.<member ${i}>` ``（evaluate.ts L407 为准，复验一致） | 已解决 |
| N-3 | MINOR | 锚点统一 L448–457 并注明 L447 为声明行（源码复验一致） | 已解决 |
| N-4 | MINOR | D4「守卫位置（设计偏好）」段明确偏好 sliceDocs 内放置，函数头放法降为实现自由度；硬性要求不变 | 已解决 |

## 14. Non-blocking observations

1. **O-1（惯例表述的适用范围注记）**：设计 §7-D8 的「全库条款级修订均为 append-only……正文原文保留」就**条款级决策修订**而言经本轮 git 全史扫描成立（所有 dated 增补节均纯新增）。但历史存在少量**非条款级**的正文原位编辑：接受前草稿期重写（`98de4ce`/`f06a384`，状态为 proposed）、术语/命名同步（`8a0a4d0` `__schema__`→`SCHEMA`——同时追加了「### 命名修订（2026-08-21，owner 决策）」节；`b155c73` `mutateRoot`→`mutateData`）、早期正文改写后被追认（`1c8b907`，在 0007 #237 节登记为「先行修订」）、协议权威改写（`b551791`/`68b886c` 于 0010）。这些不构成对设计机制的否定——反而确认「决策文本变化必附 dated 登记节」的惯例，且设计选择的 append-only 是观测谱系中最保守的一端——但「正文原文保留」不宜在未来被引为无例外的绝对不变式。无需修订本设计；留档供后续任务引证时把握措辞精度。
2. **O-2（增补节标题的 outline 归属）**：追加的 `###` 节在 markdown 大纲上会挂于 ADR 0016 末节「## 取代关系」之下（该文件以 `## 取代关系` 收尾，实测 98 行）。这与 0008 的增补节链挂在末个 `##` 节之下的既有形态一致，属仓库既有放置惯例的自然结果，无需处理；仅提示读者按「文件末尾 dated 节」而非大纲层级定位修订记录。

---

## 附：裁决理由摘要

- 文档面（iteration 0 唯一阻断项）：**F-SA2-1 已闭环**——修订版采纳建议选项 (a)，全部接受条件经独立复核满足（git 史、ADR 原文、SA8/SA6 上游文本、惯例先例四线证据一致）；对 SA8 F1 的两处误读已消除。
- 代码面（D1–D7、§8–§12）：锚点复验全部成立——伪代码与现源码结构同构、与 SA6 契约期望逐条推演一致、M4-free 逐字节不变有构造性论证、调用面无遗漏（grep 复验）、文件范围无扩张且新增 ADR 0016 正文禁区、验收映射完整且入口真实、F1 文档验收改为机械可验的「仅新增行」。
- `requiresConflictRecheck: false`：修订后的 D8 相比 iteration 0 的原位改写**收窄**了决策记录触碰面（正文不动、纯新增节），登记的是 SA8 前置门禁已裁决 clear 的 ADR 0019 §7 条款级 supersession，不新增决策触碰面，无新 ADR 冲突风险。
