# MABF Task Brief: DocScope — 作用域绑定与编译缓存（H3）

- Issue: #54
- Parent: PR #51
- Branch: fix/issue-54-on-phase-2-engine-gaps
- Base: phase-2-engine-gaps
- run_id: issue-54-1787301239-3057669
- 任务类型: 功能开发（Feature）

## What to build

实现 DocScope（设计文档 §10 作用域隔离的引擎侧）：按**文本内容哈希**（sha-256）缓存编译产物的注册表——`getCompiled(input)`（信封或文本）→ `{ module, derived }`。同一文本一次 `parseVfsl + evaluate`、处处取用同一对象引用；不同文本完全隔离（多方言并存不需要进程级「当前版本」）。v1 缓存策略：无淘汰 Map + 注释论证（进程内命名空间数有界，淘汰策略留 v2）。未知方言经 H1 断言通道，不进入缓存。

## Acceptance criteria

- [ ] 同文本两次调用返回**同一对象引用**（缓存命中可证）
- [ ] 仅空白差异的文本 = 不同键（内容哈希纪律：正确重算，不去重）
- [ ] 多文本并存互不影响（隔离性）
- [ ] 未知方言输入被 H1 通道拒绝，不产生缓存项
- [ ] evaluate 失败（合法文本但求值失败）不污染缓存（可重试语义）
- [ ] 纯引擎、零新运行时依赖、同步或 async 由 SA1 依 H1 接缝形态定

## Blocked by

#52（H1 信封解析——输入经信封/方言断言进入）

## SA6 测试设计（Phase 1 验收锚定，2026-08-21）

- 产出：`packages/vfsl/test/docscope-getcompiled.test.ts`（13 条用例，vitest，随 `pnpm test` 执行）。
- 锚点：公共入口 `getCompiled(input)`（信封或文本）→ `{ module, derived }`（ok）/ `{ ok:false, issues }`（拒绝），逐条覆盖 6 项 AC：
  - AC1 同文本同一对象引用：module/derived/容器三引用同一 + 缓存命中不重算（evaluate spy 计数不增，注入失败后命中仍 ok）+ 信封/文本两种形式、不同 id 命中同一缓存项（键 = 文本内容哈希，非 id/载体）+ 派生物与新鲜直编深相等、可 JSON 往返；
  - AC2 空白差异 = 不同键：内部空白/尾随换行/前缀共享变体均语义深相等但引用全异（正确重算、不去重）；
  - AC3 多文本隔离：交错调用 A/B 各自引用稳定、跨文本互异、派生物字段各自对应自身文本；
  - AC4 未知方言经 H1 通道：拒绝 issues 与 `parseSchemaEnvelope` 同输入全等（ENV-4/readOnly，零损透传）；拒绝路径 evaluate 零调用；拒绝后同文本合法信封正常编译（不产生缓存项）；
  - AC5 evaluate 失败不污染：`vi.mock('../src/evaluate.js')` 包裹冻结求值接缝（默认透传真实实现），注入一次性失败 → ok:false 且注入标记透传；同文本重试成功、第三次同引用且 evaluate 计数不增（只存 ok 分支、可重试语义）；
  - AC6 纯引擎零依赖：`packages/vfsl/package.json` 无运行时 `dependencies`（清单契约守卫，锁现状）；getCompiled 为包公共导出。
  - 边界补充：语法错误文本（信封/文本两形式）经 kind:'vfsl' 文本通道拒绝、不落缓存、拒绝幂等。
