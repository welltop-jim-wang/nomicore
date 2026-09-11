# SA7 动态验证报告 — issue #299（feat：#295 切片 1：0x42 kind 首字段单形态 codec + 聚合上限配置链）

- **dispatch**: `sa-66354348-6909-4e77-8f45-d5d29a12dd8a`（mabf-sa7 / final-verification / iteration 0）
- **验证对象**: SA3 实现（dispatch `sa-9e8e1172-…`，报告 `wiki/raw/task_issue-299_sa3_impl.md`）在 SA4 静态审查 approve（M1 台账路由）与 SA1 设计台账补正（design iteration 2）之后的当前工作树
- **HEAD**: `eb380d7aed296c15accf8832a45a96b630f0c8ce`（分支 `mabf/issue-299`）+ 工作树实现 diff（21 M 与 SA3 报告声明一致；本轮 `git status` 逐条核对）
- **Verdict**: **approve** — 设计声明改变的三条数据流按设计变化、声明保持的路线保持不变、连接错误流与终态正确、临时诊断已全部清理

---

## 1. Inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-299.md` | 在库（正文 + AC1–AC4；REST comments 空 → 无 Owner 映射项，与 dispatch 声明一致） |
| 设计（iteration 2，含 SA4 M1/SA1 台账补正） | `wiki/raw/task_issue-299_design.md` | 在库；§8 三条数据流路线 = 本报告验证对象 |
| SA6 验收契约 | `wiki/raw/task_issue-299_sa6_contract.md` | 在库（R1–R14 / C1–C7 / N1–N3；§13 sha256 锁定） |
| SA3 实现报告 | `wiki/raw/task_issue-299_sa3_impl.md` | 在库 |
| SA4 静态审查 | `wiki/raw/task_issue-299_sa4_review.md` | 在库（approve；§11 后续动态验证项 = 本轮证据矩阵输入） |
| SA2 设计评审 / SA8 门禁两份 | `wiki/raw/task_issue-299_sa2_review.md`、`artifacts/sa8-conflict-gate-issue-299{,-design-recheck}.md` | 在库（协议边界识别：R33/R34/R36/R38） |
| `relevant_decisions` / `conflict_report` | 不存在 | 三方（SA6/SA2/design §0）已登记；非本轮输入缺口 |

## 2. Runtime environment

- worktree：`/home/wangjian/nomicore-fix-issue-299`（cwd 固定）；node `v24.13.0`、pnpm `10.28.2`、vitest `3.2.7`；依赖已离线安装（SA6 §4 同源 store），本轮零网络。
- 驱动形态：既有套件（vitest 前台一次性命令）+ 3 个**临时探针测试文件**（fake-duplex wire / 真实 hub-peer 实现 / 插件装配桩；`[SA7-DATAFLOW]` 观察日志）——见 §7，全部已删除。
- 零常驻进程、零端口占用残留（唯一真实 TCP 用例绑 ephemeral port 且已收口）；后台 job 全部完成并收取。

## 3. Changed Data Flow Verification

