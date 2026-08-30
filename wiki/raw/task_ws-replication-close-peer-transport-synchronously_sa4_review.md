# SA4 静态验尸报告 — issue #168（恢复轮 1）

**Date**: 2026-08-30（恢复轮 1：仅审 `git diff ffca4f6..HEAD`，不审谱系提交）
**Reviewer**: SA4（静态绿光验尸）
**Verdict**: pass（终裁依据见 §8；动态复核点 3 项移交 SA7，均非阻断）

## §0. 审核范围与输入

- **Diff 范围**：`git diff ffca4f6..HEAD`（单 commit `1092d34`），共 11 个文件：
  - 生产代码 1 个：`packages/ws-replication/src/peer-connection.ts`（+70/-26 中的源码部分）
  - 测试 2 个：`packages/ws-replication/test/ws-replication-issue168-hello-timeout-close-peer-red.test.ts`（新建 415 行，SA6 Phase 1 契约）、`packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts`（D5 翻转，34 行改动）
  - wiki/raw 档案 8 个（任务简报/SA5 报告/design/SA2 评审/conflict 报告/dispatch/relevant_decisions——流水线档案，白名单类）
- **已读输入**：任务简报（含 SA6 红灯契约与红灯证据）、SA5 分析报告、SA1 design（§0–§11 全文）、SA2 评审、dispatch log（记录 SA3 曾做「fixture 字段修正——红路径不再短路后暴露」，本审核重点核对象）。
- **基线**：`ffca4f6`（= PR #185，SA8 前置门禁确认）。

## §1. 文件清单 Scope Creep Guard（SKILL §1.1）

**ALLOW LIST 抽取**（design §9）：

| 文件 | ALLOW 状态 | diff 中状态 |
|---|---|---|
| `packages/ws-replication/src/peer-connection.ts` | ALLOW（修改） | ✅ 在 diff（唯一生产代码改动） |
| `packages/ws-replication/test/ws-replication-issue168-hello-timeout-close-peer-red.test.ts` | ALLOW（`[SA6 owned]` 新建） | ✅ 在 diff（新建——SA6 Phase 1 产物随本 commit 入库，基线 ffca4f6 早于 SA6 写入） |
| `packages/ws-replication/test/ws-replication-sa7-round2-dynamic.test.ts` | ALLOW（`[SA6 owned]` D5 翻转） | ✅ 在 diff（D5 段 + 头注释，D1–D4 零改动——diff hunks 仅覆盖 D5 describe 块与文件头 D5 描述行） |

**DENY LIST 核验**：`hub-connection.ts`、`liveness.ts`、`peer-namespace.ts`、`types.ts`、`defaults.ts` 等全部 DENY 项**均不在 diff** ✅。docs/protocols、docs/adr 零改动 ✅。

**超 ALLOW 文件**：diff 中除上述 3 个代码/测试文件外仅 `wiki/raw/*` 档案（命中白名单 `^wiki/raw/task_` 与 `^wiki/raw/[0-9]{4}-…-bug-`）。

**BLACKLIST**：无 `TASK.md`、无 `package-lock.json`/`yarn.lock`、无 `.bak`、无 `.DS_Store` ✅。

**结论：scope-creep = 0。**

## §2. 设计一致性审查（SKILL §1.2）——逐处对照 design §4

**改动 1：新增私有 helper `detachCloseTimedOutTransport`（:609-644）**
- 与 design §4.1 **逐字一致**：身份断言 fail-loud（`this.transport !== transport` → throw，SA2 #2 落实）；四步序列 `stopLivenessNow → unsubscribeTransport → epoch+=1 → if (!transport.closed) close(1001, reason)`；close 包 try/catch 吸收 adapter 违约 throw（SA2 #3 落实，backoff 恢复链不被劫持）；reason 类型收窄 `'pong-timeout' | 'hello-timeout'`（未放宽到 PeerBackoffReason）✅。

