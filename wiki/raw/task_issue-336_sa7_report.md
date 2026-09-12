# SA7 Dynamic Verification Report — Issue #336（T3：readData 五键组合）

> SA7（数据流与状态机动态验证），iteration 0。被验对象：worktree
> `/home/wangjian/nomicore-fix-issue-336`（基线 HEAD `cdfdff6`）上 SA3 未提交的 Issue #336
> 实现（9 文件修改 + 6 新测试文件；SA4 verdict **approve**）。SA7 只做动态验证：驱动真实
> 源码运行、观察运行时数据路线与关键中间值；不做一般静态审查、不修改任何实现/设计/测试
> 文件。Issue #336 REST comments 为空——无 Owner 要求适用；`task_issue-336_sa6_contract.md`
> 不存在（设计 §5 登记），验收权威 = Issue AC1–AC7 + ADR-0024 验收节 L120–130。

## Inputs

| 输入 | 状态 |
|---|---|
| `wiki/raw/task_issue-336.md`（任务简报；Issue 正文同源） | 已读 |
| `wiki/raw/task_issue-336_design.md`（SA1 iteration 1，1070 行；§7 决议、§8 数据流路线 R1–R5、§12 验收规格为本报告验证矩阵主干） | 已读全文 |
| `wiki/raw/task_issue-336_sa3_impl.md`（SA3 实现报告；红→绿记录与门禁证据） | 已读全文 |
| `wiki/raw/task_issue-336_sa4_review.md`（SA4 静态审查 verdict **approve**；§11 后续动态验证项为本报告 Source=SA4 行） | 已读全文 |
| `wiki/raw/task_issue-336_relevant_decisions.md`（ADR-0024/0016/0008/0009/0003 摘录——协议边界） | 已读 |
| `task_issue-336_sa6_contract.md` | **不存在**（SA3/SA4 同裁；Source 不含 SA6） |
| 当前源码/测试 | runtime.ts（readData 组合体 L551–606、`canonicalReadOptions` L833–860、`seamReadOptionsInvalid` L880–888、`echoReadPath` L808–815）、read-schema-projection.ts（双重载 + `case 'truncated'`）、lease.ts L277–299、6 个新测试文件、T0 三件——运行前亲读 |

## Runtime environment

| 项 | 值 |
|---|---|
| Host | Linux，Node `v24.13.0`（V8），pnpm `10.28.2` |
| 运行面 | workspace 源码直驱：`NODE_OPTIONS=--conditions=nomicore-source`（exports 映射 `./src/index.ts`） |
| Runner | vitest `3.2.7`（含 `--typecheck` 类型收集）；tsc `5.9.x`；tsx `4.23.12`（独立驱动器） |
| 独立驱动器 | `/tmp/sa7-336/driver.mjs`（**仓外**，零 worktree 触碰）：经公共面（`createNamespaceRuntimeWithSeam`、doc-runtime `readLogicalValueAtPath`、vfsl `resolveSchemaAtPath`/`compileSchemaEnvelope`、registry testing 工厂）驱动，全部断言为第一手运行时观察；yjs 以与源码同一 ESM 实例加载（模块同一性） |
| 运行记录 | 套件 4 轮 + 独立驱动器 4 轮（末轮 95 检查全过）；全部进程正常退出，无遗留服务/端口占用 |

## Changed Data Flow Verification

