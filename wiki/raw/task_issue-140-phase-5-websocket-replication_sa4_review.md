# SA4 静态验尸报告 — Issue #140 Phase 5 收口（app 黑盒管理动词面）

- **Date**: 2026-08-30（R1 审查 / R2 复审 / R3 复审 / R4 窄复审，见文末各节）
- **Verdict**: R1 = **reject** → R2 = **pass** → R3 = **reject（narrow：B1 scope-creep 记账）** → **最新（R4 窄复审，SA1 B1 修正后）= pass**——§8 ALLOW LIST 已显式收纳 SA7 锚（`[SA7 owned]`），creep 集合为空；HEAD 仍为 R3 已完整审毕的 `f310f18`，技术面零变化、零重审。SA7 R2 动态验证可进（携带 O-R3-1 必验项）
- **审核对象**: SA3 commit `dbd36d4`（R1）→ `3863a69`（R2）→ `f310f18`（R3）→ SA1 设计 §8 修正（R4，无代码 commit），基线 `469ca36`
- **输入**: 任务简报 + SA1 设计（`task_issue-140-phase-5-websocket-replication_design.md` R1 版）+ SA2 审查 + SA6 红灯报告（`task_issue-140_sa6_red.md`）+ SA6 锚测试（untracked）
- **验证环境**: worktree `/home/wangjian/nomicore-fix-issue-140`，独立后台进程执行（vitest ×2 + `pnpm typecheck`）

---

## 0. 一句话结论

三个新动词的接线、编排（AD-2 冻结次序 + G5a/G5c 幂等集维护）、稳定码与文档对齐**实现质量高、零既有回归（41/42 绿）**，但 **AC3-① 验收锚在 HEAD 仍是红的**（`replace-schema` 对「schema 演进新增必填字段 + 不带 root」的场景被引擎 keep-root 校验合法拒绝 → 回执 `write-failed`），叠加一处**静默剥离输入的设计偏离**与 **typecheck 红**——Phase 5 收口条件不成立，reject 回流。

## 1. 门禁执行记录（skill 清单逐项）

| 门禁 | 结果 | 说明 |
|---|---|---|
| §1.1 Scope Creep Guard | ✅ pass | actual diff 恰 4 文件（`app.ts`/`lifecycle.ts`/两份 docs），全部在 ALLOW LIST；DENY LIST（`packages/**`、`main.ts`、`config.ts`、`index.ts`、protocol/adr/CONTEXT）零触碰；BLACKLIST 零命中 |
| §1.2 设计偏离 | ❌ **R2** | `replace-schema` 重建 schema 信封对象（静默丢弃额外键），偏离设计 §3.1「原样透传 + 未声明键拒绝单源在 runtime」——见 §2 R2 |
| §1.3 E2E spec 触发性 | n/a | 本任务无 E2E spec；（R4 涉及测试入库问题） |
| §1.4 vitest 触发性 | ⚠️ **R4** | `pnpm test` = `vitest run --typecheck`，include 含 `apps/*/test/**/*.test.ts` → 锚测试入库后必被 CI 触发；但当前锚测试 **untracked**（HEAD 不含）——若发布不收纳 untracked 文件则成 CI 黑洞 |
| §1.5 协议假设 | ❌ **R1**（新发现） | 设计 E1–E14 引用行号逐一复核属实（`hub-namespace.ts:193` idleProbeMs、`:690-706` 终态忽略交付、`peer-connection.ts:216-248` re-add 分支、`peer-namespace.ts:644-705` removeTarget 全分支 resolve、`schema-write.ts` 槽序）；但设计 §3.1 与 SA6 锚**共享了一个未验证假设**：「schema 演进（新增必填字段）+ 不带 root 的 replace 会 ok」——被引擎冻结契约否定（见 R1） |
| §1.6 契约改动连锁 | ✅ pass | 纯加法：dispatch +3 case、3 个新私有 handler、`STABLE_OP_ERROR_CODES` append 8 码、type-only import `ResetReplicaResult`；无既有函数签名/throw/return 契约变化；被调方（`replaceSchema`/`bumpReplicationEpoch`/`resetReplica`/`removeTarget`/`addTarget`）全部核验为「新 caller」非改动方；`ResetReplicaIssue` 失败分支恒携带 `code`（`types.ts:372-399`）→ `reset.code` 透传类型安全 |
| §1.7 源码 grep 断言禁令 | ✅ pass | SA6 锚测试零 `readFileSync(<源码>) + toMatch/toContain` 反模式（`readFileSync` 仅读运行期 lock 产物 `.nomicore-lock.json`）；断言全部消费子进程 stdout NDJSON 回执/事件 |
| §2 读写路径一致性 | ✅ pass | SCHEMA 写经 hub lease 写槽 → session fanout → peer apply（AC3-① 绿灯路径的传播链零分叉）；reset 编排读（registry probe）写（archive）同经 registry seam，app 零 persistence 触达 |
| §3 静默失败扫描 | ✅（新 handler）| 三 handler 每条分支都有回执（ok 或稳定码）；`replica-reset` 事件仅成功分支；G5b catch 回 `reset-replica-failed`。⚠️ R2 的静默剥离属输入静默变形（见 R2） |
| §4 降级方案 | ✅ | `epoch === undefined → 省略字段` 为设计 §4.1 裁定的结构性防御（不虚构数值）；停机窗口伪回执（E14）已诚实登记为已知有限偏差 |
| §5 极端条件攻击 | ✅（app 层）| G2 门禁覆盖：null/数组/标量 root、非 32hex 小写 id、非安全整数/≤0 epoch、空 ownerUserId、错误角色——全部 `invalid-op-args`/`unknown-op`；并发交错（w1/w2/w3）与设计竞态表推演一致（G4→G5a 无 await 窗口，删除幂等合流成立） |
| §6 错误处理链路 | ✅ | 见 §3；`handleControlLine` 外层 catch 兜底既有 |
| §7 架构死胡同 | ✅ 不触发 | AD-1 composition root 归属正确，零 `packages/**` 绕过 |
| §8 过度设计 | ✅ 精简 | +144 行 vs 设计预估 ~125 行，量级一致；无多余抽象 |

