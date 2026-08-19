# SA1 设计 — ROOT 约定实现：E310/E311 命名空间根完整性检查（Issue #19）

> Worktree: `/home/wangjian/nomicore-fix-issue-19`｜分支 `fix/issue-19-on-adr-union-representation`（base e0c9cb2）
> 任务类型: 功能开发｜run_id: `issue-19-1787121781-17717`
> 权威输入: `docs/vfsl/v1-spec.md`（e0c9cb2 修订版，frozen）、`docs/adr/0003-evaluator-derived-schema.md`、SA6 红灯 `packages/vfsl/test/parse-vfsl-root-convention.test.ts`（34 用例）
> 唯一输出：本文档。SA3 按此实现，SA4/SA7 按此验尸。

---

## §0. 输入核对与基线事实（SA1 设计期实测，2026-08-19）

以下事实全部由 SA1 本轮亲自核对，不是转抄：

| 事实 | 核对方式 | 结果 |
|---|---|---|
| 分支 HEAD | `git log --oneline -2` | `e0c9cb2`（ROOT 固定 Y.Map + YXmlFragment 不透明修订版），工作区仅新增 SA6 红灯与简报 |
| 存量测试数 | 逐文件 `grep -c '  it('` | containers 33 / cycle 16 / errors 19 / forbidden 79 / jsdoc 7 / r3 7 / sa7 8 / parse-vfsl 11 = **180**，与简报基线一致 |
| E310/E311 零实现 | `grep -rn 'E31[01]' packages/vfsl/src/` | 零命中（仅红灯测试文件命中） |
| 红灯规模 | 简报 §8.2（总控实测）+ SA6 文件 | 21 failed / 13 passed（34），全量 21 failed / 193 passed（214） |
| 包版本 | `packages/vfsl/package.json` | `0.1.3`，`dependencies` 字段不存在（零运行时依赖红线现况） |
| `ROOT` 不在保留名集合 | `parser.ts:77-82` RESERVED_NAMES | 不含 `ROOT` → `type ROOT = …` 按普通别名解析，无 E303 风险 |
| 聚合实现 | `semantic.ts:182-184` | `candidates.sort((line, column, code数值))` 取首条——min-position + 码号兜底，E310/E311 直接入池即可，**聚合机制零改动** |
| cls 体系 | `shapes.ts:301-312`（clsOf）/ `108-129`（localCls）/ `136-160`（synthesize） | 六值 Cls（scalar/map/container/mixed/cycle/unknown）；查询位一律经 clsOf（§5.1 R3 既有纪律） |
| 红灯锚点算术 | SA1 逐字符重算（Unicode 码点列） | 全部 21 红用例锚点与本设计 §4 判定矩阵一致（`type ROOT = string;`→1:13；`S` 引用→1:30；多跳 `B`→1:42；联合经别名→1:47；E302 次名→1:33；多行→2:3 / 2:13） |

**SA6 §8.3 存量扫描与本设计审计的差异（SA1 自查，SA2 请以此为准）**：

- SA6 扫描按「输入」计数（41/77 等），本设计按「测试用例」计数并重新分类相位。关键差异一处：**forbidden-matrix `E102-07-neg`（`type Box = { value: string }; type T = Box<string>;` → E100 锚 1:43）是语义相位错误**（generic-diag 终判在 `semantic.ts:104-111`，不在 parser 抛出），E310@1:1 会抢胜它——SA6「4 E301 被抢胜」的分类漏了这一条。受影响 neg 用例实为 **5** 条（E301×4 + generic-diag E100×1）。SA6 简报 §8.3 表为「修复方向」参考，本设计 §6 逐文件清单为 SA3 的执行依据。
- SA6 表中 cycle-detection 只列「9 × E106」；该文件另有 **7 个用例挂在旧版 §10 fixture 上**（AC3 四条 + AC4 三条，其中两份 fixture 副本 + 一份 kind 覆盖文本），全部受影响，须按 §6.4 处理。

---

## §1. 需求推演（Feature 切入点）

### 1.1 语义要求（spec §3「命名空间根」/ ADR-0003 §2，e0c9cb2 版）

每个模块必须**恰好声明一个**名为 `ROOT` 的别名（大小写是契约，`root`/`Root` 不算），且 ROOT **固定物化为 Y.Map**：

1. 缺失 → **E310**，锚**模块起始 (1:1)**（与声明位置、前导 trivia 无关）；
2. 重复声明 → 既有 **E302**（锚重复声明名），不是新码；
3. 非 map 形 → **E311**：仅接受裸对象 / `YMap` / `Record` / 全 map 形联合（**clsOf = map**，三分类经别名解析后判定）；标量形与 `YArray` / `YXmlFragment` 一律拒绝，锚 **ROOT 的类型表达式起点记号**。

检查位于 **parseVfsl 语义相位**（ADR-0003 §2：「行列锚定只有解析层做得到」）。E310/E311 进语义相位候选池，与既有 E30x 按 min-position 聚合（spec §4「错误判定顺序」规范性条款 + 该节明文把 E310/E311 列入「该解析时机条款同样适用于」清单）。

### 1.2 架构切入点（为什么是 shapes.ts 而不是新文件 / semantic.ts）

- **E311 的判定语言就是 clsOf**：spec §3 原文「clsOf = map，三分类经别名解析后判定」。`shapes.ts` 已有完整的别名链解析 + 迭代 Tarjan SCC + 统一查询助手 `clsOf`（含 union 行），E311 是对 `cls` 表的一次 O(1) 查询，重造即背离「查询位只经 clsOf」纪律（shapes.ts §5.1 R3）。
- **单一 cls 计算**：`collectShapeCandidates`（shapes.ts:609）内部已算好 `cls`。E310/E311 并入该函数 = 零重复计算、零新导出、semantic.ts 调用点（semantic.ts:174）零改动、单池聚合天然成立。
- **semantic.ts 不动逻辑**：E310 虽不需要形状表，但与 E311 同属「ROOT 完整性」关注点，拆两处反而分裂。semantic.ts 仅更新文件头注释（枚举中补一句）。

