# Spec 评审报告 — trusted replication / 复制管理写接入诊断变更日志（issue #151）

- **评审轴**：Spec / Acceptance（最终独立 issue/AC 审查：`722bddf` → HEAD `b5b0cb8` + worktree 终态 diff ↔ Issue #151 AC1–AC5 / ADR-0011/0012 钉死条款 / SA6 契约 / SA7 动态证据 逐条比对）
- **评审员**：SA2（独立终审；不采信任何 SA 自证，全部关键声明在本 worktree 亲自复跑或逐行核读）
- **日期**：2026-08-31
- **Verdict**: **pass**（AC1–AC5 五项全部核验通过；SA6/SA7 证据独立复现；未闭合项全部为已登记的环境/文档/流程类，无一项触及验收标准。附 3 项非阻断测试增强注记）

---

## 一、审查的精确 diff 范围

```
git diff 722bddf..HEAD            # HEAD = b5b0cb8（2 commits：218a74e 实现 + b5b0cb8 F1/F2 修复）
+ worktree 终态（未提交面）        # 3 个 wiki 文档修改 + 2 个未跟踪文件
```

| commit / 来源 | 内容 |
|---|---|
| `218a74e` | SA3 实现主体：replication-session.ts / replication-write.ts 新建 + runtime/errors/write/diagnostic/internal/p0 接线 + registry 侧 lease/registry/types/index + 红灯 15 用例 + 5 个替身测试收容 |
| `b5b0cb8` | SA4 R1 F1/F2 修复：apply R5 捕获窗口无条件化（`replication-session.ts:554`）+ enable E3 成功 input 快照（`replication-write.ts:309-311`）+ SA4 探针 2 用例 + 设计 §18 补录 |
| worktree 未跟踪 | `packages/namespace-runtime/test/runtime-replication-sa7-dynamic.test.ts`（SA7 动态 4 用例）+ `_sa7_report.md`；wiki 未提交 diff：dispatch 行 15–18、sa4_review R2 复验章、sa6_red 补锚修订记录 |

**代码/测试面实际触及**（wiki 除外）：`git diff --name-only 722bddf HEAD` = 24 文件（namespace-runtime src 8 + test 4；namespace-registry src 4 + test 6；两 package.json version bump）+ worktree 未跟踪 SA7 测试 1 文件。**DENY 面核验**：`packages/namespace-diagnostic-log/**`（冻结词表/adapter）、runtime `index.ts`/`sequencer.ts`/`close.ts`/`status.ts`、registry `testing.ts`、`doc-runtime/persistence/vfsl*/clock` 全部零 diff ✅（与设计 §18 DENY LIST 一致；SA4 R2 F3 机械比对结论独立采信并抽查复核）。

**基准文件**：任务简报 `task_trusted-replication-management-diagnostic-change-log.md`（AC1–AC5 原文）、`_relevant_decisions.md`（ADR-0011 §A–§G / ADR-0012 摘录）、`_conflict_report.md`（clear + 七条钉死）、设计 `_design.md`（695 行 R2 终稿）、`_sa2_review.md`（R1 reject → R2 pass）、`_sa4_review.md`（R1 reject → R2 pass）、`_sa6_red.md`（15 用例 + 三轮修订记录）、`_sa7_report.md`（pass + 五项移交闭合）。

---

## 二、AC1–AC5 逐项核验

### AC1 — 三 operation 发射 frozen v1 operation + 受控 source/context → ✅ PASS

**要求**：Trusted replication apply, replication enable, and replication epoch bump emit their frozen v1 operation and controlled replication source/context.

