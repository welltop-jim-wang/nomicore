# SA2 攻击评审报告 — doc-runtime：复用 detached builder 并原子替换 ROOT 内容（issue #88）

**Date**: 2026-08-23
**Verdict**: reject（发现 1 项 CRITICAL + 1 项 MEDIUM，需 SA1 修订设计后重新评审）
**被审对象**: `wiki/raw/task_doc-runtime-atomic-root-replace_design.md`（D1–D11 决策版）
**审查基线**: 任务简报（含 Phase 1 验收锚定节）+ 相关决议（ADR-0007 继续有效条款 / ADR-0008 授权条款 + D1–D11 锚定节）+ 冻结红灯测试 `packages/doc-runtime/test/replace-root-content.test.ts`（13 用例）+ worktree 实源码（materialize.ts 711 行 / carrier.ts / index.ts）+ SA8 冲突门禁 `clear`
**审查方法**: 全新视角独立攻击 + 静态核对（源码逐行对照设计 §1.2/§3.1/§4）+ **yjs 协议假设独立实测复测**（本 worktree 实依赖 yjs@13.6.32，脚本 `/tmp/sa2-yjs-attack.mjs`、`/tmp/sa2-pinpoint.mjs`、`/tmp/sa2-protocol-battery.mjs`，可重跑）+ 冻结测试文件本机实跑取证。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **CRITICAL** | 冻结验收锚（G1 fixture）+ 设计前提 | G1 fixture 对同一 `Y.Array` 实例**二次集成**（`oldFile.set('tags', oldFileTags)` 经 `root.set('assets', oldAssets)` 首次集成后，`root.set('keywords', oldFileTags)`（test:373）再次集成）→ yjs 在 **fixture 构造期即抛原生 `TypeError: Cannot read properties of null (reading 'length')`**，任何实现都无法使 G1 转绿。设计核心前提「13 用例=构造性红灯、SA3 实现并导出后转绿」对 G1 为假；§8 风险表与 §9 协议假设表均未覆盖「SA6 冻结 fixture 的手工 yjs 构造」这一负载性协议假设；§12 对 SA6-owned 测试仅开放「vitest 环境问题」级修正，不覆盖本修复。**证据三重独立**：① 隔离复现（pinpoint 脚本场景 A/B：二次集成 Y.Array→`length` of null、Y.Map→`forEach` of null，确定性崩溃）；② 健康版 fixture（每实例恰一次集成）全量 P1 断言通过；③ 本机实跑冻结测试：G1 失败根因即该 TypeError，其余 12 例才是 `(0, replaceRootContent) is not a function`——简报「全部 13 用例红=构造性红灯」的根因归纳对 G1 不实。 | 见下「攻击点 1 修订要求」：设计修订轮显式登记缺陷与证据、裁定最小接线修复（**断言逐字保留**）、归属裁决（SA6 重发 vs SA3 凭登记理由修复）、并把「同一 Y 实例二次集成 → yjs 原生 TypeError（`_prelimContent` 首次集成即消费置 null，二次 `_integrate` 以 null 调 `insert`/`forEach`）」补入设计知识面（它同时是 INV-7「一切容器重建新实例」必要性的机制注脚）。 |
| 2 | **MEDIUM** | D2 模块分解（§3.1）可执行性 | 「detached-build.ts **唯一导出** `buildTopEntries`，`plainObjectOf/recordSlotOf/declaredFieldOf` 等『一切辅助保持模块私有』」与「install-verify.ts ⑤⑥ **逐字纯移动**」**不可同时成立**：⑥ 的 `productEqual`（materialize.ts:309-319）、`deepEqualValue`（388-389）、`keysetOf`（419）调用这三个 helper（643-663，属 ② 迁出区间→detached-build 私有）；`ScratchInstall`/`ProductComparison` 还需 `Path/Resolver/BuildIssue` 类型跨模块共享。三条出路各自违反设计自宣不变量：扩导出面（违反「唯一导出」）/ 第四个共享模块（不在 DAG 与 ALLOW LIST）/ 复制三份（违反零复制纪律，制造漂移面）。另 §1.2 行号表「43–111 留 materialize.ts」与 §3.1「`BuildResult/EntriesResult/Path/Resolver` 迁入 detached-build」自相矛盾（54-58 行落在 43–111 区间内）。 | 修订 §3.1/D2：显式定义共享接缝——推荐按设计 §3.2 自己援引的 `walk @internal 包内复用接缝` 先例，detached-build.ts 除 `buildTopEntries` 外以 `@internal` 导出 `plainObjectOf/recordSlotOf/declaredFieldOf` + `Path/Resolver/BuildIssue` 类型（G6 只锚 index.ts 公共面，不受影响）；同步修正 §1.2 行号表矛盾与 §3.1 DAG 注记、§10 改动表。 |
| 3 | MINOR | §9 依据可复现性 | SA1 实测脚本 `/tmp/sa1-yjs-verify.mjs`「本地 scratch 不入仓」已不存在——RA 表依据只能靠贴出的输出摘录 + SA6 独立实证复核，命令不可原样重跑。 | SA4 阶段以 SA2 提供的 `/tmp/sa2-protocol-battery.mjs`（本报告已全量复测通过）或等价脚本重跑 RA-1~RA-8；或设计修订轮附最小可重跑脚本清单。非阻塞。 |
| 4 | MINOR | D8 消息族一致性 | `replaceRootContent` 的 E200 消息点名 API 名（`replaceRootContent 内部错误`），materializeRoot 的 E200 点名模块名（`materialize 内部错误`）——命名基准不一致。既有锚均为正则（`/DOCRT-E200/`、`/DOCRT-E202/`，materialize-root.test.ts:387/762 实核），无行为影响，G5-2 也只对拍 issue 非崩溃路径。 | 设计一句话定基调（建议统一点名 API 名，materialize 侧既有文案不动即天然两制并存；或 replace 侧改用 `replace` 模块名）。非阻塞。 |

