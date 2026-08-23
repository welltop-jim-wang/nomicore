# SA4 静态验尸报告

**Date**: 2026-08-24（R1 验尸轮）／ 2026-08-24（R2 复审轮，见文末「SA4 R2 复审」节）
**Verdict**: ~~reject~~ → **pass（R2 轮终审，2026-08-24）**——F-1 已由 SA3 commit `088a4a2` 按回流要求真实修复（putMetaKey defineProperty 四真，顶层+嵌套双位点）、SA6 回归锚 4 用例落地转绿、SA1 设计 D5 R3 touch-up 落文、F-2 顺势统一、N-1 措辞修正；全部经 R2 复审以键保真/原型级运行时证据独立确认（见文末）。R1 原始记录保留不删。

> **R1 Verdict（历史记录，已由修复回流闭环）**: reject（单项 REJECT 级发现 **F-1**：`getMetadata` 深拷贝用裸赋值 `out[k] = …` 构造返回对象——META `'__proto__'` 键触发**键静默丢失 / 返回对象原型被 doc 内数据替换**，违反 ADR-0008「getMetadata() 深拷贝顶层 META Y.Map 的全部键」与 AC4/D5；本仓已有两个硬化先例（doc-runtime `read.ts` putKey E8/E9、`extract.ts` putSnapshotKey R2.2/F-1——后者正是 SA4 历史上同型漏洞的修复回流），本包重新引入该已知陷阱。精确回流：**SA3 两处 ~4 行修复 + SA1 设计 D5 touch-up 一行 + SA6 回归锚**；其余全部审查项通过，无架构问题，不需要 needs-redesign）

- **被审对象**：SA3 commit `0931269`（`packages/namespace-runtime/src/**` 7 文件 763 行 + tsconfig + 根 package.json typecheck 一行）+ 工作树未 commit 的 SA6 R3 测试类型层修订（2 测试文件，diff 逐行核对确为类型层零行为改动）
- **基准文档**：SA1 设计 R2 终版 `task_namespace-runtime-skeleton-p0_design.md`（719 行）+ SA2 R2 pass 评审（含 N1/N2 注记）+ SA6 冻结契约 17 用例 + relevant_decisions.md（D4/D5 为 R1 快照，以设计 R2 为权威——已按此口径执行）
- **审查方法**：全静态验尸（逐文件对读设计 §4 D1–D9/§5 伪代码/INV-N1..N14）+ 边界攻击动态探针（4 轮 18 项，见附录 A）+ 全量测试套件独立复跑 + Hard Gate #13/#14 触发性静态自检 + §1.7 源码 grep 断言禁令扫描
- **测试证据**（独立后台进程 `setsid nohup` 复跑，与 CI 同命令）：
  - `pnpm exec vitest run packages/namespace-runtime --typecheck --passWithNoTests=false` → **3 文件 / 17 用例全绿，Type Errors 0，exit 0**
  - `pnpm typecheck`（七包串联，含新包）→ **exit 0**
  - `pnpm test` → **73 文件（基线 70 + 本任务 3）/ 1019 用例（基线 1002 + 17）全绿，Type Errors 0，exit 0**——既有 1002 用例零回归

---

## 一、Scope Creep Guard（§1.1）——✅ 通过

actual diff（`git diff --name-only origin/docs/namespace-runtime 0931269`，21 文件）vs ALLOW LIST（设计 §11）逐项比对：

| 文件 | 判定 |
|---|---|
| `packages/namespace-runtime/src/{index,runtime,sequencer,p0,projection,status,errors}.ts`（7 新建） | ✅ ALLOW 明示（模块合并自由度未被滥用——七文件与 §3 清单一一对应） |
| `packages/namespace-runtime/tsconfig.json` | ✅ ALLOW（include 仅 `src/**`，与 §7.1 决策逐字一致） |
| `package.json`（仓库根） | ✅ ALLOW（diff 恰一行：typecheck 追加 `&& tsc -p packages/namespace-runtime/tsconfig.json`，§7.2 精确落实，无其他改动） |
| `packages/namespace-runtime/test/*.test.ts`（3） | ✅ [SA6 owned]；其中 2 个的工作树改动 = SA6 R3 修订（任务简报登记），diff 逐行核对：p0-sequencer 仅「字面量经 unknown 单点收窄」、sync-read-face 仅「as unknown as 双跳 cast」——**运行期值形状零变化，行为断言/用例数零改动**，与 R3 修订记录声明一致 |
| `packages/namespace-runtime/package.json` | ✅ 非 creep——SA6 登记产物（任务简报明文「package.json 既有；SA3 不改」）。内容核对：deps 恰为简报登记的 doc-runtime/persistence/vfsl/yjs；scripts/devDependencies 与 doc-runtime 包结构逐字段同款（仓内建包惯例）。设计 §11 DENY 语义是「SA3 无需改动」，分支内该文件先于 SA3 存在 |
| `pnpm-lock.yaml` | ✅ 白名单豁免 + SA6 importer 登记（简报明文） |
| `wiki/raw/task_namespace-runtime-skeleton-p0*`（7） | ✅ 白名单豁免 |

