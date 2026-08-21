# MABF Task: 信封解析与方言路由：parseSchemaEnvelope（H1）

> 来源：Issue #52 / TASK.md（run_id: issue-52-1787293031-3044291，branch: fix/issue-52-on-phase-2-engine-gaps，base: phase-2-engine-gaps）
> 任务类型：功能开发（新增公共导出，无缺陷复现诉求）

## Parent

PR #51

## What to build

实现信封解析与方言路由（设计文档 §6/§9/§10；PRD #3 明示「信封解析与方言路由是后续引擎任务」）：新增公共导出 `parseSchemaEnvelope(input: unknown) → { ok: true; envelope; module } | { ok: false; issues }`。流程：信封形状校验（`{lang, version, id, text}` 四键齐备 + 类型校验；`id` 仅标签、不校验格式）→ 方言断言（`lang === 'vfsl' && version === 1`，否则只读 loud-fail）→ `parseVfsl(text)` 透传（文本错误携带原行列）。**未知方言的错误身份必须与 schema 语法错误可区分**（前者 = 只读 loud-fail，后者 = 文本非法）。

## 修订（2026-08-21，owner 决策）

信封在 doc 中的键名定为 **`SCHEMA`**（原设计文档的 `__schema__`）——与 `ROOT` 保持统一命名（doc 顶层两个具名条目：`SCHEMA` 信封 + `ROOT` 数据，均为普通大写、无 dunder 前缀）。本票的信封解析即针对 `SCHEMA` 键下的 `{lang, version, id, text}` 结构。

## Acceptance criteria

- [ ] 接缝形状如上；同步、纯函数、不抛错（与既有接缝同款纪律）
- [ ] 信封形状负例：缺键 / 多键不拒（向前兼容加法）/ 类型错误（version 非 number、text 非 string）→ 结构化拒绝
- [ ] 方言断言：`{lang:'vfsl', version:2}` / `{lang:'other'}` → 拒绝且错误身份可区分为「未知方言（只读）」
- [ ] 合法信封透传：parseVfsl 的 ok/issues 原样返回（含行列）
- [ ] `id` 任意字符串（含空串、撞名场景）不影响判定
- [ ] 错误码/消息不与 parseVfsl 的 VFSL-E 码空间混淆（独立前缀或明确区分机制）

## Blocked by

None - can start immediately

---

## SA6 红灯验收测试记录（Phase 1 验收锚定，2026-08-21）

### 测试文件

`packages/vfsl/test/parse-schema-envelope.test.ts`（12 条用例，vitest，经 `../src/index.js` 公共入口）

### AC → 测试锚点映射（逐条）

| AC | 测试锚点（运行时行为断言） |
|---|---|
| AC1 接缝形状 | 合法信封 → 同步返回 `{ok:true, envelope, module}`（非 Promise/thenable、不抛错、纯函数两次调用一致）；任意非信封输入（undefined/null/42/string/true/[]/[1,2]/{}/函数）→ `{ok:false, issues}` 结构化拒绝而非抛错 |
| AC2 信封形状负例 | 缺键（四键各自缺失 + 空对象）→ 结构化拒绝；类型错误（version:'1' / text:42 / lang:1 / id:42）→ 结构化拒绝；多键不拒：合法信封 + 多余键 → ok:true 且四键原值透传 |
| AC3 方言断言 | `{lang:'vfsl', version:2}` 与 `{lang:'other', version:1}` → 拒绝，issues 消息指向方言层（/方言\|dialect/i）、不落入 VFSL-E 码空间；**顺序锚**：同一非法文本 + 未知方言 → 方言错误（而非文本错误），vfsl@1 → 文本错误原样透传——证明未知方言先于文本解析 loud-fail 只读 |
| AC4 合法信封透传 | ok:true → module 与 `parseVfsl(text).module` 完全一致；ok:false → issues 与 `parseVfsl(text).issues` 完全一致（fixture VFSL-E100 @ line 3, column 7 显式断言行列） |
| AC5 id 仅标签 | id 空串、`'a/b\c..中文 🎉 $%^'` 特殊字符 → ok:true 判定不受影响；撞名：同 id 两个不同文本信封 → 各自按自己文本解析（无去重/注册表） |
| AC6 错误码空间独立 | 信封/方言拒绝的每条 issue message 一律 `not.toMatch(/^VFSL-E\d+:/)`（独立前缀可区分机制）；对照：文本错误透传仍保留 VFSL-E 前缀——两通道并存且可区分 |

