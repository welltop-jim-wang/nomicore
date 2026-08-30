# SA7 动态验证报告 — issue #134（Phase 5 切片 3/4：expose trusted NamespaceLease ReplicationSession）

- **Date**: 2026-08-28
- **验证对象**: HEAD = 08b49fd（实现 666f9b1 + SA6 R2 测试修复 08b49fd；基线 ebc5419）；branch `fix/issue-134-on-docs-phase-5-websocket-replication`；worktree `/home/wangjian/nomicore-fix-issue-134`
- **输入**: SA4 静态验尸 `wiki/raw/task_namespace-lease-replication-session_sa4_review.md`（pass，§四 动态审核重点 5 项）、设计 R1 `wiki/raw/task_namespace-lease-replication-session_design.md`、任务简报
- **Verdict**: **PASS**（0 实现缺陷；全量/确定性/五项动态重点/敌意面全部实测通过）

---

## Step 0 — SA4 verdict 校对

SA4 报告顶部 Verdict: **pass**（0 MAJOR / 0 MINOR / 6 INFO）→ SA7 进入动态验证（不上发限制解除，仅可独立发现 fail）。

## Step 1 — SA6 红灯（行为锚）全绿

- `registry-phase5-replication-session-red.test.ts`：**20/20 passed**（AC-1..AC-7 + O-5 补锚 a/b）
- `registry-phase5-replication-session-surface.test-d.ts`：**5/5 passed**（类型探针，typecheck 通道）
- `runtime-replication-session.test.ts`：**30/30 passed**（包内锚 T-1..T-8 + 单元面）

---

## 一、全量复跑与 typecheck（与总控基线核对）

| 项 | 命令 | 结果 | 基线 | 日志 |
|---|---|---|---|---|
| 全量测试 | `pnpm test --pool=forks --poolOptions.forks.maxForks=1 --poolOptions.forks.minForks=1 --testTimeout=60000 --hookTimeout=60000` | **exit 0 — Test Files 138 passed (138)；Tests 1679 passed (1679)；Type Errors no errors**（Duration 94.20s） | 138/1679/0 | `.mabf-bg/sa7-full-test.log`（exit `.mabf-bg/sa7-full-test.exit`=0） |
| typecheck | `pnpm typecheck`（10 包 tsc 链） | **exit 0** | 0 | `.mabf-bg/sa7-typecheck.log`（exit=0） |

**结论**：与总控亲验基线逐项一致（138 文件 / 1679 测试 / 0 错误）。

## 二、确定性验证（session 三文件各连跑 3 次）

脚本 `.mabf-bg/sa7-det-run.sh`（9 次串行 vitest，forks 单 worker，同资源约束参数）：

| 文件 | 3 次 exit | 逐字一致 | 计数 |
|---|---|---|---|
| registry-phase5-replication-session-red.test.ts | 0/0/0 | ✅ IDENTICAL（剥离环境耗时数字后 3/3 `cmp` 逐字一致） | 20 passed |
| runtime-replication-session.test.ts | 0/0/0 | ✅ IDENTICAL（原始差异仅 `72ms` vs `67ms` 逐文件耗时行——环境噪声，非行为差异） | 30 passed |
| registry-phase5-replication-session-surface.test-d.ts（--typecheck） | 0/0/0 | ✅ IDENTICAL | 5 passed |

**结论**：零 flaky。日志 `.mabf-bg/sa7-det/`（`*-run{1,2,3}.log/.exit/.norm2`）。

---

## 三、SA4 §四 五项动态审核重点 — 逐项实测数据

### ① close barrier × 真实停机序 — ✅ 通过（探针 A，17/17 PASS）

脚本 `.mabf-bg/sa7-probe-a-close-barrier.ts` → `.mabf-bg/sa7-probe-a.log`：

**core 槽级（受控 notify 门，A1.1–A1.8）**：
- apply 已接纳（notifyDirty 被门挂起）→ 同 tick `close()`：**同步段即时置终态**（`getStatus().state === 'closed'`）；500 轮微任务冲刷后 apply 与 close **均未 settle**（barrier 未翻越）；
- 放行门后 settle 序 = `apply-settled → close-settled`（close barrier 严格排在先接纳的 apply 槽之后）；被排空 apply 是成功提交且写入真实生效（`ROOT.k1 === 11`）；
- close 后到达的 apply 在接纳层 A1 即拒（`REPLICATION_SESSION_CLOSED`，resolved ok:false，不入队）；close 幂等（缓存 promise 引用相等）；`runtime.close()` 后 open → `RUNTIME_WRITE_DISABLED`（lifecycle gate）。

