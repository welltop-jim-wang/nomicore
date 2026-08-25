# 完工前独立 Spec 审查报告 — namespace-runtime Registry 专用受限生产构造 seam（issue #109）

- **审查轴**：Spec 轴（engineering/code-review 技能；只审查、未修改任何被审文件）
- **审查 diff 范围（声明）**：`git diff 3451eca..HEAD`（HEAD = `4299b90`；两 commit：`b233ea4` 实现 + `4299b90` 测试/档案）
- **Worktree**：`/home/wangjian/nomicore-fix-issue-109`（branch `fix/issue-109-on-docs-namespace-registry`）
- **规格基准**：issue #109 原文与七条 AC（`wiki/raw/task_namespace-runtime-registry-seam.md` L11–23）；已接受设计（`…_design.md`，SA2 verdict: pass）；SA2 非阻塞发现（`…_sa2_review.md`）；ADR 0009 §模块与 Cordis service 冻结句（`docs/adr/0009-….md` L18）；AC 核对表（`…_ac_checklist.md`）
- **diff 构成**：17 文件（+1725/−8）——非 wiki 7 文件 + `wiki/raw/task_*` 档案 10 文件

---

## 1. 需求实现完整性（七条 AC 逐条）

| AC | 判定 | 证据（文件/行号） |
|---|---|---|
| AC1 internal 仅导出一个 Registry 专用生产 factory | ✅ 完整 | `packages/namespace-runtime/package.json` L7–10：exports 键集恰 `[".", "./internal"]`；`src/internal.ts` L27–31：唯一值导出 `createNamespaceRuntimeForRegistry`、零类型导出；运行时键集探测锚于 `test/runtime-registry-internal-seam.test.ts`「specifier 可解析…恰一键」it |
| AC2 factory 只接收 handle + dirty notifier，不暴露 compile/fault/testing seam | ✅ 完整 | `src/internal.ts` L27–30：签名恰 `(handle: DocHandle, notifyDirty: () => Promise<void>)` 两参形——无输入对象，`p0Gate`/`compile`/fault 在类型面无处安放；委托链第三跳 `runtime.ts` L278 `createNamespaceRuntimeWithSeam({ handle, notifyDirty })` 上注入键缺席 → `compile` 缺省 `?? compileSchemaEnvelope`（`runtime.ts` L167）；类型三重判别 `test/runtime-registry-internal-type-guard.test-d.ts` 3 it + 哨兵行为锚（seam.test.ts AC2 it：compile spy 零调用、永不 resolve p0Gate 零消费） |
| AC3 主 entry 继续不导出 production constructor/DocHandle/Y.Doc/内部 state/sequencer | ✅ 完整 | `git diff 3451eca..HEAD -- packages/namespace-runtime/src/index.ts` 为空（零改动）；`grep internal src/index.ts` 零命中；存量 exports-audit 前三个 it（值导出恰一键 `RuntimeWriteFatalError`、禁导清单缺席、唯一值导出是 function）逐字未动（diff 仅 T1.4 单 hunk）；@ts-expect-error 副锚（type-guard.test-d.ts L37–39） |
| AC4 产出 Runtime 保持 P0 队首/读取/写序列器/fatal/status/close 全部现有语义 | ✅ 完整 | 纯委托 = 同一构造序代码承载（`src/internal.ts` L31 唯一语句 `return createNamespaceRuntime(handle, notifyDirty)`，无自有分支）；seam.test.ts AC4 it 全链七段（构造即读→P0 队首真实编译→FIFO notify 严格按序→status 七键/十键面→close 幂等/停接纳→跨实例落盘 n=20）；SA7 破坏探针 4 it（`test/runtime-registry-internal-sa7-dynamic.test.ts`） |
| AC5 模块边界测试证明仅 NamespaceRegistry 生产代码可消费 internal subpath | ✅ 完整 | seam.test.ts §AC5 三 it：import 图静态审计（walk `packages/domains/apps` 生产树，消费方 ⊆ 白名单）+ 白名单谓词自检（allow/deny 各例，含 `packages/namespace-runtime/src/internal.ts` deny 例防自引用绕行）+ 防空扫（`prodFiles > 0`）；白名单 = `packages/namespace-registry/src/` 前缀（前瞻空集，与简报 L56 钦定形态逐字一致）；本人独立 grep 复核：生产树零消费方（仅 internal.ts 头注注释文本命中，非 import 语句） |
| AC6 testing seam 继续位于受控测试入口，不进入主 entry | ✅ 完整 | exports 键集恰两键、禁导子路径探测（`./testing`/`./test`/`./seam`/`./internal/testing` 全 undefined，seam.test.ts AC1 it）；internal entry 零 seam/别名/运行态泄漏（同文件「零测试 seam 泄漏」it 十键点名）；@ts-expect-error 双副锚（type-guard.test-d.ts L41–47）；测试继续经 `../src/runtime.js` 包内通道消费 seam |
| AC7 全量 typecheck/test + Node 20/24 CI | ✅ 本地闭环 / ⏳ CI 腿待发布 | SA7 报告 G0–G6：frozen-lockfile、四附加门禁（persistence-contract 7/7、domains-scaffold 2/2、materialize-root 59/59、generate --check 零漂移）、`pnpm test` 96 文件 1150 用例、双 typecheck 全 exit 0（Node v24.13.0）；本人独立复跑：本包 25 文件 133 用例全绿、4 个 seam 相关文件 19/19 全绿、`Type Errors no errors`。Node 20/24 CI matrix 证据属发布后 Host 观察器职责（commit 尚未推送，环境事实），非本门禁阻断项 |

