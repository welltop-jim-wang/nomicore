# SA4 静态验尸报告 — materializeRoot 实现（issue #74）

**Date**: 2026-08-22 20:40
**Verdict**: **pass**（附 2 条 MINOR 登记：M1 设计文件清单滞后于总控硬门禁、M2 手造空联合 E200 message 措辞——均不阻塞放行）
**审查对象**: SA3 commit `ac0f487`（materialize.ts / xml-parse.ts / resolve.ts 新建，extract.ts / index.ts 修改，package.json 0.1.1→0.1.2）+ SA6 冻结测试修复 commit `d25beb6`
**基准**: design R2 定稿（997 行）、SA2 verdict=pass、SA6 冻结 13 用例（wiki/raw/task_doc-runtime-materialize-root.md）
**审查方法**: 全量源码通读 + 设计逐条比对 + 21 组对抗探针（独立进程实测，命令与输出内联 §5）+ CI workflow 触发性核查 + git diff set 比对

---

## 0. 硬门禁必做项结论（总控交办三项）

### 0.1 版本 bump 核查 ✅

`git diff 3e22795 HEAD -- packages/doc-runtime/package.json`：`"version": "0.1.1" → "0.1.2"`，且为该文件**唯一**改动（dependencies/exports/scripts/tsconfig 零变化）——patch 级提升符合总控硬门禁要求。仓库先例一致（#73 创建时 0.1.0→0.1.1，本任务 0.1.1→0.1.2）。

### 0.2 1.4 vitest 触发性自检 ✅ — **结论行：all-vitest-packages-triggered**

| 环节 | 证据 |
|---|---|
| 改动测试文件 | `packages/doc-runtime/test/materialize-root.test.ts`（新增，13 用例） |
| 所在 workspace package | `@nomicore/doc-runtime`（`packages/doc-runtime/package.json:2`） |
| CI 触发链 | `.github/workflows/ci.yml:7-8`（`on: pull_request`）→ job `test`（node 20/24 矩阵）→ `ci.yml:38-39` `Test: pnpm test` → 根 `package.json:11` `"test": "vitest run --typecheck"` → 根 `vitest.config.ts` `include: ['packages/*/test/**/*.test.ts', ...]` —— glob **覆盖** `packages/doc-runtime/test/materialize-root.test.ts` |
| typecheck 触发链 | `ci.yml:35-36` `Typecheck: pnpm typecheck` → 根 `package.json:13` 显式含 `tsc -p packages/doc-runtime/tsconfig.json` |
| 实证 | 本机复跑 `pnpm exec vitest run packages/doc-runtime/test/ --typecheck` → `6 passed (6) / 61 tests / Type Errors: no errors / EXIT=0`（与总控基线 57 文件 773 用例全绿一致；61 = 48 extract 既有 + 13 materialize 新增） |

doc-runtime 测试经根级 vitest glob 全量触发，非 `--filter` 白名单模式，不存在「测试存在但从未被 CI 触发」黑洞。**SA7 动态阶段仍须从 `gh run view --log` 摘录 materialize-root.test.ts 出现在 Test step 日志的证据**（静态自检的动态确认）。

### 0.3 SA6 测试修复（d25beb6）未收窄契约 ✅

两处 hunk 逐一验尸：

| Hunk | 原断言 | 修复后 | 收窄判定 |
|---|---|---|---|
| L184（U1/AC-1） | `expect(result.issues).toEqual(direct.issues)`（TS2339：`direct.ok` 收窄不跨块） | 块内提取 `directIssues = direct.issues`，块外 `toEqual(directIssues)` | **未收窄**：仍要求与直调结果逐条（内容+顺序）全等；`direct.ok===true` 分支被前置 `expect(direct.ok).toBe(false)` 先行拦停，`directIssues=[]` 兜底路径不可达 |
| L302（U7/AC-3） | `expect(img1.get('audit')).toEqual({...})` —— 自相矛盾断言：doc 侧 audit 恒为 Y.Map（U6 L279 载体锚点），yjs 实例 own enumerable 内部字段（`_map` 等）使 toEqual 永假 | `expect(Object.fromEntries(ymap.entries())).toEqual({...})` | **未收窄、实质更强**：投影调用 `.entries()` 在非 Y.Map 时即 TypeError 变红（隐式载体断言）；仍锚定 `createdBy==='alice'` 未被 `MUTATED` 污染（突变隔离语义完整保留） |

