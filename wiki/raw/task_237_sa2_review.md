# SA2 独立攻击评审报告 — issue #237 设计（SA1）

**Date**: 2026-09-06 | **评审对象**: `wiki/raw/task_237_design.md`（SA1 round 1）
**Verdict**: **approve（pass，附 1 项约束性裁决 + 2 项确认的约束性交付条件 + 3 项非阻断建议）**
**requiresConflictRecheck**: **否**（裁决二落在 SA8 前置门禁 E1/E3 与设计后门禁 C1 已明文授权的包络内，无新增冲突面）

- 输入（全部读过）：issue #237 正文（gh）；Owner 3 条评论全文（2026-09-05T16:01Z / 2026-09-05T16:08Z / 2026-09-06T02:55Z，gh API 重读）；SA5 `wiki/raw/20260906-bug-237.md`；SA6 `wiki/raw/20260906-ac-issue-237.md` + `wiki/raw/task_237_sa6.md` + 两个红灯测试文件全文；SA8 前置 `wiki/raw/task_237_conflict_report.md`（clear，E1–E4）+ 设计后 `wiki/raw/task_237_design_conflict_report.md`（clear，C1–C5）+ `wiki/raw/task_237_relevant_decisions.md`；源码逐文件（见 §6 证据锚）。
- 独立性声明：未采信 SA1/SA6/SA8 任何断言为前提。红灯基线本评审独立重跑；§12 契约缺陷与 C1 行为缺口以独立探针实证；L1–L3 等价引理按 `validate.ts`/`validate-patch.ts`/`extract.ts` 源码逐 kind 复核；R1–R6 与 validate-patch §3.3 五规则按源码逐条对位。

---

## 1. 实证基线（本评审运行）

```bash
# ① SA6 红灯契约独立重跑（后台 Job，2026-09-06 22:50）
NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run \
  packages/doc-runtime/test/issue-237-path-localized-validation-red.test.ts \
  packages/namespace-runtime/test/runtime-mutate-issue-237-hot-path-red.test.ts --typecheck=false
# 结果：45 tests | 4 failed（A-1×2 计数锚 / A-2 / B-3，全部预期必红）| 41 passed（Duration 6.34s）
#   —— 与 SA6 登记完全一致；41 绿锁定逐用例核对本评审确认全部真实绿。

# ② §12 / C1 行为探针（tsx + nomicore-source 直读 src，throwaway /tmp 脚本）
#    fixture: type ROOT = { target: { value: number }; library: YArray<Item> }
1) current delete ['target','value'] =>
   {"ok":false,"issues":[{"message":"缺少必填字段 \"value\"","path":["target","value"]}]}
2) oracle（完整 proposed ROOT 全量校验，同形删除）=》同样 ok:false（缺少必填字段）
3) C1：live 把 target.value 换成 Y.Map（载体损坏）后 set ['target','value']=7 =>
   现行为 {"ok":false,...期望 plain value，实际 Y.Map}（extract 拒绝）
```

结论：①证实 4 必红/41 绿锁定基线真实；②证实 §12 缺陷申报（见裁决一）；③证实 C1 措辞-行为缺口真实存在且今日行为是「拒」（见裁决二）。

---

## 2. 裁决一（总控交办 · 设计 §12）：SA6 A-1 第二用例 delete 腿不可满足 —— **申报成立，处置方案批准（= C2 约束性确认）**

独立复核链（全部回源码/实测）：

1. 探针 ②-1/②-2：现行实现与 oracle（`jsonMirror` 删除后 `validateLogicalSnapshot` 全量校验）对 `delete ['target','value']` **双双 ok:false**（`target.value` 为必填；proposed 缺必填）。ADR-0007 L35 词表明文「delete 禁止 ROOT、required 字段和数组下标；只允许 optional 字段与 Record 动态键」——SA6 断言 `expect(r3.ok).toBe(true)` 与词表本身矛盾。
2. 潜伏性核实：A-1 第二用例当前死于 r1 计数锚（`extract≠0`），r3 断言从未执行——任何等价保持实现修绿热路径后必在 `expect(r3.ok).toBe(true)` 处永久红。「4 必红转绿」在**不修订该腿**的前提下不可达，设计判断正确。
3. 设计的最小修订（fixture 增 `note?: string`，r3 改 `delete ['target','note']`；或改 Record 动态键腿）经本评审核对**不扰动其余锚点**：TEXT_LIB_ITEM 的其余消费面（A-1 第一用例、A-2、A-6 的 6 个 TEXT_LIB_ITEM 场景）均以 `mirrored.value`/两侧同源断言，optional 缺席不改变任何 oracle 决策；用例数与「3 必红 + 38 绿锁定」结构保持。
4. 设计明令禁止以「放宽 delete 词表（允许删必填）」满足断言——**正确且必须坚持**（否则击穿 A-6「delete 存在键（必填）」oracle 决策与 ADR-0007 L35）。

