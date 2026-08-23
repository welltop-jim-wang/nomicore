# SA7 动态验证报告 — materializeRoot（issue #74）

**Date**: 2026-08-22 20:55
**Verdict**: **pass**（SA4 verdict=pass 前提下独立动态验证；29 项活链路探针全 PASS + 本地全量 vitest 57 文件 / 773 用例全绿；CI 侧触发证据因分支未 push 环境阻塞，本地动态触发证据补位——见 §5/§6）
**验证对象**: SA3 实现 commit `ac0f487` + SA6 测试修复 commit `d25beb6`（packages/doc-runtime：materializeRoot 验证后安全物化 logical ROOT 到 Yjs）
**环境**: node v24.13.0 / vitest 3.2.7 / yjs@13.6.32（单实例）/ worktree `/home/wangjian/nomicore-fix-issue-74`
**方法**: 全部命令独立后台进程（`setsid nohup … & disown`），探针脚本运行于 `packages/doc-runtime/` 目录内（单 yjs 实例，规避 SA4 P15 双实例伪影）；未修改 `src/` 与 `test/` 下任何文件；临时探针文件用后已清理（`git status` 仅余 wiki 产物与 `.mabf/` 运行时目录，均不进 commit）。

---

## Step 0 — SA4 verdict 校对

- `wiki/raw/task_doc-runtime-materialize-root_sa4_review.md` 顶部：**`Verdict: pass`**（附 2 条 MINOR：M1 设计文件清单滞后、M2 手造空联合 E200 message 措辞——均不阻塞放行）。
- SA2 verdict=pass（R2 修订已核销）。→ 操作：进入 Step 1。

```
[SA7 Step 0 结论]
SA4 verdict: pass
操作: 进 Step 1
```

## Step 1 — SA6 冻结测试（红灯→绿灯第二关）

命令（后台独立进程）：`pnpm exec vitest run packages/doc-runtime/test/`（日志 `/tmp/sa7-docrt.log`，EXIT=0）

```
 ✓ packages/doc-runtime/test/materialize-root.test.ts (13 tests) 28ms
 ✓ packages/doc-runtime/test/extract-yjs-snapshot.test.ts (21 tests) 22ms
 ✓ packages/doc-runtime/test/extract-plain-domain.test.ts (9 tests) 16ms
 ✓ packages/doc-runtime/test/extract-nonfinite-number.test.ts (8 tests) 16ms
 ✓ packages/doc-runtime/test/extract-union-trial.test.ts (8 tests) 15ms
 ✓ packages/doc-runtime/test/extract-record-keyspace.test.ts (2 tests) 9ms

 Test Files  6 passed (6)
      Tests  61 passed (61)
Type Errors  no errors
```

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN（13/13 转绿；doc-runtime 全套 61/61 绿；extract 侧 48 用例回归锚无损）
操作: 进入 Step 2
```

## Step 2 — 动态清单逐条验证（29 项探针，TOTAL=29 FAILED=0，EXIT=0）

> 探针脚本：临时 `packages/doc-runtime/sa7-probe.tmp.mts`（验证后已删除），运行命令
> `/home/wangjian/nomicore-fix-issue-74/node_modules/.bin/tsx ./sa7-probe.tmp.mts`（workdir=packages/doc-runtime，
> 后台 setsid nohup，日志 `/tmp/sa7-probe.log`）。全部断言锚定 `materializeRoot` / `extractYjsSnapshot` /
> `validateLogicalSnapshot` 的**运行时可观测输出**（update 计数 / state 逐字节 / 载体 instanceof / message 文本），零源码 grep。

### 2.1 重点 #1 — unknown 位脏值：写侧响亮拒绝 + 零写入（SA2 红线 #3/#4/#5，INV-9）

| 探针 | 输入（① 全部 `validate ok:true` 宽域放行） | materialize 结果 | 证据摘录 |
|---|---|---|---|
| RL3a | `type ROOT = { u: unknown; arr: unknown[] }` + `{u: 10n, arr: []}` | 恰 1 条 F5 + 0 update + state 逐字节不变 | `validateOk=true n=1 word=bigint updates=0 stateEq=true msg="纯值域违规（ROOT.u）：期望 plain value（JSON 值域），实际 bigint"` |
| RL3b | 同上 + `{u: 1, arr: [undefined]}` | 恰 1 条 F5（undefined 词）+ 零写入 | `n=1 word=undefined updates=0 stateEq=true` |
| RL5 | `type ROOT = { d: unknown }` + `{d: new Date(0)}` | 恰 1 条 + `constructor: Date` 申报（禁静默投影 `{}`，B3）| `n=1 msg="纯值域违规（ROOT.d）：…实际 non-plain object（constructor: Date）" updates=0` |
| — | unknown 位 function | 恰 1 条 F5 | `n=1 word=function` |
| — | unknown 位内嵌 `Y.Map` 实例（B5 拒顺手集成）| 恰 1 条（载体词）+ 零写入 | `n=1 word=Y.Map updates=0 stateEq=true` |
| RL4 | `type ROOT = YMap<{ n: YLeaf<number> }>` + `{n: NaN}`（typeof NaN==='number'，① 过）| 恰 1 条 `non-finite number` + 零写入 | `validateOk=true n=1 word=non-finite updates=0 stateEq=true` |

**结论**：宽域校验 × 窄域构造的域分离在全部可达脏值上响亮执行（单 issue、零 update、state 逐字节不变），无任何「yjs 反正存得下」的静默写入（B4）。

### 2.2 重点 #1（续）— XML attr 双引号 / Record `__proto__` / union ROOT（红线 #6/#7/#8）

| 探针 | 结果 | 证据摘录 |
|---|---|---|
| RL6 attr 双引号 | `<img alt='an "alt" & <tag>' src="a.png"/>` ① wellFormedXml 放行（单引号值内 `"` 合法）→ ② F8 拒 + 零写入（域分离活证）| `validateOk=true n=1 F8 updates=0 stateEq=true msg="XML 解析失败（ROOT.body）：属性 alt 值含双引号"` |
| RL7 Record own `'__proto__'` 键 | `Record<AssetId, unknown>` + `Object.defineProperty` 造 own 键 → 物化成功、键可见、extract 回读、无原型污染 | `validate=true mat=true keys=["__proto__"] get="v" extractOk=true roundtrip={"__proto__":"v"}` |
| RL8 union ROOT | `type ROOT = A \| B`（A/B 均 map 形）两快照分别物化成功、键集正确 | `a→["a"] b→["b"]` |

