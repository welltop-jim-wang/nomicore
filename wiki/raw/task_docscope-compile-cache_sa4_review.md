# SA4 静态验尸报告 — DocScope 作用域绑定与编译缓存（H3 / issue #54）

**Date**: 2026-08-21
**Reviewer**: SA4（Red Team / 实现后静态验尸）
**被审对象**: commit `e43f3a5`（feat 实现）+ `cb42b6b` / `54f7cce`（SA6-owned fixture 修正），基线 `a5d85bd`（phase-2-engine-gaps）
**依据**: SA1 设计 R2 定稿 `task_docscope-compile-cache_design.md`（§5.3 参考实现 / §5.4·§5.5 守卫强制项 / §8 ALLOW·DENY LIST / §9 协议假设 / §10 契约连锁审计）；SA2 R2 评审 verdict pass（R2-N2/N3 实现提示）；SA3 实现记录 `task_docscope-compile-cache_sa3_impl.md`
**Verdict**: **pass**

## 审核方法声明

不采信 SA3 自述与任何先行日志，全部关键声称在本 worktree 独立重验：全量测试由本 SA 以独立进程（setsid detached）亲跑；SHA-256 以 node:crypto + 手构字节序列独立对拍并追加单射性 fuzz；行为边界以 tsx 直驱仓内源码逐项探测；diff 逐行直读对照设计伪代码。

## 审核结论

1. **设计一致性：✅ 一致（1 处已登记类型层偏差，裁定可接受）**
   - `src/sha256.ts`（122 行）与设计 §5.3 参考实现逐行同构（utf8Bytes WTF-8 单射分支 / K 表 / 长度编码 `Math.floor` 取整 / 压缩循环；`as number` 断言以局部元组消解，行为不变）；零 import 叶子模块、不进公共面（index.ts 仅 import 不 re-export，实测 grep 证实）。
   - `src/envelope.ts` 纯增量 **0 删行**——「既有函数零改动」属实；`envelopeTextGate`/`vfslIssues` 与 §5.1 伪代码一致。
   - `src/index.ts` `getCompiled` 控制流与 §5.2 逐语句一致（①typeof 判别 → gate 零损透传 → ②sha256 键 + 命中即返条目本体 → ③parse/evaluate 失败在 `Map.set` 之前 return → ④深冻结入册）；全函数体单 try/catch（D11/A2）落实；`deepFreeze` 与 §5.2 细则一致；`compiledCache` 无淘汰论证注释在位（D3）。`parseSchemaEnvelope` 内部重构与现行实现执行序/构造点同构（D5，RT-4 活体证明：`parse-schema-envelope.test.ts` 零改动、13/13 绿）。
   - **偏差登记项裁定**：`getCompiled(input: unknown)` 替代设计 §4.1 字面签名 `string | SchemaEnvelope`。**可接受**——(a) 类型层强制：SA6-owned 冻结测试 `compiledOf(input: unknown)`（:140-141）直调 getCompiled，本 SA 以 tsc 探针证实窄签名 + strict 下必 TS2345，而该文件设计明文「SA3 不得以任何理由改」；(b) 运行时行为与 §5.2 逐点一致（本 SA 实测 `42`/`null`/`undefined`/函数/数组/残缺信封 → ENV-1/ENV-2，见下文证据）；(c) 设计 §4.1 第 120 行自身明文运行时 unknown 姿态（`getCompiled(42)`/`null` → ENV-1），与 H1 `parseSchemaEnvelope(input: unknown)` 同源；(d) 已在 impl 记录 + JSDoc 双处登记（JSDoc 保留「入参意图类型」说明）。建议 SA1 后续修订时把 §4.1 签名行改为 `unknown` + 意图注释收编该偏差（非阻塞）。
   - R2-N2 实现提示已按 SA2 建议落地（RT-3 `validatePatch` path 用 `['a']` 数组实参；对抗 getter 断言经 `unknown` 中转）。R2-N3（n=100 为最大合法边界）在守卫测试注释中登记。