（设计 §8 路线表逐条；`探针` = §7 临时探针原始输出，`契约` = SA6 契约文件本轮运行）

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| ① 出站 live-update chunk（kind=0） | `sendUpdateChunk` 消息字面量 + `transferKind: 0`；`encodeUpdateChunk` 首位写 kind | 探针 T1（fake-duplex，20KB 写 > maxUpdateBytes 8KiB，协商连接） | UpdateChannel 惰性切片 → 3 帧 UPDATE_CHUNK 上 wire → 帧原始字节 `payload[0]`（envelope 20B 后首字节）= `[0,0,0]` → 解码 `transferKind` 全 0 → `chunkIndexes=[0,1,2]`、Σbytes==totalBytes → hub 收敛 BIG、ns=live、conn=ready | wire 首字节 `0x00`、kind→五字段序、分块收敛 | 与预期逐项一致（`route1-wire/transfer1`） | pass |
| ① wire 字节形态（含绑定块位） | 绑定块位置 = totalBytes 之后、bytes 之前 | 探针（codec 层 encode 观察）+ 契约 R3/R4 | encode kind=1 帧 `payloadHexHead=01236e73…`（首字节 0x01）；kind=2 规范算术重建与契约冻结向量 `KIND2_FIRST` **逐字节相等**（syncRoundId 恰在 totalBytes 与 bytes 之间） | kind 首字段恒在 + 绑定块按位 | 一致（`route1-encode`、`kind2-canonical-rebuild`） | pass |
| ① transferId 计数器（AC4 观察面） | 三 kind 共用同一计数器（本切片仅 kind=0；复用 `update-channel.ts` 既有 `nextTransferId`，代码零改动） | 探针 T1（同一 (连接,方向,namespace) 两笔超限写） | transfer1 id=1 → transfer2 id=2，`increment=1`，transfer2 kinds=[0]；`update-channel.ts` 在 `git status` 零条目（DENY 保持） | 同域严格递增、无第二计数器 | 一致（`route1-wire/transfer2-counter`） | pass |
| ① 真实 TCP 链路 | wire 经 `encodeMessage` 自动单形态；断言为解码面 | 既有 `ws-replication-issue243-real-transport.test.ts`（node:net 1 Hub + 2 Peers） | A→hub 分块上行（≥2 帧、载荷/帧长限额、transferId/chunkCount/totalBytes 跨帧一致、chunkIndex 严格递增、Σbytes==total、单 UPDATE_ACK 锚末 chunk 帧序）；hub→B fan-out 分块下行；回声抑制 hub→A 零数据帧 | 全绿 | 1/1 用例绿（373ms；两包套件内亦绿） | pass |
| ② 入站 0x42 单形态解码 | `decodeUpdateChunk` kind 首字段先行 + 绑定块按位读取 | 探针（codec 层）+ 契约 R1–R4 | `KIND1_FIRST` 解码 → `transferKind=1, replicationId="a1b2…8f90", replicationEpoch=1`（own-property 存在）；`KIND2_FIRST` → `syncRoundId=5`；`KIND0_FIRST` → 绑定成员**零 own-property**；decode→encode 逐字节往返无损 ×3 kind | 绑定块还原且位置/存在性正确 | 一致（`route2-decode`、`roundtrip`） | pass |
| ② kind/绑定块违例拒绝 | `kind ∉ {0,1,2}`、绑定块缺失/越位 → `MALFORMED_FRAME` | 探针 + 契约 R7–R10 + encode-symmetry ①–⑩ | kind=3 → `MALFORMED_FRAME: transferKind must be 0|1\|2`；**旧六字段形态（首字节 0x23=35）→ 同一 first-byte 拒绝**（自动作废，R5）；R8/R9/R10 五个违例向量全 MALFORMED_FRAME（契约 17/17 绿）；encode 侧 iff 八分支 + ⑨⑩ 全 MALFORMED_FRAME（encode-symmetry 5/5 绿） | 首字节流入即拒、违例分类稳定 | 一致（`route2-error/classification`） | pass |
| ② transferId 字段语义（AC4） | tid=0 三 kind 一致拒；0xffffffff 三 kind 一致收 | 探针 | kind 0/1/2 的 tid=0 → **同一错误消息** `transferId must be a uint32 >= 1`；三 kind tid=0xffffffff 均解码为 4294967295 且往返无损 | 三 kind 同一字段位/同值域 | 一致（`ac4-transferId/three-kinds`） | pass |
| ③ 配置链（hub/peer 双入口） | resolve → 值门 → #244 家族门 → #295 两窄门（各自新键显式激活）→ 字段赋值 | 探针（15 构型 × 双入口） | 40MiB → `TypeError: limits: maxChunkedBootstrapBytes(41943040) 必须 ≤ maxChunksPerUpdate(64) × maxUpdateBytes(524288)`（三操作数俱在，hub/peer 同消息）；族内 =2MiB 接纳 / +1 拒绝（判据 `≤` 含等号）；**族内仅 sync 显式时 bootstrap 缺省 4MiB>product 不被联动误判**（窄门实证——家族门读法必拒）；`maxChunksPerUpdate=1` 的 TypeError 消息点名 **maxChunkedUpdateBytes**（#244 链承载 R35）；`maxChunksPerUpdate=8`/`maxUpdateBytes=32KiB` 单键/零分块族键均接纳；0/1.5/−1 → 值门 TypeError | 违例构造期响亮、边界等号接纳、绝不 clamp、非追溯性 | 15/15 构型与预期一致（`route3-config` 逐条） | pass |
| ③ 缺省面 | 两键缺省各 4 MiB 进 `DEFAULT_REPLICATION_LIMITS`（键集 14→16） | 探针 + 契约 C1 | `maxChunkedBootstrapBytes=4 MiB`、`maxChunkedSyncDiffBytes=4 MiB`、`keyCount=16`；timeouts 键集零漂移（契约 C1 断言） | 两键 4 MiB、键名不变 | 一致（`route3-config/defaults`） | pass |
| ③ 插件路径（allowlist → apply → 构造器继承） | `LIMIT_KEYS` +2 键；链②经 `apply` 生效 | 探针（Cordis Context 装配桩）+ 契约 C7 | 合法新键 → `apply=ACCEPTED`、服务 `state=ready`；40MiB → `apply=TypeError`（链②三操作数消息）且 `requirePeerReplication` → **service unavailable**（无 ready 服务）；hub 插件配置路径构造接纳 | allowlist 接纳 + 违例响亮 + 服务不注册 | 一致（`route3-plugin` 三条） | pass |