### 2.3 重点 #1（续）— 红线 #1 手造联合 ROOT（R2-M1 定谳口径）与 #2 union 全拒（R2-M2）

| 探针 | 结果 | 证据摘录 |
|---|---|---|
| RL1 手造联合 ROOT 含 array 成员（structuredClone 派生物后替换 members[0]）| `ok:false` 恰 1 条，**message 含 `DOCRT-E200`**（R2-M1 定谳 throw→E200，非 F6/skip）+ 0 update + state 不变 | `n=1 E200=true updates=0 stateEq=true msg="DOCRT-E200: materialize 内部错误（意外异常）: ROOT 结构节点非 map 形（手造派生物）"` |
| RL1b 手造派生物 structure 非 root | E200 单 issue | `n=1 E200=true` |
| RL2 union 构造全拒（`{a?: string} \| {b?: string}` 两 all-optional 成员 + Date 快照：① 空键对象放行、② 原型守卫全员拒）| 单 issue，message 携带**声明序首成员差异词**（R2-M2）| `validateOk=true n=1 updates=0 msg="联合节点无可构造成员（ROOT.v）：2 个成员的结构形状均不符（首个失败：快照形状错位（ROOT.v）：期望 map 形普通对象，实际 object（constructor: Date））"` |

### 2.4 重点 #4 — observer 抛错边界（AC-6 / 红线 #9 多键部分提交不清理）

| 探针 | 结果 | 证据摘录 |
|---|---|---|
| RL9 多键 ROOT（`{a, b}` 两键）observer 抛错 | **原样 loud throw**（非吞并成返回值）+ 恰 1 次 update + 两键均已落盘（不清理、不虚假回滚）| `threw="observer-boom" updates=1 a="1" b="2"` |
| AC6b doc 级 update observer 抛错 | 同样 loud 传播且值已提交 | `threw="doc-observer-boom" title="t"` |

### 2.5 重点 #2 — R2-M3-b B 段重证（B1/B2/B3/B7/B12/B15 于实现产物活链路）

| B 断言 | 探针 | 结果（实测） | 证据摘录 |
|---|---|---|---|
| B7 | 全形态 fixture（SA6 同文本）物化 | 嵌套 detached 子树单事务安装、集成后可读（inner Y.Map / Y.Array / plain / XmlFragment 全读回）| `updates=1 nestedMap=Y.Map innerRead=true attachments=["x","y"]` |
| B2 | 全 optional 空快照 `{}` | 合法零写入成功（空事务 0 update）| `ok=true updates=0 stateEq=true(2B) size=0` |
| B15 | 同上 + 前置失败路径 | `getMap('ROOT')` 惰性创建零事件零 state 痕迹 | `updates=0 stateEq=true(2B)`（两条路径均 2B 不变）|
| B1 | fixture body `<p>Hello <b>world</b></p>` | 物化→提取**逐字字节还原** + revalidate ok | `body="<p>Hello <b>world</b></p>" byteEqual=true revalidate=true` |
| B3 | `<p>a<!-- note -->b</p>` | 注释逐字 XmlText 承载，往返字节还原 | `out="<p>a<!-- note -->b</p>" byteEqual=true revalidate=true` |
| B12 | 调用方已在 outer `doc.transact` 内调用 materializeRoot | 归并外层**单 update** 提交 + `ok:true` | `ok=true updates=1`（= 红线 #10 同探针）|