### 1.3 明确不做的（边界）

- **不改 IR**：`ROOT` 在 IR 中就是普通别名（红灯正例只断言序列化含 `'ROOT'`），无特殊标记、无 `isRoot` 字段。getMap('ROOT') 映射是求值器（Phase 0b）的事，出范围。
- **不改 parser/tokenizer**：E311 锚点复用既有 `AstType.pos`（各节点已带构造起点，parser.ts:35-47）；E310 锚点是常量 (1,1)。`ROOT` 不是保留名（§0 已核对），声明位无新判定。
- **不改公共接缝**：`parseVfsl` 签名 / 返回形状 / message 前缀格式全部延续（红线 2）。错误码经 `makeIssue` 前缀通道传递，无独立 code 字段。

---

## §2. 判定算法

### 2.1 E310（缺 ROOT）

```
条件：declared（全部别名声明名集合）中不存在精确名 'ROOT'（大小写敏感）
锚点：line=1, column=1（硬编码——spec §4 总表「模块起始（1:1）」；空文本无任何记号
      可锚，1:1 是唯一自洽读法；前导 doc/空白/BOM 均不影响）
消息：`缺少 ROOT 别名: 模块未声明名为 ROOT 的命名空间根（大小写是契约，ROOT 固定物化为 Y.Map）`
```

- 重复声明不触发 E310（`declared.has('ROOT')` 为真即满足存在性），重复走既有 E302——spec §3 明文。
- `root` / `Root` / `rOOT` 等变体是普通别名名，不满足存在性。
- 顶层字段名 / marker 实参里出现 `ROOT` 字样与根检查无关（只看**顶层 TypeAlias 声明名**）。

### 2.2 E311（ROOT 非 map 形）

```
对每个 name === 'ROOT' 的别名声明 a（E302 场景下可能多个，逐声明体检查）：
  c = clsOf(a.type, cls, declared)          // 唯一查询口，别名链/联合经它解析
  c === 'map'                               → 通过（裸对象 / YMap / Record / 全 map 联合，含经别名）
  c ∈ {'scalar','container','mixed'}        → E311 候选，锚 nodePos(a.type)
                                               （= ROOT 类型表达式起点记号；generic-diag 走
                                                namePos，但 generic-diag 恒 'unknown' 不可达此处）
  c ∈ {'cycle','unknown'}                   → 不裁决（ declined），错误身份归还 E106 / E301 /
                                               generic-diag 终判通道——与 E304（shapes.ts:553）、
                                               E309（shapes.ts:593-597）同一纪律，闭环证明见 §5
消息：`ROOT 别名非 map 形: ROOT 固定物化为 Y.Map，仅接受裸对象 / YMap / Record / 全 map 形联合（解析后形状: ${c}）`
```

### 2.3 判定矩阵（E311 全形态，含 Cls 六值闭环）

| ROOT 体写法 | clsOf 结果 | 判定 | 锚点（= 类型表达式起点） |
|---|---|---|---|
| 裸对象 `{ … }` / 空对象 `{}` | map（localCls object） | ✅ 通过 | — |
| `Record<K, V>`（**任意** K/V） | map（localCls record） | ✅ 通过；键非 string 形归 **E306** 管 | — |
| `YMap<T>` | map | ✅ 通过；实参缺陷归 **E304** 管 | — |
| 以上经别名 / 全 map 形联合（含经别名） | map | ✅ 通过 | — |
| `string`/`number`/`boolean`/`null`/`unknown`/字面量 | scalar | ❌ E311 | 体起点记号 |
| `string & Pattern<"…">` | scalar（localCls pattern） | ❌ E311 | `string` 记号（PatternType 构造起点） |
| `YLeaf<…>` | scalar（标记成员形状归类，§3） | ❌ E311 | `YLeaf` 记号 |
| `YPlainArray<…>` | scalar（根位按标量形——上下文无关 localCls，shapes.ts:122） | ❌ E311 | 标记记号 |
| 全标量联合（含经别名） | scalar（synthesize） | ❌ E311 | 首成员起点 |
| 裸数组 `T[]` / `YArray<…>` | container | ❌ E311 | primary / 标记起点 |
| `YXmlFragment<…>`（实参对象形与否无关） | container | ❌ E311 | 标记记号 |
| map+container 联合（如 `YMap<…> \| YArray<…>`） | container（synthesize map+container→container） | ❌ E311（非**全 map** 形联合） | 首成员起点 |
| 标量+容器混合联合 | mixed | ❌ E311（同位还有 E309，见 §4.2） | 首成员起点 |
| 未知名引用 / generic-diag / 含 unknown 成员的联合 | unknown | ⏸️ 不裁决（E301 / 终判候选在池） | — |
| 环上名 / 经环解析 / 纯环联合 | cycle | ⏸️ 不裁决（E106 候选在池） | — |

两个「通过但内部有缺陷」的行是 spec 语义分层的结果：E311 只裁决**根位的 map 形**，ROOT 内部的 Record 键 / 标记实参 / 混合联合缺陷由 E306/E304/E309 在各自锚点报出（min-position 聚合照常裁定谁胜出）。

---

## §3. 实现设计（SA3 执行蓝本）

### 3.1 `errors.ts` — 注册表 19 → 21 码（AC 第 9 条 / 红线 7）