- 同步/async：简报 AC6 将形态裁定交给 SA1（依 H1 接缝形态，parseSchemaEnvelope 为同步）。测试不预锁形态：`compiledOf()` 对 thenable 统一 await，引用同一性断言在两种形态下均成立；SA3 必须保持「ok 返回 `{ module, derived }`、失败返回 `{ ok:false, issues }`」。
- 红灯运行记录（2026-08-21，`pnpm exec vitest run packages/vfsl/test/docscope-getcompiled.test.ts`）：**12 failed | 1 passed（13）**，Test Files 1 failed，exit 1。12 条功能用例全部因 `TypeError: getCompiled is not a function` 失败（构造性红灯——入口未实现，同 H1 parseSchemaEnvelope 先例）；唯一通过的是 AC6 零运行时依赖清单守卫（否定性约束，锁现状，绿属预期，非伪绿）。
- 修正记录（2026-08-21 R1，依 SA1 设计 `task_docscope-compile-cache_design.md` §11 最小修正案，总控逐条核实为真；SA6 已执行，仅 3 处 fixture 级改动，AC 覆盖语义不变）：
  1. **AC4.1 case-3**：`lang` 由 `'vfsl'` 改 `'wml'`（`{lang:'wml', version:1, text:TEXT_BAD}`）。原 case 为「已知方言 + 语法错误文本」——按 H1 语义走 kind:'vfsl' 文本通道，与用例内 `issues toEqual(parseSchemaEnvelope 同输入 issues)`（kind:'vfsl'）及 `kind:'envelope'/ENV-4` 断言逻辑合取不可满足，任何正确实现二选一必红。修正后三 case 依次验证 wml@1 / vfsl@2 / wml@1+坏文本（方言拒绝先于文本解释）。
  2. **AC1.2**：改用专属 fixture `TEXT_HIT = 'type ROOT = { hit: string; };'`。原共享 `TEXT_A` 会被 AC1.1 缓存成热条目（模块级缓存跨 `it` 存续），首个调用即成命中，`evaluateMock` 计数 0≠1 与一次性失败注入均不可达。
  3. **AC5**：改用专属 fixture `TEXT_RETRY = 'type ROOT = { retry: number; };'`。同根因：`TEXT_A` 已被前序用例缓存，注入失败后调用直接命中 ok 条目，`expectRejected` 恒红。
  - 其余 10 用例对 TEXT_A/TEXT_B 冷热均通过（SA1 §11.4 逐用例模拟），无需改动。
  - 修正后红灯复验（2026-08-21，同命令）：仍 **12 failed | 1 passed（13）**，12 条全部 `getCompiled is not a function`（构造性红灯不变）；`tsc` 仅剩预期缺失导出错误。
- 修正记录（2026-08-21 R2，验收测试 fixture 修订轮——SA3 实现后 11/13 绿，剩余 2 红经总控亲验（后台全量 553/555，`.mabf-bg/ctrl-verify.log`）与 SA3 上报一致，确认为测试文件自身 mock 卫生缺陷：任何正确实现下均红，AC1.3 单独跑绿、全文件跑红 = 顺序依赖。SA6 已执行，仅 2 处 fixture 级改动 + 头部状态演进注释，AC 覆盖语义不变）：
  1. **D1（AC1.2 武装泄漏 → AC1.3 红）**：AC1.2 的一次性 `mockImplementationOnce` 失败注入，因缓存命中路径不调用 evaluate 而从不被消费，泄漏进 AC1.3 的 `freshDerived` 直调 evaluate（:177 `expect(e.ok).toBe(true)` 红）。修正：AC1.2 收尾处显式消费剩余武装（结果弃置，仅清队列）并 `mockClear()` 复位——消除跨用例状态泄漏；「命中不重算」规范证明保留（:233 调用计数断言）。
  2. **D2（AC5 计数恒 3）**：:379 `freshDerived(TEXT_RETRY)` 自身直调 evaluate（第 3 次调用），:380 `toHaveBeenCalledTimes(2)` 恒红。修正：「重试重算发生」计数断言（第一次失败 + 重试重算 = 2）移至 freshDerived 对照直调之前；末段「命中不再触发 evaluate」计数相应调整为 3，注释说明 freshDerived 的一次直调不计入 getCompiled 求值行为（若命中路径重算将 >3）。
  - 修正后复验（2026-08-21 R2，`pnpm exec vitest run packages/vfsl/test/docscope-getcompiled.test.ts`，`.mabf-bg/sa6-r2.log`）：**13 passed (13)**，Test Files 1 passed，Type Errors 无，exit 0。

## 上下文指针

- CONTEXT.md：术语表（信封 / 方言 / 派生 schema / DocScope 作用域绑定）
- docs/adr/0001~0005：ADR 决策集
- docs/phases/phase-2-engine-gaps.md：Phase 2 引擎缺口（H1/H2/H3）
- packages/vfsl：引擎包（parseVfsl / evaluate 所在）
