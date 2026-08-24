# SA4 静态验尸报告 — namespace-runtime replaceSchema（issue #91 Phase 3）

- **Date**: 2026-08-24（SA4 独立验尸）
- **对象**: SA3 实现（工作树未提交 diff：base `docs/namespace-runtime`@1616c28 == HEAD；新建 `schema-write.ts` / `schema-replace.ts` + 7 文件修改 + 3 冻结测试）
- **Verdict**: **pass**（0 CRITICAL / 0 HIGH / 0 MEDIUM；3 LOW 观察项均不阻断——见 §11 分级清单）

---

## 0. 审核方法与证据基础

不采信 SA3 自述，以下证据全部由 SA4 于本 worktree 独立重跑（独立进程，日志 `/tmp/sa4-runs/`；scratch 于包根 dotfile 即用即删，未触碰 src/ 与 test/）：

| 证据 | 命令 | 结果 |
|---|---|---|
| 定向 namespace-runtime | `pnpm exec vitest run packages/namespace-runtime` | **exit 0**：13 文件 66 用例全绿 + Type Errors 0（含 SA6 冻结 13+2+1） |
| 定向 doc-runtime | `pnpm exec vitest run packages/doc-runtime` | **exit 0**：19 文件 291 用例全绿 + Type Errors 0（含 `public-surface-guard`） |
| 设计 §12.1 脚本 A（行为） | `tsx .verify-design.ts`（逐字复刻） | 输出与设计「→」锚**逐字一致**（见 §6） |
| 设计 §12.1 脚本 B（类型） | `tsc --noEmit --strict --exactOptionalPropertyTypes … .verify-twin.ts` | `TYPE-CHECK PASS`（exit 0） |
| SA4 注入验尸（57 项断言） | `tsx .sa4-attack.ts`（A1 四变体 / A4-γ / α / β / D7 四边界 / S3 形状面 / 载体异型） | **ALL SA4 CHECKS PASS**（exit 0，逐项见 §8/§9/§10） |
| 总控四闸口日志 | `.mabf-bg/verify-p3.log` | gate2 全量 83 文件 1069 用例 exit 0 / gate3 七包 tsc exit 0 / gate4 聚合 tsc exit 0——与 SA3 记录一致 |

---

## 1. Scope Creep Guard（§1.1 硬门禁）

- **ALLOW LIST 提取**（design §11）→ **actual diff**（`git diff HEAD` + untracked；HEAD==base 1616c28 已核实）→ **set 比对**：代码面 12 个文件（8 namespace-runtime + 2 doc-runtime + CONTEXT.md + 2 package.json）**全部落在 ALLOW LIST**；3 个测试文件均为 `[SA6 owned]` 冻结文件，与 ALLOW 一致。
- **DENY LIST 零触碰**（`git diff HEAD --stat` 空集核实）：`sequencer.ts` / `status.ts` / `projection.ts` / doc-runtime 全部共享模块（`replace.ts` / `materialize.ts` / `mutation.ts` / `detached-build.ts` / `install-verify.ts` / `tx-guard.ts` / `carrier.ts` / `fatal.ts` / `extract.ts` / `read.ts` / `resolve.ts`）/ `packages/vfsl/**` / `packages/persistence/**` / `docs/adr/**`。
- **既有 10 个 namespace-runtime 测试文件零改动**（`git diff HEAD --name-only -- packages/namespace-runtime/test/` 为空，仅有 3 个新冻结文件 untracked）。
- **BLACKLIST**（package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）：零命中。
- **非 creep 的两个 runner 产物**（登记，非 SA3 越界）：`.mabf-done`（基线 HEAD 已跟踪文件，运行时删除）与 `.mabf/`（untracked runner 状态，**未被 .gitignore 覆盖**——.gitignore 只列了 `.mabf-bg/`）。→ **收口建议**：总控 commit 时按路径清单显式收口（packages/ + CONTEXT.md + wiki/），**排除 `.mabf/` 与 `.mabf-done` 删除**，避免 PR #253（TASK.md 残留）同型事故。

**结论：scope-creep 未检出，门禁通过。**

## 2. 设计一致性（§1.2）——D1–D10 逐条对照

