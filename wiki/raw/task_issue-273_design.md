# SA1 设计 — Issue #273 namespace-runtime + namespace-registry：readData 成功分支返回语义 schema 投影（ADR 0016）

- Worktree：`/home/wangjian/nomicore-fix-issue-273`（branch `mabf/issue-273`，HEAD `1acd9e9` = #272 合并提交 = PR #271 支系）
- Phase：design（**iteration 1**——按 SA2 评审 F-1 修订）；任务类型：**feature**（能力缺口实施票——ADR-0016 + ADR-0008「ADR 0016 修订节」的忠实实施，非 Bug）
- 母法：`docs/adr/0016-readdata-semantic-schema-projection.md`（已接受）+ `docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md` L167–177 修订节（已接受）
- 上游输入：SA6 验收契约 `wiki/raw/task_issue-273_sa6_contract.md`（approve，15 红契约 + 6 负控 + 2 类型锚 + 共享夹具）；SA8 冲突门禁 `wiki/raw/task_issue-273_conflict_report.md`（clear，红线 7 条）；SA8 设计后复审 `wiki/raw/task_issue-273_design_conflict_report.md`（clear——D4 throw 逃逸 no-conflict；§8 移交项 5 条；§10 已 armed 实现阶段复查清单）；#272 设计 `wiki/raw/task_issue-272_design.md` §8.7-R2/§10/§13-follow-up#1（组合义务传承）
- 评审输入：`wiki/raw/task_issue-273_sa2_review.md`（iteration 0 对本设计的裁决 **reject，仅 F-1（MAJOR）一项阻断**）——本版为 F-1 修订版，逐条落实映射见 §14
- 本版修订性质：**局部修订**——D1–D7 主线（形状、null 收敛、深拷贝、分层、类型跟随、测试改锚）不变；新增 D3b hardened path 规范化守卫（敌意 path → `schema:null` 收敛、保持 `InternalError` 为唯一逃逸 throw），并同步修订 D2 结构论断、D4 文档契约、§8/§9/§11/§12 与风险表

---

## 1. 任务类型、目标与非目标

**类型**：feature（公共读契约升级）。

**目标**：`readData` 成功分支从 `{ ok: true, value }`（doc-runtime 结果零包装透传）升级为 `{ ok: true, value, schema }`，`schema` 为该路径的语义 schema 投影（`ReadDataSchemaProjection | null`）——值语义子树 + 传递闭包别名表 + docs/aliasDocs 注释切片，每次读 detached 深拷贝。agent 类消费者一次读同时拿到值与解读/构造合法 mutation 所需的语义。**读面敌意 path 纪律（本版新增钉死）**：敌意/异态 path 输入收敛为 `schema:null`（读恒 ok、值语义零影响、绝不因敌意输入外抛）；`InternalError`（可信域畸形 derived）保持唯一逃逸 throw。

**非目标**（简报「行为要点」+ ADR-0016 §分层明文排除）：

- 不改 `@nomicore/doc-runtime`（读取保持 schema 无关，`readLogicalValueAtPath` 签名语义零触碰）；
- 不改 `@nomicore/vfsl`（`resolveSchemaAtPath`/`ReadDataSchemaProjection` 为 #272 已落地表面，本票只消费；`InternalError` 不为此导出——SA8 复审移交项 2）；
- 不改 read 失败分支（`PATH_NOT_ALLOWED` / `RUNTIME_READ_DISABLED` / lease released）与 `getSchema`/`getMetadata`/`getActiveSchema`/`getStatus`；
- 不新增公共方法/参数、不加 opt-in 开关、不加 schema 缺席原因子通道（`null` 单义）；
- 不做投影缓存（零缓存是契约；按 schema generation 缓存是 ADR 预留的加法演进）；
- 不触诊断变更日志（ADR-0016：「诊断变更日志不涉及读面」）、不触复制 raw 读面、不触持久化；
- 敌意 path 收敛**不**新增失败分支/稳定码（`schema:null` 是 ADR-0016 情形③既有收敛出口，不是读失败）。

## 2. 当前行为与证据锚点（源码事实）

| # | 事实 | 锚点 |
|---|---|---|
| B1 | doc-runtime 读结果：`ReadLogicalValueResult = { ok: true; value: unknown } \| { ok: false; code: 'PATH_NOT_ALLOWED'; path; message? }`；成功恰两键、值缺席显式 `undefined`、同步不抛（INV-R1，顶层 try/catch E100 收编意外异常） | `packages/doc-runtime/src/read.ts` L44–46、L27、L128–134 |
| B2 | runtime 读联合 = doc-runtime 联合零包装直引：`NamespaceRuntimeReadDataResult = ReadLogicalValueResult \| RuntimeReadDisabledResult`（头注「D3 零包装」） | `packages/namespace-runtime/src/runtime.ts` L116–118 |
| B3 | `readData` 实现：lifecycle gate 在透传之前——`lifecycle === 'ready' ? readLogicalValueAtPath(doc, path) : readDisabled(lifecycle, path)`；ready 期逐字节透传 | `runtime.ts` L438–446 |
| B4 | 组合 seam 就位但未接线：`RuntimeState.schemaState: 'preparing'\|'ready'\|'unavailable'` + `activeTools?: { module; derived }`（内部保留）；`installActive` 单点原子安装 | `packages/namespace-runtime/src/p0.ts` L37–43、L161–172 |
| B5 | **fatal 期 `schemaState` 停留 `'preparing'`**：P0 ⑥ 编译失败 → `schemaState='unavailable'`；⑦ internal fault → 只置 `state.fatal`/`fatalCause`，schemaState 不迁移；`activeTools` 恒未安装 | `p0.ts` L121–131 |
| B6 | resolver 依赖面已就位：`resolveSchemaAtPath(derived, path)` 公开导出，返回 ok 投影（四件套）或 `SCHEMA_PATH_NOT_FOUND`/`SCHEMA_PATH_INVALID` 两码；可信域畸形 throw `InternalError`（无顶层 catch）；返回 `valueSchema`/`aliases` 与 derived **共享节点**，头注明示「detached 深拷贝属 namespace-runtime 组合边界」 | `packages/vfsl/src/resolve-schema-at-path.ts` L48–68、L89–181、头注 L28–31；`packages/vfsl/src/index.ts` L125–126 |
| B7 | registry lease 读 = 直透传：`readData(path) { if (released) return RELEASED_ISSUE; return entry.runtime.readData(path); }`；类型别名 `NamespaceLeaseReadDataResult = ReadLogicalValueResult \| RuntimeReadDisabledResult \| NamespaceLeaseReleasedIssue` | `packages/namespace-registry/src/lease.ts` L276–278；`src/types.ts` L448–451 |
| B8 | lease `Equal` 类型级锁：`Equal<NamespaceLeaseReadDataResult, ReturnType<NamespaceRuntime['readData']> \| NamespaceLeaseReleasedIssue>` ——runtime 联合变更后别名不同步即编译红（强制跟随点） | `lease.ts` L383–391 |
| B9 | 两包依赖 `@nomicore/vfsl: workspace:*` 已在（runtime 直接依赖 + registry 直接依赖） | 两包 `package.json` |
| B10 | resolver docs/aliasDocs 切片为每次调用新鲜数组（`[...fieldDocs[k], ...markerDocs[k]]`、`[...arr]`）；valueSchema/aliases 与 derived 共享 | `resolve-schema-at-path.ts` L447–463、L175、L406 |
| B11 | runtime 同步 getter 对内部损坏的既有处置先例 = **loud throw**（getSchema 载体异型 throw `SchemaProjectionError`；getMetadata 循环值原始 `RangeError` 直接逃逸——测试断言 `toBeInstanceOf(RangeError)`） | `packages/namespace-runtime/src/projection.ts` 头注；`test/runtime-boundary-supplementary.test.ts` L79–82 |
| B12 | 仓库内 `readData(` 生产消费面：runtime/registry 两包 + `apps/yjs-server/src/app.ts`（仅消费 `result.value`，加法兼容；op 分发层全程 try/catch 收编） | 全仓 grep（§10 矩阵）；`apps/yjs-server/src/app.ts` L546–550、L827 注释 |
| B13 | CONTEXT.md「Data」/「语义 schema 投影」词条已按 ADR-0016 落地（PR #271 首提交），无术语债 | `CONTEXT.md` L34、L37–38 |
| B14 | **resolver 以迭代协议消费 path**：path 形状守卫 `for (const seg of path)`（触发 `Symbol.iterator`），主解析循环同款；失败回显 `path: [...path]` spread 同样走迭代协议——exotic-but-indexable 数组（重定义/Proxy 陷阱的 `Symbol.iterator`）可使 resolver 裸抛**非 InternalError** 的敌意异常 | `resolve-schema-at-path.ts` L97、L134、L99/L138/L158（本设计本轮亲核） |
| B15 | **doc-runtime 值读对同一敌意面以索引访问导航且不抛**：G0 `Array.isArray` 守卫（L60）→ `for (let i = 0; i < path.length; i++)` + `path[i]` 索引读（L72–73，零迭代协议）→ 缺席吸收「中间缺失立即结束」（L79：`['absent-key', Symbol()]` 在 seg0 即吸收返回 ok，**尾段 Symbol 从不被检查**）→ 全程顶层 try/catch E100；失败 path 拷贝经 `safeSpreadPath` 内层 try 收编（Proxy 数组 spread/长度 trap 威胁模型的仓内既有记载） | `read.ts` L57–88、L128–134、L139–162（SA2 F-1 证据，本轮亲核一致） |
| B16 | `InternalError` 未从 `@nomicore/vfsl` index 公开导出（仅 `resolve.ts` 模块级 + 注释提及）——测试不能以类引用断言，须按构造名/message 匹配 | `packages/vfsl/src/index.ts` grep（SA8 移交项 2 / SA2 N-2，本轮亲核一致） |

**B14+B15 的组合推论（F-1 根因）**：doc-runtime 值读成功（含吸收式 ok）**不证明** path 是普通数组——缺席吸收使值通道对尾段的检查深度短于全路径，而 exotic-but-indexable path 可全程通过索引导航返回 ok。iteration-0 设计把原样 path 直递 resolver，使 resolver 的迭代协议消费成为敌意 trap 的触发点：敌意输入（非 internal bug）触发生产可达的非 InternalError throw，违背 ADR-0008 L28「只有 internal bug 才抛异常」的分类与 doc-runtime 同敌意面纪律（safeSpreadPath 即为此威胁模型而设）。

