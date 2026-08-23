# AC 逐条核对表 — 按 LogicalPath 同步读取 Yjs 子树逻辑值 (issue #75)

核对时间：2026-08-22 17:18（Phase 3.5 AC 门禁，总控亲自核对）
AC 来源：TASK.md「Acceptance criteria」（issue body 无独立 AC 段时以 TASK.md 为准）

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | path 统一为 `readonly (string \| number)[]`；空 path 显式读取完整 ROOT | ✅ | `read-logical-value-at-path.test.ts` AC1 组 3 用例（L242-269：[]→完整 ROOT 副本、readonly 变量路径深层混合段、空 doc 边界）；`read-logical-value-at-path.test-d.ts` 类型层签名契约（readonly path 可传、点号字符串/裸 string/裸 number @ts-expect-error 自我反转）；23/23 绿 | 无需处理 |
| AC2 | schema 不允许的路径返回 `PATH_NOT_ALLOWED` | ✅ | test.ts AC2 组 3 用例（L271-288：未知 ROOT 字段、Record 键违反 Pattern、union 成员内未知字段 → ok:false code:'PATH_NOT_ALLOWED' + path 回显）；SA7 Step 1 复跑 23/23 绿 | 无需处理 |
| AC3 | 合法 optional/Record 缺键和非负整数数组越界返回 `ok:true, value:undefined` | ✅ | test.ts AC3 组 4 用例（L290-316：缺席 optional、缺席 Record 键、非负越界 → value 键显式存在且 undefined；在场正向对照） | 无需处理 |
| AC4 | 负数、非整数或字符串数组下标非法 | ✅ | test.ts AC4 组 4 用例（L318-340：-1 / 1.5 / "0" → PATH_NOT_ALLOWED；合法下标对照）；supplementary 补充锚钉死 -0/NaN/±∞/2^53 极端位（SA4 报告「极端位」节） | 无需处理 |
| AC5 | leaf/plain/XML 为不可下钻终态；plain 数组只允许整体读取 | ✅ | test.ts AC5 组 3 用例（L342-365：leaf 下钻拒绝、plain 数组整体读/下钻拒绝、xml-fragment 下钻拒绝 + 整体语义等价） | 无需处理 |
| AC6 | 读取成本与目标子树规模相关，返回值修改不影响 live doc | ✅ | test.ts AC6 组 3 用例（L367-401：只返回目标子树、返回值改写后 extractYjsSnapshot 实证 doc 未变、坏兄弟子树不影响目标读取）；SA7 报告 Step 2-⑤ 成本冒烟实证：n 扩至 20k 键时 read 平坦 0.007→0.019ms vs extract 0.059→9.663ms（read/extract=0.20%）；SUP-1 与 extract ground truth 逐字锁 | 无需处理 |

## 结论

6/6 全部 ✅，无 ❌ 条目，无需追加派发。验收测试由 SA6 锚定（红灯→SA3 转绿），SA4 静态验尸 + SA7 动态验证双清（均为 pass）。
