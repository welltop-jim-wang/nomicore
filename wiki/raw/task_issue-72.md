# MABF Task: 严格编译 SchemaEnvelope：双指纹与冻结产物

## Issue #72

## Parent

PR [#70](https://github.com/welltop-jim-wang/nomicore/pull/70)（docs/doc-runtime-validation）

## Task Type

feature

## What to build

新增纯函数 `compileSchemaEnvelope(input: unknown)`，把严格封闭的四键信封统一经过 envelope 校验、方言路由、parse 和 evaluate，返回可供后续 DocScope 使用的冻结编译产物。成功结果包含 envelope、IR module、DerivedSchema、envelope fingerprint 与 semantic fingerprint；本票不实现缓存。

## Acceptance criteria

- [ ] 信封必须恰含 `lang/version/id/text`，缺失、多余或类型错误在 envelope stage fail-fast
- [ ] dialect/envelope/internal 返回单 issue，parse/evaluate 保留原生 issues 数组
- [ ] 两种指纹均使用 SHA-256、UTF-8、canonical JSON 与 `sha256:v1:<hex>` 格式
- [ ] envelope fingerprint 覆盖四键；semantic fingerprint 忽略空白和普通注释、保留 JSDoc/声明顺序并排除 id
- [ ] envelope/module/derived 递归深冻结且共享引用关系不被复制破坏
- [ ] 无模块级 cache 或 Host 生命周期状态；全量 test/typecheck/CI 通过

## Blocked by

Blocked by: #71（已合入：f07462d refactor(vfsl)!: rename validateSnapshot to validateLogicalSnapshot (ADR-0007, #71) (#78)）

## Working Directory

/home/wangjian/nomicore-fix-issue-72

## Branch

fix/issue-72-on-docs-doc-runtime-validation

## run_id

issue-72-1787369238-3088589

---

## SA6 Phase 1 验收锚定（红灯测试）— 2026-08-22

### 测试文件

`packages/vfsl/test/compile-schema-envelope.test.ts`（28 用例，7 个 describe 组）。约束清单：`wiki/raw/task_issue-72_relevant_decisions.md`（ADR-0007 直接治理 + ADR-0001/0003/0005 支撑 + 冲突门禁 N2 域分离收紧点）。

### 需求拆解与 AC 映射（锚点全部为运行时行为断言，零源码 grep）

| AC | 锚点断言 |
|---|---|
| AC1 恰含四键 fail-fast | 缺键（ENV-2）/类型错（ENV-3）/多余键（严格封闭，**严于 H1** 的多余键容忍——H1 同输入 ok:true 对照）/非对象输入（ENV-1）各单条 envelope issue；形状错误先于方言、方言先于文本解释（混合输入顺序锚）；缺键+类型错并存仍单 issue（严于 H1 的 2 条聚合，H1 对照） |
| AC2 分阶段结果联合 | dialect→单条 ENV-4（readOnly loud-fail）；parse→原生 VfslIssue 数组与 parseVfsl 同输入深相等（line/column 形状）；evaluate→vi.mock 注入一次性求值失败，原生数组逐条保留；internal→对抗 getter Proxy 绝不外抛、单条 ENV-100 |
| AC3 指纹算法与格式 | 双指纹 `sha256:v1:<hex>`（64 位小写 hex）；envelope 指纹精确摘要 = `sha256:v1:`+SHA-256(四键 §7 冻结表序 canonical JSON)（间接覆盖 lang/version 键——方言门禁只放行 vfsl@1）；sha256Hex 以 FIPS 'abc'/'' KAT 向量锚定防循环；确定性 + 键序打乱归一化；域分离（双指纹互异） |
| AC4 指纹敏感性 | 仅 id 变→envelope 变、semantic 不变（ADR-0005：id 是标签不是键）；仅空白/普通注释（`//` 与 `/* */`）变→envelope 变、semantic 不变；仅 JSDoc 变→semantic 变（ADR-0001 保留 JSDoc）；仅声明顺序变→semantic 变 |
| AC5 递归深冻结+共享引用 | envelope/module/derived 全嵌套 isFrozen（WeakSet 防环遍历）；共享引用不被复制破坏（`index['ROOT'].node === structure`、`index['ROOT.b'].node === 树内字段 node`——复制式冻结会破坏同一性）；ref 按名不内联（IR 与派生结构树均为 `{kind:'ref'}`）；对冻结产物赋值抛 TypeError（严格模式 loud） |
| AC6 无缓存纯函数 | 同文本两次编译→产物引用互异（区别于 getCompiled 的缓存语义）、值确定；失败编译无调用顺序依赖；package.json 零运行时依赖（清单契约）；公共导出可直调 |

设计假设（已写入测试文件头，供 SA1 对照；若设计另有裁决须回写修订）：H1 envelope canonical JSON = 四键按 v1-spec §7 冻结表序紧凑序列化；H2 semantic 指纹不锁精确字节，以格式+确定性+敏感性锚定；H3 失败阶段区分以可观测 issue 内容判别（不强锁显式 stage 字段）。evaluate 失败注入经 `vi.mock('../src/evaluate.js')` 包裹公共求值接缝（docscope-getcompiled 同款先例），默认透传真实实现。

### 红灯验证（2026-08-22，独立后台进程）

```bash
pnpm vitest run packages/vfsl/test/compile-schema-envelope.test.ts
```

结果：**28 tests → 26 failed | 2 passed，exit 1**。全部 26 个被测用例红因 `TypeError: compileSchemaEnvelope is not a function`（构造性红灯——函数尚未实现/导出，同 docscope-getcompiled 先例）。2 个绿为上下文锚（非被测行为）：sha256Hex 的 FIPS KAT 向量自检、package.json 零运行时依赖清单。全量 `pnpm test`：其余 23 个既有测试文件全绿，仅本文件红（vi.mock 按文件隔离，无跨文件影响）。

类型卫生：`tsc -p packages/vfsl/tsconfig.json` 仅剩 1 错——TS2724 缺少 `compileSchemaEnvelope` 导出（构造性红灯）；SA3 实现导出后本文件应类型清洁。

**中断门禁结论**：红灯真实可复现（26/28 红且红因一致），不触发中断。