```ts
// ErrCode 对象内、E309 之后追加两行：
  E310: '310',
  E311: '311',
// 文件头注释「19 个」改为「21 个（E310/E311 随 #19 ROOT 约定交付）」
```

注册表与 spec §4 总表一一对应核对：E100~E106（7）+ E201~E203（3）+ E301~E311（11）= **21**。

### 3.2 `shapes.ts` — `collectShapeCandidates` 追加 ROOT 完整性块

插入点：既有四条检查循环（shapes.ts:653-656）**之后**、`return candidates` 之前，纯增量：

```ts
  // —— 命名空间根完整性（#19，spec §3「命名空间根」：E310/E311）——
  // E310：缺 ROOT（锚模块起始 1:1，硬编码——与声明位置、前导 trivia、BOM 无关；
  // 空文本无记号可锚亦成立）。declared 含 ROOT（含重复声明）即满足存在性——
  // 重复走既有 E302，不产 E310（semantic.ts:86-93）。
  if (!declared.has('ROOT')) {
    add(ErrCode.E310, '缺少 ROOT 别名: 模块未声明名为 ROOT 的命名空间根（大小写是契约，ROOT 固定物化为 Y.Map）', 1, 1);
  } else {
    // E311：ROOT 非 map 形，锚 ROOT 的类型表达式起点记号（nodePos）。逐声明体检查
    // （E302 多体场景每体独立裁决，各自入池由 min-position 裁定）。
    // cycle/unknown 不裁决——错误身份归还 E106/E301/终判通道（E304/E309 同纪律，
    // 闭环证明见设计 §5），无静默 ok:true 路径。
    for (const a of aliases) {
      if (a.name !== 'ROOT') continue;
      const c = clsOf(a.type, cls, declared);
      if (c === 'cycle' || c === 'unknown') continue;
      if (c !== 'map') {
        const p = nodePos(a.type);
        add(ErrCode.E311, `ROOT 别名非 map 形: ROOT 固定物化为 Y.Map，仅接受裸对象 / YMap / Record / 全 map 形联合（解析后形状: ${c}）`, p.line, p.column);
      }
    }
  }
```

配套改动：

- `shapes.ts` 文件头注释（:1-19）：标题行「四个新错误码 E304/E306/E307/E309」补为「六个错误码 E304/E306/E307/E309（#6）+ E310/E311（#19 ROOT 完整性）」，并加一行说明 ROOT 检查。
- `semantic.ts` 文件头注释（:14 附近）：「shapes.ts 的 E304/E306/E307/E309 候选并入同一候选池」一句补上 E310/E311。**仅注释，零逻辑改动。**

资源界：E310 一次 Set 查询；E311 每个 ROOT 声明体一次 `clsOf`（union 行深度 ≤ 2，shapes.ts:307 注记；ref 查表 O(1)）。无新循环维度、无递归、无新分配热点——sa7 T-l 的 20k 别名链输入渐近不变。

### 3.3 版本 bump（Hard Gate #9）

`packages/vfsl/package.json`：`"version": "0.1.3"` → `"0.1.4"`。不引入任何 `dependencies`（零运行时依赖红线，红线 5 关联）。

---

## §4. 聚合交互与并列裁决（全部情形枚举）

### 4.1 E310 与既有码（缺 ROOT 时它几乎总赢）

E310 锚 (1,1) 是语义相位**可能的最前位置**。语义相位其余各码的锚点构造上不可能先于 (1,1)：

- E301/E106 锚引用记号、E302 锚重复声明名、E304/E307 锚标记记号、E306 锚键起点、E308 锚重复字段名、E309 锚异类成员、generic-diag 终判锚 namePos/ltPos——全部位于 `type X = ` 之后的体内部或第二个声明之后，行列恒 > (1,1)。
- **唯一能并列 (1,1) 的是 E305**：模块起始即悬空文档注释（如文本 `/** x */` 单独成模块——E305 锚注释起始 1:1）。

**裁决 R-A（E305@1:1 vs E310@1:1 并列 → E305 胜出）**：维持既有聚合 `(line, column, code数值)` 不变（305 < 310）。依据：① 聚合机制是 #5~#9 多切片已冻结的行为，本任务无理由改；② E305 是**实证的结构违规**（注释就在那），E310 是**模块级缺席**按约定锚在 1:1，同位时让具体实证者胜出与 E301 先于 generic-diag 终判的既有精神一致；③ 模块仍被拒绝（ok:false），无静默放行。注：既有设计曾断言「位置并列在实际文法中不可构造」（semantic.ts:21-22）——E310@1:1 使该断言失效一次，本节即将其唯一构造位登记为确定性行为。

其余一律 E310 抢胜（SA6 §8.3 要点 1 的规格推论，非缺陷）：缺 ROOT 模块的 E301/E302/E106/E304~E309 全部被 E310@1:1 压制——这正是存量测试要补 ROOT 的原因（§6）。

### 4.2 E311 与既有码（ROOT 在场时的同池竞争）

