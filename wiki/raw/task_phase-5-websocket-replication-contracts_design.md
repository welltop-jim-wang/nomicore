# Issue #172 — Phase 5 权威契约收敛设计（SA1 design，R3）

> **修订记录**：R2（2026-08-30）逐条闭合 SA2 R1 reject 四焦点（#1 D3b 漏判 CRITICAL / #2 记账口径方向性声明失实 / #3 it.fails 锚集完整性守卫缺失 / #4 D6 边界判定缺口）+ 三个次级项（#5–#7）——逐条回应见 §6。**R3（2026-08-30，极窄修订）**：仅闭合 SA2 R2 唯一阻断 **#8**——D3b 断言③的 oracle 把「wire 字节」当「记账字节」，与既有 §4.3 收口豁免（`connectionFatal` 先 `sender.teardown()` 再把收口 ERROR 直发 `outbound.sendControl`、绕过 sender 额度判据与记账——`hub-connection.ts:397-415`，PR #165 既有行为）矛盾；修正 = 断言③剔除收口 ERROR 帧字节并引用该豁免（§3.2-T6）。顺手处理两条非阻塞备注：#9 D6「定稿」周界裁定（一句）、#10 P2 URL 辅助性标注（一句）。其余设计面零改动。R1 架构经 SA2 两轮独立核验成立。

- **任务类型**：Feature / 文档与公共契约收敛（documentation and public-contract reconciliation）
- **Worktree**：`/home/wangjian/nomicore-fix-issue-172`（branch `fix/issue-172-on-docs-phase-5-websocket-replication`）
- **权威基线**：`docs/protocols/instance-replication-v1.md`（唯一 wire contract）+ `docs/adr/0010`（含 #133/#134/#161 修订节）+ `CONTEXT.md` + `docs/AGENTS.md`（Authority 节）。SA8 conflict-report 门禁提示 1：**向权威文档 + 冻结值对齐，不得以代码现状改写冻结值**。
- **红灯/回归锚**：`packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts`（16 用例：11 红 + 5 绿锁；运行证据见任务简报 SA6 节）+ R2 新增 1 条锚集完整性 meta 守卫（§1-D2-bis，文件共 17 用例）。

---

## §0. 范围总裁决（本票做什么 / 不做什么）

Issue #172 是**契约收敛票**，不是行为修复票。五个 scope 要求映射为四条工作流：

| 工作流 | 内容 | 执行者动作 |
|---|---|---|
| **W-A 公共 API 收敛（G1）** | `controlReserveBytes`(64KiB) → `maxQueuedControlBytes`(8MiB) 字段名/缺省/构造期下界/记账判据接线 | **本票 SA3 改代码**，A1-1/A1-2/A1-3/A1-2b 转绿 |
| **W-B 测试迁移 + 叙事修正** | 冻结字段名迁移波及的既有 fixture（显式小额度 4 组 + 缺省额度依赖 2 组：r2-transport B 侧 / D3b）；4 处恒真断言加固；过时「当前实现」叙事修正 | **本票 SA3 改测试**（fixture 常量与注释；断言谓词保持/加固/按 D4 约束系统重设） |
| **W-C 文档收敛** | phase-5 交付现状节（current contract / known gap / planned fix 三分）；ADR-0010 追加 #172 修订节；去权威化 `wiki/raw` 源引用 | **本票 SA3 改文档**（草案全文见 §3.3） |
| **W-D 延后票红灯保持可执行** | A2/A3-1/A4/A5-1/A5-2/A5-5 共 8 条锚**保持红灯**且 CI 绿；锚集存在性由常驻守卫保证（R2/§1-D2-bis） | **本票 SA3 注册转换 `it.fails`**（断言体零改动）+ 新增锚集完整性 meta 守卫 |

**缺省值漂移的额外波及（D4-bis，R2 扩充）**：缺省额度 64KiB → 8MiB 波及**两个零覆写依赖缺省额度的用例**，二者均不含 `controlReserveBytes` 字面（对字段名 grep 型排查不可见——这正是 R1 漏判 D3b 的原因）：

1. `ws-replication-sa7-r2-transport.test.ts` B 侧（真实 TCP、limits 零覆写）：1280 ACK ≈ 73KiB > 旧缺省 64KiB → 1011；8MiB 下永不耗尽 → 迁移为显式额度采样（§3.2-T12）。
2. `ws-replication-sa7-issue137-dynamic.test.ts:318` **D3b**（`bootLocal` 零 limits 覆写——bootLocal 的 `limits` 为可选参数、D3b 未传，:657-665 实测）：前提 = 「~90KB BOOTSTRAP_SNAPSHOT（blurbBytes 90_000）> 缺省额度 64KiB → 暂停段首个 BOOTSTRAP 帧即耗尽」。8MiB 下 90KB ≪ 8MiB → `settleUntil(…, '首连耗尽收口', 预算)` 预算耗尽 throw → **测试红**。且更深一层：该被测行为在冻结链式下界下**结构性不可达**（§1-D4 推理完备化），场景须合法化重设（§3.2-T6 D3b 方案）。

**明确不做**（不得伪装为当前实现，也不得顺手修掉——它们是 #169/#170/#171 的验收锚）：

- 背压恢复检查点 `max(1, floor(ackTimeoutMs/100))`（现固定 `BACKPRESSURE_POLL_INTERVAL_MS=1_000`，`backpressure.ts:55`）→ **#169**；
- hub 侧 pong 超时 close(1001)（现 `connectionFatal('PONG_TIMEOUT', 1002)`，`hub-connection.ts:261`，且 `PONG_TIMEOUT` 不在 §13.1 注册表——`replication-protocol/src/errors.ts:92-110` 连接注册表 17 码无此码，`encodeError` 未知码 throw → 无 ERROR 帧）→ **#170**；
- CLOSE_OK 错误/多余关联 → `ACK_STATE_VIOLATION`(1002)（现 `peer-namespace.ts:512-520` 不匹配静默忽略）→ **#171**；
- GOAWAY drain 窗口停 OPEN / 不开始新 sync round（`peer-connection.ts:160-161` `addTarget` ready 直通 `startOpen` 未查 `goawayActive`；`peer-namespace.ts:711-718` `maybeStartRecovery` 未查 host 声明的 `isGoawayDraining()`——`peer-namespace.ts:52` 声明、`peer-connection.ts:94` 提供、零消费）→ **#171**；
- `HubReplication.close()` 先发 GOAWAY（现 `hub-connection.ts:96-106` 直接 `connection.close(1001,'hub-shutdown')`，零 GOAWAY 帧）→ **#171**（归属裁决见 §1-D3）；
- 结构化 observability（#163）、apps/yjs-server composition root 与 `DuplexTransport` 三可选面生产装配期断言（#164）——known gap，phase 文档陈述（§3.3）。

---

## §1. 核心裁决（D1–D7）

### D1（收敛面）：本票唯一的生产代码改动 = G1 公共字段收敛

冻结依据：protocol §17「Control frame 使用独立保留额度 `maxQueuedControlBytes`（缺省 8 MiB；必须 ≥ `maxBootstrapBytes` + 协议开销）……耗尽为 `CONNECTION_BACKPRESSURE`（close 1011）」+ §17 校验块 `maxQueuedControlBytes >= maxBootstrapBytes + protocol overhead` + ADR-0010 issue #161 修订节（同一冻结）。SA6 已把 A1-1（字段名/缺省）、A1-2（下界 TypeError）、A1-3（字段驱动记账耗尽）归口为本票收敛锚（任务简报「用途归口」节）。

改动半径刻意收窄为**字段重命名 + 缺省值 + 一条构造期链式校验 + 记账判据换读新字段**：记账机制本身（暂停段累计出站 control 帧实际编码字节、`enterPause`/`resume` 复位）**保留不动**——它已满足 A1-3 的耗尽语义，且机制见 D5 口径裁决。

### D2（延后锚注册机制）：8 条延后锚转 `it.fails`，断言体零改动

问题：本票合入后 anchors 文件仍有 8 条断言为红（A2-1/A2-2/A3-1/A4-1/A4-2/A5-1/A5-2/A5-5），而流水线门禁要求 PR 绿 CI（`pnpm test` 全量）。仓库无 skip/fails 先例（全仓 grep 零命中），裸留红灯 = CI 永红；`it.skip` = 锚失效（#169 落地时无人察觉）。

方案：对且仅对上述 8 条，`it(` → `it.fails(`，各用例标题尾注不变、断言体**逐字节不动**，用例上方注释补一行归口（`→ #169/#170/#171 验收锚：本票以 it.fails 注册，行为修复落地后本用例转绿会使套件反红——届时摘除 .fails 标记`）。

依据（已验证）：仓内安装的 vitest 3.2.7（`package.json` 声明 `^3.2.4`）`@vitest/runner/dist/tasks.d-CkscK4of.d.ts:105-107`：「Whether the task should succeed if it fails. If the task fails, it will be marked as passed.」`fails?: boolean`；`:314` `ChainableFunction<"concurrent" | "sequential" | "only" | "skip" | "todo" | "fails", ...>` 证实 `it.fails` 链式修饰符存在。语义双向：红→记绿（本票 CI 绿）；绿→记红（#169/#170/#171 落地时套件反红，强制摘标——自执行交接）。

已知弱点（登记不隐藏）：`it.fails` 不区分「因正确原因红」与「因错误原因红」（如 boot 期意外 throw 也记绿）。接受：各锚当前失败模式已被 SA6 运行证据钉死（任务简报偏差表逐条列出失败断言文本），#169-#171 的 SA3 以转绿瞬间的反红信号为交接点。

### D2-bis（R2 新增，SA2 #3）：锚集完整性常驻 meta 守卫——堵「锚消失 ≠ 锚期望红」盲区

SA2 攻击成立：`it.fails` 的「绿→记红」只保护**修复落地**方向，不保护**锚存在性**——未来任何 PR 删除一条 it.fails 用例、或重构中改坏断言体，CI 恒绿零信号。本票对 issue 承诺「8 条锚保持可执行红灯」，必须由机制而非注释自觉保证。

方案（选 SA2 选项 (a)，常驻守卫）：anchors 文件末尾新增**一个普通 `it`**（非 it.fails），`readFileSync(new URL('./ws-replication-issue172-contract-anchors.test.ts', import.meta.url))` 读**本文件自身**，断言两件事：

