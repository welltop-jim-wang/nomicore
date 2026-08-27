# 任务简报 — Phase 5: implement instance replication protocol v1 codec

- **Issue**: #135（label: feature）
- **Parent**: PR #130（docs/phase-5-websocket-replication）
- **Branch**: fix/issue-135-on-docs-phase-5-websocket-replication
- **任务类型**: 功能开发（feature）
- **run_id**: issue-135-1787792421-862383

## What to build（issue 原文）

Implement the pure binary protocol Module defined by the accepted instance replication v1 wire contract, including strict framing, canonical payloads, version negotiation, append-only message/error registries, and malformed-input classification.

## Acceptance criteria（issue 原文，逐条验收基准）

1. A WebSocket binary message encodes exactly one 20-byte big-endian NMCR envelope plus its declared payload.
2. The codec strictly enforces magic, envelope version, flags, reserved, direction-local sequence, payload length, namespaceId format, full payload consumption, and configured limits.
3. All v1 HELLO, GOAWAY, ERROR, OPEN/CLOSE, bootstrap, sync/resync, identity, update, and dedicated ACK payloads match the normative field order and message codes.
4. Error codes derive immutable scope/fatal/retryable/terminal metadata from an append-only registry.
5. The package directly pins compatible yjs, y-protocols, and lib0 versions and has no Cordis, WebSocket, Registry, Buffer, or server dependency.
6. Byte-level golden vectors, canonical roundtrips, every-offset truncation, length/overflow/trailing-byte cases, version matrices, and fuzz/property tests pass.

## Blocked by

None (can start immediately).

## 规范依据（worktree 内必读）

- `docs/protocols/instance-replication-v1.md` — **规范性 wire contract（唯一权威）**：20-byte 大端 envelope、消息注册表（0x01–0x41）、全部 payload 字段顺序、connection/namespace 错误注册表、上限与验收测试要求（§22 Conformance tests）。
- `docs/phases/phase-5-websocket-replication.md` — 实施切片 5（`@nomicore/replication-protocol` 范围）与测试 seam 要求。
- `docs/adr/0010-hub-peer-websocket-ydoc-replication.md` — ADR 0010（ADR 全集位于 `docs/adr/`）。
- `CONTEXT.md` — 词汇表。

## 范围界定（来自 phase-5 切片 5）

- 新建纯包 `packages/replication-protocol`（`@nomicore/replication-protocol`）。
- 严格实现 instance-replication-v1：20-byte 大端 envelope、一 WS message 一 frame、namespaceId 直接寻址、lib0 canonical payload。
- 显式 envelope/protocol 版本与 capability 协商，不靠消息数值猜测。
- append-only 消息/错误注册表、direction-local sequence、专用 ACK、统一 ERROR。
- 显式直接依赖并锁定兼容的 yjs / y-protocols / lib0 组合。
- Byte-level golden、canonical roundtrip、截断/越界/尾随、版本矩阵与 fuzz/property tests。
- **纯包**：不依赖 Cordis、WebSocket、Registry 或 Node server；不依赖 Node `Buffer`（issue AC 明确）。
- **非目标**（属后续切片，不做）：WS 连接/状态机、namespace 状态机、认证授权、背压调度、Runtime/Registry 集成——本票只做 wire codec/注册表/版本协商纯模块。

## 仓库工程约定（现状快照）