行号位移自洽验证：d25beb6 两个 hunk 共 +6 行，使 U2…U13 从设计 §1.4 记录的冻结行号各后移 3/6 行；而 `git show ac0f487:…test.ts` 中 13 个 `it(` 起始行 **L171/L194/L211/L229/L244/L264/L287/L308/L321/L335/L347/L362/L383 与设计 §1.4 冻结锚点逐一精确吻合** —— 证明 SA3 在 ac0f487 落盘的测试与 SA6 冻结版逐字一致，未篡改断言；测试文件后续唯一改动即 SA6 自有的 d25beb6。

---

## 1. 文件清单 Scope Creep Guard（§1.1）

- BASE = `3e22795`（`git merge-base HEAD origin/docs/doc-runtime-validation`）。
- actual（7 个代码/测试文件 + 8 个 wiki 档案）vs design §10 ALLOW LIST：

| actual 文件 | ALLOW LIST | 判定 |
|---|---|---|
| src/materialize.ts（新建 334 行） | ✅（约 280 行预估） | 合规 |
| src/xml-parse.ts（新建 221 行） | ✅（约 170 行预估） | 合规 |
| src/resolve.ts（新建 37 行） | ✅（约 45 行预估） | 合规 |
| src/extract.ts（-32/+2） | ✅（纯移动） | 合规，见 §2 D8 |
| src/index.ts（+9/-2，含头注） | ✅（"+2 行" 为功能行预估，其余为注释） | 合规 |
| test/materialize-root.test.ts（405 行） | ✅ [SA6 owned] | 合规，见 §0.3 |
| **package.json（version 1 行）** | ❌ **DENY LIST 命中** | 见 M1 登记 |
| wiki/raw/task_*（8 文件） | 白名单豁免 | 合规 |

- **DENY LIST 全量核验**（`git diff 3e22795 HEAD --stat` 逐项）：`packages/vfsl/**` ✅零改动、`packages/persistence/**` ✅、`src/carrier.ts` ✅、`test/extract-*.test.ts`（5 文件）✅、`tsconfig.json` ✅ 全部零触碰。
- **BLACKLIST**：diff 中无 `package-lock.json` / `yarn.lock` / `.DS_Store` / `TASK.md` / `*.bak` ✅。
- 工作区残渣：`.mabf/`（untracked 运行时目录，不进 commit）与 `dispatch.md`（wiki 白名单）——无碍。

**M1（MINOR，回流 SA1）**：design §10 DENY LIST 明列 `packages/doc-runtime/package.json`（措辞「零新依赖、零配置变化」），而总控本次硬门禁明确要求 version patch bump——实现服从总控指令（bump 满足 DENY 条目*动机*：依赖与配置确实零变化，仅 version 字段），但设计文件清单未同步修订。要求 SA1 在 design §10 将 package.json 移入 ALLOW LIST 并限定「仅 version 字段 patch bump（总控硬门禁 #74 要求），deps/exports/config 零变化」。**文档滞后，非实现缺陷，不构成 reject**（若 SA4 机械化套用「DENY 命中即 REJECT」将直接对抗总控显式交办项，故按总控指令优先原则降级为文档同步要求）。

---

## 2. 设计逐条符合性（§1.2 静态验尸全覆盖）

