# SA7 动态验证报告 — SchemaSource 接缝与脚手架文件格式（Issue #25 / F1）

**Date**: 2026-08-20
**Verdict**: **pass**（全量亲跑零回归、5 条 AC 各有驱动真实公共 API 的运行时证据、SA4 R1/R2 交代项全部闭环或如实分类环境阻塞、护栏 diff 零漂移；未发现任何新缺陷。）

**被验对象**: worktree `/home/wangjian/nomicore-fix-issue-25` 分支 HEAD `a64f282`（= feat 主实现 `6097691` 恰 11 文件 + fix `a64f282` 仅 `packages/vfsl/src/schemasource.ts`；基点 `55a55c0`）。
**前置**: SA4 R2 终态 verdict = **pass**（Step 0 校对通过，本报告在其上独立动态验证；SA4 R1 唯一阻塞项 F1 已由 `a64f282` 消除，本报告以运行时证据复核）。
**方法**: 一切验证实跑——后台独立进程（setsid nohup + 退出码留证）跑全量 typecheck/vitest；/tmp 独立探针（node 24.13.0 `--experimental-transform-types` + `.js→.ts` resolve 钩子）**直驱真实公共入口 `packages/vfsl/src/index.ts`**（`FileSchemaSource`/`assertVfslDialect`/`SchemaSourceError`/`parseVfsl` 均经消费方真实 import 面取得），34 场景全部针对 mkdtemp 临时目录内联生成的真实文件与真实文件系统，**零 mock、零 worktree 生产代码改动**。

---

## 0. 亲跑验证记录（SA7 独立进程，退出码留证）

| # | 命令 | 结果 | 退出码 | 日志 |
|---|------|------|-------|------|
| V1 | `pnpm typecheck` | 0 错误 | **0** | `/tmp/sa7-full.log` |
| V2 | `pnpm exec vitest run`（全量） | **Test Files 17 passed (17) · Tests 356 passed (356)**（含 `schemasource-seam.test.ts` 13 绿、`domains-scaffold.test.ts` 2 绿 + 空集 notice `[domains-scaffold] 0 domain schemas found` 打印在输出中） | **0** | `/tmp/sa7-full.log` |
| V3 | SA7 探针 `/tmp/sa7-probe/probe.mts`（34 场景直驱真实公共 API） | **TOTAL 34 \| PASS 34 \| FAIL 0**（另 3 条 OBSV 取证，见 §4/§5） | **0** | `/tmp/sa7-probe.log` |
| V4 | `pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false`（ci.yml `Domain scaffolds check` 同款命令、真实 repo 根） | Test Files 1 passed · Tests 2 passed，空集 notice 可见 | **0** | `/tmp/sa7-ci.log` |
| V5 | `pnpm exec vitest run packages/vfsl/test/DOES-NOT-EXIST.test.ts --passWithNoTests=false`（防删文件假绿盲区复验，SA4 V3 独立复现） | `No test files found, exiting with code 1` | **1**（盲区消除成立） | `/tmp/sa7-ci.log` |

V2 统计与简报/SA4 预期逐字一致（17 文件 / 356 用例 = 既有 342 + SA6 13 + scaffold 1→2 用例口径），`a64f282` 后用例数与 SA4 R2 复跑完全相同——零回归、锚点零变化。

进程纪律：全部测试命令按 skill 起独立后台进程（`setsid nohup … & disown`，退出码写文件）；本票为纯库单测（fixture hermetic、无端口/无服务/无网络），按 CLAUDE.md 纪律未做任何 `fuser -k` 清场，亦无未知进程被杀。

---

## 1. AC 逐条运行时证据（全部驱动真实公共 API）