- pnpm workspace：`packages/*`；包 `exports` 指向 `./src/index.ts`（TS 直出）。
- 根 `pnpm test` = `vitest run --typecheck`，include `packages/*/test/**/*.test.ts`；typecheck include `*.test-d.ts`。
- 根 `pnpm typecheck` 逐包 `tsc -p packages/<pkg>/tsconfig.json`——新包必须加入该脚本链。
- 改过的包 bump patch 版本（新包从 `0.1.0` 起）。
- 严格 tsconfig：`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`verbatimModuleSyntax` 等（见 `tsconfig.base.json`）。
- 现有包 yjs 版本：`^13.6.30`（lockfile 实际 13.6.32，lib0 传递依赖 0.2.117）；y-protocols 尚未在 lockfile，需要新增直接依赖。
- Node >= 20；ESM only。

## 验收自查提示（§22 Conformance tests 中属于本票的部分）

- 固定 envelope 与每种 payload 的 byte-level golden vectors（实现生成十六进制并提交，不得改字段顺序适配库偶然编码）；
- encode/decode canonical roundtrip；
- 每个 byte offset 截断；
- header/payload 长度少一、多一、溢出、巨大声明短 body；
- 非零 flags/reserved、未知版本/type/capability、非法 sequence/ACK；
- trailing bytes、非法 UTF-8、非法 namespaceId、错误 optional/list count；
- fuzz/property tests：decoder 不得越界分配或抛出未分类异常；
- 版本协商全矩阵；
- （fake duplex 状态机、真实 WS 集成属后续切片，不在本票。）

---

## SA6 红灯验收测试（Phase 1 验收锚定，2026-08-27 追加）

**产出目录**：`packages/replication-protocol/test/`（包本体由 SA3 创建；SA6 只写测试与 fixtures，未创建 package.json/src）。

| 文件 | 锚定的验收项（issue AC / §22） |
|---|---|
| `fixtures.ts` | 共享契约与 18 个 golden（lib0@0.2.117 canonical + §3 20-byte BE 头，已与 lockfile lib0 行为逐项核对）；解码检查顺序契约 |
| `codec-envelope.test.ts` | AC1/AC2：20-byte 大端 NMCR 头逐 offset、magic/版本/flags/reserved/type/sequence/长度检查顺序、maxFrameBytes 边界、FRAME_TOO_LARGE、一 message 一 frame |
| `codec-messages-golden.test.ts` | AC3：17 种 v1 payload 的 byte-level golden（字段顺序=规范表格，不迁就库偶然编码）；ERROR 元数据注册表推导 |
| `codec-roundtrip-truncation.test.ts` | AC6：17 种 canonical roundtrip + 每 offset 截断（0–3→BAD_MAGIC，其余→FRAME_LENGTH_MISMATCH）+ trailing（帧级/载荷级） |
| `codec-malformed.test.ts` | AC2/AC6：非法 UTF-8、非法 namespaceId、非 canonical varUint、错误 optional marker/count、巨大声明短 body、HELLO/OPEN 字段规则、ERROR 与注册表 bits 一致性、字段级 limit（UPDATE_TOO_LARGE 等）、encode 侧输入校验 |
| `codec-registries.test.ts` | AC3/AC4：消息注册表恰 17 条（code/scope/direction/ack）、连接错误恰 17 条、namespace 错误恰 20 条（含双 registry INTERNAL_ERROR）、冻结不可变、lookupError |
| `codec-version-interop.test.ts` | AC6：版本协商全矩阵、capability 交集/拒绝、HELLO→HELLO_ACK 全流程；真实 yjs update/state vector/snapshot 经 codec 往返收敛（锁定组合互通） |
| `codec-fuzz-property.test.ts` | AC6 §22：固定种子随机字节 fuzz（成功即 canonical 还原、失败必须为注册表分类错误——不得越界分配/未分类异常）、seeded 合法消息 roundtrip、golden 单字节变异 |
| `codec-package-contract.test.ts` | AC5：manifest 直接锁定 yjs/y-protocols/lib0、无 cordis/ws/registry/server/buffer 依赖；globalThis.Buffer 遮蔽下全链路行为（纯 Uint8Array 输出） |
| `codec-api.test-d.ts` | 类型层契约（vitest --typecheck）：ReplicationMessage 判别联合、DecodedMessage/FrameHeader、ERROR 无 fatal/retryable 可覆盖字段、协商函数签名、ProtocolError |

**测试必须保持红灯的行为契约（SA3 实现时不得弱化）**：任何解码失败都抛 `ProtocolError`（code ∈ 错误注册表）；解码顺序 magic→长度→version→flags→reserved→type→maxFrameBytes→长度匹配；payload 完全消费；ERROR 的 scope/fatal/retryable 由注册表导出、wire 值与注册表不符即 MALFORMED_FRAME；namespaceId `^ns-[0-9a-f]{32}$`；非 canonical varUint 拒绝；字段级限额错误码 UPDATE_TOO_LARGE/BOOTSTRAP_TOO_LARGE/SYNC_DIFF_TOO_LARGE。

### 红灯运行验证（真实执行，独立进程）

命令：`pnpm exec vitest run packages/replication-protocol`（worktree 根，vitest include >9 个新文件；后台独立进程执行）。

结果（`/tmp/sa6-red-final.log`）：

```
 Test Files  9 failed (9)
      Tests  7 passed (7)      ← 仅 test-d 的类型检查项；.test.ts 全因 import 失败而未执行
Type Errors  no errors
     Errors  16 → 14 errors（模块缺失级联；修复自身 TS bug 2 处后余均为预期 TS2307）
