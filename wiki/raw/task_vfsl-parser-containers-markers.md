# 任务简报 — Parser 容器与标记类型（Issue #6）

> Worktree: `/home/wangjian/nomicore-fix-issue-6`
> 分支: `fix/issue-6-on-refactor-docs-add-mabf-multi-repo-monito`
> 任务类型: **功能开发**（流程：SA6 验收测试 → SA1 设计 → SA2 评审 → SA3 编码 → SA4 静态 → SA7 动态）
> 前序: Issue #5（最小端到端 parser，已交付，见 `wiki/raw/task_vfsl-parser-min-e2e_design.md`）
> run_id: `issue-6-1787066321-4581`

## 一、任务目标（来自 Issue #6）

在最小端到端（#5）之上解析容器与标记：`T[]`、`Record<K, V>`、六个标记类型（`YMap` / `YArray` / `YPlainArray` / `YLeaf` / `YXmlFragment` / `Pattern`，大小写是契约）、`string & Pattern<"正则">` 交叉类型。标记及其包裹目标进入 IR；`YXmlFragment` 是保留名，只识别、不做结构解释。

## 二、Acceptance Criteria（全部满足才算完成）

- [ ] 六个标记类型各自正例解析进 IR，含标记嵌套（如 YMap 包 Record 包 YLeaf）
- [ ] `Record` 的键类型与 `Pattern` 键约束解析进 IR
- [ ] `string & Pattern<"正则">` 是唯一被接受的交叉形式，其他任何交叉报结构化错误
- [ ] 标记类型大小写错误（如 `YLEaf`、`ymap`）不被当作合法标记，按未知名处理并报错

## 三、权威输入（必读）

| 输入 | 角色 |
|---|---|
| `docs/vfsl/v1-spec.md` | v1 方言唯一规范来源（frozen）：§2 EBNF、§3 标记语义、§4 错误码总表 + 判定顺序 + 分相位、§6 大小写契约 |
| `wiki/raw/20260818-prd-vfsl-v1.md` | PRD 归档：公共接缝 `parseVfsl(text)` 冻结、零运行时依赖 |
| `wiki/raw/task_vfsl-parser-min-e2e_design.md` | #5 设计（R2 定稿）：tokenizer 记号全集已 Day 1 齐备、IR 以 kind 判别联合预留全部 v1 节点、切片外构造拒绝策略（§8）——本任务兑现这些扩展位 |
| `packages/vfsl/src/`（parser.ts / tokenizer.ts / ir.ts / errors.ts / semantic.ts / index.ts） | #5 交付的现状代码，本任务在其上做加法 |
| `packages/vfsl/test/parse-vfsl.test.ts` 等 3 个测试文件 | #5 红灯契约（现全绿，30/30），不得破坏 |
| `CONTEXT.md` | 术语规范：标记类型定义、`YLEaf`/`yleaf` 等变体拼写是要规避的反例 |
| `docs/adr/` | 已有架构决策（如有），不得违反 |

## 四、环境与验证命令

- pnpm 单仓库 + workspace，唯一业务包 `packages/vfsl`（`@nomicore/vfsl`，当前 `0.1.1`）。
- 本仓库**没有** `scripts/test-lock.sh`；测试与类型检查命令：
  - 全量测试：`pnpm test`（= `vitest run`，仓库根）
  - 类型检查：`pnpm typecheck`（= `tsc -p packages/vfsl/tsconfig.json`）
- 零运行时依赖红线：`packages/vfsl/package.json` 不得引入任何 `dependencies`。
- 改动过的包必须 bump patch 版本号（Hard Gate #9）。

## 五、产出文件命名约定（均写入 `<worktree>/wiki/raw/`）

| 文件 | 来源 |
|---|---|
| `task_vfsl-parser-containers-markers.md` | 本简报（已存在） |
| `task_vfsl-parser-containers-markers_design.md` | SA1 设计 |
| `task_vfsl-parser-containers-markers_sa2_review.md` | SA2 评审 |
| `task_vfsl-parser-containers-markers_sa4_review.md` | SA4 静态验尸 |
| `task_vfsl-parser-containers-markers_sa7_report.md` | SA7 动态验证 |
| `task_vfsl-parser-containers-markers_dispatch.md` | 派遣日志（总控维护） |

功能开发任务**不产出** `YYYYMMDD-bug-<slug>.md`（那是 SA5 故障分析，仅 Bug 修复任务）。

## 六、约束与红线

1. 发布与远程操作（push、开 PR、CI 跟踪）全部由外部 `check.sh` 负责；总控与所有 SA 均不得执行任何远程写操作。
2. `parseVfsl` 返回形状（`{ ok: true; module } | { ok: false; issues }`）与错误码体系（`VFSL-E<三位>: ` 前缀）按 #5 冻结契约延续，只增不改。
3. #5 已绿的 30 个测试不得破坏（无破坏性返工承诺：本任务对 #5 拒绝的 v1 合法文本转为 `ok: true`，属单向收敛）。
4. 测试文件为 vitest `*.test.ts`：SA4 review 须含「1.4 vitest 触发性自检」结论、SA7 report 须含「vitest 触发证据」段落（Hard Gate #14）。
5. 评审 verdict 行格式约定：dispatch log 中 verdict 单独成格（`| pass |`）；SA4/SA7 报告主 verdict 行 `**Verdict**: pass` 且为文件最后一条 verdict。

