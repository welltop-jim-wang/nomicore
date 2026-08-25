# SA4 静态验尸报告 — replaceSchema provided-root 静默投影偏差修复（issue #91 round 2 / rev1 实现）

**Date**: 2026-02-20（round 2 修订轮）
**Verdict**: **pass**
**被审对象**: SA3 未 commit 工作树改动（`git diff HEAD` 可见）：`packages/doc-runtime/src/schema-replace.ts`、`packages/namespace-runtime/src/schema-write.ts`、`CONTEXT.md`、两包 `package.json` + SA6 已暂存测试改动（sa7-dynamic / sequencer 两文件）
**基线**: `task_namespace-runtime-replace-schema-rev1_design.md`（D1–D8 / ALLOW-DENY）、`_sa2_review.md`（6 项 M/NIT/INFO）、`_relevant_decisions.md`（ADR 0008:69/:75、ADR 0007）
**方法**: 纯静态——逐行读实现 + 回源核验全部承重论断（本报告所有「证据」栏命令可重跑）；测试实跑归 SA7。

---

## 一、总控点名红线核验（六项）

### 红线 ① projectDeclaredRootKeys / narrowed 全仓零残留 — ✅ 通过

```
grep -rn "projectDeclaredRootKeys|narrowed" --include="*.ts" --include="*.md" \
  packages apps docs CONTEXT.md README.md TASK.md
→ 零命中（exit=1）
```

- 函数本体（原 :300-337）、调用（原 :170）、`narrowed` 字段（原 :89-90/:128/:188）全部消除；生产、测试、docs 三面零残留。
- 残存的「顶层声明域投影」字样仅 5 处、**全部为废止语境**（合规）：`CONTEXT.md:19`（_Avoid_ 标记已废止）、`schema-write.ts:80`（「round 1 的顶层静默剥离契约已废止」）、sa7-dynamic `:438`、schema-replace `:167`（rev1 废止说明）。测试 `:69/:514/:527` 三处以 D7 为**论据**（非废止语境）的残留见 NIT-B——注释层、行为结论（union loud）在新管线下自然成立，非阻塞。

### 红线 ② provided-root 路径 validate/build/⑥ 三者同吃 input.root.snapshot 原样引用 — ✅ 通过

`schema-replace.ts` 逐行核对（当前行号）：

| 消费点 | 行号 | 证据 |
|---|---|---|
| 取值 | :168 | `const snapshot = input.root.snapshot; // 原样——调用方提供的完整 ROOT`——无拷贝、无变换 |
| ①d validate | :169 | `validateLogicalSnapshot(input.derived, snapshot)` |
| ①d build | :171 | `buildTopEntries(input.derived, snapshot)` |
| ready 载荷 | :186 | `snapshot, // 原样携带（⑥ 消费）` |
| ④ ⑥ | :126 | `verifySnapshotIntact(input.derived, ready.snapshot, doc)` |

三消费者（外加 ⑥ 内部 scratch 侧 `buildScratchInstall(derived, snapshot)`，install-verify.ts:128）吃**同一引用**——D1/D2/D3 单形态纪律精确落地。次序 validate → build → probeRoot 与修订前一致；keep-root 分支（:158-164）、⓪①a①b①c、②③⑤ 零触碰（diff 证实）。

### 红线 ③ schema-write.ts JSDoc / CONTEXT.md 新文案与 ADR 0008:69/:75 逐字相容 — ✅ 通过

- **ADR 0008 原文回读**（`docs/adr/0008-*.md` §ROOT write 与 SCHEMA write）：第 3 条「提供 `root` 时，将其视为最终完整 logical ROOT snapshot，验证并 detached 构造完整新内容」；失败语义条「……均发生在 transaction 前，SCHEMA/ROOT 零写入，active tools 不变」。
- **schema-write.ts :77-81**（新 JSDoc）：「root 作为完整最终 logical ROOT **原样**送入封闭对象校验……与 detached 构造……`ok:false` + 指向该键的 issue（path=[<k>]），零写入、SCHEMA/ROOT/active tools 不变（issue #91 AC3 / ADR 0008 §SCHEMA write 第 3 条……）」——与设计 D6 块**逐字一致**，每个承诺都能在 ADR :69/:75 找到对应句；「提供性判定段」（:71-75）与「issues 窄化示例段」（:82-84）逐字保留（diff 上下文行证实）。
- **CONTEXT.md :17-19**：与设计 D7 块逐字一致（「原样封闭校验（provided-root as-is closed validation）」+ _Avoid_ 显式标记旧术语已废止）；条目位仍在信封条目后，`_Avoid_` 惯例保持。
- 顶层未知键失败源核验：`vfsl/validate.ts:573-578` `ctx.emit([...path, k], () => \`未知字段 "${k}"：封闭对象不接受未声明键\`)`，顶层 path 基点 `[]`（validate.ts:602 `validateValue(root, value, [], ctx)`）→ path=`['b']`、message 含 `"b"`——R2-1 断言兼容。