| 决策 | 实现落点 | 判定 |
|---|---|---|
| D1 第九键（属性语法 + 类型化 input）+ V3c'' 零新增注入点 | `runtime.ts:82`（`readonly replaceSchema: (input: ReplaceSchemaInput) => Promise<ReplaceSchemaResult>`）+ `:144-147`（`schemaWriteEnv` 同批捕获局部量：doc/handle/state/notifyDirty/compile）；`sequencer.enqueue(() => runSchemaWriteSlot(...))` 与 mutateRoot **同一 sequencer 实例** | ✅ |
| D2 七步槽序 | `schema-write.ts:101-198`：S1 fatal gate（:103）→ S2 getStatus+notifier（:108-126）→ S3 快照+形状（:129-132）→ S4 编译（:135-153）→ S5 seam（:156-174）→ S5.5 installActive（:179）→ S6 await notify（:182-194）→ S7（:197）——次序与设计逐位一致，无重排 | ✅ |
| D3 snapshotter 共享 + 形状检查 | `snapshotMutation` 复用（:129，copyFrozen R2 四查次序原样）；`shapeOfReplaceInput`（:208-238）镜像 mutation.ts (A) 措辞：非对象/缺 schema/未知键 → 单 issue `path:[]` | ✅ |
| D4 不依赖当前 schema 可编译 | S4 只读 `shape.schema`，**零读 state.active 域**（grep 证实：schema-write.ts 对 env.state 的全部引用仅 `fatal` 检查与 `installActive` 传参） | ✅ |
| D5 编译三级分类 | `:137-153`：ok:false 非空 → `toReplacementIssue` 映射 ok:false；ok:false 零 issues → throw；畸形 ok:true → `assertCompiledShape` throw → 全部归 `schema-compile-throw` committed:false | ✅ |
| D6 组合 seam 单事务 | `schema-replace.ts:105-131`：⓪ guard 第一句（:106）→ ① prepare（唯一 try/catch :138-210）→ ② `transactGuarded` 单事务内 SCHEMA clear+恰四 set [+ ROOT 原实例 clear+entries 安装]（:113-123）→ ③ ⑤-S（:125）→ ④ ⑤-R+⑥ 喂 narrowed（:126-129）→ ⑤ `{ok:true}` | ✅ |
| D7 顶层声明域投影 | `projectDeclaredRootKeys`（:318-337）：union/非 map 不投影、Record 形经 `recordSlotOf` 单点判定不投影、顶层 declared 集过滤 + `defineProperty` proto 纪律 + present 惯例；验证/构造/⑥ 全消费 narrowed | ✅ |
| D8 install 时点 + 单点状态迁移 | S5.5 同步位于 seam ok 之后、`await notifyDirty()` 之前（:176-183）；`installActive` 五字段直引 compile 产物 + tools + `'ready'` + `delete schemaIssue`（p0.ts:146-159） | ✅ |
| D9 fatal 分类表 | 逐行核验见 §9 | ✅ |
| D10 零新增注入点 / status.ts 零改动 | seam 输入不变；status.ts 未触碰，`schemaWrite = !fatal && writableNow`（:47）推导保持 | ✅ |
| 版本 bump（硬门禁 9） | namespace-runtime **0.1.3** / doc-runtime **0.1.9** | ✅ |
| A2 三处显式化 | ① `ReplaceSchemaInput.root` JSDoc（schema-write.ts:69-85，含 issues 窄化消费示例）；② CONTEXT.md 术语条目（diff 逐字符合 D7 末尾基准）；③ `projectDeclaredRootKeys` 实现注释 | ✅ |

**偏离项：无。**

## 3. 契约改动连锁审查（§1.6 立法）

本 diff 无「return→throw / Promise 形态变更 / 同步转异步 / catch rethrow / nullable 翻转」任一类既有路径契约改动——全部为**加法**（新成员/新导出/append-only 枚举/可选参数默认值）。加法面 caller 审计（grep 含 untracked）：

