# 最终规格轴审查（Final Specification-Axis Review）— Issue #150：namespace create 生命周期与 genesis 接入诊断变更日志

**Date**: 2026-08-31
**Reviewer**: SA2（独立最终审查，全新视角；不依赖此前各 SA 的自报结论）
**Verdict**: **pass**

- **审查对象**：任务基线 `722bddf` → HEAD `6ae689f`（4 commits：`85f36bd` 实现、`80a2eb8` SA6 AC5 契约勘误、`0f72527` SA4 R1 B1/B2 修复、`6ae689f` dispatch 档案）。
- **审查基准**：Issue #150 原文 AC（经 `gh issue view 150` 取回，与任务简报逐字一致）、任务简报 `task_namespace-diagnostic-change-log.md`（含 SA6 冻结契约 16 锚 + R2 AC5 勘误裁定）、`task_namespace-diagnostic-change-log_relevant_decisions.md`（ADR-0011/0012/0009/0006/0008/0007 条款摘录）。
- **方法**：独立读取全部实现 diff（`create-diagnostic.ts` 283 行全文、`registry.ts` 175 行接线 diff、types/testing/index/package.json/lockfile diff）、独立复跑全部可执行证据、对照冻结契约逐锚核验（不看 SA4/SA7 自报即先形成判断，再交叉核对）。

---

## 一、独立验证记录（命令 + 结果，本审查亲跑）

| # | 验证项 | 命令 | 结果 |
|---|---|---|---|
| V1 | SA6 冻结契约 + 既有面 + 守卫套件 | `./node_modules/.bin/vitest run packages/namespace-registry/test/registry-create-diagnostic-red.test.ts packages/namespace-registry/test/registry-create-diagnostic-code-source.test.ts packages/namespace-registry/test/registry-create.test.ts --typecheck.enabled=false` | **3 文件 / 72 测试全过**（16 + 6 + 50），exit 0 |
| V2 | SA7 动态套件（工作树未跟踪文件） | `./node_modules/.bin/vitest run packages/namespace-registry/test/registry-create-diagnostic-sa7-dynamic.test.ts --typecheck.enabled=false` | **10/10 全过**，exit 0 |
| V3 | CI typecheck 门禁（含未跟踪 SA7 文件） | `./node_modules/.bin/tsc -p tsconfig.typecheck.json` | **exit 0、0 errors** |
| V4 | 双包全量回归（与 SA4 R2 同范围 + SA7 文件） | `./node_modules/.bin/vitest run packages/namespace-registry/test packages/namespace-diagnostic-log/test --typecheck.enabled=false` | **37 文件 / 568 测试全过**，exit 0（= SA4 的 558 提交面 + SA7 10，无互扰） |
| V5 | Issue AC 原文校对 | `gh issue view 150 --json title,body` | 5 条 AC 与简报/AC checklist 逐字一致 |
| V6 | 代码范围 | `git diff --name-only 722bddf..HEAD \| grep -v '^wiki/'` | 恰 9 文件：namespace-registry 8 + `pnpm-lock.yaml`；`packages/namespace-diagnostic-log`（#148 冻结契约）**零触碰** |
| V7 | emit 插点计数 | `grep -c "diag\.emit" registry.ts` | **18**（与设计 §6.2 总表 18 结局点一一对应）+ `diag.initStream` 恰 1 处 |
| V8 | 冻结词表零发明 | 对照 `namespace-diagnostic-log/src/{vocabulary,emission}.ts` | 所有 stage/operation/sourceModule/input/result 形态均落在 v1 冻结联合内（见 §三.7） |

---

## 二、AC 逐条规格轴裁定

### AC1 — create 全路径结构化结局，用既有稳定事实 ✅

