# SA4 静态验尸报告 — task_xml-attr-quote-domain（Issue #94，Bug 修复）

**Date**: 2026-08-23（R1）/ 2026-08-23（R2 复审）
**Verdict（R2 最终）**: **pass** —— R1 唯一阻塞项（scope-creep-detected：`packages/doc-runtime/package.json` 不在 design §7 ALLOW LIST）已由 SA1 R2 修订消除，SA4 R2 复核通过（详见文末「R2 复审结论」）。R1 全部技术审查结论（§1.2-§1.7、§2-§8 独立静态+运行复验）原样承继——代码自 R1 后零变化，按 R1 声明路径无需重审代码。下文 R1 记录完整保留（其时点 verdict 为 reject，含完整证据链）。

---

## R2 复审结论（最终轮，2026-08-23）

**最终 Verdict: pass。**

**R2 复核对象**：SA1 对 `wiki/raw/task_xml-attr-quote-domain_design.md` 的 R2 修订（worktree 内，vs R1 已提交版 a2e6c52 的 `git diff`）。

### R2-1 修订内容核验（逐字 diff，三处且仅三处）

| # | 修订位置 | 内容 | 判定 |
|---|---|---|---|
| 1 | 头部版本行 | R1 → R2，注明「清单完备性修正，非设计变更；R1 全部技术设计逐字保留」缘由 | ✅ |
| 2 | §7 ALLOW LIST | 按立法「只增不删」追加第 4 条：`packages/doc-runtime/package.json — version 0.1.5→0.1.6，仅 version 字段（deps/exports/scripts 不动）`，标注 R2 修订追加 + Hard Gate #9 patch bump 义务 + rev1（0.1.2→0.1.3）/rev2（0.1.4→0.1.5）仓内先例——与 SA4 R1 报告要求的补行内容逐项对应 | ✅ |
| 3 | 尾部「SA2 反馈逐条回应」节 | R1 占位句替换为「R2 修订登记」表：SA4 R1-a/R1-b 两项要求 → 落实位置/内容逐条 mapping | ✅ |

**技术设计零变更确认**：diff 无任何其他 hunk——§1-§6（任务定性/三域矩阵/路径裁决/D1-D5/边界防御/测试映射）、§8（协议假设依据）、§9（caller 审计）、§10（AC 对照）逐字保留 R1 原文。SA1 的「修订性质声明」与实际 diff 相符，无夹带。

### R2-2 Scope Gate 重算（R1 §1.1 门禁复跑）

- ALLOW LIST：6 → **7 文件**（+package.json）。
- actual diff（`git diff --name-only b0512aa HEAD`，剔 wiki 白名单）：6 个非 wiki 文件——全部落入 7 文件 ALLOW LIST → **creep 集合 = 空**。
- BLACKLIST（package-lock/yarn.lock/.DS_Store/TASK.md/.bak）：零命中。
- DENY LIST：`git diff --stat b0512aa HEAD -- packages/vfsl packages/doc-runtime/src/materialize.ts packages/doc-runtime/src/read.ts …` 仍为零改动。
- **判定：scope-creep-detected 阻塞项消除。**

### R2-3 代码零变化确认（R1 结论承继的合法性基础）

- `git log` HEAD 仍为 `a2e6c52`（SA3 无新 commit）；`git status -- packages/` 为空（无未提交代码改动）。
- R1 独立运行证据（952/952 全绿 + 6 包 tsc 0）与全部技术审查结论（§1.2-§1.7、§2-§8）直接承继，无需重跑。

### R2-4 遗留说明（不阻塞）

- R2 修订当前位于 worktree（已 staged、未 commit）；总控收尾时随流水线归档 commit 即可，不影响本 verdict。
- R1 §1.4 的 OBSERVATION（xml-attr-quote-domain.test.ts 无 CI 具名存在性门禁步骤）与动态审核重点 3 条（SA7 范围）继续有效。

---

**最终结论**：R1 唯一阻塞项已按声明路径（SA1 一行 ALLOW LIST 修订）消除；技术实现在 R1 已被完整验证为零缺陷。**Verdict: pass——SA7 可进入动态验证。**