**registry 级真实停机序（真实 FilePersistence，A2.1–A2.8）**：
- 在途 apply（真实 notifyDirty → FilePersistence 调度）+ 同 tick `session.close()`：apply 排空成功（ok:true，live-cell 内存事实 rk1=7）→ 60 轮虚拟调度推进 + 直接快照文件轮询 → **磁盘事实 rk1=7 落盘** → closed session 再 apply 即拒；
- 完整停机序 `session close → 磁盘 flush → lease release → registry shutdown → persistence dispose` 全链路无 unhandled rejection；release 后 open → `NAMESPACE_LEASE_RELEASED`（ok:false）；dispose 后 session `getStatus()` 仍可读（state=closed，`diskCaughtUp` 字面量 false），`encodeStateVector()` 照契约 throw `ReplicationSessionClosedError`。

### ② scratch O(doc) 实测量级 — ✅ 无泄漏、近线性（探针 B）

脚本 `.mabf-bg/sa7-probe-b-scratch.ts` → `.mabf-bg/sa7-probe-b.log`（`NODE_OPTIONS=--expose-gc --max-old-space-size=2048`，GC 后基线）：

| ROOT 规模 | 状态体积 | apply 耗时（30 次连续，全量 update） | GC 后 heap 基线（每 10 次 apply） | scratch 原语独立计时 |
|---|---|---|---|---|
| 5,000 键 | 84 KB | mean **7.8ms**（p50 6.7 / max 21.2） | 13.9 → 14.0 → 14.0 MB（**Δ=0.0MB**） | 全量装载 2.4ms + 投影比对 0.02ms |
| 50,000 键 | 931 KB | mean **102.7ms**（p50 103.4 / max 128.3） | 30.9 → 29.7 → 29.8 MB（**Δ≤1.2MB 且回落**；净增 −1.3MB） | 全量装载 68.9ms + 投影比对 0.03ms |

- **耗时上界**：10× 键 ⇒ ~12× 耗时（近线性；其中探针构造的全量 update 传输占大头，scratch 装载为主导原语）；每次 apply 的 notifyDirty 恰 30 次 = apply 成功数。
- **内存上界**：连续 apply 的 scratch clone 全量可回收——GC 后基线平稳（Δ=0.0MB@5k、Δ≤1.2MB@50k），**无泄漏增长**。
- **对照**：拒绝路径成本同量级（PROTECTED_FIELDS_CHANGED 12.0ms vs 合法 7.8ms@5k；83.4ms vs 102.7ms@50k——scratch 预演照跑）；畸形字节拒绝 8.4/48.4ms（R4 catch 早退）。
- 该量级数据即 ADR 已登记的已知 O(doc) 成本基线，可直接作为切片 6「增量检查」演进的对照输入。

### ③ degraded retry 落盘真实性（真实 adapter 两路）— ✅ 通过（探针 C，16/16 PASS；Memory 路既有覆盖核验）

- **Memory 路（既有覆盖核验，不重跑自证）**：红测 AC-5 首用例 `registry-phase5-replication-session-red.test.ts:944–1013`（= SA6 用例 11）——degraded 期业务写拒 / hub→peer apply 允许（saveDoc 继续登记）/ 内存-磁盘可区分 / 恢复 I/O 后 fresh reader 见 ext=7 落盘合一。本报告 §一/§二 全量与确定性连跑已使该用例 20 次全绿。
- **File 路（本探针补齐，真实 FilePersistence + 真实磁盘字节 + wrapIo 故障面）**：脚本 `.mabf-bg/sa7-probe-c-degraded-file.ts` → `.mabf-bg/sa7-probe-c.log`：
  - C0 writer（hub）创建 + enable + 业务写 → 磁盘快照含复制身份（直接读 snapshot 文件核验）；
  - C1 main（peer，同 rootDir 新实例）从磁盘打开：**复制身份经真实磁盘 round-trip**（同 32-hex id，enabled，epoch 1）；业务写 → 故障 flush → `rootWrite/schemaWrite.enabled=false`（persistence-degraded）；
  - C2 degraded 期：业务写拒（`RUNTIME_WRITE_DISABLED`…persistence-degraded 文案）；**hub→peer session apply 允许（ok:true）**；saveDoc 继续登记（+1）；内存已追上（ext=7）；session `durability: {memoryCaughtUp:true, diskCaughtUp:false}`；**磁盘未追上**（全新 FilePersistence reader：ext=undefined、n 仍为 writer 终值 2——写拒绝即 store 不变的契约面）；
  - C3 恢复 I/O → 60 轮虚拟调度 + 快照轮询：**Persistence retry 保存完整 live doc，磁盘与内存合一（ext=7 且 n=3）**；
  - C4 重启视角：新 FilePersistence 读盘 doc 的 state-vector 与内存 session `encodeStateVector()` **逐字节一致**（19B=19B）。