**改动 2：pong-timeout 调用点机械提取（:421-429）**
- 前置守卫（`stopping` / transport 身份+代际双凭据）原样保留；原四步内联序列替换为单一 helper 调用；`onTemporaryFailure('pong-timeout', true)` 原样。唯一差异 = close 外多包 try/catch（design 明示的统一防护，非行为偏离）。执行顺序与 ffca4f6 现状完全一致 ✅。

**改动 3：`armHello(transport)` 重写（:942-960）**
- 签名参数化 + 武装时刻捕获 epoch（:944，与 dialNow :285-286 同一同步栈，中间零递增——`this.connectionEpochValue` 在 :286 与 :944 之间无任何写点，双凭据与订阅闭包 :334-337 的 epoch 同源）✅。
- 守卫层次与 design §4.3 完全一致：`stopping` → 状态（`!== 'handshaking'` 返）→ 双凭据 → helper → `onTemporaryFailure('hello-timeout', true)` ✅。
- epoch 净效果核算：helper 内 +1、`epochAlreadyInvalidated=true` 防二次递增——与修复前 `onTemporaryFailure` 单次 +1 等价，无代际跳变 ✅。

**改动 4：`dialNow` 调用点（:333）** `this.armHello(transport)`——`transport` 局部变量在 :295 已赋值给 `this.transport`，身份不变量结构成立 ✅。

**改动 5：`onTemporaryFailure` 头注释替换（:880-885）** 与 design §4.4 文案一致，消除「本任务不动」失真注释，文档-代码矛盾收口 ✅。

**冻结面核验（G5）**：
- dial-throw（:289-294）：`catch { onTemporaryFailure('dial-failed'); return; }` 零改动 ✅；
- onClose（:766-768 `socket-closed` / 1002/1008 → `enterBlocked` / goaway 路径）：零改动 ✅；
- hub 侧（hub-connection.ts）：**不在 diff**，HELLO_TIMEOUT 兜底 + state 守卫原样保留 ✅；
- §15.1 状态机迁移、观测词表、backoff 公式/attempts 计数（:892-905 单点）：零改动 ✅。

**结论：实现与 design 无偏离。**

## §3. 契约改动连锁审查（SKILL §1.6）

改动函数均为 `PeerConnectionImpl` 私有成员，公共 API（index.ts 导出面）零变化。caller 全量 grep 复核：

| 函数 | caller | grep 证据 | 判定 |
|---|---|---|---|
| `armHello`（签名收紧） | 仅 `dialNow` :333 | `git grep armHello` → 定义+1 调用+测试注释 | 单 caller 同步改，无遗漏 ✅ |
| `detachCloseTimedOutTransport`（新增） | pong :428 / hello :957 | grep → 定义+2 调用+2 注释 | 双 caller 均有前置守卫，同步 void，无 await/unhandledRejection 面 ✅ |
| `onTemporaryFailure`（契约不变） | 6 处：:292/:429/:768/:777/:849/:958 | grep 与 design §11 表逐行吻合 | 第 6 处新增传 `true`（epoch 已在 helper 失效），方法首行 `stopping` + `backoff/blocked` 幂等守卫兜底 ✅ |

helper 内两处防御（身份断言 throw / close catch 吸收）均为私有路径：身份断言触发前提是调用方守卫漏写（结构性不可能——两调用点前三行均含双凭据校验）；close 异常吸收后 `onTemporaryFailure` 必达（状态迁移 + observer 事件仍可观察——非静默失败，见 §5）。**无三层防御违规，无进程级 catch-all 风险。**

## §4. 「fixture 字段修正」专项审查（dispatch #8 登记项——SA3 触碰 `[SA6 owned]` 文件的合法性核验）

