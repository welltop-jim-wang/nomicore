# 任务简报（修订轮 rev1）— PR #84 owner Review 反馈闭环（issue #74 / materializeRoot）

- **来源**：PR #84 Review（结论 Request changes），runner 转达的发布后修订轮
- **run_id**：issue-74-1787396362-3288866
- **branch**：fix/issue-74-on-docs-doc-runtime-validation（base: docs/doc-runtime-validation）
- **Worktree**：/home/wangjian/nomicore-fix-issue-74
- **前序档案**：wiki/raw/task_doc-runtime-materialize-root*.md（初轮 SA1~SA7 全流程）
- **任务类型**：unspecified（修订任务按无标签任务处理）→ 总控自判：**功能开发/验收强化混合**——
  含 API 契约语义裁决（需设计）+ 验收测试缺口锚定（需 SA6）+ 可能的实现变更（需 SA3+SA4+SA7）。
- **自构工作流**：SA8 前置门禁 → SA1 设计（P1 契约裁决 + 全部测试计划）→ SA8 设计后复审 →
  SA2 攻击评审 → SA6 红灯/验收测试锚定 → SA3 TDD 实现（红灯变绿）→ SA4 静态验尸 →
  SA7 动态验证 → AC 逐条确认门禁 → 收尾（commit + push origin HEAD，修订轮授权 push）。
  构造依据：有契约语义裁决必有 SA1+SA2；验收型缺口必有 SA6 锚定；有代码变更必有 SA3+SA4+SA7；
  ADR-0007 语义相关 → SA8 双门禁不裁剪。

---

## Owner 反馈全文（PR #84 Review，结论 Request changes）

### 1. P1：不抛错的 observer 重入修改 ROOT 后仍可能返回成功

位置：`packages/doc-runtime/src/materialize.ts:57-60`

当前安装过程在事务前检查 ROOT 为空，然后在同一事务中逐 key 执行 `rootMap.set`，最后无条件返回 `{ ok:true }`：

```ts
doc.transact(() => {
  for (const [key, value] of ready.entries) ready.rootMap.set(key, value);
});
return { ok: true };
```

Yjs observer 可以同步重入。如果 observer 不抛错，而是删除、覆写本次写入或插入额外 key，最终 ROOT 可能已经不等于经验证和 detached 构造的 snapshot，但调用方仍收到成功结果。

需要明确并落实 API 契约：

- 如果 `ok:true` 保证返回时 ROOT 与输入物化结果一致，则需防止或检测 observer 重入修改，并在偏离时响亮失败；
- 如果 observer 修改属于允许的事务后续反应，则 ADR/API 必须明确 `ok:true` 仅表示本函数计划中的 set 已提交，不保证 observer 执行后的最终 ROOT 与 snapshot 等价。

需增加回归测试：observer 不抛错但执行 delete / overwrite / 插入额外 key，明确断言返回结果和最终 ROOT 状态。

### 2. High：补齐 detached 构造失败时的 AC-4 零写入证明

当前 `materialize-root.test.ts` 的零 update/state 不变测试只覆盖：logical validation 失败；ROOT 非空或载体异型。没有覆盖"逻辑校验成功，但 detached 构造失败"。构造失败支路位于：`packages/doc-runtime/src/materialize.ts:78-82`、`materialize.ts:128-261`、`xml-parse.ts:40-47,98-190`。

至少增加以下测试：
1. 使用 `unknown` 字段承载 Date、bigint、NaN/Infinity、Yjs 类型或数组内 undefined 等值；
2. 先断言 `validateLogicalSnapshot(...).ok === true`；
3. 再调用 `materializeRoot`，断言：ok:false；恰一条 materialization issue；update === 0；Y.encodeStateAsUpdate(doc) 字节不变；
4. 另覆盖至少一个 XML parser 构造期拒绝分支。

这是 Issue #74 AC-4"全部构造成功后才执行 transaction；构造失败 doc 零写入"的直接验收缺口。

### 3. High：扩展 XML parser 的 round-trip 与失败原子性测试

当前 AC-5 只覆盖简单输入 `<p>Hello <b>world</b></p>`，但新增 `xml-parse.ts` 约 220 行，主要分支未被覆盖。建议表驱动覆盖：attributes（单双引号及特殊字符）；comment、CDATA、processing instruction；多根 fragment、顶层文本、空 XML；self-closing、空元素、重复属性；格式化 whitespace；malformed XML；每个失败场景的单 issue + 零 update + state 不变。

