# 任务简报 — 求值器核心：evaluate 公共导出与派生 schema（issue #20）

- **Worktree**: /home/wangjian/nomicore-fix-issue-20
- **Branch**: fix/issue-20-on-adr-union-representation（base: adr/union-representation；PR #17 为 Phase 0b Parent）
- **任务类型**: 功能开发（Feature）
- **Blocked by**: #19 已完成（ROOT 约定 E310/E311 已在解析层合入，见 `git log` "ROOT 约定实现"）
- **术语规范**: `/home/wangjian/nomicore-fix-issue-20/CONTEXT.md`（求值器 / 派生 schema / 结构树 / 值 schema / 路径索引 / ROOT / 标记类型——用词以该词汇表为准）
- **必读架构决策（不得违反）**: `docs/adr/0003-evaluator-derived-schema.md`（四决策：evaluate 可失败接缝 / ROOT 根别名 / 联合分支列表+判别式缓存 / 别名按名引用不内联；含 §5 YXmlFragment 不透明语义）
- **规格参考**: `docs/vfsl/v1-spec.md`（§2 语法子集、§3 标记类型语义、§10 附录 vfs3.assets 参考 fixture）
- **现有代码**: `packages/vfsl/src/`（`index.ts` 已冻结第一公共导出 `parseVfsl`；`ir.ts` 为 IR 类型；`semantic.ts`/`parser.ts`/`tokenizer.ts` 为内部件）
- **包版本**: `@nomicore/vfsl` 当前 0.1.4；改动代码后须 bump patch 版本
- **测试命令**: 根目录 `pnpm test`（vitest run）；类型检查 `pnpm typecheck`
- **完成事务**: run_id `issue-20-1787134014-19703`

## What to build

实现求值器（ADR 0003 四决策的落地）：新增公共导出 `evaluate(module) → { ok: true, derived } | { ok: false, issues }`，把合法模块求解为派生 schema——结构树 + 值 schema + 路径索引的打包（纯数据、可 JSON 序列化、无行列）。物化规则折叠（裸对象→map、裸 `T[]`→array、全标量联合→leaf、`YPlainArray` 子树→plain 纯值上下文）；联合以分支列表表示（any-of 匹配语义、任一成员路径存在性），存在全成员互异字面量字段时附判别式缓存且缓存缺失/存在不改变可观测行为；别名按名引用（ref 保留不展开），解析由包内共享解析器完成；`ROOT` 决定文档根物化并为派生 schema 的入口。

## Acceptance criteria

- [ ] evaluate 结果联合形状符合 ADR 0003 §1；ok:true 时 derived JSON 往返无损
- [ ] 结构树节点全形态覆盖：root / map / array / xml-fragment / leaf / plain / union / ref
- [ ] 物化折叠四规则各有正反断言
- [ ] 判别式缓存边界义务：同一无判别联合在「逐个尝试」路径与「有缓存」路径下输出全等
- [ ] ref 不展开：菱形引用链派生物大小 O(文本规模)（2^N 对抗文本不炸）
- [ ] 值 schema 表达：字面量枚举 / Pattern 正则 / optional
- [ ] 路径索引可查，含 ref 穿透与 Record 键模式
- [ ] no-match 诊断形态（失败距离最小成员 + 「联合成员 i/N」）预置接缝，供后续 validateSnapshot 票消费
- [ ] 规格 §10 fixture（含 ROOT）全量求值通过

---

## SA6 红灯测试记录（2026-08-19，SA6 Phase 1）

### 测试文件

- `packages/vfsl/test/evaluate-derived-schema.test.ts`（37 条用例 / 9 个 describe）
- 测试命令：`pnpm vitest run packages/vfsl/test/evaluate-derived-schema.test.ts`（或全量 `pnpm test`）
- 类型检查：`pnpm typecheck` —— 当前仅报 `TS2305: Module '"../src/index.js"' has no exported member 'evaluate'`（+ 一条级联 TS2322），即接缝缺失的预期红；SA3 实现公共导出后转绿
- 无新增测试包 / 端口依赖；`scripts/test-lock.sh` 不存在，无需更新

### 红灯验证结果（真实失败证据，2026-08-19 18:17 运行）

```
Test Files  1 failed | 9 passed (10)
     Tests  37 failed | 216 passed (253)
```

