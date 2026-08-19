# SA4 静态验尸报告 — 验证型交付（Issue #9）

**Date**: 2026-08-19
**评审对象**: SA3 交付 commit `22b6fcd`（§3.1 新#15/新#16 落地 + HG9 bump `0.1.2 → 0.1.3`；改动恰 2 文件 +2 行级：`packages/vfsl/package.json` 1 行、`packages/vfsl/test/parse-vfsl-cycle-detection.test.ts` +14/−2）

> **取证方式**：worktree 只读复核 + 独立实跑（三绿复跑 / fixture 三源求值比对 / 锚点码点复算 / MU 注入点逐行读码），全部证据本人自取，不采信转述。测试执行按 SKILL 规范起 `setsid` 独立后台进程（`/tmp/sa4.log`，EXIT1/2/3 全 0，跑毕 `packages/vfsl/src/` diff 清零）。

---

## 一、审核结论（SKILL 八项）

| # | 项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 设计一致性 | ✅ 一致 | §3.1 冻结规格 ↔ 落地代码 **md5 逐字节相同**（见 §二.1）；落位/头注释/既有断言零改动全部合规；HG9/D3/D4/D2 逐项落实 |
| 2 | 读写路径一致性 | ✅ 一致（N/A 面） | 交付仅测试 + 版本行：全部断言经公共接缝 `parseVfsl` 读写同一返回值，无数据源分叉面；AC4 roundtrip 的 stringify/parse 同源 |
| 3 | 静默失败 | ✅ 无 | helpers（`expectOk`/`expectSingleIssue`/`aliasNode`/`objectFieldsOf`/`fieldNode`）对前提不满足均 loud-throw 且内联诊断载荷（测试文件 :36/:50/:85/:99/:111）；`expectSingleIssue` 锁 `issues` 恰 1 条防吞错；零 `.skip/.todo/.only`（grep 计数 0） |
| 4 | 降级方案 | ✅ 无降级 | 交付无 fallback 路径；设计 §7 唯一条件让步（CI/check.sh 以总控裁决为准）是显式上报，非降级掩盖 |
| 5 | 极端攻击 | ✅ 安全 | 六边源位独立推演各有专属红路径（见 §三.2）；新用例锚点对聚合并列鲁棒（见 §三.3）；锚点码点列独立复算落位再入记号 `A` |
| 6 | 错误处理 | ✅ 完整 | ok:true / ok:false 两分支均断言到三字段形状与 1 起基准；`expectIssueAt` 锁码+行+列三元组 |
| 7 | 架构评估 | ✅ 可行 | 验证型交付路径经 supervisor 裁定 + SA2 R2 确认前提成立；本次独立复核：spec §4 五边源位（v1-spec.md:333）现全部有负例锚定，台账完整性主张属实，无触发退回 SA1 信号 |
| 8 | 过度设计 | ✅ 精简 | 交付 = 10 行测试代码 + 1 行版本号 + 1 行注释同步，与「已实现未锚定补回归锁」的目标严格成比例，零新抽象 |

---

## 二、任务专项核对（简报指定重点 ①~⑥）

### 1. §3.1 冻结规格 ↔ 落地逐字一致性（重点①）— ✅

