# MABF Task: 修复 XML logical validation 与 materialization 属性引号接受域不一致

## Issue #94

## Branch

Branch: `main`

## Parent

main（PR #70 已合入，merge commit `b0512aa1eac81762f461b85b009bf8da7b23d20a`）

## Task Type

Bug 修复（总控自判：存在明确缺陷症状与复现路径——logical validation ok:true 但 materializeRoot ok:false，跨层接受域不一致）

## Problem

PR #84 合并后，XML logical validator 与 `materializeRoot` 的接受域仍不一致。以下 snapshot 中的 XML 使用单引号包裹属性，属性值中的双引号是合法字面字符：

```xml
<p title='a"b'>x</p>
```

当前行为：

```text
validateLogicalSnapshot → ok:true
materializeRoot         → ok:false（属性值含双引号）
```

`packages/doc-runtime/src/xml-parse.ts` 在读取属性值后无条件拒绝其中包含 `"`，而 VFSL `wellFormedXml` 接受另一种引号内的该字符。现有测试还把这一差异锁成"有意 materialization 约束"。

这使通过 logical validation 的 XML snapshot 不一定能经过唯一公共 materialization 入口完成 materialize → extract → revalidate，违反 Issue #74 的 XML 语义 round-trip 意图。

## What to build

统一 VFSL logical XML validation 与 doc-runtime XML materialization/extraction 的输入域。优先在 materializer/serializer 中实现属性值的无损表示或正确转义，使逻辑合法的单引号属性内双引号能够物化并在提取后再次通过逻辑校验。

如果确实只能收窄 logical XML 输入域，必须先明确 ADR/兼容性演进，不得仅保留跨层隐式差异。

## Acceptance criteria

- [ ] `<p title='a"b'>x</p>` 通过 logical validation 后，可由 `materializeRoot` 成功物化
- [ ] `extractYjsSnapshot` 提取结果再次通过 `validateLogicalSnapshot`
- [ ] round-trip 只要求 XML 语义等价，不要求引号风格或字符串逐字相同
- [ ] 单引号、双引号、空属性、两种引号交错及需要转义的属性值有表驱动覆盖
- [ ] malformed XML 继续响亮失败，validation/construction 失败继续保持目标 doc 零写入
- [ ] 删除或改写现有"逻辑校验成功但属性双引号构造期拒绝"的错误契约测试
- [ ] VFSL validator、materializer、canonical/extract 比较器对同一 XML 子集使用一致规则
- [ ] 全量 typecheck/test 与 Node 20/24 CI 通过

## SA6 红灯测试（issue #94）

**产出**：`packages/doc-runtime/test/xml-attr-quote-domain.test.ts`（新增，26 用例）；
`packages/doc-runtime/test/materialize-root.test.ts`（改写：C-8/X-F9 行删除 + 相关头注释更新）。

### 测试设计（锚定 SA5 根因：`xml-parse.ts` scan() 属性循环对单引号外壳内双引号字面量的无条件拒绝）

| 组 | 覆盖 AC | 内容 |
|---|---|---|
| RT-A | AC-①/②/③ | `<p title='a"b'>x</p>`：前置 validateLogicalSnapshot ok:true（宽域放行）→ materializeRoot 必须 ok:true（现实现 ok:false + 「属性 title 值含双引号」→ 红灯）+ 单事务 → extractYjsSnapshot 提取结果再过 validateLogicalSnapshot → 与输入 XML 语义等价 |
| RT-C | AC-④ | 表驱动 14 行：T-1~T-9 目标缺陷行（单引号外壳内 `"` 位于值中段/起首/末尾/相邻/多段/含 `<>&` 字面量/双属性交错/自闭合/嵌套元素——修复前红灯）；T-10~T-14 回归锁行（双引号外壳内 `'`、空属性单/双引号、`&quot;` 实体字面量、双引号外壳内 `<>&`——修复前后均绿，锁「修复不得破坏已工作通道」） |
| RT-D | AC-⑤ | malformed 8 行（单引号外壳内裸 `'`、双引号外壳内裸 `"`、属性值引号未闭合、标签未闭合、不匹配结束标签、无引号属性值、裸 `<`、非法属性名）：validate ok:false 恰 1 issue → materializeRoot ok:false（issues 引用零损透传）+ 0 update 事件 + encodeStateAsUpdate 逐字节不变 |
| RT-E | AC-⑦ | 输入含单引号外壳内双引号 + one-shot observer 注入另一含双引号属性 → 修复后 canonical/extract 双侧均可扫描（同域一致规则）且真实偏离仍被 ⑥ 检测 → throw DOCRT-E201（绝不假成功）；现实现 ② 期拒绝返回 ok:false 不 throw → 红灯 |

