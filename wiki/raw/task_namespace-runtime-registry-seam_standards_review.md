# Standards 审查报告 — issue #109（namespace-runtime Registry 专用受限生产构造 seam）

**审查轴**: Standards（engineering/code-review，独立完工前审查；只审查、未修改任何文件）
**审查 diff 范围（精确声明）**: `git diff 3451eca..HEAD`（HEAD = `4299b90`；两 commit：`b233ea4` 实现 + `4299b90` 测试/档案）
**审查基准**: AGENTS.md、CONTEXT.md、docs/adr/0008、docs/adr/0009、根 package.json scripts、vitest.config.ts、tsconfig 体系、packages/namespace-runtime 存量测试风格（抽样 runtime-close-sa7-dynamic.test.ts / runtime-acceptance-exports-audit.test.ts / runtime-acceptance-fullchain.test.ts 等）
**审查日期**: 2026-08-25

---

## 0. 验证方式（证据等级声明）

- 逐文件精读 diff 内全部业务改动（7 文件）；逐条对照 ADR-0008 §生命周期/所有权（L89-91）、ADR-0009 §模块与 Cordis service（L14-18）。
- 对实现侧事实声明做源码级复核（runtime.ts L148/L274/L329/L376/L161、write.ts L104、schema-write.ts L123）。
- 动态复核（只读执行）：`npx vitest run --typecheck` 针对三相关测试文件 → 16/16 绿、Type Errors no errors；`npx vitest run packages/namespace-runtime` 全量 → 25 文件 133 用例全绿、Type Errors no errors（exit 0）。
- 仓库惯例抽查：「红灯现状」头注保留惯例（存量 10+ 文件同款）、sleep(100) debounce flush 惯例（runtime-acceptance-fullchain.test.ts L235 等 6 处）、wiki/raw 设计文档引用惯例（doc-runtime/src 多文件同款）、各包 exports 形态（仅此包新增 subpath，属 ADR-0009 立法的首创而非违规）。

---

## 1. 硬性违规（hard violations）

**无。**

逐项核查记录（全部通过）：

| # | 检查项 | 证据 | 结果 |
|---|---|---|---|
| H1 | internal subpath 值导出恰一键、名称为 ADR-0009 冻结名 | internal.ts L28-32 仅 `export function createNamespaceRuntimeForRegistry`；seam.test.ts L121 运行时探测断言通过 | ✅ |
| H2 | 主 entry 公共面零改动、不导出生产构造器/seam | diff 中 index.ts 零改动；exports-audit 留守断言（L25 值导出恰 RuntimeWriteFatalError、L30-50 禁导清单）未动且全绿 | ✅ |
| H3 | 无 `./testing` 等测试子路径（issue #93 AC6 不变量保持） | package.json exports 恰 `[".", "./internal"]`；T1.4 演进后断言 L64 与 seam.test.ts L111-114 禁导子路径名单双重锚定 | ✅ |
| H4 | internal.ts 纯委托、零自有分支、相对导入（设计 §D-F 三硬规则 ①②兑现） | internal.ts L13 `from './runtime.js'`（非自引用 specifier）；L31 `return createNamespaceRuntime(handle, notifyDirty)` 单语句委托；runtime.ts L274-279 证实被委托方即既有构造序 | ✅ |
| H5 | 测试断言的稳定 message 与实现逐字一致 | SA7 探针断言 `/seam 输入缺少 handle/`（runtime.ts L329）、`/input\.notifyDirty 若提供必须是 function/`（L376）、`/HANDLE_NOT_USABLE/`+`/released/`（L161）、`notifyDirty 未绑定`（write.ts L104）——全部源码级命中 | ✅ |
| H6 | 测试文件落入 vitest/typecheck 收集范围 | vitest.config.ts L5/L9 include glob 覆盖 `test/**/*.test.ts` 与 `test/**/*.test-d.ts`；tsconfig.typecheck.json include 覆盖 `packages/*/test/**/*.ts`；包 tsconfig `src/**/*.ts` 覆盖 internal.ts（根 `typecheck` script L13 含本包） | ✅ |
| H7 | 测试纪律：零网络/零端口、真实时钟仅限 debounce flush、内存 persistence | 三新测试全部 `createMemoryPersistence`；sleep 仅 40ms FIFO 乱序探针与 100ms flush（与存量惯例一致） | ✅ |
| H8 | 模块头注/契约溯源纪律 | internal.ts L1-15 头注（ADR-0009 锚 + 消费边界 + 导出面纪律）；三测试文件头注均含契约来源、红灯机制、断言纪律——与存量 SA6/SA7 文件同款 | ✅ |
| H9 | AC5 边界审计可实施性（防空扫 + 谓词自检 + 白名单与 ADR-0009「Registry 生产代码」一致） | seam.test.ts L374-395 三 it；白名单前缀 `packages/namespace-registry/src/`（L320）逐字对应 ADR-0009 包名；审计不锁「当前空集」为断言（L318-319 注释），前瞻放行切片 5/6 | ✅ |
| H10 | 实际执行绿 | 三文件 16/16（含 typecheck 段）；全量 25 文件 133 用例，Type Errors no errors | ✅ |