| 核对项 | 结果 |
|---|---|
| 代码块逐字比对 | 设计 :165-175 与落地 :159-169 归一缩进后 **md5 相同**（`f430b42388aa4466bb2b11bb04fb1e6e`）——断言、字符串输入、锚点、消息期望零偏离 |
| 落位 | 两 it 块位于 `AC2 — 互引用环` describe（:133-170）内、第 4 个 it（Record 值位 :153-157）之后依序追加，恰为第 5/6 个 it ✅ |
| 头注释二词 | :19 恰追加「Record 键位环 / 联合成员位环」于「Record 值位环」后，唯一被删除/修改的原有行，属 §3.1 明文授权的「注释行同步」✅ |
| 既有 14 条零改动 | `git diff 6178994 HEAD -- <test>` 唯一 `-` 行即头注释该行；6178994..HEAD 间仅 22b6fcd 触碰该文件 ✅ |
| 锚点独立复算 | 新#15 `type A = Record<A, string>;` 第 17 码点列 = `A`（t1y2p3e4␣5A6␣7=8␣9R10e11c12o13r14d15<16**A17**）✅；新#16 第 2 行第 10 码点列 = `A`（t1…B6␣7=8␣9**A10**）✅——两锚均落 spec §4「再入引用记号」语义位 |
| 16 条计数 | AC1×3 + AC2×6 + AC3×4 + AC4×3 = 16；`expectIssueAt`×9 / `expectSingleIssue`×9 / `toContain`×6 与设计 A10~A13 计数逐一相符；vitest 实跑输出 `Tests 16 passed (16)` |

### 2. HG9 版本行唯一性与 D3 零依赖（重点②）— ✅

- `git log -L 3,3:packages/vfsl/package.json`：版本行历史 `0.1.0→0.1.1(#5 2b781a4)→0.1.2(#7 ef1a4ea；#6 平行分支同值，与设计 §7 P7 口径注记一致)→0.1.3(本任务 22b6fcd)`——**本任务恰一次、恰一行**，patch 语义与先例一致；
- 当前 `package.json`：`"version": "0.1.3"`，**无 `dependencies` 字段**（D3 零运行时依赖红线），`devDependencies` 仅 typescript+vitest 与 base 零差异；`exports`/`scripts` 未动。

### 3. D4 src 零 diff（重点③）— ✅

`git diff --name-only origin/refactor/…-synthetic HEAD -- packages/vfsl/src/` = **0 文件**；三绿实跑后复验仍为空；工作区 `packages/vfsl/` 干净。零产品改动这一验证型交付定义性属性保持。

### 4. §10 ALLOW/DENY 合规（重点④）— ✅ 零 scope-creep

- base..HEAD 实际文件集恰 6 个：`packages/vfsl/package.json`、`packages/vfsl/test/parse-vfsl-cycle-detection.test.ts`（均 ALLOW）、4 个 `wiki/raw/task_vfsl-parser-cycle-detection*.md`（ALLOW + 白名单）；comm 比对 creep 集**为空**；
- BLACKLIST（npm/yarn lock、.DS_Store、TASK.md、*.bak）零命中；DENY 六基线测试文件 / `docs/vfsl/v1-spec.md` / `CONTEXT.md` / `pnpm-lock.yaml` / src 均未入 diff；`.github/workflows/ci.yml` 未动（无需动，见下）。

### 5. HG14「1.4 vitest 触发性自检」（重点⑤）— ✅ 已接通

- 触发链逐跳闭合：`.github/workflows/ci.yml` `test` job（`pull_request` 触发，:38-39 `run: pnpm test`）→ 根 `package.json` `test = vitest run` → 根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts']` ⊇ `packages/vfsl/test/parse-vfsl-cycle-detection.test.ts`。无 `--filter`/`projects` 排除面，issue #289 的「workspace 包未被 CI vitest 覆盖」失效模式在本仓库结构（单一 glob 收集全部 workspace 测试）下不可构造；
- 本地同链路独立实跑：单文件 `Tests 16 passed (16)`、全量 `7 files / 101 passed (101)`、`pnpm typecheck` EXIT=0（三绿，`/tmp/sa4.log` EXIT1/2/3=0）。**结论：vitest-package-not-triggered 不成立，测试已接通且计数可见。**

### 6. HG11 wiki 产出完整性（重点⑥）— ✅

brief / design / sa2_review / dispatch 四档案在案且内容闭合；本报告补齐 sa4_review；sa7_report 按 §6 协议待 SA7 产出（非本阶段缺口）。

---

## 三、静态攻击记录