**反向 BLACKLIST**：`package-lock.json` / `yarn.lock` / `TASK.md` / `*.bak` / `.DS_Store` 全部零命中。未跟踪 `.mabf/` 为流水线运行时目录，未进 commit。

## 二、设计一致性（§1.2）——✅ 高保真（F-1 为设计伪代码同患的规格空洞，见发现清单）

逐决策对照（实现 vs 设计 §4/§5）：

| 决策 | 实现核验 | 结论 |
|---|---|---|
| D1 构造序（V1 形状守卫/V2 状态门/V3 前置） | `captureSeamInput`（runtime.ts:127-188）合并 V1 校验+捕获（设计 N1 建议的「合并为一次读取」形态）；V2 词表外值 loud throw（探针 F1：`mystery` → `HANDLE_NOT_USABLE: … 不可构造`）；一切 seam 读取/身份捕获均在 `enqueue` 之前——INV-N4 结构成立 | ✅ |
| D2 七键闭包 + freeze | runtime.ts:104-114：字面量七键、`Object.freeze`、handle/doc/state/sequencer 全在闭包；`createNamespaceRuntime` 仅 runtime.ts 模块级导出，index 不 re-export（AC1 测试锁定缺席） | ✅ |
| D3 read 纯透传 | runtime.ts:108 单行透传 `readLogicalValueAtPath(doc, path)`，doc 构造时捕获一次；INV-N10 | ✅ |
| D4 双模式投影 + 值域守卫 | projection.ts:49-90：share.has 缺席→null、getMap try/catch 异型→null、固定四键、`isPrimitiveValue` 守卫（object≠null/function/symbol 覆盖一切 `Y.AbstractType`/Uint8Array；bigint 过——N2 落地）；public throw `SchemaProjectionError`/p0 键省略。**探针 A1/A2 动态证实**：`sc.set('version', new Y.Map())` → `getSchemaEnvelope()` throw `NSRT-SCHEMA-E1`；P0 → `unavailable` + `SCHEMA_ENVELOPE_2`（ENV-2 缺键收编）、fatal null、SCHEMA write 可修复、其余读取面照常——SA2 #1 修复逐字落地 | ✅ |
| D5 META 深拷贝 + 双 loud | projection.ts:110-137：载体缺席/异型 → `NSRT-META-E2` loud（SA2 #2 方案 a）；值域违规 → `NSRT-META-E1`（bigint/undefined/function/symbol/non-finite/嵌套 Yjs/非 plain 原型）。**但键写入用裸赋值——F-1（见发现清单）** | ⚠️ F-1 |
| D6 sequencer | sequencer.ts:35-39 与设计伪代码逐字同构（`tail.then(run, run)` + 链尾 noop 接线）；`enqueue(() => runP0(env))` thunk 纯调用零求值面（runtime.ts:101） | ✅ |
| D7 P0 槽体三级分级 | p0.ts:72-122：gate → 投影(p0) → compile → ok:true 过 `assertCompiledShape` 最小守卫 / ok:false 零 issues → fatal / 非 envelope kind → `SCHEMA_TEXT_INVALID`；整体 try/catch，`fatalCause` 包内锚点（grep 证实不进任何公共面） | ✅ |
| D7.4 摘要映射 | `'SCHEMA_ENVELOPE_' + String(code)` 不透明透传（探针 A2 实测 `SCHEMA_ENVELOPE_2`） | ✅ |
| D8 五字段身份 + tools 内部 | p0.ts:142-154 freeze 五键、activeTools 只存 state；探针+冻结测试证实 module/derived/validator 三键 undefined | ✅ |
| D9 status 六键 | status.ts:38-54 位公式逐字一致（rootWrite 另需 state≠unavailable；handle.getStatus() throw 原样传播——无 try/catch） | ✅ |
| D8' seam 形状 | runtime.ts:38-45 + captureSeamInput thenable/function 校验 | ✅ |
| §7.1/7.2 构建 | tsconfig include src-only；根 typecheck 追加（diff 恰一行） | ✅ |
| ADR-0001 边界 | `grep "type ROOT" src/` 零命中——src 不含 schema 文本 | ✅ |

**继承自设计的规格空洞**：设计 §4 D5 伪代码 `out[k] = copyMetaValue(...)` 同样是裸赋值——F-1 根因在设计文本层未被排除（设计引用了 read.ts 的 isPlainRecord/D4 先例却未引用 putKey 先例）。处置：SA1 touch-up 一行，非 redesign（修复机理与成本全在实现侧）。

## 三、Hard Gate #14：vitest 触发性自检（2026-06-15 立法）——✅ 通过（本任务设计含 *.test.ts 新增，强制执行）

