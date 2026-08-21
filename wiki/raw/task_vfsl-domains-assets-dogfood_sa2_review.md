# SA2 攻击评审报告 — domains/vfs3-assets 领域包 dogfood（issue #27，票 G）

**Date**: 2026-08-21
**Verdict**: **pass**（附 1 条放行条件：总控须在合并前登记 §6.2 第 4 条的规格轴 follow-up——见攻击点 1）
**被审对象**: `task_vfsl-domains-assets-dogfood_design.md`（SA1 R1）
**评审方式**: 全文攻击 + **独立实测复核**（非仅纸面）：哈希 oracle 重算、fixture 逐字 diff、修复 diff 实核、452/452 全量复跑、干净阴性对照重建、SA2 自建对抗探针（16 断言 × 修复后 + 基线对账）、AC5 回退 (b) 实活复现、CI 退出码两端实测。证据见末节「SA2 独立验证日志」。

---

## 攻击点清单

| # | 严重度 | 攻击面 | 具体漏洞 | 建议 |
|---|--------|--------|---------|------|
| 1 | **MEDIUM** | D3 / AC5 (a) 标记臂空转 | 「守门链非裸空转」的论据 (ii) **oversells**：F1 `evaluate-derived-docs-audit.test.ts` 性质断言（markerDocs 键数 === IR marker 节点总数，已核：行 207-212 在场）封的是 **evaluate 层**（derived.markerDocs 完整性），**不封 emitter 层**。实核 `packages/vfsl-codegen/test/generate-mapping-table.test.ts`「AC2 — docs 三槽 → TSDoc」仅 2 条断言且全在 aliasDocs 位（行 164-176）——**emitter 的标记位行内发射（emitter.ts:231 `tsdocLines(tables.markerDocs[path], '')`）在全仓 452 测试中没有任何非空转覆盖**。选 (a) 后该行若回归为空串，无任何红灯。AC5 括注自称「证据缺口在此补齐」，而 (a) 下标记锚的 emitter 侧证据缺口**本票内并不闭环**，仅靠 follow-up。另：标记臂断言形态是全文 `toContain`（文件内任意位置在场即过），弱于别名/字段臂的 AST 挂载断言——即使 (b)/#46 激活，doc 挂错标记位也照绿。 | **放行条件**：总控登记规格轴 follow-up（§10 标记位补 JSDoc + fullchain-e2e/validate-snapshot 两份逐字副本同步 + 本包标记臂激活验收）。follow-up 落地时把标记臂升级为**位置感知断言**（tsc parser 定位成员签名的行内 jsDoc 或精确行匹配）+ 防空转守门（checked ≥1）。本票维持 (a) 不改：已实测回退 (b) 可一句话激活（见验证日志 #6），偏离 §10 的代价判断成立。 |
| 2 | LOW | D2 证据附录 | 附录 C.5 阴性对照「领域三文件 **7** 个类型错误」与干净环境实测不符：SA2 重建干净对照（完整 install 的 wt-c = wt-a 复原协议文件）实测为 **4 文件 / 32 个类型级失败**（领域 2 个 test-d + `vfsl-protocol-projection.test-d.ts` + `generate-discriminated-narrow.test-d.ts`——增广泄漏入统一 typecheck program，修复回退 = 4 文件红墙，比设计所述更广）。SA1 的 wt-b 复测被陈旧 node_modules 污染（收集截断：tsdoc 文件未入列，25/31 测试）。**实质结论（测试鉴别修复）成立且更强**，仅证据计数不可复现。 | 非阻塞。SA4 复核时用 wt-a 的**全新副本**（勿用 /tmp/wt-b 现态）重跑阴性对照；建议 SA1 后续修订顺手订正 C.5 措辞。 |
| 3 | LOW | D2 §4.4 diff 规格 | scratch 证据副本（/tmp/wt-a）只应用了 3 行代码改动，**注释块重写未应用**（MemberKeys 上行注释仍是旧文）；且 VfslValueOf 段的 diff 排版有损（首行上下文与 `-` 行错位）。语义无歧义（散文已精确给出两处替换），零行为影响。 | SA3 应用时以 §4.4 散文描述（`Record<infer Key, unknown>` → `object`、`[K2 in Key]` → `[K2 in keyof V]`，含注释同指）为准；SA4 对照本报告验证日志 #2 的目标态实核。 |
| 4 | LOW | D2 语义覆盖 | 「穿越可选成员下钻」语义（中途 undefined 被 Step 分发吸收，终态才诚实宽：`['o','m','z']` 读 = `string` 非 `string \| undefined`）**无 committed 测试钉死**——§8.4 的 tags 先例钉的是联合成员独有键的同构情形，可选成员版只在 SA1/SA2 的临时探针里。语义本身与钉死先例**一致**（SA2 探针 A9 实核，非缺陷）。 | 本票不动协议测试（DENY 正确）。建议后续票在 `packages/vfsl-protocol/test` 补一条可选 map 成员下钻的钉死断言。 |
| 5 | LOW | D3 / 文档一致性 | migration 测试文件头的「缺陷绕行说明」注释在 D2 修复落地后成为历史陈述，但措辞（「该协议级缺陷已上报」）易被未来读者误读为缺陷仍存活。设计 §5 决定保留（[SA6 owned]，DENY 正确）。 | 非阻塞。建议在 #46 或后续协议票顺手刷新该注释措辞。 |
| 6 | 记录（强化论据） | D2 选型 A | 基线假型形态比设计 §4.1 所述**更坏**：嵌套 map 位（含可选成员）旧行为是「**未展开的 PathSchema 树原样透传**进值位置」（SA2 基线探针 B2 实核：`PathValue<PathAt<OptTable,['o']>>` = `{ keep: PS<string,'leaf'>; opt?: PS<number,'leaf'> }`），非仅根位的 `{}`。两类都是静默 fail-open 假型——选型 A 的「根修三处」必要性被进一步证实。 | 无需动作；供 SA7/ADR 复审存档。 |

