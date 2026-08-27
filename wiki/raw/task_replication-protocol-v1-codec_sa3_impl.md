# SA3 实现报告 — `@nomicore/replication-protocol` v1 纯二进制 codec（issue #135）

- 状态：**实现完成；红灯套件 6/9 文件全绿，剩余 3 文件 6 失败全部由 SA6-owned 红灯缺陷（缺陷 A/B）导致，实现侧无剩余工作**
- 依据：`wiki/raw/task_replication-protocol-v1-codec_design.md`（R1，SA2 verdict=pass）+ `docs/protocols/instance-replication-v1.md`
- 日期：2026-08-27（worktree `/home/wangjian/nomicore-fix-issue-135`，branch `fix/issue-135-on-docs-phase-5-websocket-replication`）

---

## 1. 变更清单（ALLOW LIST 内，DENY LIST 零触碰）

| 文件 | 动作 | 说明 |
|---|---|---|
| `packages/replication-protocol/package.json` | 新建 | 设计 §11.1 原文：name/version 0.1.0/private/type module/exports `./src/index.ts`/deps lib0 `^0.2.117`+y-protocols `^1.0.7`+yjs `^13.6.30`/devDeps typescript+vitest |
| `packages/replication-protocol/tsconfig.json` | 新建 | extends `../../tsconfig.base.json`，include `src/**/*.ts`+`test/**/*.ts` |
| `packages/replication-protocol/src/constants.ts` | 新建 | ENVELOPE_MAGIC/VERSION/HEADER_BYTES、DEFAULT_MAX_FRAME_BYTES(16MiB)、PROTOCOL_OVERHEAD_BYTES(128)、NONCE_BYTES(16)、三个格式正则 |
| `packages/replication-protocol/src/errors.ts` | 新建 | ProtocolError（唯一异常类型，元数据查表导出 + 未注册码 connection 域兜底保留原码）+ CONNECTION_ERRORS(17)/NAMESPACE_ERRORS(20) 深冻结 + lookupError + 类型字面量 |
| `packages/replication-protocol/src/messages.ts` | 新建 | MESSAGE_TYPES/MESSAGE_NAMES/MESSAGE_REGISTRY（17 条，冻结，MESSAGE_NAMES 数字字符串键）+ MessageName/MessageInfo + ReplicationMessage 17 成员判别联合 |
| `packages/replication-protocol/src/canonical.ts` | 新建 | 决策 D-1/D-2：CanonicalReader（有界/canonical/严格 fatal UTF-8/分配前检查）+ PayloadWriter（lib0/encoding 封装，写前验证）+ 共享断言 helper；唯一 import lib0 的源文件 |
| `packages/replication-protocol/src/envelope.ts` | 新建 | encodeFrame/decodeFrame + FrameHeader/DecodedFrame；20-byte 大端头；fixtures 固化的 9 步检查顺序；payload = 零拷贝 subarray 视图（D-5 文档化） |
| `packages/replication-protocol/src/payloads.ts` | 新建 | 17 种消息 payload 编解码（设计 §7.1 字段表逐条落地）+ 共享字段校验（encode/decode 同套，R9）+ decodeMessage/encodeMessage 管线 + 字段级 limit（UPDATE/BOOTSTRAP/SYNC_DIFF_TOO_LARGE）；ERROR 注册表推导（D-3） |
| `packages/replication-protocol/src/limits.ts` | 新建 | FieldLimits/DecodeOptions/EncodeOptions + resolve* 值校验（非法 → CONNECTION_POLICY_VIOLATION）+ validateCodecLimits（§17 启动响亮验证，PROTOCOL_OVERHEAD_BYTES=128） |
| `packages/replication-protocol/src/negotiation.ts` | 新建 | selectProtocolVersion / selectCapabilities（§8 纯函数，uint32 无符号位运算） |
| `packages/replication-protocol/src/index.ts` | 新建 | 公共 API 汇出（全部 re-export，无逻辑） |
| `package.json`（根） | 修改 | typecheck 链末尾追加 `&& tsc -p packages/replication-protocol/tsconfig.json`（唯一根级改动，§14.3） |
| `pnpm-lock.yaml` | 修改 | `pnpm install` 产物：新增 y-protocols@1.0.7 解析（lockfile:853,1337）与新包 importer；yjs 13.6.32/lib0 0.2.117 复用既有单解 |
| `packages/replication-protocol/test/codec-malformed.test.ts` | 修改（仅测试基础设施数据字面量） | 见 §4 缺陷 C——3 个 decode 侧 limit 用例的 payload 字面量 `'0501020304'`（声明长 5 仅 4 字节，必截断）→ `'050102030405'`；断言逻辑/检查顺序/分类契约零改动（设计 §18 明允 SA3 修测试基础设施） |

