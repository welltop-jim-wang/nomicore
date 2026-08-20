# 任务简报 — 修补：派生 schema 携带 docs + typeCls 签名收敛（Issue #29）

- **任务类型**: bugfix（PR #28 评审修补票：契约缺口落地 + 调用惯例收敛）
- **Worktree**: /home/wangjian/nomicore-fix-issue-29
- **分支**: fix/issue-29-on-adr-union-representation（基于 adr/union-representation @ 40c1be0）
- **Parent**: PR #17
- **上游事实**: PR #28（issue #20 求值器）已合入，双轴评审 + 实测确认的唯一实质差距即本票

## 背景

PR #28 评审确认：evaluate 产出的派生 schema 尚未携带 JSDoc 原文。docs 携带决策（issue 正文称 ADR 0005 §3）形成于 #20 发布之后、未进入其正文，属于新增契约而非回归。

**⚠️ ADR 0005 未入库**：仓库 `docs/adr/` 现仅有 0001–0003。ADR 0005 §3 的决策内容以下方「工作内容 1」为唯一权威来源，**不得因找不到 ADR 0005 文件而阻塞或臆造其内容**。

## 工作内容

1. **派生 schema 携带 docs**（ADR 0005 §3 落地）：derived 节点增加 `docs: string[]` 槽位（别名 / map 字段 / 标记位，与 IR 三锚位对应），`evaluate` 从 IR 对应节点继承原文。这是票 F2 生成器发射 TSDoc 的输入契约（IDE hover 中文说明），也是 Phase 4 AI namespace card 的数据源。决策于 #20 发布之后、未入其正文，runner 无责；
2. **typeCls 签名收敛**（Standards 轴建议）：`typeCls(t, cls, bodies)` 挂到 Resolver 上，调用方不再解包传参（对齐 shapes.ts「查询只经自含助手」惯例）；
3. **观察项（评估后决定，非必须）**：判别式检测当前仅认内联 object 成员（evaluate.ts `detectDiscriminator`，约 :222），评估放宽到 ref 成员的可行性——缓存是非契约的，放宽不改变可观测行为。

## Acceptance criteria

- [ ] derived 的别名 / map 字段 / 标记节点携带 `docs: string[]`（无注释为空数组，与 IR 纪律一致）
- [ ] docs 内容自 IR 对应节点逐字继承（含联合成员内字段、标记实参位）
- [ ] 派生 schema JSON 序列化往返仍无损（含 docs）
- [ ] typeCls 收敛后调用方不再解包 Resolver 成员
- [ ] 存量 253 测试全绿 + 新增 docs 携带断言（含嵌套/联合内字段位）
- [ ] 规格 §10 fixture 求值后 ROOT/Audit 等节点 docs 与 IR 一致

## 仓库事实（SA 共用）

- **术语规范**: `CONTEXT.md`（派生 schema / IR / 求值器 / 结构树 / 值 schema / 语义层等；用词以它为准）
- **既有架构决策**: `docs/adr/0001–0003` 不得违反——特别是 0003 §4「别名按名引用（ref）保留、不内联展开」
- **规格**: `docs/vfsl/v1-spec.md`（§10 为 fixture 章节；AC 最后一条以其求值结果为锚）
- **关键代码**: `packages/vfsl/src/`（`evaluate.ts` / `resolve.ts`——`typeCls` 在 :129、Resolver 由 `buildResolver` 构造 / `shapes.ts` / `ir.ts` / `derived.ts`）
- **测试**: `packages/vfsl/test/`（存量 10 个测试文件、253 用例）
- **测试命令**: 根目录 `pnpm test`（vitest run）；类型检查 `pnpm typecheck`（tsc -p packages/vfsl/tsconfig.json）
- **版本**: `packages/vfsl/package.json` 当前 0.1.5；改动该包须 bump patch（Hard Gate 9）

## 纪律

- TDD：先写红测试再改代码；无法复现的缺口不盲修
- 本地测试红必须修，禁止屏蔽/跳过/排除测试
- 长脚本（vitest/tsc/build）一律 `setsid nohup` 后台独立进程，禁止前台同步阻塞
- 分支提交纪律：`TASK.md` 是调度器写入的工作区文件，**不得进入分支 commit**（PR #28 期间 SA4 曾因 TASK.md 误入 diff 而 reject）
- PR 创建与推送由外部 `check.sh` 负责，总控与所有 SA 一律不得自行执行

---

## SA6 红灯测试记录（2026-08-19 追加）

