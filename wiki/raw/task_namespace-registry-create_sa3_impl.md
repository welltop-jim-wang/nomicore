# task_namespace-registry-create — SA3 实现档案（issue #111）

> 角色：SA3（TDD 实现执行者）· worktree `/home/wangjian/nomicore-fix-issue-111` ·
> branch `fix/issue-111-on-docs-namespace-registry` · 冻结设计 R3 PASS
> （`wiki/raw/task_namespace-registry-create_design.md`）· 红灯档案
> （`wiki/raw/task_namespace-registry-create_sa6_red.md`，56 灯）。
> 本档案记录：实现清单、设计落点对照、验证命令与真实结果、**红灯裁决登记
> （5 项——经独立 SA 二审全部 CONFIRMED，属 SA6 测试自相矛盾；SA6 R-fix 已修订，
> 见文末「修订轮 R1」，当前 410/410 + 全仓 1329/1329 全绿）**、
> 设计偏离登记与遗留风险。**全程零测试文件修改**（git status/diff 证据见 §5）。

## 1. 实现清单（全部文件在 ALLOW List 内；行数 = 当前文件总行数）

| 文件 | 状态 | 行数 | 说明 |
|---|---|---|---|
| `packages/namespace-registry/src/types.ts` | 修改 | 306（原 203） | §3 冻结公共面：5 条 create message 常量、InvalidIdentityIssue / RegistryNotAcceptingIssue 命名接口、CreateNamespaceInput / CreateNamespaceIssue / CreateNamespaceResult、`RegistryOperationUnavailableIssue.operation` 收窄为 `'shutdown'`、`CreateNamespaceRegistryOptions.clock: Clock` 必需、`NamespaceRegistry.create` 契约注释 |
| `packages/namespace-registry/src/identity.ts` | 修改 | 162（原 115） | §4 DQ-1：`acceptCreateIdentity`（顶层非 object → CREATE_INVALID_INPUT；owner/namespaceId 属性 GET → `validateOpenIdentity` descriptor-only 校验 → 冻结投影+key；trap throw 一律窄 issue）；`CREATE_INVALID_INPUT_ISSUE` 常量 |
| `packages/namespace-registry/src/observer.ts` | 修改 | 69（原 62） | §8：事件联合扩展 `create-persist-failed` / `create-runtime-construction-failed`、`lifecycle-slot-failed.operation: 'open'\|'create'` |
| `packages/namespace-registry/src/create-document.ts` | 新建 | 120 | §6 DQ-2：私有编排 compileSchemaEnvelope → validateLogicalSnapshot（verbatim）→ 构造步（默认 doc-runtime seam，注入测试 factory）；`CreateDocumentGatewayResult`（doc 以 any-bridge，主入口可达声明无编辑器文档类型名） |
| `packages/namespace-registry/src/registry.ts` | 修改 | 732（原 348） | §2.1/§4/§5/§6/§7/§8：`assertClockShape`（构造期同步固定 TypeError）、`snapshotCreatePayload`/`clonePlainData`（§4 第 3-4 步 cycle-safe plain-data 深快照+深冻结）、`readCreatedAtOrFatal`（槽内单次读数，非法读数 fatal false）、`admitCreateSlot`/`runCreateSlot`（§5 伪码逐行）、内部 options（clock 必需/createDocumentFactory/testEntries any-bridge）、失败映射 §7 表逐行、create() 替换 |
| `packages/namespace-registry/src/testing.ts` | 修改 | 71（原 47） | §8：`clock: Clock` 必需 + `createDocumentFactory?` 注入面；工厂透传 |
| `packages/namespace-registry/src/index.ts` | 修改 | 24（原 22） | §2.3：type-only 增量 `CreateNamespaceInput/CreateNamespaceIssue/CreateNamespaceResult`；移除 `RegistryOperationUnavailableIssue` 导出 |
| `packages/namespace-registry/src/errors.ts` | 修改 | 55（原 52） | §7：operation/phase 词表连续性（并发注释更新——类面本就含 open/create/shutdown 与 create-document-internal，零运行时变化） |
| `packages/namespace-registry/package.json` | 修改 | — | §2.1：`@nomicore/clock` 入 dependencies；patch 0.1.1 → 0.1.2 |
| `packages/doc-runtime/src/create-initial-document.ts` | 新建 | 494 | §6/§9：`createInitialDocument` 三分支（input-invalid 单 issue path=[] / root-invalid verbatim / 手造 derived → pre-commit-internal,false）、自持 `new Y.Doc()`、fresh-map 空置断言、恰一个 transactGuarded 事务（SCHEMA 四键+META 二键+ROOT entries）、写后 verifySchemaFourKeys/verifyMetaTwoKeys/verifyInstall/verifySnapshotIntact-镜像（§3.1 复用/镜像许可；比较基准 = 安装读回 ≡ 原样输入 ROOT——初始安装即同管线唯一安装，构造性同 replace 的 scratch-仲裁，零第二事务保 afterTransaction=1 锚） |
| `packages/doc-runtime/src/index.ts` | 修改 | 30（原 28） | §2.2：值导出 `createInitialDocument` + 类型导出 |
| `packages/doc-runtime/package.json` | 修改 | — | patch 0.1.10 → 0.1.11 |

