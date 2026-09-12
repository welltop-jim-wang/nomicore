# SA8 冲突门禁报告 — issue #244（设计修订复审：SA4-2 收口复核）

- **dispatch**: `sa-3e3b2db8-9e37-4299-ab3d-58eec853e4cb`（mabf-sa8 / conflict-gate / iteration 2）
- **审查对象**: SA1 修订设计 `wiki/raw/task_issue-244_design.md`（iteration 1，dispatch `sa-ce873f16…`，507 行全文核读）——SA4-2（MAJOR：跨字段链生效口径）收口裁决 + SA4-1（BLOCKER）伪码保真同步；SA1 自判 `requiresConflictRecheck=true`（§15 一项窄复查：§7-D1 对 ADR 0013 L71 配置表约束列的执行口径解释）
- **门禁类型**: 设计修订复审（窄域：修订面 = 链生效口径 + 槽位伪码保真；其余面沿用两轮既有 clear 判定，不重复审查）
- **输入**: 任务简报 `wiki/raw/task_issue-244.md`（AC1–AC7）；`wiki/raw/task_issue-244_dispatch.md`（REST `[]`——零 owner 要求，与 dispatch 声明一致）；SA6 已批准契约 `wiki/raw/task_issue-244_sa6_contract.md` + 契约测试 `packages/ws-replication/test/ws-replication-issue244-ac-red.test.ts`（fixture/R1a/R1b/N1 及 `bootSingle` 默认路径实读）；SA2 评审 `wiki/raw/task_issue-244_sa2_review.md`（approve；W1/W2 + R11–R14 裁决）；SA4 评审 `wiki/raw/task_issue-244_sa4_review.md`（reject；SA4-1 已闭环、SA4-2 本轮收口）；SA3 报告 + `artifacts/sa3-issue244-iter1-verify.log`（契约 11/11、REG 3/3、全包 62/448、根 300/3211、tsc 0 实测在册）；两轮 SA8 既有报告（前置 clear R7–R10 / 设计后 clear R11–R14）；ADR 0013/0010、协议 §17/§9.4/§13.2 现行文；现行源码锚点逐点实测（§2–§5）
- **裁决**: **通过（clear）——0 阻塞冲突 / 0 轻微冲突 / 5 条非阻塞就绪注意项（R15–R19）**；实现轮（门放宽 ★ 行 + 契约补例 + §17 二轮注记）按已路由口径执行，不需要新的冲突复查

## 1. 冲突基准与效力判定

基准 = `CONTEXT.md` + `docs/adr/` 全集（14 篇，无 superseded——与前两轮扫描一致）。ADR 0013 仍为现行约束（R9 条件项维持：状态「提议」、父 PR #241 OPEN，无方向性返工迹象——条件性复审未触发）。本轮设计零 ADR 触改（DENY LIST 含 `docs/adr/**`，SA4 §5 文件范围审查核实 iteration 0/1 零触碰）。`docs/AGENTS.md` 权威性纪律（ADR = 已接受决策；`wiki/raw/` = 证据非规范）与本轮取材一致。

## 2. 核心裁决：ADR 0013 L69–76 配置表「约束列」的执行口径解释（SA1 §15 提请）

**ADR 冻结面**（逐字核对）：四配置名/缺省（4 MiB / 64 / 4 / 30_000）、约束关系（链①`maxChunkedUpdateBytes ≤ maxQueuedUpdateBytes`、链②`≤ maxChunksPerUpdate × maxUpdateBytes`、两键 ≥1、timeout 有限正整数）、L67「新增配置均有安全缺省、启动期响亮验证、绝不运行时 clamp」。

**ADR 未冻结面**：链校验对「调用方 Partial 表达 vs 合并结果」的**激活条件**——ADR 全文无任何 Partial/显式性/合并语义表述（该 ADR 写于「新键缺省 × 存量 legacy 下调」交互在实现期显形之前）。与前两轮口径一致（容器列未冻结 → SA1 裁决权；校验落点未冻结 → 模块位置自由），**执行触发面同属未冻结的实现语义**。

**修订口径四性质核验**（全部实测支撑）：