| 改动 | Caller | 三层防御 | 判定 |
|---|---|---|---|
| `markWriteFatal`/`rejectWithWriteFatal`/`writeFatalMessage` + 可选 `slot` 参数（默认 'root'） | write.ts ROOT 路径 4 处调用（不带 slot → 默认渲染） | 渲染逐字节比对：`NSRT-WRITE-FATAL: ROOT write internal fatal（phase=…, committed=…）；…` 与 #90 模板**逐字节相同**；`runtime-write-fatal-message-rev1.test.ts` 3 用例实测绿 | ✅ 零回归 |
| `installActive` 增 `delete state.schemaIssue` | ① p0.ts:94（P0：unavailable 分支不调 installActive，preparing→ready 时 `schemaIssue` 恒 undefined → **no-op**，runP0 源码核实）；② schema-write.ts:179（S5.5） | 无可观测差异（status.ts 仅 unavailable 态投影该字段） | ✅ |
| `assertCompiledShape` 检查面扩展（A1） | ① P0 ⑤；② schema-write S4 | P0 侧唯一新增触发面 = 注入 seam 返回畸形 ok:true——已核对 `runtime-p0-sequencer.test.ts` **无畸形 ok:true 注入用例**（仅 ok:false ENV_TEST 注入），分类不变（本就 throw→⑦ fatal）；真实 vfsl 产物恒过（ENV-5 + 五件套深冻结） | ✅ 零回归 |
| `replaceSchemaAndRoot`（新公共入口，throw 面 E201/E202/E203/E204） | 唯一 caller = schema-write.ts:161（同步调用、try/catch 包裹：branded 透传 committed/phase；未知保守 committed:true） | 槽体一切异常经返回 Promise 结算（sequencer 链尾恒绿） | ✅ |
| `NamespaceRuntime` +第九键 | 实现方全仓唯一（runtime.ts:133 `git grep implements`）；公共消费均为方法调用 | 加法对调用方零破坏 | ✅ |

**结论：无 uncaught rippling，白名单豁免条件满足。**

## 4. 测试质量审查（§1.7 源码 GREP 断言禁令）

对 3 个新增测试文件逐行扫描：**零 `readFileSync` + 零源码字符串断言**。全部断言为运行时行为锚：Proxy 输入访问计数（`accesses()===0`）、Y.Doc update 计数、`encodeStateAsUpdate` 字节比对、notifier 计数、identity `toBe` 同一实例、`expect.poll` 时序窗口、Persistence 跨实例读回。类型守卫文件锚成员存在性（`expectTypeOf().toBeFunction()`），符合其定位。

## 5. vitest 触发性自检（§1.4 硬门禁 13）——**通过**

- 新增 `*.test.ts`：`packages/namespace-runtime/test/runtime-replace-schema-{sequencer,persistence}.test.ts`；新增 `*.test-d.ts`：`runtime-replace-schema-type-guard.test-d.ts`。
- 仓库根 `package.json` `"test": "vitest run --typecheck"`；`vitest.config.ts` `include: ['packages/*/test/**/*.test.ts']` + `typecheck.include: ['packages/*/test/**/*.test-d.ts']`——**workspace 级全量收集，namespace-runtime 在覆盖内**。
- `.github/workflows/ci.yml` `Test` 步骤（:39）= `pnpm test`，Node **20/24 矩阵**；`Typecheck` 步骤（:36）= 七包 tsc（含 namespace-runtime/src 新文件）。
- 实证：总控全量闸口 83 文件 1069 用例含三个新文件；SA4 定向复跑 66 用例绿。
- **结论：`vitest-package-not-triggered` 未检出。**

## 6. 协议假设审查（§1.5 硬门禁 14）——**通过（§12.1 逐字重跑 9/9 命中）**

设计 §12.1 脚本 A/B 由 SA4 **逐字**落盘于 `packages/namespace-runtime/.verify-design.ts` / `.verify-twin.ts`（运行后已删）重跑：

