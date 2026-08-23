# 任务简报 — namespace-runtime：Runtime 骨架、同步读取与队首 P0

- Issue: #89 (welltop-jim-wang/nomicore)
- run_id: issue-89-1787497173-442625
- branch: fix/issue-89-on-docs-namespace-runtime
- base: docs/namespace-runtime
- Task Type: feature（功能开发）

## Parent

PR #85（docs/namespace-runtime）

## What to build

建立独立 @nomicore/namespace-runtime 包，实现独占 DocHandle 的 Runtime 骨架、同步读取面和队首 P0 schema preparation。Runtime 发布前 P0 已真实入队，发布后读取立即可用，早期写可在其后排队。

## Acceptance criteria

- [ ] Runtime 成功构造后独占一个 DocHandle，生产构造器不从公共 package entry 导出，失败时所有权不转移
- [ ] 公开冻结的 owner.userId/namespaceId，不公开 DocHandle、Y.Doc 或 writable Yjs reference
- [ ] read/getSchemaEnvelope/getMetadata/getActiveSchema/getStatus 均为同步只读能力，读取不等待 P0
- [ ] getSchemaEnvelope 只投影四个 primitive string 标准键并忽略额外键；META 返回全部 plain JSON 字段
- [ ] P0 是 write sequencer 的真实队首节点，只读取/编译 SCHEMA 并构造 active schema tools，不读取或验证 ROOT
- [ ] P0 正常 compile failure 形成 schema-unavailable；internal throw 永久关闭全部写但保留读取
- [ ] P0 结算后出队，只保留 preparing/ready/unavailable active schema state
- [ ] 包内确定性 testing seam 能控制 P0 resolve/reject，并证明读取在 P0 pending 时立即工作
- [ ] 全量 typecheck/test 和 Node 20/24 CI 通过

## Blocked by

- #86（已合入：2d805e9 feat(doc-runtime): schema-independent ROOT 载体投影读取 (issue #86) (#98)）

## Working Directory

/home/wangjian/nomicore-fix-issue-89

## 关键上下文（总控预读，供 SA 参考）

- ADR-0008（docs/adr/0008-namespace-runtime-read-write-capabilities-and-sequencer.md）定义
  NamespaceRuntime 全部行为契约：读取能力、单一 write sequencer、P0 与 active schema、
  生命周期/状态/所有权。本任务实现其中「Runtime 骨架 + 同步读取面 + 队首 P0」子集；
  mutateRoot/replaceSchema 两类真实写、close barrier、完整 status 投影属后续 issue。
- 前置 #86 已交付 `readLogicalValueAtPath(doc, path)`（schema-independent），
  #87 已交付 transaction fatal 契约（DocRuntimeFatalError committed-aware）。
- CONTEXT.md 术语：写序列器 / P0 / active schema / 信封 / 载体投影读取。

## SA6 红灯测试（Phase 1 验收锚定，2026-08-23）

测试文件（`packages/namespace-runtime/test/`，SA6 产出；包目录 + package.json 由 SA6 登记，
src/ 与 tsconfig.json 属 SA3 实现）：

- `runtime-public-surface-ownership.test.ts` — AC1/AC2/AC7 状态形状/AC8：生产构造器不导出、
  seam 唯一构造路径、owner 冻结、namespaceId=docId、不公开 handle/Y.Doc/writable Yjs 引用、
  released handle 构造失败且所有权不转移、结构化 status（非扁平枚举、无队列内部字段）、
  五个方法同步返回。
- `runtime-sync-read-face.test.ts` — AC3/AC4/AC8：P0 pending（p0Gate 未 resolve）时五个
  读取面立即可用且值正确、门保持时 P0 不结算（preparing 保持）、resolve 后 ready；
  getSchemaEnvelope 恰投影四键并忽略额外键（不 coercion、不补默认值）；getMetadata 全键
  深拷贝（突变/删除副本不影响重读）；read 透传 doc-runtime 结果联合（缺键 ok:true
  undefined、Y.Map 数字段 PATH_NOT_ALLOWED）。