| AC | 运行时证据（探针场景 → 实测） | 结论 |
|----|------------------------------|------|
| **AC1** 接缝形状：async、完整信封、list 枚举 | S1：`load()/list()` 均 `instanceof Promise`（async from day one）；S2：信封 `Object.keys` 排序后恰 `id,lang,text,version`（完整信封非裸文本、不夹带）；S3：`list()` 枚举多域多文件 `[a@1, b2@1, b@1, t@1]`；S4：`index.ts` 公共面 3 值导出齐（消费方真实 import 面） | ✅ |
| **AC2** 三码响亮拒绝（结构化、非静默兜底） | **三码分类逐码实测**：S5/S6/S7 逐键缺（lang/id/version）与 S8 三键全缺 → `missing-directive`（`instanceof SchemaSourceError`、`kind='schema-source'`、消息含缺失键名+文件路径，如 `头部缺少指令: @id（…/domains/evil/schema.vfsl）`）；S9 `lang=yaml`、S10 `version=2`、S11 `version=abc`（NaN 路径）→ `dialect-mismatch`（消息含期望 vs 实际）；S12 未知 id → `unknown-id`（附 `err.id` 上下文）；S8b/S14 一坏全拒：损坏树 `list()` 整体 reject 且消息指向**排序首个**损坏文件；全部走 Promise rejection，无一 resolve 降级 | ✅ |
| **AC3** 带头部 `.vfsl` `parseVfsl` 直接 ok（trivia、零预处理零微格式） | S15：`parseVfsl(env.text)` → `ok=true`，且 `env.text` 以 `// @lang: vfsl` 开头（**未剥头、零预处理**——行注释是方言 trivia 的活链路证明）；S16：盘上 utf8 原文与信封 text 全等且同样 `ok=true` | ✅ |
| **AC4** text 逐字节一致 + id/version 解析自头部 | S17：含 BOM + CRLF + 多字节（中文/emoji）+ 行尾无换行的刁钻文件，`Buffer.compare(Buffer.from(env.text,'utf8'), readFileSync(path)) === 0`（80B 逐字节一致，内容哈希可直接）；S18：`env.id='t@1'`、`env.version=1`（`typeof 'number'`）、`env.lang='vfsl'` 均解析自头部 | ✅ |
| **AC5** CI 步骤：全领域脚手架解析 + 信封校验 | V4：ci.yml `Domain scaffolds check` 步骤**同款命令**在真实 repo 根实跑 2 用例绿 + 空集 notice 打印；V5：`--passWithNoTests=false` 对不存在文件 exit 1（步骤被删/改名不会静默假绿）；S19/S20：同一消费链（`new FileSchemaSource(repoRoot)` → `list()` → 逐 id `load` → `parseVfsl` ok）在仓根活链路通过（domains/ 不存在 → 合法空集，零迭代 pass）；ci.yml 步骤原文核对（ci.yml:43-44）。GitHub Actions matrix 上的真跑：**环境阻塞**（见 §2） | ✅（本地活链路）/ ⛔ CI 远端（阻塞，交总控） |

---

## 2. SA4 交代项闭环核查（R1 §5 + R2 §5 清单逐项）