特别需要明确 validator/materializer 的接受域差异：`wellFormedXml()` 接受属性引号内的字符，但 materializer 在 `xml-parse.ts:177-181` 拒绝属性值包含 `"`。例如 `<p title='a"b'>x</p>` 可能通过逻辑校验、却在 materialize 阶段失败。需明确这是有意的 materialization 约束并以测试锁定；若不是有意约束，则需修正解析/序列化策略。

### 4. Medium：加强 AC-3 的内容完整性和深拷贝断言

`materialize-root.test.ts:267-287` 主要检查 instanceof Y.Map/Y.Array/Y.XmlFragment，可能让"载体正确但内容丢失/篡改"的实现假绿。建议：materialize 后通过 extractYjsSnapshot() 提取并与输入 snapshot 做完整语义比较；分别覆盖各 union variant、Record 全部 key、Y.Array 元素与顺序、leaf 值和 XML 内容；增加嵌套 plain object/array 的 clone 隔离测试，而不只验证扁平 attachments 数组。

### 5. Medium：单次 update 不能单独证明"构造完成后才开事务"

events.count === 1 只能证明成功路径产生一次外部 update，不能排除构造在事务内发生并在失败时留下部分写入。应以第 2 项"构造失败时 0 update + state bytes 不变"的测试作为原子性主锚；必要时再用 transaction/observer instrumentation 验证事务开始前 ROOT 未被写入。

### 6. Low：收紧 observer 抛错测试

当前只断言 toThrow()，建议改为 toThrow('observer-boom') 或断言 exact Error identity；增加 observer 调用次数断言；保留"update 已发生、值未回滚"的现有断言。

### 7. 建议：增加 materialize 专项 CI 存在性门禁

建议增加 `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false` 作为防删除/防未收集门禁。

**Review 结论**：PR 主体架构和主路径实现质量良好，但 observer 重入成功语义、detached 构造失败原子性及 XML 风险面尚未充分闭环。结论：Request changes；完成上述 P1/High 项并补充测试后再合并 PR #84。

---

## 总控研判（逐条）

| # | 级别 | 研判 | 处置 |
|---|------|------|------|
| 1 | P1 | **真问题**。`ok:true` 成功语义未覆盖"observer 同步重入且不抛错"情形（delete/overwrite/insert 后 ROOT ≠ snapshot 仍返回成功）。属 API 契约层裁决，必须 SA1 设计定谳（检测偏离响亮失败 vs 文档化"仅承诺计划 set 已提交"），ADR-0007 语义相关 → SA8 双门禁 | SA1 裁决 → SA6 锚定回归测试 → SA3 落实 |
| 2 | High | **真缺口**。AC-4 零写入证明缺"逻辑校验通过但 detached 构造失败"支路（unknown 字段承载 Date/bigint/NaN/Infinity/Yjs 类型/数组内 undefined；xml-parse 构造期拒绝）。是 AC-4 的直接验收缺口 | SA6 锚定（先断言 validateLogicalSnapshot ok:true，再断言 materializeRoot ok:false + 恰 1 issue + 0 update + state 字节不变）→ SA3 若实现有缺口则修 |
| 3 | High | **真缺口**。xml-parse.ts 约 220 行仅简单输入覆盖。表驱动补齐 + validator/materializer 接受域差异（属性值含 `"`）需 SA1 定谳是否有意约束并以测试锁定 | SA1 定谳 → SA6 表驱动锚定 → SA3 |
| 4 | Medium | **合理**。instanceof 断言可能假绿；采纳 extractYjsSnapshot 完整语义比较 + 嵌套 clone 隔离 | SA6/SA3 落实 |
| 5 | Medium | **合理**。以 #2 测试为原子性主锚；本项作为方法论说明并入 #2，不单独立项 | 并入 #2 |
| 6 | Low | **合理**。toThrow('observer-boom') + observer 调用次数断言 | SA6/SA3 落实 |
| 7 | 建议 | **采纳**。ci.yml 已有同款先例（persistence-contract L43-44、domains-scaffold L46-49），增加 materialize-root 专项存在性门禁步骤 | SA1 设计纳入 → SA3 落实 |

## 修订轮验收标准（rev1 AC）

