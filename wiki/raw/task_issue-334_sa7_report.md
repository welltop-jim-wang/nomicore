# SA7 动态验证报告 — task_issue-334（形状预算 T1：载体投影读取三参化与截断省略）

- **Role**：SA7（mabf-sa7，dispatch `sa-a35c703d-8c0e-4773-ac15-8e65452f65b3`，phase final-verification，iteration 0）
- **Issue**：welltop-jim-wang/nomicore #334（parent PR #332 / ADR-0024；tracking #331）
- **验证对象**：SA3 迭代 0+1 交付态工作区（branch `mabf/issue-334`，HEAD `ba11f32`；`read.ts` 冻结 sha256 `3bf6b8b016e4066d1b312…`）
- **验证焦点**（dispatch 指定）：预算递归、截断事实、非法 options 定序/包含面、零物化哨兵、detached 行为、legacy 无 options 不变性
- **Verdict**：**approve**（SA4 approve 基础上独立动态验证全绿；无新 fail 发现）

---

## 1. Inputs

| 输入 | 路径 | 状态 |
|---|---|---|
| 任务简报 | `wiki/raw/task_issue-334.md`（AC1–AC5；零评论，comment IDs: none——无 Owner override） | 已读 |
| SA1 设计 | `wiki/raw/task_issue-334_design.md`（§7 决议 A–D、§8.2 编排、§8.3 路线 R1–R4） | 已读（路线对照基准） |
| SA6 验收契约（迭代 1） | `wiki/raw/task_issue-334_sa6_contract.md`（§12.3 B1–B16、§12.5 V1–V6、§12.7 S1–S27、§12.8 NC-1…8、§12.10 E5） | 已读（动态断言口径来源） |
| SA3 实现报告 | `wiki/raw/task_issue-334_sa3_impl.md`（verdict clear；m1/m2/m7/m8 已备证） | 已读 |
| SA4 静态审查 | `wiki/raw/task_issue-334_sa4_review.md`（approve；§11 指定 SA7 动态项：全量门禁复跑 + m3–m6 变异仪式） | 已读（SA4 pass 前提成立） |
| SA8 冲突报告 | `wiki/raw/task_issue-334_conflict_report.md`、`…_implementation_conflict_report.md`（均 clear） | 已读（协议边界识别） |
| 现行实现 | `packages/doc-runtime/src/read.ts`（809 行全文亲读）、`src/index.ts`、6 个目标测试文件 | 已亲读 |

## 2. Runtime environment