**未成立的攻击（审查过但驳回，供 SA4/SA7 复核免重复劳动）**：

- 「`${api}` 插值破坏 materializeRoot 既有 E202 文本锚」——不成立：实核 materialize.ts:116-123，A/B 消息中 API 名各恰出现一次（前导短语），C 变体无 API 名；且既有锚为 `toMatch(/DOCRT-E202/)` 正则而非全等（materialize-root.test.ts:759-762）。字节同一性论证（§4.1）成立且为超额保险。
- 「update 计数法则（§4.3 表）与冻结断言冲突」——不成立：G1/G2 fixture 均非空快照；「空变更集 → 0 update」为 yjs 零操作事务自然语义，SA2 实测复证（P4：惰性 getMap=0、空 clear=0（裸调与事务内均 0））。
- 「⑥ 对称重物化在替换路径覆盖失效」——不成立：⑥ 比较的是 clear 后投影，与旧内容无关；快照外键/未声明键注入由 ⑤ size+同一性双断言兜住（§4.4 论证与实源码 155-176 一致）。
- 「⑤ 对 plain 值（YPlainArray）身份断言误报」——不成立：P6 复测 `plainSameRef:true`；既有 215 绿含 plain fixture。
- 「测试深 import materialize.js 受搬迁影响」——不成立：`grep -rn "from '\.\./src" test/` 全量核对，深 import 仅 read.js 三处（rev2 系），无 materialize.js。
- 「G6 公共面泄漏」——不成立：index.ts 现恰 3 值导出（extractYjsSnapshot/readLogicalValueAtPath/materializeRoot），+1 为纯增量；类型导出运行时擦除不入 `Object.keys`。
- 「版本/构建面」——不成立：package.json 实为 0.1.5（→0.1.6 正确）；tsconfig `include: ["src/**/*.ts","test/**/*.ts"]` 自动覆盖新文件；yjs 实依赖 13.6.32（^13.6.30 声明内）。

---

## SA2 独立实测复测记录（yjs@13.6.32 / Node v24，worktree 实依赖）

**命令**：`node /tmp/sa2-protocol-battery.mjs`（健康版 G1 fixture + P2/P3/P4/P5/P7/G7 模拟）；`node /tmp/sa2-pinpoint.mjs`（二次集成崩溃定位）；`cd <worktree> && pnpm exec vitest run packages/doc-runtime/test/replace-root-content.test.ts`（冻结测试取证）。

**结果（关键摘录）**：

