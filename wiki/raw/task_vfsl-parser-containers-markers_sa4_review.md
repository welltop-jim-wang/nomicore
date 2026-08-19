# SA4 静态验尸报告 — Parser 容器与标记类型（Issue #6）

**Date**: 2026-08-19
**Worktree**: `/home/wangjian/nomicore-fix-issue-6`（分支 `fix/issue-6-on-refactor-docs-add-mabf-multi-repo-monito`，SA3 commit `49e90a2`，基线 `4e7dfe2`）
**审核输入**: 任务简报（含 §7 SA6 红灯记录）｜SA1 设计 R5（SA2 R5 pass 定稿）｜SA2 评审全 5 轮存档｜SA3 实际 diff（6 源文件 + 1 测试 + 4 wiki 档案）
**R2 修订标注（2026-08-19）**: 应总控 R2 指令，仅就 §三.2 触发性结论就地补齐 Hard Gate #14 逐字要求的标题「1.4 vitest 触发性自检」（R1 误写为「§1.4 vitest 触发性」，缺「自检」后缀）；R1 全部审查结论与文末主 Verdict 均不变，未重做全量审查、未新建文件。

---

## 一、Scope Creep Guard（§1.1）——✅ 通过

- **ALLOW LIST**（design §12）vs 实际 diff（`git diff --name-only 4e7dfe2 HEAD`）：实际改动 = `parser.ts` / `shapes.ts`(新建) / `semantic.ts` / `ir.ts` / `errors.ts` / `package.json` / `test/parse-vfsl-containers-markers.test.ts` + 4 个 `wiki/raw/task_` 档案（SKILL 白名单豁免）。差集过滤后为空，**无越界文件**。
- **DENY LIST**：`tokenizer.ts`、`index.ts` 不在 diff（零改动 ✓，兑现 #5「Day 1 记号全集」验证点）；`v1-spec.md`、tsconfig/vitest 配置、根 package.json、pnpm-lock 均未动。
- **BLACKLIST**：diff 中无 `package-lock.json`/`yarn.lock`/`.DS_Store`/`TASK.md`/`*.bak`。
- **package.json**：diff 仅 `"version": "0.1.1" → "0.1.2"` 一行（HG9 ✓；零运行时依赖红线 ✓——无 `dependencies` 字段）。
- ⚠️ housekeeping 提示（非阻断）：worktree 有**未跟踪**的 `TASK.md` 与 `.mabf-bg/`（issue-runner 运行时残留）。不在本 commit 内、不触黑名单，但后续提交严禁携带。

## 二、测试与类型基线——✅ 独立复现

按 SA4 测试执行规范（setsid 独立进程）重跑：

```
pnpm test      → Test Files 4 passed (4)，Tests 70 passed (70)   [33 新增 + 37 #5 既有]
pnpm typecheck → tsc 0 错误
```

与派发日志「总控亲验 70/70 绿 + tsc 0」一致；简报 §7.4 红灯基线（25 红/45 绿）全数转绿、8 条绿锁与 #5 37 条零破坏。

## 三、触发性与协议假设门禁

1. **§1.3 E2E spec runner**：本任务无 `*.spec.ts` —— 不适用。
2. **1.4 vitest 触发性自检**：✅ 通过。新测试位于唯一 workspace 包 `packages/vfsl/test/`；CI（`.github/workflows/ci.yml`）`pnpm test` = 根 `vitest run`，`vitest.config.ts` include `packages/*/test/**/*.test.ts` 覆盖该文件；CI 同时跑 `pnpm typecheck`（node 20/24 矩阵）。**SA7 须从 `gh run view --log` 摘录 70 用例被收集执行的证据**（Hard Gate #14）。
3. **§1.5 协议假设**：✅ 通过。design §13 明示无协议级假设（进程内纯函数库）；两项「最接近」依据（JSON 序列化内建行为、vitest include）均经本次审核直接验证属实（探针 9 组 JSON 往返 + include 模式比对）。
4. **§1.6 契约改动连锁**：✅ 通过。`parseVfsl` 签名/返回/不抛错契约零变更（`index.ts` 不在 diff）；`VfslType` 纯加法（TS 穷尽性由 `toIRType` switch 编译期强制，typecheck 0 错误证实）；`toIRType` 的 generic-diag internal throw 系 #5 既有（基线 `4e7dfe2:semantic.ts:176-178` 原样），非新契约。
5. **§1.7 源码 grep 断言禁令**：✅ 通过。四个测试文件无 `readFileSync`；全部 `toMatch/toContain` 作用于 `parseVfsl` 运行时输出（issue message / JSON.stringify(module)），无源码文本形状伪测试。

