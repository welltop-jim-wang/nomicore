# SA4 静态验尸报告

**Date**: 2026-08-23（Phase 3，SA3 commit bbf4e5a 后）
**Verdict**: pass（8 项审核全过 + SA2 R3 移交清单三项全闭；2 项非阻塞发现留档，1 项既有暴露移交 SA7/SA1 登记；附动态审核重点 3 条）

**被审对象**: commit `bbf4e5a`（branch `fix/issue-88-on-docs-namespace-runtime`，base `origin/docs/namespace-runtime` = 74b9cfd）
**审查方法**: 基线源码逐函数机械 diff（711 行 materialize.ts vs 新三模块）+ E202 消息渲染实跑字节比对 + RA-9/RA-1 协议片段复跑 + 一次性对抗探针（8+1 用例，跑毕即删）+ 全量 test/typecheck 独立复跑 + CI 触发性/源码 grep 断言/BLACKLIST 门禁。

---

## 审核结论

1. 设计一致性：✅ 一致（模块分解/导出面/编排/消息族/版本 bump 逐项对照 §3.1 R3、§4、§12 全符；两处零行为偏差留档，见「非阻塞发现」F-1/F-3）
2. 读写路径一致性：✅ 一致（写 = 原实例 `getMap('ROOT')` 上 clear+set 单事务；读 = `extractYjsSnapshot(derived, doc)` 同 doc 同 ROOT；无第二数据源）
3. 静默失败：✅ 无（全部执行路径均有可观测结局：`{ok:true}` / `{ok:false,issues}` / throw；⓪ 在 try/catch 之外、④⑤⑥ 无 try/catch——实读 replace.ts:94-106 逐行核对）
4. 降级方案：✅ 安全（无任何 fallback/降级路径；缺席 ROOT 探针惰性创建为 happy path，探针 P-B 实测 0 update）
5. 极端攻击：✅ 无本任务引入的漏洞（对抗探针 8+1 项全过；1 项**既有**对抗性输入暴露移交 SA7，见 F-2——非本任务引入、materializeRoot 同款行为已实证）
6. 错误处理：✅ 完整（§6 失败面总表 7 行逐行落地；窗口 A/B/C 三变体实跑消息正确）
7. 架构评估：✅ 可行（三 seam 模块 + 双薄编排；DAG 无环实核）
8. 过度设计：✅ 精简（materialize.ts 711→132 行净减；replace.ts 152 行含 ~57 行 JSDoc 契约义务（§4.5 落实）；无多余抽象）

### 硬门禁执行记录（skill §1.1–§1.7）