- [ ] RAC-1（P1）：observer 重入不抛错（delete/overwrite/insert extra key）语义有明确契约并落实——或检测偏离响亮失败，或 ADR/API 文档化"ok:true 仅承诺计划 set 已提交"；配回归测试断言返回结果与最终 ROOT 状态
- [ ] RAC-2（High #2）：detached 构造失败（逻辑校验已通过）→ ok:false + 恰 1 条 materialization issue + 0 update + state 字节不变；覆盖 unknown 字段承载 Date/bigint/NaN/Infinity/Yjs 类型/数组内 undefined + 至少一个 XML parser 构造期拒绝分支
- [ ] RAC-3（High #3）：xml-parse 表驱动覆盖 attributes（单双引号/特殊字符）、comment、CDATA、PI、多根 fragment、顶层文本、空 XML、self-closing、空元素、重复属性、格式化 whitespace、malformed XML；失败场景单 issue + 零 update + state 不变；validator/materializer 接受域差异（属性值含 `"`）有定谳并被测试锁定
- [ ] RAC-4（Medium #4）：materialize 后 extractYjsSnapshot 提取与输入 snapshot 完整语义比较（union 各 variant、Record 全 key、Y.Array 元素与顺序、leaf 值、XML 内容）；嵌套 plain object/array clone 隔离
- [ ] RAC-5（Low #6）：observer 抛错测试断言 toThrow('observer-boom') 或 exact Error identity + observer 调用次数
- [ ] RAC-6（建议 #7）：CI 增加 `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false` 存在性门禁

---

## SA6 红灯测试记录（rev1，2026-08-22；设计 §10 落位）

- **落位文件**：`packages/doc-runtime/test/materialize-root.test.ts`（405 → 1019 行；既有 U1–U12 断言零改动，U13 仅收紧，新增 R1/R2/R3/R4 组 + `expectXmlSemanticallyEqual` 测试局部比较器（§4.4））。
- **红灯命令**（后台独立进程）：`pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false`
- **首轮结果**：12 failed | 48 passed——其中 7 个 R3 成功行失败为本测试侧比较器自身缺陷（闭合标签冲刷点用了结束标签后位置 j 而非标签起点 i，把 `</tag>` 收进文本 run），已修复（`flushText(i)` 与 xml-parse.ts 同款），非实现问题。
- **复跑结果**：**5 failed | 55 passed | Type Errors no errors**（Duration ~600ms，exit 1）
- **红灯（预期——SA3 实现 ⑤ verifyInstall 前必须红；真实失败证据均为 `AssertionError: expected [Function] to throw an error`，即现实现④后无条件 `return {ok:true}`、无 E201）**：
  1. R1 `delete 计划键 → throw DOCRT-E201`（delete 计划键）
  2. R1 `overwrite 计划键 → throw DOCRT-E201`（覆写为 HACKED）
  3. R1 `insert 额外键 → throw DOCRT-E201`（extra 键在）
  4. R1 `组合向量（delete+insert，G5）→ throw DOCRT-E201`（size 相等而身份破坏——双断言必要性）
  5. R1 `T-4 身份级保守：语义等价异实例替换 → throw DOCRT-E201`（检测基准 ===，R-8）
- **绿锚（现实现已达标的验收锚，55/55 全通过）**：
  - U1–U12 原断言零改动全绿；U13 收紧后 `toThrow('observer-boom')` + `observeCalls === 1` + updates===1 + 值未回滚（RAC-5）
  - R1 正向对照（observer 不触 ROOT → ok:true + ROOT 逐键等于快照）、同值重插不误报（G4）、T-1 嵌套事务边界 characterization（外层事务包裹 → ⑤ 空转 ok:true + 外层后偏离落地无 E201，R-7）、空 entries + observer（ok:true + 0 update，INV-10 退化）
  - R2 构造失败零写入 10/10（C-1~C-8 含 ±Infinity 与 Y.Array 各一行；含 C-8/X-F9 attr-`"` 构造期拒绝定谳锁定）：每行先证 `validateLogicalSnapshot ok:true` 再证 `ok:false` + 恰 1 issue（message 非空 + path 数组）+ 0 update + state 字节不变（RAC-2）
  - R3 表驱动 25 行：17 成功行（materialize ok + 单事务 + extract 语义等价 + revalidate ok，W2 禁逐字）+ 8 逻辑失败行（direct/materialize 两侧恰 1 issue + 引用零损透传 toEqual + 0 update + state 不变）；X-F9 与 C-8 同锚（设计 §4.3「落一条即可」）（RAC-3）
  - R4 用例 A/B/C：全量语义比较（union 三 variant 整对象 / Record 键集 / Y.Array 顺序 / leaf 值 / XML 语义比较器 / revalidate）+ 嵌套深结构 clone 隔离行为断言（突变输入三嵌套点 → extract 回原值）（RAC-4）
- **测试纪律**：observer 一律 one-shot（G8：无 guard 重入写 → RangeError）；全部断言锚定可观测运行时输出（materializeRoot / extractYjsSnapshot / validateLogicalSnapshot 返回值 + doc 状态 + update 事件计数），零源码 grep；`scripts/test-lock.sh` 无新增测试包/端口依赖，无需更新。