| 并存场景 | 各自锚点 | 胜者 | 依据 |
|---|---|---|---|
| E311 + 其内未知名 E301（`type ROOT = YArray<Foo>;`） | 1:13 / 1:20 | **E311**（位置在前） | 红灯锁定用例（SA6 §8.1「候选池 min-position 聚合」） |
| E311 + E309（混合联合 ROOT，异类成员在后） | 体起点 / 异类成员起点 | **E311**（首成员=体起点，异类成员构造上恒 ≥ 首成员之后） | min-position |
| E311 + E309（首成员本身 mixed，经别名） | **同位**（mixed 成员即异类锚且可为首成员，shapes.ts:599-600） | **E309**（309 < 311） | 码号兜底；模块仍拒 |
| E311 + E304（`type ROOT = YXmlFragment<number>;` / `YLeaf<{…}>`） | **同位**（标记记号 = 体起点） | **E304**（304 < 311） | 码号兜底；模块仍拒 |
| E311 + E306（`type ROOT = Record<number, string>;`） | — / 1:20 | **E306**（E311 不触发：record 是 map 形） | §2.3 语义分层 |
| E311 + E302（重复 ROOT 且体非 map） | 首体起点 / 次声明名 | min-position 裁定（无冻结用例；两者都合理，聚合定序） | 红灯锁定用例用 map 体 → 仅 E302 胜出，无争议 |
| E310 + E311 | — | **互斥**（E310 仅当无 ROOT，E311 仅当有 ROOT） | 构造性排除 |

### 4.3 语义相位 vs 语法/词法相位（存量测试不受影响面的判定式）

语法 / 词法相位错误（E100~E105 直抛族、E201~E203、E303、括号/负数/裸保留名/交叉违约/E102 声明位/E104/E105/E101/E103——即 parser 内 `throw` 的全部路径）在 `analyze` **之前**失败，E310/E311 不可见 → 对应存量用例**零改动**。判别式（SA3 逐用例套用）：该输入当前是否走到的错误码 ∈ 语义相位码集 {E106, E301, E302, E304, E305, E306, E307, E308, E309, generic-diag 终判 E100/E301}，或当前 ok:true——是则受影响，须按 §6 处理。

---

## §5. 不裁决闭环证明（cycle/unknown 无静默 ok:true）

**命题**：若 `clsOf(ROOT.type) ∈ {'cycle','unknown'}`，则候选池必含至少一条其他语义候选，`analyze` 必返回 ok:false。

**证明**（按 'unknown' / 'cycle' 的全部来源穷举）：

- **unknown 来源 u1——体（或其联合成员）含未声明名 ref**：`semantic.ts:96-101` 的 walk 对**每个**未声明 ref 无条件推 E301 候选（不短路）。∎
- **unknown 来源 u2——体含 generic-diag 节点**：`semantic.ts:104-111` 对每个 generic-diag 无条件推 E100（已声明，锚 ltPos）或 E301（未声明，锚 namePos）。∎
- **unknown 来源 u3——`cls.get(name) ?? 'unknown'` 防御性兜底**：`computeCls` 第 2 步（shapes.ts:292-296）已把全部被引用未声明名显式入表（值 'unknown'），且 SCC 弹出序保证被引用 SCC 先 memo——兜底不可达；即便可达，走到 u3 的路径必经一个未声明名 ref，回到 u1。∎
- **cycle 来源——ROOT（或其传递依赖名）位于引用图环上**：cls 'cycle' 只能由环 SCC 的 on-cycle 分量合成（shapes.ts:233-235, 242）；环在引用图中 ⇔ `semantic.ts:146-171` 迭代 DFS 必遇灰点回边 ⇔ E106 候选入池（遇灰即推，semantic.ts:160-165，全量收集不短路）。∎

**推论**：E311 对 cycle/unique 降 silenced 的唯一效果是「换更根本的身份报错」，不存在 ok:true 逃逸。这与 E304（shapes.ts:553）、E309（shapes.ts:593-594）、E306（⊥ 不裁决）的既有纪律同构，是本仓库语义相位的统一不变量（shapes.ts:17-18 文件头明文）。

**反例自证（三个代表性输入的推演）**：

| 输入 | clsOf(ROOT 体) | E311 | 池内其他候选 | 最终 |
|---|---|---|---|---|
| `type ROOT = Foo;` | unknown（未声明） | 不裁决 | E301@1:13 | E301（红灯锁定绿用例，实施后保持绿） |
| `type ROOT = A; type A = ROOT;` | cycle | 不裁决 | E106@2:10（回边） | E106 |
| `type ROOT = Foo \| string;` | unknown（unknown 主导传播，synthesize） | 不裁决 | E301@Foo | E301（若误裁决 E311@1:13 会抢胜 E301——这正是「不裁决」的必要性：防误报，SA6 §8.1 锁定语义） |

---

## §6. 存量测试对齐方案（SA3 执行清单——最大工作量面）

### 6.0 总规则（先于一切个例）

**规则 G1（补 ROOT 标准形）**：受影响输入追加一行 **`\ntype ROOT = {};`**（文件末尾、独立一行）。

- 为什么是 `{}`：map 形（过 E311）+ 零引用（不引入 E301/E106/E304/E306/E307/E309）+ 零字段（不引入 E308）+ **不带文档注释**（不引入/吸收 E305 挂载）+ 空对象是红灯正例已锁定的最小 map 形。
- 为什么追加在**末尾**：append-only ⇒ 既有全部记号行列不变 ⇒ 既有断言的期望码与行列**零重算**（SA6 §8.3 要点 1 提示的「补入位置推移列号须重算」在 append 策略下整体蒸发）。仅 aliasCount 类断言 +1（见 G3）。
- 比对型输入（`expectDistinct(a, b)` / `expect(x).toEqual(y)`）：**两侧施加同一变换**，可区分性 / 等价性不变。

**规则 G2（语义相位判别式）**：只有「当前 ok:true」或「当前错误码 ∈ 语义相位码集」（§4.3）的输入需要 G1。语法/词法相位用例一律不动。

**规则 G3（数目型断言）**：`expectOk(result, n)` 的 aliasCount 一律 **n+1**；`expect(lines).toHaveLength(82)` → **83**（§6.7）。**断言意图不变**：这些断言的意图是「解析出全部声明 / 行数与构造口径一致」，ROOT 本身就是新增声明。