## 2. REJECT 清单（本轮全部阻断项，一次性列出）

> 复验纪律：R1–R4 修复回流后，SA4 只复审下述固定范围及其直接影响面（AC3-① 用例 + 锚文件 6/6、extra-key 拒绝、`pnpm typecheck`、锚文件入库），不做范围外重审。

### R1【P0】AC3-① 验收锚在 HEAD 仍红——keep-root 校验否定「schema 演进不带 root」场景

**可复现证据**（三条独立证据链闭合）：

1. **vitest 实测**：`npx vitest run apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts --no-typecheck`
   → `Test Files 1 failed (1) | Tests 1 failed | 5 passed (6)`；失败点 `phase5-three-instance-acceptance-red.test.ts:394` `expect(replaced.ok).toBe(true)` 收到 `false`。AC3-②/③ 已转绿（SA3 实现对两锚有效），唯 AC3-① 不绿。
2. **进程内探针**（复现脚本见附录 A，与 stdin 同一条 `handleControlLine` 链）：
   - `replace-schema` V2（`type ROOT = { count: number; tags: string; note: string; };`，**不带 root**）→ `{"ok":false,"code":"write-failed"}`
   - 同 V2 **带合规 root**（`{count:0,tags:'hub',note:'x'}`）→ `{"ok":true}`
3. **根因源码**：`packages/doc-runtime/src/schema-replace.ts:181-188`——keep-root 分支 `extractYjsSnapshot(derived, doc)` + `validateLogicalSnapshot(derived, ex.snapshot)`：**保留的旧 root 必须通过新 schema 校验**。V2 新增必填字段 `note: string`，旧 root `{count:0, tags:'hub'}` 缺 `note` → 领域 issues → 槽 `{ok:false}` → app 按设计折叠 `write-failed`（`app.ts:634-635`）。这是 ADR 0008 冻结契约（「证明逻辑值与实际载体均已兼容；ROOT 零修改」），**引擎与 app 实现均正确**。

**影响**：Phase 5 收口 AC（AC3「Hub schema propagation … match the accepted contracts」+ 任务级「验收锚全绿」）不可达。设计 §3.1 传播链推演与 SA6 锚的绿灯条件共享同一错误假设（「缺省 = 不修改 ROOT ⟹ 演进场景也 ok」），属 §1.5 协议假设类失误：依据栏只引了传播链源码，没有引 keep-root 校验源码。

**回流目标**：
- **SA6**（锚修正，最小范围）：AC3-① 的 `SCHEMA_V2` 把 `note` 改为可选字段 `note?: string`（vfsl IR 支持 `optional`，`packages/vfsl/src/ir.ts:33-34`、既有用例 `parse-vfsl-containers-markers.test.ts:225`），**或** `replace-schema` 请求体带合规 `root`（含 `note`）。二者均保留断言语义（替换 + 后续 `note` 写传播收敛）。SA6 报告已自我授权：「SA1 设计/SA2 审查可调整（调整同时须修本文件断言）」。
- **SA1**（设计 + 文档补一句）：设计 §3.1「root 参数契约」与 `docs/integration/hub-peer-deployment.md` 动词表 `replace-schema` 行补记：**schema 演进新增必填字段时，keep-root 路径会因旧 root 不满足新 schema 而响亮拒绝（折叠 `write-failed`）——此时必须同时提供合规 root**（诚实边界口径，与既有「ok 仅表示本地写槽完成」同族）。
- **SA3**：无生产代码改动要求（handler 对该场景的折叠回执是设计 AD-3 的正确行为）。