| 检查项 | 证据 | 结论 |
|---|---|---|
| 抽出新增 `*.test.ts` | diff 含 3 文件：`packages/namespace-runtime/test/runtime-{public-surface-ownership, sync-read-face, p0-sequencer}.test.ts` | — |
| CI vitest 覆盖 | `.github/workflows/ci.yml:39` `pnpm test` → 根 package.json `"test": "vitest run --typecheck"` → `vitest.config.ts:5` include `packages/*/test/**/*.test.ts`——glob 命中 `packages/namespace-runtime/test/*.test.ts`（三文件均匹配 `packages/*/test/**` 深度且非 `*.test-d.ts`） | ✅ 三文件全部落在 test job 范围 |
| typecheck 覆盖 | ci.yml:36 `pnpm typecheck` → 根脚本已含 `tsc -p packages/namespace-runtime/tsconfig.json`（§7.2 落地），CI 端零 workflow 改动（与设计 §7.4「CI 零改动」声明一致，DENY LIST `.github/workflows/ci.yml` 未被触碰） | ✅ |
| Node 矩阵 | ci.yml `matrix: node: [20, 24]` 两档均跑 typecheck+test | ✅ |
| 动态佐证 | 本轮独立复跑 `pnpm test`：**73 文件全绿且三新文件在收集清单中**（`✓ packages/namespace-runtime/test/*.test.ts (17 tests)`）——收集非仅静态推断 | ✅ |
| Hard Gate #13（spec） | diff 无 `*.spec.ts` | N/A |

**结论：`verdict: vitest-package-not-triggered` 不成立——新包测试经 `pnpm test` 通配全量接通，typecheck 经根脚本显式接通。** SA7 动态阶段可从 `gh run view` 摘录三文件触发证据进一步确认。

## 四、协议假设审查（§1.5）——✅ 通过

设计 §12 存在且 14 条假设均带依据栏与风险等级，无「应该/通常/预计」措辞（SA2 R2 已独立重跑全部关键实测并命中）。本轮 SA4 抽查复跑与实现直接相关的假设：

| 假设 | SA4 复跑 | 结果 |
|---|---|---|
| #2 getMap 异型 throw / #3 share.has 语义 / #4 set-undefined 键语义 | 探针（附录 A：P1/C1 + A2 经 projectSchemaEnvelope 实路径） | ✅ 与设计一致 |
| #6 compile 严格门对 null/缺键返回结构化 ok:false | 探针 A2：违规 SCHEMA 键省略 → `SCHEMA_ENVELOPE_2` unavailable，非 fatal、非异常 | ✅ |
| #5 PromiseJobs 微任务起步（INV-N1） | 冻结测试 17/17 绿（构造后同步 preparing 断言）+ 全量复跑 | ✅ |
| #14 META/SCHEMA 生产可达性不对称 | 探针 P4：createDoc 接受含 `__proto__` 键的 META（只校验 docId）；C1：yjs 编解码 round-trip 后该键存活 | ✅（**该可达性正是 F-1 生产可达的证据**） |

## 五、契约改动连锁审查（§1.6）——✅ N/A（无既有契约改动）

diff 触及的既有文件仅根 `package.json` 的 `scripts.typecheck` 字符串（构建脚本，非函数契约）。新包对 doc-runtime/vfsl/persistence 的消费全部是既有公共导出的只读调用，无任何既有函数的 throw/return/async/catch 语义改动，不存在 caller 侧连锁。与设计 §13 声明一致。

## 六、测试质量（§1.7 源码 grep 断言禁令 + SA2 N2）——✅ 通过

- **源码 grep 断言禁令**：三测试文件 `readFileSync` 零命中；`toContain` 命中 8 处均为**数组成员断言**（`['preparing','ready','unavailable']).toContain(state)`、`keys).not.toContain('queue')`）或**运行时值断言**（`fatal.message).not.toContain(BOOM)`）——非「读源码字符串做正则断言」反模式。全部断言锚定公共接缝的可观测输出。
- **SA2 N2（红灯断言禁 JSON.stringify）**：三测试文件 `JSON.stringify` 零命中；active schema 身份断言用逐字段 `toBe`、键集断言用 `Object.keys` 排序比对——N2 合规。
- **fixture 纪律**：handle 一律经真实 `MemoryPersistence.createDoc` 构造，唯一缝是 seam 注入——无 mock 越界。
- SA6 R3 工作树修订：diff 逐行核对为纯类型层（unknown 单点收窄 / 双跳 cast），运行期字面量与断言零改动——与简报 R3 修订记录逐条一致。

## 七、读写路径一致性（§2）——✅ 通过

新包纯只读消费：`read` 直通 doc-runtime 同一函数（INV-N10 同源）；SCHEMA 读取单点 `projectSchemaEnvelope`（公共面与 P0 双模式同源，键集/缺席/异型语义不可能分叉——探针 A1/A2 同 doc 两模式行为互补证实）；META 读取单点 `projectMetadata`；写路径 v1 不存在（sequencer 仅骨架，无写旁路——`grep` 证实 src 无任何 `transact`/`notifyDirty` 调用）。无数据源分叉。

## 八、静默失败专项（§3）——❌ F-1（唯一命中）

F-1 的静默形态：META 顶层 `'__proto__'` 键持**标量值**时（探针 P3/P5），键从深拷贝产物中**完全蒸发**（setter 静默忽略赋值），无 throw、无状态位、无任何可观测信号——调用方拿到缺键的「全键深拷贝」。这同时命中「静默失败通道」与 ADR 契约违背（详见发现清单）。其余全部路径有可观测出口（fatal/unavailable/throw/结果联合）。

