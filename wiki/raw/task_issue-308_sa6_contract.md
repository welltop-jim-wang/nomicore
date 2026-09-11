# SA6 验收契约 — issue #308（readData 语义投影 docs 切片并入 memberDocs）

- Dispatch：`sa-913f5214-a306-49a9-bec5-07bf7094e0a0`（mabf-sa6 / acceptance-contract / iteration 0）
- 任务类型：**Feature**（能力缺口证明 + 目标行为验收契约；不虚构 Bug 根因）
- 证据基线：worktree `/home/wangjian/nomicore-fix-issue-308`，分支 `mabf/issue-308`，HEAD `4d4208b`（#306 已合入；`memberDocs` 已在 IR/derived 落地，投影切片未接线）
- 本报告范围：诊断与验收契约。**按派发指令，SA6 本轮不实现、不编写测试**——第 12 节给出可直接转写的可执行契约（fixture 文本、逐用例断言、期望值、冻结摘要、运行入口），由实现票落地。
- 结论预告：**approve** —— 能力缺口稳定复现（9 组目标断言在旧实现全部红、红因逐条落在 docs 合并处），负控/基线全绿，契约可执行且入口真实。

---

## 1. Task type and inputs

| 输入 | 位置 | 关键内容 |
|---|---|---|
| Host task brief | `wiki/raw/task_issue-308.md` | #308「feat(vfsl): readData 语义投影 docs 切片并入 memberDocs」；What-to-build 与 3 条 AC |
| SA8 冲突门禁 | `wiki/raw/task_issue-308_sa8_conflict.md` | verdict `clear`（0 阻塞 / 2 低 / 12 项一致 + 3 项实现注记 F3） |
| Issue #308 REST 评论 | `gh issue view 308 --json comments` → `comments: []`（labels: `in-progress`, `feature`，state OPEN） | **无附加 Owner 要求**；需求全集 = Issue body（What to build + 3 AC） |
| 权威决策 | `docs/adr/0019-vfsl-union-member-docs.md` §5/§7（后法显式修订 ADR 0003 docs 表条款与 ADR 0016 切片条款） | §7 即本票母决策 |
| 被修订方 | `docs/adr/0016-readdata-semantic-schema-projection.md`「投影体」docs 条款（L35–36）、L42 | 正文尚未回写增补节（SA8 F1，非阻塞） |
| 前置实现 | `packages/vfsl/src/{parser,ir,semantic,evaluate,derived}.ts`（#306，PR #313） | `memberDocs` 条件稀疏表已收集，键 = `<member N>` 路径 |
| 待接线点 | `packages/vfsl/src/resolve-schema-at-path.ts::sliceDocs`（L427–463）与投影类型注释（L54） | 现仅 fieldDocs + markerDocs 两来源 |
| 既有测试 | `packages/vfsl/test/resolve-schema-at-path*.ts`、`evaluate-derived-member-docs.test.ts`、`union-member-docs-fixture.ts` | 基线全绿（见 §4/§14）；M4-free fixture 已存在 |

**目标行为（Issue AC 逐条，需求全集）**

- AC1：读联合/枚举所在路径时，投影 `docs` 携带 `<member N>` 键的逐字成员 doc；marker 成员同时有 M3 doc 时合并次序为 **marker 在前、member 在后**。
- AC2：不使用 M4 的 schema 投影输出**逐字节不变**。
- AC3：`packages/vfsl` 相关测试（resolve-schema-at-path）与 typecheck 绿。

---

## 2. Owner comment mapping

Issue REST `comments` = `[]`（本轮实测确认），无 Owner 追加要求。契约的全部必达项来自 Issue body（3 条 AC）与 ADR 0019 §7/§5 条款；报告不引入超出该范围的强制项（唯一超出 AC 的观察项是「穿过联合的深读」，见 §15，明确列为**不冻结**）。

---

## 3. SA8 constraints（继承与本契约的对应）

| SA8 项 | 本契约落点 |
|---|---|
| C1/C3（三来源、合并序 field→marker→member 末位） | M1–M8 目标值；M7 专测 marker→member 可见次序；M9 断言内容 = field∪marker∪member 逐字拼接 |
| C2（选键规则不变：脊柱 ∪ 终点子树后代 ∪ 闭包别名内部） | M1/M2/M5 覆盖闭包别名腿；M3/M4/M5(内联项)/M6(内联 Record 值) 覆盖终点子树腿（`aliases == []` 时仍必须命中）；M8 覆盖空路径全量 |
| C5（四件套形状不变） | C7 断言 ok 分支恰 5 键（M4 schema 亦然） |
| C6（detached 克隆零改动） | 实现契约零改动 namespace-runtime；克隆器 `cloneDocsRecord` 对 docs 条目泛化深拷贝（`packages/namespace-runtime/src/read-schema-projection.ts:216–220` 结构核验） |
| C9（无 M4 逐字节不变） | C1/C2/C3 冻结摘要逐字节对照（含 memberDocs 键缺席的剥离克隆） |
| F1（ADR 0016 正文回写缺口） | 非测试项；建议随实现票落 ADR 0016 dated 增补节（自包含，不影响本契约红/绿） |
| F2（集成支中间态） | 已知并接受（#305 同支累积设计），本契约不引入规范正文断言 |
| F3.1（可信域形状守卫**不得**把 memberDocs 加入必填清单） | C3/C6 以「无 memberDocs 键的派生物必须照常解析」锚定 |
| F3.2（member-only 键的插入序未被 ADR 冻结） | M8 用 `toEqual`（键序不敏感）；C1–C3 的逐字节摘要只用于 memberDocs 缺席/无贡献的 M4-free 面（不涉及新键序） |
| F3.3（合并只发生在 docs 表层面） | C8 冻结 M4 fixture 的 `valueSchema`/`aliases`/`aliasDocs` 摘要不变 |

---

## 4. Environment and baseline

