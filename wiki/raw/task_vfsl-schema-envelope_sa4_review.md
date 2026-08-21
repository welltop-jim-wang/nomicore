# SA4 静态验尸报告 — parseSchemaEnvelope（Issue #52 / H1）

**Date**: 2026-08-21
**Verdict**: **reject**（单项缺陷 F1，局部修复即可；架构免复审）

**被审对象**：SA3 实现 commit `cb7a2c7`（`packages/vfsl/src/envelope.ts` 187 行新增、`packages/vfsl/src/index.ts` +34 行、`packages/vfsl/package.json` 版本 bump、SA6 测试文件随 commit）。
**对照基准**：SA1 设计 R2（`wiki/raw/task_vfsl-schema-envelope_design.md`，SA2 verdict pass）。
**审查方法**：静态代码审读 + 边界攻击脚本独立进程实跑取证（`/tmp/sa4-exploit-envelope.ts`，tsx，输出全文贴 §F1/§附）+ 全量绿灯独立复证。不依赖总控转述。

---

## 审核结论

1. **设计一致性**：⚠️ 一项危险偏离（F1，见下）；其余全部一致——envelope.ts 六个部件（EnvelopeErrCode / makeEnvelopeIssue+sanitizer / ENVELOPE_KEYS / validateEnvelopeShape / dialectIssueOrNull / envelopeCrashIssue / ParseSchemaEnvelopeResult）与设计 §2/§3/§4/§6 逐条对上；index.ts 编排与 §5 伪代码逐字同构（形状→方言→文本短路顺序、引用直通、顶层 catch）。良性偏离一处：**单读物化**（`src[key]` 首读值同时供校验与回显，设计 §3.4 伪代码为两次读取）——SA2 NOTE-a 建议，实装采纳并经 D1 实证（敌意 getter 恰被调用 1 次，回显与过门值一致），属 SA3 自由度内的改进，非危险简化。
2. **读写路径一致性**：✅ 一致。纯函数无持久化；唯一数据流 = 入参 → 返回值（envelope 重建恰四键 + module/issues 引用直通），无第二数据源。
3. **静默失败**：✅ 无（除 F1 的抛漏外）。五条失败通道（ENV-1/2/3/4/100 + VFSL-E 透传）全部 `{ok:false, issues}` 结构化返回；无「无请求 + 无状态 + 无反馈」路径。
4. **降级方案**：✅ 安全。唯一兜底 ENV-100 对齐 parseVfsl E100 先例，返回 ok:false 不伪装成功；无跨数据源降级。
5. **极端攻击**：❌ **发现 F1（REJECT 级）**——对抗 getter/Proxy 抛「不可字符串化的 thrown 值」时 `parseSchemaEnvelope` **外抛 TypeError**，击穿「不抛错」契约（详见 §F1）。其余 14 组边界向量全部按设计落地（§攻击矩阵）。
6. **错误处理**：❌ 缺口一处（即 F1）：顶层 catch 块内的 detail 计算（`envelopeCrashIssue` 的 `err instanceof Error ? err.message : String(err)`）自身可抛且无守卫——catch 块成为新的逃逸点。其余分支错误状态写入完整。
7. **架构评估**：✅ 可行。无需退回 SA1——缺陷是 envelopeCrashIssue 单函数实现缺口，设计承诺（「绝不外抛」）本身正确，不需要改设计。
8. **过度设计**：✅ 精简。187 行含大量注释（设计预估 ~120 行代码 + 注释）；无多余抽象层；单模块单职责，与变更半径匹配。

---

## §1.1 文件清单 Scope Creep Guard — ✅ PASS

- **ALLOW LIST 抽取**：设计 §12 存在（9 项 ALLOW + 完整 DENY）。
- **actual diff**（`git diff --name-only origin/phase-2-engine-gaps..HEAD`，11 文件）：
  - `packages/vfsl/src/envelope.ts` / `src/index.ts` / `package.json` / `test/parse-schema-envelope.test.ts` —— 4 个全部命中 ALLOW。
  - 7 个 `wiki/raw/task_vfsl-schema-envelope*.md` —— 其中 `_design_conflict_report.md`（SA8 设计复审档案）与 `_sa2_review.md` 未逐字列入 ALLOW §12，但命中白名单 `^wiki/raw/task_`（SA 流水线档案豁免），非 creep。
- **DENY LIST 全量核对**：`git diff --name-only origin/phase-2-engine-gaps..HEAD -- <十三内部件+tsconfig+vitest.config+lock+workflows+docs+CONTEXT.md+tests/>` → **空**（schemasource.ts 等零改动 ✓）。`package.json` 仅 `0.1.8 → 0.1.9` 单行 ✓。
- **BLACKLIST**：无 `TASK.md` / `package-lock.json` / `yarn.lock` / `*.bak` / `.DS_Store` 入 commit ✓。
- ⚠️ **Housekeeping（非违规，交总控）**：工作区有 staged 未 commit 的 `.mabf-bg/verify-sa3.log`（DENY LIST 明示 `.mabf-bg/` 不进分支 commit）——当前未 commit 故不构成违规，但 **PR 前必须 unstage**，否则触发 BLACKLIST 同类事故（PR #253 复盘）。

