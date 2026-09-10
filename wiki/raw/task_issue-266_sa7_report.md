# SA7 动态验证报告 — issue #266（VFSL 内容寻址 schema ID：sc1- 窄派生接口与 envelope 校验）

> SA7（Dynamic Verifier）final-verification 轮产物。dispatch `sa-c74fa0c6-0a8e-4089-8f7a-a2eae189547c`，
> iteration 0，phase final-verification。
> **验证对象**：已提交实现（approved HEAD `08c0ea6`；实现提交 `704398c`「feat(vfsl): derive
> content-addressed schema identity」叠于权威 base `a1ca2d7`；`08c0ea6` 仅追加 SA9/SA10 报告
> 档案，零代码变化）。
> 前置状态：SA4 `pass`、SA9（standards）`approve`、SA10（spec）`approve`——本轮不动这些
> verdict，只在动态链路上独立复核。Issue 评论 REST 读取为空，无 Owner 追加要求。

## Inputs

- `wiki/raw/task_issue-266.md`（Issue #266 AC1–AC4）
- `wiki/raw/task_issue-266_design.md`（SA1 设计：§7 D1–D8、§8 编排、§8.5 相位链、§10 数据流
  R1–R4、§12 ALLOW/DENY）
- `wiki/raw/task_issue-266_sa6_contract.md` + `task_issue-266_sa6_red.log` /
  `task_issue-266_sa6_narrow_red.log`（红灯基线：文件 1 16 红 + 9 绿；文件 2 8 红）
- `wiki/raw/task_issue-266_sa3_impl.log`（实现轮自报日志）
- `wiki/raw/task_issue-266_sa4_review.md`（pass；§4 数据流审计表与 §5 动态审核重点移交项）
- `wiki/raw/task_issue-266_sa9_standards.md`（approve）、`wiki/raw/task_issue-266_sa10_spec.md`（approve）
- SA8 决议（`task_issue-266_conflict_report.md` clear + `task_issue-266_design_conflict_recheck.md`
> clear）——仅用于识别不可改变的协议边界（B1：id 可校验性不得成为引擎正确性依赖；
> B3：新码落 envelope 层注册表；D6：义务面 = 仅 `compileSchemaEnvelope`）。

## Runtime environment

- node v24.13.0 / pnpm worktrees / vitest 3.2.7 / tsx 4.23.12 / TypeScript 5.9.3
- Worktree `/home/wangjian/nomicore-fix-issue-266`，branch `mabf/issue-266`，HEAD `08c0ea6`，
  工作树 tracked 零改动（仅 3 个派发前已存在的 untracked 流水线档案）。
- 全部动态驱动经公共入口：`packages/vfsl/src/index.ts` 的 `deriveSchemaIdentity` /
  `compileSchemaEnvelope` / `parseSchemaEnvelope` / `getCompiled` / `getCompiledWith` /
  `parseVfsl`，以及 `packages/namespace-runtime/src/runtime.ts` 的
  `createNamespaceRuntimeWithSeam`（缺省 compile 注入 = 生产 `compileSchemaEnvelope`）+
  `@nomicore/persistence` MemoryPersistence 真实 DocHandle。
- 驱动形式：既有测试重跑（vitest）+ /tmp 独立探针（tsx；Base32 编解码器为探针自有独立
  实现，与生产 `schema-id.ts` 及 SA6 参考件零共享代码）。探针零仓内残留（收尾核验见
  Temporary Diagnostics）。

## Changed Data Flow Verification