- **被审对象**：commit `a2e6c52`（SA3 实现：D1 删 xml-parse.ts 拒绝块、D2 新建 xml-serialize.ts、D3 extract.ts 接线、D4 canonicalXmlOf 加固、bump 0.1.6），基线 `b0512aa`（main）。
- **方法**：静态阅读 + 独立复算（§1.5 协议假设六条全部重跑、§1.6 caller 三层防御逐处对源码、全仓测试套件独立复跑），测试按立法以独立进程（setsid nohup）执行。
- **独立运行证据**：`pnpm test`（vitest run --typecheck，CI 同款）→ **Test Files 66 passed (66)；Tests 952 passed (952)；TEST_EXIT=0**；`pnpm typecheck`（6 包 tsc --noEmit）→ **TSC_EXIT=0**。其中 `xml-attr-quote-domain.test.ts` **26 用例**、`materialize-root.test.ts` **59 用例**、`materialize-root-rev2.test.ts` **23 用例**（零改动保持绿）——与 SA6 登记逐字一致。

---

# ⬇️ 以下为 R1 轮完整记录（时点 verdict: reject——按总控指令原样保留；scope 阻塞项已在 R2 消除，其余结论被 R2 承继）

## 1. 设计一致性审查

### 1.1 文件清单 Scope Creep Guard — ❌ 命中一处（本报告唯一阻塞项）

