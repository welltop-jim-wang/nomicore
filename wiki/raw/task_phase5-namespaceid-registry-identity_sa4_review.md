# SA4 静态验尸报告

**Date**: 2026-08-27（Phase 3 静态绿光验尸）
**Reviewer**: SA4（Red Team Hacker，静态审核者）
**审查对象**: commit `b21de27`（980b16a..b21de27，32 文件）+ 工作区未提交的 SA6 R4 fixture 修正（`git diff HEAD`，3 文件：red.test.ts / dispatch.md / sa6_red.md）
**设计基准**: `wiki/raw/task_phase5-namespaceid-registry-identity_design.md`（R2 定稿）
**红灯契约**: `wiki/raw/task_phase5-namespaceid-registry-identity_sa6_red.md`（R1–R4）
**辅助参照**: SA2 R2 复审（pass）、ADR 0006/0009/0010、`registry-surface.test.ts` 冻结面

---

## 0. 独立复核证据（全部独立进程执行，2026-08-27）

| # | 命令 | 结果 |
|---|---|---|
| V1 | `pnpm vitest run packages/namespace-registry/test/registry-phase5-identity-red.test.ts`（含 R4 工作区版） | **exit 0；20/20 通过**（15 AC + 锚 A/B1/B2/B3/C） |
| V2 | `pnpm vitest run --typecheck <surface.test-d.ts + red.test.ts>` | **exit 0；25/25 通过（20 运行时 + 5 类型）；Type Errors: no errors** |
| V3 | `npx tsc -p tsconfig.typecheck.json --noEmit`（设计 §12.1 命令 0） | **exit 0；零错误** |
| V4 | `pnpm vitest run packages/namespace-registry/test` | **exit 0；186/186**（含 surface 9/2 冻结面全绿） |
| V5 | `pnpm test`（全仓） | **exit 0；120 文件 / 1427/1427 通过；Type Errors: no errors**——与总控亲验一致 |
| V6 | `npx tsc -p packages/namespace-registry/tsconfig.json` + `git diff --check`（980b16a..HEAD 与工作区） | 均通过（零类型错、零 whitespace 违规） |
| V7 | 协议假设复测（设计 §9 四条）：`node -e`（randomBytes 16 字节/instanceof Uint8Array；`new Uint8Array(buf)` 独立拷贝非 Buffer；hex padStart 32 位小写、`/^ns-[0-9a-f]{32}$/` match） | `len: 16 isUint8Array: true` / `copy isBuffer: false independent: true` / `hexlen: 32 match: true`——与设计 §9 逐字吻合 |

---

## 1. 设计一致性审查

### 1.1 文件清单 Scope Creep Guard

- **ALLOW LIST 抽取**（设计 §11）：src 8 文件 + test 14 文件 + ADR 0006/0009 两文档。
- **actual diff**（`git diff --name-only 980b16a HEAD`，32 文件）：src 8 ✓、test 13 ✓（第 14 个 ALLOW 成员 `registry-surface.test.ts` **零改动**——DENY 项保持）、ADR 2 ✓、`wiki/raw/task_*` 8 文件（白名单豁免）。
- **超出 ALLOW 的文件恰 1 个**：`packages/namespace-registry/package.json`——仅 `"version": "0.1.3" → "0.1.4"` 一行。判定 **LOW 偏离（非 creep）**：仓库既定惯例（`git log -- package.json`：#110 两次、#105 均随包变更 bump 版本；6472485 即由本惯例带入 0.1.3），零依赖/exports/脚本变化（diff 仅 1 行）。处置：SA1 后续在 design ALLOW LIST 补注该惯例条目即可，不要求回滚、不阻塞。
- **BLACKLIST**：无 package-lock.json / yarn.lock / TASK.md / *.bak / .DS_Store 命中。
- **DENY LIST**：`packages/persistence/**`、`namespace-runtime/**`、`doc-runtime/**`、`lease.ts`、`errors.ts`、`registry-surface.test.ts`、`registry-entry-removal-guard.test.ts`、`CONTEXT.md`、ADR 0010、`docs/phases/**`、根 package.json——**全部零命中**。

