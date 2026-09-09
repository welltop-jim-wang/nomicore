# SA4 实现红队审查 — Issue #273 namespace-runtime + namespace-registry：readData 成功分支返回语义 schema 投影（ADR 0016）

- Worktree：`/home/wangjian/nomicore-fix-issue-273`（branch `mabf/issue-273`，HEAD `1acd9e9` = #272 合并提交——与 SA3 报告一致，`git log` 亲核）
- Phase：implementation-review（iteration 0，dispatch sa-8563d0b4）
- 审查方式：纯静态——全量 diff 亲读（17 modified + 16 untracked 逐一核对）、上游产物（简报/设计/SA2/SA6/SA8 ×3）全文亲读、vfsl/doc-runtime 类型与消息面亲核、只读 git 命令核对范围。未运行任何测试/服务（SA4 纪律）。
- 裁决：**approve**（无 BLOCKER/MAJOR；4 项 MINOR 观察不阻断，其中 1 项回流 SA1 文档修订）

## 1. Reviewed inputs

| 输入 | 位置 | 状态 |
|---|---|---|
| 任务简报（Issue #273 正文快照，AC1–AC5） | `wiki/raw/task_issue-273.md` | 亲读；Issue comments REST 读取为空（与 SA6 §2/SA1 §4/SA2 §4/SA8 三报告一致）——无 owner 要求需并入 |
| SA1 设计（iteration 1，F-1 修订版，D1–D8） | `wiki/raw/task_issue-273_design.md`（469 行） | 全文亲读（D1–D8、§8 状态机、§10 矩阵、§11 ALLOW/DENY、§12 验收映射、§14 修订映射） |
| SA2 设计评审（iter-0 reject F-1 + iter-1 pass） | `wiki/raw/task_issue-273_sa2_review.md` | 全文亲读（F-1 验收 ①–④、N-1–N-5、R2.3 守卫实测、R2.9 红线测试思路） |
| SA6 验收契约（approve） | `wiki/raw/task_issue-273_sa6_contract.md` | 全文亲读（15 红 + 6 负控 + 2 类型锚 + 夹具；§12 逐条断言描述用于 DENY 完整性核对） |
| SA8 前置门禁 + 设计复审 iter-1 + iter-2 | `task_issue-273_conflict_report.md`、`task_issue-273_design_conflict_report.md`、`task_issue-273_design_conflict_report_iter2.md` | 亲读（红线 1–7；iter-2 §8 实现义务 4 条 + §10 实现阶段复查清单 6 条——本轮逐条核对） |
| SA3 实现报告 | `wiki/raw/task_issue-273_sa3_impl.md` | 亲读（含 Deviations #1：D7 遗漏站点改锚） |
| 实际 diff | `git status`/`git diff`（17 M + 16 ??） | 逐文件亲读（生产 5 + 测试 13 改 + 新 7 + wiki 9） |
| 母法与依赖面 | `docs/adr/0016*`、`docs/adr/0008*` 修订节、`packages/vfsl/src/derived.ts`、`resolve-schema-at-path.ts`、`resolve.ts`、`packages/doc-runtime/src/read.ts`（经设计 B 行复锚） | 关键面亲核（ValueSchema/Discriminator 字段域、InternalError 类形状与消息、L119 root 消息） |

## 2. Verdict

**approve**。

- 简报 AC1–AC5、SA6 契约、SA8 红线 1–7 与 iter-2 §10 清单 6 条、SA2 F-1 验收 ①–④ 与 N-1–N-5：逐条落实且与批准设计 D1–D8 逐字吻合（证据见 §3–§6）。
- 无 BLOCKER/MAJOR。唯一 ALLOW 外改动 = `runtime-mutate-root-sequencer.test.ts` AC9 末断言改锚（SA3 报告 Deviations #1 已如实披露）：属批准设计 D4 自身规定的可选负向锚（SA2 R2.9-4 建议的构造名/message 断言方式）+ 设计 §12 D7 行自述「两门全绿 = 无漏改站点」完备性兜底的必然动作，测试专用、无生产漂移、AC9 其余断言原样——按仓内先例（`task_vfsl-codegen-hardening_sa4_review` 对硬门禁强制 ALLOW 外 `package.json` 的非阻断裁决）裁定为**非 SA3 自行扩权**，回流 SA1 做 ALLOW 增补修订（见 O-1）。
- DENY 面零触碰（含 SA6 五文件 + 夹具不可篡改性双重佐证，见 §6）。

