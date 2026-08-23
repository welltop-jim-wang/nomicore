# SA7 动态验证报告 — materializeRoot 修订轮 rev2（commit fdcf757 + SA6 测试两文件）

**Date**: 2026-08-23
**Verdict**: pass

- 验证对象：commit `fdcf757`（SA3 实现：materialize.ts ⓪ guard + ⑥ verifySnapshotIntact / xml-parse.ts canonicalXmlOf / index.ts 导出 / package.json 0.1.5）+ SA6 测试两文件（工作区暂存：`materialize-root.test.ts` 60 用例改动 + `materialize-root-rev2.test.ts` 23 用例新增）
- 前置：SA4 静态验尸 pass（`task_doc-runtime-materialize-root-rev2_sa4_review.md`，5 项动态审核重点已逐条验证，见 §5）
- 环境：本机 Node v24.13.0 / yjs 实装 13.6.32（声明 ^13.6.30）/ Linux 6.8.0；全部命令后台独立进程（`setsid nohup`）或一次性 `tsx` 进程执行
- 测试执行规范合规：全量 vitest/typecheck 双轮均后台独立进程（日志 `/tmp/sa7-round1.log`、`/tmp/sa7-round2.log`）；无端口占用型服务，未动 `fuser`

---

## Step 0 — SA4 verdict 校对

SA4 报告顶部（第 4 行）：**`Verdict: pass`** → SA7 进入动态验证（不上发不下发规则遵守：本报告仅在 SA4 pass 基础上给出独立结论）。

## Step 1 — SA6 红灯测试（绿灯确认）

两份测试文件在全量运行中全绿（见 §1 摘录行）：`materialize-root.test.ts`（60）+ `materialize-root-rev2.test.ts`（23）= **83/83 passed**。SA6 锚定的 15 红用例全部转绿、8 对照/诚实用例保持绿——与 SA4 静态结论一致，无需打回。

---

## 1. 必做 #1 — 全量 vitest + typecheck（后台独立进程，双轮）

命令（两轮同命令）：`pnpm typecheck && node_modules/.bin/vitest run --typecheck`

| 轮次 | typecheck | Test Files | Tests | Type Errors | vitest exit |
|---|---|---|---|---|---|
| Round 1 | **exit 0**（6 包全量） | **65 passed (65)** | **927 passed (927)** | **no errors** | **0** |
| Round 2 | **exit 0** | **65 passed (65)** | **927 passed (927)** | **no errors** | **0** |

摘要行原文（两轮逐字一致，仅 Duration 84.07s / 83.96s 差异）：

```
===typecheck-exit=0
 Test Files  65 passed (65)
      Tests  927 passed (927)
Type Errors  no errors
===vitest-exit=0
```

## 2. 必做 #2 — Hard Gate #14 vitest 触发证据（本地替代版）

> **CI 证据状态注明**：本轮 push 前无 CI run——按总控指示，本段以**本地 vitest 触发证据**替代；CI run 日志中的动态触发证据（「Test」job 对两文件的执行行 + 门禁步骤绿）**待 push 后由 runner 核验**。CI 通道的静态面已由 SA4 核查（`ci.yml`「Test」job `pnpm test` = `vitest run --typecheck`，include glob `packages/*/test/**/*.test.ts` 覆盖两文件；专项存在性门禁锚定 materialize-root.test.ts）。

全量运行中两文件的实际执行行（Round 1 / Round 2 逐字一致）：

```
 ✓ packages/doc-runtime/test/materialize-root-rev2.test.ts (23 tests) 78ms   ← Round 1（Round 2: 80ms）
 ✓ packages/doc-runtime/test/materialize-root.test.ts (60 tests) 59ms       ← Round 1（Round 2: 63ms）
```

**23 + 60 = 83 ✓** 与简报 SA6 锚定数吻合，两文件均在 vitest 运行范围内触发且全绿。

CI「Materialize root tests」门禁命令本地复跑（同一命令原样）：

```
$ node_modules/.bin/vitest run packages/doc-runtime/test/materialize-root.test.ts --typecheck --passWithNoTests=false
 ✓ packages/doc-runtime/test/materialize-root.test.ts (60 tests) 59ms
 Test Files  1 passed (1)
      Tests  60 passed (60)
Type Errors  no errors          → exit 0
```