**规则 G4（零删除红线）**：180 个基线用例一个不删、不 skip；3 个语义翻转用例（§6.1）保留用例本体只改期望；`it` 总数 180 不变，全量终态 **214/214 绿**。

### 6.1 `parse-vfsl.test.ts`（11/11 用例处理）

| 用例 | 动作 |
|---|---|
| T1 MINI_FIXTURE | G1：fixture 末尾加 `type ROOT = {};` 行；`FIXTURE_ALIASES` 数组与 `toContain` 断言不动（不要求加 'ROOT'，加了也不冲突） |
| T2 空文本 / T3 纯空白 / T4 仅行注释 | **语义翻转**（SA6 §8.4 已裁决，本设计确认）：`expectOk` → 断言 ok:false、E310、1:1。用例名同步改写意图，如 `空文本：语法层容忍空模块（不报 E100/E203），语义相位要求 ROOT → VFSL-E310@1:1` |
| T5 注释 trivia / T6 分隔符 / T7 空对象 / T8 前导 \| / T9 前向引用 / T10 BOM / T11 紧凑与分散 | G1（T10 为 `'﻿type A = string;\ntype ROOT = {};'`；T11 两个输入都加） |

**T2~T4 翻转的「意图不变」论证**：原意图是「语法层容忍空模块 / 注释是 trivia」。翻转后该意图仍被证明——**E310 是语义相位错误码，它出现本身就证明文本走完了 tokenize + parse 全程**（语法/词法相位任何一处失败都会先抛 E100~E203/E303）。意图从「语法容忍 ⇒ ok」收窄表达为「语法容忍 ⇒ 到达语义相位 ⇒ 语义要求 ROOT」，断言强度不减反增。

**边界登记**：T4 是**行注释**（`//`，忽略型）→ 翻转后仅 E310@1:1，无并列。若换成**文档注释** `/** x */` 单独成模块则 E305@1:1 并列胜出（§4.1 R-A）——存量无此用例，行为按 §4.1 登记。

**实现提示**：本文件无 `expectSingleIssue` 助手，SA3 就地内联断言（ok:false + issues 长度 1 + 前缀 + 1:1），沿用文件现有风格。

### 6.2 `parse-vfsl-forbidden-matrix.test.ts`（44/79 用例处理）

- **39 个 pos 用例**：G1 + G3（aliasCount 一律 +1）。逐用例：E101 ×8、E102 ×8、E103 ×8、E104 ×8、E105 ×7。
- **5 个语义相位 neg 用例**：G1（锚点行列不变）：`E101-07-neg`（E301）、`E102-06-neg`（E301）、`E102-07-neg`（**E100 generic-diag 终判——语义相位，SA6 分类漏项，§0**）、`E102-09-neg`（E301）、`E105-07-neg`（E301）。
- **35 个语法相位 neg 用例**：零改动（E101-01..06/08、E102-01..05/08、E103 全部、E104 全部、E105-01..06——全部在 parser 内 throw）。

### 6.3 `parse-vfsl-containers-markers.test.ts`（27/33 用例处理）

- describe「正例」13 用例：G1（**含全部 `expectDistinct` 双文本**——两侧都加 ROOT 行，标记可区分性保持）。
- describe「反例」9 用例（E304×4 / E306×2 / E307×2 / E309×1）：G1，锚点不变（如 `type A = YMap<string>;` → E304@1:10 保持）。
- describe「交叉类型」：5 个 E100 用例语法相位零改动；2 个 ok 用例（`Pattern<"[">`、`\\d` 解码）G1。
- describe「大小写」：用例 1（ok + E301 两输入）、用例 2（E301）、用例 3（ok）G1；用例 4（`type A = YMap;` → E100 语法相位）零改动。
- **§10 fixture 整体替换（AC 第 8 条 / SA6 §8.3 明示）**：最后一个用例的旧版 fixture（`type AssetsDoc = YXmlFragment<{…}>`、text 成员 `body: YLeaf<string>`）替换为**规格 §10 修订版全文**——canonical 副本直接取红灯测试 `parse-vfsl-root-convention.test.ts:246-276`（逐字同源，避免转录漂移）。断言改动：名字数组 `['AssetId','Audit','AssetEntity','Attachments','AssetsDoc']` → `[…,'ROOT']`；`jsonContainsString(module,'^[A-Za-z0-9_\\-]{1,64}$')` 与 roundtrip 不变。

### 6.4 `parse-vfsl-cycle-detection.test.ts`（16/16 用例处理）

- AC1 三用例 + AC2 六用例（全部 E106）：G1，锚点与环路径消息断言全部不变（append-only）。
- **AC3 四用例 + AC4 前两用例**：两份旧版 §10 fixture 副本（:174-204 与 :326-356）都替换为修订版全文（同 §6.3 canonical 副本）。断言随动（意图不变——仍是「fixture 全量解析 + 六标记入 IR + 七条 doc 挂对 + 判别联合入 IR + 可序列化/确定性」）：
  - `expect(names).toEqual([…,'AssetsDoc'])` → `[…,'ROOT']`（六别名）。
  - `DOC_ASSETSDOC` 常量 → `DOC_ROOT = ' ROOT：命名空间根文档，assets 键集受 AssetId 的 Pattern 约束 '`（修订版 §10 注释原文）；`aliasNode(module,'AssetsDoc')` 全部 → `'ROOT'`（docs / keywords / notes / assets / 其他字段不泄漏循环）。
  - `AssetsDoc → YXmlFragment` 断言拆两条：`ROOT → YMap`（修订版根形态）+ **YXmlFragment 降位断言**——`AssetEntity` 联合 `members[1]`（text 成员）的 `body` 字段类型为 `{kind:'marker', marker:'YXmlFragment'}`。「六标记全部进入 IR」的用例意图由此保持全覆盖。
  - 其余（AssetId pattern regex、Audit YMap、Attachments YPlainArray<YLeaf>、file 成员 tags YArray、判别联合 kinds、Record 键值 ref、roundtrip、确定性）不变。
