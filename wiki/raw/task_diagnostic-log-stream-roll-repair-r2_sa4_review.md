# SA4 静态验尸报告 — Issue #153 Round 2（T=0 收敛：无引用完整 orphan BIN 尾帧清零）

**Date**: 2026-08-30
**Reviewer**: SA4（Red Team）
**审查范围**: diff `51b79b9..a2cf3a5`（R2 修复 commit a2cf3a5）
**输入**: 修订简报 `…-r2.md` / SA8 R2 门禁 `…-r2_conflict_report.md`（clear + O1 纪律）/ SA6 R2 红灯报告 `…-r2_sa6_red.md`（6 锚）
**Verdict**: **pass**（七项重点复核全过；round-1 偏差链闭合、LOW-1 零字节事件结构性消除）

---

## 0. 审查方法与独立证据

- 三份输入文档全量通读后按总控七项重点逐项验尸；round-1 档案（设计 §5.2/§5.4、SA4 round-1 报告 LOW-1）作对照基线。
- 独立复跑包级测试（setsid 独立进程）：`node_modules/.bin/vitest run packages/namespace-diagnostic-log/test` →
  **Test Files 22 passed (22)；Tests 381 passed (381)；Type Errors: no errors；exit=0**（`/tmp/sa4-r2-pkg.log`）——与总控亲验（22 文件/381 测试）一致。
- `git diff --check 51b79b9..a2cf3a5` 干净；`tsc -p packages/namespace-diagnostic-log/tsconfig.json --noEmit` exit=0。
- 红灯基线自洽性核对：51b79b9 态 379 测试（round-1 375 + SA7 repair-io 补验 4）→ SA6 R2 +2 新锚（§13.11b/c）= 381；红态 6 failed | 375 passed 与「6 锚重写/新增、存量零回退」账目吻合。

## 一. 七项重点复核

### ① T=0 收敛对设计 §5.2/§5.4 字面的忠实性 — ✅ PASS

修复后代码（`reader.ts:1063-1077`）：

```ts
// C2/C3（§5.2/§5.4：T = max ref end；Refs 为空 → T=0——完整未引用尾帧全量截断）
let t = 0
for (const ref of refsToSegMax) if (ref.end > t) t = ref.end
```

- 与设计 §5.4 伪代码首行 `T = max(end for (off,end) in Refs) if Refs 非空 else 0`（design L234）及 §5.2 判定式（L224「Refs 为空 → T=0」）**逐字同义**：Refs 空 → `t` 保持 0，`[T,|B|)` = 整个 bin。
- **行走语义零变化**：`walkBinTail` 在本 diff 中未被触碰（四态返回 `'complete' | 'incomplete' | 'unknown-magic' | 'unknown-frame'`，帧头偏移 4/5/6/7-8/17-20 与 storage-gate 同源——与 round-1 比对一致）。
- **事件 kind 映射零变化**：`unknown-magic → rotate stream-corrupt`、`unknown-frame → rotate stream-incompatible`、`'incomplete' → bin-incomplete-frame`（终局证据优先）、`'complete' → bin-orphan-frames`，两 repairs 的 `truncateToBytes` 恒为 `t`——与设计 §5.4 walk + §5.1 C2/C3 动作列完全一致。
- **Refs 非空分支不受影响**（§13.8a/b、§13.9、§13.10 存量锚全绿实证）；refs 空 + 非完整前缀场景（§13.12 十字节垃圾尾、窗口2）在旧实现下 `walkCompletePrefixEnd` 本就返回 0，收敛后结果恒等——零涟漪，存量绿。

### ② walkCompletePrefixEnd 死码零残留 — ✅ PASS

- 函数体 + JSDoc（21 行块）整体删除；例外分支及其「§13.11 契约面」注释（4 行）整体删除——diff 逐行核对无部分残片。
- 全仓 grep（src/test/docs，排除 wiki 档案）：**唯一命中**为 `file-adapter-reopen-roll-repair.test.ts:444` 的重锚注释「废止 round-1『walkCompletePrefixEnd 例外』对 §13.11 的固化」——该句是对锚纠错缘由的历史性说明（明确表述**废止**），非死码、非偏差背书残留，属合理锚注。`src/` 内零残留（`前缀边界|完整帧前缀|§13.11 契约面|未引用完整帧保留` 四模式全零命中）。
- 无其他调用点（删除后 `tsc --noEmit` 0 错误即未定义引用零存在的编译级证明）。

