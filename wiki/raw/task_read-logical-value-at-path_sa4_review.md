# SA4 静态验尸报告

**Date**: 2026-08-22
**Verdict**: reject（架构与 99% 实现通过攻击验证；2 项阻塞修复——1 项 DENY LIST 硬门禁违规 + 1 项已复现的崩溃边界击穿；均为最小修复，无需 redesign）

- **被审对象**：SA3 commit `02cb596`（`packages/doc-runtime/src/read.ts` 新建 347 行 + `extract.ts` 纯导出增补 + 双包 `index.ts` 导出增补 + 双包 `package.json` 版本号）
- **基准文档**：SA1 设计 `wiki/raw/task_read-logical-value-at-path_design.md`（703 行 R1–R6 修订版）+ SA2 攻击评审/复审（R2 轮 pass）+ SA6 冻结契约 20 用例 + test-d 3 用例
- **审查方法**：全静态验尸 + 独立复跑设计期探针 + 极端入参动态探针 + 全量测试套件复跑 + SUP-1..SUP-6 锚点落地（新增 `read-logical-value-at-path-supplementary.test.ts`，14 用例全绿）
- **测试证据**：`pnpm exec vitest run packages/doc-runtime/test/ packages/vfsl/test/` → **33 文件 / 595 用例全绿 + typecheck 零错误**（read 20/20、test-d 3/3、extract 基线 48/48 零回归）；`tsc -p packages/doc-runtime/tsconfig.json` exit 0

---

## 一、Scope Creep Guard（§1.1）——❌ DENY LIST 违规（阻塞项 F1）

**actual diff**（SA3 commit `02cb596`，8 个代码文件 + 7 个 wiki 档案[白名单]）vs **ALLOW LIST**（§11）：

| 文件 | ALLOW LIST | 判定 |
|---|---|---|
| `packages/doc-runtime/src/read.ts`（新建 347 行） | ✅ 明示 | 通过 |
| `packages/doc-runtime/src/index.ts`（+9 行，其中 2 行 export + 7 行 JSDoc） | ✅ 明示（「+3 行转出口」；代码行=2，余为 JSDoc，见观察 N1） | 通过 |
| `packages/doc-runtime/src/extract.ts`（8 行：2×export 关键字 + 2×JSDoc 注记，逻辑零变化，逐行核对） | ✅ 明示（≤8 行纯 export） | 通过 |
| `packages/vfsl/src/index.ts`（+12 行：compile 别名 + 类型导出 + matchPattern 双参包装） | ✅ 明示（≤14 行） | 通过 |
| `packages/doc-runtime/test/read-logical-value-at-path.test.ts` / `.test-d.ts` | ✅ [SA6 owned] | 通过（断言与冻结契约逐条一致，SA3 未改断言） |
| **`packages/doc-runtime/package.json`（version 0.1.1→0.1.2）** | ❌ **DENY LIST**（§11 明列 `packages/*/package.json`） | **违规** |
| **`packages/vfsl/package.json`（version 0.2.1→0.2.2）** | ❌ **DENY LIST**（同上） | **违规** |

**F1 定性**：两文件各 1 行版本号变更，实质无害（private workspace 包，无运行时影响），且符合仓库发版惯例（#72 曾 0.2.0→0.2.1「新增公共面 patch」、#73 登记新包版本）——但设计 §11 将 `packages/*/package.json` 显式列入 **DENY LIST**（理由「无配置需求」），硬门禁措辞不允许 SA4 自行豁免。

**修复路径（二选一，回流目标：SA3 或 SA1）**：
1. SA3 revert 两个版本号行（最小改动）；或
2. SA1 修订设计 §11，把「发版版本号 bump」从 DENY 例外进 ALLOW（需补一句理由：公共 API 面新增遵循 #72/#73 发版惯例）。

**豁免/黑名单核验**：`wiki/raw/task_*` 白名单命中；无 `package-lock.json`/`yarn.lock`/`TASK.md`/`*.bak` 黑名单命中；`.mabf-bg/*.log` 属更早 commit（526ee4f），非本次 creep。SA6 红灯记录（`.mabf-bg/red-confirm.log` 等）与任务简报逐字一致。

## 二、设计一致性（§1.2）——✅ 通过（含 R1–R6 全部修订逐项核验）

逐决策对照（read.ts vs 设计 §4 伪代码）：