**固定复验范围**：锚文件 6/6 绿（重点 AC3-①）；文档行落地。

### R2【P1】`replace-schema` 静默剥离 schema 信封额外键——偏离设计 §3.1 单源校验分层

**可复现证据**：

1. **实现**（`apps/yjs-server/src/app.ts:627-633`）：input 构造**重建** schema 对象为恰四键 `{lang, version, id, text}`——G2 四键类型检查通过后，调用方传入的**任何额外键被静默丢弃**。
2. **设计契约**（设计 §3.1 伪代码 + 「语义校验分层」节）：`'root' in args ? { schema, root: args.root } : { schema }`——**原样透传**；「键集封闭校验/未声明键拒绝/detached 构造**单源在 runtime SCHEMA 写槽**——app 不重复语义校验」。
3. **引擎真实行为**（额外键本应响亮拒绝）：`packages/vfsl/src/envelope.ts:243-260`（ENV-5 严格封闭：`信封多余键: …（严格封闭：恰含 lang, version, id, text 四键）`）← `compileSchemaEnvelope`（`vfsl/src/index.ts:303-308`）← 写槽 S4 `env.compile(...)`（`schema-write.ts:138`）。**既有绿灯锚**：`packages/vfsl/test/compile-schema-envelope.test.ts:236`「多余键 → ok:false 单条 envelope issue——严于 H1 的多余键容忍」。
4. **动态证据**（探针，附录 A 第 4 步）：`schema` 携带 `extra: 'future-field'`（其余四键合法）→ 回执 `{"ok":true}`——设计契约下应为 `write-failed`。

**影响**：黑盒回执契约漂移（`ok:true` vs `write-failed`）；运维输入错误（拼错键、过期工具链字段、版本字段双写如 `verison`+`version`）被静默吞掉——操作者以为安装了完整信封，实际装的是窄化版；runtime 单源封闭校验对该动词**不可达**（防线失活）。与仓库既定响亮纪律相悖（issue #91 / ADR 0008 已**废止** root 路径的顶层静默剥离契约，`schema-write.ts:79-83` 注文存档）。

**回流目标**：**SA3**——G2 门禁后**原样透传** `schema`（类型收窄后 cast 到 `SchemaEnvelope` 即可，仓库有 `as` 先例 `schema-write.ts:138`；禁止重建对象）。SA1 设计无需改（设计本来就是透传）；文档无需改（现有文档从未承诺剥离）。

**固定复验范围**：extra-key 输入 → `write-failed`（探针复跑或 SA6 加一行断言，须在 R1 锚修正同 PR）；既有四键合法路径回归（AC3-① 修正后即覆盖）。

### R3【P1】`pnpm typecheck` 红——SA6 锚测试类型错误（AC8 门禁）

**可复现证据**：`pnpm typecheck` →
```
apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts(112,5): error TS2322:
Type 'Signals | null' is not assignable to type 'Signals | undefined'.
ELIFECYCLE Command failed with exit code 2
```
（`child.on('exit', (code, signal) => { … proc.signalCode = signal; })`——`@types/node` 的 `signal` 为 `Signals | null`，字段声明为 `Signals | undefined`。生产代码 `tsc -p apps/yjs-server/tsconfig.json` 检出的**唯一**错误即此——SA3 的 `app.ts`/`lifecycle.ts` 类型干净。）

**影响**：AC8（Typecheck … pass before Phase 5 merge）当前不成立；一旦 R4 落实（锚文件入库），CI `pnpm typecheck` 必红。SA6 红灯命令用 `--no-typecheck` 掩蔽了该错误。

**回流目标**：**SA6 或 SA3**（设计 §8 ALLOW LIST 明示「SA3 可修测试基础设施但不准改断言逻辑」）——一行基建修正：`proc.signalCode = signal ?? undefined;`。

**固定复验范围**：`pnpm typecheck` 全绿。

### R4【P2】验收锚测试未随实现 commit 入库（untracked）

**可复现证据**：`git status --short` → `?? apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts`；`git show --stat dbd36d4` 仅含 4 文件。**先例**：上一任务 SA3 commit `469ca36`（#186）包含全部 5 个 SA6 红灯测试文件（`app-config-red` 等 7 个 test 文件入 stat）。

**影响**：若发布流程不自动收纳 untracked 文件，PR 将不含验收锚——CI `pnpm test` 永不运行它（AC8 覆盖黑洞，与 issue #180 spec-孤儿事故同根因）；Phase 5 的黑盒验收证据在仓库中缺席。

**回流目标**：**SA3**——将锚测试文件**原样**（零改动，符合 `[SA6 owned]` 约定；R1/R3 修正由 SA6/基建修正后纳入）随实现 commit 入库。

