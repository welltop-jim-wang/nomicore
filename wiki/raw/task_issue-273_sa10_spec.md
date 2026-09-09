# SA10 Spec 审查报告 — Issue #273（namespace-runtime + namespace-registry：readData 成功分支返回语义 schema 投影，ADR 0016）

> SA10（独立 Spec 审查者）spec-review 轮产物。dispatch `sa-79956f2f-00f4-4eb1-afe1-47823da55efc`，
> phase spec-review，iteration 0（final-verification 阶段，SA9/SA10 并列派发）。
> **被审对象**：已提交实现 = HEAD `76966d2`（`feat(namespace): project schema from readData`）相对权威母基线
> `1acd9e97`（#272 合并提交，dispatch 声明「parent base docs/adr-0016-readdata-schema 已在 1acd9e97 新解析并核验」）
> 的单提交全量 diff——`git merge-base HEAD 1acd9e9` 亲证 = `1acd9e97…`，分支 `mabf/issue-273` 正确栈接
> PR #271 支系。工作树无未提交生产/测试改动（`git status` 仅剩 dispatch 记录与本简报快照两个 wiki 面）。
> **Issue 评论输入**：派遣简报明示 REST 当前读取 = none；上游六处产物（SA6 §2 / SA1 §4 / SA2 §4 / SA8 三报告）
> 同载 `comments: []`——**无 owner 要求需并入**。
> **输入产物（全部亲读）**：任务简报 `task_issue-273.md`（行为要点 6 条 + AC1–AC5）、ADR-0016 全文 +
> ADR-0008 修订节（L166–178）、SA6 契约、SA1 设计 iteration-1（F-1 修订版 469 行）、SA2 评审（iter-0 reject F-1 +
> iter-1 pass）、SA8 三报告（前置门禁 clear + 设计复审 iter-1 clear + iter-2 clear 含 §10 实现阶段复查清单 6 条）、
> SA3 实现报告、SA4 审查（approve，4 MINOR）。
> **独立核验方式（本轮全部亲读/亲跑静态命令，非转述）**：全量 diff 逐文件亲读（5 生产 + 19 测试 + wiki 档案）；
> 新模块 `read-schema-projection.ts` 220 行逐行对照设计 D3a/D3b/D4/D5 全量规格；SA6 五契约文件全文亲读并与
> SA6 §12/§6 逐条比对；ValueSchema 九 kind 与 `vfsl/src/derived.ts` L44–53 逐 member 核对克隆分派穷尽性；
> 残留 `toEqual({ ok: true, value` 全仓 grep 复扫（26 命中逐站点分类）；`.skip/.only/.todo/.fails` 扫描零命中；
> `git diff 1acd9e9..HEAD --check` 自跑 exit 0；测试文件/用例计数独立复算（38/33 文件、15/6/4 用例——与 SA3
> 报告、SA4 静态佐证三方一致）；lease.ts Equal 锁、四 getter、apps/yjs-server、doc-runtime/vfsl 零 diff 亲证。
> **边界**：零业务代码/设计/测试改动；未运行测试、未启动服务（SA10 纪律——动态复跑属 SA7/Controller/CI）；
> 零 commit/push/PR/finalize；唯一写入 = 本文件。

---

## Verdict

**approve**。

- 简报 AC1–AC5、行为要点 6 条、ADR-0016 全文义务、SA6 契约（15 红 + 6 负控 + 2 类型锚 + 夹具）、
  SA1 修订设计 D1–D8、SA2 F-1 验收 ①–④ 与 N-1–N-5、SA8 iter-2 §10 实现阶段复查清单 6 条、SA4 approve 裁决：
  逐条核验**全部满足**（§1–§7），证据链完整且三方互证（SA3 执行报告 + SA4 静态审查 + 本轮独立静态复核）。
- 无遗漏、无部分实现、无错误实现、无实质 scope creep。唯一 ALLOW 外改动（AC9 改锚）经独立裁定
  为批准设计 D4 自身规格的落地，属 MINOR 文档债（§8.1）。
- 关键 AC 无 partial/unmet/unachievable；AC5 根门绿为 SA3 本会话执行证据 + 双重静态佐证，独立动态复跑
  已按管线分工移交 SA7/Controller/CI（§9 披露项 2），不构成 reject 依据。