### 1.2 设计偏离逐项比对（§4 内核 → 实现）

| 设计机制 | 实现锚点 | 判定 |
|---|---|---|
| D-1 randomBytes 必需键 + 构造期 TypeError，顺序 clock→scheduler→idleTimeoutMs→randomBytes | `registry.ts:478 assertRandomBytesShape`（位于 resolveIdleTimeoutMs 之后）；types.ts/testing.ts/index.ts 类型面；index.ts 仅 type 追加 `RegistryRandomBytes`（运行时 9 值冻结不受影响，V4 surface 全绿实证） | ✅ |
| D-2 生产源 = plugin.ts 桥接 `node:crypto`，`new Uint8Array` 拷贝 | `plugin.ts:50,68-70,178`（`productionRandomBytes` + apply 传参）；核心零全局 crypto 直调（src 内 `node:crypto` 仅 plugin.ts 一处） | ✅ |
| D-3 `ns-`+32 小写 hex、违约立即 fatal 不耗预算 | `registry.ts:533-573 generateNamespaceId`：throw/形状（instanceof + length===16）/编码 pattern 三守卫均走 `throwIdGenerationFatal`；锚 B1/B2/B3 实证 calls===1 | ✅ |
| D-4 新主链（owner 接纳→生成循环→每候选 carrier FIFO→①碰撞②一次性准备③每候选 build④DOC_DUPLICATE→retry⑤登记） | `registry.ts orchestrateCreate/admitCreateAttempt/runCreateAttempt`；`snapshotCreatePayload` 恰三键（keys.length!==3 拒）；死代码（closing 四变体 + ALREADY_EXISTS 两出口）确已删除（grep 零残留，仅注释与 types.ts 常量） | ✅ |
| D-5 耗尽 fatal（committed:false、`namespace-id-generation` 新 phase） | `registry.ts:905-913`（retry>8 → attempts=9）；types.ts phase 联合追加；纯 entry 碰撞零 createDoc（V1 耗尽用例 `createCalls===[]` 实证） | ✅ |
| D-6 key=namespaceId、open owner 谓词先于 phase 分派 + closing recheck 同谓词 | `identity.ts:104-119`（key: namespaceId）；`registry.ts:803-806`（第一谓词）、`:825-827`（recheck 谓词）——复用既有 NOT_FOUND 常量（零存在性泄露） | ✅ |
| D-7 ALREADY_EXISTS code/message 保留、运行时零产出 | types.ts:61-62/231-232 保留；registry.ts 产出点删除；registry-create.test.ts:1106 锚定注册表文本（保持性断言，非运行时产出） | ✅ |
| D-8 prepare/build 拆分、seam 按候选调用 | `create-document.ts`（`createDocument` 单入口删除，全仓 grep 无代码级 caller 残留）；preparedBox 一次/create（快照+Clock 单读+compile/validate 不随重试重复） | ✅ |
| D-9 shutdown `admittedCreates` 编排等待 | `registry.ts:517-519`（Set + add/`void tracked.finally(delete)` 闭环）、`:1125-1130`（carrier 快照后追加等待）；shutdown() 同步段先 `acceptance='shutting-down'`（:1216）——关门后集合只减不增 | ✅ |
| D-10/AC-5 Persistence 零改动 | packages/persistence 零 diff；`createDoc(owner, 生成ID, doc)` 分区语义原样 | ✅ |
| D-11/AC-7 文档对齐 | ADR 0009 修订节（:132-143，6 条与设计 §8 逐点对应）；ADR 0006 对齐说明（:201-209）；CONTEXT.md/ADR 0010/phases 零改动 | ✅ |
| D-12 observer 加法事件 | `observer.ts:33-39` union 追加；既有十形零改动；dispatch 仅经 `throwIdGenerationFatal` 单点 | ✅（见 §5 备注 L2 措辞项） |
| 排序裁决（①namespaceId 键拒收在 owner 文法之前） | `identity.ts acceptCreateIdentity`：①getOwnPropertyDescriptor(namespaceId) 拒 → ②owner accessor 门 → ③validateOwnerIdentity；hostile String 对象用例断言 `ownerTrap===0`（键拒收短路先于 owner 读取） | ✅ |

