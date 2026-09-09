# SA3 Implementation Report — issue #273 namespace-runtime + namespace-registry：readData 成功分支返回语义 schema 投影（ADR 0016）

- Worktree：`/home/wangjian/nomicore-fix-issue-273`（branch `mabf/issue-273`，HEAD `1acd9e9` = #272 合并提交）
- Phase：implementation（iteration 0，dispatch 1788928104985）
- 裁决输入：SA6 验收契约 approve（15 红 + 6 负控 + 2 类型锚 + 夹具）；SA1 设计 iteration-1（F-1 修订版）approve；SA2 设计评审 pass（F-1 已落实、无新阻断项）；SA8 冲突门禁 clear ×2 + 设计后复审 clear（iter-2）；Issue comments REST 读取为空（无 owner 要求）

## Inputs consumed

| 输入 | 位置 | 用法 |
|---|---|---|
| SA6 验收契约 | `wiki/raw/task_issue-273_sa6_contract.md` | 红/绿基线、断言形状、类型锚、夹具（DENY） |
| SA1 设计（iteration-1 批准版） | `wiki/raw/task_issue-273_design.md` | D1–D8 决策、ALLOW/DENY LIST、D3b 全量规格、T1–T3、D7 站点分类 |
| SA2 评审（iteration-0 reject + iteration-1 pass） | `wiki/raw/task_issue-273_sa2_review.md` | F-1 验收 ①②③④、N-1–N-5（经设计 §14 落实） |
| SA8 冲突报告 + 设计冲突报告（×2） | `wiki/raw/task_issue-273_*.md` | 红线 1–7、实现阶段复查清单（iter-2 §10） |
| ADR 0016 + ADR 0008 修订节 | `docs/adr/*` | 权威行为语义（结果形状/投影体/null 三情形/深拷贝纪律） |

## Existing worktree reconciliation

无先前 SA3 产物（无 `task_issue-273_sa3_impl.md`、无未提交实现）。HEAD 生产实现零改动（仅 SA6 契约文件 + wiki 快照未跟踪）。本实现为新实现，无修订旧改动的义务。

## Changed paths