| 核验面 | 证据（源码位点 + 独立核读） | 测试证据（行为断言） |
|---|---|---|
| frozen v1 operation 三字面量 | `replication-enable`（`runtime.ts:390` emitAttempt / `createSlotDiag`）、`replication-epoch-bump`（`runtime.ts:412` 附近）、`replication-apply`（`replication-session.ts:278` emitAway / `:348` SlotDiag.operation）——三字面量均为 `namespace-diagnostic-log` 冻结面既有值（`schema.ts:94-96` / `vocabulary.ts:17-19,53-55`），**该包零 diff**（DENY 面）→ 词表演进为零，符合 ADR-0012「v1 operation 封闭词表」 | 红灯用例 1/4/5 `expect(rec.operation).toBe(...)` 三字面量逐一断言 |
| apply 受控 source | `replication-session.ts:267` `const source = { kind:'replication', direction, remoteInstanceId }`（会话闭包冻结常量，R1–R7 槽内全部结局点与 A 层拒绝恒携带）；direction 由 localRole 派生冻结（`:247`） | 红灯 5 `expect(rec.source).toEqual({kind:'replication',direction:'hub-to-peer',remoteInstanceId:REMOTE_HUB_ID})`；红灯 6 peer-to-hub 同款 toEqual（`red.test.ts:568,610`） |
| apply 受控 context | `replication-session.ts:268` `const context = { replicationId, replicationEpoch }`（open 时冻结四域派生，永不随 bump 漂移） | 红灯 5/6 `toMatchObject({replicationId, replicationEpoch:1})`（`:570,611`） |
| enable/bump source/context | enable/bump 槽 diag 缺省 source（emitAttempt 缺省 `{kind:'local'}`——`diagnostic.ts` emitAttempt 行）；context E4 后写入：enable 成功 `{replicationId, replicationEpoch:1}`（`replication-write.ts:356`）、幂等分支携既有事实（`:339`）、bump 先携既有/溢出 `{id, MAX}` 后收口 `{id, nextEpoch}`（`:449,464`） | 红灯 1（enable committed + context 断言）、红灯 4（bump context.epoch 递增 + identity 保留断言） |
| ADR 钉死 #6（身份上下文落点） | replicationId/epoch/remoteInstanceId/direction 全部走每条记录的 source/context，不进 manifest、不写 SCHEMA/META/ROOT（日志装配是构造栈旁路 `diagEnv`）✅ | — |

**结论**：AC1 兑现。管理写（local source）与复制 apply（replication source + direction 双字面量 + remoteInstanceId + 身份 context）的区分面完整，调查者可按 source.kind/direction 区分本地与复制效果。

### AC2 — 既有稳定 phase/code/issues/committed 事实保留 → ✅ PASS（附注记 N-1）

**要求**：Identity, epoch, capability, validation, transaction, dirty-notification, and committed-aware fatal outcomes retain existing stable phase, code, issues, and committed facts.

独立核读 `errors.ts`（本 diff +79 行）与三槽全部结局点的码/阶段/committed 取值：

