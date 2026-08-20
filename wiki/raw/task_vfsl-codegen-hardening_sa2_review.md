# SA2 攻击评审报告

**Date**: 2026-08-21
**Verdict**: pass（附 4 项非阻断文字级修订要求，见攻击点清单 #1–#4；零行为决策/文件范围/测试锚变动，不构成 SA1 返工轮——建议 SA3 开工前以 v1.1 顺手修订设计文档对应行）

- 被审对象：SA1 设计 v1 `wiki/raw/task_vfsl-codegen-hardening_design.md`（基点 `5907dc3` 实测复核）
- 评审方法：全新视角独立攻击——所有承重断言均以本 worktree 源码 + 自跑探针独立复证（不采信设计自述），复证记录见文末「验证证据索引」
- 约束基准：`task_vfsl-codegen-hardening_relevant_decisions.md`（ADR-0001 修订节 / 0003 / 0004 / 0005 摘录条款）——逐条对照，**未发现任何条款违反**（与 SA8 设计后复审 `clear` 一致，本轮独立复核不翻案）

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | MINOR | §4.1 事实精度（SA8 移交观察③坐实） | 设计称 ADR-0004 D3 文字未逐一列全者为 **4 名**（RootSchema/VfslValueOf/PathPatchValue/PathElementValue）。实测 D3 原文（`docs/adr/0004-*.md` L26）仅列 7 名（PathSchema/PathAt/PathValue/PathKind/UnknownPath/VfslPathMap/VfslTypedAccess），未列全者实为 **5 名**——另有 `VfslKind`。不影响冻结名单本身（12 名已独立实测核实 = `grep -c '^export' packages/vfsl-protocol/src/index.ts` → 12，与 checker 枚举一致），纯勘误 | §4.1「名单数据源纪律」一句改为 5 名并补 `VfslKind` |
| 2 | MINOR | §4.2「无第三碰撞面」完备性论证缺口 | 结论本身经我实证**成立**，但设计给出的论据不完整且部分失实：①真实封堵第三面（别名名 × 生成器自身发射的全局标识符 `Record`/`string`/`number`/`boolean`）的机制是 **parse 层 `RESERVED_NAMES`（parser.ts:77，16 名）恰好含 `Record`+原始类型名**，设计全文未点名这一层；②§4.2 论据「字段名一律发射为带引号字符串键」与事实不符——顶层接口成员 identifier 形**不加引号**（emitter.ts:172 + 设计 §3.1 自己的样例 `label: PathSchema<…>`），嵌套成员才恒加引号（emitter.ts:260）；成员名不进类型引用作用域所以**结论侥幸不受影响**，但论据链是错的；③§4.4 括注「parse 层保留名（ROOT + 标记类型）」双重失实：`ROOT` 不在 `RESERVED_NAMES` 集合（是独立约定），集合也远不止标记类型（含 Record/Pattern/string/number/boolean/null/unknown/any/extends/interface）。风险：下游（G 票/后续 SA）若引用该论据链而非结论，会在「生成器新发射全局名」或「方言保留名演进」时静默击穿完备性 | §4.2/§4.4 补一行真实论据：生成器发射的自由标识符清单 = `PathSchema`（import 绑定）+ `Record`/标量名（parse 层 RESERVED_NAMES 封死）+ 别名名（守卫域）；并修正「一律带引号」与「ROOT + 标记类型」两处措辞。我的复证：别名 `Record`/`string`/`number`/`boolean`/`unknown` 全部 parse 层 E303 拒收；别名 `Array`/`Object`/`Function`/`Symbol`/`Partial`/`ReadonlyArray` parse 放行且 post-N1 孤立编译**零诊断**（生成器从不发射这些名） |
| 3 | LOW | §3.1/§4.2 内部一致性 | 同 #2②：「字段名一律带引号」与 §3.1 样例（顶层 `label:` 不加引号）自相矛盾。零行为影响（成员名与类型引用是不同声明位置，TS 语义下均无碰撞面） | 措辞随 #2 一并修正 |
| 4 | LOW | §4.5 同步锚单向性未披露 | 冻结名单的同步锚（SA6 checker 实测枚举逐一断言必抛）只抓**增名未跟**方向；协议面未来**删名**时冻结名单残留条目 → 守卫过度拦截（fail-closed 方向，无害）且该测试**不红**。设计 §4.5 注释写「导出面漂移而本名单未跟 → 该测试红」未区分增/删向，属过度承诺 | `protocol-surface.ts` 头注补一句「删名方向不红（过度拦截方向无害）」；可选低成本锚见红灯测试思路 #4 |