EXIT=1
```

失败根因（每条即为预期红灯锚点）：
- 8 个 `*.test.ts`：`Error: Cannot find package '@nomicore/replication-protocol'`（包尚未实现——红灯）；
- `codec-api.test-d.ts`：`TypeCheckError: Cannot find module '@nomicore/replication-protocol'`（TS2307——红灯）；
- `codec-version-interop.test.ts` 另含 `Cannot find module 'yjs'`（SA3 建包并声明 yjs/y-protocols/lib0 依赖后消解；非测试侧类型缺陷——已用 /tmp 契约 stub 对全部 .ts 测试做 tsc 全量校验，exit 0，测试代码类型干净）。

禁止事项核对：无源码 grep 断言（全部断言为运行时行为/字节/注册表内容/模块导出/异常分类）；未创建 package.json/src（包创建归 SA3）；`scripts/test-lock.sh` 不存在（无脚本需维护）。非目标确认：fake-duplex 状态机与真实 WS 集成按简报属后续切片，未纳入本批测试。
**修订记录（2026-08-27 续轮）**：`test/codec-api.test-d.ts` 第 85 行 ProtocolError 断言确定为类型实参形式 `expectTypeOf<ProtocolError>().toMatchTypeOf<Error & { code: string; fatal: boolean; scope: string }>()`（第 14 行保持 `import type`，不断言构造器）；同文件第 74 行 wsCloseCode 断言改为 `NonNullable<typeof CONNECTION_ERRORS.BAD_MAGIC>['wsCloseCode']` 形式（语义不变：仍是 number | undefined，仅规避 noUncheckedIndexedAccess 下 Record 注册表点访问的 TS18048）。已用 /tmp 契约 stub 对 test-d 全文件 tsc 校验通过（exit 0），全套红灯回归为 module-not-found 类 TS2307（`Test Files 9 failed (9) / Errors 14 / EXIT=1`，见 /tmp/sa6-red-rev.log）。
**修订记录（2026-08-27 R2 轮）**：按 SA2 攻击点 #1（CRITICAL：property 生成器与 malformed nonce 规则互斥）修正 `test/codec-fuzz-property.test.ts`：(1) `randomMessage` case 0（HELLO）/case 1（HELLO_ACK）的 `connectionNonce` 改为固定 16 字节（`Uint8Array.from({length:16}, (_,i)=>i)`），`randomBytes()`（0–63 随机长度）仅保留给无长度规则的 snapshot/stateVector/update 等字段；(2) 新增防回归元测试「mulberry32(0x99aa) 全 300 轮断言每次 HELLO/HELLO_ACK 的 connectionNonce.byteLength === 16（§6.1）」（含样本数 >0 断言）；(3) malformed 侧 nonce 15/17 必拒断言（encode/decode 双侧）保持不动。修正前确定性模拟：300 轮 44 次 HELLO/HELLO_ACK nonce 抽取、42 次 ≠16（15/17/36 均出现，恰为 malformed 锚定必拒长度）；修正后模拟：29 次抽取全部 =16。stub tsc 校验 exit 0；重跑红灯套件（/tmp/sa6-red-r2.log）：`Test Files 9 failed (9) / Errors 14 / EXIT=1`，全部失败仍仅为包未实现（module-not-found @nomicore/replication-protocol + yjs 级联），无断言侧错误。
**修订记录（2026-08-27 恢复轮，SA6-owned 测试侧缺陷修复）**：SA3 交付包本体（commit 4feb737）后红灯套件 130/136 通过，剩余 6 个失败由 2 个测试侧缺陷导致（总控独立复核成立后授权最小修复）。
- 缺陷 A（CRITICAL，HELLO golden 版本表 wire 与对象互斥）：`test/fixtures.ts:244` HELLO fixture 的 payloadHex 版本段编码为 `03 01 02 03`（[1,2,3] 升序），与同条目 message 对象 `protocolVersions: [3,2,1]`（fixtures.ts:240）、`codec-messages-golden.test.ts:67` 的 `toEqual([3,2,1])` 断言及 `codec-malformed.test.ts:203-212`「升序必拒」锚点（规范 §6.1 严格降序）互斥，导致 decode 该 golden 必抛 MALFORMED_FRAME、roundtrip 必然不还原。修复：payloadHex 中 `03010203` → `03030201`（即规范编码 count=03, 03, 02, 01），其余字节一律不动；frameHex 由 buildFrameHex 自动派生，message 对象保持 [3,2,1]。
- 缺陷 B（golden 计数断言与实际条目数矛盾）：`test/codec-messages-golden.test.ts:51` `expect(GOLDEN).toHaveLength(17)`，而 fixtures.ts 的 GOLDEN 恰有 18 条 fixture（17 种消息类型，其中 ERROR 有 ERROR_CONN 与 ERROR_NS 两条变体），与设计全文及 fixtures 注释「18 个 golden」一致。修复：`toHaveLength(17)` → `toHaveLength(18)`；it 标题「注册表恰好 17 个 v1 消息」按消息类型计 17 种仍正确，未改动。
- 修复后验证（vitest v3.2.7，`pnpm exec vitest run packages/replication-protocol`，detached 进程，.mabf-bg/sa6-fix.log）：`Test Files 9 passed (9) / Tests 136 passed (136) / Type Errors no errors / EXIT=0`（2.17s）。9 个测试文件全绿：codec-messages-golden 26、codec-version-interop 25、codec-roundtrip-truncation 8、codec-registries 13、codec-malformed 34、codec-fuzz-property 5、codec-package-contract 5、codec-envelope 13、codec-api.test-d（TS 类型检查）7。