### 红线 ④ 版本 bump 恰两包 patch — ✅ 通过

`git diff HEAD -- '**/package.json'` → 恰两文件各单行：doc-runtime `0.1.9→0.1.10`、namespace-runtime `0.1.3→0.1.4`（HG #9）。无 dependencies 触碰、无其他包版本漂移。

### 红线 ⑤ DENY LIST 零触碰 — ✅ 通过

- 实际改动全集（排除 wiki/raw/task_* 白名单）：`.mabf-done`(D)、`CONTEXT.md`、`REPORT.md`、两 `package.json`、两 `src` 文件、两测试文件——与 ALLOW LIST 七项**一一对应**，无越界。
- DENY 21 文件逐一 `git diff HEAD --quiet` 显式比对：**零 diff**（detached-build/resolve/install-verify/extract/replace/carrier/fatal/tx-guard/materialize/mutation/read/index + namespace-runtime 其余 src + persistence/type-guard 测试）。`packages/vfsl`、`packages/persistence`、`apps`、`docs` 工作树干净；round 1 wiki 档案零改动。
- BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/.bak）：零命中。
- `REPORT.md`（DENY-总控专属）与 `.mabf-done`（Host 运行时标记）的Working-tree 变更属总控/Host 生命周期，非 SA3 越界——见 INFO-D/E。

### 红线 ⑥ HG #14 vitest 触发性自检 — ✅ 通过（结论：`vitest-package-not-triggered` 不成立）

- 本修订含 2 个 `.test.ts` 改动，均在 `packages/namespace-runtime/test/`（既有包、既有文件，非新增包）。
- 收集链：`.github/workflows/ci.yml` test job（Node 20/24 矩阵）→ `pnpm test` → 根 package.json `"test": "vitest run --typecheck"` → `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', …]` → **两文件均被收集**。
- 类型面双通道：`pnpm typecheck` 含 `tsc -p packages/namespace-runtime/tsconfig.json`（src）；gate3 `tsc -p tsconfig.typecheck.json --noEmit` 的 include 含 `packages/*/test/**/*.ts` → **测试文件类型面被覆盖**（重要：SA6 红灯实跑用了 `--no-typecheck`，测试类型正确性目前只由 gate3 静态保证——我已逐 API 核对见 §四-6）。
- 无需改 workflow yml，无 ALLOW 扩展需求。

---

## 二、SA2 六项攻击点处置核验（总控点名）

| # | SA2 项 | 处置状态 | 证据 |
|---|---|---|---|
| NIT#5 | 无 noUnusedLocals 门禁背书，须 grep 证 imports 清理 | ✅ **落位** | `grep -n "makeRefResolver\|plainObjectOf\|recordSlotOf\|projectDeclaredRootKeys\|narrowed" schema-replace.ts` → 唯一命中 :132 注释「buildTopEntries 内 makeRefResolver 环/缺名 sentinel」——这是对 buildTopEntries **内部实现**的准确描述（detached-build.ts:51 属实），非残留引用。import 面干净：detached-build.js 只进 `buildTopEntries`，resolve.js import 整行移除。**无孤儿导出**：plainObjectOf/recordSlotOf 仍被 install-verify.ts:26-27/:189-190/:197/:268-269/:299 消费（mutation.ts 有自己的私有同名函数，无关） |
| MINOR#1 | D3 恒等式作用域半句（对抗双读 → ⑥ E201-C/D 收编） | ⚠️ **未落位** | schema-replace.ts:44-46 照设计 D5 原文落地，未加「确定性以输入可重读为前提」半句。缓解：执行点 install-verify.ts:123-125 已有「对抗 Proxy 双读使第二次 build 发散但不抛时落在 (3) 的 C 支——R-5，loud 绝不假成功」的显式文档——防护在收编点有记载，seam 侧缺失属文档精度。登记为 MINOR-C（follow-up，非阻塞） |
| MINOR#2 | §4#11 作用域注（γ fixture 为限；组合非法输入域失败优先于 E204）+ 可选 T2 特征化测试 | ⚠️ **未落位** | 代码/注释零处登记该优先级翻转；T2 测试未补。静态推演确认翻转真实存在（validate 结构盲先行：环 derived × 含未声明键 root → validate ok:false 域失败，非 E204；两者皆零写入皆 loud，方向合理）。登记 MINOR-C + 动态审核重点 ③ |
| NIT#3 | 测试注释 D7 论据残留 | ⚠️ **未清理** | sa7-dynamic `:69`「顶层节点 kind=union → D7 不投影」、`:514` 用例标题「A2-union 不投影」、`:527`「（D7 边界登记）」仍以已废止 D7 为论据。注：简报 :45/:79 明示「A2-union 不投影（:514）保持」——SA6 按简报保持、SA3 有「可同步注释措辞」授权但未行使。行为结论（union loud）不依赖 D7，非阻塞（NIT-B） |
| NIT#4 | 环守卫消息引文精度 | ✅ 已按行号复核 | resolve.ts:25 实为模板 `` `结构 ref 环（${cur.name}）` ``，SA7CYC 是 γ fixture 别名——SA4 定位无碍 |
| INFO#6 / T6 | doc-runtime seam 级直调用例 | ➖ 可选未补 | R2-1 仅 E2E 锚定；①b 纵深防御受益方无 seam 级钉子。可选项，登记 follow-up |