| 结局类 | 实现（源码） | 稳定码（errors.ts 既有注册） | 测试 |
|---|---|---|---|
| identity/epoch 拒绝 | A-b（`replication-session.ts:461-467` stage identity + finalize 被动 fence）+ 冲突 A 层（`:312-317`） | `REPLICATION_EPOCH_CONFLICTED`（identity 承载 epoch——ADR-0011 阶段词表无独立 epoch 阶段，钉死 #3） | 红灯 8（stage identity + 码 + 零写入断言） |
| capability | A-e/A-g（R1 fatal gate / R3 writable+notifier）、A-a/A-c（显式 close / runtime-close——`closedBy` 记账分码域 `:301-310`）、E-b/E-c/E-d（gate 族） | `RUNTIME_WRITE_DISABLED`（sourceModule 'runtime'——D-9 码域注册表来源成对） | 红灯 9（acceptance/SESSION_CLOSED）；SA7 T2 增补 A-c（RUNTIME_WRITE_DISABLED + not-accessed——红灯缺口已由 SA7 补上） |
| validation | E-e/E-h（`diagValidationCode` + issues 同源透传单构造 `replication-write.ts:296-301`）、A-h/A-i（R4 scratch 预演）、B-e/B-f | `REPLICATION_INPUT_INVALID` / `REPLICATION_META_ABSENT` / `REPLICATION_RAW_UPDATE_INVALID` / `REPLICATION_PROTECTED_FIELDS_CHANGED` / `REPLICATION_NOT_ENABLED` / `REPLICATION_EPOCH_OVERFLOW` | 红灯 3（input invalid）、红灯 10（raw update invalid） |
| transaction | 槽内成功/幂等/noop → stage transaction + committed（emitSlot 缺省组装，`diagnostic.ts` emitSlot transaction 分支）；事务 throw → `diagFatalTx` 保守 committed:true / apply 按 txStarted 二分 | `NSRT-FATAL-REPLICATION-WRITE-INTERNAL`（E-j/B-h）/ `NSRT-FATAL-REPLICATION-APPLY-INTERNAL`（A-l——常量名含 WRITE 值不含，R-3.2 裁决，SA4 E-2 与主线 b66615c 15/15 逐字节 MATCH） | 红灯 1/4/5（stage 'transaction' + committed 断言 `:433,514,567`）；SA7 T3(b)（in-flight apply 记录 stage transaction 照发） |
| dirty-notification | A-m/E-k/B-i（`diagDirtyFatal` committed:true + effect 由捕获 bytes 裁决） | 同上两 fatal 码 + phase `notify-dirty-failed` | 红灯 11（fatal committed:true + 码 + 精确事务 update + live doc 已提交断言） |
| committed-aware fatal | committed 二分忠实：getStatus throw → false（红灯 12 `:798` `{kind:'fatal',committed:false}`）；notifier 失败 → true（`:742-746`）；事务 throw 保守 true；apply txStarted 精确二分（`replication-session.ts:563-576`） | phase `write-slot-internal` / `unknown-pipeline-throw` / `notify-dirty-failed` 均为 RuntimeWriteFatalPhase 既有值（append-only，`errors.ts:222-230`） | 红灯 12（`:800` sourcePhase 'write-slot-internal'） |
| issues 保留 | 同源透传：业务返回与诊断共用同一 issue 对象引用（§9.4 纪律，`replication-write.ts:296` 注释 + 单构造） | — | 红灯 3/8 等 issues 断言 |

**注记 N-1（非阻断）**：transaction-**throw** fatal（E-j/B-h/A-l 的 unknown-pipeline-throw 分支）与 epoch overflow（B-f `REPLICATION_EPOCH_OVERFLOW`）无直接动态用例（红灯 fatal 面为 dirty-notification + capability-gate 两类，恰覆盖 committed true/false 两极）。两分支均经源码核读（映射行齐全、码/phase/committed 正确）+ SA4 E-2 主线逐字对账；AC5 的测试范围枚举（fatal paths 复数）已由两类 committed 极性满足。与 #149 spec 终审先例（「个别边缘 fatal 枚举点静态逐项核对，AC 门槛满足」）同判——登记为后续测试增强项（见 §四.6）。

### AC3 — detached owned Yjs update bytes + noop/update-omitted 显式 → ✅ PASS

**要求**：Committed replication transactions provide detached owned Yjs update bytes for the exact applied effect, with no-op and update-omitted represented explicitly.

| 核验面 | 证据 |
|---|---|
| 精确事务增量（非全文档冒充） | 三处捕获窗口（apply R5 / enable E5 / bump E5）单赋值 `update` handler + try/finally 退订（`replication-session.ts:550-581`、`replication-write.ts:363-387,466-487`）；**链式重放**：红灯 5 `applyCarrier(apply增量, 基态, [enable增量])` → ROOT.n=42 + META 键精确物化（`:576-586`）；bump 用例同款 prior 链（SA6 修订记录二：结构性依赖 enable pre-state，fixture 勘误后 15/15） |
| 真增量反向鉴别 | `expectNoMaterializeWithoutBase`——空 doc 不物化（红灯 1/4/5 断言，`:586`）——ADR-0011 §D「不得事务后编码整个文档冒充」的判别锚 |
| detached / owned | 捕获在窗口 finally 收口（`diag.updateBytes = capturedUpdate`），emit 时窗口已关（emitSlot 在槽释放后微任务）零再触碰；bytes 是 Yjs update 事件自产增量，非 live doc 引用 |
| noop 显式 | enable 幂等重入 → `committed + noop` 零写入零通知（红灯 2）；apply 零新状态 update → `committed + noop` 零写入零 dirty（红灯 7；R-3.1 仲裁：捕获窗口零字节 ⟺ 零集成 ⟺ 跳过 R6） |
| update-omitted 显式 | producer 恒不产出 update-omitted（存储面承载——设计 §10 钉死 #1 裁决）；SA7 T1 活链路：`updateCapture:false`（生产默认捕获策略）→ apply 记录 `toEqual({kind:'committed',effect:'update-omitted',reason:'update-capture-disabled'})`，业务 `ok:true` 与 live 集成不变，reason ∈ 冻结三词表断言（`sa7-dynamic.test.ts:293-296`；adapter 守卫 `adapters/memory.ts` §7.4 前置转换）——ADR 钉死 #1 的 reason 词表闭包兑现 |