| 设计条款 | 实现 | 判定 |
|---|---|---|
| D1 四阶段编排；①②③ 共享 E200、④ 零捕获 | `materializeRoot` L51-61：`prepare()` 独占 try/catch（L68-98），`doc.transact` 物理位于 catch 之外，事务体仅 set 循环 | ✅ 结构性保证，非注释性承诺 |
| D2 logical issues 引用零损透传 | prepare L76 `return {kind:'fail', issues: logical.issues}` 同源引用不重包装 | ✅（U1 toEqual 平凡成立的根源） |
| D3 probeRoot 零修改复用 | carrier.ts 不在 diff 中；materialize.ts L85 直调 | ✅ |
| D4 构造侧形状断言 + 原型守卫 | `plainObjectOf`（proto === Object.prototype \|\| null）；`wordOf` object 子类附 constructor 申报 | ✅ 与 extract R2/#3 同判例 |
| D5 union 递归试验 / 无软拒 / 判别式死数据 / R2-M1 throw→E200 / R2-M2 首真 issue | `buildUnion` L173-181（firstIssue 声明序保留）；`rootEntries` L110-120 非法成员落末尾 throw；全仓 grep 零 `discriminator` 读取 | ✅ 探针 P1/P7/P17 实证 |
| D6 copyJsonDomain 六词同表 | 与 extract `copyPlainValue`（extract.ts:233-280）逐词逐行孪生：non-finite number 拆支 / bigint / 数组内 undefined / non-plain object（ctor 申报）/ function / symbol / 内嵌 Y 载体词；对象键 defineProperty；undefined 值 present 跳过 | ✅ INV-9 落文，探针 P3 实证全表 |
| D7 XML 解析器 | 扫描器骨架与 vfsl `xml.ts` `wellFormedXml` **逐条镜像**（同一 token 识别 / 同一 readXmlName/isXmlNameChar/skipXmlSpace 字符集——两文件并排逐行比对）；文本 span 逐字不解码；注释/CDATA/PI 逐字 XmlText；attr 值含 `"` 拒绝（L178-181）；重复 attr 经 setAttribute last-wins | ✅ 探针 P5/P15 实证 |
| D8 makeRefResolver 纯移动 | 删除块（extract.ts 旧 L229-251）与 resolve.ts 实现体**逐字相同**；extract.ts 仅剩 import + 注释变化 | ✅ 48 用例回归锚全绿 |
| D9 按快照键迭代 + F7 拒绝静默丢键 + Record `'<key>'` | mapEntries L189-206；`recordSlotOf` 与 extract.ts:101 / evaluate.ts:107 约定逐字一致 | ✅ |
| D10 事务体只含 set 循环 | materializeRoot L57-59；不读 detached、不再触解析器 | ✅ |
| §4.8 失败分类 F1-F10 | message 模板逐条对照实现一致（F2 L87 / F3 L90 / F4 shapeIssue / F5 domainIssue / F6 L118+L180 / F7 L199 / F8 L156 / F9 L96 / F10 throw） | ✅ |
| §7 index.ts 导出 | 与设计代码块逐字一致（`export { materializeRoot }` + type 导出） | ✅ |
| §3.1 公共签名 | `materializeRoot(derived, snapshot: unknown, doc: Y.Doc): MaterializeResult` 同步、返回值传错 | ✅ 无收窄 |
| 失败优先级冻结（logical ＞ 构造 ＞ ROOT） | prepare 内顺序 ①→②→③ | ✅ 探针 P20 实证 F1 优先 |

**INV-1~INV-9 逐条核销**（静态 + 探针双证）：

| 不变式 | 静态论证 | 实证 |
|---|---|---|
| INV-1 零写入 | ①只读 ②产物全 detached/新克隆 ③probeRoot 只读；④ 前一切 return 路径无 doc 写 | U3/U4/U9/U10 + P2/P3/P5/P11/P14 全部 `updates=0 stateEq=true` |
| INV-2 恰一事务 | 单 `doc.transact`；空 entries 空事务 0 事件（B12 合法） | U8 `=1`、P8 空=0、P10 嵌套归并=1 |
| INV-3 物化 fail-fast 单 issue | 所有 ②③ 失败路径构造单元素 issues 数组 | P1/P2/P3/P5/P11/P12/P13/P14 全部 `n=1` |
| INV-4 logical 全收集 | 引用透传 | U1（≥2 条 + toEqual） |
| INV-5 事务异常唯一出口 | ④ 无 try/catch | U13 toThrow + P9（多键中途抛：throw+1 update+部分提交不清理）+ P19（doc 级 observer 同样 loud） |
| INV-6 只写 ROOT | 全程唯一 doc 触点 probeRoot（'ROOT'）+ rootMap.set | U11 SCHEMA/META 不变 |
| INV-7 输入引用隔离 | 容器全重建 + defineProperty | U7（含 `stored !== input`）|
| INV-8 确定性 | Object.keys 枚举序 / members 声明序 / XML 源序 | 代码审读 + P7 声明序 |
| INV-9 往返域对称 | 六词同表（D6 行） | P3 五类 unknown 可达值全拒 + P15/P18 extract→revalidate ok |

---

## 3. 静默失败 / 伪降级 / 降级方案扫描（§3/§4/§6）