**未触碰**：`packages/replication-protocol/test/fixtures.ts` 与其余全部测试文件；所有 DENY LIST 文件（vitest.config.ts / tsconfig.base.json / tsconfig.typecheck.json / docs/** / 既有包）；无任何实现侧 env-override/fallback（零生产分支）。

## 2. 设计关键决策落实点

| 决策 | 落实 |
|---|---|
| D-1（读路径完全自研） | CanonicalReader 全部自研：`readVarUint` 8 字节上限 + 非最短判据（count>1 且末字节 0）、`readVarUint8ArrayCopy` 分配前 `remaining < len` 检查、`readUint32BE` 先检查后读（封死 lib0 NaN→0 静默）、strict fatal TextDecoder 捕获映射 MALFORMED_FRAME |
| 写路径 lib0/encoding | PayloadWriter 唯一使用 `encoding.createEncoder/writeVarUint/writeVarUint32BigEndian/writeVarString/writeVarUint8Array/toUint8Array`；所有值写前验证（非负安全整数/u32/well-formed 字符串/Uint8Array），封死 >2^53 精度损失通道 |
| D-2（严格 UTF-8 + BOM 不剥离） | `new TextDecoder('utf-8',{fatal:true,ignoreBOM:true})` 模块级实例；encode 侧 `assertWellFormedString`（lone surrogate → MALFORMED_FRAME，R6） |
| D-3（ERROR scope 解析） | encode：namespaceId 提供→namespace scope（code 须在 NAMESPACE_ERRORS）；否则 connection scope；decode：scope 0/1 严格、fatal/retryable 位与注册表逐位一致、ns 字段按 scope 必须出现/必须缺席 |
| D-4（MESSAGE_NAMES 键型） | `Readonly<Record<string, MessageName>>`（数字字符串键），`MESSAGE_TYPES/MESSAGE_REGISTRY` 为字面量键映射（noUncheckedIndexedAccess 下点访问精确非 undefined） |
| D-5（payload 视图原型） | decodeFrame payload = `bytes.subarray(20)` 零拷贝；原型跟随输入（Buffer 进 Buffer.prototype），JSDoc 明示调用方不得嗅探；本包自产输出恒 `Uint8Array.prototype`（`codec-version-interop` 与 `codec-package-contract` 的 golden 断言已覆盖） |
| §10 limits | 缺省不设限；显式值校验（+正安全整数）失败 → CONNECTION_POLICY_VIOLATION；字段级 TOO_LARGE 在三处 bytes 字段入/出口执行（decode 读后比对、encode 写前比对）；`validateCodecLimits` 用 128 开销常量做跨字段响亮验证 |
| §9 ProtocolError | 唯一异常类型；`message` 只含稳定码 + 本地 detail，永不上 wire；未注册码兜底保留原码（connection 域，`retryable:'no', fatal:true`） |
| 纯包边界 | src 运行时唯一外部 import = `lib0/encoding`；全局仅 Uint8Array/TextDecoder/Number/Math；全程 Buffer-free（`codec-package-contract` Buffer 遮蔽测试通过） |
| canonical roundtrip | 接受集=规范形式集（拒非最短/错误 marker/尾随/非严格 UTF-8/错误 list），产生集=同一集（lib0 最短编码 + BOM 不剥离 + 字段序固定）；fuzz 800×2 随机 + 300 合法消息 + 全 golden 单字节变异全部通过 |

## 3. 验证结果（实际命令与输出）

### 3.1 包级类型检查（通过）
```
$ pnpm exec tsc -p packages/replication-protocol/tsconfig.json ; echo EXIT=$?
EXIT=0
```

### 3.2 红灯套件（9 文件）
```
$ pnpm exec vitest run packages/replication-protocol
Test Files  3 failed | 6 passed (9)
      Tests  6 failed | 130 passed (136)
Type Errors  no errors
```
- 绿（6 文件）：codec-envelope(13)、codec-fuzz-property(5)、codec-malformed(34)、codec-package-contract(5)、codec-registries(13)、codec-api.test-d 类型检查(7)。
- 红（3 文件 6 失败，全部为缺陷 A/B，实现无关，证据见 §4）：codec-messages-golden(2)、codec-roundtrip-truncation(2)、codec-version-interop(2)。

### 3.3 根 typecheck 全链路（通过）
```
$ pnpm run typecheck
> tsc -p .../vfsl && ... && tsc -p packages/replication-protocol/tsconfig.json
EXIT=0
```

### 3.4 根全仓测试（无回归）
```
$ pnpm exec vitest run --typecheck
Test Files  3 failed | 124 passed (127)
      Tests  6 failed | 1535 passed (1541)
Type Errors  no errors
```
失败 6 个 = 缺陷 A/B（同上）；其余 124 个测试文件 1535 个测试全绿，**零回归**。

## 4. SA6-owned 红灯缺陷登记（SA3 无权修改，须总控授权 SA6）

### 缺陷 A（CRITICAL）：HELLO golden 四锚点互斥（wire 升序 vs message 降序 vs malformed 拒升序）
fixtures.ts:244 的 HELLO golden payloadHex 尾部版本段为 `03 01 02 03` = [1,2,3]（升序；已用 lockfile lib0@0.2.117 decoding 直接解码实证 count=3, versions=[1,2,3]），而：
- 同条目 message 固定 `protocolVersions: [3,2,1]`（fixtures.ts:242），golden.test.ts:67 断言 decode 结果 `toEqual([3,2,1])`；
- roundtrip/truncation.test.ts:29-49 断言该 golden decode→encode 逐字节还原；
- malformed.test.ts:203-212 锚定升序 [1,2] 与重复 [1,1] **必须拒绝**（规范 §6.1『降序、无重复、至少一个』、设计 §7.1『严格降序』）。

数学上不存在满足全部锚点的实现：decode([1,2,3]) ≠ [3,2,1]；encode([3,2,1]) ≠ wire [1,2,3]；统一顺序规则（降/升/无序）至少挂 2 个锚点。除版本段外该 golden 其余字节与其余 17 条 golden 逐字节正确（130/136 已验证）。

**最小修复建议（SA6）**：fixtures.ts:244 `'...056875622d6103010203...'` → `'...056875622d6103030201...'`（版本 [3,2,1] 的规范编码 `03 03 02 01`）。修复后全部相关断言自洽，实现侧零改动。

### 缺陷 B：codec-messages-golden.test.ts:51 断言值与 fixtures 矛盾
`expect(GOLDEN).toHaveLength(17)`，而 fixtures.ts 恰有 **18** 条 golden（17 种消息类型 + ERROR 的 connection/namespace 两条变体）；设计全文一致写『18 个 golden』。实现无关、恒红。**最小修复**：`17` → `18`。

### 缺陷 C（本次已按设计 §18 由 SA3 修复）：malformed 三个 limit 用例载荷截断
`codec-malformed.test.ts` 的 decode 侧 UPDATE/BOOTSTRAP_SNAPSHOT/SYNC_STEP2 超限用例 data `'0501020304'` = 声明长 5 + 只有 4 字节（截断 1 字节，脚本实证），正确实现只能报 MALFORMED_FRAME。作者意图（5 字节 update > limit 4 → TOO_LARGE）无歧义，已修正为 `'050102030405'`；断言、检查顺序、分类契约零改动（设计 §18 ALLOW LIST 明示『SA3 可修测试基础设施但不得改断言逻辑』）。

## 5. 结论与后续

- 实现侧全部完成且经过 golden 逐字节对齐（24/26 golden 用例直接命中；其余 2 个即缺陷 A/B）。
- 缺陷 A/B 修复落地后（预计第 3 轮 SA6 授权），无需任何实现改动即可 9/9 全绿；届时复跑 §3.2–§3.4 即可。
- 交付物全部位于设计 §18 ALLOW LIST；DENY LIST 零触碰；无 env-override/fallback；golden/断言未按 A/B 之外的任何方式放宽。
