# SA6 诊断与验收契约 — Issue #273 namespace-runtime + namespace-registry：readData 成功分支返回语义 schema 投影（ADR 0016）

- Worktree：`/home/wangjian/nomicore-fix-issue-273`（branch `mabf/issue-273`，HEAD `1acd9e9` = #272 合并提交）
- Phase：acceptance-contract（iteration 0）
- 任务类型：**feature**（能力缺口契约——非 Bug，无虚构根因）
- 裁决：**approve**（能力缺口证实、契约可执行、测试入口真实、红灯原因正确、负控绿）

## 1. Task type and inputs

| 输入 | 位置 | 说明 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-273.md` | Issue #273 正文快照；行为要点 6 条 + AC1–AC5；Task Type: feature；Parent PR #271；Blocked by #272 |
| dispatch | `wiki/raw/task_273_dispatch.md` | SA8 conflict-gate clear（1788922756763）；本 SA6 acceptance-contract 派发（1788923333935） |
| 冲突门禁 | `wiki/raw/task_issue-273_conflict_report.md` | Verdict clear：ADR 全集 14 文件无冲突；红线提醒 7 条；#272 已满足（CLOSED，合并提交即 HEAD）；PR #271 OPEN 设计使然 |
| 母法 | `docs/adr/0016-readdata-semantic-schema-projection.md` + `docs/adr/0008`（ADR 0016 修订节 L167–177） | 已接受；结果形状/投影体/解析语义/交付纪律/分层与兼容面 |
| 依赖面 | `packages/vfsl/src/resolve-schema-at-path.ts`（#272） | 公共导出 `resolveSchemaAtPath` + `ReadDataSchemaProjection`/`ResolveSchemaAtPathResult`（index.ts L125–126）；头注「detached 深拷贝属 namespace-runtime 组合边界」 |

环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7（根 `pnpm install --frozen-lockfile` 完成，无 approve-builds 拦截的依赖脚本）。

## 2. Owner comment mapping

Issue comments 经 REST 当前读取为空（dispatch 记录 + SA8 以 `gh issue view 273` 复核 `comments: []`），本 SA6 阶段无新 owner 评论（本次会话不重复 REST 读——dispatch/门禁快照即当前事实）。**无 owner 要求需并入**；执行标准唯一来源 = 简报 AC1–AC5 + ADR-0016。

## 3. SA8 constraints（并入契约的方式）

1. **包装而非透传**：runtime 成功分支将不再是 `ReadLogicalValueResult` ok 变体原样——新形状 `{ok:true,value,schema}` 必须显式映射。→ 红契约以「ok 分支恰三键 {ok,value,schema}」锚（red #1）。
2. **lease `Equal` 锁同步**（AC1 两层类型一致）。→ 类型锚 `registry-readdata-schema-red.test-d.ts`；既有 `lease.ts` L384–401 `Equal<NamespaceLeaseReadDataResult, ReturnType<NamespaceRuntime['readData']> | …>` 编译锁是强制跟随点（runtime 联合变更后别名不同步即编译红）。
3. **resolver 失败两码收敛 `schema:null`、不泄漏进读联合**。→ null 三情形契约断言 `schema === null`（不锁内部原因区分，ADR 单义性）。
4. **InternalError 通道归属属设计钉死面**（resolver 对可信域畸形 derived 抛 InternalError）——契约不锁该处置（SA1/SA2 设计面），报告 §15 记录。
5. **深拷贝是本票义务**（#272 resolver 返回与 derived 共享节点）。→ AC3 隔离契约锚（引用级 not.toBe + 改写污染 + 不冻结）。
6. **测试改锚面**（ADR-0016 Consequences：读结果 toEqual 全等断言需更新）。→ §10 impact surface 清单。
7. **工作流纪律**（栈接 PR #271 支系；本地 origin/main 陈旧）——本阶段零 commit/push，无关。

## 4. Environment and baseline

- HEAD `1acd9e9`（fix(#272): resolveSchemaAtPath 路径解析器）＝本任务依赖面已就位；`git status` 仅未跟踪快照/契约文件，**生产实现零改动**。
- 既有基线抽查（本会话运行）：
  - `vitest run runtime-sync-read-face.test.ts runtime-acceptance-exports-audit.test.ts --typecheck.enabled=false` → **8 passed**（同步读面/公共面审计在 HEAD 全绿，未受任何影响）。
  - 全仓类型面 `tsc -p tsconfig.typecheck.json`（含全部包测试与既有 test-d 锚）→ **仅 2 处新红**（见 §13），其余全部通过——证明既有类型锚无一漂移。

## 5. Positive reproduction — 能力缺口（feature 证明）

**缺口声明**：`readData` 成功分支当前是 doc-runtime `ReadLogicalValueResult` 的零包装透传 `{ ok: true, value }`（`runtime.ts` L116–118 联合、L438–446 透传），**没有任何 schema 投影**——agent 消费者无法随值取得该路径语义 schema，违反 ADR-0016 结果形状。

最小输入/观察矩阵（运行时行为，HEAD 实跑，probe 阶段控制台 + 红契约）：

| schema 状态 | 触发 | readData(['count']) 观察（HEAD） |
|---|---|---|
| ready | 真实信封 P0 编译成功 | `{ok:true, value:3}`，`'schema' in r === false` |
| preparing | p0Gate 未放行 | `{ok:true, value:3}`，无 schema |
| unavailable | 破损文本编译失败 | `{ok:true, value:3}`，无 schema |
| fatal | compile seam throw | `{ok:true, value:3}`，无 schema |

路径矩阵（ready 态）：`[]`/`['count']`/`['meta']`/`['meta','content']`/`['tags',1]`/`['skus','ab']`/`['nick']`/`['rogue']`/`['skus','ZZ1']` 全部读成功且值正确（值面零问题），但**每一条的 ok 分支都不存在 `schema` 键**——缺口是「随值的投影附加」，不是读本身。

## 6. Negative control

负控文件 `runtime-readdata-schema-projection-control.test.ts`（HEAD **6 passed**，目标实现后应保持绿——实现越界即红）：

1. doc-runtime 层逐字节不变：`readLogicalValueAtPath` 成功 = 恰两键 `{ok,value}`（值缺席吸收 = 显式 undefined）、失败单通道 `PATH_NOT_ALLOWED`（标量下钻/数字段）——**schema 无关读取是分层义务**（ADR-0016 L74，doc-runtime 零改动）。
2. runtime 失败分支不变：`PATH_NOT_ALLOWED`（['count','x']）与 `RUNTIME_READ_DISABLED`（close 后）码/形状不变，失败对象**不带** `schema` 键——schema 只进成功分支。
3. 成功分支加法兼容：ok/value 持续在场、值内容正确、preparing 期读取不等待 P0。

## 7. Stability, scale and timing

- 全部状态经**确定性同步 seam** 达成（p0Gate resolve 控制 / 真实编译失败 / compile seam throw），JS 单线程、读同步、无时钟依赖；三状态各 1ms 级结算。
- 复现率：红契约连续 3 次运行均 **15/15 红**（原因一致，见 §13）；负控 2 次运行均 6/6 绿。无 flake、无竞态窗口、无超时依赖（unavailable 轮询 2s 界内毫秒级结算；全文件 ~百 ms 级）。
- 规模/性能非本 feature 关注（每次读 O(path×N+schema 子树) 成本为 ADR 记录的设计取舍，不在契约内压测）。

## 8. Capability gap（feature 的缺口链，替代 Bug 根因链）

| Step | 事实 | 证据 | Confidence |
|---|---|---|---|
| ① doc-runtime 读面 schema 无关是母法冻结项 | `ReadLogicalValueResult = {ok:true,value} \| {ok:false,PATH_NOT_ALLOWED,…}`；读取按载体驱动 | `doc-runtime/src/read.ts` L44–46、L127/L184；ADR-0008「读取能力」 | high |
| ② runtime.readData = 零包装透传，无 schema 附加点 | `NamespaceRuntimeReadDataResult = ReadLogicalValueResult \| RuntimeReadDisabledResult`；readData 分支直接 `readLogicalValueAtPath(doc,path)` | `runtime.ts` L116–118、L438–446（D3 零包装注记） | high |
| ③ 组合素材已就位但未接线：P0 activeTools.derived 只进内部、resolver 只属 vfsl | `activeTools {module, derived}` 内部保留（D8 修订前条款）；`resolveSchemaAtPath` 公共导出但 namespace-runtime 无任何使用 | `p0.ts` L42–43/L169；`resolve-schema-at-path.ts` 头注；全仓 grep（§10） | high |
| ④ registry lease 只做类型别名 + 直透传，行为零变化是设计 | `NamespaceLeaseReadDataResult = ReadLogicalValueResult \| RuntimeReadDisabledResult \| released`；lease.readData 直返 `entry.runtime.readData(path)` | `registry/src/types.ts` L448–451；`registry/src/lease.ts` L276–278；L384–401 Equal 锁 | high |
| ⑤ 能力缺口收敛点 = namespace-runtime 组合边界（成功读 = 值 + resolver 投影每次读深拷贝） | 缺口可观测：任何成功读均无 `schema`（§5 矩阵）；红契约 15/15 在 schema 键失败 | 本会话运行证据（§13） | high |

## 9. Causal experiments（最小因果实验）

1. **值面 vs 投影面解耦实验**：同一 doc 上 doc-runtime 直读（负控）与 runtime.readData 值断言全部通过，唯独 `schema` 断言失败 → 排除了「fixture/doc 构造/载体错误导致整体红」的环境解释；红是**缺口专属**（§6 控制 + §13 断言消息均落在 schema 键）。
2. **预言机健全性**：期望投影由 vfsl 公共 API（`compileSchemaEnvelope` + `resolveSchemaAtPath`）独立求值——与 runtime 未来组合面同源同库；另设不依赖预言机的**字面量锚**（scalar number / ref 按名保留 Meta / optional 包 scalar / aliases 闭包字面量 / docs 键集与内容）→ 断言对「错误子树 / 漏别名闭包 / docs 错切片 / 值语义错」均敏感，绝非预言机自证。
3. **状态矩阵实验**（§5）：preparing/unavailable/fatal/ready 四态逐一达成并读——若缺口仅在某一态，矩阵会暴露；实际四态一致无 schema。
4. **反证/变异敏感**：AC3 引用级断言（`not.toBe` 五层 + 三次连续读互异）+ 不冻结断言 + 污染改写断言——实现若共享活 derived/冻结/带缓存，均红；null 契约若实现把 resolver 失败码泄漏进联合或把缺席细分，均红。

## 10. Impact surface（实现参考，非本阶段改动）

- **生产代码**：仅 `packages/namespace-runtime`（readData 组合 + `NamespaceRuntimeReadDataResult` 重定型）与 `packages/namespace-registry/src/types.ts` L448–451 别名（被 lease.ts Equal 锁强制）可动；doc-runtime 零改动。
- **既有全等形状断言（ADR-0016 Consequences 登记的需要更新面）**——grep `toEqual({ ok: true, value`：
  - `packages/namespace-runtime/test/runtime-boundary-supplementary.test.ts` L91/L128
  - `packages/namespace-registry/test/registry-create.test.ts` L459/L513/L1645/L1765/L1766；`registry-open.test.ts` L356/L815/L879（后二者为 stub runtime readData 工厂字面量——类型锁逼更新）；`registry-idle.test.ts`（~L479/L504/L535/L615/L711/L764/L800/L907/L971/L1055/L1094 组）；`registry-sa7-rev1.test.ts` L546/L623/L686
  - 其余消费（`toMatchObject` 或仅 `.value` 访问）加法兼容：`registry-node-dispose` L124、runtime 多文件、`apps/yjs-server/src/app.ts` L548（读 `result` 仅消费值）——由根仓 `pnpm typecheck`/`pnpm test` 门兜底（AC5）。
- 注意 grep 噪音：replication identity `{ok:true,value:{replicationId…}}`（persistence/ws-replication/registry-phase5 系列）与 readData 无关，不受影响。

## 11. Ruled-out hypotheses

| 假设 | 排除依据 |
|---|---|
| 红因 fixture/doc 构造错误 | 值面断言与 doc-runtime 直读全部绿（§6/§9 实验 1）；红消息全部指向缺 `schema` |
| 红因测试入口/收集问题 | 文件被 vitest include 收集（`packages/*/test/**/*.test.ts`），15/15 确定性失败且各自有断言消息（§13）；负控同目录同入口 6/6 绿 |
| 缺口只在某一 schema 态 | 四态矩阵一致（§5） |
| registry 侧需要独立行为改动 | lease.readData 直透传（lease.ts L276–278）——runtime 落地即 lease 行为落地；registry 契约 = 类型跟随锚 + Equal 编译锁 |
| resolver 本身缺投影能力 | #272 已合入 HEAD（1acd9e9）且其契约测试全绿（vfsl 包门禁）；投影预言机对每条路径解析 ok（§9 实验 2） |
| 需新增公共方法/参数（AC4 反面） | 契约只要求形状演进；十二键审计与 ownership 测试保持绿（§4 基线） |

## 12. Acceptance contract and test paths

红契约 `packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts`（15 tests，HEAD 全红；目标实现后全绿）：

| # | 契约断言（最小输入 → 可观测断言） | AC/ADR |
|---|---|---|
| 1 | 空路径 `[]`：ok 分支**恰三键** {ok,value,schema}；value = ROOT 普通投影深拷贝；schema toEqual 预言机 `resolveSchemaAtPath(derived, [])` 四件套 | AC1/AC2 空路径 ROOT 投影 |
| 2 | 标量终点 `['count']`：schema = `{kind:'scalar',type:'number'}` + 空表（字面量锚） | AC1/AC2 投影体 |
| 3 | ref 别名终点 `['meta']`：value 深拷贝；valueSchema ref 按名保留 `Meta`；aliases 闭包字面量；docs 键集 {Meta.content, ROOT.meta} + 内容逐字；aliasDocs {Meta:…} | AC1/AC2 ref/闭包/注释切片 |
| 4 | 别名内深读 `['meta','content']`：scalar string + 脊柱 docs | AC2 docs 切片 |
| 5 | 数组元素 `['tags',1]`：array 元素语义 | AC2 |
| 6 | Record 合法键 `['skus','ab']`：槽值 scalar number | AC2 |
| 7 | 值缺席照常返 schema：`['nick']`（optional 缺席）与 `['skus','cd']`（Record 动态键缺席）→ value 显式 undefined + schema 非 null（optional 包原样保留） | AC2 路径键控 |
| 8–10 | `schema:null` 情形①（preparing p0Gate / unavailable 破损文本 / fatal compile throw）：读恒成功 value 正确、schema === null | AC2 无 active schema |
| 11 | `schema:null` 情形② 路径偏离 schema：`['rogue']` 数据在场（raw 复制式）读成功、schema null | AC2 |
| 12 | `schema:null` 情形③ 静态解析失败：`['skus','ZZ1']` keyPattern 失配读成功、schema null；同 map `['skus','ab']` 非 null（对照） | AC2 |
| 13 | AC3 两次读内容全等、五层引用互不共享（结果/valueSchema/aliases/别名体/docs/aliasDocs）+ 三次连续读互异（零缓存） | AC3 深拷贝 |
| 14 | AC3 改写返回投影（ref 附加属性/别名体替换/docs 污染）后：新读 toEqual 原样、非同一引用、live `getActiveSchema()` 身份不变；投影不冻结（可变普通副本） | AC3 隔离 |
| 15 | 双向隔离：改写第二次读的投影不影响第一次已返回投影 | AC3 |

类型锚（编译期红/绿翻转）：
- `packages/namespace-runtime/test/runtime-readdata-schema-red.test-d.ts`：`NamespaceRuntimeReadDataResult` ok 分支须存在 `{ok:true; value:unknown; schema: ReadDataSchemaProjection | null}` 成员（精确可空，无 undefined 第三态）+ 保持性守卫（doc-runtime `ReadLogicalValueResult` 不得携带 schema）。
- `packages/namespace-registry/test/registry-readdata-schema-red.test-d.ts`：`NamespaceLeaseReadDataResult` 别名须存在同形 ok 成员（AC1 两层一致）。

负控 `runtime-readdata-schema-projection-control.test.ts`（6 tests，HEAD 与目标后均绿）见 §6。共享夹具 `packages/namespace-runtime/test/readdata-schema-projection-fixture.ts`（非测试文件，vitest 不收集；TXT_273/ENV_273/seedRoot/makeHandle/makeReadyRuntime）。

## 13. Red/green or baseline evidence

命令（worktree 根）：

```
# 红契约（运行时行为面）
NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run \
  packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts --typecheck.enabled=false
# → Test Files 1 failed (1)；Tests 15 failed (15)
# 失败消息（代表性，全部落在 schema 键）：
#   expected [ 'ok', 'value' ] to deeply equal [ 'ok', 'schema', 'value' ]        (#1)
#   expected undefined to deeply equal { valueSchema: … }                          (#2–7,13)
#   expected { ok: true, value: 3 } to have property "schema"                      (#8–12)
#   expected undefined to be defined                                               (#14–15)

# 负控（绿）
… vitest run packages/namespace-runtime/test/runtime-readdata-schema-projection-control.test.ts --typecheck.enabled=false
# → Tests 6 passed (6)

# 类型锚（红）
node_modules/.bin/tsc -p tsconfig.typecheck.json
# → packages/namespace-registry/test/registry-readdata-schema-red.test-d.ts(31,11): error TS2322: Type 'true' is not assignable to type 'never'.
#   packages/namespace-runtime/test/runtime-readdata-schema-red.test-d.ts(40,11): error TS2322: Type 'true' is not assignable to type 'never'.
#   （全仓其余测试/既有 test-d 锚零错误——红仅限两个新锚）

# 既有基线（绿）
… vitest run runtime-sync-read-face.test.ts runtime-acceptance-exports-audit.test.ts --typecheck.enabled=false
# → Test Files 2 passed (2)；Tests 8 passed (8)
```

红灯原因判定：15 条失败全部是「ok 分支缺 schema」的结构性失败（键集/属性/值差异），无一为超时、import、fixture 或环境错误；负控同环境全绿 → **红在正确原因**。

## 14. Runner trigger evidence

- 行为契约文件被仓库真实入口收集：`vitest.config.ts` `include: ['packages/*/test/**/*.test.ts']`（实测运行命中，§13）；负控同规则。
- 类型锚被 vitest typecheck 与 `tsconfig.typecheck.json` 收录：`packages/*/test/**/*.test-d.ts`（实测 tsc 报错行号即两文件，§13）。
- 夹具文件命名无 `.test.ts`/`.test-d.ts` 后缀 → 不被收集（precedent：`real-persistence-scheduler.ts`、vfsl `resolve-schema-at-path-fixture.ts`）。
- 根仓 `pnpm test`（vitest run --typecheck）与 `pnpm typecheck`（包 src tsc）为 AC5 终态门；本契约期根门预期红（契约红），包级 src typecheck（生产代码零改动）不受影响。

## 15. Unknowns and blockers

无 blocker。契约未锁（设计自由度，供 SA1/SA2 钉死）：
1. resolver `InternalError` 处置（SA8 红线 4：throw 逃逸读面 vs 收敛 null 各有 ADR 锚点）——runtime 组合面可信域（自身 P0 编译产物）下不可达，契约不预设。
2. 深拷贝机制（结构化克隆/JSON/递归拷贝）自由——AC3 只断言可观测（隔离/可变异/不冻结/内容全等）。
3. `docs` 空条目过滤（空条目保留与否）自由——预言机同源求值自动对齐。
4. 「未知方言只读」null 情形属 registry 导入面，不在此 runtime 契约内单独锚定（runtime 编译面恒 vfsl 方言）。

## 16. Temporary diagnostics cleanup

- 临时 probe `packages/namespace-runtime/test/zprobe-273.test.ts`（夹具/状态矩阵验证）已删除。
- `git status` 最终 = 仅 4 个新契约文件 + 3 个既有未跟踪快照（简报/dispatch/冲突报告），生产实现零改动；无后台服务/进程遗留（全部测试进程内完成、runtime.close() 收尾）。

## Artifacts（worktree-relative）

- `wiki/raw/task_issue-273_sa6_contract.md`（本报告）
- `packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts`（15 条红契约）
- `packages/namespace-runtime/test/runtime-readdata-schema-projection-control.test.ts`（6 条负控）
- `packages/namespace-runtime/test/readdata-schema-projection-fixture.ts`（共享夹具）
- `packages/namespace-runtime/test/runtime-readdata-schema-red.test-d.ts`（runtime 类型锚 + doc-runtime 保持守卫）
- `packages/namespace-registry/test/registry-readdata-schema-red.test-d.ts`（lease 类型锚）