- **静默失败**：无。全部路径产出结构化 issue（F1-F9，message 非空 + path 锚定）或原样抛出（F10）；空 entries → `ok:true` 是 B12 冻结的正确语义（P8：0 update 合法零写入成功），非静默失败。
- **伪降级逐条拷问（B1-B12）**：无 merge/overwrite/部分安装（④ 前置门 + 探针 P20/U3）；无 Date 静默投影 `{}`（P3：`non-plain object (constructor: Date)` 响亮）；无 NaN/内嵌 Y「顺手存」（P3：Y.Map/bigint/function/undefined 元素全拒 + 0 update）；无 attr 双引号「尽力转义」（P5：F8 + stateEq）；无 observer 吞错/伪回滚/事后清理（P9：`a="1" b="2"` 部分提交原样保留）；无 union 兜底成员（P17）；无未声明键静默丢键（mapEntries F7 + 探针 P11 Proxy 发散单 issue）；手造派生物 loud（P12 四型全 E200）。
- **降级必要性**：实现未引入任何设计外降级路径；唯一的「宽容」行为——plain 对象 symbol 键不物化（`Object.keys` 天然跳过）——与 extract `copyPlainValue` 同款（读侧同样跳过）、与 JSON.stringify 投影一致，属三方对称的冻结语义而非数据丢失（P16：物化→extract→revalidate 全通，键集 `["u"]`）。
- **错误处理链路**：④ 抛错传播至调用方（同步函数，无 unhandledRejection 面）；①②③ 一切异常收敛 E200（P13 doc 非法 / P14 循环引用 Maximum call stack / P12 手造派生物）。

## 4. §1.6 契约改动连锁审查

改动面内**无既有导出契约变化**：`makeRefResolver` 为模块级移动（实现逐字不变，extract.ts 调用语句不变，仅 import 来源）；`extractYjsSnapshot` 零行为变化（48 用例绿）；`materializeRoot` 为纯新增导出，全仓 caller 仅 index.ts 转发 + 冻结测试（`grep -rn` 全量核验）。无 return→throw / 同步变异步 / catch 语义变化 → 白名单豁免条件满足，**pass**。

## 5. 对抗探针证据（21 组，独立进程 setsid nohup，tsx @ worktree，yjs@13.6.32 单实例）

| # | 攻击面 | 结果（全部符合设计冻结规格） |
|---|---|---|
| P1 | R2-M1 手造联合 ROOT 含 array 成员 | `ok=false n=1 e200=true`（throw→E200 定谳落实）+ stateClean |
| P2 | NaN @ number leaf（① 过 ② 拒） | `validateOk=true matOk=false non-finite number updates=0 stateEq=true` |
| P3 | unknown 位五类脏值 | Y.Map/bigint/function/Date/数组 undefined → 全部 F5 单 issue + 0 update |
| P5 | XML attr 值含 `"`（① 过） | `v=true m=false F8 updates=0 stateEq=true`（域分离实证） |
| P6 | Record own `__proto__` 键 | `validate=true mat=true keys=["__proto__"] get="v" extractOk=true roundtripKeys=["__proto__"]` 且输入对象原型未被污染 |
| P7 | 联合 ROOT 两成员 | `{a:'x'}`→`["a"]`、`{b:2}`→`["b"]` 各自成功 |
| P8 | 空 entries（全 optional 空快照） | `ok=true updates=0 size=0`（B12） |
| P9 | 多键 ROOT observer 首键后抛 | `threw updates=1 a="1" b="2"`（INV-5 深水：部分提交不清理，SA2 红线 #9） |
| P10 | 嵌套事务（P13） | `ok=true updates=1`（归并外层） |
| P11 | Proxy 双读发散（B10） | 构造读到 NaN → 单 issue non-finite + 0 update + stateEq |
| P12 | 手造派生物四型 | 非 root 结构 / ref 环 / ref 缺名 / 空成员联合 → 全部 E200 单 issue |
| P13 | doc 非法（null） | E200 单 issue，不外抛 |
| P14 | 循环引用快照 | E200（栈溢出收编）+ 0 update + stateEq |
| P15 | XML 往返家族 7 串 | 元素/实体/注释/PI 字节逐字还原；`<e k='v'/>`→`<e k="v"></e>`（重排后 revalidate 全 ok）——D7 规则 1/2/4 逐条活证 |
| P16 | symbol 键 plain | 物化-提取-重校验全通，与 extract 对称丢弃 |
| P17 | union 全拒 message（R2-M2） | 单 issue 且携带首成员差异词（`联合成员 1/3：类型不匹配…`）+ 0 update |
| P18 | 全形态 fixture 判别式路由 | 单 update + extract ok + revalidate ok（image 成员在 `body` 异键处短路 → text 成员胜） |
| P19 | doc 级 update observer 抛错 | loud throw + 值已提交 |
| P20 | 失败优先级 | logical 违规遇 ROOT 非空 → F1 完整 issues 胜出（冻结优先级） |