### ④ observerFailures 长寿命计数行为 — ✅ 通过（探针 D，ALL PASS）

脚本 `.mabf-bg/sa7-probe-d-observer-failures.ts` → `.mabf-bg/sa7-probe-d.log`：

- **长序列 3,002 次事务投递**（含一永久抛错 listener + 双健康 listener + 第二 session channel）：`observerFailures` 终值 **恰 3002**（每投递 +1，无界纯计数；每 100 投递采样单调不减）；健康 listener 全收 3002 次（**扇出不断、无熔断、无退订**）；失败 listener 未被退订（每次投递仍在计数）；第二 session channel 隔离（全收，不受失败 channel 影响）；
- `Runtime status.fatal` 恒 `null`（observer 失败绝不 fatal）；session 恒 open；长序列后 apply 仍可用（ok:true）；
- **每 listener 每投递独立 slice 副本**：listener1 内变异投递对象后 listener2 收到未污染字节（字节不可变纪律 INV-S4 实测）；
- **内存**：2,000 次追加投递后 heap Δ=0.1MB（投递副本可回收——无驻留泄漏）。

### ⑤ Yjs 版本锚定 — ✅ 13.6.32 全项核验通过（探针 E，19/19 PASS）

脚本 `.mabf-bg/sa7-probe-e-yjs-anchor.ts` → `.mabf-bg/sa7-probe-e.log`：

- **版本锚**：实载 `packages/namespace-runtime/node_modules/yjs` = **13.6.32**；pnpm-lock 全部 yjs 解析行 = 13.6.32（6 处一致）；node v24.13.0。
- **origin 回传（INV-S3 谓词的行为前提）**：`Y.applyUpdate(doc, bytes, token)` → update 事件第二参**恒等 token（symbol 引用相等）**；本地 `transact(fn)`（无 origin）与裸 `set` → origin === **null**（一切 Runtime 内部写恒投全部 channel 的依据）；`transact(fn, o2)` → origin === 同一对象。
- **encodeStateAsUpdate diff 语义（encodeDiff 的行为前提）**：共同谱系下 `diff(replica.sv)` 体积 < 全量（74B vs 139B）；应用后 state vector 逐字节收敛；重复应用同 diff 为 no-op（零事件、sv 不变）；空 doc sv（零客户端，1B）⇒ 全量 diff；冗余全量重放零事件零变化（回声抑制语义基础）。
- **行为锚定（可信域契约依据）**：畸形字节 `[0xff,0xfe,...]` → `Y.applyUpdate` **同步 throw**（R4 'invalid' 过滤器前提）；**零长度 sv → Yjs 原生 throw `Unexpected end of array`**（`session.encodeDiff` 对畸形 state vector「照实抛」的实现依据）；全零 8 字节 = 合法空操作（无 throw、零事件、sv 不变——SA4 D2 立法依据的实测复核）；`Uint8Array.slice` 独立缓冲副本（INV-S4）。
- **升级提示**：上述 4 项（origin 回传 / diff 收敛 / 冗余重放 no-op / 零长度 sv throw）即设计 §13 假设的运行时实证版——Yjs 升级时以本探针重跑为回归（脚本已留在 `.mabf-bg/`，可直接复用）。

---

## 四、敌意/边界动态面（设计 R1 A2/T-2 锚点抽样复核）+ 变异抽查 — ✅ 通过（探针 F，22/22 PASS）

脚本 `.mabf-bg/sa7-probe-f-hostile.ts` → `.mabf-bg/sa7-probe-f.log`：