---

## 七、SA6 红灯测试记录（Phase 1 验收测试，2026-08-18）

### 7.1 测试文件与运行命令

- 新增测试文件：`packages/vfsl/test/parse-vfsl-containers-markers.test.ts`（33 条）
- 运行命令：仓库根 `pnpm test`（= `vitest run`，vitest 3.2.7）
- 独立进程运行（SA6 测试执行规范）：`setsid nohup bash -c 'cd <worktree> && pnpm test; echo $? > /tmp/sa6-exit' ... & disown`，退出码 1

### 7.2 需求拆解与 AC → 测试映射

| AC | 测试锚点 | 用例数 |
|---|---|---|
| AC1 六标记正例进 IR + 嵌套 | 每标记各一正例（YMap/YArray/YPlainArray/YLeaf/YXmlFragment/Pattern）；`YMap<Record<string, YLeaf<string>>>` 嵌套（最内层实参进 IR）；YArray 任意实参（嵌套 + 标量联合）；spec §10 vfs3.assets 全量 fixture 端到端 | 12 |
| AC2 Record 键 + Pattern 键约束进 IR | `Record<string, number>` 正例；键为 Pattern 约束别名（经别名链）与裸 string 键 IR 可区分；键直接 `string & Pattern<…>`（E306 的 string 形）；fixture 解码后正则原文入 IR；反例 E306 两例（直接 number 键 / 别名解析为 number 键） | 6 |
| AC3 唯一交叉形式 | `string & Pattern<"正则">` 正例（正则原文入 IR）；5 个 E100 反例（左元非 string / 右元非 Pattern / 缺实参括号 / 实参非字符串字面量 / 多段交叉）；§9.1 非法正则不校验 ok:true；§2 注记 6 反斜杠双写解码 | 8 |
| AC4 大小写契约 | YMap 精确拼写合法 vs ymap 变体 E301 配对；YLEaf → E301（锚引用记号）；变体可声明为普通别名（§6）；裸标记保留名误用 → E100（判定顺序 7） | 4 |
| 形状 / 上下文边界（§3 附表 + §4 总表） | E304×4（YMap/YLeaf/YXmlFragment 直接 + 沿别名链）；E307×2（直接 + 经别名间接）；E309×1（同步物化上下文混合联合） | 7 |

### 7.3 断言策略（不锁定 SA3 的 IR 具体形状）

IR 具体形状属实现自由度（规格 §1 出范围：「parser 实现与 IR 具体形状」），故正例不锁节点命名：

- **ok:true + IR 可 JSON 序列化**（PRD #3 冻结接缝）；
- **可区分性锚（有牙）**：与「无标记等价文本」的 IR 比较——`YMap<{x:string}>` ≠ `{x:string}`、`YArray<string>` ≠ `string`、`Record<AssetId,n>` ≠ `Record<string,n>`、`YMap<Record<string,YLeaf<string>>>` ≠ `…YLeaf<number>` 等。若实现把标记折叠进无标记形状（AC「标记及其包裹目标进入 IR」不成立），断言失败；任何合理编码（任意 kind 命名）均通过；
- **正则原文进 IR**：解码后正则字符串经 JSON 往返后深搜相等（fixture 的 `^[A-Za-z0-9_\-]{1,64}$` 与 `\\d` 双写解码）；
- 反例断言冻结错误码 + 定位锚（规格 §4 错误身份冻结），锚点均经脚本按 Unicode 码点口径核算（吸取 #5 SA6 恒红列断言教训）。

### 7.4 红灯验证结果（真实失败证据）

```
Test Files  1 failed | 3 passed (4)
     Tests  25 failed | 45 passed (70)
```

- 25 条红灯 = 全部未实现锚点：正例统一 `expected false to be true`（实际 `ok:false` + `VFSL-E100: YMap<…> 属 v1 合法构造、本切片未实现（待后续 issue 落地）`）；形状反例统一 `expected 'VFSL-E100: …' to match /^VFSL-E304|E306|E307|E309/`；E309 用例当前 `ok:true`（#5 切片内构造，待 E309 引入后变红为绿）。
- 8 条绿锁 = 已冻结契约侧（防 SA3 回归）：AC3 五个 E100 反例、YLEaf/ymap E301、变体可声明为普通别名、裸标记 E100。
- 既有 37 条（#5 交付）全部保持绿，无破坏。

### 7.5 给 SA1/SA2 的边界提示

1. **E304/E306/E307/E309 归属**：#5 设计 §8 明确「六标记落地 → E304/E307/E309 引入」「Record 落地 → E306 引入」，本测试已按规格 §4 锚定四码——SA1 设计须覆盖。
2. **YMap 实参形状**：AC1 正例 `YMap<Record<string, YLeaf<string>>>` 要求 Record 视为对象形（Record 默认物化即 Y.Map，§3 默认物化规则表），勿按「仅 ObjectType / 对象形别名」字面读法判 E304。
3. **E309 判定位置**：用例取字段位混合联合（§3 三分类「适用于字段类型」），锚首个异类成员起点。
4. **IR 可区分性**：任意节点形状均可，但标记 / 容器 / 键约束必须可区分于无标记等价文本（7.3），且正则实参以解码后文本进 IR。