设计 §10 声明改变的路线：R1（窄接口派生）、R2（envelope 格式校验）、R3（envelope 语义
匹配）。R4 为声明「零改动 + 新值流过」的下游透传路线，一并列出。

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| R1 窄接口派生 | `deriveSchemaIdentity(text)`：text → parse（原生 issues 透传）→ semantic fingerprint → digest → Base32 → `{ok, semanticFingerprint, schemaId}`；纯内存、无缓存、不抛错 | /tmp 探针 probe1（公共导出，84 断言） | text→parse→指纹→编码→三键返回全链观察；键集恰 `['ok','schemaId','semanticFingerprint']`（无 module/derived/validator/envelope 泄漏）；`fn.length===1`；`/^sc1-[a-z2-7]{52}$/`、长度 56、末字符 ∈ {a,q}；探针独立 Base32 双向：decode(id) == 指纹 digest hex、re-encode(digest) == payload；指纹与 `compileSchemaEnvelope`（legacy id）逐字节相等（单生产者）；坏文本 issues 与 `parseVfsl` 同输入深相等；循环引用文本（E106）原生透传 | 确定性派生或原生 issues | 84/84 断言全过；大文本（17,897 B，300 类型链 + 60 层嵌套）首轮 15.25 ms、复跑 10.57 ms，逐字节确定 | ✅ |
| R1 敏感度 | 空白/普通注释稳定；JSDoc、声明集变化改变 ID（指纹算法零改动，全继承 ADR 0007） | probe1 | WS/行注释/块注释变体 ID 逐字节一致；JSDoc 变体、追加类型声明变体 ID 不同 | 稳定/敏感分界正确 | 全部符合 | ✅ |
| R1 跨进程 | 同 text 跨进程重启 ID 一致（无隐藏状态） | /tmp crossproc.mts 两次独立 node 进程 | 4 组文本（含大文本）derive 输出 + compile 指纹 JSON 完全一致（diff 为空） | 逐字节一致 | 一致（`sc1-zthuaa2u…` / `sc1-6vnn5o6b…` 等两进程相同） | ✅ |
| R1 缓存纪律 | 不读不写 `compiledCache` | probe1（`getCompiledWith` 计数 parse 接缝） | 全新文本先 derive ×N 再 `getCompiledWith`：parse 恰调用 1 次（miss）、两次 getCompiled 返回同一对象引用（hit） | derive 不触碰缓存 | parseCalls=1、gc1===gc2 | ✅ |
| R2 envelope 格式校验 | `envelopeStrictGate` 步骤⑤（方言后、parse 前）：保留族 `sc<digits>-`（/i）内非 canonical → ENV_6 单条；族外零触及 | probe1（经 `compileSchemaEnvelope` 公共入口） | 17 形态全拒：`SC1-`/`Sc1-`/`sC1-`、`sc2-`/`sc10-`/`sc01-`/`sc007-`、空 payload、51/53 字、大写 payload、`=`、字母表外字符、内嵌 `\n`、内嵌空格、末字符 pad 位非零（`b`）、10k 超长——均 ok:false + 恰 1 条 `kind:'envelope'` code `'6'`、message 冻结前缀 `VFSL-ENV-E6: ` 且经 sanitizer 单行化 | ENV_6 单条 | 17/17 符合 | ✅ |
| R2 相位 | ENV-6 先于 parse；ENV-1/2/3 → ENV-5 → ENV-4 → ENV-6 既有序不扰 | probe1 | malformed id + 坏文本 → 单条 ENV_6、零 vfsl issue；多余键 → ENV-5；未知方言 + `SC1-` → ENV-4（readOnly=true）；缺 text → ENV-2；version 错型 → ENV-3 | 门序保持且新步在方言后 | 全部符合 | ✅ |
| R3 envelope 语义匹配 | parse 成功后、evaluate 前：id 解码 digest ⇔ text 语义指纹 digest 精确比较；不等 → ENV_7 单条（message 双 digest）；相等放行且 ③b 指纹复用于 ⑤ | probe1 + 既有 `sc1-failure-order-chain.test.ts`（T1.2 evaluate 注入 mock） | TEXT_B 的 canonical id + TEXT_A → ENV_7 单条，message 恰 `id=<digestB> text=<digestA>`（双 digest 逐位核对）；JSDoc 变体文本 + TEXT_A id → ENV_7；匹配 id → ok 五件套、envelope.id 回显、语义指纹 = derive 值、结果与嵌套对象深冻结；trivia 变体 + canonical id → ok；全零/全 FF digest 的 canonical id → ENV_7（非 ENV_6）；末字符 `q`（pad 位零）过格式步 | ENV_7 单条/匹配放行 | 全部符合；「先于 evaluate」由 T1.2（vi.mock 注入 evaluate 失败 + `not.toHaveBeenCalled()`）重跑 7/7 绿证实 | ✅ |
| R3 失败优先 | parse 失败文本 + canonical id → 原生 vfsl issues（mismatch 不可达） | probe1 | ok:false 且全部 `kind:'vfsl'`，条数与 `parseVfsl(坏文本)` 相等，零 envelope 码 | 原生 issues 先出 | 符合 | ✅ |
| R4 下游透传（零改动 + 新值） | `SchemaParseIssue{kind:'envelope'}` → `toIssueSummary` → `SCHEMA_ENVELOPE_6/7` 不透明透传 → schemaState='unavailable' | /tmp 探针 probe2/probe3（真实 namespace-runtime：MemoryPersistence + DocHandle + 缺省 compile） | P0 链：`sc1-NotABase32Id!!!!` → unavailable + `SCHEMA_ENVELOPE_6` + message 即 vfsl ENV_6 原文；TEXT_B digest 的 canonical id + TEXT_A → unavailable + `SCHEMA_ENVELOPE_7`；匹配 canonical id → ready、`getActiveSchema()` 携 derive 的 id+指纹、readData 正常；legacy id → ready。replaceSchema 槽：malformed/mismatched sc1- → ok:false 拒绝（摘要码 `SCHEMA_ENVELOPE_6/7` 前缀）、旧 active schema 不动、零 fatal；匹配 canonical id → 接受且 active id 翻转为 sc1- | 既有 unavailable/ready 语义不变、码不透明流过、runtime 零注册 | 13/13 + 9/9 断言全过，两次驱动进程正常退出（close 后事件循环排空，无悬挂句柄） | ✅ |

