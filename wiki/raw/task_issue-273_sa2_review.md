# SA2 设计攻击评审 — Issue #273 namespace-runtime + namespace-registry：readData 成功分支返回语义 schema 投影（ADR 0016）

- 被审对象：SA1 设计 `wiki/raw/task_issue-273_design.md`（iteration 0，374 行，D1–D7）
- 评审人：SA2（mabf-sa2，design-review，iteration 0）
- Worktree：`/home/wangjian/nomicore-fix-issue-273`（branch `mabf/issue-273`，HEAD `1acd9e9`；评审会话零生产/测试改动，唯一写产物为本文件）
- 裁决：**reject**（1 × MAJOR：F-1 敌意 path 经 resolver 迭代协议的裸 throw 通道未被设计分析，D4 的「internal-bug-only / 生产不可达」文档契约为假；修订面小且可精确验收）

## 1. Reviewed inputs

| 输入 | 状态 |
|---|---|
| 任务简报 `wiki/raw/task_issue-273.md`（行为要点 6 + AC1–AC5；Blocked by #272） | 亲读 |
| SA1 设计 `wiki/raw/task_issue-273_design.md` | 全文亲读 |
| SA6 契约 `wiki/raw/task_issue-273_sa6_contract.md`（approve）+ 5 个契约文件实存核验（red 15 / control 6 / fixture / 2 test-d 锚） | 亲读 + 逐文件核验 |
| SA8 前置门禁 `wiki/raw/task_issue-273_conflict_report.md`（clear，红线 7） | 亲读 |
| SA8 设计后复审 `wiki/raw/task_issue-273_design_conflict_report.md`（clear，D4 no-conflict；§8 移交项 5 条） | 亲读 |
| Issue comments | **空**（dispatch 记录 REST 当前读取 none；本阶段无需并入） |
| 母法 `docs/adr/0016-…md` 全文 + `docs/adr/0008-…md` 修订节 L167–178 + `CONTEXT.md` L34/L37–38/L92 | 亲读 |
| 源码亲核：`packages/doc-runtime/src/read.ts`（G0/E100/safeSpreadPath/吸收语义）、`packages/namespace-runtime/src/{runtime,p0,projection,schema-write,write,status}.ts`、`packages/vfsl/src/{resolve-schema-at-path,derived,tokenizer}.ts`、`packages/namespace-registry/src/{types,lease}.ts`（Equal 锁）、`apps/yjs-server/src/app.ts`（opRead/op 收编） | 亲读 |
| 测试面亲核：red/control/fixture/test-d 五文件全文；`runtime-boundary-supplementary`、`runtime-sync-read-face`、`runtime-data-interface.test-d`、`registry-data-interface.test-d`、`runtime-acceptance-exports-audit`/`runtime-public-surface-ownership`（grep）、registry 全部 toEqual/stub 站点（grep + 逐站点抽查亲读） | 亲读 + 全仓 grep 复核 |

评审方式：SA2 不运行测试/服务，只读源码与既有产物核验设计证据。设计的 B1–B13 事实锚点逐条对照源码**全部属实**（含行号）；§10 站点清单经全仓 grep 复核**改动类站点全部命中、无漏列的必改站点**（无改动类站点有 4 处未列，见 N-1）。

## 2. Verdict

**reject** —— 存在 1 个 MAJOR（F-1）。设计的形状/null 收敛/深拷贝/分层/类型跟随/测试改锚主线（D1–D3、D5–D7）与 ADR-0016、SA6 契约、SA8 两报告逐条吻合且证据扎实；但 D2+D4 的错误通道分析只覆盖了 resolver 的**可信域入参**（derived → `InternalError`），遗漏了它的**敌意入参**（path）：doc-runtime 对同一敌意面有 G0/safeSpreadPath/E100 三重「读面不抛」硬化，而组合面把敌意 path 直递给以迭代协议消费 path 的 resolver，使 exotic-but-indexable path 可让 `readData` 抛出**非 InternalError 的敌意异常**——这既违背 ADR-0008 L28「只有 internal bug 才抛异常」的分类（该 throw 由敌意输入触发，不是 internal bug），也使 D4 第 6 条强制要求的 JSDoc（「internal-bug-only、生产不可达」）成为虚假公共契约。修订局部（组合面前置 hardened path 守卫）、不影响文件范围与验收锚，必须在实现前落位。

## 3. 需求覆盖

| Requirement（简报行为要点/AC） | Design section | Assessment |
|---|---|---|
| 要点1 成功分支 `{ok,value,schema}`、always-on、无 opt-in | §1/§7-D1/D2、§8.2 | 落实（恰三键构造，ADR-0016 L19 逐字；红 #1 锚） |
| 要点2 `schema:null` 三情形、null 非失败、读恒成功 | §7-D3、§8.2 | 落实（单点守卫 + 两码收敛；红 #8–#12 锚） |
| 要点3 值缺席照常返 schema（路径键控）+ 空路径 ROOT 投影 | §7-D2④/D3、§12 | 落实（resolver 路径键控；红 #7/#1 锚） |
| 要点4 每次读深拷贝（detached、不冻结、零缓存） | §7-D5、§8.3 | 落实（identity-memo 显式分派克隆；红 #13–#15 锚；kind 分派表对照 `derived.ts` 9 kind **穷尽**，pattern.regex 为 string 无 RegExp 拷贝面） |
| 要点5 分层：doc-runtime 不动 / runtime 组合 / registry 别名跟随零行为变化 | §7-D1/D6、§11 DENY | 落实（lease.ts 零改动经 Equal 锁验证路径成立，L389–391 亲核） |
| 要点6 失败分支与四 getter 不变 | §7-D1/D2、§8.1 | 落实（`RuntimeReadDisabledResult` 逐字、gate 原序、失败短路零 schema 工作） |
| AC1 两层类型一致 | D1/D6 + 2 test-d 锚 + Equal 锁 | 落实 |
| AC2 null 三情形/缺席/空路径各有锚 | SA6 红 #1/#7/#8–#12（§12 映射） | 落实 |
| AC3 投影隔离双向 | SA6 红 #13–#15 | 落实（每次调用局部 memo ⇒ 跨读必然互异） |
| AC4 always-on、无新增公共方法/参数、审计测试按新形状 | §8.1、§12 | 落实——「审计测试无需改动」的解释经核验成立：exports 审计测试 grep readData 零命中；ownership 测试仅 typeof/非 Promise 探针（L107/L171 亲核） |
| AC5 两包测试 + 根门绿 | §11/§12 D7 | 落实（改锚站点清单经全仓 grep 复核属实；见 N-1 完备性注记） |
| Blocked by #272 | 头部（HEAD `1acd9e9` = #272 合并提交） | 满足 |