**固定复验范围**：`git log --diff-filter=A -- <锚测试>` 显示入库；远端 CI `Test` 步骤日志包含该文件（SA7 动态摘录）。

## 3. 审核结论（模板八项）

1. **设计一致性**：⚠️ 偏离——R2（schema 信封重建剥离额外键，违反 §3.1 透传 + 单源校验分层）；R1（设计假设层缺口：keep-root × schema 演进，设计未引该证据）
2. **读写路径一致性**：✅ 一致——SCHEMA 写/传播/reset 归档重引导全链无数据源分叉
3. **静默失败**：❌ 发现——R2（输入静默变形：额外键丢弃后回 `ok:true`）；三 handler 分支回执本身完备
4. **降级方案**：✅ 安全——epoch 投影防御分支、停机窗口伪回执均按设计诚实登记；无新增无必要性降级
5. **极端攻击**：✅ app 层安全（G1/G2 门禁全覆盖）；R1 场景属引擎合法拒绝而非漏洞
6. **错误处理**：✅ 完整（每分支稳定码回执）；⚠️ 诊断粒度：`write-failed` 折叠不透传 issues 为 AD-3 既定取舍，R1 修复后建议文档补 keep-root 语义一句（已列入 R1 回流）
7. **架构评估**：✅ 可行——AD-1/AD-2/AD-3 全部按设计落地；无退回 SA1 信号（R1 仅需设计补证 + 锚修正，非架构推翻）
8. **过度设计**：✅ 精简——变更半径与设计预估一致

**加分项（记录，不需动作）**：G5a/G5c `peerOwners` 维护、竞态 w1/w2/w3 推演、`replica-reset` 事件收敛为单字段、稳定码 8 码与文档逐字一致（顺序亦一致）、AC3-② 断言序依赖的 fence 推演（E1/E9 复核属实）——R1 修订轮的防御性设计全部如实落地。

## 4. 动态审核重点（交 SA7，`task_<slug>_sa7_report.md` 逐条回复）

1. **AC3-① 修复后 6/6 + 传播链端到端**：R1 锚修正（可选 `note` 或带 root）后锚文件全绿；如选可选字段方案，确认 peer 侧 `installActive` 后 `verify-write note`（hub）→ 双 peer 收敛（`waitConverged(['note'])`）。
2. **R2 修复后 extra-key 拒绝的动态确认**：stdin 发送携带额外键的 `replace-schema` → 回执 `write-failed`、SCHEMA 未变（旧 schema 读数不变）。
3. **`replicationEpoch` 回执值正确性**：`bump-epoch` 回执的数值 = bump 后实际 epoch（锚测试只断言 ok）。
4. **file 适配器上的 reset-replica 全周期**：AC3-③ 仅 memory 拓扑；FilePersistence 上 archive 落盘 + 进程重启后 bootstrap 资格（key 缺席）动态确认（AC6 家族交叉）。
5. **停机窗口伪回执（E14）**：reset 进行中发 SIGTERM → 回执 `ok:true` 而重引导不发生——按设计为已知有限偏差，动态观测一次即可，不求修。
6. **fence 检出延迟**：AC3-② 的 30s 窗口在 CI 慢机上的稳定性（idleProbeMs=10s 上界 + 3 倍余量；事件驱动微任务链加速）。
7. **CI 触发证据**：R4 落实后从 `gh run view --log` 摘录锚测试文件出现在 `Test` 步骤的证据。

---

## 附录 A：R1/R2 动态复现脚本（SA4 探针，审后已从 worktree 删除；置于仓库根以 `npx tsx` 运行）

```js
// sa4-probe-replace-schema.mjs —— 进程内直调 handleControlLine（与 stdin 同链）
import { createNomicoreApp } from './apps/yjs-server/src/index.ts';
const events = [];
const config = { role: 'hub', instanceId: 'hub-1', persistence: { kind: 'memory' },
  hub: { listen: { host: '127.0.0.1', port: 0 }, tokens: { 'peer-1': 'token-1' },
    provision: [{ id: 'p1', ownerUserId: 'alice',
      schema: { lang: 'vfsl', version: 1, id: 'notes-v1', text: 'type ROOT = { count: number; tags: string; };\n' },
      root: { count: 0, tags: '' } }],
    authorization: [{ peerInstanceId: 'peer-1', provisionId: 'p1', read: true, submit: true }] } };
const app = createNomicoreApp(config, { emitter: (e) => events.push(e) });
await app.ready;
const nsId = events.find((e) => e.event === 'provisioned').namespaceId;
const send = (line) => app.handleControlLine(JSON.stringify(line));
const V2 = 'type ROOT = { count: number; tags: string; note: string; };\n';
console.log(await send({ op: 'verify-write', id: 'w1', namespaceId: nsId, set: ['tags'], path: ['tags'], value: 'hub', timeoutMs: 15000 }));
// R1：不带 root（keep-root）→ {"ok":false,"code":"write-failed"}
console.log(await send({ op: 'replace-schema', id: 'r1', namespaceId: nsId, schema: { lang: 'vfsl', version: 1, id: 'notes-v2', text: V2 } }));
// R1 对照：带合规 root → {"ok":true}
console.log(await send({ op: 'replace-schema', id: 'r2', namespaceId: nsId, schema: { lang: 'vfsl', version: 1, id: 'notes-v2', text: V2 }, root: { count: 0, tags: 'hub', note: 'x' } }));
// R2：额外键（其余合法）→ 实现 {"ok":true}（静默剥离）；设计契约应为 {"ok":false,"code":"write-failed"}
console.log(await send({ op: 'replace-schema', id: 'r3', namespaceId: nsId, schema: { lang: 'vfsl', version: 1, id: 'notes-v2', text: V2, extra: 'future-field' }, root: { count: 0, tags: 'hub', note: 'x' } }));
await app.stop();
```