## §1.3 E2E spec runner 触发性 — N/A

本任务 diff 无 `*.spec.ts`（`grep -E '\.spec\.ts$'` 于 diff 文件清单 = 空）。

## §1.4 vitest 触发性自检 — ✅ PASS

- **本任务测试文件**：`packages/vfsl/test/parse-schema-envelope.test.ts`（新增 `.test.ts`，触发本门禁）。
- **所在 workspace package**：`@nomicore/vfsl`（`packages/vfsl/package.json`）。
- **CI 接线证据链**（静态 grep `.github/workflows/ci.yml`）：
  - `ci.yml:38-39` `Test` job → `pnpm test`；
  - 根 `package.json` scripts.test = `vitest run --typecheck`；
  - `vitest.config.ts` include = `packages/*/test/**/*.test.ts` —— **模式覆盖 `packages/vfsl/test/parse-schema-envelope.test.ts`**；
  - 另 `ci.yml:36` `pnpm typecheck` 含 `tsc -p packages/vfsl/tsconfig.json`（TS2724 自愈路径在 CI 亦有兜底）。
- **运行时佐证**（本会话全量亲跑）：汇总行亲见 `✓ packages/vfsl/test/parse-schema-envelope.test.ts (12 tests)`。
- **结论**：无 `vitest-package-not-triggered`；设计「零 CI 改动、经 vitest include 自动入列」声称成立（SA7 动态阶段请从 `gh run view --log` 摘录该文件的执行行）。

## §1.5 协议假设审查 — ✅ PASS

设计 §10 章节存在，七项假设均有依据类型标注。本会话独立复验关键三项：

| 设计假设 | SA4 复验结果 |
|---|---|
| BAD_TEXT → `VFSL-E100` @ line 3, column 7（AC4 锚） | ✅ 本会话 tsx 实跑逐字一致（`{"message":"VFSL-E100: 类型位置意外记号: 标点 ';'","line":3,"column":7}`，且与直调 parseVfsl 全等） |
| 全量基线 Test Files 31 / Tests 464 全绿 | ✅ 本会话独立复跑：`Test Files 31 passed (31)`、`Tests 464 passed (464)`、`Type Errors no errors`、exit 0（27.03s） |
| `pnpm typecheck` 0 错 | ✅ tsc 三包链无报错输出；vitest `--typecheck` 亦报 no errors |

无「应该/通常/预计」类裸推断；无 HTTP/WS/端口/进程类假设负担。

## §1.6 契约改动连锁审查 — ✅ N/A（纯增量）

index.ts diff 逐行核对：`parseVfsl` 函数体**零改动**（仅头部注释 + import + 追加导出与 `parseSchemaEnvelope` 本体）；无任何既有 export 的签名/返回/throw 行为变化。新导出 `parseSchemaEnvelope` 全仓 caller = 仅 SA6 测试文件（grep 亲证）。无 caller 迁移面。

## §1.7 源码 GREP 断言禁令 — ✅ PASS

`parse-schema-envelope.test.ts` 全文无 `readFileSync`；12 用例全部为经公共入口 `../src/index.js` 的运行时行为断言（返回形状 / message 正则 / 行列 / toEqual 透传对照），无源码字符串断言反模式。

---

## F1【REJECT】ENV-100 崩溃边界的 detail 计算自身可抛 → 「不抛错」契约被击穿

**位置**：`packages/vfsl/src/envelope.ts:179-182`

```ts
export function envelopeCrashIssue(err: unknown): VfslIssue {
  const detail = err instanceof Error ? err.message : String(err);   // ← 此行在 catch 块内执行，自身无守卫
  return makeEnvelopeIssue(EnvelopeErrCode.ENV_100, `内部错误（意外异常）: ${detail}`);
}
```

**机制**：`parseSchemaEnvelope` 顶层 catch 捕获敌意 getter / Proxy trap 抛出的任意值后调用 `envelopeCrashIssue(err)`。当 thrown 值**不可字符串化**时，`String(err)`（ToPrimitive → toString）在 **catch 块内部**二次抛出——该异常不再有任何外层守卫，直接逃逸出 `parseSchemaEnvelope`。

**被击穿的契约**（三处成文承诺）：

