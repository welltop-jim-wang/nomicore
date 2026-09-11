# SA1 架构与实现设计 — issue #308（readData 语义投影 docs 切片并入 memberDocs）

- Dispatch：`sa-f9bce8dc-a34a-424e-b5a1-9397cdc5f8af`（mabf-sa1 / design / iteration 1；原位修订 iteration 0 设计，原 dispatch `sa-40177706-4927-4730-8cd1-e661a24d45e8`）
- 证据基线：worktree `/home/wangjian/nomicore-fix-issue-308`，分支 `mabf/issue-308`，HEAD `4d4208b`（#306 已合入：`memberDocs` 已在 parser→IR→semantic→evaluate 落地；投影消费侧未接线）
- 上游输入：任务简报 `wiki/raw/task_issue-308.md`（Issue #308 正文；REST comments 为空 `[]`，无附加 Owner 要求）；SA6 契约 `wiki/raw/task_issue-308_sa6_contract.md`（approve，红/绿矩阵 + §12 可转写契约）；SA8 冲突门禁 `wiki/raw/task_issue-308_sa8_conflict.md`（clear：0 阻塞 / 2 低 F1–F2 / 12 项一致 + F3 三项实现注记）；SA2 设计攻击评审 `wiki/raw/task_issue-308_sa2_review.md`（reject：唯一阻断项 F-SA2-1 MAJOR = D8 的 ADR 修订机制；D1–D7 代码面逐锚点核验通过、3 项 MINOR 观察 N-1–N-4）
- 本设计不实现代码、不编写测试；§10 验收映射把 AC 关联到 SA6 §12 契约（由实现票转写落地）

---

## 1. 任务类型、目标与非目标

**任务类型：Feature（消费侧接线）**。非 Bug：#306 交付面止于派生物面（derived 四表中的 `memberDocs` 条件稀疏表已在场），#308 是 ADR 0019 §7 明列的投影消费侧接缝补全——「能力缺口 = 接缝缺失」（SA6 §8）。

**目标**：

1. `resolveSchemaAtPath` 的 docs 切片（`sliceDocs`）从两来源（fieldDocs → markerDocs）扩为三来源（field → marker → **member 末位**），使读联合/枚举所在路径时 `<member N>` 键的逐字成员 doc 随投影下发。
2. 选键规则**零改动**（脊柱 ∪ 终点子树后代 ∪ 闭包别名内部——`<member N>` 路径天然落在既有规则内）；空条目过滤不变。
3. 不使用 M4 的 schema 投影输出**逐字节不变**（AC2）；投影四件套形状不变；namespace-runtime detached 克隆零改动。
4. ADR 0016 落 **append-only dated 增补节**登记 ADR 0019 §7 的条款级修订（两来源 → 三来源 + 「文档三表」→「文档四表」措辞，逐条「旧文 → 新文」记于节内；**正文原文一字不动**）——Issue 正文括注已引该修订，SA8 F1 / SA6 §15.2 建议同票归属本票（两者建议的交付形态即增补节）。

**非目标**：

- 不改 M4 解析/收集管线（parser/ir/semantic/evaluate/derived——#306 已合入面）；
- 不改 codegen 发射位（#307 面）、不改 v1-spec §5 / schema-authoring-guide（#309 面；SA8 F2 集成支中间态为明示设计）；
- 不扩展「穿过联合的深读」（如 `['u','x']`）携带成员 doc——SA6 §15.1 明确不冻结，本设计选择保持现状（见 §7-D6）；
- 不改 `DerivedSchema` 类型、可信域必填键守卫清单、namespace-runtime 克隆器、既有测试文件。

## 2. 当前行为与证据锚点

| 事实 | 锚点 |
|---|---|
| docs 切片现只扫两张表：`for (const k of Object.keys(derived.fieldDocs))` 与 `for (const k of Object.keys(derived.markerDocs))`，内容 `[...fieldDocs[k] ?? [], ...markerDocs[k] ?? []]`，空合并过滤（`content.length > 0`） | `packages/vfsl/src/resolve-schema-at-path.ts` L448–457（L447 为 `const docs` 声明行） |
| 选键 `want()`：脊柱键 ∪ 终点候选子树后代（`k === p \|\| k.startsWith(p + '.')`）∪ 闭包别名内部（`k === a \|\| k.startsWith(a + '.')`） | 同文件 L436–445 |
| 值侧游走在 union 处已产 `<member N>` 语法路径（`matchValueNode` case 'union'：`matchValueCandidate(ctx, node.members[i], `${anchor}.<member ${i}>`)`） | 同文件 L279–284 |
| `DerivedSchema.memberDocs?: Record<string, string[]>` 条件稀疏键已落地（`exactOptionalPropertyTypes` 纪律：无成员 doc 时整键不存在） | `packages/vfsl/src/derived.ts` L84–91 |
| evaluate 侧收集：`walkDocs` union 分支先过 `guardMemberDocs`（手造 IR loud 守卫），再按声明序收非空成员 doc，键 = `` `${path}.<member ${i}>` `` | `packages/vfsl/src/evaluate.ts` L363–369, L401–409（键模板见 L407） |
| markerDocs 可与 memberDocs 同键双非空（`type Mixed = /** 成员甲 */ \| /** 载体甲 */ YLeaf<string> ...`：doc 紧邻 `\|` 前 → M4 挂成员；`\|` 与成员之间 → M3 挂标记） | ADR 0019 决策 1/3；SA6 §12.1 夹具注记 |
| 可信域形状守卫：六键在场检查（structure/values/aliases/fieldDocs/markerDocs/aliasDocs），**不含 memberDocs**；畸形 → `InternalError` | `resolve-schema-at-path.ts` L103–123 |
| 投影四件套类型（valueSchema/aliases/docs/aliasDocs）与结果联合两码 | 同文件 L48–68；类型面测试 `test/resolve-schema-at-path.test-d.ts` |
| detached 克隆：`cloneDocsRecord` 按 `Object.keys(rec)` 泛化遍历 + 每条目新数组——docs 表新条目随表流过，零改动成立 | `packages/namespace-runtime/src/read-schema-projection.ts` L106–114, L216–220 |
| `resolveSchemaAtPath` 唯一生产消费者 = `projectReadDataSchema`（ok 分支整体深拷贝；`InternalError` 逃逸通道已有文档） | `read-schema-projection.ts` L33, L54–58 |
| 基线：聚焦 4 文件 55 tests 全绿 + 包/根 typecheck 绿（HEAD `4d4208b`） | SA6 §4/§14 |
| M4 旧实现实测：16 条契约路径 `ok:true` 且 `valueSchema`/`aliases` 正确，唯 `docs` 缺 `<member N>` 键（memberDocs 23 键在场而不可达） | SA6 §5 |
| ADR 修订机制惯例：全库条款级修订均为 append-only——修订登记于 dated 增补节内（逐条「旧文 → 新文」），正文原文保留 | git `6155b51`（ADR 0016→0008 D8 修订：+13 行纯新增节；0008 正文 L36 旧句「不暴露 module、derived 或 validator」至今保留）；git `2d9dce7`（issue #237→0007 修订：对 0007 无删除行）；ADR 0007 L68–69 模式句「owner 授权 + 显式修订节……除下列明示条款外，正文其余条款维持原文效力」 |