---

## 2. 非阻塞判断（judgement calls）

| # | 位置 | 判断 | 理由 |
|---|---|---|---|
| J1 | README.md L30-32 | 「Contract sources」段仍只列 CONTEXT.md + ADR-0008；L9 已新增 ADR-0009 派生面（internal subpath）的描述，建议后续把 0009 补入契约源清单 | 非阻塞：0009 在 internal.ts 头注与测试头注中已充分锚定；README 该段措辞是「normative behavior」主干（单 Runtime 语义仍全部来自 0008） |
| J2 | internal.ts L13 行内注「（§D-F）」 | 该引用解析到 wiki/raw 任务设计文档 §D-F（非规范文档）；仓内存量惯例允许源码引用 wiki/raw 设计文档（doc-runtime/src 多文件同款），且头注 L3 已锚定规范源 ADR-0009 | 非阻塞；若追求纯规范溯源可改写为 ADR-0009 §模块与 Cordis service，但现状不违例 |
| J3 | package.json version 0.1.5→0.1.6 | 新增 exports subpath 按 semver 直觉更像 minor；但包 `private: true` 无发布对象，仓内版本演进本为 ad-hoc（git log 仅 #85 与本 commit 两次触碰该文件），bump 动作本身比不 bump 更合规 | 非阻塞 |
| J4 | seam.test.ts L334-337 AC5 审计正则 | 覆盖 `from '…'` 与动态 `import('…')` 两种形态，未覆盖 side-effect `import '…'`（无 from）形态；对本仓 ESM/无 side-effect 导入惯例而言覆盖足够，未来可作加固项 | 非阻塞 |
| J5 | seam.test.ts L87-99 双探针调用 | `factory(handle, notifyDirty, sentinels)` 向两参函数传第三参（JS 忽略），刻意不预锁 arity；类型面锁死由 test-d.ts 承担，分工在头注 L80-86 已声明 | 非阻塞（刻意的契约探测设计） |
| J6 | sa7-dynamic.test.ts L55-62 本地 `RuntimeLike` 结构型 | 未复用公共 `NamespaceRuntime` 类型，属「unknown 工厂产物」探测的刻意结构子集；十键完整面已由 seam.test.ts L263-274 锚定，无覆盖缺口 | 非阻塞 |
| J7 | seam.test.ts 头注 L14-19「红灯现状（2026-08-25 HEAD）」在修绿后保留 | 与仓内惯例逐字一致（存量 10+ 文件保留红灯头注作历史锚，如 runtime-p0-sequencer.test.ts L34）；非但不违例，反而是本仓测试档案纪律的遵守 | 确认合规，非问题 |

---

## 3. 结论

**Verdict: pass**

依据：硬性违规零条（§1 十项核查全过，含动态执行复核 16/16 + 全量 133/133 绿、typecheck 零错误）；§2 七项均为非阻塞判断（J7 实为合规确认）。改动与 ADR-0008/0009 逐字对齐，测试/头注/导出/术语纪律与仓内存量风格一致，T1.4 演进保持了 issue #93 立法的不变量并显式记录演进依据。