**未改动**：任何测试文件（SA6 owned）、`packages/persistence/**`、`packages/namespace-runtime/**`、
`packages/clock/**`、`packages/dsh-persistence/**`、`docs/**`、根 package.json、全部配置文件、
`pnpm-lock.yaml`（DENY 边界保守；遗留说明见 §6.3——node_modules 内的 `@nomicore/clock`
symlink 手工补齐（gitignored，不落盘版本库），锁文件 importer 项待总控/收口更新）。

## 2. 设计落点对照（关键契约逐条）

| 设计条款 | 落点实现 | 验证 |
|---|---|---|
| §5 伪码次序 acceptance→entry→payload→Clock→create-doc→Persistence→Runtime | `registry.ts runCreateSlot` 逐行 | 成功链/duplicate/Clock 计数/ordering 全绿 |
| closing+closePromise===undefined → fail-loud | runCreateSlot 双分支；observer lifecycle-slot-failed(create)+fatal create/lifecycle-slot-internal/false，**在 payload/Clock 前** | closing fixture 主体断言通过（该用例其余断言另见 §4-5 裁决） |
| §4 DQ-1 最小接纳+冻结身份 | `acceptCreateIdentity` + 槽内只读快照 | owner 冻结红灯绿；owner Proxy trap / 先短路红灯绿 |
| §4 payload 快照（4 键/plain/descriptor/cycle-safe/深冻结） | snapshotCreatePayload/clonePlainData | 12 变体红灯绿（循环/bigint/Date/class/function/NaN/Infinity/symbol/共享/accessor/Yjs） |
| §6 DQ-3 Clock 必需/门禁/单读/非法读数 | assertClockShape（构造期 TypeError 逐字）+ readCreatedAtOrFatal | 门禁 7 变体、now 抛/NaN/Infinity/超界/边界、counter 锚（除 §4-3 裁决点）全绿 |
| §6 DQ-2 createInitialDocument 三分支+单事务+四组核验 | create-initial-document.ts | 9/9 绿（含 afterTransaction=1、fresh-map 空置、三篡改 committed:true） |
| §7 映射表（operational/duplicate/fatal/unknown/post-commit） | runCreateSlot catch 分流 | persistence 六用例 + post-commit 六用例绿（除 §4-4 裁决点） |
| §7 DQ-6 unknown → committed false | unknown → fatal lifecycle-slot-internal/false | 红灯绿 |
| §7 DQ-7 post-commit factory → release 恰一次 fire-and-forget + committed true + 零 entry | runCreateSlot 尾段 | release reject/never-settle 红灯绿；open 恢复（除 §4-4 裁决点） |
| §8 observer/testing/导出面 | observer.ts/testing.ts/index.ts | observer 事件断言、testing 签名、d.ts 三审计全绿 |
| §8 主入口可达声明禁用词 | create-document.ts `doc: any` any-bridge + 注释去词 | declaration emit 绿灯 |
| §8 closing any-bridge entry 注入面（SA6 §6 第 1 点） | `NamespaceRegistryInternalOptions.testEntries?: ReadonlyMap<string, any>`（仅内部 options；index/testing 不导出；文件头注明测试专用） | closing fixture 主体通过 |