```ts
const DEFERRED_ANCHORS = ['A2-1', 'A2-2', 'A3-1', 'A4-1', 'A4-2', 'A5-1', 'A5-2', 'A5-5'] as const;
it('#172 meta：延后锚集完整性守卫（8 条 it.fails 在场 + 冻结标题锚定）', () => {
  const source = readFileSync(new URL(import.meta.url), 'utf8');
  const failsCount = (source.match(/it\.fails\(/g) ?? []).length;
  expect(failsCount, 'it.fails 用例数 = DEFERRED_ANCHORS 清单长度（删锚/漏改标记都会反红）').toBe(DEFERRED_ANCHORS.length);
  for (const id of DEFERRED_ANCHORS) {
    expect(
      new RegExp(`it\\.fails\\('${id} `).test(source),
      `延后锚 ${id} 必须以 it.fails 注册且标题保留冻结锚号`,
    ).toBe(true);
  }
});
```

- **纪律合规**：「零源码 grep 断言」纪律（SA6 红线）禁的是对**实现源码**（`src/**`）的文本断言；本守卫对象是测试文件自身（锚登记面的自检），不属于该纪律管辖对象。SA6 owned 授权范围：新增该守卫 + `DEFERRED_ANCHORS` 常量 + `node:fs`/`node:url` import，不触碰其余任何断言。
- **随票演进**：#169 摘 A2-1/A2-2 标记时同步把清单缩为 6 项（守卫立即强制同步——漏改即红）；至 #171 摘完缩为空数组（守卫退化为零长断言，可随 #171 删除）。锚号（A2-1 等）是冻结标题的一部分（T3 已规定保留锚号），守卫键据此稳定。
- **反腐烂双保险**：删整条用例 → 计数失配红；把 `it.fails` 改回 `it`（锚静默转正）→ 计数失配红；改标题抹锚号 → 正则失配红。
- SA7 动态红线（SA2 review §4-2 已列）：临时删除任一 it.fails 用例 → 守卫必须红，恢复后绿。

### D3（A5-5 归属裁决）：hub 停机 GOAWAY 属 ws-replication 包行为，修复票 #171，**不**是 #164 composition 边界

依据：protocol §21 停机顺序第 1 步「replication 停止接纳连接/target 并发送 GOAWAY」的主语是 replication（插件），不是宿主；`HubReplication.close()`（`hub-connection.ts:96-106`）持有全部 live connection 与出站控制面，包内即可发送 GOAWAY——不需要 apps/yjs-server。#164 的 composition root 职责是按 §21 顺序**编排**（replication drain → channel/session close → lease release → Registry shutdown → Persistence dispose → Timer/Clock），不拥有 GOAWAY 发送本身。phase-5 文档切片 9 与 §21 交付现状节均按此标注（§3.3），A5-5 锚归 #171 不静默删除。

### D4（fixture 相容性校准）：新下界使既有小额度 fixture 非法——同 limits 显式降低 `maxBootstrapBytes` 恢复合法性

新链式校验对**合并结果**生效（与 validate.ts 既有链式校验同构）。合并缺省 `maxBootstrapBytes = 4 MiB` ⇒ 任何 `maxQueuedControlBytes < 4 MiB + 128` 的旧 fixture 构造即 TypeError。波及 5 组 fixture（经 `createHubReplication`/`createPeerReplication` 走校验）：

| Fixture | 位置 | 现值 | 处置 |
|---|---|---|---|
| A1-3 | anchors:104-115 | `maxQueuedControlBytes: 1_500` | limits 追加一行 `maxBootstrapBytes: 1_024`（1_500 ≥ 1_024+128=1_152 ✓）；K=40 不动（40×~57B≈2,280B > 1_500 ✓） |
| R2-4 独立性 | issue137-r2-red:380-424（字面 :390） | `controlReserveBytes: 64_000` | 改名 + 追加 `maxBootstrapBytes: 1_024`（64_000 ≥ 1_152 ✓）；语义（~3,000B ≪ 64_000 不耗尽）不变 |
| R2-4 生效 | 同文件 :425-470（字面 :437） | `controlReserveBytes: 1_500` | 改名 + 追加 `maxBootstrapBytes: 1_024`；算术 `Math.floor(1_500/ackBytes)`（:455）与字面 1_500 保持互指，断言不动 |
| D3a/D3c | sa7-issue137-dynamic:251-/:359-（字面 :264/:372） | `1` / `100` | 两值在冻结下界下**结构性非法**（任何 `maxBootstrapBytes ≥ 1` ⇒ 最小合法额度 ≥ 129；「暂停段首个控制帧即耗尽」要求额度 < 单帧 ~57B 恒不可满足）。按 §3.2-T6 重设场景 |
| **D3b（R2 补入，SA2 #1）** | sa7-issue137-dynamic:318-352（**零字面——bootLocal 未传 limits，纯缺省配方**） | 缺省额度 64KiB | 前提「~90KB BOOTSTRAP 帧 > 缺省额度首帧即耗尽」双重失效：① 8MiB 缺省下永不耗尽（settleUntil 预算 throw → 红）；② **结构性不可达**（下段推理）。按 §3.2-T6 D3b 方案合法化重设 |

**结构性不可达推理的完备化（R2，SA2 #1 同一把刀的另一半）**：R1 对 D3a 裁决了「额度 < 单控制帧」的结构性非法，却未把同一推理应用到 D3b 的「单个 BOOTSTRAP 帧耗尽额度」——后者同样不可达：bootstrap 帧合法上场必须通过 payload 大小检查（`frame-io.ts:75-85` `snapshot.byteLength > maxBootstrapBytes → BOOTSTRAP_TOO_LARGE`；hub 侧同款 `hub-namespace.ts:403`），而合法配置恒有 `maxQueuedControlBytes ≥ maxBootstrapBytes + 128 > snapshot + 128 > 帧字节（= snapshot + envelope ~60B）`——**任何合法配置下单个 BOOTSTRAP 帧不可能越过额度**。这恰是冻结链式下界的存在动机（control 保留额度必须恒容纳一次 bootstrap），D3b 重设后反向成为该下界的**正面证明用例**（见 §3.2-T6：wire0 上 BOOTSTRAP 恰 1 帧 = 下界动机的行为印证）。

`maxBootstrapBytes: 1_024` 的可行性证据（设计期实测，2026-08-30，worktree 内 node + 仓内 yjs）：以 fixture 同构文档（SCHEMA 文本 `'type ROOT = { n: number; blurb: string; };\n'` + META{docId/createdAt/replicationId/epoch} + ROOT{n:1,blurb:'seed'}）实测 `Y.encodeStateAsUpdate` = **345 bytes** ⇒ 1_024 ≈ 3× 裕量。命令与输出：

```text
$ node -e "…Y.Doc + SCHEMA/META/ROOT 同构装载…; console.log(Y.encodeStateAsUpdate(doc).byteLength)"
snapshot bytes = 345
```

**校准回退规则**（SA3 实测兜底，R2 扩充覆盖 D3b）：若真实 fixture 快照 > 所选 `maxBootstrapBytes`（BOOTSTRAP_TOO_LARGE 显影），按约束系统升档——`maxBootstrapBytes = 2_048`（或 ≥ 实测快照的最小 2 幂；**D3b 单列**：其快照 ≈ 90_500B（90_000 字面 blurb + ~500B schema/META/ROOT），取 `maxBootstrapBytes: 92_000` ≈ 1.6KB 裕量，实测不符则按 ≥ 实测快照 + ≥1KB 裕量升档）⇒ `maxQueuedControlBytes ≥ maxBootstrapBytes + 128 + 余量`（A1-3/R2-4 生效/D3c 至少 +400 触发余量；D3b 按 §3.2-T6 的 `C_live` 自校准派生）⇒ `K = ceil((maxQueuedControlBytes + 300) / ackBytes)`（R2-4 生效的 `ackBytes*K < 64_000` 上界守卫随之核对）；算术一律改为从具名常量派生（`const RESERVE = 1_500` 式），禁止裸字面重译。A1-3 属 SA6 owned 文件：**只许追加 `maxBootstrapBytes` 一行 + 注释 + D2-bis meta 守卫，断言与 K 不动**（K=40 在 1_024 档位下满足 40×57=2,280>1_500；若升档至 2_048 档则 K 不足——该情形下向总控上报而非改 SA6 断言）。

不受波及（核对过，R2 复核扩充）：类级直构 `ConnectionSender` 的 fixture 不走 `validateLimits`——`sa7-round2-dynamic` D4_LIMITS(:698) 与 `r1-r7` QUEUE_LIMITS(:468) 仅**改名**即可，但必须改名（否则 `host.limits.maxQueuedControlBytes === undefined` ⇒ typecheck TS2352 先拦；即便绕过类型检查，NaN 比较使永不耗尽 ⇒ R2-A2a 的 `exhausted` 锚反红——双层自守卫）。`R1_LIMITS`/`R13_LIMITS`/`driver.boot` 缺省额度（8 MiB ≥ 4 MiB+128）天然合法。**零覆写依赖缺省额度的用例全仓恰两处**（r2-transport B 侧、D3b——审计清单见 §8-P10）；`ac3-bootstrap.test.ts:80` 的 `maxBootstrapBytes: 64` 与新下界兼容（该用例未覆写额度，缺省 8MiB ≥ 64+128 ✓，且其断言的 BOOTSTRAP_TOO_LARGE 只依赖 maxBootstrapBytes 自身）；`g3-g4` A2 锚依赖**不耗尽**（~1.2KB ≪ 64KiB ≪ 8MiB 双向成立）。

**D4-bis（缺省值漂移波及，处置详见 §0 同名节）**：`ws-replication-sa7-r2-transport.test.ts` B 侧（真实 TCP、limits 零覆写）：A 侧 128 ACK ≈ 7.3KiB 存活；B 侧 1280 ACK ≈ 73KiB > 64KiB → 恰 1 ERROR + 1011。缺省改 8MiB 后 B 侧永不耗尽（单连接暂停段 control 上界 = Σ_ns min(窗口 32)——要到 8MiB 需 ~4,600 ns，结构性不可达）。处置（T12）：两侧构造改为显式 `limits: { maxBootstrapBytes: 1_024, maxQueuedControlBytes: 64_000 }`（hub+peer 两侧同传——两构造器都走新校验；fixture 快照同 issue137 形态 ≈345B ≤ 1_024），A/B 字节算术不变（7.3KiB < 64_000 存活 / 73KiB > 64_000 越界）；头注释「缺省零漂移抽样」前提改述为「显式额度边界抽样（#172 后缺省 8 MiB，真实链路单连接控制流量结构性不可达——缺省侧采样改为显式 64_000 额度上的边界采样，真实 bufferedAmount 驱动暂停段的采样价值不变）」。

### D5（记账口径声明，R2 改述——SA2 #2）：暂停段出站 control 实编码字节累计 = 「socket 缓冲内未冲刷控制字节」的**近似**口径；净方向不定，不声称恒保守上界

Protocol §17「额度按 socket 缓冲内未冲刷控制字节计」——WS transport 无逐帧冲刷可观察面（`bufferedAmount` 只有聚合值），当前实现（`backpressure.ts:63-64/117-121` 暂停段出站 control 帧实际编码字节累计；`enterPause`/`resume` 复位 :186/:193 表征「暂停窗口 = 缓冲拥塞窗口、恢复 = 缓冲排空」）是唯一可确定实现的代理口径。R1 曾声称其为「保守上界 ⇒ 偏向提前 1011 = fail-safe」——**该方向性声明不严格成立，R2 撤回并如实登记**：

设暂停窗口内真实未冲刷控制字节 = `C_pre + C_pause − F`（`C_pre` = 暂停开始前已发出、仍滞留缓冲的控制字节；`C_pause` = 暂停段内出站控制字节；`F` = 暂停段内已冲刷控制字节）。代理量 = `C_pause`，与真实量之差 = `F − C_pre`：

- **段内偏高项**：代理不扣减 `F`（已冲刷字节仍被计入）→ 偏向提前 1011；
- **段边界偏低项**：`enterPause` 复位 `controlReserveUsed = 0`（`backpressure.ts:186`）**丢弃 `C_pre`**——暂停前滞留缓冲的控制字节不再计额；深拥塞下 FIFO 冲刷先排空队头（多为 data），`C_pre` 可长期未冲刷。当 `C_pre > F`（深拥塞典型）时代理**欠计** → 1011 可**晚于**契约口径触发。

**净方向取决于冲刷进度（C_pre 与 F 的相对大小），既非恒偏高亦非恒偏低**——本票所有文档（C1/C2/代码注释）一律采用此准确表述，禁止「保守上界/fail-safe/偏向提前」残留（SA7 轮次 grep `保守上界` 于 docs/ 与 src/ 应只剩本节改述后的措辞）。机制本身不改（代理是 WS API 约束下的合理实现；协议未规定观察机制，新造逐帧冲刷观察面属过度工程），限制（C_pre 复位丢失）在 ADR #172 修订节显式登记。

### D6（去权威化范围，R2 扩充——SA2 #4）：src 9 个文件 + 测试头 14 处（11「契约来源」式 + 3「设计基准/以…为准」式）；其余 wiki 引用不动

判定标准（对齐 docs/AGENTS.md Authority 节与验收标准「`wiki/raw` is historical evidence only, not an authoritative contract in source/specification」）。**权威性措辞判定关键词（R2 扩为五类）**：①「冻结契约」②「权威设计」③「契约来源」④「设计基准 / 基准」⑤「以…为准 / 定稿」——凡以上述措辞把 wiki/raw 指为规则/契约的**依据来源**者必改，不论其出现在 src、测试头还是**测试 helper**（helper 是被多测试消费的门禁规则载体，属 specification 灰区，按 AC 措辞从严处理）；以「任务简报/评审报告/根因报告/（历史）设计记录」**叙事身份**引用者不动。**class-⑤「定稿」周界裁定（R3，SA2 R2 #9）**：「定稿」仅当构成「以…为准」式权威指向时属权威性措辞；「X 定稿（revN 设计 §Y）」式**出处叙述**（记录措辞在哪轮定稿——无 wiki/raw 路径、无 defer 语义）归叙事身份不动——src 中 9 个含「定稿」文件（tx-guard / install-verify / detached-build / create-initial-document / registry / pattern / validate / materialize / replication-session；后两者已因其他措辞在 §3.4 清单）已逐类核验为出处叙述，**不扩改写清单、不加门禁**。

- **必改**：
  - src 9 个文件（ws-replication 3：types/index/defaults——其中 types 为直接 wiki/raw 路径引用、index/defaults 为「§2 冻结契约面」隐式指涉；namespace-runtime 1；doc-runtime 5）；
  - 测试头 11 处（措辞为「契约来源：wiki/raw/…（冻结…）」）；
  - **测试 helper / test-d 3 处（R2 补入，SA2 #4 实测存在）**：`packages/namespace-registry/test/helpers/registry-seam-audit.ts:15` 与 `packages/namespace-runtime/test/helpers/registry-seam-audit.ts:7`（「**设计基准**：wiki/raw/task_namespace-runtime-registry-seam-rev1_design.md（R1）§D-A–§D-D」——这两个 helper 正是生产白名单收窄门禁的规则来源，「设计基准」措辞 = 把 wiki 设计当规范依据）；`packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts:281`（「未尽事项**以** wiki/raw/task_vfsl-protocol.md 的 SA6 红灯测试记录**为准**」——「以…为准」= 权威指向）。
- **不动**：以「任务简报/评审/根因」叙事身份引用 wiki/raw 的其余 ~35 处测试头 = 历史证据引用，docs/AGENTS.md 明文允许（改它们 = issue #176 式 scope creep）。

改写模式：`契约来源：wiki/raw/X（冻结，…）` / `设计基准：wiki/raw/X（R1）§…` / `未尽事项以 wiki/raw/X 为准` → `规范权威：ADR-YYYY / docs/protocols/… §N；设计记录（历史证据，非规范）：wiki/raw/X`。逐文件权威指向见 §3.4（R2 表补 #21-#23 三行）。

### D7（不动面）：protocol 文档与 CONTEXT.md 零改动

- `docs/protocols/instance-replication-v1.md`：全量对照 §17/§18/§6.3/§21/§10.2/§13.1 与 ADR-0010 #161 修订节——冻结值逐项一致（8 MiB/下界/checkpoint 公式/30s-10s/pong 1001/ACK_STATE_VIOLATION 1002/GOAWAY 语义），无矛盾。协议文档是**目标契约**权威，不承载交付状态；交付状态归 phase 文档（§3.3 状态表即消除「repository guidance 矛盾」的机制——矛盾不是文档互相打架，而是「文档目标 vs 代码现状」的 gap 未被显式登记）。
- `CONTEXT.md`：本票不引入/不改域词汇（`maxQueuedControlBytes` 是插件配置字段，非 domain term）。
- `packages/replication-protocol/**`：错误注册表不动。`PONG_TIMEOUT` 是否入 §13.1 注册表、hub 侧 pong 超时是否发 ERROR 帧——属 #170 的设计决定，本票不预写（A3-1 只锚 close code 1001）。

---

## §2. 需求推演（五组偏差的代码根因定位）

| 组 | 冻结契约（权威） | 代码根因（行级） | 本票处置 |
|---|---|---|---|
| G1 字段名/缺省/下界/记账 | §17：`maxQueuedControlBytes` 8MiB、≥ maxBootstrapBytes+开销、耗尽 1011 | `types.ts:29` 字段名 `controlReserveBytes`；`defaults.ts:27` 64KiB；`validate.ts:118` 仅正整数校验无链式下界；`backpressure.ts:81` 判据读旧字段；SA6 经 `as unknown as Partial<…>` 注入新名被 `resolveLimits` spread（`defaults.ts:52-54`）静默丢弃 ⇒ A1-3 红 | **W-A 收敛**（§3.1） |
| G2 恢复检查点 | §17：`max(1, floor(ackTimeoutMs/100))` | `backpressure.ts:55` 冻结常量 `BACKPRESSURE_POLL_INTERVAL_MS = 1_000`，`armPoll`(:198-210) 固定使用；`ResolvedTimeouts` 已含 `ackTimeoutMs` 却未参与 | 登记 gap → #169；A2-1/A2-2 `it.fails` |
| G3 hub pong 语义 | §18：pong 超时=临时失败 close(1001)+backoff | `hub-connection.ts:261` `onPongTimeout: () => this.connectionFatal('PONG_TIMEOUT', 1002)`；peer 侧已正确（`peer-connection.ts:308-311` close(1001)+onTemporaryFailure——A3-2/A3-3 绿锁印证） | 登记 gap → #170；A3-1 `it.fails` |
| G4 CLOSE_OK 关联 | §10.2/§13.1：错误/多余 ACK 关联 = connection fatal `ACK_STATE_VIOLATION`(1002) | `peer-namespace.ts:512-520` `onCloseOk` 仅在 `state==='closing' && ackedSequence===closeSequence` 时收口，否则**静默 return**（UPDATE_ACK 路径有对偶实现 `channel.onAck` 返回 `'violation'` → `connectionFatal`，:482-492——CLOSE_OK 漏接同构处理） | 登记 gap → #171；A4-1/A4-2 `it.fails` |
| G5 GOAWAY quiesce/deadline | §6.3：drain 窗口停 OPEN、不开新 round；§21 停机第 1 步先发 GOAWAY | 收侧已对（`peer-connection.ts:398-412` deadline close(1001)；SHUTTING_DOWN/REAUTH → blocked——A5-3/A5-4 绿锁）；静默窗口两漏（D3 前述三行）+ hub close 零 GOAWAY | 登记 gap → #171；A5-1/A5-2/A5-5 `it.fails` |

---

## §3. 实现设计

### §3.1 W-A：公共 API 收敛（4 个 src 文件 + index 头注释）

**`packages/ws-replication/src/types.ts`**

1. L29 字段改名 + 注释对齐冻结文本：
```ts
readonly maxQueuedControlBytes: number; // §17 冻结：control 帧独立保留额度（缺省 8 MiB；构造期校验 ≥ maxBootstrapBytes + 协议开销）；耗尽 = CONNECTION_BACKPRESSURE(1011)
```
2. L2-5 文件头去权威化（§3.4 模式）：
```ts
/**
 * `@nomicore/ws-replication` 公共契约类型（规范权威：docs/protocols/instance-replication-v1.md
 * §17/§18 + ADR-0010 issue #161 修订节；历史设计记录（非规范）：wiki/raw/task_phase5-ws-namespace-sync_design.md）。
 * …
 */