1. **缺省自洽**：4 MiB ≤ 4 MiB ∧ 4 MiB ≤ 64×512 KiB=32 MiB（`defaults.ts:16-48` 实测）——约束列被缺省构型满足。
2. **表达即受约束**：两激活键（`maxChunkedUpdateBytes ∨ maxChunksPerUpdate`）任一显式 → 对合并结果响亮校验两链（`validateChunkedTransferChain` 对 resolved 值判定——validate.ts:224-237 实测；R1a/N1 冻结钉死，R1c 补锁）。
3. **零运行时 clamp**：值门 + 链全部构造期 throw，运行期只读 resolved 值（两构造器实测）。
4. **ADR 安全论证面不动**：L76 内存上界 = `maxConcurrentAssembliesPerConnection × maxChunkedUpdateBytes` 与链①②无关（链把分块 envelope 系到 legacy 队列/帧预算的**相干性**，非内存界）；「仅显式下调既有键」残余族运行期仍受 envelope（totalBytes）/count（D2）/槽位（D3）三上界 + 发送侧既有 bounded 拒纳/shed 封顶（§7-D1 语义残余段自证成立）。

**反向验证（唯一替代读法不可满足）**：无条件合并值校验与 SA6 冻结契约逻辑不相容——`LIMITS` fixture（L104-109：`maxQueuedUpdateBytes:1MiB`/`maxUpdateBytes:8KiB`、零分块族键）经 `bootSingle` 默认注入 R2–R5/N2–N4 九用例，依赖构造成功；严格合并值校验下缺省 4 MiB envelope 双链违例 → 九用例构造期 TypeError。且该读法追溯性非法化约 21 个存量绿灯文件（grep 实测取证：`issue137-ac1-ac7-red`/`issue137-r2-red`（1 MiB）、`issue172-contract-anchors`、`issue231-send-failure`（含 1_024 极端值）、`issue233-repro`、`issue243-ac-red`/`issue243-chunked-live`/`issue243-real-transport`/`issue243-sa7-dynamic`（DENY 面 4 件 + review-revisions/sa7 系列 1 MiB 级）、`apps/yjs-server/test/issue164-sa7-dynamic`（maxUpdateBytes 1 KiB → 链②违例）等）。**使已批准验收契约不可满足的读法不能是基线本意**——契约一致读法族唯一 = 「显式表达分块族链上键才校验」（设计 §7-D1 理由 1 的三腿推导经本轮独立复核成立）。

**裁决：无冲突**。约束列陈述约束关系（缺省满足之、表达即受之），执行触发面属未冻结语义，SA1 裁决权内且已显式文档化（边界语义表唯一权威口径 + §17 二轮注记规格 + 语义残余登记）。解释性裁决留痕见 R16。

## 3. 四方要求面对照（dispatch 指定）

| # | 对照面 | 核验证据（逐点实测） | 裁决 |
|---|---|---|---|
| Q1 | **任务简报 AC1**（四配置缺省 + 启动期校验链生效 + 非法配置 TypeError + 零 clamp） | 链对分块族**全量**生效（双激活键 = 与冻结契约相容的最大族——单键门留下的 `{maxChunksPerUpdate:4}`+缺省静默缺口即 SA4-2 批评模式的族内复现，算术核实 4 MiB > 4×512 KiB=2 MiB）；AC1 的可执行化本就是 SA6 契约：R1a 显式键 throw / LIMITS 构造成功已把「非法配置」边界钉死在分块族表达面；REST `[]` 零 owner 要求，无更严口径来源 | 无冲突（legacy-only 族为显式裁定的合法面，见 §2 性质 4） |
| Q2 | **SA6 契约**（冻结 11 用例 + 补例 R1c/N5/N6） | R1a：显式 6 MiB → throw ✓（激活键命中）；R1b：`maxChunksPerUpdate:0` → 值门 TypeError（构造器序 `validateLimits` 先于链——两构造器实测）✓；N1：`{...LIMITS, maxChunkedUpdateBytes:256KiB}` → 合并值判定通过（256 KiB ≤ 1 MiB ∧ ≤ 64×8 KiB=512 KiB）✓——**合并值语义由冻结用例钉死**；LIMITS 九用例经 `bootSingle({}) ?? LIMITS` 构造成功 ✓。补例与全部冻结用例零矛盾：激活键全仓穷尽 grep（test/src/apps），经构造器表达 `maxChunksPerUpdate` 者仅 R1b；包外 `maxChunkedUpdateBytes` 表达 = `issue243-chunked-live:682/707`（6/10 KiB，链满足）与 `issue243-sa7-dynamic:74`（4096，链满足）——**零存量绿面翻转** | 无冲突 |
| Q3 | **SA2 既定裁决**（W1/W2/R11–R14） | W1：§8.1 注释保留 hub/peer 前置序分列（peer 侧实测无 submit 门）✓；W2：§7-D3「单一权威口径」D2→D3→accept、双违例 TOO_LARGE 保留（代码实测同序）✓；R11/R12/R13/R14 全保留（§6 表 + §7-D5 接线表/side 字面量/GOAWAY 归并/R14 三层断言措辞）✓。iteration-0 D1「合并结果上校验（无条件）」措辞被本轮取代——该措辞经 SA4-2 判定与冻结契约**本不可同时满足**（缺陷文本），SA4 §9-SA4-2 明示授权「SA1/SA6 修订设计与契约把口径固化为裁决」；SA2 批准所依赖的契约转绿闭合面不受影响 | 无冲突（授权内的缺陷文本取代，非重开裁决） |
| Q4 | **兼容性约束**（存量套件/plugin 路径/DENY 面/受保护文件） | 双键门放宽零存量翻转（Q2 穷尽 grep）；plugin 路径对称：`mergeNested` 只合并用户 Partial（不填缺省）→ `hasOwnProperty` 探测两路径语义一致，`LIMIT_KEYS` 已含两键（plugin.ts:154 实测）；后续轮 ★ 四行（hub/peer-connection 门条件、validate.ts 注释、协议 §17 口径句）均不在 DENY；契约补例路由 owner/SA6 dispatch（冻结文件 SA3 禁触——DENY 表明示） | 无冲突 |