## 3. 根因 / 能力缺口（承接 SA6 §8）

直接故障点：`sliceDocs()` 只遍历 `derived.fieldDocs` 与 `derived.markerDocs` 两张表，第三来源 `derived.memberDocs` 从未被读取（源码位置 `resolve-schema-at-path.ts` L448–457；行为实测见 SA6 §5 矩阵）。

最深根因：#308 的母决策 ADR 0019（§7）把「投影切片并入」明列为本票实现改动面（`resolve-schema-at-path.ts（sliceDocs 第三来源）`）；#306 按票链边界止步于派生物面。**能力缺口 = 派生物面（四表）领先于消费面（两表）的接缝缺失**，非回归。放大因素：无（缺口只造成 `<member N>` 键缺失，C8 证明非 docs 部分零扰动）。

排除项（SA6 §11 已闭口）：memberDocs 未落地（✗，23 键在场）；路径解析失败（✗，全 `ok:true`）；守卫拒绝（✗，清单不含该键）；克隆吞条目（✗，泛化深拷贝）；空过滤/键序假设需改（✗）。

## 4. Owner 要求落实

Issue REST `comments: []`（Host 简报与 SA6 §2 双重实测确认；本轮修订简报仍为空评论）——无评论级 Owner 要求；需求全集 = Issue 正文（What to build + 3 条 AC）。

| 来源 | Updated at | Requirement | 设计位置 |
|---|---|---|---|
| Issue body（无评论） | 2026-09-11T06:53:35Z | AC1：读联合/枚举所在路径投影 docs 携带 `<member N>` 逐字成员 doc；marker+member 同键时 marker 前、member 后 | §7-D1/D2（合并序与选键）、§10（M1–M9/M7） |
| 同上 | — | AC2：不使用 M4 的投影输出逐字节不变 | §7-D3、§10（C1/C2/C3） |
| 同上 | — | AC3：`packages/vfsl` 相关测试（resolve-schema-at-path）与 typecheck 绿 | §10 验证命令、§11 文件范围 |
| 同上（What to build 括注） | — | 「修订 ADR 0016 切片条款」 | §7-D8（ADR 0016 append-only dated 增补节，正文不动）、§11 ALLOW LIST |

## 5. 复现和根因承接

| 上游事实（SA6 契约） | 证据位置 | 设计响应 |
|---|---|---|
| 16 条契约路径旧实现红、红因逐条落在 docs 合并处（`docs` 缺/错，`valueSchema`/`aliases`/`aliasDocs` 全对） | SA6 §5 矩阵 | §7-D1 三源合并；§10 M1–M9 逐字期望承接 SA6 §12.2/§12.3 |
| 两腿选键独立可判（`['pair']`/`['mode']` 等闭包空 = 终点子树腿；`['s']`/`['u']`/`['inl']` = 闭包别名腿） | SA6 §9.3 | §7-D2：`want()` 零改动，两腿天然覆盖 `<member N>` 键 |
| 合并序对照：`Mixed.<member 0>` 目标 `[' 载体甲 ',' 成员甲 ']`；`Mixed.<member 1>` 三源合并为空 → 必须过滤 | SA6 §9.5 | §7-D1：合并表达式 member 末位 + 空合并过滤保持 |
| 表剥离对照：删 `memberDocs` 键后 17 路径与旧实现逐字节相同 | SA6 §9.4/§12.4 表 2 | §7-D3：条件键缺席即整遍扫描跳过 |
| M4-free 逐字节冻结摘要（表 1/表 2/表 3） | SA6 §12.4 | §10：C1/C2/C3/C8 直接转写 |
| 规模近线性（N=10/100/400：9.77/19.80/53.65 µs/次） | SA6 §7 | §7-D1 第三遍扫描 O(memberDocs 键数)，无额外复杂度 |
| SA6 §15.1：深读路径不冻结 | SA6 §15 | §7-D6：明确不扩展（现状保持） |

上游事实与源码无矛盾（逐锚点核对通过）。

## 6. SA8 约束落实

| SA8 项 | 设计位置 | 处理方式 | 是否需要设计后冲突复查 |
|---|---|---|---|
| C1（并入第三来源；ADR 0019 §7 授权修订 ADR 0016，非冲突） | §7-D1 | 第三遍扫描 + 合并表达式 | 否 |
| C2（选键规则不变） | §7-D2 | `want()` 与 spine/终点/闭包集合构造零改动 | 否 |
| C3（合并序 field → marker → member 末位） | §7-D1 | 单点合并表达式（§7 伪代码 `merged(k)`） | 否 |
| C4（空条目过滤不变） | §7-D1 | `content.length > 0` 过滤保持 | 否 |
| C5（四件套形状不变） | §7-D3 / §11 DENY | 不改 `ReadDataSchemaProjection`/结果联合/index 导出 | 否 |
| C6（detached 克隆零改动） | §11 DENY | 不触碰 `packages/namespace-runtime/**`；克隆器泛化深拷贝承接新条目 | 否 |
| C7/C8（AC1 逐字 doc、marker 前 member 后） | §10 | M1–M9（M7 专测次序） | 否 |
| C9（M4-free 逐字节不变） | §7-D3 / §10 | C1/C2/C3 冻结摘要 + M4-free 面无 `<member ` 键断言 | 否 |
| C10（验证门槛：聚焦包级测试 + typecheck） | §10 | 验证命令承接 SA6 §14 | 否 |
| C11/C12（前置 #306 已满足；PR #305 同支累积） | §1 非目标 | 无动作 | 否 |
| F1（ADR 0016 正文回写缺口，低） | §7-D8 / §11 ALLOW | append-only dated 增补节随本票落：条款改写（切片三来源 + 「三表」→「四表」）逐条登记于节内，**正文原文不动**——与 F1 建议交付形态（「ADR 0016 增补节（切片三来源 + L42 三表→四表措辞）」）及全库惯例一致 | 否（登记的是 ADR 0019 §7 已成立的条款级 supersession，非新决策） |
| F2（集成支中间态，低） | §1 非目标 / §12 | v1-spec §5 滞后属 #309 收官面，登记不改 | 否 |
| F3.1（守卫**不得**把 memberDocs 加入必填键清单） | §7-D4 / §11 DENY | 必填清单不动；仅在**在场且畸形**时 loud（见 D4 边界论证） | 否 |
| F3.2（member-only 键插入序未冻结，布局自由度） | §7-D5 | 第三遍扫描为自然选择（确定性、逐调用稳定） | 否 |
| F3.3（合并只在 docs 表层面，不触 ValueSchema/闭包/合成 union） | §7-D1/D2 | 改动局限 `sliceDocs` docs 分支 | 否 |