## 3. 上游要求落实

| Requirement or finding | Implementation evidence | Assessment |
|---|---|---|
| 简报要点 1 / AC1：成功分支 `{ok:true,value,schema}`，runtime 与 lease 两层类型一致 | `runtime.ts` L117–127（ok 成员恰三键 + `ReadLogicalValueFailure = Extract<ReadLogicalValueResult,{ok:false}>` + `RuntimeReadDisabledResult` 原样）；`registry/src/types.ts` L448–449 别名 = `NamespaceRuntimeReadDataResult \| NamespaceLeaseReleasedIssue`；两 test-d 锚 `Extract<…,{ok:true;value:unknown;schema:ReadDataSchemaProjection\|null}>` 非 never（精确可空，无 undefined 第三态） | ✅ 落实（D1/D6 逐字） |
| 简报要点 2 / AC2：null 三情形；缺席照常返 schema（路径键控）；空路径返 ROOT 投影 | `read-schema-projection.ts` L46–57：D3a（`schemaState !== 'ready' \|\| activeTools === undefined` → null；fatal 期 schemaState 停留 preparing——p0.ts L109/L123/L128–133 亲核：fatal 只置 fatal/fatalCause，installActive 仅 ok 编译调用）+ D3b（敌意/异态 → null）+ resolver 两码 `!resolved.ok` → null 同一出口；红 #1（`[]` ROOT 四件套）/#7（`['nick']`、`['skus','cd']` 值 undefined + schema 非 null）/ #8–#12 | ✅ 落实 |
| 简报要点 3 / AC3：投影每次读深拷贝、detached、不冻结、零缓存 | `read-schema-projection.ts` L106–220：四件套整体 identity-memo 克隆（memo 跨 valueSchema/aliases 共享传递）、逐 kind 显式分派、外壳先登记后递归、普通可变副本不冻结；红 #13–#15（五层 not.toBe、三连续读互异、改写污染、`Object.isFrozen` false、`getActiveSchema` 身份不变） | ✅ 落实 |
| 简报要点 4 / AC4：always-on、无新增公共方法/参数；public-surface 审计更新 | `read-schema-projection.ts` 为包内模块（`index.ts` 零导出变化——grep `read-schema-projection` 于 index.ts 零命中）；runtime/registry 两 index.ts 公共键集零变化（runtime 仅头注）；`runtime-acceptance-exports-audit`/ownership 面 HEAD 已绿且不被触碰 | ✅ 落实 |
| 简报要点 5：分层——doc-runtime 不动、registry 别名跟随零行为变化 | doc-runtime/vfsl 零改动（git status 核对）；lease.ts 零改动（直透传 L276–278 + Equal 锁 L383–391 原样，别名恰为 `ReturnType<NamespaceRuntime['readData']> \| released` → 锁自然绿） | ✅ 落实 |
| 简报要点 6：失败分支与四 getter 不变 | `runtime.ts` L461–473：lifecycle gate 原序先行 → 值读 → `if (!result.ok) return result`（失败对象不带 schema 键，零 schema 工作）；负控 #3/#4 断言 `'schema' in r === false`；四 getter diff 零触碰 | ✅ 落实 |
| AC5：两包测试 + test-d + 根两门绿 | SA3 报告 Verification 表（红 15/15 翻绿、负控 6/6、类型锚 2、hostile 4/4、runtime 38 文件、registry 33 文件、根 typecheck/test exit 0）。SA4 静态复核：文件计数 38/33 与磁盘枚举一致（`ls \| wc -l` 亲测）；测试计数 15/6/4 与 `grep -c "it("` 一致；入口真实性见 §9。根门重跑留动态验证项（SA4 不运行测试） | ✅ 静态佐证成立（动态重跑归 SA7/Controller） |
| SA2 F-1 验收 ①：敌意迭代器数组不抛 + 恰 `{ok:true,value:3,schema:null}` + `iteratorCalls===0` 载荷锚 | `runtime-readdata-hostile-path-guard.test.ts` L26–42（`toEqual({ok:true,value:3,schema:null})` + L40 `expect(iteratorCalls).toBe(0)` 可执行断言）；实现 `normalizeReadPath` L84 同一性比较（属性读不调用） | ✅ 落实 |
| SA2 F-1 验收 ②：Proxy get 陷阱 | 同文件 L44–55（对 `Symbol.iterator` 键 throw 的 Proxy → 收敛 null 不抛）；实现 L80–96 内层 try 收编属性读异常 | ✅ 落实 |
| SA2 F-1 验收 ③：`['absent-key',Symbol()]` → `{ok:true,value:undefined,schema:null}` 且键在场 | 同文件 L57–64（含 L62 `'schema' in r === true`）；实现 L90 段域检查捕尾段 Symbol | ✅ 落实 |
| SA2 F-1 验收 ④：既有面回归 | SA6 五文件内容与 SA6 §12 逐条吻合（计数/断言形态/字面量锚，见 §6）；D7 改锚 13 文件逐站点核对（见 §9） | ✅ 落实 |
| SA8 iter-2 §10 清单 1：对 resolver 调用无 try/catch；JSDoc+模块头注双域文档在场；内层 try 仅敌意扫描 | `read-schema-projection.ts` L56 resolver 调用在任何 try 之外（try 边界 = L80–96 `normalizeReadPath` 函数体）；模块头注 L9–21 + `runtime.ts` readData JSDoc（L137–150 区段）双域表述 + 内层 try 辖域注明 | ✅ 落实 |
| SA8 iter-2 §10 清单 2：恰三键/精确可空/Extract 派生/两码单义收敛 | runtime.ts L117–127 + L57（两码同 `return null`，无码透传、无子通道） | ✅ 落实 |
| SA8 iter-2 §10 清单 3：深拷贝落位 runtime 边界；lease.ts 零改动、Equal 锁绿 | 见上文 AC3/分层行 | ✅ 落实 |
| SA8 iter-2 §10 清单 4：冻结面（失败三分支、released、四 getter、十二键/exports、无新公共方法/参数/稳定码） | git diff 逐文件核对：仅 5 生产文件（runtime.ts/types.ts 实改 + index.ts/p0.ts 注释级）+ 新内部模块；`readDisabled`/`RELEASED_ISSUE`/getter 零触碰 | ✅ 落实 |
| SA8 iter-2 §10 清单 5：p0.ts 仅注释行；SA6 五文件未修改 | p0.ts diff 仅 L42–44 注释替换（零代码行变化）；SA6 文件完整性见 §6（内容 + mtime 双佐证） | ✅ 落实 |
| SA8 iter-2 §10 清单 6：D3b 专项（仅属性读/索引读/同一性、计数器锚、内层 try 不含 resolver、副本传递、D8 文件 ALLOW 内被收集且绿、红契约透明） | `normalizeReadPath` L79–97 逐行核对（`Array.isArray`/`path[Symbol.iterator]` 同一性/`length` 快照 typeof+isInteger+非负/`path[i]` 索引读/段域 string\|number）；副本 `out` 传 resolver（L56）；vitest include `packages/*/test/**/*.test.ts` 覆盖（vitest.config.ts 亲核）；D3b 对契约路径透明的红 15 全绿由 SA3 报告 + 断言形态静态佐证 | ✅ 落实 |
| SA8 红线 5 / #272 头注义务：深拷贝在 runtime 组合边界 | resolver（vfsl）零改动；拷贝器在 `read-schema-projection.ts` | ✅ 落实 |
| N-1（4 处无改动站点留档） | registry-open L957（失败分支字面量——亲核仍在且类型合法）、phase5-bootstrap-reset-r2-internal、ws-replication `src/testing.ts` L47、runtime-registry-internal-sa7-dynamic——均不在 git status 改动清单 | ✅ 与设计一致（未改） |
| N-2（不导出 InternalError，按构造名/message 断言） | vfsl index.ts 零改动（InternalError 仍仅 resolve.ts 模块级）；AC9 改锚 L806/L808 按构造名 + message（`'root 节点'` 恰为 vfsl L119 消息子串——亲核）；runtime 新模块零 InternalError 导入 | ✅ 落实 |
| N-3（yjs-server 销项） | `apps/yjs-server/src/app.ts` 零改动；L548 读 `result.ok`/`result.value` 仅值消费（亲核） | ✅ 落实 |
| N-4（确定性站点可加非 null 断言——非义务） | registry-create L459 仅按 D7 改 toMatchObject，未加非 null 断言；SA3 报告记录「非义务不处理」 | ✅ 记录在案（O-3） |
| N-5（键域判断依据保留于实现注释） | `read-schema-projection.ts` L200–203（cloneValueSchemaRecord）+ L214–215（cloneDocsRecord）+ L183–184（cloneDiscriminator）——CreateDataPropertyOrThrow + tokenizer ASCII 字母起始判断依据均在 | ✅ 落实 |