## 4. 合并值条件触发的连贯性核验（dispatch 专项一）

1. **激活键集闭合且对称**：{`maxChunkedUpdateBytes`, `maxChunksPerUpdate`} = 两链不等式的**全部分块族操作数**（另两操作数 `maxQueuedUpdateBytes`/`maxUpdateBytes` 为 legacy 键）；两键同为本切片家族引入（slice 2/3）。族定义无遗漏：非操作数新键（`maxConcurrentAssembliesPerConnection`/`assemblyTimeoutMs`）不激活（N6 锁定）——「调并发/超时钮不触发字节链错误」，与值门无条件性不矛盾（值门 = 单键约束，链 = 跨键相干约束，两者判据不同）。
2. **表达式语义（非值语义）为固有且已文档化**：显式 = 缺省值亦激活——`{maxChunkedUpdateBytes:4MiB, queued:1MiB}` throw 而 `{queued:1MiB}` 不 throw（有效值相同）；同理 `{...LIMITS, maxChunksPerUpdate:64}`（= 缺省值）将 throw 而 `{...LIMITS}` 不 throw。此为任何 hasOwnProperty 条件触发的固有性质，冻结契约 R1a/N1 语义即此形态；边界表行 1 明示「任意值，含 =缺省 4MiB」、行 2 对称适用。连贯性成立（声明意图语义：触碰分块族旋钮 = 全配置须自洽；仅触碰 legacy 旋钮 = 保持 slice-3 前语义）。附注 R17。
3. **顺序核验**：值门先于链（两构造器既有调用序实测）→ R1b 报精确值门错误（同为 TypeError，契约保持绿）；链违例报链错误。
4. **补例算术/边界核验**：R1c（`{maxChunksPerUpdate:4}` 其余缺省 → 4 MiB > 2 MiB → TypeError，现行单键门下红 = 落地序守卫）；N5（`{...LIMITS}` 零分块族键表达 → 不抛，非追溯边界显式锁定）；N6（非链操作数键不激活）——三条与冻结面零矛盾、与边界语义表逐行一致。
5. **残余族登记完备**：「仅显式下调既有键 + 缺省 envelope」有意合法，运行期有界论证成立（§2 性质 4）；未来收紧的代价证据链（ADR 措辞 + 冻结契约 + 约 21 存量套件三方同步）已固化于被否方案 (b)。

## 5. 槽位生命周期未重开核验（dispatch 专项二）

