# SA6 诊断与验收契约报告 — issue #266：VFSL 内容寻址 schema ID（sc1-）：窄派生接口与 envelope 校验

> 阶段：acceptance-contract（红灯固化，iteration 0）。前置：SA8 冲突门禁 `clear`
> （`wiki/raw/task_issue-266_conflict_report.md`，含 B1/B2/B3 三项边界条件）。
> Issue comments：派发前 REST 读取为空——无 Owner 反馈适用；owner requirements：无。
> 结论：能力缺口已实证（当前 HEAD 无任何 `sc1-` 实现、无 text-only 身份派生接口），
> 红灯契约测试已固化并亲跑验证——envelope 校验契约 **16 红灯（全部且仅为本契约的
> 目标断言，失败点均为「期望 ok:false 收到 ok:true」）+ 9 绿负控/锚**，3/3 连跑结果
> 逐位一致；窄接口契约 8 红灯（失败点均为「导出缺失/非函数」的构造性红灯，同
> compile-schema-envelope.test.ts Phase 1 先例）；全仓 557 既有 vfsl 测试零波及。

## 1. 交付物

| 文件 | 内容 |
|---|---|
| `packages/vfsl/test/sc1-base32-ref.ts` | 独立 RFC 4648 Base32 canonical 参考件（测试侧；非 *.test.ts，不被 vitest 收集；不进入包公共面） |
| `packages/vfsl/test/sc1-schema-id-envelope-validation.test.ts` | envelope 强校验红灯契约（25 用例：16 红 + 9 绿）——**当前即可执行**，行为级红/绿 |
| `packages/vfsl/test/sc1-derive-schema-identity.test.ts` | 窄接口验收契约（8 用例，全红）——静态 import 尚不存在导出，构造性红灯 |
| `wiki/raw/task_issue-266_sa6_red.log` | envelope 契约单次 verbose 红跑原始日志（16 failed \| 9 passed，Type Errors: no errors） |
| `wiki/raw/task_issue-266_sa6_narrow_red.log` | 窄接口契约红跑原始日志（8 failed \| 0 passed，Type Errors: no errors） |
| `wiki/raw/task_issue-266_sa6_contract.md` | 本报告 |

## 2. Task type and inputs

- **类型：Feature**（ADR 0015 的 `@nomicore/vfsl` 包内切片兑现；不设计最终修复、不改生产实现）。
- 输入：任务简报 `wiki/raw/task_issue-266.md`（issue #266，open，挂 Parent PR #158）；派发注记
  `wiki/raw/task_266_dispatch.md`（comments: none (REST read)；owner requirements: none）；
  SA8 冲突门禁 `wiki/raw/task_issue-266_conflict_report.md`（verdict `clear`）；governing 决策
  `docs/adr/0015-vertical-rest-namespace-create.md` L117-144/L196（content-addressed schema ID、
  窄派生接口、测试决策）；指纹语义 `docs/adr/0007-...md` L17；词条 `CONTEXT.md` L70-74。
- 仓库基线：HEAD `a1ca2d7`（`docs: specify vertical REST namespace create`，PR #158 分支尖，携带
  ADR 0015），branch `mabf/issue-266`；无 `wiki/raw/task_issue-266_relevant_decisions.md` 与既有
  SA6 产物（首次迭代，原位新建）。

## 3. Owner comment mapping

Issue 评论 REST 读取为空、无 Owner 追加要求（派发注记与简报一致）。验收口径 = issue 简报
AC1–AC4 + ADR 0015 §测试决策 L196 六场景清单逐条映射（§12）。

## 4. SA8 constraints（本契约的落实）

| SA8 裁决/约束 | 本契约落实 |
|---|---|
| 无冲突放行；范围 = `packages/vfsl` 包内部分；REST vertical 本体不在本票 | 全部测试落在 `packages/vfsl/test/`，经公共入口 `src/index.ts` 消费；零生产改动 |
| 冲突点 1/2/3 逐字兑现：窄接口形状、`sc1-<52 小写 Base32 无 padding>`= 完整 256-bit digest、空白/普通注释稳定 + JSDoc/顺序敏感 | 文件 2 全量锚定；digest 一致性用**独立参考件双向重编码**验证（防与生产实现同源循环论证） |
| 冲突点 4/B3：两新码落 envelope 层 `VFSL-ENV-E<码>:` 注册表（自然读法），不触方言层 21 码冻结表；「编号由实施时按错误注册表分配」 | 契约**不预锁具体数字**：只锁两模式各自稳定、互不相同、纯数字 envelope 码、不与既有 ENV_1–5/100 别名、冻结 message 前缀（文件 1 describe 4 单测自足） |
| 冲突点 5：六场景包级契约测试 | §12 逐项映射到两个测试文件 |
| 边界条件 B1：id「标签→可校验内容地址」不回归「引擎正确性不依赖 id 唯一性」 | 契约只要求与同信封 text 的**真实性匹配**（格式 + digest 相等），不要求全局唯一性、不进入 doc/复制身份 |
| 冲突点 9/工程纪律：公共 API 仅经 `src/index.ts`；稳定性兼容 | 窄接口契约静态 import 自 `../src/index.js`；envelope 契约全部经既有 `compileSchemaEnvelope` 公共入口；既有码/排序/严格性回归由负控组守护 |