---

## 三、验尸清单八项结论

1. **设计一致性：✅ 一致**。D1（删投影+原样喂值+次序不变）、D2（`narrowed`→`snapshot` 更名+JSDoc 新文案）、D3（⑥ 喂原样）、D4（imports 清理）、D5（七处注释面逐处核对全落）、D6/D7（JSDoc/术语逐字）、D8（双 bump）——逐条与设计文本比对无偏离。E204 γ 可达链静态复核成立：validate 结构盲（validate.ts:4-6 头注 + :602 只消费 `derived.values`）→ buildTopEntries 内 makeRefResolver（detached-build.ts:51）→ rootEntries 首行 resolve（:65）→ resolve.ts:25 环守卫 throw `DerivedInvariantError` → schema-replace.ts:189 同一 catch → E204 pre-commit-internal committed:false——分类零漂移；「非 map 形」裸 throw → E200 分类不变（detached-build.ts:47-50）。throw 源类别集合净变化论证属实（被删的投影内 resolver 与 build 内 resolver 同一 makeRefResolver 实现）。
2. **读写路径一致性：✅ 一致**。写路径（② entries 安装）与读路径（active tools read / extractYjsSnapshot）同源于同一 compile 产物与同一 snapshot；⑥ scratch（buildScratchInstall + 双侧 extract）机制化验证等价。无数据源分叉。
3. **静默失败：✅ 无新增**（修复对象本身即静默剥离——已消灭）。新代码全部分支：validate fail → issues 透传（path 指向键）、build issue → fail、probe 异型 → fail、catch → E204/E200——每条路径要么 loud 失败要么有可观察提交。
4. **降级方案：✅ 安全**。未引入任何降级/fallback；删除的正是「伪降级」（输入不匹配被包装成设计行为）。无外部服务依赖。
5. **极端攻击：✅ 安全**（静态推演）。null/非 plain/数组形 root → validate 值树拒绝 loud（旧投影 plainObjectOf→null→原样返回，行为恒等）；union 形 → 恒等（旧 :322 本就整段返回）；Record 形 → 恒等（旧 :323）；`__proto__` own 键 → validate Object.keys 枚举为未知键 loud、build mapEntries own 数据属性遮蔽（T10 锚）、⑥ 同一实现；undefined 顶层值 → present/skip 三方同规；对抗 Proxy 双读（doc-runtime 直调信任边界）→ 结局二选一且必 loud（build F7 → ok:false；或 ⑥ scratch 发散 → E201-C/D committed 诚实，install-verify.ts:123-148），且嵌套层同向量旧代码本就暴露（投影只拷顶层）——非回归，与姊妹 seam replace.ts:106 既定纪律对齐。namespace-runtime 路径 snapshot 受控 snapshotter 递归冻结 + compiled 五件套深冻结（schema-write.ts S3 `snapshotMutation`）。
6. **错误处理：✅ 完整**。§1.6 契约连锁审计：本改动是**结果联合值域收紧**（原 ok:true 的输入子集 → ok:false），非 throw/async/签名变化，不在 5 类触发清单；唯一生产 caller `runSchemaWriteSlot`（schema-write.ts:161）同步 try/catch（DocRuntimeFatalError 透传 committed/phase、未知保守 committed:true），且 `:174 if (!result.ok) return {ok:false, issues}` **先于** S5.5 installActive 与 S6 notifyDirty——R2-1 的 0 notifier / active tools 不变 / 非 fatal / schemaWrite 仍 enabled 由现有结构天然满足。`git grep replaceSchema` apps/domains 生产调用零命中——caller 审计闭合。
7. **架构评估：✅ 可行**。净变化 −19 行（删函数 + 换喂值 + 注释/文档/版本），无绕架构约束、无 FIXME、无新数据流——无退回 SA1 信号。
8. **过度设计：✅ 精简**。修复半径 = 根因半径；删代码多于加代码；无新抽象层。

