# SA4 静态验尸报告 — domains/vfs3-assets 领域包 dogfood（issue #27，票 G）

**Date**: 2026-08-21
**Verdict**: **pass**
**审验对象**: commit `7c49901`（8 文件）+ SA6 已 staged 接线/测试文件（domains 三测试、pnpm-workspace.yaml、vitest.config.ts、tsconfig.typecheck.json）
**审核方式**: 全文静态验尸 + 关键承重断言**独立复跑**（非转述总控结论）：双 sha256 oracle 复算、fixture 逐字 diff、worktree 全量套件 452/452 复跑、`generate --check` exit 0 复跑、干净阴性对照 /tmp/wt-c 全量复跑（4 文件 / 32 失败红墙复现）。

---

## 审核结论

1. **设计一致性**：✅ 一致（逐字级，含 §4.4 三处 diff、附录 A/B 双 oracle、§3.4/§3.6 逐字吻合）
2. **读写路径一致性**：✅ 一致（schema.vfsl → generate → generated.ts 同原子提交入仓；CI regen-diff 读同一对；头注哈希互绑实核）
3. **静默失败**：✅ 无新增；修复**移除**两条既存静默假型路径（根位 `{}` 坍缩 / 嵌套位 PathSchema 树透传）；零领域 exit 2 响亮失败语义保留（cli.ts 本体零改动实核）
4. **降级方案**：✅ 安全（CLI `--allow-empty-domains` 本体保留 = 设计在案的本地逃生门，CI 不再使用——非掩蔽型降级）
5. **极端攻击**：✅ 未新发漏洞（fail-closed 方向静态推理 + SA2 16 断言探针 + 阴性对照红墙三重佐证）
6. **错误处理**：✅ 完整（编译期 fail-closed + CLI 退出码 0/1/2 + CI 门禁三层）
7. **架构评估**：✅ 可行，无退回 SA1 信号
8. **过度设计**：✅ 精简（协议净改动 3 行 + 注释；领域包四件为 ADR 0005 §5 最小形态）

---

## 必查项逐条

### 1. 设计偏差与 oracle 复算 ✅

**§4.4 逐字一致性**：commit 对 `packages/vfsl-protocol/src/index.ts` 的改动 = 恰好三处（:27 MemberKeys / :63-65 VfslValueOf / :88-90 PathPatchUnwrap），与 §4.4 diff **逐字吻合**（含注释块重写——SA2 LOW③ 提示的 scratch 注释未应用问题，在正式 commit 中已按散文描述正确应用，注释同指「见 MemberKeys 注」）。`PathElementValue`（:97 `Record<infer _Idx, infer ElementNode>`）保持原样，符合 §4.3 末段最小 diff 纪律。

**双 sha256 oracle 复算**（SA4 独立执行）：
- `domains/vfs3-assets/schema.vfsl` = `82e98fa1546b9548f32795dd51e9212eaf35e4731939a1c4db5c8f3b03b93c69` ✓（附录 A 钉死值逐字吻合）
- `domains/vfs3-assets/generated.ts` = `fbe181f3f67bf64c0aad30ff6ce6df689f849fea26d88b48026f49ace9c365ea` ✓（附录 B 钉死值逐字吻合）
- **fixture 逐字**：`docs/vfsl/v1-spec.md` §10 代码块 awk 抽取 vs schema.vfsl 去头部四行 → `diff` 零差异（各 29 行，FIXTURE-VERBATIM-OK）
- **头注哈希互绑**：generated.ts 头注 `Source hash: sha256:82e98fa1…93c69` == schema.vfsl 实测哈希 ✓；`Generator: @nomicore/vfsl-codegen@0.1.1` 与 codegen 未 bump 一致 ✓

**DENY LIST 零触碰**：commit 8 文件 = `.github/workflows/ci.yml`、`domains/vfs3-assets/{schema.vfsl,generated.ts,index.ts,package.json}`、`packages/vfsl-protocol/{src/index.ts,package.json}`、`pnpm-lock.yaml`——全部在 §11 ALLOW LIST 内；`packages/vfsl-protocol/test/**`、`packages/vfsl-codegen/**`、`packages/vfsl/**`、`docs/**`、两份 §10 逐字副本测试零触碰（diff 实证）。staged 区 = SA6 owned 三测试文件（DENY 语义为「他 SA 不动」，SA6 自建合法）+ SA6 接线三件（设计 §3.7 明文在案）+ wiki 档案（白名单豁免）。**Scope creep：无。BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/.bak）：零命中。**