| 项 | 值 |
|---|---|
| HEAD | `4d4208b3393cec8b655e7aadeb5cae47aa712c74`（`fix(#306): … IR/derived memberDocs (#313)`） |
| 分支 / worktree | `mabf/issue-308` / `/home/wangjian/nomicore-fix-issue-308` |
| Node / pnpm | `v24.13.0` / `10.28.2`（仓库 engines ≥20） |
| 依赖 | `pnpm install --frozen-lockfile --offline` 成功（65 包，全部复用本地 store；无网络依赖） |
| 生产实现改动 | **无**（起点 `git status` 仅 Host 拥有的两份未跟踪 brief；SA6 未改任何生产文件） |
| 基线测试（变更前） | `pnpm vitest run packages/vfsl/test/resolve-schema-at-path.test.ts packages/vfsl/test/resolve-schema-at-path-control.test.ts packages/vfsl/test/resolve-schema-at-path-pattern-errors.test.ts packages/vfsl/test/evaluate-derived-member-docs.test.ts --typecheck` → **4 files / 55 tests passed；Type Errors 无**（exit 0） |
| 基线类型检查 | `npx tsc -p packages/vfsl/tsconfig.json` → OK；根 `pnpm typecheck`（14 个 tsconfig，含 apps/yjs-server）→ OK（exit 0） |
| 解析/求值前置 | #306 已把 M4 落到 IR/derived（`memberDocs` 条件稀疏表在场，键 23 个；本契约 fixture 实测） |

---

## 5. Positive reproduction（能力缺口：旧实现红灯证据）

**最小输入**：`M4_TEXT`（§12.1，逐字节固定；23 个 `<member N>` 成员 doc，覆盖别名联合/别名枚举/内联联合/内联枚举/数组元素/Record 值位/M3+member 同键）。派生 schema 由公共入口 `parseVfsl` → `evaluate` 产出（确定性，无服务、无 I/O）。

**观察**：`resolveSchemaAtPath(derived, P)` 全部 `ok:true`（路径解析成功、`valueSchema` 与 `aliases` 均正确），但 `docs` 缺失/错误。

| 读路径 P | 旧实现 `docs`（实测） | 目标 `docs`（AC1） | 红因 |
|---|---|---|---|
| `["s"]`（别名枚举终点） | `{}` | `Status.<member 0/1>` | memberDocs 未消费 |
| `["u"]`（别名联合终点） | `{}` | `U.<member 0/1>` | 同上 |
| `["m"]`（marker 成员联合终点） | `{"Mixed.<member 0>":[" 载体甲 "]}` | `{"Mixed.<member 0>":[" 载体甲 "," 成员甲 "]}` | 三来源缺 member 且合并序无从体现 |
| `["items"]` / `["items",0]` | `{}` | `Choice.<member 0/1>` | 同上 |
| `["pair"]`（内联联合终点，闭包空） | `{}` | `ROOT.pair.<member 0/1>` | 同上（且证明只靠终点子树腿也必须命中） |
| `["mode"]`（内联枚举终点，闭包空） | `{}` | `ROOT.mode.<member 0/1>` | 同上（枚举值树无成员结构，键只能来自 memberDocs 表） |
| `["inlineItems"]` / `["inlineItems",0]` | `{}` | `ROOT.inlineItems.<item>.<member 0/1>` | 同上 |
| `["recInline","k1"]` | `{}` | `ROOT.recInline.<key>.<member 0/1>` | 同上 |
| `["inl"]` / `["inlEnum"]` / `["inlItems"]` / `["inlItems",0]` / `["inlRec","k1"]` | `{}` | `Inl.*` / `InlEnum.*` / `InlItem.<item>.*` / `InlRec.<key>.*` | 同上 |
| `[]`（ROOT 全量） | `{"Mixed.<member 0>":[" 载体甲 "]}` | 23 个 member 键（含 Mixed marker+member 合并） | 同上 |

**红因非环境/夹具/入口错误的反证**：同一调用在旧实现下 `ok:true`、`valueSchema`/`aliases`/`aliasDocs` 全部与目标前置一致，仅 `docs` 不满足断言；`evaluate` 为绿色基线（`memberDocs` 表 23 键在场）；路径均为既有测试同款公共入口取得。

**实测片段**（`M4_TEXT` + 公共入口，旧实现，HEAD 4d4208b）：

```
### memberDocs: {"ROOT.pair.<member 0>":[" 内联甲 "],…,"Status.<member 0>":[" 草稿：可继续编辑 "],"Status.<member 1>":[" 已提交：只可追加备注 "],"U.<member 0>":[" 变体甲 "],"U.<member 1>":[" 变体乙 "],"Mixed.<member 0>":[" 成员甲 "],…}
### markerDocs: {…,"Mixed.<member 0>":[" 载体甲 "],"Mixed.<member 1>":[],…}
### values kinds: {"ROOT":"object","Status":"enum","U":"union","Mixed":"union","Choice":"enum","Inl":"union","InlEnum":"enum","InlItem":"array","InlRec":"object"}
PATH []               aliases=[Status,U,Mixed,Choice,Inl,InlEnum,InlItem,InlRec] vs=object docs={"Mixed.<member 0>":[" 载体甲 "]} aliasDocs={"Status":[" 订单生命周期状态 "]}
PATH ["s"]            aliases=["Status"] vs=ref    docs={}      aliasDocs={"Status":[" 订单生命周期状态 "]}
PATH ["u"]            aliases=["U"]      vs=ref    docs={}
PATH ["m"]            aliases=["Mixed"]  vs=ref    docs={"Mixed.<member 0>":[" 载体甲 "]}
PATH ["pair"]         aliases=[]         vs=union  docs={}
PATH ["mode"]         aliases=[]         vs=enum   docs={}
PATH ["inlineItems",0] aliases=[]        vs=enum   docs={}
PATH ["recInline","k1"] aliases=[]       vs=enum   docs={}
（其余 7 条路径 ["items"]/["items",0]/["inl"]/["inlEnum"]/["inlItems"]/["inlItems",0]/["inlRec","k1"] 与 [] 的实测见上表与 §12.2）
```