## Preserved Data Flow Verification

设计 §10 声明不变的路线（§7 D6 义务面 + B1 纪律 + 既有管线）：

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| 旧式 id 路径（族外零触及） | 9 形态（`vfs3-assets@1`、`compile-fixture`、`命名空间@schema版本`、`mysc1-provisional-id`、`sc-`、`sc1x-foo`、`sc１-<…>` 全角、`schema-1`、任意旧标签）恒 ok:true 且语义指纹稳定 | probe1 | SA6 P5/N1（实现前 ok:true） | 全部 ok:true 且 `semanticFingerprint` 与 derive(TEXT_A) 逐字节相等（id 排除在语义指纹外保持） | ✅ |
| `parseSchemaEnvelope`（D6 义务面外） | 不校验 sc1-：`id:'sc1-garbage!!'` → ok:true | probe1 | SA6 §15.4（实现前不校验） | ok:true（行为不变） | ✅ |
| `getCompiled`（D6） | 不校验 sc1-；缓存键纯文本哈希（id 不参与） | probe1 | index.ts 既有语义（SA6 §2.1） | `sc1-garbage!!` 信封 → ok:true；`getCompiled(text)` 与 `getCompiled(不同 id 同 text 信封)` 返回同一对象引用（同缓存条目） | ✅ |
| `parseVfsl` | 好/坏文本行为不变 | probe1 | SA6 基线 557 绿 | 好 ok / 坏 issues；E106 循环引用文案不变 | ✅ |
| envelope 指纹域（含 id） | envelopeFingerprint 随 id 变、semanticFingerprint 不随 | probe1 | #72 冻结语义 | 同 text 不同 id：semantic 相等、envelope 指纹不同 | ✅ |
| vfsl 既有全量行为 | 557 既有测试绿（含 compile-schema-envelope 顺序锚、docscope-getcompiled） | vitest `packages/vfsl/test/` 全目录 | SA6 基线 557 passed | **31 files / 588 passed**（557 既有 + 31 新），Type Errors: no errors | ✅ |
| 下游包行为（namespace-runtime 等） | 零 diff、码透传不透明（ADR 0008 L131） | probe2/probe3 真实链路 + `git diff a1ca2d7..704398c --stat`（仅 `packages/vfsl` 8 文件 + wiki 档案） | 实现前 P0 unavailable/ready 语义 | unavailable/ready/fatal 分级、摘要冻结、close 行为全部按既有语义（见 R4 行） | ✅ |

## State Machine Verification

