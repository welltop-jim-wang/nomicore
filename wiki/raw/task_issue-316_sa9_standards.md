# SA9 Standards 审查 — issue #316：codegen 与 readData 投影适配 int/range 叶子

- Dispatch：`sa-bea73f88-0620-4871-96ac-ab2ed58dce84`（mabf-sa9 / standards-review / iteration 0）
- 审查对象：最终提交 `cb207b22172b2c6505e7ab62f6b636e066de73aa`（`test: cover int and range schema projections`），基线 = 父 PR #311 head `bd9fb93dd69d6b27f10113cd98d8dfca9184ce8c`（已确认包含于交付提交，`git log` 亲验 HEAD 即 cb207b2、父即 bd9fb93）
- 审查方式：静态只读（git diff/name-status、源码锚点、ADR、根与模块 AGENTS.md、CI/vitest 配置、既有测试惯例、sha256 钉值）；不运行测试、不修改任何文件（SA9 技能约束）
- Issue comments REST snapshot：空（派工单明文）⇒ 无 owner 追加要求需要映射

## Verdict

**`approve`** — 无 BLOCKER / MAJOR。交付 diff 是纯加法测试覆盖（2 个既有文件加法式扩展 + 1 个自包含新文件）+ 5 件 wiki 任务产物，生产实现零改动；逐项符合根/模块 AGENTS.md、ADR 0005/0016/0019/0020、单一事实源、生命周期对称性、文件范围与测试质量标准。3 条 MINOR 观察见 §9（均不阻断）。

## 1. 审查输入与 diff 核验

| 输入 | 状态 |
| --- | --- |
| `wiki/raw/task_issue-316.md`（Host 简报） | 存在（未跟踪，Host 产物）；Issue body AC1~AC4 + Blocked by #315；§Comments 空 |
| `wiki/raw/task_issue-316_design.md`（SA1 设计 iteration 1，SA2 approve） | 存在；§7 D-1~D-4（生产零改动硬性结论）+ T-1~T-4、§10 ALLOW/DENY 为对照基准 |
| `wiki/raw/task_issue-316_sa2_review.md`（iteration 1，approve） | 存在；F1~F5 修订映射、N1~N3 非阻断 |
| `wiki/raw/task_issue-316_sa3_impl.md`（iteration 0） | 存在；Changed paths / Verification / Deviations 逐项复核 |
| `wiki/raw/task_issue-316_sa4_review.md`（iteration 0，approve） | 存在；§12 N1~N4 非阻断观察承接到本审查 §9 |
| `wiki/raw/task_issue-316_sa6_contract.md`（iteration 0，approve） | 存在；§12.0 断言纪律、§12.6 四缺口为契约基准 |
| 实际 diff | `git diff bd9fb93..cb207b2 --name-status`：`A packages/namespace-runtime/test/runtime-readdata-int-range.test.ts`、`M packages/vfsl-codegen/test/generate-int-range.test.ts`、`M packages/vfsl/test/resolve-schema-at-path-int-range.test.ts` + 5 件 wiki 产物（A）；工作区对 HEAD 干净（仅 Host 简报未跟踪） |

diff 内容逐行复核：两个 M 文件均为**纯加法**——既有断言/字段零改动（generate-int-range：仅头注增段 + 追加 C1c/C1e 两 describe；resolve-…-int-range：头注增段 + FIXTURE 注释行替换 + 追加 6 字段与 C3b describe，既有 7 用例与字段 a~e/p/q 原样）。`git diff --check` exit 0。

## 2. 根 AGENTS.md 与流程合规