| # | SA4 交代项 | SA7 落实 | 状态 |
|---|-----------|---------|------|
| 1 | **F1 修复后回归**（S1a/S1b 形状应落 missing-directive + 全量 vitest） | S21：`/* note */ type ROOT = {};` 后伪 `// @id: evil@1` → `load('evil@1')` = **missing-directive**（劫持死，消息 `头部缺少指令: @id（…/domains/evil/…）`）；S22：跨行闭合行 `*/ type ROOT = {};` 同形状同落点；S23a/S23b：CRLF/BOM 变体同样消除；S24 对照：三键齐全的「块注释前缀代码行」文件照常 RESOLVED（**无过度终止回归**）；S26：F1 树 `list()` 一坏全拒；V2 全量 356 绿、用例数不变 | ✅ 闭环（独立证据与 SA4 R2 A1–A4 一致） |
| 2 | **CI 活链路**（GH Actions matrix node 20/24 上 `Domain scaffolds check` 真跑 + 空集 notice） | 本地等价物已做（V4 命令级 + S19/S20 链路级 + C3 步骤原文）；远端 CI run **不存在**——分支未 push（总控边界：SA7 不负责 push/建 PR/宣称 CI 绿） | ⛔ **环境阻塞，交总控**（push 后由 CI/check.sh 出证，建议总控收尾时摘录 matrix 两 node 版本上该步骤日志） |
| 3 | **readdir d_type**（runner 文件系统对 withFileTypes 返回真实类型） | S27：本地实跑——指向 **domains 盘外**目录的符号链接 `domains/linkout → <tmp>/outside/` **不入册**（`outside@1` 不可达，`d.isDirectory()` 对 DT_LNK 为 false）、符号链接文件 `link.vfsl` 不跟随（`real@1` 无重复）；本机 `/tmp`=tmpfs、仓在 ext4（stat -f 实测），d_type 均真实。CI runner（ext4/overlayfs）上的同款验证随 #2 一并阻塞 | ✅ 本地闭环 / 远端随 #2 阻塞 |
| 4 | **扫描竞态**（二级 readdir 遇目录被删 → 原生 ENOENT 冒泡，不得误当 unknown-id） | S33 竞态锤：250 次 `list()` × 扫描窗内删目录（60 域 fixture、0–4.4ms 延迟扫描），**捕获原生 ENOENT ×246、unknown-id 误分类 ×0、其他 ×0**（4 次删除未落窗内正常 resolve）——冒泡语义直接运行时证实；仓内唯一消费方 `domains-scaffold.test.ts` 对原生 rejection 表现为测试红（响亮），无任何 unknown-id 转换路径 | ✅ 闭环（超出 SA4 预期的直接证据） |
| 5 | **非 UTF-8 文件**（低优先；utf8 读入 U+FFFD 使「逐字节一致」失真） | S34 取证：含非法 UTF-8 字节（0xFF 0xFE 0x00 0x81）的文件 load 成功、text 含 U+FFFD、`Buffer.compare ≠ 0`——与 SA4 判断一致（设计 §3.2 固有，硬保证属后续票），维持备案非阻塞 | ✅ 如实取证，维持备案 |
| 6 | **F5 备案确认不阻塞**（夹心代码行仍按 trivia） | S25：`/* a */ type X /* b */` 后伪 `@id` → `RESOLVED(sandwich@1)`——与 SA4 R2 实测**逐字一致**。非阻塞理由成立：形状做作（一行内块注释包裹代码非自然写法）、仓内 `domains/` 不存在（实测 `ls domains` → No such file）、存量 356 用例无此锚点。裁决权在 SA1（收紧建议：剥离全部块注释跨度后判残留，且**不可**用「首个闭合符之后」否则纯多块注释行误终止） | ✅ 确认维持 LOW 备案 → SA1 |
| 7 | **CI 触发性 flag 行为**（`--passWithNoTests=false`） | V4（实文件 + flag → 2 绿 exit 0）+ V5（不存在文件 + flag → exit 1），双行为独立复证；与 SA4 V3 结论一致 | ✅ 闭环 |

### Spec / vitest 触发证据（skill Step 3/Step 4）

- **Spec（E2E）**: 本票设计无新增/改动 `*.spec.ts` → Step 3 触发条件不成立，N/A。
- **vitest**: 设计含 2 个新增 `*.test.ts`（`schemasource-seam.test.ts`、`domains-scaffold.test.ts`），均落 vitest include `packages/*/test/**/*.test.ts`（`vitest.config.ts:5`）→ `pnpm test` 全量自动跑到（V2 输出两文件均在 17 文件清单中 ✓ 触发且通过）；ci.yml 另有显式点名步骤双保险（V4/C3）。**CI runner 上的远端触发性证据**：⛔ 环境阻塞（同 §2 #2——分支未 push，无 run 可摘录；SA7 不伪造 CI 绿）。**verdict（本地）**: ✅ all-vitest-packages-triggered；远端证据缺口已如实上报总控。

---

## 3. 护栏 diff 零漂移（DENY 清单核对，对基点 `55a55c0`）