## 四、设计一致性——✅ 一致（设计登记行为面 100% 复核）

**方法**：不止静态读码——把设计 §10/§11 登记的**全部可观测行为面**（40+ 个码/行/列锚点）写成探针在 SA3 真实实现上逐条执行（探针置于 `/tmp`，未入 worktree）。结果：

| 组 | 覆盖 | 结果 |
|---|---|---|
| §10.1 SA6 11 锚 | E304×4 / E306×2 / E307×2 / E309 / E301×2 | ✅ 全过（且 70/70 内含） |
| §11.1 T-a~T-l | E304 界定（xml/数组非对象形）、E306 字面量键、E307 多层链锚、T-e 文本位豁免、**T-f 预算边界（101 层 YArray → E100@第 101 个 YArray (1,710)，不抛 RangeError）**、T-g（100 层 ok）、**T-h（`string & Pattern<"a">[]` ok 且 IR ≠ `string[]`——注记 1 优先级兑现）**、T-i/T-w 锚点迁移族（E100@`<`(2,13)）、T-j（E304 胜出 304<307 同锚竞争）、T-k | ✅ 全过 |
| §11.2 T-m~T-y | 假环消灭（T-m/T-n/T-x E304/E309 正确复现）、未声明不裁决（T-o/T-p/T-q → E301）、generic-diag 终判独占（T-r/T-s → E301）、E302 多体位置竞争（T-t E302@(2,6) 胜出）、键位口径①（T-u E309@(1,21) 胜出）、自反对象形（T-v ok）、环经联合（T-y E106@(2,11)） | ✅ 全过 |
| §11.3 T-R2-1~5/T-z | 未声明 E301@Foo(1,15)/变体(1,23)、union 行（YLeaf<string\|number> ok）、从宽边界（T-R2-3b E304）、**k=40 E302 双体链 <1s 正常返回（无指数挂起）**、环触达 ⊥（T-z E106@Q(3,10)，无 E306） | ✅ 全过 |
| §11.4 T-R3-1a~d/T-R3-2/T-R4-1~4 | **桶级折叠**（{a}\|string[] ok、别名介导 ok、mixed\|mixed E309@M(1,10)、标量容器并存 E309@number(1,26)）、**两序同码同位**（T-R3-2 A/B 均 E304@YMap(1,10)）、**R5 分量池顶层分解**（T-R4-1/T-R4-2 容器介导环 → E106@A(2,15) 非 E304@YMap——分辨位验证通过；T-R4-3 规格规范示例回归 E106@(1,15)；T-R4-4 判读辅助 E304@YLeaf(1,10)） | ✅ 全过 |
| 声明序不变性 | M2 模块 3!=6 全排列：候选集恒含 {E304@YMap, E106@回边}（集合不变 ✓）；A/B 对（YMap 行恒首）同码同位 ✓。全排列下胜出者随文本位移动（E304↔E106）——与 §8-18 min-position 注记登记口径**逐项一致**（cls 表序无关是内部不变量，报告位按文本竞争是位置语义固有属性，非解析序敏感） | ✅ 符合登记口径 |
| 附加攻击（SA4 自构造） | PV 文本位联合豁免 E309（`YPlainArray<string \| {a:1}>` ok）/ PV 内联合同步标记 E307 / PV 内 record 值位下降 / 嵌套 YPlainArray 不屏蔽 / 键位 E307 被 E306 支配（§8-15c）/ 前向引用 ok / `>>` 记号配对 ok / 空正则 ok（§9.1）/ `期望'>'实际','` 锚违反期望记号 / §8-17 界分（E304 不桶折叠：`YMap<{a}[]\|{b}>` → E304）/ **T-l 20k 裸引用链 + Record 键 ok:true（294ms，线性、无 RangeError）** | ✅ 全过 |