### 测试文件

`packages/vfsl/test/evaluate-derived-docs-typecls.test.ts`（新增，8 条断言；纯 vitest 单元测试，无新增依赖、无端口 → 无 `scripts/test-lock.sh` 更新义务；仓库无该脚本）

### 测试设计（契约承载位置锁定）

**硬约束推导**：既有 `evaluate-derived-schema.test.ts` 对 StructureNode / MapField / ValueSchema / ValueField 做了精确 `toEqual`（如 :431 字段对象 `{name, optional, node}`、:356/:534 `{name, value}`、:326/:355 终态节点 `{kind}`）——在这些既有类型上加必填 `docs` 键即违约「存量 253 测试全绿」。故 docs 三锚以 **DerivedSchema 新增三个顶层槽位**承载（纯数据、可序列化，不破坏内容哈希纪律）：

| 槽位 | 键 | 值语义 |
| --- | --- | --- |
| `aliasDocs` | 别名名（含 ROOT；每别名一项） | `VfslAlias.docs` 逐字继承；无 doc 为空数组（必填） |
| `fieldDocs` | 语法路径（与 index 键同构；联合成员内字段以 `<member N>` 段定位，N = 成员声明序 0 起；Record 值位合成字段 `<key>` 同表） | `VfslField.docs` 逐字继承；无 doc 为空数组 |
| `markerDocs` | 标记所产节点路径（标记在字段类型位 → 该字段路径；标记在别名体根 → 别名名路径） | `marker.docs` 逐字继承；无 doc 为空数组 |

SA5 报告「别名级承载位置需 SA1 定形」——SA6 红灯契约即定形，以本表为准；SA1 如持异议须在实现前与总控协调，不得擅自改形。

**AC 覆盖**：
- AC1 → 空数组断言（fixture 无注释字段/标记 + 合成模块无 doc 字段/别名）
- AC2 → 合成模块全量断言：联合成员内字段位（`Entity.<member 0>.kind` 等）+ 标记实参内字段位（`Entity.<member 1>.body.paragraphs`）+ 字段类型位标记（`ROOT.n`）+ 别名体根标记（`Box`）
- AC3 → JSON 往返 + docs 三锚在往返后仍在
- AC4 → typeCls 三件套：**模块导出断言**（resolve.ts 不再导出自由函数 `typeCls`）+ **Resolver 方法形态**（`R.typeCls(t)` 为 function）+ **方法语义**（scalar/map 判定与收敛前一致，驱动真实 `buildResolver` 路径）——全部为运行时行为/模块导出断言，零源码 grep
- AC6 → §10 fixture 求值后 `aliasDocs` 与 IR `VfslAlias.docs` **逐字全量一致**（for 循环遍历比对）+ ROOT/Audit/AssetId/AssetEntity/Attachments 具名锚 + `fieldDocs['ROOT.notes']` 与 IR 字段 docs 逐字一致
- AC5 → 既有 253 测试形状零改动（新槽位全部为顶层新增键，不触碰既有断言对象）

### 红灯运行证据

命令：`pnpm exec vitest run packages/vfsl/test/evaluate-derived-docs-typecls.test.ts`（后台独立进程 `setsid nohup`，退出码 1）

```
 Test Files  1 failed (1)
      Tests  8 failed (8)
   Duration  335ms
```

关键失败断言（逐条为真红灯，非伪红）：
1. `AC6：…各别名 docs 与 IR 逐字一致` → `expected null to deeply equal [ " vfs3.assets — … ", " 资产 ID：… " ]`（aliasDocs 槽缺失）
2. `AC1+AC2：ROOT.notes` → `expected null to deeply equal [ " @semantic 可选说明字段 " ]`
3. `AC1：无注释…空数组` → `expected null to deeply equal []`
4. `AC2：联合成员内字段位…` → `expected null to deeply equal [ " 变体标记 " ]`（合成模块 parse 成功，失败点在 docs 槽——parser 对联合成员内/标记实参位挂载已支持）
5. `AC3：JSON 往返` → `expected null to deeply equal [ " ROOT：… " ]`
6. `AC4：自由函数不再导出` → `expected [Function typeCls] to be undefined`
7. `AC4：Resolver 方法形态` → `expected 'undefined' to be 'function'`
8. `AC4：方法语义` → `expected undefined to be 'scalar'`

结论：**Bug 缺口真实可复现**，红灯为真（缺口 = 缺特性而非断言误构）；SA3 实现后应 8 条全转绿且 253 存量保持全绿。