- **ALLOW LIST 抽取**（design §7）：`packages/doc-runtime/src/xml-parse.ts`、`src/xml-serialize.ts`、`src/extract.ts`、`test/xml-attr-quote-domain.test.ts`、`test/materialize-root.test.ts`、`test/materialize-root-rev2.test.ts`（共 6 文件）。
- **actual diff**（`git diff --name-only b0512aa HEAD`，剔白名单 wiki/raw/* 后）：
  - packages/doc-runtime/src/extract.ts ✓
  - packages/doc-runtime/src/xml-parse.ts ✓
  - packages/doc-runtime/src/xml-serialize.ts ✓（新建，65 行）
  - packages/doc-runtime/test/materialize-root.test.ts ✓
  - packages/doc-runtime/test/xml-attr-quote-domain.test.ts ✓
  - **packages/doc-runtime/package.json ✗（version 0.1.5 → 0.1.6，不在 ALLOW LIST）**
- **BLACKLIST**（package-lock/yarn.lock/.DS_Store/TASK.md/.bak）：零命中 ✓。
- **DENY LIST**：`packages/vfsl/**`、`src/materialize.ts`、`src/read.ts`/`src/carrier.ts`/`src/resolve.ts`/`src/index.ts`、persistence 四包、test/ 其余文件——`git diff --stat` 全部为零改动 ✓。
- **定性**：`package.json` 的 1 行 version bump 遵循仓内铁律级先例（doc-runtime 历次交付 4/4 均 patch bump：0.1.1→0.1.4→0.1.5→0.1.6），且**前两轮设计都显式把它列入 ALLOW LIST 并标注理由**——`task_doc-runtime-materialize-root-rev1_design.md:690`（「repo 先例：行为增补随交付 patch bump…仅 version 字段」）、`task_doc-runtime-materialize-root-rev2_design.md:67`（RD11 同款）。本次 design §7 **漏列**。按 2026-06-08 立法（issue #147/#176 复盘）：超出 ALLOW 且不在豁免名单 → **REJECT**，不接受「已测试/惯例如此」作为豁免理由。
- **处置（二选一，均可立即复验转 pass）**：
  1. **SA1 修订 design §7 ALLOW LIST**（首选）：补一行 `packages/doc-runtime/package.json — 修改：version bump 0.1.5→0.1.6（repo 先例 patch bump，rev1:690 / rev2 RD11 同款；仅 version 字段）`；
  2. SA3 回滚 bump 行（`git checkout b0512aa -- packages/doc-runtime/package.json` 后重新 commit）。
- 总控 dispatch 第 7 行虽已登记「bump 0.1.6」，但总控口头登记不是 design 修订——ALLOW LIST 是唯一 scope 授权面，本门禁正是强制 SA1 设计完整性的机制。

### 1.2 设计偏离审查 — ✅ 无危险偏离（2 处良性且经授权）

- D1（xml-parse.ts）：拒绝块删除、头注释规则 3 改写、`:76` canonical 注释同步——与 §4.1 逐字一致；`renderCanonicalNode` 改为 `escapeAttrValue(v)`——与 §4.4 一致。
- D2（xml-serialize.ts）：与 §4.2 草稿逐行同构，**两处偏离均为 SA2 评审要求的显式采纳**（SA2 verdict pass 附带「建议 SA3 实现时采纳」，已核实采纳到位）：
  - **MINOR #1 已采纳**：`escapeAttrValue` 用 `('' + (v as string))` 而非草稿的 `String(v)`（xml-serialize.ts:28-30，注释注明 SA2 MINOR #1）——ToPrimitive(default) 镜像 yjs `key + '="' + attrs[key] + '"'` 隐式强转。
  - **MINOR #2 已采纳（处置 a：递归）**：`xmlNodeToString` 对 `Y.XmlFragment` 子节点递归自渲染（xml-serialize.ts:59-63）而非一律委托原生——封死嵌套 fragment 后代属性 `"` 不转义缺口。
- D3（extract.ts）：walk xml-fragment 分支接线 + import + D7' 注释——与 §4.3 逐字一致。
- D5（materialize.ts 六阶段）：零改动 ✓（DENY 遵守，§4.5 论证兑现——952 用例含 rev2 全绿佐证）。

### 1.3 E2E spec runner 触发性自检 — N/A

本任务无 `*.spec.ts` 改动（全部为 vitest `*.test.ts`）。

### 1.4 vitest 触发性自检 — ✅ pass

- 涉及测试文件：`packages/doc-runtime/test/xml-attr-quote-domain.test.ts`（新增，26 用例）、`packages/doc-runtime/test/materialize-root.test.ts`（改写）→ 所在 workspace package = **@nomicore/doc-runtime**。
- CI 触发链（`.github/workflows/ci.yml`，仅此一个 workflow）：`test` job（matrix node 20/24）→ `pnpm test` → 根 `package.json` script = `vitest run --typecheck` → 根 `vitest.config.ts` include = `packages/*/test/**/*.test.ts` —— **glob 覆盖两个测试文件**；另有 `Materialize root tests` 具名步骤（ci.yml:55）直接点名 materialize-root.test.ts。
- 判定：**无未接通的 package/文件**，verdict ≠ vitest-package-not-triggered。
- OBSERVATION（不阻塞）：具名「存在性门禁」步骤仅覆盖 materialize-root.test.ts 等三个文件，新契约主锚 xml-attr-quote-domain.test.ts 无同款门禁——若该文件被删/改名，CI 仍绿（vitest 配置 `passWithNoTests: true` 只在全集为空时生效）。这与 extract-*/read-*/rev2 等其余 doc-runtime 测试文件的地位一致，属既有门禁策略的覆盖广度问题，建议后继任务（含 SA1）评估是否加第四个具名步骤；本任务按立法不构成 reject。

### 1.5 协议假设审查 — ✅ pass（六条假设独立复算全部吻合 + 5 个攻击角落实跑）

design §8 章节在位，六行假设均给出源码行号或实测输出，无「应该/通常」类无据推断。SA4 复验（yjs@13.6.32 本机实跑，脚本 tsx 临时置于包内、跑后已删）：

| # | 假设 | SA4 复算结果 |
|---|---|---|
| 源码 | `YXmlElement.js:113-128` toString 零转义/keys.sort/toLocaleLowerCase/单空格 join/显式闭合 | ✅ 逐行核对一致（`key + '="' + attrs[key] + '"'`、`keys.sort()`、`nodeName.toLocaleLowerCase()`、`' ' + join(' ')`） |
| 实测 #1 | 存储值 `a"b` 原生投影非良构 | ✅ `<p title="a"b">x</p>`（缺陷实证，逐字复现） |
| 实测 #2 | 自建序列化器产出良构 | ✅ `<p title="a&quot;b">x</p>` |
| 实测 #3 | quote-free 值下与 yjs toString 逐字节相同 | ✅ 复杂树（嵌套/`'` 值/`ns:item-2.x` 名/字面实体文本）`byte-equal: true` |
| 实测 #4 / live 守卫 | detached getAttributes 静默 `{}` → 守卫 loud throw | ✅ detached 调用 throw「xmlFragmentToString: 收到未集成（detached）的…」；`_integrate`（:66-71）落盘 `_prelimAttrs` 后置 null 核对一致 |
| 源码 | `YXmlFragment.js:269-271` toString = `typeListMap(...).join('')` | ✅ 核对一致（`toArray().map().join('')` 等价结构） |