```

**`packages/ws-replication/src/defaults.ts`**

1. L27：`controlReserveBytes: 64 * 1024,` → `maxQueuedControlBytes: 8 * 1024 * 1024, // §17 冻结缺省 8 MiB（≥ maxBootstrapBytes 4 MiB + 协议开销）`
2. L2/L15 头注释「设计：§2（值）/§15.2」的 wiki 设计 § 指向改为 protocol §17/§18（§3.4 模式）；「与 harness CONTRACT_LIMITS 逐值一致」保留（harness 镜像同步迁移，§3.2）。

**`packages/ws-replication/src/validate.ts`**（伪代码——追加在 `validateLimits` 既有链式校验之后，复用 L14 `PROTOCOL_OVERHEAD_BYTES = 128`）

```ts
// L118：改名
positiveSafeInteger(limits.maxQueuedControlBytes, 'maxQueuedControlBytes');
// validateLimits 尾部追加（消息风格与既有链式校验一致：含具体数值）：
assertCollKind(
  limits.maxQueuedControlBytes >= limits.maxBootstrapBytes + PROTOCOL_OVERHEAD_BYTES,
  'limits',
  `maxQueuedControlBytes(${limits.maxQueuedControlBytes}) 必须 ≥ maxBootstrapBytes(${limits.maxBootstrapBytes}) + ${PROTOCOL_OVERHEAD_BYTES}`,
);
```

校验时点：`createHubReplication`（`hub-connection.ts:59-64`）与 `createPeerReplication`（`peer-connection.ts:69-76`）构造期、`resolveLimits` 合并之后、`validateLimits` 内同步 TypeError——与 §17「配置启动时响亮验证……不得运行时 clamp」一致，与既有 `pongTimeoutMs < pingIntervalMs`（A3-2 绿锁）同款机制。

**`packages/ws-replication/src/backpressure.ts`**

1. L81 判据：`this.host.limits.controlReserveBytes` → `this.host.limits.maxQueuedControlBytes`（唯一记账判据点，`sendControl` 暂停段额度检查）。
2. L74-76 注释更新为 §17 冻结措辞 + D5 近似口径声明（R2 措辞）：
```ts
/** control 发送点（§4.1/§4.3）：水位观察 + 保留额度判据 + emit（控制帧不被闸门阻塞）。
 *  R2-4/#172：额度判据用冻结字段 `maxQueuedControlBytes`（protocol §17，缺省 8 MiB，
 *  构造期校验 ≥ maxBootstrapBytes + 协议开销）。「按 socket 缓冲内未冲刷控制字节计」
 *  的实现口径 = 暂停段出站 control 帧实际编码字节累计（onEmitted 单点回报）、
 *  enterPause/resume 复位——WS 无逐帧冲刷可观察面，此为近似口径：段内不扣减已冲刷
 *  字节（偏高）、段边界复位丢弃暂停前未冲刷残留 C_pre（偏低），净方向取决于冲刷
 *  进度（ADR-0010 #172 修订节登记）。lowWater 仅保留 §17 恢复 dequeue 的水位迟滞
 *  语义（observeWater/poll），与额度无关。 */
```
3. L54-55 `BACKPRESSURE_POLL_INTERVAL_MS` **保留不动**（含注释）——它是 #169 的改造对象；本票在注释尾追加一行登记：`// #172 登记：冻结检查点 = max(1, floor(ackTimeoutMs/100))（§17）；当前固定 1_000 为已知偏差 → #169（A2-1/A2-2 it.fails 锚）。`（不改行为，只把偏差在代码现场显影——「不发明未实现行为」的反向面：不掩盖已登记偏差。）

**`packages/ws-replication/src/index.ts`**：仅 L2 头注释 `（SA6 冻结契约面，§2；值 + 类型，零逻辑）` → `（公共契约面：值 + 类型，零逻辑；规范权威 protocol §17/§18 + ADR-0010 #161/#172 修订节）`。导出集零变化。

### §3.2 W-B：测试迁移与叙事修正（逐文件逐行）

**T1 `test/harness.ts`**
- L53 `WsReplicationLimits.controlReserveBytes` → `maxQueuedControlBytes`（注释 → `// §17 冻结：control 帧独立保留额度（缺省 8 MiB）`）；L138 `CONTRACT_LIMITS.controlReserveBytes: 64 * 1024` → `maxQueuedControlBytes: 8 * 1024 * 1024`（镜像与 `DEFAULT_REPLICATION_LIMITS` 逐值一致——`defaults.ts:15` 注释的对照承诺继续成立）。
- L21-24 头「契约面（SA6 冻结，见任务简报）」→「契约面（规范权威：protocol §17/§18 + ADR-0010 #161 修订节；本镜像与包 DEFAULT_* 逐值一致）」。

**T2 `test/ws-replication-api.test-d.ts`**：L135 `readonly controlReserveBytes: number;` → `readonly maxQueuedControlBytes: number; // §17：control 帧独立保留额度（缺省 8 MiB）`（类型形状断言整体不变——`toMatchTypeOf` 逐字段对照，改名后即锁死新面）。

**T3 `test/ws-replication-issue172-contract-anchors.test.ts`** `[SA6 owned]`
- A1-3（L104-115）limits 字面追加一行 `maxBootstrapBytes: 1_024,`（D4 校准；旁注 `// #172：新链式下界（§17）要求 maxQueuedControlBytes(1_500) ≥ maxBootstrapBytes+128 ⇒ 同 limits 降 maxBootstrapBytes（实测 fixture 快照 345B，1_024 ≈ 3× 裕量）`）。**断言、K、注释中冻结语义表述零改动**。
- 8 条延后锚 `it(` → `it.fails(`（A2-1 L173 / A2-2 L182 / A3-1 L300 / A4-1 L367 / A4-2 L399 / A5-1 L427 / A5-2 L441 / A5-5 L511），各用例前注释补归口行（D2 措辞）。
- **锚集完整性 meta 守卫（R2 新增，D2-bis）**：文件末尾按 §1-D2-bis 代码草案新增一个普通 `it` + `DEFERRED_ANCHORS` 冻结清单常量 + `node:fs`/`node:url`（或直接 `import.meta.url`）import；断言 it.fails 计数 = 清单长度、每锚号以 `it.fails('<id> ` 形式在场。**实现注意事项**：守卫自身源码里的正则字面量（`/it\.fails\(/g` 与 `it\\.fails\\('`）因反斜杠转义不会自匹配，但守卫的 message/注释中**不得出现裸文本 `it.fails(`**（会被计数吞掉）——message 措辞用「it.fails 用例数」无括号形式（草案已合规）。
- 文件头 G1 分组注释（L13-16）与 A1-1/A1-2/A1-3 标题中「现为 controlReserveBytes=64KiB / 现无该校验 / 现字段被忽略」等**现状偏差描述**在收敛后过时——头注释改为「G1 已于 #172 收敛（A1-1..A1-3 现绿）」；三条 it 标题去掉「RED：…（现为…）」的现状括注、保留锚号与冻结语义。其余分组注释不动（G2-G5 偏差仍真实）。