### 已攻击并排除（probed-and-cleared，不再追）

- **裸数组契约外形态无新假绿**：手写 `PathSchema<string[], 'array'>`（发射器永不产出：裸 T[] 恒映射 `Record<\`${number}\`,…>`）在新旧两版协议上行为**逐点一致**（SA2 探针实核：`['a','length']` 两版均 PathKind=never / PathValue=number）。`keyof` 对数组的方法键暴露是旧码 Record-infer 同款垃圾面，非本次引入。
- **穿越可选成员下钻 ≠ 缺陷**：见攻击点 4，与 §8.4 tags 钉死先例同语义（SA2 一度误判为假绿，经 tsc 类型揭示自纠）。
- **`keyof Record<string, X>` = string \| number 不引入行为差**：路径段恒为 string（`P extends readonly string[]`），Step 门禁结果与旧码 `Key=string` 等价；`Record<\`${number}\`,…>` 同理。
- **联合成员内可选成员的旧「部分坍缩」**：基线实核——`{a} | {b?}` 表中 b 静默不可达（UnknownPath）而 a 正常（部分假红，非全坍缩）；修复后两全（探针 A1）。属旧缺陷形态之一，A 已覆盖。
- **readonly/`?` 修饰符保留**：同态 keyof 实核保留（探针 A3），与 §4.3 代价披露一致；旧行为是坍缩，无可合法依赖者。
- **混合「索引签名 + 可选成员」手写表**：修复后全形态正确（探针 A6）。
- **fail-closed 方向不变**：未知键 → UnknownPath（A7）、空表 never（A8）、`keyof never` 不可达——实核。
- **PathElementValue 不修**：其 Record-infer 输入恒为纯索引签名 Record，可选成员只可能住在元素节点**内部**（不触发推断位）——探针 A5（array 元素 = 含可选成员的联合）实核绿。不修决定成立。
- **D1 oracle 与 schema 演进无冲突**：附录 A/B 的 sha256 是本票一次性验证 aid（SA2 重算逐字节吻合）；在仓的演进绑定是 `generate --check` 全量重生成 diff（ADR 0005 §4），wiki oracle 不构成演进阻力。
- **附录 B 与生成器版本耦合稳定**：header.ts 运行时读 codegen package.json version（0.1.1 未 bump）→ 头注重力稳定；未来 bump 由 regen-diff 双抓。
- **原子提交范围含 lockfile**：§9 step 7 明列 `pnpm-lock.yaml`（协议修复 + bump + 领域包四件 + lockfile + ci.yml）。

---

## 协议假设依据审查（技能 §3）