语义等价比较器（测试局部，W2）：mini 扫描器（token 识别镜像 `wellFormedXml`，配对闭引号扫
描、值内一切字符为字面量、重复属性 last-wins）→ canonical 归一化（属性按名排序、一律双引号、
自闭合/空元素统一显式闭合、文本/span 逐字）；**属性值入 Map 前单遍实体解码**
（quot/apos/amp/lt/gt + 数字引用，未知实体字面保留）——对 SA5 给出的任一修复形态
（`"` → `&quot;` 转义 / 按需改选单引号外壳）均成立，且不因实体字面量与裸 `"` 值的 XML 语义
等价性误判；不锁 yjs 序列化器输出、无任何源码 grep 断言。

C-8 改写（AC-⑥）：错误契约「逻辑校验成功但属性双引号构造期拒绝」作为 R2 组 it.each 行
（materialize-root.test.ts:839）已删除（含 R2 表内注释、文件头 RAC-2/RAC-3 注释、R3 组
X-F9 同锚注释更新）；新契约由 RT-A/RT-C 承担：单引号属性内双引号必须 materializeRoot
ok:true + round-trip 语义等价。

### 红灯验证（修复前，实测）

命令：`pnpm exec vitest run packages/doc-runtime/test --typecheck.enabled=false`（Node v24.13.0，
yjs@13.6.32，独立进程 setsid 运行）

- 结果：**Test Files 1 failed | 12 passed；Tests 12 failed | 223 passed（235）**；typecheck
  （`tsc -p packages/doc-runtime/tsconfig.json --noEmit`）通过。
- 12 条红灯全部落在新契约文件：RT-A（2 条）+ RT-C T-1~T-9（9 条）+ RT-E（1 条）；其余
  （RT-A 前置、RT-C T-10~T-14、RT-D M-1~M-8 计 14 条）绿——即「已工作通道 + malformed 零写入
  防线」回归锁全部通过。
- 关键失败证据（逐字，与 SA5 症状完全一致）：
  `AssertionError: expected { ok: false, issues: [ { message: "XML 解析失败（ROOT.body）：属性 title 值含双引号", path: ["body"] } ] } to deeply equal { ok: true }`
  全部 12 条失败均为该「属性 title 值含双引号」构造期拒绝路径（RT-E 为「期望 throw
  DOCRT-E201，实际返回 ok:false 不 throw」）。
- 既有 223 条测试（含改写后的 materialize-root.test.ts 59 条、rev2 23 条、extract/read 各套）
  全绿——C-8 删除未破坏任何既有契约；RT-5（observer 注入含双引号属性值 → E201）在当前
  实现即绿，修复后经 ⑥ 变体 C 检测仍绿，无需改动。

git 状态：新增 `packages/doc-runtime/test/xml-attr-quote-domain.test.ts`；修改
`packages/doc-runtime/test/materialize-root.test.ts`（仅测试，未触碰 src/ 生产代码）。

## Blocked by

None (can start immediately from `main`).

## Working Directory

/home/wangjian/nomicore-fix-issue-94

## Branch

refactor/-xml-logical-validation--materialization-