2. **读写路径一致性：✅ 一致**——写路径（`compiledCache.set(sha256Hex(text), entry)`）与读路径（`compiledCache.get(sha256Hex(text))`）共用同一哈希单点；module/derived 产出接缝与新鲜直编完全同源（parseVfsl/evaluate 直连，无中间层、无数据源分叉；AC1.1/AC3/RT-1 的 `toEqual(freshDerived)` 深相等断言为证）。
3. **静默失败：✅ 无**——getCompiled 全部路径返回结构化 ok 联合；本 SA 实测 8 类边界输入（42/null/undefined/函数/数组/残缺信封/对抗 getter/坏文本信封）全部落 `ok:false + issues` 且 kind/code 正确（ENV-1/ENV-2/ENV-100/kind:'vfsl'），无一条无观察效果路径。parse 失败重试幂等（两次 issues 全等）；未知方言拒绝不占用缓存键（同文本合法信封随后正常编译——实测）。
4. **降级方案：✅ 安全**——无任何 fallback/env-override/测试特判（铁律合规，diff 直读证实）；唯一「降级形态」ENV-100 顶层 catch 是设计 D11 强制的防御边界（与 H1 同口径，envelopeCrashIssue 单点含二次异常守卫），实测对抗 getter → `kind:'envelope'/code:'100'` 不外抛。深冻结非降级而是共享引用硬化（变异实测抛 TypeError，loud）。
5. **极端攻击：✅ 安全**——(a) **A1 攻击链闭合验证**：`sha256Hex('\uD800'/'\uDC00'/'\uFFFD')` 三向量与手构字节序列（`ed a0 80`/`ed b0 80`/`ef bf bd`）的 node:crypto 参照全等，且与设计 §5.4 声称的期望摘要逐字符一致；doc 注释/字符串字面量两攻击对经 getCompiled 引用互异 + 派生物各自正确（守卫测试 + 本 SA 独立复算双确认）；(b) **单射性 fuzz**：本 SA 自建 xorshift 代理密集生成器，30,000 条（20,537 条互异）→ 20,537 个互异摘要、0 碰撞；(c) 合法文本行为零变化：19 条合法向量（含 55/56/63/64/119/120 字节块边界、1000 字节多块、1–4 字节 UTF-8）与 node:crypto 全等；(d) 深冻结/JSON 往返/嵌套预算（parser.ts:24 `MAX_TYPE_NESTING=100` 实证）均达标。
6. **错误处理：✅ 完整**——每个分支（gate 拒绝/parse 失败/evaluate 失败/入册成功/命中）都有结构化返回；issues 与 parseSchemaEnvelope 同域（AC4 `toEqual(h1.issues)` 全等断言绿——gate 同源构造的活体证明）。
7. **架构评估：✅ 可行**——纯组合冻结接缝（零改动 evaluate/parser/tokenizer/semantic/ir/derived/validate 族），无绕过、无 FIXME、无临时补丁；D1–D11 全部按设计落地，无一处需要退回 SA1 的架构制约。
8. **过度设计：✅ 精简**——实现规模与设计估算吻合（sha256 122 行 / envelope +26 / index 净 +125）；无「为将来」抽象层；守卫测试为设计强制项非 SA3 自加。

## 文件清单 Scope Creep Guard（§1.1）