**T4 `test/ws-replication-issue137-r2-red.test.ts`**
- L25 头字段清单：`controlReserveBytes —— 暂停段 control 帧独立保留额度（字节）` → `maxQueuedControlBytes —— 暂停段 control 帧独立保留额度（§17 冻结名；缺省 8 MiB）`。
- R2-4 独立性（L383-390）：`controlReserveBytes: 64_000,` → `maxQueuedControlBytes: 64_000,` + 追加 `maxBootstrapBytes: 1_024, // #172 下界相容：64_000 ≥ 1_024+128（快照实测 345B）`；L389 附近「SA6 冻结新契约字段」注释更新为冻结字段名。
- R2-4 生效（L434-438）：`controlReserveBytes: 1_500,` → `maxQueuedControlBytes: 1_500,` + 同上追加 `maxBootstrapBytes: 1_024,`；L455 `Math.floor(1_500 / ackBytes2)` 与断言 ①②③ 全部不动（1_500 语义原样，`allowed=26` 算术不变）。

**T5 `test/ws-replication-issue137-ac1-ac7-red.test.ts`**（叙事修正，断言零改动）
- L114-116：`// ★ 红灯锚（核心）：压力高于高水位 → 连接 dequeue 暂停 → 零 UPDATE 帧 / 当前实现：完全无视 bufferedAmount → 6 帧立即发出 → 本断言红` → `// ★ 回归锁（#137 已交付）：压力高于高水位 → 连接 dequeue 暂停 → 零 UPDATE 帧（bufferedAmount 水位闸门已接入——issue #161 R2/PR #165）`。
- 文件头 L17-30「本文件锚定的 #137 新域红灯（当前实现全部实测红）：AC-2…当前每笔未发送增量一帧；AC-4+AC-6a…当前无视压力立即发送；AC-5…当前该限额字段运行时从未被读取」——同款过时叙事逐条改为「已交付（现为回归锁）」表述；头注释「#136 设计 §4.4」按 D6 模式补 protocol §17 权威指向。

**T6 `test/ws-replication-sa7-issue137-dynamic.test.ts`**（D3a/D3b/D3c 场景合法化重构——断言谓词保持或按 D4 约束系统重设）
- 头注释 L20-31 逐分支改述：a 行「`controlReserveBytes=1` 极端」→「`maxQueuedControlBytes = maxBootstrapBytes+128` 边界最小合法额度」；**b 行（L27-29「缺省 64KiB 配方（大控制帧路径）：暂停段首个 >64KiB BOOTSTRAP_SNAPSHOT 首帧即触发…」）必须整行重写**（R2，SA2 #1-c：该叙事描述的结构性非法场景——见 §1-D4 推理）→「b 边界最小合法额度的大控制帧占用路径：BOOTSTRAP 大帧（≤ maxBootstrapBytes）恒可入额度（§17 链式下界的动机印证），额度被 bootstrap 占用后由暂停段后续 control 帧（UPDATE_ACK）触发耗尽」；c 行字段名同步。
- **D3a**（L251-）：场景重设——limits：`{ lowWater: 1, highWater: 2, maxInFlightUpdates: 1, maxQueuedUpdateCount: 100, maxQueuedUpdateBytes: 1_048_576, maxBootstrapBytes: 1_024, maxQueuedControlBytes: 1_152 }`（1_152 = 1_024+128：下界 `>=` **等值通过**——本用例兼任「运行时边界镜像」：构造不抛 + 耗尽语义在最小合法额度下成立）。流程：置压（3 > highWater）→ `allowed = floor(1_152/ackBytes)`（实测 ACK 帧长，等长推理同 D3c）笔写逐笔 `await settle()` → 断言：恰 1 个 connection ERROR（`CONNECTION_BACKPRESSURE`、无 namespaceId）、暂停段 ACK 恰 `allowed` 帧（触发帧不上 wire）、`close(1011)`、`backoff`（非 blocked）、撤压重连恢复 live。原用例「首个控制帧即耗尽」叙事删除（结构性非法，见 D4），恢复段断言全保留。
- **D3b（R2 重设，SA2 #1）**：保留原用例的独有价值（大控制帧占用额度的路径 + 真实 BOOTSTRAP 帧 + 撤压重连后 bootstrap 流转），重设为合法配置：
  - **limits**（经 bootLocal 新传 `limits` 参数——bootLocal 已支持）：`{ maxBootstrapBytes: 92_000, maxQueuedControlBytes: 92_128 }`（92_128 = 92_000+128：与 D3a 同款边界等值构造，大尺度镜像；快照 ≈ 90_500B（90_000 字面 blurb + ~500B）≤ 92_000，裕量 ≈ 1.5KB，实测不符按 D4 回退规则升档）。
  - **流程**（`initialHubPressure: HIGH_WATER*2`、`blurbBytes: 90_000`、`waitForLive: false` 全保留）：首连暂停段内 HELLO_ACK/OPEN_OK/BOOTSTRAP/reconcile 帧（全为 hub→peer control）逐帧过额度检查——累计 `C_live`（至 live 的全部 hub→peer 帧字节和，测试内**自校准实测**：`C_live = Σ byteLength(wire0 hubToPeer frames at live)`，估 ≈ 91_000 < 92_128 ✓）→ live 后逐笔 `peerWrite`（peer 侧无压，数据直达；hub UPDATE_ACK 57B/帧入额度）→ `allowed = floor((92_128 − C_live) / ackBytes)`（首笔 ACK 实测帧长）笔后第 `allowed+1` 笔触发。
  - **断言（原谓词全集的合法化等价形）**：① wire0 上 BOOTSTRAP_SNAPSHOT **恰 1 帧**（新语义 = 链式下界动机的正面证明：bootstrap 恒可入额度；替换原「首连零 BOOTSTRAP 帧」——那是结构性非法前提的谓词）；② 触发帧不上 wire：wire0 UPDATE_ACK 计数 = `allowed` 且实际写次数 = `allowed+1`（末笔 ACK 缺席）；③ **除收口 ERROR 帧外**的 wire0 hub→peer 累计字节 ≤ 92_128（口径 = 额度记账字节：收口 ERROR 帧经 `connectionFatal` 先 `sender.teardown()` 再直发 `outbound.sendControl`，依 **§4.3 豁免**（`hub-connection.ts:397-415`，PR #165 既有注释「收口 ERROR 直发 outbound——绕过 sender 额度判据」）**不进额度记账**，故须从字节总和中显式剔除、与断言④的单 ERROR 帧单列——断言口径与记账口径显式解耦，防「wire 总字节 = 记账字节」oracle 混淆〔R3/SA2 #8〕。反向验证（SA2 R2 红线 7）：临时把收口 ERROR 计入总和（错误 oracle）→ ③ 必须红，还原后绿）；④ 恰 1 个 connection ERROR（`CONNECTION_BACKPRESSURE`、无 namespaceId）；⑤ `close(1011)` + peer `backoff`（非 blocked）；⑥ 撤压重连后 wire1 BOOTSTRAP_SNAPSHOT 恰 1 帧 + 大 blurb 收敛 + `probe.events` 空（恢复段三谓词原样保留）。
  - **触发等待**：沿用既有 `settleUntil(…, '首连耗尽收口', 预算)` 形态，条件改为 `wire0 关闭 || backoff`（预算内在 `allowed+1` 笔写后必然达成——每笔写均 await settle，无挂死面）。
- **D3c**（L359-）：`controlReserveBytes: 100` → `maxBootstrapBytes: 1_024, maxQueuedControlBytes: 1_500`；L391 `Math.floor(100 / ackBytes)` → `Math.floor(RESERVE / ackBytes)`（`const RESERVE = 1_500` 具名常量）；L407 断言 message 同步换算（`floor(RESERVE/ackBytes)`）——**谓词（放行帧数恰 = floor(reserve/ackBytes)、异形谓词多发 1 帧）原样保留**，`allowed+1` 笔写循环自适。
- 全文件 `controlReserveBytes` 字面/注释清零（grep 门禁，§5）。

**T7 `test/ws-replication-sa7-round2-dynamic.test.ts`**
- 恒真断言加固（L393/L401/L404，断言消息与叙事对齐——「Tests describe current behavior and critical assertions are non-vacuous」）：
  - L393（循环内）：`expect(pending()).toBeGreaterThanOrEqual(0)` → `expect(pending(), \`write#${i + 1} 后 pendingData = ${i}（handoff 入队、暂停段零派发）\`).toBe(i)`——由绿锁 L395（`toBe(6)`）与 L403（updates 总数 `toBe(1)`，帧不可撤回 ⇒ 循环期零派发）联合保证恒真于当前行为；
  - L401：`expect(resyncs.length).toBeGreaterThanOrEqual(0)` → `expect(resyncs.length, '触发面必须显影——shed 路径 RESYNC 声明 ≥ 1').toBeGreaterThanOrEqual(1)`——源码依据：hub live 时 facet shed → `declareHubResync()`（`hub-namespace.ts:106-113`）→ RESYNC_REQUIRED 帧；
  - L404：`expect(pending()).toBeGreaterThanOrEqual(0)` → `expect(pending(), '触发面后幸存面清零（pendingData = 0，含负记账守卫）').toBe(0)`——由绿锁 L408（`toBe(0)`）+ L405-407（needsResync 置位后 deliver 首行丢弃 ⇒ pending 不动）反向传播保证。
- L698 `D4_LIMITS.controlReserveBytes: 32 * 1024` → `maxQueuedControlBytes: 32 * 1024`（类级直构不校验，值不变语义不变：8KiB snapshot ×4 > 32KiB 耗尽）。
- 头注释（L9 等）`channel pendingDataCount 恒 ≥ 0` 表述随加固更新。

**T8 `test/ws-replication-review-revisions-r1-r7-red.test.ts`**
- L428：`expect(resyncCount(run), '严格准入不得产生重复/虚假声明').toBeGreaterThanOrEqual(0)` → `expect(resyncCount(run), '拒纳必须无条件 RESYNC 声明').toBeGreaterThanOrEqual(1)`——与同文件 R1-2 锚 2（L391，`toBeGreaterThanOrEqual(1)`，现绿）同构同族路径（严格接纳拒纳 + 幸存面全弃 + onDataShed → live → `declareHubResync`），运行证据：22 文件 159 passed 含 R1-2。消息同时修正（原消息与断言声称不符——SA6 判定「恒真」的证据之一）。
- L442：`expect(channelPendingDataOf(run, nsId), 'authoritative facet 队列计数不得负记账').toBeGreaterThanOrEqual(0)` → `expect(channelPendingDataOf(run, nsId), '拒纳后 pendingData 归零（幸存面同批丢弃；0 兼负记账守卫）').toBe(0)`——叙事锚 (b) 自称「pendingDataCount 恒 0」、用例标题自称「pendingData 归零」，`>=0` 弱于叙事；归零由幸存面同批丢弃保证。
- L468 `QUEUE_LIMITS.controlReserveBytes: 32 * 1024` → `maxQueuedControlBytes: 32 * 1024`（类级直构，见 D4）。
- 加固反证门（§5）：若任一加固断言在当前实现下转红，SA3 **不得回退成恒真**——记录实际观测值，若与冻结语义冲突则按 known gap 上报总控归类（预期不发生：三处均有绿锁/源码/同族绿锚三重依据）。

