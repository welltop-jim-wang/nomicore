# Spec 轴完工审查 — issue #135 `@nomicore/replication-protocol` v1 codec

- **Reviewer**: SA2（Spec 轴，只读）
- **审查对象**: `git diff 980b16a...HEAD`（4feb737 / 7489ca1 / 1060bb9 / fa53d86），范围 `packages/replication-protocol/**` + 根 `package.json`
- **Spec 源**: issue #135 AC 6 条 + 范围界定（`wiki/raw/task_replication-protocol-v1-codec.md` L13–20、L33–42、L54–64）；规范性 wire contract `docs/protocols/instance-replication-v1.md`

## 验证证据

- `pnpm exec vitest run packages/replication-protocol` → **9 文件 / 139 测试全绿，Type Errors: no errors**（本审查独立复跑）。
- `src/payloads.ts` 逐条对照规范 §5–§13 字段表：17 种 payload 字段顺序、编码规则全部一致；`src/errors.ts` 与 §13.1/§13.2 逐行比对：连接 17 条、namespace 20 条的 fatal/retryable/wsCloseCode/terminalState **全部一致**；fixtures golden hex 手工逐字节解码复核（HELLO/HELLO_ACK/GOAWAY/ERROR×2/OPEN 等）字段序与规范吻合。
- 独立探针（tsx 直跑 src）：sequence=0 的 encode/decode 行为、非 canonical varUint（`82 00`→MALFORMED_FRAME）、payload 尾随字节（→MALFORMED_FRAME）、非数值 messageType（INFO-1 行为）。
- 两笔测试侧 commit（7489ca1、fa53d86）diff 复核：均为窄面修复（HELLO golden 版本段改严格降序、计数 17→18）与防回归锚点新增，**无断言弱化**。

## (a) spec 要求但缺失或部分实现

| # | 级别 | 条目 | 依据（spec 原文） | 说明与修订要求 |
|---|---|---|---|---|
| 1 | LOW | sequence 纪律仅以 seam 委托 | §3「sequence：uint32，**正常 frame 从 1 严格递增**」；§1 不变量 2「对端严格按期望值接收」 | encodeFrame 接受 sequence=0（实测），可产出 wire 非法帧；decodeFrame 无 `expectedSequence` 时接受任意值（实测）。纯 codec 无连接状态，seam 委托与简报非目标（WS 状态机）一致且 seam 已测（实测 SEQUENCE_VIOLATION）——定性「部分实现、非阻塞」。要求：后续 ws 切片**必须恒传 expectedSequence**；建议 encodeFrame 顺手拒绝 sequence=0（wire 上不存在合法 0 序号帧）。测试构想：encodeFrame({sequence:0}) → 断言 MALFORMED_FRAME。 |
| 2 | INFO | AC5「directly pins」靠 lockfile 落地 | AC5「directly pins compatible yjs, y-protocols, and lib0 versions」 | package.json 用 `^0.2.117/^1.0.7/^13.6.30`，实际组合由提交的 pnpm-lock.yaml 锁定（13.6.32/1.0.7/0.2.117）；测试仅断言依赖存在。符合仓库 `^` 约定；残余面=无 lockfile 新装可漂移，依赖升级时按 §4「依赖升级必须跑旧/新实现互通矩阵」执行即可。非阻塞。 |

## (b) diff 中 spec 未要求的行为（scope creep）

未发现。src 唯一外部 import 为 `lib0/encoding`（grep 全量确认）；negotiation 纯函数、§17 limits 启动验证子集、注册表元数据均可回溯规范条文；yjs/y-protocols 声明而未 import 正是 AC5 要求本身；根 package.json 仅按仓库工程约定追加 typecheck 链一行。非目标五项（WS 连接/状态机、namespace 状态机、认证授权、背压调度、Runtime/Registry 集成）零触碰。

## (c) 看似实现但实现有误

未发现。逐条核验：AC1 20-byte 大端头 + 一 message 一帧（byteLength≠20+payloadLength 即拒，粘连/分片/尾随必拒，检查先于 payload 复制/分配）；AC2 magic/version/flags/reserved/messageType/payload 长度/namespaceId 格式/完全消费/maxFrameBytes+三字段限额全部强制且失败必为注册表内 ProtocolError；AC3 17 消息 code 与字段序无误；AC4 ERROR scope/fatal/retryable 由注册表导出、wire 位与注册表不符即拒；AC6 §22 本票范围内测试项（golden/roundtrip/全 offset 截断/长度越界尾随/版本矩阵/fuzz）齐备且全绿。

## SA4 R1 INFO-1 独立复核

同意非阻塞，不重复计 finding。实测：`encodeFrame({messageType:'toString'})` 产出 type=0x00 帧，任意 decode 边界必拒（UNSUPPORTED_MESSAGE_TYPE）；数字字符串静默收敛为正确字节；TS 类型面不可达；无未分类异常逃逸。

---

**汇总**: findings 共 2 条（1 LOW + 1 INFO），最重一项为 LOW（sequence 纪律以 expectedSequence seam 委托状态层，encode 侧可产出 sequence=0 帧）。
**Verdict: pass**