## 4. Preserved Data Flow Verification

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| ② 协商门先于 payload 解析（N1 / SA8 R34） | 未协商 0x42 → payload 解析前 `UNSUPPORTED_MESSAGE_TYPE` | 探针（codec + 传输两层） | SA6 HEAD：N1 绿 | codec 层 `selectedCapabilities=0` → `UNSUPPORTED_MESSAGE_TYPE: UPDATE_CHUNK requires negotiated CAP_CHUNKED_UPDATE`；传输层 T3：未协商连接注入合法 kind=0 chunk → hub ERROR 帧 `UNSUPPORTED_MESSAGE_TYPE` + close(1002/'protocol-error') + peer blocked + **hub 副本保持 'seed'（零部分应用）**；`codec-issue242-ac-red` 28/28 绿、`codec-version-interop` 25/25 绿 | pass |
| ② `selectedCapabilities` 急切校验（N2） | 非法值（-1 / 1.5）→ `CONNECTION_POLICY_VIOLATION` | 契约 N2（本轮运行） | SA6 HEAD：绿 | 绿（契约 17/17 内） | pass |
| 他域不波及（N3） | UPDATE 0x40 golden 逐字节往返；21 golden 计数锚 | 契约 N3 + `codec-messages-golden`（27）/`truncation`（8）/`malformed`（37） | SA6 HEAD：194 用例绿 | protocol 包 13 文件 213 用例全绿 + typecheck 干净 | pass |
| control reserve 校验（C6） | `maxQueuedControlBytes ≥ maxBootstrapBytes + 128` 原样保留 | 探针 | SA6 HEAD：绿 | 不足 → `TypeError: limits: maxQueuedControlBytes(4194304) 必须 ≥ maxBootstrapBytes(4194304) + 128`；恰好等于 → 接纳（契约 C6 亦绿） | pass |
| #244 家族门（链①/链②）不变 | 显式 `maxChunkedUpdateBytes`/`maxChunksPerUpdate` 仍激活；消息面不变 | 探针 + 契约 C5 | SA6 probe B：两链响亮 | `maxChunksPerUpdate=1` → #244 链②消息（点名 maxChunkedUpdateBytes）响亮；C5 三支（1 拒/8 接纳/存量不误判）契约绿 | pass |
| 传输层既有回归（构造点文件） | issue243/244/246 传输套件在 `+transferKind:0` 后全绿（断言为解码面） | 5 文件聚焦运行 + 两包全套件 | SA6 基线：45 用例绿 | 聚焦 41/41 绿（chunked-live 16、issue243-ac-red 6、issue244-ac-red 14、interop-matrix 4、real-transport 1）；ws-replication 70 文件 500 用例全绿 | pass |
| 观察面/背压矩阵 | observer-red T1–T5 与两新键无行为耦合（M1 面 +2 行缺省键） | `ws-replication-observer-red.test.ts`（套件内） | SA6/SA3：绿 | 绿（500 内）；两键在 `src/` 零行为读者（SA4 §4-A 静态证明的运行时复核） | pass |
| fuzz/property 对称性 | 三 kind × 绑定块 presence 组合 encode→decode→逐字段一致 | 套件（300 轮）+ 探针**扩展 5000 轮**（SA4 §11 移交项：种子外溢抽查） | SA3：绿 | 套件 5/5 绿；扩展轮（不同源 PRNG、随 kind/idx/presence/bytes 随机）`violations=0` | pass |

