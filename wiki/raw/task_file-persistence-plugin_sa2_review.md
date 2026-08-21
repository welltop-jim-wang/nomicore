# SA2 攻击评审报告

**Date**: 2026-08-21
**Verdict**: reject（架构机制本身经受住了攻击、无 CRITICAL 机制缺陷；但存在 1 个 MAJOR 论证/披露缺陷 + 2 个 MINOR 设计文本缺陷，需 SA1 修订设计文档后放行。修订均为文档/伪代码级，不要求推翻任何架构决策 A–F）

- 被审对象：`wiki/raw/task_file-persistence-plugin_design.md`（SA1 R0 首版，637 行）
- 约束基准：`wiki/raw/task_file-persistence-plugin_relevant_decisions.md`（ADR-0006 为核心 ADR）
- 参照：SA8 设计冲突复审 `clear`（5 条解释点已逐一复核，解释点 1 即下文攻击点 #1 的质询对象）
- 审查方式：全新视角通读设计 → 逐行比对 `src/memory.ts`（344 行）、`src/index.ts`、`src/testing.ts`、`test/file-persistence.test.ts`（SA6 红灯全文）、`test/memory-persistence.test.ts`（P2 全文）、`test/memory-testkit.ts`、tsconfig/vitest 配置、`@types/node` 引用 → 对可疑点做 TS 编译探针实测

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **MAJOR**（ADR 解释论证缺陷 + 后果未披露） | 决策 E：`.tmp` 惰性清扫 vs ADR「启动发现遗留 `.tmp` 时一律忽略并删除」 | 机制本身可辩护（SA8 解释点 1 的 (a)(c)(d) 成立），但设计文档存在三处实质缺陷：**(i) 核心论据错误**——§3 决策 E 理由 2 称启动全树扫描「这就是 ADR 明文排除的 list 能力」。ADR-0006 的「v1 不提供 list：per-user 枚举用到再补」规范的是**公共接口能力**，内部 housekeeping `readdir` 不向任何 caller 暴露枚举，该论据是偷换概念；真正的强论据（HMR/reload 下新实例启动清扫会 unlink 旧活跃实例同 rootDir 的在途 tmp → 旧实例 rename ENOENT → 虚假 degraded → 活链路 WS 写被拒）设计只以「与插件就绪时序、dispose epoch 语义打架」一句带过。**(ii)「清扫面自然闭合」论证失效**——flush 的 `writeFile(tmp, flag:'w')` 截断只作用于**再次 flush** 的 namespace，而生产路径再次 flush 必先经 loadDoc 获得 handle，loadDoc 已先行清扫，故 flush 截断的边际覆盖为**零**；它不是第二条清扫面，只是同一条的重复表述。**(iii) 残留行为未披露**——崩溃时在途 flush 的 namespace 集合 S 中，重启后从未再被 loadDoc 的子集，其 `.tmp`（快照体积级）**永久滞留**，跨多次崩溃只增不减（上界 ≈ namespace 数 × 快照大小），ADR 文本的「启动删除」承诺对该子集不成立，且滞留 tmp 会误导运维（看似 pending 写入）。设计全文无一处披露此残留。 | 不要求改机制（惰性清扫在单实例内结构安全：cache-miss ⇒ 无 Entry ⇒ 无在途 flush ⇒ 清扫不可能与自身 flush 竞态，此点已由 SA2 独立论证成立；启动清扫反而引入 HMR 单写者竞态）。要求修订文档三件事：① 把理由 2 替换为正确的 HMR/单写者竞态论据，删除「list 能力」偷换；② 删除或改写「清扫面自然闭合」为准确表述（覆盖面 = 重启后再次被访问的 namespace；flush 截断无边际覆盖）；③ 新增「ADR 解释与残留披露」小节：记录与 ADR「启动……删除」文本的解释性偏离及依据（任务简报验收条款即 load 时点表述）、残留集合定义、体积上界、回收途径（离线清理 / v2 启动清扫），供 owner 复核。若 owner 判定要求启动期全量卫生清扫，须另行评估 apply() 时机 + track() + epoch 防护方案，并接受 HMR 竞态风险——本评审不推荐。 |
| 2 | **MINOR**（确定性编译失败，违反设计自述约束） | §4.1/§4.2/§4.3 伪代码：`PersistenceCoreOptions` 桥接 | `super({ name, schedule: options.schedule, timer: options.timer })` 在仓库旗标 `exactOptionalPropertyTypes: true`（`tsconfig.base.json`，设计 §4.1 自己引述并声称「伪代码已按此约束书写」）下**必然编译失败**：TS2379，`schedule: Partial \| undefined` 不能赋给 `schedule?: Partial`。已用仓库锁定 typescript@5.9.3 实测复现（命令与输出见文末「验证证据」）。SA3 逐字照抄即被 typecheck 拦截，绕开即与设计文本脱钩。 | `PersistenceCoreOptions` 两个字段改为 `readonly schedule?: Partial<PersistenceSchedule> \| undefined`、`readonly timer?: PersistenceTimer \| undefined`（或子类条件展开对象）。一行改动，写入设计。 |
| 3 | **MINOR**（误导性语义注释 × 无测试钉死的缝隙） | §4.2 memory 桥接 `readCommittedSnapshot` 注释 | 注释称「options 回调优先（**即使其返回 undefined**），无回调时回落内部 map」——与所附代码 `this.options.readSnapshot?.(key, signal) ?? this.snapshots.get(key)?.snapshot` 的实际语义**相反**：回调存在但返回 undefined 时，`??` 会**回落内部 map**（代码正确、注释错误）。加重因素（grep 证实）：P2 全部 5 处 `readSnapshot` 测试用法均返回实值或显式 reject/resolve，**没有任何用例钉死「回调返回 undefined → 回落 map」**——该注释是搬迁期间防语义漂移的唯一护栏，写反了就把漂移方向指错，且漂移发生时 480 绿灯不会变色。 | 改写注释为准确语义：「回调存在时优先求值；其返回 nullish（含 undefined）时回落内部 map；无回调时直接读 map」。并在 §6.2 迁移不变式清单中把该缝隙列为「无测试钉死、以注释为准」项，供 SA4 静态核对。 |
| 4 | **LOW**（继承语义未披露，非本设计缺陷） | §4.5/§4.6：degraded 状态的**适配器全局**语义 | ADR-0006 措辞是「失败后 **namespace** 进入 `persistence-degraded`」，P2 内核实现为**整个适配器单状态**且已被测试钉死（memory-persistence.test.ts:285：doc1 降级期间 doc 'other' 的创建路径也被拒）。两个未披露细节：① FilePersistence 使该语义跨**用户**生效——任一 namespace 一次 flush 失败（如 ENOSPC/EACCES）即拒绝**所有用户**的 saveDoc/创建，直至任一 retry 成功；② 成功路径 `this.status='ready'` 无条件写入——**无关 doc 的 flush 成功即可把状态翻回 ready**（此时失败 doc 仍 dirty-retry 中，写重新被接受，内存事务不丢、由其自身 retry 兜底）。行为本身是 P2 逐字继承（改它 = 动 P2 钉死行为 = 越界），但设计把它当作不可见继承、未在错误矩阵/并发章节披露。 | 在 §4.5 错误矩阵与 §4.6 并发表补一段「degraded 全局语义（P2 继承）」：降级半径 = 整个适配器（跨用户跨 namespace）；恢复条件 = 任一 flush 成功（不必然是失败的那个）；与 ADR「namespace 进入 degraded」措辞的解释关系。仅文档，不改代码。 |
| 5 | **LOW**（论据事实错误，结论侥幸成立） | §6.4 循环依赖论证 | 「值导入均为函数声明，提升安全」——不成立：`systemPersistenceTimer` 是 `export const`（index.ts:63），非函数声明，存在 TDZ。结论仍正确的原因是另一条：所有跨循环访问都推迟到**构造期**（构造函数体内才读绑定），且 `index ⇄ memory` 同构循环今日已绿。论据错误会给 SA4 静态审计埋一个假锚点。 | 改写为准确论据（TDZ 安全性来自「模块顶层不求值这些绑定、仅在构造期访问」+ 既有同构循环绿灯先例），并注明 `systemPersistenceTimer` 为 const。 |