（设计 §8.3 路线 R1–R5；「Observed hops」为独立驱动器/套件第一手观察值）

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| R2 预算读·值通道 | raw options 原样入 T1 三参（A-1 单一权威），截断省略 + 载体计数清单 | driver S2 + red B1–B3/C1–C2 | `readData([], {depth:1})` → value `{"title":"hello","count":3,"meta":{},"tags":[]}`；truncations 恰 `[{path:['meta'],kind:'depth',omitted:2},{path:['tags'],kind:'depth',omitted:5}]`；`depth:0` 骨架 `{}`/`[]` + 单条；width 保留 3 → `['a','b','c']` + 父路径单条 `omitted:2`；blob `omitted:2 ≠ 6`（直接子项数） | 被裁键省略、条目三字段、尾段即被裁键名、B14 | 与预期逐字段一致 | ✅ |
| R3 预算读·投影通道（canonical 单预算贯通） | 值通道成功后接缝净化（T1 同款读纪律，零 `[[Get]]`）→ resolver 三参只吃 canonical → detach 10-case（含标记） | driver S2/S4 + red D/E | `depth:1` 投影标记位集 `["meta","tags"]` ≡ 值通道 depth 条目位置集 `["meta","tags"]`（归一 recipe：数字段→`<item>`）；标记节点 `{kind:'truncated',clue:{via:'ref',name:'Meta'}}`（ref 名线索）/`{via:'container',containerKind:'array'}`；width-only 投影与无 options 读 **JSON 逐字节相等**；`{depth:undefined}` 净化后零预算、schema 与无 options 读逐字节相等 | 两通道位置一一对应；canonical 剥离 present-undefined | 全部一致；敌意夹具上同见 S4 行 | ✅ |
| R4 净化失败（敌意 options 视图不稳定） | A-2b 双出口响亮失败，绝不 throw / schema:null 静默化 | driver S4 | 状态化 descriptor trap（第 4 次起抛）→ 恰四键 `READ_OPTIONS_INVALID`、`descCalls=5`（轨迹：T1 校验 #1/#2 → 净化 #3/#4 抛 → 重派发 #5 抛 → T1 内层 try 单源收编 = **出口①**）；交替 trap（仅第 4 次抛）→ 恰四键 + message `READ_OPTIONS_INVALID: options 视图在读取期间不稳定（敌意 descriptor/Proxy）——接缝拒绝组合同预算读` = **出口②** 接缝终态成员；path 新鲜回显 `[]`/`['meta']`；两次调用全程零 throw | 恰四键失败、非静默、非抛 | 与设计钉死轨迹一致（套件以 throwFrom=3 钉死 4/5 计数亦绿） | ✅ |
| R5 lease 透传 | released 先行；active 期 raw 引用直传（零预算解释） | driver S6 + passthrough 套件 | 记录型 stub 捕获 `argc=2`、path/options **同一引用**、结果对象同一性；敌意 Proxy get trap 在 lease 层 `trapCalls=0`；单参调用 `argc=1`；真实装配 `lease.readData([],{depth:1})` 与 runtime 直调 JSON 逐字节相等（value/truncated/truncations 全同） | 原样透传、released 先行 | 一致 | ✅ |
| 新增：READ_OPTIONS_INVALID 公共失败分支 | 决策 1：同步不抛、不借路径/生命周期码 | driver S3 | 11 类非法输入（未知键/负数/非整数/NaN/±Inf/字符串轴/数组/Date/null/accessor 键/抛错 trap Proxy）→ 恰四键 `{ok,code,path,message}`、message 非空；非法 path + 非法 options → `PATH_NOT_ALLOWED`（path 优先）；无 options 调用恒不产生该码 | 公共分支、定序 lifecycle>path>options | 一致 | ✅ |

关键中间跳点（非仅最终返回值）均取得运行时证据：canonical 净化的真实发生由 `descCalls≥4` 与 `{depth:undefined}` 净化用例证明；投影通道只吃 canonical 由 split-Proxy（descriptor=1 / get=1.5）在 **depth=1** 对齐、`getCalls=0` 证明（若 raw 双发，T2 的 `[[Get]]` 会读到 1.5 → `SCHEMA_OPTIONS_INVALID` → `schema:null` 静默——未出现）。

## Preserved Data Flow Verification

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| R1 无 options 读 | value/schema 内容与 T3 前逐字节一致（ADR-0024 L29/L67）；信封差异恰为新增两键 | driver S1（7 条路径 × 独立预言机） | #273 oracle 形态：doc-runtime 公共直调值 + vfsl resolver 公共直调投影 | 全部路径 `value`/`schema` 与预言机 `toStrictEqual` 级 JSON 逐字节相等；`truncated=false`、`truncations=[]`（每次调用新鲜 `[]` 实例，`a.truncations !== b.truncations`）；control 套件同款断言绿 | ✅ |
| 既有失败分支形状 | PATH_NOT_ALLOWED / RUNTIME_READ_DISABLED / NAMESPACE_LEASE_RELEASED 三分支不带截断键、原通道 | driver S3/S5/S6 | #92/#273 既有契约 | PATH 四键（G0 守卫，`'not-an-array'` 实参）；lifecycle 四键；released 三键 `{ok,code,message}` 冻结单例（两次调用同一对象） | ✅ |
| lifecycle gate 定序 | B-1：closing/closed 先于一切 options 读取与 doc 触碰 | driver S5 | #92 停接纳纪律 | close 后带敌意 Proxy options 调用：`get=0 desc=0 ownKeys=0`（零 trap 执行）；closing 窗口（close() Promise 在飞）同步拒绝；getStatus 全程可观测 | ✅ |
| `schema:null` 单义与 always-on | D3a 先行；预算参数不是 schema 开关 | driver S2/S5b | ADR-0016 L22 | preparing 期预算读五键共存（`value=3`、`schema:null`）；off-schema 路径 `['rogue']` 五键 + `schema:null`；ready 后同参 schema 正常挂载 | ✅ |
| 读不进 sequencer / detached | 零 sequencer 槽位；每读全新深拷贝、不冻结、零缓存 | driver S7 | ADR-0008/0016 交付纪律 | 连续同参预算读深度相等但 `schema`/`valueSchema`/marker `clue` 引用互异；`Object.isFrozen=false`；改写 marker.clue 与 `valueSchema=null` 后重读逐字节不受污染 | ✅ |
| T1/T2 上游公共面零变化 | 本票只消费 | git diff + 套件 | T1/T2 既有套件 | `git status` 零触碰 `packages/doc-runtime/**`、`packages/vfsl/**`；两包全套件绿 | ✅ |
| 文档负控边界 | `readDataOptionUsages` 只扫 SCOPE_DOCS 三件 | 套件运行 | T5 #338 面 | `readdata-docs-adr0016-sync-red/control` 两套件在 95 文件运行中绿（负控面未被本票扰动） | ✅ |