---

## 6. Negative control

以下控制在旧实现即绿，实现后必须保持绿（全部经公共入口观察，无源码/字符串断言）：

| 控制 | 内容 | 旧实现实测 |
|---|---|---|
| C1 M4-free 逐字节 | `FIXTURE_TEXT`（`resolve-schema-at-path-fixture.ts`）6 条读路径的 `sha256(JSON.stringify(resolve结果))` == 冻结摘要 | 绿（摘要见 §12.4） |
| C2 存量金样本逐字节 | `SPEC_FIXTURE` 4 条 + `FIXTURE_B` 3 条读路径冻结摘要 | 绿 |
| C3 memberDocs 键缺席（剥离克隆） | 对 `M4_TEXT` 派生物删 `memberDocs` 键后 17 条读路径冻结摘要 | 绿（§12.4 表 2） |
| C4 空条目过滤不变 | 手造克隆把 `memberDocs['U.<member 0>']` 置 `[]` → `["u"]` 的 `docs` **不得含 `'U.<member 0>'` 键**（仅断言缺席；`'U.<member 1>'` 的在场由 M1 锚定） | 绿（旧实现天然缺席；实现后须仍为空合并过滤） |
| C5 未选中键不泄漏 | 手造 `memberDocs = {"Unrelated.<member 0>":[" 不应出现 "]}` → 契约路径集内不得出现该内容/键 | 绿 |
| C6 守卫不得要求 memberDocs | 无 `memberDocs` 键的派生 schema 与含表的派生 schema 均 `ok:true`（SA8 F3.1） | 绿 |
| C7 形状/确定性/可序列化 | ok 分支恰 5 键 `{ok,valueSchema,aliases,docs,aliasDocs}`；同输入两次调用全等；`JSON.parse(JSON.stringify(r))` 往返全等 | 绿 |
| C8 非 docs 部分不变（M4 schema） | `sha256(JSON.stringify({valueSchema,aliases,aliasDocs}))` == 冻结摘要（16 条路径） | 绿 |
| C9 既有测试零改动仍绿 | 既有 `resolve-schema-at-path*.ts` 断言（含 L449–485「docs 键 ⊆ fieldDocs∪markerDocs 且内容 = field+marker」不变量，M4-free 夹具）不得被修改/弱化 | 绿（55 tests） |

**对抗性/敏感度**（实现若走偏，哪条断言先红）：只接闭包别名腿 → M3/M4/M5(内联项)/M6(内联 Record 值) 红；只接终点子树腿 → M1/M2/M5(别名数组)/M8 红；合并序反了 → M7 红；丢空条目过滤 → M7 + C4 红；把 `memberDocs` 加入守卫必填清单 → C1/C2/C3/C6 红；动了非 docs 部分 → C8 红；改了 M4-free 输出（新增空条目/键序漂移）→ C1/C2 红。

---

## 7. Stability, scale and timing

- **确定性**：同输入两次调用 JSON 全等（`["m"]` 实测 `true`）；解析为同步纯函数、无服务/无时钟/无并发面。
- **规模曲线**（旧实现，基线；inline enum 字段 N 个 → memberDocs 2N 键，读 `["f<N-1>"]` 500 次均值）：N=10（20 键）9.77 µs/次；N=100（200 键）19.80 µs/次；N=400（800 键）53.65 µs/次 → 近线性、无爆炸；断言不设时限，不与超时竞争。
- **单测规模**：契约夹具 23 member 键 + 16 条契约读路径（另 1 条 `['u','x']` 为不冻结观察路径），毫秒级；`--typecheck` 面为既有 test-d。
- **复现率**：100%（确定性纯函数，重复运行结果一致）。

---

## 8. Root-cause chain / capability gap

| Step | Fact | Evidence | Confidence |
|---|---|---|---|
| 症状 | M4 schema 的联合/枚举端点读，投影 `docs` 不含 `<member N>` 键（甚至完全为空） | §5 实测矩阵（16 路径） | 高 |
| 直接故障点 | `sliceDocs()` 只遍历 `derived.fieldDocs` 与 `derived.markerDocs` 两张表（`Object.keys` 两遍扫描），第三来源 `derived.memberDocs` 从未被读取 | 行为实测（memberDocs 23 键在场而 docs 不出现）+ 源码位置 L447–457 | 高 |
| 触发条件 | 模块使用 M4（`memberDocs` 条件键在场）且读路径落在联合/枚举的**既有选键范围**（终点子树后代 或 闭包别名内部） | M1–M8：`aliases` 公开可见（闭包腿）；`aliases==[]` 的内联路径证明终点腿 | 高 |
| 最深根因 | #306 交付面止于 IR/derived 表（parser→semantic→evaluate），投影消费侧接线属 #308（ADR 0019 §7 明列的 `resolve-schema-at-path.ts（sliceDocs 第三来源）`）——**能力缺口=接缝缺失**，非回归 Bug | 本支 git 历史（`4d4208b` 为 #306 实现提交，docs 合并未动）；ADR 0019 Consequences 实现改动面清单 | 高 |
| 放大因素 | 无（缺口只造成 `<member N>` 键缺失，不改动其它键、值树、别名闭包与 aliasDocs） | C8 非 docs 摘要全绿；C1/C2 逐字节全绿 | 高 |
| 未证实假设 | 无遗留：三源在场性、键文法、守卫清单、克隆通道均以实测/结构核验闭口 | 见 §9 | — |
| 排除项 | ① M4 解析/derived 收集缺失 → 实测 memberDocs 23 键、内容逐字；② 路径解析失败 → 全 `ok:true` 且 `valueSchema` 正确；③ 形状守卫拒绝 → `memberDocs` 不在必填清单，调用未 throw；④ detached 克隆丢条目 → 克隆器按 `Object.keys(rec)` 泛化处理 docs 条目；⑤ 空条目过滤/键序假设 → M4-free 摘要与既有测试全绿 | §5/§6/§9 | 高 |