### 2.6 重点 #3 — AC-5 XML 往返家族（物化→extract→normalizeXml 语义等价→revalidate）

fixture `type ROOT = YMap<{ body: YXmlFragment<{}> }>`（逐串 ① 先验通过）：

| # | 输入 XML | extract 输出 | 语义等价 + 再校验 |
|---|---|---|---|
| AC5-1 | `<p title="a&gt;b">x<!-- note --><br/>y</p>` | `<p title="a&gt;b">x<!-- note --><br></br>y</p>`（yjs 重排显式闭合）| `semEq=true revalidate=true` |
| AC5-2 | `<e k='v'/>` | `<e k="v"></e>`（单引号重排双引号）| `semEq=true revalidate=true` |
| AC5-3 | `plain &amp; text` | `plain &amp; text`（实体字面保持，D7 规则 1）| `semEq=true revalidate=true` |
| AC5-4 | `<?pi data?><!--c-->` | `<?pi data?><!--c-->`（PI/注释逐字承载）| `semEq=true revalidate=true` |
| AC5-5 | ``（空串）| ``（空 fragment）| `semEq=true revalidate=true` |

### 2.7 附加回归锚（探针自带，非交办但加固）

| 探针 | 结果 | 证据 |
|---|---|---|
| F7a 结构-值树错位（手造剥离 fields）：快照键无结构声明 | 单 issue 拒绝静默丢键（D9/F7）+ 零写入 | `validateOk=true n=1 path=["a"] msg="快照含结构树未声明字段 "a"——拒绝静默丢键" updates=0 stateEq=true` |
| F7b 对抗 Proxy getter 双读发散（B10）| 构造以自身读到的数据为准：NaN → 响亮单 issue + 零写入 | `validateOk=true n=1 word=non-finite updates=0 stateEq=true` |
| P20 失败优先级 | logical 违规遇 ROOT 非空 → F1 完整 issues 胜出（引用透传）| `n=2 equalDirect=true` |
| INV-7 突变隔离抽查 | 物化后突变嵌套 plain 输入，doc 不变 | `mutatedInput docStable=true` |

**探针汇总**：`TOTAL=29 FAILED=0`，退出码 0（初跑 1 例 FAIL 为探针自身 Proxy 构造缺陷——ownKeys 在 validate 阶段即泄露异键，非实现问题；修正探针后全绿。已复核）。

## Step 3 — E2E spec 触发证据

不适用：本任务 design 无新增/改动 `*.spec.ts`（SA6 冻结测试为 vitest 单测 `*.test.ts`）。

## Step 4 — vitest 触发证据（硬门禁必做；verdict 升级 — 2026-06-15 立法）

**改动测试文件**：`packages/doc-runtime/test/materialize-root.test.ts`（新增 13 用例）→ 所在 workspace package **`@nomicore/doc-runtime`**。

**本地全量动态触发**（`pnpm exec vitest run --typecheck`，后台独立进程，日志 `/tmp/sa7-full.log`，EXIT=0；等价复现 CI `Test` step 的根级 glob 全量触发链 `ci.yml:38 → package.json:"test" → vitest.config.ts include`）：

```
 Test Files  57 passed (57)
      Tests  773 passed (773)
Type Errors  no errors
   Duration  101.45s
```

各 workspace package 触发的测试文件（`✓` 行逐文件摘录，materialize-root.test.ts 确在 runner 列表且 13 用例通过）：

| Workspace Package | 测试文件（全量 run 中实跑）| 结果 |
|---|---|---|
| @nomicore/doc-runtime | `materialize-root.test.ts (13)`、`extract-yjs-snapshot.test.ts (21)`、`extract-plain-domain.test.ts (9)`、`extract-nonfinite-number.test.ts (8)`、`extract-union-trial.test.ts (8)`、`extract-record-keyspace.test.ts (2)` | ✓ 6 files / 61 tests passed |
| @nomicore/vfsl | 24 个 `*.test.ts`（parse-vfsl* / evaluate-* / validate-* / compile-schema-envelope* / docscope-* 等）| ✓ 全绿 |
| @nomicore/persistence | 9 个 `*.test.ts`（file/memory-persistence、issue-79-*、contract、module-graph-regression 等）| ✓ 全绿 |
| @nomicore/dsh-persistence | 3 个 `*.test.ts`（dsh-probe-cli、dsh-profile-acceptance、dsh-file-probe-determinism）| ✓ 全绿 |
| @nomicore/vfsl-codegen | 6 个 `*.test.ts`（generate-*）| ✓ 全绿 |
| @nomicore/vfsl-protocol | 1 个 `*.test.ts`（vfsl-protocol-empty-module）| ✓ 全绿 |

