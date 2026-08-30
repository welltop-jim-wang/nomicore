# SA4 静态验尸报告 — issue #164 切片 9（SA3 commit a1fdcfb）

**Date**: 2026-08-30
**Reviewer**: SA4（静态红队审查，独立复跑全部关键证据）
**对象**: commit `a1fdcfb`（apps/yjs-server 组合根 + 真实 WebSocket adapter）vs
SA1 R1 设计（`…_design.md`，SA2 R1 PASS 附十条就绪约束）+ SA2 R1（A1–A5）+
SA6 红灯契约（FS1–FS9[+FS5b] + TF1–TF3）+ issue #164
**Verdict**: **pass（SA3 实现侧零剩余工作）** —— 附 **SA6 回流 2 项硬阻断（缺陷 A/B，CI 恒红根因）+ 1 项推荐（缺陷 C）**，回流目标与固定复验范围见 §4。SA3 无需重新提交。

---

## 0. 审查方法与独立证据总览

本报告全部结论建立在**独立复跑/反向实验**之上，不采信 SA3 报告的转述：

| # | 实验/命令 | 结果 |
|---|---|---|
| E1 | `npx vitest run apps/yjs-server/test`（独立后台进程） | **11 passed / 2 failed (13)**，Type Errors 0；失败 = FS5b + TF3 |
| E2 | `pnpm test` 全量（独立后台进程） | **Test Files 2 failed \| 191 passed (193)；Tests 2 failed \| 2177 passed (2179)；Type Errors no errors** —— 与 SA3 §2.2 逐字一致，既有 191 文件零回归 |
| E3 | `tsc -p apps/yjs-server/tsconfig.json --noEmit`（现 include=src） | exit 0（0 errors） |
| E4 | tsc 临时配置加入 `test/**`（/tmp/sa4-tsconfig-check.json，不动 worktree） | exit 2，**14 处类型错误全在 SA6 冻结测试文件**（harness.ts ×7、transport-faces-red ×7），src/ 零错误 → 缺陷 C 实锤 |
| E5 | tsx 直调 `encodeMessage(HELLO 'Peer_Alpha!')` | **同步抛 `ProtocolError: MALFORMED_FRAME: invalid peerInstanceId`**（栈：checkInstanceId payloads.ts:64 → encodeHello :156）→ 缺陷 A 机理实锤 |
| E6 | **FS5b 反向实验**（/tmp/sa4-fs5b-probe.mts）：编码合法 HELLO('peer-alpha') 后同长度字节补丁为 'Peer_Alph!'（帧结构合法、文法非法），经 `RawWsClient.sendBinary` 直发 wire | 服务器**正确帧级拒绝**：收到 ERROR 帧 + `close(1002,'protocol-error')` + 零 HELLO_ACK + code ∈ [1002,1008] 全部满足 → **服务器侧 FS5b 契约成立，失败 100% 在冻结客户端** |
| E7 | **TF3 反向实验**（/tmp/sa4-tf3-probe.mts）：真实 `ws` 客户端（node_modules/ws，事件排队语义）连同一配置服务器 | `close {code:1011, reason:'transport-faces-missing'}` + **零协议帧** + `alert[0] = "transport missing required production faces: bufferedAmount, ping, onPong(…)"` → **服务器侧 TF3 契约成立且可被合规客户端观测，失败 100% 在冻结夹具** |
| E8 | vitest 失败栈核对 | FS5b 栈全程在客户端（`PeerWire.send harness.ts:579 → encodeMessage`），帧从未上线；TF3 卡在第二个 `waitUntil('连接收口')`（alert/零 HELLO_ACK 断言均已通过） |

---

## 1. 审核结论（技能九项 + 立法门禁）

1. **设计一致性：✅ 一致**。
   - `src/transport.ts`（208 行）逐条落实 SA1 §3.1/§3.2/§3.3：'error' 最先订阅吸收（D1）；text 帧/不明 binary 载体 → `close(1002)` 零投递；close 仅 `readyState===OPEN` 调 socket.close（幂等）+ onClose 恰一次守卫；ping 无 closed 门；send 竞态吸收 + ownClosed；bufferedAmount 实时投影；toBytes 三形态（Buffer/ArrayBuffer/Buffer[] 拼接）；assertProductionTransportFaces 缺面 TypeError 且 message 列全部缺面名（E7 实测 message 逐字）。唯一偏差：删除了设计伪码中未使用的 `pongListeners` 死变量——更干净，非偏离。
   - `src/index.ts`（485 行）逐条落实 SA1 §4.1–§4.6 与 **SA2 R1.3 十条就绪约束**（逐条核对表见 §2）。