**T9 `test/ws-replication-sa6-hardening-g1-g2-red.test.ts` / T10 `g3-g4-red.test.ts`**（叙事修正，断言零改动）
- g1-g2 头 L1-30：「⚠ 说明：`accept()` 的受信身份参数当前不存在……现实现接受冒充 → 红灯」→ 改为「已交付（issue #161 / PR #165 round 2：`accept(transport, identity)` 受信身份 + 缺失 TypeError）——本文件现为回归锁」；AC1/AC2/AC3 各条的「当前实现 …」行同步改为「已修复（回归锁）」并保留协议条款引用。文件名 `-red` 后缀保留（历史命名；头注释注明「文件名中 red 为历史红灯批次标记，现全部为回归锁」）。
- g3-g4 头 L1-28：AC5 行「当前全部无实现（OutboundQueue 数据面死置、UPDATE 走控制路径、三常量零逻辑引用）」→「已交付（#137/PR #162 + #161 R2/PR #165：per-ns 队列、round-robin、连接总压 shed、bufferedAmount 水位、control 保留额度、CONNECTION_BACKPRESSURE 1011）——现为回归锁」；AC4/AC6 同款处理。

**T11 `test/ws-replication-ac4-reconcile.test.ts`**
- L71：`expect(peerStep1At, 'peer 的 Step1 必须已发出').toBeGreaterThanOrEqual(0)`（`findIndex` 结果的 `>=0` 在上文 L60-62 已证 Step1 在场后冗余——SA6 判定真空）→ `expect(run.peerFrames('SYNC_STEP1').length, 'peer 的 Step1 必须已发出').toBeGreaterThanOrEqual(1)`（0 可达 ⇒ 可失败 ⇒ 非真空；直接表达消息声称）。L72（`hubStep1At > peerStep1At` 时序断言）不动。

**T12 `test/ws-replication-sa7-r2-transport.test.ts`**（D4-bis 缺省漂移迁移；断言谓词零改动）
- `bootReal`（L222 hub / L245 peer 构造）两侧追加 `limits: { maxBootstrapBytes: 1_024, maxQueuedControlBytes: 64_000 }`；A/B 用例字节算术与全部断言不动。
- 头注释 L5-8「`controlReserveBytes` 缺省 64KiB …缺省零漂移的动态差分证明」与 L23「limits 全部取缺省（零覆写——零漂移抽样前提）」按 D4-bis 措辞改述（历史「旧实现 lowWater ceiling 等价性」叙述保留为历史证据，标注以 #172 前缺省为参照系）。
- grep 门禁（§5）覆盖本文件旧字段名注释清零。

### §3.3 W-C：文档收敛（2 个文档；protocol/CONTEXT 不动，见 D7）

**C1 `docs/phases/phase-5-websocket-replication.md`** —— 两处编辑：

**(a) 既有正文修正（R2，SA2 #5）**：切片 8 首行（L123）「Peer `resetReplica(owner, namespaceId, expectedLocalIdentity)` 编排 close→archive→允许 bootstrap。」的执行次序描述已被 ADR-0010 issue #133 round-2 修订节显式替换，原地保留会与新插节的新口径并存为两种次序指引（违反 AC「No contradictory repository guidance」）。该行改为：

```markdown
- Peer `resetReplica(owner, namespaceId, expectedLocalIdentity)` 编排归档与重新 bootstrap 资格；执行次序以 ADR 0010 issue #133 round-2 修订节为准（先在唯一 write sequencer 的 reset-fence 槽内完成 live 投影 + persisted committed-snapshot 双源身份核对，之后才允许 close/archive/bootstrap 资格变更——早期「close→archive→bootstrap」简写已被该修订节替换）。
```

**(b) 新插节**：在「## 实施切片」与「## 协议与状态机验收」之间插入下节（全文草案，SA3 原样落盘后可按行宽微调）：

```markdown
## 交付现状与边界（issue #172 收口登记）

本节区分「当前已交付契约」「已知偏差（planned fix）」与「未交付边界」。wire 语义权威
仍为 `docs/protocols/instance-replication-v1.md`（ADR 0010 issue #161 修订节冻结值）；
本节只登记交付状态，不改写任何冻结值，也不把未合入行为表述为当前实现。

### 切片交付状态

| 切片 | 状态 | 说明 |
|---|---|---|
| 1 identity/CSPRNG/管理操作 | 已交付 | enable/bump FIFO 槽序、replication 两态投影 |
| 2 Persistence 导入/归档 | 已交付 | importDoc/archiveDoc/只读身份探针（ADR 0006 #133 修订节） |
| 3/4 ReplicationSession + trusted apply | 已交付 | ADR 0010 issue #134（含 round 2）修订节冻结词汇 |
| 5 replication-protocol codec | 已交付 | envelope/payload/注册表/版本协商 + golden/截断/fuzz 套件 |
| 6 ws-replication namespace 状态机 | 已交付* | 背压（水位/严格接纳/shed/control 保留额度）随 #137/#161 交付；*恢复检查点 cadence 为已知偏差（#169） |
| 7 WS 连接/认证/授权 | 部分交付 | 受信 Upgrade 身份、peer pong close(1001)、peer GOAWAY deadline/blocked 已交付；hub pong 语义（#170）与 GOAWAY 静默窗口、hub 停机 GOAWAY（#171）为已知偏差；生产 adapter 三面装配断言随 #164 |
| 8 Reset/配置/observability | 部分交付 | Registry 侧 resetReplica 已交付（ADR 0010 #133 round-2 修订节为现行有效文本，正文旧次序描述不引用）；peer 侧 resetReplica 编排与结构化 observer/metrics 面（#163）未交付 |
| 9 apps/yjs-server | 未交付 | #164（composition root + DuplexTransport 三可选面装配期断言 + §21 停机编排） |
| 10 最终集成与审查 | 未交付 | 依赖 #163/#164/#169/#170/#171 |

### 已知偏差（冻结契约 vs 当前实现；可执行验收锚已就位）

| 偏差 | 冻结语义（权威出处） | 当前实现 | 修复票 |
|---|---|---|---|
| 背压恢复检查点 | §17：`max(1, floor(ackTimeoutMs/100))`（缺省 100ms） | 固定 1_000ms（`BACKPRESSURE_POLL_INTERVAL_MS`） | #169 |
| hub 侧 pong 超时 | §18：临时失败 → close(1001) + backoff | close(1002)；`PONG_TIMEOUT` 不在 §13.1 注册表（无 ERROR 帧） | #170 |
| CLOSE_OK 关联 | §10.2/§13.1：错误/多余 ACK 关联 → `ACK_STATE_VIOLATION`(1002) connection fatal | closing/live 期不匹配或多余 CLOSE_OK 静默忽略 | #171 |
| GOAWAY 静默窗口 | §6.3：drain 窗口内停止 OPEN、不开始新 sync round | `addTarget` 在 ready 下直接 startOpen；needs-resync 恢复未查 drain 窗口 | #171 |
| hub 停机 GOAWAY | §21 停机顺序第 1 步：停止接纳并发送 GOAWAY | `HubReplication.close()` 直接 close(1001)，零 GOAWAY 帧 | #171 |

验收锚：`packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts`
（A2-1/A2-2 → #169；A3-1 → #170；A4-1/A4-2/A5-1/A5-2/A5-5 → #171——以上以 `it.fails`
注册为期望红灯，修复票落地转绿时自动反红提示摘标；锚集存在性由同文件常驻 meta 守卫
保护——删锚/摘标不同步清点都会使套件反红；A1-1/A1-2/A1-3/A1-2b/A3-2/A3-3/
A5-3/A5-4 为现绿回归锁）。

**hub 停机 GOAWAY 归属裁决**：§21 第 1 步的 GOAWAY 发送属 `@nomicore/ws-replication`
包行为（`HubReplication.close()` 包内可完成，不依赖 composition root），修复票 #171；
切片 9（#164）的 composition root 只负责按 §21 顺序编排停机，不拥有 GOAWAY 发送本身。

### 未交付边界（known gap）

- 结构化 observability（#163）：`HubReplication`/`PeerReplication` 公共 API 无
  observer/metrics 事件面；ADR 0010「资源限制与 observability」节的最小观测面未交付。
- apps/yjs-server + real WebSocket adapter/composition（#164）：`apps/` 下无 composition
  root；`DuplexTransport` 三可选面（bufferedAmount/ping/onPong）的生产装配期响亮断言
  （§17「生产 Adapter 必须暴露三面」）随 #164 交付。
- peer 侧 resetReplica 编排（切片 8 部分）：Registry 侧已交付；ws-replication 层未暴露
  peer reset 面（`PeerReplication` 无 reset 编排 API）。

### control 保留额度实现口径（#172 收敛登记）

公共字段为 `maxQueuedControlBytes`（缺省 8 MiB；构造期校验
`≥ maxBootstrapBytes + 协议开销`，TypeError，绝不运行时 clamp）；额度耗尽 =
`CONNECTION_BACKPRESSURE` close(1011)。「按 socket 缓冲内未冲刷控制字节计」的实现口径
为暂停段出站 control 帧实际编码字节的近似累计——段内不扣减已冲刷字节（偏高）、段边界
复位丢弃暂停前未冲刷残留（偏低），净方向取决于冲刷进度；WS transport 无逐帧冲刷可观察
面，此为可实现近似（ADR 0010 issue #172 修订节同款登记）。
```

**C2 `docs/adr/0010-hub-peer-websocket-ydoc-replication.md`** —— 文件末尾追加修订节（append-only；不改正文与既有修订节）：

```markdown
### issue #172 修订（Phase 5 权威契约收敛——2026-08-30）

本节登记公共 TypeScript API 与 wire 权威文档的收敛决定及交付边界陈述；wire 冻结值
不变，正文与既有修订节效力不变。

1. **control 保留额度公共字段**：`@nomicore/ws-replication` 公开 `ReplicationLimits`
   的 control 保留额度字段为 `maxQueuedControlBytes`（缺省 8 MiB；构造期响亮校验
   `maxQueuedControlBytes ≥ maxBootstrapBytes + 协议开销`，同步 TypeError，绝不运行时
   clamp）。PR #165 曾以 `controlReserveBytes`（64 KiB）落地，与本节及 protocol §17
   不一致；issue #172 收敛为冻结字段名/缺省/下界，记账判据（耗尽 →
   `CONNECTION_BACKPRESSURE` close 1011）由冻结字段驱动。「额度按 socket 缓冲内未冲刷
   控制字节计」的实现口径 = 暂停段出站 control 帧实际编码字节的近似累计（段内不扣减
   已冲刷字节、段边界复位丢弃暂停前未冲刷残留——净方向取决于冲刷进度，不构成恒保守
   上界；WS 无逐帧冲刷可观察面，此为可实现近似）。
2. **`wiki/raw` 非规范**：源码与规范中的公共行为表述必须指向 `CONTEXT.md`、ADR 或
   `docs/protocols/`；`wiki/raw/` 仅为流水线历史证据（`docs/AGENTS.md` Authority 节）。
   仓库内以「冻结契约/权威设计/契约来源」措辞指向 `wiki/raw` 的源引用已改为权威指向
   +历史证据双标注。
3. **交付边界陈述**（详见 `docs/phases/phase-5-websocket-replication.md`「交付现状与
   边界」节，此处登记结论）：peer 侧 resetReplica 编排未交付（Registry 侧已按 #133
   round-2 修订节交付）；结构化 observer/metrics 面（#163）未交付；apps/yjs-server
   composition root 与 transport 三可选面装配期断言（#164）未交付。已知偏差修复路由：
   背压恢复检查点 → #169；hub 侧 pong 超时 close(1001) → #170；CLOSE_OK 错误/多余
   关联 `ACK_STATE_VIOLATION`(1002)、GOAWAY drain 窗口静默（停 OPEN/不开新 round）、
   hub 停机先发 GOAWAY → #171。hub 停机 GOAWAY 发送归属 `@nomicore/ws-replication`
   包行为（非 #164 composition 边界）。
```

### §3.4 W-C 续：源引用去权威化（9 个 src 文件 + 14 处测试侧引用〔11 测试头 + 2 helper + 1 test-d〕；一律注释改写，零行为改动）

改写模式（D6，R2 五类关键词）：删除「冻结契约/权威设计/契约来源/设计基准/以…为准」单指 wiki/raw 的表述 → 「规范权威：ADR/protocol/CONTEXT + 历史设计记录（非规范）：wiki/raw/X」双标注。