- **接线完整性**：`registry.ts` 18 个 emit 插点覆盖 Issue 列举的全部路径——acceptance（#1 停接纳 / #3、#7 entry duplicate / #4–#6 closing fatal）、duplicate（#3/#7 entry 级 + #14 持久层 DOC_DUPLICATE，四源同码 `NAMESPACE_ALREADY_EXISTS`）、input snapshot（#8 `input-snapshot`/`NAMESPACE_CREATE_INVALID_INPUT`/`unsafe-input`）、schema compile（#10 `NAMESPACE_SCHEMA_INVALID` + #12/#13 fatal 伞形）、validation（#11 `NAMESPACE_ROOT_INVALID`）、transaction/Persistence（#14/#15/#16a/#16b）、post-commit Runtime construction（#18 `runtime-construction`/`committed:true`）与成功（#17 `committed`+`update`）。#2 identity、#9（clock fatal 诚实缺席）为设计 DC-6 显式映射，非Issue 列举项但属同一「首次可观察尝试」目标。
- **既有稳定事实（零发明）**：全部 code 为 Registry 既有稳定码；stage 均在 ADR-0011 八值封闭词表内（`vocabulary.ts:21-30` 逐字核验）；`operation:'namespace-create'` 为 ADR-0012 v1 封闭集成员；`sourceModule:'registry'` 与 code 成对出现/成对省略（#17 committed 无 code——ADR-0011「committed 无 code」）。issue 级码派生（`SCHEMA_ENVELOPE_${code}`/`SCHEMA_TEXT_INVALID`）是 `p0.toIssueSummary` 的跨包语义复制，由 `registry-create-diagnostic-code-source.test.ts` 冻结同串关系并有 `VFSL-ENV-E` 反向锚（防发明码复活）。
- **可执行证据**：V1 中 16/16 契约测试（it 列表与简报锚一一对应：停接纳/entry duplicate/持久层 duplicate/敌意 payload/schema 编译/ROOT 校验/持久层运营/提交后构造失败各成独立 it）。

### AC2 — 成功创建供 detached genesis bytes；post-commit fatal 保留 committed 事实 ✅

- **源码**（`registry.ts:1085-1089`）：`createDoc` resolve 后、factory 前对 `initial.doc` 做 `Y.encodeStateAsUpdate`（owned bytes；该 doc 即 Persistence 已提交的同一初始文档——ADR-0006 #64 先例），`initStream(id.namespaceId, state?.slice())` 传**独立 slice 副本**（与 emission 引用不共享内存）。factory 成败皆先建 stream（DC-2 冻结次序：encode → initStream → factory → emit）；防御 fatal 路径（#12–#16）不建 stream。
- **post-commit fatal**：#18 `fatalFromBytes(true, state)` → `fatal/committed:true` + `effect:'update'`（bytes 可得）或诚实 `'unknown'`（encode 失败不可达防御——不伪造无 bytes 的 update）；业务面 `NamespaceRegistryFatalError{phase:'runtime-construction', committed:true}` 与「文档保留可 open」由契约 it（red test:666）运行时断言。
- **可执行证据**：V1 成功路径 it（`clock.calls===1` + initStream 恰一次 + genesis bytes 物化出 SCHEMA 四键/META 二键/ROOT）+ File adapter E2E it（磁盘 `genesis-baseline` seq 1 + `attempt` seq 2 + manifest 存在 + `readStreamStrict` status ok）。

### AC3 — pre-input 失败不触 payload；后续捕获复用既有 detached 安全快照 ✅

- **源码**：#1/#3/#7（及 #4–#6）emission 一律 `input:{status:'not-accessed'}` 且构造实参不触碰 `inputRef`（emitter 参数为字面量，零访问调用方对象）；#8 敌意 payload → `unsafe-input`，accessor 零执行；快照成功后的全部插点（#10–#18）传 `input:{snapshot:{schema: payload.schema, root: payload.root}}`——`payload` 即 create 路径既有 `snapshotCreatePayload` 产物（detached frozen 快照），**无第二套序列化规则**。
- **可执行证据**：red test:711-755——Proxy trap 计数 logged === baseline（日志零额外读取）；createDoc gate 前变异调用方原对象 → 记录仍为槽内 frozen snapshot（`{schema: ENVELOPE, root: ROOT0}`，非变异后值）；停接纳 it 断言零 trap。

### AC4 — 日志禁用/stream 初始化失败/队列压力/sink 失败不改业务四不变 ✅