| 依据 | 设计锚 | SA4 复跑输出 | 判定 |
|---|---|---|---|
| 5 | envelope keys → id,lang,text,version | `envelope keys: id,lang,text,version` | ✅ |
| 1 | validate 多余键 → 未知字段 "b" | `未知字段 "b"：封闭对象不接受未声明键`（path ['b']） | ✅ |
| 1 | 缺必填 → 缺少必填字段 "b" | 逐字一致 | ✅ |
| 2 | buildTopEntries F7 | `快照含结构树未声明字段 "b"——拒绝静默丢键` | ✅ |
| 2 | 缺必填不阻塞 build | `entries [["n",5],["a","z"]]` | ✅ |
| 9 | extract v2b → {a,n} 且 validate ok | 逐字一致 | ✅ |
| 9 | extract v3 → 载体错位 | `Yjs 载体错位（ROOT.a）：期望 Y.Array，实际 plain value` | ✅ |
| 4 | 单事务恰 1 update + identity | `replaceRootContent => {"ok":true} updates: 1 identity: true` | ✅ |
| 6 | 孪生兼容 | `TYPE-CHECK PASS`（exit 0） | ✅ |

另对第三方库补充实证：yjs `getMap` 于同名 Y.Text 上确实 throw（`probeSchemaMap` 四级级联的 catch 前提成立——SCHEMA=Y.Text 实测走 `carrier:'Y.Text'` → ok:false 零写入）。**结论：`unverified-protocol-assumption` / `protocol-assumption-mismatch` 均未检出。**

## 7. 其余静态度量

1. **读写路径一致性**：✅ 无分叉。写 = S5 单事务（SCHEMA/ROOT 同一 `transactGuarded`）；读 = projection/status 直读 live doc + state.activeInfo 单点驱动；active 与 committed 仅在写后 fatal 撕裂（设计 D8/A3 显式登记形态，见 §10-α）。
2. **静默失败**：✅ 未发现。全部失败收敛三通道（ok:false 非空 issues / RuntimeWriteFatalError rejection + status.fatal 同步可观测 / 构造期无可抛点）；成功 = live commit + notifier 双信号。
3. **降级方案**：✅ 无伪降级。「SCHEMA 载体异型 → ok:false」与 #88 G3-3 同族且保留修复可达性；「显式 root:undefined → MUTATION_INPUT_NOT_PLAIN_DATA」为 loud 拒绝且 message 携带键名（A8 落实，实测含「键 "root"」）。
4. **极端条件攻击**（§5 静态 + 动态补充，57 项全过）：`{schema:42}` 经真实 vfsl 全总编译（ENV-100 兜底不外抛，源码核实）→ ok:false **不误升 fatal**；Record 形 root 全保留（extra=9 可读回）；union 形不投影 loud 失败；嵌套未声明键 loud；SCHEMA 缺席惰性创建零 update；SCHEMA=Y.Text 异型零写入；S3 形状四负例（未知键/缺 schema/非对象/显式 undefined）全部单 issue loud 且组后可继续成功替换。
5. **错误处理链路**：✅ 完整（分类表 §9 全落线；A3 撕裂态被 status.fatal 显式标记不静默冒充健康）。
6. **架构死胡同**：✅ 无信号。绕过架构约束 0 处；组合 seam 是 #88 §5/D6 第 3 条逐字预授权载体；仓内零第二份构造规则（buildTopEntries/probeRoot/transactGuarded/verifyInstall/verifySnapshotIntact/extractYjsSnapshot/makeRefResolver 全部只读复用）。
7. **过度设计**：✅ 精简。新增代码只有编排 + SCHEMA 四键写入 + ⑤-S + 探针 + 投影；`WriteSlot` 参数化以默认值保 ROOT 逐字节渲染，无多余抽象层。（微观察：`errDetailOf` 导出后 schema-write.ts 未消费——设计 ALLOW 预告的共享件，无害。）

## 8. SA2 红线六条逐条核验（§5 红线测试思路）

