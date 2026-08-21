# MABF Task: domains/vfs3-assets 领域包 dogfood（G）

- Issue: #27 (welltop-jim-wang/nomicore)
- run_id: issue-27-1787257582-2987666
- branch: fix/issue-27-on-adr-vfsl-protocol
- base: adr/vfsl-protocol
- 任务类型: 功能开发（Feature）

## Parent

PR #23

## What to build

首个领域包（顶层 `domains/`，ADR 0005 §5）：`schema.vfsl` 用规格 §10 修订版 fixture 文本 + 头部指令；`generated.ts` 入仓；`index.ts` 增广挂载；typecheck 测试覆盖设计文档 §8.4 矩阵（真实 fixture 类型表上）+ §8.5 迁移演示（旧路径 → `UnknownPath` 编译错误清单）。

## Acceptance criteria

- [ ] 包结构符合 ADR 0005 §5（schema.vfsl + generated.ts + index.ts + test/ + package.json 纯类型）
- [ ] §8.4 正负例在真实 fixture 类型表上全过（expectTypeOf / @ts-expect-error）
- [ ] 迁移演示：模拟字段重命名后旧路径全部编译错误（每行一个 `@ts-expect-error`）
- [ ] CI regen-diff 覆盖本包（含移除 F2 阶段门 `--allow-empty-domains`——零领域重新成为响亮失败）
- [ ] docs 三锚位 TSDoc 断言：生成物中别名/字段/标记位的 fixture JSDoc 全部出现在 TSDoc 注释上（F2 评审发现的证据缺口在此补齐——#46 Spec 轴）

## Blocked by

#45（生成物编译级加固——N1/N2 修复是 dogfood 的编译前提，缺失则 generated.ts 不过 tsc）——**已闭环（CLOSED，PR #49 合入本分支基底）**；#26 已闭环

## Working Directory

/home/wangjian/nomicore-fix-issue-27

## Branch

fix/issue-27-on-adr-vfsl-protocol

---

## SA6 红灯测试记录（2026-08-21，验收锚定 · Feature 分支 A.2）

### 需求拆解 → 测试映射

| AC | 锚定方式 | 测试位置 |
|----|----------|----------|
| AC1 包结构（ADR 0005 §5 五件） | 运行时断言：五件 existsSync + package.json name + **纯类型空模块**（`Object.keys(await import(pkg))` = []，类比 ADR 0004 D3）；另由两个 test-d 的 import 解析 + 增广挂载行为锚定 | `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts` |
| AC2 §8.4 正负例（真实 fixture 类型表） | vitest typecheck：正例 `expectTypeOf` 类型相等（手写独立 oracle，不引用生成物别名防同源自证）+ 负例 `@ts-expect-error` 自我反转，全部跑在**领域包真实增广的 VfslPathMap** 上（复刻样板：vfsl-protocol-projection.test-d.ts） | `domains/vfs3-assets/test/vfs3-assets-projection.test-d.ts`（19 tests） |
| AC3 §8.5 迁移演示 | 模拟 file 成员 `name`→`label` 重命名：对照组（真实表旧路径合法）+ 手写迁移后表 `MigratedPathMap`（本地接口，不增广全局）上旧路径清单**每行一个 @ts-expect-error** + 精确失败态 `UnknownPath<['name']>` 等价锚 + 新路径正例 | `domains/vfs3-assets/test/vfs3-assets-migration.test-d.ts`（6 tests） |
| AC4 CI regen-diff 覆盖 + 移除 `--allow-empty-domains` | 行为锚 = 命令级：`pnpm generate --check`（无 flag）当前 exit 2「零领域集」响亮失败 → 种包后 exit 0（已实测：临时种包后 GENEXIT=0）。ci.yml 删 flag + TODO 注记清理归 **SA3** 落地（SA6 不动 CI 配置） | 无新测试文件（CLI 既有覆盖 + CI 步骤） |
| AC5 docs 三锚位 TSDoc | **tsc parser jsDoc 挂载断言**（ts.createSourceFile 读声明节点 jsDoc 原文，语义层「挂在哪个声明上」，非正则扫文本）；期望值由 fixture 驱动：经 **FileSchemaSource 接缝**（ADR 0001 脚手架纪律）+ parseVfsl/evaluate 取派生 docs 三槽，非空条目逐字锚定，带防空转守门（别名位 ≥5 条、字段位 ≥1 条） | `domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts` |

### SA6 已做的测试基建接线（非业务代码）

- `pnpm-workspace.yaml`：+ `domains/*`（领域包 workspace 注册前提）；
- `vitest.config.ts`：include / typecheck.include + `domains/*/test/**` 两族 glob；
- `tsconfig.typecheck.json`：include + `domains/*/*.ts`、`domains/*/test/**/*.ts`。