| 测试文件 | 触发结果 | 证据 |
|---|---|---|
| packages/doc-runtime/test/materialize-root.test.ts | ✓ 60 tests passed（全量 + 门禁命令双绿） | 上述执行行 |
| packages/doc-runtime/test/materialize-root-rev2.test.ts | ✓ 23 tests passed（全量 glob 触发） | 上述执行行 |

**本地判定：✅ all-vitest-packages-triggered（本地证据）；CI 动态证据待 push 后 runner 核验。**

## 3. 必做 #3 — 活链路攻击复跑（独立进程，不走测试框架）

脚本：`.mabf/sa7-attack/live-attack.mts`（`node_modules/.bin/tsx` 独立进程，黑盒断言：错误码/变体文本锚/零写入双证，不读源码）。结果：**47 passed / 0 failed，exit 0**；同命令第二轮复跑 **47/0 逐项一致**。

| # | 攻击/场景 | 预期 | 实测 | 关键证据摘录 |
|---|---|---|---|---|
| a | 外层 `doc.transact` 内调用（P1 主向量） | throw E202-A + 零写入 | ✅ 7/7 | `DOCRT-E202: 在未闭合的外层 doc.transact 内调用…（运行时检测：doc._transaction 非空）`；0 update、state/vector 逐字节不变、ROOT 空置、删改 observer 未触发 |
| b | observer 回调内调用（窗口 B，观察 OTHER map） | throw E202-B + 零写入 | ✅ 6/6 | `DOCRT-E202: 在 Yjs 事务 cleanup/observer 派发期间调用…`（「派发期间」锚）；state 跨调用逐字节不变、update 计数不增、ROOT 空置 |
| c1 | observer 嵌套 Y.Map 就地 `u.set('n',2)`（顶层引用不变） | E201-C | ✅ 4/4 | `DOCRT-E201: ROOT 逻辑快照安装后语义校验偏离：键 "n" 读回 2 与对照安装读回 1 不等价（ROOT.u.n）`——⑤ 过（顶层 identity 未动）、⑥ 抓 |
| c2 | 嵌套 Y.Array `tags.insert(1,['z'])` | E201-C | ✅ 4/4 | `…键 "tags" 读回 ["a","z","b"] 与对照安装读回 ["a",…]`（顺序敏感逐元素） |
| c3 | 嵌套 Y.XmlFragment `body.insert` 追加 | E201-C | ✅ 4/4 | `…键 "body" 读回 "<p>x</p>HACKED" 与对照安装读回 "<…`（canonical 面） |
| d1 | D1 删宽成员声明键 `u.delete('k')`（前置 ① validate ok） | E201-C（键集支） | ✅ 4/4 | `…键 "u" 读回键集 ["x"] 与对照安装读回键集 ["x","k"] 不等…` |
| d2 | D2 判别联合经 ref `asset.delete('body')` | E201-C | ✅ 2/2 | `…键 "asset" 读回键集 ["kind"] 与对照安装读回键集 ["kind","body"]…` |
| e1 | 诚实路径（map/array/leaf 混合） | ok:true + extract ≡ 输入 | ✅ 4/4 | `{"ok":true}`、单 update（单事务）、读回 `{"title":"t","count":7,"tags":["a","b"],"u":{"n":1}}` 深度相等 |
| e2 | 诚实重叠联合（宽窄成员） | ok:true + 读回 ≡ 输入 | ✅ 3/3 | 读回 `{"u":{"x":1,"k":2}}`（宽成员仲裁，无假阳性拒绝） |
| e3 | 诚实 XML | ok:true + 读回语义等价 | ✅ 2/2 | body 读回 `'<p>hello</p>'` |
| f | 极深树（20 000 层 XML） | E200 + 零写入 | ✅ 7/7 | 前置 ① validate ok（触发点确在 ② 装配支路）；返回 `{"ok":false,"issues":[{"message":"DOCRT-E200: materialize 内部错误（意外异常）: Maximum call stack size exceeded","path":[]}]}` 恰 1 issue；0 update、state/vector 不变、ROOT 空置 |

结论：**owner P1 假成功链在活链路上被 ⓪ 写前拦截（A/B 两窗口）；Medium 三形态嵌套修改与删除向量被 ⑥ 对称重物化捕获（变体 C，⑤ 空转路径封堵）；诚实路径零假阳性；E200 崩溃边界零写入。**

## 4. 必做 #4 — SA2/SA1 探针抽样重跑（§9.5 十七场景 + r3-optionb-verify）