```json
// 健康版 fixture（每实例恰一次集成）——设计 RA-1 全项复证
"P1": { "updates": 1, "identityKept": true, "oldAssetsStale": true, "oldAuditStale": true,
        "oldKeywordsStale": true, "staleKeyGone": true, "size": 4, "plainSameRef": true }
"P2": { "threw": "observer-boom", "calls": 1, "updates": 1, "title": "new", "count": 7,
        "cleanupsEmpty": true, "txNull": true }          // RA-2 复证（G4-1 可达）
"P3": { "updates": 2, "title": "new", "countUndefined": true, "size": 1 }  // RA-3 复证（G4-2 可达）
"P4": { "lazyGetMapUpdates": 0, "emptyClearUpdates": 0, "emptyClearInTx": 0 } // RA-4 复证
"P5": { "updates": 1, "size": 0 }                        // RA-5 复证
"P7": { "probe": "throw: Type with the name ROOT has already been defined with a different constructor",
        "updates": 0, "stateUnchanged": true }            // RA-7 复证
"G7": { "threw": "DOCRT-E202: guard-reject", "updates": 0, "stateUnchanged": true, "oldKept": true }
```

```text
// 攻击点 1 取证一（隔离复现，pinpoint 脚本）：
A1 root.set(assets, oldAssets)  [首次集成 oldFileTags]: OK
A3 root.set(keywords, oldFileTags) [二次集成！]: THREW TypeError: Cannot read properties of null (reading 'length')
B2 二次 set 同 Y.Array 实例（一般化）: THREW Cannot read properties of null (reading 'length')
D2 二次 set 同 Y.Map 实例: THREW Cannot read properties of null (reading 'forEach')
C1 全新 detached array 装进非空 root（clear+set 单事务）: OK   ← 设计自身安装路径安全

// 攻击点 1 取证二（冻结测试本机实跑）：
FAIL replace-root-content.test.ts > G1（非空 ROOT …）
TypeError: Cannot read properties of null (reading 'length')     ← G1：fixture 崩溃，非构造性红灯
FAIL …（其余 12 例）
TypeError: (0, replaceRootContent) is not a function             ← 12/13：构造性红灯
```

**结论**：设计 §9 RA-1~RA-8 全部经 SA2 第三方独立复测成立（SA1 实测 + SA6 断言可达性实证 + SA2 复测三方一致）；唯一的协议假设盲区是 RA 表之外的那条——冻结 fixture 自身的手工 yjs 构造（攻击点 1）。

---

## 攻击点 1 修订要求（CRITICAL，reject 的直接依据）

1. **登记缺陷**：设计修订须新增一节（或 §8 风险表 + §9 RA 表增补）登记：G1 fixture（replace-root-content.test.ts:337-374）对 `oldFileTags` 的二次集成使 fixture 构造期确定性崩溃（证据如上），G1 在任何实现下不可转绿；同时更正简报 Phase 1 节「失败根因=包入口未导出（全部 13 用例红，构造性红灯）」的归纳——12/13 成立，G1 为 fixture 缺陷。
2. **裁定最小修复**：断言逻辑**逐字保留**，仅修 fixture 接线，保证「每个手工 Y 实例恰被集成一次」。推荐形态：`oldFile` 的 `tags` 改用独立 `Y.Array` 实例，`root.set('keywords', oldFileTags)` 成为该实例首次集成——G1 全部断言（含 `not.toBe(oldFileTags)`、`stale` 消失、恰 1 update）语义不变且已被 SA2 健康版 fixture 实测全量通过（见 P1 输出）。
3. **归属裁决**：测试文件为 `[SA6 owned]`，§12 现仅允许「vitest 环境问题」级修正——fixture 接线修复超出该窗口，修订轮须二选一并写明：SA6 重发该文件；或授权 SA3 凭本报告登记理由执行上述最小修复（仍不得动断言）。未裁决前 SA3 无合法路径使验收门（AC-3/AC-4/AC-7 的 G1 锚）达成。
4. **知识面增补**：§1.4/INV-7 处补一句机制注脚：同一 Y 实例二次集成 → `_prelimContent` 已消费（null）→ 二次 `_integrate` 原生 TypeError——这正是「detached builder 一切容器重建新实例、replace 安装全新 detached 实例」的机制必要性，也是「旧内容仅由 clear 递减引用计数回收、从不复用实例」的安全边界。

## 攻击点 2 修订要求（MEDIUM）

- §3.1 明确 install-verify → detached-build 的**辅助/类型共享接缝**（`@internal` 导出 `plainObjectOf/recordSlotOf/declaredFieldOf` + `Path/Resolver/BuildIssue`），或引入显式第四模块（同步补 ALLOW LIST 与 DAG）；三选一写死，不留 SA3 自由裁量——现状的三条隐式出路各违反一条自宣不变量（唯一导出 / DAG / 零复制）。
- 修正 §1.2 行号表与 §3.1 的类型归属矛盾（54-58 行内部类型：留 materialize.ts 还是迁 detached-build，二选一写明；按 §3.1 意图应为后者，行号表须同步）。