- `runtime-p0-sequencer.test.ts` — AC5/AC6/AC7/AC8：P0 是真实异步队首节点（构造同步返回、
  绝不在构造栈内结算，preparing → ready）；active schema 身份 + 双指纹与 vfsl
  compileSchemaEnvelope 产物逐字节一致且不暴露 module/derived/validator；注入 compile
  收到的信封恰为四键投影（P0 只读 SCHEMA 标准四键）；ROOT 为 Y.Text（非 Y.Map）或内容
  违反 schema 均照常 ready（P0 不读取/不验证 ROOT），读取面不重校验（违规值原样读出）；
  正常 compile failure（TEXT_BAD 真实解析失败）→ unavailable + 稳定 issue 摘要
  （code/message、无 stack/cause）+ rootWrite 关 / schemaWrite 可修复 + 读取保留 +
  getActiveSchema null；注入 compile 抛错 → 构造不抛、fatal 稳定摘要（不含原始错误文本、
  无 stack/cause）、rootWrite/schemaWrite 永久关闭、读取保留；结算后 state 只属
  {preparing, ready, unavailable} 且收敛稳定。

**SA6 冻结的包内契约**（SA3 实现按此对接，仅可补充不可收窄）：

- 公共入口 `src/index.ts`（exports "."）：不得导出任何生产构造器（测试锁定
  `createNamespaceRuntime` 缺席；生产工厂保留包内，未来 Registry 使用）；
- seam 构造器 `createNamespaceRuntimeWithSeam(input)` 从同一入口导出（@internal，
  沿 doc-runtime `getCompiledWith` 先例），同步返回 Runtime；input =
  `{ handle: DocHandle; p0Gate?: Promise<void>; compile?: (envelope: SchemaEnvelope) =>
  CompileSchemaEnvelopeResult }`。`p0Gate` 是 P0 编译前 await 的可控门（resolve 控制）；
  `compile` 注入编译步（缺省 vfsl compileSchemaEnvelope；抛错 = internal fault 注入）。
  接受 `handle.getStatus() ∈ {'ready','persistence-degraded'}`（读与 P0 不受 degraded
  影响）；'released'/'disposed' → 同步 throw。
- Runtime 对象：`{ owner(冻结 {userId}), namespaceId(=handle.docId), read, getSchemaEnvelope,
  getMetadata, getActiveSchema, getStatus }`；不公开 doc/handle/docHandle/yDoc/sequencer/
  persistence（own/原型链均不得）。
- `read(path)` 透传 doc-runtime `readLogicalValueAtPath` 同步结果联合；
  `getActiveSchema()` 未安装时 null；`getStatus()` 结构化：
  `{ lifecycle:'ready', read:{enabled}, rootWrite:{enabled}, schemaWrite:{enabled},
  schema:{state:'preparing'|'ready'|'unavailable', issue?:{code,message}}, fatal:{code,message}|null }`，
  不得含 queue/sequence/taskType 等队列内部字段。
- P0 语义：异步（绝不 sync 结算于构造栈）、只读 SCHEMA 四键 → compile → 安装 tools；
  正常 compile failure → unavailable（rootWrite 关、schemaWrite 可修复）；internal
  throw → fatal（全部写关、读取保留、摘要稳定不含原始错误）。

**红灯证据**（2026-08-23，构造性红灯：包不存在 → 公共入口无法解析）：

```text
$ pnpm exec vitest run packages/namespace-runtime --typecheck --passWithNoTests=false
Test Files  3 failed (3)   Tests  no tests
FAIL packages/namespace-runtime/test/runtime-p0-sequencer.test.ts
FAIL packages/namespace-runtime/test/runtime-public-surface-ownership.test.ts
FAIL packages/namespace-runtime/test/runtime-sync-read-face.test.ts
Error: Cannot find module '../src/index.js' imported from '…/runtime-*.test.ts'
```

即：3/3 测试文件全部红，红灯锚点是缺失的 `@nomicore/namespace-runtime` 公共入口
（src/index.js 不存在 → 模块未找到，全部错误唯一且同源）。SA3 建包实现后，行为断言
接管并转绿。全量基线（`pnpm test`，CI 同命令）：`Test Files 3 failed | 70 passed (73)，
Tests 1002 passed (1002)` —— 全部既有 1002 用例零回归，红仅出现在本任务 3 个新文件；
`pnpm typecheck`（六包）通过。

**交付备注**：

- SA6 已登记 `packages/namespace-runtime/package.json`（deps：doc-runtime/persistence/
  vfsl/yjs）+ pnpm-lock.yaml importer（沿 doc-runtime 建包先例「package.json 既有；
  lockfile importer 为 SA6 登记」）；未创建任何 src/ 生产文件、未改任何现有包。
- `scripts/test-lock.sh` 在本仓不存在（根无 scripts/ 目录），本任务无新测试包/端口
  依赖（仅新增一个 workspace 包），无需更新。
- 全量基线验证（`pnpm typecheck` + `pnpm test`）结果见 dispatch log / wiki 记录。