## 4. 设计落实审查

| Design decision | Implementation location | Assessment | Finding |
|---|---|---|---|
| D1 结果联合重定型 | `runtime.ts` L117–127 | 逐字（Extract 派生失败成员；ok 恰三键；RuntimeReadDisabledResult 原样；`value:unknown` 保持、键恒显式构造 L473） | 无 |
| D2 组合顺序 | `runtime.ts` L461–473 | gate 原序 → 值读先行 → 失败短路（零 schema 工作）→ 恰三键构造；值直传 doc-runtime 副本（零重复拷贝） | 无 |
| D3a 状态守卫 | `read-schema-projection.ts` L46–50 | 单点双条件；先于 path 守卫（无 active schema 不触碰敌意对象）；fatal 经 B5 天然覆盖（p0.ts 亲核） | 无 |
| D3b 敌意 path 规范化 | 同文件 L79–97 | 与设计全量规格逐行一致（含四备选否决对应的机制选择：迭代纯度校验在场、绝不调用迭代协议、副本传递）；内层 try 辖域 = 函数体，不含 resolver 调用 | 无 |
| D4 InternalError throw 逃逸 | 同文件 L54–56（零 catch）+ 模块头注 L9–21 + JSDoc | 双域文档两处义务落地；`InternalError`（extends Error，name='InternalError'——resolve.ts L26–31 亲核）直通逃逸 | 无 |
| D5 深拷贝 | 同文件 L99–220 | 逐 kind 显式分派九类全覆盖（object/array/union/optional/enum/ref/pattern/scalar/xml——与 `vfsl/src/derived.ts` L44–53 ValueSchema 联合逐 member 核对无遗漏）；字段域亲核：`keyPattern?/regex` 均 string 原语、`values` 原语数组、`discriminator.byValue` number record——无对象引用逃逸，深拷贝语义完备；memo 外壳先登记后递归（array/optional 暂持原引用单线程内不可观测——L136 注释自证） | 无（O-4 见 §12） |
| D6 registry 类型跟随 | `types.ts` L448–449 + 导入清理（删 doc-runtime `ReadLogicalValueResult`/`RuntimeReadDisabledResult`，增 `NamespaceRuntimeReadDataResult`） | 别名单点跟随；`RuntimeReadDisabledResult` 仍由 runtime index 导出（公共面不变）；registry index.ts L45 再导出名/元数不变 | 无 |
| D7 测试改锚 | 13 文件 diff 逐站点核对（§9 表） | 三策略严格执行：typed/any stub 补 `schema:null` 且全等断言同步补；真实 runtime 站点 toEqual → toMatchObject（值意图不变）；无站点被弱化为跳过/only | 无 |
| D8 新验收文件 | `runtime-readdata-hostile-path-guard.test.ts`（4 tests） | T1–T3 + 局部负控逐字落实设计 §12 F-1 行（含 `iteratorCalls===0` 载荷锚、`'schema' in r` 键在场、非 null 字面量对照 + 不冻结抽检）；夹具 import-only | 无 |