| # | 核查 | 结果 |
|---|------|------|
| G1 | `git show --stat 6097691` | 恰 **11 文件**，与设计 §12 ALLOW LIST 11 项一一对应（8 代码/配置 + 3 wiki/raw） |
| G2 | `git diff 6097691..a64f282 --name-only` | 仅 `packages/vfsl/src/schemasource.ts`（ALLOW LIST 内）；累计 `git diff 55a55c0..HEAD --stat` 仍恰 **11 文件**（+2044/−12） |
| G3 | 引擎十二内部件（tokenizer/parser/semantic/ir/derived/evaluate/validate/resolve/shapes/pattern/xml/errors.ts） | **0 触碰** |
| G4 | `packages/vfsl/tsconfig.json`、`tsconfig.base.json`、`vitest.config.ts`、`pnpm-workspace.yaml`、`domains`、`docs`、`tests/acceptance` | **0 触碰** |
| G5 | 黑名单 `package-lock.json`/`yarn.lock`/`*.bak`/`TASK.md` | **0 触碰** |
| G6 | 提交内含 `TASK.md`/`.mabf-bg`/`.mabf-git`？ | **无**（工作树中的 M/?? 均为调度器运行时文件与 SA4 报告，未入 commit） |
| G7 | `CONTEXT.md`、`.scratch*` | **0 触碰** |

---

## 4. SA7 探针全文输出（V3，2026-08-20 亲跑，逐字摘录）