## 5. Environment and baseline

- 运行环境：node v24.13.0 / pnpm 10.28.2 / vitest 3.2.7 / TypeScript 5.9.3；
  `pnpm install --prefer-offline`（本地 store，零网络）干净完成。
- HEAD：`a1ca2d7`；工作树除本 SA6 文件外零改动（`git status` 仅列出测试、报告、日志与
  派发前已存在的简报/门禁 untracked 文件）。
- 基线：`packages/vfsl/test/` 全目录 30 文件 557 passed 复跑确认（加本契约后 557 passed +
  24 红，见 §13）；`compile-schema-envelope.test.ts` 28/28 绿——语义指纹的空白/注释稳定、
  JSDoc/顺序敏感、id 排除等敏感度已由 #72 契约锁定，本契约**不重测算法**，只测 `sc1-`
  作为信封 `id` 值格式时的新增校验面与其消费（窄接口同指纹语义）。
- 能力缺口事实面（grep 全仓）：`sc1-` 仅出现于 `CONTEXT.md` 与 ADR 0015；`packages/vfsl/src`
  无任何实现；`semanticFingerprintOf/envelopeFingerprintOf` 为模块内部（index.ts 只内部消费，
  不导出）；公共面无「text → fingerprint/ID」函数。

## 6. Capability gap（Feature 的「正复现」：当前行为 vs 目标行为）

最小输入探针（/tmp scratch，经公共入口 compileSchemaEnvelope；同一输入重复执行结果一致）：

| # | 输入 envelope（lang=vfsl, version=1） | 当前行为 | 目标行为（ADR 0015 L144） |
|---|---|---|---|
| P1 | `id` = TEXT_B digest 的 canonical `sc1-`，`text` = TEXT_A | **ok:true（放行）** | ok:false，语义不匹配 issue code M |
| P2 | `id` = TEXT_A digest 的 canonical `sc1-`，`text` = TEXT_A + JSDoc | **ok:true（放行）** | ok:false，语义不匹配 issue code M（JSDoc 保留在指纹） |
| P3 | `id` = `sc1-NotABase32Id!!!!` | **ok:true（放行）** | ok:false，格式 issue code F |
| P4 | `id` = `sc1-<大写 payload>` | **ok:true（放行）** | ok:false，格式 issue code F（非 canonical 大小写） |
| P5 | `id` = 旧式（`legacy-schema-id` / `vfs3-assets@1`） | ok:true | ok:true（兼容，不变）——负控 |
| P6 | `id` = TEXT_A 的 canonical `sc1-`，`text` = TEXT_A（trivia 变体） | ok:true | ok:true（匹配，不变）——验收正例 |

P1–P4 四类放行即功能缺口的行为证据（红灯断言点全部为 `expect(r.ok).toBe(false)` 收到
`ok:true`——「期望 false 收到 true」，失败在目标断言处而非环境/入口）。窄接口方向缺口 =
公共导出不存在（§13 文件 2 构造性红 + tsc TS2305 单错）。

## 7. Negative control（相近负控，恒绿）

| # | 负控 | 断言（全部运行时行为） | 当前 | 目标 |
|---|---|---|---|---|
| N1 | 旧式 SCHEMA id 兼容（`vfs3-assets@1` 仓内真实形态 / `compile-fixture` / `命名空间@schema版本` ADR 0006 例举 / 任意旧标签；含 `sc1` 子串但非 `sc1-` 前缀） | compileSchemaEnvelope ok:true、语义指纹稳定同 FP_A | 绿 | 保持绿 |
| N2 | canonical `sc1-` id 与同 digest text（逐字/空白/`//`/`/* */` trivia 变体） | ok:true、指纹逐位一致、id payload 与指纹 digest 一一重编码 | 绿 | 保持绿 |
| N3 | parse 失败文本 + canonical `sc1-` id | ok:false 且全为原生 vfsl issues（与 parseVfsl 同输入深相等）、零 envelope 码 | 绿 | 保持绿（语义指纹需规范 IR ⇒ 判定只能在 parse 成功之后，H3） |
| N4 | 参考件自检（RFC 4648 §10 KAT + 32-byte 往返 + 全零/全 FF 极端 digest 钉位） | 参考编码器自身不漂移（防循环论证） | 绿 | 绿 |