**静态一致性**（读码比对，非运行）：

- parser.ts：parseIdentType 分发表 / parseRecordType / parseMarkerType / parsePatternType 主层前移（§2.3）/ parsePostfixType `[` 循环与 `depth + k` 预算 / dispatchContinuation / E104 字段名位 / 判定顺序 6、7 条不变性——与 §4.2 逐条一致；`MAX_TYPE_NESTING=100` 口径（三入口 +1/-1 try-finally + `[` 链）与 §4.6 一致。
- shapes.ts：Tarjan SCC（显式帧栈、弹出即求值、缩点序依赖在前）、**分量池顶层分解**（topComponents 不展开容器叶，容器内 ref 仅作图边）、SCC 均匀指派、synthesize（'unknown' 主导 → eff 移 cycle → mixed → 桶合成）、clsOf（ref/union/localCls 三行）、strForm 两步法（灰 DFS on-cycle + 反向传播 cycNames 预填 ⊥ + 帧栈 memo-on-completion）、containsSync 反向可达 + pvCheck（不穿越 ref、键位下降）、E309 桶级扫描（map/container 同桶、mixed 恒异类锚、首成员 ⊥ 整联合不裁决）——与 §5.1~§5.6/§8-16~§8-19 逐条对应。
- semantic.ts：walk 下降集扩展（array.element / record.key+value / marker.arg，generic-diag 被 visit）✓ §9-10；E106/E301/E302/E308 候选机制不变，新四码同池 minBy(line,column,code) 聚合 ✓ §5.7；toIR +4 映射剥离 pos ✓ §6（别名不内联、标记不折叠、正则解码原文——SA6 可区分性锚全绿佐证）。

## 五、静默失败 / 降级 / 错误处理——✅ 无静默路径

- 每个「不裁决」类别均闭环验证到已注册错误通道：'unknown'/⊥ ⟸ 未声明名（T-o/T-p/T-q → E301 ✓）或 generic-diag（T-r/T-s → 终判 E301/E100 ✓）；'cycle'/环触达 ⟸ 环存在（T-y/T-z/T-R4-1~3 → E106 ✓）；多体 ⟹ E302（T-t ✓）。全部探针无一条出现「非法文本 ok:true」或 `内部错误` 兜底 E100@(1,1)（index.ts 顶层 catch 未被任何设计路径触达）。
- 这些不是降级：错误身份归还正确通道（如 `YMap<Foo>` 报 E301@Foo 而非 E304@YMap），是设计 §8-13/§8-14 登记的语义，非吞错。
- 单一 issue 模型 + min-position 聚合行为与 #5 冻结口径一致（相位优先由 throw 通道保证）。

## 六、极端条件攻击——✅ 未发现漏洞

- 预算边界：101 层容器 → E100 资源口径（锚第 101 个构造起始记号）；100 层 ok；`[]` 串 `depth+k` 合算；AST 最深 ≈ 200~400 层（容器×`[]` 串 + 联合层）仍 ≪ 爆栈基线 2912 / JSON 4456（#5 §15 实测），walk/toIR 递归安全边际充足。
- 规模攻击：20k 裸引用链 294ms 线性；k=40 E302 双体链 <1s（R2 指数挂起路径已消灭）；穿环 strForm 拓扑不裁决（T-z 族）。
- 输入域：未声明名 / generic-diag / 多体 / 环 全部走守卫通道，无 undefined 取体路径（`comp` 已声明检查 + 第 2 步入表；查询位一律经 clsOf/strFormOf——读码确认无裸表查询残留）。
- EOF/残缺输入（`string & Pattern<`、`Pattern<1>`、缺 `>`/`,`）均落 E100 锚违反期望记号，无异常逃逸。

## 七、架构与过度设计