**背景**：dispatch 记录 SA3 在修绿过程中做过「fixture field correction——红路径不再短路后暴露」。两测试文件标 `[SA6 owned]`（design §9：SA3 不改断言逻辑，仅 harness 级异常经总控裁决的等价修复）。SA6 Phase 1 产物与 SA3 修复合入同一 commit `1092d34`，git 无法二分各自改动——采用**契约等价性 + 断言消息同一性**双重复核：

1. **断言消息同一性**（红灯证据 vs 当前文件）：
   - SA6 红灯证据：`AssertionError: hello 超时同步关闭 peer 侧旧 transport（孤儿窗口收口）: expected false to be true ❯ …red.test.ts:284`——当前文件同消息断言位于 :296（消息逐字一致，行号 +12 = 上方 fixture 增补所致）；
   - D5 红灯证据：`:802 expected false to be true`——当前 :801 同消息断言（行号 −1）。
   - **核心红/绿断言原文保留，未被改写。**
2. **契约覆盖等价性**（任务简报 SA6 契约逐条 vs 当前文件）：
   - T1 八个锚全部在场：`peerSideClosed===true`（:296）、签名 `{1001,'hello-timeout'}`（:299-302）、恰一次 backoff-scheduled{reason,attempt:1}（:304-311）、零 connection-failed（:312）、迟到 HELLO_ACK 零扰动（:314-329）、恢复链 25ms→wire2→ready→live（:331-334）、hub.connections 收口 1（:336）、hub 同值 HELLO_TIMEOUT 幂等 no-op（:340-345）；
   - T2（dial-throw 冻结 :354-377）、T3（onClose 冻结 + 迟到 hello 定时器 :379-414）在场；
   - D5 翻转与简报描述逐条吻合（peerSideClosed true + close 签名 + hub 兜底段改 onTransportClosed 收口 + 恢复链保留）；diff hunks 仅覆盖文件头 D5 描述、D5 banner、D5 describe 块——**D1–D4 零触碰**。
3. **修正定性**：+12 行漂移对应红路径短路后才可达的 fixture 增补（`hubSideCloseInfo` 观测管道 :90/:108/:179-184/:195-197、微任务排空 `await settle()` :292 等）——服务于 SA6 契约里既有的次要签名断言，属 harness 级，且 dispatch（总控日志）已登记。**在 design §9 豁免信封内。**

**测试质量（SKILL §1.7）**：两文件 `readFileSync` 计数 = 0；无裸 `toMatch/toContain`（仅行为断言 `toMatchObject`/`toBe`/`toEqual`/`toHaveLength`）；零 skip、零 real sleep、零源码 grep 断言 ✅。

## §5. 静默失败 / 降级 / 极端条件攻击（SKILL §3/4/5）

- **静默失败扫描**：新增的唯一吞异常点是 helper 内 close try/catch（:637-643）。路径可观察性三问：传输 close 已尝试（网络层）、epoch 已作废 + 监听已退订（状态变更）、后随 `onTemporaryFailure` 必达（`setState('backoff')` + observer 事件）——**非静默失败**，且注释明示吸收理由（SA2 #3：防 adapter 违约劫持恢复链）。✅
- **降级必要性**：`!transport.closed` 跳过 close 不是降级而是竞速下的合法幂等（对端已关是正常态，design §4.1 已论证）；try/catch 吸收为设计明示的防护。**无新增掩盖性降级。** ✅
- **攻击面枚举**（静态推理结论）：
  | 攻击 | 结果 |
  |---|---|
  | 迟到旧代 hello timer 作用新代（R2） | 三层拦截：`clearHello` 单槽（arm 时 + 全部离场路径）→ 状态守卫 :950 → 双凭据 :953；结构性不可穿透 ✅ |
  | close() 同步重入 onClose（R3） | epoch 先失效（:634 先于 :636）+ 退订先行 + 订阅闭包 epoch 门 :335-336——重入被滤除 ✅ |
  | timer fire 时传输已被对端关闭（R4） | `!transport.closed` 跳过；代际收口照常；onTemporaryFailure 状态守卫防双 backoff ✅ |
  | stop() 竞速（R5） | stop :194 clearHello + 回调 :947 stopping 守卫双拦 ✅ |
  | 身份断言 throw 可达性 | 两调用点在**同一同步栈**先行校验 `this.transport !== transport`（:424/:953）→ 不可达；若未来第三调用点漏守卫 → timer 回调内 loud throw（design A9 预期）✅ |
  | epoch 双递增 | helper +1 后 `epochAlreadyInvalidated=true` → 净 +1，与修复前等价 ✅ |
  | 迟到 in-flight HELLO_ACK（R1）/ hub 同值 HELLO_TIMEOUT 后到（R7） | 退订+epoch 双闸 / hub state 守卫幂等 no-op——T1 :314-345 已驱动 ✅ |