| 面 | 注入 | 实测结果 |
|---|---|---|
| 敌意 Uint8Array 子类 | `class Evil extends Uint8Array`（`slice()/valueOf()/toString()` 全 throw，内容合法） | apply **不同步 throw**，resolved ok:true（INV-S15：`new Uint8Array(update)` 拷贝，敌意 slice 永不被调）；内容真实落 doc |
| Proxy 伪装载荷 | `new Proxy(bytes, { get() { throw } })` | resolved ok:false `REPLICATION_RAW_UPDATE_INVALID`（A2 防御分支）；零写入 |
| 畸形字节 | `[0xff,0xfe,0xfd,0x00,0x01,0xde,0xad,0xbe,0xef]` | resolved ok:false RAW_UPDATE_INVALID；live doc 零触碰（零 update 事件、sv 逐字节不变） |
| 非函数 listener | `42 / null / undefined / 'fn' / {}` | 5/5 订阅时同步 `TypeError`（形状门禁）；敌意 Proxy 函数经形状门禁，运行期 throw 由扇出自捕获计数（不熔断） |
| 敌意 options（lease 层） | `new Proxy({}, { get/ownKeys: throw })`；原始值 `42` | 均经结果联合结算 ok:false `REPLICATION_SESSION_INPUT_INVALID`（绝不冒泡 reject/crash）；敌意探测后正常 open 成功（零残留） |
| 变异抽查①：R1 fatal gate 短路顺序 | notify-dirty 失败注入 → fatal 置位 → 再 apply | fatal 后 apply resolved ok:false（fatal 域 RUNTIME_WRITE_DISABLED 文案）；**handle.getStatus 调用数不增（before=5 after=5——R1 零 doc/handle 访问）**；零写入；fatal 后 open 同拒 |
| 变异抽查②：R2 epoch fence × fanout detach | bump（epoch 1→2）→ 旧 session apply + 本地写 | session 冻结 epoch 恒 1 / currentEpoch 投影 2（fence 可观测）；旧 session apply → `REPLICATION_EPOCH_CONFLICTED` 零写入；终态 conflicted 稳定；**fence 后本地写零投递旧 session listener（同步 detach 生效）**；conflicted 后再 apply → A1 即拒 |

---

## 五、缺陷清单

**实现缺陷：无。**（本验全部探针最终 PASS；未发现任何违反设计 R1 冻结词汇/门序/不变量的行为）

观察项（非缺陷，供后续切片参考）：

1. **O-1（行为锚定，已由设计覆盖）**：`session.encodeDiff(零长度 sv)` 在 yjs 13.6.32 下抛原生 `Unexpected end of array`——设计已声明「可信域契约：照实抛」（replication-session.ts:272–274 注释），探针 E2.6 实证该前提成立。
2. **O-2（成本基线）**：scratch 预演 O(doc) 实测 5k 键 ≈2.4ms / 50k 键 ≈69ms（装载主导，投影比对 <0.05ms 可忽略）——ADR 已登记的已知成本；本报告数据可作为切片 6 增量检查演进的对照基线。
3. **探针自纠记录（非实现问题）**：本轮探针脚本三次预期/构造错误（A2.4 单轮调度推进不足以冲洗净虚拟定时链 → 改 60 轮 + 快照轮询；C2.6 degraded 期磁盘 n 预期写错（正确事实 = 停留在 writer 终值 2）；E2 diff 探针未构造共同谱系）均已修正后重跑通过——修正仅发生在 `.mabf-bg/` 探针脚本内，未触碰任何 `src/` 或 `packages/*/test/` 文件。

## 六、Spec / vitest 触发证据说明

- 本任务设计 R1 **不含任何 `*.spec.ts`（E2E）**——Step 3 spec 触发门不适用。
- vitest 面（Step 4）：本任务新增/修改的 `*.test.ts` 均在 `packages/namespace-registry` 与 `packages/namespace-runtime` 两个 workspace 包，本轮已在本地全量（138 文件/1679 测试）与单文件连跑（9 次）中真实执行并全绿；**CI 触发证据待总控 push 后的 run**（SA7 纪律：不负责 push/建 PR/宣称 CI 已绿）。

## 附：产物与日志清单（全部在 worktree `.mabf-bg/`，gitignored）

| 文件 | 内容 |
|---|---|
| `sa7-full-test.log/.exit` | 全量复跑（138/1679/0，exit 0） |
| `sa7-typecheck.log/.exit` | pnpm typecheck（exit 0） |
| `sa7-det-run.sh` + `sa7-det/`（27 文件） | 确定性 9 连跑日志 + 归一化比对 |
| `sa7-probe-a-close-barrier.ts/.log/.exit` | ①close barrier × 停机序（17 PASS） |
| `sa7-probe-b-scratch.ts/.log/.exit` | ②scratch O(doc) 量级与内存（GC 后 Δ=0.0MB） |
| `sa7-probe-c-degraded-file.ts/.log/.exit` | ③degraded retry File 路全链路（16 PASS） |
| `sa7-probe-d-observer-failures.ts/.log/.exit` | ④observerFailures 长寿命（3002 精确计数） |
| `sa7-probe-e-yjs-anchor.ts/.log/.exit` | ⑤Yjs 13.6.32 行为锚定（19 PASS） |
| `sa7-probe-f-hostile.ts/.log/.exit` | 敌意/边界 + 变异抽查（22 PASS） |
| `node_modules`（symlink） | 探针模块解析用（指向 packages/namespace-runtime/node_modules；`.mabf-bg/` 内，gitignored） |

**verdict: PASS**