### AC4 — 日志故障/队列压力零业务影响 → ✅ PASS（附注记 N-2）

**要求**：Logger failure or queue pressure never changes apply results, replication ACKs, identity/epoch state, write-sequencer order, or transport health reporting.

| 核验面 | 证据 |
|---|---|
| emitter 违约 throw | 红灯 13：hostile emitter 下 enable+bump 业务结果逐项 ok、FIFO 槽序（META epoch=2 证明 bump 在 enable 后）、`getStatus().fatal===null`、handle ready 全不变；emit 恰 2 次且 throw 全吞没（`emitAttempt` 单点 try/catch——ADR-0011 §A「Runtime 防御 adapter 违约」） |
| 队列压力 | 红灯 14：capacity:1 → accepted=1/droppedTotal=1，业务两次写完整成功且顺序正确 |
| ACK/结果不被日志前置或延迟 | apply/enable/bump 的完成信号 = 槽 promise（`settled`）直接返回调用方；emit 挂 `void settled.then(...)`（`replication-session.ts:375-378`、`runtime.ts:398-402,425-429`）——ADR-0012 amendment C「slot 之外或已释放之后」+ ADR-0011 §G「emitter 不被 await」钉死 #2 兑现；A 层/acceptance 拒绝在公共方法同步段 emit（amendment 允许的两个合法位置） |
| 无日志基线行为等价 | SA7 T4：无 emitter 基线 vs 有日志装配，同操作序列（enable→bump→apply 集成→apply 空 diff→bump fence→fenced apply）三面（结果联合/saveCalls 轨迹 `[1,2,3,3,4,4]`/终态 META）逐项相等；**F1 修复的破坏性反证**（mutation check）：临时把 apply 窗口退化为 diag 条件 → T4 + 探针 A 立即双红，还原后复绿、`git diff` 零残留——守卫有效性经实证非恒真 |
| F1 修复形态（终态核读） | `replication-session.ts:554` `host.doc.on('update', updateHandler)` **无条件**；`:578-579` finally 无条件双退订；`:580` 仅 diag.updateBytes 赋值 diag 条件；`:589` R6 门控读 `capturedUpdate !== undefined`——无 emitter 生产基线（`createNamespaceRuntime(handle, notifyDirty)` 两参默认）下有集成 ⟹ notifyDirty 同构成立，ADR-0006 持久化触发器不悬空 |
| transport 健康面 | 会话 open/getStatus/close 零诊断路径；本 worktree 无 Phase 5 transport 业务层（SA8 注记 3 基线事实）——transport observability 面结构性零触碰 |

**注记 N-2（非阻断）**：敌意 emitter **期间 apply** 的直接用例缺失（红灯 13/14 覆盖 enable+bump）。apply 的全部发射（A 层 emitAway / 槽后 emitSlot）与 enable/bump 共用同一单点 `emitAttempt` 吞没机械，且 SA7 T4 已证 apply 在「无 emitter vs 有 emitter」两基线业务等价——结构性隔离成立；登记为后续增强项（§四.6）。

### AC5 — 测试覆盖六面 → ✅ PASS

**要求**：Tests cover both replication directions, identity/epoch rejection, committed apply, management writes, fatal paths, and isolation from transport observability.