| 项 | 值 |
|---|---|
| worktree / branch / HEAD | `/home/wangjian/nomicore-fix-issue-334` / `mabf/issue-334` / `ba11f328…` |
| node / pnpm / tsx / vitest / yjs | v24.13.0 / 10.28.2 / 4.23.12 / 3.2.7 / 13.6.32 |
| 起始工作区 | 与 SA3 交付态逐字节一致（`read.ts` sha `3bf6b8b0…` = SA3 §6.4 冻结值；`git status`：3 M + 3 新测试 + wiki 输入） |
| 测试入口 | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run`（doc-runtime / 单文件）；root `pnpm typecheck` / `pnpm test` |
| 动态仪器 | probe 脚本（tsx 直跑，公共接缝 `src/index.js`）+ yjs `Y.Map/Y.Array.prototype.get` 调用记账 + detached 实例 own accessor `size`/`length` 计数器 + Proxy trap 计数 + HEAD 源 A/B 对照 |

## 3. Changed Data Flow Verification

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| R2 预算读·depth 递归（设计 §8.3 R2） | depth 在投影递归内生效：`d===0` 折叠为同形空容器 + 至多 1 条 depth 条目；容器子项耗一层（B1） | probe1（F-CANON 同构夹具）：S2–S8/S24 共 14 组 + probe3 嵌套组 | 折叠点（projectValue/copyPlainStrict `d===0` 分支）→ 条目 push → 四键成功构造 | S2 `{}`+`[cfg]depth3`；S3 `[]`+omitted4；S4 空 path `[]`+omitted9；S5 `{k1:{},k2:'v'}`+`[nested,k1]`；S6 终态原样+5 条 depth；S7/S8 全量 `truncated:false`+`truncations:[]` 在场 | 37/37 全 pass（含 proto=Object.prototype） | ✅ |
| R2 预算读·width 递归 | 前 K raw 槽位保留、超出槽位零读（B6/B7/B8）；父路径单条 width 条目（B11） | probe1 S9–S14 + probe3 hop 级 get 记账 | `rawTotal=size/length` 计数 → kept=min → break 先于 get → 条目 push | S9 `["a","b"]`+omitted2；S10 `[]`+omitted4；S11 K≥rawTotal 全量；S12 前缀=现场 `keys()` 前 2；S13 plain 载体；S14 组合恰 1 条 width omitted6 | 全 pass；**hop 级**：Y.Array K=2 投影 `get` 恰 2 次（下标 0,1）；Y.Map（含 undefined 值键）投影 `get` 恰 2 次（前缀槽位，第 3 键零读）；depth 折叠投影 `get`=0 | ✅ |
| R2 截断事实通道（AC2） | 成功面恒四键；条目 `path/kind/omitted`；`omitted`=raw 直接子项数（B5/B14） | probe1 B14 扫描 11 组调用 + S24 + S27 | 条目构造点 → `truncated` 派生点 → 结果对象 own 键集 | 恰四键；`truncated===(truncations.length>0)`；omitted=直接子项（S24：2 ≠ 4 后代）；条目 path ROOT 基（B9：`[]`/`['cfg']`） | 全 pass；S27 深等身份互异、突变返回值/条目/实参后重读不变 | ✅ |
| R3 非法 options（设计 §8.3 R3） | G0→OPT→N0 定序；`READ_OPTIONS_INVALID` 新分支；零 doc 触碰（V1/V2） | probe2 25 组检查 | G0 守卫 → 校验短路点 → N0 前返回 | 双非法→`PATH_NOT_ALLOWED`（G0 优先）；合法 path+非法 options→`READ_OPTIONS_INVALID`；fresh doc `share.has('ROOT')` 前后均 false；update 事件 +0 | 全 pass；**对照锚**：2 参拒绝读同 doc 惰性建 ROOT（false→true）证明锚有判别力 | ✅ |
| R3 失败分支字段/包含面（V5/V6） | `{ok:false,code,path,message}` 恰四字段；path 新鲜回显；不携带预算键；新码只进 budget 联合 | probe2 V5/V6 组 | optionsInvalid 构造点 + 2 参调用面 | 恰 `{code,message,ok,path}`；path 深等实参且身份互异；11 组 2 参调用零 `READ_OPTIONS_INVALID`、成功恰两键 | 全 pass；跨包包含面：`namespace-runtime` **零 diff**、`runtime.ts:119` `Extract<ReadLogicalValueResult,…>` 输入类型逐字未动、`:484` 仍 2 参调用 | ✅ |
| 新增·零物化边界（B8/B15） | 折叠/裁减子项零值读零递归 | probe3 哨兵 + Proxy trap 计数 + get 记账 | 槽位枚举层（break/裁减）vs 物化层 | poison/sparse/detached 被折或被裁 → `ok:true`；Proxy 值（width 边界外/depth 折叠下）零 trap 调用 | 全 pass（详见 §5） | ✅ |
| 新增·detached B16/R9 | `d===0` 折叠照常、`rawTotal:=0` 无条目、零公共 count 读；`d≥1` 现行守卫 | probe3 detached 组（own accessor 计数器） | budgetFold 的 `doc===null` 短路点 | `[holder] depth:1`→`{ys:{}}`、`truncated:false`、无条目、**size/length 计数器=0**；目标入口 `[holder,ys] depth:0` 同款；`depth:2`/width 物化/legacy 2 参 → `PATH_NOT_ALLOWED` | 全 pass（B16①–⑤ 逐条 + 载体同形 `{ys:[]}`） | ✅ |

## 4. Preserved Data Flow Verification

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| R1 无 options 读（F1） | 2 参行为逐字节不变：成功恰两键、失败单码 `PATH_NOT_ALLOWED`、投影输出深等、message 逐字 | probe4 **HEAD 源 A/B**（`git show HEAD:…/read.ts`+`carrier.ts` 提取至临时目录，双实现各自构造同构 doc） | HEAD 侧 34 组场景（29 常规 + 5 敌意/非数组 path）稳定序列化输出（ok/code/path/message/value 全字段） | 当前实现侧逐组 **canon 序列化全等**（含 message 逐字节）；成功面键序 `ok,value`、无 `truncated`/`truncations` | ✅ |
| R1 缺席吸收/键空间/敌意 path（F2/F3） | 缺键/越界→`ok:true value:undefined`；accessor/non-enumerable/原型链键空间外；Proxy path 收编 | probe4 A/B（absent/OOB/accObj/protoObj/hostile×5）+ probe1 S16/probe2 S23 | HEAD 同款 | 全等；`read(doc,[],undefined)`（显式 undefined ≡ 无 options，S23/R1）→ 恰两键 | ✅ |
| R1 零写零事件 + N0 惰性建 ROOT（INV-R9） | 读零写零事件；拒绝路径惰性建 ROOT 为现行既有行为 | probe4 双实现事件计数 + `share.has` 前后观察 | HEAD：update 0、ROOT false→true | 双实现一致（update 0/0；false→true 同款） | ✅ |
| R1 runtime readData 跨包消费（F11） | `readData` 三键形状/失败联合零改动 | `git diff --name-only packages/namespace-runtime` = 0 文件；`runtime.ts:119/484-486` 亲读 | HEAD 状态 | 零 diff；`Extract` 输入类型未变 → `READ_OPTIONS_INVALID` 不可能泄漏进 `NamespaceRuntimeReadDataResult` | ✅ |
| 冻结回归锚（F13/E4） | 4 个既有读锚 + 类型锚未修改且全绿 | `vitest run packages/doc-runtime` | SA6 基线 374 tests | 503/503 绿（33 schema-independent + 4 test-d + 39 guards + 3 surface + 33 budget + 88 budget-guards + 7 budget test-d + 其余包内既有） | ✅ |

## 5. State Machine Verification（单调用阶段序；无持久状态机）

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| 调用入口 | 非数组 path（± 非法 options） | G0 → `PATH_NOT_ALLOWED`（path `[]`） | probe2：`null`/`'str'`/`42`/`{…}`/Proxy path 均如此；双非法时 G0 优先 | 未落入 OPT/N0（options 分支零执行） | ✅ |
| G0 通过 | options 在场且非法 | OPT → `READ_OPTIONS_INVALID`（零 doc 触碰） | probe2 §12.2 矩阵 26 组非法（非对象/非 plain 宿主/未知键/值域/accessor/Proxy）全部收编 | 无外抛（Proxy trap 3 族全收编）；无 doc 触碰（ROOT 不建、update +0） | ✅ |
| G0 通过 | options 缺席/显式 undefined | OPT → legacy ctx（budget null）→ N0 → N1 → P1 → 恰两键 | probe2 S23 + probe4 A/B 全组 | 成功面永不出现 `truncated`/`truncations` | ✅ |
| G0/OPT 通过 | 合法 path + 合法 options | N0 → N1（预算盲）→ P1 预算投影 → 四键/失败透传 | probe1/probe3 全部成功组；路径缺陷组（S18：`['title','x']`/`['items','0']`/`['xmlEl','child']`）仍 `PATH_NOT_ALLOWED`+回显 | options 不掩盖路径失败（NC-4）；导航吸收早退仍出 4 键面（S16） | ✅ |
| P1 递归中 | 子项物化失败（NaN/空洞/detached 展开） | fail-fast 单错透传 → `PATH_NOT_ALLOWED`（失败面无截断键） | probe3 S21/NC-2/NC-8 全红面正确（`depth:2`/K=2/width 保留物化/d≥1 目标入口） | 无伪成功（预算不洗白不可表示值） | ✅ |
| 任意阶段 | 内部意外抛（如循环引用 E100） | 顶层 catch → `PATH_NOT_ALLOWED` + `DOCRT-E100` message | probe4 A/B `cycle` 场景双实现逐字节一致 | options 域缺陷不经 E100（V4：OPT 自身零外抛） | ✅ |

## 6. Error and Cleanup Flow

| 场景 | 预期 | 实测 |
|---|---|---|
| 非法 options ×26（含敌意 Proxy/accessor） | 零外抛、`READ_OPTIONS_INVALID`、零副作用 | probe2 全 pass；getter/setter 执行计数 0；options 前后深等 |
| 投影中途不可表示值（poison/sparse/detached 展开） | fail-fast 单 `PATH_NOT_ALLOWED`、失败面恰 `{ok,code,path,message}` | probe3 S21 组全 pass；probe2/probe4 失败面键集断言 pass |
| E100 兜底（循环引用 plain） | `PATH_NOT_ALLOWED` + DOCRT-E100 前缀，不外抛 | probe4 A/B `cycle` 场景双实现一致 |
| 资源清理 | 纯同步读、调用局部对象、无 register/dispose/后台任务 | 无清理责任面；S27 幂等/身份互异/突变隔离 pass；无任何进程/端口启动（本轮全部 vitest/tsx 前台或受管后台 job，均已完成退出） |
| restart/复活 | 单切片加法、revert 即恢复 HEAD | A/B 证明当前 legacy 路径与 HEAD 逐字节一致（无旧路径复活面） |

## 7. Mutation ritual（E5 m3–m6；m1/m2/m7/m8 由 SA3 已备证）

| # | 变异（施加于 `read.ts`，先 `/tmp` 备份） | 红 | 还原后 |
|---|---|---|---|
| m3 | `budgetFold` rawTotal 改为 `m3DescTotal` 后代总数（materializing 计数） | shape-budget **6 failed**/33：S2/S4/S6/S19①/S19②/**S24**（指定锚：omitted 2→4 红） | 33/33 绿 |
| m4 | 截断通道条件在场（`truncations` 空时成功面退化两键，P1 终点 + okUndefined 两处） | **10 failed**/33：S7/S8/S11/**S15**/S16/S17/S19④/O-1/S22/S25/S27（指定锚 S7/S15 红） | 33/33 绿 |
| m5 | `truncated` 恒 false（两处构造点） | **20 failed**/33（指定锚 S2 红） | 33/33 绿 |
| m6 | 非法 options 借 `PATH_NOT_ALLOWED`（optionsInvalid 码替换） | guards **71 failed**/88（NC-5 校验矩阵大面积红） | 88/88 绿（含在全量 503/503） |

每次还原后 `sha256sum read.ts` 均回到冻结值 `3bf6b8b016e4066d…`；全部变异均被对应锚击杀（无幸存变异）。

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA4 §11 | 全量门禁最终态复跑（typecheck/test） | `pnpm typecheck`；`pnpm test` | exit 0 / 全绿 | typecheck **exit 0**（14 tsconfig）；test **341 files/3717 tests**、Type Errors no errors、exit 0 | 本报告 §10 命令记录 | ✅ | — |
| SA4 §11 | E5 m3–m6 变异仪式 | §7 逐条施加→红→还原→绿 | 各指定锚红、还原绿 | m3→6 红、m4→10 红、m5→20 红、m6→71 红；还原后全绿 | §7 表 | ✅ | — |
| SA6 §12.7/S19–S22 | 零物化哨兵 + hop 级观测 | probe3（get 记账/Proxy trap 计数/own accessor 计数） | 折叠/裁减边界外零物化 | 35/35 pass（详见 §3/§5） | probe3 输出 | ✅ | — |
| SA6 §12.5 V1–V6 | 非法 options 定序/零触碰/零外抛/字段构成/码域 | probe2 | 25 组全 pass | ✅ | probe2 输出 | — |
| SA6 §12.4/F1 | 无 options 逐字节不变 | probe4 HEAD A/B | 34 组 canon 全等 | ✅ | probe4 输出 | — |
| SA6 §12.10 E6/E7 | 范围/公共面 | `git status`/`git diff --stat` 亲核 | 仅 ALLOW 6 项 | `index.ts +7`、`read.ts +423/−34`、test-d +15、3 新测试文件；namespace-runtime/vfsl/docs 零 diff | §10 | ✅ | — |
| Design §12 风险表 | Y.Map 序不稳定致脆断 | probe1 S12 现场 `keys()` 派生比较 | 前缀=现场序 | pass（契约 R6 口径） | probe1 输出 | ✅ | — |
| —（额外发现） | 无 | — | — | 未发现任何实现偏离/新失败面；SA4-O1 组合场景（undefined 值键在 width 前缀内占额度被吸收）动态确认正确（probe3 B7 组） | probe3 | ✅ | — |

## 9. Temporary Diagnostics

| 临时物 | 路径 | 处置 |
|---|---|---|
| probe1–probe4 脚本（103 项检查） | `packages/doc-runtime/.scratch-sa7-334/` | **已删除**（`rm -rf`；`ls .scratch*` 零命中） |
| HEAD 基线源副本（A/B 用） | 同上目录（`read-head.ts`/`carrier.ts`，`git show HEAD:` 提取） | 已随目录删除 |
| 变异备份 | `/tmp/sa7-read-backup.ts` | 已删除 |
| 源码临时日志 | 未使用（全程零 `[SA7-DATAFLOW]`；`git diff` grep 0 命中） | 不适用 |
| 后台 job | bash-28（doc-runtime 套件）、bash-29（root 门禁） | 均 completed 退出，无遗留进程 |

**收尾核验**：删除后重跑 doc-runtime 全套 **503/503 绿 + Type Errors no errors**；`read.ts` sha 仍为冻结值 `3bf6b8b016e4066d…`；`git status` 回到 SA3 交付态（3 M + 3 新测试 + wiki 输入），本报告为唯一新增文件。

## 10. Commands and Evidence

| # | Command | Result |
|---|---|---|
| 1 | `NODE_OPTIONS=--conditions=nomicore-source npx vitest run packages/doc-runtime` | 27 files / 503 tests / no type errors（收尾后复跑同结果） |
| 2 | `npx tsx …/probe1-budget.ts`（已删） | 37 pass / 0 fail |
| 3 | `npx tsx …/probe2-options.ts`（已删） | 25 pass / 0 fail |
| 4 | `npx tsx …/probe3-sentinel.ts`（已删） | 35 pass / 0 fail |
| 5 | `npx tsx …/probe4-legacy-ab.ts`（已删） | 6 pass / 0 fail（覆盖 34 组 A/B + 5 组敌意 + 不变量） |
| 6 | m3–m6 变异循环（python 施加 → vitest 单文件 → cp 还原 → vitest 复绿） | 见 §7（4×施加红、4×还原绿） |
| 7 | `pnpm typecheck` | exit 0 |
| 8 | `pnpm test` | 341 files / 3717 tests / no type errors / exit 0 |
| 9 | `git diff --stat`；`git diff --name-only \| grep namespace-runtime\|vfsl\|docs` | 仅 ALLOW 6 项；越界面零命中 |
| 10 | `git diff \| grep -c SA7-DATAFLOW` | 0 |

## 11. Deviations

- **无实现偏离**：设计/契约钉定的全部动态口径（B1–B16、V1–V6、S1–S27 抽样全族、NC-1…NC-8、F1/F10/F11/F13）运行时观察与预期一致。
- 探针脚本自身有 4 处预期构造 bug（JSON 键序 / 空目标 Proxy 不触发 gopd / 导航 get 计入投影 / 夹具缺 xmlEl），均为探针侧修正，不涉及实现；修正后 103/103 全绿。
- SA4 §12 非阻塞观察 SA4-O1（undefined 值键 + width 前缀组合）本轮已动态确认实现语义正确（probe3 B7 组：占额度、被吸收、omitted 按 raw 口径）。

## 12. Verdict

**approve**。

- 设计声明改变的数据流（预算递归 depth/width、截断事实通道、非法 options 定序/包含面、零物化边界、detached B16 折叠）均按设计变化，关键中间跳点（槽位枚举层 get/descriptor 读、条目构造点、计数短路点、OPT 短路点）有运行时证据；
- 设计声明不变的路线（无 options 2 参全行为、缺席吸收、键空间、零写零事件、跨包 readData 面）经 HEAD 源 A/B 逐字节验证保持不变；
- 状态机阶段序正确、禁止转换未出现（无外抛、无伪成功、无码域泄漏、无条件在场通道）；
- 错误与清理符合设计（fail-fast、E100 兜底、零副作用）；变异 m3–m6 全部被指定锚击杀；
- 全量门禁（root typecheck/test）最终态复跑全绿；临时诊断已全部清理且清理后结果不变。

—— 报告结束 ——
