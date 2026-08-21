# SA4 静态验尸报告 — parseSchemaEnvelope（Issue #52 / H1）

**Date**: 2026-08-21（R1 首轮）；同日 R2 复审（追加节见文末）
**Verdict（当前，R2）**: **pass**
**Verdict（R1 历史）**: reject（单项缺陷 F1——ENV-100 崩溃边界 detail 计算在 catch 内二次可抛；已由 SA3 commit `14f56f0` 修复 + SA6 第 13 条回归锚钉死，R2 复审通过，见文末 R2 节）

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

---
---

# R2 复审（2026-08-21）

**Verdict: pass**

**被审对象**：SA3 F1 修复 commit `14f56f0`（`envelope.ts` `crashDetail` 守卫 + SA6 追加 F1 回归锚）。复审范围按 R1 既定：仅 F1 修复点 + SA6 红灯锚；R1 其余章节结论维持不变。
**复审方法**：不采信总控转述——修复 diff 逐行核对 + 穷尽攻击向量独立进程实跑（`/tmp/sa4-r2-f1-reverify.ts`，tsx，含 R1 全部实锤/理论向量 + 新增向量，13/13）+ 全量 typecheck/vitest 独立复跑。

## 1. 修复点核验 — ✅ 通过

`envelope.ts` diff 逐行核对：`envelopeCrashIssue` 的 detail 计算拆为模块内部 `crashDetail(err)`，原表达式（`err instanceof Error ? err.message : String(err)`）整体包进 try/catch，二次异常降为确定性占位正文 `不可字符串化的异常值（${typeof err}）`，仍经 `makeEnvelopeIssue`（唯一构造点 + 单行 sanitizer，链路不变）。静态审查确认：

- **守卫覆盖完备**：`instanceof`（V6：Proxy getPrototypeOf trap 使运算自身抛）、`err.message`（V5：原型伪装 Error 的 message getter 抛）、`String(err)`（V1/V2/V3/V4/V7：ToPrimitive 全路径）三步任一抛出均被捕获；
- **占位正文自身不可抛**：`typeof err` 恒不抛（非属性访问），模板无动态值注入，sanitizer 对其幂等（无行终止符）；
- **不吞正常路径**（P2）：普通 Error 的原 message 保留；原始值 thrown（V8：string）经 `String()` 直通保留；
- **修复半径**：仅 `envelope.ts` 单函数 +22 行（含注释），`makeEnvelopeIssue`/sanitizer/形状校验/方言路由/编排零触碰。

## 2. 穷尽攻击向量复验 — ✅ 13/13 全过（独立进程实跑）

| 向量 | 来源 | 结果 |
|---|---|---|
| V1 getter 抛 `Object.create(null)` | R1 实锤 A1 | PASS：不抛 + `VFSL-ENV-E100:` @ 0/0 恒单行 |
| V2 getter 抛 `{toString:42}` | R1 实锤 A2 | PASS |
| V3 Proxy `getOwnPropertyDescriptor` trap 抛（`Object.hasOwn` 注入点） | R1 实锤 A5 | PASS |
| V4 Proxy `get` trap 抛（属性读取注入点） | SA6 锚第三向量同源 | PASS |
| V5 原型伪装 Error + throwing message getter | R1 理论向量① | PASS（instanceof 真 → message getter 抛 → 守卫收编） |
| V6 Proxy 包裹 Error + `getPrototypeOf` trap 抛（instanceof 自身抛） | R1 理论向量② | PASS |
| V7 `Symbol.toPrimitive` 抛 | **R2 新增向量** | PASS |
| V8 thrown string 原始值 | 对照 | PASS（detail 直通不丢） |
| P1–P3 占位正文结构性质 / 普通 Error 不误吞 / 多行 err.message 仍单行化 | 对照（R1 A4/B3 不回归） | PASS |
| S1/S2 hostile lang 伪造单行化 / 合法信封恰四键回显 | R1 B1/C8/D2 抽复验 | PASS |

占位正文实测形态（P1，结构性质断言、不锁定措辞）：`VFSL-ENV-E100: 内部错误（意外异常）: 不可字符串化的异常值（object）`。

## 3. SA6 第 13 条回归锚核验 — ✅ 通过

- **断言质量**：全部为经公共入口 `../src/index.js` 的运行时行为断言（`not.toThrow` + `ok:false` + `^VFSL-ENV-E100:` 前缀 + `not.toMatch(/^VFSL-E\d+:/)` + 哨兵 0/0 + 无换行）；无源码 grep 断言反模式（§1.7 禁令合规）；未锁定兜底正文措辞（锚契约不锚实现，允许后续演化）✓；
- **向量覆盖**：getter 抛 `Object.create(null)` / `{toString:42}` / Proxy get trap 三向量，与 R1 §F1 复现证据同源 ✓；
- **红灯真实性有据**：任务简报 SA6 追加节记录修复前实跑 `Tests 1 failed | 12 passed (13)`，失败根因 `TypeError: Cannot convert object to primitive value` 与 R1 §F1 取证逐字一致——修复前必红、修复后转绿，锚有判别力 ✓；
- **原 12 用例零触碰**：`git diff cb7a2c7..14f56f0` 测试文件删除行仅为过时头注释叙事（「当前状态」段落），断言逻辑零改动——SA6 owned 纪律（ALLOW LIST「断言逻辑禁改」）合规 ✓。

## 4. Scope / 存量复验 — ✅ 通过

- `14f56f0` 触界：`envelope.ts`（ALLOW）+ 测试文件（SA6 回流授权）+ 4 个 wiki 档案（白名单）；DENY/BLACKLIST 零命中；全分支 vs base 的 DENY 复核仍为空；
- R1 Housekeeping 项已解决：`.mabf-bg/verify-sa3.log` 不再 staged（当前 git status 仅 dispatch.md 修改，白名单内）✓；
- 全量独立复跑：`pnpm typecheck` → TYPECHECK_OK（0 错）；`pnpm test` → **Test Files 31 passed (31) / Tests 465 passed (465) / Type Errors no errors / exit 0**，汇总行亲见 `parse-schema-envelope.test.ts (13 tests)` 执行——R1 基线 464 + 1 新锚，存量零回归 ✓。

## 5. 动态审核重点（交 SA7，R2 修订）

R1 三条中第 1 条（F1 修复后回归）静态+实跑双确认已闭环，**从 SA7 清单撤销**；保留：

1. **CI 触发证据**：从 `gh run view --log` 摘录 `parse-schema-envelope.test.ts (13 tests)` 执行行（§1.4 静态接线的动态确认）；
2. **超长 text 透传冒烟**：合法信封数 MB 级 text 走 parseSchemaEnvelope，确认仍受 parseVfsl 既有三层防护约束、ENV 侧引用直通无额外内存放大。

## R2 结论

**Verdict: pass。** F1 修复与 R1 处方逐字对应且经穷尽向量实跑验证（含 R1 全部理论向量与新增 Symbol.toPrimitive 向量，13/13）；守卫不吞正常路径、不触碰既有通道；SA6 回归锚断言质量合规且修复前红灯有据；scope 干净、全量 31/465 独立复绿零回归。R1 其余章节（设计一致性、Scope Guard、§1.4 vitest 触发性、协议假设、码空间判别、边界矩阵、过度设计）结论维持。**SA7 可进入动态验证**（清单见 §5，两条）。