**SA8 移交三项非门禁观察的裁决**（总控点名要求，逐条）：

- **① AC-4 字面「三处」vs 设计顺带同步 L50 注释**：**接受**。实测 `grep -c '由总控开后续票登记' emitter.ts` = 4（L39/L58/L76 三消息串 + L50 JSDoc），与设计 §5 表一致；issue #44 实存且标题「投影协议层扩展——Record/联合/被引用 ROOT 与异形联合 PathKind 语义」与三处尾串语义 **1:1 对应**（Record/联合形 ROOT 顶层动态键→「Record/联合」、被引用 ROOT 引用目标语义→「被引用 ROOT」、异形联合 PathKind 联合语义→「异形联合 PathKind 语义」），「见 #44」非悬空引用；L50 零行为面、在 ALLOW LIST 文件内、有 `grep -c = 0` 判据、SA6 断言零关联。范围忠实度裁定：这是对同一 stale 事实的一致性收尾而非 scope 扩张，**放行**（SA4 按 grep 判据验证）。
- **② 拦截域宽度（声明形态超集）与 `--check` 行为增强（exit 0→2）**：**两项均接受**。
  - 声明形态超集（未引用惰性别名按声明名拦截）：与发射层既有「parse 合法 ≠ 可投影」先例完全一致（三类既有发射期错误同为响亮拒绝 parse 合法输入，SA8 冲突点 #4 同裁）；方向 fail-closed；设计披露充分（§4.2/§11-D）；我复跑 probe-unref 证实未引用 `PathSchema` 仍 TS2440（真害）、其余名编译干净（遮蔽+演进危害论证成立）；SA6 引用形态断言是声明形态的严格子集，绿灯不受影响。ADR-0003「惰性积木合法」限定 parse/evaluate 接受性与数据面成员资格，不构成「生成器必须成功发射」义务。
  - `--check` exit 0→2：机制核实成立——守卫在 `generateProjection` 内，`--check` 同走 `collectProjections`（cli.ts:59 先于 :72 checkFreshness）；与 cli.ts 头注既有退出码语义一致（硬错误→2，非新鲜→1）；`generate-cli-check.test.ts` 无碰撞域 `--check` 锚（实测 grep）；CI（ci.yml:55 `--allow-empty-domains`）零域不受影响；方向为响亮化（消除 exit 0 假绿）。ADR-0005 §4「双抓」未被违反——碰撞域不存在合法产物可作 diff 对象，内容缺陷判定先于 diff 比较与该条款意图一致。
- **③ §4.1 D3 小勘误**：**坐实，列攻击点 #1**（4 名实为 5 名，漏 `VfslKind`）。非阻断：冻结名单以实测 12 名为准的正确性不受影响，纯文字勘误。

---

## 协议假设依据审查

**结论：通过。**

- **章节存在性**：§11「协议假设依据」存在，8 行（A–H）逐假设列表，含依据类型栏与具体引用栏。
- **无据推断扫描**：未发现「应该/通常/预计」类无据断言——每行依据类型为「设计期实测验证 / 源码引用 / 现有测试引用」之一，实测项附探针脚本路径与结果表（§4.2 十二名全表）。
- **实测证据可复现性（本评审独立复跑，非采信）**：SA1 四探针（`/tmp/sa1-i45/probe-edge/probe12/probe-unref/probe-bind.mjs`）本轮全部重跑成功且结果与设计 §11 表逐项一致：
  - probe12：9 泛型名 TS2314（段③ 行）、`PathSchema` TS2440、`VfslKind`/`VfslPathMap` CLEAN、基线 CLEAN——「12/12 有害（10 硬错 + 2 静默绑错）」成立；
  - probe-bind：checker 实证 `VfslKind`/`VfslPathMap` 段③ 实参声明于协议包 index.ts、对照 `Box` 声明于生成物——「非泛型名编译干净但静默绑错符号」成立（这是全量拦截最硬的架构依据）；
  - probe-unref：未引用 `PathSchema` → TS2440、未引用 `PathAt`/`VfslKind` → CLEAN——超集拦截的理由表成立；
  - probe-edge：零别名 / `YMap<{}>` / 裸 `{}` 三形态 post-N1 零诊断——「恒定 = 无条件」的理由 2 成立（且顺带实证现状零别名产物 L7-8 双空行残留）。