| # | 红线 | SA4 证据 | 判定 |
|---|---|---|---|
| ① | schema-write.ts 零 `schemaState` 门 | `grep schemaState packages/namespace-runtime/src/schema-write.ts` → **零命中**（env.state 引用仅 fatal gate + installActive 传参） | ✅ |
| ② | A1 畸形 ok:true envelope → schema-compile-throw **fatal**（非 ok:false） | 注入四变体（envelope 多一键 / text:42 / version:'1' / 缺 text 键）→ 全部 `RuntimeWriteFatalError` rejection，phase=`schema-compile-throw`、committed=false、0 update、0 notifier、字节不变、status.fatal=`NSRT-FATAL-SCHEMA-WRITE-INTERNAL`、active tools 仍 ns-1 | ✅ 4/4 |
| ③ | A4 `DerivedInvariantError→E204` 分支镜像 | 手造环 ref derived（structure.node=ref A, aliases.A=ref A）→ rejection phase=**`pre-commit-internal`**、committed=false、零写入（**非** E200 ok:false）；代码 `schema-replace.ts:190-203` instanceof 分支逐字镜像 prepareReplace | ✅ |
| ④ | 单事务恰 1 update、双顶层 Y.Map identity | 代码 ② 单 `transactGuarded` 内原实例 clear+set（:113-123）；冻结测试锚（updates=1、`doc.getMap('ROOT')`/`getMap('SCHEMA')` toBe 同实例）全绿；§12.1 复跑同证 | ✅ |
| ⑤ | installActive 先于 `await notifyDirty` | `schema-write.ts:179`（install）→ `:182-183`（await）；冻结测试 3「notifier 挂住窗口 getActiveSchema===ns-2」绿 | ✅ |
| ⑥ | D7 投影边界四态 | 动态实证：顶层剥离（ns-2b × {n,a,b,zzz} → ok:true、键集恰 {a,n}、read b===undefined）；嵌套 loud（inner:{x,y} → ok:false 含 y）；Record 全保留（extra=9 读回）；union 不投影（{a,b} → loud 失败零写入） | ✅ 4/4 |

## 9. fatal 分类表代码落线核验（D9 表逐行）

| 触发 | 设计 committed/phase/notifier | 代码落点 | SA4 动态证据 | 判定 |
|---|---|---|---|---|
| S2 getStatus 抛错 | false / write-slot-internal / 0 | `:113` `rejectWithWriteFatal(env, false, 'write-slot-internal', …, 'schema')` | 结构同 ROOT 槽（#90 已锚） | ✅ |
| S4 compile 抛出 / ok:false 零 issues / 畸形 ok:true | false / **schema-compile-throw**（新）/ 0 | `:140`（零 issues throw）、`:149`（守卫）、`:152`（统一 fatal） | A1 四变体 4/4（§8②） | ✅ |
| S5 branded（E201/E203/E204） | 透传 committed/phase / committed:true → best-effort 恰一次 | `:169-171` | α（E201 committed:true + notifier 恰 1 次）、β（E203 committed:true + 恰 1 次）、γ（E204 committed:false + 0 次） | ✅ |
| S5 未知异常（含 E202 误用） | true（保守）/ unknown-pipeline-throw / best-effort | `:172` | 过报方向与 #90 同构 | ✅ |
| S6 notifyDirty 失败 | true / notify-dirty-failed / 不重试 | `:184-194`（markWriteFatal + 直 throw，不经 rejectWithWriteFatal——不重试 notifier） | 结构同 ROOT 槽（rev1 测试锚） | ✅ |

摘要码区分：全部经 `slot:'schema'` → `NSRT-FATAL-SCHEMA-WRITE-INTERNAL`（errors.ts append-only 新码/文案恒定不插值；phase 联合 append-only 增 `'schema-compile-throw'`）。ROOT 路径渲染逐字节不变（模板 noun 参数化，`'root'` 分支字符串与 #90 逐字符相同；rev1 冻结测试 3 用例绿）。

## 10. replaceSchema fatal 通道确定性锚评估（SA6 移交项 / 设计 D9 末条）

**裁决：本轮不补冻结锚（SA4 边界禁改 test/），移交 SA7 动态补锚——且 SA4 已先行完成全量动态验证，补锚素材即取即用。**

- **SA4 动态验证已覆盖**（57 项断言全 PASS，scratch 即用即删）：
  - **α（E201 + A3 撕裂态）**：`doc.on('update', () => sc.delete('text'))` → rejection phase=`post-commit-verification`/committed=true；**撕裂五要素全部实证**：`getActiveSchema()?.id==='ns-1'`（旧）× `getSchemaEnvelope()?.id==='ns-2b'`（新）× read 观察新 generation × rootWrite/schemaWrite 双 false × 后续 mutateRoot/replaceSchema 均 settle `{ok:false, RUNTIME_WRITE_DISABLED}`（队列不挂死）；best-effort notify 恰 1 次。
  - **β（E203）**：`doc.on('update', () => { throw })` → phase=`observer-cleanup-throw`/committed=true/notify 恰 1 次。
  - **γ（E204）**：见 §8③。
