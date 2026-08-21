# SA2 攻击评审报告 — SchemaSource 接缝与脚手架文件格式（Issue #25 / F1）

**Date**: 2026-08-20
**Verdict**: **pass**（**R2 终态**，2026-08-20：R1 全部攻击点 #1–#11 经 SA1 R2 修订后逐一消除——4 必修项由 SA2 独立原型（52/52 场景）+ vitest 三项亲跑复核证实为真实语义修订而非文字搪塞；新增量攻击无阻塞发现，仅 2 条 LOW 备案。R1 reject 记录与攻击点清单完整保留于下，R2 复审见文末「## R2 复审」节。pass 仅表示设计通过审查，不替代 SA4/SA7 对实现与活链路的验证。）

**评审方法**：假装全新开局，逐节攻击 §0–§12；设计期可验证声明全部亲跑复核（shell 实跑、后台独立进程、留证路径见下）；另以**独立同构原型**（`/tmp/sa2-attack-proto.mjs`，按设计 §3/§4 逐条抄写算法，非复用 SA1 原型）实跑 SA6 全部 12 分类场景 + 13 个 SA6 之外攻击场景，用构造证据取代纸面推演。

---

## 0. 实跑复核记录（SA2 亲跑，供 SA4 复核）

| # | 设计声明（§10 行） | SA2 复核命令 | 结果 | 结论 |
|---|------------------|-------------|------|------|
| V1 | 红灯基线 12 红 1 绿、失败模式唯一缺导出 | `cd <worktree> && pnpm exec vitest run packages/vfsl/test/schemasource-seam.test.ts` | `Tests 12 failed \| 1 passed (13)`；12/12 均 `TypeError: FileSchemaSource is not a constructor`（log: /tmp/sa2-red-verify.log） | **成立** |
| V2 | 全量 16 文件 354 用例、唯一红即本票文件 | `pnpm exec vitest run` | `Test Files 1 failed \| 15 passed (16)`、`Tests 12 failed \| 342 passed (354)`（log: /tmp/sa2-full-verify.log） | **成立** |
| V3 | typecheck 现状 6 错（:29-31/:32/:242/:329） | `pnpm typecheck` | 恰 6 错，行号+错误码逐条一致，exit 2；且 :142 `as unknown` **无错**（证实设计计数与诊断正确） | **成立** |
| V4 | 原型 30/30（/tmp/sa1-seam-proto/prototype.mjs） | `ls /tmp/sa1-seam-proto/` | **目录已不存在，不可复跑** → 见攻击点 #7；SA2 另建独立原型复证（下表） | **部分成立**（算法结论被 SA2 复证，证据本体已失） |
| V5 | vitest 可点名单文件运行 | `pnpm exec vitest run <path>` | 可行（V1 即证） | **成立** |
| V6 | exports 直指 TS 源无构建产物 | 读 `packages/vfsl/package.json:6-8`、root `package.json:7-9` | `"exports": { ".": "./src/index.ts" }`、`engines: node >=20` | **成立** |

**SA2 独立攻击原型**（`/tmp/sa2-attack-proto.mjs` → log: /tmp/sa2-attack-proto.log，全文见附录 A）：
SA6 12 分类场景 **全过**（含二级回退核心用例 broken.id → missing-directive）；设计 §3.2/§4 边界表 7 项（BOM+CRLF / 代码后伪指令不劫持 / 块注释内伪指令不计 / version 前导零 / version 非数字→dialect-mismatch / list 一坏全拒 / 无后缀 id 仅一级）**逐项复现成立**；SA6 之外攻击场景 5 项暴露缺口（见攻击点 #2/#3/#4/#8/#9）。

---