## 3. 能力缺口（feature 缺口链）

**缺口**：runtime `readData` 成功分支没有任何 schema 投影——SA6 §5 实测四态（ready/preparing/unavailable/fatal）× 路径矩阵（9 路径）全部 `'schema' in r === false`。组合素材（`activeTools.derived` B4 + `resolveSchemaAtPath` B6）均已在位但零接线（全仓 grep：namespace-runtime 对 resolver 无任何使用）。缺口收敛点 = **namespace-runtime 组合边界**（ADR-0016 §分层 L75）：成功读 = doc-runtime 值 + resolver 投影的每次读深拷贝。

缺口链（承接 SA6 §8，全部 high confidence）：doc-runtime 读面 schema 无关是母法冻结项（B1）→ runtime 零包装透传无附加点（B2/B3）→ 素材就位未接线（B4/B6）→ registry 只类型别名 + 直透传（B7/B8）→ 落地点 = runtime 组合。

**组合面新增敌意面义务（F-1 修订）**：接线同时使组合面首次消费敌意 path 的 schema 通道——必须与 doc-runtime 在同一敌意面同纪律（结果面收敛、不外抛），即 D3b。

## 4. Owner 要求落实

Issue comments 经 REST 读取为**空**（任务简报 `## Comments` 节空；SA6 §2、SA8 两报告、SA2 §4 四处同载 `comments: []`；本迭代 dispatch 复核仍 none）——**无 owner 评论要求需并入**，本表无行。执行标准唯一来源 = 简报「行为要点」6 条 + AC1–AC5 + ADR-0016 + SA2 评审 F-1（对简报 AC 隐含的读面敌意纪律的攻击性细化），其逐条落实映射见 §7（设计决策）、§12（验收映射）、§14（评审修订映射）。

## 5. 复现和根因承接

| 上游事实 | 证据位置 | 设计响应 |
|---|---|---|
| 能力缺口证实：成功分支缺 `schema` 键，15/15 红契约全落在 schema 键；值面/失败面负控 6/6 绿 | SA6 §5/§6/§13 | §8 组合设计直接落位：ok 分支恰三键 `{ok, value, schema}`（D2），失败分支零触碰 |
| 红契约 #1–#7：投影内容 = 同源预言机（`compileSchemaEnvelope` + `resolveSchemaAtPath`）逐字相等 + 字面量锚 | SA6 §12 表 1–7 | D5：runtime 组合面直接消费 resolver ok 分支四件套并整体深拷贝——内容同源即相等，不自造第二套投影逻辑 |
| 红契约 #8–#10：preparing/unavailable/fatal 三态读恒成功、`schema === null` | SA6 §12 表 8–10 | D3a：`schemaState !== 'ready' \|\| activeTools === undefined → null` 单点守卫；fatal 由 B5 天然覆盖（schemaState 停留 preparing） |
| 红契约 #11/#12：路径偏离 schema（`['rogue']`）与静态解析失败（`['skus','ZZ1']` keyPattern 失配）→ 读成功、schema null；同 map 合法键对照非 null | SA6 §12 表 11–12 | D3：resolver 两码（NOT_FOUND/INVALID）单义收敛 null，不细分、不泄漏进读联合 |
| 红契约 #13–#15：两次读内容全等但五层引用互不共享、三次连续读互异（零缓存）、改写投影不污染后续读数与 live `getActiveSchema()`、投影不冻结 | SA6 §12 表 13–15 | D5：四件套整体 identity-memoized 深拷贝（可变普通副本、不冻结、跨读零共享、零缓存） |
| 类型锚 ×2：`NamespaceRuntimeReadDataResult` 与 `NamespaceLeaseReadDataResult` ok 分支须存在 `{ok:true; value; schema: ReadDataSchemaProjection \| null}` 成员（精确可空） | SA6 §12 类型锚、§13（当前 TS2322 红） | D1/D6：联合重定型 + 别名跟随，两锚翻绿；doc-runtime 保持守卫（锚内第 2 断言）零改动成立 |
| 基线绿：`runtime-sync-read-face` / `runtime-acceptance-exports-audit` 8/8 绿——既有同步读面/公共面未受影响 | SA6 §4 | 设计保持十二键键集与 exports 面零变化（AC4）；审计测试无需改动（其不涉 readData 形状——SA2 §3 AC4 行核验成立） |
| SA6 §15 未锁自由度：InternalError 处置、深拷贝机制、docs 空条目过滤、未知方言 null 情形 | SA6 §15 | D4 钉死 InternalError 处置（可信域 throw 逃逸）；D3b 钉死敌意 path 处置（收敛 null）；D5 钉死深拷贝机制；docs 空条目过滤不在本票辖域（resolver #272 已钉死，本票只消费）；未知方言属 registry 导入面非本票锚定范围（SA6 §15.4） |
| **SA2 F-1（MAJOR，reject）**：敌意/exotic path 经 resolver 迭代协议产生生产可达非 InternalError throw；iteration-0 D2「INVALID 结构上不可达」论断错误；D4 JSDoc「internal-bug-only、生产不可达」公共契约失真 | SA2 §13 F-1（证据：`resolve-schema-at-path.ts` L94–101 / `read.ts` L57–88、L128–134、L139–162；本设计 B14/B15 亲核一致） | **D3b hardened path 规范化守卫**（索引访问扫描拷贝 + 迭代纯度校验 + 内层 try，异态/异常 → `schema:null`，普通数组副本传 resolver）；D2 撤销「结构上不可达」论断；D4 JSDoc 改双域表述；§12 新增三条可执行验收测试（T1–T3）；§11 ALLOW 增补测试文件 |
| 上游矛盾：**无**——SA6/SA8/SA2 事实与源码逐条核对一致（B1–B16）；F-1 是 iteration-0 设计分析缺口（SA2 自述「设计分析缺口而非事实错误」），非上游事实矛盾 | 本设计 §2 | 无需矛盾上报 |

## 6. SA8 约束落实

（`wiki/raw/task_issue-273_relevant_decisions.md` 不存在；SA8 已在 `task_issue-273_conflict_report.md` 内嵌 ADR 全集 14 文件盘点表，并在 `task_issue-273_design_conflict_report.md` 完成设计后复审——等价固定产物，本表按其红线、裁决与移交项落实）

| 决议或义务 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| 红线 1 包装而非透传：新成功分支必须显式映射（value 透传 + schema 附加），`PATH_NOT_ALLOWED` 原样透传 | §8.2 D2 | readData ready 分支重写为值读 → 失败短路透传 → 成功恰三键构造 | 否（ADR-0016 逐字） |
| 红线 2 lease `Equal` 锁同步：types.ts 别名与 lease.ts 类型级锁同步演进且锁保持编译绿 | §8.4 D6 | 别名 = `NamespaceRuntimeReadDataResult \| NamespaceLeaseReleasedIssue`；锁零改动自然成立 | 否 |
| 红线 3 null 单义性：resolver 两码一律收敛 `schema:null`，不泄漏进读联合、不加缺席原因子通道 | §8.2 D3 | 单点守卫收敛；无 `schemaIssue`、无码透传；**D3b 敌意收敛同走 null 出口，不新增子通道/码** | 否（ADR-0016 被否备选明文拒绝） |
| 红线 4 InternalError 通道归属须 SA1 钉死（throw 逃逸 vs 收敛 null 两读法各有 ADR 锚点） | §7 D4、§9 | **钉死：可信域 throw 逃逸读面**（不加针对 resolver 的 catch、不收敛 null、不记 fatal、不发诊断）+ **敌意域收敛 null（D3b，两域划界）**——SA8 设计后复审已对「throw 逃逸」裁定 no-conflict（D4 焦点表 9 行），SA2 F-1 明示修订后「D4 对可信域的裁定不变」 | 复审已闭合；**实现阶段复查已 armed**（SA8 报告 §10）；本版对复查清单第 1 条的措辞歧义提交窄域复查（§15） |
| 红线 5 深拷贝是本票义务：#272 resolver 与 derived 共享节点，本票在 namespace-runtime 边界对四件套整体深拷贝 | §8.3 D5 | 新内部模块 identity-memoized 递归克隆；AC3 隔离契约（红 #13–#15）即验收锚 | 否（ADR-0016 §交付纪律） |
| 红线 6 测试改锚面：读结果 toEqual 全等断言按新形状更新（toMatchObject 加法兼容）；public-surface 审计按新形状；yjs-server 由根门覆盖 | §10、§11 | 测试改锚策略 D7（站点分类 + 完整清单——含 SA2 N-1 补全的 4 处无改动站点留档） | 否（ADR-0016 Consequences 自登记） |
| 红线 7 工作流纪律：栈接 PR #271 支系、勿信陈旧本地 `origin/main` | §13 | 记录为实现票约束（SA1 不提交；实现留在 `mabf/issue-273`） | 否 |
| ADR-0008 修订节第 3 条「原规则保持」：schema 无关读取、不进 sequencer、失败通道、**读取保留不变量（敌意面不抛）**均不变 | §8.2/§9 | readData 保持同步、sequencer 之外、零副作用；失败三分支原样；**敌意 path 由 D3b 收敛 null——「读取保留不变量」正是 F-1 被破坏点，本版补齐** | 否（文义既有） |
| ADR-0016 Consequences 第 1 条：D8 封口改写——derived 只经投影深拷贝进公共面；module/validator 仍永不 | §8.2/§11 | 组合面只递出投影副本；`p0.ts` L43 旧注释按修订节更正（注释级） | 否 |
| SA8 设计后复审 §8 移交项 1（JSDoc 两处义务） | D4 论证 6 | 落实——文案改**双域表述**（敌意 → null；InternalError → throw），防后续维护者误判 | 否 |
| SA8 设计后复审 §8 移交项 2（不导出 InternalError） | §12（N-2 修订） | 落实——可选负向测试按构造名/message 匹配断言，勿为此导出该类 | 否 |
| SA8 设计后复审 §8 移交项 3（yjs-server 外层收编评估） | §10 yjs-server 行 | SA2 N-3 已评估销项：`opRead` try/finally 仅消费 value，op 分发层全程 try/catch 收编（app.ts L827）——进程不崩溃；F-1 修订后该面 throw 概率进一步归零。无改动结论成立，留档 | 否 |
| SA8 设计后复审 §8 移交项 4（可选负向测试） | §12 | 保留为可选（非验收门），按 N-2 修正断言方式 | 否 |
| SA8 设计后复审 §8 移交项 5（工作流） | §13 follow-up #4 | 记录为实现票约束 | 否 |
| SA8 设计后复审 §10 实现阶段复查清单（已 armed） | §15 | 本版对清单第 1 条「组合层无 catch」与本版 D3b 内层 try 的辖域区分提交窄域说明——内层 try 仅包裹敌意 path 扫描（输入域），不包裹 `resolveSchemaAtPath` 调用，InternalError 通道不受影响 | **是（窄域，见 §15）** |