---

## 1. AC 逐项终态对照（简报 Acceptance Criteria）

| AC | 判定 | 关键证据（本轮亲核） |
|---|---|---|
| AC1 成功分支 `{ ok:true, value, schema: ReadDataSchemaProjection \| null }`，runtime 与 lease 两层类型一致 | ✅ 满足 | `runtime.ts` L117–127：ok 成员恰三键、`schema` 精确可空（无 undefined 第三态）、失败成员 `Extract<ReadLogicalValueResult,{ok:false}>` 单源派生、`RuntimeReadDisabledResult` 逐字；`registry/types.ts` L443–449 别名 = `NamespaceRuntimeReadDataResult \| NamespaceLeaseReleasedIssue` + 导入清理；`lease.ts` **零 diff**、Equal 锁 L383–391 原样（基准 `ReturnType<NamespaceRuntime['readData']>`，别名同构 → 锁自然绿）；两 test-d 锚在场且 SA3 报告 `tsc -p tsconfig.typecheck.json` 0 错误 |
| AC2 `null` 三情形、缺席吸收照常返 schema、空路径返 ROOT 投影各有测试锚定 | ✅ 满足 | 红契约（全文亲读，与 SA6 §12 逐条吻合）：#1 空路径 `[]` → 恰三键 + ROOT 四件套 toEqual 独立预言机；#7 `['nick']`/`['skus','cd']` 值显式 undefined + schema 非 null（optional 包装保留）；#8–#10 preparing/unavailable/fatal → 读恒 ok + `schema === null`；#11 `['rogue']` 路径偏离 → null；#12 `['skus','ZZ1']` keyPattern 失配 → null + 同 map `['skus','ab']` 非 null 对照。实现面：D3a 状态守卫（L50）+ resolver 两码单义收敛（L57），fatal 经 B5 天然覆盖 |
| AC3 投影隔离测试（改写投影后再读与后续读数不受影响） | ✅ 满足 | 红 #13 两次读内容全等 + 五层 `not.toBe`（结果/valueSchema/aliases/别名体/docs/aliasDocs）+ 三连续读互异（零缓存）；#14 三类改写（ref 附加属性/别名体替换/docs 污染）后新读 toEqual 原样 + 非同一引用 + `Object.isFrozen` false ×3 + `getActiveSchema()` 身份不变；#15 双向隔离。实现面：`detachReadSchemaProjection`（L106–114）每次读全新 wrapper + 全新 memo，identity-memo 逐 kind 显式分派克隆（九 kind 穷尽，对 `derived.ts` L44–53 逐 member 核对无遗漏）、普通可变副本不冻结 |
| AC4 读面 always-on、无新增公共方法/参数；public-surface 审计按新形状 | ✅ 满足 | `read-schema-projection.ts` 为包内模块（index.ts 对其零导出——grep 仅 L11 注释提及）；runtime `index.ts` diff 纯注释块（5 行）；两包公共键集/导出键集零变化；`readData` 签名不变、无 opt-in。public-surface 审计测试（exports-audit/ownership）未被触碰且无需改——其不断言 readData 形状（exports 审计 grep readData 零命中、ownership 仅 typeof/非 Promise 探针），SA2 §3/SA4 §3 已裁定该「按新形状更新」义务 vacuously 成立，本轮复核一致 |
| AC5 两包测试（含 test-d）绿；根仓 `pnpm typecheck`、`pnpm test` 绿 | ✅ 满足（证据链闭合；独立动态复跑为披露项） | SA3 执行证据：红 15/15 翻绿、负控 6/6 保持、hostile 4/4、runtime 38 文件 319 测试、registry 33 文件 384 测试、根 typecheck exit 0、根 test 301 文件 3203 测试全绿 + Type Errors no errors。本轮独立静态佐证：38/33 文件计数与磁盘枚举一致；15/6/4 用例计数与 grep `it(` 一致；两 test-d 锚被 `tsconfig.typecheck.json` 与 vitest typecheck include 收录（亲核 vitest.config.ts L15/L20）；`git diff --check` 干净；测试纪律扫描零 `.skip/.only/.todo/.fails` |