**结论：无缺失、无部分实现的 AC。** AC7 的 CI 腿处于本门禁（完工前审查）应有的状态——本地全量门禁已闭环，CI 证据待 Host 发布后产生。

## 2. Scope creep 审查

非 wiki diff 7 文件逐项对照设计 §6 ALLOW/DENY LIST：

| 文件 | 判定 |
|---|---|
| `src/internal.ts`（新建，32 行） | ✅ ALLOW LIST 内，与设计 §D-C 代码体逐字等价 |
| `package.json`（恰 2 处：version 0.1.5→0.1.6 + exports 增 `./internal`） | ✅ ALLOW LIST 内；版本 bump 属硬门禁 #9 强制，非 creep；`private: true`/dependencies 零变化 |
| `test/runtime-acceptance-exports-audit.test.ts`（仅 T1.4 单 it 演进） | ✅ 简报「已知契约演进点」预授权（L44–51）；其余三 it 逐字未动；不变量「testing seam 绝不进 package entry」保持 |
| `README.md`（1 行） | ✅ ALLOW LIST 可选项（§D-G），SA2 A12 建议保留已采纳；文本与设计逐字一致 |
| `test/runtime-registry-internal-seam.test.ts` + `…-type-guard.test-d.ts`（SA6 owned） | ✅ ALLOW LIST 内（简报 §SA6 验收锚定记录），断言逻辑与锚定映射一致，无 skip/only/弱化 |
| `test/runtime-registry-internal-sa7-dynamic.test.ts`（170 行，commit 4299b90） | ⚠️ **超出 SA1 设计 §6 ALLOW LIST**，但属管线 SA7 动态验证阶段标准产出（dispatch log #9；SA7 报告 §5 声明「生产代码零改动」），且被总控 AC 核对表引为 AC2/AC4/AC5 证据。纯测试增补、位于本包 test 目录、AC5 审计 SKIP_DIRS 豁免内、不触生产代码。判定：**管线授权的测试加固，非业务 scope creep**（观察项 O1） |
| `wiki/raw/task_*.md` ×10（简报/设计/SA2/SA4/SA7/AC/dispatch/冲突报告×2/relevant_decisions） | ✅ 简报纪律「wiki/raw/ 全部产出随代码 commit」钦定 |