目标/非目标无静默扩大（非目标清单与 ADR-0016 §分层明文排除一一对应）。

## 4. Owner评论覆盖

Issue comments 经 REST 当前读取为空（dispatch 记录；SA6 §2 / SA8 两报告三处同载 `comments: []`）。**无 owner 评论要求需并入，本表无行。** 执行标准唯一来源 = 简报 + ADR-0016（设计 §4 处理正确）。

## 5. 上游事实与SA8约束

| Fact or constraint | Design response | Assessment |
|---|---|---|
| SA6 缺口链 ①–⑤ + 四态×9 路径矩阵（全部无 schema 键） | §3 缺口链承接 + §5 逐条映射 | 成立（源码亲核 B1–B8 与 SA6 证据一致） |
| SA6 红 #1–#15 / 负控 6 / 类型锚 2 / 共享夹具 | D1–D6 逐条可满足 | 成立（契约文件实存、断言内容亲读；负控对 doc-runtime 直读做 toEqual（L29–31）不受实现影响，runtime 面全部 toMatchObject——实现后保持绿的分析正确） |
| SA6 §15 四项自由度 | D4/D5 钉死两项；docs 过滤/未知方言明确移交 | 成立 |
| SA8 红线 1 包装而非透传 | D2 显式映射 | 落实 |
| SA8 红线 2 lease Equal 锁同步 | D6 别名 = runtime 联合 + released | 落实（`Equal` 基准 `ReturnType<NamespaceRuntime['readData']>` 与别名同构，锁自然绿；types.ts L35/L43 旧导入确实只服务 L449–450，导入清理主张亲核成立） |
| SA8 红线 3 null 单义 | D3 单点收敛、无子通道 | 落实 |
| SA8 红线 4 / 设计后复审 D4 = throw 逃逸 no-conflict | D4 六条论证 + JSDoc 义务 | ADR 冲突面成立；**但敌意 path 通道分析缺失（F-1）——SA8 复审的 D4 分析同样只讨论 InternalError，未覆盖该通道，属 SA2 错误攻击面** |
| SA8 红线 5 深拷贝义务（#272 复审移交） | D5 | 落实（resolver L28–31 共享节点声明亲核） |
| SA8 红线 6 测试改锚面 | D7 三策略 + 站点清单 | 落实（grep 复核：全部必改站点在清单内） |
| SA8 红线 7 工作流纪律 | §13 follow-up #4 | 落实（记录为实现票约束） |
| ADR-0008 修订节第 3 条「原规则保持」 | §8.2/§9 | 落实；**但「读取保留不变量」中的敌意面不抛纪律恰是 F-1 被破坏点** |
| 设计后复审 §8 移交项 1–5 | JSDoc 两处义务 / 不导出 InternalError / yjs-server 评估 / 可选负向测试 / 工作流 | 移交项 1、2、5 已入设计；项 3 本评审已评估（见 N-3）；项 4 已列为可选测试（见 N-2 落地注记） |

上游矛盾：无（SA6/SA8 事实与源码逐条核对一致；本评审未发现新的事实性矛盾，F-1 是设计分析缺口而非事实错误）。

## 6. 设计内部一致性

| 检查项 | 结论 |
|---|---|
| D1–D7 与 §8 状态机/数据流 | 一致（伪代码、判别顺序、键集构造逐行对得上） |
| §10 调用方矩阵 vs 全仓 grep | **必改站点全部命中**；无改动站点有 4 处未列（N-1，均核实确无需改） |
| §11 ALLOW/DENY vs 正文 | 一致（p0.ts「仅注释行」与 §6 行呼应；无未解释扩张） |
| §12 验收映射 vs SA6 契约 | 一致（红编号逐条对应） |
| **D2 括注「resolver 从组合面结构上不可达 SCHEMA_PATH_INVALID 的非数组/野段输入」** | **不成立**：doc-runtime 缺席吸收「中间缺失立即结束」（read.ts L79）——`['absent-key', Symbol()]` 在 doc-runtime 返回 `{ok:true,value:undefined}` 而不检查尾段，resolver 检查全段 → INVALID → null。行为无害（两码同收敛 null），但该「结构性不可达」论断是错的，且它是 D2/D4 敌意面分析可信度的直接反例（F-1 证据） |
| B5（fatal 期 schemaState 停留 preparing） | 亲核 p0.ts L125–134 属实；D3 的 fatal 覆盖论证成立，且 `activeTools===undefined` 双条件为 belt-and-suspenders |
| B11（包内 loud throw 先例） | 亲核 projection.ts 头注 + `runtime-boundary-supplementary` RangeError 锚属实 |

## 7. 状态机与并发攻击

| ID | Initial state | Trigger | Expected behavior | Design gap | Required revision |
|---|---|---|---|---|---|
| SM-1 | preparing（P0 未结算） | readData | `{ok:true,value,schema:null}`，不等待 | 无（D3；红 #8） | — |
| SM-2 | unavailable / fatal | readData | 值可用 + null | 无（D3 + B5；红 #9/#10） | — |
| SM-3 | closing/closed | readData | `RUNTIME_READ_DISABLED`，schema 通道不可达 | 无（D2 gate 原序，runtime.ts L442–445 亲核） | — |
| SM-4 | ready（旧 derived） | replaceSchema 成功（installActive S5.5 同步换装） | 读见旧或新投影快照，无撕裂 | 无（installActive 单同步函数、槽内无 await 间隔；JS 单线程同步读不可插入） | — |
| SM-5 | ready | 值缺席路径读（`['nick']`/`['skus','cd']`） | ok + 非 null 投影 | 无（resolver 路径键控；红 #7） | — |
| SM-6 | ready | **敌意 path：吸收后野尾段**（`['absent',Symbol()]`） | doc-runtime ok → resolver INVALID → null | 行为正确但 D2 声称结构不可达（§6） | 并入 F-1：JSDoc/设计正文撤销该论断 |
| SM-7 | ready | **敌意 path：exotic-but-indexable 数组**（重定义/Proxy 陷阱的 `Symbol.iterator`，索引读正常） | doc-runtime 以**索引访问**导航（read.ts L72–73）返回 ok → resolver 守卫 `for..of`（resolve-schema-at-path.ts L97）触发迭代协议 → 敌意 trap 异常裸抛 | **设计未分析**（D4 可达性论证只看 derived 输入） | **F-1（MAJOR）** |
| SM-8 | 任意 | 并发/重试/幂等 | 纯同步零副作用，memo 每调用局部 | 无（§9 论证成立） | — |