- AC4 第三用例（kind 覆盖文本）：G1（行数组追加 `'type ROOT = {};'`；文本中已有 `type Root = {...}` 与 `ROOT` 大小写并存合法，红灯正例锁定）。

### 6.5 `parse-vfsl-errors.test.ts`（5/19 用例处理）

E301×2（含多行 3:10）、E302×1、E106×2 → G1，锚点不变。其余 14（E100×5、E101~E105、E201~E203、E303）语法/词法相位零改动。

### 6.6 `parse-vfsl-jsdoc.test.ts`（7/7 用例处理）

| 用例 | 动作 |
|---|---|
| 连续两条 doc 挂 AssetId | G1（追加在末尾，不影响 doc→AssetId 相邻挂载） |
| 属性位 notes（局部 fixture `type AssetsDoc = {…}` 是**手造对象 fixture，非 §10 fixture**） | G1（名字不改；E311 只看 ROOT 自己的体） |
| 标记类型位 doc 挂 YMap | G1 |
| **E305 悬空**（`type A = string;\n/** 悬空文档注释 */` → E305@2:1） | **特例：行内插入，不能 append**——append 会让悬空 doc 挂到新 ROOT 上（M1 相邻挂载），E305 消失、断言意图损毁。改为 `'type A = string; type ROOT = {};\n/** 悬空文档注释 */'`：ROOT 在场消 E310，doc 仍在模块末尾无可挂载节点 → **E305@2:1 原码原位保持，断言零改动**（SA6 §8.4 第二条「补 ROOT 后 E305 恢复胜出」的落地形态） |
| 忽略型注释不破坏相邻挂载 | G1 |
| `//` 与 `/* */` 有无比对 IR 相等 | G1 双侧同变换，`toEqual` 保持 |
| `/**/` / `/***/` 特例比对 | G1 双侧同变换 |

### 6.7 `parse-vfsl-r3-regression.test.ts`（3/7）与 `parse-vfsl-sa7-supplementary.test.ts`（8/8）

r3：R-2 三用例（E106/E106+E302）G1，锚点 (1,15)/(2,15) 不变；R-1 四用例（E100 语法相位）零改动。

sa7（全部为变量构建输入，在**行数组**追加 `'type ROOT = {};'`）：

| 用例 | 动作 |
|---|---|
| T-l（20k 链 ok:true） | 行数组 push ROOT 行；性能断言（隐含 <1s 级）不受影响（§3.2 资源界） |
| T-R2-4 | 行数组 push ROOT 行 + **`expect(lines).toHaveLength(82)` → `toHaveLength(83)`**，行尾注释改「2k+2+ROOT 行（#19 对齐口径：2k+2 声明行 + 1 根行）」；E302@(2,6) 不变 |
| T-R2-5 | 同上（本用例无长度断言）；E302@(2,6) 与 <1s 断言不变 |
| T-R3-2 | moduleA/moduleB **两串各自**追加 `\ntype ROOT = {};`（同变换保持「同码同位同文」断言：E304@1:10 双侧一致） |
| T-R4-1 / T-R4-2 | G1；E106@2:15 不变 |
| **fuzz 记号汤**（`okTrue > 0` 断言是隐藏反向锁——TOKENS 字母表无 `ROOT` 记号，E310 落地后纯随机汤**不可能**再产出 ok:true，断言必红） | 每个随机输入改为 `assertParseContract(parts.join('') + '\ntype ROOT = {};')`。**设计期实测依据（SA1 跑 mulberry32(20260819) 全模拟）：3000 次迭代中 26 次 length===0（空汤），这些输入恰为 `\ntype ROOT = {};` → ok:true 确定性触达，`okTrue > 0` 在固定种子下必然成立**；非空汤几乎全落 ok:false 支路，`okFalse > 0` 平凡成立。TOKENS / chars 字母表**不动**（动字母表会扰动 PRNG 流，把确定性换成抽签） |
| **fuzz fixture 变异**（`okTrue > 0`） | FIXTURES 池 7 条**每条末尾追加** `\ntype ROOT = {};`。确定性依据：系统性全前缀截断循环含 `end === fixture.length`（完整 fixture，含 ROOT）→ 每条 fixture 至少贡献 1 个 ok:true，不依赖种子。变异/删字符/插入产物照常落契约两支 |

### 6.8 对齐面汇总（SA4 验尸口径）

| 文件 | 用例总数 | 受影响 | 处置 |
|---|---|---|---|
| parse-vfsl.test.ts | 11 | 11 | 8 × G1 + 3 × 语义翻转（§6.1） |
| parse-vfsl-containers-markers.test.ts | 33 | 27 | G1 ×26 + §10 fixture 替换 ×1 |
| parse-vfsl-cycle-detection.test.ts | 16 | 16 | G1 ×9 + §10 fixture 替换 ×2（6 用例）+ kind 文本 G1 ×1 |
| parse-vfsl-errors.test.ts | 19 | 5 | G1 |
| parse-vfsl-forbidden-matrix.test.ts | 79 | 44 | G1（39 pos + aliasCount+1；5 语义 neg） |
| parse-vfsl-jsdoc.test.ts | 7 | 7 | G1 ×6 + E305 行内特例 ×1 |
| parse-vfsl-r3-regression.test.ts | 7 | 3 | G1 |
| parse-vfsl-sa7-supplementary.test.ts | 8 | 8 | 行数组 G1 ×6 + fuzz 双用例设计 §6.7 |
| **合计** | **180** | **121** | 零删除、零 skip、`it` 计数 180 不变；+ 红灯 34 → 终态 214/214 |