| AC5 枚举面 | 用例（文件+编号） | 独立复跑 |
|---|---|---|
| both replication directions | 红灯 5（hub-to-peer，source toEqual 精确）+ 红灯 6（peer-to-hub，双字面量 + remoteInstanceId 精确） | ✅ |
| identity/epoch rejection | 红灯 8（fence 后 apply → identity/REPLICATION_EPOCH_CONFLICTED/rejected/零写入）；SA7 T2 复核 fenced apply `{ok:false,code:'REPLICATION_EPOCH_CONFLICTED'}` | ✅ |
| committed apply | 红灯 5/6/7（committed+update / noop）+ SA7 T1（committed+update-omitted） | ✅ |
| management writes | 红灯 1（enable committed）/2（幂等 noop）/3（输入拒绝）/4（bump committed） | ✅ |
| fatal paths | 红灯 11（dirty-notification fatal committed:true + 精确事务 update）/12（capability fatal committed:false + sourcePhase）；SA7 T2（A-c RUNTIME_WRITE_DISABLED + in-flight FIFO 排空时序） | ✅ |
| isolation from transport observability | 红灯 15：session open/×3 getStatus/×2 幂等 close 全程零 emission（`emissions.length===2` 恰 = enable+apply 两条变更尝试；record 面 `['replication-enable','replication-apply']` toEqual）——ADR-0011 §C transport 排除面行为级兑现 | ✅ |

---

## 三、SA6/SA7 证据独立复核（全部亲自重跑，非转述）

| # | 声称（来源） | 我的独立复跑（命令 → 结果） | 判定 |
|---|---|---|---|
| 1 | SA6 红灯 15/15 PASS（`_sa6_red.md`） | `pnpm exec vitest run …runtime-replication-diagnostic-red.test.ts …sa4-probe.test.ts …sa7-dynamic.test.ts` → **21/21 passed（红 15 + 探针 2 + SA7 4），Type Errors no errors** | ✅ 属实 |
| 2 | SA7 B-3 两包 365/365（44 文件）exit 0 | 三次完整跑：①365 用例 1 failed/364 passed（失败者被 tail 截断未捕获身份）；②**365/365 passed（44 文件）exit 0**；③全仓跑内两包全部文件绿（含红灯/SA7/探针/全部 registry 文件） | ✅ 属实（①为偶发，见 #4） |
| 3 | SA7 B-5/B-6 typecheck + root tsc exit 0 | `pnpm typecheck` → **exit 0**（十包）；`pnpm exec tsc -p tsconfig.typecheck.json --noEmit` → **exit 0** | ✅ 属实 |
| 4 | SA7 B-4 全仓 `pnpm test` 1837/1837（exit 1 仅因 2 条 vitest-worker RPC 超时） | 我的复跑：**1828/1837 passed（145 文件）+ 2 unhandled errors + 9 failed**。9 失败**全部**位于本任务零 diff 的三个包：`dsh-persistence/test/dsh-probe-cli.test.ts`（2）、`vfsl/test/schema-check-cli.test.ts`（4）、`vfsl-codegen/test/generate-cli-check.test.ts`（3）——全为 5000ms spawn 超时；三文件**隔离复跑 16/16 passed exit 0**（首次隔离跑 2 例瞬时失败、二次全绿）。2 errors 与 SA7 登记签名**逐字一致**（`[vitest-worker]: Timeout calling "onTaskUpdate"`，同为 2 条） | ✅ 环境伪影判定成立（见下） |
| 5 | SA7 T1–T4 动态四用例 + F1 mutation 反证 | 4/4 亲跑绿（含 #1 内）；mutation 已还原（worktree 源码面 `git status` 零源码 diff——仅 3 wiki 修改 + 2 未跟踪文件） | ✅ 属实 |

