# 任务简报：validateSnapshot — 整份 JSON 快照校验（issue #21）

- **任务类型**: 功能开发（Feature）
- **Worktree**: /home/wangjian/nomicore-fix-issue-21
- **Branch**: fix/issue-21-on-adr-union-representation
- **Parent PR**: #17（stacked，base 由外部 check.sh 推导，禁止自行 gh pr create）
- **Blocked by**: #20 —— 已合入（HEAD `40c1be0` 已含 evaluate 第二公共导出与派生 schema）

## 背景与术语

- 术语规范见仓库根 `CONTEXT.md`（VFSL / 派生 schema / 整文档校验 validateSnapshot / 判别联合 / 封闭对象 / 结构树 / 值 schema 等，措辞必须对齐）。
- ADR：`docs/adr/0001`（单一真相源）、`docs/adr/0002`（authority 范围外）、`docs/adr/0003`（求值器与派生 schema：evaluate 接缝、ROOT 约定、**§3 联合的分支列表表示 + 判别式索引为派生缓存**、§4 别名按名引用、§5 YXmlFragment 不透明语义）。**不得违反任何 ADR。**
- 规格：`docs/vfsl/v1-spec.md`（PRD 底稿 `wiki/raw/20260818-prd-vfsl-v1.md`）。验收要求引用**规格 §10 fixture** 的合法/非法快照各至少一例。
- 既有实现：`packages/vfsl/src/`（parser/tokenizer/ir/resolve/semantic/evaluate/derived/shapes/errors），公共导出 `parseVfsl` 与 `evaluate`（`src/index.ts`）。测试在 `packages/vfsl/test/*.test.ts`（vitest）。

## What to build

实现 `validateSnapshot`（CONTEXT.md「整文档校验」）：对一份 JSON 快照按派生 schema 做完整校验：

1. **结构校验**：封闭对象未知键拒绝、必填字段缺失报告、leaf/plain 位置不接受下钻内容。
2. **值校验**：原始类型、字面量枚举、Pattern 正则、optional。
3. **联合**：按 ADR 0003 §3 的 any-of 语义——判别式缓存透明（有/无判别式缓存两路径输出全等）；no-match 时报失败距离最小的成员（「联合成员 i/N」定位）。

### 冻结的接缝形状（已批准，不得更改）

- 签名 `validateSnapshot(derived, snapshot)`——输入派生 schema（编译一次、校验多次）+ 任意 JSON 值；
- 输出 `{ ok: true } | { ok: false, issues: [{ message, path }] }`——issue 带**路径**而非行列（不复用 VfslIssue）；
- path 为**段数组**（如 `["assets","abc123","duration"]`）——Record 键可含任意字符，段数组零转义问题（不采用 RFC 6901 字符串）；
- **全收集 + 上限**：与 parseVfsl 的单错误模型不同（单错误模型只管方言层），快照校验收集全部问题，上限 100 条，超限末条为截断标记。

### 设计开放点（由 SA1 设计 + SA2 攻击评审定稿）

- YXmlFragment 的 JSON 快照表示按票 B（#20）SA1 设计定义的映射执行（该映射属语义层职责、方言层不冻结）。
- Pattern 正则执行引擎：ReDoS 防护 vs 零运行时依赖纪律。
- 失败距离度量定义（no-match 报最小成员时如何量化「距离」）。

## Acceptance criteria（全部满足才算完成）

- [ ] 接缝形状如上冻结；结果可 JSON 序列化往返
- [ ] 结构校验：封闭对象未知键拒绝、必填字段缺失报告、leaf/plain 位置不接受下钻内容
- [ ] 值校验：原始类型 / 字面量枚举 / optional / Pattern（含 ReDoS 对抗用例，SA2 主场）
- [ ] 联合：any-of 接受语义；有/无判别式缓存两路径输出全等；no-match 报失败距离最小成员（「联合成员 i/N」定位）
- [ ] YPlainArray 子树：纯值上下文嵌套 JSON 校验
- [ ] YXmlFragment 按 #20 定义的映射校验
- [ ] path 段数组在含特殊字符 Record 键下无歧义
- [ ] 全收集语义：多错误快照一次报全；100 条上限 + 截断标记
- [ ] 规格 §10 fixture 的合法/非法快照各至少一例

## 工程纪律

- 测试跑法：`pnpm test`（vitest run，仓库根）；类型检查 `pnpm typecheck`。无 scripts/test-lock.sh。
- 修改 `packages/vfsl` 后必须 bump 其 `package.json` patch 版本（Hard Gate #9）。
- 所有产出沉淀到 `wiki/raw/task_vfsl-validate-snapshot*.md`；SA 修完红/绿后立即 commit（防 supervisor 剪枝丢工作）。
- 禁止 `git push` / `gh pr create`（PR 由外部 issue-runner/check.sh 负责）。

---

## SA6 红灯测试记录（2026-08-19，SA6 Phase 1）

### 测试文件

- `packages/vfsl/test/validate-snapshot.test.ts`（33 条用例 / 9 个 describe）
- 测试命令：`pnpm vitest run packages/vfsl/test/validate-snapshot.test.ts`（或全量 `pnpm test`）
- 类型检查：`pnpm typecheck` —— 当前报 `TS2305: Module '"../src/index.js"' has no exported member 'validateSnapshot'`（根因：接缝缺失）+ 15 条 TS7006 级联（validateSnapshot 缺失使 `any` 传播、回调参数推断失效）；SA3 实现公共导出后全部消除
- 无新增测试包 / 端口依赖；仓库无 `scripts/test-lock.sh`，无需更新