### 1. §1.7 源码 GREP 断言禁令 — 零命中

改动测试文件 `readFileSync`/`readFile` 计数 **0**；全部 `toMatch`（:59/:70，锁 `VFSL-E\d{3}: ` 冻结前缀）/`toContain`（×6，环路径）作用于 `parseVfsl` 运行时返回的 `issue.message`——纯运行时行为断言，文件头注「无源码 grep」声明属实。

### 2. 六边源位独立推演（对 §4 M7 表的再验证）

逐一构造「walk 单分支删除」的失效路径：`object.fields`(:45)→新#2 唯一引用在字段位红 / `union.members`(:48)→新#16 红 / `array.element`(:51)→新#1 唯一引用在 `A[]` 元素位红 / `record.key`(:54)→新#15 红 / `record.value`(:55)→新#7 的 B 边仅经 Record 值位红 / `marker.arg`(:58)→新#3 唯一引用在标记实参红——**六分支各有专属红路径，spec §4（v1-spec.md:333）五边源位负例锚定主张经我独立推演成立**，测试对「环拒绝行为静默丢失」家族（P10/P11 证实的 `ok:true` 失效模式）均有 `expectSingleIssue`（期望 ok:false）拦截。

### 3. 新用例锚点鲁棒性（极端条件攻击）

新#15/新#16 输入即使意外触发同位形状候选（E306/E309），聚合器 `semantic.ts:182-185` 的 `(line, column, code)` 序使 106 号码胜出——断言不依赖「恰好只有一个候选」的脆弱前提；`expectSingleIssue` 的恰 1 条由聚合器结构保证（`candidates[0]` 单点返回）。新#16 两联合成员均容器形（`A`→`{x:B}`、`{y:string}`），无 E309 干扰面。

### 4. fixture 三源同一性独立复现（P1 复核，含求值层方法）