- 36/37 失败：`TypeError: (0 , evaluate) is not a function`（evaluateModule 调用处 —— evaluate 未在公共面导出）
- 1/37 失败：`AssertionError: expected 'undefined' to be 'function'`（typeof 断言：evaluate 为第二公共导出）
- **无 parse 前置失败**：全部测试文本（含 §10 fixture）均通过 `parseVfsl`（解析层合法），红灯纯粹锚定 evaluate 接缝缺失，非伪红、非测试文本错误
- 全量套件：既有 9 个 parse 测试文件 216 条全绿，无回归

### 派生 schema 测试契约（SA3 按此实现；形状 = 测试内类型定义）

```ts
DerivedSchema = {
  aliases: Record<string, StructureNode>;  // 别名表（ADR §4：照搬 IR 模块形状，ref 不展开，含 ROOT）
  structure: StructureNode;                // 结构树入口：root 节点包裹 ROOT 的 map 物化
  values: Record<string, ValueSchema>;     // 值 schema（与结构树正交：物化语义 vs 值语义）
  index: Record<string, IndexEntry>;       // 路径索引：路径 → 条目
}
StructureNode = root | map(fields: MapField[]) | array(element) | xml-fragment
              | leaf | plain | union(members, discriminator?) | ref(name)
MapField = { name, optional, node }
Discriminator = { field, byValue: Record<string, number> }   // 值→成员序号跳转表
ValueSchema = object(fields) | array(element) | xml | union(members, discriminator?)
            | enum(values) | pattern(regex) | scalar(type) | optional(value) | ref(name)
IndexEntry = { match: 'exact' | 'pattern', keyPattern?, node }
```

- 路径 = `ROOT` 起 '.' 连接的**语法路径**（ref 为终态节点，不展开）；Record 键段 `<key>` 与数组段 `<item>` 为 pattern 条目（Record 键带 Pattern 约束时 keyPattern 携带解码后正则）
- **ref 穿透是查询期能力**（ADR §4「解析动作由包内共享解析器完成」）：索引 + 别名表足以支撑穿透下钻；测试内 `resolvePath` 为最小消费者验证数据充分性。索引键不枚举 ref 穿透路径 —— 保证菱形链派生物（含索引）恒 O(文本规模)
- **no-match 诊断接缝**：求值期失败当前为空集（ADR 后果节），接缝 = 联合成员按声明序、完整保留（「联合成员 i/N」编号与「失败距离最小成员」计算的数据基础；计算属 validateSnapshot 票消费）
- **判别式缓存边界**：缓存仅附加（members 与去缓存基线全等）；byValue 与线性逐个尝试一致（缓存键 → 成员序号，该成员判别字段字面量 = 键）；无互异字面量字段（无公共字段 / 值不互异）→ 不附缓存

### 验收标准 → 测试映射

| 验收标准 | 覆盖 describe |
| --- | --- |
| evaluate 结果联合形状符合 ADR 0003 §1；ok:true 时 derived JSON 往返无损 | `ADR 0003 §1 接缝`（含无行列纪律、纯函数性） |
| 结构树节点全形态 root/map/array/xml-fragment/leaf/plain/union/ref | `结构树节点全形态`（§10 fixture 全量求值 + 各节点正例） |
| 物化折叠四规则各有正反断言 | `物化折叠四规则`（裸对象→map / 裸 T[]→array / 全标量联合→leaf / YPlainArray→plain，各含纯值上下文反例） |
| 判别式缓存边界义务 | `联合：分支列表表示与判别式缓存边界`（缓存正例 / 与逐个尝试一致 / 仅附加全等 / 两负例） |
| ref 不展开：菱形引用链派生物大小 O(文本规模) | `ref 按名引用不内联展开`（N=15 菱形链：序列化长度 <50KB、ref/map 次数线性界、索引键数线性界） |
| 值 schema：字面量枚举 / Pattern 正则 / optional | `值 schema`（enum 声明序 / AssetId 解码后正则 / notes 可选包装 + 结构 optional:true / 两树正交并存） |
| 路径索引可查，含 ref 穿透与 Record 键模式 | `路径索引`（exact 条目 / `<key>` 带 keyPattern / `<item>` / resolvePath 穿透查询 + 不存在路径 → null） |
| no-match 诊断形态预置接缝 | `no-match 诊断接缝`（成员声明序编号 + 每成员完整子树在场；无判别联合同样保序） |
| §10 fixture（含 ROOT）全量求值通过 | 结构树全形态首条 + 各 describe 内 fixture 复用 |