**附加门禁**：§1.7 源码 grep 断言禁令——两测试文件零 `readFileSync`；全部 toMatch/toContain 命中均为**运行时行为值断言**（fatal.message 来自真实 rejection、settled.value 来自真实 API 结果、issue message 来自真实失败载荷）——R2-1 断言组（ok:false + path 定位 + 0 update/notifier + 字节不变 + 三不变 + 非 fatal）是合格的行为契约锚。R2-3 修订后测试意图保持：排队期间仍同时突变 schema（→ns-2b）与 `root.n`（→999），断言 `ok:true` + notifier 恰 1 + `read(['n'])===999` + envelope id ns-2b——「槽起点快照获胜」语义未削弱。

---

## 四、遗留清单（全部非阻塞）

| # | 级别 | 内容 | 处置建议 |
|---|---|---|---|
| NIT-A | NIT | `schema-replace.ts:2` 头注「issue #91 设计 §4 D6/D7」仍引用 round-1 设计的 D6/**D7**（provenance 引用而非语义断言；设计 D5 表未列 :2，§6.3 自检「D7 只剩废止语境」被此行轻微突破） | follow-up 顺手改为引用 rev1 设计（或「round-1 D6 + rev1 D1–D5」） |
| NIT-B | NIT | sa7-dynamic `:69/:514/:527` 以已废止 D7 为论据（SA2 NIT#3；简报明示「保持」，SA3 有授权未行使） | follow-up 注释清理（行为结论无需动） |
| MINOR-C | MINOR | SA2 MINOR#1/#2 的两处作用域注未落位（设计未采纳、SA3 照设计落地——不构成对 SA3 的驳回理由；对抗双读的防护文档在收编点 install-verify.ts:123-125 存在） | 后续票随 T1/T2 测试一并补 |
| INFO-D | INFO | 工作树 `REPORT.md` 仍是 round-1 交付报告（把「顶层声明域投影」描述为交付语义）——round-2 完成时**总控必须改写**，否则发布报告与代码矛盾 | 总控（本文件 DENY 归属即总控） |
| INFO-E | INFO | tracked `.mabf-done` 在工作树被删除（Host 生命周期标记）——发布提交时注意勿将该删除混入 SA3 语义 commit | Host 发布阶段处置 |

## 动态审核重点（交 SA7）

1. **三道门禁全绿 + R2-1 红→绿**：`pnpm typecheck`、`pnpm test`（基线 84 files / 1078 tests，含 typecheck 通道）、`tsc -p tsconfig.typecheck.json --noEmit`。特别关注 gate3——SA6 红灯实跑用 `--no-typecheck`，测试文件类型面（含 R2-1 新断言的 `getStatus().schemaWrite.enabled` / `getActiveSchema()?.id` / 本地 `ReplaceSchemaIssue.message/path`——我已逐一静态核对形状存在于 status.ts:29/:34、p0.ts:50-56）尚无任何实跑证据。
2. **保持项回归**：γ E204（经 buildTopEntries 环守卫，rejection 非 ok:false、committed=false、cause 保留）、A2-union loud、A2-嵌套 loud、AC3 快照时点（R2-3）、⑥ 嵌套 Y.Array 快乐路径、A1 四变体、persistence ENV2 全声明三 call site（:47/:129/:185）。
3. **可选动态锚（SA2 T1/T2）**：T1 doc-runtime 直调顶层 Proxy 双读取发散 → 断言必 loud（ok:false path=[k] 或 E201-C/D committed 诚实）；T2 γ 环 derived × root 含未声明顶层键 → 断言 resolved ok:false（域失败优先于 E204）——把新优先级钉为有意行为。

---

**Verdict: pass**——六项红线全过、SA2 NIT#5 核验落位、DENY 零触碰、无 CRITICAL/MAJOR；遗留 2 NIT + 1 MINOR + 2 INFO 全部为注释精度/登记/总控事务类，不构成回流 SA1/SA3 的必要性。SA7 可进入动态验证（重点见上）。