| 决策 | 实现核验 | 结论 |
|---|---|---|
| D1 两阶段模型 | Phase A（isPathAllowed/decide）纯 schema、零 doc 访问；Phase B（resolveLive/navigate）活解析；`['title','x']` presence-independent | ✅ |
| D2 弃用 index | 全文无 `derived.index` 消费；导航=结构树+resolveS；values 仅取 keyPattern | ✅ |
| D3 values 锁步双游标 + vfsl 引擎 | makeValuesResolver（环守卫+memo，镜像 makeRefResolver）+ keyAllowed（compilePattern/matchPattern，per-call pc） | ✅（探针复跑证实 values 树携带 keyPattern，见 §六） |
| D4 union any-of 活导航 | Phase A `members.some` + Phase B 声明序 for 循环首个可产出者胜 | ✅ |
| D8 吸收式缺键 | optional 缺席/Record 缺键/非负越界 → `{ok:true, value:undefined}`（value 键显式构造） | ✅ |
| D9 段形态 | map×string / array×`Number.isInteger && >=0`；两阶段各检一次（自校验义务落实） | ✅ |
| D10/D12 | plain/xml 终态拒下钻；空 path=完整 ROOT；空 doc→`{}` | ✅ |
| D11 崩溃边界 | 顶层 try/catch → `DOCRT-E100:` 前缀 | ✅（但见阻塞项 F2 的击穿孔） |
| D13/R2 memo | memoA 键 (resolve 后节点, i)、memoB 键 (节点, live, i)；`hit !== undefined` 正确区分缓存 false；**SUP-2 实测 26 层重叠联合 14ms 全绿**（无 memo 为 2^26 级，确定性出局） | ✅ 强制项已落实 |
| D14/R3 Phase A 先行 | 代码序：isPathAllowed → probeRoot → resolveLive；**SUP-3 实测被拒路径零 update 事件 + ROOT size 0 + 幂等** | ✅ |
| D15/R1 Phase B 零 keyPattern | navigate Record 分支无任何 pattern 检查（注释保留反例警告）；**SUP-1 实测 `['items','BAD']` 与 extractYjsSnapshot ground truth 逐字相等** | ✅（SA2 攻击点 #1 的错误实现方向未被踩中） |
| R5 matchPattern 双参 | vfsl index.ts 内 2 参薄包装（charge no-op 封装）；pattern.ts 零修改（commit 无此文件） | ✅ |
| R6/INV-11 模块级零可变态 | `grep -nE "^(let\|var) \|const .* new (Map\|Set)"` 零命中；patternCache/memoA/memoB 均函数体内创建 | ✅（SUP-6 静态审查完成） |

**合理增强（非偏离）**：SA3 在 Phase A 封闭 map/array 分支补了 values kind 显式检查（设计伪代码未写、但语义同属「lockstep 断裂→throw→C3」），对合法派生物零行为差异——判为防御增强，不属偏离。`decide`/`navigate` 从内嵌函数提为模块级（参数显式传递），行为等价。

## 三、读写路径一致性（§2）——✅ 通过

纯只读能力：全程仅 `get`/`length`/`keys`/`toString`；唯一「构造」是 probeRoot 惰性空 map（设计 D12/P4 授权，SUP-3 实测零 update 事件）。终点转换复用 extract 的同一 `walk`（包内导出，单一转换语义源）——read 与 extractYjsSnapshot 对同一 doc 无第二投影源（SUP-1 双向锁实证）。

## 四、静默失败 / 降级（§3/§4）——✅ 通过（1 项补充锚点已钉死）

- 全部 5 类出口（C1/C2/C3 × message、成功、吸收式 undefined）均为结构化带内返回，`notAllowed` 恒构造非空 message；无「无请求+无反馈」形态（无 I/O）。
- **伪降级禁令关键位**：required 缺席 → loud `{ok:false}`（不冒充吸收式 undefined）——SA6 20 用例未覆盖此位，**SUP-2 第二用例已补锚**（26 层链底层空 map → PATH_NOT_ALLOWED 而非 undefined）。
- pattern 引擎 throw（编译失败/预算耗尽）→ C3 + `DOCRT-E100:` 前缀（fail-closed 不冒充「不匹配」）——**SUP-4 实测**（`Pattern<"("` + 零键 Record → message 前缀命中）；pattern.ts 预算内部性（matchBudget 8192 起/二次项/4M 封顶在 match 内部）经源码一手核实，no-op charge 不失封顶。