## State Machine Verification

单次调用编排（设计 §8.2 S1→S2a/S2b→C→P）与生命周期状态机：

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| preparing（P0 gated） | `readData(['count'], {depth:1})` | ok 五键、值通道照常、`schema:null`；P0 释放后 ready、schema 挂载 | `state=preparing` → 五键 `value=3, schema=null` → gate 释放 → ready → 同参 `schema≠null` | 无「preparing 期抛错/schema 开关」 | ✅ |
| ready | 无 options / 预算 / 非法 options / 敌意 options | 分别走 S2a 五键、S2b 五键、T1 拒绝、A-2b 出口①/② | 见 Changed/Preserved 表逐行 | 无「成功分支三键」「失败分支带截断键」 | ✅ |
| ready → closing | `close()` 在飞期间 readData | 同步 `RUNTIME_READ_DISABLED`（非抛、非 Promise） | closing 窗口四键拒绝 | 无「排空后复活读」 | ✅ |
| closing → closed | close 完成 | 拒绝稳定；getStatus 可观测 | closed 仍四键拒绝、getStatus 正常 | 无状态回退 | ✅ |
| lease active | `lease.readData(path, opts)` / `(path)` | 双参透传（argc=2）/单参 legacy（argc=1） | 两通道实参形态均观察到 | 无「lease 层构造 canonical / 复制 options」 | ✅ |
| lease active → released | `release()` 后 readData（含 options） | 冻结单例 issue 先于透传、零 runtime 触达 | `calls.length=0`、两次调用同一对象 | 无「released 后仍触达 runtime」 | ✅ |
| 重复/并发触发 | 同参重复预算读 | 逐字节确定（确定性输入） | S7 三次读 JSON 恒等 | 无跨调用共享可变状态 | ✅ |

## Error and Cleanup Flow

- **错误分类不伪成功**：11 类非法 options 与敌意 trap 全部收敛为恰四键 `READ_OPTIONS_INVALID`（出口① T1 单源 / 出口② 接缝成员），无一例 throw、无一例 `ok:true ∧ schema:null ∧ truncated:true` 静默组合（split-Proxy 用例负断言）。
- **敌意 path**：非数组 → `PATH_NOT_ALLOWED`；off-schema/raw 键 → `schema:null` 收敛（ok 恒真）；零物化哨兵：`['sentinel']` 预算折叠读 ok（`value={}` + 单条清单）而无预算读响亮 `PATH_NOT_ALLOWED`（哨兵真实——证明「先全量再裁」退化实现不存在）。
- **清理时序**：驱动器内所有 runtime `close()`、lease `release()`、registry `shutdown()` 正常完成；进程零残留（全部 job exit 0）；敌意原型污染（`Object.prototype.maxChildrenPerNode`）try/finally 还原并断言 `delete` 后不再在场。
- **重入/复活**：close 后读不复活、released 后透传不复活、旧路径（整读三键）在五键断言下不可达。

## Temporary Diagnostics

| 项 | 记录 |
|---|---|
| 添加的 `[SA7-DATAFLOW]` 临时日志（worktree 内） | **0**——全部观察经公共 API 返回值 / 独立预言机 / 调用计数 Proxy（敌意构造器自带计数）取得，无需仪器化源码 |
| 观察驱动器 | `/tmp/sa7-336/driver.mjs`（仓外；输出前缀 `[SA7-DATAFLOW]` 用于关联，末轮日志 `/tmp/sa7-336/driver-final.log` 95/95 PASS） |
| 删除项 | 无（无可删） |
| Post-removal 验证 | 末轮完整重跑在零仪器化 worktree 上执行（exit 0）；`git diff` 与 `grep -r SA7-DATAFLOW packages apps` 零命中；`git status --porcelain` 24 项 = SA3 原状（9 改 + 6 新代码 + wiki 输入），SA7 零增量 |
| 临时诊断进 artifactPaths | 否（驱动器/日志留仓外） |

## Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA4 §11-1 | SA3 报告的全量绿需独立复跑（集中化遗漏 / stub 不可赋值会红） | 两包全套件 + 4 层 tsc | 全绿 | 95 文件/864 测试绿、Type Errors none；`tsconfig.typecheck.json`/runtime/registry/root(14 包) tsc 全 exit 0 | 本报告 Commands and Evidence | ✅ | — |
| SA4 §11-2 | F-x5/F-x6 descriptor 计数锚依赖引擎 enumerability 探测 | red F-x5/F-x6（node v24/V8） | 计数恰 4/5 | 套件绿；独立驱动器同轨迹（throwFrom=4 时 descCalls=5，与钉死序列平移一致） | 套件运行 + driver S5 出口①/② | ✅ | — |
| SA4 §11-3 | `readdata-docs-adr0016-sync-control` 真实装配锚 T3 后自动绿 | 95 文件运行内 | 绿 | 绿（21 测试随套件通过） | 套件输出 | ✅ | — |
| SA4 §11-4 | 重派发路径稳定性（敌意-only） | driver S4 + 全套件 | 无超时/泄漏 | 全部同步完成、进程干净退出 | driver-final.log | ✅ | — |
| Design §7.1（F1 修订） | 净化器读纪律分叉 / `[[Get]]` 泄漏 / trap 裸逃逸 | driver S4：split-Proxy、throwing-get、non-enum、继承键、状态化/交替 trap | 对齐成功或恰四键响亮失败；get trap 零执行 | `getCalls=0` ×2；双盲夹具 schema 与无 options 读逐字节相等；出口①/② 恰四键零 throw | driver-final.log S4 段 | ✅ | — |
| Design §7.2（B-1/B-3/B-4） | lifecycle×options 定序；失败面冻结；清单零合成 | driver S3/S5 + 套件 F6/F7 | 见上表 | 一致 | driver-final.log | ✅ | — |
| Design §12-T1-D（AC2） | 两通道截断位置一一对应（主缝断言） | driver S2 对齐 recipe（独立实现） | 位置集相等 | `markers=["meta","tags"] ≡ entries=["meta","tags"]`；`['meta']` depth:0 目标位对齐；depth:2 双空 | driver-final.log | ✅ | — |
| Design §12-T1-E（AC3） | width 触发时投影与无预算读逐字节相等 | driver S2 | JSON.stringify 相等 | 相等（含 key 序） | driver-final.log | ✅ | — |
| Issue AC1/AC4/AC5/AC6/AC7 | 五键恒形 / omitted 语义 / 失败分支 / T0+lease / 门禁 | 上述全部 | 见上 | 见上 | 本报告 | ✅ | — |

## Commands and Evidence