- **章节存在性**：§12 存在，10 行假设全表列依据。✓
- **无据推断扫描**：依据栏全部为「设计期实测 + 附录 C 编号」或文档/源码引用；唯一非实测条目（frozen-lockfile）引的是 pnpm 官方文档公认语义 + CI 既有步骤，属可接受文档级依据。**无「应该/通常/预计」类裸推断**。✓
- **实测声称可验证性**：SA2 独立重跑了全部承重实测（见验证日志）——命令可重跑、产物可比对（sha256 oracle 逐字节吻合）。**例外**：C.5 阴性对照的计数不可复现（攻击点 2，LOW），且 /tmp/wt-b 现态已被陈旧 install 污染，SA4 勿直接复用。
- **结论**：通过（附攻击点 2 的证据卫生提示）。

## 错误处理链路审查（技能 §4）

本 Feature 无用户交互/异步 UI 面；错误处理 = 编译期 fail-closed 语义 + CLI 退出码 + CI 门禁：

- **静默失败检查**：修复**移除**了两条既存静默假型路径（根位 `{}` 坍缩、嵌套位 PathSchema 树透传——攻击点 6），未引入新静默面。未知键/空表/终态越界三向 fail-closed 经探针 A7/A8 + empty-fail-closed 套件实核不变。✓
- **状态闭环**：CLI 退出码语义（0/1/2）源码实核（cli.ts:56-70）；零领域无 flag → exit 2 响亮失败（当前 worktree 实测复现）；种包后 `--check` exit 0（wt-a 实测）。✓
- **降级路径 / 虚假降级**：无「把正常路径前提缺失当降级」的伪降级模式。CI 摘 flag 后「domains/ 被误删/改名」回归掩蔽防护成立（SA2 实测：当前仓 domains/vfs3-assets/ 仅有 test/ 无 schema.vfsl，`generate --check` 仍 exit 2）。✓
- **结论**：通过。

## 红线测试思路（技能 §5——思路非代码）

1. **攻击点 1（emitter 标记位无非空转守门）**：#46 落地时的红灯形态——fixture 携带 `notes?: /** X */ YLeaf<string>` 后：(i) 标记臂防空转守门 `checked.length >= 1`（缺守门则守门自身可被删而全绿——反自毁断言）；(ii) 位置感知断言：tsc parser 定位 `VfslPathMap` 增广接口中 `notes` 成员签名，断言其类型节点前导 trivia 含该行内 doc 原文（而非全文 `toContain`）——挂错标记位（如挂到 keywords 上）须红；(iii) 反向红灯：手工从 generated.ts 删掉该行内 doc → 测试须红（防「在场但不可鉴别」）。
2. **攻击点 4（可选成员下钻语义无钉死）**：协议套件后续票补钉——表 `{ m?: PathSchema<{ z: PathSchema<string,'leaf'> }, 'map'>; n: PathSchema<number,'leaf'> }`：断言 `PathValue<PathAt<T,['m']>>` = `{ z: string } | undefined`（终态诚实宽）、`PathValue<PathAt<T,['m','z']>>` = `string`（中途吸收，与 tags 先例对齐）、`patch(['m','z'], 's')` 可编译、`PathKind<PathAt<T,['m','z']>>` = `'leaf'`。Step 的 undefined 吸收语义若变，该组转红。
3. **攻击点 2（阴性对照污染）**：不算新测试——SA4 复核规程：阴性对照必须用「全量 install 完成后再复原单个协议文件」的副本，且以 `pnpm test` 全量（而非领域子集命令）观测爆炸半径（正确读数 = 4 文件 / 32 失败红墙）。
4. **修复回归面（已闭环，存档备查）**：修复被整体回退的红墙 = 领域 2 test-d + protocol-projection + codegen-discriminated-narrow 四文件齐红（SA2 wt-c 实测）；其中后两者是增广泄漏入统一 typecheck program 的「免费守门」——若未来 vitest typecheck 改为按文件独立 program，该免费守门失效，届时攻击点 4 的补钉从 LOW 升为 MUST。

## ALLOW / DENY 完整性核对（攻击面 5）

- SA3 所需全部文件均在 ALLOW：协议 src/package.json、领域四件、pnpm-lock.yaml、ci.yml、设计文档。逐项核对无遗漏（`pnpm install` 不动根 package.json——新包 devDeps 全部已存在于仓内 lockfile 版本池；无 tsconfig 需求——scratch 实核；无 .gitignore/CHANGELOG 惯例——仓内均无）。
- DENY 无误拦：`tests/acceptance/`（python harness）与本票零牵连；`packages/vfsl-protocol/test/**` 的 DENY 阻挡了「协议层补可选成员回归测试」这一 nice-to-have——可接受，因为修复回退的守门已由领域测试 + 增广泄漏红墙双重承担（见红线思路 4）；记录为攻击点 4 的后续票。
- DENY 无漏禁：`docs/vfsl/v1-spec.md`、`docs/adr/**`、codegen 全包、两份 §10 逐字副本测试均在列；`cli.ts` flag 本体保留的切割（CI 不再使用 ≠ 删除逃生门）正确。