```
PASS S1 load/list 返回 Promise(AC1 async from day one) :: load()/list() 均 instanceof Promise
PASS S2 信封恰四键 {lang,version,id,text}(AC1 完整信封非裸文本) :: keys=[id,lang,text,version]
PASS S3 list() 枚举多 .vfsl id(AC1 list 枚举) :: list=[a@1, b2@1, b@1, t@1]
PASS S4 index.ts 公共面:FileSchemaSource/assertVfslDialect/SchemaSourceError 导出 :: 3 值导出齐(typeof function)
PASS S15 parseVfsl(env.text) ok:true——头部指令注释是 trivia、零预处理零剥头(AC3) :: ok=true(text 以头部指令开头,未剥头)
PASS S16 parseVfsl(盘上 utf8 原文) ok:true(AC3 与 AC4 的交点) :: ok=true 且与信封 text 全等
PASS S17 text 与文件原文逐字节一致(BOM+CRLF+多字节,Buffer.compare=0)(AC4) :: Buffer.compare=0(80B)
PASS S18 env.id/version/lang 解析自头部(version typeof number)(AC4) :: id=t@1 version=1(number) lang=vfsl
PASS S5 缺 lang → missing-directive(AC2) :: reject schema-source/missing-directive id='nl@1' path~domains/nolang/schema.vfsl :: 头部缺少指令: @lang（…/domains/nolang/schema.vfsl）
PASS S6 缺 @id → missing-directive(AC2) :: reject schema-source/missing-directive id='noid@1' path~domains/noid/schema.vfsl :: 头部缺少指令: @id（…/domains/noid/schema.vfsl）
PASS S7 缺 version → missing-directive(AC2) :: reject schema-source/missing-directive id='nv@1' path~domains/nover/schema.vfsl :: 头部缺少指令: @version（…/domains/nover/schema.vfsl）
PASS S8 三键全缺 → missing-directive 非静默(AC2) :: reject schema-source/missing-directive id='noall@1' path~domains/noall/schema.vfsl :: 头部缺少指令: @lang、@id、@version
PASS S8b 一坏全拒:list() 对损坏树 reject(AC2/AC5) :: reject schema-source/missing-directive path~domains/noall/schema.vfsl
PASS S9 lang=yaml → dialect-mismatch(AC2) :: reject schema-source/dialect-mismatch id='y@1' :: 方言不符: 期望 lang='vfsl'、version=1，实际 lang='yaml'、version=1
PASS S10 version=2 → dialect-mismatch(AC2) :: reject schema-source/dialect-mismatch id='v2@1' :: 实际 lang='vfsl'、version=2
PASS S11 version=abc → dialect-mismatch(AC2) :: reject schema-source/dialect-mismatch id='va@1' :: 实际 lang='vfsl'、version=NaN
PASS S12 未知 id → unknown-id(AC2) :: reject schema-source/unknown-id id='ghost@1' :: 未知 id: 'ghost@1'（domains/ghost/ 下无 schema 文件）
PASS S13 assertVfslDialect:ok 不抛 / yaml 抛 dialect-mismatch(§5 层 2) :: ok 不抛 / yaml 抛 dialect-mismatch
PASS S14 好坏混栽 list() reject 且消息指向损坏文件(排序首坏 noall) :: reject schema-source/missing-directive path~domains/noall/schema.vfsl
PASS S19 仓根 list()=空集(domains/ 不存在,F1 先于 G 的设计内状态)(AC5) :: list()=[]
PASS S19b 仓根 load → unknown-id(非静默空信封) :: reject schema-source/unknown-id id='x@1'
PASS S20 接缝消费链(list→load→parseVfsl)在仓根活链路通过(AC5) :: list()=[] → 零迭代(与 CI Domain scaffolds check 同一链路)
PASS S21 [F1 回归]S1a 形状 load(evil@1) → missing-directive(劫持死) :: reject schema-source/missing-directive id='evil@1' path~domains/evil/schema.vfsl :: 头部缺少指令: @id
PASS S22 [F1 回归]S1b 形状 load(evil2@1) → missing-directive :: reject schema-source/missing-directive id='evil2@1' path~domains/evil2/schema.vfsl
PASS S23a [F1 回归]CRLF 变体 → missing-directive :: reject schema-source/missing-directive id='evilcrlf@1' path~domains/evilcrlf/schema.vfsl
PASS S23b [F1 回归]BOM 变体 → missing-directive :: reject schema-source/missing-directive id='evilbom@1' path~domains/evilbom/schema.vfsl
PASS S24 [F1 对照]三键齐全会块注释代码行文件照常 RESOLVED(无过度终止) :: RESOLVED(clean@1)
OBSV S25 [F5 备案确认]夹心形状 /* a */ type X /* b */ 后伪 @id 仍被识别(与 SA4 R2 实测一致) :: RESOLVED(sandwich@1)——做作形状、domains/ 仓内不存在、无锚点,维持非阻塞备案 → SA1
PASS S26 [F1 回归]F1 树 list() 一坏全拒(消息含 @id 缺失) :: reject schema-source/missing-directive path~domains/evil/schema.vfsl
PASS S27 符号链接目录(→盘外)/文件不入册(I1 不跟随;本地 fs d_type 真实生效) :: list=[real@1](盘外 outside@1 不可达;real@1 无重复=link.vfsl 未跟随)
PASS S28 隐藏目录内 id → unknown-id :: reject schema-source/unknown-id id='hid@1'
PASS S29 顶层散放 .vfsl → list() 原生 Error reject(含路径+ADR 0005 提示) :: 原生 Error:[vfsl] 布局错误: domains/ 顶层散放 schema 文件（…/domains/stray.vfsl）——领域 schema 应位于 domains/<domain>/（ADR 0005 §5）
PASS S29b 散放不阻塞正常 id load :: RESOLVED(real@1)
PASS S30 现扫无缓存恒新鲜(增域即现、删域即失) :: list 长度 4 → 5 → 4,late@1 出现后消失
PASS S32 并发 30×(load+list) 无撕裂 :: 60 并发全 fulfill
OBSV S33 [SA4 #4 竞态锤]250 次列扫 × 窗内删目录 :: 捕获原生 ENOENT ×246(冒泡非降级);unknown-id=0;other=0;resolved=4
OBSV S34 [SA4 #5]非 UTF-8 字节经 utf8 读入成 U+FFFD,text 与盘上字节失真(设计 §3.2 固有) :: resolve 成功;text 含 U+FFFD=true;Buffer.compare=0?false——SA4 已判如需硬保证属后续票,维持备案

TOTAL 34 | PASS 34 | FAIL 0
```