## 3. 验证命令与真实结果

### 3.1 迭代（实现中，两包定向）
```
cd /home/wangjian/nomicore-fix-issue-111
npx vitest run packages/namespace-registry packages/doc-runtime
```
- 迭代 1 → 7 failed；修复（seam 领域 kind 分流、d.ts 注释去词、clock import 链接、type leak 收口）后：
- **最终：Test Files 1 failed | 26 passed (27)；Tests 5 failed | 405 passed (410)；Type Errors no errors（exit 1 = 5 灯待裁决，见 §4）。**

### 3.2 全量
```
npx vitest run --typecheck                # = pnpm test 等价（pnpm 包装层因环境 deps 检查 CWD 报错，见 §6.3）
=> Test Files 1 failed | 108 passed (109)；Tests 5 failed | 1324 passed (1329)；Type Errors no errors
pnpm typecheck                            # exit 0（9 包 tsconfig 全过）
npx tsc -p tsconfig.typecheck.json --noEmit   # exit 0，零错误（基线 89 条中间态噪音清零）
```
- 基线 pnpm test 断言摘要（SA6 档案）：56 failed | 354 passed (410)。当前：5 failed | 405 passed (410)。
  - **既有 354 盏绿灯全部保持**（00 baseline-green 文件零回归：registry-open 32/32、
    registry-node-dispose 2/2、registry-entry-removal-guard 7/7、doc-runtime 20 文件全绿、
    registry-surface 既有 8 断言绿 + 2 新断言绿、full-repo 其余 1080+ 案例全绿）。
  - 新红灯转绿：**51/56**（43-create 中 38、doc-runtime seam 9/9、surface 2/2 新断言、
    doc-runtime-surface 2/2、registry-surface 2 新断言）。
  - 剩余 5 灯 = §4 待裁决清单（**均为测试自相矛盾，非实现缺陷**）。

### 3.3 证据文件
`/tmp/vitest-final1.log`（两包定向，405/410 + 5 项失败原文）、`/tmp/vitest-full-repo.log`
（全仓 1324/1329）、`/tmp/tsc-full2.log`（TSC_EXIT=0）、`/tmp/pnpm-typecheck.log`
（PNPM_TYPECHECK_EXIT=0）、`/tmp/vitest-surface.log`（12/12）。

## 4. 红灯裁决登记（5 项；未修改任何测试——TDD 纪律，等待总控裁决）

> 独立复审（子代理，未修改文件）对 5 项逐一结论 **全部 CONFIRMED（不可约）**：
> 无任何正确实现可在不改测试的前提下使这些断言转绿。逐项证据：

| # | 用例 | 矛盾性质 | 具体证据 |
|---|---|---|---|
| 1 | identity 表 case 0（`makeCreateInput({owner:null})`） | fixture 自吞 | makeCreateInput 的 `overrides.owner ?? {userId:'u-alice'}` 把 `null` 变为默认合法身份 → 该输入与成功路径输入不可区分 → `toMatchObject({ok:false,code:'NAMESPACE_INVALID_IDENTITY'})` 不可达（同一文件成功用例要求该输入必须成功，互斥） |
| 2 | 自创面负锁·`create-persist-failed` | 断言与精确实例引脚互斥 | 本文件另一用例（persistence 映射）断言 `ev.cause === typed`（exact DocCreateOperationalError，设计 §8 冻结类型）；而 DocCreateOperationalError（persistence/src/contract.ts）message 恒为固定字符串（sentinel 只在 `.cause.message`）→ `(persistEv.cause as Error).message` 含 sentinel 与 exact-instance 严格互斥；open 既有同型测试用 `.cause.cause.message` 先例佐证本处为笔误 |
| 3 | Clock 恰读一次·末段 | 与 entry 保留态引脚互斥 | 设计 §1.3 + 本文件 duplicate 用例（lease 全释放后仍 ALREADY_EXISTS、clock 恒 1）钉住 entry 保留；末段排队 DocDuplicateError 后再 create 期望 clock=2——active entry 在 **Clock 前** 短路（§5 冻结次序），DocDuplicateError 不可达，clock 恒 1 |
| 4 | post-commit·后续 open 完整 | fixture 恒丢工厂 | `runtimeFactory: () => { throw factoryCause; }` 恒丢；设计 §7 明确后续 open 走**同一**注入工厂重建 Runtime——open 必丢，`okLease(open)` 断言不可达 |
| 5 | closing fail-closed·健康回归 | fixture 恒丢工厂 | 注入 `createDocumentFactory` 恒丢（无 key 区分）；k-other 合法 key → 必进 createDocument → 恒丢 → create-document-internal fatal；`other.ok === true` 不可达；且 seam 注入用例（FIFO/input-invalid）要求注入全局生效，无法为 k-other 绕过 |