| # | 文件:行 | 现状表述 | 权威指向 |
|---|---|---|---|
| 1 | `packages/ws-replication/src/types.ts:2-5` | 「SA6 冻结，逐字段」+「设计：wiki/raw/…§2（冻结契约面）」 | protocol §17/§18 + ADR-0010 #161/#172 修订节 |
| 2 | `packages/ws-replication/src/index.ts:2` | 「SA6 冻结契约面，§2」 | 同上 |
| 3 | `packages/ws-replication/src/defaults.ts:2-4,15,30,44` | 「设计：§2（值）/§15.2」「冻结默认…（§2 注释值）」 | protocol §17/§18 + ADR-0010 #161 修订节 |
| 4 | `packages/namespace-runtime/src/replication-session.ts:2-4` | 「设计 wiki/raw/task_namespace-lease-replication-session_design.md §4，R1 定稿」 | ADR-0010 issue #134（含 round 2）修订节 + phase-5 切片 3/4 落地锚定 |
| 5 | `packages/doc-runtime/src/extract.ts:5` | 「设计 §3.1/§4.3–§4.8（wiki/raw/…design.md）」 | ADR-0007（extract 的求值/校验域）；wiki 降为历史设计记录 |
| 6 | `packages/doc-runtime/src/materialize.ts:5-7` | 同上（3 个 wiki 引用） | ADR-0007/ADR-0008 |
| 7 | `packages/doc-runtime/src/read.ts:6` | 同上 | ADR-0008 |
| 8 | `packages/doc-runtime/src/replace.ts:6-7` | 同上 | ADR-0008 |
| 9 | `packages/doc-runtime/src/carrier.ts:4` | 同上 | ADR-0007 |
| 10 | `packages/namespace-registry/test/registry-create.test.ts:5` | 「契约来源：wiki/raw/…_design.md（冻结，R3 PASS）」 | ADR-0009（+ADR-0010 namespaceId CSPRNG 面） |
| 11 | `packages/namespace-registry/test/registry-open.test.ts:5` | 「契约来源：…（冻结设计）」 | ADR-0009 |
| 12 | `packages/namespace-registry/test/registry-idle.test.ts:5` | 「契约来源：…（冻结设计，R1 修订）」 | ADR-0009 |
| 13 | `packages/namespace-registry/test/registry-plugin.test.ts:5` | 同上 | ADR-0009 |
| 14 | `packages/namespace-registry/test/registry-shutdown.test.ts:5` | 同上 | ADR-0009 |
| 15 | `packages/namespace-registry/test/registry-phase5-identity-red.test.ts:592` | 「契约来源：wiki/raw/…_design.md §12.3」 | ADR-0010（Registry identity 修订） |
| 16 | `packages/namespace-registry/test/registry-phase5-replication-session-round2-red.test.ts:15` | 「契约来源：wiki/raw/…_round2.md（评审全文…）」 | ADR-0010 issue #134 round-2 修订节 |
| 17 | `packages/namespace-runtime/test/runtime-replication-session-round2-red.test.ts:18` | 同上 | 同上 |
| 18 | `packages/doc-runtime/test/create-initial-document.test.ts:5` | 「契约来源：wiki/raw/task_namespace-registry-create_design.md（冻结，R3 PASS）」 | ADR-0009（+ADR-0007 ROOT 载体域） |
| 19 | `packages/doc-runtime/test/xml-attr-quote-domain-sa7.test.ts:4` | 「契约来源：SA4 静态审核报告（wiki/raw/…_sa4_review.md）」 | ADR-0007（逻辑校验域）；评审报告降为历史证据 |
| 20 | `packages/vfsl/test/compile-schema-envelope-sentinel.test.ts:4` | 「契约来源：wiki/raw/task_issue-72_sa2_review.md」 | ADR-0004（schema envelope/projection 域） |
| 21 | `packages/namespace-registry/test/helpers/registry-seam-audit.ts:15` | 「设计基准：wiki/raw/task_namespace-runtime-registry-seam-rev1_design.md（R1）§D-A–§D-D」 | ADR-0009（internal subpath 消费边界 + testing seam 白名单——helper 注释上文已引 ADR-0009 两处，「设计基准」行改挂其下）；wiki 降为历史设计记录 |
| 22 | `packages/namespace-runtime/test/helpers/registry-seam-audit.ts:7` | 同上（两份 helper 同源双拷贝） | 同上 |
| 23 | `packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts:281` | 「未尽事项以 wiki/raw/task_vfsl-protocol.md 的 SA6 红灯测试记录为准」 | ADR-0004（VFSL 协议类型投影）+ 本文件 `expectTypeOf`/`@ts-expect-error` 断言即规范载体；SA6 红灯记录降为历史证据 |

注：ws-replication 测试头的去权威化已并入 T1/T5（harness 头、ac1-ac7 头）。其余 ~35 处以「任务简报/评审/根因」身份引用 wiki/raw 的测试头**不动**（历史证据引用，DENY LIST 防误伤）。#21/#22 为测试 helper（生产白名单门禁的规则载体）、#23 为 test-d——三类均属「specification 灰区从严」裁决（D6 R2 规则）。

---

## §4. 验收标准对照（issue → 设计覆盖）

| Issue 验收标准 | 覆盖点 |
|---|---|
| `wiki/raw` is historical evidence only, not an authoritative contract in source/specification | §3.4（23 处改写：9 src + 11 测试头 + 2 helper + 1 test-d）+ C2-修订节第 2 条 + D6 判定标准（R2 五类关键词含「设计基准/以…为准」，specification 灰区从严） |
| Public fields/defaults/error and close-code semantics map one-to-one between code and one authoritative document | §3.1（G1 字段/缺省/下界 ↔ §17）；错误/close 语义经 §3.3 状态表显式区分「已映射」与「gap 待 #169-#171 映射」——唯一权威文档仍是 protocol §13/§14/§17/§18，仓库无第二权威 |
| Phase documentation identifies #163/#164 and `resetReplica` delivery/dependency status | §3.3 C1 切片状态表 + 未交付边界节；**R2 补**：既有切片 8 行（L123）旧次序 supersede 注记（C1-a）——交付状态与现行有效次序口径（#133 round-2）同文档一致 |
| No contradictory repository guidance for control reserve, polling interval, pong timeout, `CLOSE_OK`, or `GOAWAY` | D7（protocol↔ADR 全量对照一致）+ C1 状态表消除「目标 vs 现状」未登记矛盾 + C1-a 消除 resetReplica 新旧次序并存；全仓 grep 扫描（§5）确认无第三处矛盾指引 |
| Tests describe current behavior and critical assertions are non-vacuous | T5/T7/T8/T9/T10/T11（叙事修正 + 4 组恒真断言加固，均带可失败性论证）；T3 延后锚以 it.fails 显式标注「非当前行为」+ D2-bis meta 守卫保证锚集不腐烂；T6/T12 头注释「缺省 64KiB 配方/缺省零漂移」过时前提改述 |
| `git diff --check` passes; executable-contract changes include relevant typecheck/tests | §5 验证门禁 |

---

## §5. 验证门禁（SA3 收尾必跑 + 预期矩阵）

```bash
# ① 旧字段名清零（R2 改全仓 + 排除 wiki——设计/评审文档合法保留旧名历史记述）
git grep -n "controlReserveBytes" -- ':(exclude)wiki'                # 预期：零命中
# ② D6 权威性措辞清零（R2 新增，SA2 #4：五类关键词扫描；命中即漏改）
git grep -nE "契约来源：wiki|设计基准：wiki|以 wiki/raw.*为准" -- 'packages/**' 'apps/**' 'docs/**'   # 预期：零命中（§3.4 全部 23 处改写后；「冻结契约/权威设计」类由 ①③ 与人工复核覆盖）
# ③ D5 过强措辞残留清零（R2 新增，SA2 #2；扫描域 = 将落盘的 docs/ 与 src 注释，wiki 设计文档不扫）
git grep -rn "保守上界\|fail-safe" -- 'docs/**' 'packages/ws-replication/src/**'   # 预期：零命中（落盘文本一律用「近似口径·净方向取决于冲刷进度」表述）
pnpm typecheck                                                        # 预期：no errors
pnpm test                                                             # 预期：全绿
git diff --check                                                      # 预期：通过
```

**it.fails 双向翻转一次性实测（R2 新增，SA2 #7；SA3 在本地分支执行并把记录附 PR 描述）**：(a) 临时把任一现绿锁（如 A3-2）标 `it.fails` → 全量套件必须**红**（绿→记红方向）；(b) 还原后跑 anchors 文件 → 8 锚期望红全记绿、meta 守卫绿（红→记绿方向）；(c) 全程零 unhandled rejection。

预期测试矩阵：

| 文件 | 预期 |
|---|---|
| `ws-replication-issue172-contract-anchors.test.ts` | **17 用例全绿**：8 条现绿锁/收敛锚（A1-1/A1-2/A1-2b/A1-3/A3-2/A3-3/A5-3/A5-4）+ 8 条 it.fails 期望红（A2-1/A2-2/A3-1/A4-1/A4-2/A5-1/A5-2/A5-5）+ 1 条 D2-bis meta 守卫（锚集完整性） |
| `ws-replication-issue137-r2-red.test.ts` | 全绿（R2-4 两用例 fixture 迁移后语义不变） |
| `ws-replication-sa7-issue137-dynamic.test.ts` | 全绿（**D3a/D3b/D3c 合法化重构**后谓词成立——D3b 按 §3.2-T6 R2 方案：wire0 BOOTSTRAP 恰 1 帧 + `allowed` ACK + 触发帧缺席 + 1011 + 恢复段原谓词） |
| `ws-replication-sa7-round2-dynamic.test.ts` / `ws-replication-review-revisions-r1-r7-red.test.ts` | 全绿（恒真加固三/两处 + LIMITS 改名） |
| `ws-replication-sa7-r2-transport.test.ts`（真实 TCP 集成） | 全绿（D4-bis 显式额度迁移后 A 存活 / B 耗尽两侧字节算术不变） |
| 其余 ws-replication 11 文件（23 − 本票修改 12）+ namespace-registry/doc-runtime/vfsl/vfsl-protocol/namespace-runtime 全量 | 全绿（仅注释改动，零行为面） |
| `ws-replication-api.test-d.ts` / `vfsl-protocol-projection.test-d.ts`（typecheck） | 全绿（字段形状改锁新面 / 头注释改写零类型面影响） |

**加固反证门**：T7/T8 任一加固断言若红——不得回退恒真；记录实际值，与冻结语义冲突时按 known gap 上报总控归类。**D4 校准门（R2 扩）**：A1-3/R2-4/D3a/D3c（快照 > 1_024）或 **D3b（快照 > 92_000 → BOOTSTRAP_TOO_LARGE；或 `C_live` 距额度不足一笔 ACK；或 reconcile 帧自身越限触发——`C_live + 首帧即 > 额度`，peerWrite 前已收口）**——按 §1-D4 回退规则升档重校（D3b：mBB ≥ 实测快照 + ≥1KB，额度 = mBB+128，`allowed` 自校准重派生），仍不通则上报。

---