`compileSchemaEnvelope` 可观察失败优先级链（设计 §8.5）与 `deriveSchemaIdentity` 两态机：

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| unknown envelope 输入 | 缺键/错型 + malformed sc1- | ENV-1/2/3 坍缩单条（先于 ENV-6） | ENV-2（缺 text）、ENV-3（version 错型）单条先出 | 未出现 ENV-6 抢跑/多条 | ✅ |
| unknown envelope 输入 | 多余键 + `sc2-<52>` | ENV-5（先于 ENV-6） | ENV-5 单条 | 同上 | ✅ |
| unknown envelope 输入 | 未知方言 + `SC1-<52>` | ENV-4 readOnly=true（先于 ENV-6） | ENV-4 单条且 readOnly=true | ENV-6 未抢跑 | ✅ |
| 方言过门 | 族内非 canonical id | ENV-6 单条（parse 不运行） | 17 形态 ENV_6 单条；坏文本零 vfsl issue 混入 | parse issues 未混入；ok:true 未出现 | ✅ |
| ENV-6 过门 | 坏文本 | 原生 vfsl issues | 全 `kind:'vfsl'`，条数 = parseVfsl | ENV_7 未越先 | ✅ |
| parse 成功 | canonical id ≠ text digest | ENV_7 单条（evaluate 前裁定） | ENV_7 单条 + message 双 digest；T1.2 重跑证 evaluate 未被调用 | evaluate issues 未掩盖 mismatch | ✅ |
| ENV-7 过门 | 匹配 id | evaluate → 双指纹 → 深冻结 ok 五件套 | ok 五键、envelope/module/result 冻结、指纹 = derive 值 | 中间态/部分结果未泄漏 | ✅ |
| 任意相位 | 意外异常 | ENV-100 / E100 崩溃边界收编（不外抛） | derive 对 undefined/null/42/{}/[] 五类非 string 输入：不抛、ok:false、恰 1 条 `VFSL-E100: ` issue | 未外抛异常、未伪成功 | ✅ |
| 重复/交错触发 | 200 次交错调用（ok/ENV_6/ENV_7/legacy 四类输入轮转 ×50） | 纯函数：每输入结果逐次一致、恒单条纪律 | 全部符合 | 无跨输入串扰、无多条 | ✅ |
| 重启恢复（进程级） | 同输入全新进程 | 同结果（无隐藏状态） | 两进程 JSON 输出 diff 为空 | 无 ID 漂移 | ✅ |
| P0 schema 状态机（runtime 侧） | rejected envelope → unavailable；corrected id 新 runtime → ready | preparing → unavailable（终态，摘要冻结）；新句柄 ready | probe2 R4-1/2/3/4/5 观察到位 | 旧路径不因 retry/restart 复活；无 fatal 误升级 | ✅ |

## Error and Cleanup Flow

- **错误分类**：ENV_6（格式）与 ENV_7（语义不匹配）各自稳定（重复调用 JSON 逐字节相等）、
  互不相同、均为 `kind:'envelope'` 单条 + 冻结前缀 `VFSL-ENV-E<码>: `；正文自解释（ENV_6 内嵌
  违规 id、ENV_7 内嵌双 digest），经 sanitizer 单行化（10k 长度与内嵌 `\n` 用例均无原始换行）。
- **错误路径不伪成功**：族内 malformed/mismatched 输入全部 ok:false（P1–P4 探针面 27+ 形态）；
  旧路径（族外 9 形态）ok:true 是规范定义的兼容路径，非降级。
- **崩溃边界**：`deriveSchemaIdentity` 非法输入 5 类 → E100 单条结构化 issue，不外抛；
  `sc1MismatchIssueOrNull` 的不变式破坏 throw 属实现缺陷通道，公共 API 面不可达（本轮无代码
  注入手段可触发，由 SA4 189 条对抗探针中的静态通道复核兜底——非本轮动态缺口）。
- **cleanup/quiescence**：纯函数路径无部分状态（失败即返、幂等重试逐字节一致）；runtime 侧
  probe2/probe3 每个 runtime 均 `close()` 且进程 exit 0（事件循环排空，无悬挂 timer/handle）；
  unavailable 终态摘要一经结算冻结，corrected-id 新链路正常 ready（旧拒绝不复活）。
- **资源**：无缓存写、无落盘、无后台任务（R1 缓存纪律探针：derive 后 `getCompiledWith`
  parse 恰 1 次）。

## Temporary Diagnostics

- **零临时日志**：本轮未在生产/测试代码中添加任何 `[SA7-DATAFLOW]` 或其他诊断日志——
  全部观察经公共入口返回值、既有测试、`getCompiledWith` 测试接缝与真实 runtime 公共面完成。
- 驱动脚本位于 `/tmp/sa7-266/`（probe1.mts / probe2.mts / probe3.mts / crossproc.mts /
  sanity.mts / dbg-large.mts / run1.json / run2.json），仓外零提交面。probe2/probe3 因工作区
  bare-specifier 解析需要短暂以 untracked 文件存在于 `packages/namespace-runtime/`，运行后
  已删除。
- 收尾核验：`git status --short` 仅余 3 个**派发前已存在**的 untracked 流水线档案
  （`task_issue-266.md`、两份 SA6 红跑日志——SA9 M1 已路由总控补提交）；`git diff` 零变化；
  `grep -rn "SA7-DATAFLOW" packages/ wiki/` 零命中。