N1 是兼容性回归守护：证明红=新增校验纪律，而非对旧式 id 的误伤。N3 排除「parse 失败被
误报为语义不匹配」的伪路径。

## 8. Stability, scale and timing

- 稳定性：envelope 契约文件 **3/3 连跑均为 `16 failed | 9 passed`，Type Errors: no errors，
  unexpected 0**（失败集逐次相同，见 §13 三连跑输出）；全部纯同步、确定性（compileSchemaEnvelope
  纯函数），零 sleep/零计时 → 无 flake 面。
- 规模：单信封、最短 VFSL 文本（`type ROOT = { a: string; };` 量级）+ trivia/JSDoc/顺序变体；
  不依赖文本规模。
- 时序条件：无。

## 9. Capability gap 根因链（Feature 缺口链；非 Bug，无「旧实现因根因而错」因果）

| Step | 事实 | 证据 | Confidence |
|---|---|---|---|
| 1（症状） | 任意 `sc1-` 前缀 id（含格式垃圾与语义不匹配）都被完整 envelope 编译放行为 ok:true | P1–P4 探针；红灯日志 `expected true to be false` ×16 | 高（16/16 复现） |
| 2（直接缺口点） | envelope 形状门只校验 `id` 的 typeof=string（envelope.ts `ENVELOPE_KEYS`），无值域/格式规则；id 全程不参与 compileSchemaEnvelope 任何判定 | `packages/vfsl/src/envelope.ts` L82-87/L232-268；index.ts compileSchemaEnvelope L313-357（id 仅进 envelope 指纹与回显） | 高（源证据 + 行为探针互证） |
| 3（缺口二） | semantic fingerprint 计算已存在（fingerprint.ts，经 index.ts 内部消费）但无「text → fingerprint/ID」的公共窄接口；指纹函数不进公共面 | `packages/vfsl/src/fingerprint.ts` L55-58；`src/index.ts` 导出清单零指纹函数；`parseVfsl(text)` 只返 module | 高（grep + 导出面阅读） |
| 4（缺口三） | `sc1-` 编码/解码与 canonical 校验在全仓零实现（无 Base32 参考、无格式常量） | grep `sc1-` 全仓仅 CONTEXT.md/ADR 0015；packages/vfsl/src 零命中 | 高 |
| 5（触发条件/上下文） | ADR 0015 L144 义务只挂在「完整 envelope 编译」= `compileSchemaEnvelope`（含 evaluate 与双指纹的成功路径）；H1 `parseSchemaEnvelope`/`getCompiled`（无指纹）不在义务面 | ADR 0007 L15 分相位模型 + 0015 L144 措辞；SA8 冲突点 4 | 中（语义读法；见 §15 未锁项） |
| 6（排除项） | 「id 校验会影响旧式 id/其余路径」：旧式 id 恒 ok、指纹算法独立于 id | N1/N2 绿；#72 契约 AC4 已证 id 排除在语义指纹外 | 高（已排除） |

## 10. Causal experiments

1. **控制变量（id 前缀 vs 文本）**：同一 TEXT_A 上只替换 id 前缀/编码形态（P1–P4）→ 全放行；
   同 id 只替换文本为 JSDoc 变体（P2）→ 仍放行。变量 = sc1- 校验缺失本身，非 fixture 形态。
2. **独立参考件跨验**：RFC 4648 Base32 参考实现与 Python `base64.b32encode`（strip `=`、lower）
   对 5 组 32-byte digest（含 sha256('')/sha256('abc')/全零/全 FF/AA 重复）逐字一致；32 bytes →
   恰 52 字、末字符 ∈ {a,q}（pad 位为零的推论，RFC 4648 §3.2）数学自洽。参考件进测试套
   自检（N4 绿），防止测试侧漂移。
3. **未来绿灯模拟**（/tmp scratch，28 断言）：以「compileSchemaEnvelope(旧式 id) 的语义指纹 +
   独立参考件编码」模拟 H1 窄接口语义，对文件 2 全部 28 条断言逐条演算 —— **28/28 PASS**：
   证明文件 2 的红只可能来自导出缺失（构造性红），期望/夹具/断言无隐藏错误；SA3 落地同名
   导出后文件 2 应整体转绿。