## 附录 B：验证命令与结果汇总

| 命令（独立后台进程） | 结果 |
|---|---|
| `npx vitest run apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts --no-typecheck` | `1 failed \| 5 passed (6)`——AC3-① 红（R1） |
| `npx vitest run apps/yjs-server/test/ --no-typecheck` | `1 failed \| 41 passed (42)`，7/8 文件绿——既有 app 测试零回归 |
| `pnpm typecheck` | **失败**（exit 2）——唯一错误在 SA6 锚测试 `:112` TS2322（R3）；SA3 生产代码类型干净 |
| `git diff --name-only 469ca36 HEAD` × ALLOW LIST set 比对 | creep 集合为空；DENY/BLACKLIST 零命中 |
| 探针（附录 A） | R1/R2 回执证据（见各条目） |

---

# SA4 R2 复审（2026-08-30，修复 commit `3863a69`）

- **复审范围（总控指令固定）**：锚 6/6 含 AC3-① / schema extra-key 拒绝 / `pnpm typecheck` / 锚测试 tracked；另按指令做 remediation 回归检查
- **最新 Verdict**: **pass**（R1 的 R1–R4 四项阻断全部闭环；零回归；无 residual reject）

## 1. 修复内容核验（diff 逐项 vs R1 回流要求）

| 阻断项 | 修复落点（`git show 3863a69`） | 判定 |
|---|---|---|
| R1 锚修正 | 锚测试 `SCHEMA_V2.text` 改为 `type ROOT = { count: number; tags: string; note?: string; };`（可选字段演进——keep-root 合法）；**断言逻辑零改动**（与 SA6 原版逐行比对，仅 fixture + 注释 + 基建三处，符合 `[SA6 owned]`「SA3 可修测试基础设施/fixture、不准改断言」边界） | ✅ |
| R1 文档行 | `docs/integration/hub-peer-deployment.md` `replace-schema` 行补记 keep-root 语义：「保留的旧 root 必须通过新 schema 校验——新增**必填**字段而旧 root 缺该字段时响亮拒绝（折叠 `write-failed`），须同时提供合规 `root`；兼容演进（可选字段 `?:`/放宽类型）不带 `root` 即成功」 | ✅ |
| R2 透传 | `app.ts` input 构造改为 `schema as { lang: string; version: number; id: string; text: string }`——**仅类型收窄 cast，零对象重建**（G2 先行保证四键四型，cast 可靠；额外键原样透传至 runtime ENV-5 严格门），注释显式登记「严禁重建对象」 | ✅ |
| R3 类型修 | 锚测试 `:115` `proc.signalCode = signal ?? undefined;`（运行时行为等价性分析：对 `exitCode !== null \|\| signalCode !== undefined` 谓词在正常退出/崩溃退出两态均无差异——纯类型面修复） | ✅ |
| R4 入库 | `git ls-files` 含锚文件；`git log --diff-filter=A` → `3863a69`（与 #186 先例一致随实现 commit） | ✅ |
| Scope 复检 | 修复 commit 触及 3 文件（`app.ts`/锚测试/部署文档）全部在 ALLOW LIST；DENY/BLACKLIST 零触碰 | ✅ |

## 2. 固定复验范围执行结果（串行、独立后台进程）

| 复验项 | 命令 | 结果 |
|---|---|---|
| **锚 6/6（AC3-①）** | `npx vitest run apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts --no-typecheck`（串行，无并发负载） | **`1 passed (1) | 6 passed (6)`**——AC3-① 转绿 ✅ |
| **extra-key 拒绝** | 进程内探针（附录 A 同款，V2opt 场景）：①可选字段演进不带 root → `{"ok":true}`；②5 键信封（合法四键 + `extra`）→ **`{"ok":false,"code":"write-failed"}`**（R1 轮为伪 `ok:true`）；③被拒后干净重提 v3 → `ok:true`（零破坏佐证） | ✅ |
| **typecheck** | `pnpm typecheck` | **exit 0 全绿** ✅ |
| **tracked 锚** | `git ls-files` / `git log --diff-filter=A` | 入库于 `3863a69` ✅ |
| **回归检查** | `npx vitest run apps/yjs-server/test/ --no-typecheck`（串行） | **`8 passed (8) | 42 passed (42)`**——零回归 ✅ |