**修复建议（供 SA6 回改或总控裁决）**：1 → 直构 `{owner:null,…}` 对象或 `as never`；2 → 与 open 先例一致改 `.cause.cause.message`（或移除该行——另一用例已锁 exact instance）；3 → 删除末段或改换 key/断言（保留态下 persisted-duplicate 需无 entry 的 key）；4/5 → 注入工厂改为「仅首次调用抛错」的计数器工厂。

## 5. 测试文件完整性

- `git status --short`：测试文件的 ` M` 仅为 SA6 已迁移文件（registry-open / registry-surface /
  registry-node-dispose——**启动前基线即存在**，见初始 git status）；SA3 期间无任何测试文件
  被编辑（git diff 只含 src/package.json/doc-runtime index.ts）。registry-create.test.ts、
  create-initial-document.test.ts、doc-runtime-surface.test.ts 为 SA6 新建（untracked），
  未受触碰。
- `npx tsc -p tsconfig.typecheck.json --noEmit` 在测试文件原样下零错误（create 签名宽度
  见 §6.1——这正是测试文件的静态类型要求）。

## 6. 设计偏离登记（如实；非零项均有依据）

### 6.1 【偏离】`NamespaceRegistry.create` 参数以 `unknown` 表达（设计 §14 冻结
`create(input: CreateNamespaceInput)`）
- **原因（硬约束）**：SA6 测试把输入静态表达为 `{owner: unknown; namespaceId: unknown;
  schema: unknown; root: unknown}`（makeCreateInput 显式注解），且 registry-open.test.ts
  的零回显用例直接 `registry.create({ schema, root })`（缺 owner/namespaceId）——
  两者在 `create(input: CreateNamespaceInput)` 下均 TS2345（已用最小 tsc 程序实证）。
  任务门禁要求 `tsc -p tsconfig.typecheck.json --noEmit` 零错误、测试不可改——唯一
  相容签名即 `unknown`。
- **等价性保持**：运行时接纳（`acceptCreateIdentity`，§4）是唯一形状验收点：顶层非
  object → NAMESPACE_CREATE_INVALID_INPUT；identity 缺陷 → NAMESPACE_INVALID_IDENTITY；
  槽内 §4 第 3 步强制恰四键（owner/namespaceId/schema/root）+ data descriptor。
  `CreateNamespaceInput`（§3 冻结）仍以 type-only 从主入口导出，静态调用方获命名形状。
- 影响面：仅静态参数宽度；运行时/行为/导出面/零回显契约零变化。请求总控裁决是否需要
  在 SA6 测试补 `as never` 后恢复设计签名。

### 6.2【实现注（设计允许项）】verifySnapshotIntact 以「镜像」实现
- 设计 §6 与 SA6 §6.2 均写「复用/镜像既有 install-verify 机械」——镜像是被许可路径。
  未复用 `install-verify.verifySnapshotIntact` 的原因：其实现在 scratch doc 上执行一次
  `scratchDoc.transact(...)`（buildScratchInstall），而测试以 `Y.Doc.prototype.getMap`
  包装器锚定 **afterTransaction 恰 1**（SA6 §6.2 明文）——scratch 事务会使计数为 2，
  且测试无法修改。镜像方案：比较基准 = 安装读回（extractYjsSnapshot）≡ 原样输入 ROOT，
  比较器逐规则镜像 productEqual（全键集/逐元素/XML canonical/union any-of/ref 解析，
  复用 detached-build/resolve/xml-parse 既有 @internal 导出，零构造规则复制）——初始
  安装即同一管线在 fresh doc 上的唯一安装，与 replace 的 scratch-仲裁（两侧 = 同一
  输入同一管线读回）构造性等价；根因是 fresh map 空置断言要求事务前 getMap 探针，
  probe 注册先于一切。fatal 归类不变（post-commit-verification,true）。