4. **回归面探针**：旧式 id（P5/N1）与 parse 失败（N3）在既有实现上行为符合目标 → 红绿对照
   干净，无负控伪绿/伪红。

## 11. Impact surface

- 生产改动面（SA3 域，本契约只观测不实现）：`packages/vfsl/src/envelope.ts` 注册表 append
  两新码（SA8 B3 读法：`VFSL-ENV-E` 码空间；不得动 errors.ts 方言层 21 码冻结表）；
  `compileSchemaEnvelope`（index.ts）envelope 相位加 `sc1-` 格式校验 + parse 成功后加
  digest 匹配校验；`src/index.ts` 公共面新增窄接口导出（本契约假设名 `deriveSchemaIdentity`，
  见 §15）；新增 canonical Base32 编码件（实现侧内部件，公共面不暴露）。
- 观察面（不改）：`parseSchemaEnvelope`（H1）/`getCompiled`（DocScope 门）语义保持——本票
  义务挂「完整 envelope 编译」；`parseVfsl`/`evaluate`/指纹算法/冻结产物五件套零变。
- 兼容面守护：N1（旧式 id）、#72 契约（指纹敏感度/单 issue/冻结）、全 vfsl 目录 557 既有
  测试绿（§13）——新增校验不得造成任何既有绿转红。

## 12. Acceptance contract and test paths

包级契约测试矩阵 = issue AC3 六场景 + AC1/AC2/AC4 + ADR 0015 L144 两码场景：

| 验收标准（issue/ADR） | 契约位置（用例数） | 当前状态 |
|---|---|---|
| AC1 窄接口从 VFSL text 确定性派生 fingerprint 与 `sc1-` ID，或 VFSL issues | 文件 2 describe 1（4 红）/describe 3（1 红） | 红（导出缺失） |
| AC2 ID = 完整 256-bit digest 的 52 位小写 Base32，与 `sha256:v1:<hex>` 同 digest 信息 | 文件 2 describe 1（1 红：独立参考件双向重编码 + 与既有 pipeline 指纹相等）；文件 1 参考件组（3 绿） | 红/绿 |
| AC3·fingerprint ↔ sc1- 一一重编码 | 文件 1 匹配正例（绿）；文件 2 describe 1（红） | 见上 |
| AC3·空白/普通注释稳定 | 文件 1 匹配正例 trivia（绿）；文件 2 describe 2（红） | 见上 |
| AC3·JSDoc 变化改变 ID | 文件 1 红灯 1 P2（红）+ 正例 JSDoc 自洽（绿）；文件 2 describe 2（红） | 红/绿 |
| AC3·canonical Base32（含声明顺序变化） | 文件 1 红灯 2 格式矩阵 12 形态 + 顺序变化见文件 2；文件 1 参考件 KAT | 红/绿 |
| AC3·旧 ID 兼容 | 文件 1 负控 N1（2 绿） | 绿 |
| AC3/ADR L144·`sc1-` 格式错误与语义不匹配各产生稳定 issue code | 文件 1 describe 3（1 红：稳定性/互异性/码空间单测自足） | 红 |
| AC4 不暴露 IR/派生 schema/validator、不接受 provisional envelope ID | 文件 2 describe 1（ok 分支精确键集 + `fn.length===1` + 单参调用；红） | 红 |
| ADR L144·完整 envelope 编译强校验（格式 + 精确匹配） | 文件 1 describe 1/2/3/4 + 正例 + N3 锚（16 红 + 9 绿） | 红/绿 |

测试入口真实性：两个文件均落在仓库 vitest include 模式 `packages/*/test/**/*.test.ts`
（vitest.config.ts）内；`pnpm test`（root，`NODE_OPTIONS=--conditions=nomicore-source vitest
run --typecheck`）与定向 `vitest run <file>` 均发现（§13 命令逐条亲跑）。

## 13. Red/green or baseline evidence（亲跑，全部原始日志存 §1）

**文件 1（envelope 契约，当前 HEAD 直接可执行）**——`16 failed | 9 passed (25)`，Type Errors:
no errors；3/3 连跑逐位一致：

- 16 红 = 语义不匹配 2（ID_B+TEXT_A；ID_A+JSDoc 文本）+ 格式错误 12 形态（前缀大小写 ×3、
  `sc2-`、空 payload、51/53 字符、大写 payload、`=`、非法字符、内嵌空白、pad 位非零末字符）
  + 格式错独立形态 1（合法文本 + 一字改坏）+ code 稳定互异 1。失败断言全部为
  `expect(r.ok).toBe(false)`（期望 false 收到 ok:true——旧实现放行的直接观测）。