## 7. 设计决策与主要备选方案

### D1 结果联合重定型（runtime 层）

```ts
/** read 失败成员（PATH_NOT_ALLOWED）：doc-runtime 单源派生——doc-runtime 保持 schema
 *  无关（负控/类型守卫双锚），失败形状以 doc-runtime 为准，不复制第二份。 */
type ReadLogicalValueFailure = Extract<ReadLogicalValueResult, { ok: false }>;

export type NamespaceRuntimeReadDataResult =
  | { ok: true; value: unknown; schema: ReadDataSchemaProjection | null }
  | ReadLogicalValueFailure
  | RuntimeReadDisabledResult;
```

- ok 成员**恰三键**（红 #1 `Object.keys` 锚）；`schema` 精确可空（`| null`，无 `undefined` 第三态——类型锚 `Extract<T, {ok:true; value:unknown; schema: ReadDataSchemaProjection | null}>` 要求成员可分配性成立）。
- `value: unknown` 保持；`value` 键恒显式构造（doc-runtime INV-R3 语义在包装层延续——缺席读返回 `{ok:true, value: undefined, schema}`，`value` 键在场，红 #7）。
- `RuntimeReadDisabledResult` 逐字不变（L109–114 既有定义）。
- 落位：`runtime.ts` L116–118 原地重定型；`NamespaceRuntime` 接口 `readData` JSDoc 同步改写（去掉「D3 零包装」表述，注明 ADR-0016 组合语义 + D4 双域 throw/null 契约）。
- **备选否决**：① 保留 `ReadLogicalValueResult` 整体于联合（ok 成员将同时存在有/无 schema 两形态——联合不健全，类型锚虽可过但公共契约含糊，调用方无法收敛 ok 分支形状）；② 内联复制失败成员字面量（doc-runtime 失败形状出现第二份定义，未来漂移无锁——`Extract` 派生让 doc-runtime 保持唯一事实源，SA6 负控 + 类型守卫锚同时锁住两层）。
- **不变（F-1 修订不触及本决策）**。

### D2 组合顺序（readData ready 分支）

```ts
readData: (path) => {
  const lifecycle = state.lifecycle;
  if (lifecycle !== 'ready') return readDisabled(lifecycle, path);   // ① 失败通道原样（gate 保持原序）
  const result = readLogicalValueAtPath(doc, path);                  // ② 值读先行
  if (!result.ok) return result;                                     // ③ 失败短路：零 schema 解析（失败对象不带 schema 键）
  return { ok: true, value: result.value, schema: projectReadDataSchema(state, path) }; // ④ 恰三键
},
```

- 顺序即语义：**值先行**保持 doc-runtime G0/C1 对垃圾输入的第一道结果面防线（非数组 → `PATH_NOT_ALLOWED` 短路；`PATH_NOT_ALLOWED` 不做任何 schema 工作——性能正确性兼语义正确性）。
- **【F-1 修订】撤销 iteration-0 的错误论断**：原括注「resolver 从组合面结构上不可达 `SCHEMA_PATH_INVALID` 的非数组/野段输入」**不成立**——doc-runtime 缺席吸收「中间缺失立即结束」（B15：`['absent-key', Symbol()]` 在 seg0 吸收返回 ok，尾段 Symbol 从不被值通道检查），且 exotic-but-indexable 数组可全程通过索引导航返回 ok。**值读成功不证明 path 是普通数组**：值通道与 schema 通道对 path 的检查深度与消费协议不同（索引导航 + 吸收 vs 迭代协议 + 全段扫描），前者不构成后者的前置保证。结构性防御由 **D3b** 在 schema 通道内自持（组合面对自己消费的敌意面负责，不假借值通道的副产品）。
- `value` 直传 doc-runtime 投影副本（值深拷贝纪律在 doc-runtime P1 已尽，本层零重复拷贝）。
- **备选否决**：schema 先行再值读（失败读也解析 schema——浪费且违背「失败分支不带 schema」；且 InternalError 逃逸面扩大到失败读）。**备选否决**（F-1 后追加）：在 readData 外层包 catch 收编敌意异常（会把可信域 `InternalError` 与敌意异常混入同一 catch，无法在不吞 InternalError 的前提下区分两域——收编必须在敌意面单点、且只包裹敌意扫描本身，即 D3b 的内层 try）。

### D3 null 收敛规则（两级守卫：D3a 状态守卫 + D3b 敌意 path 守卫）

```ts
// 新内部模块 read-schema-projection.ts
export function projectReadDataSchema(
  state: RuntimeState,
  path: readonly (string | number)[],
): ReadDataSchemaProjection | null {
  const tools = state.activeTools;
  if (state.schemaState !== 'ready' || tools === undefined) return null; // D3a 情形①：无 active schema
  const normalized = normalizeReadPath(path);                            // D3b hardened 守卫（F-1）
  if (normalized === null) return null;                                  // 敌意/异态 path → 情形③收敛
  const resolved = resolveSchemaAtPath(tools.derived, normalized);       // resolver 只见普通数组副本
  if (!resolved.ok) return null;                                         // 情形②/③：路径偏离 / 静态解析失败
  return detachReadSchemaProjection(resolved);                           // D5 四件套整体深拷贝
}
```

- **D3a 情形①**（无 active schema）：`schemaState !== 'ready'` 覆盖 preparing/unavailable；**fatal 由 B5 天然覆盖**（fatal 期 schemaState 停留 `'preparing'` 且 activeTools 未安装）——无需读 `state.fatal`，守卫保持单源。「未知方言只读」属 registry 导入面（SCHEMA 载体 lang 非 vfsl → compile 层 unavailable 或导入路径），同一守卫出口，本票不单独锚定（SA6 §15.4）。**守卫次序**：状态守卫先于 path 守卫——无 active schema 时不触碰敌意对象（零敌意代码执行面、零无谓扫描）；两守卫皆收敛同一 `null` 出口，无子通道。
- **D3b hardened path 规范化守卫（F-1 修订新增，本版核心）**：

```ts
/**
 * 敌意 path 规范化（F-1）：仅以普通属性读（length/[i]/Symbol.iterator 同一性比较）扫描
 * 并拷贝入普通数组，全程包内层 try；任何异常、迭代器非标准、长度异型或非 string|number
 * 段 → null（schema:null 收敛，绝不外抛——镜像 doc-runtime safeSpreadPath/E100 敌意面
 * 纪律）。绝不调用迭代协议（不 spread、不 for..of、不 Array.from）。
 */
function normalizeReadPath(path: readonly (string | number)[]): Array<string | number> | null {
  try {
    if (!Array.isArray(path)) return null;                                   // 防御（值通道 G0 已挡非数组；此处为内部直调者兜底）
    if (path[Symbol.iterator] !== Array.prototype[Symbol.iterator]) return null; // 迭代纯度：重定义/Proxy 陷阱 → null
    const n = path.length;                                                   // 属性读，非迭代
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) return null;
    const out: Array<string | number> = [];
    for (let i = 0; i < n; i++) {
      const seg = path[i];                                                   // 仅索引访问
      if (typeof seg !== 'string' && typeof seg !== 'number') return null;   // 段域检查（B15 尾段 Symbol 在此被捕）
      out.push(seg);
    }
    return out;                                                              // 普通数组副本（原型 Array.prototype、标准迭代器）
  } catch {
    return null;                                                             // 敌意 trap/意外异常 → 收敛 null，绝不外抛
  }
}
```

  设计要点：

  1. **单点、输入域、内层 try**：内层 try 只包裹敌意 path 扫描本身，**不包裹** `resolveSchemaAtPath` 调用（D4 可信域通道保持零 catch）——两域处置在代码结构上物理分离，与 vfsl AGENTS「敌意输入走判别联合、可信域畸形 throw」二分在组合面的对偶一致。
  2. **绝不调用迭代协议**：扫描、拷贝、长度读取全部为普通 [[Get]]/元操作；`Symbol.iterator` 只做**同一性比较**（属性读，不调用）——T1 的敌意迭代器函数从头到尾不被调用（测试以调用计数器断言）。
  3. **迭代纯度校验的职责**：使「exotic-but-indexable 但索引读正常」的数组（重定义迭代器的真数组 T1、对 `Symbol.iterator` 键抛出的 Proxy T2）确定收敛 null——仅靠索引扫描无法与普通数组区分这两类，而**部分信任敌意对象**（扫出什么信什么）正是 F-1 要求废弃的姿势；敌意对象的语义不可信（可非确定、可有副作用），纪律是 fail-closed 收敛（null），与 doc-runtime `safeSpreadPath` 敌意数组坍缩为 `[]` 同一姿势的 schema 面对偶。
  4. **普通数组副本传 resolver**：通过校验后传副本而非原对象——即便未来 resolver 内部消费方式演变（其 `for..of`/`[...path]` 均只见普通数组），防御自包含、不依赖 resolver 实现细节；成本 O(path)，与值通道导航同阶。
  5. **段语义不在此重复**：守卫只做**句法域**检查（普通数组 + string|number），段的语义合法性（整数性、非负、keyPattern）仍由 resolver 两码单义收敛——D3 原有「resolver 是段语义唯一裁决者」保持，红 #11/#12 行为零变化。
  6. **红契约透明性**：普通合法 path（`[]`、`['count']`、`['skus','ZZ1']` 等）逐项通过校验，副本与原数组逐元素相等——红 #1–#15、负控 6、类型锚 2 行为零变化（SA2 F-1 验收 ④）。

  **备选否决**（D3b 机制）：
  - ① **索引扫描 + 副本传递，但不做迭代纯度校验**（SA2 required-change 文本的最小字面读法）：对 T1/T2 的敌意迭代器不再触发任何迭代，读面确实不抛——但 exotic 输入将得到**由扫描副本解析出的非 null schema**，与 SA2 F-1 验收 ①② 明确断言的 `schema:null` 不符，且实质是部分信任敌意对象（见要点 3），否决；
  - ② **把原对象直递 resolver 并在 resolver 调用外包 catch**：catch 无法在不吞可信域 `InternalError` 的前提下区分两域异常（`InternalError` 未导出、B16，深模块导入违反 DENY），且「先让敌意 trap 抛再收编」违反「绝不调用迭代协议」，否决；
  - ③ **spread/`Array.from` 拷贝**：恰好触发被防御的迭代协议陷阱（doc-runtime `safeSpreadPath` 注释明载该威胁模型），否决；
  - ④ **`Object.getOwnPropertyDescriptor(path, Symbol.iterator)` 描述符级探测**：描述符读绕过 [[Get]]，检不出 Proxy `get` 陷阱型敌意（T2），否决。