**附加攻击角落实跑**（超出 §8 范围的红队补充）：
- **[A] symbol 属性值**（direct API）：`setAttribute('k', Symbol('x'))` 在 yjs **set/integrate 期自身即 throw**（`AbstractType.js:874 'Unexpected content type'`）——根本到不了序列化器。SA2 MINOR #1 讨论的 ToPrimitive 角落实际不可达；采纳的 `'' + v` 是纵深防御，无静默捏造值向量。
- **[B] 带 valueOf 对象**：`setAttribute('k', {valueOf:()=>42})` 可存储 → extract ok:true，投影 `<p k="42"></p>`——与 yjs 原生隐式强转镜像（原生 `key + '="' + obj + '"'` 同产 `42`）✓ 镜像保真。
- **[C] 嵌套 Y.XmlFragment 子树**（SA2 MINOR #2）：后代 `title='a"b'` → 投影 `<div><span title="a&quot;b"></span></div>`，转义生效、无裸 `"` ✓。
- **[D] observer 双引号同存值** `x"y'z` → `<p q="x&quot;y'z"></p>` 良构 ✓（§3 决定性反例的死角被主路径覆盖）。
- **[E] §5.5 表示漂移不动点**：materialize(`'a"b'`) → extract(`a&quot;b`) → re-materialize ok → re-extract **逐字节不变**（一次到达不动点，esc 幂等实证）✓。

### 1.6 契约改动连锁审查（Contract Change Rippling）— ✅ pass

改动面：`walk` xml-fragment 分支返回**内容**变化（非签名/结构）+ 新增理论 throw 路径（live 守卫；`'' + v` 对 symbol 的 TypeError——经 [A] 实跑证明 yjs 更早 loud throw，序列化器层不可达）。caller 矩阵：

| Caller | 位置 | await | 直接 try/catch | 顶层兜底 | 判定 |
|---|---|---|---|---|---|
| `extractYjsSnapshot` | extract.ts:51 → walk | 同步 N/A | INV-6 顶层 try/catch（:52-80 实读核对） | ✅ E100 结构化返回，绝不外抛 | ✅ |
| `materializeRoot` ⑥ 双侧提取 | materialize.ts:262-263 | 同步 | (2) 块 try/catch → e201D（实读核对 :261-266） | ✅ | ✅ |
| ⑥ `productEqual` → `canonicalXmlOf` | materialize.ts:343-344 | 同步 | (3) 块 try/catch → e201D（:277-287） | ✅ | ✅ |
| `readLogicalValueAtPath` 终点 | read.ts:370 复用 walk | 同步 | 顶层 try/catch（:84 catch；:249 C3 DOCRT-E100 前缀 fail-closed） | ✅ | ✅ |
| 包外消费方 | grep 全仓 | — | persistence/dsh-persistence/vfsl* 零引用 doc-runtime；无 apps | — | ✅ 无第六处 |

无 async fire-and-forget caller、无 `process.on('unhandledRejection')` 一刀切 exit 面。三层防御全部满足。

### 1.7 测试质量：源码 GREP 断言禁令 — ✅ pass

两个改动测试文件 `readFileSync` 命中 0、`toMatch/toContain` 命中 0；全部断言为运行时行为（公共入口返回值 / toThrow / update 计数 / encodeStateAsUpdate 字节比较 / 语义等价比较器）。用例数 26 = RT-A(3，含前置绿) + RT-C(14) + RT-D(8) + RT-E(1)，与 SA6 登记一致。C-8/X-F9 删除干净：`materialize-root.test.ts` 中「值含双引号」仅存于改写说明注释（:842-846/:881-883），无残留断言。

---

## 2. 读写路径一致性 — ✅ 一致

写路径：scan（现逐字收值，含单引号壳内 `"`）→ `setAttribute(k, 原始值)`；读路径：extract walk → `xmlFragmentToString`（投影面 esc）。两侧同一数据源（Y.XmlElement 属性表），存储值是真值（`a"b`）、语法正确性归投影层——无分叉。⑤ 零写入/单事务结构未触碰（RT-D 8 行零写入双证 + RT-A `events.count === 1` 全绿）。

## 3. 静默失败 — ✅ 无

