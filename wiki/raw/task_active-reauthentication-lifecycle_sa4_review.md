# SA4 静态验尸报告 — task_active-reauthentication-lifecycle（issue #175）

**Date**: 2026-08-30（R1 静态验尸 + R2 固定范围复验，同日）
**Verdict**: R1 **reject**（唯一阻断项 F-1：HG9 版本 bump 缺失；实现代码零缺陷，8 个技术维度全部独立验证通过）→ **R2 pass**（F-1 回流两项均按 R1 处方精确落地——commit `6c7d9cf` 仅 version 一行 0.1.2→0.1.3 + SA1 design §3/§13/§14 治理出口补齐；src/test 零变化，R1 §1-§8 与 V1-V6 证据全部携带有效。详见文末「SA4 R2 复验（固定范围）」）

- 被审对象：commit `0d80a36`（`fix(ws-replication): Hub 主动 reauth 生命周期实现（issue #175）`，5 文件 +579/−2：src 三文件 + SA6 owned 红测/driver 镜像两件随附）
- 依据输入：任务简报 `task_active-reauthentication-lifecycle.md`、SA5 `20260830-bug-active-reauthentication-lifecycle.md`、SA1 设计 `..._design.md`（§1-§15）、SA2 `..._sa2_review.md`（verdict pass，三裁决维持 SA1）、SA3 `..._sa3_impl.md`
- 独立性声明：本评审未采信 SA1/SA2/SA3 报告的任何断言为前提；设计三腿逐行对照源码复核、红灯套件与冻结绿套件独立复跑、CI 触发面与版本台账独立考古。

---

## 0. 独立验证证据（全部命令在 worktree 根实跑）

| # | 命令 | 结果 | 判定 |
|---|---|---|---|
| V1 | `npx vitest run packages/ws-replication/test/`（独立后台进程，exit 码落盘） | **25 files / 181 tests passed，Type Errors: no errors，EXIT=0** | 与 SA3 自报逐字一致；红灯套件 6/6 绿、三冻结绿套件零回归 |
| V2 | `git diff-tree --no-commit-id --name-only -r 0d80a36` | 恰 5 文件（src 三 + red.test + driver.ts） | scope 比对输入 |
| V3 | `git show 0d80a36:packages/ws-replication/package.json \| grep version` vs `git show 0df6583:...` | 双侧 `"version": "0.1.2"`；commit 对 package.json diff = 0 行 | **F-1 证据** |
| V4 | `grep -rn "console\.\|process\.env" packages/ws-replication/src/` | 零命中 | AC7 零日志面结构保证 |
| V5 | `grep -rn "implements HubReplication\|implements PeerReplication" --include='*.ts' packages/ apps/ domains/` | 恰两命中（本包 HubReplicationImpl/PeerConnectionImpl） | §1.6 实现者抓全 |
| V6 | `.github/workflows/ci.yml` + `vitest.config.ts` + 根 `package.json` scripts | `pnpm test` = `vitest run --typecheck`，include `packages/*/test/**/*.test.ts`；`pnpm typecheck` 含 `tsc -p packages/ws-replication/tsconfig.json` | 新测试文件 CI 触发接通 |

---

## 1. 设计一致性审查

### 1.1 文件清单 Scope Creep Guard — ✅ 通过

- SA1 design §13 ALLOW LIST 存在（5 条目）。actual diff（V2）= 5 文件，**逐一落在 ALLOW LIST 内**：
  - `src/types.ts` / `src/hub-connection.ts` / `src/peer-connection.ts` — 显式 ALLOW（修改）✓
  - `test/ws-replication-reauth-lifecycle-red.test.ts` / `test/driver.ts` — `[SA6 owned]` 条目；其 diff 为 SA6 阶段产物（冻结 seam 镜像 + 红灯套件 + SA2 裁决的两处锚点修正），与 SA3 实现同提交收录——repo 既有惯例（PR #162/#173 同型），SA3 报告如实申报 ✓