## 3. 回归定性：并行负载下的 AC6 抖动（非 remediation 回归，已排除）

复审首轮曾将锚测试与全量套件**并行**执行（叠加 5 次探针进程），观测到 AC6（FilePersistence crash recovery）1–2 例失败（`process exited awaiting reply`）与一次探针退出段 SIGABRT（exit 134，发生在全部断言完成之后）。**判定为验证环境负载抖动，非代码回归**，依据：

1. **静态排除**：remediation diff 与 AC6 路径零交集——`app.ts` 仅改 replace-schema 输入构造（AC6 不调用该动词）；锚测试改动仅 SCHEMA_V2 字符串（AC3-① 专用）与 `signal ?? undefined`（对退出检测谓词行为等价，见上表）；文档为散文。
2. **串行复跑双清**：卸载并发后锚 6/6、全量 42/42 两次全绿，串行日志零 warning/EAGAIN/孤儿。
3. R1 轮同款并行双套件（无探针叠加）AC6 亦绿——抖动仅出现在更高负载窗口。

## 4. 遗留观察项（非阻断，交 SA7/流水线）

- **O-A（SA7 动态关注）**：AC6 在多套件并行高负载下出现过「process exited awaiting reply」抖动；CI 单 job 串行环境为权威执行面——SA7 从 `gh run view --log` 确认 CI 上锚 6/6 稳定；若 CI 复现抖动，另开测试基建票（非 #140 固定范围）。
- **O-B（SA1 卫生项）**：untracked 设计工件（`task_issue-140-phase-5-websocket-replication_design.md` §3.1 root 参数契约）未同步补 keep-root 语义句；持久用户面契约（部署指南）已落地，设计文档为流水线工件，不阻断。
- **O-C（记录）**：commit message 声称「design + deployment docs」但实际仅部署文档变更——措辞不准，无契约影响。
- R1 轮「动态审核重点」7 项中第 1/2 项已随本轮闭环；第 3–7 项（`replicationEpoch` 回执值、file 适配器 reset 全周期、E14 停机窗口、fence 时序稳定性、CI 触发证据摘录）仍归 SA7。

---

# SA4 R3 复审（2026-08-30，SA7 F1 修复 commit `f310f18`）

- **复审范围（总控指令固定）**：removeTarget 后的收口结算等待 / opAddTarget 状态感知幂等与恢复 / 文档对齐 / SA7 锚 tracked；确认测试与 typing 证据；检查回归
- **Verdict**: **reject（narrow）**——唯一阻断项 **B1（scope-creep 记账）**：`apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` 入库但 **SA1 设计 §8 ALLOW LIST 未扩展**（本文件为 creep 集合唯一元素）。总控指定的全部技术复验项**通过**（见 §2）；代码/文档/测试本轮已完整审毕，B1 修复后**无需重审技术面**。

## 1. F1 修复的静态审查（两项修复逐项）

### 1.1 Fix 1 — G5b 收口结算等待（`waitPeerTargetSettled`）

**实现**（`app.ts`）：`await removeTarget` 后、`addTarget` 前轮询 `peer.getNamespaceState`（100ms 间隔），接受 `{undefined, closed, conflicted, failed, disconnected}`；预算 = `config.timeouts?.closeTimeoutMs ?? 5000` + 2s 边距；超限 → `reset-replica-failed`（`peerOwners` 保持 G5a 的 deleted）。

**静态判定：✅ 成立**，证据链：

1. **有界性**：`peer-namespace.ts:1369-1380` `onTimerFired('close')`——closing 态在 closeTimeout 到点时 `setState('closed') + settleCloseMemo`；或 CLOSE_OK 早到 → closed；即离开 closing 必有结算点 ≤ closeTimeout。预算（closeTimeout+2s）覆盖。`config.ts:114-122` 确认 `closeTimeoutMs` ∈ TIMEOUT_KEYS（`timeouts?: Partial<ReplicationTimeouts>` 类型合法，config 白名单校验）。
2. **接受态 → 恢复映射全覆盖**：终态（closed/conflicted/failed）→ 引擎 `addTarget` re-add 分支（`peer-connection.ts:228-233`）→ `requestRebuild('re-add')` 整连接重建 ✓；`disconnected` → `addTarget` 合流分支翻转 `intent → 'active'`，连接 ready 后 `openActiveTargets`（`peer-connection.ts:619-627`）对 `disconnected/failed` 态 **`setState('targeted') + startOpen()`** 接管 ✓——G5b 的 addTarget 调用在该路径承重（removeTarget 后 intent='removed'，不翻则 openActiveTargets 跳过）。`undefined`（controller 缺席）→ addTarget 新建 controller ✓。
3. **诚实失败路径**：超限回 `reset-replica-failed`（稳定码已注册），`peerOwners` 保持 deleted → `add-target` 重试可达（且叠加 Fix 2 后即使条目在也放行终态）✓。
4. **设计对齐**：SA1 设计 R3 记录（§3.3 G5b 增补 + E16 + G5 失败三分法 + 竞态表修正）与实现逐条一致；E16 引用行号复核属实（`peer-connection.ts:216-248` 合流分支、`peer-namespace.ts:1369-1380` 兜底结算）。