## 2. 简报「行为要点」六条对照

1. **成功分支 `{ok,value,schema}`、always-on、无 opt-in** → runtime.ts L461–473（gate 原序 → 值读先行 → 失败短路零 schema 工作 → 恰三键显式构造，`value` 键恒在场）；无开关、无新参数。✅
2. **`schema:null` 三情形、null 非失败、读恒成功** → D3a（schemaState/activeTools 单点守卫）+ D3b（敌意/异态 path 收敛——F-1 修订，经 SA8 iter-2 A1 裁定栖于 ADR-0016 L22③ + L57「非数组/野段形状守卫」既有辖域，非第 4 类情形）+ resolver 两码收敛；同一 null 出口、无子通道、无码透传。✅
3. **值缺席照常返 schema（路径键控）+ 空路径 ROOT 投影** → 红 #7/#1 锚定；解析与值无关（resolver 路径键控）。✅
4. **每次读深拷贝（detached、不冻结、零缓存）** → D5 落地（§1 AC3 行）；活 derived 零出站（`activeTools` 注释同步更正，p0.ts L42–44 注释级 diff 亲证）。✅
5. **分层：doc-runtime 不动 / runtime 组合 / registry 别名跟随 lease 零行为变化** → `git diff --stat` 亲证 `packages/doc-runtime/`、`packages/vfsl/`、`packages/namespace-registry/src/lease.ts`、`registry/index.ts` **零 diff**；runtime 组合单点 = 新内部模块。✅
6. **失败分支（PATH_NOT_ALLOWED/RUNTIME_READ_DISABLED/released）与四 getter 不变** → 失败短路透传（失败对象不带 schema 键，负控 #3/#4 锚 `'schema' in r === false`）；`readDisabled` 零触碰；getSchema/getMetadata/getActiveSchema/getStatus 零 diff。✅

## 3. ADR-0016 忠实性（权威母法逐节）

