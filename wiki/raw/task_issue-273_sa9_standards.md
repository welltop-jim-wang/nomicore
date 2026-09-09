# SA9 Standards 审查报告 — Issue #273（namespace-runtime + namespace-registry：readData 成功分支返回语义 schema 投影，ADR 0016 实施票）

> SA9（独立 Standards 审查者）standards-review 轮产物。dispatch
> `sa-01e7e93d-ad2f-4574-92c2-e243cdcc8352`，phase standards-review，iteration 0。
> **Worktree**: `/home/wangjian/nomicore-fix-issue-273`（branch `mabf/issue-273`）。
> **被审对象**: HEAD `76966d2`（实现提交 `feat(namespace): project schema from readData`）
> 的完整交付 diff `1acd9e9..76966d2`——33 文件 +2658/−65（git show --stat 本轮亲证）；
> 父提交 `1acd9e97e000880ea0c98eb63bd1dffdd5ef92aa`（#272 合并提交 = PR #271 支系头，
> git rev-parse HEAD~1 亲证，与 dispatch 声明的 base `1acd9e97` 一致）。工作树除未跟踪
> 简报 `task_issue-273.md` 与 dispatch 追加行（本 phase 记录）外干净。
> **Issue 评论输入**: dispatch 明示 REST 当前读 = none；简报 §Comments、SA6 §2、SA8 三
> 报告、SA2 §4、SA4 §1 多处一致同载——无 Owner 追加要求需并入，本轮无一遗漏面。
> **输入产物（全部亲读）**: `task_issue-273.md`（简报，AC1–AC5）、
> `task_issue-273_design.md`（SA1 iteration-1 F-1 修订版，469 行全文，D1–D8）、
> `task_issue-273_sa2_review.md`（iter-0 reject F-1 + iter-1 pass，322 行全文）、
> `task_issue-273_sa3_impl.md`（含 Deviations #1 披露）、
> `task_issue-273_sa4_review.md`（approve，0 BLOCKER/MAJOR，O-1–O-5 MINOR）、
> `task_issue-273_sa6_contract.md`（approve，15 红 + 6 负控 + 2 类型锚 + 夹具）、
> `task_issue-273_conflict_report.md`（clear，红线 7）、
> `task_issue-273_design_conflict_report.md`（clear，D4 no-conflict）、
> `task_issue-273_design_conflict_report_iter2.md`（clear，C5 辖域确认，§10 六条清单
> armed）、ADR-0016 全文（98 行）、根/docs/namespace-runtime/namespace-registry
> AGENTS.md、新模块 220 行全文、runtime.ts/types.ts/index.ts/p0.ts 全量 diff、
> 全部测试 diff 逐 hunk、SA6 五契约文件全文/抽检。
> **审查方式**: 独立取证，非结论复用——全部源码锚点亲验（runtime.ts 组合分支逐行、
> normalizeReadPath 守卫逐行、cloneValueSchema 九 kind 分派对 vfsl derived.ts
> ValueSchema 联合逐 member、p0.ts fatal/schemaState 迁移（B5）、lease.ts Equal 锁
> L383–391、installActive 单点）+ 定向 grep（DENY 面 diff 零命中、skip/only/todo 零
> 命中、read-schema-projection 于 index.ts 零导出）+ 测试计数清点（15/6/4）+ runner
> 入口配置亲证（vitest include/typecheck include/tsconfig.typecheck.json/package.json
> scripts）。未运行测试、未启动服务（SA9 纪律）；零代码/设计/测试改动；零
> commit/push/PR；唯一写入 = 本文件。
> **职责面**: 只判断实现是否符合仓库 AGENTS、ADR、模块责任、既有架构惯例、单一事实源、
> 生命周期对称性、文件范围与测试质量标准；Issue 需求完整实现归属 SA10。

---

## Verdict

**approve**（`requiresConflictRecheck: false`）

- **0 BLOCKER / 0 MAJOR**。交付 diff 在包边界与 AGENTS 链、ADR 合规、模块责任、架构
  惯例、单一事实源、生命周期对称性、文件范围、测试质量八个 standards 面全部合规
  （§1–§8）。
- 唯一 ALLOW 外改动（`runtime-mutate-root-sequencer.test.ts` AC9 改锚）经独立复核定性
  为设计 ALLOW 清单的经验性遗漏 + 批准设计自身钉死行为（D4）的必然落锚——SA3 如实
  披露、SA4 按仓内先例裁非阻断，本轮维持 **MINOR**（§7/§9），不升级为阻断项。