### 1.2 Fix 2 — opAddTarget 状态感知幂等门

**实现**：短路条件从 `peerOwners.has` 收紧为 `peerOwners.has && state ∉ {closed, conflicted, failed}`；终态放行 → 底层 re-add + `target-added` 事件。

**静态判定：✅ 成立**：

1. **不变量**：`peerOwners ⊆ controllers`（boot 构造器同步为每个 config target 建 controller——`peer-connection.ts:118-120`；`peerOwners.set` 的三处均在 addTarget 之后；controllers map 无 delete 路径）→ 「has 条目 + state undefined」结构性不可达，短路不会漏建 controller。
2. **既有契约不破**：全仓既有测试对 add-target 只断言首加（`stdin-error-chain-red.test.ts:324-331` ok + target-added）——非终态短路语义与旧版一致；终态重复 add 现发 `target-added` + 触发真实重建 = 文档化恢复入口语义（部署文档动词表已改写）。
3. **G1 前置**：`getNamespaceState` 在 role/peer 守卫之后调用，无 undefined 解引用。

## 2. 固定复验范围执行结果（严格串行、独立后台进程）

| 复验项 | 命令 | 结果 |
|---|---|---|
| SA7 锚（F1 红锚转绿） | `npx vitest run apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts --no-typecheck` | **`4 passed (4)`**，exit 0 ✅ |
| 全量回归 | `npx vitest run apps/yjs-server/test/ --no-typecheck` | **`9 passed (9) \| 46 passed (46)`**，exit 0 ✅（含 SA6 锚 6/6） |
| typing | `pnpm typecheck` | **exit 0** ✅ |
| tracked 锚 | `git ls-files` / `git log --diff-filter=A` | 入库于 `f310f18` ✅（CI `pnpm test` include 覆盖） |
| 文档对齐 | diff 逐行比对 | 动词表 add-target 行（状态感知幂等语义）/ reset-replica 行（ok = 归档+收口结算完成+重引导入队；结算超限 → reset-replica-failed）/ 管理动词节冻结次序 ③ 等待步 + F1 收编注记 / 稳定码注记（+收口结算超限）/ 恢复指引（终态不被短路拦截）——**全部与实现一致** ✅ |
| 日志卫生 | verify log grep | 零 Unhandled/EAGAIN/stderr warning；零孤儿进程 ✅ |

## 3. 🔴 阻断项 B1 — SA7 锚测试文件未入设计 ALLOW LIST（scope-creep-detected）

**证据**：

- `git diff --name-only 469ca36 HEAD` × 设计 §8 ALLOW LIST 集合比对 → creep 集合 = **恰一个文件** `apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts`（其余 5 个 diff 文件全在 ALLOW）。
- 设计文档 R3 修订记录（2026-08-30）更新了 §3.3/E16/竞态表/§4.6/§7/§6.1，但 **§8 ALLOW LIST 零改动**；全文 grep `sa7|mgmt-verbs` **零命中**——该文件在 SA1 设计中无任何收纳。
- 文件来源：SA7 R1 动态验证的自建锚（SA7 报告 §2 声明 ownership `[SA7 owned]`），由 SA3 随修复 commit 入库。

**影响**：违反 §1.1 Scope Creep Guard 硬门禁（issue #147/#176/#248/#254 立法）——SA1 的文件半径裁决权被绕过（非有意，是 R3 修订漏项）。不涉及生产代码越界（纯测试文件，内容已过审：黑盒纪律 ✅、零源码 grep ✅、fixture/类型修正沿用已授权模式 ✅）。

**回流目标与修复路径**：**SA1**（唯一）——设计 §8 ALLOW LIST 追加一条（镜像 SA6 锚模式）：

```
- `apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` — `[SA7 owned]` F1 红锚 + SA4 R2 动态审核重点补充验证（4 用例；SA7 R1 产出、随 f310f18 入库）。理由：F1（两轮 reset 循环重引导断裂）的回归锁；SA6 锚 AC3-③ 仅覆盖单轮。SA3/SA6 预期零改动；调整断言须经 SA4/SA7 裁决
```