| Path | Design section | Change |
|---|---|---|
| `packages/namespace-runtime/src/read-schema-projection.ts`（新文件） | §7-D3a/D3b/D4/D5 + §11 ALLOW | 新内部模块：`projectReadDataSchema`（D3a 状态守卫 → D3b 规范化 → resolver → D5 深拷贝）、`normalizeReadPath`（敌意 path 全量规格：索引访问/迭代器同一性/内层 try）、identity-memo 递归克隆器（逐 kind 显式分派、外壳先登记后递归、不冻结）；模块头注双域处置 + 内层 try 辖域记录（D4 文档义务） |
| `packages/namespace-runtime/src/runtime.ts` | §7-D1/D2/D4、§8.2、§11 ALLOW | `NamespaceRuntimeReadDataResult` 重定型（ok 成员恰三键 + `Extract<ReadLogicalValueResult,{ok:false}>` 失败派生 + `RuntimeReadDisabledResult`）；接口 `readData` JSDoc 双域契约改写；`readData` ready 分支组合重写（值读先行 → 失败短路 → 恰三键构造）；导入 `ReadDataSchemaProjection` + `projectReadDataSchema` |
| `packages/namespace-runtime/src/index.ts` | §11 ALLOW（注释级） | 头注新增 #273 增量段（readData 组合形状；导出键集零变化） |
| `packages/namespace-runtime/src/p0.ts` | §11 ALLOW（仅注释行） | `activeTools` 注释按 ADR-0008 修订节 D8 封口改写（derived 只经 readData 投影受控只读深拷贝进公共面；module/validator 仍永不）——零行为 |
| `packages/namespace-registry/src/types.ts` | §7-D6、§8.4、§11 ALLOW | `NamespaceLeaseReadDataResult` 别名 = `NamespaceRuntimeReadDataResult \| NamespaceLeaseReleasedIssue`；导入清理（删 doc-runtime `ReadLogicalValueResult` 与 `RuntimeReadDisabledResult`，增 `NamespaceRuntimeReadDataResult`）；`lease.ts` Equal 锁零改动 |
| `packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts`（新文件） | §7-D8、§12 F-1 行、§11 ALLOW | T1（重定义 `Symbol.iterator` 敌意数组：不抛 + 恰 `{ok:true,value:3,schema:null}` + `iteratorCalls===0` 载荷锚）/ T2（Proxy get 陷阱）/ T3（尾段 Symbol + `'schema' in r===true`）+ 局部负控（合法 `['count']` 非 null 且等于红 #2 字面量）；夹具 import-only |
| `packages/namespace-runtime/test/runtime-boundary-supplementary.test.ts` | §10/§11 ALLOW（L91/L128） | 真实 runtime 两站点 toEqual → `toMatchObject({ok:true,value})`（D7 真实 runtime 分类） |
| `packages/namespace-registry/test/registry-open.test.ts` | §11 ALLOW | `makeRuntime` 默认 readData 补 `schema: null`（typed stub）+ L356 改 toMatchObject（真实 runtime）+ L815/L879 stub 全等断言补 `schema: null` |
| `packages/namespace-registry/test/registry-create.test.ts` | §11 ALLOW | `makeMarkerRuntime` 补 `schema: null`（any stub 推荐项，D7）+ L513/L1765/L1766 stub 全等断言补 `schema: null` + L459/L1645 改 toMatchObject（真实 runtime，ready 态确定性站点） |
| `packages/namespace-registry/test/registry-idle.test.ts` | §11 ALLOW | `ObservableRuntime.readData` 补 `schema: null`（typed stub）+ 11 断言站点全等补 `schema: null` |
| `packages/namespace-registry/test/registry-sa7-rev1.test.ts` | §11 ALLOW | stub 补 `schema: null` + 3 断言站点补 `schema: null` |
| `packages/namespace-registry/test/registry-shutdown.test.ts` | §11 ALLOW | `ObservableRuntime.readData` 补 `schema: null`（typed stub） |
| `packages/namespace-registry/test/registry-sa7-hostile.test.ts` | §11 ALLOW | stub 补 `schema: null` + L422 全等断言补 `schema: null` |
| `packages/namespace-registry/test/registry-sa7-concurrency.test.ts` | §11 ALLOW | `CountingRuntime.readData` 补 `schema: null`（typed stub） |
| `packages/namespace-registry/test/registry-sa7-cordis.test.ts` | §11 ALLOW | L184/L360 改 toMatchObject（真实 runtime） |
| `packages/namespace-registry/test/registry-persistence-contract.test.ts` | §11 ALLOW | L110/L114/L128 改 toMatchObject（真实 runtime） |
| `packages/namespace-registry/test/registry-plugin.test.ts` | §11 ALLOW | L196/L529 改 toMatchObject（真实 runtime） |
| `packages/namespace-registry/test/registry-sa7-phase5-dynamic.test.ts` | §11 ALLOW | L149/L198 改 toMatchObject（真实 runtime/真实 fs round-trip） |
| `packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts` | **D7 遗漏站点（见 Deviations）** | AC9「写前 internal 失败 → 全部写永久禁用 + 读取保留」末断言按 ADR-0016 组合契约（D4）改锚：seam 注入畸形派生物（structure 非 root）的 runtime 上 `readData` 由「返回值 1」改为「loud throw `InternalError`（构造名/message 匹配，N-2 方式）」——即设计 §12 D4 可选负向锚（SA2 R2.4 第 4 条建议）的场景原位落位 |

## SA2 Finding 落实