**能力缺口一句话**：`resolveSchemaAtPath` 的 docs 切片消费面（两来源）落后于派生物面（四表），`memberDocs` 表存在但不可达公共投影。

---

## 9. Causal experiments（控制变量）

1. **表在场性对照**：同一 `evaluate` 产物同时暴露 `memberDocs`（23 键）与投影 `docs`（M4 相关键 0 个，除 Mixed 的 M3 条目）→ 排除「表未收集」。
2. **路径成功性对照**：16 条契约路径全 `ok:true`、`valueSchema` 与 `aliases` 与目标前置一致 → 排除「路径解析/夹具错误」。
3. **选键腿分离对照**：`["pair"]`/`["mode"]`/`["inlineItems",0]`/`["recInline","k1"]` 的 `aliases == []`（终点子树腿独立可判）；`["s"]`/`["u"]`/`["inl"]` 的 `aliases == ["<别名>"]`（闭包腿独立可判）→ 两腿都必须由第三来源扫描承压，不能以单一腿实现蒙混。
4. **表剥离对照**：删 `memberDocs` 键后同派生形状 17 路径结果与旧实现逐字节相同（摘要冻结，§12.4）→ 证明「缺席即惰性」，同时给 AC2 提供与 M4 schema 同形的对照组。
5. **合并序对照**：`Mixed` 成员同时有 `markerDocs['Mixed.<member 0>']=[' 载体甲 ']` 与 `memberDocs['Mixed.<member 0>']=[' 成员甲 ']`；旧实现只出 marker 条目 → 目标必须 `[' 载体甲 ',' 成员甲 ']`（M7）；`Mixed.<member 1>` 三源合并为空 → 必须过滤（旧/新同判，C4 同构控制）。
6. **空条目/未选中对照**（手造派生物）：C4 空数组合并必须过滤；C5 未选中键不得泄漏 → 排除「见表即全量倾倒」的伪实现。
7. **规模对照**：N=10/100/400 曲线近线性 → 排除性能性红。

---

## 10. Impact surface

| 面 | 影响 | 证据 |
|---|---|---|
| `resolveSchemaAtPath` 返回 `docs` | 仅新增 `<member N>` 键条目（M4 输入）；M4-free 输入逐字节不变 | C1/C2/C3 + M8 |
| `valueSchema`/`aliases`/`aliasDocs` | 零变化 | C8 冻结摘要 |
| 公共类型 `ReadDataSchemaProjection` | 零变化（四件套；`memberDocs` 只是 `DerivedSchema` 可选键，属 #306 已落地面） | `packages/vfsl/src/resolve-schema-at-path.ts:49–58`；既有 test-d 绿 |
| `namespace-runtime` detached 克隆 | 零改动：`cloneDocsRecord` 泛化遍历 docs 条目 | `packages/namespace-runtime/src/read-schema-projection.ts:106–114,216–220` |
| `namespace-registry` / 下游 docs 契约测试 | 无 M4 输入，零影响 | `grep memberDocs` 于 registry/runtime 测试为空 |
| 实现改动面 | `packages/vfsl/src/resolve-schema-at-path.ts`（`sliceDocs` + L54 类型注释措辞）；文档面 ADR 0016 增补节（SA8 F1 建议同票） | ADR 0019 Consequences |

---

## 11. Ruled-out hypotheses

1. **「memberDocs 未在 derived 落地」** —— 实测条件稀疏表 23 键、内容逐字（`evaluate` 绿色基线；#306 已合入）。
2. **「投影路径解析失败导致 docs 空」** —— 契约路径全 `ok:true` 且 `valueSchema` 正确。
3. **「可信域守卫拒绝含 memberDocs 的派生物」** —— 守卫清单不含该键，含表/无表派生物均解析成功（C6）。
4. **「detached 克隆会吞掉新条目」** —— 克隆器按键泛化深拷贝，条目随表流过（结构核验 + C6 路径可用）。
5. **「空条目过滤/键序规则需要改」** —— ADR 0019 §7 明示不变；M4-free 摘要与既有不变量测试全绿。
6. **「红是夹具/期望漂移」** —— 期望值由 `evaluate` 运行时输出生成并对账（期望键全部 ∈ memberDocs 表、内容 = 三源逐字拼接，探针实测 `true`）。
7. **「深读路径也必须带 member docs」** —— 非 AC 要求；ADR 0019 §7「选键规则不变」下不为既有规则所蕴含（见 §15），本契约不冻结，避免伪红。

---

## 12. Acceptance contract（可直接转写的可执行契约）

> 按派发指令，SA6 本轮**不编写测试文件**；以下为逐用例规格。实现票按其转写为测试后，必须复现本节红/绿判定。契约测试落点（真实 runner 收件目录，`vitest.config.ts` include = `packages/*/test/**/*.test.ts`）：

| 文件 | 性质 | 说明 |
|---|---|---|
| `packages/vfsl/test/resolve-schema-at-path-member-docs-fixture.ts` | fixture（数据，不被收集） | `M4_TEXT` + `EXPECTED_DOCS` + 冻结摘要常量 |
| `packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts` | **红契约**（M1–M9） | 旧实现红、实现后绿 |
| `packages/vfsl/test/resolve-schema-at-path-member-docs-control.test.ts` | **负控**（C1–C9） | 旧实现绿、实现后必须仍绿 |

### 12.1 fixture 文本（逐字节固定，不得改动）