### 红灯验证结果（真实失败证据，2026-08-19 22:50 运行）

```
Test Files  1 failed | 10 passed (11)
     Tests  33 failed | 253 passed (286)
```

- 32/33 失败：`TypeError: (0 , validateSnapshot) is not a function`（各断言调用处 —— validateSnapshot 未在公共面导出）
- 1/33 失败：`AssertionError: expected 'undefined' to be 'function'`（typeof 断言：validateSnapshot 为第三公共导出）
- **无 parse / evaluate 前置失败**：全部测试文本（含 §10 fixture）均通过 `parseVfsl` + `evaluate`（既有 253 条全绿），红灯纯粹锚定 validateSnapshot 接缝缺失，非伪红、非测试文本错误
- 全量套件：既有 253 条（parse 216 + evaluate 37）全绿，无回归

### validateSnapshot 测试契约（SA3 按此实现；接缝形状 = 简报冻结）

```ts
validateSnapshot(derived: DerivedSchema, snapshot: unknown): { ok: true } | { ok: false, issues: ValidateIssue[] }
ValidateIssue = { message: string; path: Array<string | number> }  // path 段数组，不复用 VfslIssue（无行列）
```

- **全收集 + 上限**：收集全部问题；上限 100 条真实 issue，超限末条为截断标记（契约读法：超限时 issues 总长 101 = 100 真实 + 1 标记；标记须可区分于真实 issue——测试锚定消息含「截断/truncat」信号，措辞留给实现）
- **路径**：段数组（如 `["assets","abc123","duration"]`），Record 键 / 字段名均为段，特殊字符键零转义、整段相等；数组下标段的数字/字符串表示未冻结——测试对数组元素路径仅锚定首段与段数（`["keywords", <元素段>]`），不锁定表示
- **结构校验**：封闭对象未知键拒绝（ROOT 层与判别联合命中成员内均测）；必填字段缺失报告；leaf/plain 位置收到对象/数组即报错
- **值校验**：原始类型 string/number/boolean/null/unknown；字面量枚举（单值 + 多值联合）；optional 缺失合法 / 在场类型错；Pattern 匹配/不匹配 + Record 键 Pattern（AssetId）
- **联合（ADR 0003 §3）**：any-of 任一成员接受；判别式缓存透明——测试以 `stripDiscriminators`（对派生物数据删 `discriminator` 键）构造无缓存派生物，断言有/无缓存两路径对匹配与 no-match 快照输出全等（含错误输出）；no-match 消息含「联合成员 i/N」（fixture 例：`{kind:"video"}` 报 2/3；平局例报 1/2）
- **YPlainArray**：纯值上下文嵌套 JSON（元素为封闭对象、下钻路径 `["items", <元素段>, "count"]`）；混合联合（`string | { a: number }`）合法、任一命中即接受
- **YXmlFragment（ADR 0003 §5）**：快照值为 XML 字符串；良构通过、非良构（未闭合标签）拒绝、非字符串拒绝
- **ReDoS 对抗**：`(a+)+$` × 长 32 非匹配输入（`'a'*32+'!'`）——朴素 RegExp 指数回溯远超 vitest 默认 5s 超时；实现须有防护（安全引擎 / 长度上限等），对抗成功即通过；断言 `ok:false`（值确实不匹配）
- **fixture**：§10 fixture 合法快照（六标记全出现、三成员齐备、含可选 notes）→ ok:true；非法快照 7 处独立错误一次报全（值/结构/嵌套 Audit ref 内错误全收集）

### 验收标准 → 测试映射

| 验收标准 | 覆盖 describe |
| --- | --- |
| 接缝形状冻结；结果 JSON 序列化往返 | 接缝：签名、结果形状与 JSON 往返（8 条） |
| 结构校验：未知键 / 必填缺失 / leaf·plain 不下钻 | 结构校验：封闭对象 / 必填缺失 / leaf·plain 不下钻（6 条） |
| 值校验：原始类型 / 枚举 / optional / Pattern（含 ReDoS） | 值校验：原始类型 / 字面量枚举 / optional / Pattern（6 条） |
| 联合：any-of / 缓存两路径全等 / no-match 最小成员 | 联合：any-of 接受 / 判别式缓存透明 / no-match 最小距离（6 条） |
| YPlainArray 子树纯值上下文嵌套 JSON | YPlainArray 纯值上下文嵌套 JSON（2 条） |
| YXmlFragment 按 #20 定义映射（良构 XML 字符串） | YXmlFragment：XML 字符串 + 良构要求（1 条） |
| path 段数组特殊字符 Record 键无歧义 | path 段数组：Record 键特殊字符零转义（1 条） |
| 全收集语义：一次报全 / 100 上限 + 截断标记 | 全收集 + 100 条上限 + 截断标记（1 条）；另结构校验「一次报全」与 fixture 非法快照「7 处一次报全」交叉覆盖 |
| 规格 §10 fixture 合法/非法快照各至少一例 | 规格 §10 fixture：合法 / 非法快照（2 条） |