- DENY LIST（`hub-namespace.ts`/`peer-namespace.ts`/其余 src 12 文件/`replication-protocol/**`/协议 docs/apps/domains）：diff 零命中 ✓
- BLACKLIST（package-lock.json / yarn.lock / .DS_Store / TASK.md / *.bak）：零命中 ✓
- 豁免白名单无需动用（无 wiki/pnpm-lock 之外的越界项）。

### 1.2 设计偏离审查 — ✅ 一致（逐腿逐行核对）

| 设计条款 | 实现锚点 | 判定 |
|---|---|---|
| §4.1 `requestReauth`：closed 早退 + 拷贝迭代 + `authenticatedInstanceId` 键 + 同步 beginReauth | hub-connection.ts:219-225 | 逐行一致（注释含 resolve 语义说明） |
| §4.2 `beginReauth`：`closedFlag\|\|reauthRequested` 守卫、handshaking 分支直发 close(1001)、`state='draining'`、GOAWAY(REAUTH_REQUIRED, closeTimeoutMs) 直发、catch → fail-closed close(1001)、deadline 回调 closedFlag 守卫 | :365-392 | 逐行一致（含 §4.5 直发豁免注释） |
| §4.2 `cleanupAll` 头部清 `reauthDeadlineHandle` | :599-602（四条收口路径 :335/:593/:630/:673 全部经 `void this.cleanupAll()`，同步段首行清句柄——首个 await 之前） | 一致 |
| §5 `notifyAuthChanged`：stopping 早退 + blocked 门 + `requestRebuild('auth-change')` | peer-connection.ts:190-194 | 一致 |
| §6.1 onGoaway blocked 分支：`enterBlocked()` **之后** `drainMs>0 → armBlockedDeadline()`（顺序正确——enterBlocked :692 首段 clearDrainClose，先武装会被清） | :419-424 | 一致（`goawayDrainMs` 于 :414 先赋值） |
| §6.2 `armBlockedDeadline`：clearDrainClose + 捕获 transport + 复用 `drainCloseHandle` + 回调状态守卫 + `close(1001,'blocked-deadline')` | :455-465 | 一致 |
| §6.3 drain=0 不武装 | :424 `> 0` 条件 | 一致（D5-B1 冻结语义） |
| §6.4 `requestRebuild` 追加 `clearDrainClose()` | :738 | 一致 |
| §3 types.ts 两接口纯新增 + 头注引注（SA2 MINOR #2） | types.ts:1-8, :126-130, :162-163 | 一致；既有成员零变化 |
| SA2 裁决一/二修正（IT4 drain=300_000 / IT6 toBeUndefined 变体） | red.test.ts:343 / :443 | 均按裁决落地 |

**零危险偏离**。handshaking 分支、双 reasonCode 武装、drain=0 豁免三处均按 SA2 裁决后的设计口径实现。

### 1.3 E2E spec 触发性 — ✅ N/A→通过

本任务无 `*.spec.ts`（纯 vitest）。见 §1.4。

### 1.4 vitest 触发性 — ✅ 通过

- 新增 `packages/ws-replication/test/ws-replication-reauth-lifecycle-red.test.ts` 所在 workspace package = `@nomicore/ws-replication`。
- CI（`ci.yml` Test 步）= `pnpm test` = `vitest run --typecheck`，`vitest.config.ts` include `packages/*/test/**/*.test.ts` → **该文件被 CI 全量覆盖**（V6）；`--typecheck` 同步覆盖 `api.test-d.ts` 结构断言；Typecheck 步含 `tsc -p packages/ws-replication/tsconfig.json`。无孤儿 spec。

### 1.5 协议假设审查 — ✅ 通过（章节在位，锚点逐条复验）