- 删除探针后的关键场景复跑：三契约文件 **40/40 绿**（post-removal verification，结果与
  删除前一致）。

## Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA6 | 文件 1（envelope 契约）实现后 16 红→绿 + 9 绿保持（SA4 §5.5 独立复跑要求，D-1 残余） | vitest 重跑 `sc1-schema-id-envelope-validation.test.ts` | 25/25 绿 | 25/25 绿（两轮：收尾前 + 探针删除后） | 本轮 vitest 输出 | PASS | 无 |
| SA6 | 文件 2（窄接口契约）8 例 + 顺序链 7 例转绿 | vitest 重跑两文件 | 15/15 绿 | 8 + 7 绿 | 同上 | PASS | 无 |
| SA6 | 红灯基线未被弱化（25+8 用例标题与 SA6 红日志一致） | 对比红日志 `sa6_red.log`/`sa6_narrow_red.log` 标题与当前文件 | 标题逐字一致 | 一致（SA4 §2.2 已逐字比对；本轮计数 25/8 吻合） | 红日志 + 本轮运行 | PASS | 无 |
| Design | R1 全链关键跳点（入口→parse→指纹→Base32→三键）+ AC4 四不暴露 | probe1 | 见 Changed 表 | 84/84 | /tmp 探针输出 | PASS | 无 |
| Design | R1 大文本确定性/耗时 + 跨进程一致（SA4 §4 R1 必验跳点） | probe1 + crossproc 双进程 | 确定且可复现 | 17.9 KB 15.25 ms；双进程 diff 空 | 探针输出 | PASS | 无 |
| Design | R2/R3 门序与单条纪律（§8.5 链） | probe1 + T1.1–T1.5 重跑 | ENV-1/2/3→ENV-5→ENV-4→ENV-6→parse→ENV-7→evaluate→ok | 全链观察一致 | 探针 + vitest 7/7 | PASS | 无 |
| Design | R4 真实链路透传（SA4 §5.2：P0/Registry 侧喂 mismatched id） | probe2（P0）+ probe3（replaceSchema 槽） | unavailable + `SCHEMA_ENVELOPE_6/7` | 观察到位，runtime 零改动零注册 | 探针输出 | PASS | 无 |
| Design | 保留族外零触及（P5/N1 负控 + `sc１-` 全角已知边界） | probe1 | 族外恒 ok + 指纹不变 | 9/9 形态符合（含全角 `sc１-` 放行——设计 D3/SA2 F3 裁定的已知非缺陷边界，本轮记录观测） | 探针输出 | PASS | 无 |
| SA4 | ENV-7 先于 evaluate 的运行时证明 | 既有 `sc1-failure-order-chain.test.ts` T1.2（vi.mock evaluate） | evaluate 未被调用 + ENV_7 先出 | 重跑绿 | vitest | PASS | 无 |
| Design | D6 义务面：`parseSchemaEnvelope`/`getCompiled` 不校验 sc1-；缓存键纯文本 | probe1 | 两入口 ok + 同 text 不同 id 同缓存条目 | 观察到位 | 探针输出 | PASS | 无 |
| Design | 既有行为零回归（557 基线） | vitest `packages/vfsl/test/` 全目录 | 588 绿 | 588 绿（31 files） | 本轮 vitest 输出 | PASS | 无 |
| SA4 | CI 真实运行证据（SA4 §5.1） | ——（SA7 章程：不等待 PR CI、不读远端 CI 日志；分支未 push、无 PR CI run） | shard 执行记录 | 本轮以本地动态证据替代 | —— | N/A（范围外） | 总控收官时以 CI 运行记录补（非本票合并阻塞项） |

额外发现（finding，不扩大验证面）：无新缺陷。两项记录性观察：(1) `sc１-` 全角数字族外
放行为设计既定边界（T2 钉位测试锁定）；(2) replaceSchema 槽的拒绝摘要 message 带
`SCHEMA_ENVELOPE_<n>: ` 前缀而 P0 摘要 code 字段承载同码——两者均属既有 runtime 投影面
（零 diff），非本票引入的差异。

## Commands and Evidence