| Finding ID | Implementation | Result |
|---|---|---|
| F-1（MAJOR，iteration-0 reject；iteration-1 pass 后按验收 ①②③④ 落实） | ① `normalizeReadPath` 全量规格（索引访问扫描 + `Symbol.iterator` 同一性 + 内层 try + 段域检查 → `null`），T1/T2/T3 逐字验收锚 + `iteratorCalls===0` 载荷锚；② 普通数组副本传 resolver（T1/T2/T3 全部收敛 `schema:null` 不抛）；③ D4 双域 JSDoc/模块头注（敌意 → null；`InternalError`（可信域）→ throw 逃逸——内层 try 不包裹 resolver 调用，两域物理分离）；④ 既有面全套回归（见 Verification） | 已落实 |
| N-1（4 处无改动站点留档） | 未改：registry-open L945（失败分支 override）、registry-phase5-bootstrap-reset-r2-internal L271、ws-replication `src/testing.ts` L47、runtime-registry-internal-sa7-dynamic L57——与设计 §10 亲核一致；根门绿兜底 | 落实（无改动，与设计一致） |
| N-2（不导出 InternalError，按构造名/message 断言） | AC9 改锚断言 `err.constructor.name === 'InternalError'` + message 含 root 节点字样；未为此导出 vfsl 类（DENY vfsl/** 保持） | 落实 |
| N-3（yjs-server 外层收编评估销项） | `apps/yjs-server/src/app.ts` 零改动（仅消费 `result.value`；根 `pnpm typecheck` 绿含 yjs-server） | 落实 |
| N-4（registry-create L459 确定性站点可加非 null 断言） | 该站点按 D7 改 toMatchObject（义务项）；schema 非 null 另加为可选加固未做（非义务，内容锚集中在 SA6 红契约） | 记录不处理理由：非义务 |
| N-5（D5 键域判断依据保留于实现注释） | `read-schema-projection.ts` `cloneValueSchemaRecord`/`cloneDocsRecord`/`cloneNumberRecord` 注释保留 CreateDataPropertyOrThrow（Object.fromEntries 逐键构造）+ tokenizer ASCII 字母起始判断依据（防退化为裸赋值） | 落实 |

## File scope check

| Changed path | ALLOW entry | Purpose |
|---|---|---|
| `packages/namespace-runtime/src/read-schema-projection.ts`（新） | §11 ALLOW 行 2 | 深拷贝/null 收敛/敌意面收敛自包含单点 |
| `packages/namespace-runtime/src/runtime.ts` | §11 ALLOW 行 1 | 组合边界唯一落点 |
| `packages/namespace-runtime/src/index.ts` | §11 ALLOW 行 3 | 头注注释级更新 |
| `packages/namespace-runtime/src/p0.ts`（仅注释行） | §11 ALLOW 行 4（DENY 注记：代码禁改——本次零代码改动） | 陈术语清理（注释） |
| `packages/namespace-registry/src/types.ts` | §11 ALLOW 行 5 | 别名跟随 + 导入清理 |
| 上述 13 个测试文件 | §11 ALLOW 行 6–17 对应行 | D7 改锚 / D8 新验收文件 |
| `packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts` | §11 无对应行（D7 遗漏站点——见 Deviations） | 组合契约行为面改锚（D4 负向锚原位） |
| DENY 面 | — | doc-runtime/**、vfsl/**、lease.ts、registry index.ts、apps/yjs-server/**、SA6 五文件、夹具、ADR/docs——全部零改动（git status 核对） |

## Verification

| Command | Result | Evidence |
|---|---|---|
| `vitest run packages/namespace-runtime/test/runtime-readdata-schema-projection-red.test.ts ... --typecheck.enabled=false` | 15/15 绿（HEAD 15/15 红） | SA6 红契约翻绿（AC1/AC2/AC3 全锚） |
| 同上 control 文件 | 6/6 绿 | SA6 负控保持（doc-runtime/失败分支/加法兼容面零回归） |
| `tsc -p tsconfig.typecheck.json` | 0 错误 | 2 类型锚翻绿 + 全仓类型面（含 registry-idle 等 typed stub 改后）零错 |
| `vitest run packages/namespace-runtime/test/runtime-readdata-hostile-path-guard.test.ts --typecheck.enabled=false` | 4/4 绿 | D8 T1–T3 + 局部负控（F-1 验收 ①② + 防守卫过拒） |
| `vitest run packages/namespace-runtime/test`（全套 38 文件） | 38 文件 / 319 测试全绿 | runtime 包全套（AC9 改锚后含 sequencer/fatal 面） |
| `vitest run packages/namespace-registry/test`（全套 33 文件） | 33 文件 / 384 测试全绿 | registry 包全套（含 registry-surface declaration 审计） |
| 根 `pnpm typecheck`（14 包含 apps/yjs-server） | exit 0 | AC5 根门 ① |
| 根 `pnpm test`（`vitest run --typecheck`，全仓） | **301 文件 / 3203 测试全绿；Type Errors: no errors；exit 0** | AC5 根门 ②（含 AC9 改锚后的 runtime 全套与 registry 全套） |
| `tsc -p tsconfig.typecheck.json`（最终态复核，含全部包测试） | exit 0 | 全仓 src+test 类型面零错（改锚全部完成后复核） |
| 设计指定的静态生成/check | 无（本票不涉 codegen/schema 生成——设计 §12 未指定 generate 门；typed-access 生成面不受影响） | — |

## Deferred verification

- 无（根两门 + 包套件 + 契约套件全部完成并绿）。
- D4 可选负向测试（设计 §12「建议新增，非验收门」）未新增独立测试文件（§11 ALLOW 只列 D8 一个新文件）——其场景已由 `runtime-mutate-root-sequencer.test.ts` AC9 改锚断言原位覆盖（同一 seam 注入畸形 derived → readData loud throw 的断言面）。
- 真实环境/跨进程动态验收、CI、PR 生命周期：SA4/SA7/Controller 职责。

## Deviations or blockers

1. **D7 遗漏站点（需要评审注意）**：`packages/namespace-runtime/test/runtime-mutate-root-sequencer.test.ts` AC9 不在设计 §10/§11 站点清单——其 fixture 经 compile seam 注入**结构畸形派生物**（structure 非 root，P0 最小形状守卫放行、安装为 ready），旧契约下末断言「读取保留 = readData(['n']) 返回值 1」成立（值通道不触 derived）；ADR-0016 组合后 readData 的 schema 通道消费 `activeTools.derived`，该 internal-bug 注入态按设计 D4（可信域畸形 → `InternalError` 逃逸读面，唯一逃逸 throw）loud throw——正是设计 §12 D4 可选负向锚（SA2 R2.4 第 4 条建议）的预言场景。AC5 根门要求下必须处理：以最小改锚把末断言改为 loud throw 断言（构造名/message 匹配，N-2 方式），AC9 其余断言（rejection committed:false/notifier 零调用/零写入/写永久禁用/status.read.enabled=true/fatal 非 null）原样保持。语义裁决：生产不可达（derived 恒为自身 compile ok 产物——seam 注入是 internal-bug 注入面）；D3b 敌意输入零 throw 不受影响。此改动超出设计 D7 枚举清单但属于「根门绿 = 无漏改站点」完备性兜底（设计 §12 D7 行自述）的必然动作；建议 SA4/SA7/SA8 按实现阶段复查清单核对本改锚与 D4 一致。
2. 无其他 blocker；SA6 五文件 + 夹具零改动（DENY 全部保持）；未执行 git add/commit/push。

## Suggested commit message

```
feat(namespace-runtime, namespace-registry): readData 成功分支返回语义 schema 投影（ADR 0016，#273）

- readData ready 期成功分支 = { ok:true, value, schema }（恰三键）；schema 为路径语义
  投影（ReadDataSchemaProjection | null），每次读 detached 深拷贝（可变、不冻结、零缓存）
- 新内部模块 read-schema-projection.ts：D3a 状态守卫 + D3b 敌意 path 规范化守卫（索引
  访问/迭代器同一性/内层 try，异态收敛 schema:null 绝不外抛）+ resolver 消费 + identity-
  memo 深拷贝；InternalError（可信域畸形 derived）保持唯一逃逸 throw（双域 JSDoc）
- registry NamespaceLeaseReadDataResult 别名跟随 runtime 联合（lease Equal 锁零改动）
- 测试：SA6 红契约 15/15 翻绿、负控 6/6 保持、类型锚 ×2 翻绿；新增 hostile-path-guard
  验收（T1–T3 + 局部负控）；D7 改锚 13 文件；AC9 读取保留断言按 D4 改锚（见实现报告）
```