- **禁用**：`diagnosticLog` 缺席/null/畸形（敌意 getter、非函数 emit）→ 构造栈收敛冻结 NOOP 单例（`createCreateDiag`，B1 修复 `0f72527` 后属性读取全部在真非抛边界内）；`registry-create.test.ts` 50/50 既有面 + 「启用 vs 禁用逐位一致」it（同 namespaceId/同 Clock 下 metadata/status/registryState）双证零漂移。
- **违约隔离**：emitter 同步 throw / initStream 同步 throw / clock 故障 / encode 失败 / issues 畸形五类全部吞没于 `emitAttempt`/`initStream` try 边界，emit 恰一次不重试；code-source 套件 4 it（null/Proxy/畸形/throwing-emit 跨 10 条结局路径与无日志基线 `toEqual`）+ SA7 动态套件同面复证。
- **队列压力**：真实 `createBoundedMemoryDiagnosticLog` capacity 1 → 第二条 `queue-full` drop + stats 计数，双创建业务均 ok（red test:782-805）。
- **stream 初始化失败**：真实 File adapter 非法 roll targets（`targetRecordsPerSegment:0`）→ create ok + 独立健康 observer `LOG_STREAM_INIT_FAILED/invalid-roll-targets`（事件由 Host 侧 adapter observer 真实产生，Registry 不代发不伪造——red test:832-871）。
- **sink 失败**：对 Registry 而言 throwing sink ≡ throwing emitter（同一 seam、同一吞没边界），由 emitter-throw 锚覆盖；adapter 内部 sink 故障的健康上报属 #152/#159 冻结面（V4 双包全量绿含其自身套件），#150 不重复造证据。
- **ADR-0012 amendment C（write-slot 接线纪律）**：逐一核读 18+1 个调用点——全部位于 Registry create lifecycle 槽或公共入口同步段；create 期 Runtime write sequencer 尚不存在，post-commit 段在 Registry 槽调用栈（P0 独立异步结算、只读 SCHEMA），无任何 emit/initStream 进入或延长 Runtime write slot。**合规**。

### AC5 — 六类测试场景（含延迟初始化的诚实当前态 genesis）✅

- 冻结套件 16 it 覆盖全部六类：成功 genesis（it1/it2）、duplicate（it3/it4）、validation rejection（it7）、persistence failure（it8）、post-commit construction failure（it10）、delayed stream init（it16）。
- **AC5 勘误忠实性独立核验**：commit `80a2eb8` 与 SA6 R2 裁定（preferred correction A）逐条对应——首次 initStream 以非法配置真实失败（`LOG_STREAM_INIT_FAILED` + **零落盘**，无健康 stream 构成真「延迟」）；ROOT n:1→n:2（经 lease mutateRoot）；重试以**当时** Y.Doc（Persistence `loadDoc` → `Y.encodeStateAsUpdate`，无 live doc 泄漏）+ 合法配置建全新 stream；断言仅 genesis-baseline seq 1、物化 `ROOT.n=2`（**反向鉴别锚保留**：伪称创建态则 n=1）、streams 目录恰 1（首次失败零落盘证明）。诚实当前态未被弱化为 resume 语义（健康 stream 的 resume 忽略 genesis bytes 是 #159 冻结正确行为，勘误只是把 fixture 从「原地续写」改为真「延迟」场景）。red test:873-953 逐行核读确认。

### Constraint — 不等待 #148 合并、按当前 worktree 实施 ✅

依赖以 workspace 链接指向 in-worktree 冻结实现（`package.json` +`@nomicore/namespace-diagnostic-log`，lockfile 一致），未引入任何外部等待或桩。

---

## 三、边界与条款符合性