## 九、降级方案审查（§4）——✅ 通过（无伪降级）

- persistence-degraded → 写位 false、读与 P0 照常（ADR 明文，真实可达状态，非伪降级；D9 落实）；
- SCHEMA 缺席/异型 → null → ENV-1 → unavailable（可观测缺席信号，生产合法可达——设计 R2 论证成立，探针 P4 佐证 createDoc 宽容）；
- P0 失败三级分级全部收敛到结构化终态（fatal/unavailable），无中间态滞留（探针 G2：compile throw → fatal + state preparing ∈ 三态；E1：gate reject → fatal）；
- 无「替别的模块缺陷兜底」型降级。F-1 不属降级设计问题，属实现缺陷。

## 十、极端条件攻击（§5）——❌ F-1（动态实证）+ 2 项 LOW 备案（F-2/F-3）

18 项探针结果汇总（附录 A 全文）：

| 攻击面 | 结果 |
|---|---|
| SCHEMA 四键持 live `Y.Map`（INV-N13） | ✅ 守卫工作：public `NSRT-SCHEMA-E1` throw / P0 键省略 → unavailable（A1/A2） |
| p0Gate reject（边界 #1） | ✅ fatal `NSRT-FATAL-P0-INTERNAL`、文案不含哨兵、双写关、读保留（E1/E2） |
| 未知 handle 状态（边界 D1 V2） | ✅ `HANDLE_NOT_USABLE` loud（F1 探针） |
| 注入 compile throw（边界 #2） | ✅ fatal 稳定摘要、无 unhandled rejection（G2/G3——INV-N12 动态面零噪声） |
| **META `'__proto__'` 键（标量/对象值、嵌套层、round-trip）** | ❌ **F-1：键丢失 + 原型替换 + 下游 TypeError（P2/P3/P5/P6/B1/B2/C1）** |
| 嵌套 plain object undefined 值键 | ⚠️ F-2（LOW）：与顶层 E1-throw 不一致（吸收 vs throw） |
| 循环 META 值（seam 直通） | ⚠️ F-3（LOW）：原始 `RangeError` 外抛（loud 家族正确、无稳定 code）；经 createDoc 不可达（persistence 编码期即崩） |
| 残缺 handle / flaky getter（边界 #19/#20） | ✅ 结构安全（captureSeamInput 单函数捕获 + 全部前置于 enqueue；p0Gate/compile 的 undefined 检查+捕获双读均在构造栈内——见注记 N-1） |

## 十一、错误处理链路（§6）——✅ 完整（F-1 除外）

全部分支有对应错误状态或结构化迁移：V1/V2 throw（构造契约）、P0 ⑦ fatal（permanent + fatalCause 包内锚点）、⑥ unavailable（issue 摘要冻结）、投影器双 loud（NSRT-SCHEMA-E1/NSRT-META-E1/E2）、`handle.getStatus()` throw 原样传播（设计边界 #13 明文）。INV-N12 零 unhandled rejection 经全局监听器动态证实（G3）。

## 十二、架构评估（§7）——✅ 可行，无需退回 SA1

实现与设计同构度高（§二对照表 14/15 项逐字级一致）；无绕过架构约束的补丁（零 TODO/FIXME）；F-1 修复为局部机械替换（沿本仓两个既有先例），不动数据流、不动状态机、不触及其他模块。退回信号全部不满足。

## 十三、过度设计审查（§8）——✅ 精简

763 行 src 对应设计 D1–D9 全谱契约（构造序守卫/双模式投影/三级分级/结构化 status），无「为将来需求」的空壳（写槽/close barrier 严格按设计只留文档位不预写代码——sequencer 40 行恰为 FIFO 最小实现）；descriptor 级键读取沿 read.ts 先例而非新发明；变更半径=设计 ALLOW 清单。

---

## 审核结论（8 项汇总）

1. **设计一致性**：⚠️ 高保真 + 1 项规格空洞继承（F-1 设计伪代码同患，SA1 touch-up）
2. **读写路径一致性**：✅ 一致（SCHEMA 双模式同源单点、read 纯透传）
3. **静默失败**：❌ F-1（META `'__proto__'` 标量值键静默蒸发）
4. **降级方案**：✅ 安全（无伪降级；F-1 属实现缺陷非降级设计）
5. **极端攻击**：❌ F-1（REJECT，动态实证）；F-2/F-3 LOW 备案
6. **错误处理**：✅ 完整（F-1 缺口除外；INV-N12 动态零噪声）
7. **架构评估**：✅ 可行（局部修复，无需退回）
8. **过度设计**：✅ 精简

**Hard Gate #14 结论（强制写入项）**：✅ **通过**——3 个新增 `*.test.ts` 全部落在 CI `pnpm test`（`vitest run --typecheck` + include `packages/*/test/**/*.test.ts`）收集范围内，typecheck 经根脚本第七包串联覆盖；`verdict: vitest-package-not-triggered` 不成立。零 workflow 改动，与设计 §7.4 声明一致。

