# SA4 静态验尸报告 — `@nomicore/replication-protocol` v1 codec 实现（issue #135）

**Date**: 2026-08-27（R0 验尸 + R1 窄面重审，同 session 续传）
**Verdict**: R0 → **reject**；R1 重审 → **pass**（F1/F2/F3 全部闭环且经逐项复核，1 条 INFO 级纵深观察不阻塞。当前生效裁决见文末「R1 重审节」）
**被审对象**: R0 = commit `4feb737`（SA3 交付）+ 工作区 SA6 恢复轮未提交改动；R1 = commit `7489ca1`（SA4 R0 窄面回流修复）叠加其上
**审查方式**: 纯静态——设计 R1（735 行）/ 规范（587 行）/ src 9 文件（~1600 行）/ 测试 9 文件 + fixtures（~2200 行）全量逐行；golden hex 手工反解；JS 语义证据用 node 单句验证；`tsc -p`（静态编译检查）EXIT=0；R1 抽查复跑单文件测试（总控明示授权）

---

## 0. Skill 门禁结论（先行）

| 门禁 | 结论 | 证据 |
|---|---|---|
| §1.1 文件清单 Scope Creep | ✅ PASS | commit 4feb737 共 31 文件，全部落在设计 §18 ALLOW LIST 或 `^wiki/raw/task_` 白名单（wiki 档案 7 件）；BLACKLIST（package-lock.json/TASK.md/.bak）零命中；DENY LIST（apps/**、既有包、vitest.config.ts、tsconfig.*、docs/**、CONTEXT.md）零触碰。根 package.json 改动经 diff 核实**仅** typecheck 链追加一段（§14.3 合规）。工作区未提交改动（2 测试 + 2 wiki）亦全在白名单内 |
| §1.3 E2E spec 触发性 | N/A | 本票无 `*.spec.ts` |
| §1.4 vitest 触发性 | ✅ PASS | 根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` + typecheck include `*.test-d.ts` 自动覆盖新包；CI `ci.yml:39` `pnpm test`（= `vitest run --typecheck`）与 `ci.yml:36` `pnpm typecheck`（链含新包，package.json:13）均触达 |
| §1.5 协议假设 | N/A | 设计 §16 存在且声明纯 codec 无网络/进程假设（SA2 已复核，无新假设引入） |
| §1.6 契约改动 ripple | N/A | greenfield 零 caller（设计 §17 已审计） |
| §1.7 源码 GREP 断言禁令 | ✅ PASS | 测试中唯一 `readFileSync` 是 codec-package-contract.test.ts:24 读 **package.json**（manifest 数据 + JSON.parse 值断言，AC5 契约），非源码字符串正则断言 |

**SA3 对 SA6-owned 测试改动的专项审计**（commit 4feb737 内 codec-malformed.test.ts 三处 `'0501020304'`→`'050102030405'`，SA3 自报 §4 缺陷 C）：diff 全量核对为**纯数据字面量修复**——原 payload 声明 5 字节仅 4 字节实体（任何实现必报 MALFORMED_FRAME 截断，TOO_LARGE 断言不可达），修复后 5 字节真实超限；断言逻辑/期望错误码/检查顺序零改动。落在设计 §18「SA3 可修测试基础设施但不得改断言逻辑」的明文许可内。**放行**。

---

## 1. 逐清单项结论

### 1.1 帧层 9 步顺序 — ✅ pass

`src/envelope.ts:76-141` 逐一对照 fixtures.ts:17-31 固化顺序：

| 步 | fixtures 要求 | 实现位置 | 一致性 |
|---|---|---|---|
| 前置 | options 值校验 | envelope.ts:80-81（`resolveMaxFrameBytes`/`resolveExpectedSequence`，非法 → CONNECTION_POLICY_VIOLATION，与设计 §4.2 伪代码同位） | ✓ |
| 1 | <4 字节或 magic ≠ NMCR → BAD_MAGIC | envelope.ts:83-91（`byteLength < 4 ||` 逐字节比对，**先于步骤 2**） | ✓ |
| 2 | <20 → FRAME_LENGTH_MISMATCH | envelope.ts:93-95 | ✓ |
| 3 | version ≠1 → UNSUPPORTED_ENVELOPE_VERSION | envelope.ts:97-99 | ✓ |
| 4 | flags ≠0 → UNSUPPORTED_FLAGS | envelope.ts:101-103（be16） | ✓ |
| 5 | reserved ≠0 → MALFORMED_FRAME | envelope.ts:105-107（be32） | ✓ |
| 6 | type 未注册 → UNSUPPORTED_MESSAGE_TYPE | envelope.ts:109-112（MESSAGE_NAMES 查表；messageType ∈ [0,255]，数字字符串键不在 Object.prototype 上，无 1.4-F1 同类问题） | ✓ |
| 7 | >maxFrameBytes → FRAME_TOO_LARGE；**===maxFrameBytes 通过** | envelope.ts:114-116（严格 `>`，边界通过，红灯 codec-envelope.test.ts:148 锚定） | ✓ |
| 8 | byteLength ≠ 20+payloadLength → FRAME_LENGTH_MISMATCH（分配前） | envelope.ts:118-124（先于 subarray 视图产出，零复制） | ✓ |
| 9 | expectedSequence 提供且不等 → SEQUENCE_VIOLATION；位置=长度校验后、payload 前 | envelope.ts:126-129 | ✓（SA2 已裁定该位置与 fixtures 第 9 步（payload 级）无冲突，不重复展开） |

encodeFrame 检查 a–e（type/sequence 域/payload 类型/u32 溢出/帧上限）顺序与设计 §4.3 逐条一致（envelope.ts:149-171）；输出全新 Uint8Array，flags/reserved 恒 0（:172-184）。

### 1.2 CanonicalReader — ✅ pass

`src/canonical.ts`：

- **varUint 8 字节上限**：:146-148（循环顶 `count >= 8` → MALFORMED_FRAME；第 9 字节永不消费）。8 字节可表 MAX_SAFE_INTEGER（ceil(53/7)=8）✓。
- **非最短拒绝**：:161-163（`count > 1 && last === 0`——无符号 LEB128 完备判据，SA2 已独立验证不重复展开；`82 00`/`80 00` 拒、`06`/`88 27`/`ff ff ff ff 7f` 过，红灯 malformed:106-125 锚定）。
- **MAX_SAFE_INTEGER 拒绝**：:164-166（2^53 邻域双精度 ulp=2，舍入不会向下漏过 2^53-1 边界——SA2 排除项复核采信）。
- **readVarUint8ArrayCopy 分配前界检查**：:180-188（`remaining < len` 先拒，**后** `new Uint8Array(len)` 精确拷贝；len 上界受帧体钉死，fuzz「绝不越界分配」由构造满足；malformed:171-179 的 0xff/2^35-1 巨大声明用例走此路径）。
- **fatal+ignoreBOM TextDecoder**：:34（模块级单例；ignoreBOM 保 BOM 逐字节 roundtrip——D-2；lib: ["ES2022"] 无 DOM 类型，:25-32 的本地 `declare const TextDecoder` 是合法类型垫片而非类型作弊，运行时用全局 TextDecoder，Node≥11/浏览器皆有）。
- **readUint32BE 先查 remaining**：:119-129（先 `remaining < 4` 后读，封死 lib0 F6 NaN→0 静默路径）。
- PayloadWriter 写前验证全齐：writeU8 域检查 :210-215、writeVarUint 非负安全整数 :226-229、writeUint32BE/writeVarUint32 assertU32 :221-234、writeVarUint8Array instanceof :236-241、writeVarString well-formed（R6 lone surrogate）:243-246 —— 封死 lib0 >2^53 精度损失与 TextEncoder U+FFFD 替换通道。**唯一缺口见 F2（safeMessage 无前置 typeof 守卫）**。

### 1.3 encode/decode 同套字段验证（R9，17 种消息逐一） — ✅ pass（含 1 项 MINOR 缺口 F2）

逐消息对照设计 §7.1 字段表与规范 §6–§13（`src/payloads.ts`）：

| 消息 | 字段序（wire） | 规则落实 | 行号 |
|---|---|---|---|
| HELLO 0x01 | peerInstanceId→expectedHubInstanceId→protocolVersions→caps×2→nonce | R5×2（:121-124/:156-157）；列表 ≥1 项/逐项 ≥1/严格降序（decode :125-139；encode checkProtocolVersions :87-101，含 safe-integer 检查）；caps u32（readUint32BE 天然域 / assertU32 :159-160）；nonce 恰 16（:103-107，15/17/巨大声明全拒，红灯两侧对齐） | ✓ |
| HELLO_ACK 0x02 | hubInstanceId→protocolVersion→caps→nonce→connectionId | R5；protocolVersion ≥1 安全整数（:181-184/:202-204）；nonce 恰 16；connectionId 非空（:189/:207） | ✓ |
| GOAWAY 0x03 | reasonCode→drainTimeoutMs→retryAfterMs(opt) | reasonCode 非空；drain ≥0 安全整数（encode -1 拒，:234）；marker 0/1 + 缺席省略键（R10，:221-229/:235-245） | ✓ |
| ERROR 0x04 | §6.3 七段固定 | scope u8∈{0,1}；code 查 scope 注册表；wire fatal ≡ registry.fatal；wire retryable ≡ (retryable!=='no')；relatedSequence opt varUint u32；namespace scope 必带/ connection 必不带 namespaceId；safeMessage 无约束（可空串，符合设计 §7.0）。encode 侧 D-3 推导（namespaceId 提供→namespace scope）+ 元数据类型层面不可覆盖（ErrorMsg 无 fatal/retryable 字段，messages.ts:128-134，test-d :55-63 锚定） | ✓（查表健全性缺口 = **F1**） |
| OPEN_NAMESPACE 0x10 | ns→bool→rid(opt)→epoch(opt) | identity 成对律四象限（decode :368-377；encode :382-392）；R2/R3/R4（rid 31 字符/大写/epoch 0 全拒，红灯 :229-265/:430-468 锚定）；false 分支省略两键（R10 :377） | ✓ |
| OPEN_OK 0x11 | ns→mode(u8)→rid→epoch | mode∈{0,1}（:411-412/:422）；R2/R3/R4 | ✓ |
| CLOSE_NAMESPACE 0x12 / CLOSE_OK 0x13 | ns→reasonCode / ns→ackedSequence | 非空 / R8 u32 | ✓ |
| BOOTSTRAP_SNAPSHOT 0x20 | ns→rid→epoch→snapshot | R2/R3/R4；snapshot 受 maxBootstrapBytes（decode 读后 :471-474、encode 写前 :482-485 → BOOTSTRAP_TOO_LARGE）；空 snapshot 合法 | ✓ |
| BOOTSTRAP_ACK 0x21 | ns→ackedSequence | R8 | ✓ |
| IDENTITY_CHANGED 0x22 | ns→rid→epoch | R2/R3/R4 | ✓ |
| SYNC_STEP1 0x30 | ns→syncRoundId→stateVector | R8；空 SV 合法；无命名字段限额（符合设计「仅受 maxFrameBytes」） | ✓ |
| SYNC_STEP2 0x31 | ns→syncRoundId→relatedStep1Sequence→update | R8×2；update 受 maxSyncDiffBytes → SYNC_DIFF_TOO_LARGE（decode :550-553 / encode :561-564）；空 diff 合法 | ✓ |
| SYNC_APPLIED 0x32 | ns→syncRoundId→ackedSequence | R8×2 | ✓ |
| RESYNC_REQUIRED 0x33 | ns→reasonCode | 非空 | ✓ |
| UPDATE 0x40 | ns→update | maxUpdateBytes → UPDATE_TOO_LARGE（decode :611-614 / encode :620-623） | ✓ |
| UPDATE_ACK 0x41 | ns→ackedSequence | R8；0xffffffff 可承载（readVarUint32 上界恰 0xffffffff，roundtrip 红灯 :65-69） | ✓ |

R1（decodeMessage 末尾 `expectEnd`，payloads.ts:737）、R10（optional 缺席省略键——GOAWAY/ERROR/OPEN_NAMESPACE 三处条件赋值）均落实。golden 18 条 hex 逐条手工反解（HELLO 版本段 `03 03 02 01`、GOAWAY `8827`=5000/`d00f`=2000、ERROR_CONN 七段、ERROR_NS fatal=01/retryable=00 与注册表一致等）与实现字段序/编码选择逐字节吻合。encodeMessage 管线（validate-then-write 合并于各 encode* 函数，效果等同设计 §7.2 的 validateMessage 前置）+ sequence 缺省 1（:749）+ maxFrameBytes 透传（:752）。

### 1.4 注册表 — ✅ pass（含 1 项 MAJOR 健全性缺口 F1）

- **MESSAGE_REGISTRY 恰 17 条**：messages.ts:77-98 与规范 §5 表（及 fixtures MESSAGE_TABLE/SCOPE/DIRECTION/ACK 四表）逐格比对一致，含 IDENTITY_CHANGED `terminal-conflict`、RESYNC `peer-starts-new-round` 等字面量；码空间洞（0x00/0x05–0x0f/0x14–0x1f/0x23–0x2f/0x34–0x3f/0x42+）无多余注册（红灯 :72-81）。MESSAGE_TYPES/MESSAGE_NAMES/MESSAGE_REGISTRY 全 Object.freeze，条目经 messageInfo 冻结（深冻结一层足够——字段全原始值）。MESSAGE_NAMES 为十进制数字符串键逆映射（D-4，:67-71）。
- **CONNECTION_ERRORS 恰 17 条**：errors.ts:92-110 与规范 §13.1 逐格一致（FRAME_TOO_LARGE 1009/config、INSTANCE_IDENTITY_MISMATCH 1008、CONNECTION_BACKPRESSURE 1011/yes、INTERNAL_ERROR 1011/yes 等）。
- **NAMESPACE_ERRORS 恰 20 条**：errors.ts:112-133 与规范 §13.2 逐格一致；**ACK_TIMEOUT 唯一 fatal:false**（:130，全表其余 19 条 fatal 均 true，连接表 17 条全 true）；**INTERNAL_ERROR 双表元数据差异**正确（connection yes/1011 vs namespace reconnect/failed）。
- **深冻结**：表与条目双层 Object.freeze（connectionError/namespaceError 工厂 :74-90 + :136/:139），红灯 Object.isFrozen + 写入 throw 锚定。
- **lookupError scope 隔离**：errors.ts:144-149 按 scope 定位，跨 scope undefined（红灯 :146-149）。**但成员判定用裸属性索引，对 Object.prototype 继承键不健全 → F1**。

### 1.5 ProtocolError — ✅ pass（兜底语义正确；1 项 MINOR 例外见 F2）

- 唯一异常类型：全部 throw 点逐一清点（envelope 12 处、payloads 8 处、limits 1 处、canonical throwMalformed/throwPolicy 包装）均为 ProtocolError；TextDecoder throw 被捕获映射（canonical.ts:194-198）。**唯一逃逸口 = F2（assertWellFormedString 对 undefined 的 TypeError）**。
- 兜底路径 `this.code` 保留原字符串：errors.ts:174（`this.code = code` 无条件赋值，未注册码不替换为 INTERNAL_ERROR）——SA2 #4 写死条款落实；兜底分支 connection 域 + fatal:true/retryable:'no'（:186-190），loud 非降级。
- message 不上 wire：构造器 message 仅 `${code}${detail}`（:172）；encodeError 只写调用方 safeMessage（payloads.ts:338），绝无 err.message/stack 触点。
- codec 抛出码全集与设计 §9 清单一致（8 帧级 + 3 字段级 + CONNECTION_POLICY_VIOLATION；UPDATE_TOO_LARGE 经 connection-miss→namespace fallback 取得 scope=namespace/fatal=true，红灯 malformed:334-347 锚定）。

### 1.6 协商纯函数 — ✅ pass

`src/negotiation.ts`：selectProtocolVersion 纯集合语义（Set 交集取最大 :12-21，与顺序/重复无关；**不做降序校验**——:8 注释明示归 HELLO wire 规则，与设计 §8「纯交集数学」一致）；selectCapabilities `((required & ~supported) >>> 0) === 0` + `(optional & supported) >>> 0`（:26-29，bit31 安全，红灯 7 例矩阵 + order-independence 2 例全对齐）。不抛错、不映射 UNSUPPORTED_*（归调用方）。

### 1.7 limits — ✅ pass

`src/limits.ts`：validateCodecLimits 四值正有限安全整数（:80-83）+ 三字段限额 ≤ maxFrameBytes − PROTOCOL_OVERHEAD_BYTES(128)（:84-93，R1 修正后的假绿灯公式）；违规 throw CONNECTION_POLICY_VIOLATION（throwPolicy :35-37）；**无运行时 clamp**（src 全文无 Math.min/Math.max/clamp 逻辑，仅 JSDoc 提及）。显式 options/limits 非法值（NaN/Infinity/-0/负数/非整数/0）→ CONNECTION_POLICY_VIOLATION（resolveMaxFrameBytes :47-51 / resolveFieldLimit :63-67 / resolveExpectedSequence :54-60，逐值验算）；未传字段不参与跨字段校验（Partial 语义保持）。maxFrameBytes 缺省 16MiB（constants.ts:18）。

### 1.8 纯包边界 — ✅ pass

- src 全部 import 清单（grep 全量）：`lib0/encoding`（canonical.ts:21，唯一外部包）+ 包内相对导入（payloads/limits/envelope/index/errors/messages 间，无环，方向符合设计 §2）；**无 Buffer/process/node:/require 触点**（grep 命中仅为 JSDoc 文字，envelope.ts:18-19/canonical.ts:205）。
- 全局使用仅 Uint8Array/TextDecoder/Number/Math——跨平台；Buffer 遮蔽红灯（package-contract:52-78）由「解码自研 + lib0 仅写路径」架构保证。
- 输出原型承诺（D-5 准确边界）：自产输出（encodeFrame `new Uint8Array` envelope.ts:172 / encodeMessage 经 `encoding.toUint8Array` canonical.ts:248-250 / decodeMessage 字段 bytes 经 readVarUint8ArrayCopy 精确拷贝 canonical.ts:185）恒 `Uint8Array.prototype`；唯一例外 decodeFrame payload subarray 视图（envelope.ts:139）原型跟随输入，JSDoc :16-20 已文档化并明令禁止原型嗅探。

### 1.9 公共 API 面 — ✅ pass

index.ts:8-53 逐项对照设计 §3：★ 项全数在列——常量 5（ENVELOPE_MAGIC/VERSION/HEADER_BYTES/DEFAULT_MAX_FRAME_BYTES/PROTOCOL_OVERHEAD_BYTES）、注册表 5（MESSAGE_TYPES/NAMES/REGISTRY、CONNECTION_ERRORS/NAMESPACE_ERRORS）+ lookupError、帧层 2（encodeFrame/decodeFrame）+ 3 类型、消息层 2（encodeMessage/decodeMessage）+ FieldLimits/DecodeOptions/EncodeOptions、协商 2、ProtocolError、validateCodecLimits、类型面（MessageName/Scope/Direction/Info、FrameHeader/DecodedFrame/DecodedMessage、ReplicationMessage + 17 成员、ConnectionErrorCode/NamespaceErrorCode/RetryPolicy/TerminalState/ErrorInfo、ErrorMsg 无元数据字段）。**无缺项**；亦无内部泄漏（NONCE_BYTES/三个正则/throwMalformed/assertU32 等 internal 导出均未进 index）。9 个测试文件 import 的全部名字逐一核对可达。

### 1.10 编码质量 — ✅ pass（3 项小瑕疵见 F3/F5 及 INFO）

- **类型作弊清零**：`as any`/`@ts-ignore`/`@ts-expect-error`/`as unknown as` 零命中；`tsc -p packages/replication-protocol` EXIT=0（本次实测，覆盖 SA6 恢复后的当前树），在 strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes + verbatimModuleSyntax 全开下通过。
- 非空断言 10 处逐一判定**全部有前置守卫**（canonical.ts:107/123-126/152 随 remaining 检查；envelope.ts:56/60/109 随长度/offset 检查；payloads.ts:135 随 length>0）——noUncheckedIndexedAccess 下的合法用法。
- 类型转换 5 处全部合理：payloads.ts:417 `mode as 0|1`（checkMode 运行时收窄后）；errors.ts:146/148 查表索引转换（**F1 修复点**）；messages.ts:69-70 逆映射构造（D-4 已文档化）。
- 魔法数：envelope magic 字节 0x4e/0x4d/0x43/0x52 两处（encode 写 + 注释对照），有 JSDoc 说明；BE 移位算术为标准形态。无其他裸魔法数。
- 重复逻辑：encode/decode 每消息成对验证是 R9「同套验证」的落实形态（设计明示）；HELLO 版本表降序判定 decode 内联（:135-137）与 encode checkProtocolVersions（:96-98）重复一处，可接受。
- 死代码：**F3**（readU32Field 不可达分支）。
- 无 FIXME/TODO/注释掉代码；模块级仅冻结常量与无状态函数（可并发共享，SA2 排除项复核采信）。

---

## 2. 发现清单

### F1 — lookupError 成员判定对 Object.prototype 继承键不健全；encodeError 静默产出注册表外 ERROR 帧 【MAJOR】

- **位置**：`src/errors.ts:144-149`（lookupError 裸属性索引）→ 消费点 `src/payloads.ts:312-315`（encodeError）/ `src/errors.ts:175-178`（ProtocolError 构造器）。
- **机理**（node 单句语义验证，2026-08-27）：`CONNECTION_ERRORS`/`NAMESPACE_ERRORS` 是普通对象字面量 + Object.freeze，原型链为 Object.prototype。对 `'toString'`/`'constructor'`/`'__proto__'`/`'valueOf'`/`'hasOwnProperty'` 等 ~12 个继承键，`registry[code]` 返回继承成员（≠ undefined），「未知 code」检查被绕过。
- **后果链**（typed caller 可达——`ErrorMsg.code: string` 类型不排除这些字面量）：
  1. `encodeMessage({kind:'ERROR', code:'toString', safeMessage:'x'})` 不抛 MALFORMED_FRAME，而是写出 `scope=00, code="toString", fatal=00(entry.fatal undefined→writeBool 翻译为 0), retryable=01(undefined!=='no')` 的帧——**违反设计 §6.3「code 必须在注册表，否则 MALFORMED_FRAME」与规范 §13「fatal/retryable 由 code registry 固定 / Encoder 从 code registry 导出…调用方不能覆盖」**；
  2. 该帧被**本 codec 自己的 decoder 拒绝**（decodeError 的 fatal ≡ registry 一致性检查对 undefined 元数据必 mismatch → MALFORMED_FRAME）——encode 接受/decode 拒绝的不对称，破坏 canonical roundtrip 不变量在 API seam 的成立；下游 ws-replication 若回显/转发此类帧将形成协议违约；
  3. 同根因：`new ProtocolError('toString')` 得到 `scope=undefined, fatal=undefined, retryable=undefined` 的错误对象，违反 ProtocolError 类契约（scope: 'connection'|'namespace'）与「错误码/元数据 ∈ 注册表」不变式（errors.ts:157-159 的可测试性声明）。
  - decode 侧不受攻击（继承键帧在 decodeError 一致性检查处必被拒，分类正确）——非 wire 攻击面，属**本地 API 契约洞 + 静默无效输出**。
- **修复建议（SA3，一行）**：lookupError 改 own-key 判定，如 `return Object.hasOwn(CONNECTION_ERRORS, code) ? CONNECTION_ERRORS[code as ConnectionErrorCode] : undefined;`（namespace 分支同款）。已验证 hasOwn 对 `'__proto__'`/`'toString'` 返回 false、对注册码返回 true；对全部红灯零影响（registries 测试只用非继承键）。
- **回流目标**：SA3（修复）；SA6 可选补一条 encode 侧 `code:'toString'` → MALFORMED_FRAME 的红灯锚（防回归）。

### F2 — encodeError 的 safeMessage 是唯一无 typeof 守卫的字符串写入点：undefined → TypeError 逃逸；非字符串 → 静默类型强转 【MINOR】

- **位置**：`src/payloads.ts:338`（`writer.writeVarString(msg.safeMessage, 'safeMessage')`）→ `src/canonical.ts:60-73`（assertWellFormedString 直接 `s.length`，无 typeof 检查）。
- **机理**：其余全部字符串字段（namespaceId/replicationId/instanceId/reasonCode/connectionId）都有 check* helper 的 `typeof s !== 'string'` 前置（payloads.ts:50-78）；code 字段经注册表命中间接保证为 string。唯独 safeMessage 无任何前置。
- **后果**：JS caller / JSON 反序列化输入（`{"kind":"ERROR","code":"BAD_MAGIC","safeMessage":null}`）→ `assertWellFormedString(null)` 在 `s.length` 抛 **TypeError**——违反 errors.ts:152-153「一切解码/校验失败只抛 ProtocolError，绝不抛 RangeError/TypeError 等未分类异常」的自我声明与设计 §13 防弹要点 2；`safeMessage: 42` 则被 TextEncoder 静默强转为 `"42"` 上 wire（同套验证精神缺口）。TS 类型面（safeMessage: string）使 typed caller 不可达；fuzz 契约仅覆盖 decode 侧。
- **修复建议（SA3）**：assertWellFormedString 首行加 `if (typeof s !== 'string') throwMalformed(...)`（一处修复覆盖全部 writeVarString 调用点）。
- **回流目标**：SA3。

### F3 — readU32Field 的 `v > 0xffffffff` 分支不可达（死防御代码） 【MINOR】

- **位置**：`src/payloads.ts:110-116`。readVarUint32（canonical.ts:171-177）已保证 ≤ 0xffffffff，readU32Field 内的重复检查永不触发。
- **处置**：删除该分支或降级为注释说明「readVarUint32 已保证」；纯卫生项，无行为影响。

### F4 — ProtocolError 构造器对显式 scope='connection' 仍回退 namespace 注册表 【INFO】

- **位置**：`src/errors.ts:175-178`。三元仅区分 `scope === 'namespace'`；显式 `'connection'` + namespace-only 码（如 `'ACK_TIMEOUT'`）会走 namespace fallback，`err.scope` 变为 'namespace'，与 JSDoc「优先 scope 指定的注册表」措辞不完全一致。codec 内部不可达（内部 throw 均用正确 scope 域的码）；仅外部 caller 传显式 scope + 跨 scope 码时出现元数据措辞歧义，行为本身（元数据与 code 真实注册条目一致）反而合理。可不修；若修，与 F1 同函数顺带处理。

### F5 — encodeHello 的 connectionNonce undefined 前置检查冗余 【INFO】

- **位置**：`src/payloads.ts:161-163`。checkConnectionNonce 的 `instanceof Uint8Array` 已覆盖 undefined（更早抛错）。无害，保留亦可（错误信息更友好）。

### INFO 汇总（不阻塞，均已核实非问题）

- canonical.ts:25-32 本地 `declare const TextDecoder`：lib 仅 ES2022 无 DOM 类型的合法垫片，运行时解析到全局 TextDecoder——非类型作弊。
- SA3 对 codec-malformed.test.ts 的三处数据字面量修复（缺陷 C）：断言契约零改动，设计 §18 明文许可，已审计放行（见 §0）。
- SA6 恢复轮工作区改动与任务简报声明逐字一致（fixtures.ts:244 `03010203`→`03030201`；golden 测试 :51 `17`→`18`），无夹带。
- malformed 测试 HELLO_TAIL（:26，版本段 [1,2,3] 升序）被 instanceId 文法用例复用：instanceId 检查先于版本表检查，任何实现顺序下均产出 MALFORMED_FRAME，分类断言无歧义——测试数据瑕疵但契约无洞。
- decodeHello 的 list 循环以 payload 实体为自然上界（每项 ≥1 字节），巨大 count 声明无分配/时间放大面。

---

## 3. 审核结论（Skill 输出格式）

1. 设计一致性：⚠️ 偏离 1 处（F1：§6.3 ERROR 注册表推导的成员判定不健全——窄面）；其余 §3 API 面/§4 帧 9 步/§5 CanonicalReader/§6 注册表/§7 字段表/§8 协商/§9 错误/§10 limits/§11 纯包边界全部逐条落实。
2. 读写路径一致性：✅ N/A（无状态纯函数 codec；encode/decode 对同一字段表闭合，golden 18 条逐字节锚定）。
3. 静默失败：❌ 1 处（F1：encode 侧静默产出本 codec 自身即拒绝的 ERROR 帧——正是静默无效输出类缺陷）；F2 的非字符串强转为次要静默面。
4. 降级方案：✅ 无降级路径（无 clamp、无 fallback 编码、无 best-effort 解析；非法输入一律 loud）。
5. 极端攻击：decode 侧全量攻击（截断每 offset/尾随/非 canonical varUint/巨大声明/非法 UTF-8/marker/list/成对律/注册表位篡改/边界 0xffffffff/2^53/8 字节 varUint/继承键）推理全拒且分类确定；encode 侧发现 F1/F2 两洞。
6. 错误处理：⚠️ 兜底语义正确（原码保留/loud），但「唯一异常类型」声明被 F2 的 TypeError 逃逸口打破一处。
7. 架构评估：✅ 可行且优（D-1 自研读 + lib0 写的组合兑现了全部 F4–F6 封堵承诺；无需退回 SA1）。
8. 过度设计：✅ 精简（无投机抽象；validateCodecLimits/协商纯函数等均为 AC 明确要求；预估 1100–1400 行 vs 实际 ~1600 行含 JSDoc，合理）。

## 4. 动态审核重点（交 SA7）

1. 复跑 `pnpm exec vitest run packages/replication-protocol`：确认 SA6 恢复后 9 文件 136/136 全绿（SA4 静态审查未执行测试）。
2. F1 行为实证：`encodeMessage({kind:'ERROR', code:'toString', safeMessage:'x'})` 当前应**不抛**且产出 `00 08 746f537472696e67 00 01 00…` 帧；再 `decodeMessage` 该帧应 MALFORMED_FRAME（encode/decode 不对称）。修复后应转为 encode 即抛 MALFORMED_FRAME。
3. F2 行为实证：`encodeMessage({kind:'ERROR', code:'BAD_MAGIC', safeMessage: undefined} as never)` 应抛 TypeError（修复后应 MALFORMED_FRAME）。
4. CI 触发证据：`gh run view --log` 摘录 ci.yml `pnpm test` 输出中 replication-protocol 9 文件的收集行（§1.4 静态结论的动态确认）。
5. D-5 运行时确认：Node `Buffer` 输入 decodeFrame 的 payload 视图原型为 `Buffer.prototype`（与 JSDoc 承诺一致）。

## 5. R0 最终 verdict

**reject（窄面）**——F1（MAJOR）未决：设计明文规则（§6.3 encode 侧 code ∈ 注册表否则 MALFORMED_FRAME）被不健全的查表实现绕过，typed caller 可达且静默产出注册表外 wire 输出，同时破坏 encode/decode 对称与 ProtocolError 元数据契约。修复为 errors.ts 一行 own-key 判定（连同可选的 F2 typeof 守卫），零红灯影响、无架构改动；F1+F2 修复后本包即可放行进入 SA7 动态验证。核心实现质量（帧 9 步、CanonicalReader、17 消息字段表、注册表移植、协商、limits、纯包边界）在静态验尸下全部站得住。

---

# R1 窄面重审节（2026-08-27，SA4 同 session 续传）

**重审范围**：R0 reject 的窄面——commit `7489ca1`（4feb737 之上）对 F1/F2/F3 的修复正确性与完整性、SA3 的查表点审计论证复核、新增 3 个 it 锚点与既有契约一致性、修复是否引入新问题。R0 已判 pass 的其余面不重开。**R0 §4 动态审核重点第 2/3 项已由本轮锚点测试闭环**（见下）。

**被审 diff**：7489ca1 共 5 文件（src/canonical.ts +7、src/errors.ts +10−2、src/payloads.ts +16−16、test/codec-malformed.test.ts +42−0、wiki sa3_impl 报告 +49）；全部在 ALLOW LIST / wiki 白名单内，DENY LIST 零触碰；工作区未提交改动仍仅为 SA6 恢复轮 4 件（R0 已核对，无新夹带）。

## 逐项复核结论

### F1（MAJOR）lookupError own-key 判定 — ✅ 闭环

| 检查 | 结论 | 证据 |
|---|---|---|
| 修复正确性 | ✅ | errors.ts:150-155：双 scope 均改为 `Object.hasOwn(REG, code) ? REG[code as ...] : undefined`。node 单句在冻结对象字面量上实测：`'toString'/'constructor'/'__proto__'/'valueOf'/'hasOwnProperty'` 及数字/null/undefined 入参全部 → undefined（正确拒绝），注册码 → HIT——R0 建议的修复形态逐字落地 |
| 消费点全数收口 | ✅ | grep 全量：src 中注册表式索引仅 5 处——errors.ts:152/:154（已修）、payloads.ts:751、envelope.ts:110/:152（见下审计复核）；`ProtocolError` 构造器（errors.ts:175-178）、`decodeError`（payloads.ts:264）、`encodeError`（payloads.ts:312）全部经修复后的 lookupError。继承码入参现走 connection 域兜底**保留原码**（scope='connection'/fatal:true/retryable:'no'）——`new ProtocolError('toString')` 的 undefined 元数据污染同步消除，且正是 R0 §9 写死的兜底语义 |
| **SA3 审计论证复核①**：`MESSAGE_NAMES[messageType]` 数值键路径不改 | ✅ 成立 | envelope.ts:110（decode，messageType = bytes[5]，恒 number 0-255）、:152（encode，TS 类型 number）。number 经 ToString 恒为十进制/指数字符串（node 实测 `String(1e21)`='1e+21' 亦非继承键），Object.prototype 的 13 个 own 属性（constructor/__proto__/hasOwnProperty/isPrototypeOf/propertyIsEnumerable/toLocaleString/toString/valueOf/__define*__/__lookup*__）无一为数字字符串 → 数值域内裸索引 ≡ hasOwn，免疫成立（与 R0 §1.1 步骤 6 判定一致） |
| **SA3 审计论证复核②**：`MESSAGE_TYPES[message.kind]` 字面量联合键路径不改 | ✅ 成立 | payloads.ts:751 仅在 `encodePayload` 的 17 个字面量 case 命中后可达；任意其他 kind（含 'toString'）在 switch default（payloads.ts:720-725）先抛 `UNSUPPORTED_MESSAGE_TYPE`——不暴露任意字符串索引面。纵使病态抵达，`MESSAGE_TYPES[...]` 返回函数 → encodeFrame 内 `MESSAGE_NAMES[函数]` → 强转键 → undefined → 仍 loud 拒绝，无静默面 |
| 遗漏字符串键查表点 | ✅ 无 | 上列 grep 即全集；limits.ts（无查表）、negotiation.ts（Set.has，无原型问题）、canonical.ts（无查表）、messages.ts（构造而非查表） |
| 残余面（本轮新登记 INFO-1，不阻塞） | ℹ️ | JS caller 向 encodeFrame 传**非数值** messageType（如字符串 'toString'）时 `MESSAGE_NAMES['toString']` 仍命中继承函数通过检查，随后 `out[5]='toString'` → NaN → 0（node 实测落字节 0），产出 type=0x00 的帧——decode 侧仍必拒（UNSUPPORTED_MESSAGE_TYPE）。TS 类型面不可达（number）、非 wire 攻击面、失败在任何 decode 边界仍 loud，低于 R0 F1 门槛（后者是 TS 合法字符串值碰撞）。建议后续顺手加 `typeof messageType === 'number'` 守卫或 hasOwn 对称化，纯纵深项 |

### F2（MINOR）assertWellFormedString typeof 守卫 — ✅ 闭环

- canonical.ts:69-71：`if (typeof s !== 'string') throwMalformed(...)` 置于函数首行；throwMalformed 返回 never，TS 控制流收窄 s: string，无新类型问题（包级 + 根 typecheck 双 EXIT=0）。
- 覆盖完整性：PayloadWriter.writeVarString（canonical.ts:243-246）是 assertWellFormedString 的唯一调用入口，而全部字符串字段写入均经 writeVarString——一处修复覆盖全部调用点（R0 修复建议逐字落实）。原 F2 的三个症状（undefined/null → TypeError 逃逸；数字 → TextEncoder 静默强转）现在一律 MALFORMED_FRAME，与新锚点逐例对应。
- 行为面回归检查：既有调用点全部传入经 check* helper 验证的 string（payloads.ts:50-78 的 typeof 检查链），无合法路径依赖非字符串宽容——无行为回归。

### F3（MINOR）readU32Field 死分支删除 — ✅ 闭环

- payloads.ts:109-115：函数简化为 `return reader.readVarUint32()`，注释明示「readVarUint32 内部已检查 ≤ 0xffffffff（canonical.ts）」——上界保证仍由 canonical.ts:171-177 单点承担，行为恒等。
- 调用点清点：grep 计 9 处 `readU32Field(reader)`（relatedSequence/CLOSE_OK/BOOTSTRAP_ACK/SYNC_STEP1/SYNC_STEP2×2/SYNC_APPLIED×2/UPDATE_ACK），签名 (reader) 与全部调用点一致，typecheck EXIT=0。（SA3 自报「10 处」系把函数定义行计入的口径差，无实质影响。）

### 新增锚点（3 it / 10 断言调用）与既有契约一致性 — ✅ 无弱化

- **纯增量**：numstat 42+/0−，既有断言零改动（「ERROR 与注册表一致性」describe 内插入 3 个 it）。
- 锚点 1（encode 继承码双 scope，6 例）：'toString'/'constructor'/'__proto__' × {无 namespaceId→connection, 带 namespaceId→namespace} 全部断言 MALFORMED_FRAME——正是 R0 §4 动态审核重点第 2 项的行为契约（修复前该 6 例会静默产出帧，现在 encode 即拒）。
- 锚点 2（decode wire code='toString'，1 例）：payload `00 08 746f537472696e67 01 00 00 00 0178` 手工反解无误（scope 00 + len 8 'toString' + fatal 01 + retryable 00 + 双 marker 00 + 'x'）→ MALFORMED_FRAME；该例修复前后分类不变（原走 fatal 位 mismatch，现更早走未知 code），作为契约锁定仍有效。
- 锚点 3（safeMessage null/42/undefined，3 例）：`as never` 是测试侧故意的类型违规惯用法（模拟 JS caller），断言 ProtocolError(MALFORMED_FRAME) 而非 TypeError——对应 R0 §4 第 3 项。
- 断言计数口径：SA3 自报「7 断言」实为 10 个 expectProtocolError 调用（6+1+3）；描述口径差，测试本体为准。
- 语义抽查（总控授权的复跑）：`vitest run codec-malformed.test.ts --typecheck` → **37/37 通过（34 旧 + 3 新）、Type Errors no errors、EXIT=0**（本轮独立执行）；SA3 的全量证据 `.mabf-bg/sa3-r2-vitest.log`（9 文件 139/139、EXIT=0）与 `.mabf-bg/sa3-r2-typecheck.log`（根 10 包链 EXIT=0）核对一致，139 = 136 + 3 新 it，数目自洽。

### 修复引入新问题检查 — ✅ 未发现

- `Object.hasOwn`：ES2022（Node ≥16.9/常青浏览器），tsconfig lib ES2022 提供类型（无垫片），工程基线 Node ≥20——无运行时可用性风险。
- F1 行为面变化仅限继承键入参（此前错误接受 → 现正确拒绝/兜底）；全部红灯（registries 的 lookupError 三态、malformed 的 NO_SUCH_CODE/scope 混用、golden ERROR 双例）语义不变，139/139 佐证。
- F2/F3 无行为变化（F2 仅把未分类异常/静默强转转为分类拒绝；F3 恒等重构）。
- F4/F5（R0 INFO）按 R0 裁定「可不修」保持未动，符合最小变更纪律。

## R1 重审结论

R0 三项发现（1 MAJOR + 2 MINOR）在 7489ca1 中全部正确、完整闭环：F1 修复形态与 R0 建议逐字一致且消费点全数收口，两项「不改」审计论证经独立复核均成立（并新登记 1 条 INFO 级纵深观察 encodeFrame 非数值入参）；F2 一处修复覆盖全部字符串写入点；F3 恒等重构无行为变化。新增锚点纯增量、无断言弱化，且直接闭环了 R0 交付 SA7 的两项行为实证。验证证据（包级 139/139 + 根 typecheck 双 EXIT=0）与抽查复跑一致。

**Verdict: pass —— 同意放行，SA7 可进入动态验证**（R0 §4 剩余项：全量套件复跑、CI 触发证据、D-5 Buffer 原型运行时确认；另建议 SA7 顺带覆盖 INFO-1 的 encodeFrame 非数值入参行为记录）。
