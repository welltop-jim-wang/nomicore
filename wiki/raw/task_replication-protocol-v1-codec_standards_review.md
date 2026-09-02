# Standards 轴独立代码审查 — issue #135 `@nomicore/replication-protocol` v1 codec

- **审查对象**: `git diff 980b16a...HEAD`（4feb737 / 7489ca1 / 1060bb9 / fa53d86），仅 `packages/replication-protocol/**` + 根 `package.json` typecheck 链；wiki/raw、REPORT.md、.mabf-bg 属流水线元数据未审。
- **标准源**: 任务简报 §仓库工程约定、§范围界定；docs/protocols/instance-replication-v1.md（规范性 wire contract）；tsconfig.base.json。
- **方法**: 通读 src 9 文件 + test 10 文件，逐项对表简报约定与规范 §3/§5/§6–§13/§17；独立进程实测验证。

## 一、明文标准逐项核对（hard violation 清单）

| 标准（来源） | 结果 |
|---|---|
| pnpm workspace `packages/*`、新包 `0.1.0`、`exports["."]="./src/index.ts"`、`type:module`（简报 §仓库工程约定） | ✅ package.json:2-8 |
| 根 `pnpm typecheck` 链加入新包（同上） | ✅ 根 package.json diff 仅一行追加 `tsc -p packages/replication-protocol/tsconfig.json`，实测 EXIT=0 |
| 根 `pnpm test` = `vitest run --typecheck` 覆盖新测试（同上） | ✅ vitest.config include `packages/*/test/**/*.test.ts` + `*.test-d.ts` 双 glob 命中；CI ci.yml:39 `pnpm test` 触发，无孤儿测试 |
| 严格 tsconfig 继承（tsconfig.base.json） | ✅ extends + include src/test；tsc strict 全项通过（工具已强制项跳过） |
| 纯包：无 Cordis/WebSocket/Registry/Node server/Buffer（简报 §范围界定 + AC5） | ✅ src 唯一外部 import 为 `lib0/encoding`（canonical.ts:21），无 `node:`/`ws`/cordis；Buffer-free 有运行时行为测试（codec-package-contract.test.ts:51-88）。测试侧 `node:fs` 仅读 manifest，不属包运行时依赖 |
| 显式锁定兼容 yjs/y-protocols/lib0（AC5） | ✅ deps `lib0 ^0.2.117`/`y-protocols ^1.0.7`/`yjs ^13.6.30`；lockfile 解析 0.2.117/1.0.7/13.6.32，peer `yjs@^13` 满足且无 lib0 双版本 |
| wire contract 规范性对表 | ✅ 抽查通过：20-byte 大端头布局与 9 步检查序（envelope.ts ↔ §3）、消息注册表 17 条 code/scope/direction/ack（messages.ts ↔ §5）、连接/namespace 错误注册表 17+20 条 fatal/retryable/wsCloseCode/terminalState 逐值一致（errors.ts ↔ §13.1/13.2）、HELLO 字段序与严格降序（payloads.ts ↔ §6.1）、OPEN_NAMESPACE identity 成对律（↔ §7.1）、ERROR 七段 + registry 位一致性（↔ §13）、limit 启动响亮验证不 clamp（limits.ts ↔ §17） |
| Node >= 20 / ESM only | ✅ ESM（.js 后缀 import）；无 engines 字段与仓库全部既有包一致，非偏离 |

**hard violation：0 项。**

## 二、Fowler smell 发现（全部为 judgement call，非阻断）

- **F1 Duplicated Code**（payloads.ts:221-224/276-287/350-362）：optional marker `!==0 && !==1` 校验形状重复 6 处，`CanonicalReader.readBool` 已含同型检查（错误文案不同）；可提取 `readMarker(name)` helper。
- **F2 Duplicated Code**（payloads.ts:471-485/550-564/611-623）：`resolveFieldLimit → 比较 → throw 专用错误码` 同形状在 BOOTSTRAP/SYNC_STEP2/UPDATE 的 decode+encode 共 6 份；可提取 `checkFieldLimit(len, max, code)`。
- **F3 Duplicated Code**（src/messages.ts:102-243 vs test/fixtures.ts:77-201）：17 个消息 interface 双轨维护（SA6 红灯先行所致，编译期由 encodeMessage 输入对齐兜底）；漂移风险低但存在。
- **F4 Data Clumps**（src/messages.ts:144-183）：`namespaceId/replicationId/replicationEpoch` 三元组横跨 OPEN_OK/BOOTSTRAP_SNAPSHOT/IDENTITY_CHANGED/OPEN_NAMESPACE；系 wire 表格驱动，平铺可接受。
- **F5 Repeated Switches**（payloads.ts:643-682/684-727）：decode/encode 两张平行 17-case 分发表；TS 判别联合穷尽性可证，codec 惯用形状。
- **F6 冗余表达式（nit）**（test/fixtures.ts:65）：`((sequence >>> 0) >>> 0)` 双重无符号化，多余一层。

测试质量：无源码 grep 断言（唯一 readFileSync 为 manifest 配置断言，行为断言另有覆盖）；红字契约未见弱化；golden/matrix/fuzz 均为运行时行为断言。

## 三、验证证据（独立进程实测）

- `pnpm exec vitest run packages/replication-protocol` → **Test Files 9 passed / Tests 139 passed / Type Errors no errors / EXIT=0**（/tmp/sa4-stand-verify.log）。
- `pnpm run typecheck`（根链含新包）→ **EXIT=0**。
- `git diff` 逐 hunk 审读 + 规范对表（见 §一）。

## 四、汇总

**findings 总数 6（hard violation 0 + judgement call 6），最重一项为 F1/F2 Duplicated Code（同形状校验重复 6 处，属可维护性级别，建议下轮顺手提取 helper，不构成阻断）。**

Verdict: pass