### ③ 修复事件诚实性的结构保证 — ✅ PASS（两侧结构性证明）

**bin 侧**：repair 仅在守卫 `bin !== null && bin.byteLength > t` 内 push（行走与 push 同处单一条件块）⇒ `truncatedBytes = bin.byteLength - t` **严格大于 0**——结构成立，不依赖运行期检查。round-1 的 `truncatedBytes:0` 事件源（refs 空 + 全完整帧时 `t` 被推至 `|B|`）随例外分支删除而不可达。

**C1 侧**：repair 仅在 `segmentUnterminated.has(segMax)` 时 push；该集合仅当 `jbuf !== null && jbuf.byteLength > 0 && jbuf[jbuf.byteLength-1] !== 0x0a` 时加入。未终止 ⇒ 末字节 ≠ 0x0A ⇒ `lastNl ≤ byteLength-2` ⇒ `truncateToBytes = lastNl+1 ≤ byteLength-1` ⇒ `truncatedBytes ≥ 1`——结构成立。

**全局性**：`grep repairs.push` 恰两处（reader.ts:1055 C1、:1072 C2/C3），无其他 repair 生产者；`file.ts` `applyRepairs` 对每条 repair 无条件发事件——两生产点结构保证 ⇒「每个 `stream-tail-repaired` 事件 `truncatedBytes > 0`」全路径成立。测试侧以负向断言钉死（§13.11/§13.11c `repaired.every(e => e.truncatedBytes > 0)`）。

### ④ 新注释与设计明文的逐字一致性 — ✅ PASS

- 新注释「§5.2/§5.4：T = max ref end；Refs 为空 → T=0——完整未引用尾帧全量截断」对设计 L224/L234 明文的转写忠实（判定式、Refs 空特例、全截语义三要素齐备，无引入新语义）。
- README/AGENTS 偏差同源表述核查（简报范围 3）：零残留——README 唯一「零字节」命中（:109）是 #152 提交点纪律的「definitive 失败零字节可证明」既有用语，与本偏差无关；AGENTS「未引用尾 orphan frames」泛化措辞与 T=0 全截同向（SA8 门禁证据 #6 同判）。设计文档/ADR 零触碰（正确——本轮是实现向设计收敛）。

### ⑤ 版本 bump 0.1.3 → 0.1.4 — ✅ PASS（硬门禁 9）

`package.json` diff 逐字核对。

### ⑥ ALLOW/DENY 边界 — ✅ PASS

- R2 非 wiki 面 = 恰 3 文件：`src/reader.ts` + `test/file-adapter-reopen-roll-repair.test.ts` + `package.json`——全部在 round-1 设计 §16 ALLOW LIST 内（reader.ts 修改 / 该测试文件 SA6 owned / 版本 bump），无越界。
- **零设计文档/ADR/CONTEXT.md 改动**（`git diff --name-only | grep -E "docs/|CONTEXT.md"` 空）；**零冻结面触碰**（record/schema/vocabulary/pipeline/emission/sink/memory/frame/storage-gate/carrier/crc32c/canonical-json/digest/schema-patterns/index/testing 全未动）；**零其他 src 涟漪**（file.ts/paths.ts/health.ts 未动——修复面精确收敛于 reader.ts 单点，符合「最小变更」）。
- wiki 面 6 件（r2 简报/门禁/dispatch/相关决议/红灯报告 + round-1 简报 Round-2 附记）——SA 流水线档案白名单豁免；round-1 简报附记核对为纯档案性记录（红灯证据/锚清单），无代码语义。

### ⑦ 1.4 vitest 触发性自检 — ✅ PASS

- 本轮唯一测试文件改动 `packages/namespace-diagnostic-log/test/file-adapter-reopen-roll-repair.test.ts` 落在根 `vitest.config.ts` include `packages/*/test/**/*.test.ts` 内；CI（`.github/workflows/ci.yml` "Test" step）执行 `pnpm test` = `vitest run --typecheck` 全覆盖；"Typecheck" step 含本包 tsconfig。无 CI 黑洞。测试文件未增删（52 用例所在文件既有），无 `scripts/test-lock.sh` 依赖面变化。