**本地动态触发结论**：`✓ packages/doc-runtime/test/materialize-root.test.ts (13 tests)` 出现在全量 run 的 Test Files 列表且通过 → **本地 all-vitest-packages-triggered**。

**CI Run**: **环境阻塞——分支未 push**。`fix/issue-74-on-docs-doc-runtime-validation` 不存在于 origin（`git ls-remote --heads origin <branch>` 空、`gh run list --branch <branch>` 空、`gh pr list --head <branch>` 空；本地待推 commit = `ac0f487` + `d25beb6`）。SA7 职责边界不含 push/建 PR/宣称 CI 已绿；静态触发链已由 SA4 §0.2 核验（根 vitest glob 覆盖该文件 + `pnpm typecheck` 显式含 doc-runtime tsconfig），本地全量 run 即该触发链的动态复现。**CI 侧 `gh run view --log` 摘录（node 20/24 双矩阵腿）留待总控 push 后补录**，不构成本轮 verdict 阻塞项。

| Workspace Package | CI Step Name | 触发结果 | log 摘录 |
|---|---|---|---|
| @nomicore/doc-runtime | Test（CI 未运行）| 🔥 CI run 不存在（分支未 push，环境阻塞）| 本地等价复现：`✓ packages/doc-runtime/test/materialize-root.test.ts (13 tests)` + `Test Files 57 passed (57)` |

**verdict**: ✅ all-vitest-packages-triggered（本地动态证据）；CI 动态确认环境阻塞已登记。

## 环境阻塞与边界登记

1. **CI 触发证据（SA4 动态审核重点 #1）**：分支未 push → 无 PR、无 CI run → `gh run view --log` 无从摘录。属环境阻塞而非实现缺陷；静态触发链（SA4 §0.2）+ 本地全量动态复现（§Step 4）双证覆盖，CI 补录责任在总控 push 之后。
2. **SA4 动态审核重点 #4（XML 文法镜像同步义务）**：长期回归点登记（vfsl `xml.ts` 演进时 `xml-parse.ts` 须同票跟进），本轮两侧逐字镜像状态经探针行为面间接复核（RL6/AC5-1..5 与 vfsl 良构扫描器对同串判定一致），无动作项。
3. **SA4 M2（手造空成员联合 E200 message 措辞）**：INFO 级，不阻塞；本轮未重复验证（13 用例与红线均不触达）。

## 验证命令与日志索引（可复跑）

| # | 命令（worktree 根，全部 setsid nohup 后台）| 日志 | EXIT |
|---|---|---|---|
| 1 | `pnpm exec vitest run packages/doc-runtime/test/` | `/tmp/sa7-docrt.log` | 0 |
| 2 | `pnpm exec vitest run --typecheck` | `/tmp/sa7-full.log` | 0 |
| 3 | `node_modules/.bin/tsx ./sa7-probe.tmp.mts`（workdir=packages/doc-runtime；29 项探针；脚本验证后已删除）| `/tmp/sa7-probe.log` | 0 |

## 结论

- SA6 冻结 13 用例全绿；extract 侧 48 用例回归锚无损；全仓 57 文件 / 773 用例 / typecheck 全绿。
- 总控交办 4 项动态重点逐条活链路实测通过：unknown 位六类脏值（NaN/bigint/Date/function/数组内 undefined/内嵌 Y.Map）写侧响亮拒绝+零写入；XML attr 双引号 ① 过 ② 拒；Record `__proto__` 键往返正确；union ROOT（合法双成员 + 手造非 map 成员 E200 定谳 + 全拒首差异词）；多键 observer 部分提交不清理不虚假回滚；嵌套事务归并单 update；B1/B2/B3/B7/B12/B15 六条 B 段断言重证；AC-5 五串 XML 语义等价往返 + 再校验；AC-6 双 observer 面（ROOT 级/doc 级）loud 传播。
- 无任何静默失败 / 伪降级 / 虚假回滚行为被发现；未发现 SA4 pass 之外的缺陷。

**Verdict: pass** —— 可交总控进入 push/CI 阶段（CI 触发证据补录后闭环）。