| # | Command | Result |
|---|---|---|
| 1 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-runtime/test/runtime-readdata-shape-budget-red.test.ts …-control.test.ts packages/namespace-registry/test/registry-readdata-budget-passthrough.test.ts` | `3 passed (3)`，`Tests 37 passed (37)`，`Type Errors no errors` |
| 2 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --typecheck packages/namespace-runtime/test/runtime-readdata-shape-budget.test-d.ts packages/namespace-registry/test/registry-readdata-budget-passthrough.test-d.ts` | `2 passed (2)`，`Type Errors no errors` |
| 3 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run packages/namespace-runtime packages/namespace-registry` | `Test Files 95 passed (95)`，`Tests 864 passed (864)`，`Type Errors no errors`（含 T0 收敛门 22 测试、hostile-path、projection-red/control、docs-adr0016-sync、registry surface 审计） |
| 4 | `pnpm exec tsc -p tsconfig.typecheck.json`；`tsc -p packages/namespace-runtime/tsconfig.json`；`tsc -p packages/namespace-registry/tsconfig.json` | 三者零输出、exit 0 |
| 5 | `pnpm typecheck`（root，14 包含 `apps/yjs-server` 消费方） | exit 0、无诊断 |
| 6 | `NODE_OPTIONS=--conditions=nomicore-source pnpm exec tsx /tmp/sa7-336/driver.mjs` | exit 0；`[SA7-DATAFLOW] PASS` ×95 / FAIL ×0（S1 无 options 预言机逐字节、S2 预算清单+对齐+width+哨兵、S3 失败矩阵+差分+净化、S4 敌意面+双出口、S5/S5b lifecycle、S6 lease、S7 detach） |

代表性观察值（driver-final.log 摘录）：

- `S1 schema≡oracle(byte)@[…]` ×7 全过（无 options 回归锚）；
- `S2 depth:1 entries :: truncations=[{"path":["meta"],"kind":"depth","omitted":2},{"path":["tags"],"kind":"depth","omitted":5}]`；
- `S2 depth:1 alignment :: markers=["meta","tags"] entries=["meta","tags"]`；
- `S4 split-proxy ok + zero [[Get]] :: getCalls=0`；`S4 split-proxy aligned at descriptor value(1)`；
- `S5 exit① … code=READ_OPTIONS_INVALID descCalls=5`；`S5 exit② seam member :: message=READ_OPTIONS_INVALID: options 视图在读取期间不稳定…`；
- `S5 zero hostile trap execution after close :: get=0 desc=0 ownKeys=0`；
- `S6 passthrough same refs + result identity :: argc=2`；`S6 released issue first :: keys=["code","message","ok"]`。

## Acceptance-contract observables（Issue AC ↔ 动态证据）

| AC | 动态可观察项 | 证据 |
|---|---|---|
| AC1 五键恒形 + 失败分支不动 | driver S1/S2/S3 键集断言 + red A1–A3/F1 + control 失败键集 | ✅ |
| AC2 两通道截断位置对齐 | driver S2 独立对齐 recipe + red D1–D6（含 F-x 延拓） | ✅ |
| AC3 width 逐字节相等 | driver S2 width schema byte≡ + red E1 | ✅ |
| AC4 depth 尾段枚举 + omitted 计数 | driver S2（`omitted:2 ≠ 6`）+ red B/C | ✅ |
| AC5 READ_OPTIONS_INVALID + 无 options 回归锚 | driver S3（11 例 + 定序 + 差分）+ control 预言机 | ✅ |
| AC6 T0 五键修订 + lease 透传 | 命令 3（gate 22 测试 + 10 消费文件零手改随动绿）+ driver S6 + passthrough 套件 | ✅ |
| AC7 门禁 | 命令 1–5（受影响两包全套件 + 4 层 typecheck 含 root 14 包）；root `pnpm test` 全仓面由 SA3 记录（350 文件/3841 测试）背书，SA7 按 skill 边界不重跑全仓回归 | ✅（见 Deviations-2） |

## Deviations

1. **驱动器两次自误修正**（非实现缺陷）：首两轮 driver 的 2 个 FAIL 均为驱动器侧预期错误——(a) 对 raw fixture 读 `[]` 误期 `schema:null`（[] 是 schema 合法路径，rogue 仅是不进投影的子键；改为读 `['rogue']` 后观察到位）、(b) 记录型 stub 未接进 registry 工厂（经最小探针 `/tmp/sa7-336/debug-lease.mjs` 证实透传本身正确后修正接线）。修正后末轮 95/95 全过；两误均不构成对实现的观察证据。
2. **边界登记**：(a) 未重跑 root `pnpm test` 全仓回归（SA7 skill 禁全仓回归；受影响两包已全量重跑，AC7 全仓面以 SA3 记录为准）；(b) 未物理复现红灯态（需回退 worktree 实现状态，违反「不修改文件」边界）——红灯机理以 SA3 实现前运行记录（27 failed/10 passed）+ 本次全部断言恰观察 HEAD 缺失的五键/预算/失败码可观察项佐证；(c) 独立驱动器位于 `/tmp`（仓外），不进 artifactPaths。
3. **版本 bump / 文档负控 / T4 #337 / T5 #338**：非本票验收面（设计 §13），未验证。

## Verdict

**approve**。

- 设计声明改变的数据流（R2/R3/R4/R5 + 新失败分支）全部按设计变化，关键中间跳点（T1 权威校验 → canonical 净化 → 投影三参 → detach；出口①/②）均有第一手运行时证据；
- 设计声明不变的路线（R1 逐字节、三既有失败分支、lifecycle/released 定序、sequencer 外读、detached 纪律、T1/T2 上游面）全部保持不变；
- 状态机转换与关键值正确、禁止状态未出现（三键成功面、失败带截断键、静默 `schema:null ∧ truncated`、released 后透传、close 后敌意 trap 执行均为零观察）；
- 错误与清理符合设计，进程与资源到达 quiescence；
- 临时诊断零添加、零残留（`git diff` 无 `[SA7-DATAFLOW]`）。