按设计 §2.2 P1 补注方法（先求值模板字面量再逐字节 diff）：文件内 AC3/AC4 两副本**求值+trim 后与 `docs/vfsl/v1-spec.md` §10 ```vfsl 块逐字节 IDENTICAL**；census 复算 `/**` 恰 7 条、别名序 `AssetId→Audit→AssetEntity→Attachments→AssetsDoc`、源层 `\\\\-`（求值后 `\\-` 双反斜杠）在位——与 SA1 P1/P3/P6、SA2 §0 独立复核三方一致。本人抽验亦踩到并确认了「前导换行须 trim、源码层直接 diff 必假阴性」的方法警示（设计攻击点 8 补注有效）。

### 5. SA7 注入点行号抽验（§6.2 矩阵可执行性 — SA4 读码侧）

| 注入点 | 实读 | 判定 |
|---|---|---|
| MU-1/MU-3 `semantic.ts:164` | `candidates.push(candidate(makeIssue(ErrCode.E106, …, ref.pos.line, ref.pos.column)…))` 恰在 :164，`ref.pos` ×2 在位；`root`（:146 循环）作用域覆盖 :164 | ✅ 可执行 |
| MU-2 `:163` | `const path = […stack.slice(startIdx)…, ref.name].join(' → ')` 恰在 :163 | ✅ |
| MU-5 `:160` | `if (gray.has(ref.name)) {` 恰在 :160，单条件改写为 gray∪black 语法上直接可注入 | ✅ |
| MU-7 `:54` | `walk(t.key, visit);` 恰在 :54 | ✅ |
| MU-11 `tokenizer.ts:176` | `pending.push({ body: text.slice(open + 3, close), … })` 恰在 :176，`.trim()` 配方即改即得 | ✅ |
| MU-19 `:183`/`:185` | 比较器三元链在 :183、`candidates[0]` 取首在 :185（排序 :182-184） | ✅ |
| P10 机制 | `shapes.ts:379` 环名预填 ⊥、`checkE306:573` 仅 `=== false` 入池 | ✅ 实读闭合 |

七条 MU 注入点行号**全部照单可执行**，SA7 无寻点落空风险。

### 6. R3 读码核对（设计 §5 R3 指派 SA4）— ✅

`ir.ts` 全部 IR 类型（VfslModule/VfslAlias/VfslField/VfslType 九 kind 判别联合）**零 pos/line/column 字段**；`VfslIssue` 携带行列属 issues 通道（#5 冻结契约），不入 IR。头注 :7-9 明示「IR 不携带行列（位置是诊断信息，进 IR 会让内容哈希对排版敏感）」——设计承诺在码，R3 残余按原裁定「接受，登记为实现纪律」复核成立。

---

## 四、勘误登记与护栏注记（不阻塞）

| # | 项 | 内容 | 处置 |
|---|---|---|---|
| E-A（SA2 R2.4 移交） | 设计 §4 M8 注入点行号 | 本人实读确认：`parser.ts` `claimDocs` 的 return 语句在 **:155**（:157 为空白行），设计写 `:157` 属笔误。无执行后果（M8 不在 §6.2 抽样矩阵，SA7 不按此寻点）；描述文字本身准确 | 登记在案；SA1 下次自然触碰设计文档时改 `:155` 即可，无需为此开修订轮 |
| E-B（SA2 R2.4 移交） | 设计 §1.2 措辞 | 「抽样实跑 7 条（覆盖 §4 全部结论类型）」中「全部结论类型」与 §4 三分类（必红/联合锚定/存活）字面不对齐——存活类（M20/R3）按 §5 裁定归 SA4 静态（本报告 §三.6 已承接）。无执行后果 | 登记在案，措辞层面收敛即可 |
| N-1（SA4 新增护栏注记） | 工作区未跟踪 `TASK.md` | **当前不在交付 diff 内（无违规）**；但 SKILL BLACKLIST 有 PR #253 前科（issue-runner runtime 文件混入 commit）。完成事务/后续 commit 前请总控确保其保持未跟踪或删除，勿入任何 commit | 提请总控注意（非 reject 事由） |

---

## 五、动态审核重点（交 SA7）

1. **§6.2 七条 MU 逐条实跑**：注入点行号已经 SA4 静态验讫全部可执行（§三.5 表）；期望观测按设计修订 1 栏逐条比对，**MU-19 双跑法差异报告（单文件 16 全绿 vs 全量 r3×2+sa7s×5 红）为关键证据点**；MU-2/MU-7 的「预期内不红/单红」照实登记（HG12）。
2. **墙钟政策**：每注入全量跑带 `timeout 300` 外层；超时 = FAIL-挂起如实入报并还原，不计全绿（MU-5 原配方挂起教训在册）。
3. **清零门禁**：逐注入 `git diff --name-only -- packages/vfsl/src/` 为空方入下一条；矩阵终了 `git status` 零残留 + §6.1 标准回归复跑。
4. **HG14 vitest 触发证据段落**：实际运行输出含 16 条计数可见（SA4 已静态确认触发链闭合 + 本地 16/16 实跑，SA7 补交付 commit 时点证据）。
5. 若复算 fixture 同一性，沿用「求值模板字面量 + trim 后逐字节 diff」方法（源码层直接 diff 必假阴性，本次 SA4 抽验再次复现该坑）。

---

## 六、verdict 依据小结

验证型交付的两件交付物（16 条 AC 回归锁 + HG9 bump）均按 SA2 R2 定稿设计**零偏离落地**：规格逐字一致（md5 级）、既有 14 条断言字节零改动、src 零 diff、scope 零越界、依赖零新增、三绿独立复现、五边源位负例锚定主张经独立推演成立、SA7 全部注入点照单可执行。两处 LOW 勘误（E-A/E-B）与一处护栏注记（N-1）均无下游执行路径，不构成 reject 事由。SA3 交付质量与设计冻结精度一致，放行 SA7 动态验证。

**Verdict**: pass