（初跑 P15/P16 曾现异常，定位为本 SA 探针脚本双 yjs 实例（pnpm store 绝对路径 import）破坏 instanceof 的**探针伪影**——`Yjs was already imported` 警告佐证；探针移入 package 目录单实例复跑后全绿。非实现缺陷。）

## 6. §1.7 源码 GREP 断言禁令扫描

`grep -nE "readFileSync|readFile\(|toMatch\(|toContain\(" packages/doc-runtime/test/materialize-root.test.ts` → **零命中**。全部断言为运行时行为断言（载体 instanceof / update 计数 / state 逐字节 / 突变隔离 / toThrow / revalidate）。✅

## 7. MINOR 登记与回流

| # | 级别 | 事项 | 回流 |
|---|---|---|---|
| M1 | MINOR（文档） | design §10 DENY LIST 含 package.json，与总控硬门禁要求的 version bump 冲突；实现已按总控执行（仅 version 字段，deps/config 零变化），设计未同步 | **SA1**：§10 ALLOW LIST 增补 package.json（限定 version 字段 patch bump） |
| M2 | INFO（代码 cosmetics） | `rootEntries`/`buildUnion` 对手造**空成员**联合（`members: []`）走到 `firstIssue!.message` 抛裸 TypeError（`Cannot read properties of undefined`）→ E200 收编。结局仍为 loud 单 issue E200（INV-3 守住），但 message 措辞不含「union 无成员」语义（extract 侧 walkUnion L171 有显式干净 throw）。仅手造派生物可达，13 用例与 SA2 红线均不触达 | **SA3**（下一任务顺手）：仿 extract 加显式 `throw new Error('union 无成员（手造派生物）')`；或登记不做 |

无 CRITICAL / MAJOR。SA2 三条 MINOR 修订（R2-M1/R2-M2/R2-M3）均已在实现中核销（P1/P17/§2 D7 行）。

## 8. 架构与过度设计评估

- **架构**：无绕过架构约束的硬编码/临时补丁/FIXME；崩溃边界由函数体结构（prepare/transact 切分）而非注释保证；不触发退回 SA1 信号。
- **过度设计**：新增代码 ~590 行对四个公共行为域（域拒绝/形状拒绝/XML 往返/崩溃边界），与 extract 侧既有复杂度对称；无「为将来需求」的抽象层；resolve.ts 抽取系设计 D8 明令的防漂移移动。✅ 精简。

---

## 审核结论汇总

1. 设计一致性：✅ 一致（D1-D10 / §4.8 / §7 逐条符合；偏离仅 M1 文档滞后）
2. 读写路径一致性：✅ 一致（物化写侧=extract 读侧同表同载体词表，INV-9 探针实证）
3. 静默失败：✅ 无（全路径结构化 issue 或 loud throw）
4. 降级方案：✅ 无伪降级（B1-B12 逐条探针核销；空 entries 为冻结正确语义）
5. 极端攻击：✅ 安全（21 组探针全数落位冻结规格；双 yjs 实例异常为探针伪影）
6. 错误处理：✅ 完整（E200 收编一切①②③异常；④ 唯一出口原样抛出）
7. 架构评估：✅ 可行（无退回信号）
8. 过度设计：✅ 精简

## 动态审核重点（交 SA7）

1. **CI 触发证据**：`gh run view --log` 摘录 PR CI `Test` step 中 `packages/doc-runtime/test/materialize-root.test.ts (13 tests)` 出现行（静态结论 all-vitest-packages-triggered 的动态确认；node 20 与 24 两矩阵腿都要）。
2. **SA2 红线 #1-#10 的活链路落测**：本报告 P1/P5/P6/P7/P9/P10/P17/P18 已在本地单实例实证，SA7 按 sa2_review.md「红线测试思路」在 CI 环境复跑（尤其 #9 多键部分提交与 #3/#4 值域可达性）。
3. **B 段重证（R2-M3-b）**：B2（空事务 0 事件）/ B7（嵌套 detached 单事务可读）/ B12（嵌套 transact 归并）/ B15（getMap 惰性零事件）于 SA3 实现产物上重证——本地 P8/P10/P18 已代跑，CI 侧补录。
4. **冻结 XML 文法镜像同步义务**：vfsl `xml.ts` 若未来演进（如 DOCTYPE），`xml-parse.ts` 必须同票跟进——登记为长期回归点（两侧当前逐字镜像，本报告已并排核验）。

**Verdict: pass** —— SA7 可进入动态验证。