## 5. 架构一致性与惯例

### 责任归属

| Behavior | Expected owner | Actual location | Assessment |
|---|---|---|---|
| 值读（schema 无关、敌意面硬化） | doc-runtime | `readLogicalValueAtPath` 零改动，runtime 组合层只透传 | ✅ 单一事实源保持 |
| schema 投影组合 + 深拷贝 + 敌意收敛 | namespace-runtime 组合边界（ADR-0016 L75） | `read-schema-projection.ts` 单点自包含 | ✅ |
| lease 透传 + 类型别名 | registry | `lease.ts` 零改动；`types.ts` 别名单点 | ✅ |

### 相似能力对照

| Similar capability | Existing implementation | Actual implementation | Consistent or divergent | Reason |
|---|---|---|---|---|
| 敌意 path 收编 | doc-runtime `safeSpreadPath`（read.ts L139–162：内层 try + 坍缩 `[]`） | `normalizeReadPath` 内层 try + 收敛 null | 一致 | 同威胁模型（F1/P10 Proxy spread/长度 trap）的 schema 面对偶 |
| 可信域内部损坏 loud throw | `getSchema` 载体异型 throw `SchemaProjectionError`；`getMetadata` 循环值 `RangeError` 逃逸（有测试锚） | resolver `InternalError` 零 catch 逃逸 | 一致 | 同处置类（B11 先例）；AC9 改锚即其测试锚 |
| 深拷贝交付纪律 | `projection.ts`（getSchema/getMetadata 投影）| 新模块同风格（普通可变副本、不冻结） | 一致 | 包内既有惯例 |
| 失败路径回显硬化 | `readDisabled`（runtime.ts，safeSpreadPath 同款） | 零触碰 | 一致 | A-6 攻击面复核成立 |