**攻击后确认无漏洞的面**（SA2 主动攻击未破防，记录给 SA4/SA7 复用）：路径穿越（双重点校验 + 测试 11×6 全拒）；rename 覆盖 chmod 444（P1 实测 + POSIX 论证 + SA6 用例 8 三重锚定）；sweep 与自身 flush 竞态（不可能：cache-miss ⇒ 无 Entry ⇒ 无在途 flush；`maybeEvict` 有 `flushing` 前置条件）；跨 Adapter handle 伪造（`CoreDocHandle` 统一后仍有 HANDLE_OWNER 实例校验 + `entry.handles` 成员资格双门）；dispose 中途 rename 窄窗（有效旧状态 + epoch 防护，SA8 解释点 4 认可，SA2 复核同意）；`writeSnapshot` 拆解为 `writeCommittedSnapshot`+epoch+`onSnapshotCommitted` 的次序等价性（await 点逐一对齐，无观察者差异）；effect label 变更（grep 证实无任何测试断言）；包外消费者（grep 证实零引用，§8 审计成立）；SA6 §5 映射表 11 行逐一与实际测试文件比对一致；错误消息参数化后 Memory 侧逐字不变、File 侧匹配 `/disposed/`。

## 协议假设依据审查

**通过（含 1 处论据勘误，见攻击点 #5）。** §7 章节存在，10 条假设全部标注依据类型（设计期实测 / 源码引用 / 官方文档引用 / 现有测试引用），实测条目附输出摘录（`ENOENT`、`AbortError`、`Invalid typed array length`、`Unexpected end of array`），无「应该 / 通常 / 预计」类无据推断。可验证性抽查（SA2 实际定位，SA4 可重跑）：