（`/tmp` 易失，关键输出已全文贴入；探针脚本 `/tmp/sa7-probe/probe.mts` + resolve 钩子 `hooks.mjs`——`.js→.ts` 说明符映射属测试装载层路径解析，非行为 mock，等价于 vitest/esbuild 的装载行为。技术注记：`--experimental-strip-types` 不支持 `parser.ts:70` 的参数属性语法，故用 `--experimental-transform-types`（仍为类型层转换，行为是真实实现）。）

**探针迭代透明记录**：探针开发中出现过 3 次探针侧预期/fixture 错误（非实现缺陷），每次实跑暴露后修正：(a) list 一坏全拒的消息指向**排序首个**损坏目录（`noall` 而非我最初猜的 `nolang`）——实测行为确定性正确；(b) 我的 AC3 fixture 正文引用了未定义的 `Info` 类型致 parseVfsl 红盘——改 `type ROOT = {};` 后绿，反证 parseVfsl 真在解析；(c) S27 初版符号链接误指向 domains 内真目录、散放文件混入扫描 fixture——拆独立 fixture 后语义成立。三次「红」均为探针 bug，实现行为全部正确。

---

## 5. 缺陷清单

**无阻塞/非阻塞新缺陷。** SA4 备案面（F2/F3/F4/F5 + 非 UTF-8）本报告全部独立复核，状态与 SA4 R2 一致，维持 LOW 备案 → SA1，不构成本票阻塞。

| 项 | SA7 独立复核结果 | 分级 |
|----|----------------|------|
| F5 夹心代码行仍识别 | S25 实测 `RESOLVED(sandwich@1)`，与 SA4 R2 逐字一致；触发需做作形状、仓内无 domains/、无测试锚点 | LOW 备案 → SA1（维持） |
| 非 UTF-8 失真 | S34 实测 U+FFFD 替换、字节不一致；设计 §3.2 固有 | 后续票裁决（维持） |
| F2/F3（值含冒号 regex 二义 / 空 @id 不计重复） | 本轮未重开（SA4 已静态+探针双源定形，规格二义属 SA1 文字裁决） | LOW 备案 → SA1（维持） |
| F4 符号链接散放不可见 | 与 I1 不跟随方向自洽（S27 反证链接目录亦不入册，行为一致） | LOW 备案（维持） |

## 6. 环境阻塞汇总（交总控）

1. **GitHub Actions 远端活链路**（SA4 交代 #2/#3 的 CI 半边 + skill Step 4 远端触发性摘录）：分支未 push（SA7 纪律不 push/不建 PR/不宣称 CI 绿）→ 无 run 可摘录。本地等价证据已 maximal（V2/V4/V5 + C3 + S19/S20）。**建议总控**：push 后摘录 matrix node 20/24 两 run 的 `Domain scaffolds check` 步骤日志（应各见 2 tests passed + 空集 notice）。
2. 其余无阻塞：无端口/服务依赖，无并发环境冲突。

## 7. Verdict

**pass。**

- 全量亲跑：typecheck 0 错（exit 0）+ 17 文件/356 用例全绿（exit 0），与 SA4 R2 复跑逐字一致（零回归）；
- 5 条 AC 各有驱动真实公共 API 的运行时证据（§1），AC2 三码分类、AC4 逐字节一致、AC3 parseVfsl-ok 均以错误码级/字节级实测落定；
- SA4 R1/R2 交代项：5/5 本地闭环或如实分类（#2/#3 远端半边环境阻塞交总控，#4 竞态以 246 次原生 ENOENT × 0 误分类的直接证据闭环）；
- 护栏 diff 零漂移（11 文件精确、DENY 全空）；
- 无新增缺陷；SA4 verdict=pass 的基础上 SA7 独立验证亦 pass，不上发不下发之外的任何改写。