- **读写路径一致性**：无数据源变更（纯传输生命周期），无分叉面 ✅。
- **过度设计/架构死胡同**：helper 提取为任务简报明示预期形态（"or an equivalent guarded helper"）；净 ~34 行；零 FIXME/绕行 ✅。

## §6. 触发性自检（SKILL §1.3/1.4）与验证证据

- **vitest 触发性**：CI `test` job（`.github/workflows/ci.yml`）跑 `pnpm test` = `vitest run --typecheck`，root vitest.config include `packages/*/test/**/*.test.ts` → 覆盖两个改动测试文件；`pnpm typecheck` 含 `tsc -p packages/ws-replication/tsconfig.json`。node 20/24 矩阵。**无未接通 package/spec**（无 .spec.ts，E2E 门禁不适用）✅。
- **验证证据**（2026-08-30 恢复轮，独立进程复跑 design §7.4 全命令组）：
  ```
  1. red contract   : Tests 3 passed (3)      ← T1 红转绿 + T2/T3 冻结面绿
  2. sa7 round2 D5  : Tests 6 passed (6)      ← D5 翻转绿 + D1–D4 绿
  3. pong 回归 5 文件: Tests 25 passed (25)   ← 机械提取零回归
  4. 全包            : Test Files 42 / Tests 308 passed, Type Errors no errors
  5. tsc --noEmit   : exit 0
  ```

## §7. 动态审核重点（交 SA7）

1. **红基线复证**：在 scratch 检出上仅回退 `peer-connection.ts` 改动，确认 T1/D5 仍在 §4 所列同消息断言处失败（证明 fixture 修正未使契约测试空转）。
2. **真实 adapter 的 hello 路径重入语义**：pong 路径有 real-transport 测试先例；hello 路径现仅经内存 wire 驱动——建议以真实 socket adapter 确认 close() 同步派发 onClose 时零重入副作用（R3 同构实证补全）。
3. **（可选/info）helper close 吸收分支**：内存 wire 的 close 不抛错，catch 分支未被执行面——如 SA7 有故障注入 wire 先例可确认「close 抛错 → backoff 仍必达」。

## §8. 终裁

| 维度 | 结论 |
|---|---|
| Scope creep（§1） | ✅ 0 越界；DENY/BLACKLIST 零命中 |
| 设计一致性（§2） | ✅ 与 design §4 逐字一致，冻结面/hub 侧零触碰 |
| 契约连锁（§3） | ✅ 全私有改动，caller 全量核清，无 uncaught/进程级风险 |
| fixture 修正（§4） | ✅ 断言消息同一 + 契约覆盖等价 + 总控登记——豁免信封内 |
| 静默失败/降级/攻击（§5） | ✅ 无静默失败、无掩盖性降级、攻击面全数拦截 |
| 触发性（§6） | ✅ CI test job 覆盖；验证全绿（308/308 + tsc 0） |

**Verdict: pass**

（SA3 实现可信：hello 超时同步关闭收口孤儿传输窗口，冻结面与 pong 回归面全绿；3 项动态复核点移交 SA7，均非阻断。）