**裁定**：按设计 §12 + 门禁 C2 执行，作为 SA3 交付的一部分；dispatch log 登记；SA4 复核单列说明。本裁决无需 SA1 改稿（§12 处置已写入设计）。

---

## 3. 裁决二（总控交办 · 门禁 C1 / 设计 §17-4）：R6 set 旧值不读 vs E1/E3 损坏条款措辞 —— **缺口成立；择向 (b) 修复语义；E1/E3 措辞由本裁决文本取代设计 §14 草稿；新增 2 条锚为 SA3 约束性交付**

### 3.1 缺口的独立定性（为什么必须改措辞，且改形式检查也救不回）

- 探针 ②-3：今日 `set` 覆盖损坏载体目标位 = **ok:false**（全量 extract 拒绝）。设计 R6（目标位 = 边界、旧值不消费）将反转为 **ok:true 修复**。设计 §14 E1 草稿「mutation 路径/边界内损坏仍响亮失败」与 E3 草稿「触达路径/边界内的非法数据仍会被响亮拒绝」对 set 目标位**字面为假**——目标位既是路径终段又是边界本身，而其旧值既不被读也不可能被拒。
- 备选 (a)（S4 终段对在场 set 目标加载体形态检查）**不充分**：只能拦载体形状错位，拦不住目标位旧**内容**损坏（如 map 形目标位既存非法字段值——整值替换同样不读旧内容）。即任何保 R6 O(1) 的实现都无法让草稿措辞字面成立；把 set 边界升到父 map（对称化）则顶层字段 set 退化为 O(ROOT)，直接击穿本 issue 主目标与 B-4/A-1 锚。
- 语义依据复核：Owner 2026-09-05T16:01Z「函数负责证明本次 mutation **不破坏受影响的 schema 约束**，而非扫描并诊断……既存非法数据」——整值替换后旧值不复存在，不构成任何可被「破坏」的约束；proposed 状态完全由 payload 决定且已被整体校验。修复语义是 phase-1 契约的自洽读法，且保留了唯一可行的修复通道（否则只能走 `set([])` 全量重装）。

### 3.2 裁决：采用 (b)

1. **行为**：R6 set 目标位旧值（载体与内容）一律不读取、不诊断；合法 payload 写入即**修复**。导航逐跳载体检查（A-4 面）、R1/R2/R4/R5 提取型边界内损坏（含 delete/array-* 的目标旧值——分别经父 map/数组边界提取被读到）**维持响亮拒绝**。
2. **E1 损坏条款定稿措辞**（取代设计 §14 E1 第 3 点草稿；SA3 落 ADR-0007 修订节时逐字采用）：

   > 损坏条款：普通非空路径写按最近必要语义边界工作——(i) 导航逐跳的局部 carrier 形态违规（含 array-* 目标非 Y.Array）仍响亮拒绝（ok:false、零写入）；(ii) 被提取/重建/校验的边界（union 穿越位、Record 位、数组位、delete 的父 map 位）内部既存载体/值域非法仍响亮拒绝；(iii) **set 的目标位旧值不被读取**——set 是整值替换，目标位既存非法（载体或值）由本次合法写入整值修复而非拒绝；(iv) 触达面之外的既存非法数据（含路径祖先容器内未触达的兄弟位）不再被普通写发现、不修复、不扫描（声明的语义让渡；全局合法性重建另票，见 ADR-0010 follow-up）。

3. **E3 后备句定稿措辞**（ADR-0010 L107 修订；取代设计 §14 E3 草稿中「触达路径/边界内的非法数据仍会被响亮拒绝」半句）：

   > 后续普通业务写按路径级/边界级校验：其导航路径与语义边界内的非法数据（不含被 set 整值替换的目标位旧值——该位由合法写入修复）仍会被响亮拒绝；触达面外的非法数据不再被普通写发现。