DENY LIST 复核：`src/index.ts`、`src/runtime.ts`、语义层 9 文件、两 tsconfig、`vitest.config.ts`、`docs/adr/**`、`CONTEXT.md`、其余 6 包、`domains/**`——全部零 diff（diff 17 文件全部可入账）。未新建 Registry 包（切片 5/6 边界保持）；`pnpm-lock.yaml` 零改动（SA2 A9：workspace 包自身版本 bump 不入 lockfile，`--frozen-lockfile` 安全，SA7 G0 复验 exit 0）。

**结论：无业务 scope creep。**

## 3. 疑似错误行为审查（三个重点面）

### 3.1 factory 输入面 — ✅ 无缺陷

- 两参形签名与既有生产工厂 `createNamespaceRuntime`（runtime.ts L274–279）**逐字同形**，委托即恒等，无参数拆包/重组代码。
- AC2 的语言级保证成立：注入面哨兵作为第 3 位置实参传入时被 JS 调用语义天然忽略——seam 层零守卫代码，不存在「承认注入但静默丢弃」的伪降级路径（SA4 §4 复核一致）。
- `notifyDirty` 必填无缺省：SA7 探针 3 实证 `factory(handle, undefined)` 构造成立但一切写 loud 拒绝（`RUNTIME_WRITE_DISABLED` + 「notifyDirty 未绑定」）——无静默 no-op 持久化，与 ADR 0008「构造方绑定窄接缝」一致。

### 3.2 委托语义 — ✅ 无缺陷

- `src/internal.ts` L31 唯一语句 `return createNamespaceRuntime(handle, notifyDirty)`；零分支/零 catch/零 finally——构造 throw（V1 形状守卫 TypeError / V2 状态门 `HANDLE_NOT_USABLE`）同步透传，throw 前置于入队、零副作用、所有权归调用方（SA7 探针 1/2 活链路实证：throw 后同一 handle 仍可成功构造读写 close；released handle 二次构造 loud 拒绝）。
- 委托链第三跳 `{handle, notifyDirty}` 上 `p0Gate`/`compile` 缺席（runtime.ts L278）→ P0 恒走真实 `compileSchemaEnvelope`、无 gate——AC2「注入面零效果」与 AC4「真实编译」同源成立。
- leaf 模块无环：internal.ts 不 import index.ts、不被其 import（SA4 §1.2 全 src 树复核）；主 entry 加载图字节不变。

### 3.3 边界审计白名单 — ✅ 本 ticket 面无缺陷（两条前瞻加固项已正确登记）

- 白名单谓词 `packages/namespace-registry/src/` 前缀与简报 L56 钦定形态逐字一致（当前空集、前瞻放行切片 5/6）；谓词自检含 internal.ts deny 例，封堵本包自引用 specifier 绕行（设计 §D-F 规则 2 落实）。
- 审计 walk 覆盖 `packages/domains/apps` 生产树，跳过 `test/tests/__tests__/docs/wiki/node_modules` 等；防空扫断言 `prodFiles > 0` 防静默空扫。
- SA7 探针 4 实证深导入 `@nomicore/namespace-runtime/src/internal.js` 经 exports map 不可解析——被审计 specifier 是唯一通道，exports 封装反而收紧边界。
- 已知盲区（SA2 #1 LOW）：审计正则不覆盖裸副作用 `import 'spec'`、`require(...)`、非 TS 扩展名（.js/.mjs/.cjs）；SKIP_DIRS 按目录名豁免。**当前暴露面为零**（全仓无 .js/.mjs/.cjs 生产文件；消费方空集），SA2/SA4 均明确「本 ticket 不要求改，责任在切片 5/6 落地前」——登记未丢失（观察项 O3）。
- 白名单粒度（SA2 #2 LOW）：「Registry 生产代码」是否含未来 registry testing subpath 属切片 5/6 设计期显式裁决项——本 ticket 白名单前瞻空集是简报钦定形态，非遗漏。

## 4. SA2 非阻塞发现落实核对（2 LOW + 3 INFO）