1. 任务简报 AC1：「同步、纯函数、**不抛错**（与既有接缝同款纪律）」——PRD #3 接缝纪律「错误经返回值传递」；
2. 设计 §5：「崩溃边界……→ 结构化 ENV-100，**绝不外抛**」；
3. 设计 §7 边界表：「getter/Proxy 抛异常的对抗对象 → 顶层 catch → ENV-100（**不外抛**）」。

**复现证据**（脚本 `/tmp/sa4-exploit-envelope.ts`，`pnpm exec tsx` 独立进程实跑，输出全文）：

```
=== A. 崩溃边界 meta-throw 向量（设计 §7 承诺：对抗 getter → ENV-100 不外抛） ===
[**THREW**] A1 getter throws Object.create(null) => TypeError: Cannot convert object to primitive value
[**THREW**] A2 getter throws {toString:42} => TypeError: Cannot convert object to primitive value
[NO-THROW] A3 getter throws Error subclass w/ throwing message getter => {"ok":false,"issues":[{"message":"VFSL-ENV-E100: 内部错误（意外异常）: x","line":0,"column":0}]}
[NO-THROW] A4 control: getter throws plain Error => {"ok":false,"issues":[{"message":"VFSL-ENV-E100: 内部错误（意外异常）: normal crash","line":0,"column":0}]}
[**THREW**] A5 Proxy hasOwn-trap throws Object.create(null) => TypeError: Cannot convert object to primitive value
```

三条向量（A1/A2/A5，含 `Object.hasOwn` 路径与属性读取路径两种注入点）均 **THREW**。最小复现：

```ts
const input = { get lang() { throw Object.create(null); }, version: 1, id: 'x', text: 'type ROOT = {};' };
parseSchemaEnvelope(input);   // → TypeError: Cannot convert object to primitive value（逃逸）
```

**补充向量（静态确认，同根因，未单测）**：① `Object.setPrototypeOf({ get message() { throw … } }, Error.prototype)` 使 `instanceof Error` 为真后读 `err.message` 抛；② Proxy 包裹 Error 且 `getPrototypeOf` trap 抛，使 `instanceof` 运算本身抛。注意 A3 显示**普通子类**安全（`super(message)` 建立的 own data property 遮蔽原型 getter）——向量的真实面是非 Error 不可字符串化 thrown 值 + 原型伪装。

**影响评估**：
- **当前面**：无生产 caller（仅 SA6 测试），12 用例不覆盖敌意 getter → 全绿不暴露；**总控亲跑绿灯为真但覆盖面有洞**。
- **落地面**：本接缝的立项定位就是 Phase 2 yjs-server / H3 DocScope 的引擎入口（设计 §1.1）。一个「绝不抛错」的公共接缝在对抗数据上外抛 TypeError，与 PR #255（auth 网络抖动 → 进程崩溃）同类风险形态：调用方按契约不设防，逃逸异常沿调用链上溯。未知/损坏信封正是本接缝设计上要接住的输入类别（loud-fail 只读立法的对象）。
- **非缺陷辩护不成立**：「parseVfsl E100 同款无守卫」是仓内既有形态，但 parseVfsl 入参是 `string`、内部 throw 恒为真实 Error，攻击者无法注入 thrown 值；本接缝入参 `unknown`，thrown 值本身攻击者可控——攻击面是本票**新增**的，且设计 §7 白纸黑字对本输入类别作出了「不外抛」承诺。SA2 R2 红灯思路用例 B（getter 抛含换行 Error → ENV-100 恒单行）检验的正是该边界的健壮性方向。

**修复方向（SA3，实现层 ~3 行，无需改设计）**：`envelopeCrashIssue` 内部把 detail 计算包进守卫，任何二次异常都降为确定性占位正文，仍经 `makeEnvelopeIssue`（单行 sanitizer 前置不变）：

```ts
function crashDetail(err: unknown): string {
  try {
    return err instanceof Error ? err.message : String(err);
  } catch {
    return `不可字符串化的异常值（${typeof err}）`;
  }
}
```

**回流目标**：
- **SA3**：修复 `envelope.ts` `envelopeCrashIssue`（上式或等价守卫）；修复后 12 存量用例必须保持全绿（本修复不触碰任何被测路径）。
- **SA6**：补 1 条红灯锚（对抗 getter 抛 `Object.create(null)` → 不抛 + `{ok:false}` + message `VFSL-ENV-E100` 前缀恒单行），把 F1 钉进回归面。
- **SA4 复审范围**：仅 F1 修复点 + 新增红灯锚，其余章节免复审。

---

## 边界攻击矩阵（除 F1 外全部通过，实跑证据）