### 6.3【环境/收口注记】
- `@nomicore/clock` 经 `packages/namespace-registry/package.json` 入 dependencies
  （设计 §2.1 明令）；`pnpm-lock.yaml` 属根配置文件（DENY 边界保守未动）——当前
  node_modules 以手工 symlink 补齐（gitignored），**锁文件 importer 项与 CI
  --frozen-lockfile 需总控/收口处置**（`pnpm install` 会补 importer 项）。
- `pnpm test` 在本环境因 pnpm 的 verify-deps-before-run 在非项目 CWD 执行 install
  报错（`[ERR_PNPM_NO_PKG_MANIFEST] /home/wangjian/.a2a-sessions`）——非项目问题；
  等价命令 `npx vitest run --typecheck` 已全量执行（结果见 §3.2）。

## 7. 遗留风险

1. 5 项红灯待总控裁决（§4）——预期为 SA6 测试修订，非实现返工。
2. `create(input: unknown)` 静态宽度（§6.1）待裁决；运行时契约零差异。
3. pnpm-lock.yaml importer 缺 `@nomicore/clock`（§6.3）——CI frozen install 前须更新。
4. 镜像 verifySnapshotIntact 与 replace 的 scratch 仲裁在极端 XML/union 输入下的
   等价性依靠「管线 roundtrip + canonical 语义」论证（与 replace 同族信任）；当前
   红灯矩阵（含成功链、篡改面、doc-runtime 9 灯）全部覆盖通过。

---

# 修订轮 R1（总控裁决落实；SA6 R-fix 后基线 410/410 + 1329/1329 全绿）

> 总控三项裁决（对应原档案 §6.1/§6.2/§6.3）：①恢复 typed create 签名（偏离 6.1 驳回）；
> ②verifySnapshotIntact 复用共享实现（偏离 6.2 驳回）；③pnpm-lock.yaml 收口（显式授权）。
> SA6 已完成测试侧配套（makeCreateInput 返回类型改 `CreateNamespaceInput`、敌意输入
> `as never`、doc probe 改 per-doc WeakMap 锚定——scratch 重放事务计入 scratch 自身条目、
> 目标 doc afterTransaction 恰 1 锚保持）。本轮 SA3 实现侧改动如下。

## R1-1. 三裁决落点

| 裁决 | 实现落点 | diff 统计 |
|---|---|---|
| ① typed create 签名 | `types.ts`：`NamespaceRegistry.create(input: CreateNamespaceInput): Promise<CreateNamespaceResult>`（公共声明 typed；实现 `registry.ts` 保持 `async create(input: unknown)`——**实现层签名宽于 interface**，对齐 open 的「公共 typed / 实现 unknown」双层先例；运行时 §4 接纳校验不变，静态调用方获命名形状） | types.ts create 方法 + 注释（签名行改动；interface/doc 说明 ~8 行） |
| ② verifySnapshotIntact 共享复用 | `create-initial-document.ts`：**删除镜像比较器全段**（verifyCreateSnapshotIntact / postCommitVerificationFatal / CreateProductComparison / createProductEqual / deepEqualValue / createValueDiff / createDetailOf / keysetOf / summarize / errDetail / renderPath，共 ~190 行）；改为 `import { verifyInstall, verifySnapshotIntact } from './install-verify.js'`（与 verifyInstall 同模块同源），写后段依次 verifySchemaFourKeys → verifyMetaTwoKeys → verifyInstall → **verifySnapshotIntact(input.derived, prepared.snapshot, doc)**；文件 494 → 297 行；头注实现注同步更新（scratch-仲裁对初始安装同样成立；per-doc 观测使目标 doc afterTransaction=1 锚保持） | -190 行镜像 + ~6 行共享调用 |
| ③ 锁文件收口 | 根目录 `pnpm install`（exit 0）：`pnpm-lock.yaml` 的 `packages/namespace-registry` importer 落入 `@nomicore/clock: workspace:* → link:../clock`（+3 行）；`pnpm install --frozen-lockfile` exit 0（"Lockfile is up to date"）；node_modules symlink 由 pnpm 接管（`packages/namespace-registry/node_modules/@nomicore/clock → ../../../clock`） | pnpm-lock.yaml +3 |