```ts
export const M4_TEXT = [
  'type ROOT = YMap<{',
  '  s: Status;',
  '  u: U;',
  '  m: Mixed;',
  '  items: YArray<Choice>;',
  '  pair: /** 内联甲 */ { kind: "a"; n: YLeaf<string> } /** 内联乙 */ | { kind: "b"; m: YLeaf<number> };',
  '  mode: /** 开 */ "on" /** 关 */ | "off";',
  '  inlineItems: YArray</** 元素甲 */ "p" /** 元素乙 */ | "q">;',
  '  recInline: Record<string, /** 记录甲 */ "x" /** 记录乙 */ | "y">;',
  '  inl: Inl;',
  '  inlEnum: InlEnum;',
  '  inlItems: InlItem;',
  '  inlRec: InlRec;',
  '}>;',
  '/** 订单生命周期状态 */',
  'type Status =',
  '  /** 草稿：可继续编辑 */',
  '  | "draft"',
  '  /** 已提交：只可追加备注 */',
  '  | "submitted"',
  '  | "archived";',
  'type U =',
  '  /** 变体甲 */',
  '  | { kind: "a"; x: YLeaf<string> }',
  '  /** 变体乙 */',
  '  | { kind: "b"; y: YLeaf<number> };',
  'type Mixed = /** 成员甲 */ | /** 载体甲 */ YLeaf<string> | YLeaf<number>;',
  'type Choice =',
  '  /** 选项甲 */',
  '  | "p"',
  '  /** 选项乙 */',
  '  | "q";',
  'type Inl = /** 别名内联甲 */ { kind: "a"; n: YLeaf<string> } /** 别名内联乙 */ | { kind: "b"; m: YLeaf<number> };',
  'type InlEnum = /** 别名开 */ "on" /** 别名关 */ | "off";',
  'type InlItem = YArray</** 别名元素甲 */ "p" /** 别名元素乙 */ | "q">;',
  'type InlRec = Record<string, /** 别名记录甲 */ "x" /** 别名记录乙 */ | "y">;',
].join('\n');
```

（`join('\n')` 后即探针使用的文本；派生 `memberDocs` 键 23 个、`markerDocs['Mixed.<member 0>']=[' 载体甲 ']`、`values` kinds 见 §5。）

### 12.2 红契约用例（旧实现必须红；用例名建议逐字采用括号内 ID）

断言一律经公共入口：`parseVfsl(M4_TEXT)` → `evaluate`（前置：`ok:true`）→ `resolveSchemaAtPath`。每条断言用 `expect(r.docs).toEqual(<目标>)`（键序不敏感）与 `expect(r.aliasDocs).toEqual(...)`。

| ID | 输入 P | 目标 `docs`（逐字） | 目标 `aliasDocs` / 其它 |
|---|---|---|---|
| M1 | `['u']` | `{'U.<member 0>':[' 变体甲 '],'U.<member 1>':[' 变体乙 ']}` | `{}`；`valueSchema = {kind:'ref',name:'U'}`；别名闭包 `['U']` |
| M2 | `['s']` | `{'Status.<member 0>':[' 草稿：可继续编辑 '],'Status.<member 1>':[' 已提交：只可追加备注 ']}` | `{'Status':[' 订单生命周期状态 ']}`；`valueSchema` ref Status（**枚举无成员结构：键只能从 memberDocs 表按 `<member N>` 回填**） |
| M3 | `['pair']` | `{'ROOT.pair.<member 0>':[' 内联甲 '],'ROOT.pair.<member 1>':[' 内联乙 ']}` | `{}`；别名闭包 `[]`（证明终点子树腿独立成立） |
| M4 | `['mode']` | `{'ROOT.mode.<member 0>':[' 开 '],'ROOT.mode.<member 1>':[' 关 ']}` | `{}`；`valueSchema = {kind:'enum',values:['on','off']}`；闭包 `[]` |
| M5a | `['items']` 与 `['items',0]` | 两者均 `{'Choice.<member 0>':[' 选项甲 '],'Choice.<member 1>':[' 选项乙 ']}` | `{}` |
| M5b | `['inlItems']` 与 `['inlItems',0]` | `['inlItems']` → `{'InlItem.<item>.<member 0>':[' 别名元素甲 '],'InlItem.<item>.<member 1>':[' 别名元素乙 ']}`；`['inlItems',0]` → `{'InlItem.<item>.<member 0>':[' 别名元素甲 '],'InlItem.<item>.<member 1>':[' 别名元素乙 ']}` | `{}` |
| M6 | `['recInline','k1']`；`['inlRec','k1']` | `{'ROOT.recInline.<key>.<member 0>':[' 记录甲 '],'ROOT.recInline.<key>.<member 1>':[' 记录乙 ']}`；`{'InlRec.<key>.<member 0>':[' 别名记录甲 '],'InlRec.<key>.<member 1>':[' 别名记录乙 ']}` | `{}`；两路径闭包均 `[]` |
| M7 | `['m']` | `{'Mixed.<member 0>':[' 载体甲 ',' 成员甲 ']}`（**marker 在前、member 在后**；JSON 序列化须逐字含两元素次序） | `{}`；`Mixed.<member 1>` 三源合并为空 → 不得成键 |
| M8a | `['inl']` / `['inlEnum']` | `{'Inl.<member 0>':[' 别名内联甲 '],'Inl.<member 1>':[' 别名内联乙 ']}` / `{'InlEnum.<member 0>':[' 别名开 '],'InlEnum.<member 1>':[' 别名关 ']}` | `{}` |
| M8b | `[]` | 23 键全量（见 12.3） | `{'Status':[' 订单生命周期状态 ']}`；别名闭包 = 8 名（顺序同旧实现 `['Status','U','Mixed','Choice','Inl','InlEnum','InlItem','InlRec']`） |
| M9a | 契约路径全集 | 对每条路径：凡 `k` 满足「锚名 ∈ `Object.keys(r.aliases)` 且 `k === a || k.startsWith(a + '.')`」的 `memberDocs` 键，`r.docs[k]` 必须等于三源逐字拼接 | 机械断言，覆盖闭包腿全路径 |
| M9b | 契约路径全集 | `docs` 键 ⊆ `fieldDocs ∪ markerDocs ∪ memberDocs` 键；每键内容 `=== [...(fieldDocs[k]??[]), ...(markerDocs[k]??[]), ...(memberDocs[k]??[])]`；`aliasDocs` 键/内容 ⊆ 与表逐字一致 | 同族不变量（M4-free 版见既有测试 L449–485，保持不动） |