- **情形②/③**（resolver 两码）：`SCHEMA_PATH_NOT_FOUND`（路径偏离 schema 或 keyPattern 失配）/`SCHEMA_PATH_INVALID`（形状守卫——D3b 后仅可达于普通数组副本的语义级拒绝）**不细分、不透传**——ADR-0016「三种情形不区分……不承诺缺席原因分类」。红 #12 的同 map 合法/失配键对照由同一规则自然满足。
- 双条件（schemaState + activeTools）：语义上 installActive 单点原子安装使两条件等价（B4）；`activeTools === undefined` 检查同时服务 TS 非空收窄。二者与皆为 belt-and-suspenders，无第三状态。
- **备选否决**（D3 整体）：按 `state.fatal`/`schemaState` 细分 null 原因并透传码（ADR-0016 被否备选「schema 子通道结果联合」明文拒绝）。

### D4 可信域 `InternalError` 处置 = **throw 逃逸读面**（SA8 红线 4 钉死 + SA8 设计后复审 no-conflict；F-1 修订后划界不变）

**决策**：组合层对 `resolveSchemaAtPath` **不加任何 try/catch**——可信域畸形 derived（ref 目标缺失、值树引用环、两树分歧、root/ROOT 缺失、derived 非对象、Pattern 判定中四类引擎错误之外的意外异常）throw 的 `InternalError` 直接逃逸 `readData`。不收敛 null、不降级失败码、不记 fatal 态、不发诊断（读面零副作用；ADR-0016 明示诊断日志不涉读面）。

**【F-1 修订】双域划界**（SA2 E-4 要求的公共契约改写）：iteration-0 的「internal-bug-only、生产不可达」单句表述**作废**，JSDoc/模块头注改为双域陈述：

> - **敌意/异态 path**（非普通数组、Proxy 或重定义 `Symbol.iterator`、长度异型、非 string\|number 段、path 属性读取抛出的任意异常）→ `schema: null`（ADR-0016 情形③收敛；读恒 ok、`value` 语义零影响、绝不外抛——镜像 doc-runtime `safeSpreadPath`/E100 敌意面纪律）；
> - **`InternalError`**（可信域畸形 derived）→ throw 逃逸（internal-bug-only、生产不可达——`activeTools.derived` 恒为自身 P0/SCHEMA 写槽 `compileSchemaEnvelope` ok 产物）。

论证链（1–5 条 iteration-0 已获 SA8 设计后复审逐条核验成立，SA2 E-3 亦核验成立；第 6 条按 F-1 改写）：

1. **层次纪律**：#272 契约红线 1 + vfsl 包边界（`packages/vfsl/AGENTS.md`：trusted-domain 畸形 → throw `InternalError`、不进结果联合、无顶层 catch）确立该通道为下层的**刻意 loud 设计**。组合层若 catch 后收敛 null，等于在上一层把下层刻意保持 loud 的内部缺陷通道静默化——层次纪律倒置，且违反「正常路径不变量缺失应 fail loud」。
2. **ADR 锚点**：ADR-0016「解析语义」明文「ref 目标缺失（畸形派生物）沿 validate-patch 先例抛 InternalError：**可信域契约，不进结果联合**」——null 情形③「静态解析失败」的文义载点是 resolver **结果联合两码**，InternalError 被 ADR 自己排除在外；ADR-0008「只有 internal bug 才抛异常」（L28）支持保留 throw。**同一句 L28 恰是 F-1 的反向依据**：敌意输入触发的 throw 不是 internal bug，预期失败应走结果面——这正是 D3b 把敌意域从 throw 通道剥离的母法根据（两域划界后 L28 对两域同时成立）。
3. **包内先例**：runtime 同步读面对内部损坏的既有处置就是 loud throw（B11：getSchema 载体异型 `SchemaProjectionError`；getMetadata 循环值原始 `RangeError` 逃逸且有测试锚）。readData 的 schema 附加（可信域半边）加入同一处置类是局部一致，不是新发明；**敌意半边**则加入 doc-runtime 敌意面收敛类（B15），同样有先例。
4. **可达性（修订后表述）**：`InternalError` 生产不可达（derived 出自自身 sequencer 槽内 vfsl 编译，可信域）；敌意 path 生产**可达**（公共参数），其处置是收敛 null 而非 throw。两类情形下各自的处置都是最优信号：可信域 loud throw 防 vfsl 回归被静默吞没；敌意域收敛 null 保「读恒 ok」公共契约。
5. **上游传承**：#272 设计 §10 对组合票的预售结论即「组合票无需**为合法派生物**新增 catch 通道」——合法派生物只产两码（D3 收敛 null）；畸形派生物的 throw 不是「需要 catch 的负担」而是需要保留的信号。D3b 不改变该结论：它收编的是**敌意输入**，不是派生物异常。
6. **文档义务（改写）**：`readData` JSDoc 与 `read-schema-projection.ts` 模块头注（两处）必须显式记录上述**双域**处置（敌意 → null；InternalError → throw 逃逸），并注明 D3b 内层 try 只包裹敌意 path 扫描、不包裹 resolver 调用——防止后续维护者把内层 try 误判为「F-1 前遗留的漏改」或误扩大到可信域。

**备选否决**（可信域收敛 `schema: null`）：静默掩盖 vfsl 回归/seam 误用（全部读面无错丢语义）；把「内部不变量破坏」伪装成「schema 缺席」的正常可观测状态——正是 ADR-0016 拒绝 schema 子通道时强调的「null 单义性」的反面滥用；且与 B11 先例冲突；SA8 设计后复审亦裁定收敛 null 读法与 L64 carve-out 及三情形穷尽枚举相抵（报告 §6 反事实核验）。**备选否决**（catch 后转 fatal 态/降级 PATH_NOT_ALLOWED）：读面必须零副作用、不进 sequencer（ADR-0008「原规则保持」）；把读途异常写成写侧状态机属于新的生命周期所有权，无 ADR 支持；doc-runtime E100「意外异常 → PATH_NOT_ALLOWED」先例针对**敌意数据面**（值读），不覆盖可信域 schema 面——两域处置差异是本仓既有原则（vfsl AGENTS 二分），F-1 修订使组合面完整继承该二分的**两半**（iteration-0 只继承了后半句）。

### D5 深拷贝实现（四件套整体、每次读）

新内部模块 `packages/namespace-runtime/src/read-schema-projection.ts`（不进 `index.ts` 公共面——包内相对导入消费，沿 `p0.ts`/`projection.ts` 先例）：

```ts
function detachReadSchemaProjection(resolved: ResolveSchemaAtPathOk): ReadDataSchemaProjection {
  const memo = new Map<object, unknown>();          // identity-memo：同节点 → 同副本（保共享同构 + DAG 不膨胀 + 环不发散）
  return {
    valueSchema: cloneValueSchema(resolved.valueSchema, memo),
    aliases: cloneAliasRecord(resolved.aliases, memo),
    docs: cloneDocsRecord(resolved.docs),
    aliasDocs: cloneDocsRecord(resolved.aliasDocs),
  };
}
```

- `cloneValueSchema`：逐 `kind` 显式分派递归克隆（object/fields/keyPattern、array/element、union/members/discriminator、optional/value、ref/name、enum/values、pattern/regex、scalar/type、xml），普通可变对象/数组字面量构造（原型 `Object.prototype`，**不冻结**——红 #14 `Object.isFrozen` 锚）；**memo 先登记后递归**（构造外壳 → `memo.set` → 递归填成员），对共享节点保共享、对假想环不发散（防御性——resolver 自身游走已带身份守卫，但拷贝器是独立遍历，不依赖该实现细节）。
- `cloneAliasRecord`/`cloneDocsRecord`：新 record + 每条目新数组（`[...entry]`）；string 原语直传。键写入用展开/逐键字面量构造（CreateDataPropertyOrThrow 语义，无 `__proto__` accessor 风险；且键域为可信 VFSL 标识符语法路径——tokenizer 标识符起始限 ASCII 字母（`_` 不可起始），`__proto__` 类键结构性不可达；SA2 N-5 独立核验成立——**实现注释必须保留该判断依据**，防未来重构退化为裸赋值）。
- docs/aliasDocs 虽为 resolver 每调用新鲜产物（B10），仍统一拷贝——**纪律自包含**：隔离不变量由本模块独立保证，不依赖 resolver 内部新鲜性实现细节（未来 resolver 重构不破 AC3）。
- 每次读全新 wrapper + 全新四件套（红 #13 五层 `not.toBe` + 三连续读互异 = 零缓存锚）；无模块级可变状态。
- **备选否决**：① `structuredClone`——满足共享保持与不冻结，但引入宿主 API 语义面而收益为零，显式分派每 kind 一行、可读可锚（SA6 §15.2 明示机制自由）；② JSON round-trip——语义等价但同样间接，且对 `undefined` 字段键与可读性无增益；③ 只拷贝 valueSchema/aliases（docs 依赖 resolver 新鲜性）——省两次浅拷贝但把 AC3 正确性押在跨包实现细节上，否决。
- **不变（F-1 修订不触及本决策；深拷贝输入 `resolved` 只来自 resolver ok 分支，敌意面已在 D3b 收敛）**。