### 交接 SA1/SA3 的钉死项

1. **id/目录名张力**：ADR 0005 §2 样例 id `vfs3.assets@1` 的 idBase（`vfs3.assets`）≠ 目录名 `vfs3-assets`，而 F2 collect.ts 不变式要求 idBase == 目录名，不符则 `pnpm generate` 响亮 exit 2。须钉死其一（建议 `@id: vfs3-assets@1` 对齐目录名）。测试只依赖**包名 `@nomicore/vfs3-assets`** 这一接缝。
2. **package.json 要求**（SA6 实测验证过的最小形态）：name `@nomicore/vfs3-assets`、private、type module、exports `.` → `./index.ts`、devDeps `@nomicore/vfsl` + `@nomicore/vfsl-protocol`（workspace:*）+ typescript + vitest；index.ts = `export * from './generated.js'`（挂载点）。新增 workspace 包后须 `pnpm install` 更新 lockfile（CI frozen-lockfile）。
3. **生成类型表形态**（SA6 已用真实生成器对 §10 fixture + 头部三键跑通验证，与测试期望逐字一致，唯一偏差见下方重大发现）：assets → `PathSchema<Record<string, PathSchema<AssetEntity,'map'>>,'map'>`；attachments → plain 终态 `string[]`；keywords（裸 T[]）→ **array 载体**（规格 §3 默认物化 Y.Array，勿误判为 plain）；notes? → 可选 leaf；别名全量 export + ROOT doc 挂 VfslPathMap 增广接口。

### 🔴 重大发现（dogfood 首战利品）：可选成员使协议 MemberKeys 推断整体坍缩

**现象**：VfslPathMap 增广含任一**可选成员**（如 fixture 的 `notes?: YLeaf<string>`）时，`MemberKeys<V> = V extends Record<infer Key, unknown> ? Key : never` 的 Key 推断整体失败 → never → 一切路径（含无关于段）解析为 UnknownPath，**全表 fail-closed**。移除可选成员后全表正常（SA6 逐项二分证实；`{} &` 交叉技巧不可规避；与 exactOptionalPropertyTypes 无关）。

**最小复现**（tsconfig.base 严格配置）：

```ts
declare module '@nomicore/vfsl-protocol' {
  interface VfslPathMap {
    simple: PathSchema<string, 'leaf'>;
    opt?: PathSchema<string, 'leaf'>;   // 删除此行即恢复正常
  }
}
type K = PathKind<PathAt<{} & VfslPathMap, ['simple']>>;  // 实际 'unknown'，应为 'leaf'
```

**影响**：§10 fixture 必含 `notes?` → AC2 转绿的前置是协议层修复（MemberKeys 改 `keyof` 基实现，或生成器把可选成员发射为「必填 + `| undefined`」形态——SA6 已实测后一形态下本批测试 452/452 全绿，且测试断言对两种修复形态均兼容）。**提请总控裁决**：纳入本任务 SA3 范围（N1/N2 同类「编译前提」先例）还是单开阻塞 issue。

### AC5 已知证据缺口（不阻塞，提请裁决）

§10 fixture 的 JSDoc 全在别名位与字段位；**标记位**（markerDocs——doc 直挂标记类型记号）fixture 无条目 → 标记位扫描臂当前空转（逻辑在场，fixture 携带标记位 JSDoc 即生效，且解析器遇新锚位形态会响亮失败要求扩展）。若 AC5 要求标记位实证，需在 schema.vfsl 标记位补一条 JSDoc（偏离 §10 原文，须决议）。

### 红灯运行证据（后台独立进程，2026-08-21）

- `pnpm exec vitest run domains/vfs3-assets --typecheck` → **exit 1**：3 文件全红，根因 `TS2307: Cannot find module '@nomicore/vfs3-assets'`（包不存在，真红非伪红）；`Type Errors 7 failed`。
- `pnpm test`（全量）→ Test failed：失败**仅** 3 个领域测试文件，其余 27 文件全绿（接线改动对既有套件零连带损伤）。
- `pnpm generate --check`（无 flag）→ **exit 2**：`零领域集：domains/ 不存在或为空——若 G 尚未落地属预期，请加 --allow-empty-domains`（AC4 红灯锚）。
- **绿灯事故反向验证**（防「写出来就是绿的」事故 + 防 SA3 被测试自身错误卡死）：SA6 曾临时种包（scratch 生成 generated.ts + 桩 index/package.json）并模拟可选成员修复形态，全套 **452/452 绿（exit 0）**；随后已完整拆除临时文件并还原 lockfile，仓内回到纯红灯态。结论：测试断言全部经真实生成输出端到端校准，当前红 = 包不存在 + 可选成员协议缺陷待修，无「天然绿」事故。