## 5. State Machine Verification

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| live 连接（协商） | 入站 kind=3 违例帧 | hub 发恰 1 个 ERROR(MALFORMED_FRAME) → close(1002/'protocol-error') → peer `blocked` 终态、ns `disconnected`、hub 侧 closed | 逐项一致（探针 T2：`hubErrorCodes=["MALFORMED_FRAME"]`、`peerSideCloseInfo={1002,'protocol-error'}`、`peerConnectionState=blocked`、`peerNamespaceState=disconnected`、`hubSideClosed=true`） | **零 UPDATE_ACK**（无部分处理/伪成功）；hub 副本无部分写入 | pass |
| live 连接（未协商） | 注入合法 kind=0 chunk | ERROR(UNSUPPORTED_MESSAGE_TYPE) → close(1002) → blocked；数据零应用 | 逐项一致（探针 T3；hub root 保持 'seed'） | 无「未协商帧被解码/应用」；无第二错误分类 | pass |
| live 连接（协商） | 两笔超限写（正常路径） | ns 恒 live、conn 恒 ready、零 SYNC/resync 回退 | T1：两笔 transfer 后 `live`/`ready`；`ws-replication-issue243-chunked-live` 断言零 SYNC round、零 resync（16/16 绿） | 无离开 live 的回退路径复活 | pass |
| 配置构造期 | 违例 limits（值门/链②） | 构造期一次性 TypeError、先于字段赋值、无 ready 服务 | 探针：全部违例即抛；插件路径 `requirePeerReplication` → unavailable（服务未注册） | 无部分初始化服务、无运行时 clamp、无「先 ready 后纠正」 | pass |
| codec 内部 | 任意解码/编码序列 | 无状态纯函数（R33） | 实现零新增模块级状态（diff 审读）；扩展 fuzz 5000 轮往返等价（无跨帧状态依赖表象） | 无隐藏跨帧状态 | pass |

## 6. Error and Cleanup Flow

- **decode 违例 → 连接 fatal**：T2 观察到 ERROR 帧先行、close(1002) 收口、blocked 终态、零 ACK——错误沿设计路径传播（分类不变：仅既有 `MALFORMED_FRAME`/`UNSUPPORTED_MESSAGE_TYPE`），无伪成功。
- **encode 违例（codec 面）**：encode-symmetry 负控 ①–⑩ 全 `MALFORMED_FRAME`（严格拒绝、无归一化）；P1–P5 正控含 decode→encode 逐字节往返（等价性保持）。live 发送路径本切片结构性不可达 encode 违例（`transferKind: 0` 硬编码、`ChunkedTransferPiece` 不携带绑定成员——D8）；发送侧 try/catch → 弃置 + send-failed 的既有收敛路径不在本切片改动面（`git status` 五个传输文件零条目）。
- **配置违例**：构造期一次性 `TypeError`（消息含三操作数，无静默 clamp）；插件 `apply` 路径违例 → 服务不注册（探针实证 unavailable）。cleanup 到达 quiescence：无部分初始化对象外泄（构造器守卫先于字段赋值——违例时不产生 ready 服务）。
- **资源收尾**：所有测试/探针为一次性进程内运行；真实 TCP 用例绑 ephemeral port 并在 finally 收口；本轮零遗留进程/端口（`job` 全部完成收取）。