## SA2 独立验证日志（2026-08-21，typescript 5.9.3 / node v24 / 仓内 lockfile 工具链）

1. **oracle 实核**：附录 A 内容（设计文档行 384-416 + 自带尾换行）sha256 = `82e98fa1…93c69` ✓ 与钉死值逐字吻合；scratch 种植文件 `/tmp/wt-a/domains/vfs3-assets/schema.vfsl` / `generated.ts` 哈希与两 oracle 逐字节吻合 ✓。
2. **fixture 逐字**：v1-spec.md §10 代码块 awk 抽取 vs 附录 A 去头部四行 → `diff` 零差异（FIXTURE-VERBATIM-OK，各 29 行）。
3. **修复 diff 实核**：`diff worktree:packages/vfsl-protocol/src/index.ts /tmp/wt-a:…` = 恰好 3 处（:27 / :63-64 / :88-89），与 §4.4 语义一致（注释块未应用于 scratch，攻击点 3）。
4. **452/452 复跑**：/tmp/wt-a `pnpm test` → `Test Files 30 passed (30) / Tests 452 passed (452) / Type Errors no errors`（含 parse-vfsl-forbidden-matrix、三协议测试、domains-scaffold）；`tsc -p tsconfig.typecheck.json` 0 错误；`generate --check` exit 0。
5. **干净阴性对照**：新建 wt-c = wt-a 全量副本 + 复原协议文件 → 领域三文件 `Type Errors 14 failed`（纯坍缩驱动，零环境噪声）；全量 `pnpm test` → **4 文件 / 32 失败 / 420 passed**（红墙含 protocol-projection 与 codegen-discriminated-narrow——增广泄漏实锤，修复鉴别力超设计所述）。
6. **AC5 回退 (b) 实活**：wt-a schema.vfsl 加 `notes?: /** 可选说明的 Yjs 叶子载体 */ YLeaf<string>;` → `pnpm generate` → 生成物行内位 `/**  可选说明的 Yjs 叶子载体  */`（双空格 = 派生 docs 保留原空白 + tsdocLines 单空格包裹，与标记臂未 trim 的 needle 相容）→ tsdoc 测试 **6/6 绿**（标记臂实质化）；探后已复原并复校哈希。⚠️ 此实验证实「fixture 驱动自动激活」为真，也证实标记臂 needle 与发射形态的空格耦合成立。
7. **SA2 对抗探针**（/tmp/vfsl-probe/sa2-attack-fixed.ts，16 断言，旗标对齐 tsconfig.base 含 exactOptionalPropertyTypes + noUncheckedIndexedAccess）：联合成员内可选（A1）、嵌套可选 map（A2）、readonly+可选保留（A3）、整 map 写投影可选不强制（A4，`{ w: 1 }` 合法）、array 元素含可选联合（A5）、索引签名+可选混合手写表（A6）、未知键 fail-closed（A7）、空表 never（A8）、可选 map 成员终态/下钻语义（A9）——**全绿**。基线对账（sa2-attack-baseline.ts + contract-out 两版）：部分坍缩、透传假型、契约外形态两版一致，均实核。
8. **发射契约对照**：`generate-mapping-table.test.ts:179-203` 实核断言 `title?:` / `meta?:` 键后单 `?` 形态——候选 B 确须翻转该 F2 验收锚（设计 §4.3 第 4 面成立）；protocol-surface.ts 12 名冻结名单实核无增删。
9. **CI 两端**：当前仓（未种包）`generate --check` exit 2 响亮失败 ✓；wt-a（种包）exit 0 ✓；ci.yml 两处编辑点（行 43/50-53/55）与设计 §3.6 引述一致。

## 结论

SA1 R1 设计的全部承重断言经 SA2 独立实测复核成立；D2 选型 A 的根修论证、D3 选 (a) 的权衡、D1 种植方案、D4/D5 钉死均无可推翻的攻击点。**Verdict: pass**，放行条件一条（攻击点 1：总控登记规格轴 follow-up，防止 AC5 标记锚 emitter 侧证据缺口无限期悬空）；LOW 级攻击点 5 条均为非阻塞提示（证据卫生 / diff 排版 / 测试补钉 / 注释措辞），移交 SA4/SA7 与后续票知悉。