D1 是失败面单调缩小（删一条拒绝分支，malformed 判定路径不经过它——配对闭引号解析成功之后的位置，实读 :209-213 确认）；所有失败仍 ok:false+issue 或 throw E201/E202；live 守卫 loud throw 拒绝静默空投影（[实测 #4]）。

## 4. 降级方案 — ✅ 无降级

未新增任何 fallback；live 守卫是「正常路径前提缺失 = bug 须 loud assert」立法的正确落地（detached `getAttributes()` 实测静默返回 `{}`，若无守卫将产出**静默丢属性**的假投影）。

## 5. 极端条件攻击 — ✅ 未发现漏洞

攻击与结果：双引号同存值 `x"y'z`（[D] 良构）；`<>&` 字面量（T-6 良构——vfsl R2 成文口径）；实体字面量 `&quot;`（T-13 逐字不动 + [E] 不动点）；空属性/交错/自闭合/嵌套（T-7/T-8/T-9/T-11/T-12 绿）；symbol（yjs 自身更早 throw [A]）；valueOf 对象（镜像强转 [B]）；嵌套 fragment（[C] 转义生效）；detached（守卫 throw [#4]）；escapeAttrValue 幂等（`&quot;` 不含 `"`，split/join 二次作用恒等）。深递归栈廓与修复前同款（toArray 递归 ↔ typeListMap 递归），溢出仍落 E100/E201-D。**全部响亮或行为等价，无假成功向量。**

## 6. 错误处理链路 — ✅ 完整

① 拒绝透传（RT-D 引用零损 toEqual）/② 构造失败 ok:false/E200/④ 事务异常/⑥ E201 变体 C/D 分工面零变化；② 失败面只减不增。全绿佐证。

## 7. 架构评估 — ✅ 可行（无需退回 SA1）

修复半径恰好覆盖四条耦合点（SA5 清单 4/4 兑现：缺陷行/extract 投影/canonical 渲染/契约测试），零绕过、零 FIXME、零跨模块蔓延（vfsl 零改动）。四域一致：①=②（骨架镜像恢复）、③=④（同 esc 口径）。

## 8. 过度设计 — ✅ 精简

65 行新模块解决真实跨层缺陷；`'' + v` 比草稿更短；嵌套 fragment 递归 4 行堵 SA2 实证缺口。无比根因复杂一个数量级的问题。

---

## 动态审核重点（交 SA7）

1. **CI vitest 触发证据**：`gh run view --log` 摘录 Node 20 与 24 两个 matrix 分支中 `packages/doc-runtime/test/xml-attr-quote-domain.test.ts`（26 tests）与 `materialize-root.test.ts`（59 tests）被收集执行的行——SA4 已静态确认 glob 覆盖（§1.4），SA7 补动态证据。
2. **RT-E/RT-5 observer 时序**：one-shot observer 在 ④ 事务内注入 → ⑥ 变体 C throw 的路径在本机套件已绿；CI 环境复跑一致性确认。
3. **yjs 版本窗口抽样**（可选）：declared compat `^13.6.30`；若 lockfile 外（如 13.6.33+）升级，抽验 §8 实测 #3 字节一致性仍成立（本设计以替换而非依赖 yjs 实现，漂移只影响回归保证不影响正确性——SA1 已自我声明）。

## 结论

| 审查项 | 结论 |
|---|---|
| 1.1 Scope Creep | ❌ `packages/doc-runtime/package.json`（bump 0.1.6）不在 ALLOW LIST → **唯一阻塞项** |
| 1.2 设计偏离 | ✅（SA2 MINOR #1/#2 采纳核实到位） |
| 1.3 E2E spec | N/A |
| 1.4 vitest 触发 | ✅（glob 覆盖，Node 20/24 matrix） |
| 1.5 协议假设 | ✅（六条复算 + 5 攻击角落全部吻合） |
| 1.6 契约连锁 | ✅（caller 三层防御 4/4） |
| 1.7 测试质量 | ✅（零源码 grep 断言；26+59+23 用例全绿） |
| 2-8（读写/静默/降级/攻击/错误/架构/过度） | ✅ 全部通过 |

**Verdict: reject（scope-creep-detected，回流目标 SA1——§7 ALLOW LIST 补 `packages/doc-runtime/package.json` 一行；或 SA3 回滚 bump 行）。** 技术实现 D1-D4 及 SA2 MINOR 采纳经 SA4 独立静态+运行复验全部成立（952/952 + tsc 0），上述 1 行处置落地后无需重审代码，SA4 复核 design 修订即可翻 pass。

**Verdict: pass**（R2 最终裁定——R1 reject 唯一阻塞项已由 SA1 R2 ALLOW LIST 修订消除；详见文首 Verdict（R2 最终）与「R2 复审结论」节，R1 历史记录保留于上文）