- 9 绿 = 参考件自检 3 + 旧式 id 兼容 2 + canonical 匹配正例 3（逐字/trivia/JSDoc 自洽）+ parse
  失败锚 1。

**文件 2（窄接口契约）**——`8 failed (8)`：当前导出缺失，每个用例在目标断言处失败
（typeof/调用 TypeError `deriveSchemaIdentity is not a function`、key-set/格式断言未达）；
文件内 fixture 自检（referenceFingerprint 等既有通道前提）全部先行通过（模块加载无异常）。
`tsc -p packages/vfsl/tsconfig.json` 恰 1 错：`TS2305: Module '.../index.js' has no exported
member 'deriveSchemaIdentity'`——类型层同点构造性红。

**绿灯可信度**：/tmp 未来绿灯模拟 28/28 PASS（§10.3）——按 H1 语义实现导出后文件 2 断言全部
成立；文件 1 的 9 绿当前即绿且断言内容 = 目标行为本身。

**回归面**：`packages/vfsl/test/` 全目录 = `2 failed | 28 passed (30 files)`，`24 failed |
557 passed (581 tests)`——24 红恰为本契约两文件，既有 557 绿零波及。

## 14. Runner trigger evidence

```text
$ pnpm install --prefer-offline                                   # 环境（本地 store）
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run \
    packages/vfsl/test/sc1-schema-id-envelope-validation.test.ts   # exit 1: 16 failed | 9 passed
$ NODE_OPTIONS=--conditions=nomicore-source node_modules/.bin/vitest run \
    packages/vfsl/test/sc1-derive-schema-identity.test.ts          # exit 1: 8 failed
$ ...vitest run <两文件路径>                                        # 2 failed files | 24 failed | 9 passed
$ ...vitest run packages/vfsl/test/                                # 既有 557 绿 + 24 红
$ node_modules/.bin/tsc -p packages/vfsl/tsconfig.json             # TS2305 ×1（窄接口导出缺失）
```

原始输出：`wiki/raw/task_issue-266_sa6_red.log`、`wiki/raw/task_issue-266_sa6_narrow_red.log`；
三连跑计数见 §8。root `pnpm test` 使用同一 vitest include（`--typecheck` 只查 *.test-d.ts，
本契约文件不受影响——vitest Type Errors 恒 no errors）。

## 15. Unknowns and blockers（设计自由度移交，均不阻塞放行）

1. **窄接口导出名/签名**（文件 2 头注 H1）：契约假设 `deriveSchemaIdentity(text: string) →
   {ok:true; semanticFingerprint; schemaId} | {ok:false; issues: VfslIssue[]}`（text-only =
   lang=vfsl/version=1 上下文常量的最窄读法）。若 SA1 裁决不同签名（如显式 lang/version 参数
   或不同命名），须回写文件 2 并走修订轮。
2. **两 issue code 具体编号**（ADR 0015「实施时按错误注册表分配」）：契约只锁稳定/互异/
   envelope 码空间/非既有码别名/前缀格式，不锁数字——任意未占用的注册表编号均通过。
3. **格式错与 parse 错并存的组合序**（malformed `sc1-` + 坏文本）：契约只分别锁「格式错 +
   合法文本 → 格式码」「canonical id + 坏文本 → 原生 parse issues」两端；组合序未锁（envelope
   相位先于 parse 的读法下格式码先出，属 SA1 裁决）。
4. **义务面边界**：`parseSchemaEnvelope`（H1）/`getCompiled` 对 `sc1-` id 是否也校验未锁
   （ADR「完整 envelope 编译」读法 = 仅 `compileSchemaEnvelope`；本契约不加锁，防过度约束）。
5. **末字符 ∈ {a,q}**：是 256-bit digest + pad 位为零（RFC 4648 §3.2）的数学推论，非独立
   设计条款；格式校验只须验 pad 位为零（N4 钉位 KAT 已含）。

## 16. Temporary diagnostics cleanup

- 诊断探针全部位于 `/tmp`（`sc1probe.ts`、`sc1sim.ts`、`base32probe.js`、py/js 对照文件），
  仓库零残留；无临时日志/probe 写入生产路径。
- 工作树最终 `git status`：仅新增 3 个测试/参考件 + 2 个日志 + 本报告（+ 派发前已存在的
  brief/门禁 untracked）；**零生产实现改动、零既有文件修改**。
- 无服务/后台进程需停止（全部前台同步命令；无 nohup/setsid/PID 文件）。