## 7. 设计决策与主要备选方案

### D1：`sliceDocs` 三源合并（核心变更）

在既有两遍扫描（fieldDocs → markerDocs）之后增加第三遍扫描 `derived.memberDocs`（条件键），并把合并内容统一为三源拼接。三处扫描共用**单点合并表达式**，保证合并次序（field → marker → member 末位）与空过滤只有一处定义：

```ts
// —— sliceDocs 内（选键 want() 与 aliasDocs 分支零改动）——
// 第三来源（ADR 0019 §7）：条件稀疏键缺席 → 整遍扫描跳过（M4-free 逐字节不变）。
// 在场但非 record 形状 → InternalError（可信域 loud；不加必填键清单——SA8 F3.1）。
const memberDocs = derived.memberDocs;
if (
  memberDocs !== undefined &&
  (memberDocs === null || typeof memberDocs !== 'object' || Array.isArray(memberDocs))
) {
  throw new InternalError('memberDocs 畸形（可信域契约：在场须为 Record<string, string[]>）');
}
// 三源合并单点：field → marker → member 末位（ADR 0019 §7）；空合并由各扫描处过滤。
const merged = (k: string): string[] => [
  ...(derived.fieldDocs[k] ?? []),
  ...(derived.markerDocs[k] ?? []),
  ...(memberDocs?.[k] ?? []),
];

const docs: Record<string, readonly string[]> = {};
for (const k of Object.keys(derived.fieldDocs)) {
  if (!want(k)) continue;
  const content = merged(k);
  if (content.length > 0) docs[k] = content;
}
for (const k of Object.keys(derived.markerDocs)) {
  if (docs[k] !== undefined || !want(k)) continue;   // 去重并入（fieldDocs 已出的键跳过）
  const content = merged(k);
  if (content.length > 0) docs[k] = content;
}
for (const k of memberDocs !== undefined ? Object.keys(memberDocs) : []) {
  if (docs[k] !== undefined || !want(k)) continue;   // 去重并入（前两遍已出的键跳过）
  const content = merged(k);
  if (content.length > 0) docs[k] = content;
}
// aliasDocs 切片分支零改动
```

要点：

- **合并次序构造性正确**：`Mixed.<member 0>` 键由第二遍（markerDocs）扫描发射，内容经 `merged(k)` = `[...marker(' 载体甲 '), ...member(' 成员甲 ')]` → M7 绿；`Mixed.<member 1>` marker 空、member 缺席 → 合并空 → 过滤（C4/M7 同判）。
- **合并表达式是全函数**：不依赖「fieldDocs 在 `<member N>` 键上恒无条目」的文法事实（ADR 0019 §7 该句是实现性说明而非前置条件）——任意重叠组合下拼接序仍为 field→marker→member。
- **值仍是新数组、内容逐字**：与现状一致（spread 拷贝），docs 条目为每次调用新鲜产物，detached 克隆照常深拷贝。
- **零新增公共符号**：`merged` 为 `sliceDocs` 内局部闭包；`InternalError` 复用 `./resolve.js` 既有导入。

**备选（否决）**：① 重构为「三表键并集单遍扫描」——更「干净」但重写既有两遍循环结构，diff 面与回归风险大于收益，且两遍扫描的键序语义（fieldDocs 声明序优先）本就未被 ADR 冻结，无必要重构；② 三处内联合并表达式复制——三份相同表达式，合并次序有漂移风险（M7 敏感），单点闭包杜绝。

### D2：选键规则零改动（`<member N>` 天然命中）

`want()`、`spine` 记录、终点候选 `V`、闭包 `aliases` 全部不动。两腿对 `<member N>` 键的覆盖（SA6 §9.3 已分离验证）：

- **闭包别名腿**：`['s']`/`['u']`/`['m']`/`['inl']` 等终点为 ref → valueSchema=ref、别名进闭包 → `Status.<member 0>`、`U.<member 0>`、`Mixed.<member 0>`、`Inl.<member 0>` 按 `k.startsWith(a + '.')` 命中；
- **终点子树腿**：`['pair']`/`['mode']`/`['inlineItems',0]`/`['recInline','k1']`（闭包空）→ 终点语法路径（如 `ROOT.pair`、`InlItem.<item>`）为前缀的后代键命中；
- **`[]` 全量读**：endpoint=`ROOT` 子树 + 8 名闭包并集 → 23 键全覆盖（M8b）。

`<member N>` 合成段不含 `.`，前缀匹配安全性注记（L424–425）继续成立；注意子串判据不适用（成员内部字段键如 `ROOT.pair.<member 0>.kind` 合法含 `<member ` 子串——SA6 §12.2 前提断言注记），选键只用 `===`/`startsWith(anchor + '.')` 整段比较，现状已如此。

### D3：M4-free 逐字节不变（AC2）构造性论证

- `memberDocs` 键缺席 → 第三遍扫描整体跳过；`merged(k)` 中 `memberDocs?.[k] ?? []` 贡献空——两遍扫描的内容、键集、键序与旧实现**逐字节相同**；
- 不触碰 `valueSchema`/`aliases`/`aliasDocs` 任何构造路径（C8 表 3 冻结）；
- 不改可信域必填键守卫（F3.1）——无 `memberDocs` 键的手造派生物（既有测试、C3 剥离克隆）照常解析（C6）；
- 投影结果序列化字节 = JSON.stringify 逐字节 → C1/C2/C3 的 sha256 冻结摘要直接对账。

### D4：`memberDocs` 在场但畸形的窄 loud 守卫（新失败路径的唯一增量）

不加必填键清单（F3.1 红线）；仅在键**在场**且非 record 形状（null / 非对象 / 数组）时 throw `InternalError`。理由：