SA1 §11 存在（9 条，全带源码/测试/实测依据，零「应该/通常」）。本轮抽验 6 条关键依据全部与 HEAD 源码吻合：
- 依据 1：`frame-io.ts` `sendControl` = push + **同步** `drain()`（:126-129）✓
- 依据 2：`validate.ts` `validateTimeouts` 对 `closeTimeoutMs` 施加 positiveSafeInteger（:166）+ `defaults.ts:38` 5000 ✓ → 冻结契约「drainTimeoutMs>0」由构造期保证
- 依据 3：`harness.ts:585` `if (self.closed) return`（close 幂等）+ 对端观测语义 ✓
- 依据 5：`peer-connection.ts:590` blocked 早退 ✓
- 依据 6：handshaking 非 HELLO_ACK → CONNECTION_POLICY_VIOLATION（:284-291）✓
- 依据 8：四收口路径汇聚 cleanupAll（:335/:593/:630/:673）✓
- 协议文本独立核对：§6.3 L141「接收时开始计算本地 elapsed deadline」（字段级规则，不分 reason——双 reasonCode 武装为协议忠实读法）；L149「之后**发送方**以 WS 1001 关闭」；§15.1 L437 `REAUTH_REQUIRED`→blocked 等待 token/config 变化；L450「已建立连接只有在认证/授权 Adapter 主动发 reauth/revoke 事件时关闭」；§15.2 FSM `ready→draining→closed`（beginReauth 的 state 迁移合法）——**设计三腿与协议逐条对得上**。

### 1.6 契约改动连锁审查 — ✅ 通过（无既有契约变更）

- diff 全为**新增**（两接口新成员 + 两私有方法 + 三处私有方法行为增强）；零 `return→throw`、零同步变异步、零 catch 吞→rethrow、零可空性翻转。
- 新公共方法唯一生产 caller = 组合根（切片 9 未建）：全仓 `requestReauth|notifyAuthChanged` grep 仅本包定义/实现 + 测试镜像（V5 佐证接口实现者唯二，外部零 `implements`）。
- 被增强私有方法 caller 全部包内同步调用，零新增 throw 面（timer map 操作同步、`armBlockedDeadline`/`beginReauth` 回调只调既有同步 `close()` 路径）。
- `seam 永不 reject` 论证复核成立：`sendControl` 异常在 `beginReauth` 内 catch + fail-closed（hub-connection.ts:383-386）；`notifyAuthChanged` 同步零 throw。红灯套件 6 IT 全挂 `collectUnhandledRejections` 探针且全绿（V1）。

### 1.7 测试质量：源码 GREP 断言禁令 — ✅ 通过

`ws-replication-reauth-lifecycle-red.test.ts` 全文零 `readFileSync`、零对源码字符串的 `toMatch/toContain`；全部断言锚定运行时可观测面：wire 帧解码（`hubGoaways`/`hubFramesAll`）、连接/namespace 状态投影、dialCount/verifyCalls 记账、双侧 close info、全 wire 字节 token 序列扫描（`tokenLeaksOnWire`）。真实 yjs/Registry/Runtime 双实例 + fake-duplex/fake scheduler（测试基建，非 mock 被测对象）。driver.ts 镜像（HubReauthSeam/PeerAuthNotifySeam/tokenSource）与简报 §SA6 冻结契约逐字段一致。

---

## 2. 读写路径一致性 — ✅ 一致

状态机单点写读：`connStateValue` 经 `setState` 单点写、`getConnectionState()`/回调守卫读；GOAWAY 出站 = outbound.sendControl → wire → peer decodeMessage 入站，同一条 wire 双向闭环；`authenticatedInstanceId` 写于 accept 分配期（hub-connection.ts:273）、读于 requestReauth 键匹配（:222）——同源。无数据源分叉。

## 3. 静默失败扫描 — ✅ 无

逐路径 trace（beginReauth 三出口 / deadline 回调双守卫 / notifyAuthChanged 四状态门 / armBlockedDeadline 回调双守卫 / requestReauth 三分支）：每条路径均有 wire 可观测（GOAWAY 帧 / close 码+reason）或状态可观测（state/connState 投影）效果；三类 no-op（未知身份 / 非 blocked 通知 / drain=0）均为冻结契约明文语义（设计 §9 合法降级表），且有 IT2/IT4/D5-B1 锚定——非静默失败。GOAWAY 发送失败 → `close(1001,'hub-reauth')` fail-closed（响亮）。