| 义务 | 核验 | 结论 |
| --- | --- | --- |
| Typed Namespace writes（PathAt/PathPatchValue fail-closed，负例证明未知路径/错误值 fail closed） | C1c 即该义务的编译级哨兵：generated+consumer 同 program 0 诊断；独立负例恰 1×TS2322（投影退化 any/string 即 0 条 ⇒ 红）；两条 `@ts-expect-error` 反噬机制在场（TS2578） | 符合 |
| 模块 AGENTS.md 先读义务 | 本审查已读三个受影响包 AGENTS.md（vfsl-codegen/vfsl/namespace-runtime）并逐条对照（§3） | 符合 |
| wiki 产物入库惯例 | 仓内先例：`docs(mabf): record final reviews for issue 334`（4b04a6b）、`docs(mabf): add issue 334 task brief`（282c99f）等；本次 5 件 wiki 产物随交付提交入库与惯例一致 | 符合 |
| Worktree/分支纪律 | 交付在任务 worktree 分支 `mabf/issue-316`，父提交即 PR #311 head，未夹带无关改动 | 符合 |

## 3. 模块 AGENTS.md 责任边界

| 模块条款 | 实现核验 | 结论 |
| --- | --- | --- |
| vfsl-codegen「Consume evaluator output；字节稳定；不支持形状响亮失败（stable diagnostics）」 | 生产零改动（`valuetype.ts:35-39` int/range→`'number'` 原样、`emitter.ts:335-348` leaf 白名单显式集合、`desync` 模板 `:533` 均亲验无 diff）；C1e 负控只钉稳定片段 `structure/value desync`（与「stable diagnostics」条款同义），不冻结全文 | 符合 |
| vfsl「公共 API 只经 `src/index.ts`；错误码/路径回报是兼容行为」 | 测试只经公共接缝 `parseVfsl`/`evaluate`/`resolveSchemaAtPath`（`../src/index.js` import）；`FROZEN_CODES` 断言失败码集合 ⊆ 两枚冻结码——把「稳定错误码是兼容行为」固化为回归哨兵 | 符合 |
| namespace-runtime「读在 sequencer 外；公共面只暴露 detached 投影；生产构造器与测试 seam 保持内部」 | 新测试只观察公共面 `readData`/`getStatus`；`createNamespaceRuntimeWithSeam` 经 `../src/runtime.js` seam import（`runtime.ts:343` 亲验导出），与 #273 fixture 同款先例，未把 seam 泄入公共面；detached 隔离用例（污染后重读逐字等于 pristine、非冻结、非同引用）正是「公共面只暴露 detached 投影」的哨兵 | 符合 |
| namespace-runtime 生命周期（`close()` 幂等、同步终止） | 每 `it` `try/finally await runtime.close()` 逐例收尾，与既有 #273 red 测试同款 | 符合 |

## 4. ADR 合规

| ADR | 条款 | 核验 | 结论 |
| --- | --- | --- | --- |
| 0020 决策 7 | int/range 叶发射 `number` 原样、品牌类型不做、生成物形状不胀 | `valuetype.ts:35-39` 亲验原样；既有 10 用例零改动 + C1c 编译级补强；无品牌类型引入 | 符合 |
| 0020 决策 8 | 投影按标量叶处理、终态/下钻与 pattern 同构、不新增拒绝路径与失败码 | `resolve-schema-at-path.ts:289-291` kind-agnostic default 终态亲验原样；C3b 以 7 组 int/range ↔ pattern 配对（6×`SCHEMA_PATH_NOT_FOUND` + 1×野段 `SCHEMA_PATH_INVALID`）+ 码集合断言证明同构且不越界 | 符合 |
| 0016 | readData 三键成功形状、每次读 detached 深拷贝（不冻结）、失败对象无 schema 键、两枚失败码冻结 | 断言与 `runtime.ts:474-486`（`:485` 失败短路透传、`:486` 恰三键）及 `doc-runtime/src/read.ts` 失败联合 `{ok:false,code,path,message?}` 亲验一致；`Object.hasOwn(r,'schema')===false`、`Object.isFrozen===false`、键集恰三键均在场 | 符合 |
| 0005 | codegen 确定性/字节稳定 | 生产零改动；本轮实测 `sha256sum domains/vfs3-assets/generated.ts` = `342d8c1fe0814409f682852c13748260b9d6cbda125afe0e815a8de3298e6707`，与 SA1/SA2/SA6 钉值逐字节一致；CI `codegen-freshness` 门禁未触碰 | 符合 |
| 0019 | docs 切片（成员 doc 行内前置） | T-4 docs 断言只查 `ROOT.b` 键存在与切片内容非空，不冻结文案 | 符合 |
| 0021 决策 3 先例 | 消息文案不进冻结面 | 全部断言只钉码/路径/键集/计数/稳定片段；无全文文案冻结 | 符合 |