**明确不采纳**：SA3 回滚该文件（会摧毁 F1 回归锁，违背修复目的）。

**固定复验范围（下一轮）**：仅 §1.1 集合比对（ALLOW LIST 扩展后 creep 集合为空即闭环）。**代码/文档/测试技术面本轮已完整审毕且全过，无需重审。**

## 4. 移交项（非阻断）

- **O-R3-1（SA7 R2 必验）**：Fix 2 的**终态放行分支无任何动态/锚定证据**——F1 锚的 `add-target` 步骤在修复后运行于 live 通道（走短路分支）；全绿套件中无「终态通道 + peerOwners 有条目 → add-target → `target-added` + 重建收敛」用例。SA7 R2 须以探针或增量用例钉住该分支（建议场景：reset ok 后断 hub 使重引导失败 → 通道终态 → hub 恢复 → add-target → 收敛）。
- **O-R3-2（记录）**：settle 等待窗口内并发 `add-target` 且恰在 controller 到达终态后完成 re-add 的交错下，等待可能观察到 `targeted/opening/…` 直至预算超限 → 回执 `reset-replica-failed` 假阴性（实际重引导已在进行、状态终将收敛）——设计竞态表「stdin 并发无全局排序 last-writer-wins」口径内，发生窗口极窄，记录不改。
- **O-R3-3（记录）**：commit message「Design doc R3 record added」——R3 记录确实存在但漏 §8（即 B1）；措辞与事实部分不符。
- R2 轮 O-B（设计工件卫生项）第二次发生并升级为 B1 本体；SA1 修复 B1 时一并核看 §3.1 root 契约句是否已补（R2 O-B 原始项）。

## 5. 验证命令与结果汇总（R3 轮）

| 命令（单后台作业严格串行） | 结果 |
|---|---|
| `npx vitest run apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts --no-typecheck` | `4 passed (4)`，exit 0 |
| `npx vitest run apps/yjs-server/test/ --no-typecheck` | `9 passed (9) \| 46 passed (46)`，exit 0 |
| `pnpm typecheck` | exit 0 |
| `git diff --name-only 469ca36 HEAD` × ALLOW set 比对 | creep = {`phase5-mgmt-verbs-sa7.test.ts`}（B1） |
| 引擎侧复核 | `peer-connection.ts:619-627`（openActiveTargets 接管 disconnected/failed）/ `:216-248`（re-add/合流分支）/ `peer-namespace.ts:1369-1380`（closeTimeout 兜底）——Fix 1/2 静态闭环 |

---

# SA4 R4 窄复审（2026-08-30，SA1 B1 修正——仅文件记账，无代码 commit）

- **复审范围（总控指令固定）**：仅 B1 文件集合记账；修正未引入意外不一致时不重跑技术验证
- **最新 Verdict**: **pass**——B1 闭环

## 1. B1 修正核验

| 检查 | 证据 | 结果 |
|---|---|---|
| §8 ALLOW LIST 显式收纳 | 设计 §8 追加条目：`apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` — `[SA7 owned]`（含理由：SA7 创建的测试文件归 ALLOW 非 DENY、DENY 语义 = 任何 SA 不准动；覆盖面 = §7 F1 收编；所有权规则 = SA3 可修基建不准改断言——镜像 SA6 锚模式） | ✅ |
| §1.1 集合比对复跑 | `git diff --name-only 469ca36 HEAD`（6 文件）× 设计 ALLOW 集合 → **creep 集合为空** | ✅ |
| 修订记录 | 设计修订记录新增 R4 行（2026-08-30，响应 SA4 R3 narrow reject B1）：「纯 scope-accounting 修正……设计正文、架构决策、其余清单条目零变化」 | ✅ |
| 不一致性快检 | HEAD 仍为 `f310f18`（R3 已完整审毕的同一 commit，零代码变动）；worktree 非 wiki 零变更；DENY LIST 零 sa7 引用（无 ALLOW/DENY 矛盾）；其余 5 条 ALLOW 条目与 R3 读到的内容一致 | ✅ 无意外不一致 |

## 2. 结论与移交

- **B1 闭环，本轮零新发现**。verdict 链：R1 reject → R2 pass → R3 reject(narrow B1) → **R4 pass（最新）**。
- 技术面以 R3 节为准（SA7 锚 4/4、全量 46/46、typecheck exit 0、F1 两修复静态闭环、文档对齐、零回归）——本轮按指令未重跑。
- **SA7 R2 动态验证必验清单**（承接）：**O-R3-1**——Fix 2 终态放行分支（终态通道 + peerOwners 有条目 → add-target → `target-added` + 重建收敛；建议场景：reset ok 后断 hub → 通道终态 → hub 恢复 → add-target）；附 R2 轮遗留 O-A（CI 上锚稳定性摘录）与其报告 §5 CI 触发证据补录。