留存探针原样复跑 + SA7 适配重跑（适配原因：两探针均写于 rev2 实现**之前**，其场景跑批假设 materializeRoot 不 throw——新实现下攻击场景由生产 ⑥ 在 `materializeRoot` 调用内直接 throw DOCRT-E201，先于探针自身比较器仿真执行。适配重跑仅加逐场景 try/catch：攻击场景判「生产⑥ 拦截」为 ✓（更强证据），诚实场景保持原判（不得 throw + ok:true + 探针比较器 equal）；**场景表与比较器零改动**，留存原件未动）：

| 探针 | 原样复跑 | 适配重跑（`/tmp/sa7-attacks.log`） | 第二轮 |
|---|---|---|---|
| `.mabf/sa1/r4-optionb-probe.ts`（设计 §9.5 十七场景仿真） | 4 诚实场景全 `equal ✓` 后，第 5 场景（RT-1.4 攻击）进程终止于**生产 E201-C uncaught throw**（`materialize.ts:109 materializeRoot → :288 verifySnapshotIntact`）——生产检测先于探针比较器生效的直接证据 | **17/17 全对**：诚实 10 全 `equal ✓`（探针 productEqual 比较器在新实现诚实路径上判等）+ 攻击 7 全 `生产⑥ E201-C throw ✓`（RT-1.4 值改 / Shape A·B 值改 / Shape C 判别联合 body 篡改 / D1·D2 删除 / 插入翻转） | 17/17 一致 |
| `.mabf/sa2-attack/r3-optionb-verify.mts`（SA2 方案 b 十五场景） | 4 诚实场景全 `equal ✓` 后，第 5 场景（RT-1.4 攻击）同样终止于生产 E201-C throw | **15/15 全对**：诚实 8 `equal ✓`（含 optionB 双侧 extract 比较）+ 攻击 7 `生产⑥ E201 throw ✓` | 15/15 一致 |

核对结论：**§9.5 十七场景（诚实 10 equal / 攻击 7 diff）与 SA2 十五场景的判据预期，在 rev2 实现上以「生产 ⑥ 直接拦截（攻击）+ 探针比较器判等（诚实）」的双层形式全部兑现，无一 MISMATCH、无一诚实误拒。**

## 5. SA4「动态审核重点」五项逐条验证

| # | SA4 交办 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | CI 触发证据（Test job 执行行 + 门禁步骤绿） | 本轮 push 前无 CI run → 本地替代证据（§2：全量 83/83 触发行 + 门禁命令本地 60/60 exit 0）；CI 动态证据待 push 后 runner 核验（报告注明） | ✅ 本地面；CI 面 deferred |
| 2 | RT-2 窗口 B / afterAllTransactions 例外真实链路复核 | §3(b) 活链路 OTHER-map observer 回调内调用 → E202-B（含 wedge 指引句可操作性：消息末句「队列异常残留…请勿继续复用该 doc 实例」实测可达，RT-4 用例绿）；afterAllTransactions 明文放行例外 = RT-2 对照用例（套件内绿，ok:true + extract 投影等价）。仓内尚无 NamespaceRuntime 等接入方（见 #4 grep），未来接入方复核登记观察项 O-S7-1 | ✅ |
| 3 | ⑥ 性能抽查（无意外平方级） | `.mabf/sa7-attack/perf-probe.mts`：Record 键数 1000/2000/4000 → 19/21/46ms（比值 1.08/2.24）；YArray 5000/10000/20000 → 21/25/45ms（1.20/1.81）；嵌套深度 25/50/99 → 0.9/0.9/1.7ms（1.08/1.78）；组合 1000 键×3 层嵌套 34/84/86ms（2.45/1.02）——**四维全部近线性，无平方级嫌疑**（注：VFSL 解析器 100 层实现上限 VFSL-E100 为设计内资源上限，深维度取 ≤99） | ✅ |
| 4 | O-S4-3：无 null doc / getter 化 stub 调用方 | 全仓 grep `materializeRoot`：src 侧仅定义+导出（index.ts:29），调用方全在 `packages/doc-runtime/test/` 与 `.mabf/` 探针——**零 null-doc / getter-stub 调用路径**；TS 签名 `doc: Y.Doc` 下不可达 | ✅ 确认 |
| 5 | Minor-2 栈上限环境方差（失败方向确认） | 本机 Node v24.13.0：§3(f) 20 000 层 → 溢出点落 **② 装配** → `ok:false + 恰 1 issue DOCRT-E200 + 0 update + state 不变`（非 ④ 期 raw throw 形态）；若引擎栈上限漂移，断言面会以非 E200 形态显式变红（f1/f2/f3 均为显式断言）而非静默假绿。CI 矩阵（ubuntu node 20/24）的实际方差待 push 后 CI run 复核 | ✅ 本机面确认；CI 面 deferred |

