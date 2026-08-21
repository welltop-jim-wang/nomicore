# 任务简报：validatePatch：路径级写入校验（H2）

- Issue: #53 (welltop-jim-wang/nomicore)
- Parent: PR #51
- run_id: issue-53-1787290452-126966
- Branch: fix/issue-53-on-phase-2-engine-gaps
- Base: phase-2-engine-gaps
- Task Type: 功能开发（Phase 2 引擎缺口 H2）

## What to build

实现 §7 统一写入管线的判定核心（增量形态）：`validatePatch(derived, base, path, value) → { ok: true } | { ok: false; issues }` + 数组三操作变体（insert/append/delete，D1 词表的运行时面）。两段判定：

- **结构守卫**——按结构树查路径存在性（ADR 0003「任一成员出现即存在」规则），leaf/plain 位置拒绝下钻，数组下标越界为运行时错误（替换语义）；
- **值校验**——在最近结构边界重建整值（base + patch 合并）后整体过子 schema（联合判别一致性由重建兜底，ADR 0003 §3 已演练语义）。

issues 复用 ValidateIssue（message + path 段数组）。**复用 #31 的 validate.ts 解释器，不复制第三份**——并顺手收敛 #28/#31 评审留档的 resolve 双份问题（resolveValues/resolveChain 合一）。

## Acceptance criteria

- [ ] 接缝形状如上；同步、纯函数、不抛错
- [ ] 结构守卫：未知键路径 / leaf 下钻 / plain 下钻 / 越界替换 → 拒绝并带精确 path
- [ ] 重建语义：向 union 成员写入他成员字段 → 重建后 any-of 全拒绝（报失败距离最小成员 + 「联合成员 i/N」）
- [ ] 数组合法下标替换通过；insert（含末尾 append 语义）/ delete 的元素类型校验
- [ ] 解释器单一来源：validate.ts 的 resolve 循环收敛为一份（validateSnapshot 与 validatePatch 共用）
- [ ] 全收集 + 上限语义与 validateSnapshot 一致

## Blocked by

None - can start immediately

## 关键参考（总控注）

- 设计文档 §7（统一写入管线）：docs/vfsl/v1-spec.md
- ADR 0003（求值器与派生 schema）§3 重建语义、§4 ref 别名：docs/adr/0003-evaluator-derived-schema.md
- CONTEXT.md 词表：「重建校验」「结构树」「路径索引」「零写入」
- Phase 2 缺口说明：docs/phases/phase-2-engine-gaps.md（H2 行）
- 现有解释器：packages/vfsl/src/validate.ts（#31 产物，validateSnapshot）；resolve 双份问题见 #28/#31 评审留档（wiki/raw/ 内相关 sa4_review）

---

## SA6 Phase 1 验收锚定记录（2026-05-08 流程）

### 测试产出

- 测试文件：`packages/vfsl/test/validate-patch.test.ts`（36 条用例，6 组 describe）
- 锚定接缝（D1 词表镜像命名；SA1 若设计定名不同须以本文件导出名转绿）：
  - `validatePatch(derived, base, path, value)` — path 为段数组（string|number），顶段即 ROOT 字段（ADR 0004 D5，不含 ROOT 前缀）；`base` = 当前 ROOT 快照值（与 validateSnapshot 的 snapshot 同形状）；输出 `{ ok: true } | { ok: false, issues: ValidateIssue[] }`
  - `validateAppendToArray(derived, base, path, value)`（value = 单元素）
  - `validateInsertIntoArray(derived, base, path, index, value)`
  - `validateDeleteFromArray(derived, base, path, index)`
- 全部经 `../src/index.js` 公共面导入（与 validateSnapshot 先例一致）。

### 测试设计（AC 逐条锚定）

| AC | 锚点 | 用例数 |
|----|------|--------|
| AC1 接缝形状 | 公共导出函数；结果形状 `{ok}` / `{ok,issues:[{message,path}]}`；JSON 往返；纯函数（两次调用全等、derived/base 不被修改）；同步不抛错（含 base=null 等异常输入返回拒绝） | 6 |
| AC2 结构守卫 | 未知键路径（ROOT 层 + 封闭对象深层）；leaf 下钻（`['name','deep']`）；plain 下钻（`['attachments',0]`，YPlainArray 只整体替换）；xml-fragment 下钻（`['assets','text1','body','deep']`，ADR 0003 §5）；越界替换（`['items',5]`，length 2）；plain 整体替换合法/非法 | 9 |
| AC3 重建语义 | FIXTURE 交叉写入（img1 写 text 成员独有字段 body → 联合成员 1/3 + 精确 path）；与 validateSnapshot 同重建值 issue 全等（单一来源）；双向交叉写入（a→y 报 1/2、b→x 报 2/2，失败距离最小成员）；自身字段类型错（联合成员 1/2 + 类型不匹配）；自身字段合法写入 ok:true；判别式缓存透明（有/无缓存输出全等） | 6 |
| AC4 数组三操作 | 合法下标替换通过；替换元素类型错（path 含下标段）；append 合法/元素类型错（path=`['items',2]`）/非数组路径拒绝；insert 中位/末尾 append 位（index==length）合法/元素类型错；delete 中位/末位合法/残留非法元素拒绝（重建后下标）/越界拒绝/非数组路径拒绝 | 11 |
| AC5 单一来源 | 非联合值校验：validatePatch 与 validateSnapshot 对同重建快照 issue（message+path）逐条全等；联合交叉写入同源全等（并入 AC3） | 1（+AC3 1 条） |
| AC6 全收集+上限 | 多字段错一次报全（2 条 issue 非短路）；150 坏元素重建后 101 条 issue（100 真实 + 末条截断标记 /截断\|truncat/i）与 validateSnapshot 同契约 | 2 |

### 红灯运行证据（必须真实红）

命令：`npx vitest run packages/vfsl/test/validate-patch.test.ts --reporter=verbose`

```
Test Files  1 failed (1)
      Tests  36 failed (36)
Type Errors  no errors
```

根因（全部 36 条同一类别，非伪红）：`validatePatch` / `validateAppendToArray` / `validateInsertIntoArray` / `validateDeleteFromArray` 在 `src/index.ts` 无导出——`(0 , validatePatch) is not a function`（首条为 `expected 'undefined' to be 'function'`）。功能尚不存在，红灯真实成立；SA3 实现公共导出后按断言转绿。断言全部锚定运行时行为（结果形状 / issue 内容 / path 段数组 / 与 validateSnapshot 等价性），无源码 grep。

### 交给 SA1 的设计备注（红线外自由）

1. 数组三操作命名以本测试导出名为转绿契约；如设计定名不同，index.ts 须同时导出本测试名。
2. insert 下标上界（index > length）未冻结（SA8 门禁裁定属设计自由），本测试只锚 index ∈ [0, length]（含 length = append 位）；delete/替换越界按 D1「越界归运行时校验」锚定为拒绝。
3. 结构守卫拒绝的 issue path 本测试按「完整尝试路径」锚定（如 `['name','deep']`）；如设计取失败点前缀，须与测试对齐或回写本记录。
4. 值校验 issue path 按绝对路径（ROOT 起）锚定（与 validateSnapshot 一致）；重建边界为「最近结构边界」，两处等价性用例对边界选择不敏感（边界内 issue 与整快照 issue 全等）。