```text
# 独立重跑（全部 exit 0）
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run \
    packages/vfsl/test/sc1-schema-id-envelope-validation.test.ts \
    packages/vfsl/test/sc1-failure-order-chain.test.ts \
    packages/vfsl/test/sc1-derive-schema-identity.test.ts
  # 3 files / 40 passed（25 + 7 + 8），Type Errors: no errors（收尾前后各一轮）

$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run packages/vfsl/test/
  # 31 files / 588 passed，Type Errors: no errors（53.5s）

$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/tsx /tmp/sa7-266/probe1.mts
  # probe vfsl-public-surface: pass 84 / fail 0
  #   largeTextBytes 17897, firstDeriveMs 15.25, secondDeriveMs 10.57
  #   textA FP  sha256:v1:cccf40035479731a04786e0127aa371fe915d20165884b529894c9bec2c47ecb
  #   textA ID  sc1-zthuaa2upfzrubdynyaspkrxd7urluqbmweewuuyste35qxup3fq

$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/tsx /tmp/sa7-266/crossproc.mts  (×2)
  # 两进程输出 diff 为空 → CROSS-PROCESS IDENTICAL

$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/tsx packages/namespace-runtime/sa7-probe2.tmp.mts
  # probe namespace-runtime-p0: pass 13 / fail 0（ENV_6/ENV_7 → unavailable + SCHEMA_ENVELOPE_6/7；
  #   匹配 id → ready + activeInfo 指纹 = derive 值；legacy → ready；corrected id → ready）

$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/tsx packages/namespace-runtime/sa7-probe3.tmp.mts
  # probe namespace-runtime-replace-schema: pass 9 / fail 0（S4' 写槽同款透传 + 旧 active 不动）

$ git rev-parse HEAD && git status --short && git diff --stat
  # 08c0ea6；tracked 零改动；grep SA7-DATAFLOW 零命中
```

## Deviations

1. **CI 动态证据（SA4 §5.1）未采集**：SA7 章程明文「不等待 PR CI、不读远端 CI 日志」，
   且分支尚未 push、无 PR CI run 存在。已用本地动态证据（同 vitest include 配置的定向
   重跑 + 真实链路探针）覆盖同一风险面；CI 侧确认移交总控收官。
2. **ENV-7 先于 evaluate 的「真实求值失败」不可注入**：evaluate 唯一 ok:false 路径是 E100
   崩溃边界（无领域级失败面），公共 API 无法构造求值失败文本；该跳点采用既有 T1.2
   （vi.mock evaluate 注入 + `not.toHaveBeenCalled()` 双判）重跑作为运行时驱动——符合
   Skill「优先使用现有测试」纪律。
3. **`sc1MismatchIssueOrNull` 不变式破坏 throw → ENV-100 通道**：公共 API 面不可达（需
   破坏门前置不变式），本轮无动态触发手段；采信 SA4 对抗探针 + 静态复核，登记为动态
   证明边界而非缺陷。
4. probe2/probe3 探针临时置于 `packages/namespace-runtime/`（tsx 对工作区 bare-specifier
   的解析需要），运行后立即删除并复跑关键场景确认结果不变（见 Temporary Diagnostics）。
5. 本报告为 `wiki/raw/task_issue-266_sa7_report.md` 固定输出原位新建（此前无 SA7 报告）。

## Verdict

**approve**。

- 设计声明改变的三条数据流（R1/R2/R3）在真实运行链路上按设计变化：窄接口派生链关键跳点
  全部有运行时证据（入口形状、指纹单生产者一致、独立 Base32 双向互证、缓存纪律、崩溃
  边界、跨进程确定）；envelope 门新增格式步与 parse 后语义匹配步的相位、单条纪律、稳定
  码、双 digest message 全部实测符合 §8.5 链。
- 设计声明不变的路线全部保持：族外 9 形态零触及且指纹稳定、D6 两入口行为不变、缓存键
  纯文本哈希、557 既有测试基线在 588 绿中完整保持。
- 状态机合法顺序与关键值正确，禁止状态（族内 malformed/mismatched 放行、ENV_6 越序、
  多条 issue、ok 分支泄漏 IR、外抛异常、跨进程 ID 漂移、unavailable 复活）均未出现。
- 错误与 cleanup 符合设计：诚实失败、幂等、纯函数、runtime 侧 close 后资源退出
  （进程 exit 0）。
- 下游 R4 在真实 namespace-runtime P0 与 replaceSchema 双消费者上确认
  `SCHEMA_ENVELOPE_6/7` 不透明透传与 unavailable/ready 既有语义（零 runtime 改动）。
- 临时诊断零残留（无 `[SA7-DATAFLOW]`、工作树 tracked 零变化、探针已删并复跑）。
- SA4 pass 与 SA9/SA10 approve 保持不动；本轮未发现任何可行动缺陷。