**次序不变量复核**（§4.3 尾段）：纯 entry 碰撞零 Clock 读/零 build（①最先返回 retry，V1 实证 consumed=9 且 createCalls=[]）；payload 快照槽内一次；Clock 单读（preparedBox 内一次）；compile/validate 一次/create；createDoc 仅在准备成功后——全部与实现吻合。

### 1.3/1.4 CI 触发性自检

- 运行时新文件 `registry-phase5-identity-red.test.ts` 与全部迁移 `.test.ts`：命中根 `vitest.config.ts` include `packages/*/test/**/*.test.ts`；CI（`.github/workflows/ci.yml` Test 步 = `pnpm test` = `vitest run --typecheck`）覆盖 ✓。
- 类型面 `registry-phase5-identity-surface.test-d.ts`：命中 typecheck.include `packages/*/test/**/*.test-d.ts`（tsconfig = `tsconfig.typecheck.json`，其 include 含 `packages/*/test/**/*.ts`）✓。
- `pnpm typecheck` 显式含 `tsc -p packages/namespace-registry/tsconfig.json`（V6 通过）✓。
- 本任务未新增 workflow/E2E spec；**无未接通测试**。

### 1.5 协议假设审查

设计 §9 章节存在，4 条假设依据类型/引用齐备，无「应该/通常」类无据推断。SA4 复跑实测（V7）四条全部吻合：`node:crypto` randomBytes 16 字节且 instanceof Uint8Array、`new Uint8Array(buf)` 独立普通拷贝（改拷贝不动原值）、hex 编码恒 32 位小写且过 pattern、declaration 可达图仅跟相对 specifier（`registry-surface.test.ts:147-178` 源码核实）。**verdict: 无 mismatch**。

### 1.6 契约改动连锁审计

| 契约改动 | caller | await | 直接 try/catch | 处置判定 |
|---|---|---|---|---|
| `createNamespaceRegistry` 新增构造期 throw | `plugin.ts:178` apply 内 | 同步构造 | ❌ 裸调用 | **同切片已补 `randomBytes: productionRandomBytes`**（修复后该 throw 运行期不可达；apply throw → cordis fiber 响亮失败，既有通道）；plugin 测试 9 例全绿（V4） |
| 同上 | `red.test.ts:341-342`（`as never` 双工厂） | 否 | ✅ `toThrow(TypeError)` | 期望 throw 本身即断言（V1 绿） |
| `createNamespaceRegistryForTesting` 同款 throw | 既有 11 测试文件 ~145 调用点 | 混合 | ✅ vitest | §7 迁移矩阵全部补 deterministic/scripted 随机源（V4 186/186 绿；零随机注入的残留构造会被门禁响亮拒绝，非静默） |
| `NamespaceRegistry.create` 四键→三键（结果通道不变） | 生产 caller：无（apps/ 空、domains 零引用、跨包 grep 零命中——本次复核） | — | — | 无生产 ripple；敌意输入经接纳段窄 issue（运行时校验完整保留） |
| 模块私有 `createDocument` 拆分删除 | registry.ts 唯一消费者（同步迁移）；测试零直接 import（grep 仅注释） | — | — | 无悬空 caller |

fire-and-forget 新增面：仅 `void tracked.finally(...)`（回调为 Set.delete，不可 throw）与 `void releaseHandleBestEffort`（既有，内部全包）——**零 unhandled rejection 新面**（锚 A 显式探针 `probe.events===[]` 实证）。

### 1.7 源码 GREP 断言禁令

对全部 13 个改动测试文件扫描：`readFileSync` + `toMatch/toContain` 源码字符串断言——**零命中**。红灯文件全部为运行时行为断言（lease 投影/计数 stub/observer 事件/fatal 字段）；唯一文件级读取是 `registry-surface.test.ts` 的导出面/静态守卫扫描（**本任务零改动**，属其既有冻结面职责，非本切片断言）。**verdict: 无违规**。