**其余逐字核对**：index.ts == §3.3 一行 `export * from './generated.js'` ✓；package.json == §3.4 内容逐项一致（name/version 0.1.0/private/type/exports/四 devDeps）✓；ci.yml 两处编辑 == §3.6（删 TODO(#27)×2、删 flag、注释改写为「零领域集 = 响亮失败（exit 2，cli.ts §5.5）」）✓；lockfile 新增 `domains/vfs3-assets` importer 且四 devDeps 解析正确（link:../../packages/vfsl、link:../../packages/vfsl-protocol、typescript 5.9.3、vitest 3.2.7）✓。

### 2. 版本 bump 检查（硬门禁 9）✅

- `packages/vfsl-protocol`：0.1.0 → **0.1.1** ✓（D2 类型内部修复 = patch，导出面无增删改）
- `packages/vfsl-codegen`：**不动**（0.1.1）✓——commit 未触碰 codegen 任何文件，generated.ts 头注版本稳定
- `packages/vfsl`、根 `nomicore`：不动 ✓
- `domains/vfs3-assets`（新）：0.1.0 初始 ✓（非 bump）
- 全 diff 中 package.json 改动仅上述两处，**无漏 bump**

### 3. 1.4 vitest 触发性自检 ✅ —— 结论：**all-vitest-packages-triggered**

- 本任务新增 `*.test.ts` × 1（`vfs3-assets-tsdoc.test.ts`）+ `*.test-d.ts` × 2（projection / migration），均在 `domains/vfs3-assets/test/`。
- **include 覆盖**（staged diff 摘录）：`vitest.config.ts` — `include: ['packages/*/test/**/*.test.ts', 'domains/*/test/**/*.test.ts']`、`typecheck.include: ['packages/*/test/**/*.test-d.ts', 'domains/*/test/**/*.test-d.ts']`——两族 glob 均覆盖 `domains/*/test/**` ✓。
- **CI 真跑证据**：`.github/workflows/ci.yml:39` `run: pnpm test` → 根 package.json `"test": "vitest run --typecheck"` → 单根 vitest.config 全仓扫描，无 `--filter` 分包盲区。SA4 独立复跑 `pnpm test`：`Test Files 30 passed (30) / Tests 452 passed (452) / Type Errors no errors`（exit 0），30 文件含领域三文件（31 tests）——**静态接线 + 动态运行双重在场**。
- 配套：`tsconfig.typecheck.json` include + `domains/*/*.ts`、`domains/*/test/**/*.ts` ✓（typecheck program 覆盖领域包源码与测试）；`pnpm-workspace.yaml` + `domains/*` ✓。
- **1.3 E2E spec 自检：不适用**——本任务无 `*.spec.ts`。

### 4. 协议假设审查（1.5）✅

设计 §12 章节存在，10 条假设依据栏全部为「设计期实测 + 附录 C 编号」或文档/源码引用，无「应该/通常/预计」裸推断。SA4 抽出承重实测项**独立复跑**：

| 假设 | SA4 复跑结果 |
|---|---|
| 修复后全套件 452/452 绿（C.4） | worktree `pnpm test` → **30 文件 / 452 passed / Type Errors no errors / exit 0** ✓ |
| 种包后 `generate --check`（无 flag）exit 0（C.4） | worktree 实测 **exit 0** ✓ |
| 未修协议 + 种包 = 真红·测试鉴别力（C.5） | /tmp/wt-c（干净阴性对照，未修协议 Record-infer 三位点在案 + 种包 schema 哈希吻合）全量 `pnpm test` → **exit 1，4 文件失败 / 32 failed / 420 passed** ✓ 红墙 = `domains/vfs3-assets/test/{migration,projection}.test-d.ts` + `packages/vfsl-protocol/test/vfsl-protocol-projection.test-d.ts` + `packages/vfsl-codegen/test/generate-discriminated-narrow.test-d.ts`（增广泄漏入统一 typecheck program 的免费守门，与 SA2 验证日志 #5 逐点吻合） |
| 零领域无 flag → exit 2（SA6 在案 + cli.ts:63-70 源码） | cli.ts 零改动实核（见必查项 5），exit-2 守卫逐字在场 ✓ |

**SA2 LOW② 处置**：遵从「/tmp/wt-b 已被污染勿复用」，改用 /tmp/wt-c 干净对照。复跑读数 = SA2 的 **4 文件 / 32 失败**，而非 SA1 附录 C.5 所述「领域三文件 7 个类型错误」——证实 C.5 计数不可复现（LOW，非阻塞，实质结论「测试鉴别修复」成立且更强：红墙比设计所述更广）。建议 SA1 后续修订顺手订正 C.5 措辞（沿 SA2 建议，不阻塞本票）。

### 5. 静默失败/降级风险 ✅

- **零领域响亮失败保留**：`git show 7c49901 --name-only` 不含 cli.ts（flag 本体未动，符合 DENY 切割「CI 不再使用 ≠ 删除逃生门」）；`cli.ts:63-70` 实核——`outputs.length === 0` 且无 flag → stderr 响亮消息 + `return 2` 逐字在场。摘旗后 CI 的「domains/ 被误删/改名 → 回归掩蔽」防护语义完整。
- **generated.ts 头注哈希互绑**：`Source hash` == schema.vfsl 实测 sha256（必查项 1 已证）——源漂移由 regen-diff 全量重生成 diff 双抓（非纯哈希比对的假守门）。
- **fail-closed 方向不变**（静态推理）：`MemberKeys = V extends unknown ? keyof V : never`——未知键不属 `keyof` → Step 拒绝 → UnknownPath；空表 `keyof {}` = never ≡ 原坍缩结果；`V extends object` 守卫对 `undefined`（可选成员查找合法产物）透传，对标量 garbage-in 上游由 desync 守卫拦截。empty-fail-closed 套件在 452/452 复跑中绿 ✓。
- **修复移除既有静默假型**：根位 `{}` 坍缩与嵌套位 PathSchema 树透传（SA2 攻击点 6 实核的 fail-open 假型）一并根除——本修复是静默面**净减**。

### 6. SA2 MEDIUM#1 知悉确认 ✅（守门链真实在场）

按设计 D3(a)「空转 + 守门」，实核实现中守门链：

1. **别名臂非空转**：`vfs3-assets-tsdoc.test.ts:141` — `expect(checked.length, …).toBeGreaterThanOrEqual(5)`，且断言本体是 **tsc parser jsDoc AST 挂载**（`ts.createSourceFile` + `attachedJsDocText`，:129-138），非文本正则——防空转断言自身不可空转（checked 计数驱动）✓。
2. **字段臂非空转**：:183 — `toBeGreaterThanOrEqual(1)`，同为 AST 挂载断言；解析器遇新锚位形态 `throw` 响亮失败要求扩展（:160/165/171/174），不静默跳过 ✓。
3. **标记臂空转但非裸空转**：:186-196 — fixture 驱动循环（`derived.markerDocs` 非空条目逐字 `toContain`），fixture 携带标记位 JSDoc 即自动实质化（SA2 验证日志 #6 已实测激活路径）；emitter 侧 `packages/vfsl-codegen/src/emitter.ts:231` `tsdocLines(tables.markerDocs[path], '')` 行内发射位在场（codegen 零改动，DENY 合规）。
4. **残余缺口如实记录**：emitter 标记位行内发射在全仓 452 测试中**无非空转覆盖**（SA2 MEDIUM#1 本体）——本票内按设计 (a) 不闭环，依赖规格轴 follow-up（§10 fixture 标记位补 JSDoc + 两份逐字副本同步 + 标记臂升级位置感知断言 + 防空转守门）。**SA2 放行条件 = 总控合并前登记该 follow-up**——此项为流程性放行条件，移交总控/SA7 终态确认（见动态审核重点 #5），不构成本 SA4 静态验尸的 REJECT 事由。

### 7. 契约改动连锁审查（1.6）✅

- 改动为**纯类型级**（协议包纯类型模块，empty-module 测试绿）；commit diff 中 `throw`/`return` 运行时契约变化 grep 计数 = **0**——§1.6 触发条件中的运行时契约改动不存在。
- 类型消费者 caller 抓全（SA4 独立 grep `VfslValueOf|PathPatchValue|PathPatchUnwrap|MemberKeys` over packages/apps/domains）：协议包外源码命中仅 `protocol-surface.ts:14-15`（12 名冻结名单登记，非调用）；其余命中为测试文件（被测对象本身）。
- **导出面 12 名冻结名单无增删**：`packages/vfsl-protocol/src/index.ts` 实核导出 = VfslKind/PathSchema/UnknownPath/RootSchema/PathAt/VfslValueOf/PathValue/PathKind/PathPatchValue/PathElementValue/VfslTypedAccess/VfslPathMap —— 与 `PROTOCOL_EXPORT_NAMES` 集合逐一吻合 ✓。
- 爆炸半径 = 编译期：任何漏网不兼容以 tsc/vitest typecheck 红灯 fail-closed 当场暴露（452/452 + Type Errors no errors 复跑实证无漏网）。

### 8. 源码 GREP 断言禁令（1.7）✅（豁免条款 3 适用，已注明）

- 两 test-d 文件：零 `readFileSync`，全部 `expectTypeOf` / `@ts-expect-error` 类型行为断言 ✓。
- tsdoc 测试：`readFileSync` 三处，但**别名/字段两臂主锚 = tsc parser AST jsDoc 挂载断言**（语义层「挂在哪个声明上」，非对源码字符串正则/toMatch）；仅**标记臂**用全文 `toContain`——该臂本票内空转（D3(a) 裁决），且契约锚（emitter 行内发射）的实质覆盖已路由 follow-up（必查项 6）。属 §1.7.3 豁免：「源码文本断言仅为空转臂的辅助形态，主契约锚为 AST 行为断言」。注明：follow-up 落地时标记臂须升级为位置感知断言（SA2 红线思路 1）。

---

## REJECT 清单

**无。**

## 动态审核重点（交 SA7）

1. **CI regen-diff 实证**：PR run 中 `Generated projection freshness (regen-diff)` 步骤（已无 flag）exit 0——从 `gh run view --log` 摘录步骤名与退出证据；同时确认 `Domain scaffolds check` 步骤由 vacuous pass 转实质（domains-scaffold.test.ts 2 tests 真跑真绿）。
2. **vitest 触发证据（1.4 动态确认）**：CI `pnpm test` 日志中摘录领域三文件（`vfs3-assets-{projection,migration}.test-d.ts`、`vfs3-assets-tsdoc.test.ts`）运行计数（31 tests），确认非「存在但未触发」。
3. **frozen-lockfile 实证**：CI `pnpm install --frozen-lockfile` 通过（lockfile 含 `domains/vfs3-assets` importer），摘录日志。
4. **回归掩蔽防护反向探针（可选，scratch 环境）**：临时改名/清空 `domains/` 后 `pnpm generate --check` 应 exit 2——验证摘旗后零领域响亮失败在 CI 语义下成立（SA2 已在仓内实测过当前态，SA7 可择情复验）。
5. **SA2 放行条件闭环**：确认总控已登记规格轴 follow-up issue（§10 fixture 标记位补 JSDoc + `vfsl-assets-fullchain-e2e.test.ts`(#32)/`validate-snapshot.test.ts`(#21) 两份逐字副本同步 + 标记臂升级位置感知断言 + 防空转守门 checked≥1）——合并前须有登记号，防 AC5 标记锚 emitter 侧证据缺口无限期悬空（SA2 MEDIUM#1）。
6. **证据卫生存档**：SA1 附录 C.5「7 个类型错误」计数不可复现（正确读数 4 文件/32 失败，SA4 已用 /tmp/wt-c 复核）；/tmp/wt-b 已被陈旧 install 污染，后续任何复核勿用。C.5 措辞订正留后续票（LOW）。

---

## 结论

commit 7c49901 与设计 §4.4/§3/§3.6 逐字一致，双 sha256 oracle 与头注哈希互绑机器复核吻合，DENY LIST 零触碰、BLACKLIST 零命中、硬门禁 9 bump 无漏；1.4 vitest 触发性自检 = **all-vitest-packages-triggered**（静态接线 + SA4 独立 452/452 复跑双重在场）；协议假设全部经独立复跑兑现（含干净阴性对照 4/32 红墙复现）；零领域 exit 2 响亮失败语义随 cli.ts 零改动完整保留；SA2 MEDIUM#1 守门链在实现中真实在场（别名 ≥5 / 字段 ≥1 防空转断言 + 标记臂 fixture 驱动），残余 emitter 侧缺口按设计 (a) 路由规格轴 follow-up。**Verdict: pass**，SA7 可按上列六条动态审核重点进入运行时验证。