## 8. 错误与恢复攻击

| ID | Failure | Current design behavior | Risk | Required revision |
|---|---|---|---|---|
| E-1 | `PATH_NOT_ALLOWED` | 失败短路透传，零 resolver 工作 | 无 | — |
| E-2 | resolver 两码（NOT_FOUND/INVALID） | 单义收敛 null | 无（ADR-0016 L22） | — |
| E-3 | resolver `InternalError`（可信域畸形 derived） | throw 逃逸（D4，SA8 复审 no-conflict） | 无（六条论证链核验成立） | — |
| E-4 | **敌意 path 触发的裸异常**（SM-7） | 同样逃逸（D2 无守卫、D4 无 catch），且被 JSDoc 记为「internal-bug-only、生产不可达」 | **读面为敌意输入新增可生产触发的 throw 通道**：违背 doc-runtime 在同一敌意面的既定纪律（G0/safeSpreadPath/E100——safeSpreadPath 注释明文「path 可能是 Proxy 包装数组……spread 触发 Symbol.iterator/长度读取 trap」即本威胁模型）、违背 ADR-0008 L28 分类（敌意输入 ≠ internal bug，预期失败应走结果联合）、公共 JSDoc 契约失真 | **F-1（MAJOR）**：`read-schema-projection.ts` 在调用 resolver 前**仅以索引访问**（不用迭代协议）做 hardened path 规范化/守卫，异常或非 string|number 段 → `schema:null`（ADR-0016 情形③「静态解析失败」+ 敌意输入走结果面纪律，镜像 safeSpreadPath 先例）；把规范化后的普通数组传给 resolver，使 `InternalError` 保持唯一逃逸 throw（D4 对可信域的裁定不变）。JSDoc 相应改写为：敌意 path 异态 → null；InternalError（可信域）→ throw |
| E-5 | null 终值性 / 重试安全 | null 非降级、重试安全、状态机推进后自然非 null | 无 | — |
| E-6 | 读面副作用 | 零诊断、零 sequencer、零缓存 | 无（ADR-0016 L77） | — |

正常路径不变量（敌意输入不抛）缺失处不得以「loud throw 即诚实」掩盖——事实 owner 是既有的敌意面→结果联合纪律（doc-runtime 先例 + ADR-0008 L28），不是 D4 的可信域 loud 判据；两域处置差异恰是 vfsl AGENTS 二分（敌意输入走判别联合、可信域畸形 throw）在组合面的对偶面，设计只继承了后半句。

## 9. 契约影响审查

| API or contract | Missing or weak caller handling | Evidence | Required revision |
|---|---|---|---|
| `NamespaceRuntimeReadDataResult` ok 分支加键 | 无（加法兼容；TS 判别式消费不受影响） | §10 矩阵亲核（runtime-sync-read-face/data-interface.test-d 均 ok 判别 + .value） | — |
| typed stub ×6（`implements NamespaceRuntime`）+ 2 工厂默认值 | 无遗漏（grep `implements NamespaceRuntime` 恰 5 类 + registry-open `makeRuntime` 参数/默认值；registry-create `makeMarkerRuntime` any） | §10 行与 grep 逐一对应 | — |
| toEqual 改锚站点 | 无遗漏（全仓 grep `toEqual({ ok: true, value` 复核：runtime 2 + registry 31 站点全部在 §10/§11） | 本评审 grep 输出与设计清单一致 | — |
| 无改动类未列站点 | registry-open L945（失败分支字面量 override——D1 后仍合法）、registry-phase5-bootstrap-reset-r2-internal L271（`unknown` 假 runtime，无类型锁/无 toEqual 锚）、ws-replication `testing.ts` L47（bind 真实 lease 方法）、runtime-registry-internal-sa7-dynamic L57（宽松 RuntimeLike 类型） | 亲读四站点，确认均无需改 | N-1（完备性注记，非阻断） |
| `apps/yjs-server` opRead | 设计判「无改动」成立：try/finally 仅消费 value；且 op 分发层全程 try/catch 收编（app.ts L827 注释「op 全程 try/catch 收编」），即便 E-4 throw 也不致进程崩溃 | app.ts L530–556 亲读 | 无（经 F-1 修订后该面 throw 概率进一步归零） |
| lease Equal 锁 / registry index re-export | 无（别名同构 + 名/元数不变） | lease.ts L389–391、types.ts 亲核 | — |

## 10. 架构一致性与惯例审查

### 责任归属

| Behavior | Expected owner | Design location | Assessment |
|---|---|---|---|
| 值读 | doc-runtime（ADR-0016 L74 冻结） | 透传 | 正确 |
| schema 投影组合 + 深拷贝 | namespace-runtime 组合边界（ADR-0016 L75；resolver 头注指派） | D2/D5 新内部模块 | 正确 |
| 敌意 path 处置 | 消费敌意面的层以结果面收编（doc-runtime G0/safeSpreadPath 先例） | **缺位**（直递 resolver） | F-1 |
| lease 形状 | registry 仅别名（ADR-0016 L76） | D6 | 正确 |

### 相似能力对照