| # | 向量 | 结果 | 设计锚点 |
|---|---|---|---|
| B1 | hostile `lang="x\nVFSL-E999: …"` 伪造文本通道行 | ✅ ENV-4 拒绝；joined `/^VFSL-E\d+:/m` 检出 **false**；无真实行终止符；哨兵 0/0；lang 以 `\n` 可见转义呈现 | §2.1/§4（R2 #1 落地实证） |
| B2 | CRLF（`x\r\nVFSL-E100: fake`） | ✅ 忠实转义 `\r\n`，恒单行 | §2.1 逐字符类定稿 |
| B3 | ENV-100 多行 `err.message`（`boom\nVFSL-E9: forged`） | ✅ 单行化 `boom\nVFSL-E9: forged`，`/m` 检出 false | §6.1 |
| C1 | 空对象 | ✅ ENV-2 单条四键列全 | §3.2 |
| C2 | 缺 lang + version:'1' | ✅ ENV-2 + ENV-3 双条并行全收集 | §3.2 |
| C3 | `Object.create(四键原型)` | ✅ ENV-2 拒绝（own-key 不命中，不静默半份解释） | §3.3 |
| C4 | `Object.create(null)` 四自有键 | ✅ 接受（合法物化形态） | §3.3 |
| C5 | `new String('vfsl')` 包装对象 | ✅ ENV-3（typeof object） | §3.2 |
| C6 | `version: NaN` | ✅ 形状过 → ENV-4（typeof 门/方言域分界线正确） | §3.2 |
| C7 | `text: ''` | ✅ 信封层放行 → 透传 E310 @ 1:1 | §3.2/§7 |
| C8 | symbol 多余键 | ✅ ok:true；回显恰四键（keys=[lang,version,id,text]，symbols=0） | §3.4 |
| D1 | 敌意 getter 首读 'vfsl' 次读 42 | ✅ 恰调用 1 次；首读值过门且回显一致（单读物化） | SA2 NOTE-a |
| D2 | 同输入双调用 | ✅ 结构全等（纯度） | §7 |
| E1 | BAD_TEXT 透传 | ✅ 与直调 parseVfsl issues 全等；line 3 / column 7；`^VFSL-E\d+:` 前缀保留 | AC4/AC6 |

码空间判别抽查：ENV 消息一律 `VFSL-ENV-E<码>:`（`E` 后随 `N` 非 digit），`/^VFSL-E\d+:/` 恒不匹配；透传通道 VFSL-E 前缀原样——两通道并存可区分（AC6）✓。

---

## 验证证据（SA4 本会话独立实跑）

| 命令 | 结果 |
|---|---|
| `pnpm test`（独立进程 setsid nohup） | `Test Files 31 passed (31)` / `Tests 464 passed (464)` / `Type Errors no errors` / exit 0——与设计 §8.4 SA4 字面对照口径（31/464）逐字一致 |
| `pnpm typecheck`（同上链内） | 三包 tsc 链零报错输出 |
| `pnpm exec tsx /tmp/sa4-exploit-envelope.ts`（独立进程） | 输出全文贴 §F1 与矩阵；exit 0（A1/A2/A5 三条 THREW 为逃逸证据，脚本自身捕获记录） |
| `git diff --name-only origin/phase-2-engine-gaps..HEAD` | 11 文件，全部落 ALLOW + wiki 白名单；DENY/BLACKLIST 零命中 |
| `grep -rn parseSchemaEnvelope packages/ domains/` | caller 仅 SA6 测试文件 |

## 动态审核重点（交 SA7）

1. **F1 修复后回归**（前置：SA3 修复 + SA6 补锚）：对抗 getter / Proxy trap 抛 `Object.create(null)`、`{toString:42}`、原型伪装 Error —— 断言不抛 + ENV-100 结构化 + message 恒单行。修复未落地前本项为 REJECT 依据，SA7 不应在该状态下放行。
2. **CI 触发证据**：从 `gh run view --log` 摘录 `parse-schema-envelope.test.ts (12 tests)` 执行行（§1.4 静态接线的动态确认）。
3. **超长 text 透传冒烟**：本接缝对合法信封的超长 text 零新增预算点（设计 §7「资源」行），抽一个数 MB 级 text 走 parseSchemaEnvelope 确认仍受 parseVfsl 既有三层防护约束、ENV 侧无额外内存放大（引用直通不拷贝，预期无问题）。

---

## 结论

SA3 实现质量总体高：设计十二用例机制映射逐条兑现、R2 #1 单行 sanitizer 与伪造向量消除实测成立、边界矩阵 14/15 组按设计落地、scope 干净、CI 接线自动成立、全量 31/464 独立复绿。**唯一但必须修复的缺陷 F1**：ENV-100 崩溃边界的 detail 计算在 catch 块内二次可抛，使「绝不外抛」的成文承诺在对抗输入上失效——这正是本接缝被立项来接住的输入类别，且修复成本 ~3 行。**Verdict: reject**——SA3 修复 `envelopeCrashIssue` 守卫 + SA6 补 1 条对抗红灯锚后，SA4 仅就该点复审。