### 单一事实源

| Fact | Authoritative source | Derived state | Drift risk |
|---|---|---|---|
| 读失败形状 | doc-runtime `ReadLogicalValueResult` ok:false | `Extract` 派生（非复制第二份） | 无（漂移即两包 typecheck 红——R5） |
| lease 读形状 | runtime 联合 | 别名 + Equal 编译锁 | 无（锁零改动自然绿，亲核 L383–391 基准为 `ReturnType<NamespaceRuntime['readData']>`） |
| 活 schema | `activeTools.derived` | 每读重解析重拷贝投影（零缓存、零模块状态） | 无（同步点 = 下一次读） |

### 生命周期对称性

| Start or acquire | Stop or release | Failure recovery | Assessment |
|---|---|---|---|
| 读面无资源获取（纯同步、sequencer 外、零 state 写） | 无需释放 | 无资源泄漏面；close 停接纳 gate 先行短路（schema 通道不可达） | ✅ 不适用对称项且边界保持 |

### 平行机制检查

| Candidate duplicate | Existing path | Actual path | Disposition |
|---|---|---|---|
| 第二套投影逻辑？ | vfsl `resolveSchemaAtPath` | runtime 直接消费 resolver ok 分支 + 深拷贝（不自造第二套解析） | 非重复 |
| 投影缓存/第二 schema 状态？ | 无（零缓存是契约） | 每读全新 wrapper + 四件套；无模块级可变状态（`CloneMemo` 每调用新建） | 非重复 |
| 新公共方法/参数/opt-in？ | 十二键公共面 | 零新增（内部模块不进 index） | 非重复 |

## 6. 文件范围审查

git status（`-uall`）：17 M + 16 untracked，逐文件映射：