| # | 严重度 | 本 ticket 是否必须处理 | 状态 |
|---|---|---|---|
| #1 AC5 审计正则盲区 | LOW | 否（SA2 原文「本 ticket 不要求改」） | ✅ 正确defer至切片 5/6；SA4 §5 以 node 探针实证盲区存在性与零暴露面 |
| #2 白名单粒度 vs「生产代码」措辞 | LOW | 否（registry 包不存在） | ✅ 正确 defer；切片 5/6 设计文档须显式裁定（要求已登记） |
| #3 SA6 helper catch-fallback 掩蔽构造 throw | INFO | 否（SA6-owned；现 11 用例构造均成功不触发） | ✅ 无需动作；后续失败路径用例编写纪律已登记（直调 factory 禁经 helper） |
| #4 版本 bump × frozen-lockfile | INFO（已闭） | — | ✅ SA2 实测闭合 + SA7 G0 复验 exit 0 |
| #5 §D-H 未覆盖 CI 四附加门禁 | INFO | 提醒 SA3 以全量 CI 为准 | ✅ 已落实：SA7 G1–G4 四门禁本地实跑全绿 |

**结论：无「本 ticket 必须处理而被遗漏」的 SA2 发现。**

## 5. 独立复验证据（本审查轮真实运行）

| # | 命令 | 结果 |
|---|---|---|
| V1 | `git log --oneline` + `git diff --stat 3451eca..HEAD` | HEAD=`4299b90`；diff 恰 17 文件（7 非 wiki + 10 wiki），+1725/−8 |
| V2 | `git diff 3451eca..HEAD -- src/index.ts src/runtime.ts` + `grep internal src/index.ts` | 双双零 diff / 零命中——主 entry 与构造序实现字节未动 |
| V3 | `sed -n` 读 `runtime.ts` L130–180/L270–290 | 委托目标签名两参形同形（L274–279）；`compile ?? compileSchemaEnvelope`（L167）；第三跳 `{handle, notifyDirty}` 注入键缺席 |
| V4 | `grep -rn "namespace-runtime/internal" --include='*.ts' packages domains apps` | 生产树零 import 消费方（仅 internal.ts 头注注释 + 3 个 test 目录文件） |
| V5 | `npx vitest run packages/namespace-runtime/test/` | 25 文件 133 用例全绿，`Type Errors no errors`，exit 0 |
| V6 | `npx vitest run` 4 个 seam 相关文件（seam/type-guard/sa7-dynamic/exports-audit） | 4 文件 19 用例全绿（含 T1.4 演进后键集断言），exit 0 |
| V7 | `cat package.json` | version `0.1.6`、exports 恰 `[".", "./internal"]`、`private: true`、dependencies 零变化 |

## 6. 观察项（全部非阻塞）

- **O1（INFO）**：`runtime-registry-internal-sa7-dynamic.test.ts` 超出 SA1 设计 §6 ALLOW LIST——属管线 SA7 阶段标准产出并被 AC 核对表收编为证据，纯测试增补、生产零改动。建议后续设计文档的 ALLOW LIST 为 SA7 动态补充测试预留显式位，消除形式差异。
- **O2（INFO）**：AC7 的 Node 20/24 CI matrix 证据待 Host 发布后由观察器采集（commit 未推送为环境事实）；本地 Node 24 腿全量门禁已闭环，符合本门禁预期状态。
- **O3（前瞻，切片 5/6）**：SA2 #1/#2 两条 LOW（审计正则盲区加固、registry testing subpath 白名单粒度裁定）责任在切片 5/6 落地前，本报告复述以防丢失。
- **O4（INFO）**：SA2 #3（SA6 helper catch-fallback 掩蔽）为未来失败路径用例编写纪律项，现无影响。

## 7. 结论

七条 AC 全部完整实现（AC7 CI 腿按职责边界移交 Host），无缺失/部分实现；无业务 scope creep（SA7 测试增补为管线授权）；factory 输入面、委托语义、边界审计白名单三重点面均无缺陷；SA2 全部非阻塞发现无遗漏落实。

**Verdict: pass**