---

## §7. 边界裁决登记（无冻结用例处，SA1 显式定案）

| # | 边界 | 裁决 | 理由 |
|---|---|---|---|
| R-1 | 前导 `\|` 联合的 E311 锚（`type ROOT = \| string \| number;`） | 锚 = **首成员起点记号**（AST union.pos = nodePos(members[0])，parser.ts:268），非前导 `\|` 记号 | ① 单成员前导 `\|`（`\| string`）被 parser 坍缩为裸 primitive（parser.ts:265-267），「锚 `\|`」读法在两种形态间不自洽；② `\|` 是分隔符非类型记号，本仓库全部锚点（E301/E309/E306）一律锚类型记号；③ 改 union.pos 需动 parser（DENY），收益为零——无冻结用例、无存量回归 |
| R-2 | `ROOT` 作为字段名 / marker 实参名 / 变体别名名 | 与根检查无关；`type root = …` 是普通惰性积木 | 检查域 = 顶层 TypeAlias 声明名，精确匹配 'ROOT' |
| R-3 | 重复 ROOT 的 E311 | 逐声明体独立裁决，各自入池 | 「重复声明 → E302」是存在性维度；非 map 形是每体的形状维度，spec §3 三条并列条件，min-position 聚合定序 |
| R-4 | `/** x */` 单独成模块（E305@1:1 + E310@1:1） | E305 胜出（码号 305<310，§4.1 R-A） | 模块仍拒；E305 消解后（补声明）E310 自然浮现或一并消失 |
| R-5 | BOM 前缀 + 无 ROOT | E310@1:1（BOM 剥离不占列，spec §9.2） | 与空文本锚同构 |
| R-6 | `Record` 形 ROOT 内部键非法 / `YMap` 形 ROOT 实参非法 | E311 通过（map 形），E306/E304 各自报 | E311 只裁决根位 map 形（§2.3），分层不越权 |
| R-7 | ROOT 体是 generic-diag（`type ROOT = Foo<Bar>;`） | clsOf → localCls(generic-diag) = 'unknown' → 不裁决；终判通道（E100/E301）在池 | shapes.ts §8-14 既有纪律 |

---

## §8. 协议假设依据 (Protocol Assumption Evidence)

**无协议级假设**：本设计仅涉及纯代码逻辑（解析器语义相位新增检查 + vitest fixture 对齐），不含 HTTP/WS 端点、端口占用、进程/时序、第三方库行为四类假设。

为防 SA2/SA4 追问，承载设计结论的**内部行为依据**（全部为本轮源码引用级核对）：

| 内部行为假设 | 依据类型 | 依据内容 | 风险 |
|---|---|---|---|
| 聚合 = (line, column, 码号) 排序取首 | 源码引用 | `semantic.ts:182-184` | 低 |
| clsOf 六值 + union 行 + 别名链解析 | 源码引用 | `shapes.ts:108-129 / 136-160 / 301-312` | 低 |
| 语义相位候选全量收集不短路 | 源码引用 | `semantic.ts:96-124, 160-165`；`shapes.ts:553, 593-597`（不裁决纪律） | 低 |
| fuzz 种子 20260819 下 `okTrue > 0` 确定性恢复 | **设计期实测验证** | SA1 跑 mulberry32 全模拟：`node /tmp/sa1-fuzz-sim.mjs` → 3000 迭代 26 次 length===0（空汤 + 追加 ROOT 行 ⇒ ok:true 必触达）；SA7 动态期再以真实 vitest 复核 | 中→低（SA7 复核） |
| fuzz 变异用例 `okTrue > 0` 确定性 | 源码引用 | `parse-vfsl-sa7-supplementary.test.ts:258-262` 前缀截断循环含 `end === fixture.length`（完整合法 fixture） | 低 |
| 基线 180 全绿 / typecheck EXIT 0 | 简报 §三（总控 2026-08-19 14:44 实测）+ SA1 用例计数复核（§0） | 低 |

---

## §9. 契约改动连锁审计 (Contract Change Caller Audit)

**无契约改动**：本设计仅涉及【语义相位内部新增检查 + 内部注释 + 测试 fixture 对齐 + 版本号 bump】。

- `parseVfsl(text)` 签名、返回二态联合、`VfslIssue { message, line, column }`、message 前缀 `VFSL-E<三位>: ` 全部不变（红线 2，只增不改——E310/E311 是「增」）。
- 无任何函数的签名 / 返回类型 / throw 行为 / async 性变化；无导出面变化（errors.ts 的 `ErrCode` 仅加两个键，纯增量；shapes.ts 无新导出）。
- Caller 清单：`parseVfsl` 的唯一编排链 `index.ts:31-53 → tokenize → parseModule → analyze → collectShapeCandidates`，新增逻辑位于链尾内部，无新 caller、无既有 caller 行为半径变化。

---

## §10. SA7 动态验证登记（Hard Gate #14 关联）

SA7 须以真实 `pnpm vitest run` 输出验证（本设计只登记验证点，不代跑）：