---

## 发现清单

### F-1【REJECT】`getMetadata` 键写入裸赋值 → META `'__proto__'` 键丢键 + 返回对象原型劫持

- **位置**：`packages/namespace-runtime/src/projection.ts:134`（顶层 `out[k] = copyMetaValue(meta.get(k), …)`）与 `projection.ts:180`（嵌套对象分支 `out[k] = copyMetaValue(hit.value, …)`）
- **机理**：`out['__proto__'] = v` 命中 `Object.prototype.__proto__` accessor——**标量值被 setter 静默忽略（键丢失）；对象值替换 `out` 的原型（键丢失 + 原型被 doc 内数据接管）**。Y.Map 顶层键走内部 `Map` 存储，`'__proto__'` 可存可读（`meta.keys()` 正常产出该键）。
- **违反契约**：ADR-0008 L31「`getMetadata()` 深拷贝顶层 META Y.Map 的**全部键**」；任务简报 AC4「META 返回全部 plain JSON 字段」；设计 D5「逐键深拷贝」。`'__proto__'` 键与 plain object 值均在契约域内（Y.Map 键空间开放、plain object 是合法 META 值、createDoc/loadDoc 只校验 docId）。
- **可复现证据**（附录 A 全文，探针经 tsx 跑真实实现）：
  - P1：`meta.set('__proto__', {evil:'payload', toString:'NOT-A-FUNCTION'})` → `meta.keys()` = `["docId","createdAt","__proto__"]`；
  - P4：`persistence.createDoc` 接受该 META（`ready`）——**生产路径可达，无需上游 bug**；
  - C1：`Y.encodeStateAsUpdate → applyUpdate` round-trip 后该键存活（`["docId","createdAt","__proto__"]`）——**持久化/跨会话可达**；
  - P5：`runtime.getMetadata()` 返回 own keys `["docId","createdAt"]`（**键丢失**）且 `Object.getPrototypeOf(result).evil === 'payload'`（**原型被替换**）；
  - P3：标量值时键完全蒸发（原型不变）；
  - P6：`String(result)` 抛 `TypeError: Cannot convert object to primitive value`（继承的 `toString` 为字符串）——**下游模板字符串/拼接场景崩溃**；
  - B1/B2：嵌套 plain object 自有 `'__proto__'` 键（defineProperty 构造）同样丢失——**两层皆中**。
- **影响定级**：MEDIUM-HIGH。不破坏 sequencer 单写模型（劫持只作用于已剥离 live 引用的深拷贝副本，无 Yjs 写面泄漏），但 (a) 全键深拷贝契约被击穿；(b) 返回对象原型被 doc 数据接管，属性回退链可见攻击者属性（`in` 检查、继承方法查找被污染）；(c) 数据驱动的下游崩溃向量（loadDoc 场景下 doc 创建者可影响其他消费进程的 getMetadata 消费方）。
- **仓内先例（本仓已知陷阱，本包属重新引入）**：
  - `packages/doc-runtime/src/read.ts:447-452` `putKey`：「经 defineProperty 写入 `'__proto__'` 自有键不触发原型 setter（E8/E9 防劫持）」；
  - `packages/doc-runtime/src/extract.ts:331-336` `putSnapshotKey`：R2.2/F-1 修复回流——**与本次完全同型**（SA4 历史发现「Record 动态键 `'__proto__'` 在 ok:true 下静默丢失/原型劫持」的修复产物，注释明文「禁赋值式」）。
- **修复要求（回流目标 SA3）**：`projectMetadata` 顶层与 `copyMetaValue` 对象分支的键写入一律改经 `Object.defineProperty(out, k, { value, writable: true, enumerable: true, configurable: true })`（或 `Object.create(null)` 容器）——两处 ~4 行，机械替换，零行为面变化（对无 `'__proto__'` 键的 META 完全等价）。
- **设计 touch-up（回流目标 SA1，一行）**：D5 伪代码补注「键写入经 defineProperty 安全助手（沿 read.ts putKey / extract.ts putSnapshotKey R2.2/F-1 先例，禁赋值式）」。
- **回归锚（回流目标 SA6）**：新增用例——META 顶层与嵌套 `'__proto__'` 键（对象值 + 标量值）→ `hasOwnProperty` 保真断言 + `Object.getPrototypeOf(result) === Object.prototype` 断言（**按 SA2 N2：用 hasOwnProperty/getPrototypeOf/typeof 断言，不用 JSON.stringify**）；加 persistence round-trip 变体（C1 场景）。沿 extract-yjs-snapshot F-1 闭环先例。

### F-2【LOW，备案不阻断】嵌套 plain object 的 undefined 值键被吸收，与顶层处置不一致

`projection.ts:231-233`（`readableOwnDataValue` 对 `desc.value === undefined` 返回不命中 → 键省略）vs `projection.ts:153`（顶层 Y.Map 键 get 为 undefined → `NSRT-META-E1` throw）。同一「undefined 值」在两层一 throw 一吸收。设计 D5 未明文对象分支的 undefined 处置；yjs ContentAny 对嵌套对象内的 undefined 无法 round-trip（仅 in-memory 引用可达）。建议随 F-1 修复时顺手统一（对象分支 undefined 值键并入 E1-throw，与数组元素处置对齐）；SA1 可在 D5 补半句。