1. **不加守卫会泄漏裸 TypeError**：`Object.keys(null)` 直接抛 TypeError——违反模块既有承诺「本函数不向调用方泄漏裸 TypeError」（`resolve-schema-at-path.ts` L104–105 注释）与 packages/vfsl AGENTS.md「malformed derived schemas … throw InternalError and never enter the result union」；
2. **与 evaluate 侧守卫同族**：evaluate 对手造 IR 的 `memberDocs` 在场畸形已 loud（`guardMemberDocs` → TypeError → E100，`evaluate.ts` L363–369）；resolver 侧对派生物表的同类畸形 loud 是同族延伸，非新语义类别；
3. **零契约面影响**：SA6 契约 M1–M9/C1–C9 无任何用例传入在场畸形 `memberDocs`（C3 剥离 = 缺席；C4/C5 手造 = 合法 record 形状）；M4-free 面不受影响（键缺席短路）；
4. **条目级形状照旧信任**：与 fieldDocs/markerDocs 条目同一信任级（evaluate ok 产物契约；现状 `...(derived.markerDocs[k] ?? [])` 亦不校验条目元素）——只守表级形状，因为它会变成本函数自身的裸 TypeError 泄漏点。

**守卫位置（设计偏好，回应 SA2 N-4/S4）**：守卫留在 `sliceDocs` 内（D1 伪代码所示位置）。理由：与「仅为新增访问路径堵裸 TypeError 泄漏点」的论证贴合——键缺席时第三遍扫描短路、守卫不触碰 M4-free 路径；路径解析失败时 `sliceDocs` 不被调用，手造派生物「解析失败 + 表在场畸形」的可观测结果仍是两码结果联合（`SCHEMA_PATH_NOT_FOUND`/`SCHEMA_PATH_INVALID`），不额外 throw。并入函数头可信域守卫块属实现自由度（两放法均在可信域 loud 姿态内、无契约用例区分），但非本设计首选。硬性要求不变：失败类型 = `InternalError`；不得把 `memberDocs` 加入**必填**在场检查。

**备选（否决）**：纯信任直扫（与 fieldDocs mistype 现状同姿势）——为一个新增访问路径引入新的裸 TypeError 泄漏面，违背模块自身注释承诺；「修 fieldDocs/markerDocs mistype 守卫」是独立的存量加固项，见 §12 follow-up，不顺手扩 scope。

### D5：docs 键插入序（F3.2 自由度的选择）

fieldDocs 声明序 → markerDocs-only 键（声明序）→ memberDocs-only 键（声明序 = evaluate `walkDocs` 别名/成员声明序）。未被任何 ADR 冻结（ADR 0016 只冻结键规约文法）；第三遍扫描 = 与既有两遍同构的自然布局；逐调用确定（派生物不可变）。M8b/C1–C3 断言均用 `toEqual`（键序不敏感）或字节摘要（M4-free 面，不涉新键序）——设计选择与契约口径相容。

### D6：穿过联合的深读不扩展（SA6 §15.1）

`['u','x']` 类深读：`spine` 记录的是**命中候选**路径（`U.<member 0>.x` 等），成员锚 `U.<member 0>` 本身既不在脊柱、也不是终点后代（是终点祖先）、`['u','x']` 时闭包为空 → 朴素第三遍扫描下 docs 无成员条目（SA6 实测旧/新同判 `{}`）。本设计**显式保持**该行为：「选键规则不变」（ADR 0019 §7 原文）= 不为成员锚扩大脊柱/选键。若未来要求深读携带途经成员 doc，需另立需求 + SA6 扩契约 + 可能触碰 ADR 0016 选键条款——本票不做。

### D7：注释/文档措辞同步（代码内）

- `resolve-schema-at-path.ts` L54 接口注释：`fieldDocs/markerDocs 的相关切片` → `fieldDocs/markerDocs/memberDocs 的相关切片`（补一句 ADR 0019 §7 三源合并、member 末位）；
- `sliceDocs` docstring（L418–426）：合并公式改 `docs[k] = [...fieldDocs[k], ...markerDocs[k], ...memberDocs[k]]`（member 末位；fieldDocs 在 `<member N>` 键上恒无条目，实际合并 = marker 在前 member 在后）；扫描序注记补「fieldDocs → markerDocs → memberDocs（条件键缺席即整遍跳过）」；前缀匹配安全性注记保持。

（D7 是**源码内注释**同步，与 D8 的 ADR 文档回写是两个不同交付物；前者在 ALLOW 第 1 行内，后者在 ALLOW 第 2 行内。）

### D8：ADR 0016 回写——append-only dated 增补节，正文原文不动（Issue 括注 + SA8 F1 + SA6 §15.2 同票归属）

**机制（与全库 ADR 修订惯例一致，采纳 SA2 F-SA2-1 修订选项 a）**：仅在 `docs/adr/0016-readdata-semantic-schema-projection.md` 文件末尾追加一个 dated 修订节，节内逐条以「旧文 → 新文」登记条款改写；**正文原文一字不动**（含「考虑的备选」节）。对 ADR 0016 的 diff 为纯新增行。

**惯例证据（git 实测，本轮逐项复核）**：

- 全库条款级修订均为 append-only：`6155b51`（ADR 0016 对 0008 的 D8 封口修订）对 0008 的 diff 为 **+13 行纯新增**的「### ADR 0016 修订：D8 封口与 readData 结果形状（2026-09-09）」节——条款改写（旧句「不暴露 module、derived 或 validator」→ 新文）**登记在节内**，0008 正文 L36 旧句至今原文保留；
- `2d9dce7`（issue #237 对 0007 的修订）对 0007 的 diff **无删除行**（纯新增）；
- 模式文字先例：ADR 0007 L68–69（#237 修订节）明文「本节按『owner 授权 + 显式修订节』模式……修订下列条款；除下列明示条款外，正文其余条款维持原文效力」；0008 各增补节（#93/#132/#237/0017/0018）同款收尾句；
- 「哪段文字在效力」的判定方式由该惯例统一定义：读 dated 修订节的条款清单——明示条款以增补节登记文为准，未列条款正文原文继续有效。本设计不引入第二种判定方式。

**增补节规格（自包含；实现票照此落地，节题与条款结构如下）**：