---

## 协议假设依据审查

- **章节存在性**：§9 存在，8 条 RA 逐条给出依据类型与具体引用（源码 file:line、实测输出 JSON、既有测试锚 materialize-root.test.ts:581 实核存在、rev2 定谳引用）。✅
- **依据可验证性**：源码引用可定位（yjs 13.6.32 实包核对 `Transaction.js`/`YMap.js` 行为一致）；实测输出已贴；既有测试锚存在且绿。SA2 已对 RA-1~RA-8 **全量第三方重跑复证通过**（见上）。✅
- **「应该/通常/预计」类无据推断**：未发现。✅
- **缺口**：§9 末句「无其他协议级假设」不实——冻结 fixture 的手工 yjs 构造（实例复用→二次集成崩溃）是一条未被 RA 表覆盖的负载性协议假设，正是攻击点 1 的盲区（MINOR 流程缺口并入攻击点 1/3 修订要求）。
- **命令可重跑性**：SA1 脚本未归档（攻击点 3，MINOR）；SA2 已提供等价可重跑脚本补偿。

## 错误处理链路审查

- **静默失败**：无。全部失败面 loud：①②③ → `{ok:false,issues}`（含 E200 崩溃边界收编）；⓪ → throw E202（写入前）；④ observer 异常 → 原样传播（P2 实测复证：`threw:"observer-boom"` 且 update 已发、值已落盘）；⑤⑥ 偏离 → throw E201。同步函数无异步悬空路径。✅
- **状态闭环**：`ok:true / ok:false / throw` 三态承诺面（RINV-1~RINV-10）与 G1–G7 断言矩阵逐条对齐；不存在「已执行写入却无结果无异常」的路径（④ 无 try/catch 为结构性保证，与 materialize.ts:98-110 同款且实核一致）。✅
- **降级路径**：无任何 fallback/降级设计（服从 ADR「不覆盖、不合并、不 fallback」）；「缺席 ROOT 惰性创建空 map」是 happy path 而非降级（P4 实测 0 update，零写入纪律不受影响）。✅
- **虚假降级识别**：设计本体未发现伪降级。但流程上存在一处「缺陷被表象掩盖」：G1 的 fixture 崩溃被简报归纳为「构造性红灯（功能未实现）」——实质是 fixture 缺陷伪装成红灯，已按 CRITICAL 定性并要求 loud 登记（攻击点 1）。✅（处理后）
- **用户可感知性**：所有 throw 携带 `DOCRT-E202/E201` 码与可操作指引文案；issues 携带 `message + path` 段数组（禁点号串/JSON Pointer，服从 ADR-0007 路径纪律）。✅
- **竞态/死锁/撕裂**：同步单线程语境无竞态；observer 同步重入是唯一「重入」向量，已由 ⑤ 检测 + E201 loud 处理（P3 实测：独立新事务、终态=observer 留下、G4-2 断言面可达）；无缓存/DB 双写面。✅
- **Feature 契约污染**：materializeRoot 公共契约零变化成立（签名/消息/行为逐位保持；E202 `${api}` 插值对 materializeRoot 渲染字节同一且既有锚为正则——双保险实核）；新公共入口为纯增量（3→4 值导出）。✅

## 红线测试思路

- **攻击点 1（CRITICAL）**：修复即测试——fixture 接线修复（每实例恰一次集成）后，G1 现有断言即完整红灯→绿灯路径（SA2 健康版已实测全绿预期：恰 1 update / identity `toBe` / 旧引用 `not.toBe` / `stale` 消失 / extract 读回全等）。无需新增用例；若 SA6 重发文件，建议补一行 fixture 注释「每实例恰集成一次（yjs 二次集成 `_prelimContent=null` 崩溃）」防回归。可选强化（非必需）：一条「同一旧实例仅顶层集成一次 → replace → `root.get('keywords')).not.toBe(oldFileTags)`」已含于 G1。
- **攻击点 2（MEDIUM）**：运行时不可锚（模块内部结构）→ 转 SA4 静态门禁思路：① `grep -n "plainObjectOf\|recordSlotOf\|declaredFieldOf" packages/doc-runtime/src/*.ts` 断言定义恰一处（零复制体）；② import 图核对 install-verify→detached-build 共享接缝与设计修订版一致、无环。G6-1（公共面恰 4 值）已锚封装边界。
- **攻击点 3（MINOR）**：无新测试；SA4 重跑 §9 RA 表命令（可用 `/tmp/sa2-protocol-battery.mjs`）。
- **攻击点 4（MINOR）**：无需测试（既有锚为正则，两种命名均兼容）。