- **源码引用核对**：§11-H（cli.ts:150-153 code 前缀分支、:159-164 顶层 catch exit 2）、§12（collect.ts:78 裸调用、cli.ts:63-64 零域 flag）逐行核对吻合；caller 全集 `git grep generateProjection` 复跑无遗漏（生产 1 + re-export 1 + 测试 6 文件）。
- **无进程/端口/时序假设**：与设计自述一致，本设计为纯函数 + 既有 CLI 通道，无网络与跨进程资源生命周期。

---

## 错误处理链路审查

**结论：通过（无静默失败、无伪降级）。**

- **静默失败**：无新增静默路径。守卫失败 = `generateProjection` throw → collect.ts:78 裸调用冒泡 → cli.ts 顶层 catch → `printStructuredError` 泛 Error 分支打印 `[alias-protocol-export-collision] <消息>` + exit 2（既有通道零改动，我已核实 code 读取分支在 cli.ts:150-153）。多域运行时 `collectProjections` **全量前置**（cli.ts:59）先于写盘循环（cli.ts:75-78）——碰撞域在**任何**写盘前失败，无部分写盘/撕裂态。
- **状态闭环**：无状态机引入；生成与 `--check` 两路径同走守卫，失败均以结构化 stderr + 非零退出闭环。
- **降级路径**：无网络/外部服务依赖，不适用。冻结名单（vs 运行时枚举）是**带同步锚的技术取舍**而非降级：协议包纯类型模块运行时不可枚举（ADR-0004 D3 事实）、生产发射器不得依赖 devDependency 的编译器 API（package.json 实证 typescript 在 devDependencies）——约束真实、锚真实（增名方向漂移→红）。
- **虚假降级识别（重点审查）**：
  - 设计 §4.6 被否方案 2 主动否决「生成物侧静默改名/加前缀规避碰撞」——这正是虚假降级立法要求的正确遵守（产物名是消费方契约面，响亮失败 + 指引改名）；
  - N1+N2 的恒定 import 行是**根因修复**而非降级掩盖：N2 根因 = 文件 script 形，import 行直接消除该形态（module 性），非绕过；
  - 未引用别名拦截把「parse 合法」输入变为响亮失败——是收窄静默损害面（非泛型名静默绑错符号是编译器都看不见的最险类），非把 bug 降级掩盖。**未发现任何伪降级形态**。
- **用户可感知性**：碰撞（exit 2 + `[code]` + 别名清单 + 重命名指引）、尾串（stderr endsWith 见 #44）、ROOT 形态/引用/异形联合（既有前缀 + 新尾串）全部 stderr 可见。

---

## 已排除攻击面（攻击未成立，留证供 SA4/SA7 复用）