4. **新增锚（SA3 随实现一并交付，约束性）**——追加到 `packages/doc-runtime/test/issue-237-path-localized-validation-red.test.ts` 新 describe `A-7【SA2 裁决二锚】set 整值替换修复语义（声明 carve-out）`，2 个 it：
   - `set 替换损坏载体目标位 = 修复成功`：live 把 `target.value` 置为 `new Y.Map()` 后 `set ['target','value']=7` → `ok:true`、`readTargetValue===7`、恰 1 update 事件、library identity/规模不动、三计数锚 = 0。（该锚在 HEAD `9e3f0bf` 为红、修后转绿——属「随实现交付的行为反转锚」，非 SA6 冻结 45 锚的改写；A-2/B-3 同款例外注释声明 phase-1 carve-out。）
   - `对称面：array-insert 目标数组内既存损坏元素（边界内）→ ok:false 零写入`：live 写坏 `library[0].qty` 后对 `library` array-insert → `ok:false` + 状态字节不变（R4 边界提取拒绝）。（该锚今日已绿、修后保持绿——绿锁定。）
   - 交付后 doc-runtime 文件 43 tests（原 41 + 2），全绿口径不变；SA4 复核时按本裁决登记说明。
5. **§11/§13 登记**：SA3 须把 A-7 与 §13 修订同列「授权测试面变更」清单（引用本报告裁决二 + Owner 2026-09-05T16:01Z + SA8 C1）。

**与 45 锚的相容性**：新锚与 A-2/B-3（无关分支反转）、A-4（导航载体拒）互补成完整三分面（无关=不管 / 边界内=拒 / set 目标位=修复），无任何既有锚与之矛盾。

---

## 4. 攻击面逐项复核（任务交办清单 → 结论）