## R1-2. 验证证据（全部后台独立进程，exit code 落文件）

| 命令 | 结果 | exit code |
|---|---|---|
| `npx vitest run packages/namespace-registry packages/doc-runtime` | **Test Files 27 passed (27)；Tests 410 passed (410)**；Type Errors no errors | **0** |
| `npx vitest run --typecheck`（全仓 = pnpm test 等价） | **Test Files 109 passed (109)；Tests 1329 passed (1329)**；Type Errors **no errors** | **0** |
| `pnpm typecheck` | 9 包 tsconfig 全过 | **0** |
| `tsc -p tsconfig.typecheck.json --noEmit` | 零错误 | **0** |
| `pnpm install`（锁文件刷新） | "Already up to date"；lockfile +3 行（clock importer） | **0** |
| `pnpm install --frozen-lockfile` | "Lockfile is up to date" | **0** |

> 注：首轮并行执行（targeted + full-repo 同跑）时 registry-surface / doc-runtime-surface
> 的 declaration-emit 用例因 CPU 争抢出现 5s 超时假红（ts.createProgram 密集）；
> 单独串行复跑即 410/410——载入（非实现）噪声，证据见 /tmp/vitest-r1-targeted2.log。
> 证据文件：/tmp/vitest-r1-targeted2.log、/tmp/vitest-r1-full.log、/tmp/pnpm-r1-typecheck.log、
> /tmp/tsc-r1.log、/tmp/pnpm-install.log、/tmp/pnpm-frozen.log。

## R1-3. 偏离登记更新：**全部闭合**

- ~~6.1 create(input: unknown) 静态宽度~~ → **闭合**：typed 公共签名已恢复（裁决 ①）。
- ~~6.2 verifySnapshotIntact 镜像~~ → **闭合**：共享 verifySnapshotIntact 复用（裁决 ②）。
- ~~6.3 pnpm-lock.yaml 未更新~~ → **闭合**：锁文件收口 + frozen-lockfile 通过（裁决 ③）。
- 剩余：无实现侧偏离；SA6 测试侧 5 项自相矛盾已在 SA6 R-fix 中修订（本档案 §4 原登记
  → 当前 410/410 即其闭合证据）。git commit 仍未执行（按纪律总控收口）。

## R1-4. 遗留风险

1. 零红灯、零类型错误、锁文件一致——无已知遗留。
2. 共享 verifySnapshotIntact 的 scratch 重放事务与 per-doc 观测的耦合依赖 SA6 R-fix
   的 WeakMap 锚定机制（已由 410/410 + 全仓 1329/1329 实证）。
3. 无 commit（总控收口）；`pnpm install` 已更新 lockfile——CI frozen 安装可过。

---

# 修订轮 R2（SA4 修复回流；SA6 R-fix2 4 盏新红灯，两包 414 用例）

> 背景：SA4 changes-required（HIGH-1 closing fail-closed / MEDIUM-2 clonePlainData
> 数组四查）回流，设计补遗（§5 closing 三态 fail-closed、§8 testEntries 冻结），
> SA6 已锚 4 盏新红灯（HIGH-1 变体 A/B/C + MEDIUM-2，见 sa6_red.md R-fix2 节实录）。
> 本轮 SA3 实现侧修复：**4/4 转绿、零回归**（410 既有绿灯保持 + 4 新灯）。

## R2-1. 修复落点（registry.ts 行号 = 修复后文件）