```markdown
### ADR 0019 修订：docs 切片并入 memberDocs 第三来源（2026-09-11，issue #308）

授权链：ADR 0019（2026-09-11，已接受）决策 7 显式修订本 ADR 的 docs 切片条款；
issue #308 正文括注「修订 ADR 0016 切片条款」。除下列明示条款外，正文其余条款
维持原文效力（「考虑的备选」节为决策时历史记录，不随条款改写）。

1. **投影体 docs 条款改写**：正文「投影体」节 docs 注释「fieldDocs/markerDocs
   的相关切片：脊柱、终端子树后代、闭包别名内部的注释」修订为——三来源
   （fieldDocs/markerDocs/**memberDocs** 的相关切片）；合并内容
   `docs[k] = [...fieldDocs[k], ...markerDocs[k], ...memberDocs[k]]`
   （member 末位；fieldDocs 在 `<member N>` 键上恒无条目，实际合并 = marker 在前
   member 在后）；空条目过滤与选键规则（脊柱 ∪ 终点子树后代 ∪ 闭包别名内部）
   不变。
2. **键规约措辞改写**：正文「`docs`/`aliasDocs` 的键规约与 `DerivedSchema`
   文档三表完全同构」修订为「文档四表」——memberDocs 条件稀疏（在场时只含
   非空条目，与切片空过滤相容；ADR 0019 决策 5）。
3. **影响面**：仅使用 M4 的 schema 产生新切片内容；不使用 M4 的投影输出逐字
   节不变；投影返回四件套形状与 namespace-runtime detached 克隆零改动。权威 =
   ADR 0019 决策 7。
```

要点：

- **三处正文旧措辞均保留原文**（SA2 N-1）：L35–36（切片注释）、L42（「文档三表」）、L84（Considered Options「与 DerivedSchema 三表同构的路径寻址切片」）。append-only 机制下 L84 无需处理——增补节保持句显式声明「考虑的备选」为决策时历史记录、不随条款改写；
- **对 SA8 F1 的承接按其原文语义**（修正 iteration 0 的两处误读）：F1 建议的交付形态就是「ADR 0016 **增补节**（切片三来源 + L42 三表→四表措辞）」——措辞改写登记在增补节内，不是正文原位改写；F1 的「矛盾持续到收官」指的是**完全不回写**的路径（若 #308 落地而票链无人认领回写），不是 append-only 风格；append-only 下「正文与增补节字面并存旧文与新文」正是全库惯例的工作方式，非持续矛盾；
- **docs/AGENTS.md 义务的满足方式**：「Amend or supersede prior decisions explicitly instead of silently contradicting them」与「update every normative document whose stated contract changed」由显式、dated、逐条登记的增补节满足——修订被显式登记而非静默矛盾，且对 ADR 文件是纯新增 diff（可逆、可审）。

**备选（否决）**：

- ① **原位改写正文两处旧文 + 增补节记录出处**（iteration 0 设计的机制）：否决——偏离全库 append-only 惯例（上述 git 实测：6 份 ADR、十余次条款级修订无一原位改写正文），会给决策记录引入第二种修订风格、单方面改变「哪段文字在效力」的判定方式，且无补偿收益（读者按惯例读增补节即可获得全部新文）。SA2 F-SA2-1 对该路线的要求是：删除先例主张、如实记载偏离惯例、增补节显式注明正文已同步、并把该偏离交 Controller/Owner 确认——若未来 Owner 明确要求正文同步，须按该条件重新走确认，本设计不主张；
- ② **完全不回写、归属 #309**：否决——Issue 正文括注点名「修订 ADR 0016 切片条款」；SA8 F1 / SA6 §15.2 均建议同票归属本票（其括注已引该修订，最自然归属）；拖延会留下 F1 明言的「矛盾持续到收官」中间态（决策集字面与实现不一致）。

## 8. 接口、状态机与数据流

**接口变化：无。** 公共 API（`resolveSchemaAtPath` 签名、`ResolveSchemaAtPathResult`、`ReadDataSchemaProjection` 四件套、两枚失败码、`index.ts` 导出）零变化；变化仅在 ok 分支 `docs` 的**内容**（新增 `<member N>` 键条目，仅 M4 输入）。无状态机（纯函数、同步、零 memo）；无 wire/persistence/schema-envelope 面。

### 数据流路线（读时投影，无持久化变化）

| 路线 | 触发者与输入 | 写入或创建点 | 转换与边界 | 存储或传输 | 读取或投影点 | 可观察结果 | 错误与清理 | 验收锚点 |
|---|---|---|---|---|---|---|---|---|
| ① 派生表建立（前置，已落地） | P0 `compileSchemaEnvelope` → `evaluate(module)`（namespace-runtime 写槽，一次性） | `evaluate.collectDocs/walkDocs` 建 `memberDocs` 条件稀疏表（evaluate.ts L377–409） | parser→IR→semantic→evaluate 包内；无跨进程边界 | 内存（`activeTools.derived`，不可变契约） | — | 表在场 ⇔ 模块至少一名成员有 doc；键 23 个（契约夹具） | 手造 IR 畸形 → E100（#306 已落，不动） | SA6 §5 前置实测；`evaluate-derived-member-docs.test.ts`（存量不动） |
| ② 每次读的 docs 切片（本票变更点） | `readData(path)` 成功 → `projectReadDataSchema` → `resolveSchemaAtPath(tools.derived, normalizedPath)` | `sliceDocs` 三源合并产**新鲜** docs record（每键新数组） | vfsl 包内纯函数；输入=① 的表 + path | 无（进程内同步返回） | `sliceDocs` → 返回 ok 分支 | M4 输入：`docs` 新增 `<member N>` 键、内容三源逐字拼接；M4-free：逐字节同旧 | `memberDocs` 在场畸形 → `InternalError` 逃逸（internal-bug-only，生产不可达：derived 恒为 evaluate ok 产物）；两码收敛不变 | M1–M9 / C1–C9 |
| ③ detached 深拷贝（组合边界，零改动） | `projectReadDataSchema` ok 分支 | `detachReadSchemaProjection` → `cloneDocsRecord` 泛化深拷贝 docs 表（含新条目） | vfsl → namespace-runtime 包边界（进程内函数调用） | 无 | `readData` 结果载荷 `schema.docs` | 消费者拿到可变普通副本；新条目随表流过 | 克隆器无错误路径（泛化遍历） | C6/C7；`read-schema-projection.ts` 结构核验（SA6 §3） |

一致性口径：① 是事实源（single source of truth = derived 表）；② 每次读现算、无缓存（确定性：同输入两次调用 JSON 全等，SA6 §7）；③ 零缓存独立隔离。失败可见性：② 的 InternalError 逃逸读面（已有文档化通道，D4 不新增类别）；③ 无失败面。

## 9. 错误、恢复、并发和幂等

- **错误**：唯一增量 = D4 窄守卫（`memberDocs` 在场且非 record → `InternalError`，可信域 throw 通道，不进结果联合、不降级码——与 packages/vfsl AGENTS.md 边界一致）。无静默 fallback：条件键缺席是**合法形状**（非异常态），跳过扫描是规格行为而非降级。正常路径不变量（选键、合并序、空过滤）由契约测试锚定，缺失即红。
- **恢复/重试/回滚**：纯同步函数无重试语义；实现票回滚 = revert 单文件代码改动 + 删除三份新增测试文件 + revert ADR 0016 增补节（纯新增节，删除即还原，无正文残留）。
- **并发**：无共享状态、零 memo（正则缓存为调用局部，现状保持）；多读并发安全性与现状相同。
- **幂等**：同输入逐字节确定（SA6 §7 实测两次调用全等）；FIFO/写槽不涉及（读面在 sequencer 之外，ADR 0008）。