## 4. 降级方案审查 — ✅ 安全

§9 五行降级逐项独立复核成立（未知身份 no-op = 键查询语义 + 断线天然竞态；非 blocked 通知 no-op = 无待恢复事实，backoff 重拨本就读当前凭据；drain=0 不武装 = D5-B1 冻结语义 + 生产恒 >0；send 失败 = fail-closed 非吞）。无 env-override/软兜底（SKILL 禁令 1 合规，V4 零 process.env 命中）。

## 5. 极端条件攻击 — ✅ 安全（静态可确认面）

- `requestReauth(null/''/超长/畸形)` → 零匹配 → resolve（纯 string 等值比较，无解析、无崩溃）；键空间受 `isValidInstanceId` 构造期验证约束。
- wire 巨值 drainTimeoutMs → 长 timer，但 `enterBlocked` 不停 liveness（stopLivenessNow 仅 stop:118/dialNow:203）——ping/pong 继续值守，pong 超时 1001 收传输（§15.1 L524），wire 生命周期仍有界（SA2 3b backstop 成立）。
- 同 tick `requestReauth` ↔ `hub.close()` 双序推演通过（§4.6：cleanupAll 同步段清 reauth deadline，stale fire 双守卫；IT5-2 锚定）；`requestReauth` ↔ 同身份新 `accept()` 竞态 = 迭代错过新连接（契约无害，幂等重发覆盖——SA2 攻击点 3，登记 SA7 动态面）。
- transport 已断后 beginReauth：sendControl 静默跳过（emit 回调 `!transport.closed` 门）→ deadline 至 close() 时 transport.closed 门内 skip、cleanupAll 照常 drop——收敛无泄漏。
- 第二条 blocked GOAWAY：onMessage 状态门（:267，blocked ≠ handshaking/ready）丢弃——两 deadline 不共存（§6.5 互斥成立）。
- 重复 notifyAuthChanged / 通知与 addTarget 交叠：`rebuildPending` + blocked 门收敛为一次重建。

## 6. 错误处理链路 — ✅ 完整

全部分支有状态写入与可观测反馈（见 §3）；`requestReauth`/`notifyAuthChanged`/两 deadline 回调全路径零 throw（§1.6）；timer 纪律矩阵：hub `reauthDeadlineHandle` 清除点 = cleanupAll 单点（覆盖全部四收口路径）+ 回调 closedFlag 守卫；peer `drainCloseHandle` 清除点 = stop:116 / dialNow:201 / requestRebuild:738（新增）/ onGoawayClosed:616 / onClose draining:599 / enterBlocked:692 + 回调状态守卫——**无泄漏路径，双重满足**。blocked 期 onClose 早退后残留 deadline 至多 fire 一次且 transport.closed 门内 no-op（有界，非泄漏）。

## 7. 架构评估 — ✅ 可行

三腿设计（Hub 主动侧 / Peer 恢复缝 / receiver 侧 deadline）互相独立、全部复用既有收口拓扑（close()/cleanupAll/requestRebuild）；零绕过、零 FIXME、零临时补丁；未触碰 revoke 语义（ADR-0010 条款 3 正交性保持）。无退回 SA1 信号。

## 8. 过度设计审查 — ✅ 精简

src 净 +106 行对 5 缺陷点（SA5 根因表），与设计估算（≈10+45+35）吻合；零新抽象层、零新 knob（drain 预算复用 closeTimeoutMs）、零不可能边界防御。变更半径恰为 Bug 影响面。

---

## 9. 🚨 REJECT 级发现（本轮唯一阻断项，固定复验范围）

### F-1【MAJOR·治理/台账】`@nomicore/ws-replication` 漏 Hard Gate #9 版本 bump（0.1.2 未动）