### F-3【LOW，备案不阻断，交 SA7 观测】循环 META 值 → 原始 RangeError 外抛（非稳定 code）

探针 D1：seam 直通（绕过 persistence）的循环引用 META 值 → `copyMetaValue` 无限递归 → 裸 `RangeError: Maximum call stack size exceeded` 从 `getMetadata()` 外抛（loud 家族正确、无 MetaProjectionError 稳定 code）。经 createDoc 不可达（persistence 编码期 lib0 writeAny 自身先崩）。按 §8 过度设计守卫不建议加环检测——维持 loud，仅登记；若 SA1/SA6 认为需要稳定 code，可在 copyMetaValue 入口加有限深度守卫（≤32，与 isPlainRecord 同款）转 `NSRT-META-E1`。

### 注记 N-1（表述精度，零行为影响）

`runtime.ts:125-126` 头注声称「每个 seam 字段恰读一次」——实际 `p0Gate`/`compile` 各读两次（runtime.ts:166-167/174-175 的 undefined 检查 + 捕获）。两次读取均在构造栈内、enqueue 之前：flaky getter 的任何行为要么在构造期 throw（零副作用、INV-N4 成立），要么被第二次读取捕获后永不再读——SA2 N1 的安全性质（入队后零读）**成立**。仅头注措辞与代码不完全一致，SA3 修复 F-1 时可顺手改为「构造栈内有限次、入队后零次」。

---

## 动态审核重点（交 SA7）

1. **F-1 修复验证**（SA3 修复 + SA6 回归锚落地后）：`getMetadata()` 对含 `'__proto__'` 键 META 的全键保真（hasOwnProperty + 原型未被替换），含 persistence round-trip 变体（本报告附录 A C1 场景重跑）；
2. **CI 触发证据摘录**：`gh run view --log` 摘录 `pnpm test` 步骤中三个 `packages/namespace-runtime/test/*.test.ts` 文件的执行行（Hard Gate #14 静态已过，SA7 按 SKILL「vitest 触发证据」要求动态确认）；
3. **Node 20 档实测**：本轮复跑环境为 Node 24.13.0；CI 20/24 双档均需绿（微任务时序/`Object.prototype.__proto__` accessor 语义两档一致，预期无差异，以 CI 为准）；
4. **F-3 形态确认**：seam 直通循环 META 值时 `getMetadata()` 的外抛形态是否如 D1 记录（RangeError、可捕获、无进程级影响）；
5. **外部违约 release 后读取面**（设计 R3 边界）：`handle.release()` 后 `read`/`getSchemaEnvelope` 照常、写位瞬时观察转 false——真实时序下确认。

---

## 附录 A：探针命令与输出（可复现）

执行环境：worktree `packages/namespace-runtime/` 下 `pnpm exec tsx <probe>`（Node 24.13.0，yjs 13.6.32，经真实 `@nomicore/persistence` createDoc 与 `src/runtime.ts` 真实实现）。探针脚本全文备份：`/tmp/sa4-probe1-final.mjs` / `/tmp/sa4-probe2-final.mjs` / `/tmp/sa4-probe3-final.mjs`。

### A-1 F-1 核心复现（probe1 摘录）

```text
P1 keys(): ["docId","createdAt","__proto__"]            ← yjs 可持 '__proto__' 键
P2 own keys of out: []                                    ← 裸赋值后 own 键为空
P2 __proto__ own key present: false
P2 prototype replaced: true                               ← 原型被攻击对象替换
P2 inherited evil visible: payload                        ← 攻击属性经原型链可见
P3 own keys: [] | proto unchanged: true                   ← 标量值：键静默蒸发
P4 createDoc accepted META with __proto__ key: ready      ← 生产路径可达
P5 getMetadata() own keys: ["docId","createdAt"]          ← 全键契约被击穿
P5 has own __proto__ key: false
P5 prototype is attacker object: payload                  ← 返回对象原型被劫持
P6 String(m) throws: TypeError - Cannot convert object to primitive value
```

### A-2 守卫/分级/门/状态正向验证（probe2/probe3 摘录）

```text
A1 getSchemaEnvelope throws: SchemaProjectionError | code= NSRT-SCHEMA-E1   ← INV-N13 公共面
A2 P0 state: unavailable | issue code: SCHEMA_ENVELOPE_2 | fatal: null       ← p0 面省略→ENV-2
A3 read ok: {"ok":true,"value":{}} | meta docId: ns-evil1                    ← 横向隔离
B1 nested own keys: ["origin"] | B2 own __proto__ preserved: false           ← 嵌套层同患
C1 round-trip META keys: ["docId","createdAt","__proto__"]                   ← 持久化可达
D1 getMetadata throws: RangeError | code= undefined                          ← F-3
E1 gate reject → fatal: NSRT-FATAL-P0-INTERNAL | msg-contains-sentinel=false
E2 writes closed: true | read kept: true
F1 unknown status throws: NamespaceRuntimeConstructionError | HANDLE_NOT_USABLE: …mystery…
G2 compile-throw → fatal: NSRT-FATAL-P0-INTERNAL | msg-contains-sentinel: false | state: preparing
G3 (no G1 lines above = no unhandled rejection)                              ← INV-N12 动态面
```