### 1.8 §12.3 双登记验证项（D-13——SA4 专属核对清单）

| 核对项 | 结果 |
|---|---|
| 锚 A（D-9 shutdown×在途重试）已落盘且与 §4.6 一致 | ✅ `red.test.ts:597-638`：剧本 [X,X,Y] + `gateCreate(Y_ID)` deferred gate 卡 createDoc 在途 + shutdown；断言 `order===['create2','shutdown']`、X/Y 各恰关一次、`{state:'stopped'}`、`probe.events===[]`——与设计规格逐条对应 |
| 锚 B（D-3 运行期违约）已落盘且与 §4.2 一致 | ✅ `red.test.ts:640-707`：B1 throw（cause exact identity）、B2 15 字节（`calls===1` 零预算消耗）、B3 非 Uint8Array 并案；公共面断言 phase=`'namespace-id-generation'`、committed=false、零 Persistence、observer 恰一次 |
| 锚 C（C-1 推论 1 同候选并发）已落盘且与 §4.3.4 一致 | ✅ `red.test.ts:709-728`：共享剧本 [X,X,Y] 并发双 create；两 lease 恰 {X,Y}、`constructed` 按 ID 各恰 1（绝无第二个 X Runtime）、createDoc 恰 [X,Y] FIFO 次序、双 okLease（零 fatal） |
| `MAX_NAMESPACE_ID_RETRIES` 常量为 8 | ✅ `registry.ts:141`（总生成 ≤9；耗尽用例 `src.consumed===9` 实证严格读法） |
| `admittedCreates` add/delete 闭环（finally） | ✅ `registry.ts:555-560`（add 于同步段、`void tracked.finally(delete)`；shutdown 同步关门后只减不增） |
| observer 新事件仅生成失败终局发射 | ✅ 全部经 `throwIdGenerationFatal` 单点（registry.ts:529），无其他 dispatch 点；逐次碰撞重试零事件（锚 A/C 运行无该事件实证）。备注见 L2 |

---

## 2. 读写路径一致性

- 写路径：create →（接纳 owner → 生成 ID）→ `persistence.createDoc(owner, 生成ID, doc)`；读路径：open → entry（key=namespaceId）→ miss → `persistence.loadDoc(owner, namespaceId)`。**同一 Persistence、同一 owner 分区键、同一 docId 语义，无分叉**。
- entry 写（slot ⑤ `entries.set(id.key)`）与读（open/create ① 的 `entries.get/has`）同以 namespaceId 为键；lease.owner 投影自接纳冻结 owner（V1 lease.owner 断言绿）。
- `META.docId === 候选 namespaceId`（buildInitialDocument 按候选传参，Runtime constructed 以生成 ID 构造——V1 断言绿）。
- **verdict: 一致，零分叉**。

## 3. 静默失败专项

新链全部终局可观察：四键/坏 owner → resolve 窄 issue（零副作用，测试断言 consumed===0/createCalls===[]）；碰撞重试有界（9）且每次经 carrier FIFO 结算；耗尽/随机源违约 → reject branded fatal + observer 恰一次；Persistence operational/fatal、Runtime 构造失败沿既有通道（CREATE_FAILED_ISSUE / committed 传播 / releaseHandleBestEffort）。未发现「无结果 + 无信号」路径。**verdict: 无静默失败**。

## 4. 降级方案审查

- **零新增降级**：randomBytes 缺失/违约不 fallback（无 Math.random / crypto.getRandomValues 缺省——plugin.ts 桥接是唯一生产来源；核心零全局 crypto 直调，grep 实证）。
- 「坏源重摇掩盖」被设计显式拒绝、实现照办（违约立即 fatal 不耗预算，锚 B 实证）——符合反伪降级纪律。
- 载体清理/`factory ?? defaultDocumentFactory` 均为既有机制，非本切片新降级。
- **verdict: 安全**。

## 5. 极端条件攻击（静态构造）