| Similar capability | Existing implementation | Proposed design | Consistent or divergent | Reason |
|---|---|---|---|---|
| 出站深拷贝 | projection.ts META 深拷贝（putPlainKey） | D5 显式 kind 分派 + identity-memo | divergent（有据） | 值域不同（ValueSchema vs plain data）；键域为 VFSL 标识符语法路径——tokenizer 亲核：标识符起始限 ASCII 字母（`_` 不可起始），`__proto__` 类 accessor 陷阱键结构性不可达，且展开/计算键字面量为 CreateDataPropertyOrThrow 语义；判断依据已记录在设计内 |
| 敌意 path 规范化 | read.ts `safeSpreadPath`（内层 try 收编） | **无对应物** | divergent（无据） | F-1：组合面消费同一敌意输入却无同款硬化 |
| 状态守卫 | write.ts L163 `schemaState!=='ready' \|\| tools===undefined` | D3 同款双条件 | consistent | 复用包内既有守卫习惯 |
| 同步读 loud throw 先例 | getSchema/getMetadata（B11） | D4 | consistent（限可信域） | 见 F-1 的两域划界 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 失败成员形状 | doc-runtime `ReadLogicalValueResult` | `Extract<…,{ok:false}>` | 无（派生非复制；备选否决②正确） |
| 读结果联合 | runtime `NamespaceRuntimeReadDataResult` | registry 别名 + Equal 锁 | 无（锁强制跟随） |
| schema 投影 | `activeTools.derived` | 每读重解析重拷贝的只读视图 | 无（零缓存零前写） |

### 生命周期对称性

纯读面，无 acquire/release、无订阅、无后台任务——对称性不适用；close 停接纳先行短路覆盖（SM-3）。

### 平行机制检查

| Candidate duplicate | Existing path | Proposed path | Disposition |
|---|---|---|---|
| 深拷贝器 | 无既有 ValueSchema 克隆器 | 新模块内部函数 | 非重复（记录在案） |
| schema 缺席原因子通道 | 无 | 设计明确拒绝 | 一致（ADR 被否备选） |
| 第二缓存 | 无 | 零缓存承诺 + 红 #13 锚 | 一致 |

## 11. 文件范围审查

| Path or scope issue | Evidence | Required revision |
|---|---|---|
| ALLOW 17 路径 vs 正文改动面 | 一致（生产 5 + 测试 12；每条有理由） | 无 |
| ALLOW 无未解释扩张；DENY 与正文不冲突（p0.ts「仅注释行」双载一致；SA6 契约 5 文件冻结） | 亲核 | 无 |
| follow-up 4 条 | 均为真增量（缓存/子通道/未知方言锚定/工作流），无掩盖本票必要项 | 无 |
| F-1 修订落点 | 落在 ALLOW 既有新模块 `read-schema-projection.ts` 内 + 建议新增负向测试入 `packages/namespace-runtime/test/`（与既有 ALLOW 测试文件同级目录；建议实现票把该新测试文件名补入 ALLOW） | F-1 验收要求（微小范围增补，非扩张） |

## 12. 验收设计审查

| Requirement or risk | Proposed evidence | Gap | Required revision |
|---|---|---|---|
| AC1/AC2/AC3/AC4/AC5 | SA6 红 15 + 负控 6 + 类型锚 2 + 根门（§12 映射） | 无（断言全部为可观测行为，无源码文本断言——红文件亲读确认；红灯原因经 SA6 §13 实证为缺 schema 键） | — |
| P0 时序不敏感（防 flake） | D7 toMatchObject 分类 | 无；且 registry-create L459 前一行已断言 `schema.state==='ready'`（亲核），属「确定性站点可另加非 null 断言」的适用对象 | —（设计已留该选项，见 N-4） |
| D4 无 catch 守卫 | 可选负向测试（seam 注入畸形 derived → toThrow） | `InternalError` 未从 `@nomicore/vfsl` 导出（SA8 复审移交项 2），`toThrow(InternalError)` 无法以类引用断言 | N-2：按类名/message 匹配断言 |
| **敌意 path 通道（E-4/SM-7）** | **无任何契约/建议测试** | 实现后该面既可能抛（违 AC 隐含的读面纪律）又无锚 | F-1 验收：①索引读正常但 `Symbol.iterator` 抛出的类数组 path → `readData` 返回 `{ok:true,value,schema:null}` 且不抛；②`['absent-key',Symbol()]` → ok + null；③（可选）InternalError 逃逸锚保持 |
| 回归面 | 两道根门 + 改锚清单 | 无 | — |

## 13. Required revisions

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance |
|---|---|---|---|---|---|
| F-1 | **MAJOR** | `packages/vfsl/src/resolve-schema-at-path.ts` L94–101（path 守卫经 `for..of` 迭代协议消费敌意 path；无顶层 catch）；`packages/doc-runtime/src/read.ts` L57–88（G0 + 索引访问导航 + L79 缺席吸收「中间缺失立即结束」）、L143–162（safeSpreadPath：Proxy 数组 spread/长度 trap 威胁模型的仓内既有记载）、L128–134（E100 收编使值读 INV-R1 同步不抛）；设计 §7-D2（值读先行、无 path 预处理）+ §7-D4（「不加任何 try/catch」「internal-bug-only、生产不可达」+ JSDoc 义务第 6 条）+ §7-D2 括注「SCHEMA_PATH_INVALID 结构上不可达」 | 组合面把敌意 path 直递 resolver：doc-runtime 以索引访问导航可在 exotic-but-indexable path（重定义/Proxy 陷阱的 `Symbol.iterator`）上返回 ok，随后 resolver 守卫循环触发敌意 trap 异常并裸抛出 `readData`。后果：(a) 公共读面为敌意输入新增可生产触发的**非 InternalError** throw 通道，违反 ADR-0008 L28「只有 internal bug 才抛异常」的分类（敌意输入的预期失败应走结果面）与 doc-runtime 在同一敌意面的既定硬化纪律（safeSpreadPath 即为此威胁模型而设）；(b) D4 强制的 JSDoc 将把该通道错误记为「internal-bug-only、生产不可达」，公共契约陈述为假；(c) D2「INVALID 结构上不可达」论断错误（缺席吸收跳过尾段），敌意面结构分析不可信 | 在 `read-schema-projection.ts` 内、调用 `resolveSchemaAtPath` 之前新增 hardened path 规范化守卫：仅以索引访问（`length`/`[i]`）扫描并拷贝入普通数组，全程包内层 try；任何异常或非 string|number 段 → 直接返回 `schema:null`（情形③），并把规范化后的普通数组传给 resolver——由此 `InternalError`（可信域）保持唯一逃逸 throw，D4 对可信域的裁定与 SA8 复审结论不变。同步修订：设计正文撤销 D2「结构上不可达」括注；D4/JSDoc 文案改为「敌意 path 异态 → schema:null；InternalError（可信域畸形 derived）→ throw 逃逸」 | 新增测试（建议实现票 ALLOW 增补该测试文件）：①`Object.defineProperty(arr, Symbol.iterator, {value(){throw}})` 且 `arr=['count']` → `readData(arr)` 得 `{ok:true,value:3,schema:null}` 不抛；②Proxy 数组 get 陷阱对索引键返回合法值、对 `Symbol.iterator` 抛出 → 同上；③`['absent-key',Symbol()]` → `{ok:true,value:undefined,schema:null}`；④既有红 15/负控 6/类型锚 2/根门全绿不受影响 |