## 结论

**Verdict: reject。**

- 行为面/契约面（D1/D3–D9）：设计质量高——六阶段镜像、单事务语义、identity 机制、issues 纪律、no-rollback 面均与 ADR-0007/0008 及冻结测试逐条对齐，且全部协议假设经 SA2 第三方独立实测复证通过；「未成立的攻击」七项均已驳回并留档。
- 但 **攻击点 1（CRITICAL）使验收门在现状下结构性不可达**（G1 永红），设计必须修订：登记 fixture 缺陷与证据、裁定最小接线修复与归属、增补协议假设知识面。**攻击点 2（MEDIUM）**使 §3 模块分解按原文不可执行，必须显式化共享接缝。攻击点 3/4 为非阻塞 MINOR。
- 修订完成后交 SA2 复审（重点复核攻击点 1/2 的落点与 §8/§9/§12 联动更新）；SA4/SA7 后续仍须对实现与活链路独立验证（本 pass/reject 不替代）。

**SA2 复核将检查的落点清单**：① §8/§9 新增条目与简报根因更正；② fixture 修复裁决文字（断言逐字保留承诺）；③ §3.1/D2/§1.2/§10/§12 的共享接缝与类型归属一致性；④ （可选）攻击点 4 的命名基调一句话。

---
---

# SA2 攻击评审报告 — R2 复审轮（2026-08-23）

**Date**: 2026-08-23（R2）
**Verdict**: **reject**（R1 攻击点 1/3/4 全部验证落实；攻击点 2 落实 95% 但残留**同一缺陷类的单点未闭合**——R2-A1，一处外科手术级修订即可放行，附快速通道条款）
**被审对象**: `wiki/raw/task_doc-runtime-atomic-root-replace_design.md` R2 修订版（548 → 680 行）
**复审方法**: 按 R1 报告末节落点清单 ①②③④ 逐项复核 + 对 R2 新增内容全新视角再攻击 + 实证复验（RA-9 内联片段实跑 / yjs 源码行号核对 / 留守区符号机械审计 / 陈旧表述全文 grep）。

## R1 落点清单逐项复核

### ① §8/§9 新增条目与根因更正（§1.5 / RA-9 / D12）——✅ 落实（含一处非阻塞措辞瑕疵）

- **§1.5（110–147 行）**：缺陷登记完整（test:337–374 双集成定位精确到行）、根因更正明确（12/13 构造性 + G1 fixture 崩溃，SA1 无简报写权以设计登记代更正）、四方证据链如实（SA2 三重 + SA1 独立复现 R2-A/B/C）、修复裁定不变量「每个手工 Y 实例恰被集成一次」+ 推荐形态 + 允许改动范围（test:344–345/353/373 接线区 + 一行防回归注释）——与 SA2 R1 建议逐条对应。✅
- **RA-9（550 行）+ 内联复现片段（552–562）**：**SA2 实跑复现成功**（node 直跑输出 `RA9 snippet reproduced: TypeError: Cannot read properties of null (reading 'length')`）；源码行号引用核对属实——yjs 实包 `YArray.js` `_integrate`（76–80 行区间：`this.insert(0, this._prelimContent); this._prelimContent = null`）与 `YMap.js`（`_prelimContent.forEach(...)` 后置 null）与机制注脚 §1.4 描述一致。§9 末尾（568–570）对初轮「无其他协议级假设」失实表述的诚实更正到位。✅
- **D12（42 行）+ §8 首行（522 行）+ 头部（4 行）+ §7 R2 注记（512–514）**：七处联动一致（SA1 自检声明经 grep 验证成立——「13 用例=构造性红灯」旧表述全文清除，现存各处均为更正语境）。✅
- **非阻塞瑕疵（NIT-R2-1，不要求修订）**：§1.5 证据 2 措辞「G1 **全量断言**通过」略超 SA2 battery 的实际枚举面（P1 输出覆盖 yjs 机制层断言：恰 1 update / identity / 三组 `not.toBe` / stale 消失 / plainSameRef；G1 的 extract 读回断言（含 XML 投影）由 SA6 Phase 1 scratch + 共享 builder 等价性（G5/RINV-9）覆盖，非 SA2 直接实测）。括号内枚举本身诚实，结论链成立——建议顺带修半句，不构成本轮阻塞项。

### ② fixture 修复裁决文字——✅ 落实