- `@types/node@20.19.43` `fs/promises.d.ts` readFile `{encoding?: null, flag?} & Abortable` ≈ :1121 ✓、writeFile options ≈ :1024 ✓；`fs.d.ts` `MakeDirectoryOptions`（无 signal）:1666 ✓、`RmOptions`（无 signal）实际起点 ≈ :1625（设计写 :1620，5 行内偏差，可定位，不计缺陷）✓
- `tsconfig.typecheck.json` include `packages/*/test/**` ✓；`vitest.config.ts:7-11` typecheck 块 ✓；`test/memory-persistence.test.ts:476` `unloads one Cordis service exactly once` 存在 ✓；SA6 红灯记录（EXIT=1、`Cannot find module '../src/file.js'`）与工作区现状一致（`src/file.ts` 尚不存在、测试文件已就位）✓
- P1/P4/P5/P6 的实测描述（mkdtemp/chmod/rename/abort/垃圾字节）操作具体、输出已引，SA4 可原样重跑；本评审额外用 typescript@5.9.3 做了 §4.1 伪代码的编译探针（见 #2），属对设计自述「按 strict 旗标书写」的反向验证——结果为否。

## 错误处理链路审查

（本任务为宿主无关 Cordis 插件，无前端 UI；按后端等价物审查：调用方可感知性 = loadDoc/saveDoc 拒绝 + `getStatus()`）

- **静默失败**：未发现。load 链路非 ENOENT 读错误全部上抛；flush 链路失败进 degraded + 退避 retry（状态可见）；唯一吞错点 `sweepLeftoverTmp` 属**契约性 best-effort**，其「同一磁盘状况会在下次 flush 响亮浮出」的信号不丢失论证经 SA2 独立复核**在 POSIX 本地文件系统上成立**（unlink 与 create 同需目录 w+x；EISDIR/EPERM/immutable 同样阻塞 writeFile）。边界注记：NFS root-squash 等远端语义下 unlink 与 create 权限可能分离，该论证依赖「Linux 本地文件系统」这一 P1 同款平台假设——建议在设计 §4.5 该行加半句平台限定。
- **状态闭环**：`ready → persistence-degraded → ready`（retry 成功）与 `→ disposed` 全部可达且有测试钉死；degraded 期间创建路径（test factory）也被拒（P2 :285）；disposed 后全入口 throw。
- **降级路径**：ENOENT → null 是规格内 miss（创建=首个 saveDoc），**非伪降级**；空 rootDir → 构造期 TypeError（配置缺陷 loud fail）；flush 失败 → degraded 保留内存事务（ADR 条款逐字落实）。
- **虚假降级识别**：文法违例、META.docId 不一致、损坏字节、foreign/released handle 全部 loud throw——设计明确拒绝把上游缺陷降级为 null（决策 C 原文「拒绝虚假降级」）。**未发现把 bug 当降级处理的情形**。