### A-3 测试套件独立复跑（独立后台进程）

```text
$ pnpm exec vitest run packages/namespace-runtime --typecheck --passWithNoTests=false
 Test Files  3 passed (3)   Tests  17 passed (17)   Type Errors  no errors   exit 0
$ pnpm typecheck    # 七包串联含 namespace-runtime
 exit 0
$ pnpm test          # CI 同命令
 Test Files  73 passed (73)   Tests  1019 passed (1019)   Type Errors  no errors   exit 0
```

---

## 处置要求（总控）

1. **驳回 SA3 当前实现**（verdict: reject）——F-1 修复后 SA4 复审（复审范围：projection.ts 键写入 diff + SA6 回归锚转绿，其余项不重审）；
2. **回流 SA1**：D5 touch-up 一行（putKey/putSnapshotKey 先例引用）；F-2 半句可选；
3. **回流 SA6**：F-1 回归锚（顶层+嵌套+round-trip 三变体，断言用 hasOwnProperty/getPrototypeOf，N2 合规）；
4. F-3/N-1 备案不阻断。

（本报告为 SA4 唯一可写产物；未修改任何生产代码与冻结测试。探针脚本经 worktree 临时 scratch 执行后已清理，全文备份于 /tmp 供复审重跑。）

---
---

# SA4 R2 复审（2026-08-24）

**复审对象**：SA3 修复 commit `088a4a2`（projection.ts + runtime.ts，54+17/-20 行）+ SA6 回归锚 `packages/namespace-runtime/test/metadata-proto-key.test.ts`（4 用例，R4 fixture 修订版）+ SA1 设计 D5 R3 touch-up（工作树落文）。
**复审范围**（R1 限定，严格不越界）：F-1 修复面 diff 核验 + 锚转绿 + 附带项（F-2 行为变化 / F-3 登记态 / N-1 措辞）。R1 其余通过项不重审。
**复审方法**：diff 逐行审读 + R1 探针原样重跑（F-1 键保真/原型对照）+ F-2/F-3 新探针 + 三套件独立复跑（独立后台进程，CI 同命令）。不采信任何自述，全部证据本轮重取。

## 1. F-1 修复面核验——✅ 真实修复（非表面补丁）

| 检查项 | 证据 | 结论 |
|---|---|---|
| 回流要求落地 | `putMetaKey`（projection.ts:206-208）= `Object.defineProperty(out, k, { value, writable: true, enumerable: true, configurable: true })`——与 read.ts putKey / extract.ts putSnapshotKey 四真描述符逐字同款 | ✅ |
| 双位点覆盖 | 顶层 `projectMetadata`（projection.ts:144）+ 嵌套 plain object 分支（projection.ts:195）两处调用点恰对应 R1 指认的 :134/:180 | ✅ |
| 无残留裸赋值 | `grep "out\[[ki]\] =" projection.ts` 仅剩 :92——**SCHEMA 四键投影的固定键集** `['lang','version','id','text']`（结构免疫 `'__proto__'`，R1 已判定无需改）与注释行；数组分支走 `push`（数字下标无原型 setter 病理） | ✅ 完备 |
| 修复面纯洁性 | commit 088a4a2 仅触 projection.ts + runtime.ts 两文件，冻结测试零触碰（git stat 核验） | ✅ |
| 运行时证据（R1 探针原样重跑） | P5：`getMetadata()` own keys `[\"docId\",\"createdAt\",\"__proto__\"]`（R1 为缺键）+ `has own __proto__ key: true` + **prototype 不再被替换**（R1 为 `payload`）；P6：`String(m)` 恢复正常（R1 为 TypeError）；B1/B2：嵌套层 own keys `[\"origin\",\"__proto__\"]` + 原型干净；C1：round-trip 后 own 键存活 + 原型干净 + 值逐字保真 `{"evil":"roundtrip"}` | ✅ 契约击穿面全部闭合 |

## 2. SA6 回归锚转绿——✅ 锚定质量合格

- **4 用例覆盖矩阵**：顶层标量值（键保真+值原样+原型不替换）/ 顶层对象值（键保真+深拷贝+突变隔离+原型不替换）/ 嵌套层（JSON.parse 真 own 键+副本非同引用+原型干净）/ persistence round-trip（R1 C1 场景复刻）——恰为 R1 回流要求的三变体 + 隔离断言。
- **断言纪律（SA2 N2）**：全部经 `Object.hasOwn` / `Object.getPrototypeOf` / `Object.keys` / 值断言——`JSON.stringify` 零命中、零源码读取。✅
- **R4 fixture 修订核验**：`'__proto__'` 键一律经 computed key `{ ['__proto__']: v }` 注入（真 own enumerable data property）；头注明文记录字面量裸写 `{ __proto__: v }` 是原型设置语法、键永不入 Y.Map 的陷阱——fixture 纪律正确且留档。
- **CI 触发**：文件落 `packages/namespace-runtime/test/*.test.ts`，命中 `packages/*/test/**/*.test.ts` 通配——本轮全量复跑 74 文件收集清单中可见（Hard Gate #14 范围自动延续覆盖）。
- **转绿证据**：`✓ packages/namespace-runtime/test/metadata-proto-key.test.ts (4 tests)`，包内 4 文件 21/21 绿。