| 攻击尝试 | 排除证据 |
|---|---|
| 多域部分写盘（域 2 碰撞致域 1 已写盘撕裂） | cli.ts:59 collect 全量前置 → :75 写盘；throw 点在 collect 内 → 零写盘 |
| import 行破坏既有 golden snapshot | 三既有测试文件 grep `toMatchSnapshot/InlineSnapshot/toBe(\`` 均无命中——只有正则/toContain/自相等 |
| import 行破坏既有确定性断言 | 常量行 + 纯分段 join，`expect(emit()).toBe(emit())` 同输入自相等不受影响（§3.4） |
| 尾串替换破坏既有前缀断言 | generate-discriminated-emission.test.ts:103/121/150 三处 `/ROOT 形态不支持/`、`/ROOT 不可被引用/`、`/联合成员结构 kind 异形/` 实测核对——均为前缀正则，尾串替换零触碰 |
| 守卫误伤既有测试 fixture 别名 | fixture 别名全集实测：Entity/Id/Meta（mapping-table）、Entity/A/B/U/Node（emission）、Extra + demo 零别名域（cli-check）——∉ 12 名 |
| 头注/哈希/版本机制受扰 | header.ts 入 DENY、import 行不参与哈希（仅 sourceText 入哈希）、零入仓生成物零迁移 |
| 第三碰撞面（别名 × 全局名）造成未守卫破坏 | 见攻击点 #2：`Record` 等被 parse 层封死；`Array` 等实测零诊断（本评审探针 `/tmp/sa2-i45/probe-third-surface.mjs`） |
| CI `--check` 被行为增强破坏 | ci.yml:55 用 `--allow-empty-domains` 零域集 → exit 0 路径不经过守卫 |
| 红灯基线漂移 | SA6 三文件 13 tests 本轮复跑仍全红（3 files / 13 failed），与简报记录一致 |
| 碰撞别名名含引号/换行注入错误消息 | 别名名经 parse 层 identifier 词法约束（保留名 16 名之外的可声明标识符），消息 join 无注入面；碰撞上限 12 名（集合成员测试），消息有界 |

---

## 红灯测试思路

> 原则：SA6 三文件（owned，断言逻辑禁改）已锚定 AC-1–AC-4 主行为；以下为针对本评审发现与边缘的**补充**测试构想，供 SA4/SA7 或后续票使用，不要求纳入本票 ALLOW LIST。

1. **（对应攻击点 #1/#3，纯文字勘误）**：无行为面，无红灯测试——验证形态 = SA4 静态核对设计 v1.1 文本修订。
2. **（对应攻击点 #2，完备性前提的守护锚）**：新测试文件构想 `generate-global-name-harmlessness.test.ts`：对 `Array/Object/Function/Symbol/Partial/ReadonlyArray` 逐一构造**引用形态**碰撞 fixture（`type ROOT = YMap<{ x: NAME }>; type NAME = YMap<{ y: YLeaf<string> }>`），断言 post-N1 孤立编译零诊断。机理：这些名是当前唯一 parse 放行且不在守卫域的「疑似第三面」——本测试锚定「它们无害」这一完备性前提；若未来生成器开始发射新的全局标识符（如 `Partial<...>`）或 parse 保留名收缩，此测试即红，完备性断言的被击穿当场显影而非静默。
3. **（对应 `--check` 行为增强，SA7 动态验证项）**：探针构想——临时目录放置碰撞域，跑 `pnpm generate --check --domains <dir>`，断言 exit 2 + stderr 含 `[alias-protocol-export-collision]`。SA6 ②仅锚生成路径，此探针补 `--check` 路径的实证（设计 §9 已披露该行为变化，SA7 活链路验证时执行一次即可，不新增仓内测试文件）。
4. **（对应攻击点 #4，删名方向锚，可选）**：一行断言构想：`protocolExportNames()` 实测面 ⊆ `PROTOCOL_EXPORT_NAMES` 冻结名单（经 `import { PROTOCOL_EXPORT_NAMES } from '../src/protocol-surface.js'` 双源核对）——协议面**删名**即红，补齐同步锚的双向性。成本一行；若 SA1 判定不值得（过度拦截方向无害）则在 protocol-surface.ts 注释披露单向性即可（见攻击点 #4 建议）。
5. **（多重碰撞确定性）**：SA6 ②未锚多重碰撞——探针构想：fixture 同时声明两个碰撞别名（如 `type PathAt = ...; type PathValue = ...`），断言抛错、`aliases` 列表 = 声明序、消息含两名。设计 §4.3/§9 已承诺，SA7 动态验证顺手覆盖。
6. **（守卫次序确定性）**：探针构想：联合形 ROOT + 碰撞别名并存 fixture，断言错误为 `UnsupportedRootShapeError`（非碰撞错误）——锚定 §4.4 冻结次序「入口形态错误先于命名错误」。