### D6 registry 类型跟随（别名 + Equal 锁）

```ts
// packages/namespace-registry/src/types.ts（替换 L448–451）
/** lease.read 结果 = runtime read 正常联合 | released issue。 */
export type NamespaceLeaseReadDataResult =
  | NamespaceRuntimeReadDataResult
  | NamespaceLeaseReleasedIssue;
```

- 导入调整：从 `'@nomicore/namespace-runtime'` 增 `NamespaceRuntimeReadDataResult`，删不再使用的 `RuntimeReadDisabledResult` 导入与 `'@nomicore/doc-runtime'` 的 `ReadLogicalValueResult` 导入（types.ts 内两者均只服务旧 L449–450）。
- `lease.ts` **零改动**：`Equal` 锁（L383–391）以 `ReturnType<NamespaceRuntime['readData']>` 为基准，别名恰为该联合 + released → 锁自然保持编译绿（B8 的强制跟随点）。lease `readData` 直透传行为零变化（ADR-0016 §分层 L76）；D3b 收敛发生在 runtime 组合层内部，对 lease 是不可见的内部细节（结果面始终为联合成员）。
- registry 无需新增 `@nomicore/vfsl` 依赖（别名不直接提 `ReadDataSchemaProjection`；registry 测试锚已依赖 vfsl，B9）。
- **备选否决**：在 types.ts 结构性重写 ok 成员（第二份形状定义——与 runtime 漂移即被 Equal 锁打红，纯负担）。
- **不变（F-1 修订不触及本决策）**。

### D7 测试改锚策略（ADR-0016 Consequences 落实）

按站点类别三策略（保持各测试原断言意图，不弱化值断言）：

| 类别 | 策略 | 理由 |
|---|---|---|
| **typed stub**（`implements NamespaceRuntime` / 参数类型引用联合） | stub 返回字面量补 `schema: null`；对应 toEqual 断言补 `schema: null`（保持全等） | 类型锁强制（缺键即 TS2322）；stub 无 activeTools，`null` 是其诚实语义 |
| **`any` stub**（`makeMarkerRuntime`） | 同上补 `schema: null`（推荐，ADR Consequences「读结果 toEqual 全等断言需要更新」的字面义务） | 非类型强制（运行时仍绿），但保留 2 键字面量会误导后续读者 |
| **真实 runtime 的 toEqual 站点** | 改 `toMatchObject({ ok: true, value })`（值意图不变）；已断言 `schema.state === 'ready'` 的确定性站点可另加 `expect(r.schema).not.toBeNull()` | 真实 runtime 的 schema 在场性取决于 P0 是否已结算（open/create 返回即读的时序不受契约保证）——全等断言 P0 时序敏感会引入 flake；投影**内容**锚定集中在 SA6 红契约（namespace-runtime 包内），registry 编排测试不重复 |

补充发现（SA6 §10 清单之外，iteration-0 全仓 grep 实证）：SA6 §10 未枚举 `registry-sa7-cordis`（L184/L360）、`registry-persistence-contract`（L110/L114/L128）、`registry-plugin`（L196/L529）、`registry-sa7-phase5-dynamic`（L149/L198）、`registry-sa7-hostile`（L422）的 toEqual 站点，以及 3 个 stub 类（`registry-shutdown` L178、`registry-sa7-hostile` L154、`registry-sa7-concurrency` L160）与 `registry-open` `makeRuntime` 默认值（L184）、`registry-create` `makeMarkerRuntime`（L376）。完整站点清单见 §10/§11（含 SA2 N-1 补全的 4 处**无改动**站点留档）；根仓 `pnpm typecheck` + `pnpm test`（AC5）为完备性兜底门。

### D8 新增验收测试文件（F-1 修订新增）

新文件 `packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts`（见 §12 T1–T3 + 局部负控）：敌意 path 收敛契约的可执行锚——SA2 F-1 验收 ①②③ + 「合法 path 不受守卫影响」对照。使用 SA6 共享夹具 `readdata-schema-projection-fixture.ts` 的 `makeReadyRuntime()`（**import-only，不改夹具**——夹具在 DENY LIST）。文件命名匹配 vitest include `packages/*/test/**/*.test.ts`（SA6 §14 收录证据），被仓库真实入口收集。

## 8. 接口、状态机和数据流

### 8.1 公共类型变化总览

| 面 | 前 | 后 |
|---|---|---|
| `NamespaceRuntimeReadDataResult`（runtime.ts L116–118） | `ReadLogicalValueResult \| RuntimeReadDisabledResult` | `{ ok:true; value:unknown; schema: ReadDataSchemaProjection \| null } \| Extract<ReadLogicalValueResult, {ok:false}> \| RuntimeReadDisabledResult` |
| `NamespaceRuntime.readData`（接口 JSDoc + 实现 L438–446） | 零包装透传 | 组合：值透传 + schema 投影附加（D2 + D3b 双域契约 JSDoc） |
| `NamespaceLeaseReadDataResult`（registry types.ts L448–451） | `ReadLogicalValueResult \| RuntimeReadDisabledResult \| NamespaceLeaseReleasedIssue` | `NamespaceRuntimeReadDataResult \| NamespaceLeaseReleasedIssue` |
| 其余公共面（十二键键集、exports 键集、getSchema/getMetadata/getActiveSchema/getStatus、失败三分支、mutateData/replaceSchema/复制面） | — | **零变化**（AC4；负控 + exports 审计 + ownership 测试保持绿） |

无新增公共方法/参数/导出键/稳定码（`read-schema-projection.ts` 为包内模块；`index.ts` 仅注释更新；D3b 收敛走既有 `schema:null` 出口，非新结果分支）。

### 8.2 readData 状态机（读时序，全部同步、sequencer 之外）

```
readData(path)
  ├─ lifecycle ≠ ready ──────────────→ RuntimeReadDisabledResult（原样，无 schema 键）
  ├─ readLogicalValueAtPath(doc, path)                 ← 值通道：G0 + 索引导航 + 吸收（B15）
  │    ├─ ok:false ──────────────────→ PATH_NOT_ALLOWED 原样透传（无 schema 键，零 schema 工作）
  │    └─ ok:true (value)
  │         ├─ schemaState ≠ ready 或 activeTools 缺席 ──→ { ok:true, value, schema: null }   （D3a 情形①，含 fatal；不触碰 path）
  │         ├─ normalizeReadPath(path)（D3b：内层 try，仅属性读/索引读/迭代器同一性）
  │         │    ├─ 异态/异常/段域违规 ──→ { ok:true, value, schema: null }                   （敌意收敛，情形③；绝不外抛）
  │         │    └─ ok(normalized 副本)
  │         └─ resolveSchemaAtPath(derived, normalized) ← resolver 只见普通数组副本
  │              ├─ ok:false（两码）────────────→ { ok:true, value, schema: null }            （情形②③）
  │              ├─ throw InternalError ──────────→ 逃逸（internal-bug-only，D4——唯一逃逸 throw）
  │              └─ ok:true ────────────────────→ { ok:true, value, schema: 深拷贝四件套 }    （D5）
```

与既有状态的交互：preparing（P0 未结算）读不等待、值可用、schema null（负控锚）；unavailable/fatal 同理；SCHEMA 写槽 `installActive` 换装 derived 后的下一次读即见新投影（JS 单线程，同步读观察一致快照——`state` 读取与 resolver 消费之间无 await，无撕裂）；close 停接纳先行短路（schema 通道不可达）。**敌意 path 与状态机的组合**：非 ready 态下敌意 path 同样收敛 null（D3a 先出，不执行敌意属性读）；ready 态下敌意 path 的值读结果完全由 doc-runtime 决定（含吸收式 ok），schema 恒 null（D3b）。

### 8.3 数据流路线

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| R1 readData 组合（纯内存，同步） | 调用方传 `path`（**敌意通道**） | 每次读创建：值副本（doc-runtime P1）+ 投影四件套副本（D5）+ path 普通数组副本（D3b） | doc-runtime 值读（索引导航、schema 无关）→ D3b 敌意 path 规范化（内层 try、仅属性读/索引读、迭代器同一性；异态 → null）→ resolver 双游标解析（只见副本；对 `activeTools.derived` 只读）→ identity-memo 深拷贝（活 derived 零出站） | 无（进程内返回值；零缓存零模块状态） | ok 分支恰三键；schema 为 detached 投影或 null | 值语义零变化 + schema 随值在场；敌意 path 不抛、收敛 null | 失败三分支原样；InternalError 逃逸（internal-bug-only，唯一 throw）；无资源需清理 | 红 #1–#15 + 负控 6 + 类型锚 2 + **T1–T3（F-1）** |
| R2 lease 透传（跨包边界） | Host 经 lease.readData(path) | 无新写入 | released 短路 → `entry.runtime.readData(path)` 直传（跨进程内包边界，联合类型经别名跟随；D3b 为 runtime 内部细节，lease 不可见） | 无 | 同 R1 形状（两层类型一致） | 同 R1 | released issue 原样 | registry 类型锚 + Equal 锁编译绿 + registry 既有测试改锚后绿 |
| R3 边界声明 | — | — | **无**持久化/复制/wire/诊断变化：读面不产生变更日志事件（ADR-0016）；ReplicationSession raw 读面（可信域）不触；`getActiveSchema` 五字段身份与投影零共享（activeInfo 只含指纹字段）；D3b 对敌意 path 只做属性读（无写、无副作用调用——与 doc-runtime 值通道对 path 的触碰面同阶） | — | — | — | — | 负控 + 既有 replication/diagnostic 测试保持绿（根门） |

事实源：值的唯一事实源 = live Y.Doc ROOT 载体；schema 投影的事实源 = `activeTools.derived`（P0/SCHEMA 写槽安装的编译产物快照引用）。投影为**最终一致只读视图**：不缓存、不前写，每次读重解析重拷贝——与 live schema 的同步点 = 下一次读。

### 8.4 registry 跟随

types.ts 别名替换（D6）+ 导入清理；lease.ts / index.ts / 其余 registry 生产代码零改动。

## 9. 错误、恢复、并发和幂等

