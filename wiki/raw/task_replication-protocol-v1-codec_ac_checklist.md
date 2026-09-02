# AC 门禁核对表 — Phase 5: implement instance replication protocol v1 codec (issue #135)

- **核对人**：总控（受控恢复轮 R4）
- **基线**：SA4 R1 pass + SA7 PASS（wiki/raw/task_replication-protocol-v1-codec_sa7_report.md）
- **证据根**：`.mabf-bg/`（sa7-*.log，gitignored）+ 包级/根级套件复跑记录

| # | Issue AC（原文） | 证据 | 结论 |
|---|---|---|---|
| 1 | A WebSocket binary message encodes exactly one 20-byte big-endian NMCR envelope plus its declared payload. | codec-envelope.test.ts 13 项（逐 offset 头布局、一 message 一 frame、trailing 必拒）；包级 139/139 EXIT=0（sa7-vitest-pkg.log）；遮蔽套件 127/127（sa7-shadow-suite6.log） | ✅ |
| 2 | The codec strictly enforces magic, envelope version, flags, reserved, direction-local sequence, payload length, namespaceId format, full payload consumption, and configured limits. | codec-envelope/codec-malformed 共 50 项（固定检查顺序 magic→长度→version→flags→reserved→type→maxFrameBytes→长度匹配、完全消费、字段级限额 UPDATE_TOO_LARGE 等）；alloc-bound 探针 200k×2 不越界分配（sa7-probe-allocbound.log） | ✅ |
| 3 | All v1 HELLO, GOAWAY, ERROR, OPEN/CLOSE, bootstrap, sync/resync, identity, update, and dedicated ACK payloads match the normative field order and message codes. | codec-messages-golden 26 项：17 种消息 18 条 byte-level golden（字段顺序=规范表格，SA6 A/B 修复后逐字节吻合）；roundtrip canonical 逐字节还原 | ✅ |
| 4 | Error codes derive immutable scope/fatal/retryable/terminal metadata from an append-only registry. | codec-registries 13 项（连接错误恰 17 条、namespace 错误恰 20 条、冻结不可变、lookupError 含 F1 修复后 own-key 语义）；malformed 侧 wire 值与注册表 bits 一致性用例 | ✅ |
| 5 | The package directly pins compatible yjs, y-protocols, and lib0 versions and has no Cordis, WebSocket, Registry, Buffer, or server dependency. | codec-package-contract 5 项（manifest 锁定 + 依赖禁令 + 就地 Buffer 遮蔽用例）；**整套件 Buffer 遮蔽 7/7·127/127 EXIT=0**（sa7-shadow-suite6.log）；遮蔽下内存有界裁决探针 EXIT=0（sa7-shadow-node-probe.log：forks 池 OOM 系 vitest 基础设施假象，codec 运行时 heap 全平） | ✅ |
| 6 | Byte-level golden vectors, canonical roundtrips, every-offset truncation, length/overflow/trailing-byte cases, version matrices, and fuzz/property tests pass. | golden 18 条 + roundtrip-truncation 8（每 offset 0–3→BAD_MAGIC、其余→FRAME_LENGTH_MISMATCH）+ 长度少一/多一/溢出/巨大声明短 body + 版本协商全矩阵（version-interop 25）+ fuzz 5 项×3 连跑确定性（sa7-fuzz-{1,2,3}）+ yjs 锁定组合互通 25/25（sa7-interop） | ✅ |

## 非目标确认（简报 §范围界定）

WS 连接/状态机、namespace 状态机、认证授权、背压调度、Runtime/Registry 集成均未实现——属后续切片，符合 spec（不算缺失）。包内无 Cordis/WebSocket/Registry/server/Buffer 依赖（package.json manifest 断言 + 遮蔽套件双重锚定）。

## 登记事项

- **INFO-1**（SA4 R1 登记，非阻塞）：encodeFrame 非数值 messageType 入参产出 type=0x00 帧，decode 边界必拒（UNSUPPORTED_MESSAGE_TYPE），失败 loud。SA7 §3.3 实测与登记分析一致（sa7-probe-info1.log）。处置：后续切片顺手加 `typeof` 守卫，纯纵深项，本轮不阻塞。
- **D-5**（payload 原型跟随输入）：设计文档化行为，SA7 §3.1 运行时 11/11 确认与 §11.2 承诺边界一致。

**AC 门禁结论：6/6 ✅，非目标零越界，登记事项均已处置 —— 放行双轴终审。**