## 五、极端条件攻击（§5）——❌ 1 项已复现击穿（阻塞项 F2）

**F2（已复现）：非数组 path 击穿崩溃边界，违反 FC-1「同步、不抛错」**

```
$ tsx probe：readLogicalValueAtPath(derived, doc, null as any)
→ 外抛 TypeError: path is not iterable      ← 逃出公共函数！
```

机理：`path=null` → Phase A 中 `segs.length` 抛 TypeError → 顶层 catch → `notAllowed(path,…)` → **catch 块内部** `[...path]` 二次抛出（read.ts:92）→ 逃逸。D11 承诺「收编一切异常」在 catch 路径自身不成立。对照同函数对其它类型外输入的处置（`derived={}` → C3、`doc=null` → 干净拒绝，均已实测 loud），唯独非数组 path 外抛——不对称且违反 INV-3 字面承诺。

- 严重度：LOW-MEDIUM（TS 调用方被签名挡住；JS/运行时动态调用方可达）。
- 归属：**设计遗传**——设计 §4.1 伪代码 `notAllowed` 同款 `[...path]`，SA3 忠实照抄。修复需 SA3 一行防御（如 `Array.isArray(path) ? [...path] : []`，或在 catch 内先行守卫）+ SA1 设计勘误注记。
- 附带（观察 N2，随 F2 修复自然消化）：裸 string path（可迭代）`'zz'` → 回显被字符拆分为 `['z','z']`（实测）——类型外输入，无害但语义怪异；`Array.isArray` 守卫后归一为 `[]`。

**其余极端位全部安全（静态推演 + SUP 补充锚实测）**：
- `-0` 下标归一为 0（SUP 锚实测返回首元素）；`NaN/±Infinity` 拒绝；`2^53` 整数越界 → 吸收式 undefined（SUP 锚 3 用例）。
- 超长路径：合法派生物递归深度受 schema DAG 有界（E301/E106 + MAX_TYPE_NESTING=100），终态拒绝先于栈溢出；RangeError 由顶层 catch 收编。
- `path=[' __proto__'…]`：fields.find 按名查无原型风险；Record 动态键经 walk 的 putSnapshotKey（defineProperty）安全写入（extract 闭环继承）。
- memo 键：live 恒为 Yjs 对象引用（容器错位前置判定阻断原始值下钻）或按值原始键（SameValueZero 对 -0/NaN 安全）；memo/patternCache 均有界（触及节点数 × 路径长）。

## 六、协议假设审查（§1.5）——✅ 通过（探针独立复跑一致）

- §9 章节存在；无 HTTP/WS/端口/进程时序假设；全部依据为源码引用或设计期实测。
- **设计期实测复跑**：`/tmp/probe75/probe.mts` exit 0——①内联 Record：结构树无 keyPattern、index 有 `ROOT.assets.<key>` 行；②ref 别名 Record：index 仅 `ROOT.assets | ref` 一行（无 `.<key>` 行）、`values['Assets']` 完整携带 keyPattern；③union 带判别式（read 零读取）。与设计 §1.2 三项裁决性证据**逐字一致**（D2/D3 依据成立）。
- pattern.ts `matchBudget`/`tick`/三参 `match` 签名（L761-773/L895）一手核实，与 SA2 论断一致。

## 七、契约改动连锁审计（§1.6）——✅ 通过（纯增量，无 return→throw 类改动）

| 接缝 | 改动 | caller 矩阵 |
|---|---|---|
| `walk` / `makeRefResolver`（extract.ts） | 私有 → 包内导出，**逐行核对纯 export + JSDoc，逻辑零变化** | 唯一新 caller = read.ts（同步调用，位于 readLogicalValueAtPath 顶层 try/catch 内，A/B/C 三层全满足）；不经 index.ts 公共入口，公共 API 面不变 |
| `compilePattern`/`matchPattern`/`CompiledPattern`（vfsl） | 新公共导出（compile 别名 + 2 参包装） | 唯一新 caller = read.ts keyAllowed（同步，throw → 顶层 catch → C3）；命名无冲突（grep 复核单一导出） |
| `readLogicalValueAtPath` | 新函数 | 存量 caller **零**（`grep -rln` 复核：仅 src 三文件 + 三个测试文件）；SA6/SA4 测试为唯一消费者 |
| `extractYjsSnapshot` | 不改 | 本任务未触碰（diff 无行为行） |