## §6. SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| #1 CRITICAL：D3b（sa7-issue137-dynamic:318 零覆写依赖缺省额度）漏判——§5 矩阵误报全绿、结构性非法场景未裁决、回退规则盲区、头 L25 叙事未覆盖 | ✅ | §0 D4-bis（扩为两例）/ §1-D4 波及表 + 「结构性不可达推理完备化」段 + 回退规则（D3b 单列 92_000 档）/ §3.2-T6（D3b 合法化重设全方案 + 头 L27-29 b 行整行重写）/ §5 矩阵与 D4 校准门 / §8-P10 / §9 caller 表 | D3b 补入波及表（第 5 行）；「单个 BOOTSTRAP 帧耗尽额度在合法配置下结构性不可达」推理完备化（frame-io.ts:75-85 + hub-namespace.ts:403 + 下界 ⇒ bootstrap 恒可入额度——恰为链式下界动机）；重设 = `{maxBootstrapBytes: 92_000, maxQueuedControlBytes: 92_128}` 边界等值 + `C_live` 自校准 + `allowed` 派生 + 原谓词全集的合法化等价形（wire0 BOOTSTRAP 恰 1 帧=下界动机正面证明、触发 ACK 缺席、累计字节 ≤ 额度、1011、恢复段三谓词原样） |
| #2 MEDIUM：「保守上界 ⇒ 偏向提前 1011 = fail-safe」方向性声明失实（enterPause 复位丢 C_pre ⇒ 深拥塞下欠计、1011 可晚触发）——C1/C2/§1-D5/注释四处 | ✅ | §1-D5（整节改述：C_pre + C_pause − F 分解、净方向取决于冲刷进度、撤回保守上界声明）/ §3.1 backpressure.ts 注释草案 / C1 末段 / C2 第 1 条 / §5 门禁③（`保守上界\|fail-safe` 残留 grep 清零） | 四处措辞统一改为「近似口径：段内偏高（不扣已冲刷）+ 段边界复位丢弃 C_pre（偏低）——净方向取决于冲刷进度，不声称恒保守上界」；C_pre 复位丢失限制显式登记入 ADR #172 修订节；SA7 轮次 grep 复核（SA2 §4-3 红线） |
| #3 MEDIUM：it.fails 锚集完整性无常驻守卫（删锚/改标记/抹锚号 → CI 恒绿零信号） | ✅（选方案 (a)） | §1-D2-bis（新节：meta 守卫完整代码草案 + 纪律合规论证 + 随票演进 8→6→…→0）/ §3.2-T3（守卫规格 + 自匹配注意事项）/ §5 矩阵（17 用例）+ 双向翻转实测 / §7 ALLOW（anchors 行扩注） | 新增普通 `it` readFileSync 本文件断言 it.fails 计数 = DEFERRED_ANCHORS 长度且每锚号 `it.fails('<id> ` 在场；对象是测试文件自检非实现源码（不违「零源码 grep 断言」纪律）；删锚/改回 it/抹锚号三路径全部反红 |
| #4 MEDIUM：D6 判定关键词不覆盖「设计基准/以…为准」——registry-seam-audit.ts ×2、vfsl-protocol-projection.test-d.ts:281 三处未裁决 | ✅ | §1-D6（判定关键词扩为五类 + 「helper/test-d 属 specification 灰区从严」裁决）/ §3.4 表 #21-#23 + 注 / §5 门禁② / §7 ALLOW（+3 文件） | 三处纳入必改（#21/#22 → ADR-0009 挂靠；#23 → ADR-0004 + 本文件断言即规范载体，SA6 红灯记录降历史证据）；§5 新增 `契约来源：wiki\|设计基准：wiki\|以 wiki/raw.*为准` 零命中门禁 |
| #5 MEDIUM-LOW：phase-5 既有 L123 resetReplica 旧次序叙事与 #133 round-2 新口径同文档并存 | ✅ | §3.3 C1-(a)（新增既有正文修正：L123 改挂「执行次序以 ADR 0010 issue #133 round-2 修订节为准」supersede 注记）/ §4 AC 对照行 | 一行 supersede 注记（非静默删除——原行保留编排职责描述，次序声明替换）；C1 编辑范围从「仅插节」扩为「插节 + 一行修正」，ALLOW 已覆盖该文件 |
| #6 LOW：§5 grep 门禁不含仓根与 tests/** | ✅ | §5 门禁① | 改为 `git grep … -- ':(exclude)wiki'`（全仓 - wiki 历史证据豁免） |
| #7 LOW：P2 依据缺官方 URL；it.fails 运行时语义未实测 | ✅ | §8-P2（补 vitest 官方文档 URL）/ §5（双向翻转一次性实测三步 + 记录附 PR） | P2 引 https://vitest.dev/api/test.html（it/test 共页，fails 修饰符）；SA3 执行 (a) 绿锁临时标 fails → 红、(b) 还原 → 8 锚记绿 + 守卫绿、(c) 零 unhandled rejection，记录附 PR |
| **#8 HIGH（R2 阻断）**：D3b 断言③「wire0 hub→peer 累计字节 ≤ 92_128」把 wire 字节当记账字节——收口 ERROR 经 `connectionFatal` 直发 outbound（§4.3 豁免、不记账），触发时刻 wire 总字节 = 已记账 + 1 个不记账 ERROR 帧 ⇒ slack < ERROR 帧字节时确定性红，且不在任何 D4 回退分支内 | ✅ | §3.2-T6 D3b 断言③（唯一改动点） | 断言③改述为「**除收口 ERROR 帧外**的 wire0 hub→peer 累计字节 ≤ 92_128」——收口 ERROR 帧字节显式剔除、单列于断言④；引用 §4.3 豁免 + `hub-connection.ts:397-415` 代码注释原文（PR #165 既有行为）；断言口径与记账口径显式解耦；附 SA2 R2 红线 7 反向验证（错误 oracle 计入 ERROR → ③ 必红）。其余五条断言与其余设计面零改动 |
| **#9 LOW（R2 非阻塞，顺手处理）**：class-⑤「定稿」规则文本与清单/门禁周界不一致 | ✅ | §1-D6 class-⑤ 周界裁定句 | 「定稿」仅当构成「以…为准」式权威指向时必改；「X 定稿（revN 设计 §Y）」出处叙述归叙事身份不动（src 9 文件逐类核验）；不扩清单、不加门禁 |
| **#10 LOW（R2 非阻塞，顺手处理）**：P2 官方 URL 未能独立验证 | ✅ | §8-P2 | URL 标注为辅助引用（承重证据 = 仓内类型声明）；SA3 落地时核准或删除，不作门禁条件 |

---

## §7. 文件清单（File Scope）

### ALLOW LIST

**生产代码（ws-replication 公共契约收敛，§3.1）**
- `packages/ws-replication/src/types.ts` — 修改：字段改名 L29 + 头注释去权威化（§3.4#1）；~6 行
- `packages/ws-replication/src/defaults.ts` — 修改：缺省值 8MiB + 头注释（§3.4#3）；~6 行
- `packages/ws-replication/src/validate.ts` — 修改：改名校验行 + 追加链式下界（§3.1 伪代码）；+8 行
- `packages/ws-replication/src/backpressure.ts` — 修改：判据换读新字段 L81 + 注释（含 D5 口径 + #169 登记）；~10 行
- `packages/ws-replication/src/index.ts` — 修改：仅头注释；~2 行

**生产代码（去权威化注释，§3.4）**
- `packages/namespace-runtime/src/replication-session.ts` — 修改：仅头注释权威指向；~3 行
- `packages/doc-runtime/src/extract.ts` — 修改：仅头注释；~2 行
- `packages/doc-runtime/src/materialize.ts` — 修改：仅头注释；~3 行
- `packages/doc-runtime/src/read.ts` — 修改：仅头注释；~2 行
- `packages/doc-runtime/src/replace.ts` — 修改：仅头注释；~2 行
- `packages/doc-runtime/src/carrier.ts` — 修改：仅头注释；~2 行

**ws-replication 测试（迁移/叙事/加固，§3.2）**
- `packages/ws-replication/test/harness.ts` — 修改：镜像改名 8MiB + 头注释；~5 行
- `packages/ws-replication/test/ws-replication-api.test-d.ts` — 修改：类型形状 L135 改名；~2 行
- `packages/ws-replication/test/ws-replication-issue172-contract-anchors.test.ts` — `[SA6 owned]` 修改：A1-3 fixture 追加 `maxBootstrapBytes: 1_024` 一行（D4 授权：冻结下界波及的 fixture 合法化，断言/K 零改动）+ 8 条延后锚 `it.fails` 注册转换（D2 授权：CI 绿门禁，断言体零改动）+ **D2-bis meta 守卫新增**（R2/SA2 #3 授权：`DEFERRED_ANCHORS` 常量 + 守卫 `it` + fs/url import，锚集完整性自检）+ 头注释/G1 标题现状括注刷新；既有断言谓词零改动
- `packages/ws-replication/test/ws-replication-issue137-r2-red.test.ts` — 修改：R2-4 字段改名 + `maxBootstrapBytes: 1_024` 追加 + 注释；断言零改动；~8 行
- `packages/ws-replication/test/ws-replication-issue137-ac1-ac7-red.test.ts` — 修改：过时叙事（头 + L114-116）→ 回归锁表述；断言零改动
- `packages/ws-replication/test/ws-replication-sa7-issue137-dynamic.test.ts` — 修改：**D3a/D3b/D3c 场景合法化**（§3.2-T6；D3b 为 R2/SA2 #1 补入——合法化重设含谓词的合法化等价形替换「首连零 BOOTSTRAP」结构性非法谓词）+ 头 L27-29 b 行整行重写 + 注释
- `packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts` — 修改：恒真加固 L393/L401/L404 + D4_LIMITS 改名 L698
- `packages/ws-replication/test/ws-replication-review-revisions-r1-r7-red.test.ts` — 修改：恒真加固 L428/L442 + QUEUE_LIMITS 改名 L468
- `packages/ws-replication/test/ws-replication-sa6-hardening-g1-g2-red.test.ts` — 修改：头叙事 → 回归锁表述；断言零改动
- `packages/ws-replication/test/ws-replication-sa6-hardening-g3-g4-red.test.ts` — 修改：同上
- `packages/ws-replication/test/ws-replication-ac4-reconcile.test.ts` — 修改：L71 恒真加固；~2 行
- `packages/ws-replication/test/ws-replication-sa7-r2-transport.test.ts` — 修改：D4-bis 缺省漂移迁移（两侧构造追加显式合法 limits + 头注释改述）；断言零改动

**测试侧去权威化（§3.4 #10-#23，一律仅注释；#10-#20 测试头 11 处 + R2/SA2 #4 补入 #21-#23）**
- `packages/namespace-registry/test/registry-create.test.ts`
- `packages/namespace-registry/test/registry-open.test.ts`
- `packages/namespace-registry/test/registry-idle.test.ts`
- `packages/namespace-registry/test/registry-plugin.test.ts`
- `packages/namespace-registry/test/registry-shutdown.test.ts`
- `packages/namespace-registry/test/registry-phase5-identity-red.test.ts`
- `packages/namespace-registry/test/registry-phase5-replication-session-round2-red.test.ts`
- `packages/namespace-runtime/test/runtime-replication-session-round2-red.test.ts`
- `packages/doc-runtime/test/create-initial-document.test.ts`
- `packages/doc-runtime/test/xml-attr-quote-domain-sa7.test.ts`
- `packages/vfsl/test/compile-schema-envelope-sentinel.test.ts`
- `packages/namespace-registry/test/helpers/registry-seam-audit.ts` — `[R2 追加]` 仅 L15「设计基准：wiki/…」行改挂 ADR-0009（§3.4#21）；审计逻辑零改动
- `packages/namespace-runtime/test/helpers/registry-seam-audit.ts` — `[R2 追加]` 同上（§3.4#22）
- `packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts` — `[R2 追加]` 仅 L281「以 wiki/raw/… 为准」行改挂 ADR-0004（§3.4#23）；类型断言零改动