## 14. Non-blocking observations

| ID | Observation |
|---|---|
| N-1 | §10 自述「完整站点清单（全仓 grep 实证）」有 4 处无改动站点未列：registry-open L945（失败分支字面量 override，D1 后仍类型合法）、registry-phase5-bootstrap-reset-r2-internal L271（`unknown` 假 runtime）、ws-replication `src/testing.ts` L47（bind 真实 lease 方法）、runtime-registry-internal-sa7-dynamic L57（宽松 RuntimeLike）。四者均经亲核确无需改动，两道根门亦兜底——仅「完备清单」措辞与事实有出入，建议实现票把 grep 复核清单补全留档，避免后续以此清单为唯一依据做范围判断 |
| N-2 | §12 的 D4 可选负向测试写为 `toThrow(InternalError)`：该类未从 `@nomicore/vfsl` 导出（SA8 复审移交项 2，本票 DENY vfsl/**），测试应以构造名/message 匹配断言（沿 getMetadata 原始 `RangeError` 锚的先例精神），勿为此导出该类 |
| N-3 | SA8 设计后复审移交项 3（apps/yjs-server 外层收编）本评审已评估：`opRead` try/finally 仅消费 value，op 分发层全程 try/catch 收编（app.ts L827 注释明示）——进程不因逃逸 throw 崩溃，REST 面且先经 `isSegmentArray` 净化；无改动结论成立，留档销项 |
| N-4 | registry-create L459 前一行已确定性断言 `schema.state==='ready'`（亲核），是 D7「确定性站点可另加 `expect(r.schema).not.toBeNull()`」的直接适用对象；实现票可顺手加固 1–2 处此类站点（非义务） |
| N-5 | D5 的「键域可信 ⇒ 免 putPlainKey」判断经独立核验成立：tokenizer 标识符起始限 ASCII 字母（`_` 不可起始）⇒ `__proto__` 键结构性不可达；与 resolver 侧赋值式 record 的行为奇偶性（oracle 同源）不冲突。此判断应在实现注释中保留设计已要求 的依据引用，防未来重构退化为裸赋值 |

---

评审结论重申：**reject，仅 F-1（MAJOR）一项阻断**。D1–D7 主线（形状、null 收敛、深拷贝、分层、类型跟随、测试改锚）与母法、SA6 契约、SA8 两报告高度一致且证据可靠；F-1 修订局部于 `read-schema-projection.ts` 的 path 预处理 + 文档措辞 + 一个新负向测试，不触碰文件范围主体、不推翻任何 D 决策、无需新的 ADR 冲突复查（敌意输入 → 结果面/null 是 ADR-0016 情形③ 与 ADR-0008 L28 的既有文义，非新决策）。修订后建议直接进入实现（SA3/SA4）。

---

# SA2 攻击评审 — 第 2 轮（iteration 1，F-1 修订版复审）

- 被审对象：SA1 设计 `wiki/raw/task_issue-273_design.md`（**iteration 1，469 行**——F-1 修订版：D1–D7 主线不变 + 新增 D3b hardened path 规范化守卫 + D4 双域划界改写 + D8 新验收测试文件 + §14 逐条修订映射 + §15 窄域复查请求）
- 评审人：SA2（mabf-sa2，design-review，iteration 1；全新视角复审，不沿用 iteration-0 妥协）
- Worktree：`/home/wangjian/nomicore-fix-issue-273`（branch `mabf/issue-273`，HEAD `1acd9e9`；`git status` 复核：生产实现零改动，仅 SA6 契约 5 文件 + wiki 快照未跟踪——SA1 纪律保持）
- 上游输入：SA6 契约（approve）+ SA8 前置门禁（clear，红线 7）+ SA8 设计复审 iteration-1（clear，D4 no-conflict）+ **SA8 设计冲突复审 iteration-2 `task_issue-273_design_conflict_report_iter2.md`（clear——本修订版的专项复审：23 对照行 0 冲突；C5 辖域确认；§10 清单第 1 条改写 + 第 6 条 D3b 专项新增）** + 任务简报（Issue comments 四处同载为空，无 owner 要求需并入）
- **裁决：pass**（iteration-0 唯一阻断项 F-1（MAJOR）已完整、可执行地落实；本轮独立攻击未发现新阻断项；验收契约与 ADR 约束逐项保持）

## R2.1 Reviewed inputs 与本轮独立核验方式

| 输入 | 状态 |
|---|---|
| SA1 设计 iteration 1（469 行） | 全文亲读（重点：D3b 全量规格、D2 论断撤销、D4 双域改写、D8/§12 T1–T3、§14 映射、§15 复查请求） |
| F-1 证据链源码复锚 | `resolve-schema-at-path.ts` L94–101/L134/L99/L138/L158（迭代协议消费 + 无顶层 catch + 头注敌意通道分类）、`read.ts` L60/L72–73/L79/L128–134/L139–162（G0/索引导航/中间缺失立即结束/E100/safeSpreadPath）——与设计 B14/B15 逐字一致（本轮亲核） |
| B16（InternalError 未从 vfsl index 导出） | `packages/vfsl/src/index.ts` grep 仅注释提及——属实；N-2 修订（按构造名/message 断言）随之必要且已落实 §12 |
| SA6 契约敌意构造零性 | red 15 / control 6 / 2 test-d 锚 / 夹具 grep `Symbol\|Proxy\|defineProperty` → **零命中（本轮亲测，exit=1）**——D3b 迭代纯度校验对契约全部路径透明的前提成立 |
| 夹具可用性（D8 import-only） | `readdata-schema-projection-fixture.ts` L93 `makeReadyRuntime` 导出在位；`seedRoot` L49 `count=3`——T1/T2 断言 `{ok:true, value:3}` 的事实基础成立 |
| vitest 收录 | `vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖 D8 新文件名（亲核） |
| registry 跟随点 | `types.ts` L448–451 旧别名 + L35/L43 导入仅服务旧别名（亲核）；`lease.ts` Equal 锁以 `ReturnType<NamespaceRuntime['readData']>` 为基准（亲核）——D6「锁零改动自然绿」路径成立 |
| 调用方矩阵完备性 | 全仓 grep `.readData(`：生产消费面恰两处（lease.ts L278 透传 + app.ts L548 仅消费 value）；`toEqual({ ok: true, value` 36 站点/11 文件全部在 §10/§11 清单内（本轮重扫一致） |
| **D3b 守卫逻辑独立攻击实测** | 以 node 直接仿真设计规格逐字实现的 `normalizeReadPath`，18 组敌意/合法输入实测（证据见 R2.3） |

## R2.2 Verdict

**pass**。iteration-0 的 reject 仅由 F-1 一项构成，且明示「修订局部、可精确验收」。本轮逐项核验修订四要素 + 独立攻击实测，结论：

1. **敌意 path 规范化守卫（D3b）成立且无逃逸**：守卫落位 schema 通道、D3a 之后、resolver 之前；机制 = 仅普通属性读（`Array.isArray` / `Symbol.iterator` **同一性比较**（属性读、绝不调用）/ `length` 单次快照 / `[i]` 索引读）+ 段域检查 + 全程内层 try + 普通数组副本传递。对本评审构造的全部敌意输入（敌意迭代器、Proxy get 陷阱、尾段 Symbol、空洞、accessor 下标、谎报 length、对象/布尔段、非数组），守卫**全部收敛 null、零外抛、零敌意函数调用**；对合法输入（空路径、混合 string|number 段、子类数组、benign Proxy）**逐元素透明**。
2. **`schema:null` 收敛保持单义**：敌意收敛与三情形共用同一 null 出口，无子通道/码/稳定键；SA8 iter-2 A1 独立裁定敌意形状栖于 ADR-0016 L22③ 经 L57「非数组/野段形状守卫」的既有辖域（implements-existing-decision，非第 4 类情形）；对 SA6 红契约逐元素透明（契约零敌意构造，实测）。
3. **`InternalError` 边界逐字保持**：内层 try 辖域 = `normalizeReadPath` 函数体（敌意扫描），**不包裹** `resolveSchemaAtPath` 调用——两域处置在代码结构上物理分离；SA8 iter-2 C5 已对辖域歧义作出正式确认并把实现阶段复查清单第 1 条改写（「对 resolveSchemaAtPath 调用无任何 try/catch……允许且仅允许的内层 try：敌意 path 规范化扫描自身」）+ 新增第 6 条 D3b 专项——设计 §15 提请的窄域复查已闭合。
4. **D4 公共契约陈述恢复为真**：JSDoc/模块头注双域表述（敌意 → null；InternalError → internal-bug-only throw 逃逸）与实现行为一致；iteration-0 的失真单句已作废。
5. **验收契约与 ADR 约束零破坏**：SA6 契约 5 文件 DENY 冻结、D8 import-only；AC1–AC5 锚面不动；红线 1–7 / 冻结面七项（SA8 iter-2 §5）逐项通过；主线 D1/D2/D5/D6/D7 未被修订触碰（设计自述与修订内容一致）。

## R2.3 D3b 守卫独立攻击实测（本轮核心证据）

按设计 §7-D3b 伪代码**逐字**实现 `normalizeReadPath` 后直接运行（node v24，评审会话内联执行，零 worktree 写入）：

| # | 输入 | 实测结果 | 判定 |
|---|---|---|---|
| T1 | `['count']` + `defineProperty(Symbol.iterator, {value(){calls++;throw}})` | `null`，**`iteratorCalls === 0`**（敌意迭代器从未被调用——同一性比较是属性读不调用） | ✅ 收敛 |
| T2 | `new Proxy(['count'], {get(t,p){ if(p===Symbol.iterator) throw; return Reflect.get(t,p) }})` | `null`（`Array.isArray(proxy)===true` 确认；属性读异常被内层 try 收编） | ✅ 收敛 |
| T3 | `['absent-key', Symbol('rogue')]` | `null`（尾段 Symbol 被段域检查捕获——值通道在 seg0 吸收返回 undefined，两通道各按其规则结算） | ✅ 收敛 |
| 合法组 | `[]` / `['count']` / `['skus','ab',0]` | 逐元素相等的普通数组副本 | ✅ 透明 |
| 子类数组 | `class A extends Array{}; A.from(['count'])` | 通过（继承标准迭代器，同一性相等） | ✅ 透明（防守卫过拒） |
| benign Proxy | `new Proxy(['count'], {})` | 通过（默认 get 转发，语义与普通数组不可区分） | ✅ |
| 空洞数组 | `[,'count']` | `null`（hole → undefined → 段域拒绝；值通道同路径 seg0 undefined → PATH_NOT_ALLOWED，schema 通道不可达，两通道一致） | ✅ |
| accessor 下标 | `['a']` + index0 accessor throw | `null`（内层 try 收编） | ✅ |
| 中途扫描抛 | Proxy 对 index `1` 抛 | `null` | ✅ |
| 谎报 length | `2.5` / `-1` / `"3"` | 全部 `null`（typeof/isInteger/负数检查逐项拦截；无 ToPrimitive 陷阱面——`!==`/`typeof`/`<` 均原语比较不抛） | ✅ |
| 真迭代器 own 属性 | `defineProperty(Symbol.iterator, {value: Array.prototype[Symbol.iterator]})` | 通过（同一性相等——正确放行标准语义） | ✅ |
| 非数组 / null | `{length:1,0:'count'}` / `null` | `null`（内部直调者兜底；公共路径值通道 G0 先挡） | ✅ |
| 对象段 / 布尔段 | `['a',{}]` / `['a',true]` | `null` | ✅ |

零异常逃逸、零敌意函数调用、零合法路径回归。**通过校验后 resolver 只见 `out`（模块内新建普通数组，标准原型/迭代器）——resolver 的 `for..of`/`[...path]` 迭代协议消费面被结构性封死，F-1 的 throw 通道不再存在。**

**对「迭代纯度校验」超出 iteration-0 required-change 机制句字面的裁定（本评审明示背书）**：F-1 required-change 机制句（「仅以索引访问扫描拷贝」）是最小字面读法；但 F-1 验收 ①② 断言 T1/T2 输入 `schema:null`——仅索引扫描将把 T1/T2 的扫描副本交给 resolver 得到**非 null** schema，违反验收。二者冲突时**以可执行验收为准**：纯度校验是满足验收 ①② 的必要机制，且「部分信任敌意对象（扫出什么信什么）」正是 F-1 要求废弃的姿势；fail-closed 与 doc-runtime `safeSpreadPath` 敌意数组坍缩 `[]` 同一纪律的 schema 面对偶。设计备选否决 ① 的推理正确，SA8 iter-2 C6 同判。SA3/SA4 应按**含纯度校验的完整规格**实现（机制自由、验收面强制）。

## R2.4 F-1 修订四要素逐项核验（对照 iteration-0 §13）

| F-1 要素 | 设计落实 | 本轮核验 |
|---|---|---|
| (守卫) hardened path 规范化、内层 try、非 string\|number 段 → null、普通副本传 resolver | §7-D3b 全量规格（含 4 备选否决）+ §8.2 状态机插层 + §8.3 R1 + §11 ALLOW 新模块行 | ✅ 规格可实现且经 R2.3 实测无逃逸；守卫次序（D3a 状态守卫先出——无 active schema 时不触碰敌意对象）与 write.ts L163 包内守卫先例同构 |
| (论断撤销) D2「INVALID 结构上不可达」撤销 + 反例入锚 | §7-D2【F-1 修订】段（值读成功不证明 path 普通数组——B15 吸收语义）+ B14/B15/B16 事实行 + T3 显式锚 | ✅ 论证与源码逐字一致（read.ts L79 吸收、L72–73 索引导航） |
| (双域文档) JSDoc 改「敌意 → null；InternalError → throw 逃逸」 | §7-D4 双域表述 + 论证 2（L28 两域同真）+ 论证 6 改写（含内层 try 辖域注明，防维护者误判/误扩） | ✅ 表述与将实现的行为一致；SA8 iter-2 C7 同判（描述 L28+L57+L64 联立已授权的行为，非发明） |
| (验收测试 ①–④) | §12 T1–T3 + 局部负控（合法 `['count']` 非 null 对照）+ ④ 既有面回归行 + §11 ALLOW 增补 `runtime-readdata-hostile-path-guard.test.ts`（D8，import-only 夹具） | ✅ 断言可执行（夹具/种子值/vitest include 亲核）；`iteratorCalls === 0` 计数器为载荷锚（SA8 移交项 2 同判） |

N-1/N-2/N-3/N-4/N-5 五观察项 + SM-6/E-4/§12 缺口的映射经 §14 逐条对照：**无缺项、无方向偏差**。

## R2.5 验收契约与 ADR 约束保持核验

| 面 | 结论 |
|---|---|
| SA6 红 15 / 负控 6 / 类型锚 2 / 夹具 | DENY 冻结（§11）；D3b 对契约路径逐元素透明（契约零敌意构造，本轮亲测）；实现后自动翻绿路径不变 |
| AC1–AC5 | D1/D2/D5/D6/D7 未被修订触碰，锚面原样（§12 映射）；AC4 无新增公共方法/参数/稳定码——`normalizeReadPath` 包内私有，敌意收敛走既有 null 出口非新结果分支 |
| ADR-0016 | 结果形状/null 单义（L22+L87）/每次读深拷贝/分层（L74–76）逐项保持；SA8 iter-2 §5 冻结面七项全过 |
| ADR-0008 | L28 两域同真（敌意域 D3b 收敛、可信域 D4 throw）；修订节第 3 条「读取保留不变量」的敌意面子句正是 F-1 被破坏点、本版补齐（SA8 iter-2 A2/A3） |
| SA8 红线 1–7 | §6 表逐行落实；红线 4 的辖域张力已由 iter-2 C5 正式消解（清单改写） |
| 工作流 | git status 零生产改动；设计/评审/门禁文件齐全；HEAD `1acd9e9` 栈接正确 |

## R2.6 本轮攻击点清单（全新视角，全部未成立为缺陷）

| # | 攻击面 | 攻击构造 | 结果 |
|---|---|---|---|
| A-1 | 守卫自身成为敌意代码执行点 | `Symbol.iterator` getter/Proxy get 陷阱在纯度比较中触发 | 不成立——属性读在 try 内，实测收敛 null；比较运算（`!==`/`typeof`/`<`）均为原语操作无 ToPrimitive 陷阱面 |
| A-2 | 守卫后仍可触达迭代协议 | 副本 `out` 的传递路径 | 不成立——resolver 只见模块内新建普通数组；深拷贝输入只来自 resolver ok 分支（D5 辖域声明） |
| A-3 | 守卫与值通道检查深度错位引入新不一致 | 吸收语义下值通道短于全路径、守卫全段扫描 | 不成立——两通道各按其规则结算且均无 throw；行为矩阵（T3/空洞）一致收敛 |
| A-4 | 纯度校验过拒合法输入（子类/跨页内上下文数组） | 子类数组、benign Proxy、冻结数组 | 不成立——继承标准迭代器者同一性相等，实测透明；跨 realm 收敛 null 为 R7 已登记的 fail-closed 非支持场景（follow-up #5 放宽路径在案） |
| A-5 | 敌意长 path DoS 放大 | Proxy 谎报巨 length | 不成立（R8）——与 doc-runtime 导航循环严格同阶，首个异态段即短路，无值通道没有的新循环/上限 |
| A-6 | 非 ready 态敌意 path 旁路 | lifecycle gate / readDisabled 路径回显 | 不成立——`readDisabled`（runtime.ts L630–644）已是 safeSpreadPath 同款硬化（`Array.isArray` + try + spread + catch → `[]`），既有行为零变化 |
| A-7 | 失败分支/四 getter 被 F-1 修订顺带改变 | §8.1/§8.2 复核 | 不成立——失败三分支原样、gate 原序、`RuntimeReadDisabledResult` 逐字；D8 新测试仅动 ALLOW 新文件 |
| A-8 | 调用方矩阵漏列新面 | 全仓 grep 复扫 | 不成立——生产消费面恰两处且均「无改动」结论维持；36 个 toEqual 站点全在清单（含 N-1 四处无改动留档） |

## R2.7 协议假设依据审查

设计不含 HTTP/WS 端点、端口/进程时序、第三方库行为类协议假设（关键词扫描 0 命中，本轮亲测）——Hard Gate #15 不触发。F-1 修订引入的 **JS 语言语义假设**（`Array.isArray` 对数组 Proxy 为真、`Symbol.iterator` 同一性可比较、比较运算不触发 ToPrimitive、索引读可经 Proxy 触发陷阱）全部有仓内先例锚（read.ts safeSpreadPath F1/P10 威胁模型注释）+ 本评审**直接实测证据**（R2.3，命令可重跑），无「应该/通常/预计」类无据推断。

## R2.8 错误处理链路审查

- **静默失败**：无——正常路径 ok 恰三键、`value` 缺席显式 `undefined`、schema 缺席显式 `null`（键恒在场）；敌意收敛不省略键。
- **状态闭环**：读面零状态写入（不进 sequencer/诊断/fatal）——闭环不适用且已由 R3 边界声明钉死。
- **降级路径**：`schema:null` 是 ADR-0016 契约形态而非降级；敌意收敛走同一 null 出口。
- **虚假降级识别（重点复查）**：敌意 path → null **不是**「把正常路径前提缺失当降级」——敌意输入是外部输入而非内部不变量；内部不变量破坏（可信域 derived 畸形）的通道仍 loud throw（InternalError 逃逸），未被 null 掩蔽。两域划界恰好把「虚假降级立法」的判据（internal defect 必须 loud、外部敌意输入必须结果面）在组合面完整落实。iteration-0 只有后半句、前半句缺位——本版补齐。

## R2.9 红线测试思路（对 SA3/SA4 的锚定建议）

1. **T1–T3 + 局部负控（设计 D8 已载，验收面强制）**：T1 计数器 `iteratorCalls === 0` 是「绝不调用迭代协议」的载荷锚，必须可执行断言（非注释）；T3 须断言 `'schema' in r === true`（键在场性）。
2. **（建议增补，非义务）透明性对照扩展**：子类数组 / benign `new Proxy(arr, {})` / 冻结普通数组 → 同合法 path 投影非 null——防守卫过拒回归（A-4 面的回归锚）。
3. **（建议增补，非义务）收敛矩阵扩展**：空洞数组 / 谎报 length（分数、负数、字符串）/ 对象段 → `{ok:true, value:<doc-runtime 语义>, schema:null}` 零抛——R2.3 表的可执行化子集。
4. **InternalError 可选负向锚（§12 已载，按 N-2 方式）**：seam 注入畸形 derived → `toThrowError(/InternalError/)` 或 `err.constructor.name === 'InternalError'`——**不得为此导出该类**（B16；DENY vfsl/**）。
5. **实现阶段 SA8 复查清单（iter-2 §10，已 armed）第 6 条**为 D3b 专项验收：内层 try 边界、副本传递、T1–T3 收集与绿、红契约透明——SA4/SA7 按此核对实际 diff。

## R2.10 Non-blocking observations（iteration 1）

| ID | Observation |
|---|---|
| O-1 | 完美仿真 Proxy（get 陷阱返回真 `Array.prototype[Symbol.iterator]` 且忠实转发索引/长度）通过纯度校验并获得真实投影——语义上与普通数组不可区分（且值通道已对同一对象做过同款属性读），非违例；但说明守卫边界是「迭代纯度 + 句法域」而非「敌意对象检测」。建议 D8 文件以一条 benign-Proxy 透明性对照（R2.9-2）把该边界钉成显式契约，防 SA4 误判为漏洞 |
| O-2 | §8.2「非 ready 态下敌意 path 同样收敛 null（D3a 先出，**不执行敌意属性读**）」的括注辖域是 schema 通道；值通道（doc-runtime 导航）与既有的 `readDisabled` 路径回显 spread 事实上都会触碰敌意属性（均已硬化）。实现期 JSDoc 措辞建议明确「schema 通道不触碰」，防字面误读。非阻断（行为安全且零变化） |
| O-3 | R7（跨 realm fail-closed）/R8（同阶 DoS 面）为如实登记的残余风险，follow-up #5 放宽路径在案；本仓全部调用方同 realm（进程内库 + REST 层 JSON.parse 产物），当前无消费者受影响 |

## R2.11 结论

**pass——F-1 修订完整、可验收、无新阻断项**。敌意 path 全谱收敛 `schema:null`（读恒 ok、值语义零影响、零 throw、零敌意函数调用），`InternalError` 保持唯一逃逸 throw 且两域在代码结构上物理分离，D4 公共契约陈述恢复为真；SA6 验收契约、AC1–AC5、ADR-0016/0008 全部约束、SA8 红线与冻结面逐项保持；SA8 iteration-2 已对本修订版专项复审 clear（0 冲突）并闭合 §15 提请的辖域确认。**建议直接进入实现（SA3），实现期按 SA8 iter-2 §10 清单（含第 6 条 D3b 专项）由 SA4/SA7/SA8 复核。** 本 pass 仅覆盖设计面；实现与活链路验证仍由 SA4/SA7 及 armed 的实现阶段冲突复查承担。

**[Iteration 1 Verdict]: pass**