---

## 验证证据索引（本评审独立执行）

| # | 命令（仓根） | 结果 |
|---|---|---|
| 1 | `git log --oneline -1` | `5907dc3` 基点吻合 |
| 2 | `find . -name 'generated.ts' -not -path './node_modules/*'` | 空——零入仓生成物，§3.4 再生成空操作成立 |
| 3 | `grep -c/-n '由总控开后续票登记' packages/vfsl-codegen/src/emitter.ts` | 4 处：L39/L58/L76（消息）+ L50（JSDoc）——§5 表吻合 |
| 4 | `grep -c '^export' packages/vfsl-protocol/src/index.ts` | 12——冻结名单数据源吻合，逐名比对一致 |
| 5 | `node_modules/.bin/tsx /tmp/sa1-i45/probe-{edge,12,unref,bind}.mjs` | 四探针全复现（TS2314×9 / TS2440 / VfslKind·VfslPathMap CLEAN+绑协议声明源 / 未引用 TS2440+CLEAN / 三边缘形态零诊断） |
| 6 | `tsx /tmp/sa2-i45/probe-third-surface.mjs`（本评审自写，真管线） | `Record/string/number/boolean/unknown` → parse E303 拒收；`Array/Object/Function/Symbol/Partial/ReadonlyArray` → 放行且 post-N1 编译零诊断 |
| 7 | `sed -n '70,95p' packages/vfsl/src/parser.ts` | `RESERVED_NAMES` 16 名全集（含 Record/原始名；ROOT 不在其中） |
| 8 | `gh issue view 44` | OPEN，标题与三尾串语义 1:1 对应——「见 #44」非悬空引用 |
| 9 | `grep -n 'toThrow' generate-discriminated-emission.test.ts`（L103/121/150） | 三前缀正则实证，尾串替换零触碰 |
| 10 | `grep -o 'type [A-Za-z0-9_]* = ' 三既有测试文件` | fixture 别名 Entity/Id/Meta/A/B/U/Node/Extra ∉ 12 名 |
| 11 | golden snapshot 扫描（`toMatchSnapshot|InlineSnapshot|toBe(\``） | 无命中——无全文快照断言 |
| 12 | `git grep -n 'generateProjection' -- 'packages/**/*.ts'` | 生产 1（collect.ts:78）+ re-export 1（index.ts:7）+ 测试 6 文件——§12 caller 审计无遗漏 |
| 13 | `vitest run 三 SA6 红灯文件` | 3 files / 13 tests 全红——红灯基线未漂移 |
| 14 | `grep -rn 'generate' .github/workflows/ci.yml` | L55 `pnpm generate --check --allow-empty-domains`——零域集不受守卫影响 |
| 15 | cli.ts / collect.ts / header.ts / index.ts / package.json 全读 | :150-153 code 分支、:159-164 exit 2、:59/:72/:75 collect-先于-check-先于-写盘、:63-64 零域 flag、公共面最小、typescript 为 devDependency——§4.6/§12/§3.4 逐项吻合 |

---

## 结论

**Verdict: pass。**

设计的三条修复线（恒定 import 行、12 名碰撞守卫 + 独立错误码、三尾串替换）在机理、通道、次序、确定性、冲击面五个维度全部经本评审**独立复证成立**，无 CRITICAL/HIGH/MEDIUM 级漏洞；SA8 移交三项观察中①②裁定接受（证据充分、披露完整、方向响亮）、③坐实为纯文字勘误。4 项非阻断文字级修订要求（#1–#4，2 MINOR + 2 LOW）均为设计文档精度修正，零行为决策/文件范围/测试锚变动——建议 SA1 在 SA3 开工前出 v1.1 顺手修订并更新「SA2 反馈逐条回应」表，无需重新走 SA2 评审轮。

`pass` 仅覆盖设计层；实现与活链路验证仍属 SA4（静态门禁 + ALLOW/DENY 核对 + `grep -c = 0` 判据）与 SA7（动态验证，建议执行红灯测试思路 #3/#5/#6 探针）。