## 红线测试思路

（SA6 文件为 SA6 owned、P2 测试 DENY 修改——以下构想供总控决定是否发起 SA6 R2 锚定轮，或转 SA4 静态/SA7 活链路场景）

1. **对应攻击点 #1（残留语义钉死或翻转）**：seed `{rootDir}/users/alice/d1.snapshot.tmp` 与 `d2.snapshot.tmp`，仅 `loadDoc(alice, d1)` → 断言 d1.tmp 已删且 **d2.tmp 仍在**（把「未披露的残留」变成「钉死的设计行为」）；若总控改判启动清扫，断言翻转并另加「apply() 后两 tmp 均删、rootDir 缺失不炸」用例。
2. **对应攻击点 #2（编译门禁）**：无运行时红灯；验证 = SA3 落地后 worktree 根 `pnpm typecheck` 与 `pnpm test`（`vitest run --typecheck`）EXIT=0 且 `Test Files 33 passed`。SA4 复核桥接写法与修订后伪代码一致。
3. **对应攻击点 #3（缝隙语义钉死）**：memory 侧新增用例：`readSnapshot: async () => undefined` 而内部 map 预置快照 → `loadDoc` 应**从内部 map 还原**（钉死 `??` 回落语义，给「逐字搬迁」加一道迁移护栏；当前 480 用例无一覆盖）。
4. **对应攻击点 #4（degraded 半径钉死）**：file 侧：chmod 500 `users/bob` 目录 → bob 的 flush EACCES 失败 → 断言** alice** 的 saveDoc 也被拒（适配器全局降级）；随后 alice 自身 flush 成功 → 断言 status 翻回 `ready` 而 bob 仍在退避 retry（把「无关 doc 成功即恢复可写」的继承语义钉为显式契约）。
5. **对应「sweep 吞错信号不丢失」端到端**：chmod 555 `users/alice`（r-x）+ 遗留 tmp + 有效 snapshot → load 成功（unlink EACCES 被吞、snapshot 正常还原）→ 随后 saveDoc → flush 的 writeFile EACCES → 断言 status=`persistence-degraded`（验证「信号在下次 flush 响亮浮出」链条真实闭合）。

## 结论

架构判断（继承式内核抽取、`(user, docId, signal)` 缝、validateIdentity 钩子、惰性 tmp 清扫、v1 边界贯彻）在本轮全维度攻击下**无机制级缺陷**，§5 红灯映射与 480 绿灯兼容性论证经逐行比对成立。**reject 仅因设计文本自身必须先修正**：#1 的论证错误与残留未披露（MAJOR，直接关系 ADR 一致性表述的严肃性）、#2 的确定性编译失败、#3 的反义注释。三项均为定点修订，不动任何架构决策；修订后 SA2 复审可快速放行（预计仅核对修订段落）。

### 给 SA1 的修订要求清单（对应设计末尾「SA2 反馈逐条回应」表）

| # | 要求 | 落点 |
|---|------|------|
| 1 | 重写决策 E 理由 2（删「list 能力」论据，换 HMR/单写者竞态论据）；修正「清扫面自然闭合」表述；新增 ADR 解释与残留披露小节（残留集合、体积上界、回收途径） | §3 决策 E |
| 2 | `PersistenceCoreOptions.schedule/timer` 类型加 `\| undefined`（或条件展开），消除 TS2379 | §4.1（§4.2/§4.3 随动） |
| 3 | 改正「回调优先（即使其返回 undefined）」注释为真实 `??` 回落语义；在 §6.2 标注该缝隙无测试钉死 | §4.2、§6.2 |
| 4 | 补披露 degraded 适配器全局语义（跨用户半径 + 无关 flush 成功即恢复 ready）为 P2 继承行为 | §4.5、§4.6 |
| 5 | 改正「值导入均为函数声明」论据（const + 构造期延迟访问 + 同构先例）；§4.5 sweep 行补 POSIX 平台限定半句 | §6.4、§4.5 |