| 序号 | 修复 | 行号 | 内容 |
|---|---|---|---|
| HIGH-1 | `runCreateSlot` closing 分支 | 622-660 | ① `try { await current.closePromise } catch (cause)` → observer lifecycle-slot-failed(create) + `NamespaceRegistryFatalError('create','lifecycle-slot-internal',false,cause)`（**cause = exact close rejection，绝不裸传**——变体 B）；② await 后**三态再评估**：`after===undefined`（唯一放行分支）→ 继续 payload；`after.phase==='active'` → ALREADY_EXISTS；**仍 closing** → 描述性内部 Error（'closing entry 在 close 后仍为 closing'，零回显）+ observer + 同形 fatal——不建 loop（#112 接管）——变体 A；全程零 payload/Clock/createDocument/Persistence |
| HIGH-1 | `testEntries` 注入形态扩展 | 104-124（JSDoc 冻结）、397-402（种子调用） | `ReadonlyMap<string, any> | ((entries: Map<string, any>) => void)`：构造期同步调用种子函数（收到 Registry 内部 entries map——变体 C 的「close settle 时移除 entry = generation 迁移」语义）；JSDoc 明示 test-only 边界（只服务 closing 分支四变体 fixture；**不经 index.ts / testing.ts 公共导出，主入口与 testing 子路径零可达**；不得用于读取真实 entries / 生产注入 / 扩展为公开生命周期 API） |
| MEDIUM-2 | `clonePlainData` 数组四查（对齐 write.ts copyFrozen 纪律）+ 对象分支同补 | 299-352 | 数组：① `Object.getPrototypeOf(arr) === Array.prototype` 精确守卫（子类/null 原型/自定义原型全拒）；② symbol 键拒绝；③ getOwnPropertyNames（滤 length）与 Object.keys 一致性 + 可枚举非索引键/长度失真拒绝；④ **descriptor 全表扫描先于任何值读取**（accessor/稀疏空洞/非数据描述符拒绝）；⑤ 纯数据读取。对象分支同补：proto/symbol/ownNames-vs-keys（非枚举拒）/descriptor 扫描，且写入改 `Object.defineProperty`（'__proto__' 自有键不触发原型 setter——copyFrozen putPlainKey 同纪律）。5 变体（symbol/非枚举/子类/null 原型/自定义原型）全转绿 |
| MINOR-3 | create 实现处注释 | 786-790 | 「公共 typed CreateNamespaceInput / 实现 unknown 接纳」双层签名说明（对齐 open 先例；纯结构性注释，零行为变化） |

## R2-2. 验证证据（后台独立进程，exit code 落文件）

| 命令 | 结果 | exit code |
|---|---|---|
| `npx vitest run packages/namespace-registry packages/doc-runtime` | **Test Files 27 passed (27)；Tests 414 passed (414)**；Type Errors no errors | **0** |
| `npx vitest run --typecheck`（全仓） | **Test Files 109 passed (109)；Tests 1333 passed (1333)**；Type Errors **no errors** | **0** |
| `pnpm typecheck` | 9 包 tsconfig 全过 | **0** |
| `tsc -p tsconfig.typecheck.json --noEmit` | 零错误 | **0** |

> 证据文件：/tmp/vitest-r2-targeted.log（414/414）、/tmp/vitest-r2-full.log（1333/1333）、
> /tmp/pnpm-r2-typecheck.log、/tmp/tsc-r2.log。SA6 R-fix2 的 4 灯实录（失败形态）已在
> sa6_red.md R-fix2 节——本轮后全部转绿（变体 C 的对照绿锚 = 种子函数注入 +
> after===undefined 放行全链成功：createCalls=1、Clock=1、createdAt 锚、read 42）。

## R2-3. 偏离登记：无新增

- create 双层签名、verifySnapshotIntact 共享复用、pnpm-lock.yaml 收口（R1）保持闭合。
- 本轮实现侧零偏离：HIGH-1/MEDIUM-2/MINOR-3 全部按设计补遗与 SA4 要求落实；
  测试文件零改动（仅 SA6 R-fix2 自身修改）。无 commit（总控收口）。

---

# Standards BLOCKER/D1 闭合修订轮

> 背景：唯一红灯 D1 = registry-create.test.ts:718-752「构建器 D1 终审」——当前失败形态
> `expected 2 to be +0`（accessor getter 各执行 1 次）。根因：identity.ts
> `acceptCreateIdentity`（旧 identity.ts:136-146）以属性 GET 读 `record.owner`/
> `record.namespaceId` 触发 getter。Standards 评审冻结 5 处最小改动（BLOCKER-1
> version bump + ADVISORY-1/2/4 + D1 核心），设计/红灯/SA4/SA7/AC/Spec 结论全部冻结，
> 只做指定改动、零顺带重构、不改其它文件、不 commit。