| # | 攻击 | 结论 |
|---|---|---|
| X1 | 敌意随机源恒返同 16 字节 + entry 占位 | 9 代全碰撞 → 耗尽 fatal（committed:false 结构性成立：任何 createDoc 成功即登记返回，进不了耗尽分支）✅ 安全 |
| X2 | 随机源 throw / 返回 15 字节 / 非 Uint8Array / Buffer 子类 | throw/形状违约立即 fatal（锚 B）；Buffer `instanceof Uint8Array` 且 length=16 合法通过（V7 实测语义）✅ |
| X3 | 并发同候选（同/异 owner） | carrier FIFO 结构性排他：后到 attempt ① 命中已登记 entry → 重生成（锚 C 实证；异 owner 同构——entry 键与 owner 无关）✅ |
| X4 | 在途重试遇 shutdown | `admittedCreates` 屏障等编排终局；晚登记 entry 落入关闭全集枚举（closure 循环在屏障之后）→ 恰关闭一次（锚 A 实证 order/stopped/探针）✅ |
| X5 | open 跨 owner 探测他人 namespace 存在性 | mismatch → 既有 NOT_FOUND 常量（同 message、不区分属他人/不存在）；短路先于 loadDoc/factory（V1 `loadCalls===[]`、`constructed` 恰 1）✅ 零泄露 |
| X6 | entry 无而 (ownerB, nsId) 分区有文档 | loadDoc(ownerB, nsId) 正常建立——ADR 0010 合法面（设计 §4.4.2 显式裁决），非泄露 ✅ |
| X7 | 排队期变异 input / accessor / Proxy trap | 快照槽内恰三键 own data descriptor 校验 + 深克隆深冻结（既有机制原样）；accessor owner 零 getter 执行（ownerTrap===0 断言）✅ |
| X8 | 旧格式 namespaceId（`k-ns`）round-trip | open 文法（isMinimalSafeString）零改动，idle/shutdown 用例继续绿（V4）✅ |
| X9 | `orchestrateCreate` 首代即 fatal（run 已 reject） | tracked 恒绿尾仍入 Set（IIFE 后同步注册）；caller 收 fatal、零 unhandled ✅ |
| X10 | create 于 shutdown 后调用 | acceptance 检查先于一切输入访问（`REGISTRY_NOT_ACCEPTING` + 四键字面量豁免断言零 trap 访问）✅ |

未发现可静态确认的漏洞。**verdict: 安全**。

## 6. 错误处理链路

每个分支均有窄 issue / branded fatal / observer 事件三选一以上可观察出口；错误注册表变更（§4.7 七项）逐项与实现比对一致（新 phase、保留 ALREADY_EXISTS、新 message 常量、新门禁文案、新 observer 形）；构造门禁顺序保持既有测试锚（clock/scheduler/idleTimeoutMs 文案用例全绿）。**verdict: 完整**。

## 7. 架构评估

身份内核迁移（复合键退役→namespaceId 单键、caller ID→CSPRNG 生成、ALREADY_EXISTS→重试环）在 ADR 0010 裁决内闭合；无绕过架构约束的硬编码、无 FIXME 残留、无与设计相悖的新数据流；仅触及设计授权的单一包。**verdict: 可行，无需退回 SA1**。

## 8. 过度设计审查

- 变更半径与 AC 精确匹配：6 src 模块改动全部可映射到 D-1..D-12；preparedBox/拆分由重试语义必需（Clock 单读/compile 一次/createDoc 按候选），非投机抽象。
- 生成器自编码 hex（零 Buffer 依赖）+ 结构守卫（pattern 恒真防回归）是防御而非过度——各 ~6 行。
- 无「为未来需求」的死抽象；`PreparedDocumentBundle` 等新类型即编即用。
- **verdict: 精简**。

---

## 9. 遗留事项（不阻塞，需登记/处置）