## 二. O1 纪律与反馈建议落实核验

| 项 | 落实证据 | 判定 |
|---|---|---|
| 反馈建议 ①（删例外保持 T=0） | 例外分支整体删除，`t` 计算即设计字面 | ✅ |
| 反馈建议 ②（完整 orphan 后缀全部截断） | Refs 空 → T=0 → `[0,\|B\|)` 全截；§13.11/§13.11c/窗口1/窗口3/§13.32c 断言 bin 长度 0 | ✅ |
| 反馈建议 ③（测试断言修复后 BIN 实际长度 0） | 六锚全部补 `binPath.byteLength === 0` | ✅ |
| 反馈建议 ④（修复后 sidecar `frameOffset="0"` + strict ok） | §13.11b/§13.11c 两锚：`carrier2.frameOffset === '0'` + `readStreamStrict.status === 'ok'` | ✅ |
| 反馈建议 ⑤（共享原语抽取，非必须） | 未做——范围纪律正确（简报明确排除） | ✅ |
| **O1：不补「防 frame-boundary-invalid」伪需求断言** | §13.11b/11c 注释按勘误口径引「首引用 expectedOffset=null 跳过边界检查（storage-gate.ts:88）系既定链语义」，断言面仅 frameOffset/reader ok——零伪需求断言 | ✅ |
| round-1 LOW-1（零字节事件备案）作废 | SA8 O2 预判成立：结构性保证（③）+ 负向断言双落地 | ✅ |
| round-1 SA4 偏差裁定被推翻的处置 | 本轮 SA4 确认：owner 裁决以设计字面为准正确；round-1 裁定的六条依据中「契约面已由 SA6 红灯锚钉死」一条的权重判断失误（锚本身编码偏差时锚不应高于设计明文）——已随本轮锚纠错消解，无遗留张力 | ✅ 记档 |

## 三. 附加攻击面（本轮新改动面）

- **无契约改动**：R2 diff 不触碰任何函数签名/throw/return 契约；`analyzeStreamForResume` 返回形状、`readStreamStrict`、健康事件形状全部不变（§1.6 联动核验零触发项）。
- **无静默失败新路径**：删除的分支原本产出的唯一可观察效果（零字节事件）已被更强的真实截断事件取代。
- **无过度设计**：净 -30/+27 src 行（纯删除 + 单行注释），最小变更收敛。
- **D-A1「首引用前 orphan」语义未被误伤**：refs 非空时 orphan 位于 T 之前不属截断范围（§5.1 后缀性质），`file-adapter-sa7-dynamic.test.ts` D-A1-续 存量锚全绿实证。

## 四. 动态审核重点（交 SA7）

1. **AC3/AC1 重新实证**：真实重启（非写盘模拟）下 refs 空完整 orphan 尾帧的 T=0 全截 + 修复后首条 sidecar `frameOffset="0"` + strict reader ok（对应 §13.11b/c 的运行时面）。
2. **全仓 `pnpm test`（140 文件/1784+2 测试）与 `pnpm typecheck` 在 CI 环境复绿零回退**（本 SA4 已独立复跑包级 381/381；全仓面交 SA7/CI 日志）。
3. round-1 遗留动态项中与 tail 修复语义相关的复核（kill -9 真实崩溃窗口）在 T=0 收敛后的终态一致性。

## 五. 结论

**Verdict: pass**

- R2 修复是对设计 §5.2/§5.4 字面的精确收敛：例外分支与死码（含 JSDoc/注释）零残留，行走与事件 kind 映射零变化，修复事件诚实性获得两侧结构性证明并被负向断言钉死。
- 版本 bump、ALLOW/DENY 边界、vitest 触发性、O1 纪律、反馈建议 ①–④ 全部落实；⑤ 正确不做。
- 独立复验：包级 381/381 绿、typecheck 0 错、`git diff --check` 干净。
- SA7 可进入动态验证（重点见 §四）。