## 10. 调用方影响矩阵

| 调用方 | 当前处理 | 设计后处理 | 所需改动 | 证据 |
|---|---|---|---|---|
| `packages/namespace-runtime/src/read-schema-projection.ts::projectReadDataSchema`（唯一直接调用方） | 消费 ok 分支四件套整体深拷贝；InternalError 已文档化逃逸（internal-bug-only） | 新 docs 条目经 `cloneDocsRecord` 泛化深拷贝流过；InternalError 通道类别不变（D4 同通道） | **零改动** | `read-schema-projection.ts` L54–58, L106–114, L216–220 |
| `NamespaceRuntime.readData` 成功分支（runtime.ts 组合点） | `schema: projection \| null` 透传 | 透传（docs 内容增量） | 零改动 | ADR 0016「分层与兼容面」；read-schema-projection.ts 模块头 |
| `@nomicore/namespace-registry` / typed-access / 外部 adapter | 键控读取投影字段；无 M4 输入 | 加法兼容：M4 schema 才出现新 docs 键；四件套形状不变 | 零改动 | SA6 §10（registry/runtime 测试 grep `memberDocs` 为空）；ADR 0016「typed-access 投影与 codegen 加法兼容」 |
| `packages/vfsl/src/validate.ts` / `validate-patch.ts` | 不读任何 docs 表（ADR 0019 决策 8） | 不变 | 零改动 | ADR 0019 §8；源码 |
| `packages/vfsl-codegen` emitter | 直接消费 derived 表；memberDocs 发射位属 #307 | 不变（本票不触） | 零改动 | ADR 0019 决策 6；SA8「#307 面非 #308 面」 |
| 既有测试（resolve-schema-at-path*.ts、evaluate-derived-member-docs.test.ts、两 fixture） | 55 tests 绿；L449–485 不变量（M4-free 面 docs 键 ⊆ field∪marker、内容 = field+marker） | 原样保持绿（M4-free 面字节不变 ⇒ 不变量前提不受扰） | **禁止修改**（C9） | SA6 §6 C9 / §12.5 |
| 新契约测试（实现票转写 SA6 §12） | 不存在 | 三份新文件（fixture / 红契约 M1–M9 / 负控 C1–C9） | 新增（ALLOW LIST） | SA6 §12 文件表；vitest include `packages/*/test/**/*.test.ts` |

无未覆盖调用方：`resolveSchemaAtPath` 生产消费面经 grep 全量核对仅 namespace-runtime 一处（§2 表末行）。

## 11. 文件范围

### ALLOW LIST

| 路径 | 预期改动 | 原因 |
|---|---|---|
| `packages/vfsl/src/resolve-schema-at-path.ts` | `sliceDocs` 第三遍扫描 + 三源单点合并表达式 + D4 窄守卫；L54 接口注释与 L418–426 docstring 措辞同步（§7-D1/D4/D7） | 唯一待接线消费点（ADR 0019 §7 实现改动面明列；SA6 §8 直接故障点） |
| `docs/adr/0016-readdata-semantic-schema-projection.md` | 文件末尾追加 dated 修订节「ADR 0019 修订：docs 切片并入 memberDocs 第三来源（2026-09-11，issue #308）」；**正文零改动**——对本文件的 diff 为纯新增行（§7-D8） | Issue 正文括注点名；SA8 F1 / SA6 §15.2 建议同票归属（建议形态即增补节）；全库 append-only 惯例（§7-D8 惯例证据）；docs/AGENTS.md 规范文档同步义务 |
| `packages/vfsl/test/resolve-schema-at-path-member-docs-fixture.ts` | 新建：`M4_TEXT`（逐字节 = SA6 §12.1）+ `EXPECTED_DOCS`（§12.3）+ 冻结摘要常量（§12.4 表 1/2/3） | SA6 §12 契约文件表第 1 行；非 `.test.ts` 不被 vitest 收集 |
| `packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts` | 新建：红契约 M1–M9（§12.2/§12.3 逐字期望 + 前提断言） | SA6 §12 文件表第 2 行；AC1 |
| `packages/vfsl/test/resolve-schema-at-path-member-docs-control.test.ts` | 新建：负控 C1–C9（§6/§12.5 口径：冻结摘要、空过滤、不泄漏、守卫、形状/确定性、非 docs 不变、存量零改动） | SA6 §12 文件表第 3 行；AC2 + F3.1/F3.3 锚定 |

### DENY LIST

| 路径 | 与任务的关系 | 禁止修改原因 |
|---|---|---|
| `packages/vfsl/src/derived.ts` | `memberDocs?` 可选键类型 | #306 已落地面；类型零变化（C5） |
| `packages/vfsl/src/{parser,ir,semantic,evaluate}.ts` | M4 收集管线 | #306 已合入面；本票是消费侧接线；改收集面会破坏 AC2 前提（指纹/派生物稳定） |
| `resolve-schema-at-path.ts` L103–123 可信域**必填键**清单 | 守卫所在文件内的特定禁区 | SA8 F3.1：加入 `memberDocs` 必填检查会破坏 C9（M4-free 手造派生物被拒） |
| `packages/namespace-runtime/**`（含 `read-schema-projection.ts`） | detached 克隆组合边界 | C6：克隆器泛化深拷贝，零改动是验收不变量 |
| `packages/vfsl/test/resolve-schema-at-path.test.ts`、`-control.test.ts`、`-pattern-errors.test.ts`、`-test-d.ts`、`-fixture.ts`、`evaluate-derived-member-docs.test.ts`、`union-member-docs-fixture.ts` | 既有测试/夹具 | SA6 C9：禁止修改/弱化，实现后原样仍绿 |
| `packages/vfsl/src/index.ts` | 公共导出面 | 无新增公共符号（§8） |
| `packages/vfsl-codegen/**` | memberDocs 发射位 | #307 面（SA8 横向核查）；本票不触 |
| `docs/vfsl/v1-spec.md`、`docs/vfsl/schema-authoring-guide.md` | 规范正文滞后项 | #309 面；SA8 F2 集成支中间态为明示设计（#305 同支累积） |
| `CONTEXT.md` | 「语义 schema 投影」词条 | 措辞为表数不可知（「文档注释表的相关切片」），四表化后无需改（SA8 横向核查） |
| `docs/adr/0019-vfsl-union-member-docs.md` | 母决策 | 已接受；本票执行其 §7，不修订决策本体 |
| `docs/adr/0003-evaluator-derived-schema.md` | ADR 0019 §5 对 0003 的修订回写指针 | 正文无 docs 表条款原文；对称回写归属 #306 收尾/#309（SA8 F1 移交建议），不属本票 scope |
| ADR 0016 **正文**（L1–98 既有内容，含 L35–36/L42/L84 旧措辞） | append-only 禁区（文件内特定禁区） | §7-D8：全库惯例为正文原文保留、修订登记于增补节；本票对本文件只允许末尾追加 |