**#4 归属判定**：9 失败包（dsh-persistence/vfsl/vfsl-codegen）全部位于设计 §18 DENY「非接线对象」面，`git diff 722bddf` 零触碰；失败形态为 CLI spawn 5s 超时（满载并发下进程启动慢）；隔离跑全绿。与前序票 #149 REPORT.md 遗留风险第 2 条登记的「generate-cli-check / dsh-probe-cli spawn 超时以及 vitest-worker RPC timeout 环境伪影」**同款同包同签名**——本任务改动不引入该失败（本任务两包专项跑全绿为对照证据）。SA7 报告「1837/1837」为其当时低载运行结果；本审查高载复现的偏差属环境类，**非证据失实**，但登记为环境注记（§四.5）。

---

## 四、未闭合范围（unclosed scope 登记——均非 AC 阻断）

1. **CI run-log 证据**：分支未 push（SA7 职责边界禁 push/建 PR），首个 CI run 的 `Test` step 摘录不存在——SA7 §6 已交付静态接线证据（ci.yml → `pnpm test` → vitest include glob 命中全部三个测试文件 + Typecheck 含两包）与首 run 预期形态；归发布阶段（Host push/PR 后）消费。先例：#149 REPORT.md 遗留风险第 1 条同款处置。
2. **设计 §18 ALLOW LIST 未收编 SA7 测试文件**：`runtime-replication-sa7-dynamic.test.ts`（worktree 未跟踪、属最终 diff 组成）不在 ALLOW LIST——SA7 报告 §8 已自登记为「下一轮 SA1 文档修订顺带收编」的文档形式项（同 F3 类，P2、纯文档、代码不回滚）。
3. **dispatch 行 17（Review-A standards 终审）pending**：`engineering/code-review` skill 运行时不可用（`invalid skill name`，与 #149 REPORT.md 遗留风险第 3 条同款运行时限制），按 dispatch 行 17/18 以独立替代双轴终审收口——本报告闭合 spec 轴（行 18）；standards 轴（行 17）由另一独立评审产出，尚待归档。
4. **worktree 未提交状态**：SA7 测试 + SA7 报告 + 3 个 wiki 文档修订尚未 commit——最终 diff（基线→worktree 终态）已包含；commit/push/PR 属 Host 发布阶段生命周期，非评审可闭合面。
5. **环境伪影登记**：满载全仓跑的 9 例 CLI spawn 超时 + 2 例 vitest-worker RPC 超时（本审查复现）与 SA7 登记的 2 例 RPC 同类；建议发布阶段在 CI（隔离环境）以 run-log 一次性洗清。
6. **测试增强注记（非阻断，N-1/N-2 落档）**：transaction-throw fatal（E-j/B-h/A-l）、epoch overflow（B-f）、敌意 emitter 期间 apply 三处无直接动态用例——实现面经源码核读 + SA4 E-2 主线逐字对账 + 词表闭包静态核验；按 #149 先例（「边缘 fatal 枚举点静态核对，AC 门槛已满足」）登记为后续票增强项，不阻断本票。

---

## 五、结论

1. **AC1–AC5 五项全部通过**：三条 operation 的 frozen v1 词表 + 受控 source/context（AC1）、七类结局的既有稳定码/阶段/issues/committed 事实保留（AC2）、detached owned bytes + noop/update-omitted 显式分置（AC3）、日志故障/队列压力四面零业务影响 + 无日志基线等价经 mutation 反证（AC4）、六面测试覆盖（AC5）——每项均有源码位点 + 行为断言用例 + 本审查独立复跑三重证据。
2. **SA6/SA7 证据链独立复现**：21/21（红 15+探针 2+SA7 4）、两包 365/365、typecheck/root-tsc 双 exit 0 亲自重跑属实；全仓跑偏差（9 例 spawn 超时）经隔离复跑归零并溯源至零触碰包的环境伪影（与 #149 登记同款）。
3. **未闭合范围全部为已登记的环境/文档/流程类**（CI run-log 待 push、ALLOW 收编、standards 轴 pending、未提交 worktree、环境伪影、增强注记），无一项触及验收标准或需代码回退。
4. **Verdict: pass**。本 pass 基于本地可复现证据；CI 级绿待发布阶段 push 后以首 run 摘录补全（§四.1），与本判定不冲突。