| 门禁 | 结果 | 证据 |
|---|---|---|
| §1.1 Scope Creep / DENY / BLACKLIST | ✅ | actual diff（剔除 `wiki/raw/task_*` 白名单）恰 8 文件 = ALLOW LIST §12 全集（package.json + src 6 文件 + test 1 文件）；DENY（extract/read/carrier/resolve/xml-parse/既有测试/其余 packages/docs/adr/.github）零命中；BLACKLIST（lockfile/.DS_Store/TASK.md/*.bak）零命中 |
| §1.3 E2E spec 触发性 | N/A | 本任务无 `.spec.ts` |
| §1.4 vitest 触发性 | ✅ | 根 `pnpm test` = `vitest run --typecheck`，include `packages/*/test/**/*.test.ts` 覆盖新测试文件；`ci.yml` test job（Node 20/24 矩阵）执行 `pnpm test`——无孤儿测试。注：`Materialize root tests` 专项门禁不含本文件，但 blanket `pnpm test` 已覆盖，不属 §1.4 事故类 |
| §1.5 协议假设 | ✅ | §9 RA-1~RA-9 全带依据、无「应该/通常」；SA4 复跑：RA-9 内联片段复现 `TypeError: Cannot read properties of null (reading 'length')`；RA-1 核心机制（clear+set 单事务 → 恰 1 update / identity 保持 / 旧子 stale / 新实例同引用）复证 |
| §1.6 契约改动连锁 | ✅ | 无 return→throw 翻转/同步变异步；`assertOutermostTransactionContext` 加 api 参——materializeRoot 侧渲染**实跑字节比对全等**（A/B/C 三变体 true）；caller 总数 <10 全在包内；新公共函数纯增量 |
| §1.7 源码 grep 断言禁令 | ✅ | 新测试文件零 `readFileSync`、零源码文本断言；G6-1 为模块运行时 `Object.keys` 黑盒断言（合法），其余全为行为断言 |

### 1.4 vitest 触发性自检（硬门禁 #14）

**输入**：本任务新增/改动的 `*.test.ts` = `git diff --name-only origin/docs/namespace-runtime HEAD | grep -E '\.test\.ts$'` → 恰 1 个：`packages/doc-runtime/test/replace-root-content.test.ts`（所属 workspace package = `@nomicore/doc-runtime`，dir `packages/doc-runtime`，自最近 package.json `name` 字段解析）。

**CI vitest 调用面核对**（`.github/workflows/ci.yml` 全量 grep，本仓唯一 workflow）：

| job/step | 命令 | 覆盖判定 |
|---|---|---|
| `test` job · Test step（L39，**Node 20/24 矩阵**） | `pnpm test` → 根 package.json script = `vitest run --typecheck`（workspace 根单 vitest 配置，无 `--filter`/`--project` 分片） | ✅ `vitest.config.ts` include = `packages/*/test/**/*.test.ts` → **`packages/doc-runtime/test/replace-root-content.test.ts` 命中 glob**；实际收集证据 = SA4 全量复跑 66 文件/940 用例含本文件 13 用例（「审核结论」节） |
| Persistence contracts（L44） | `pnpm exec vitest run packages/persistence/test/persistence-contract.test.ts …` | 专项存在性门禁（本任务不涉及） |
| Domain scaffolds check（L49） | `pnpm exec vitest run packages/vfsl/test/domains-scaffold.test.ts …` | 专项存在性门禁（本任务不涉及） |
| Materialize root tests（L55） | `pnpm exec vitest run packages/doc-runtime/test/materialize-root.test.ts …` | 专项存在性门禁（#74 遗产；不含本文件，但非本文件唯一触发面——blanket `pnpm test` 已覆盖，不属 §1.4「测试存在但从未被触发」事故类） |

**结论标记：`all-vitest-packages-triggered`** —— 本任务新增的 `*.test.ts` 所在 workspace package（`@nomicore/doc-runtime`）被 CI `test` job（Node 20/24 双版本）的 `pnpm test`（根级 vitest run，include glob 直包）完整覆盖，无未接通的 vitest package；无孤儿测试文件。

### SA2 R3 静态门禁移交清单（三项全闭）

| # | 项 | 结果 | 证据 |
|---|---|---|---|
| ① | `makeIssue` 定义恰一处 | ✅ | `grep -rn "function makeIssue" packages/doc-runtime/src/` = detached-build.ts:258（2 参 `BuildIssue`）+ extract.ts:344（3 参 `ExtractIssue`，**基线既有**、不属本设计链——与派发注记一致）；设计链内恰一处，零复制体 |
| ② | import 面对照 §3.1 R3 导出面 | ✅ | materialize.ts:49 = `{buildTopEntries, makeIssue}`（§3.1 256-258 授权面）；install-verify.ts:24-30 = `{buildTopEntries, plainObjectOf, recordSlotOf, declaredFieldOf}` + `type {BuildIssue, Path, Resolver}`（§3.1 R3 面逐项吻合）；replace.ts:63 = `{buildTopEntries}`；三 seam 模块无任何包外/测试深 import；DAG 单向无环 |
| ③ | G1 fixture 修复遵守 §1.5/§12 窗口 | ✅ | 逐实例核对：9 个手工 Y 实例（oldAudit/oldFileTags/oldFileOwnTags/oldFileAudit/oldFile/oldTextAudit/oldBody/oldText/oldAssets）**每个恰集成一次**；改动 = 新增 2 行接线（test:346-347 独立 `oldFileOwnTags` + 一行防回归注释）+ test:355 改引用；`root.set('keywords', oldFileTags)`（test:375）成为该实例首次唯一集成；断言语义与简报 G1 锚（`toBe` identity / `not.toBe` ×3 / stale 消失 / 恰 1 update / extract 读回全等）逐项保持——`oldFileTags` 仍是被替换前旧 keywords 实例，`not.toBe(oldFileTags)` 锚未失效；13 用例数不变（678+2=680 行） |

### 「纯移动逐字不变」独立机械验证

以基线 `git show origin/docs/namespace-runtime:...materialize.ts`（711 行）为基准，逐函数 brace-matching 抽取比对 28 个函数：

- **逐字全等**：buildValue / buildUnion / mapEntries / copyJsonDomain / wordOf / renderPath / buildScratchInstall / deepEqualValue / valueDiff / detailOf / keysetOf / summarize / errDetail / e201C / e201D（15 个）
- **仅差授权项**：`export` 关键字（§3.1 导出面，7 个：buildTopEntries/plainObjectOf/recordSlotOf/declaredFieldOf/makeIssue/verifyInstall/verifySnapshotIntact）；`MaterializeIssue`→`BuildIssue` 类型注解（§10 明文「结构同一，无运行时转换」，5 处）；materializeRoot 仅 ⓪ 调用加 `'materializeRoot'` 实参（D7）
- **零行为偏差 2 处**（见 F-2/F-3）

### 实证复跑记录（全部独立进程）

- `pnpm test`：**66 文件 / 940 用例全绿，exit 0**（86.9s；= 派发基线 927 + 本任务 13）——与 commit message 宣称独立复核一致
- `pnpm typecheck`：六包 tsc **exit 0**
- E202 字节同一性（node 实跑渲染）：`A('materializeRoot')===orig_A: true`；`B: true`；`C: true`；`A('replaceRootContent')` 长度差 +3（15→18 字符）且前缀正确——materializeRoot 公共契约零变化实证
- RA-9 / RA-1 复跑：见 §1.5 行
- 一次性对抗探针（已删，不留仓）8+1 用例：clear-only 恰 1 update（P-A）；空×空 0 update（P-B）；observer 重插同值 → ok:true（P-C，无偏离即无 E201——正确语义）；非 genuine doc 窗口 C fail-closed（P-D）；materializeRoot E202 全文正则全等（P-G）；observer 派发窗口 B 变体带正确 API 名（P-H）

---

## 非阻塞发现（留档）

### F-1（MINOR）renderPath 六行私有重定义——R2-A1 同类规格未闭合点

原 ⑥ 的 `detailOf`（基线 materialize.ts:408）消费 `renderPath`，但 §3.1 R3 写死的 detached-build 导出面不含它、install-verify import 面也未登记——SA3 面临与 SA2 R2-A1（makeIssue）完全同构的三难（扩导出面违反写死清单 / 第四模块违反 DAG / 复制违反零复制纪律）。SA3 选择 install-verify.ts:313 私有重定义 6 行 + **文件头 loud 登记**（「detached-build 的导出面按设计 §3.1 写死（不含 renderPath）……不属构造规则共享面（AC-1 零复制纪律对象）」）。
**判定**：非阻塞。两侧实现逐字全等（机械比对实证）；renderPath 是 message 文本渲染（诊断辅助），非 Y.Map/Y.Array/XML/plain 构造规则——AC-1 零复制纪律对象不涉及；行为零影响。**回流目标：SA1**（后续设计触点把 renderPath 补进 §3.1 导出面或显式登记复制豁免，消除规格-实现间的这一残差）。

### F-2（MINOR，既有暴露，非本任务引入）对抗性 Proxy「①→② 稳定化双读发散」两入口均不检测

**探针实证**（跑毕即删）：对 `snapshot` 施加 hostile Proxy（首次 `ownKeys` 返回全键、后续读返回缩减键集）——① `validateLogicalSnapshot` 见全键通过（含必填 `count`），② `buildTopEntries` 读缩减键集构造，⑥ scratch 第三次读与 ② 一致 → `productEqual` 通过 → **`replaceRootContent` 返回 ok:true 且必填键 count 静默丢失**（读回快照无法通过逻辑校验）。
**定性**：**非本任务引入**——同一 Proxy 对 `materializeRoot`（基线 #74 血统）行为逐字节同款（对照探针实证：两入口均 ok:true、产物 JSON 全等；②⑥ 逐字纯移动的机械证明亦排除行为分叉可能）。设计（#74 rev2 R-5 及本设计）明文承诺的检测面是「② vs ⑥ 双读**发散**→ 变体 C loud」——本向量是「① vs ② **稳定化**发散」，设计未宣称覆盖，故不构成契约证伪；且仅对抗性 TOCTOU 输入可达（普通快照对象读序确定，不可能发散）。未声明键**注入**方向已被 F7 loud 拒绝，仅声明键**丢弃**方向静默。
**处置**：不 reject（修它 = 改共享管线 = 动 materializeRoot 契约，超 #88 范围）。**回流目标：SA1**（知识面登记建议：「① 校验视图与 ② 构造视图的稳定化发散（对抗性输入专属）为共享管线已知边界」）+ **SA7**（动态复核，见下）。若未来裁决要堵：构造完成后对 `entries` 键集与 ① 视图重验一次（两入口同步改）。

### F-3（NIT）productEqual 两处注释措辞微调

迁移体 productEqual 内 2 行注释「设计 §4.3/R2/#7」→「rev2 §4.3/R2/#7」「设计 §4.2」→「rev2 §4.2」——严格违反「逐字不变」字面，零行为影响，且系消歧改进（仓内现存两份设计文档）。非阻塞，无需处置。

---

## 动态审核重点（交 SA7）

1. **F-2 复核**：在活链路（Node 20 与 24 各一）确认对抗性 Proxy 输入下 `replaceRootContent`/`materializeRoot` 行为与本报告一致（ok:true + 键丢失、两入口产物全等）；并确认普通 JSON 快照输入（经 REST/持久化反序列化产物，非 Proxy）不可能触发该向量。
2. **Node 20/24 CI 证据**：`gh run view --log` 摘录本 PR CI：`Test` step（`pnpm test`）与 `Typecheck` step 双 Node 版本绿，且日志中出现 `replace-root-content.test.ts` 被收集执行（spec 触发证据，SA4 静态自检 §1.4 的动态确认面）。
3. **活链路 yjs 版本漂移**：CI 环境 install 的 yjs 若非 13.6.32（^13.6.30 范围内浮动），抽查 G1（恰 1 update / identity / not.toBe）与 G7（E202）仍绿——本设计全部协议假设锚定 13.6.32 实测。

---

## 结论

**Verdict: pass。**

- 任务简报 AC-1~AC-8 与冻结契约（G1–G7 / 13 用例）在实现层全量兑现且**独立复跑 940/940 绿 + 六包 typecheck 绿**；
- SA2 R3 移交清单三项（makeIssue 单点 / import 面 / fixture 修复窗口）全部闭合；
- 「纯移动逐字不变」经 28 函数机械比对 + E202 渲染实跑字节比对双重实证（授权偏差外仅 F-3 注释级）；
- 唯二实质发现（F-1 规格残差、F-2 既有对抗边界）均零行为影响/非本任务引入，已按回流目标登记（SA1/SA7），不构成本实现的重审条件。

SA7 可进入动态验证（重点见上节）。