- **修订面精确圈定**：§8.1 伪码唯一新增行 = `this.assemblySlotHeld = true;`（D3 门通过后、`accept` 前）——与已落地修复逐行一致（hub-namespace.ts:721 / peer-namespace.ts:704 实测，含「SA4-1 修复」注释与获取-归还闭环论证）；§8.2 不变量段补获取侧置位描述。dispatch 指令「只做伪码保真同步、不重新设计该修复」——**遵守**。
- **D3 机制面零改动**：连接级 Set / 两 facet / `has`-`delete` 幂等 / 唯一归还点 `endAssemblyScope` / W2 准入序全部维持原裁决形态（源码实测与 §8.1/§8.2 伪码吻合）；REG1–REG3 回归文件在册（3 用例、LIMITS 构型）且 verify.log 实测 3/3 绿——SA4-1 的验收面（quint+ 新 ns 收敛、peer 跨代际）由回归锁定，本轮修订未触碰。
- **正交性**：链生效门在连接构造器（每连接一次、配置面），槽位在通道首 chunk 管线（每 transfer、运行面）——修订不触及槽位路径；§10 调用方矩阵中 `HubChannelHost`/`PeerNamespaceHost` 行明示「不变」。

## 6. 就绪注意项（非阻塞）

- **R15 · 暂存分歧（design-ahead-of-implementation）**：现行实现 = 单键门（hub-connection.ts:195-202 / peer-connection.ts:109-116 实测），修订设计 = 双键门；协议 §17 L569 现注记 = 单键口径的如实登记。分歧已显式路由（§11 ★ 四行 + §12「先契约后实现」顺序 + R1c 单键门下红 = 顺序守卫 + SA4/SA7 复核），落地前文档-行为暂不一致窗口由 §7-D8「同轮落地」约束闭合。**非冲突**（未冻结语义面内的已路由暂存态）。
- **R16 · 解释性裁决留痕**：本报告 §2 对 ADR 0013 L71 约束列执行口径的解释（判无冲突）应随 SA4-2 收口完整落笔于协议 §17 二轮注记（设计 §7-D8 第 1 条已规格化逐字句）；若 owner 未来采严格无条件合并值口径，须 ADR 0013 措辞修订（owner 域）+ 冻结契约 + 约 21 存量套件三方同步（被否方案 (b) 代价证据链）——设计自身已登记逃生门。
- **R17 · 表达式语义附注**：显式 = 缺省值亦激活（§4 第 2 条两种构型）——固有且已文档化；建议契约补例落笔时 N5 措辞保持「零分块族键表达」的精确边界（设计 N5 定义已如此），避免 SA6 侧写成「不含 maxChunkedUpdateBytes」的单键化回退。
- **R18 · 契约补例所有权依赖**：R1c/N5/N6 尚未落笔（冻结契约现 11 用例不锁双键边界）——补例前该边界仅由设计文本 + 本裁决承载；路由 owner/SA6 dispatch（设计 §12 写死，SA3 禁触冻结文件）。登记为已路由依赖项，非冲突。
- **R19 · 锚点微漂移**：设计引 observer-red 含 `maxChunksPerUpdate` 字面量为「L742」，实测该键在 L749（`ConnectionSenderHost` 直构 host 字面量跨 L742-752，不经构造器、值全缺省且链满足——与门无关的判定不变）。纯行号精度项，无符合性后果。

## 7. 结论

**设计修订复审通过（clear）**。SA1 iteration-1 修订与冲突基线**零冲突**：§7-D1 链生效口径（分块族链上键显式表达门、合并结果校验）对 ADR 0013 L69-76 冻结面构成**相容的执行口径解释**而非口径冲突——缺省自洽、表达即受约束、零运行时 clamp、内存上界论证面不动，且唯一替代读法（无条件合并值）与已批准契约逻辑不可同时满足；四方要求面（简报 AC1 / SA6 冻结契约 / SA2 既定裁决 / 兼容性约束）逐点闭合，双激活键经全仓穷尽取证零存量绿面翻转；合并值条件触发连贯（激活键集闭合对称、表达式语义固有且文档化、值门先于链、补例算术与边界逐条成立）；SA4-1 槽位生命周期仅保真同步、未重开（W2/D3/REG 全维持）。R15–R19 为非阻塞就绪注意项（R15/R18 归已路由的实现轮与 owner/SA6 dispatch，R16/R17 随 §17 二轮注记与契约补例落笔，R19 纯措辞）。**后续实现轮（★ 行门放宽 + 契约补例 R1c/N5/N6 + §17 口径句同轮联动）不需要新的冲突复查**（`requiresConflictRecheck: false`——全部落在已核对的未冻结语义面与已路由文件面内；R9 条件项照旧：父 PR #241 方向性返工则复审）。