- 「断言逻辑**逐字锁定**，任何 SA 不得改」+ 授权 SA3 凭 §1.5 登记理由执行 + 三条理由 + 回退路径（发现断言语义受牵连 → 停止并上报总控 → SA6 重发）+ 修复后 `not.toBe(oldFileTags)` 语义保真论证（`oldFileTags` 仍是被替换前的旧 keywords 实例）——完整闭环。✅
- 授权依据「SKILL 立法先例」核对：`implement-fix/SKILL.md:62` 确有 test fixtures 独立化条款（「独立的 test fixtures……不污染业务代码」）——引用成立；且归属裁决并不单悬于此条（回退路径在）。✅
- 给总控的流转提示：SA3 派发时请随 dispatch 附 §1.5 与本 R2 节（SA6-owned 文件的触碰授权依据链）。

### ③ §3.1/D2/§1.2/§10/§12 共享接缝与类型归属——⚠️ 落实 95%，残留单点未闭合（→ R2-A1）

已验证闭合的部分：

- §3.1 导出面清单写死（`buildTopEntries` + `@internal` `plainObjectOf/recordSlotOf/declaredFieldOf` + 类型 `Path/Resolver/BuildIssue`，其余枚举私有）+ DAG 边全集（217–220，含 install-verify → detached-build 单向边）+ 不选第四模块理由；§1.2 行号表拆分订正（54–58 类型去向与 §3.1 对齐，实源码行号核对无误）；§10 新增 2 行改动 + 1 行 caller；§12 detached-build/install-verify 条目同步；D2/D11/RINV 表一致；「唯一导出」歧义表述全文清除（grep 验证仅存于更正语境）；walk 先例行引用核对属实（extract.ts:86–88 确有 `@internal 包内复用接缝（issue #75）`）。install-verify 侧消费面（`productEqual` 309–319 / `deepEqualValue` 388–389 / `keysetOf` 419 + `ScratchInstall/ProductComparison` 签名）与导出面**完全闭合**。✅

**未闭合的单点 → R2-A1（见攻击点清单）**：留守 materialize.ts 的 `prepare`（§1.2 明文「441–475 留 materialize.ts」）在实源码 464/467 行调用 `makeIssue`——而 §3.1 私有清单（234 行）明文将 `makeIssue` 列为 detached-build 模块私有，§12 对 materialize.ts 仅授权「三处 import 替代迁出体」。

### ④ E200 命名基调（模块名制）——✅ 落实

D8 决策行（38 行）≡ §4.2 伪代码（351 行 `DOCRT-E200: replace 内部错误（意外异常）`）一致；与 materialize 侧「materialize 内部错误」同基调两制并存；既有锚均为 `/DOCRT-E200/` 正则（R1 已核），冻结测试对 replace E200 无断言——兼容性成立。新增的「ROOT 载体 issue 沿 materialize 同款结构（载体词 + 拒因尾巴，不点名）」与 §4.2 伪代码一致，G3-3 仅锚长度与 path。✅

## R2 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| R2-A1 | **MEDIUM**（R1 攻击点 2 同类残留） | D2 模块分解（§3.1 私有清单 × §1.2 留守区 × §12 修改授权 × §10 caller 审计） | **`makeIssue` 跨模块归属未闭合**：留守 materialize.ts 的 `prepare` 在实源码 464/467 行调用 `makeIssue`（载体 issue + 非空 ROOT issue 两处），而 §3.1 把 `makeIssue` 明文列入 detached-build「保持模块私有」清单，§12 materialize.ts 条目仅授权「删三段迁出体 + 改三处 import」。SA3 按字面执行无法编译 prepare：要么 import 一个被写死为私有的符号（违反 §3.1「无 SA3 自由裁量」），要么改写留守区两处调用（超出 §12 授权面）——**R1 攻击点 2 的缺陷类（规格按原文不可执行）在 materialize.ts 侧原样复发**。§10 caller 审计（本应捕捉此类跨模块引用的工具）同样漏登此两行，使 §11「三方一致」自检结论存在过度声明。触发条件：SA3 按设计字面实施；影响：SA3 被迫未登记裁量（违反 R1 建立的「写死零裁量」标准），或 SA4 静态门禁对 §3.1 import 面 grep 时必然报偏差。行为面零风险（`makeIssue` 为 2 行 `{message, path}` 构造器，任一解法行为逐字节不变）——但规格可执行性标准不容再豁免。 | **一处外科手术级修订（二选一写死，SA3 零裁量）**：**方案 A（推荐）**——`makeIssue` 移入 detached-build `@internal` 导出面（实源码 665 行自述「issue 构造器（统一出口）：shapeIssue / domainIssue / makeIssue 全部收敛到此」，materialize 的载体/非空 issue 本就经它构造，共享单点纪律最自然）；§3.1 导出面清单 + §10（新增 materialize prepare→makeIssue caller 行）+ §12（「三处 import」→ 含 makeIssue 的 detached-build import）三处同步。**方案 B**——§1.2/§12 明文登记留守 prepare 的两处 `makeIssue(...)` 改内联字面量 `{ message: ..., path: [] }`（行为逐字节不变，登记为授权过的留守区最小编辑）。 |
| NIT-R2-1 | MINOR（非阻塞） | §1.5 证据 2 措辞 | 「G1 全量断言通过」超出 SA2 battery 枚举面（见 ① 节）。 | 顺带修半句：「G1 的 yjs 机制层断言（枚举如后）实测通过；extract 读回断言由 SA6 Phase 1 实证 + 共享 builder 等价性覆盖」。不要求本轮处理。 |