- **错误（双域划界后的通道枚举）**：读失败语义四通道——① `PATH_NOT_ALLOWED`（值导航失败，原样）；② `RUNTIME_READ_DISABLED`（lifecycle，原样）；③ lease released issue（registry 层，原样）；④ `schema: null` **不是失败**（ADR-0016：null 单义、读恒 ok）——收敛来源 = 三情形 + **D3b 敌意/异态 path 收敛（F-1 修订）**。**唯一 throw 通道 = `InternalError`**（D4，可信域 internal-bug-only，生产不可达，JSDoc 显式记录）；敌意输入**零 throw**（D3b 内层 try 收编一切敌意 trap/意外异常 → null）。正常路径无静默 fallback：值缺席显式 `undefined`（不省略键）、schema 缺席显式 `null`（非 undefined、非省略）。
- **恢复/重试**：readData 纯同步读，零副作用 → 任意重试安全；同输入连续读内容全等（红 #13）、引用互异（零缓存）。null 是终值非降级——不承诺后续重读转非 null（除状态机推进：preparing → ready 后自然非 null）。敌意 path 重试同收敛 null（D3b 确定性：只依赖属性读，无状态）。
- **并发**：readData 保持 sequencer 之外、同步、零 state 写（ADR-0008「原规则保持」）。JS 单线程下 `state.activeTools`/`schemaState` 读取与 resolver 消费之间无交错点（无 await）；与 SCHEMA 写槽换装 derived 的竞争 = 「读到旧或新快照」的线性一致观察，无撕裂。深拷贝器局部 memo（每次调用新建）——天然可重入；D3b 无共享状态。
- **幂等**：读幂等（零写、零缓存、零事件）；同一 (state 快照, path 值序列) 输入产出内容恒等投影（D3b 副本由确定性的属性读序列构成）。
- **资源/成本**：每次成功读 O(path × N + schema 子树) 解析 + 深拷贝 + O(path) 规范化副本（与值通道导航同阶，无新渐近项；ADR-0016 §交付纪律如实登记的取舍；缓存演进留 profiling 后加法）。递归深度受求值期 `MAX_TYPE_NESTING` 封顶 + memo 防环，无栈溢出新面。敌意长 path 的扫描成本与 doc-runtime 导航循环同阶（首个异态段即短路，B15 同姿势——值通道先行已支付同阶成本或已短路）。

## 10. 调用方影响矩阵