### 红灯运行证据

- 命令：`pnpm exec vitest run packages/vfsl/test/parse-schema-envelope.test.ts`（后台独立进程，日志 `/tmp/sa6-red-envelope2.log`）
- 结果：**Test Files 1 failed (1) / Tests 12 failed (12) / Type Errors no errors / exit code 1**
- 红灯根因（真实、非伪红）：`TypeError: (0, parseSchemaEnvelope) is not a function`——`parseSchemaEnvelope` 尚未在 `packages/vfsl/src/index.ts` 导出（构造性红灯，同 schemasource-seam.test.ts 先例）。SA3 实现公共导出后逐条断言即成为行为锚点。
- 附注：`pnpm typecheck`（`tsc -p packages/vfsl/tsconfig.json`）当前唯一新增错误为 TS2724「index.js 无 parseSchemaEnvelope 导出」——测试文件其余部分类型干净，SA3 补导出后即消。
- 测试策略变更：无（未新增测试包/端口依赖，`scripts/test-lock.sh` 不存在、无需更新）。

### SA6 追加：F1 回归红灯锚（SA4 R1 reject 回流，2026-08-21）

**背景**：SA3 实现（cb7a2c7）后原 12 条用例转绿；SA4 R1 reject F1——`packages/vfsl/src/envelope.ts:179` `envelopeCrashIssue` 的 `String(err)` 在顶层 catch 内二次可抛（不可字符串化 thrown 值 → `TypeError: Cannot convert object to primitive value` 逃逸），击穿「不抛错」契约。SA4 回流目标：SA6 补 1 条对抗红灯锚。

**新增用例**（文件末尾新 describe「F1 回归锚」，用例数 12 → 13）：
- 三向量循环：getter 抛 `Object.create(null)`（SA4 最小复现）、getter 抛 `{toString:42}`、Proxy get trap 抛 `Object.create(null)`（属性读取路径注入点）
- 断言：`parseSchemaEnvelope` 不外抛；`{ok:false}`；首条 issue = `VFSL-ENV-E100:` 前缀（`not.toMatch(/^VFSL-E\d+:/)` 双保险）、坐标哨兵 line 0 / column 0、message 恒单行（无真实换行）
- 锚定设计 §7 边界表「对抗 getter/Proxy 抛异常 → 顶层 catch → ENV-100（不外抛）」成文承诺；未锁定修复措辞（不断言兜底正文文本）

**红灯运行证据（修复前实跑）**：
- 命令：`pnpm exec vitest run packages/vfsl/test/parse-schema-envelope.test.ts`（后台独立进程，日志 `/tmp/sa6-f1-red.log`）
- 结果：**Tests 1 failed | 12 passed (13) / Test Files 1 failed (1) / Type Errors no errors / exit 1**——新用例红、原 12 用例保持绿 ✓
- 红灯根因（真实、与 SA4 §F1 取证一致）：`AssertionError: expected [Function] to not throw an error but 'TypeError: Cannot convert object to primitive value' was thrown`（envelope.ts:179 `String(err)` 二次抛出逃逸）
- `tsc -p packages/vfsl/tsconfig.json` 0 错（新用例类型干净，无需 SA3 处理）
- 测试策略变更：无（纯新增断言，无新依赖/端口）