## 12. 验收与验证映射

| 需求或风险 | 现有证据 | 所需行为测试或动态场景 | 预期观察 |
|---|---|---|---|
| AC1：`<member N>` 逐字成员 doc（联合/枚举路径） | 旧实现 16 路径红矩阵（SA6 §5） | M1–M6、M8a/M8b（`packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts`，fixture `M4_TEXT`） | `r.docs` 逐字 = SA6 §12.2/§12.3 期望；`toEqual` 键序不敏感；`aliasDocs`/`valueSchema`/闭包同步断言 |
| AC1：marker 前 member 后（同键双非空） | SA6 §9.5 对照实验 | M7（`['m']`）：`{'Mixed.<member 0>': [' 载体甲 ', ' 成员甲 ']}` | JSON 序列化逐字含两元素次序；`Mixed.<member 1>` 不成键 |
| AC1：两腿选键独立成立 | SA6 §9.3 腿分离对照 | M3/M4/M5b/M6（终点腿，闭包 `[]`）与 M1/M2/M5a/M8a（闭包腿）对半覆盖 | 只接单腿的实现必红其中一组（SA6 §13 敏感度） |
| AC1：闭包腿机械不变量 + 三源拼接 | — | M9a/M9b（契约路径全集） | 凡锚名 ∈ `Object.keys(r.aliases)` 的 memberDocs 键，`r.docs[k]` = 三源逐字拼接；docs 键 ⊆ 三表键并集 |
| AC2：M4-free 逐字节不变 | 旧实现摘要全绿（SA6 §12.4 录制） | C1（`FIXTURE_TEXT` 6 路径）/ C2（`SPEC_FIXTURE`+`FIXTURE_B` 7 路径）sha256 冻结对账 + docs 无 `<member ` 子串断言 | 摘要逐路径相等；无成员键泄漏进 M4-free 面 |
| AC2：表缺席惰性 | SA6 §9.4 剥离对照 | C3（`M4_TEXT` 派生物删 `memberDocs` 键，17 路径摘要） | 与旧实现逐字节相同（缺席 ⇒ 无新条目） |
| 风险：丢空过滤 / 见表全量倾倒 | SA6 §9.6 | C4（空数组合并不得成键）/ C5（`Unrelated.<member 0>` 不得泄漏） | `['U.<member 0>']` 键缺席；契约路径集不含未选中内容 |
| F3.1：守卫不得要求 memberDocs | — | C6：剥离克隆与含表派生物均 `ok:true` | 两形状均正常解析（必填清单未动） |
| C5/四件套形状 + 确定性 | — | C7：ok 分支恰 5 键、两次调用全等、JSON 往返全等 | `['aliasDocs','aliases','docs','ok','valueSchema']` |
| F3.3/C8：非 docs 部分不变 | — | C8：16 路径 `sha256(JSON.stringify({valueSchema,aliases,aliasDocs}))` 表 3 对账 | 摘要逐路径相等 |
| 存量回归 | 基线 4 files / 55 tests 绿（SA6 §4） | C9：既有测试文件零改动原样运行 | 全绿；L449–485 不变量保持 |
| D4：在场畸形 loud | —（新守卫，无契约用例） | 实现票可加一条辅助断言（非 SA6 契约项）：手造 `memberDocs: null` → `expect(() => resolveSchemaAtPath(...)).toThrow(InternalError)` | 可信域 throw 通道纯度（不泄漏裸 TypeError）；可选，不得替代任何 M/C 用例 |
| AC3：验证命令 | SA6 §14 runner 证据 | ① `pnpm vitest run packages/vfsl/test/resolve-schema-at-path.test.ts packages/vfsl/test/resolve-schema-at-path-control.test.ts packages/vfsl/test/resolve-schema-at-path-pattern-errors.test.ts packages/vfsl/test/evaluate-derived-member-docs.test.ts packages/vfsl/test/resolve-schema-at-path-member-docs.test.ts packages/vfsl/test/resolve-schema-at-path-member-docs-control.test.ts --typecheck`；② `npx tsc -p packages/vfsl/tsconfig.json`；③ 根 `pnpm typecheck` | 全绿（packages/vfsl AGENTS.md 聚焦门槛；公共类型未变 ⇒ 根级全量为集成时例行） |
| F1：ADR 0016 回写（append-only 增补节） | — | 文档 diff 审查：增补节三条款与 ADR 0019 §7/§5 逐条语义一致（切片三来源 + 合并式 + 「三表」→「四表」+ 影响面）；权威指针（ADR 0019 决策 7）正确；保持句含「考虑的备选为历史记录」声明 | `git diff` 对 ADR 0016 **仅新增行**（无删除/改写行——正文零改动的机械可验）；`git diff --check` 干净 |

新文件必然被 runner 收集：vitest include = `packages/*/test/**/*.test.ts`（fixture 非 `.test.ts` 不收集、仅由包 tsconfig `test/**/*.ts` 覆盖类型检查）——SA6 §14 已核实。

## 13. 风险、回滚和残余问题

**风险**

| # | 风险 | 概率/影响 | 缓解 | 先红断言 |
|---|---|---|---|---|
| R1 | 合并次序漂移（marker/member 互换或表达式分叉） | 低/高（AC1 语义错误） | §7-D1 单点合并表达式；M7 逐字序断言 | M7 |
| R2 | M4-free 逐字节破坏（误加守卫必填、键序漂移、多余空条目） | 低/高（AC2 破坏） | D3 构造性论证 + F3.1 禁区；冻结摘要 | C1/C2/C3/C6 |
| R3 | 三表重叠键处理想当然（依赖「fieldDocs 恒无 `<member N>` 键」作前置） | 低/中 | 合并表达式全函数化（D1 要点） | M9b |
| R4 | ADR 0016 增补节措辞与 ADR 0019 §7 语义漂移，或实现票顺手原位改写正文（破坏 append-only） | 低/低（文档卫生） | D8 增补节条款以 0019 §7 原文为权威转写；§12 F1 行「仅新增行」机械验收；SA4 文档审查 | §12 F1 行 |
| R5 | 越界改动（namespace-runtime / codegen / 既有测试 / ADR 0016 正文） | 低/中 | §11 DENY LIST 显式列举（含 ADR 0016 正文禁区行） | C9 / 聚焦测试 / §12 F1 行 |