**R2 新增内容的其余再攻击（均驳回，留档）**：RA-9 内联片段实跑复现 ✓；yjs 源码行号引用核对属实 ✓；§1.5 允许改动范围行号（test:344–345/353/373）与冻结文件实况一致 ✓；D12/§8/头部/§7/RA-9/RINV-3 七处联动 grep 验证一致 ✓；留守区符号机械审计（59–111 + 441–475 全部调用标识符提取）：`assertOutermostTransactionContext`（tx-guard ✓）/`buildTopEntries`（detached-build ✓）/`probeRoot`（carrier ✓）/`validateLogicalSnapshot`（vfsl ✓）/`verifyInstall`/`verifySnapshotIntact`（install-verify ✓）全部已登记——**唯一未闭合符号即 `makeIssue`**（`extractYjsSnapshot` 出现于 materializeRoot 的 JSDoc 注释文本非代码依赖；`errDetail` 随 ⑥ 迁出正确，其调用点 250/265/286 均在 ⑥ 区间内）。

## 协议假设依据审查（R2 增量）

RA-9 依据链完整可验：SA2 三重取证 + SA1 独立复现 + 源码行号（核对属实）+ **自包含可重跑片段（SA2 实跑复现）**——满足「依据可被 SA4 验证」标准。可重跑脚本清单（564–566 行）把 SA2 battery 升级为 RA-1~8 复核锚、初轮 SA1 scratch 如实降级为历史依据——攻击点 3 闭合。✅

## 错误处理链路审查（R2 增量）

无新增错误路径（R2 修订不触碰 ④⑤⑥ 编排与失败面总表）；fixture 修复裁决补齐了「G1 锚可达性」这一验收链缺口，静默失败/状态闭环/降级/伪降级四项结论与 R1 相同（全部 ✅，见 R1 报告对应节）。

## 红线测试思路（R2-A1）

运行时无新测试必要（行为面零变化）；SA4 静态门禁思路：① `grep -rn "function makeIssue" packages/doc-runtime/src/` 断言定义恰一处（detached-build.ts，零复制体）；② import 图核对：materialize.ts 自 detached-build.js 的 import 与修订版 §3.1 导出面完全一致、无私有面引用、无环。

## 结论

**Verdict: reject（R2，外科手术级）**

- R1 四项攻击点复核：攻击点 1（CRITICAL）**完整落实并经实证验证**（RA-9 片段复跑 + yjs 源码核对 + 七处联动 grep）；攻击点 2 落实 95%——install-verify 侧完全闭合，但 `makeIssue` 单点使 materialize.ts 侧规格不可执行（R2-A1）；攻击点 3、4 完整落实。
- **唯一放行条件 = R2-A1 一处修订**（方案 A 或 B，各约 1–3 行设计文字 + 三处同步）。**快速通道条款**：SA1 完成 R2-A1 修订后，SA2 复核降级为 grep 级快检（验证 §3.1/§10/§12 三处同步且无新引入矛盾，无需全量再审），快检通过即改判 pass。NIT-R2-1 不阻塞、可顺带处理。
- 本 reject 不影响已验证结论的有效性：§1.5/§12 的 fixture 修复裁决即刻生效，可供总控派发引用；SA4/SA7 仍须对实现与活链路独立验证（本裁决不替代）。

---
---

# SA2 攻击评审报告 — R3 快速通道快检（2026-08-23）