## 7. Temporary Diagnostics

| 项 | 内容 |
|---|---|
| 添加 | 3 个临时探针测试文件：`packages/replication-protocol/test/sa7-299-codec-probe.test.ts`（codec wire/错误分类/协商门/AC4/扩展 fuzz）、`packages/ws-replication/test/sa7-299-transport-probe.test.ts`（T1 wire 首字节/计数器、T2 kind=3 fatal、T3 未协商门）、`packages/ws-replication/test/sa7-299-config-probe.test.ts`（15 构型配置链 + 插件路径）；统一 `[SA7-DATAFLOW]` 前缀、仅最小字段（route/step/关键值）、零 secret/零 live 对象 dump/零控制流改变 |
| 删除 | 收尾前全部删除（`ls | grep sa7-299` 零命中） |
| post-removal 验证 | 7 个关键文件重跑 = **52/52 绿 + `Type Errors no errors`**（契约 31 + chunked-live 16 + interop 4 + real-transport 1）；`git diff HEAD | grep -c SA7-DATAFLOW` = **0**；工作树 tracked 变更集合 = SA3 声明的 21 M 逐条一致；契约三文件 sha256 本轮复测 = SA6 §13 锁定值（`3168f11c…`/`56a2337b…`/`171104c2…`）——结果与探针在场时完全一致 |
| 备注 | `artifacts/sa7-issue299-probe-*.log` 为探针运行的**观察记录**（含 `[SA7-DATAFLOW]` 输出行），非交付进代码库的诊断仪表本身 |

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA6 R1–R6 | 单形态 codec + golden 改写 | 契约运行 + 探针 | 26/26 绿；绑定块还原；往返无损 | 31/31 绿（含 encode-symmetry）；探针逐项吻合 | `artifacts/sa7-issue299-post-removal-verify.log`、`-probe-codec.log` | pass | — |
| SA6 R7–R14 / SA6 §15.2 | kind/绑定块单帧规则 + 编码侧 iff | 契约 + encode-symmetry + 探针 | 全 MALFORMED_FRAME；旧形态作废 | 一致；kind=3 与旧六字段同收敛于首字节拒绝 | 同上 | pass | — |
| SA6 C1–C7 / SA8 R35 | 配置五面 + 两条链②窄门 + 非追溯性 + 插件链 | 契约 + 探针 15 构型 + 插件装配 | 响亮/接纳矩阵全中 | 15/15 一致；窄门跨键反例实证；R35 经 #244 链承载 | `-probe-config.log` | pass | — |
| SA6 N1–N3 / SA8 R34 | 协商门/选项校验/他域不波及 | 契约 + 探针 T3 + 套件 | 保持绿、分类不变 | 全绿；传输层 fatal 1002 同锚 | `-probe-transport.log`、契约运行 | pass | — |
| SA4 §11-1 | 全仓回归（328 文件含 apps/root tests） | **未由 SA7 执行**（技能边界：非一般回归；SA4 标注 driver = Controller 路由的最终动态验证） | `pnpm test` 全绿 | 两受影响包全套件（213+500）+ 根 `pnpm typecheck` exit 0 由本轮复核 | `pnpm typecheck` 本轮 exit 0 | 部分（非 SA7 缺口） | controller（合流前最终门） |
| SA4 §11-2 | 真实 WebSocket / interop 矩阵单形态运行时行为 | `issue243-real-transport` + `issue246-interop-matrix` 聚焦运行 | v1 端照旧 UNSUPPORTED_MESSAGE_TYPE；v2↔v2 分块收敛不变 | 41/41 绿（真实 TCP 1/1；interop 4/4） | `-transport-suites.log` | pass | — |
| SA4 §11-3 | observer 事件矩阵对 wire 前缀无关性 | `ws-replication-observer-red`（套件内） | T1–T5 全绿 | 绿（500 内） | 两包套件运行 | pass | — |
| SA4 §11-4 | fuzz 种子外溢抽查 | 探针扩展 5000 轮 | 属性保持 | violations=0 | `-probe-codec.log` | pass | — |
| Design §8-①②③ | 三条数据流路线（含 wire 首字节、fatal 收口、链②窄门） | 探针 T1/T2/T3 + 契约 + real-transport | 见 §3 表 | 全部按设计 | §3 表 | pass | — |
| Design D8/R41 | kind≠0 经传输层结构性不可达（测试不构造） | 探针遵守该边界（未注入 kind=1/2 传输帧） | kind≠0 仅 codec 层验证 | 与设计一致（kind=1/2 解码/往返由契约与探针 codec 面承载） | §3 表 | pass | — |