- 实际 diff（`git diff --name-only a5d85bd HEAD`）非 wiki 文件恰 7 项，与 §8 ALLOW LIST 逐项一一对应：`src/sha256.ts`（新）/ `src/envelope.ts`/`src/index.ts`/`package.json`（0.1.9→**0.1.10** 实证）/ `test/docscope-sha256.test.ts`（新）/ `test/docscope-guards.test.ts`（新）/ `test/docscope-getcompiled.test.ts`（SA6-owned，修正轮 cb42b6b/54f7cce）。**无越界文件**。
- DENY LIST 全零触碰：evaluate/parser/tokenizer/semantic/shapes/resolve/pattern/xml/errors/ir/derived/validate/validate-patch/schemasource/vfsl-protocol/vfsl-codegen/配置/既有测试均不在 diff；envelope.ts 0 删行（既有函数零改动实证）；`parse-schema-envelope.test.ts` 零改动全绿（RT-4 活体证明）。
- BLACKLIST（package-lock.json/yarn.lock/.DS_Store/TASK.md/*.bak）：零命中。wiki/raw/task_* 为白名单管线档案。

## 测试触发与质量（§1.3/§1.4/§1.7）

- **触发**：三个 docscope 测试均落 `packages/vfsl/test/*.test.ts`，被 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖；根 `pnpm test` = `vitest run --typecheck`、CI `ci.yml`（PR 触发，node 20/24 矩阵）显式跑 `pnpm test` + `pnpm typecheck`（三包 tsc）。无孤儿 spec。
- **质量**：无 `.skip`/`.only`/`.todo`；无「readFileSync 源码 + 正则断言」反模式——AC6.1 的 `readFileSync('../package.json')` 是**清单契约断言**（`dependencies ?? {}` toEqual `{}`，设计 AC6 明文要求，读的是 manifest 非源码），其余断言全部为运行时行为（引用同一性/spy 计数/深相等/结构化 issues 形状）。SA6 修正轮（cb42b6b D1/D2 + 54f7cce R2.1 签名）均为 fixture/mock 卫生级，断言语义未削（直读 diff 证实：D1 仅加 drain+mockClear，D2 仅调计数位置与期望值）。

## 1.4 vitest 触发性自检（Hard Gate #14 立法项，2026-08-21 增补）

本任务新增/改动的全部 `*.test.ts`（3 个，同属 workspace package `@nomicore/vfsl`，目录 `packages/vfsl/test/`）：

| 测试文件 | 来源 commit | vitest include 覆盖 | tsc typecheck 覆盖 |
|---|---|---|---|
| `packages/vfsl/test/docscope-getcompiled.test.ts` | e43f3a5 + cb42b6b + 54f7cce | ✅（见下） | ✅（见下） |
| `packages/vfsl/test/docscope-sha256.test.ts` | e43f3a5 | ✅ | ✅ |
| `packages/vfsl/test/docscope-guards.test.ts` | e43f3a5 | ✅ | ✅ |

**触发链逐环核实**（本 SA 直读配置 + 本会话亲跑实证）：

1. **vitest include 模式**：`vitest.config.ts` `test.include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts']`——`packages/vfsl/test/docscope-*.test.ts` 被 `packages/*/test/**` 通配精确覆盖。本仓库为根级单 vitest 运行（无 per-package `--filter`），包级触发问题在此归约为「include glob 是否覆盖该包目录」——覆盖。
2. **CI workflow**：`.github/workflows/ci.yml`（`on: pull_request`）`test` job 显式步骤 `pnpm typecheck`（= 三包 `tsc -p`，其中 `packages/vfsl/tsconfig.json` 的 `include: ["src/**/*.ts", "test/**/*.ts"]` 把三个测试文件纳入 tsc 辖域）+ `pnpm test`（= `vitest run --typecheck`，经上述 include 收录执行）。无 `continue-on-error`、无 `paths:` 路径过滤，任一测试红即 job 红。
3. **本会话亲跑实证**（2026-08-21，独立 detached 进程 `pnpm test`，日志 `/tmp/sa4-full-test.log`）：
   ```
   ✓ packages/vfsl/test/docscope-guards.test.ts (6 tests) 50ms
   ✓ packages/vfsl/test/docscope-getcompiled.test.ts (13 tests) 18ms
   ✓ packages/vfsl/test/docscope-sha256.test.ts (13 tests) 12ms
   Test Files  36 passed (36) / Tests  555 passed (555) / Type Errors no errors / exit 0
   ```
   三个文件（6+13+13=32 用例）均被 runner 实际加载并执行——非孤儿 spec 的直接证据。
4. **CI run 补验说明**：分支尚未 push、PR 未建，GitHub Actions run 尚不存在——`ci.yml` 触发性属静态核实（步骤直读，如上），动态证据（`gh run view --log` 摘录三个文件在 node 20/24 矩阵下的执行记录）留待 push 后由 SA7 dynamic-verify 阶段补验（与本报告「动态审核重点」#1 一致对齐）。

**结论行：all-vitest-packages-triggered**（`@nomicore/vfsl` 的全部三个新增/改动测试文件均被 vitest.config include 与 ci.yml `pnpm test`/`pnpm typecheck` 步骤覆盖；本地亲跑已证执行，CI run 证据 push 后 SA7 补验）。

## 协议假设复核（§1.5，设计 §9 重放）

| # | 假设 | 本 SA 重放结果 |
|---|---|---|
| #3 | SHA-256 参考实现正确 | ✅ 19 合法向量 + 3 WTF-8 手构向量 vs node:crypto 全等；块边界（55/56/63/64/119/120B）与多块路径覆盖 |
| #7 | WTF-8 单射性 + 期望摘要值 | ✅ 三期望摘要逐字符复现；fuzz 20,537 互异字符串 0 碰撞；D800/DC00/FFFD/DBFF/DFFF 互异 |
| #1 | 模块级缓存跨 it 存续 | ✅ 隐式确认（AC1.2 evaluate spy 计数 =1/命中不增断言绿——计数断言依赖跨用例缓存存续） |
| #5 | vi.mock 模块图截获值导入 | ✅ 隐式确认（spy 计数精确命中 = mock 截获了 index.ts 的 evaluate 值导入；公共 re-export 面不变） |
| #2/#4 | ESM freeze TypeError / lib ES2022 | ✅ tsconfig.base.json 直读（`lib:["ES2022"]`/strict/noUncheckedIndexedAccess/verbatimModuleSyntax）；冻结变异实测 TypeError |

## 契约改动连锁审计（§1.6）

无「return→throw / 同步变 async」类契约改动。逐 caller 矩阵：