**Date**: 2026-08-23（R3，按 R2 报告快速通道条款执行 grep 级快检）
**Verdict**: **pass**（R2-A1 三处同步全部验证闭合，无新引入的可执行性矛盾；两条非阻塞 NIT 留档）
**被审对象**: `wiki/raw/task_doc-runtime-atomic-root-replace_design.md` R3 外科修订版（680 → 697 行）
**快检范围**: 严格限定 R2 快速通道条款——验证 §3.1/§10/§12 三处同步 + 无新矛盾；不做全量再审（R1/R2 已验证结论沿用）。

## R2-A1 三处同步验证（grep 级）

| 同步点 | 验证结果 | 证据（设计行号 + 实源码核对） |
|---|---|---|
| §3.1 导出面/私有清单 | ✅ | 231–234 行新增 `@internal makeIssue` bullet（消费方 = 留守 prepare 464/467 + builder 内部同源，源码 665「统一出口」自述引用属实）；**237–238 行私有清单已剔除 makeIssue**（`issue/shapeIssue/domainIssue` 正确保留私有——仅 builder 内部消费）；256–258 行 materialize bullet 注记 detached-build import 含 `@internal makeIssue` |
| §10 改动函数表 + caller 表 | ✅ | 589 行改动函数表新增 `makeIssue` 行（materialize.ts:670 → detached-build.ts，模块私有 → `@internal` 共享导出，实现逐字不变）；601 行 caller 表新增补登行（留守 prepare → makeIssue，464/467，`@internal` import，SA3 零裁量）——R2 指出的「caller 审计漏登」同步修复 |
| §12 ALLOW LIST | ✅ | 661–665 行 detached-build 导出面含 `makeIssue`（与 §3.1 清单逐字一致）；671–673 行 materialize.ts 条目授权「detached-build import 含 `@internal makeIssue`」+ 源码行号锚 |

**无新矛盾核查**：DAG 边全集（217–220）无需变更（makeIssue 走既有 materialize → detached-build 边，不新增模块对）；§11 R2 自检与 R2 回应表原文保留（627–646，审计轨迹完整），R3 回应表追加（648–653）；§3.1（225–238）与 §12（663–664）两份权威导出面清单逐字一致。✅

## 留档观察（非阻塞，不构成本轮门槛）

- **NIT-R3-1（措辞残留）**：§3.1 理由段（239–241 行）「三辅助与 builder 同属 ② 构造域语义……grep 三辅助定义恰一处」的「三辅助」计数未随 makeIssue 成为第四个 `@internal` 辅助而更新。权威导出面清单（§3.1/§12）无歧义、SA3/SA4 以清单为准，且 SA2 R2 报告红线思路已单列 `grep -rn "function makeIssue"` 检查项——不产生执行歧义。建议后续修订轮顺手改「辅助族/四辅助」，不阻塞。
- **NIT-R2-1（R2 遗留措辞）**：R3 回应表显式登记「未处理 + 理由」（总控 R3 指令为单点外科不动其他章节——范围纪律正当），留待后续修订轮或 SA6 重发时顺带。维持非阻塞。

## SA4 静态门禁移交清单（R2-A1 落点）

① `grep -rn "function makeIssue" packages/doc-runtime/src/`——定义恰一处（detached-build.ts，零复制体）；② import 图核对：materialize.ts / install-verify.ts 自 detached-build.js 的 import 与 §3.1 R3 版导出面（`buildTopEntries` + `@internal plainObjectOf/recordSlotOf/declaredFieldOf/makeIssue` + 类型 `Path/Resolver/BuildIssue`）完全一致、无私有面引用、无环；③ SA3 对 G1 fixture 的修复严格遵守 §1.5/§12 R2 窗口（断言逐字锁定 + 每实例恰集成一次 + 一行防回归注释）。

## 结论

**Verdict: pass（R3 快检，最终）**

- R2-A1（唯一放行障碍）经三处同步验证**完全闭合**：`makeIssue` 移入 `@internal` 导出面，留守 prepare 的 464/467 调用获得合法 import 授权，SA3 零裁量、行为零变化——R1 攻击点 2 的缺陷类（规格按原文不可执行）至此**全量清零**。
- R1–R3 累计结论：设计的全部行为面/契约面/协议假设/模块分解均已通过独立攻击与实证复核；两条 NIT（措辞级）留档不阻塞。
- **pass 仅表示设计通过审查**：SA3 实现须按 §12 ALLOW/DENY 与 §1.5 fixture 修复窗口执行；SA4 静态门禁（含上述移交清单）与 SA7 活链路验证照常进行，本 pass 不替代。