## 9. Commands and Evidence

| Command | Result | Evidence |
|---|---|---|
| `npx vitest run --typecheck <契约 4 文件>` | 4 文件 / **31 用例绿** + `Type Errors no errors` | 探针前运行（§7 post-removal 亦含） |
| `npx vitest run --typecheck packages/replication-protocol/test` | 13 文件 / **213 绿** + typecheck 干净 | 本轮后台运行（exit 0） |
| `npx vitest run --typecheck packages/ws-replication/test` | 70 文件 / **500 绿** + typecheck 干净 | 本轮后台运行（exit 0） |
| `npx vitest run <5 个传输构造点/互通文件>` | **41 绿**（含真实 TCP real-transport） | `artifacts/sa7-issue299-transport-suites.log` |
| 探针 ×3（codec/transport/config） | 全绿，`[SA7-DATAFLOW]` 观察 30+ 条 | `-probe-codec.log`、`-probe-transport.log`、`-probe-config.log` |
| 探针删除后 7 文件重跑 | **52 绿** + typecheck 干净 | `artifacts/sa7-issue299-post-removal-verify.log` |
| `pnpm typecheck`（根，14 tsconfig） | **exit 0** | 本轮前台运行 |
| `sha256sum` 契约三文件 | = SA6 §13 锁定值（未改一行） | 本轮复测（§7） |
| `git diff HEAD \| grep -c SA7-DATAFLOW` | **0** | §7 |

## 10. Deviations

1. **全仓 `pnpm test`（328 文件）未由 SA7 执行**——SA7 技能边界为设计点名路线的动态验证、不跑一般回归；该项在 SA4 §11 的既定 driver 是 Controller 路由的最终动态验证。本轮已覆盖受影响两包全套件（213+500）+ 根 typecheck=0 + 全部传输构造点/真实 TCP/互通矩阵聚焦运行；上表矩阵已按 routing 标注。非缺陷、非阻塞。
2. 探针注入的 kind=3 违例帧属**故障注入**（错误流验证）；设计 D8 禁止的是经传输层构造 kind=1/2 **合法**帧（部署面不可达、后续切片范围）——本轮严格未构造，kind=1/2 仅在 codec 层验证。无偏差。
3. 无其他偏差：契约三文件零改动（sha256 复测一致）；DENY 面零触碰（工作树变更集合 = SA3 声明 21 M）；本轮生产代码零修改（仅临时探针 + 证据日志 + 本报告）。

## 11. Verdict

**approve**。

- 设计声明改变的三条数据流（①出站 kind=0 wire、②入站单形态解码与违例拒绝、③配置链双入口 + 插件路径）全部获得运行时逐跳证据，与设计 D3/D4/D6/D8 逐项一致。
- 设计声明保持的路线（协商门、选项急切校验、#244 家族门、control reserve、他域 golden/互通车域、观察矩阵、fuzz 属性）全部保持，分类与消息面不变。
- 连接状态机错误流（ERROR 帧 → 1002 → blocked 终态、零部分处理）与配置构造期一次性失败（无 ready 服务）符合设计；禁止状态未出现。
- 临时诊断 3 文件已全部删除，post-removal 重跑结果不变，tracked diff 零 `[SA7-DATAFLOW]`。
- 唯一未覆盖项（全仓 `pnpm test`）按 SA4 §11 既定路由移交 controller，不构成本轮 reject 依据。