- SA4 批准的 5 枚 MINOR（O-1–O-5）经本轮独立复核均定性准确、无一升级（§9）。
- 流程面合规：SA8 前置门禁 clear + 设计后复审 clear ×2（iter-2 对 F-1 修订版专项
  clear 并闭合 C5 辖域确认）、SA6 契约 approve、SA2 reject(F-1)→pass（修订落实）、
  SA3 实现、SA4 approve——审查链完整，无跳级、无未决阻断项。

---

## 1. 包边界与 AGENTS.md 链（根 / docs / namespace-runtime / namespace-registry）

| 规约 | 本轮亲证 | 判定 |
|---|---|---|
| namespace-runtime AGENTS「Reads stay outside that sequencer」 | `readData` 组合为同步箭头函数体（runtime.ts L461–473）：lifecycle gate → 值读 → 失败短路 → 恰三键构造；零 sequencer 进入、零 state 写、零诊断事件（ADR-0016 L77） | ✅ |
| namespace-runtime AGENTS「Public APIs expose detached projections only. The owned handle, live Y.Doc, writable roots, sequencer … remain internal」 | schema 投影每次读整体 identity-memo 深拷贝（read-schema-projection.ts L106–220），活 `activeTools.derived` 零出站；新模块 `read-schema-projection.ts` 不进 index.ts 公共面（grep 亲证 index.ts 仅头注提及，零导出） | ✅ |
| namespace-runtime AGENTS「internal fatal state permanently disables writes while retaining reads」 | fatal 期 D3a 天然覆盖（p0.ts L121–131 亲证：⑦ 只置 fatal/fatalCause，schemaState 停留 `'preparing'`、activeTools 未安装）→ `schema:null` 读恒 ok | ✅ |
| namespace-runtime AGENTS Verification「Run root `pnpm typecheck` and `pnpm test` before completing any runtime … contract change」 | SA3 报告两门 exit 0（3203 测试全绿、Type Errors 无）；SA4 静态佐证（文件/用例计数、入口真实性）；SA9 纪律不复跑，留 SA7/Controller 动态复核项 | ✅（证据面） |
| namespace-registry AGENTS「Add public APIs only through `src/index.ts`」 | registry 唯一生产改动 = types.ts 别名替换 + 导入清理（D6）；index.ts 零改动（diff 实证）；无新增公共方法/参数/导出键/稳定码 | ✅ |
| 根 AGENTS「typed Namespace writes 强制」 | 本票为**读面**变更，不触 mutation 路径/生成面（domains/** 零改动，diff 实证）；该强制不触发 | ✅（不适用） |
| 根 AGENTS「Before changing files under packages/ read nearest nested AGENTS.md」 | 两包 AGENTS 被遵守且无需随票修订（两包 AGENTS 均未枚举 readData 形状，无被新行为抵触的条款——逐条比对） | ✅ |
| docs/AGENTS「代码行为变更须同步更新规范文档；documentation-only 改动不得发明行为」 | 规范面（ADR-0016 + ADR-0008 修订节 + CONTEXT 两词条）已在 base PR #271 落仓（本票 DENY 正确不触）；p0.ts L42–44 注释按修订节逐字改写（「derived 只经 readData 语义 schema 投影的受控只读深拷贝进入公共面；module/validator 仍永不」）= 描述 ADR 明文与已实现行为，非发明 | ✅ |
| wiki/raw 工件定位（证据非规范） | 9 枚流程工件随实现提交（dispatch/简报链 8 + 本 SA9 后续），与仓内 task_228/task_issue-272 先例一致 | ✅ |

## 2. ADR 合规（ADR-0016 为直接母法 + ADR-0008 修订节，逐条亲证）

| ADR 明文 | 实现落点 | 判定 |
|---|---|---|
| ADR-0016 结果形状 `{ ok:true; value:unknown; schema: ReadDataSchemaProjection \| null }`，ok 恰三键 | runtime.ts L117–127 联合重定型（ok 成员恰三键 + `ReadLogicalValueFailure = Extract<…,{ok:false}>` 单源派生 + `RuntimeReadDisabledResult` 逐字）；L473 显式构造 `{ ok:true, value: result.value, schema: … }` | ✅ |
| null 三情形不区分、无缺席原因子通道、null 非失败 | `projectReadDataSchema` L46–57：D3a 状态守卫（①）+ D3b 敌意守卫 + resolver 两码 `!resolved.ok`（②③）同走单一 `null` 出口；无 `schemaIssue`、无码透传（ADR-0016 L87 被否备选遵守） | ✅ |
| 失败分支不变（PATH_NOT_ALLOWED / RUNTIME_READ_DISABLED / released） | L461–473 gate 原序 + 失败短路原样透传（失败对象不带 schema 键、零 schema 工作）；lease.ts released 短路零改动；负控 #3/#4 锚 `'schema' in r === false` | ✅ |
| 值缺席照常返 schema（路径键控）；空路径 ROOT 投影 | resolver 路径键控（红 #7 `['nick']`/`['skus','cd']` value 显式 undefined + schema 非 null；红 #1 `[]` ROOT 四件套） | ✅ |
| 每次读深拷贝：detached、可变普通副本、不冻结、零缓存 | `detachReadSchemaProjection` 每次调用全新 memo + 全新四件套；逐 kind 显式分派普通字面量构造（不冻结）；零模块级状态（grep 亲证） | ✅ |
| always-on、无 opt-in 开关、无新增公共方法/参数 | 成功分支恒附加；十二键/exports 键集零变化（index.ts diff 仅头注注释块，导出键集亲证不变——`NamespaceRuntimeReadDataResult`/`RuntimeReadDisabledResult` 等原样） | ✅ |
| 分层：doc-runtime 不动 / runtime 组合 / registry 仅别名跟随 | doc-runtime、vfsl 零改动（diff 实证）；组合单点 `read-schema-projection.ts`；types.ts 别名 = `NamespaceRuntimeReadDataResult \| NamespaceLeaseReleasedIssue`，lease.ts 零改动、Equal 锁（L383–391）以 `ReturnType<NamespaceRuntime['readData']>` 为基准自然绿 | ✅ |
| ADR-0008 修订节 D8 封口（derived 只经投影深拷贝进公共面；module/validator 仍永不） | 组合面只递出投影副本；p0.ts activeTools 注释同步更正（注释级，零代码行——diff 亲证仅 L42–44 注释） | ✅ |
| ADR-0008 L28（只有 internal bug 才抛异常）双域同真 | 敌意域：D3b `normalizeReadPath` 内层 try 收编一切敌意 trap/异态 → null，绝不外抛（L80–96）；可信域：resolver 调用在任何 try 之外（L56），`InternalError` 唯一逃逸 throw——两域在代码结构上物理分离（SA8 iter-2 C5 辖域确认逐字兑现） | ✅ |
| ADR-0016 L64 InternalError 不进结果联合 | 组合层对 `resolveSchemaAtPath` 零 catch（L56 亲证）；不收敛 null、不降级码、不记 fatal、不发诊断 | ✅ |
| ADR-0016 Consequences（toEqual 全等断言需更新；toMatchObject 加法兼容） | D7 三策略严格执行（§7/§8）；残留 `toEqual({ok:true,value…})` 全仓扫唯一命中为 doc-runtime 直读负控面（应保持）——SA4 §7 同载，本轮复核成立 | ✅ |

## 3. 模块责任

| 行为 | 应有 Owner | 实际落位 | 判定 |
|---|---|---|---|
| 值读（schema 无关、敌意面硬化） | `@nomicore/doc-runtime`（ADR-0016 L74 冻结） | `readLogicalValueAtPath` 零改动，runtime 只透传其值 | ✅ |
| schema 投影组合 + null 收敛 + 敌意 path 规范化 + 深拷贝 | namespace-runtime 组合边界（ADR-0016 L75；#272 resolver 头注指派） | `read-schema-projection.ts` 单点自包含（D3a/D3b/resolver/D5） | ✅ |
| 读路径语义解析 | vfsl `resolveSchemaAtPath`（#272 已落地） | 直接消费公共导出，不自造第二套解析逻辑 | ✅ |
| lease 透传 + 类型形状 | registry（仅别名） | types.ts 别名单点 + Equal 锁强制跟随；lease.ts 行为零变化 | ✅ |
| 敌意输入处置 | 消费敌意面的层以结果面收编（doc-runtime G0/safeSpreadPath 先例） | D3b 在组合面 schema 通道内收敛——SA2 F-1 修订核心逐字落位 | ✅ |

## 4. 既有架构惯例

- **包内模块不进公共面**：`read-schema-projection.ts` 沿 `p0.ts`/`projection.ts` 先例
  （包内相对导入消费，index.ts 零 re-export）。✅
- **敌意面纪律对偶**：`normalizeReadPath` 内层 try + fail-closed 收敛 null，与
  doc-runtime `safeSpreadPath`（内层 try + 坍缩 `[]`）同威胁模型的 schema 面对偶；
  绝不调用迭代协议（`Symbol.iterator` 只做同一性比较——属性读不调用，T1 以
  `iteratorCalls === 0` 可执行载荷锚钉死）。✅
- **可信域 loud throw 先例**：`InternalError` 零 catch 逃逸与 `getSchema` 载体异型
  `SchemaProjectionError`、`getMetadata` 循环值原始 `RangeError`（有测试锚）同处置类；
  AC9 改锚即该处置类在 readData 面的新测试锚（构造名/message 匹配，未为此导出 vfsl
  类——B16/N-2 遵守）。✅
- **守卫习惯复用**：D3a 双条件 `schemaState !== 'ready' || tools === undefined` 与
  write.ts L163 包内既有守卫同构。✅
- **键域安全判断留痕**：`cloneValueSchemaRecord`/`cloneDocsRecord`/
  `cloneNumberRecord` 注释保留 CreateDataPropertyOrThrow（Object.fromEntries 逐键
  构造）+ tokenizer ASCII 字母起始 ⇒ `__proto__` 键结构性不可达的双层判断依据
  （SA2 N-5 义务——防未来重构退化为裸赋值）。✅
- **提交流程惯例**：SA6 契约五文件随实现一并提交（HEAD 前为 untracked 属正常在途
  状态）；wiki 工件随票提交。✅
- **观察（MINOR，M-5）**：提交信息 `feat(namespace): project schema from readData`
  未带 issue 引用 `(#273)`、未采用 SA3 建议的详细正文。仓史惯例本为混合
  （`a6b2a79 docs(adr): …`、`2fdac1b fix: …` 亦无 issue 引用；合并时 PR 号由 GitHub
  追加），不构成阻断，留档备 Host/Runner 参考。

## 5. 单一事实源

| 事实 | 权威源 | 派生方式 | 漂移风险 |
|---|---|---|---|
| 读失败形状 | doc-runtime `ReadLogicalValueResult` ok:false | `Extract<…,{ok:false}>` 派生（非复制第二份）；doc-runtime 冻结由负控 + test-d 保持性守卫双锚 | 无（漂移即两包 typecheck 红） |
| lease 读形状 | runtime `NamespaceRuntimeReadDataResult` | 别名 + lease.ts `Equal` 编译锁（基准 `ReturnType<NamespaceRuntime['readData']>`，零改动自然绿） | 无（锁强制跟随） |
| 活 schema 投影 | `activeTools.derived`（P0/SCHEMA 写槽单点安装——installActive 亲证） | 每读重解析重拷贝的只读视图；零缓存、零模块状态、零前写 | 无（同步点 = 下一次读） |
| 投影语义预期值 | vfsl 公共 API（compileSchemaEnvelope + resolveSchemaAtPath） | 红契约 oracle 同源独立求值 + 不依赖 oracle 的字面量锚双保险 | 无 |

无第二事实源、无镜像状态、无平行投影逻辑、无按 generation 缓存（ADR 预留的加法
演进未抢跑）。

## 6. 生命周期对称性

纯同步读面：无资源获取/订阅/后台任务——对称性平凡满足；close 停接纳 gate 先行短路
（schema 通道不可达）；克隆 memo 每次调用局部新建（可重入）；敌意扫描无共享状态。
✅

## 7. 文件范围（ALLOW/DENY 逐条对账，git diff 实证）

| 类别 | 路径 | 对账 |
|---|---|---|
| ALLOW-1 | `packages/namespace-runtime/src/runtime.ts` | D1 联合重定型 + D2 组合重写 + 双域 JSDoc——逐 hunk 亲证 ✅ |
| ALLOW-2 | `packages/namespace-runtime/src/read-schema-projection.ts`（新建 220 行） | D3a/D3b/D4/D5 唯一载体；模块头注双域处置 + 内层 try 辖域记录（D4 文档义务） ✅ |
| ALLOW-3 | `packages/namespace-runtime/src/index.ts` | 仅头注 #273 增量段（注释级）；导出键集零变化 ✅ |
| ALLOW-4 | `packages/namespace-runtime/src/p0.ts` | 仅 L42–44 注释替换（零代码行——diff 亲证），与 DENY 注记「仅允许注释行」一致 ✅ |
| ALLOW-5 | `packages/namespace-registry/src/types.ts` | D6 别名替换 + 导入清理（删 doc-runtime/RuntimeReadDisabledResult 导入，增 NamespaceRuntimeReadDataResult） ✅ |
| ALLOW 测试 ×13 | runtime-boundary-supplementary + registry 11 文件 + 新建 hostile-path-guard | D7 三策略逐站点核对（stub 补 `schema:null` 且全等断言同步补——强度未弱化；真实 runtime 站点 toEqual→toMatchObject 值意图保持）；D8 新文件 T1–T3 + 局部负控逐字落实设计 §12 ✅ |
| **ALLOW 外 ×1** | `packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts` | AC9 末断言改锚（旧 `readValue(...)).toBe(1)` → InternalError throw 锚）。本轮独立复核：(i) fixture 经 compile seam 注入 structure 非 root 的畸形派生物（L755–761 亲读），ADR-0016 组合后 readData schema 通道必消费之 → 旧断言结构性不可能保持；(ii) 改锚内容 = 批准设计 §12 D4「可选负向锚」规格逐字落地（SA2 R2.9-4 建议的构造名/message 方式）；(iii) AC9 其余断言（rejected/committed:false/notifier 0/零写入/写禁用/read.enabled/fatal 非 null）原样保持（上下文亲核）；(iv) SA3 Deviations #1 如实披露、SA4 按 `task_vfsl-codegen-hardening` 先例裁非阻断并回流 SA1（O-1）。**定性：MINOR——设计 ALLOW 清单经验性遗漏（该站点经 helper 断言，不匹配构建清单所用 grep 形态），非实现自扩权；测试专用、无生产漂移** ⚠️→MINOR |
| SA6 交付物（DENY） | 红契约 15 / 负控 6 / 夹具 / 2 test-d 锚 | 本轮亲读/抽检与 SA6 §12 逐条吻合（键集锚、oracle + 字面量双锚、三情形 ×4 态、五层 not.toBe、不冻结、readOk 对 ok:false loud throw 不假绿、夹具 TXT_273/seedRoot count=3/makeReadyRuntime）；SA4 内容 + mtime 双佐证实现期未被重写 ✅ |
| DENY 其余 | doc-runtime/**、vfsl/**、lease.ts、registry index.ts、apps/yjs-server/**、docs/**、CONTEXT.md、domains/** | git diff HEAD~1..HEAD 对上述路径**零命中**（本轮亲证）✅ |
| 流程工件 | wiki/raw/task_* ×9 | 仓内惯例 ✅ |

除上述已定性 MINOR 的一处外：无 ALLOW 外扩张、无 DENY 越界、无 ALLOW 漏项。

## 8. 测试质量标准

| 标准 | 亲证 | 判定 |
|---|---|---|
| 行为锚定（非源码文本/grep 断言） | 全部断言为键集/toEqual/toMatchObject/引用隔离/不冻结/throw 构造名与 message/类型投影；红契约头注明示「不读生产实现源码、不做字符串断言」 | ✅ |
| 无 skip/only/todo | grep 亲证五枚新测试/锚文件零命中 | ✅ |
| 发现入口真实 | vitest include `packages/*/test/**/*.test.ts` 覆盖红/负控/D8 三文件；typecheck include `packages/*/test/**/*.test-d.ts` 覆盖两类型锚；tsconfig.typecheck.json `packages/*/test/**/*.ts` 全覆盖；根 `pnpm test`（vitest run --typecheck）与 `pnpm typecheck`（14 包链含两包）入口真实（配置亲证） | ✅ |
| 红灯原因真实、翻绿机制诚实 | SA6 §13 红证据在案（15/15 红全部落 schema 键、类型锚 TS2322 ×2）；`readOk` 窄接口对 ok:false loud throw；oracle 同源公共 API 独立求值 + 字面量锚（非自证）；SA3 报告翻绿（15/15、6/6、4/4、两锚），SA4 静态佐证计数一致；SA9 纪律不复跑——动态复核归 SA7/Controller | ✅（证据面） |
| 改锚不弱化 | stub 类站点全等强度保持（补 `schema:null` 后仍 toEqual）；真实 runtime 站点 toMatchObject 保留值断言意图（D7 防 P0 时序 flake 的批准策略）；无一站点被注释/跳过/删除（diff 逐 hunk 亲证） | ✅ |
| 负控不依赖实现面 | 负控仅经公共接缝（doc-runtime 直读 + runtime 失败分支）；对 HEAD 与目标实现同绿 | ✅ |
| D8 敌意锚质量 | T1 计数器载荷锚可执行（`iteratorCalls === 0`）、T2 Proxy get 陷阱、T3 `'schema' in r` 键在场 + value undefined；局部负控合法 path 非 null + 字面量对照 + 不冻结抽检；夹具 import-only（零夹具改动） | ✅ |
| 计数一致性 | 本轮清点：红 15 + 负控 6 + D8 4 + test-d 2——与 SA6 §12/SA3 Verification/SA4 §9 全部吻合 | ✅ |

## 9. 上游 MINOR 观察独立复核（SA4 O-1–O-5）

| ID | 本轮复核 | 定性 |
|---|---|---|
| O-1 设计 ALLOW 清单缺口（AC9 站点） | 属实且已按 §7 独立复核：遗漏成因（helper 断言形态不匹配 grep 清单方法论）、改锚必然性（旧断言结构性不可保持）、内容合规性（设计自身 D4 规格逐字落地）均成立；文档债回流 SA1 的裁决与仓内先例一致 | MINOR，不阻断 |
| O-2 AC9 值面直接锚被 throw 锚替换 | 属实：该站点值通道保留性现由 `status.read.enabled===true` 间接锚；但值通道保留性在全仓另有充分直接锚（负控、红契约、sync-read-face 等），单站点间接化不构成质量缺口 | MINOR，不阻断 |
| O-3 N-4 可选加固未做 | SA3 记录「非义务不处理」，与设计 D7/§14 一致 | MINOR，不阻断 |
| O-4 cloneDiscriminator 不走 identity-memo | 亲证 L185–193：byValue 为 number 原语 record、field 为 string——纯数据逐键构造；当前 derived 构造无跨 union 共享 discriminator 面，语义无影响（红 #13 仅锚跨读隔离） | MINOR（留注记），不阻断 |
| O-5 验证边界（SA6 文件 untracked 无 git 基线；根门 SA3 单会话） | SA4 以内容比对 + mtime 双佐证替代基线，本轮以内容抽检复核一致；根门重跑已列 SA7/Controller 动态项 | MINOR（流程留档），不阻断 |

## 10. 结论重述

- **Verdict：approve**。实现与批准设计（SA1 iteration-1，D1–D8）、SA6 契约、SA8
  红线 1–7 与 iter-2 §10 六条实现复查清单、SA2 F-1 验收 ①–④ 与 N-1–N-5，在
  standards 全部八面逐条对位成立；本轮全部关键结论独立取证（源码锚点亲验、diff
  逐 hunk、DENY 面零命中 grep、断言计数清点、runner 入口配置亲证），非复用 SA4
  结论。
- `requiresConflictRecheck`：**false**——实现未引入设计之外的新语义面（AC9 改锚 =
  批准设计 D4 自身钉死行为的落位；D3b/双域划界已经 SA8 iter-2 专项复审 clear 并
  闭合 C5 辖域确认）。SA8 iter-2 armed 的实现阶段复查六条已由 SA4 §3 逐条核对、
  本轮对要害条目（resolver 零 catch、恰三键、深拷贝边界、冻结面、p0.ts 注释级、
  D3b 专项）独立复证一致；Controller 可按流程路由 SA8 正式销项，standards 面无
  新冲突面。
- MINOR 观察共 6 枚（SA4 O-1–O-5 + 本轮 M-5 提交信息惯例观察），均不阻断；动态
  验证余项（根门干净环境重跑、CI 实跑、红 #13–#15 隔离复跑、敌意面扩展矩阵可选）
  归 SA7/Controller，不属于本 standards 轮的阻断面。