## 5. 既有架构惯例与单一事实源

| 检查面 | 核验 | 结论 |
| --- | --- | --- |
| 编译级断言装置 | 复用既有 `tsc-helper.ts` `compileInTempDir`/`preEmitDiagnostics`（孤立 program paths 把 `@nomicore/vfsl-protocol`/`@nomicore/vfsl` 指到仓内源码，`:44-47` 亲验）；零新编译装置 | 符合 |
| typed-access consumer 形态 | 六名类型均 import 自 `@nomicore/vfsl-protocol`（`index.ts:59/72/81/96/118/157` 亲验实导出）；生成文本只做 `VfslPathMap` 增广（与 `domains/vfs3-assets/generated.ts` 消费形态同款）；先例 `generate-number-literals.test-d.ts` 一致 | 符合 |
| T-4 装置平行性 | 自包含四件（TXT_316/seedRoot316/makeHandle316/makeReadyRuntime316）镜像 #273 fixture `:73-98` 配方；不扩共享 fixture 的理由经设计备选 6 四条 + 文件头注显式声明（fixture 被 273 载体锁定，本轮亲验 `makeHandle` opts 仅 text/seedSchema、`:87` 硬编码 `seedRoot`、无参 `makeReadyRuntime`）；唯一复用共享件 `real-persistence-scheduler.ts` 只读 import（非 vitest 收集助手，头注自证）——**已声明的镜像配方，非未声明平行机制**；fixture/scheduler 零 diff（git name-status 亲验） | 符合 |
| 局部 FIXTURE 先例 | #351 resolve 测试选文件内局部 FIXTURE 而非扩展共享 fixture；T-4 同构决策 | 符合 |
| 野段注入先例 | `WILD_SEG = {} as unknown as string` 与 `runtime-readdata-hostile-path-guard.test.ts:59` 同款敌意通道惯例；被测的是公共形状守卫 | 符合 |
| 单一事实源 | T-4 `oracle()` 经同一公共 API（`compileSchemaEnvelope`+`resolveSchemaAtPath`，`@nomicore/vfsl` 实导出亲验，且为 namespace-runtime 依赖 package.json:25）构造独立预言机——非旁路第二实现；`FROZEN_CODES` 为断言素材（ADR 冻结契约的字面引用）；域生成物钉值未漂移 | 符合 |
| 测试发现性 | 新文件匹配根 `vitest.config.ts:15` include `packages/*/test/**/*.test.ts`；CI 6 分片磁盘枚举自动纳入，零配置改动 | 符合 |

## 6. 生命周期对称性

| Acquire | Release | 失败路径 | 结论 |
| --- | --- | --- | --- |
| T-4 每 `it` 自建 runtime（ready 有界 poll interval 10 / timeout 5s） | `finally { await runtime.close() }` 逐例 | poll 超时即红（fail loud）；META.docId 违约 → persistence 拒绝；播种遗漏 → 值断言红 | 对称 |
| T-1/T-2 临时目录 `mkdtempSync` | `finally { cleanup() }`（rmSync recursive） | 编译诊断断言失败即红 | 对称（复用既有 helper 形态） |

无跨用例共享可变状态（每 `it` 独立 runtime + 独立 Y.Doc）；`WILD_SEG` 为无状态共享对象。