1. **改动范围**：代码仅 `packages/namespace-registry`（src 5 文件 + test 2 文件 + package.json）与 `pnpm-lock.yaml`；设计 §10 ALLOW LIST（R2 后）与实际 diff 精确一致（B2 已闭）；DENY/BLACKLIST 零触碰（`namespace-runtime/**`、plugin 路径未动）。
2. **#148 冻结契约零改动**：`packages/namespace-diagnostic-log` 不在 diff 内；消费面纯 `import type`（DC-5，运行图零新增值级绑定），yjs 因 `encodeStateAsUpdate` 值级使用自 devDependencies 上移 dependencies（lockfile 平移，版本不变）——合法。
3. **公共面扩张最小**：新增仅可选 `diagnosticLog` option（生产面 + 测试面）与 `NamespaceRegistryDiagnosticLog` 类型导出——即 ADR-0011「业务模块依赖小 emitter interface」的落地；查询/导出/重放/健康接口未扩张到 Registry/Runtime/Lease/Persistence 面。version bump 0.1.3→0.1.4 符合仓库能力新增即 patch 的先例（SA4 已裁定非阻断）。
4. **ADR-0009 Clock 单读**：成功路径 `clock.calls === 1` 锚绿——槽内复用 `createdAt` 字符串（零额外读数）；Clock 步之前终结的结局由诊断侧单次读数；clock 故障 → 该条 emission 丢弃（不伪造时间戳）。`observedAt` 全部源自注入 Clock，无墙钟。
5. **ADR-0011 排序/时序**：未引入第二业务排序机构（emission 全在既有 carrier FIFO 槽序内）；emitter 不被 await（同步 void）；emission 不构成 createDoc/Yjs transaction/dirty notification 前置。
6. **ADR-0012 genesis 纪律**：producer 只供 bytes，genesis-baseline 由 adapter 内部构造（emission 公共面无 genesis 构造路径——`EmissionResult` 联合无 genesis 形态，核验属实）；encode 失败 → initStream 传 undefined（stream 仍可记录诊断事实）+ 成功 emission 诚实缺席，**未发明** `update-omitted` 新 reason（v1 三值词表未扩）。
7. **输入策略归属**：producer 语义面供 `{snapshot:{schema,root}}`（detached 快照复用），full/digest 投影为 Host 侧 adapter 配置（测试经 `inputPolicy` 配置，AC 记录面 `capture:'full'` 为 adapter 投影产物）——与 ADR-0011「输入策略可配置、默认保守」及 CONTEXT.md「storage projection 归 adapter」一致，#150 无越权。

---

## 四、非阻断观察（移交总控，发布前后处置）

1. **工作树未提交产物须随发布提交**：`packages/namespace-registry/test/registry-create-diagnostic-sa7-dynamic.test.ts`（SA7 动态套件）、`wiki/raw/task_namespace-diagnostic-change-log_ac_checklist.md`、`wiki/raw/task_namespace-diagnostic-change-log_sa7_report.md` 及 dispatch（13–17 行）/SA4 review（R2 节）的工作树修改当前均未入 HEAD。AC checklist 与 SA7 报告引为 AC 证据，且 SA7 测试文件已过 typecheck + 10/10（V2/V3/V4 亲证）、落在 CI include 内——**发布（push/PR）前必须一并 commit**，否则 PR 将缺失该证据面。此为总控档案事务，非 HEAD diff 的规格缺陷，故不阻断本裁定。
2. **CI run log 补录**：分支未发布，`gh pr list`/`gh run list` 为空（SA7 已登记）；发布后按 SA7「移交总控」节摘录 `pnpm test` 步骤两（或三，含 SA7 文件）测试文件的执行行。
3. **全量 `pnpm test` 的 worker-RPC 超时 flake**：本机多租户负载下的既有环境条件（SA7 以 baseline `722bddf` 判别实验证明同款 flake 在本题 diff 之前即存在）；本审查的定向复跑（V1–V4）全部 exit 0，不受影响。

## 五、裁定

五条 AC + Constraint 均有**本审查独立复跑的真实可执行证据**支撑（V1–V4），边界（范围、DENY、#148 冻结契约、词表零发明、write-slot 纪律、Clock 单读、genesis 纪律）逐项核验合规；SA4 R1 的 B1/B2 阻断项确认真闭合；未发现新的可修复阻断项。上述三条观察均为发布时序/档案事务，不构成规格缺口。

**Verdict: pass**