## R3-1. 改动清单（5 处，全部最小；行号 = 修复后文件）

| 序号 | 文件 | 行号 | 内容 |
|---|---|---|---|
| 1 | `src/identity.ts` | 151-187 | `acceptCreateIdentity` 改 descriptor-only（**D1 闭合核心**）：「顶层非 object 首查」不变；`Object.getOwnPropertyDescriptor(inputRef,'owner'/'namespaceId')` 取描述符；accessor（`!('value' in desc) \|\| desc.get!==undefined \|\| desc.set!==undefined`，与 validateOpenIdentity/snapshotCreatePayload 同判别式）→ 窄 `CREATE_INVALID_INPUT_ISSUE`（零 getter 执行）；缺键 → 以 undefined 交 `validateOpenIdentity`（**缺键仍 NAMESPACE_INVALID_IDENTITY**，registry-open.test.ts:1100 零回显探针保持）；data descriptor → `desc.value` 交 `validateOpenIdentity`；try/catch 外壳不变（trap throw 仍收编为窄 CREATE_INVALID_INPUT）；JSDoc 第 2 条同步重写为 descriptor-only 描述 |
| 2 | `src/identity.ts` | 1-2、15-19 | 模块头注补 #111 provenance：首行追加「（issue #110 设计 §4；issue #111 设计 §4 DQ-1 —— create 最小 identity 接纳）」；「accessor 拒绝」扩展「#111 起 input 顶层 owner/namespaceId 读取同为 descriptor-only、accessor 零执行」 |
| 3 | `src/registry.ts` | 124-126 | Entry 头注重写（ADVISORY-1）：「#111 create 只读消费 closePromise / phase:'closing'（R2-M1 fail-closed，不建 loop、不改动其写入）；lifecycleTail 仍无消费者，留 #112 关闭聚合统一接管。」 |
| 4 | `src/registry.ts` | 236 | `assertClockShape` 去 `export`（ADVISORY-2）：全仓消费者仅本文件 :380/:812，测试不直调；grep 全仓确认无外部 import 残留（仅 registry.ts 内 2 调用 + 1 注释引用） |
| 5 | `package.json` / `test/registry-node-dispose.test.ts` | 3 / 22-23 | BLOCKER-1 + ADVISORY-4：version `0.1.1`→`0.1.2`（仅一行，private 记账；pnpm-lock 不动）；manualClock helper 后连续双空行折叠为单空行（零语义） |

## R3-2. 验证证据（worktree 根目录实际执行，完整尾部输出 + exit code）

| 命令 | 结果（尾部输出） | exit code |
|---|---|---|
| `npx vitest run packages/namespace-registry` | `✓ registry-open.test.ts (32) / registry-create.test.ts (49) / registry-node-dispose.test.ts (2) / registry-entry-removal-guard.test.ts (7) / registry-surface.test.ts (10)`；`Test Files 5 passed (5)`；`Tests 100 passed (100)`；`Type Errors no errors` | **0** |
| `npx vitest run packages/namespace-registry packages/doc-runtime` | `Test Files 27 passed (27)`；`Tests 416 passed (416)`；`Type Errors no errors` | **0** |
| `npx tsc -p tsconfig.typecheck.json --noEmit` | 零输出 | **0** |
| `git diff --check cdcf28b` | 零输出（零空白错误） | **0** |

D1 定向：`npx vitest run packages/namespace-registry/test/registry-create.test.ts -t "D1 终审"`
→ `Test Files 1 passed (1)`；`Tests 1 passed | 48 skipped (49)`（getterCalls=0 断言转绿）。

## R3-3. 偏离登记：无新增

- 5 处改动全按冻结清单落地；测试零语义改动（仅 ADVISORY-4 空白折叠）；源码零行为面
  意外变化（缺失键路径经 `ownerDesc?.value` undefined 交 #110 校验，语义与原属性 GET
  逐字一致——identity 表 registry-create.test.ts:781+ 与零回显探针全部保持原 field）。
- 无 commit（总控收口）。