（全仓 grep `readData(` + `NamespaceRuntimeReadDataResult|NamespaceLeaseReadDataResult` 实证；`packages/vfsl/src/schema-check-cli.ts` 为同名本地函数，无关。**必改/推荐改/无改动三类齐全**；SA2 §9 全仓 grep 复核：改动类站点全部命中、无漏列的必改站点）

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `apps/yjs-server/src/app.ts` L546–550 | `result.ok` 判别后仅消费 `result.value`，构造自有 REST 结果 | 加法兼容（新键忽略）；REST 面先经 `isSegmentArray` 净化（SA2 N-3；op 分发层全程 try/catch 收编——app.ts L827 注释） | **无** | 源码亲读；根门兜底 |
| `packages/namespace-registry/src/lease.ts` readData | 直透传 runtime 结果 | 同（类型经别名跟随；D3b 为 runtime 内部细节） | **无**（Equal 锁零改动自然绿） | L276–278、L383–391 |
| `packages/namespace-registry/src/types.ts` L448–451 | 别名直引 doc-runtime 旧联合 | 别名 = runtime 联合 + released | 替换别名 + 导入清理（D6） | §8.4 |
| registry `index.ts` L45 | re-export 别名 | 不变（类型名/元数不变） | **无** | grep |
| `runtime-data-interface.test-d.ts` L19 / `registry-data-interface.test-d.ts` L20 | 结果赋给联合类型变量 | 赋值兼容（两侧同变） | **无** | 亲读 |
| `runtime-sync-read-face.test.ts`（L94–99、L153–160 等） | `ok` 判别 + `.value`/`.code` 访问 | 加法兼容 | **无** | 亲读 |
| `runtime-public-surface-ownership.test.ts` L171 | readData 仅作「非 Promise」探针 | 兼容 | **无** | 亲读 |
| `runtime-acceptance-exports-audit.test.ts` | 不涉 readData（exports 键集审计） | 值导出键集不变 | **无** | grep 零命中 |
| registry phase5/issue-226/node-dispose 等值消费 | `toMatchObject` / `.value` 访问 / cast 后读值 | 加法兼容 | **无**（`registry-node-dispose` L124 等已核实） | grep 逐站点 |
| **无改动类站点（SA2 N-1 补全留档）**：registry-open L945（失败分支字面量 override——D1 后仍类型合法）；registry-phase5-bootstrap-reset-r2-internal L271（`unknown` 假 runtime，无类型锁/无 toEqual 锚）；ws-replication `src/testing.ts` L47（bind 真实 lease 方法）；runtime-registry-internal-sa7-dynamic L57（宽松 `RuntimeLike` 类型） | 逐站点亲读（本设计复核与 SA2 一致）：四者均无需改，两道根门兜底 | 加法兼容 | **无** | SA2 §9 N-1 + 本设计亲核 |
| **typed stub：registry-open `makeRuntime`（L174–195，默认值 L184 + 覆盖参数类型 L176）** | 返回 `{ok:true,value}` 字面量 | 类型锁强制补 `schema: null` | **必改**（TS2322） | 亲读 L174–195 |
| **typed stub 类：registry-idle L229 / registry-sa7-rev1 L199 / registry-shutdown L178 / registry-sa7-hostile L154 / registry-sa7-concurrency L160（`implements NamespaceRuntime`）** | readData 返回 marker 字面量 | 同上补 `schema: null` | **必改** | grep `implements NamespaceRuntime` |
| **any stub：registry-create `makeMarkerRuntime` L376** | 返回 `{ok:true,value:marker}`（`any` 绕过类型锁） | 推荐补 `schema: null`（D7） | 推荐改（ADR Consequences 字面义务） | 亲读 L376–380 |
| **真实 runtime toEqual 站点：runtime-boundary-supplementary L91/L128（ready 态已断言）；registry-create L459/L1645；registry-open L356；registry-sa7-cordis L184/L360；registry-persistence-contract L110/L114/L128；registry-plugin L196/L529；registry-sa7-phase5-dynamic L149/L198** | `toEqual({ok:true,value})` | `toMatchObject({ok:true,value})`（P0 时序不敏感，D7；ready 态已断言的站点可另加 schema 非 null——registry-create L459 前一行已确定性断言 `schema.state==='ready'`，SA2 N-4） | **必改**（运行时红） | grep + 逐站点亲读 |
| **marker stub 断言站点：registry-create L513/L1765/L1766** | `toEqual({ok:true,value:'MARKER_*'})` 对 stub 返回 | stub 补 `schema: null` 后全等断言同步补 | **必改**（随 stub 改动） | 亲读 L509–516/L1747–1766 |
| **stub 站点断言：registry-open L815/L879；registry-idle 11 站点（L479/504/535/615/711/764/800/907/971/1055/1094）；registry-sa7-rev1 L546/L623/L686；registry-sa7-hostile L422** | `toEqual({ok:true,value})` 对 stub 返回 | 全等补 `schema: null`（stub 已改，保持全等强度） | **必改**（stub 改后原断言红） | grep 逐站点 |
| typed-access 投影 / codegen 消费者 | 忽略未知字段 | 加法兼容（ADR-0016 §分层明文） | **无** | ADR-0016 L77 |
| SA6 契约文件（红 15 + 负控 6 + 夹具 + 类型锚 2） | 红契约按目标形状断言 | 实现后自动翻绿（D3b 对合法 path 透明） | **禁改**（§11 DENY） | SA6 §13 |
| **新增：`runtime-readdata-hostile-path-guard.test.ts`（D8）** | 不存在（新文件） | F-1 敌意收敛锚 T1–T3 + 合法 path 对照 | **新增**（§11 ALLOW） | SA2 F-1 验收 ①–③ |

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/namespace-runtime/src/runtime.ts` | `NamespaceRuntimeReadDataResult` 重定型（D1）；`readData` ready 分支组合重写（D2）；接口/联合 JSDoc 更新（ADR-0016 组合语义 + **D4 双域 throw/null 契约**） | 组合边界唯一落点（ADR-0016 §分层 L75） |
| `packages/namespace-runtime/src/read-schema-projection.ts`（**新文件**） | `projectReadDataSchema`（D3a 状态守卫 + **D3b `normalizeReadPath` 敌意 path 规范化守卫** + resolver 调用）+ `detachReadSchemaProjection`/`cloneValueSchema`（D5 深拷贝）；模块头注记录双域处置与 D3b 内层 try 辖域（D4 文档义务） | 深拷贝、null 收敛与**敌意面收敛纪律**自包含单点；包内模块（不进公共面） |
| `packages/namespace-runtime/src/index.ts` | 头注「read 结果联合」表述更新（注释级；导出键集零变化） | 公共契约描述与实现一致（docs 纪律） |
| `packages/namespace-runtime/src/p0.ts` | L43 `activeTools` 注释按 ADR-0008 修订节更正（「derived 只经 readData 投影深拷贝进公共面；module/validator 仍永不」）（注释级，零行为） | 旧注释与已修订 D8 封口矛盾——陈术语清理（docs AGENTS） |
| `packages/namespace-registry/src/types.ts` | 别名替换 + 导入清理（D6） | AC1 两层类型一致；Equal 锁强制 |
| `packages/namespace-runtime/test/runtime-boundary-supplementary.test.ts` | L91/L128 两断言改锚（D7；ready 态确定性） | ADR-0016 Consequences |
| **`packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts`（**新文件**，D8）** | T1 重定义迭代器敌意数组 / T2 Proxy get 陷阱 / T3 尾段 Symbol 三条敌意收敛断言 + 合法 path 非 null 对照（import SA6 夹具，不改夹具） | **F-1 验收 ①②③ 的可执行锚**（SA2 §11：建议实现票 ALLOW 增补该测试文件——本版已并入） |
| `packages/namespace-registry/test/registry-open.test.ts` | `makeRuntime` 默认 readData + L356/L815/L879 改锚 | 同上（类型锁 + 运行时红） |
| `packages/namespace-registry/test/registry-create.test.ts` | `makeMarkerRuntime`（L376）+ L459/L513/L1645/L1765/L1766 改锚 | 同上 |
| `packages/namespace-registry/test/registry-idle.test.ts` | `ObservableRuntime` readData + 11 断言站点改锚 | 同上 |
| `packages/namespace-registry/test/registry-sa7-rev1.test.ts` | `ObservableRuntime` + L546/L623/L686 改锚 | 同上 |
| `packages/namespace-registry/test/registry-shutdown.test.ts` | `ObservableRuntime` readData 补 `schema: null` | 类型锁强制 |
| `packages/namespace-registry/test/registry-sa7-hostile.test.ts` | `ObservableRuntime` + L422 改锚 | 同上 |
| `packages/namespace-registry/test/registry-sa7-concurrency.test.ts` | `CountingRuntime` readData 补 `schema: null` | 类型锁强制 |
| `packages/namespace-registry/test/registry-sa7-cordis.test.ts` | L184/L360 改锚（toMatchObject） | 运行时红 |
| `packages/namespace-registry/test/registry-persistence-contract.test.ts` | L110/L114/L128 改锚（toMatchObject） | 运行时红 |
| `packages/namespace-registry/test/registry-plugin.test.ts` | L196/L529 改锚（toMatchObject） | 运行时红 |
| `packages/namespace-registry/test/registry-sa7-phase5-dynamic.test.ts` | L149/L198 改锚（toMatchObject） | 运行时红 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/doc-runtime/**` | 值读事实源（敌意面纪律先例所在——`safeSpreadPath`/E100 只读取证） | ADR-0016 §分层 L74 冻结；负控 #1/#2 + 类型守卫锚锁定「schema 无关」 |
| `packages/vfsl/**` | resolver/投影体事实源（#272 已落地并过门禁；其 path 守卫的迭代协议消费是**已知消费方式**，防御在组合面做，不改 resolver） | 本票纯消费；深拷贝边界归属已裁定在 runtime 侧（resolver 头注）；**不得为 B16 导出 `InternalError`**（SA8 移交项 2） |
| `packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts` | SA6 红契约（15） | 验收契约冻结——实现使其翻绿，禁改断言 |
| `packages/namespace-runtime/test/runtime-readdata-schema-projection-control.test.ts` | SA6 负控（6） | 同上（实现越界即红） |
| `packages/namespace-runtime/test/readdata-schema-projection-fixture.ts` | SA6 共享夹具（D8 新测试 **import-only**） | 同上 |
| `packages/namespace-runtime/test/runtime-readdata-schema-red.test-d.ts` | SA6 runtime 类型锚 | 同上 |
| `packages/namespace-registry/test/registry-readdata-schema-red.test-d.ts` | SA6 lease 类型锚 | 同上 |
| `packages/namespace-registry/src/lease.ts` | lease 透传 + Equal 锁 | 行为零变化（ADR-0016 L76）；锁零改动即绿，改反而引入行为风险 |
| `packages/namespace-registry/src/index.ts` | 公共面 re-export | 别名名/元数不变，无导出变化需求 |
| `apps/yjs-server/**` | REST 消费面 | 加法兼容（仅消费 value；N-3 已评估销项）；范围外 |
| `packages/namespace-runtime/src/p0.ts` 的**代码**（仅允许注释行） | activeTools 安装单点 | 行为零变化；installActive 语义不变 |
| `CONTEXT.md`、`docs/adr/**`、`docs/vfsl/**` | 母法与词汇 | 已随 PR #271 落地（B13）；本票不改决策（F-1 修订为既有文义实施，非新决策——SA2 结论同） |
| `packages/namespace-registry/src/` 其余生产文件、诊断/复制/持久化各包 | 无涉 | 读面单点变更；R3 边界声明 |

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1 形状（恰三键、两层类型一致） | SA6 红 #1（键集断言）+ 2 类型锚 + lease Equal 锁 | 红 #1–#7 运行 + `tsc -p tsconfig.typecheck.json` | ok 分支键集恰 `[ok,schema,value]`；两锚 `Extract` 非 never；锁编译绿 |
| AC2 null 三情形 + 缺席照常返 schema + 空路径 ROOT | SA6 红 #8–#12、#7、#1（预写） | 四态矩阵 + `['nick']`/`['skus','cd']` + `[]` | 值正确 + `schema` 分别为 null / 非 null（optional 包装保留）/ ROOT 四件套 |
| AC3 投影隔离（深拷贝、不冻结、零缓存、双向） | SA6 红 #13–#15（预写，HEAD 红） | 五层 `not.toBe` + 三连续读互异 + 三类改写 + `Object.isFrozen` false + `getActiveSchema` 身份不变 | 改写后新读 toEqual 原样；live schema 零污染 |
| AC4 always-on、无新增公共方法/参数、失败分支不变 | SA6 负控 6（HEAD 绿）+ exports 审计（HEAD 绿） | 负控 + `runtime-acceptance-exports-audit` + `runtime-public-surface-ownership` 保持运行 | 失败对象无 schema 键；值导出键集仍恰 `['RuntimeWriteFatalError']`；十二键不漂移 |
| AC5 两包测试（含 test-d）+ 根仓 `pnpm typecheck` / `pnpm test` 绿 | SA6 §4 基线（同步读面/审计 8/8 绿；全仓 tsc 仅 2 新锚红） | §11 ALLOW LIST 测试改锚后全套门 | 全绿；无既有测试回归 |
| **F-1 敌意 path 收敛（T1–T3，可执行验收，D8 新文件 `runtime-readdata-hostile-path-guard.test.ts`）** | 本设计 B14/B15（源码亲核）+ SA2 F-1 证据链；无既有契约锚（SA2 §12：「无任何契约/建议测试」缺口——本版补齐） | **T1**：`const arr = ['count'] as (string\|number)[]; let iteratorCalls = 0; Object.defineProperty(arr, Symbol.iterator, { value() { iteratorCalls++; throw new Error('hostile iterator'); } });` → ready runtime 上 `readData(arr)`：① 调用不抛（`expect(() => r).not.toThrow()` 或直接调用）；② 返回恰 `{ ok:true, value:3, schema:null }`；③ `iteratorCalls === 0`（敌意迭代器从未被调用）。**T2**：`const proxy = new Proxy(['count'], { get(t, p) { if (p === Symbol.iterator) throw new Error('hostile get'); return Reflect.get(t, p); } })` → `readData(proxy)` 不抛、恰 `{ ok:true, value:3, schema:null }`。**T3**：`readData(['absent-key', Symbol('rogue')] as any)` 不抛、恰 `{ ok:true, value:undefined, schema:null }` 且 `'schema' in r === true`（尾段 Symbol 经 D3b 段域检查收敛；值通道缺席吸收在 seg0 返回 undefined——B15）。**局部负控（同文件）**：合法 `['count']` 仍 `{ ok:true, value:3, schema }` 且 `schema` 非 null、toEqual 红 #2 字面量（守卫对 bona fide path 透明——防守卫过拒） | 三敌意输入全部：读恒 ok、值语义与 doc-runtime 一致、`schema === null`、零 throw、零敌意函数调用；合法 path 投影不回退（SA2 F-1 验收 ①②③） |
| **F-1 既有面回归（SA2 验收 ④）** | SA6 契约全套（HEAD 红/绿基线在案） | 红 15 + 负控 6 + 类型锚 2 + 根仓两门在实现后全套重跑 | 全绿不受影响（D3b 对合法 path 逐元素透明） |
| D4 InternalError 逃逸（设计钉死面，可信域） | 无契约锚（SA6 §15.1 显式不锁；SA8 移交项 4 建议采纳） | **建议新增**（可选，非验收门）：包内 seam 注入伪造 compile 返回畸形 derived → `readData` 断言 throw——按 **N-2 修订**：以构造名/message 匹配断言（`expect(() => …).toThrowError(/InternalError/)` 或 `err.constructor.name === 'InternalError'`），**勿用类引用**（B16：未导出；沿 getMetadata 原始 `RangeError` 锚先例精神），勿为此导出该类 | throw 逃逸（构造名/message 匹配 InternalError）；不返回 `{ok:true,...,schema:null}` 掩盖 |
| D7 改锚完备性 | 本设计 §10 全仓 grep 站点清单（含 N-1 无改动 4 站点留档） | 根仓 `pnpm typecheck`（类型锁强制面）+ `pnpm test`（运行时红面） | 两门全绿 = 无漏改站点 |
| P0 时序不敏感 | §7-D7 分类依据（open/create 即读无 ready 保证） | 改锚站点全部用 `toMatchObject`（真实 runtime 类） | 无 flake（多次运行稳定） |
| 读面零副作用（不进 sequencer/诊断） | ADR-0008 修订节第 3 条 + B3 原序 | 既有 sequencer/diagnostic/replication 测试套（根门） | 保持绿 |

## 13. 风险、回滚和残余问题

**风险**