**文档（§3.3）**
- `docs/phases/phase-5-websocket-replication.md` — 修改：插入「交付现状与边界（issue #172 收口登记）」节（C1-b 草案全文）+ 既有 L123 resetReplica 行 supersede 注记（C1-a，R2/SA2 #5）
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` — 修改：末尾追加「issue #172 修订」节（C2 草案全文；append-only）

**流水线产物**
- `wiki/raw/task_phase-5-websocket-replication-contracts_design.md` — 本设计文档

### DENY LIST

- `docs/protocols/instance-replication-v1.md` — 唯一 wire 权威；全量对照无矛盾（D7），冻结值不因代码现状改写
- `CONTEXT.md` — 本票零域词汇变化（D7）
- `packages/replication-protocol/**` — 错误注册表/codec 不动；`PONG_TIMEOUT` 入册与否是 #170 的设计决定
- `packages/namespace-registry/src/**`、`packages/namespace-runtime/src/**`（除 ALLOW 的 `replication-session.ts` 头注释）、`packages/doc-runtime/src/**`（除 ALLOW 的 5 文件头注释）、`packages/vfsl/**`（除 ALLOW 的 1 测试头）、`packages/vfsl-protocol/**`（除 ALLOW 的 1 test-d 头注释）— 本票不动其行为面
- `packages/clock/**`、`packages/persistence/**`、`packages/dsh-persistence/**`、`domains/**`、`tests/**` — 无关联
- `apps/**` — #164 域（现仅 AGENTS.md/README.md）
- `packages/ws-replication/src/liveness.ts`、`hub-connection.ts`、`peer-connection.ts`、`peer-namespace.ts`、`hub-namespace.ts`、`frame-io.ts`、`update-channel.ts`、`round-engine.ts`、`lifecycle-queue.ts`、`fence-watchdog.ts`、`testing.ts` — 行为修复属 #169/#170/#171；本票对这些文件零改动（偏差仅在 phase 文档/既有注释登记）
- 其余 ~35 处以「任务简报/评审/根因报告」身份引用 `wiki/raw` 的测试头 — 历史证据引用合法（docs/AGENTS.md），防 scope creep（R2：~38 − 3 处 D6 边界改写）
- `README.md`、`docs/AGENTS.md`、`docs/agents/**` — 已正确陈述 wiki/raw 证据地位
- 既有 ws-replication 测试文件的断言谓词（除 §3.2 明列的恒真加固/合法化重构与 SA6 owned 授权项）— 不得顺手改写

---

## §8. 协议假设依据 (Protocol Assumption Evidence)

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险 |
|---|---|---|---|---|
| P1 | `resolveLimits` spread 合并会静默丢弃未知键（A1-3 红灯根因；改名后新字段自然生效） | 源码引用 | `packages/ws-replication/src/defaults.ts:52-54` `{ ...DEFAULT_REPLICATION_LIMITS, ...(partial ?? {}) }`——Partial 显式字段整值替换，多余键不进 `ResolvedLimits` 类型面 | 低 |
| P2 | `it.fails` 在仓内 vitest 可用且语义为「红→绿、绿→红」双向翻转 | 设计期实测验证（类型声明，承重证据）+ 官方文档引用（辅助，R3 标注） | 仓内安装 `node_modules/.pnpm/@vitest+runner@3.2.7/.../dist/tasks.d-CkscK4of.d.ts:105-107`「Whether the task should succeed if it fails. If the task fails, it will be marked as passed.」+ `:314` ChainableFunction 含 `"fails"` 修饰符；官方文档 https://vitest.dev/api/test.html（it/test 共页，`fails` 修饰符条目同语义）——**URL 为辅助引用**（SA2 R2 #10：未能独立验证，vitest 3.x 文档路径疑为 `/api/test` 无 .html），SA3 落地时核准或删除，不作门禁条件。运行时细节（timeout 计入、报告面）由 §5 双向翻转一次性实测复核 + D2-bis meta 守卫常驻兜底 | 低-中（类型声明承重 + 实测/守卫双兜底） |
| P3 | issue137 fixture 的 bootstrap 快照 ≈ 345B，`maxBootstrapBytes: 1_024` 合法且留 ≥ 2× 裕量 | 设计期实测验证 | 2026-08-30 worktree 内 node + 仓内 yjs：SCHEMA 文本 `'type ROOT = { n: number; blurb: string; };\n'` + META{docId ns-32hex/createdAt/replicationId 32hex/epoch 1} + ROOT{n:1,blurb:'seed'} 同构装载 → `Y.encodeStateAsUpdate` = 345 bytes（命令+输出见 §1-D4）。SA3 以实际套件跑通复核（BOOTSTRAP_TOO_LARGE 不出现即证）；回退规则已备 | 中（模型可能漏 META 键差异——裕量 3× 覆盖） |
| P4 | 恒真加固点 T7-L401（shed → RESYNC ≥ 1）在当前实现下成立 | 源码引用 + 现有测试引用 | `hub-namespace.ts:106-113` facet `discardForConnectionPressure` → live 时 `declareHubResync()`（发 RESYNC_REQUIRED）；同族路径既有绿锚 `ws-replication-review-revisions-r1-r7-red.test.ts:391`（R1-2 锚 2 `toBeGreaterThanOrEqual(1)`，22 文件 159 passed 运行证据） | 低-中 |
| P5 | 恒真加固点 T7-L393/L404、T8-L442 的精确值（`toBe(i)`/`toBe(0)`）在当前实现下成立 | 源码推理 + 现有绿锁联合 | L393/L395/L403：updates 总数 `toBe(1)` 且 UPDATE 帧不可撤回 ⇒ 循环期零派发 ⇒ pending 严格递增至 i；L404/L408：`toBe(0)` 绿锁 + L405-407 needsResync 首行丢弃（`update-channel.ts:67`）⇒ pending 冻结 ⇒ 反向传播；T8-L442：R1-3 标题/叙事自称「pendingData 归零」且幸存面同批丢弃（`backpressure.ts:235` discard 全弃 + removeFromWheel）。SA3 实测复核（§5 反证门） | 中 |
| P6 | 构造期校验对合并结果生效与既有机制同构（A1-2 语义） | 源码引用 + 现有测试引用 | `validate.ts` 既有链式校验（L120-152）全部作用于 resolve 后合并值；`hub-connection.ts:61-64`/`peer-connection.ts:71-76` resolve→validate 时序；A3-2 绿锁（pongTimeout < pingInterval TypeError）为同款现役行为 | 低 |
| P7 | 类级直构 fixture（QUEUE_LIMITS/D4_LIMITS）不经过 `validateLimits` | 源码引用 | `backpressure.ts:60-70` ConnectionSender 构造不调用 validate；两 fixture 以 `as ResolvedLimits` 直传（`ws-replication-review-revisions-r1-r7-red.test.ts:457`、`ws-replication-sa7-round2-dynamic.test.ts:688-699`） | 低 |
| P8 | `PONG_TIMEOUT` 不在连接错误注册表（A3-1 双偏差之一） | 源码引用 | `packages/replication-protocol/src/errors.ts:11-28` ConnectionErrorCode 17 字面量无 PONG_TIMEOUT；`:92-110` 注册表同 | 低 |
| P9 | 缺省额度 64KiB → 8MiB 使 `ws-replication-sa7-r2-transport.test.ts` B 侧（73KiB control）结构性失效；单连接暂停段 control 上界 = Σ_ns min(窗口 32) 使 8MiB 缺省在真实链路不可达 | 现有测试引用（文件自述结构约束）+ 算术 | 该文件头 L14-17「单连接暂停段内可达 control 流量上界 = Σ_ns min(窗口 32)……B 取 40 ns × 32 = 1280 ACK（≈73KiB > 64KiB）」——8MiB / (73KiB/1280) ≈ 146K ACK ≈ 4,570 ns，结构性不可达；SA3 迁移后实测复核（§5 矩阵 r2-transport 行） | 低（算术自证） |
| **P10（R2 新增，SA2 §2 补缺）** | **零覆写依赖缺省额度耗尽的用例全仓恰两处**（r2-transport B 侧、sa7-issue137-dynamic D3b）——二者均已纳入迁移（T12/T6-D3b），无第三处漏网 | 现有测试引用 + 全仓审计 | `git grep -l "CONNECTION_BACKPRESSURE" packages/ws-replication/test` = 7 文件，逐一核 limits 覆写：①`issue137-r2-red`（R2-4 显式额度）②`issue172-anchors`（A1-3 显式 1_500）③`r1-r7`（QUEUE_LIMITS 显式 32KiB 类级）④`sa6-hardening-g3-g4`（A2 锚依赖**不耗尽**：~1.2KB ≪ 64KiB ≪ 8MiB 双向成立；SHED/RESYNC 断言走显式 SHED_LIMITS）⑤`issue137-ac1-ac7`（AC-6b 存活侧，~KB 级流量 ≪ 两代缺省）⑥`sa7-r2-transport`（零覆写 B 侧 → T12）⑦`sa7-issue137-dynamic`（D3a/D3c 显式、**D3b 零覆写 → T6-D3b**）。另：`ac3-bootstrap.test.ts:80` 显式 `maxBootstrapBytes: 64`（未覆写额度；8MiB ≥ 192 兼容，其 BOOTSTRAP_TOO_LARGE 断言只依赖 mBB 自身） | 低（清单式审计可重跑） |

其余设计决定（文档措辞、断言消息修正）不构成协议级假设。

## §9. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数/类型

| 对象 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `ReplicationLimits.controlReserveBytes` | `packages/ws-replication/src/types.ts:29` | `readonly controlReserveBytes: number`（缺省 64 KiB） | **删除**，由 `readonly maxQueuedControlBytes: number`（缺省 8 MiB）取代 |
| `DEFAULT_REPLICATION_LIMITS` | `packages/ws-replication/src/defaults.ts:16-28` | 含 `controlReserveBytes: 64*1024` | 含 `maxQueuedControlBytes: 8*1024*1024` |
| `validateLimits` | `packages/ws-replication/src/validate.ts:107` | 不校验 control 额度下界 | 合并结果违反 `maxQueuedControlBytes ≥ maxBootstrapBytes + 128` → 同步 `TypeError`（**新增 throw 路径**） |
| `ConnectionSender.sendControl` | `packages/ws-replication/src/backpressure.ts:77-88` | 额度判据读 `controlReserveBytes` | 读 `maxQueuedControlBytes`（行为等价、阈值随配置/缺省变化） |

### Caller 清单（`ReplicationLimits` 字段消费点 / 构造器新 throw 路径的调用方）

| Caller | 文件:行 | 是否受 throw 影响 | 直接 try/catch | 处置方案 |
|---|---|---|---|---|
| `validateLimits`（hub 构造） | `hub-connection.ts:63`（`createHubReplication` 构造体） | 是（新增 TypeError 路径） | ❌ 裸调用（构造函数，预期向调用方同步抛出） | 测试期望行为（A1-2 锚）；仓内生产 caller 为零（`apps/` 空置、包 `private: true` 无外部消费者——`packages/ws-replication/package.json`） |
| `validateLimits`（peer 构造） | `peer-connection.ts:74`（`createPeerReplication` 构造体） | 是 | ❌ 同上 | 同上 |
| 记账判据 | `backpressure.ts:81` | 否（纯读字段） | N/A | §3.1 改名接线 |
| 正整数校验 | `validate.ts:118` | 否 | N/A | §3.1 改名接线 |
| 类型形状锁 | `test/ws-replication-api.test-d.ts:124-136` | 否（typecheck 期） | N/A | §3.2-T2 改名 |
| 镜像常量 | `test/harness.ts:42-53,127-139` | 否（无构造消费） | N/A | §3.2-T1 改名 + 8 MiB |
| 构造期 fixture（经校验） | `ws-replication-issue172-contract-anchors.test.ts:83,96,104-115`；`ws-replication-issue137-r2-red.test.ts:383-390,434-438`；`ws-replication-sa7-issue137-dynamic.test.ts:254-264,321（bootLocal 新传 limits）,364-372`；`ws-replication-sa7-r2-transport.test.ts:222,245`（hub+peer 双构造） | 是（旧小额度值/旧缺省边界采样将 TypeError 或永不耗尽——R2/SA2 #1：D3b 属后者且零字面） | ❌（测试直构，抛出=用例失败=期望信号） | §1-D4/D4-bis：同 limits 追加 `maxBootstrapBytes: 1_024`（D3b 单列 92_000 档；r2-transport 另加显式 `maxQueuedControlBytes: 64_000`）恢复合法/恢复可耗尽 |
| 类级直构 fixture（不经校验） | `ws-replication-review-revisions-r1-r7-red.test.ts:457-469`；`ws-replication-sa7-round2-dynamic.test.ts:688-699` | 否 | N/A | 仅改名（否则字段 undefined → NaN 判据永不耗尽 → R2-A2a/D4 当场反红，自守卫） |
| `DEFAULT_REPLICATION_LIMITS` 直接消费 | `test/ws-replication-issue172-contract-anchors.test.ts:37,67`（A1-1）；`test/ws-replication-api.test-d.ts:17,173` | 否（读值/类型） | N/A | A1-1 断言新字段 8 MiB——收敛后即绿 |

**行为变化面**：缺省额度 64 KiB → 8 MiB（暂停段 control 字节容限扩大 128×——所有未显式配置额度的既有测试场景 control 流量 ≪ 8 MiB，零行为显影）；显式小额度配置从「静默生效」变「构造期 TypeError」（D4 fixture 合法化覆盖）。**无运行时（构造后期）新增 throw**——throw 只在构造函数同步段，与既有 `pongTimeoutMs < pingIntervalMs` 校验同相位。

抓全方法复核（SA4 可复跑）：
```bash
git grep -n "controlReserveBytes" -- 'packages/**/*.ts'   # 改后预期零命中（§5 门禁）
git grep -n "\bcreateHubReplication\s*(\|\bcreatePeerReplication\s*(" -- 'packages/**/*.ts' 'apps/**/*.ts' | grep -v "src/hub-connection.ts\|src/peer-connection.ts\|src/index.ts\|src/testing.ts"   # 全部 caller = 测试文件
```