- **为何移交而非本轮补**：冻结测试文件属 SA6 所有（设计 §11 `[SA6 owned]`），SA4 按 Skill 只可新增「稳定复现测试」且本任务禁改 `test/` 下任何文件；而设计已声明该锚「另立冻结文件」属 SA6/SA7 职责面。
- **SA7 补锚规格**（可直接落 `packages/namespace-runtime/test/runtime-replace-schema-fatal-channel.test.ts`）：三条注入路径 + 上述断言清单（α 需含撕裂态五要素与 DISABLED 后续；β/γ 各至少 phase/committed/notifier 计数/字节不变）。零新注 seam——doc observer 与 seam compile 注入即可（设计 D9 末条 + SA4 scratch 已验证可行）。

## 11. 分级问题清单

| # | 级别 | 问题 | 处置 |
|---|---|---|---|
| L1 | LOW（收口卫生） | `.mabf-done`（基线已跟踪，运行时删除）与 `.mabf/`（untracked，**不在 .gitignore**——仅 `.mabf-bg/` 被忽略）位于工作树；若总控 `git add -A` 收口会把 runner 运行时状态带进 PR（PR #253 TASK.md 同型事故面） | → **总控**：按路径清单显式 commit（packages/ + CONTEXT.md + wiki/），排除 `.mabf*`；或后续单独立法把 `.mabf/` 加入 .gitignore（属 pipeline 仓库治理，非本任务 SA3 职责） |
| L2 | LOW（已登记开放项） | 顶层剥离无 advisory 反馈通道（typo 键名无声蒸发）——设计 §10 R7 已显式登记「另立 issue」（冻结结果联合无携带位）；A2 三处显式化已落实 | → 后续 issue（不阻断本轮；SA1 已登记） |
| L3 | LOW（移交验证） | replaceSchema fatal 通道确定性**冻结锚**缺失（SA6 备注显式移交；运行时行为已由 SA4 57 项动态验证全过） | → **SA7**（配方见 §10） |

**无 CRITICAL / HIGH / MEDIUM。**

## 12. 动态审核重点（交 SA7）

1. **补 replaceSchema fatal 通道冻结锚**（§10 规格：α/β/γ 三路径 + α 撕裂态五要素 + DISABLED 后续写；建议真实 Persistence 语境下再各跑一条 saveDoc 已登记断言）。
2. **CI 动态证据**：从 `gh run view --log` 摘录 Node 20/24 两矩阵中 `Test` 步骤含 `runtime-replace-schema-*` 三文件收集行 + `Type Errors 0`（§1.4 静态结论的动态面）。
3. **P0→replaceSchema 恢复链在真实 Persistence 下的 flush 时序**（冻结测试已覆盖 2 用例；SA7 抽查 debounce 窗口内 crash 注入点位于事务后的跨实例一致性——SA2 红线思路 §5.5）。
4. **⑥ verifySnapshotIntact 喂 narrowed 的对称性**：投影后含嵌套 Y 载体类型（如 `a: string[]`）的 replace-root 快乐路径在真实 yjs 下的 ⑥ 双侧提取等价（冻结测试 v2 平面形状为主；建议 SA7 加一条嵌套载体用例的动态确认，非阻断）。

---

## 结论

**Verdict: pass。** ALLOW/DENY 零越界（DENY 13 文件 + 既有 10 测试零触碰）；SA2 红线 6/6 落实（A1 四变体/A4 镜像/单事务双 identity/时序/投影四边界全部动态实证）；fatal 分类表 5 行全部落线且 ROOT 路径逐字节零回归；硬门禁 9（版本）/13（vitest 触发）/14（协议假设逐字复跑）全过；定向 66+291、总控全量 1069 全绿复现。SA7 可进入动态验证（§10/§12 清单）。