| # | 风险 | 等级 | 缓解 | 残余 |
|---|---|---|---|---|
| R1 | registry 测试改锚站点多（~40 断言 + 6 stub 工厂/类）且分两类策略，机械改错（如给真实 runtime 站点硬编码 `schema:null`）会造假绿/假红 | 中 | §10 矩阵逐站点分类 + D7 三策略表；两道根门（typecheck 抓 typed stub 漏改、test 抓运行时红）+ 全仓 grep 复核清单在案（含 N-1 补全留档） | 人工核对成本；门禁兜底 |
| R2 | ~~D4 与 SA2 评审预期可能分歧~~ **已消解**：SA8 设计后复审对「throw 逃逸」裁定 no-conflict；SA2 F-1 明示修订后「D4 对可信域的裁定与 SA8 复审结论不变」，reject 仅针对敌意通道缺口 | 低（原中） | D4 双域表述 + JSDoc 义务；§15 对 SA8 实现阶段复查清单第 1 条「组合层无 catch」与 D3b 内层 try 的辖域区分提交窄域复查（内层 try 仅包裹敌意扫描，不包裹 resolver 调用） | 复核确认措辞辖域（§15） |
| R3 | 每次读深拷贝成本（O(schema 子树)）在大 schema 高频读场景放大 | 低 | ADR-0016 §交付纪律如实登记的取舍；零缓存是契约（红 #13 三连续读互异锚）——不得以缓存「优化」破契约 | profiling 后按 generation 缓存 = ADR 预留加法演进（follow-up） |
| R4 | 深拷贝器对假想共享/环节点的不终止 | 低 | identity-memo 先登记后递归（D5）；resolver 自身游走已带身份守卫；求值期嵌套封顶 | 无（防御性设计） |
| R5 | `Extract<ReadLogicalValueResult, {ok:false}>` 依赖 doc-runtime 失败成员形状稳定 | 低 | doc-runtime 冻结（负控 + 类型守卫双锚锁「schema 无关」）；形状漂移即两包 typecheck 红 | 无 |
| R6 | registry `any` stub（makeMarkerRuntime）不补 `schema:null` 时测试仍绿——契约诚实性欠账 | 低 | D7 推荐 + ALLOW LIST 列名 | 若实现票裁撤该项，无验收影响（门全绿），仅文档诚实性 |
| **R7（新，F-1）** | D3b 迭代纯度校验对**跨 realm 普通数组**收敛 null（其 `[Symbol.iterator]` 是另一 realm 的 Array.prototype 迭代器，同一性比较不等）——值读不受影响（doc-runtime 只查 `Array.isArray`），但 schema 将 null | 低 | fail-closed 且契约合法（null 非失败）；本仓全部调用方为同 realm（进程内库；REST 层 JSON.parse 产物为同 realm 数组）；T1–T3 + 红契约锚定主导行为 | 跨 realm path 非支持场景；若未来出现，放宽为 realm 容忍比较（如 `path.constructor?.prototype?.[Symbol.iterator]` 同一性）是加法演进 |
| **R8（新，F-1）** | 敌意长 path（Proxy 谎报 `length` 巨值且逐段返回合法 string）使 D3b 扫描与 doc-runtime 导航同样长跑——DoS 面 | 低 | 成本与值通道严格同阶（B15 同姿势：值读先行已支付或已短路；首个异态段即 return null）；不引入值通道没有的新上限/新循环 | 与 doc-runtime 既有敌意面成本对等，无新增渐近项 |

**回滚**：纯读面单点变更、无数据迁移/wire/持久化/缓存失效——回滚 = revert §11 生产面 5 处（runtime.ts、新模块 read-schema-projection.ts、index.ts 注释、p0.ts 注释、registry types.ts）+ 测试改锚与新增测试文件提交；契约测试随之回到红基线（缺 schema），负控回绿。租约/复制/持久化状态零影响。

**任务内必要条件**：无未解决项——SA6 契约在位且可执行、依赖面（#272 表面）就位、设计决策全部钉死（D1–D8，含 F-1 敌意面）、SA2 reject 的唯一阻断项已在本版落实（§14）。

**明确的 follow-up（非本票）**：

1. （仅当 profiling 证明成本瓶颈）按 schema generation 的投影缓存——ADR-0016 预留加法演进，须保持跨读隔离语义。
2. （仅当出现真实消费者）schema 缺席原因摘要（`schemaIssue` 类）——ADR-0016 被否备选注明的加法路径，须 ADR。
3. registry 导入面「未知方言只读」null 情形的独立锚定（SA6 §15.4 移交；本票守卫已天然覆盖其行为）。
4. 工作流纪律（SA8 红线 7）：实现 PR 栈接 `docs/adr-0016-readdata-schema` 支系（PR #271 OPEN 为设计使然）；勿基于陈旧本地 `origin/main`（`6a005a4`；真实 main `a4037cf`）rebase——由 Host/Runner 执行。
5. （仅当出现跨 realm 调用方）D3b 迭代纯度校验的 realm 容忍放宽（R7）——加法演进，先锚定后放宽。

## 14. 评审修订映射（SA2 `task_issue-273_sa2_review.md`，iteration 0 → 本版逐条落实）

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **F-1（MAJOR，reject 唯一阻断项）**：敌意/exotic path 经 resolver 迭代协议产生生产可达非 InternalError throw；D2「INVALID 结构上不可达」论断错误；D4 JSDoc「internal-bug-only、生产不可达」失真 | **守卫**：§7-D3b（`normalizeReadPath` 全量规格 + 四备选否决）+ §8.2 状态机插层 + §8.3 R1；**论断撤销**：§7-D2 改写（值读成功不证明 path 普通——B15 吸收语义反例）+ §2 B14/B15/B16 事实行；**文档契约改写**：§7-D4 双域表述 + D4 论证 2（L28 两域同真）+ 论证 6 改写 + §1 目标句；**测试**：§7-D8 + §12 T1–T3（可执行断言逐字落实 SA2 验收 ①②③）+ §11 ALLOW 增补 `runtime-readdata-hostile-path-guard.test.ts`；**风险**：§13 R7/R8 | **已落实**——敌意 path 全谱收敛 `schema:null`（读恒 ok、值语义零影响、零 throw、零敌意函数调用），`InternalError` 保持唯一逃逸 throw（内层 try 只包裹敌意扫描、不包裹 resolver 调用——两域物理分离），D4 可信域裁定与 SA8 复审结论不变 |
| N-1（§10「完整清单」措辞与事实有出入：4 处无改动站点未列） | §10 新增「无改动类站点（SA2 N-1 补全留档）」行（registry-open L945 / registry-phase5-bootstrap-reset-r2-internal L271 / ws-replication `src/testing.ts` L47 / runtime-registry-internal-sa7-dynamic L57——本设计逐站点复核一致，均无需改）+ §7-D7 措辞改「完整站点清单见 §10/§11（含 N-1 补全的 4 处无改动站点留档）」 | 已落实——清单完备性修正并留档；grep 复核清单不再被引为唯一范围依据（两道根门兜底自始在案） |
| N-2（D4 可选负向测试 `toThrow(InternalError)` 类引用不可行——类未导出，勿为此导出） | §12 D4 行改按构造名/message 匹配断言（`toThrowError(/InternalError/)` 或 `err.constructor.name`）；§2 B16 事实行；§11 DENY vfsl/** 行加「不得为 B16 导出 InternalError」 | 已落实 |
| N-3（apps/yjs-server 外层收编评估——SA8 移交项 3 销项） | §10 yjs-server 行（`isSegmentArray` 净化 + op 分发层全程 try/catch 收编 app.ts L827 + F-1 修订后该面 throw 概率进一步归零）+ §6 移交项 3 行 | 已落实——留档销项，无改动结论维持 |
| N-4（registry-create L459 为确定性站点可加非 null 断言） | §10 真实 runtime toEqual 站点行（括注 N-4：L459 前一行已断言 `schema.state==='ready'`，可另加 `expect(r.schema).not.toBeNull()`——非义务） | 已落实——保留为实现票可选项（非义务，与 D7 一致） |
| N-5（D5 免 putPlainKey 判断依据须在实现注释保留） | §7-D5（「tokenizer 标识符起始限 ASCII 字母 ⇒ `__proto__` 键结构性不可达；SA2 N-5 独立核验成立——**实现注释必须保留该判断依据**，防未来重构退化为裸赋值」） | 已落实 |
| SA2 §6 SM-6（D2「结构性不可达」反例：`['absent-key', Symbol()]` 行为无害但论断错误） | §7-D2 撤销论断 + §2 B15 + §12 T3（该输入现为显式验收锚：ok + value:undefined + schema:null） | 已落实——反例从「无害未析」升级为「设计内锚定」 |
| SA2 §8 E-4 / §10 责任归属（敌意 path 处置缺位——「消费敌意面的层以结果面收编」） | §7-D3b（组合面对自己消费的敌意面负责）+ §1 目标 + §9 通道枚举 | 已落实 |
| SA2 §12 验收设计（敌意 path 通道「无任何契约/建议测试」缺口） | §12 F-1 行（T1–T3 + 局部负控 + SA2 验收 ④ 既有面回归） | 已落实 |
| SA2 结论行「无需新的 ADR 冲突复查（敌意输入 → 结果面/null 是 ADR-0016 情形③ 与 ADR-0008 L28 既有文义，非新决策）」 | §6 表（ADR-0008 修订节行）、§11 DENY（docs/adr/** 行）、§15 | 采纳为本设计立场；§15 另对 SA8 实现阶段复查清单第 1 条的措辞辖域提交窄域确认（非新决策复查） |

## 15. 是否需要设计后 ADR 冲突复查及理由

**结论：需要（`requiresConflictRecheck: true`），范围收窄为一点辖域确认；无新决策面复查。**

1. **iteration-0 的 D4 复查已闭合**：iteration-0 自报复查 → SA8 设计后复审裁定 D4（InternalError throw 逃逸）= no-conflict（含 ADR-0008 L28 常设抛错政策的组合面延续定性）；同时 SA8 报告 §10 已对**实现阶段** armed 复查清单（公共 API 形状演进 + 失败语义，待实际 diff 核对）。本版不重开该面。
2. **F-1 修订不构成新决策**（SA2 结论行同）：敌意输入 → 结果面收敛（`schema:null`，情形③出口）是 ADR-0016 L22 情形③ + ADR-0008 L28「预期失败走结果联合」的既有文义实施，且与 doc-runtime 同敌意面既定纪律（`safeSpreadPath`/E100 先例）同向；不新增结果分支/稳定码/生命周期所有权。设计 §11 DENY `docs/adr/**` 与该结论自洽。
3. **唯一需 SA8 确认的辖域点**：SA8 设计后复审 §10 清单第 1 条字面为「D4 按钉死落地：组合层**无 catch**（不收敛 null、不降级码、不记 fatal、不发诊断），`InternalError` 逃逸」。本版 D3b 在组合层**新增一个内层 try**——它只包裹敌意 path 规范化扫描（输入域），**不包裹** `resolveSchemaAtPath` 调用，故已获裁定的命题「组合层对 `resolveSchemaAtPath` 不加任何 try/catch」逐字保持为真；但复查清单的字面措辞（「组合层无 catch」）与该内层 try 存在解读张力，宜由 SA8 在执行（已 armed 的）实现阶段复查时正式确认辖域区分：内层 try = 敌意输入收编（safeSpreadPath 对偶），非 InternalError 通道收敛。设计已在 D3b 要点 1 与 D4 论证 6 显式记录该区分，供复查直接核对。
4. **若复查改裁**（要求内层 try 移除或改为其他形式）：实现影响面 = `normalizeReadPath` 单函数 + T1–T2 断言改写，§11 文件范围不变；AC1–AC5 验收面不受影响（SA6 契约不含敌意 path 锚）。