## 3. 附带项复核

**F-2（行为变化）——✅ 已按 R1 建议方向统一，兼容性证实**：`readableOwnDataValue` 从二路 `{hit|miss}` 改三路 `{ok|skip|undefined}`——嵌套 plain object 的 undefined 值键从吸收改为 `NSRT-META-E1` throw（projection.ts:189-191），与顶层 Y.Map 键/数组元素处置对齐；设计 D5 R3 半句同步落文。探针复核：F2a 嵌套 undefined 键 → `MetaProjectionError NSRT-META-E1`（keyPath `META.nested.u`）；F2b 顶层 undefined 键 → 仍 E1-throw（旧行为不变，两层一致）；F2c 健康 META（冻结 fixture 形状）全键/全值零变化。既有 17 冻结用例全绿佐证兼容性声明。
**外观 nit（非阻断，SA3 顺手项）**：F-2 throw 的 message 出现「值域违规」双写（`META.nested.u 值域违规（值域违规：undefined）`——metaValueError 外壳与分支 msg 各一次）。code 才是消费锚，零行为影响；后续触碰该文件时可改传 `undefined` 裸词。

**F-3（登记态）——✅ 维持 R1 登记不变，无恶化**：探针复核修复后行为仍为 loud、可捕获的原始 `RangeError`（非 MetaProjectionError、无稳定 code）、进程存活、其余读取面不受影响；经 createDoc 仍不可达（persistence 编码期先崩）。R1 处置（LOW 备案、不加环检测、观测归 SA7）继续有效，无需动作。

**N-1（措辞）——✅ 已修正**：runtime.ts 三处头注（:5-6/:72-73/:126-129）改为「构造栈内有限次、入队后零次」口径，与实际双读（p0Gate/compile 的 undefined 检查+捕获）一致；安全性质声明（入队后零读、INV-N14）与代码相符。

**SA1 设计 R3 touch-up——✅ 落文完整**：D5 标题/③ 分支/copyMetaValue plain object 行 + 新增「proto-key 安全写入纪律」段（机理、R1 附录证据援引 P1-P6/B1/B2/C1、putKey/putSnapshotKey 先例、SA6 锚纪律）+ 修订史行。与 R1 回流要求逐条对齐，无范围外改动（git diff 仅 D5 节 + 修订史）。

## 4. 独立复跑证据（本轮重取，独立后台进程）

```text
$ pnpm exec vitest run packages/namespace-runtime --typecheck --passWithNoTests=false
 ✓ runtime-public-surface-ownership (6) ✓ runtime-sync-read-face (4)
 ✓ runtime-p0-sequencer (7) ✓ metadata-proto-key (4)
 Test Files 4 passed (4)  Tests 21 passed (21)  Type Errors no errors  exit 0
$ pnpm typecheck        # 七包串联     exit 0
$ pnpm test             # CI 同命令
 Test Files 74 passed (74)  Tests 1023 passed (1023)  Type Errors no errors  exit 0
```

与总控亲跑结果（21/21、74 文件 1023/1023、typecheck exit 0）**逐字一致**。既有 1002 基线 + 本任务 17 冻结 + 4 回归锚 = 1023，零回归零漂移。

## R2 最终结论

**Verdict: pass（终审）。**

- F-1 唯一阻断项经键保真/原型级运行时证据确认真实闭合（修复面纯洁、双位点覆盖、无残留、先例同款）；
- SA6 回归锚 4/4 绿且锚定质量合格（N2 合规、computed-key fixture 纪律、round-trip 变体）；
- 附带项全部按 R1 处置方向闭环（F-2 统一+兼容证实、F-3 登记态无恶化、N-1 措辞修正、设计 R3 落文）；
- R1 全部通过项（Scope/设计一致性/HG#14/§1.5/§1.6/§1.7/读写路径/降级/架构/过度设计）不受本次 diff 影响（修复仅触 projection.ts 键写入与 runtime.ts 注释，无契约面/公共面/时序面变化）。

**SA7 动态验证可进入**；R1「动态审核重点」清单第 1 项（F-1 修复验证）本轮已由 SA4 静态+探针闭环，剩余项（CI 触发证据摘录、Node 20 档、F-3 形态已复核、外部违约 release 读取面）仍归 SA7。

（R2 探针备份：`/tmp/sa4-probe1-final.mjs`（R1 原样重跑）、`/tmp/sa4-r2-probe4-final.mjs`（F-2/B/C）、`/tmp/sa4-r2-probe5-final.mjs`（F-3）。worktree scratch 已清理，未修改任何生产代码与冻结测试。）