**事实（可复现）**：

```bash
git show 0d80a36:packages/ws-replication/package.json | grep '"version"'   # 0.1.2
git show 0df6583:packages/ws-replication/package.json | grep '"version"'   # 0.1.2（父提交，同值）
git diff-tree --no-commit-id --name-only -r 0d80a36 | grep package.json    # 零命中
```

commit `0d80a36` 改动该包 **3 个 src 文件**，且向**冻结公共 API 面**新增两个方法（`HubReplication.requestReauth` / `PeerReplication.notifyAuthChanged`，types.ts:126-130/:162-163）——package.json version 零变化。

**违反的仓库门禁**（独立考古，非本任务文档自创）：

1. **MABF 硬门禁 #9**：「所有改过代码的模块必须 bump patch 版本号」。仓内多次成文：`task_ws-replication-hardening_design.md:905`（**本包先例**：12 src 文件改动 → 0.1.0→0.1.1，SA4 R1 曾把 bump 的 ALLOW 治理列为阻断项 R2 处置）；`task_phase5-ws-multiplex-backpressure-r2_sa4_review.md`（**本包先例**：0.1.1→0.1.2，SA4 验收第 5 条）；`task_vfsl-codegen_dispatch.md`、`task_namespace-runtime-registry-seam_design.md:121` 等。
2. **公共面变更 = 最强触发**：「公共面/源码变更随 PR bump patch 位」（`task_phase5-replication-identity-epoch-rev1_standards_review.md` ⑤）；vfsl 先例「公共面新增导出 = minor bump（仓内 0.1.x 节奏 → patch）」（`task_vfsl-validate-patch_design.md` §8）。本任务**两者都占**。
3. **同类缺陷先例 = 终审 BLOCKER**：commit `942ac31`（#149）终审 BLOCKER-2 原文「namespace-runtime **漏 version bump**（仓库『逐变更 patch bump』惯例）」——修复 commit 即补 bump 一行。
4. **设计侧同步缺口**：design §13 ALLOW LIST 对 `packages/ws-replication/package.json` **只字未提**（既未授权也未豁免）——bump 的治理出口从未打开（对照 hardening 任务的正规出口写法）。任务简报/设计/dispatch 全文零 version/bump 字样（grep 实证）。

**影响**：包版本对已交付公共 API 面说谎（0.1.2 面向的是 #137 R2 的 ReplicationLimits 面，不含 reauth seam）；违反仓库硬门禁 #9；本仓 Standards 轴终审对该缺陷类有 BLOCKER 先例，PR 终审必然复发。技术面零影响（零运行时依赖该字段；`private: true`）——故为治理级而非代码级。

**回流目标与固定复验范围（可共同修复集合，一次回流）**：

| Owner | 动作 | 半径 |
|---|---|---|
| **SA3** | `packages/ws-replication/package.json` version `0.1.2` → `0.1.3`（**仅此一行**，exports/deps/scripts 零改动——hardening 任务同款边界） | 1 行 |
| **SA1** | design §13 ALLOW LIST 追加 `packages/ws-replication/package.json` 条目：注明「仅限 version patch bump 一行（0.1.2→0.1.3），HG9 强制 + hardening/backpressure-r2 本包先例」，并在 §14 回应表补一行 | 2 行级 |

**SA4 复验承诺**：回流后仅复验该两处 diff（version 行 + design §13/§14），其余全部维度（§1-§8 + V1-V6 证据）本轮已验证通过并直接携带，无需重跑套件。附带登记（一行说明即可，不另立阻断项）：本分支上 #138 两提交（`01e6801`/`35b68a5`）同样未 bump，按仓内判例（`task_persistence-create-doc_sa4_review.md` R1 备案修正）属台账缺口而非门禁豁免；本任务 0.1.2→0.1.3 一并覆盖 PR #162 以来的累计漂移。

---

## 审核结论汇总