无同步→异步、nullable 化、catch swallow→rethrow 等五类契约改动；无 fire-and-forget caller。

## 八、CI 触发性（§1.3/§1.4）——✅ 通过

- 新增 3 个测试文件均落 `packages/doc-runtime/test/**`，被根 `vitest.config.ts` 的 `include: packages/*/test/**/*.test.ts`（运行时）与 `typecheck.include: *.test-d.ts`（类型层）覆盖；CI `ci.yml` Test 步 `pnpm test` = `vitest run --typecheck` 直接触发；Typecheck 步含 `tsc -p packages/doc-runtime/tsconfig.json`（include `test/**`，SUP-5 的 @ts-expect-error 与 expectTypeOf 断言被 tsc 消费，exit 0 实证）。无 E2E spec。无孤儿测试。

## 九、测试质量（§1.7）——✅ 通过

- SA6 双文件 + SA4 补充文件均**零** `readFileSync`/源码字符串断言；全部锚定 `readLogicalValueAtPath` / `extractYjsSnapshot` / `matchPattern` 可观测输出（行为断言、ground truth 交叉、类型投影、时间护栏）。
- SA6 冻结契约 20 用例与任务简报映射逐条一致（AC1–AC6 六组）；断言未被 SA3 改写（文件为 SA6 Phase 1 产物随本 commit 入库，内容与简报记录的红灯用例集一致）。

## 十、架构评估（§7）与过度设计（§8）——✅ 通过

两阶段模型是 presence-independence 的必要结构（SA2 已验证交织式会产生双态不一致）；memos 是设计强制项（D13「必要的防护而非优化」）而非过度优化；read.ts 347 行对应设计 ~260 行伪代码 + 防御增强 + 注释，复杂度与设计委托相称。无 FIXME/临时补丁/绕过架构约束痕迹；未触发退回 SA1 信号（F2 属一行修复级勘误，非架构制约）。

---

## 阻塞项汇总（reject 依据）

| # | 项 | 证据 | 修复 | 回流目标 |
|---|---|---|---|---|
| **F1** | `packages/doc-runtime/package.json` + `packages/vfsl/package.json` 版本号变更落在设计 §11 **DENY LIST**（`packages/*/package.json`） | `git show 02cb596 -- packages/*/package.json`（各 1 行 version 字段） | revert 两行，或 SA1 修订 §11 显式放行发版 bump（补惯例理由 #72/#73） | SA3（回滚）/ SA1（修订 ALLOW LIST） |
| **F2** | 非数组 path（null/undefined/number 等不可展开值）→ catch 块内 `[...path]` 二次抛出 → **TypeError 外抛**，击穿 FC-1「不抛错」/INV-3/D11 | 本地复现：`readLogicalValueAtPath(derived, doc, null)` → `TypeError: path is not iterable`（探针 `/tmp/probe75/extreme-probe.mts` 可复跑） | `notAllowed` 加 `Array.isArray(path) ? [...path] : []` 类守卫（一行）；设计 §4.1 伪代码同款缺陷需 SA1 勘误注记 | SA3（实现）+ SA1（设计勘误） |

其余 8 项审核维度全部 pass；**核心架构（两阶段/导航权威/键空间交叉一致性/memo 折叠/零 doc 触碰）经独立攻击与 SUP 实测全部站住**。修复后 SA4 只需复审上述两点（diff ≤ 4 行），无需全量重审。

## 观察项（非阻塞）

- **N1**：doc-runtime `index.ts` 实改 +9 行 vs ALLOW LIST「+3 行」——代码行恰为 2 行 export，余 7 行为公共入口 JSDoc（描述新接缝），判符合清单意图；SA1 下次修订可将措辞改「+2 行代码 + JSDoc」。
- **N2**：裸 string path 回显字符拆分（`'zz'` → `['z','z']`）——F2 修复自然消化。
- **N3**：`makeValuesResolver` 的 memo 在环检测 throw 前已写入（`memo.set(cur, next)` 先于链终止验证）——与 extract `makeRefResolver` 同款语义（先例一致）。当前不可达挂起：首次 throw 直接冒泡到顶层 catch 终止整次调用，污染的 memo 无第二次消费机会。**潜在约束**：未来若在 union 试验等分支引入局部 try/catch 消化 resolveV 异常，此模式会变为无限循环挂起——记入下述动态审核重点，供后继演进警戒。
- **N4**：SUP-2 时间护栏预算取 `<2000ms`（memo 实测 14ms，无 memo 2^26 级）——CI 慢机上安全边际充足；SA7 复核无 flake 即可。