| ADR 条款 | 实现落点 | 判定 |
|---|---|---|
| §结果形状 L19 `{ok:true; value:unknown; schema: ReadDataSchemaProjection \| null}` | runtime.ts L117–127 逐字 | ✅ |
| L22 null 三情形不区分、无缺席原因分类、null 非失败 | 单义 null 出口（L50/L53/L57）；无 `schemaIssue`、无码透传（被否备选 L87 未复活） | ✅ |
| L23 失败分支三通道不变 | 失败短路原样透传；`RuntimeReadDisabledResult` 逐字；registry released issue 零触碰 | ✅ |
| L24 值缺席照常返 schema（路径键控） | 红 #7；resolver 路径键控、不用判别式缓存按值收窄 | ✅ |
| L25 空路径 ROOT 投影 | 红 #1（`[]` → ROOT 四件套） | ✅ |
| §投影体 L30–39 四件套（值语义子树 ref 按名保留 + 传递闭包别名 + docs/aliasDocs 切片同构键规约） | 直接消费 #272 `resolveSchemaAtPath` ok 分支（不自造第二套投影）+ D5 深拷贝；红 #3 字面量锚（ref `Meta` 按名、闭包别名体、docs 键集 `{Meta.content, ROOT.meta}`、aliasDocs `{Meta:[' 备注实体 ']}`） | ✅ |
| §交付纪律 L69–70 always-on、每次读深拷贝、可变普通副本不冻结、零缓存 | 红 #13–#15 锚 + D5 实现 | ✅ |
| §分层 L74–76 doc-runtime 不动 / runtime 组合 / registry 仅别名 | 零 diff 亲证（§2 要点 5） | ✅ |
| L77 诊断/复制 raw 面/typed-access 兼容 | 读面零诊断事件、零 sequencer 进入（纯同步组合）；apps/yjs-server 零 diff；domains/** 零 diff | ✅ |
| Consequences L91–92 D8 封口改写 + toEqual 改锚 | p0.ts 注释更正（derived 只经投影深拷贝进公共面；module/validator 仍永不）；D7 三策略改锚 13 文件逐站点亲核（typed/any stub 补 `schema:null` 保全等强度；真实 runtime 站点 toEqual → toMatchObject 值意图不变——无站点被弱化/跳过/删除） | ✅ |

## 4. SA6 契约完整性与满足性

- **五契约文件全文亲读并与 SA6 §12/§6 逐条比对一致**：红 15（断言形态/预言机 + 字面量双锚/四态矩阵/五层隔离——逐条吻合）、负控 6（doc-runtime 恰两键/失败单通道/失败对象无 schema 键/preparing 不等待）、类型锚 ×2（`Extract<…,{ok:true;value:unknown;schema:…|null}>` 非 never 探针 + doc-runtime 保持性守卫）、夹具（TXT_273 覆盖位/seedRoot count=3/`makeReadyRuntime` 导出在位）。SA4 的内容+mtime 双佐证结论本轮以内容比对独立复证，**无篡改**。
- 红契约断言全部落在可观测行为（键集/值/schema 内容/引用隔离/null 语义），无源码字符串断言；`readOk` 对 ok:false loud throw，无假绿面。
- 类型锚红→绿翻转机制与 SA6 §13 记录的红形态（TS2322 never）互洽；SA3 报告 typecheck 0 错误即两锚翻绿。

## 5. 修订设计 D1–D8 与 SA2 审批落实

| 决策/评审项 | 实现证据（行号亲核） | 判定 |
|---|---|---|
| D1 联合重定型（恰三键 + Extract 派生 + Disabled 逐字） | runtime.ts L114–127 | ✅ 逐字 |
| D2 组合顺序（值先行 → 失败短路 → 恰三键） | runtime.ts L461–473；`value` 直传 doc-runtime 副本零重复拷贝 | ✅ |
| D3a 状态守卫（先于 path 守卫；fatal B5 天然覆盖） | read-schema-projection.ts L46–50；p0.ts fatal 不迁移 schemaState 亲证 | ✅ |
| D3b 敌意 path 规范化（仅属性读/索引读/迭代器**同一性比较**、`length` typeof+isInteger+非负、段域 string\|number、全程内层 try、普通数组副本传 resolver） | L79–97 与设计伪代码逐行一致；内层 try 边界 = 函数体，**不包裹** L56 resolver 调用（两域物理分离）；迭代器同一性比较是属性读不调用 | ✅（含纯度校验完整版——SA8 iter-2 §8 实现义务 1 强制项） |
| D4 InternalError throw 逃逸（零 catch、不收敛 null、不降级码、不记 fatal、不发诊断）+ 双域文档两处义务 | L56 零 catch 直通；模块头注 L9–21 + readData JSDoc（runtime.ts L137–150）双域表述 + 内层 try 辖域注明（防维护者误判/误扩） | ✅ |
| D5 深拷贝（逐 kind 显式分派穷尽、memo 先登记后递归、不冻结、键域 CreateDataPropertyOrThrow + tokenizer ASCII 判断依据注释保留） | L99–220；九 kind 对 `derived.ts` 逐 member 核对无遗漏；`keyPattern?/regex/values/scalar.type` 原语域无引用逃逸；N-5 依据注释在 L200–203/L214–215/L183–184 | ✅ |
| D6 registry 别名跟随 + 导入清理；lease.ts 零改动 | types.ts L443–449 + 导入 diff；lease.ts 零 diff、Equal 锁原样 | ✅ |
| D7 三策略改锚 | 13 测试文件逐 diff hunk 亲核（§3 Consequences 行）；registry-open L957 失败分支字面量站点原样保留 | ✅ |
| D8 新验收文件（T1–T3 + 局部负控；夹具 import-only） | hostile-path-guard.test.ts 85 行：T1 `iteratorCalls===0` 载荷锚为**可执行断言**（L40，非注释——SA8 iter-2 §8 义务 2 兑现）；T2 Proxy get 陷阱；T3 含 `'schema' in r === true` 键在场断言（L62）；负控合法 `['count']` 非 null + 红 #2 字面量对照 + 不冻结抽检；夹具零改动 | ✅ |
| SA2 F-1 验收 ①②③④ | ①②③ 见 D8 行；④ 既有面回归 = SA6 五文件零改动 + 根门绿（§1 AC5） | ✅ |
| N-1（4 处无改动站点留档） | registry-open L957/phase5-bootstrap-reset-r2-internal/ws-replication testing.ts/runtime-registry-internal-sa7-dynamic 均不在 diff 清单（亲证） | ✅ |
| N-2（不导出 InternalError；构造名/message 断言） | vfsl/** 零 diff（InternalError 仍未导出）；AC9 断言 `constructor.name === 'InternalError'` + message 含「root 节点」（恰为 vfsl L119 消息子串） | ✅ |
| N-3（yjs-server 销项） | apps/** 零 diff | ✅ |
| N-4（确定性站点非 null 断言，非义务） | 未加；SA3 记录「非义务不处理」与设计 §14 一致 | ✅ 记录在案 |
| N-5 | 见 D5 行 | ✅ |

## 6. SA8 发现落实（实现阶段复查清单 iter-2 §10，逐条）

1. **对 `resolveSchemaAtPath` 调用无任何 try/catch；JSDoc+模块头注双域文档在场；允许且仅允许的内层 try = 敌意扫描自身** → L56 调用在任何 try 之外；内层 try = L80–96 函数体；两处文档在场。**通过**。
2. **恰三键/精确可空/Extract 派生/Disabled 逐字/两码单义收敛** → §5 D1/D3 行。**通过**。
3. **深拷贝落位 runtime 边界；lease.ts 零改动、Equal 锁编译绿** → §5 D5/D6 行。**通过**。
4. **冻结面：失败三分支、released、四 getter、十二键/exports、无新增公共方法/参数/稳定码** → 零 diff 亲证；D3b 走既有 null 出口非新结果分支。**通过**。
5. **p0.ts 仅注释行；SA6 契约 5 文件未修改** → p0.ts diff 仅 L42–44 注释替换（零代码行）；§4 完整性核验。**通过**。
6. **D3b 专项：仅属性读/索引读/同一性比较（T1 计数器锚在场）；内层 try 不含 resolver；副本传递；D8 文件 ALLOW 内、被 vitest 收集且绿；红契约透明** → L79–97 逐行核对；T1 计数器断言在场；副本 `out` 传 resolver（L56）；文件命中 vitest include `packages/*/test/**/*.test.ts`（亲核 L15）；红契约对合法 path 逐元素透明（契约 grep 零敌意构造，SA8 iter-2 §2 实测 + 本轮复证）。**通过**。

红线 1–7（前置门禁）与 iter-1/iter-2 clear 裁定的实施面：包装而非透传（D2 显式三键构造）、Equal 锁同步（D6）、null 单义（无子通道）、InternalError 通道归属（D4 双域钉死）、深拷贝义务（D5）、测试改锚面（D7）、工作流纪律（HEAD 栈接 `1acd9e97` = PR #271 支系 head，亲证）——全部落实。

## 7. SA4 approve 一致性

SA4 裁决 approve（无 BLOCKER/MAJOR；O-1–O-5 非阻断）。本轮对 SA4 的关键静态佐证独立复证成立（文件/用例计数、DENY 零触碰、toEqual 残留扫描唯一命中 = doc-runtime 直读恰两键站点 `create-initial-document.test.ts:289`——schema 无关负控面，**应保持**，非漏改）。SA4 §11 动态验证项（根门复跑/CI/隔离运行时复核/敌意面扩展矩阵/SA8 复查清单确认）属 SA7/Controller 职责，与本轮静态核验无矛盾。

## 8. 偏差与 MINOR 备案（均不阻断）

### 8.1 AC9 改锚（ALLOW 清单外唯一改动）——独立裁定：非 scope creep、非弱化

- **事实**：`runtime-mutate-root-sequencer.test.ts` AC9 末断言由「`readValue(runtime,['n'])` 返回 1（读取保留值面直接锚）」改为「readData loud throw `InternalError`（构造名/message 匹配，N-2 方式）」。该站点不在设计 §10/§11 清单（SA3 Deviations #1 如实披露；SA1/SA2 grep 方法论双漏——该站点经 helper 值断言，非 `toEqual({ok:true,value})` 形态）。
- **独立裁定**：(i) 该 fixture 经 compile seam 注入**结构畸形 derived**（structure 非 root）并安装为 ready；ADR-0016 组合后 readData 的 schema 通道消费 `activeTools.derived` → resolver 对该畸形派生物抛 `InternalError`——这正是批准设计 D4 钉死的行为（可信域畸形 → throw 逃逸，唯一逃逸通道；SA8 iter-2 §10 清单第 1 条明令「不收敛 null」）。**旧断言在新契约下结构性不可能保持**；若实现为保旧断言而对 resolver 加 catch 收敛 null，反而违反已裁决的 D4/SA8 清单——改锚是唯一合规路径。(ii) 新断言内容 = 设计 §12 D4「可选负向锚」规格的逐字落地（SA2 R2.9-4 建议的断言方式）。(iii) AC9 写侧断言（rejected/committed:false/notifier 零调用/零写入/写永久禁用/fatal 非 null）全部原样；「读取保留」不变量（ADR-0008 修订节第 3 条）由 `status.read.enabled === true` 持续锚定——读取**能力**保留语义未削弱（该 seam 注入态生产不可达）。(iv) 测试专用、零生产漂移。
- **结论**：沿 SA4 O-1 裁决维持 **MINOR 文档债**（ALLOW 增补回流 SA1）；不构成 reject 依据。

### 8.2 其余 MINOR（备案，不阻断）

- **O-2**：AC9 值通道保留性现仅 `read.enabled` 间接锚（未来可补 doc-runtime 直读断言）——非义务。
- **O-3**：N-4 确定性站点非 null 断言未加——设计明示非义务，记录在案。
- **O-4**：`cloneDiscriminator` 不走 identity-memo——当前 derived 构造下单投影内不共享 discriminator，语义无影响；留作未来重构注记。
- **R7/R8（设计 §13 已登记）**：跨 realm 普通数组 fail-closed 收敛 null（值读不受影响；本仓全部调用方同 realm；follow-up #5 加法放宽路径在案）；敌意长 path 扫描成本与值通道严格同阶、无新增渐近项。均为如实登记的残余风险，非缺陷。
- **wiki 档案随实现同提交**：8 个 wiki/raw 产物 + dispatch 记录入 `76966d2`——任务档案白名单惯例（SA4 §6 同裁），非生产面。

## 9. PR 必须披露的未达成/待办项（approve 附带披露义务）

1. **AC9 改锚理由与 ALLOW 缺口**（§8.1）：PR 描述须保留 SA3 Deviations #1 的披露——该站点不在原设计 ALLOW 清单、改锚由 AC5 根门完备性兜底强制、内容为设计 D4 可选负向锚的原位落地；ALLOW 增补文档债回流 SA1（SA4 O-1）。
2. **根门独立动态复跑未完成于本审查**：AC5 绿证 = SA3 单会话执行（红 15/负控 6/类型锚 2/hostile 4/runtime 38 文件 319/registry 33 文件 384/根 typecheck/根 test 301 文件 3203 全绿）+ SA4 与本轮双重静态佐证；SA10 纪律不运行测试。**合并前须由 Controller/SA7 于干净环境复跑 `pnpm typecheck` + `pnpm test`，并经 CI（typecheck 作业 + Node 20/24 × 6 分片 + contract-gates）实跑确认**——尤其 sequencer/fatal 面（AC9 改锚站点所在文件）与 registry typed stub 类型面。
3. **SA8 已 armed 的实现阶段冲突复查（iter-2 §10 清单 6 条）**：本轮静态核对 6 条全过（§6），但正式复查结论须由 SA8 按管线出具。
4. **MINOR 备案清单**（§8.2）：O-2/O-3/O-4/R7/R8 与 follow-up #5（跨 realm 放宽，仅当出现真实跨 realm 调用方）。
5. **无 owner 评论并入**：Issue comments 经 REST 当前读取为空（上游六处同载），本实现不含任何 owner 追加要求——PR 无需就评论偏差作说明。

## 10. 交付物

- 本文件：`wiki/raw/task_issue-273_sa10_spec.md`（唯一写入）。
- 结构化结果：`verdict = approve`，`requiresConflictRecheck = false`（本轮为 spec 符合性审查，不新触 ADR 面冲突裁决；SA8 armed 实现阶段复查的正式出具见 §9.3 披露），artifactPaths 见 tool call。