1. 设计一致性：✅ 一致（§1.2 逐行核对，零偏离；SA2 三裁决口径全部落实）
2. 读写路径一致性：✅ 一致（状态机单点写读 + 同 wire 双向闭环）
3. 静默失败：✅ 无（三类 no-op 均为冻结契约语义 + 测试锚定）
4. 降级方案：✅ 安全（§9 五行逐项成立；fail-closed 非吞）
5. 极端攻击：✅ 安全（畸形身份/巨值 drain/双序竞态/双 GOAWAY/transport 先断——静态全收敛）
6. 错误处理：✅ 完整（零 throw 面 + timer 纪律双重满足 + 6 IT 零 unhandled rejection 实证）
7. 架构评估：✅ 可行（三腿独立、全复用既有拓扑、无退回信号）
8. 过度设计：✅ 精简（+106 行对 5 缺陷点，零新抽象零新 knob）
9. 范围/触发性/测试质量：✅（ALLOW LIST 内 5 文件、DENY/BLACKLIST 零命中、CI vitest 全覆盖、零源码 grep 断言、IT4/IT6 裁决修正落地）
10. **版本 bump：❌ F-1（HG9 缺失，REJECT——唯一阻断项）**

**Verdict: reject**（仅 F-1；实现与测试零返工。F-1 两行级修复落盘后 SA4 仅复验该固定范围即可转 pass）。

---

## 动态审核重点（交 SA7，`task_active-reauthentication-lifecycle_sa7_report.md` 逐条回复）

1. **真实 socket 事件序**（SA2 红线思路 2）：真实 WS 版 hub 主动 reauth → peer 原始 socket 事件序 `frame:GOAWAY(REAUTH_REQUIRED, drain>0)` → drain 窗保持开放 → `close(1001)`；双侧 close reason 为静态码（'hub-reauth'/'blocked-deadline'）零 token（r1-transport-auth D4 同款基建）。
2. **requestReauth ↔ accept 同 tick 竞态**（SA2 攻击点 3）：`callReauth` 与 `hub.accept(newWire)` 背靠背 → 断言二次 requestReauth 覆盖新连接（恰再 1 GOAWAY），零 unhandled rejection。
3. **SHUTTING_DEADLINE 武装后半段**（SA2 红线思路 4）：注入 `GOAWAY(SERVER_SHUTTING_DOWN, drain=60)` + `advanceBy(60)` → wire 1001 收口且 **state 仍 blocked**（不 backoff、不重拨）——G2 只覆盖 fire 前半段。
4. **drain=0 × REAUTH_REQUIRED**（SA2 红线思路 5）：注入 `drainTimeoutMs:0` → `pending()` 计面不增、wire 冻结、blocked 保持（把 D5-B1 语义从 SHUTTING_DOWN 扩展锚到 REAUTH）。
5. **receiver deadline ↔ rebuild 先后序镜像锚**（SA2 红线思路 1）：`advanceMs(drainTimeoutMs + 60_000)` 无通知 → 旧 wire 以 1001（blocked-deadline）收口且仍 blocked——防未来实现把 deadline 挪到 rebuild 之后。
6. **blocked 期 liveness backstop**（SA2 3b）：巨值 drain（如 300s）+ 无通知 → pong 超时路径 1001 收传输（§15.1 L524），wire 生命周期有界。

---

# SA4 R2 复验（固定范围）— F-1 回流核验

**Date**: 2026-08-30
**复验范围**：仅 R1 §F-1 处方的两项回流（SA3 bump commit + SA1 design touch-up）及其直接影响面。按 R1 承诺，不重跑测试套件——src/test 零变化已实证（R2-V3），R1 V1（25 files / 181 tests / typecheck exit 0）携带有效。

## 复验证据（全部命令实跑）