| # | 攻击面 | 结论 | 关键证据/推理 |
|---|---|---|---|
| 1 | **4 必红可修绿、41 绿锁定保持** | ✅（裁决一处置后） | A-1×2：三 seam 计数恒 0 的机械可行性成立——`vi.mock` 工厂 `...mod` 透传其余导出，新管线消费的 `walk`（extract.ts:91）、vfsl 新增两导出、`verifyBoundaryIntact`（新函数）均不在包装面内；A-2/B-3：R6 边界不含 library，ok:true + 无关分支原样保留；38+3 绿锁定逐用例走查（A-3 域规则面 S4/S6 逐条对齐 `placeSet/placeDelete/placeArrayInsert/placeArrayDelete`；A-4 面 S4 逐 hop 载体检查保持；A-5 面 R4 批量一次重建 + `validateSubtree` 整体判定；A-6 28 场景见 #5；B-1/B-2/B-4 面 write.ts 零改动透传） |
| 2 | **local boundary（R1–R6）** | ✅ | 与 validate-patch §3.3 五规则源码对位：规则1=R1、规则2=R2、规则3 对 mutation 词表不适用（`placeSet` 现行拒绝域保持，行为不变）、规则4=R4（批量扩展）、规则5=R6；R5（delete 父 map 位）为新边界，语义依据成立（必填/keyset 约束活在父层）；R1 优先于 R4 与现行「命中即止」次序一致；array-* 经 Record 键到达不触发 R2（键集不变）而 R4（目标数组位）——正确 |
| 3 | **carrier navigation** | ✅ | S4 逐 hop：union 试验仲裁（walkUnion 同款纪律，extract.ts:160-226 三结局语义复述与源码一致）、map→Y.Map+string / array→Y.Array+整数+**界内** / 终态即拒、中间在场检查、array-* 目标载体前置——逐条对齐 Owner 2026-09-05T16:08Z §3；载体违规归领域 ok:false 与 A-4 现绿一致（现行 E204 抛点在 extract 之后不可达的论证经源码核实成立：`navigateLive` 仅在 extract+validate 全过后执行） |
| 4 | **union trial** | ✅ | L1 成立：`walk` 与 `extractYjsSnapshot` 同一代码路径（extract.ts:65 经 `walk(derived.structure.node, ...)`）；重叠成员投影推论两侧一致（oracle 基线同为 extract 产物），最终 any-of 由 `validateSubtree` 共享解释器重仲裁——单源，无第二解释器 |
| 5 | **full proposed-root equivalence（L1–L3）** | ✅ | L3 经 `validate.ts` 逐 kind 复核：scalar/enum/pattern/object（必填+封闭 keyset，域内）/array（元素）/xml（字符串良构，域内）/union（any-of）/Record keyPattern（键域内，L549-553）——**无跨子树约束**，引理成立；域规则面 S6 与 applyToJson 逐条对齐（见 #1）；A-6 oracle 结构核实（决策 + 结果 doc 全等 + 失败零写），28 场景含 union 交叉/判别非法/成员切换/Record/optional/数组边界/两级 ref/空路径——覆盖面与机制对得上 |
| 6 | **batch atomicity** | ✅ | R4 整数组一次重建（insert-batch/delete-count 新原语）+ `validateSubtree` 整体判定，中间态不参与——满足「不逐元素」；越界不 clamp 与 `placeArrayInsert/placeArrayDelete` 现行语义一致（A-5 锚定） |
| 7 | **zero write and dirty** | ✅ | S3–S7 全部先于事务；失败只走 ok:false 联合；E205 面（信封/意外异常）保留；write.ts S5→S6 槽序零改动 → 零 dirty/零事件由 B-2 锚透传 |
| 8 | **fatal classification** | ✅ | E201 变体 C/D **复用既有码字**（install-verify.ts e201C/e201D 在场）→ 门禁 C4 的稳定码注册义务天然满足；E203 transactGuarded 不动；E204 收窄给手造派生物（行为保持性重分类，可观测面不变）；E205 不动；committed:true/不回滚/不假成功措辞族保持 |
| 9 | **single guarded transaction / minimal edit** | ✅ | S8 = 现行 `commitPrepared` + `transactGuarded` 原样（mutation.ts:57/161-180）；只 set/delete 目标键或 insert/delete 数组段；B-1 `<128B`、B-4 `<256B` 与 29–33B 现状锚一致 |
| 10 | **postcommit non-root scan** | ✅ | `verifyBoundaryIntact` = O(1) 安装事实核 + O(boundary) 边界重投影核；不重过 schema 的论证成立（pre-commit 已证 proposed 合法，核证明 installed ≡ proposed）；偏离 → E201-C committed:true；核无法运行 → E201-D 绝不假成功；**范围收窄（边界外 observer 干扰不再检测）已在 §8.5 声明**——与 E1 修订措辞一致（触达面外让渡） |
| 11 | **R6 set-old-value vs E1 wording（C1）** | ⚠️→✅ | 见裁决二：缺口成立（探针 ②-3），择向 (b)，E1/E3 措辞定稿 + 2 条新锚为约束性交付 |
| 12 | **ADR-0007/0008/0010 + CONTEXT 修订与 follow-up 登记** | ✅（措辞按裁决二取代） | 四文件实存且引用行核实（0007 L27/L35/L37/L59、0008 L65/L69、0010 L107、CONTEXT L63/73/91/137）；§14 逐条对应 SA8 E1–E4 义务（含 set([]) 保持全量、等价测试硬前置保留）；follow-up 四项显式登记（replication/损坏存量/不可信恢复合法性重建、carrier 覆盖面审计、MABF origin/path instrumentation、lazy cursor 后议）——无静默留白 |
| 13 | **public API / FIFO 不变** | ✅ | doc-runtime `index.ts` 零改动（surface 两测试前提）；namespace-runtime 零源码改动（write.ts S1–S7/sequencer/snapshotter 不动，源码核实 S5 调用点与 S6 await notifyDirty）；vfsl 经 `src/index.ts` additive 增补（vfsl AGENTS.md「Add public API only through src/index.ts」合规；无 vfsl surface 枚举测试需同步）；vfsl 零 Yjs 依赖保持 |
| 14 | **benchmark：零墙钟 / 不归因 #238** | ✅ | 入仓锚 = 计数锚（规模无关）+ B-4（确定性计数断言，30s 周期压缩为紧邻调用）；墙钟/heap 仅入不入仓的 throwaway 证据运行（`.mabf-bg/`，gitignore L8 核实）；#238 仅引用冻结 wire 计数测试对照、不归因；sequencer 占用定性承载（C5） |
| 15 | **Owner 要求映射**（前置=拓扑+值双半边 / 无 baseline 状态机 / 无 ordinary 旧全量校验 / 导航局部 carrier 检查 / prewrite-only / 无关分支不读不复制不校验） | ✅ 全部 | §3.1 双半边入内部契约+测试前置（SA6 expectValidBaseline 在场）；§3.1 明示无 generation/缓存/baseline；S3–S6 无旧 ROOT validate；S4 逐 hop；S3–S7 先于 S8；§5 构造性保证（无 ROOT 级遍历入口）+ A-1 计数锚机械满足 |

---

## 5. 非阻断建议（advisory，不阻塞 SA3）