| 改动 | caller | 判定 |
|---|---|---|
| `getCompiled`（新增） | 仓内零 caller（git grep apps/domains/codegen/protocol/tests 零命中）——纯新增，无连锁 | ✅ |
| `evaluate` 导入形态（re-export → 值导入+re-export） | codegen `collect.ts:71` + codegen 各测试经 `@nomicore/vfsl` 公共面取用——绑定名与解析目标模块均不变，全量 555 绿实证 | ✅ |
| `parseSchemaEnvelope`（内部重构） | H1 验收测试（零改动 13/13 绿）+ SA6 AC4 对照基准（toEqual 全等绿）——行为逐字节不变的活体证明 | ✅ |

## 验证证据（本 SA 亲跑，2026-08-21 本 worktree）

| 验证项 | 命令 | 结果 |
|---|---|---|
| 全量测试 | `pnpm test`（= `vitest run --typecheck`，独立 detached 进程） | **Test Files 36 passed (36) / Tests 555 passed (555) / Type Errors no errors / exit 0** |
| SHA-256 对拍 | tsx 脚本：19 合法向量 + 3 WTF-8 手构字节向量 | `legal-ALL: true`；三 WTF-8 向量 `impl==handRef:true impl==claimed:true`，字节序列 `ed,a0,80`/`ed,b0,80`/`ef,bf,bd` |
| 单射 fuzz | tsx + xorshift 生成器，30,000 条代理密集串 | `distinct strings: 20537, distinct hashes: 20537, collisions: 0` |
| 攻击对 | 设计 §5.4 两对 fixture | `pair1/pair2 distinct: true`；D800/FFFD/DC00/DBFF/DFFF 两两互异 |
| 行为边界探测 | tsx 直驱 `getCompiled` | 冻结容器/module/derived 全 `isFrozen:true`，变异→TypeError；hit 同引用；`42/null/undefined/函数/数组→ENV-1`、`{lang:'vfsl'}→ENV-2`、对抗 getter→`ENV-100`（kind envelope/code 100）、坏文本信封→kind:'vfsl'；parse 失败重试 issues 全等；wml 拒绝后同文本合法信封正常编译 |
| 版本 bump | `packages/vfsl/package.json` | `"version": "0.1.10"` ✅（dependencies 空集维持——AC6） |

## 流程完整性备注（非代码缺陷，登记供总控知悉）

本 SA 注意到 staging 区已有总控的归属更正（dispatch 日志「⚠ 越权进程」行）：e43f3a5/cb42b6b/54f7cce 三 commit 的实际作者为非总控、非 SA 的进程，wiki 原记录的「总控亲验/SA6 已执行」归属被更正。**对本次验尸的影响评估**：本 SA 的裁定完全基于对 commit 内容的独立审计（上述全部证据为本会话亲跑，不采信任何先行日志），内容层面与设计一致、全量绿由本 SA 复现，故代码级 verdict 不受该事件影响。归属更正属总控处置范畴（SA6 事后审查轮 + 总控亲验复验均已排程），建议这些 staged wiki 更正随本任务一并提交以固化事实链。

## 动态审核重点（交 SA7）

1. **PR CI 绿确认**：本地 555/555 exit 0 已由本 SA 复现；SA7 应从 PR 的 `gh run view --log` 摘录 ci.yml（node 20/24 矩阵）中三个 docscope 测试文件 + `pnpm typecheck` 的实际执行证据（spec 触发证据立法项）。
2. **内容完整性锚定**：鉴于越权 commit 事件，SA7 应在动态验证前记录 HEAD 内容哈希（`git rev-parse HEAD` + `git hash-object packages/vfsl/src/*.ts`），确认 PR 发布内容与本报告审计对象逐字节一致（无审计后漂移）。
3. **大文本成本 sanity**（可选）：~64KB 文本 sha256+deepFreeze 首编耗时与命中 O(hash) 对照——守卫测试已证正确性，性能量级未测。
4. **未来消费方接入观察**（前瞻，非本票义务）：v1 无淘汰 Map 的内存论证依赖「进程内命名空间数有界」——yjs-server 接入（H3 下游）时应实测活文档集规模 × 单文本规模的上界（§12 V2-2 触发条件监控）。
5. **getCompiled 在真实并发交错的引用稳定性**（可选）：同步函数 + JS 单线程下无 in-flight 竞争（§6 论证），动态侧抽测交错调用引用同一即可，风险低。

---

**Verdict: pass** —— 实现与 SA1 R2 设计一致（唯一偏差已登记且经裁定为类型层强制项），ALLOW/DENY 合规，A1/A2 攻击面闭合经独立复算确认，全量 555/555 由本 SA 独立复现。SA7 可进入动态验证，重点见上节。