补充前提断言（绿，两文件均可）：`Object.keys(memberDocs).every(k => fieldDocs[k] === undefined)`（ADR 0019 §7「fieldDocs 在 `<member N>` 键上**恒无条目**」——实测成立：`memberDocs` 23 键中 0 键有 fieldDocs 条目；注意不能用子串判据，成员内部字段键如 `ROOT.pair.<member 0>.kind` 合法含 `<member ` 子串）；`Object.keys(markerDocs).filter(k => (markerDocs[k] ?? []).length > 0 && memberDocs[k] !== undefined)` = `['Mixed.<member 0>']`（M7 唯一同键双非空位）；`memberDocs` 键数 = 23。

### 12.3 `[]` 读的目标 `docs`（23 键，逐字）

```ts
{
  'ROOT.pair.<member 0>': [' 内联甲 '],
  'ROOT.pair.<member 1>': [' 内联乙 '],
  'ROOT.mode.<member 0>': [' 开 '],
  'ROOT.mode.<member 1>': [' 关 '],
  'ROOT.inlineItems.<item>.<member 0>': [' 元素甲 '],
  'ROOT.inlineItems.<item>.<member 1>': [' 元素乙 '],
  'ROOT.recInline.<key>.<member 0>': [' 记录甲 '],
  'ROOT.recInline.<key>.<member 1>': [' 记录乙 '],
  'Status.<member 0>': [' 草稿：可继续编辑 '],
  'Status.<member 1>': [' 已提交：只可追加备注 '],
  'U.<member 0>': [' 变体甲 '],
  'U.<member 1>': [' 变体乙 '],
  'Mixed.<member 0>': [' 载体甲 ', ' 成员甲 '],
  'Choice.<member 0>': [' 选项甲 '],
  'Choice.<member 1>': [' 选项乙 '],
  'Inl.<member 0>': [' 别名内联甲 '],
  'Inl.<member 1>': [' 别名内联乙 '],
  'InlEnum.<member 0>': [' 别名开 '],
  'InlEnum.<member 1>': [' 别名关 '],
  'InlItem.<item>.<member 0>': [' 别名元素甲 '],
  'InlItem.<item>.<member 1>': [' 别名元素乙 '],
  'InlRec.<key>.<member 0>': [' 别名记录甲 '],
  'InlRec.<key>.<member 1>': [' 别名记录乙 '],
}
```

（键序不作断言，`toEqual` 即可；条目值为新数组，内容逐字含前导/尾随空白。）

### 12.4 冻结摘要（录制于实现前 HEAD `4d4208b`；`sha256(JSON.stringify(X))`）

**表 1 — M4-free 夹具整投影逐字节（AC2；C1/C2）**

| fixture | 读路径 | sha256 |
|---|---|---|
| `FIXTURE_TEXT` | `[]` | `5c2eb58e98e87b3f1ce1624ee8a8d5c13830299d4d3684b9d07f32c8f0d234ce` |
| `FIXTURE_TEXT` | `['notes']` | `fd64ebfcd5191e1238a0ad1cf8cdfc0da8cfb9ffd220c541cca75515f38f0330` |
| `FIXTURE_TEXT` | `['audit']` | `0522bec4126c4361a2f6058d0b175b81d3e7855f6958e79114fdcf1915c630dd` |
| `FIXTURE_TEXT` | `['assets','img1']` | `1fdd6ec9abc63cf7887aca8cc53269f35834eed92bad1149ab97a3afd5670c4d` |
| `FIXTURE_TEXT` | `['u','x']` | `2b26ffb93924762a88a2a015c27c38f299f50f2bc3e4739efa7e7f94d2886af3` |
| `FIXTURE_TEXT` | `['attachments']` | `88b6c9c4604c6de95db49906ac45c11e9830a7376895d7400a0b67dc5df9cf8f` |
| `SPEC_FIXTURE` | `[]` | `e5108899fa5446198e797c2208297622630accdb7754cc15c056375cce0ef7c1` |
| `SPEC_FIXTURE` | `['assets','a1']` | `ac094f7dc346b584dbfebf5e016ab6e26b1067a2e5cf0cb44c4c4105388e140e` |
| `SPEC_FIXTURE` | `['attachments']` | `07874c397c0a2f99b66cd09ce3306efd4f195e5f6d85fd9a8f49062852ffcc71` |
| `SPEC_FIXTURE` | `['notes']` | `22146f45aaf66c5b663987720b9066f2b522dff974be3b6b2269a3541c2636df` |
| `FIXTURE_B` | `[]` | `2b8405a618f1f340e9ea35252018f9aba3530cf24796892338a4fbe406f9823f` |
| `FIXTURE_B` | `['u']` | `286a8e77aec177e798df972c748a63dd53d7599c54f66c011dfc7c2274a1e8b7` |
| `FIXTURE_B` | `['v','deep',0,'k']` | `f2f7325afdcc2d5c7156e5db5142dd382a2d558f30c8639dbf1b75a638f1862f` |

**表 2 — `M4_TEXT` 派生物剥离 `memberDocs` 键后整投影（C3；表缺席惰性对照）**

| 读路径 | sha256 | 读路径 | sha256 |
|---|---|---|---|
| `[]` | `e420517ef5ae0b9af486042c35a71f3d4b894d280613eaf08633084e3484f1f4` | `['pair']` | `6189ad7dba5deb39848374bfbcfee39c9bebe4c214fc0e3a96b02f3e5d0fe32f` |
| `['s']` | `1a9a6ca740ed6e1a8a645a79b00bdb51fb6c7bbfa2bf7350d20a8c6d50ab17e5` | `['mode']` | `a7ceb3f785274e34e1844485fd4686963066070caa2b057c00bb1d7358c461d5` |
| `['u']` | `aa281a1148a71a5838318e3ebeb5d229facd1612f51bc1dfa05610c11de6d216` | `['inlineItems']` | `f74887240cbffa3cd51b2747469a996c484772ce804cfa87b283b992b1823650` |
| `['m']` | `d171a634ca297d854aaf752a6caee4bb891e8965c6b568912434cd6dc5a2ed89` | `['inlineItems',0]` | `f2f7325afdcc2d5c7156e5db5142dd382a2d558f30c8639dbf1b75a638f1862f` |
| `['items']` | `dd0bcb0b8b6ae0f9bdc9d28daae855a27bd1b0cc430e7b6df3d3eb57e038f854` | `['recInline','k1']` | `979d2201ed0a05d62d5a17c6fb17d2b168f4abb52061a956fc0ae947f948322c` |
| `['items',0]` | `767f4b5a201004bd8196b64dcbaca2af45b459a8cbaeb857d08e71006feff628` | `['inl']` | `f8b1d570eeaf25754b050c8de71441d186c6651081487b37c8b9c9b23377c467` |