## SUP-1..SUP-6 落地记录（归 SA4，已完成）

**产出**：`packages/doc-runtime/test/read-logical-value-at-path-supplementary.test.ts`（设计 §11 ALLOW LIST 明示 SA4/SA7 owned；SA3 不编写）——**14 用例全绿（14ms）+ tsc 零错误**：

| 锚点 | 落地形态 | 结果 |
|---|---|---|
| SUP-1 | `['items','BAD']` 与 extractYjsSnapshot 逐字相等（双向锁）+ 两成员均许可对照 + `['items','BAD','x']` 终态拒 | ✅ |
| SUP-2 | 26 层重叠联合：Phase A 全拒路径 / Phase B required 缺席路径（兼伪降级禁令锚）/ 底层在场正向对照；各 <2s | ✅ |
| SUP-3 | 被拒路径零 update 事件 + ROOT size 0 + 幂等；随后 `[]` → `{}` 仍零事件（P4/INV-5） | ✅ |
| SUP-4 | `Pattern<"("` + 零键 Record → message `^DOCRT-E100:` | ✅ |
| SUP-5 | matchPattern 双参运行时 + expectTypeOf 签名 + `@ts-expect-error` 3 参拒绝（tsc 消费实证） | ✅ |
| SUP-6 | 模块级零可变态——静态审查完成（本文 §二 R6 行） | ✅ |
| 追加 | D9 段形态边界（-0/NaN/±∞/2^53，SA6 未覆盖的 AC4 邻域） | ✅ |

## 动态审核重点（交 SA7）

1. **F2 修复复验**：SA3 落防御后，重放 `readLogicalValueAtPath(derived, doc, null/undefined/42)` → 断言结构化返回、无外抛（SA4 探针 `/tmp/probe75/extreme-probe.mts` 可作模板）。
2. **CI 触发证据**：PR CI run 的 Test 步日志中摘录 `read-logical-value-at-path.test.ts (20)`、`…supplementary.test.ts (14)`、`test-d (3)` 三文件执行行（静态门禁 §1.3/1.4 的动态确认）。
3. **SUP-2 时间护栏 CI 稳定性**：慢 runner 上 26 层构造 + `<2000ms` 断言无 flake（memo 版毫秒级，预期安全）。
4. **N3 演进警戒**：若后继任务在 read.ts 引入分支级 try/catch（如 union 试验局部消化 resolveV throw），必须先重审 makeValuesResolver/makeRefResolver 的「环检测 throw 前 memo 已写入」模式（潜在无限循环挂起）。
5. **活链路冒烟**（可选）：readLogicalValueAtPath 当前零业务 caller；待 NamespaceRuntime 落地后验证高频路径读取对 `extractYjsSnapshot` 的 1/n 成本承诺（ADR-0007 §性能）。

---

## 验证证据索引（命令 + 结果）

| 验证 | 命令 | 结果 |
|---|---|---|
| 全量回归 | `pnpm exec vitest run packages/doc-runtime/test/ packages/vfsl/test/` | 33 文件 / 595 用例全绿 + typecheck 零错误；read 20/20、test-d 3/3、extract 基线 48/48 |
| SUP 锚点 | `pnpm exec vitest run packages/doc-runtime/test/read-logical-value-at-path-supplementary.test.ts` | 14/14 通过（14ms） |
| 类型层 | `pnpm exec tsc -p packages/doc-runtime/tsconfig.json` | exit 0 |
| 设计探针复跑 | `./node_modules/.bin/tsx /tmp/probe75/probe.mts` | exit 0；三项裁决性证据与 §1.2 一致 |
| 极端探针 | `tsx packages/doc-runtime/extreme-probe.tmp.mts`（运行后已删） | `path=null → 外抛 TypeError`（F2 实锤）；`derived={}`/`doc=null` loud |
| scope 比对 | `git show 02cb596 --name-only` + design §11 | 仅两个 package.json 越界（F1） |
| caller 审计 | `grep -rln readLogicalValueAtPath --include='*.ts' packages/ apps/` | 仅 src 三文件 + 测试三文件（零存量业务 caller） |
| 预算内部性 | `sed -n '755,775p;888,912p' packages/vfsl/src/pattern.ts` | matchBudget/tick 在 match 内部；charge 仅记账（SA2 论断一手复核一致） |