## 6. 必做 #5 — 双跑稳定性

- 全量 `pnpm typecheck && vitest run --typecheck` 同命令两轮（后台独立进程）：typecheck exit 0 ×2；`Test Files 65 passed (65)` ×2；`Tests 927 passed (927)` ×2；`Type Errors no errors` ×2；vitest exit 0 ×2——**摘要行逐字一致**（仅 Duration 84.07s vs 83.96s 与单文件毫秒差）。
- 活链路攻击脚本两轮：47/0 → 47/0 逐项一致；r4 适配重跑两轮 17/17 → 17/17；r3 适配重跑两轮 15/15 → 15/15。

## 7. 补充测试与产物清单

- **未新增仓内测试文件**：SA6 两文件 83 用例已覆盖全部攻击面锚定，SA7 活链路证据由 `.mabf/` 探针承载（不入场）。SA4 观察项 O-S4-1（存在性门禁未含 rev2 文件）/ O-S4-2（R-8 可选 characterization）属 SA1/housekeeping/SA6-optional 回流面，非 SA7 阻塞项，本报告如实转录。
- 本轮产出（均未 commit，遵守「不要 commit」）：
  - 本报告：`wiki/raw/task_doc-runtime-materialize-root-rev2_sa7_report.md`
  - 活链路攻击脚本：`.mabf/sa7-attack/live-attack.mts`
  - 性能抽查探针：`.mabf/sa7-attack/perf-probe.mts`
  - 探针适配重跑副本（场景表/比较器零改动，仅加 try/catch）：`.mabf/sa7-attack/r4-optionb-probe-rerun.mts`、`.mabf/sa7-attack/r3-optionb-verify-rerun.mts`
  - 日志：`/tmp/sa7-round1.log`、`/tmp/sa7-round2.log`、`/tmp/sa7-attacks.log`、`/tmp/sa7-r4probe-asis.log`

## 8. 观察项（非阻塞）

| # | 观察 | 定性 | 回流目标 |
|---|---|---|---|
| O-S7-1 | SA4 动态重点 #2 的「未来接入方（NamespaceRuntime）事务回调链路复核」——仓内当前无生产调用方，E202-B 诊断分支仅有单测/活链路证据 | 待接入方出现后补真实链路复核，非本轮缺口 | 未来接入任务的设计/验证清单 |
| O-S7-2 | CI 动态触发证据（Test job 两文件执行行 + node 20/24 矩阵上 Minor-2 栈方差）待 push 后产生，本报告以本地同命令证据替代 | 流程性 deferred，非缺陷 | 总控 runner（push 后核验并在 dispatch log 记录） |

---

## Verdict 论证

- Step 0 合规：SA4 pass 在先，SA7 独立动态验证无翻案面；
- 83/83 锚定测试绿 + 全量 927/927 × 双轮一致 + 双 typecheck exit 0；
- owner P1 假成功链（外层事务/observer 回调两窗口）在活链路被 ⓪ 写前拦截且零写入（E202-A/B 变体文本锚实测命中）；
- Medium 三形态嵌套修改 + D1/D2 删除向量在活链路被 ⑥ 捕获（E201-C 值支/键集支 detail 实测），⑤ 空转路径封堵；诚实路径（含重叠联合仲裁、XML）零假阳性，extract 读回语义等价实证；
- §9.5 十七场景 + SA2 十五场景判据预期在新实现上 17/17 + 15/15 全对（双层兑现：生产 ⑥ 拦截 + 探针比较器判等）；
- ⑥ 性能四维近线性；E200 崩溃边界（20 000 层）确定性零写入；O-S4-3 零违规调用方确认。

**Verdict: pass** —— 未发现 SA4 静态结论之外的任何缺陷；CI 动态触发证据与矩阵栈方差按指示 deferred 至 push 后 runner 核验（O-S7-2），不构成阻塞。