| Changed path | ALLOW entry | Purpose | Assessment |
|---|---|---|---|
| `packages/namespace-runtime/src/runtime.ts` | §11 行 1 | D1/D2/JSDoc | ✅ |
| `packages/namespace-runtime/src/read-schema-projection.ts`（新） | §11 行 2 | D3a/D3b/D5 单点 | ✅ |
| `packages/namespace-runtime/src/index.ts` | §11 行 3（注释级） | 头注增量段；导出键集零变化（diff 仅注释块） | ✅ |
| `packages/namespace-runtime/src/p0.ts` | §11 行 4（DENY 注记：仅注释行） | activeTools 注释 D8 封口更正——diff 仅 L42–44 注释，零代码行 | ✅ |
| `packages/namespace-registry/src/types.ts` | §11 行 5 | D6 别名 + 导入清理 | ✅ |
| 11 个 registry 测试文件 + `runtime-boundary-supplementary.test.ts` | §11 行 6–17 | D7 改锚 | ✅（策略核对见 §9） |
| `packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts`（新） | §11 D8 行 | F-1 验收锚 | ✅ |
| `packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts` | **§11 无对应行（SA3 Deviations #1 披露）** | AC9 末断言按 D4 改锚（见 §9） | ⚠️ ALLOW 清单缺口——裁定非阻断（O-1，回流 SA1） |
| SA6 五文件 + 夹具（untracked） | §11 DENY | — | ✅ 零修改佐证：(a) 内容与 SA6 §12 逐条吻合（红 15/负控 6/锚 2 断言形态、oracle + 字面量锚、夹具 TXT_273/seedRoot count=3/makeReadyRuntime）；(b) mtime 全部为 11:17–11:18（SA6 阶段），早于 SA3 实现产物（12:32–12:51）——实现期未被重写 |
| `wiki/raw/task_*`（9 个 untracked） | 任务档案白名单 | 流水线产物 | ✅ |
| 其余 DENY（doc-runtime/**、vfsl/**、lease.ts、registry index.ts、apps/yjs-server/**、docs/adr/**、CONTEXT.md） | §11 DENY | git status 零命中 | ✅ |

**ALLOW 外唯一改动的裁定**（O-1 详述见 §12）：(i) 旧断言 `expect(readValue(runtime,['n'])).toBe(1)` 在新契约下结构性不可能保持（值读成功后 schema 通道消费畸形 derived → InternalError 逃逸——正是批准设计 D4 钉死的行为）；(ii) 保持根门绿（AC5）与保留 AC9 写侧断言的唯一交集就是该改锚；(iii) 改锚内容 = 设计 §12 D4 行「可选负向锚」规格的逐字落地（SA2 R2.9-4 明示建议：构造名/message 匹配、勿导出类）；(iv) SA3 如实披露并请求 SA4/SA7/SA8 核对。判定：设计 ALLOW 清单的经验性遗漏（该站点是经 helper 的值断言，非 `toEqual({ok:true,value})` 形态，SA1 §10/SA2 §9 的 grep 方法论双漏），非实现自扩权——沿 `task_vfsl-codegen-hardening` 先例记文档债回流 SA1，不构成 MAJOR。

## 7. 契约连锁审查

| Contract | Caller | Actual handling | Risk | Finding |
|---|---|---|---|---|
| ok 分支新增 `schema` 键（加法） | `apps/yjs-server/src/app.ts` L546–550 | 仅 `result.ok`/`result.value` 消费（亲核）；REST 面先经段净化 + op 分发层 try/catch | 无 | 无 |
| 联合形状演进 | `lease.ts` readData（直透传） | 零改动；Equal 锁以 `ReturnType<NamespaceRuntime['readData']>` 为基准自然保持 | 无 | 无 |
| 类型别名变更 | registry `index.ts` L45 再导出 | 名/元数不变 | 无 | 无 |
| 失败分支不变 | 全部 `.code` 消费者（runtime-sync-read-face 等） | 失败对象原样透传、不带 schema 键（负控 #3/#4 锚） | 无 | 无 |
| InternalError 新可观测 throw 通道（仅 internal-bug 注入面） | yjs-server（生产唯一外层消费面） | 生产不可达（derived 恒为自身编译 ok 产物）；即便逃逸，op 层全程 try/catch 收编（N-3 销项维持） | 无 | 无 |
| test-d 接口锚 | `runtime-data-interface.test-d.ts` / `registry-data-interface.test-d.ts` | 零改动（git status 核对）；赋值兼容（联合单侧演进） | 无 | 无 |
| 残留 `toEqual({ok:true,value…})` 全仓扫 | — | grep 全仓唯一命中 = `doc-runtime/test/create-initial-document.test.ts:289`（doc-runtime 直读恰两键——schema 无关负控面，**应保持**不属漏改） | 无 | 无 |
| typed-access/codegen 消费者 | domains/** 零改动 | 加法兼容（ADR-0016 分层明文）；本票不触生成面（设计 §12 无 generate 门——核对属实） | 无 | 无 |

## 8. 错误、恢复与并发

- **双域通道枚举核实**：读失败四通道（PATH_NOT_ALLOWED/RUNTIME_READ_DISABLED/released/`schema:null` 非失败）+ 唯一 throw = InternalError（D4）。敌意输入零 throw：`normalizeReadPath` 全程内层 try，任何属性读异常/迭代器非标准/长度异型/段域违规 → null；比较运算均为原语操作（无 ToPrimitive 陷阱面）。
- **无静默失败**：值缺席显式 `undefined`（键恒在场，L473 显式构造）、schema 缺席显式 `null`（非 undefined 非省略）；失败短路不做任何 schema 工作。
- **幂等/重试**：纯同步读、零写、零缓存、零事件——任意重试安全；敌意 path 收敛确定性（只依赖属性读序列，无状态）。
- **并发**：sequencer 之外、零 state 写保持；单线程下 `state.activeTools`/`schemaState` 读取与 resolver 消费间无 await（无撕裂）；克隆器 memo 为每次调用局部。
- **DoS 面对等**：敌意长 path 扫描与 doc-runtime 导航循环同阶（`length` 单次快照 + 首个异态段即短路）；无值通道没有的新上限（R8 保持）。
- **深拷贝不终止风险**：memo 先登记后递归防环节点发散；resolver ok 输入本身无环（求值期封顶）——防御性双保险（R4 保持）。
- **静态无法确认项**：根门全量重跑、CI 实跑、跨 Node 版本矩阵——已列入 §11 动态验证项（不猜测通过；SA3 报告数字经文件/用例计数静态佐证）。

## 9. 测试质量审查

| Test | Behavior asserted | Runner entry | Weakening or gap | Finding |
|---|---|---|---|---|
| `runtime-readdata-schema-projection-red.test.ts`（15） | AC1 键集恰三键（L102 `Object.keys().sort()`）/ 投影内容双锚（oracle 同源 + 字面量）/ null 三情形 ×4 态 / 值缺席照常返 schema / 隔离五层 not.toBe + 三连续读互异 + 改写污染 + 不冻结 + getActiveSchema 身份 | vitest include `packages/*/test/**/*.test.ts`（vitest.config.ts 亲核）+ CI 动态分片（`scripts/ci-test-shard.mjs` 磁盘枚举——新文件自动入片，ci.yml L66–68 注释明示「不会漏跑」） | 无 skip/only/todo；`readOk` 对 ok:false loud throw 不假绿；断言全为可观测行为（零源码字符串断言） | 无 |
| `runtime-readdata-schema-projection-control.test.ts`（6） | doc-runtime 恰两键/失败单通道/失败对象不带 schema 键/preparing 不等待 P0 | 同上 | SA6 红灯断言保持（内容与 SA6 §6/§12 吻合） | 无 |
| 2 × test-d 类型锚 | ok 成员携精确可空 schema；doc-runtime 保持性守卫 | `tsconfig.typecheck.json` include `packages/*/test/**/*.ts`（覆盖 .test-d.ts，亲核）+ vitest typecheck include + CI typecheck 作业 `vitest run --typecheck.only`（ci.yml L44） | 无 | 无 |
| `runtime-readdata-hostile-path-guard.test.ts`（4，D8） | T1/T2/T3 + `iteratorCalls===0` 载荷锚（可执行）+ `'schema' in r` + 合法 path 非 null 字面量对照 + 不冻结抽检 | 同 red（同 include） | 夹具 import-only（零夹具改动）；无 | 无 |
| D7 改锚 13 文件 | 见左：stub 类（makeMarkerRuntime/makeRuntime/ObservableRuntime ×3/CountingRuntime）补 `schema:null` 且对应 toEqual 全等同步补（**未弱化**——全等强度保持）；真实 runtime 类（boundary-supplementary L91/L128、create L459/L1645、open L356、cordis ×2、persistence ×3、plugin ×2、phase5 ×2）toEqual → toMatchObject（设计 D7 明示策略：P0 时序不敏感化，值断言保持） | 包测试 + 根门 + CI | 逐 diff hunk 核对：无一站点被注释/跳过/断言删除；失败分支字面量站点（registry-open L957）原样保留 | 无 |
| AC9 改锚（`runtime-mutate-root-sequencer.test.ts` L787–809） | seam 注入畸形 derived（structure 非 root）→ readData throw `InternalError`（构造名 L806 + message 含「root 节点」L808——恰为 vfsl L119 消息子串，亲核）；AC9 其余断言原样（settled rejected/committed:false/notifier 0/零写入/写禁用/read.enabled/fatal 非 null——diff 上下文亲核） | 包套件 + 根门 + CI | 站点不在设计 §10/§11 清单（O-1）；「读取保留」的值面直接锚（旧 `.toBe(1)`）被 D4 throw 锚替换——值通道保留性现仅由 `status.read.enabled===true` 间接锚（O-2） | O-1/O-2（MINOR） |
| SA6 五文件 + 夹具 | DENY | — | 未修改（内容逐条匹配 SA6 §12 + mtime 佐证，§6） | 无 |

**SA3 报告 Verification 的静态佐证汇总**：包文件数 38/33（磁盘枚举一致）；契约用例数 15/6/4（grep `it(` 一致）；`vitest run --typecheck`（根 `pnpm test`）与 `pnpm typecheck`（14 包 tsc）入口真实（package.json 亲核）；CI 三入口（typecheck/typecheck.only/动态分片）均覆盖新文件。报告与可静态核实的事实零矛盾。

## 10. Required revisions

无（本轮无 BLOCKER/MAJOR finding）。

| Finding ID | Severity | Evidence | Problem | Required change | Acceptance | Suggested routing |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

## 11. 后续动态验证项

| Risk | Driver | Expected observation | Failure condition |
|---|---|---|---|
| 根门全量重跑（SA3 报告为单会话结果） | Controller/SA7 在合并前于干净环境执行 `pnpm typecheck` + `pnpm test`（`vitest run --typecheck`） | 两门 exit 0；runtime 38 文件 / registry 33 文件全绿；Type Errors: no errors | 任何红（尤其 sequencer/fatal 面与 registry stub 类型面） |
| CI 实跑（PR 栈接 PR #271 支系） | CI（push/PR 触发；typecheck 作业 + Node 20/24 × 6 分片 + contract-gates） | 全作业绿；新文件落入分片被执行 | 分片遗漏/类型锚红/跨 Node 版本行为差异 |
| 投影改写-再读隔离的运行时复核（含 `getActiveSchema` 指纹身份） | SA7 动态验证（红 #13–#15 重跑） | 改写后新读 toEqual 原样、五层引用互异 | 任何共享引用/污染泄漏 |
| 敌意面实跑矩阵扩展（可选） | SA7（沿 SA2 R2.9-3 建议子集：空洞数组/谎报 length/对象段/子类数组/benign Proxy） | 全部收敛 null 或透明非 null，零 throw | 任一外抛或合法 path 过拒 |
| SA8 已 armed 的实现阶段冲突复查（iter-2 §10 清单 6 条） | SA8（Controller 路由） | 6 条逐项确认（本轮 SA4 静态核对已全过，见 §3） | 任一条与实际 diff 不符 |

## 12. Non-blocking observations

| ID | Observation | Suggested routing |
|---|---|---|
| O-1 | **设计 ALLOW 清单缺口**：`runtime-mutate-root-sequencer.test.ts` AC9 改锚不在 §11 ALLOW（SA3 Deviations #1 已披露）。改锚内容 = 设计 §12 D4「可选负向锚」规格逐字落地（SA2 R2.9-4 建议方式），由 AC5 根门完备性兜底强制；测试专用、AC9 其余断言原样、无生产漂移。裁定非阻断（先例：`task_vfsl-codegen-hardening` ALLOW 外 `package.json` 的文档债裁决）。建议 SA1 出 ALLOW 增补修订（该测试文件 + 改锚理由一行），使范围清单与「两门全绿 = 无漏改站点」的自述闭环 | design |
| O-2 | AC9 站点「读取保留」的值面直接锚（旧 `expect(readValue(...)).toBe(1)`）被 D4 throw 锚替换后，值通道保留性在该站点仅由 `status.read.enabled===true` 间接锚。未来如需双锚，可补 doc-runtime 直读断言（`readLogicalValueAtPath(doc,['n'])` 恰两键）——非义务 | implementation（可选） |
| O-3 | N-4 建议的确定性站点非 null 断言（registry-create L459）未加——SA3 已记录「非义务不处理」，与设计 D7/§14 一致，留档 | 无 |
| O-4 | `cloneDiscriminator`（read-schema-projection.ts L185–193）不走 identity-memo：若单投影内两个 union 节点共享同一 discriminator 对象，克隆后为内容相等但身份互异的两份。当前 derived 构造下不共享、无契约锚（红 #13 仅锚跨读隔离），语义无影响——留作未来重构注记（若引入 memo 需防 byValue record 共享语义变化） | 无 |
| O-5 | 验证边界说明：SA6 五文件 + 夹具为 untracked（无 git 基线），「未篡改」由内容逐条比对 SA6 §12 + mtime 时序双佐证（§6/§9）；根门绿为 SA3 单会话报告，SA4 未复跑（纪律）——以 §11 动态项兜底 | acceptance-contract（SA7/Controller 重跑即可销项） |