## 7. 文件范围

交付 diff 与设计 §10 ALLOW 下半段逐字吻合（3 个测试路径）；DENY 全表零触碰——生产 `src/**`、`domains/vfs3-assets/**`、`docs/**`、CI/vitest/根 `package.json`、`readdata-schema-projection-fixture.ts`、`real-persistence-scheduler.ts` 及其余既有测试/fixture 均无 diff（`git diff --name-status` 亲验）。wiki 产物路径符合技能固定产物约定。可选 T-5 与 `.test-d.ts` 镜像未做均属设计明示许可（SA3 Deferred 表显式记录）。

## 8. 测试质量标准（SA6 §12.0 纪律）

- 断言只观察公共接缝运行时输出（parseVfsl/evaluate 前置判别、generateProjection 发射文本、真实 TS 编译器诊断、resolveSchemaAtPath、readData）；无对实现源码的字符串/正则断言。
- 正例前置判别在场（C6a 前置、C3b 配对前提、T-4 前置用例 + 值断言），非空转；敏感性反证齐全（负例恰 1×TS2322、`@ts-expect-error` 反噬、desync 负控、7 组配对同码、码集合 ⊆ 冻结集、裸 Int 条件键 `Object.keys===['kind']`、detached 污染重读）。
- skip/only/todo/failing 扫描三个改动文件零命中；无 env 开关、无 fallback、无吞错（`derive()`/`oracle()`/`readOk()`/篡改前提守卫均携带实际 issues/code 响亮抛出）。
- 文案不冻结（只钉码/路径/键集/计数/稳定片段 `structure/value desync`）。
- SA3 报告的通过计数（13/16/10、焦点 4 文件 44 用例）与代码逐条可数的用例结构静态自洽；SA9 按技能约束未复跑，运行事实已由 SA3 门禁证据 + SA4 静态复核承接。

## 9. Non-blocking observations（MINOR，不阻断）

| ID | 观察 | 依据 |
| --- | --- | --- |
| M1 | 提交信息 `test: cover int and range schema projections` 未携带 issue 引用——近期惯例多带 `(#NNN)` 域（`fix(#314):`、`docs(#312):`、`feat(#282):`），SA3 建议稿亦为 `test(#316): …`； conventional type `test:` 本身合规，仅溯源便利性损失 | git log 惯例比对 |
| M2（承接 SA4 N1） | T-4 首条用例标题「writeData/readData 装置可观察预写值」中 `writeData` 措辞误导（runtime 写路径公共键为 `mutateData`；预写值系 runtime 构造前经 Y.Doc 播种，全文件无写路径调用）——纯测试标题文案，无行为影响 | `runtime-readdata-int-range.test.ts:113` |
| M3（承接 SA4 N2，存量观察） | 新文件类型面不在任何持久 typecheck 门禁内（`packages/namespace-runtime/tsconfig.json` 仅 include `src/**`；vitest typecheck 仅收 `*.test-d.ts`）——该包全部既有 `*.test.ts` 同处此存量缺口，非本票引入；SA3 已以一次性 strict tsc 单检补偿（报告 exit 0） | SA4 §12 N2；本轮亲验包 tsconfig |

## 10. 收尾结论

- **Verdict：`approve`**。交付 diff 是批准设计（iteration 1）的忠实纯加法落地：生产零改动守住 AC2 字节基线（钉值本轮再实测一致）；四项覆盖缺口（C1c/C1e/C3b/C3c）的断言形状、敏感性反证与 SA6 §12.0 纪律逐项成立；模块责任、ADR 冻结面、单一事实源、生命周期对称性、文件范围全部符合；无 BLOCKER/MAJOR。
- `requiresConflictRecheck: false`：零生产改动、零接口/协议/wire/schema/持久化/状态机语义变化；纯加法测试不触碰任何 ADR 冻结面。