（余下：`['inlEnum']` = `971d4745b481ad80a3212c55cef6303c42aa3ec76f2365a22c41ed0da645660e`；`['inlItems']` = `7254649d1004a44ccf7c8432b1dbe45e1341509208973ebcf83f4656050b88f4`；`['inlItems',0]` = `f2f7325afdcc2d5c7156e5db5142dd382a2d558f30c8639dbf1b75a638f1862f`；`['inlRec','k1']` = `979d2201ed0a05d62d5a17c6fb17d2b168f4abb52061a956fc0ae947f948322c`；`['u','x']` = `2417f648bb65657d8840508d9db806185ffdde7357756a1919b55a618e5ece37`。）

**表 3 — `M4_TEXT` 非 docs 部分不变（C8；`sha256(JSON.stringify({valueSchema, aliases, aliasDocs}))`）**

| 读路径 | sha256 | 读路径 | sha256 |
|---|---|---|---|
| `[]` | `99e628e255972871d56a122a53f10466f1c8d9fcda008bd3793099649f2d80e9` | `['inlineItems']` | `452695fab6a275c92c3739c8eff9f39cd6420e9c467d031a64b1a1f2ca36f1b8` |
| `['s']` | `c4bc5d4011e9a0bf1ff7f6d3ca0d820800fb7ba3fc1970d45e88b2543289eacf` | `['inlineItems',0]` | `e0b219dfad8d943176866e653b01604a789d5be8b2b4a416be05161bd2ed7160` |
| `['u']` | `3f7ad22db59f4a1972552ca242d4df511261f0ab27435628ac48df25766db080` | `['recInline','k1']` | `beede5499397c854e680e37087e32c3315660dd2b442aad22d02f534ce2a3a5e` |
| `['m']` | `9438f9a2693accb75bd494677d199fdab55037b0762d1889bb82806b70157f68` | `['inl']` | `9bad89f317327d6d5bbede1c4020ea2af55146d9c5b457ba846314b43d1c09de` |
| `['items']` | `ebae36038e80e96f0e0695bb813e3e32717f658061a28211114965300d411519` | `['inlEnum']` | `cff9579ee2732c39c3eb4d368059957ad1aee1e4aaf4a3947a445e97cd402a8f` |
| `['items',0]` | `df8347bb75a19700ea793d2f043de3ccf01093cf15a913046d083a76e6ccaeb4` | `['inlItems']` | `cbef1b06a4fe23ef2561971a00eea0515968aa246f53123bbe3f6fc435c80f60` |
| `['pair']` | `c0acd96799a91f75f4f14e4ca9b0d01a876875c21e8cb008e34c3f3426db4dc9` | `['inlItems',0]` | `e0b219dfad8d943176866e653b01604a789d5be8b2b4a416be05161bd2ed7160` |
| `['mode']` | `169dad66cccbcd8338a23ad7ba25433430e350e28a8d665d18de01fcf36f083f` | `['inlRec','k1']` | `beede5499397c854e680e37087e32c3315660dd2b442aad22d02f534ce2a3a5e` |

### 12.5 负控用例（C1–C9，实现前后均须绿）

见 §6 表；断言口径：

- C1/C2/C3：`sha256(JSON.stringify(resolveSchemaAtPath(derived, p)))` 逐路径 == 冻结摘要（表 1/表 2）；并额外断言 `Object.keys(r.docs).every(k => !k.includes('<member '))`（M4-free 面不得出现成员键）。
- C4：`const d = clone(m4Derived); d.memberDocs['U.<member 0>'] = [];` → `expect(r.docs['U.<member 0>']).toBeUndefined()` 且 `expect(Object.keys(r.docs)).not.toContain('U.<member 0>')`（空合并条目不得成键；`'U.<member 1>'` 在场由 M1 覆盖）。
- C5：`d.memberDocs = {'Unrelated.<member 0>':[' 不应出现 ']}` → 契约路径集内 `JSON.stringify(r.docs)` 不得含 `不应出现`；`['m']` 仍 `toEqual({'Mixed.<member 0>':[' 载体甲 ']})`。
- C6：剥离克隆与原文派生物均 `ok:true`（守卫清单不含 `memberDocs`）。
- C7：`Object.keys(r).sort()` `toEqual(['aliasDocs','aliases','docs','ok','valueSchema'])`；两次调用全等；JSON 往返全等（契约路径全集）。
- C8：表 3 摘要逐路径相等。
- C9：**禁止修改既有测试文件**（`resolve-schema-at-path*.ts`、`evaluate-derived-member-docs.test.ts`、两个既有 fixture）；实现后原样运行仍绿（既有不变量测试对 M4-free 夹具继续成立）。

### 12.6 判定与验收出口

- 旧实现：M1–M9 红（证据 §5，实测逐条在目标断言处失败）；C1–C9 绿。
- 目标实现：M1–M9 绿且 C1–C9 绿；`packages/vfsl/test/resolve-schema-at-path*.ts` 全量绿；`npx tsc -p packages/vfsl/tsconfig.json` 与根 `pnpm typecheck` 绿。
- 实现范围：`packages/vfsl/src/resolve-schema-at-path.ts`（`sliceDocs` 第三来源 + L54 注释措辞）；不得改 `DerivedSchema`/守卫清单/克隆器/既有测试。