1. **红灯转绿**：`pnpm vitest run packages/vfsl/test/parse-vfsl-root-convention.test.ts` → 34/34（21 反例全绿 + 13 锁定用例保持绿）。**vitest 触发证据**段落必含（红线 5）。
2. **全量**：`pnpm test` → **214/214**（8 文件 180 存量 + 34 新增），EXIT=0；`pnpm typecheck` EXIT=0。
3. **零删除核对**：`it(` 计数 per 文件与 §0 基线表一致（180 不变）；无 `.skip` / `.only` / 删除（`grep -rn '\.skip\|\.only\|\.todo' packages/vfsl/test/` 零命中）。
4. **注册表核对**：`errors.ts` ErrCode 键数 = 21，与 spec §4 总表逐码对上（AC 第 9 条）。
5. **零依赖红线**：`packages/vfsl/package.json` 无 `dependencies` 字段、version = 0.1.4。
6. **抽查锚点不变式**（SA7 自选 ≥3 条）：前导 doc 无 ROOT 仍 1:1；空文本 1:1；`type ROOT = YArray<Foo>;` E311@1:13 抢胜 E301@1:20。
7. **fuzz 确定性复核**：两 fuzz 用例 okTrue/okFalse 双支路触达（§8 表第 4/5 行依据的运行时证实）。

---

## §11. 残余风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| §7 R-1（前导 `\|` 锚点取首成员）与 R-4（E305@1:1 并列）无冻结用例，属实现裁定量 | 低 | §7 显式登记裁决 + 理由；SA2 如认为应锚 `\|` 记号，需先推翻「单成员坍缩不自洽」论证并动 parser（DENY 解除须走修订流程） |
| forbidden-matrix 39 处 aliasCount +1 的机械改动量大，易漏 | 低 | §6.2 规则化（一律 +1）+ SA4 按 §6.8 表 set 比对；漏改必红（aliases 长度断言），不会静默 |
| §10 fixture 三处副本替换若手抄而非复制 canonical 源，有转录漂移风险 | 低 | §6.3 指定以红灯测试 :246-276 为 canonical 逐字源；替换后 cycle AC3 的 regex/doc 原文断言（逐字级）即漂移探针 |
| fuzz 汤用例改动触碰测试骨架（输入拼接式）而非断言 | 低 | 断言集合不变（契约自检 + 双支路触达），仅输入构造加固定后缀；SA4 静态比对可见 |

---

## SA2 反馈逐条回应

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|---|---|---|---|
| （首轮交付，暂无 SA2 反馈） | — | — | SA2 reject 后本表逐条落实，修订只增不删 |

---

## §12. 文件清单（File Scope）

### ALLOW LIST

- `packages/vfsl/src/errors.ts` — 修改：ErrCode 注册表追加 E310/E311 两键 + 头注释 19→21 码（≤6 行）。AC 第 9 条。
- `packages/vfsl/src/shapes.ts` — 修改：`collectShapeCandidates` 末尾追加 ROOT 完整性块（E310/E311 候选，§3.2 蓝本，≤45 行含注释）+ 文件头注释更新（≤4 行）。
- `packages/vfsl/src/semantic.ts` — 修改：**仅文件头注释**补记 E310/E311 经 shapes 并入一句（≤4 行，零逻辑改动）。
- `packages/vfsl/package.json` — 修改：version 0.1.3 → 0.1.4（Hard Gate #9）。不新增 dependencies。
- `packages/vfsl/test/parse-vfsl-root-convention.test.ts` — `[SA6 owned]` 验收红灯测试（已存在，34 用例）。**SA3 不得改动任何断言**；13 个锁定绿用例（E302@33、E301@13、11 正例）实施前后必须同绿。SA6/SA7 仅可在总控指令下追加用例。
- `packages/vfsl/test/parse-vfsl.test.ts` — 修改：8 用例补 ROOT + 3 用例语义翻转（§6.1，含用例名与断言期望改写，零删除）。
- `packages/vfsl/test/parse-vfsl-containers-markers.test.ts` — 修改：26 用例 G1 + §10 fixture 替换为修订版及其名字数组断言（§6.3）。
- `packages/vfsl/test/parse-vfsl-cycle-detection.test.ts` — 修改：9 用例 G1 + 两份 fixture 副本替换及随动断言（ROOT/YMap/YXmlFragment 降位/DOC_ROOT，§6.4）+ kind 文本补 ROOT。
- `packages/vfsl/test/parse-vfsl-errors.test.ts` — 修改：5 用例 G1（§6.5）。
- `packages/vfsl/test/parse-vfsl-forbidden-matrix.test.ts` — 修改：44 用例（39 pos G1+aliasCount+1；5 语义 neg G1，§6.2）。
- `packages/vfsl/test/parse-vfsl-jsdoc.test.ts` — 修改：6 用例 G1 + E305 用例行内插入特例（§6.6）。
- `packages/vfsl/test/parse-vfsl-r3-regression.test.ts` — 修改：3 用例 G1（§6.7）。
- `packages/vfsl/test/parse-vfsl-sa7-supplementary.test.ts` — 修改：6 用例行数组补 ROOT（含 toHaveLength 82→83 与注释）+ fuzz 双用例输入构造加固定 ROOT 后缀 / FIXTURES 各追加 ROOT（§6.7，断言集合不变）。

### DENY LIST

- `packages/vfsl/src/index.ts` — 公共接缝编排无需改动（§1.3、§9）。
- `packages/vfsl/src/parser.ts` — E311 锚点复用既有 `AstType.pos`，零解析器改动（§7 R-1 裁决含 leading-\| 不改 union.pos）。
- `packages/vfsl/src/tokenizer.ts` — 词法层不涉及（ROOT 非保留名，§0 核对）。
- `packages/vfsl/src/ir.ts` — IR 形状不变（ROOT 是普通别名，§1.3）。
- `docs/vfsl/v1-spec.md`、`docs/adr/**` — 冻结规范与 ADR，任何 SA 不动。
- `package.json`（仓库根）、`pnpm-lock.yaml` — 零运行时依赖红线，无依赖变更。
- `CONTEXT.md`、`README.md`、`wiki/raw/` 其他档案 — 非本任务产出面。