**回滚**：单文件代码 revert + 三份新测试文件删除 + ADR 0016 增补节 revert（纯新增节，删除即还原）；无持久化/wire/迁移残留（纯读面、零缓存）。

**任务内必要条件**（全部已具备，无缺口）：上游表在场（#306 已合入，HEAD `4d4208b` 实测 23 键）；基线绿；契约可执行；依赖离线就绪（SA6 §4）。

**残余问题 / follow-up（非本票阻塞项）**

1. **ADR 0003 回写指针无人认领**（SA8 F1 对称项）：ADR 0019 §5 修订 0003 docs 表条款，0003 正文无原文、回写为一句指针（append-only 增补节同款）；建议 Controller 钉给 #309（或 #306 收尾），本设计不扩 scope。
2. **F2 集成支中间态**：v1-spec §5 三挂载位措辞与 ADR 0016 滞后由 #309 收官（PR #305 收官清单核对项）。
3. **深读携带途经成员 doc**（SA6 §15.1 设计自由度）：本票明确不做；若未来需要，须另立票 + SA6 扩契约 + 评估 ADR 0016 选键条款触碰。
4. **存量加固（可选）**：`fieldDocs`/`markerDocs` 在场但 mistype（如 `null`）仍会泄漏裸 TypeError（先于本票存在）；如需统一 loud 化属独立小票，不与本票混同。
5. **规模**：第三遍扫描 O(memberDocs 键数)，SA6 §7 曲线（N=400 → 53.65 µs/次）近线性，无性能项。

## 14. 评审修订映射

评审输入：`wiki/raw/task_issue-308_sa2_review.md`（SA2 dispatch `sa-10ce65aa-c9c9-45a6-9acf-a1b33bcbb098`，iteration 0，reject：1 MAJOR / 0 BLOCKER / 3 MINOR + 4 项非阻断观察）。逐条处理：

| Finding | 修订位置 | 处理结果 |
|---|---|---|
| **F-SA2-1（MAJOR）**：D8 的 ADR 修订机制基于不实先例（「ADR 0008 的 D8 封口句即正文修订 + 增补节记录」与 git 史相悖）并偏离全库 append-only 惯例；对 SA8 F1 建议交付形态与「矛盾持续到收官」引文均有误读 | §7-D8 全节重写（采 SA2 选项 a：append-only，正文零改动）；§1 目标 4、§6 F1 行、§11 ALLOW（ADR 0016 行）、§12 F1 行、§9 回滚句、§13 R4/R5 同步 | **已落实**：① 删除不实先例句，先例主张全部改为 git 实测事实（`6155b51` +13 行纯新增、0008 正文 L36 旧句保留、`2d9dce7` 无删除行、0007 L68–69 模式句——本轮逐项复核）；② 增补节为 ADR 0016 唯一交付物，条款改写逐条「旧文 → 新文」登记于节内，正文原文不动（§12 F1 行以「diff 仅新增行」机械验收）；③ SA8 F1 引用按原文语义修正（建议形态 = 增补节；「矛盾持续到收官」= 完全不回写路径，append-only 非持续矛盾）；④ 原位修订路线改记为否决备选①，并如实注明其须「删先例 + 记载偏离 + Controller/Owner 确认」的前提（选项 b），本设计不主张；⑤ D8/§1/§6/§11/§12 五处对 ADR 0016 交付物的描述与 append-only 机制一致 |
| **N-1**（并入 F-SA2-1 验收）：ADR 0016 正文第三处旧措辞 L84（Considered Options「与 DerivedSchema 三表同构的路径寻址切片」） | §7-D8 要点 1、增补节规格保持句 | **已落实**：append-only 下正文不动，L84 随全文原文保留；增补节保持句显式声明「考虑的备选」为决策时历史记录、不随条款改写（无需「使正文自洽」的额外处理） |
| **N-2**：§2 锚点表 evaluate 收集键模板漏闭合尖括号 | §2 evaluate 行 | **已落实**：键模板改为 `` `${path}.<member ${i}>` ``（evaluate.ts L407 为准，本轮复核） |
| **N-3**：两遍扫描行号边界差一行（L447 为 `const docs` 声明行，循环体为 L448–457） | §2 首行、§3 直接故障点 | **已落实**：锚点统一改为 L448–457（本轮 read 复核 L447–457 实际内容） |
| **N-4**：D4 守卫位置（sliceDocs 内 vs 函数头守卫块）对「路径解析失败 + 表在场畸形」的可观测结果不同，设计宜明确偏好 | §7-D4「守卫位置（设计偏好）」段 | **已落实**：明确偏好 = 守卫留在 `sliceDocs` 内（解析失败 + 畸形表 → 两码结果联合，不额外 throw；与「仅新增访问路径泄漏点」论证贴合）；函数头放法降为实现自由度、非首选；硬性要求（InternalError、不加必填清单）不变 |

SA2 对 D1–D7、§8–§12 代码面与验收面的核验结论为「独立核验全部成立」——本轮对相应章节仅做 N-2/N-3/N-4 定点修订与 D8 联动同步，技术内容未改动。

## 15. 是否需要设计后 ADR 冲突复查

**否（`requiresConflictRecheck: false`）**。理由：

1. 本设计**执行**既有已接受决策（ADR 0019 §7 条款级修订 ADR 0016 切片条款），不新增、不修订任何决策——ADR 0016 append-only 增补节是对**已成立 supersession** 的登记式回写（SA8：「实质权威无歧义……属文档对齐卫生」）；相比原位改写，append-only 对决策记录的触碰面更小（正文不动，纯新增节），不扩大而是收窄决策记录变化面；
2. 无公共 API/协议/wire/schema-envelope/持久化/状态机变化（四件套形状、两码、导出面零变化）；
3. 无新失败语义类别：D4 窄守卫落在既有可信域 `InternalError` 通道（packages/vfsl AGENTS.md 既有边界文字覆盖），且无任何契约用例触及；
4. SA8 前置门禁 verdict = clear（0 阻塞），12 项逐条一致；SA2 对 F-SA2-1 的裁决亦明示该 finding「不引入新的决策触碰面」（ADR 0019 §7 对 0016 的条款级 supersession 已由 SA8 前置门禁裁决 clear，finding 只纠正回写机制的记录方式）。