---

## 13. Red/green or baseline evidence

| 断言组 | 旧实现（HEAD `4d4208b`） | 依据 | 目标实现 |
|---|---|---|---|
| M1–M8（端点/载体/合并序/全量逐字） | **红**：16 条契约路径逐条在目标断言处失败（缺失条目并集 = 全部 23 个 member 条目；`Mixed.<member 0>` 仅 marker 一元素） | §5 实测（探针，退出码 0） | 绿 |
| M9a/M9b（闭包腿机械不变量 + 三源拼接） | **红**：`['s']` 闭包锚 `Status.` 下 2 键缺失；`[]`/`['m']` 拼接对比缺 member 内容 | 探针实测 `MISSING_OR_WRONG` 列表（[] 23 条、["s"] 2 条…） | 绿 |
| C1–C3（逐字节冻结） | 绿（摘要录制于旧实现） | 探针实测 | 绿（必须不变） |
| C4–C7（过滤/不泄漏/守卫/形状） | 绿（旧实现天然满足；实现后必须保持） | 探针 H2/H3/H4/H5 实测 | 绿 |
| C8（非 docs 不变） | 绿 | 探针摘要 | 绿 |
| C9（既有 55 测试） | 绿（4 files / 55 tests / Type Errors 无） | §14 运行记录 | 绿 |

契约敏感度（反证）：若实现只做「见 memberDocs 即全量倾倒」→ C5/C1 红；只接闭包腿 → M3/M4/M5b/M6 红；只接终点腿 → M1/M2/M5a/M8a 红；合并序错 → M7 红；动非 docs → C8 红。

---

## 14. Runner trigger evidence

| 证据 | 命令 | 结果 |
|---|---|---|
| 收件模式 | `vitest.config.ts`：`include: ['packages/*/test/**/*.test.ts', …]`；`typecheck.include: ['packages/*/test/**/*.test-d.ts']` | 新增 `packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts` / `-control.test.ts` / `-fixture.ts`（fixture 非 `.test.ts` 不被收集）必然被收集 |
| runner 列举 | `npx vitest list` | 列出 `resolve-schema-at-path.test.ts`、`-control.test.ts`、`-pattern-errors.test.ts`、`-schema-at-path.test-d.ts` 全部用例（52 行匹配；exit 0） |
| 基线聚焦运行 | `pnpm vitest run packages/vfsl/test/resolve-schema-at-path.test.ts packages/vfsl/test/resolve-schema-at-path-control.test.ts packages/vfsl/test/resolve-schema-at-path-pattern-errors.test.ts packages/vfsl/test/evaluate-derived-member-docs.test.ts --typecheck` | 4 files / 55 tests passed；`Type Errors 无 errors`；exit 0 |
| 包类型检查 | `npx tsc -p packages/vfsl/tsconfig.json` | OK（exit 0） |
| 根类型检查 | `pnpm typecheck`（14 个 tsconfig 串行） | OK（exit 0） |
| AC3 落地命令（实现后必跑） | 上述聚焦运行命令 + 包/根 typecheck；`packages/vfsl/AGENTS.md`「focused changes：包类型检查 + VFSL 相关测试」门槛满足 | — |

---

## 15. Unknowns and blockers

1. **穿过联合的深读不作为冻结面（设计自由度，非阻塞）**：读路径 P 经过联合/枚举但终点更深时（如 `['u','x']`），`<member N>` 路径既不在旧实现 `spine`（只记录出候选路径），也不在终点子树/闭包别名范围内。实测（旧实现）`resolve(m4, ['u','x']).docs = {}`；若实现按 ADR 0019 §7「选键规则不变」做朴素第三来源扫描，结果仍为 `{}`——满足本契约；若设计选择把遍历经过的成员锚并入 spine，则会出现 `U.<member 0/1>` 条目——同样满足本契约（M4-free 逐字节仍不变）。**本契约对深读路径不设断言**（避免伪红）；若 SA1/SA4 决定把深读纳入语义，由 SA6 在后续迭代扩展契约。
2. **ADR 0016 增补节归属（SA8 F1，非阻塞）**：#308 括注「修订 ADR 0016 切片条款」但 AC 只列代码+测试；建议实现票同票落 ADR 0016 dated 增补节（两来源→三来源 + L42 三表→四表措辞）。纯文档，不影响红/绿。
3. **F2 集成支中间态（非阻塞）**：v1-spec §5 四锚位与 ADR 0016 正文滞后属 #305 同支累积的明示设计，#309 收官；本契约不断言规范正文。
4. 无环境阻塞：依赖已离线安装、基线全绿、无服务/无网络依赖；诊断已完成，契约可执行进入设计/实现。

---

## 16. Temporary diagnostics cleanup

| 项 | 处置 |
|---|---|
| `.scratch/sa6-308-probe.ts`、`.scratch/sa6-308-probe2.ts`（临时探针，非测试） | 已删除（收尾核验） |
| `/tmp/variants.ts`、`/tmp/final-capture.ts`（临时诊断脚本） | 已删除 |
| 生产实现 / 既有测试 / fixture | **零改动**（`git status` 收尾核验仅剩 Host 的 `wiki/raw/task_issue-308.md`、`wiki/raw/task_issue-308_sa8_conflict.md` 与本报告；无生产文件 diff） |
| 后台作业 | `bash-14`（install）、`bash-15`（基线测试）、`bash-16`（typecheck+list）、`bash-17`（根 typecheck）全部 completed，无遗留进程/服务 |
| 诊断语义 | 探针只经公共入口读取运行时输出，未改业务语义、未加日志注入、未 skip/only/env override |

**复现脚本（已清理，可原样重放）**：fixture 文本见 §12.1；`parseVfsl`→`evaluate`→对 §12.2 路径集调用 `resolveSchemaAtPath`，打印 `docs`/`aliasDocs`/`aliases`/`valueSchema.kind`（旧实现输出见 §5 清单）。