2. **读写路径一致性：✅ 一致**。组合根不引入数据源；FS2 全链路绿（peer diff → hub accept → registry → persistence.peek 同一 Y.Doc 收敛 ROOT.n=43）实证读写闭环经既有包无分叉。
3. **静默失败：✅ 无**。全部路径有可观察出口（HTTP 状态行 401/403/404/503 / WS close 码 / alert 通道 / escalate→uncaughtException）；仅有的吸收点（D1 ws 'error'、D2 send/ping 竞态、safeClose* 吞二次异常）均为设计指定的外部故障正当降级且有注释锚。
4. **降级方案：✅ 安全**。无新增无据降级；tsconfig include 收窄 = 设计 §6.2 **自有降级预案**的触发（E4 实锤 14 处冻结测试类型错误、src 零错误），已在实现报告 §4 + commit message + dispatch log 三处显式登记，不静默。
5. **极端攻击：✅ 未发现可静态确认漏洞**。攻击面逐一推演：extractBearerToken 对非 string/非 Bearer/空捕获组/多余内容 → 401；safePathname 畸形 URL → 404；port 0–65535 整数校验；verifier 裁决 null/非对象/ok≠true → 403；close-before-start、double-start、double-close（幂等 same-Promise）、并发 upgrade×close 竞态（(a)/(e) 双门 + hub 门 0 + 清扫兜底）均有终态。
6. **错误处理：✅ 完整**。D1–D15 全数落地（相位路由/wss error 订阅/pendingStart 失败复位/accept rejection 分支/工厂产物形状不可信双吞——实现与设计逐条对位）。
7. **架构评估：✅ 可行，无死胡同**。零包修改红线守住（diff name-only 亲核：packages/** 零触碰）；全部协议语义由既有包承载，FS2/FS5/FS7/FS8/FS9 在真实 TCP 上全绿即证明。
8. **过度设计：✅ 精简**。两文件合计 693 行 vs 设计估 ~430 行（差值为注释/引用锚），无多余抽象层、无不可能边界防御、变更半径 = ALLOW LIST 全集。

**立法门禁**：
- §1.1 Scope Creep：✅ commit 16 文件全部映射 ALLOW LIST（package.json 仅 +typecheck 一段、vitest.config.ts 为 SA6 原样 include、pnpm-lock 仅 ws@8.21.3/@types/ws@8.18.1 + importer 块）；DENY LIST 零触碰；BLACKLIST（package-lock/yarn.lock/TASK.md/.bak）零命中。微瑕（informational）：AGENTS.md 15 行 vs 设计 §6.3「≤10 行」——纯行数装饰差，不阻塞。
- §1.3/§1.4 触发性：✅ `ci.yml` 每个 PR（Node 20/24 矩阵）跑 `pnpm test`（根 vitest include 已含 `apps/*/test/**/*.test.ts`）+ `pnpm typecheck`（typecheck 脚本已含 apps/yjs-server）。**后果：两失败用例会直接打红 CI test job——这是缺陷 A/B 必须回流的硬理由，非可选卫生项。**
- §1.5 协议假设：✅ §8 P1–P14 齐备；P8/P11/P12/P2/P1/P4/P5 经 E1/E2 运行时验证；P13/P14 有 SA1+SA2 双独立实测；A2 先例引用（hub-connection.ts:183-188 helloTimeoutMs auth-timeout）亲核属实。
- §1.6 契约连锁：✅ 纯新增公共面，零既有导出改动；grep 全仓零代码 ripple（仅 vfsl 注释提及）。
- §1.7 源码 grep 断言禁令：✅ SA6 两测试文件零 readFileSync/零源码字符串断言，全部锚在 HTTP 状态行/WS 帧/close 码/Y.Doc/回调。

## 2. SA2 R1 十条就绪约束逐条静态核对（含 A1–A5）

| 约束 | 判定 | 静态锚（index.ts） |
|---|---|---|
| 1. A1 机制照抄 | ✅ | escalate :376-380（queueMicrotask-throw）；runLoud :382-388；cb 包装 :307；(f) catch 仅 destroy :309-315；外层 .catch = destroy+escalate :162-169；accept rejection = safeCloseTransport+runLoud(notify) :358-362；httpServer/wss 'error' 同步上下文直调 notify :137-150；notify 缺省 throw TypeError :401-407 |
| 2. **A5（强制）** | ✅ | :259-266 `new Promise((resolve) => resolve(this.config.verifyToken(token))).then(verdict, () => verifier-threw)`——**同步 throw 折入 promise rejection → verifier-threw → 403**，绝不逃逸外层 .catch；wrapper 永不 reject（零 UHR）。SA2 实测的 R1 伪码字面远程崩溃向量已消除 |
| 3. A2 pre-auth 封顶 | ✅ | race + `timer.setTimeout(helloTimeoutMs)` executor 同步武装 :269-274；全出口 clearTimeout :276；timeout→503 'Auth Timeout' :277-280；verifier-threw/畸形裁决→403 :282-290；401 仅缺凭据/非 Bearer :246-249 |
| 4. eOPT 细则 | ✅ | 可选属性 `| undefined` 联合 :55-58；条件展开传包 :121-122 |
| 5. adapter 精确行为 | ✅ | transport.ts 全条（§1.1 详列） |
| 6. §4.5 顺序与零协议分配 | ✅ | :341-351 transport 收口→真 socket 1011→notify；faces 拒绝路径 return 在 accept 之前（零协议分配，E7 实测零协议帧） |
| 7. §4.6 停机全序 + 幂等 | ✅ | :205-225 closed 先置位→①close→hub.close→清扫→wss.close→④registry.shutdown→httpClosed；same-Promise :206 |
| 8. §4.3 相位路由 | ✅ | :137-146 pendingStart 挂/摘 + started 失败复位；:148-150 wss 'error' 订阅；:176-181 closed 单向门 |
| 9. §6.1/§6.2 接线 + 降级登记 | ✅ | package.json/tsconfig/AGENTS.md 逐字段对齐设计 §6.1；降级三处登记（见 §1 结论 4） |
| 10. 零修改红线 + 验收命令 | ✅ | diff 亲核；E1/E2/E3 全部复现 SA3 声称的结果 |

## 3. SA3 声称的三项「SA6-owned 冻结缺陷」独立裁定（总控委办核心问题）

### 缺陷 A（FS5b，`issue164-slice9-red.test.ts:292`）——**成立，修复归 SA6**

- **成立证据（E1/E5/E8）**：失败栈 `throwMalformed → checkInstanceId(payloads.ts:64) → encodeHello(:156) → encodeMessage → PeerWire.send(harness.ts:579)` 全程在**测试自身客户端**；`INSTANCE_ID_RE = /^[a-z][a-z0-9-]{0,62}$/`（constants.ts:38）在**编码端**先拒 'Peer_Alpha!'（E5 直调实锤同步抛 `MALFORMED_FRAME: invalid peerInstanceId`），帧从未到达 wire。replication-protocol 编码先验（R9 立法）是包的既定行为且在 DENY LIST（SA3 禁改）。
- **决定性反证（E6）**：同长度字节补丁构造「帧结构合法、instanceId 文法非法」的 HELLO 直发 wire → 服务器**立即帧级拒绝**：ERROR 帧 + close(1002,'protocol-error') + 零 HELLO_ACK，FS5b 的全部断言（零 HELLO_ACK + code ∈ [1002,1008]）在服务器侧**全部可满足**。
- **裁定**：任何不违反 DENY LIST（packages/** + SA6 冻结三件）的实现都无法使该用例到达被测路径——这是**测试自有的构造性缺陷**（SA6 简报 §5「12 用例进入行为断言」的假设对 FS5b 不成立）。SA6 简报 §7 亦已预留「契约断言自身缺陷按最小范围修正」条款。**SA3 零责任。**
- **最小修正方向（采纳 SA3 提案）**：harness 增加 `PeerWire.sendRaw(bytes)`（或直接 `RawWsClient.sendBinary`）发送手工编码帧；断言逻辑零改动。

### 缺陷 B（TF3，`issue164-transport-faces-red.test.ts:229`）——**成立，修复归 SA6**

- **成立证据（E1/E8 + harness 源码）**：TF3 的 alert（含 'bufferedAmount'）与零 HELLO_ACK 断言**均已通过**，卡死在第二个 `waitUntil('连接收口')`。机理（harness.ts 亲读）：loopback 上 ws `completeUpgrade` 写 101 与组合根同步拒绝 close(1011) 合并为单个 TCP segment；`wsUpgrade` 数据处理器在 `new RawWsClient` 后立即 `feed(残余)`（:446-447），close 帧在**零 closeListener 注册**时被消费（:324-333 只遍历空数组、不存储），`this.closed=true` 后 socket 'close' 守卫跳过回放（:296-300）；`PeerWire` 在 `wsUpgrade` resolve 后才订阅 onClose（test :214）——close 信息不可恢复，`wire.closed` 恒 undefined。
- **决定性反证（E7）**：真实 ws 客户端（事件排队语义，与生产客户端同构）对同一服务器观测到 `close(1011,'transport-faces-missing')` + 零协议帧 + alert 含 'bufferedAmount'——**服务器侧 TF3 契约完全成立且可被合规客户端观测**。
- **裁定**：**冻结夹具的关闭观察窗竞态**（SA6 自研 RFC 6455 客户端不回放已发生关闭），与生产实现无关。SA3 若为转绿而延迟服务器拒绝时序（把同步拒绝改为异步）反而违反冻结设计 §4.5 顺序——测试缺陷不该由实现迁就。**SA3 零责任。**
- **最小修正方向（采纳 SA3 提案）**：RawWsClient 增加「已关闭状态回放」——记录最后 close 帧信息（如 `lastClose` 字段），PeerWire 构造时播种 `this.closed`；一行级 fixture 改动，断言零改动。

### 缺陷 C（tsconfig include 收窄 src/**）——**降级预案正当触发；修复归 SA6（推荐随 A/B 同轮）**

- **证据（E3/E4）**：现配置（src only）0 errors；加入 test/** 后 14 处类型错误**全部**位于 SA6 冻结测试文件（harness.ts：TS2554×1/TS2322×2/TS2532×3；transport-faces-red：TS2379/TS2532/TS2722×2/TS18048/TS7006），src/ 零错误。SA1 §6.2 显式预案 + 三处登记 → 正当。
- **建议**：SA6 修复 A/B 必然要动 harness.ts 与两个测试文件——**同轮顺手清掉这 14 处类型错误并把 tsconfig include 恢复为 `["src/**/*.ts","test/**/*.ts"]`**，兑现设计 §6.2 原始意图（冻结测试须被证明可通过严格编译）。非 CI 阻断项（vitest 不对 apps 测试做 typecheck），但不修则登记债永续。

### 责任归属总裁定

| 缺陷 | 归属 | 理由 |
|---|---|---|
| A（FS5b） | **SA6** | 测试构造性缺陷；服务器侧契约经 E6 反证成立；SA3 受 DENY LIST 双重锁定（packages/** 编码器 + SA6 冻结测试文件） |
| B（TF3） | **SA6** | 夹具观察窗竞态；服务器侧契约经 E7 反证成立；SA6 简报 §7 已预留修正条款 |
| C（tsconfig） | **SA6（推荐项）** | 冻结测试类型缺陷；设计 §6.2 预案登记在案；随 A/B 同轮零额外成本 |

注：SA1 ALLOW LIST 虽留有「SA3 仅可在 SA4/SA7 指出契约自身缺陷时经登记修正」的通道，但本流水线红灯测试编写职责已立法归属 SA6（SA4 SKILL 2026-05-11 职责定位），且断言语义修订（FS5b 发送路径变更属红灯契约修订）是 SA6 的craft——**裁定走 SA6 回流，不走 SA3 修正通道**。

## 4. SA6 回流项（一次性列齐）与固定复验范围

**回流阻塞项（SA6 一轮内全部完成；不修则 CI 恒红——`pnpm test` exit 1 直接失败 ci.yml test job）**：

1. **[阻断] 缺陷 A**：FS5b 改为绕过编码器的原始帧发送（harness `sendRaw` 基建或 `RawWsClient.sendBinary` 直发）；断言强度不降：仍须断言零 HELLO_ACK + close code ∈ [1002,1008]（wire 可观察行为）。
2. **[阻断] 缺陷 B**：RawWsClient 已关闭状态回放（记录 last close 信息 + PeerWire 构造播种）；断言零改动（alert 含 'bufferedAmount' + 零 HELLO_ACK + 连接收口三项全保留）。
3. **[推荐同轮] 缺陷 C**：清理 harness.ts 与 transport-faces-red 的 14 处严格编译错误，恢复 tsconfig include 为 `["src/**/*.ts","test/**/*.ts"]`。

**SA6 diff 允许范围**（超出即新增 creep，需重新登记）：`apps/yjs-server/test/harness.ts`、`apps/yjs-server/test/issue164-slice9-red.test.ts`、`apps/yjs-server/test/issue164-transport-faces-red.test.ts`（仅类型修复）、`apps/yjs-server/tsconfig.json`（include 恢复）。**禁触**：`apps/yjs-server/src/**`、`packages/**`、`vitest.config.ts`。

**SA4 复验固定范围（下一轮只审这些）**：
- (i) SA6 diff 逐行比对（仅上述 4 文件；断言强度核对：FS5b/TF3 断言项零削弱）；
- (ii) `npx vitest run apps/yjs-server/test` → **13/13 绿**；
- (iii) `pnpm typecheck` → **0 errors**（include 恢复后）；
- (iv) `pnpm test` 全量 → **0 failed / 2179 passed**。
SA3 无需重新提交；SA4 通过后 SA7 进入动态验证。

## 5. 动态审核重点（交 SA7，`…_sa7_report.md` 逐条回复）

以下均为静态已核但**冻结测试盲区**（无运行时测试锚）或需真实环境确认的风险点：

1. **A5 红灯（SA2 §R1.4-1）**：同步 throw 的 verifier（`() => { throw new Error('sync') }`）+ 合法 Bearer → upgrade → 断言 HTTP 403（非 101、非进程崩溃）+ `process.on('uncaughtException')` 计数 0。静态锚已核（§2 约束 2），运行时锚缺。
2. **A1 红灯（SA2 §R1.4-2）**：无 alert + 缺面 transportFactory → `uncaughtException` 捕获 TypeError 含 'bufferedAmount'（断言 unhandledRejection 处理器零触达——钉死 P14 通道选择）+ 零 HELLO_ACK + 连接 1011 收口。TF3 恒传 alert，此路径无既有覆盖。
3. **A2 红灯（SA2 §R1.4-3）**：永不 resolve 的 verifier → `helloTimeoutMs + slack` 内 `wsUpgrade` resolve `{status:503, ws:undefined}` + 进程存活。
4. **D7 maxPayload 双层同界**：认证前超限帧（> maxFrameBytes）→ ws 层 1009 截断（冻结测试未覆盖）；可顺带验证 limits 覆写传播。
5. **A4(a) 运行时**：EADDRINUSE 端口 start 失败 → reject 后重试报真实根因（非「重复 start」）。
6. **FS6 深水变体**：close() 时存在**活跃 channel** 的连接 → GOAWAY/drain/Runtime barrier 包语义在真实 TCP 上的表现（冻结 FS6 只测 ready 零 channel 形态）。
7. **SA6 修复后 CI 环境复跑**：FS5b/TF3 转绿证据从 `gh run view --log` 摘录（PR CI Node 20/24 双矩阵）。

## 6. 杂项记录（informational，不阻塞）

- SA6 简报称「9 用例 FS1–FS9」但 slice9 文件实含 **10 个 it**（FS5b 独立成例），总数 13 非 12——SA6 报告口径小误，无害。
- SA1 设计 P3 引「harness.ts:314-321 手工 pong」与实际行号（sendPong 在 :352-354）有小漂移；但 SA2/SA6 各自引用的行号（transport-faces:83-91、slice9:80、harness 总 610 行）全部精确命中——判定为 SA1 引用笔误，非文件篡改证据。
- 探针脚本存档：`/tmp/sa4-fs5b-probe.mts`、`/tmp/sa4-tf3-probe.mts`（可复现 E6/E7）。