- 架构评估：✅ 可行。无 FIXME/HACK/TODO，无绕过补丁；实现紧贴设计伪码，未触发退回 SA1 信号。
- 过度设计：✅ 基本精简。shapes.ts 实际 658 行 vs 设计估算 ~380 行——增量全部可追溯到 SA2 历轮攻击的机制加固（Tarjan SCC、两步法 strForm、桶级扫描、双查询助手），无「为未来需求」的空转抽象；边界仍守在 `@nomicore/vfsl` 内部件（index.ts 不导出 shapes ✓）。

## 八、发现事项（均 LOW，不构成 reject）

1. **【LOW · 设计文档】§8-4 示例文本不可达**：登记行写作「联合（`Record<string | Pattern, V>`）→ 非 string 形 → E306」，但该输入按设计自身 §4.2 与规格判定顺序第 7 条在**语法相位**即被拒（实测 E100@`Pattern`(1,26)，裸 `Pattern` 脱离 `string &` 语境）。登记的**选择本身**（联合/字面量/对象/标记键 → E306）已实现且经可达输入验证：直接联合键 `Record<string | number, …>` → E306@(1,17) ✓、别名介导 `"a" | string` 键 → E306@(2,17) ✓、字面量键 T-c ✓。**回流目标：SA1**（下次触碰设计时把示例改为可达输入，一行修订；无行为面影响，SA3 无需动作）。
2. **【LOW · 备忘】声明序全排列的报告位漂移**：YMap 行不在首位的排列下胜出码可在 E304/E106 间随文本位切换——非缺陷，系 §8-18 min-position 注记的登记行为（候选集不变已验证）；记录于此防后续 SA4/SA7 误判。
3. **【LOW · 验证限度】单 commit 压缩**：SA6 测试与 SA3 实现同在 `49e90a2`，无法用 git 历史区分 SA3 是否动过测试断言。旁证：测试内容与简报 §7 记录逐条吻合（33 条、锚点、策略），8 条绿锁与 #5 37 条全程未破，且全部断言为运行时行为断言——SA3 弱化断言的风险相应很低。SA7 如需补证可比对外部 runner 的 SA6 红跑日志。

## 审核结论

1. 设计一致性：✅ 一致（§10/§11 全部登记锚点 + 附加攻击在真实实现复核通过；LOW-1 为设计侧文档瑕疵）
2. 读写路径一致性：✅ 一致（text → tokenizer → AST → semantic → IR 单管线，无数据源分叉；别名不内联/标记不折叠/正则原文入 IR 均验证）
3. 静默失败：✅ 无（不裁决类别全部闭环到 E301/E302/E106/终判通道；顶层兜底未被触达）
4. 降级方案：✅ 安全（'unknown'/'cycle'/⊥ 为错误身份归还语义，非降级；必要性经 SA2 五轮论证）
5. 极端攻击：✅ 未发现漏洞（预算边界/深链/环/未声明/EOF 全数落结构化错误，无抛错、无挂起、无假 ok:true）
6. 错误处理：✅ 完整（每条失败路径产出冻结前缀 + 精确锚点的单一 issue）
7. 架构评估：✅ 可行（无退回信号）
8. 过度设计：✅ 精简（shapes.ts 行数超估算但增量皆有 SA2 攻击溯源）

## 动态审核重点（交 SA7）

1. **vitest 触发证据**（Hard Gate #14）：从 PR 的 `gh run view --log` 摘录 ci.yml `Test` step 收集执行 **70** 用例（4 文件）+ `Typecheck` step 0 错误的证据段落（node 20 与 24 两矩阵）。
2. **CI 环境资源界复核**：T-l 20k 链与 k=40 双体链在 CI runner 的耗时（本地 294ms / <1s，vitest 默认 5s 超时边际充足，但须留 CI 实测记录）。
3. **fuzz 烟雾**（可选加固）：对 `parseVfsl` 做一轮随机/截断输入循环，断言永不抛异常、返回形状恒为二态 union（静态审查已覆盖已知攻击面；此为兜底性质）。
4. **外部对照**（对应 LOW-3）：如可得 SA6 红跑原始日志，比对 25 红用例清单与现测试文件断言一致性。

---

**Verdict**: pass