| # | 检查项 | 命令/锚点 | 结果 | 判定 |
|---|---|---|---|---|
| R2-V1 | bump commit 恰一行一字段 | `git show 6c7d9cf`（full diff） | 恰 1 文件 `packages/ws-replication/package.json`、恰 1 行 `-  "version": "0.1.2",` / `+  "version": "0.1.3",`；exports/scripts/dependencies/private 零触碰（其余字段冻结的授权边界被精确遵守） | ✅ |
| R2-V2 | HEAD 版本落位 | `grep '"version"' packages/ws-replication/package.json`；`git rev-parse --short HEAD` = `6c7d9cf` | `"version": "0.1.3"` | ✅ |
| R2-V3 | src/test 零漂移（R1 证据携带前提） | `git diff 0d80a36..6c7d9cf --name-only -- packages/ws-replication/src/ packages/ws-replication/test/` | 0 文件——实现与测试代码自 R1 验尸后零变化，R1 §1-§8 技术结论与 V1-V6 证据全部携带有效 | ✅ |
| R2-V4 | SA1 design §13 ALLOW LIST 治理出口 | design.md:434 | 新条目「（SA4 R1 F-1 修订追加）修改，**仅** version patch bump `0.1.2 → 0.1.3`（1 行……）**不得**触碰其余任何字段（scripts/exports/dependencies 冻结）」；:450 比对说明同步更新（actual diff 预期含 package.json 仅 version 一行） | ✅ |
| R2-V5 | SA1 design §3 正文锚点 | design.md:78（§3 末条） | 「公共面扩展伴随包版本 patch bump（SA4 R1 F-1）……HG9：公共 API 面变更必须升版——本任务净增 `requestReauth`/`notifyAuthChanged` 两个公共方法……仅 version 字段一字段改动，其余字段冻结」——ALLOW 条目的正文章节锚点立法满足 | ✅ |
| R2-V6 | SA1 design §14 回应表 | design.md:458 | F-1 行：要求/✅ 落实/修订位置（§13 第 4 条 + §3 末条）/内容摘要——回流闭环留痕完整 | ✅ |
| R2-V7 | 授权 ↔ 实际 diff 精确一致 | R2-V1 ↔ R2-V4 | ALLOW 授权「仅 version 一行 0.1.2→0.1.3」；commit 实做恰此一行、无多无少——治理授权与分支现实一致化（doc-runtime R3 F-R3-1 同型闭环标准） | ✅ |
| R2-V8 | 工作树卫生 | `git status --short`（tracked 文件） | 零漂移；仅 wiki/raw 任务档案 untracked（收尾步骤统一入库的既有惯例） | ✅ |

## 复验结论

- **F-1 两项回流均按 R1 处方精确落地**：SA3 `6c7d9cf` = 恰一行版本 bump（授权边界内）；SA1 §3/§13/§14 三处 touch-up = 治理出口显式登记 + 正文锚点 + 回应表留痕。
- F-1 消除：`@nomicore/ws-replication` 版本台账与交付公共 API 面一致（0.1.3 含 reauth seam）；HG9 履行；与 hardening（0.1.0→0.1.1）/backpressure-r2（0.1.1→0.1.2）本包先例同型。R1 附带登记的 #138 两提交台账缺口亦被本次 0.1.2→0.1.3 一并覆盖（PR #162 以来累计漂移收敛）。
- INFO（非阻断，无需处置）：SA1 引用的 patch 先例取 doc-runtime `0.1.11` / namespace-registry `0.1.6`，与 R1 报告引用的本包自身先例（hardening 0.1.1 / backpressure-r2 0.1.2）与 #149 BLOCKER-2 判例互补不冲突——规范力同源（HG9），引用选择属 SA1 裁量。
- 其余维度：R1 §1-§8（设计一致性/scope/CI 触发性/契约连锁/测试质量/读写路径/静默失败/降级/极端攻击/错误处理/架构/过度设计）与 V1-V6 独立验证证据经 R2-V3 实证携带有效，零复验需求。

## **R2 Verdict: pass**

F-1 固定范围复验通过，R1 全部技术结论维持。SA7 可进入动态验证（重点清单见上节 6 条）。
