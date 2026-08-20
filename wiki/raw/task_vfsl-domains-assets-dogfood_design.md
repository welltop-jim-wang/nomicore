# SA1 防御性架构设计 — domains/vfs3-assets 领域包 dogfood（issue #27，票 G）

- 任务类型：功能开发（Feature）· 阶段：第二阶段 设计（R1 初版）
- Worktree：`/home/wangjian/nomicore-fix-issue-27` · base：`adr/vfsl-protocol` · run_id：issue-27-1787257582-2987666
- 输入：任务简报 `wiki/raw/task_vfsl-domains-assets-dogfood.md`（含 SA6 红灯记录）、`..._relevant_decisions.md`（ADR 约束基准）、冲突门禁报告（clear）、SA6 三红灯测试文件（`domains/vfs3-assets/test/`，已锚定、真红 TS2307）
- **设计期实测声明**：本设计全部关键类型级/命令级断言均在设计期真实执行验证（scratch 副本 `/tmp/wt-a`、探针 `/tmp/vfsl-probe/`），命令与输出摘要见附录 C。无「应该会」式假设。

## 决策速览（TL;DR）

| # | 裁决点 | 选择 | 一句话理由 |
|---|---|---|---|
| D1 | 领域包种植 | schema.vfsl = 头部三键 + §10 fixture 逐字；`pnpm generate` 产出 generated.ts 入仓；index.ts `export *`；package.json 纯类型；ci.yml 摘 flag + 清两处 TODO(#27)；单原子提交 | ADR 0005 §4/§5 直接兑现；全链已在 scratch 实测 452/452 绿 |
| D2 | 🔴 可选成员坍缩修复选型 | **候选 A：修协议包**（MemberKeys 改 distributive `keyof`，VfslValueOf/PathPatchUnwrap 同步修同族推断位） | 根因修复；零触碰 F2 生成器冻结契约与既有测试；实测 452/452 绿 + 阴性对照真红 |
| D3 | AC5 标记位证据缺口 | **(a) schema.vfsl 保持 §10 逐字**，标记臂空转（逻辑在场、fixture 驱动自动激活），缺口显式记录并路由规格轴 follow-up；附 (b) 精确回退 diff 备总控一句话推翻 | 单一真相源纪律（ADR 0001）优先；验收锚（SA6 测试）在 (a) 下全绿；跨票 churn 不成比例 |
| D4 | id/目录名张力 | **`@id: vfs3-assets@1`** | F2 collect.ts 不变式（idBase==目录名）是代码冻结的响亮失败；ADR 0005 §2 样例 id 是格式示例非冻结值 |
| D5 | 版本 bump | `packages/vfsl-protocol` 0.1.0 → **0.1.1**；其余包不动；新领域包 0.1.0 初始 | 硬门禁 9：只 bump 被改动的包；codegen 不动 → generated.ts 头注版本不变 |

---

## §1. 任务识别与约束基线

本任务 = ADR 0005 后果所列票 G：种植首个领域包 `domains/vfs3-assets`，把 F2 生成管线（SchemaSource → parse/evaluate → 纯发射器 → 入仓生成物 → CI regen-diff）端到端 dogfood 一遍。五条 AC 已由 SA6 锚定为三测试文件（两 typecheck 一 runtime），当前真红（包不存在 TS2307）。

约束基线（逐条实读核实，非转述）：

1. **ADR 0005 §2**：头部三键（`@lang`/`@id`/`@version`）全部必需；`text` = 整个文件原文（含头部）——行注释是词法 trivia，`parseVfsl` 直接可解析（schemasource.ts 文件头明文，实测成立）。
2. **ADR 0005 §4**：生成物入仓、头注 `GENERATED … DO NOT EDIT` + 源哈希；CI `generate --check` 全量重生成 diff 双抓；**schema 改动与重新生成同一原子提交**。
3. **ADR 0005 §5**：`domains/` = 业务 schema 包（schema.vfsl + generated.ts + 挂载点 + dogfood 测试）；按可独立发布标准组织。
4. **ADR 0004 D1–D5**：投影机制（Record 通配层 / D2 诚实宽度 / D3 fail-closed / D4 测试装置 / D5 顶层键=ROOT 字段）。
5. **ADR 0001 修订节**：脚手架纪律——一切消费方经 SchemaSource 接缝（本任务的 tsdoc 测试与 CI 校验均已是经接缝消费，设计无需新增消费方）。
6. **F2 collect.ts 不变式**（`packages/vfsl-codegen/src/collect.ts:86-101`）：`idBase == 目录名`，违者 `pnpm generate` 响亮 exit 2——代码冻结，不是文档约定。
7. **F2 发射契约**（`wiki/raw/task_vfsl-codegen_design.md` §3.2 规则 1 + §3.5）：可选性以**键后 `?`** 表达，权威源 = 结构侧 `MapField.optional`；既有验收测试 `generate-mapping-table.test.ts:180-203` 断言 `title?:` / `meta?:` 形态——**这是 D2 选型的关键对照事实**。
8. **CI 现状**（`.github/workflows/ci.yml`）：regen-diff 步骤带 `--allow-empty-domains`（F2 阶段门）+ 两处 TODO(#27) 注记（line 43、53）；`Domain scaffolds check` 步骤已由 #25 落地（空集 pass+notice → 种包后自然实质化）。

## §2. 需求推演（Feature 切入点）

五条 AC 的最小充分切入面：

| AC | 切入面 | 归属 |
|----|--------|------|
| AC1 包结构五件 + 纯类型 | 新建 `domains/vfs3-assets/` 四件（schema.vfsl / generated.ts / index.ts / package.json；test/ 已由 SA6 落地） | SA3 |
| AC2 §8.4 正负例（真实 fixture 类型表） | 生成类型表 + 增广挂载 + **协议缺陷修复（D2，编译前提）** | SA3 |
| AC3 §8.5 迁移演示 | 同上（MigratedPathMap 为测试内手写表，不依赖生成器重跑） | 无需动作（测试自含） |
| AC4 CI regen-diff 覆盖 + 摘 flag | ci.yml 编辑 + lockfile 更新 + 原子提交纪律 | SA3 |
| AC5 docs 三锚位 TSDoc | generated.ts 的 TSDoc 发射（生成器既有能力）+ fixture 数据（D3 裁决） | SA3 + 本设计裁决 |

**编译前提链**：fixture 必含 `notes?`（§10 原文）→ 增广表含可选成员 → 未修协议下 MemberKeys 坍缩 → 全表 fail-closed → AC2 三文件无法转绿。故 D2 是 AC2 的前置（总控已裁决纳入本任务，#45 N1/N2「编译前提前移」先例）。

## §3. D1 — 领域包种植方案

### §3.1 `domains/vfs3-assets/schema.vfsl`（新建）

组合 = **头部三键 + 空行 + 规格 §10 修订版 fixture 逐字**（`docs/vfsl/v1-spec.md` line 497-525 代码块内容，含其首行 `/** vfs3.assets — … */` 块注释——它是 fixture 本体的一部分，不是头部指令）：

```vfsl
// @lang: vfsl
// @id: vfs3-assets@1
// @version: 1

<§10 fixture 逐字（附录 A 钉死全文与 sha256）>
```

钉死项与依据：

- **头部在前**：`parseHeaderDirectives` 只在前导 trivia 区识别指令（schemasource.ts §3.1）；三键行注释置于文件首三行即在最前导区，fixture 首行的 `/** … */` 块注释与空行均为合法 trivia，不干扰解析（实测：`FileSchemaSource.list()` 正确返回 `vfs3-assets@1`）。
- **id = `vfs3-assets@1`**：见 §7（D4）。
- **fixture 逐字、零增补**：见 §4/§6（D2 保持 `?:` 发射形态故无需为缺陷让步；D3 裁决 (a) 不为标记位补 doc）。
- **防漂移 oracle**：附录 A 给出钉死全文 + `sha256:82e98fa1…93c69`；generated.ts 头注哈希与之绑定（附录 B），SA3 产出逐字节比对、SA4 可机器复核。

### §3.2 `domains/vfs3-assets/generated.ts`（新建，`pnpm generate` 产出入仓）

- 生成路径：`pnpm generate`（根 script → `tsx packages/vfsl-codegen/src/cli.ts`）→ FileSchemaSource 扫描 → 方言断言 → parse/evaluate → 纯发射 → 写 `domains/vfs3-assets/generated.ts`（collect.ts 由 idBase 推导 outPath）。
- **入仓内容实测预知**（附录 B 全文 + `sha256:fbe181f3…65ea`）：头注 `Generator: @nomicore/vfsl-codegen@0.1.1`（D5：codegen 不 bump，头注稳定）；段② 全量别名 export（AssetId→string、Audit 对象字面量、AssetEntity 判别联合、Attachments→string[]）；段③ VfslPathMap 增广（顶层键=ROOT 字段，D5），其中：
  - `assets: PathSchema<Record<string, PathSchema<AssetEntity, 'map'>>, 'map'>`（Pattern 键 → string；ref → 别名引用）
  - `attachments: PathSchema<Attachments, 'plain'>`（规则 0 值侧 ref 优先 → 别名引用；plain 终态）
  - `audit: PathSchema<Audit, 'map'>`
  - `notes?: PathSchema<string, 'leaf'>`（**D2 选型 A 下保持键后 `?`**——F2 §3.5 契约不变）
  - `keywords: PathSchema<Record<`\`${number}\`, PathSchema<string, 'leaf'>>, 'array'>`（裸 T[] 默认物化 Y.Array，勿误判 plain——SA6 钉死项 3 一致）
  - 三锚位 TSDoc：别名位 5 组全挂（fixture 首行块注释与 AssetId doc 连续同挂 AssetId——与 `parse-vfsl-jsdoc.test.ts` 文件头「§10 挂载样本：AssetId 两条连续 doc 同挂一节点」预期一致，实测生成物如是）；字段位 `ROOT.notes` 的 `@semantic` 挂增广接口成员；标记位空（D3）。
- ADR 0005 §4 原子纪律：schema.vfsl 与 generated.ts 与 ci.yml 改动同一提交（冲突报告补充观察 2 亦要求 flag 移除与首领域同票）。

### §3.3 `domains/vfs3-assets/index.ts`（新建，增广挂载点）

```ts
export * from './generated.js';
```

- 类型空间再导出 + 经 import 链把 `declare module '@nomicore/vfsl-protocol'` 增广带入编译程序（ADR 0005 §5「挂载点」；SA6 实测最小形态，本设计 scratch 复测同形态全绿）。
- 运行时为空模块（generated.ts 纯类型）→ AC1「纯类型包」断言（`Object.keys(await import(pkg))` = []）成立（实测绿）。
- 逐字与该形态保持一致是接缝：测试仅依赖包名与导出面，不依赖 index.ts 内部写法——但任何等价改写（如显式 `export type {…}` 枚举）都增加维护面，不采纳。

### §3.4 `domains/vfs3-assets/package.json`（新建，纯类型）

SA6 实测验证过的最小形态 + 初始版本号：

```json
{
  "name": "@nomicore/vfs3-assets",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.ts" },
  "devDependencies": {
    "@nomicore/vfsl": "workspace:*",
    "@nomicore/vfsl-protocol": "workspace:*",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4"
  }
}
```

- `@nomicore/vfsl` 依赖是真实的：tsdoc 测试 import FileSchemaSource/parseVfsl/evaluate/assertVfslDialect；`typescript` 供 tsc parser API（ts.createSourceFile）；`vitest` 供 describe/expectTypeOf。
- **无 tsconfig.json**：领域包由根 `tsconfig.typecheck.json`（vitest typecheck）覆盖，`pnpm typecheck` 只扫 packages/*——scratch 实测无 tsconfig 全绿，不增设。
- **无 build/main/types 等发布字段**：私有纯类型脚手架（ADR 0005 §5「阶段态与生成器同仓」），exports 直指 .ts 源（packages/vfsl-protocol 同款先例）。

### §3.5 `pnpm-lock.yaml`（修改）

新增 workspace 包后必须 `pnpm install` 更新 lockfile（CI `pnpm install --frozen-lockfile` 前提）。实测 lockfile 新增 `domains/vfs3-assets` importer（四个 devDeps 链接/版本解析正确）。

### §3.6 `.github/workflows/ci.yml`（修改，AC4）

两处编辑，其余不动：

1. `Domain scaffolds check` 步骤：删 line 43 的 TODO(#27) 注记行（步骤由 vacuous pass 转实质校验——domain-scaffold.test.ts 的 list→load→parse 链对种包后的领域自动实质化，无需步骤本体改动）；保留 AC5 依据注释。
2. regen-diff 步骤：删 line 50-53 的阶段门注释与 TODO(#27)，`run:` 改为 `pnpm generate --check`；注释改写为现状语义：

```yaml
      # AC5（ADR 0005）：全领域脚手架解析 + 信封校验——显式步骤使校验在工作流文件里
      # 评审可见；--passWithNoTests=false 防测试文件被删后静默假绿（vitest.config 默认 true）。
      - name: Domain scaffolds check
        run: pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts --passWithNoTests=false

      # AC4（ADR 0005 §4）：全量重新生成 → 与仓内生成物逐字节 diff。
      # 源漂移（schema 改了没重新生成）与生成器漂移（codegen 逻辑变了）双抓——
      # 纯哈希比对抓不到后者，故必须全量重生成再 diff。
      # 零领域集 = 响亮失败（exit 2，cli.ts §5.5）：防 domains/ 被误删/改名后的回归掩蔽。
      - name: Generated projection freshness (regen-diff)
        run: pnpm generate --check
```

- **CLI 的 `--allow-empty-domains` flag 本体保留**（cli.ts 不动）：它是合法的本地逃生门；AC 要求的是 CI 不再使用它。
- 摘 flag 后的行为迁移已有实测锚：SA6 记录 `pnpm generate --check`（无 flag）在零领域时 exit 2 响亮失败；本设计 scratch 实测种包后 exit 0（附录 C）。

### §3.7 SA6 已接线、本任务零改动

`pnpm-workspace.yaml`（+`domains/*`）、`vitest.config.ts`（两族 glob）、`tsconfig.typecheck.json`（+domains include）——SA6 已完成且 git status 在案，设计确认充分（scratch 全链验证覆盖），不重复改动。

## §4. D2 — 🔴 协议级缺陷修复选型（核心决策）

### §4.1 缺陷机理（设计期实测定位，非转述）

`packages/vfsl-protocol/src/index.ts` 中三处 `V extends Record<infer Key, unknown>` 同态映射推断：

| 位点 | 行 | 作用 |
|------|----|------|
| `MemberKeys<V>` | :27 | Step 的键空间并集（`Seg extends MemberKeys<V>`） |
| `VfslValueOf` 内联 | :63-65 | 整值投影递归展开 map/array 子树 |
| `PathPatchUnwrap` 内联 | :88-90 | 写投影递归展开 map/array 子树 |

**实测机理**（探针 probe2，tsconfig.base 严格配置 + exactOptionalPropertyTypes，typescript 5.9.3）：`Record<infer Key, unknown>` 对**含任一可选成员**的对象类型（接口 / 对象字面量 / `{} &` 交叉，三形态同）推断 Key → **never**（全必填时正常推断为键并集）。后果：

- `MemberKeys` 坍缩 → Step 全拒 → **一切路径（含无关字段）UnknownPath**——SA6 报告的全表 fail-closed（probe1 基线复现：`{} &` 交叉与直用 VfslPathMap 两形态均坍缩，三条断言全败）。
- `VfslValueOf`/`PathPatchUnwrap` 坍缩方向**更坏**：Key=never → 映射类型产出 `{}`——整 map 值读/写**静默得到空对象类型**（fail-open 假型，非 fail-closed）。例：修复前 `PathValue<PathAt<VfslPathMap, []>>`（含 `notes?` 的表）= `{}`。

TS 版本敏感性声明：该推断行为是 TS 版本相关实现细节；仓内 typescript 锁 5.9.3（lockfile 实测），全部探针与套件均在该版本执行；未来 TS bump 由全量套件 + CI 兜底。

### §4.2 候选形态

- **候选 A（修协议）**：`MemberKeys<V> = V extends unknown ? keyof V : never;`（distributive keyof，保持 D2 联合键空间并集语义——对联合 V 逐成员分发后取 keyof 再并集）；`VfslValueOf`/`PathPatchUnwrap` 的同族推断位同步改为 `V extends object ? { [K2 in keyof V]: … } : V`（同态 keyof 映射，保留可选/readonly 修饰符）。生成器零改动，`notes?:` 发射形态不变。
- **候选 B（修生成器）**：emitter 把可选成员发射为「必填 + `| undefined`」（`notes: PathSchema<string,'leaf'> | undefined;`），协议包零改动。SA6 已实测该形态下 452/452 绿，测试断言对两形态兼容。

### §4.3 选型：**候选 A**。论证四面：

1. **根因与覆盖完整性**：坍缩是协议内部对「可选成员」这一 v1 方言一等特性（F2 R3 措辞）的推断脆弱；任何 map 位（ROOT 字段、嵌套封闭 map、别名引用目标、联合成员）出现 `?:` 都会触发，且 `VfslValueOf` 位是**静默假型**（`{}`），比 fail-closed 更危险。A 在三处位点一并根除（含 silent-`{}`）；B 只保证「生成物永不携带 `?:`」，协议缺陷原样潜伏（手写增广、测试内手写表、未来任何直写场景仍雷）。
2. **对 ADR 0004 D3 fail-closed 语义**：A 不改变失败方向——未知键仍 `keyof` 不属 → never → UnknownPath；空表 `keyof {}` = never → fail-closed 原样（empty-fail-closed 测试实测绿）。被移除的是**过度失败**（已声明的可选成员连坐全表），恰是 D2/D3 本意的恢复：D3 管「未声明路径」、D2 管「已声明成员的诚实宽度」。B 同样恢复该语义但靠绕开触发条件。
3. **对既有 packages/vfsl-protocol/test 套件**：A 实测 452/452 全绿（附录 C 命令与输出），三协议测试文件（projection 矩阵 / empty-fail-closed / empty-module）零改动通过；B 对协议套件同样无损（不动协议）。此项两者持平，但 A 的证据是本设计自有一手实测（含阴性对照：未修协议 + 种包 → 领域三文件 7 个类型错误真红，证明测试确实鉴别修复）。
4. **对生成器契约**：A 零触碰——F2 §3.5「可选性以键后 `?` 表达」冻结契约不变，`generate-mapping-table.test.ts:180-203`（F2 交付的验收断言 `title?:`/`meta?:` 形态）零改动，codegen 不 bump → generated.ts 头注版本稳定。B 须翻转该冻结契约并改写 F2 验收测试（跨票改动既有验收锚），生成物形态变为非惯用的 `| undefined` 必填成员。

**代价披露（A 的已知行为变化）**：`VfslValueOf`/`PathPatchUnwrap` 改为同态 keyof 映射后，整 map 值投影对可选成员**保留 `?` 修饰符**（如整根读 → `{ …; notes?: string | undefined }` 而非必填带 undefined）；修复前该路径产出的是 `{}`（坍缩假型），不存在可合法依赖的旧行为。导出面签名（12 名冻结名单、参数/返回形状）无一改变。详见 §13 契约审计。

**不修的位点（最小 diff 纪律）**：`PathElementValue`（:97 `Record<infer _Idx, infer ElementNode>`）——其输入恒为 array 节点的 `Record<`\`${number}\`, 元素子树>`（纯索引签名，发射契约下不可能含可选成员），不属触发面，保持原样。

### §4.4 修复规格（SA3 落地精确 diff，packages/vfsl-protocol/src/index.ts 三处）

```diff
-/** 键空间并集：对 union V 逐成员分发取各成员 keyof 再并集（≠ keyof(union)=交集）。（A.4.1，不导出） */
-type MemberKeys<V> = V extends Record<infer Key, unknown> ? Key : never;
+/** 键空间并集：distributive keyof——对 union V 逐成员分发取 keyof 再并集（≠ keyof(union)=交集）。
+ *  （A.4.1，不导出）禁用 Record<infer Key, unknown> 同态推断：含可选成员的表上 Key 坍缩 never
+ *  → 全表 fail-closed（#27 dogfood 实测）；keyof 对可选/交叉/联合形态均稳定。 */
+type MemberKeys<V> = V extends unknown ? keyof V : never;
```

```diff
       ? (V extends Record<infer Key, unknown>
-          ? { [K2 in Key]: VfslValueOf<V[K2]> }   // 递归展开映射/数组元素子树
+      ? (V extends object
+          ? { [K2 in keyof V]: VfslValueOf<V[K2]> }   // 递归展开映射/数组元素子树（同态 keyof：可选成员保 `?`，免 Record-infer 坍缩，见 MemberKeys 注）
           : V)
```

（`PathPatchUnwrap` 同形替换：`Record<infer Key, unknown>` → `object`，`[K2 in Key]` → `[K2 in keyof V]`，注释同指。）

守卫语义对账：`V extends object` 与原 `Record<infer Key, unknown>` 在**可达输入**上逐点等价——原形式对标量 V 推断失败得 Key=never 后 `Record<never, unknown>` ≡ `{}` 仍匹配非 nullish 一切（产出 `{}` 假型），唯一真实回退分支是 `undefined`（可选成员查找的合法产物）；新形式 `undefined extends object` = false → 同样透传。无效输入（标量配 map kind）两侧皆为发射契约外的 garbage-in，desync 守卫在上游拦截。

## §5. D2 对红灯测试矩阵的满足性（逐臂核对）

- `vfs3-assets-projection.test-d.ts`（19 tests）：`notes?` 读 `string | undefined`（MemberLookup 索引取值天然含 undefined，与 exactOptionalPropertyTypes 无关——实测）、patch 取声明处 string（PathPatchValue 分发后 `string | never` = string）、`PathKind = 'leaf'`（分发后 `'leaf' | never`）——全部实测绿。Record 通配层 / 判别联合 / 序列编辑 / plain·xml-fragment 终态 / 负例 @ts-expect-error 各自实测绿。
- `vfs3-assets-migration.test-d.ts`（6 tests）：MigratedPathMap 的 `notes: PathSchema<string,'leaf'> | undefined` 形态（SA6 为绕缺陷所选）在修复后仍是合法表形态（必填成员值含 undefined）——迁移断言不触碰 notes，两形态等价，实测绿。**该文件头注释（缺陷绕行说明）保留不改**：[SA6 owned]，注释是发现史的真实记录；是否刷新措辞归 SA6/后续票，本任务不动。
- `vfs3-assets-tsdoc.test.ts`（6 tests）：AC1 五件 + 纯类型空模块实测绿；AC5 别名位（≥5 守门：AssetId 双 doc、Audit、AssetEntity、Attachments、ROOT——fixture 首行块注释同挂 AssetId，守门计数不受影响）、字段位（≥1 守门：ROOT.notes `@semantic`）实测绿；标记位空转（D3 裁决）。

## §6. D3 — AC5 标记位证据缺口裁决

### §6.1 裁决：**(a) —— schema.vfsl 保持 §10 原文逐字，标记臂空转 + 缺口显式记录 + 路由规格轴 follow-up**。

### §6.2 权衡

| 维度 | (a) 逐字（主选） | (b) schema.vfsl 补标记位 JSDoc | (c) 改规格 §10 再逐字复制 |
|------|------|------|------|
| 单一真相源（ADR 0001） | 完全保持：schema.vfsl = §10 + 头部，唯一组合 | **破坏**：dogfood 首包即偏离规格实例，立坏先例；未来 §10 修订需人工甄别「规格改动 vs 本地补丁」 | 形式保持（改在真相源），但 §10 是方言规格附录，本票越轴 |
| AC5 证据完整性 | 别名/字段两臂实质（守门 ≥5/≥1），标记臂空转（vacuous truth：断言量化对象是「fixture 携带的 JSDoc」） | 三臂全实质 | 三臂全实质 |
| 连带改动面 | 零 | 本票内 1 行 | 规格附录 + `vfsl-assets-fullchain-e2e.test.ts`（#32）与 `validate-snapshot.test.ts`（#21）内嵌「与 §10 逐字对齐」副本须同步——跨三票 churn |
| 验收锚（SA6 测试）现状 | 绿（标记臂无防空转守门，SA6 明示「不阻塞，提请裁决」） | 绿（实测，附录 C） | 绿 + 上述跨票测试改动重验 |

**选 (a) 的理由**：

1. dogfood 的存在意义是「在规格自己的正例上端到端跑通管线」；为首包引入本地偏离等于在演示座上动刀，削弱其证据价值。ADR 0001 是本仓奠基法，AC5 的标记位 vacuity 是 **fixture 数据属性**而非断言规避——测试断言「fixture 携带的全部 JSDoc 都出现在 TSDoc」，逐字 fixture 下该命题完整成立。
2. 缺口的正当修复位在**规格轴**（AC 括注自指「#46 Spec 轴」）：给 §10 fixture 增补标记位 JSDoc 是规格编辑性增补，其涟漪（两份逐字对齐副本同步）应随规格票审慎推进，不应由领域种植票顺手夹带。
3. 「守门」由既有机制链承载，非裸空转：(i) 标记臂扫描逻辑在场且 fixture 驱动——fixture 一旦携带标记位 JSDoc 自动生效（本设计实测验证，附录 C 探针 F）；(ii) F1 层 `evaluate-derived-docs-audit.test.ts` 性质断言「markerDocs 键数 === IR marker 节点总数」结构性封死漏走标记位；(iii) tsdoc 测试对字段位新锚形态响亮失败要求扩展（不静默跳过）。
4. **Follow-up 路由（提请总控登记）**：规格轴票——§10 fixture 在标记位补一条 JSDoc（建议位：`notes?: /** … */ YLeaf<string>`，与既有字段位 doc 同字段双锚，演示力最强）+ 同步 fullchain-e2e/validate-snapshot 两份逐字副本 + 本包标记臂自动激活即验收。

### §6.3 回退方案（总控/SA8 若裁决「AC5 须本票内三臂实证」，一句话激活，无需重新设计）

采用 (b) 的精确形态（实测绿，附录 C 探针 F）——schema.vfsl 唯一偏离行：

```diff
   /** @semantic 可选说明字段 */
-  notes?: YLeaf<string>;
+  notes?: /** 可选说明的 Yjs 叶子载体 */ YLeaf<string>;
```

生成物对应行变为 `notes?: /**  可选说明的 Yjs 叶子载体  */ PathSchema<string, 'leaf'>;`（emitNode 行内位），标记臂即实质断言。同时：设计 R 修订在 ALLOW LIST 保留 schema.vfsl（本就在列）并显式标注偏离事实 + 登记 §6.2 第 4 条 follow-up（终态仍应回归规格轴、schema.vfsl 复归逐字）。**不采纳 (c)**：跨票改动两份验收测试的代价与 G 票职责不成比例。

## §7. D4 — id/目录名张力钉死

**钉死：`@id: vfs3-assets@1`**（idBase = `vfs3-assets` = 目录名）。

- 约束力来源：F2 `collect.ts:86-101` `assertIdBaseDir`——idBase 目录不存在即响亮 exit 2（代码冻结不变式）；任务简报与 SA6 接线（`domains/*` glob、包名 `@nomicore/vfs3-assets`）钉死目录名 `vfs3-assets`。两钉相交，id 唯一可行解 = `vfs3-assets@1`。
- ADR 0005 §2 样例 `vfs3.assets@1` 是**头部格式示例**（演示三键语法），非 id 值冻结——§2 冻结的是「三键全部必需 + 响亮拒绝」，不是样例字符串。冲突门禁报告补充观察 3 按样例建议 `@id: vfs3.assets@1`，但那是基于「目录名可随 id」的隐含假设；目录名已被简报/包名钉死，故 id 迁就目录名。**提请 SA8 设计后 ADR 复审知悉此偏离**（判断：无需 ADR 演进，样例非冻结值；若 SA8 认为 §2 样例值具约束力，则须先改目录名——但那将推翻简报与 SA6 接线，代价明显不成比例）。
- 兼容性实测：`FileSchemaSource.load('vfs3-assets@1')` 一级寻址命中（`vfs3-assets` 为合法单段）；SA6 tsdoc 测试的 id 正则 `/^vfs3[.-]assets@\d+$/` 兼容；`pnpm generate` outPath = `domains/vfs3-assets/generated.ts`；CI 三步骤全绿（附录 C）。
- §10 fixture 首行散文 `/** vfs3.assets — … */` 保留逐字（文档性质，非 `@id` 指令；无机器标签条款不触及，ADR 0005 §2 切割在案）。

## §8. D5 — 版本 bump 计划（硬门禁 9）

| 包 | 当前 | 目标 | 依据 |
|----|------|------|------|
| `packages/vfsl-protocol` | 0.1.0 | **0.1.1** | D2 三处类型内部修复（缺陷修复 = patch；导出面无增删改） |
| `packages/vfsl-codegen` | 0.1.1 | **不动** | 选型 A 零改动；头注 `Generator:` 版本不变 → 入仓 generated.ts 稳定（附录 B 即 0.1.1 头注实测产出） |
| `packages/vfsl` | 0.1.8 | **不动** | 零改动 |
| `domains/vfs3-assets`（新） | — | **0.1.0** | 新包初始版本，非 bump；private 不发布 |
| 根 `nomicore` | 0.1.0 | 不动 | 零改动 |

bump 纪律延伸：若 SA2 攻击迫使方案改为触碰 codegen（如翻转为候选 B），则 codegen 须 bump 0.1.1→0.1.2 **且** generated.ts 头注同步再生（header.ts 版本自同步机制会令 regen-diff 报警——同原子提交内重生成即可）。

## §9. 实施顺序与验收回执（SA3 落地清单）

1. `packages/vfsl-protocol/src/index.ts` 三处替换（§4.4 diff 逐字）+ `package.json` version → 0.1.1。
2. 新建 `domains/vfs3-assets/`：`schema.vfsl`（附录 A 逐字，sha256 自校）、`package.json`（§3.4）、`index.ts`（§3.3）。
3. `pnpm install`（更新 pnpm-lock.yaml，须含 `domains/vfs3-assets` importer）。
4. `pnpm generate` → 产出 `generated.ts`（与附录 B 逐字节比对 / 头注哈希 = `sha256:82e98fa1…93c69`）。
5. ci.yml 两处编辑（§3.6）。
6. 本地全绿回执：`pnpm typecheck` exit 0；`pnpm test` 452 全绿（30 文件）；`pnpm generate --check` exit 0。
7. **单原子提交**：协议修复 + bump + 领域包四件 + lockfile + ci.yml（ADR 0005 §4 纪律延伸至 CI 步骤改动，冲突报告观察 2）。

验证命令（SA4/SA7 可机器复核）：附录 C 全量。

## §10. 边界条件与风险登记

| # | 边界/风险 | 处置 |
|---|-----------|------|
| E1 | exactOptionalPropertyTypes 交互 | 探针全程带该 flag；`V['notes']` 索引取值含 undefined 是索引语义（非修饰符语义），read 投影 `string \| undefined` 实测成立 |
| E2 | `{} & VfslPathMap` 交叉形态（protocol 测试同款装置） | probe1-fixed 实测修复后正常；领域测试直用形态亦实测绿 |
| E3 | 空表 fail-closed（D3）回归 | `keyof {}` = never ≡ 原坍缩结果；empty-fail-closed 测试实测绿 |
| E4 | 联合键空间并集（D2）回归 | distributive keyof 逐成员分发；probe2 `_u4` + 全套件联合断言实测绿 |
| E5 | 同态 keyof 映射的修饰符保留（`?`/readonly） | 是行为变化但是**更诚实**方向；无测试断言旧（坍缩/必填化）形态；§4.3/§13 披露 |
| E6 | TS 版本漂移使推断行为变化 | typescript 锁 5.9.3；未来 bump 由全量套件 + CI 双抓 |
| E7 | SA3 手滑致 schema.vfsl 字节漂移 | 附录 A sha256 oracle + `generate --check` 双抓 |
| E8 | 未来领域在嵌套 map/联合成员用 `?:` | A 已根修三位点，全形态覆盖（非只修 ROOT 层）；`PathElementValue` 不在触发面（§4.3 末段） |
| E9 | fixture 首行块注释归属 | 实测与 AssetId doc 连续同挂 AssetId（与 parse-vfsl-jsdoc 测试文件头的 §10 挂载样本预期一致）；tsdoc 测试 fixture 驱动自动跟随 |
| E10 | lockfile 与 base 漂移冲突 | 例行 rebase 重跑 `pnpm install`；frozen-lockfile 在 CI 兜底 |

## §11. 文件清单（File Scope）

R1 初版：尚无 SA 2 反馈（修订时在此节上方追加「SA2 反馈逐条回应」表；ALLOW LIST 只增不删）。

### ALLOW LIST

- `packages/vfsl-protocol/src/index.ts` — 修改，D2 三处类型内部修复（§4.4 逐字 diff；净改动 3 行 + 注释 ≤ 8 行）
- `packages/vfsl-protocol/package.json` — 修改，version 0.1.0 → 0.1.1（1 行，硬门禁 9）
- `domains/vfs3-assets/schema.vfsl` — 新建，头部三键 + §10 fixture 逐字（附录 A；32 行）
- `domains/vfs3-assets/generated.ts` — 新建，`pnpm generate` 产出入仓（附录 B 参考输出；~30 行）
- `domains/vfs3-assets/index.ts` — 新建，增广挂载点（§3.3；1 行）
- `domains/vfs3-assets/package.json` — 新建，纯类型包清单（§3.4；14 行）
- `pnpm-lock.yaml` — 修改，`pnpm install` 新增 domains/vfs3-assets importer（机器产出）
- `.github/workflows/ci.yml` — 修改，§3.6 两处（摘 flag + 清两处 TODO(#27) 注记 + 注释改写；净 -6 行左右）
- `wiki/raw/task_vfsl-domains-assets-dogfood_design.md` — 新建，本设计文档

### DENY LIST

- `domains/vfs3-assets/test/**` — [SA6 owned] 验收锚三文件；任何 SA 不动断言逻辑（两修复形态均兼容，实测全绿，无改动必要；migration 文件头的缺陷绕行注释是发现史记录，保留）
- `packages/vfsl-protocol/test/**` — [SA6 owned，#24 票] 协议验收套件；D2 修复以其**零改动全绿**为验收门禁
- `packages/vfsl-codegen/**`（含 src 与 test）— 选型 A 下零改动；F2 §3.5 `?:` 发射契约与 mapping-table 验收断言不动
- `packages/vfsl/**` — 解析/求值/校验/接缝层稳定，本任务不动
- `docs/vfsl/v1-spec.md` — §10 fixture 原文（D3 裁决 (a)：不偏离；标记位增补走规格轴 follow-up）
- `docs/adr/**` — ADR 演进归 SA8/总控流程，本票不改
- `packages/vfsl/test/vfsl-assets-fullchain-e2e.test.ts`、`packages/vfsl/test/validate-snapshot.test.ts` — [SA6 owned，#32/#21 票] 内嵌 §10 逐字副本；本任务不动（D3 选 (a) 即保其「逐字对齐」声明不失效）
- `pnpm-workspace.yaml` / `vitest.config.ts` / `tsconfig.typecheck.json` / `tsconfig.base.json` / 根 `package.json` — SA6 接线已毕/无需改动
- `apps/**`、`tests/**`、`packages/vfsl-codegen/src/cli.ts`（`--allow-empty-domains` flag 本体保留，仅 CI 不再使用）

## §12. 协议假设依据 (Protocol Assumption Evidence)

本设计无 HTTP/WS/端口类协议假设；类型级与命令级假设全部经设计期实测（typescript 5.9.3、node v24、pnpm 10.28.2；命令与输出摘要见附录 C）：

| 假设 | 依据类型 | 依据内容 | 风险等级 |
|---|---|---|---|
| `Record<infer Key, unknown>` 对含可选成员对象推断 Key→never（缺陷机理） | 设计期实测 | probe2：接口/字面量/`{} &` 交叉三形态断言全败，全必填通过（附录 C.1） | 低（已实测） |
| distributive `keyof` 修复在 `{} &` 交叉/直用/联合/可选四形态正确 | 设计期实测 | probe2 `_u1.._u4` 全绿；probe1-fixed 三断言全绿（附录 C.1/C.3） | 低 |
| `V extends object` 守卫在可达输入上与原 Record-infer 等价 | 设计期实测 + 推导 | 全量套件 452/452 绿（含整值投影 toEqualTypeOf 精确断言）；probe3 整根读 = `{ simple: string; opt?: string }`（附录 C.3） | 低 |
| 修复后全套件（30 文件 452 测试）绿 | 设计期实测 | /tmp/wt-a `pnpm test` 输出（附录 C.4） | 低 |
| 未修协议 + 种包 = 真红（测试鉴别力） | 设计期实测（阴性对照） | /tmp/wt-b 领域三文件 7 类型错误失败（附录 C.5） | 低 |
| 种包后 `pnpm generate` exit 0、`--check` exit 0（无 flag） | 设计期实测 | 附录 C.4；零领域 exit 2 另有 SA6 记录在案 + cli.ts:63-70 源码 | 低 |
| `pnpm install` 更新 lockfile 且 frozen-lockfile 可复原 | 设计期实测 | lockfile 新增 importer（附录 C.4）；frozen 行为 = pnpm 官方文档公认语义 + CI 既有步骤 | 低 |
| schema.vfsl 组合（头部 + fixture 逐字）可被 list/load/parse/evaluate/generate 全链接纳 | 设计期实测 | 附录 C.2/C.4（生成物附录 B 即产物） | 低 |
| AC5 回退 (b) 标记臂可激活 | 设计期实测 | 附录 C.6（标记臂 6/6 绿） | 低 |
| module augmentation 经 `export *` 链挂载生效 | 设计期实测 + 现有测试引用 | 领域 projection 测试全绿；protocol 测试文件头增广泄漏说明同款机制 | 低 |

## §13. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数（类型级；零运行时契约变化——协议包纯类型，empty-module 测试实测绿）

| 构造 | 文件 | 改动前 | 改动后 | 导出？ |
|---|---|---|---|---|
| `MemberKeys<V>` | packages/vfsl-protocol/src/index.ts:27 | `V extends Record<infer Key, unknown> ? Key : never` | `V extends unknown ? keyof V : never` | 否（内部） |
| `VfslValueOf<T>` 内联推断位 | 同上 :63-65 | `Record<infer Key, unknown>` + `[K2 in Key]` | `V extends object` + `[K2 in keyof V]`（同态） | **是**（12 名冻结名单成员） |
| `PathPatchUnwrap<V,K>` 内联推断位 | 同上 :88-90 | 同上 | 同上 | 否（经 `PathPatchValue` 间接导出） |

### Caller 清单（类型消费者；grep 方法见下）

| Caller | 位置 | 受影响？ | 处置 |
|---|---|---|---|
| `Step`（PathAt 单段推进） | index.ts:35-42（经 MemberKeys） | 可选成员表上由坍缩恢复正确；其余形态逐点等价 | 行为恢复即目的；全套件实测绿 |
| `PathValue`（= VfslValueOf 别名） | index.ts:70 | 整 map 值投影对可选成员现保留 `?`（旧行为 = 坍缩 `{}` 假型，无可合法依赖者） | §4.3 代价披露；probe3 钉死新形态 |
| `PathPatchValue` | index.ts:79-83（经 PathPatchUnwrap） | 同上 | 同上 |
| `VfslTypedAccess` 六方法 | index.ts:116-152（经 PathAt/PathPatchValue/PathValue/PathElementValue） | 签名形状不变；可选成员路径由「全拒」恢复为 D2 语义 | 领域/协议测试实测绿 |
| `packages/vfsl-codegen/src/protocol-surface.ts:14` | 导出名冻结名单（名字登记，非调用） | 否——导出面 12 名无增删 | 碰撞守卫测试实测绿 |
| 三协议测试文件 + 三领域测试文件 | packages/vfsl-protocol/test、domains/vfs3-assets/test | 是（被测对象本身） | 452/452 实测绿，零改动 |
| 运行时 caller | 无（纯类型包，编译后空模块） | — | empty-module 测试实测绿 |

抓全 caller 的方法（已执行）：`grep -rn "VfslValueOf\|PathPatchValue\|PathPatchUnwrap\|MemberKeys" --include='*.ts' packages apps domains` —— 协议包外命中仅 protocol-surface.ts 的名字登记两行（附录 C.7）。

**遗漏 caller 的代价评估**：类型层契约变化的爆炸半径 = 编译期；任何漏网不兼容都会以 tsc/vitest typecheck 红灯当场暴露（fail-closed 方向），不存在运行时静默面。

## §14. SA2 攻击预案（自检一致性声明）

| 预判攻击 | 防御位置 |
|---|---|
| 「为什么不选 B（SA6 已实测绿）」 | §4.3 四面论证：A 的证据同为实测（且含阴性对照），B 须翻转 F2 冻结契约 + 改写 F2 验收测试 + 潜伏 silent-`{}` |
| 「动 ADR 0004 冻结协议包 = 越权」 | ADR 冻结 D1–D5 语义决策；本修复恢复 D2/D3 本意（已声明可选成员不应连坐全表），不改任何语义决策；已提请 SA8 复审（§7 同） |
| 「VfslValueOf 修饰符保留是隐藏契约变更」 | §4.3 代价披露 + §12/§13 审计 + probe3 实证；旧行为是坍缩假型，无可依赖者 |
| 「AC5 标记位空转 = 验收不完整」 | §6.2 四点 + 验收锚作者（SA6）自评「不阻塞」+ 回退 (b) 精确 diff 备总控一句话激活 |
| 「id 偏离 ADR §2 样例」 | §7：样例非冻结值；目录名被简报/包名钉死；SA8 复审路由已开 |
| 「PathElementValue 为何不同步修」 | §4.3 末段：输入恒为纯索引签名 Record，不在触发面；最小 diff 纪律 |
| 「`export *` 挂载可靠性」 | §3.3 + 附录 C 实测（AC1 空模块 + projection 增广断言双绿） |

一致性自检：全文 id 取值（vfs3-assets@1）、版本号（protocol 0.1.1 / codegen 0.1.1 不动）、generated.ts 形态（`notes?:`）、AC5 裁决 (a) 在各章节表述一致；附录 A/B 哈希互绑。

---

## 附录 A — schema.vfsl 钉死全文

`sha256: 82e98fa1546b9548f32795dd51e9212eaf35e4731939a1c4db5c8f3b03b93c69`（对下列逐字内容，含尾换行）：

```vfsl
// @lang: vfsl
// @id: vfs3-assets@1
// @version: 1

/** vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位） */

/** 资产 ID：键约束由 Pattern 定义，禁 "." 与 "|" */
type AssetId = string & Pattern<"^[A-Za-z0-9_\\-]{1,64}$">;

/** 审计信息：所有写入留痕 */
type Audit = YMap<{
  createdBy: YLeaf<string>;
  createdAt: YLeaf<number>;
}>;

/** 资产实体：按 kind 判别的封闭联合 */
type AssetEntity =
  | { kind: "image"; url: YLeaf<string>; width: YLeaf<number>; height: YLeaf<number>; audit: Audit }
  | { kind: "text"; body: YXmlFragment<{ paragraphs: YArray<YLeaf<string>> }>; audit: Audit }
  | { kind: "file"; name: YLeaf<string>; size: YLeaf<number>; tags: YArray<YLeaf<string>>; audit: Audit };

/** 附件：与 Yjs 同步无关的纯值数组 */
type Attachments = YPlainArray<YLeaf<string>>;

/** ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 */
type ROOT = YMap<{
  assets: Record<AssetId, AssetEntity>;
  attachments: Attachments;
  audit: Audit;
  /** @semantic 可选说明字段 */
  notes?: YLeaf<string>;
  keywords: YLeaf<string>[];
}>;
```

## 附录 B — generated.ts 参考输出（设计期实测产出，SA3 再生后逐字节比对）

`sha256: fbe181f3f67bf64c0aad30ff6ce6df689f849fea26d88b48026f49ace9c365ea`：

```ts
/**
 * GENERATED FILE — DO NOT EDIT.
 * Generator: @nomicore/vfsl-codegen@0.1.1
 * Source hash: sha256:82e98fa1546b9548f32795dd51e9212eaf35e4731939a1c4db5c8f3b03b93c69
 * Regenerate with: pnpm generate
 */

import type { PathSchema } from '@nomicore/vfsl-protocol';

/**  vfs3.assets — 依据 issue #9 描述还原（原设计文档缺位）  */
/**  资产 ID：键约束由 Pattern 定义，禁 "." 与 "|"  */
export type AssetId = string;
/**  审计信息：所有写入留痕  */
export type Audit = { 'createdBy': PathSchema<string, 'leaf'>; 'createdAt': PathSchema<number, 'leaf'> };
/**  资产实体：按 kind 判别的封闭联合  */
export type AssetEntity =
  | { 'kind': PathSchema<'image', 'leaf'>; 'url': PathSchema<string, 'leaf'>; 'width': PathSchema<number, 'leaf'>; 'height': PathSchema<number, 'leaf'>; 'audit': PathSchema<Audit, 'map'> }
  | { 'kind': PathSchema<'text', 'leaf'>; 'body': PathSchema<string, 'xml-fragment'>; 'audit': PathSchema<Audit, 'map'> }
  | { 'kind': PathSchema<'file', 'leaf'>; 'name': PathSchema<string, 'leaf'>; 'size': PathSchema<number, 'leaf'>; 'tags': PathSchema<Record<`${number}`, PathSchema<string, 'leaf'>>, 'array'>; 'audit': PathSchema<Audit, 'map'> };
/**  附件：与 Yjs 同步无关的纯值数组  */
export type Attachments = string[];

declare module '@nomicore/vfsl-protocol' {
  /**  ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束  */
  interface VfslPathMap {
    assets: PathSchema<Record<string, PathSchema<AssetEntity, 'map'>>, 'map'>;
    attachments: PathSchema<Attachments, 'plain'>;
    audit: PathSchema<Audit, 'map'>;
    /**  @semantic 可选说明字段  */
    notes?: PathSchema<string, 'leaf'>;
    keywords: PathSchema<Record<`${number}`, PathSchema<string, 'leaf'>>, 'array'>;
  }
}
```

## 附录 C — 设计期实测证据（2026-08-21，typescript 5.9.3 / node v24.13.0 / pnpm 10.28.2）

scratch 布置：`rsync -a --exclude node_modules --exclude .git <worktree>/ /tmp/wt-a/` + 应用 §4.4 diff + 种植 §3 四件 + `pnpm install`。阴性对照 `/tmp/wt-b` = wt-a 复原协议文件。探针 `/tmp/vfsl-probe/*.ts`，统一编译旗标 `--strict --exactOptionalPropertyTypes --module esnext --moduleResolution bundler --target es2022 --skipLibCheck`（对齐 tsconfig.base.json）。

1. **缺陷复现与机理**（probe1/probe2，基线协议）：含可选成员时 `{} &` 交叉与直用两形态 `PathKind<PathAt<…,['simple']>>` ≠ 'leaf'（三条 Assert 全 TS2344）；`Record<infer Key, unknown>` 对接口/字面量/交叉三形态可选成员载体推断 ≠ 键并集，全必填通过；distributive keyof 四形态（接口/字面量/交叉/联合）全通过。
2. **schema.vfsl 全链接纳**：`pnpm generate` exit 0，产物 = 附录 B；`FileSchemaSource.list()` 含 `vfs3-assets@1`。
3. **修复后探针**（probe1-fixed/probe3，patch 后协议）：三断言全绿（编译零错误）；整根值读 `PathValue<PathAt<VfslPathMap, []>>` = `{ simple: string; opt?: string }`（修复前 = `{}` 坍缩假型）。
4. **全量套件**（/tmp/wt-a）：`pnpm test` → `Test Files 30 passed (30) / Tests 452 passed (452) / Type Errors no errors`；`pnpm typecheck` exit 0；`pnpm generate --check` exit 0；lockfile 新增 `domains/vfs3-assets` importer（四 devDeps 解析正确）。
5. **阴性对照**（/tmp/wt-b = 未修协议 + 种包）：`vitest run domains/vfs3-assets --typecheck` → `Test Files 3 failed (3) / Type Errors 7 failed`——真红，测试鉴别力成立。
6. **AC5 回退 (b) 探针**：schema.vfsl 加 `notes?: /** 可选说明的 Yjs 叶子载体 */ YLeaf<string>;` → 再生 → 标记臂实质化，`vfs3-assets-tsdoc.test.ts` 6/6 绿（探后已复原逐字 fixture 并重生成）。
7. **caller 抓全**：`grep -rn "VfslValueOf\|PathPatchValue\|PathPatchUnwrap\|MemberKeys" --include='*.ts' packages apps domains` → 协议包外仅 `packages/vfsl-codegen/src/protocol-surface.ts:14-15`（名字登记）。