1. **检测次序与 issue 文案兼容**：新管线把「未知终段字段」类拒绝从 proposed 全量校验前移到 S3 结构守卫——单因失败路径/文案应尽量沿用现行措辞域（S6 已逐条对齐；S3/S4 新文案自由度大）。已核查现有锁定测试无 issue message/path 级断言（仅 sa7 E205 spoof-envelope 与 xml materialize 两处，均不在改动面），风险低；SA3/SA4 以全量 `pnpm test` 兜底（设计 §11 已含）。vfsl AGENTS.md「stable error codes, issue ordering, path reporting」为兼容面——新增两导出的 issue 序须确定性（rebase 规则已定）。
2. **§17-6 边界重投影成本（array 2×O(boundary)）**：接受保守完整边界核；B-4 场景为 R6 不受影响。若后续 8k 数组批量操作成为瓶颈再议 spot-check 降级——与 lazy cursor 同属「证明为瓶颈后再议」纪律。
3. **§17-8 `planMutationBoundary` 形状**：phase-1 足够（prefix/relPath/归一化 node/kind 四元组 + (derived,path,op) 纯函数、零 doc 状态，TOCTOU 面干净）；建议 JSDoc 明示「phase-1 契约：不含 lazy-cursor 所需的中间 hop 结构信息，演进走 additive v2」——命名定稿后长期公共面，注释即契约。

---

## 6. 证据锚（本评审实际读取/运行）

- 运行：§1 两项（红灯契约重跑 45|4|41；tsx 探针 3 输出）。
- 读取：`packages/doc-runtime/src/{mutation,extract,install-verify}.ts` 全文、`detached-build` 头部、`src/index.ts` 导出面；`packages/vfsl/src/validate-patch.ts`（头部纪律段 + guardWalk/五规则 L298-461 + drillStep）、`validate.ts`（interpret/validateLogicalSnapshot/validateSubtree L598-660 + 逐 kind L322-359/458-553）、`src/index.ts` 导出面；`packages/namespace-runtime/src/write.ts`（S5/S6 槽序）；两红灯测试文件全文；`apply-validated-mutation-fatal-contract.test.ts`（W5 用例 L209 区段在场，与 §13 描述一致）、`apply-validated-mutation-operations.test.ts`、`sa7-fatal-dynamic-verify.test.ts`（E205 message 断言面）；三包 AGENTS.md；`docs/adr/0007/0008/0010` 引用行、`CONTEXT.md` 四词条、`docs/AGENTS.md`（amend 规则）、`.gitignore`；issue #237 正文 + Owner 3 评论（gh 全文）。
- 关键行号：`mutation.ts:8,9,49-63,72-83,107-153,182-235,328-372`；`extract.ts:53-83,91-152,160-226,235-257`；`install-verify.ts:44-90,100-169,182-252`；`validate.ts:322-359,458-553,598-660`；`validate-patch.ts:298-461`；`write.ts:141-158`；ADR-0007 L27/L35/L37/L59；ADR-0008 L65/L69；ADR-0010 L107；CONTEXT.md L63/73/91/137。

---

## 7. 结论与 SA3 交付清单（约束性）

**Verdict：approve** —— 设计的局部边界管线、导航载体纪律、union 试验复用、批量整体判定、等价引理（L1–L3 经源码逐 kind 复核成立）、零写入/fatal/单事务/最小 edit/边界级提交后验证、公共面与 FIFO 零变化、benchmark 纪律、E1–E4 + follow-up 登记全部经受住攻击，能以裁决一处置为前提把 4 必红修绿并保持 41 绿锁定。SA1 无需返工改稿；以下为**随 SA3 交付的约束性条件**（Controller 派发 SA3 时必须并入 prompt）：

1. **裁决二全套**：(b) 修复语义；ADR-0007/0010 修订采用 §3.2 定稿措辞（**取代设计 §14 E1 第 3 点与 E3 对应半句草稿**）；交付 A-7 两锚（doc-runtime 文件 41→43 tests，登记为授权测试面变更）。
2. **裁决一/C2**：A-1 delete 腿最小修订（optional 字段或 Record 键），严禁放宽 delete 词表；保持 3 必红/38 绿结构。
3. **C3**：fatal-contract W5 用例修订按 §13（损坏移入边界、保持「领域失败不入 fatal 通道」意图、注释引用 Owner 2026-09-05T16:01Z + ADR-0007 修订节）；fatal 契约面其余用例零改动。
4. **C4**：复用 e201C/e201D 既有码字即满足；若引入新字面量须按 errors.ts 注册表 append-only 纪律。
5. E1–E4 文档 + follow-up 注册、§15 证据运行（不入仓、含「完整 ROOT 投影次数=0」旁证与 sequencer 占用定性说明）按设计 §14/§15 交付；全量 `pnpm typecheck` + `pnpm test`。

**冲突复审**：不需要——裁决二两个选项均在 SA8 C1 预授权包络内，措辞收窄属 E1/E3 已裁决修订义务的落地，无新增 ADR/CONTEXT 冲突面。