## 1. 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 修订要求 |
|---|--------|--------|---------|---------|
| 1 | **CRITICAL** | §4.5 错误处理：ENOTDIR「视同缺失」是**虚假降级** | root 指向文件 / `domains` 是文件（ENOTDIR）被并入「domains/ 不存在 → 静默空集」。该条件在正常使用流程（SA6 fixture、repo 根）**永远满足**——出现即调用方 bug 或仓内异常状态，静默 `[]` 把 bug 掩盖成「合法空集」。触发条件：`new FileSchemaSource('/etc/passwd').list()` → `[]`、CI 绿。按 2026-05-07 三度立法（虚假降级识别）标记 CRITICAL | 区分 ENOENT（F1 现状合法空集，保持）与 ENOTDIR（响亮：结构化错误或 I/O 冒泡，二选一明示）。一行级修订 |
| 2 | **HIGH** | §4.2 二级回退：三码分类在「同目录多文件」下出错（**原型实测证实**） | 目录内同时存在「完好声明 `base@v1` 的文件」与「无关损坏文件」时，`load('base@v2')` 报 **missing-directive**（指向无关坏文件）而非 unknown-id（附实际声明 id）。「版本打错」被误诊为「声明损坏」——直接击穿设计 §1.1 自 declared 的正确性焦点 №2「三种结构化错误各自出现在语义正确的场景」。触发：`domains/foo/{a.vfsl 声明 foo@1 完好, b.vfsl 缺 version}` + `load('foo@2')`（实测得 missing-directive）。§4.5 明文允许同目录多 .vfsl，属设计自身允许的状态空间 | 二级规则细化：目录内存在「头部完整且声明 id 的 base 与请求 base 一致」的文件时优先 **unknown-id + 附实际声明 id**；仅当目录内无任何健康同 base 声明时才 missing-directive。SA6 用例不受影响（broken.id/broken.all 目录内均无健康声明——原型已验证两种场景可共存） |
| 3 | **HIGH** | §6.1 AC5「双保险」存在删除盲区（**实测证实**） | `vitest.config.ts:7` `passWithNoTests: true` → 显式 CI 步骤 `pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts` 在文件被删/改名时 **exit 0 静默假绿**（实测：点名不存在文件 → `No test files found, exiting with code 0`）。两条路径（include 自动跑 + 点名步骤）在文件消失时**同时失明**——「可审计的合规锚点」实为自毁式锚点，AC5 完整性被击穿。触发条件：任何后续票误删/重命名该测试文件 | CI 步骤加 `--passWithNoTests=false`（最小修），或在步骤前显式断言文件存在。零依赖零新服务不变 |
| 4 | **HIGH** | §4.2 规格自相矛盾：重复 id 语义与「入册」机制不可同时成立（**原型证实**） | 同节冻结了「load 取扫描序**首个**」+「list() 重复项**可见**」，但机制句是「@id 非空者**按头部 id 入册**」——键控入册（Map）天然去重且后写覆盖：load 实际取**最后**一个、list 丢重复项（SA2 原型 Map 实现实测 `list=["dup@1"]`，两文件同 id 只剩一条）。SA3 按字面任选一种实现都违背设计另一句，且无测试锚点兜底 | 显式冻结数据结构语义：注册表 = 条目数组 + **首胜**查表；list() 从文件扫描数组派生（重复保留）。或改设计文字放弃其一——不得两句并存 |
| 5 | **MEDIUM** | §4.2 二级回退 base 未冻结路径段校验（穿越窗口） | 字面「若 `domains/<base>/` 下存在 .vfsl 文件」按 `join(root,'domains',base)` 直译实现时，id `'../<dir>@1'` 的 base 含分隔符可越出 domains/ 读任意 .vfsl 并把盘外内容装进信封 text 返回（SA2 原型按目录名精确匹配未穿越，但设计未冻结该实现，直译 join 的 SA3 会中招） | 冻结：base 必须为单一路径段（含 `/`、`\`、为 `.`/`..` 者 → 直接 unknown-id，不做任何文件系统访问）。一行规则，防「拿错文件」纪律同款 |
| 6 | **MEDIUM** | §4.1 顶层散放 `domains/*.vfsl`：定性「布局错误」却**静默排除** | 设计自断「散文件是布局错误，不静默收纳」，但处置是静默忽略（原型实测：list=`[]`、load=unknown-id，无任何信号）——放错位置的 schema 对 CI 完全隐形，恰是 AC5 要防的「CI 对坏布局失明」。与「一坏全拒」的严格哲学自相矛盾（坏头部响亮、坏布局无声） | 二选一并写死：(a) list() 检测 depth-1 散放 .vfsl → reject（消息含路径）——与既有哲学一致，推荐；(b) 明示容忍 + 理由（如与 dogfood fixture 排除统一） |
| 7 | **MEDIUM** | §10 协议假设依据：原型证据不可复跑 | `/tmp/sa1-seam-proto/prototype.mjs` 已不存在（SA2 亲查），SA4 无法按「命令可重跑、引用可定位」标准复核 30/30 声明。SA2 已以独立原型复证算法满足契约（第 0 节），技术风险消解，流程缺口在 | 后续设计期实测证据必须持久化（贴全量输出入 wiki，或产物入仓内 scratch），不得依赖 /tmp。本条为流程修订要求，不要求重做实验 |
| 8 | **LOW** | §4.1 隐藏目录静默入册（原型证实） | `domains/.bak/`、`domains/.staging/` 等点开头目录被正常扫描注册（实测 .bak 内文件注册成功）——备份/暂存目录的 .vfsl 会进 list、参与 CI 校验、可与正式 id 重复 | 冻结排除 `.` 开头目录（与排除深层递归同款理由：非领域包形态） |
| 9 | **LOW** | §4.2 重复 @id 键文件的入册语义未冻结 | 头部重复 `@id`（y@1/z@1）+ 目录名不一致时 `load('y@1')` 落 **unknown-id**（原型实测）——盘上确有声明 y@1 的文件却被报「不存在」，§3.2 的 duplicate→missing-directive 分类在寻址层失守 | 在 §4.5 边界表明示该落点（接受 unknown-id 亦可，须写明），或让重复键文件的全部出现值参与二级诊断 |
| 10 | **LOW** | §12 ALLOW LIST 漏列必须随分支 commit 的 wiki 产物 | git status：`wiki/raw/task_vfsl-schemasource-seam.md`（含 SA6 R2 真红灯证据）、`wiki/raw/task_vfsl-schemasource-seam_dispatch.md`、本评审文件均未跟踪；纪律要求 wiki/raw 产物随分支 commit，ALLOW LIST 仅列设计文档——红灯证据有漏出分支的风险 | ALLOW LIST 补上述三个 wiki/raw 文件 |
| 11 | **LOW** | 杂项（不阻塞） | (a) §0 行 2「index.ts 追加 5 项导出」与 §12「3 值 + 4 类型 = 7」计数不一致；(b) §6.1 repoRoot 推导未指定 `fileURLToPath`（`URL.pathname` 直取在百分号编码路径下出错，CI 路径当前无害但应写死正确 API）；(c) 备案：SA6 测试文件头引「v1-spec §1 注记 9/10」实为 **§2**（语法注记在 §2；设计 §1.2 引 §2 正确——SA6 文件注释错引，随 #SA6-owned 修复顺手改可不改） | 文字修订，SA1 顺手改 |

### 多维扫描未命中项（备案）

- **竞态/死锁**：无共享状态、每次调用现扫（§4.3），并发 load/list 互不撕裂 ✓；
- **缓存撕裂**：无缓存，恒新鲜 ✓（且设计正确地把缓存判为「脚手架长成承重墙」反面教材）；
- **极端输入 panic**：头部解析为纯正则/行扫描，无递归无回溯爆炸面；超长文件仅内存线性 ✓；
- **Feature 污染既有路径**：src 纯增量（12 内部件 DENY 与实际文件逐一对应，已核对）、公共面只增不改、§11 契约审计成立 ✓；
- **前导 trivia 边界（指定专项）**：BOM（ECMAScript `\s` 含 U+FEFF + tokenizer.ts:67-68 串首剥离双保险）、CRLF（`\s*$` 吸收）、块注释伪指令、代码后伪指令、未闭合块注释（= 首行非 trivia → missing-directive）——设计 §3.2 表 + 原型逐项证实，**无遗漏** ✓；
- **list() 严格性与 SA6 兼容（指定专项）**：SA6 无任何用例在含损坏文件的 fixture 上调 list()，一坏全拒不触碰既有锚点；AC1#3 在净 fixture 上正常（原型证实）✓；
- **@types/node workspace 影响（指定专项）**：workspace 实际仅 `packages/vfsl` 一个包（apps 仅 README），typecheck 只编译该包，pnpm 默认不 hoist → 无跨包类型面泄漏；`^20` 对齐 engines 下限、matrix 20/24 仅类型无运行时影响；`skipLibCheck: true` 已开 ✓。

---

## 2. 协议假设依据审查（2026-06-13 立法）

- **章节存在**：§10 存在，覆盖全部机制类假设 ✓，无「应该/通常/预计」类无据推断（每行均标注依据类型与内容）✓；
- **可验证性**：6 行中 5 行 SA2 已亲跑复证成立（V1/V2/V3/V5/V6）；唯一例外 = 原型 30/30 行——产物失存、SA4 不可复跑（攻击点 #7）。设计其余源码引用（package.json:6-8、engines、tsconfig 开关、vitest include）SA2 逐一比对原文**全部准确**；
- **裁定**：依据质量整体达标，不构成 reject 主因；证据留存纪律须补（#7）。

## 3. 错误处理链路审查（2026-05-07 立法）

- **静默失败**：三处——(a) 顶层散放静默忽略（#6）；(b) 隐藏目录静默入册（#8）；(c) CI 步骤 passWithNoTests 删除盲区（#3）。其余失败路径（缺键/方言不符/未知 id）均结构化响亮 + path 诊断 ✓；
- **状态闭环**：N/A（纯库无 UI 状态）；
- **降级路径**：ENOENT 空集 = 合法降级（F1 现状 domains/ 不存在是设计内状态）✓；ENOTDIR = **虚假降级**（#1，CRITICAL）；EACCES 等原样冒坡且不臆造第 4 码 = 正确判断 ✓；
- **用户可感知性**：三码均带 kind/code/path/id 上下文，unknown-id 附「目录内实际声明 id」提示——诊断质量是本设计亮点 ✓。

## 4. 红线测试思路（每漏洞一条，SA6/后续票可直接取用）

1. **#1 ENOTDIR**：`writeFile(root+ domains 路径为文件)` → `await expect(list()).rejects`（结构化或原样 I/O 均可，唯独不得 resolve `[]`）；
2. **#2 错分类**：fixture `domains/foo/a.vfsl`（完整声明 foo@1）+ `b.vfsl`（缺 version）→ `load('foo@2')` 断言 `code === 'unknown-id'` 且消息含 `foo@1`（当前设计会 missing-directive——修复前必红）；
3. **#3 CI 盲区**：临时改名 `domains-scaffold.test.ts` → `pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false` 必须非零退出（修复前对不存在文件实测 exit 0）；
4. **#4 重复 id 语义**：`domains/{a,b}/schema.vfsl` 同声明 `dup@1` → `load('dup@1')` 断言 `env.text` 为排序首文件内容；`list()` 断言含两个 `'dup@1'`；
5. **#5 穿越**：root 旁放诱饵 `<root>/secret/decoy.vfsl`（声明 `pwned@1`）→ `load('../secret@1')` 断言 `unknown-id` 且绝不 resolve 诱饵 text；
6. **#6 散放**：`domains/foo.vfsl` 散放 → `list()` reject（若采纳 6a）；
7. **#8 隐藏目录**：`domains/.bak/schema.vfsl` → `list()` 结果不含其注册项；
8. **#9 重复 @id 键**：`domains/x/` 双 @id（y@1/z@1）→ `load('y@1')` 按冻结语义断言（missing-directive 或明示的 unknown-id）。

## 5. 放行条件（reject → SA1 修订后复审）

**必须修复（阻塞放行 SA3）**：#1（ENOTDIR 响亮）、#2（二级回退优先 unknown-id 规则）、#3（CI 步骤 --passWithNoTests=false）、#4（重复 id 数据结构语义冻结）。
**强烈建议同轮吸收**：#5（base 单段校验）、#6（散放处置定形）、#10（ALLOW LIST 补 wiki 产物）。
**备案不改可放**：#7（流程）、#8/#9（边界表补行）、#11（文字）。

## 6. 对设计的核心裁定（给总控与 SA1）

被攻击后**站得住的部分**：接缝形状与 ADR 0005 §1 逐字一致；两级寻址满足 SA6 全部 13 用例（SA2 独立原型实跑复证，非采信 SA1 自述）；前导 trivia 区解析的边界表（BOM/CRLF/块注释/代码后伪指令）逐项实测无遗漏；12红→绿推演、6 错清零路径、存量零回归论证全部经独立复核成立；纯增量无契约污染；包布局与「为单类不另起包」判断正确。

被击穿的部分集中在**规格完备性**而非架构方向：二级回退在多文件目录下错分类（#2）、重复 id 两句不可兼得（#4）、AC5 锚点可自毁（#3）、ENOTDIR 虚假降级（#1）。四项都是段落级修订——设计不需要推翻任何 §2–§6 的结构决策，把上述四处的语义写死即可进入复审。

---

## 附录 A：SA2 独立攻击原型实跑记录（全文）

```
PASS SA6 AC1#2 信封四键+值
PASS SA6 AC1#3 list 含两 id
PASS SA6 AC2a 缺lang → missing-directive
PASS SA6 AC2a 缺id → missing-directive（二级核心）
PASS SA6 AC2a 缺version → missing-directive
PASS SA6 AC2a 三键全缺 → missing|unknown
PASS SA6 AC2b lang=yaml → dialect-mismatch
PASS SA6 AC2b version=2 → dialect-mismatch
PASS SA6 AC2c 未知id → unknown-id
PASS B1 多文件目录 load 版本打错（foo@1 完好 + b.vfsl 损坏 → load('foo@1') 一级命中不受损）
PASS B1b load(foo@2)（a 完好声明 foo@1，b 无关损坏）→ 分类 :: 实得 missing-directive —— 攻击点 #2 证实
FAIL B2 base 路径穿越防护未由设计冻结 :: 实得 undefined（SA2 原型自身 ENOENT 早退形状 bug，修正后按名匹配不穿越；设计未冻结实现 → 攻击点 #5 成立）
PASS B3 重复@id键+目录名x → load(y@1) → unknown-id（盘上确有声明却被报不存在 —— 攻击点 #9 成立）
PASS B4 顶层散放 .vfsl → 静默忽略（list=[] 且 load=unknown-id —— 攻击点 #6 成立）
PASS B5 隐藏目录 .bak 被静默入册（—— 攻击点 #8 成立）
PASS B6 BOM+CRLF 首行指令容忍
PASS B7 代码后伪指令不劫持 → missing-directive
PASS B8 块注释内伪指令不计 + 缺@id → missing-directive
PASS B9 version 01 → 1（前导零容忍）
PASS B10 version=abc → dialect-mismatch
PASS B11 list() 一坏全拒 → missing-directive
PASS B12 无@digits后缀 → unknown-id（设计冻结：仅一级）
FAIL B13 重复 id 跨文件 → list 重复可见 :: list=["dup@1"]（Map 入册天然去重 —— 攻击点 #4 证实）

TOTAL 23 | PASS 21 | FAIL 2
```

（注：两处 FAIL 均为 SA2 原型 harness 侧问题，恰以反证方式暴露了设计未冻结点——B2 说明设计未禁止 join 直译穿越、B13 说明「入册」机制与「重复可见/取首个」矛盾。原型与 log：/tmp/sa2-attack-proto.mjs、/tmp/sa2-attack-proto.log，/tmp 易失，以本附录为准。）

## 附录 B：passWithNoTests 盲区实测证据

```
$ pnpm exec vitest run packages/vfsl/test/DOES-NOT-EXIST.test.ts
 RUN  v3.2.7 /home/wangjian/nomicore-fix-issue-25
No test files found, exiting with code 0
filter: packages/vfsl/test/DOES-NOT-EXIST.test.ts
include: packages/*/test/**/*.test.ts
```

→ 设计 §6.1 的显式 CI 步骤在该文件被删/改名时静默 exit 0（攻击点 #3 的实跑证据；log: /tmp/sa2-passwithnotests.log）。

---

## R2 复审（2026-08-20，SA2）

**评审输入**：SA1 R2 修订稿（`task_vfsl-schemasource-seam_design.md`，文首 R2 修订记录 + 文末逐条回应表）。
**复核方法**：(1) 逐攻击点对照 R2 修订是否真实消除；(2) **独立同构原型 v2**（`/tmp/sa2-r2-proto.mjs`——按 R2 §3/§4 新冻结语义**逐条重写**：四级二级决策树、条目数组+首胜、base 单段校验、strays 通道、ENOTDIR 分流、点开头两层排除；与 R1 原型零代码复用，R1 原型已失存）实跑 **52 场景全过**（全文见附录 C）；(3) SA1 §10 可验证声明亲跑复核（vitest 三项，下表）；(4) 设计文本残留矛盾 grep 扫描 + ALLOW LIST 三件在盘亲查。

### R2.1 逐攻击点复核表（R1 放行条件逐项验收）

| # | R1 修订要求 | R2 落点 | 消除确认 | SA2 实证 |
|---|------------|--------|---------|---------|
| **1** | ENOENT 保持空集；ENOTDIR 响亮（结构化或冒泡二选一明示） | §4.5 表第 2 行：readdir 按码分流，ENOENT→合法空集、ENOTDIR→**原样冒泡**（附理由：与 EACCES 同域、不臆造第 4 码、正常流程不可能出现） | ✅ 二选一已明示（选冒泡），虚假降级消除 | 原型 R2#1a/#1b：`domains` 是文件时 `list()`/`load()` 均 reject 原生 ENOTDIR，**绝不** resolve `[]`/unknown-id |
| **2** | 二级回退细化：有健康同 base 声明 → 优先 unknown-id 附实际 id | §4.2「二级分类决策树」四级全重写 +「头部完整=三键齐无重复键、**不含方言有效性**」明示 + §8.1 13 用例逐一自检表 | ✅ 决策树四级互斥完备（见 R2.2-1）；broken.id/broken.all 落点不变经独立复证 | 原型 S5（broken.id→missing-directive，**核心锚点不变**）、S7（broken.all→missing）；R2#2a：**foo@2（a 完好 foo@1+b 损坏）→ unknown-id 附 foo@1**——R1 实测此场景得 missing-directive（错分类），R2 修正真实生效；R2#2b：foo@1 一级命中不受损文件影响 |
| **3** | CI 步骤 `--passWithNoTests=false`（最小修） | §6.1 yaml 步骤带 flag + §10 实测行（输出贴文档） | ✅ 且 SA2 亲跑复核其 §10 声明三项全成立 | T1 不存在文件+flag → **exit 1**；T2 无 flag → exit 0（盲区复现，与 R1 附录 B 一致）；T3 绿文件（parse-vfsl.test.ts 11/11）+flag → exit 0——**删除盲区消除、存量行为零变化** |
| **4** | 冻结数据结构：条目数组+首胜+list 重复保留（两句矛盾不得并存） | §4.2「扫描产物与数据结构（冻结）」：entries 数组、「入册=数组追加、Map 明示禁用」、一级首胜、list 派生重复保留、入册资格=「@id 恰一次且非空」 | ✅ grep 全文无残留矛盾句（「入册」15 处全部统一为数组语义） | 原型 R2#4a：两文件同 `dup@1` → load 取排序首 a/ 内容（首胜）；R2#4b：list 含两个 `'dup@1'`（重复保留）——R1 附录 A 的 B13 FAIL（Map 去重）在新结构下不复现 |
| **5** | base 单一路径段校验（含 `/`/`\`、恰为 `.`/`..` → unknown-id，不做 FS 访问） | §4.2「base 单一路径段校验」：整串相等判据（`broken.id` 含点子串不受影响）+ 禁 join 直译探盘 + 目录匹配冻结为「与扫描条目按名精确相等」 | ✅ 早出+结构性双保险均冻结 | 原型 R2#5a：`../secret@1`（盘旁有诱饵 `secret/decoy.vfsl` 声明 pwned@1）→ unknown-id，**诱饵不可达**；R2#5b：`..@1`/`.@1`/`@1`/`a/b@1`/`a\b@1`/`foo/..@1` 六形状全拒 |
| **6** | 散放处置二选一写死（推荐 list() reject） | §4.1/§4.4/§4.5：采纳推荐 (a)——scan() 产出 `strays`，list() 整体 reject（原生 Error 含路径+ADR 提示）；load 不受影响；「list=可见性通道（一坏全拒）/load=寻址通道（指谁验谁）」标定 | ✅ 哲学自洽恢复（坏布局响亮） | 原型 R2#6a/b/c：散放 → list() reject（原生 Error 含 `stray.vfsl`）；散放 id load → unknown-id；正常 id load 照常工作——**组合无矛盾** |
| **7** | 实测证据持久化纪律 | §10 头部纪律条款 + R2 新实测（#3 flag 行为）输出全文贴入 | ✅ 纪律成文且本 R2 首次执行 | SA2 亲跑复核该新实测行（= T1/T2），输出与设计 §10 所贴一致 |
| **8** | 冻结排除 `.` 开头目录 | §4.1 表 + §4.5：两层扫描同规则（点开头目录与点开头 .vfsl 文件同排除）；补「readdir 不返回 `.`/`..` 自身，无规则冲突」 | ✅ | 原型 R2#8/#8b：`.bak/` 与 `.hidden.vfsl` 不入 list、不触发 stray reject、id 不可寻址 |
| **9** | 重复 @id 键落点明示 | §4.2 入册资格 + §4.5：`load('x@1')`→missing-directive（duplicate 消息）；`load('y@1')`/`load('z@1')`→**unknown-id（冻结落点）**+「宁可不存在不拿错」理由 | ✅ | 原型 R2#9a/b/c 三落点逐一实证与冻结文字一致 |
| **10** | ALLOW LIST 补 wiki/raw 三件 | §12：任务简报 / `_dispatch.md` / 本评审文件均已列 | ✅ | SA2 亲查 `wiki/raw/`：三文件均在盘 |
| **11** | 文字三处 | §0 计数 3 值+4 类型=7（与 §2.2 导出清单核对一致）；§6.1 `fileURLToPath` 写死并禁 `URL.pathname`；§8.3 备案 §1→§2 | ✅ | 逐一比对原文 |

### R2.2 增量攻击（R2 新引入语义的缺口扫描）

1. **二级决策树分支完备性**：四分支（目录不存在或无 .vfsl→unknown-id；有健康同 base 声明→unknown-id 附实际 id；无健康同 base 但有损坏→missing-directive 首个损坏者；全完好但声明别的 base→unknown-id 附实际 id）**互斥且并集覆盖 scan() 产物全部状态**。原型逐一独立触发：分支 1（S10/R2#5b/R2#9b）、分支 2（R2#2a/2d/5c）、分支 3（S5/S7/R2#9a）、分支 4（R2#2f）——**无交叉、无遗漏**。一句话冻结「missing-directive 仅当有损坏可指且无健康同 base 声明」与 R1 #2 的修订要求逐字对齐。
2. **「健康声明不含方言有效性」边界**（R2 新语义最锐利的边）：`@lang: yaml` 的 `foo@1` 是「健康声明 foo@1」→ `load('foo@2')` 落分支 2 报 unknown-id 附 foo@1、`load('foo@1')` 一级命中报 dialect-mismatch。原型 R2#2c/#2d 实证两落点各得其所，设计明示此判定且自洽——版本打错与方言错误的诊断通道不串扰，**无新漏洞**。
3. **strays 数据结构消费一致性**：仅 list() 消费（reject），load 零消费（散放 id→unknown-id）；点开头 .vfsl 在 stray 判定**之前**已被排除（先排除后判散放，无双计数）；散放与正常 id 的 load 互不影响。原型 R2#6a/b/c + R2#8 组合实证，**无自相矛盾**。
4. **「对 SA6 契约零影响」声明复核**：原型 S1–S12 按 R2 规则复刻 SA6 fixture 逐字形状（broken.all 的块注释头、mismatch.* 的双键等），12 分类用例落点与 SA6 R2 真红灯记录/设计 §8.1 自检表**逐一一致**——声明成立。#4 数组化与 #5 单段校验不触及任何 fixture 形状（fixture 无重复 id、base 均合法单段）。
5. **新发现（LOW，备案不阻塞）——I1 符号链接目录判据未冻结**：设计 §4.1 说「domains/ 下第一层目录」但未写死 dirent 判据（grep 证实全文无 isDirectory/symlink/withFileTypes 字样）。若 SA3 用「逐名 readdir + 吞 ENOTDIR 跳过」惯用法实现，会**跟随符号链接**——`domains/evil -> /somewhere` 可把盘外 .vfsl 注册入册（base 单段校验防不了：段本身单段、逃逸由链接完成）。安全默认 = `readdir(…, {withFileTypes:true})` + `ent.isDirectory()`（不跟随；原型 I1 按此实证跳过）。**给 SA3 的一行实现要求：目录判据冻结为 dirent.isDirectory()，不跟随符号链接**（可由 SA4 在实现审查时把关，不需 SA1 再修订设计）。
6. **新发现（LOW，备案不阻塞）——I2 跨目录健康声明的诊断富化机会**：`domains/foo/` 声明 `bar@1`（背离）而 `domains/bar/` 不存在时，`load('bar@2')` 落分支 1，消息「domains/bar/ 下无 schema 文件」**准确但未提示盘上别处确有 bar@1**（一级注册表其实知道）。code 正确（unknown-id——无任何文件声明 bar@2），纯消息层可选富化；用户可经 list() 发现。不构成规格缺口。

### R2.3 多维扫描（新语义下重扫）

竞态/死锁（现扫无共享状态）、缓存撕裂（无缓存）、极端输入（行扫描无递归）、Feature 契约污染（纯增量+§11 审计成立）——R1 已放行项在 R2 修订下均不受触动（修订全部落在错误分类/数据结构/扫描排除规则，未改接缝形状与扫描时机）。前导 trivia 边界（BOM/CRLF/块注释/代码后伪指令）在原型 v2 重写下 B1–B5 复证不变。

### R2.4 实跑复核记录（SA2 亲跑，供 SA4 复核）

| # | SA1 R2 声明（§10） | SA2 复核命令 | 结果 | 结论 |
|---|------------------|-------------|------|------|
| T1 | 点名不存在文件 + `--passWithNoTests=false` → exit 1 | `pnpm exec vitest run packages/vfsl/test/DOES-NOT-EXIST.test.ts --passWithNoTests=false` | `exit 1` | **成立**（盲区消除） |
| T2 | 同命令去 flag → exit 0 | 同上去 flag | `No test files found, exiting with code 0`，exit 0 | **成立**（盲区复现，与 R1 附录 B 一致） |
| T3 | 文件存在且用例过 → 照常 exit 0 | `pnpm exec vitest run packages/vfsl/test/parse-vfsl.test.ts --passWithNoTests=false` | `Test Files 1 passed (1)`、`Tests 11 passed (11)`，exit 0 | **成立**（flag 对存量零影响） |
| P1 | （#2/#4/#5/#6/#8/#9 新语义满足 SA6 契约且落点不变） | SA2 独立原型 v2（52 场景，附录 C） | `TOTAL 52 \| PASS 52 \| FAIL 0` | **成立** |

（/tmp 路径易失——原型全文输出以附录 C 为准，日志 /tmp/sa2-r2-proto.log、/tmp/sa2-r2-t{1,2,3}.log。）

### R2.5 R2 Verdict

**pass。**

- R1 四必修（#1 ENOTDIR 响亮、#2 二级回退优先 unknown-id、#3 CI flag、#4 数据结构冻结）+ 三同轮吸收（#5/#6/#10）全部真实消除，非文字搪塞——每项均有 SA2 独立原型或亲跑命令的构造证据；
- 增量攻击未发现阻塞级缺口；两条 LOW 备案（I1 符号链接判据→SA3 实现一行冻结、I2 消息富化→可选）移交 SA4/后续，不构成本轮 reject 依据；
- 设计结构决策（接缝形状/两级寻址/双层方言断言/CI 双保险/包布局）自 R1 起未动且持续站得住。

**放行 SA3。** 提醒：本 pass 是设计层裁定；SA3 实现须逐字遵守 §4.2 R2 冻结语义（决策树/数组扫描/单段校验/strays），SA4 静态门禁与 SA7 活链路验证照常执行，重点抽查 I1（目录判据）与 §8.3 的 SA6 协调项。

---

## 附录 C：SA2 R2 独立原型实跑记录（全文）

```
PASS S1 AC1#1 load/list 返回 Promise
PASS S2 AC1#2 信封恰四键+值
PASS S3 AC1#3 list 含两 id
PASS S4 AC2a 缺lang → missing-directive
PASS S5 AC2a 缺id（broken.id）→ missing-directive（核心锚点）
PASS S6 AC2a 缺version → missing-directive
PASS S7 AC2a 三键全缺 → missing|unknown
PASS S8 AC2b lang=yaml → dialect-mismatch
PASS S9 AC2b version=2 → dialect-mismatch
PASS S10 AC2c 未知id → unknown-id
PASS S11 AC4 text 逐字节一致（含头部）
PASS S12 AC4 id/version 解析自头部
PASS R2#2a foo@2（a 完好 foo@1 + b 损坏）→ unknown-id
PASS R2#2b foo@1 一级命中不受损文件影响
PASS R2#2c lang=yaml 的 foo@1 一级命中 → dialect-mismatch
PASS R2#2d lang=yaml 的 foo@2 → 分支2 unknown-id 附 foo@1
PASS R2#2e 背离目录 load(bar@1) 一级命中
PASS R2#2f 背离目录 load(foo@1) → 分支4 unknown-id 附 bar@1
PASS R2#4a 重复 id load 首胜（排序首 a/）
PASS R2#4b list 重复保留（两个 dup@1）
PASS R2#5a ../secret@1 → unknown-id（不触盘，诱饵不可达）
PASS R2#5b "..@1" → unknown-id
PASS R2#5b ".@1" → unknown-id
PASS R2#5b "@1" → unknown-id
PASS R2#5b "a/b@1" → unknown-id
PASS R2#5b "a\\b@1" → unknown-id
PASS R2#5b "foo/..@1" → unknown-id
PASS R2#5c foo@01（盘上 foo@1）→ 分支2 unknown-id 附 foo@1
PASS R2#6a 散放 → list() 整体 reject（原生 Error 含路径）
PASS R2#6b 散放 id load → unknown-id（load 不受散放影响）
PASS R2#6c 散放存在时 load 正常 id 照常工作
PASS R2#8 点开头目录/文件排除（list 不拒、不含其 id）
PASS R2#8b .bak 内 id → unknown-id
PASS R2#9a load(x@1) → missing-directive（duplicate 消息）
PASS R2#9b load(y@1) → unknown-id（冻结落点）
PASS R2#9c load(z@1) → unknown-id（冻结落点）
PASS R2#1a ENOTDIR list() → 冒泡（原生 I/O 错，非空集）
PASS R2#1b ENOTDIR load() → 冒泡（非 unknown-id 静默）
PASS B1 BOM+CRLF 首行指令容忍
PASS B2 代码后伪指令不劫持 → missing-directive
PASS B3 块注释内伪指令不计
PASS B4 version 01 → 1（前导零容忍）
PASS B5 version=abc → dialect-mismatch
PASS B6 list() 一坏全拒
PASS B7 无后缀 id 一级可寻址
PASS B8 深层 .vfsl 排除（dogfood 防混入）
PASS B8b 深层 id → unknown-id
PASS B9 净 fixture list 恰两 id
PASS B10 空 domains/ → []（合法空集）
PASS B10b domains/ 缺失 → []（ENOENT 合法空集）
PASS I1 符号链接目录被跳过（isDirectory()=false，不跟随）
PASS I2 @lang 重复但 @id 良好 → 一级入册命中报 duplicate

TOTAL 52 | PASS 52 | FAIL 0
```

（原型：`/tmp/sa2-r2-proto.mjs`——按 R2 设计 §3/§4 新冻结语义独立同构抄写，52 场景覆盖 SA6 12 用例、R1 七个攻击场景的新规则落点、决策树四分支、边界回归与两条增量观察。/tmp 易失，以本附录为准。）