---

## 验证证据（SA2 审查命令与结果）

- `grep -r "memory-persistence: service"` → 仅 `src/memory.ts:122`（实现处）与设计 §8 自述；**无测试断言 label** ✓
- `grep -r "@nomicore/persistence"`（*.ts/*.json）→ 仅包自身 package.json 与 memory.ts 注释；**包外零消费者** ✓（§8 审计成立）
- `grep readSnapshot packages/persistence/test/**` → 5 处，均返回实值/显式 reject/resolve；**无「回调返回 undefined」钉死用例** ✓（攻击点 #3 加重因素）
- `sed -n` @types/node@20.19.43 `fs/promises.d.ts`(1018-1030/1115-1127)、`fs.d.ts`(1612-1630/1660-1672) → Abortable/MakeDirectoryOptions/RmOptions 引用可定位 ✓
- `cat tsconfig.base.json` → `strict/exactOptionalPropertyTypes/noImplicitOverride/verbatimModuleSyntax` 全部在位 ✓
- TS 编译探针（仓库 typescript@5.9.3，旗标同 tsconfig.base.json）：按 §4.1/§4.2 伪代码构造 `super({ name, schedule: options.schedule, timer: options.timer })` → **`error TS2379: ... with 'exactOptionalPropertyTypes: true'`，EXIT=2**（攻击点 #2 实锤）
- 逐行比对 `src/memory.ts`（89-313）与设计 §4.1/§4.2 的搬迁映射、`test/file-persistence.test.ts` 全文与设计 §5 映射表 → 次序等价性与 11 行用例机制映射成立 ✓

---

# R2 复审（2026-08-21，复审轮）

**被审对象**：`wiki/raw/task_file-persistence-plugin_design.md`（R1 修订版，672 行；文末「SA2 反馈逐条回应」表登记 5/5）
**复审方式**：全新重读修订版全文 + 逐项核对 5 项修订要求 + 对修订**新引入**的两个可验证声明做独立探针复测 + grep 确认旧错误论证仅存于勘误引文 + 与 R0 逐节比对排除隐蔽改动

## R2 Verdict: **pass**

5/5 修订要求全部落实且经 SA2 独立验证；修订未引入新错误；架构决策 A–F 与 §5/§7/§8/§9/§10 逐字未动。

## 逐项复核结果

| R1 要求 | 落实 | SA2 独立验证 |
|---|:--:|---|
| #1 MAJOR（决策 E 论证 + 残留披露） | ✅ 超额 | 理由 2 已换 HMR 单写者竞态论据（unlink 在途 tmp → rename ENOENT → 虚假 degraded → 活链路写被拒，链条与内核语义核对无误）；「list 能力」偷换已删（grep 证实仅存于勘误引文）；「清扫面自然闭合」改为准确表述（flush 截断**无边际覆盖**）；新增决策 E.1：解释性偏离声明（依据 = 简报验收条款 load 时点表述 + HMR 竞态）、残留集合（S 中不再访问子集永久滞留）、体积上界（≈ namespace 数 × 快照大小）、回收途径（停机后 `find {rootDir}/users -name '*.snapshot.tmp' -delete`，模式正确）、owner 翻转决策路径。E.1 引用的「单实例内竞态不可能」与 SA2 R1 独立论证一致 |
| #2 MINOR（TS2379） | ✅ | §4.1:124-125 两字段加 `\| undefined` 并附成因注释；SA2 同款旗标重编探针：R0 形态 EXIT=2 → **修订形态 EXIT=0** |
| #3 MINOR（反义注释） | ✅ 超额 | §4.2 注释改为三分支精确语义，SA2 node 探针独立复测：`同步 undefined → MAP-BYTES`（回落 map ✓）、`async undefined → undefined`（Promise 对象 non-nullish 不回落 ✓）、`无回调 → MAP-BYTES` ✓——与注释逐字一致。**修订比 R1 要求更精确**：SA1 发现并披露了 SA2 R1 未点破的 sync/async 回调不对称（`??` 作用于 Promise 对象本身而非解析值）。§6.1 新增「无测试钉死的缝隙」子项 + SA4 静态核对项（实现与 memory.ts:171 表达式逐字同构） |
| #4 LOW（degraded 全局语义披露） | ✅ | §4.5 新增披露段 + 矩阵行指引 + §4.6 新行。P2 `:285` 引用属实（SA2 R1 已核原文）；「恢复条件 = 任一 flush 成功」与内核 `flush` 成功路径无条件 `status='ready'` 一致；ENOSPC/EACCES 场景语义评估与 v2 留待表述恰当 |
| #5 LOW（循环依赖论据 + 平台限定） | ✅ | §6.4 承认 R0「函数声明」为事实错误，`export const systemPersistenceTimer`（index.ts:63 行号经核属实）；新论据（顶层不读循环绑定 + 构造期访问 + index⇄memory 先例）成立；§4.5 sweep 行已补 POSIX 平台限定（NFS root-squash 例外如实声明） |

## 修订版新引入内容的攻击复核（防「修一处错一处」）

- 决策 E 理由 2 HMR 链条：rename 缺失源确为 ENOENT；「新旧实例**可能**短暂共存」措辞恰当（框架 dispose 时序未定义）；惰性清扫竞态不可能性严格限定「单实例内」，与 v1「多实例同 rootDir 属调用方错误」边界自洽 ✓
- E.1 离线清理要求「停机后」执行——正确（运行期清理即 HMR 竞态同类）✓
- §6.4 新论据①「lifecycle.ts/file.ts 模块顶层从不读取循环导入绑定」——经核 lifecycle.ts 顶层（WeakMap 构造/Symbol/类声明）与 file.ts 顶层（正则字面量；index.js 为 type-only import）均不触及 ✓
- 旧错误表述 grep 证实仅存于勘误声明与回应表（「R0 此说为事实错误」「R1 勘误」），正文论证全部替换 ✓
- 与 R0 逐节比对：改动收敛于 5 项要求对应的段落（决策 E 2/3 + E.1、§4.1 选项与引言、§4.2 注释、§4.5 两行 + 披露段、§4.6 一行、§6.1/§6.4/§6.5、头部与回应表），其余逐字一致，无隐蔽改动 ✓

## R2 结论

**pass**——设计放行，可进入 SA3 实现阶段。R1 的 5 个攻击点全部闭合（#1/#3/#4 超出最低要求）。本 pass 仅表示**设计**通过攻击审查，不替代 SA4 对实现与静态门禁、SA7 对活链路的验证。移交下游的静态核对项：① §6.1「无测试钉死的缝隙」——实现须与 `memory.ts:171` 表达式逐字同构（480 绿灯不会捕获该处漂移）；② §4.1 `| undefined` 桥接形态保持；③ R1 报告 5 条红灯测试构想（残留钉死 / degraded 半径 / sweep 吞错端到端等）是否发起 SA6 R2 锚定轮由总控决定，其中「残留钉死」一条在决策 E.1 披露后已成为**钉死文档承诺**的候选。

## R2 验证证据

- node 探针（三分支语义）：`sync-undefined -> MAP-BYTES / async-undefined -> undefined / no-callback -> MAP-BYTES`——与修订注释逐字一致
- tsc 探针（仓库 typescript@5.9.3 + tsconfig.base.json 同款旗标，strict/exactOptionalPropertyTypes/noImplicitOverride/verbatimModuleSyntax）：R0 形态 EXIT=2（TS2379）→ R1 修订形态 **EXIT=0**
- grep `list 能力|清扫面自然闭合|回调优先（即使其返回 undefined|值导入均为函数声明` → 5 处命中全部位于勘误/回应表上下文，正文论证已替换
- 修订版 672 行全文重读；P2 测试 `:285`、`src/index.ts:63`、`memory.ts:171` 三处被修订引用的锚点逐一复核属实