| # | 级别 | 事项 | 处置建议 |
|---|---|---|---|
| L1 | LOW（scope 注记） | `packages/namespace-registry/package.json` 版本 bump（0.1.3→0.1.4）不在设计 §11 ALLOW LIST——仓库惯例性 housekeeping（#105/#110 先例），零功能面变化 | SA1 在 design 补一行 ALLOW 注记（或总控在 PR 描述声明惯例）；无需回滚 |
| L2 | LOW（措辞） | 设计 §4.3.5「发射点恰三处」vs 实现经 `throwIdGenerationFatal` 的 4 个调用点（随机 throw/形状违约/编码 pattern 守卫/耗尽）——设计 §4.2 自身伪码即含 4 处 dispatch（pattern 为结构性不可达守卫），实现与 §4.2 逐字一致，属设计内部文本不自洽 | 后续修订轮把 §4.3.5 措辞改为「三类可达终局 + 一处结构性守卫」；不影响任何断言面 |
| L3 | LOW（已知，转正） | SA2 R2 留下的 §7 普查计数「33 处」vs 枚举 16 处——本次复核确认枚举行号完整（迁移后各文件 create 调用点计数因语义重写有正常增减）；执行依据是逐行判定 + §12 命令 4 grep 门（本次 26 残留命中逐条核验均属 open 调用/期望对象/文法拒收面/豁免注记，**create 成功输入零残留**） | SA1 订正计数；以逐行清单为准（SA2 R2 已裁决不构成驳回事由） |
| L4 | 操作项（重要） | R4 fixture 修正 + wiki 记录目前**仅在工作区未提交**（`git diff HEAD` 3 文件）。已提交态 b21de27 单独跑 red 文件为 17/20（SA6 R4 记录：getter 解构缺陷使 3 断言结构性不可满足）；本报告 V1 的 20/20 以工作区态为准 | **总控必须确保 R4 修正随最终 commit/push 一并提交**，否则 CI 将在 red 文件 3 例红灯（`src.consumed` 计数断言）。这是发布操作要求，非代码缺陷 |

---

## 10. 动态审核重点（交 SA7）

1. **R4 提交完整性**：`gh pr diff` / push 后 CI 日志确认 red 文件 20/20（而非 17/20）——L4 的运行时确认。
2. **plugin 生产随机链路实测**：经真实 cordis host 起插件 → create → 断言产物 namespaceId 匹配 `/^ns-[0-9a-f]{32}$/`（plugin 测试读回 lease 但未显式锚格式；scripted 源格式锚已覆盖生成器逻辑，此项为实机补充）。
3. **真实文件 Persistence round-trip**：生成 ID 经 `@nomicore/persistence` file 实现落盘/重开（owner 分区 + 35 字符文件名安全性；单元面为 stub 分区建模）。
4. **长时 CSPRNG 行为**：生产源统计健全性/无重复（CSPRNG 契约由注入方负责，核心仅形状守卫——设计 §13 显式拒绝核心统计检测，SA7 可做抽样观证）。
5. **锚 A 的真实时序观证**：以非确定性调度（真实 scheduler）复跑 shutdown×在途重试 interleaving 一次（单测用确定性 gate；真实异步序下的屏障行为抽样）。

---

## 11. 结论

| 维度 | 结论 |
|---|---|
| 1. 设计一致性 | ✅ 一致（§4 全部机制 D-1..D-13 逐项落位；L1/L2 两处 LOW 注记） |
| 2. 读写路径一致性 | ✅ 一致（Persistence 分区/entry 键/META.docId 同源闭环） |
| 3. 静默失败 | ✅ 无 |
| 4. 降级方案 | ✅ 安全（零新增降级；反伪降级纪律落实） |
| 5. 极端攻击 | ✅ 未发现漏洞（X1–X10 全部结构性安全或已锚见证） |
| 6. 错误处理 | ✅ 完整 |
| 7. 架构评估 | ✅ 可行 |
| 8. 过度设计 | ✅ 精简 |

§12 绿判独立复核：命令 0/1/2/3/4 全过（V1–V6 + grep 门 26 残留逐条核验）；§12.3 锚 A/B/C 双登记六项核对全过；1427/1427、0 类型错、9/2 导出冻结保持。遗留 4 项均为 LOW/操作级（L4 为发布操作要求：R4 工作区修正必须随 push 提交）。

**Verdict: pass**
