# SA4 r2 修复复审报告 — validateSnapshot own-property 守卫（issue #21）

- **评审对象**: SA3 修复 commit `236f271`（`packages/vfsl/src/validate.ts` +4/−3）
- **前置裁决**: r1 reject（轻度）——仅阻断 F1（判别式快路径原型链污染 → 合法输入假 E100），连带 F2（ref 解析同类面）；报告 `task_vfsl-validate-snapshot_sa4_review.md`
- **复审性质**: 轻量修复复审（总控派发四项范围：diff 范围核验 / r1 §六.1 回归清单独立复测 / 守卫角点攻击 / typecheck+全量复跑）
- **评审人**: SA4（红队）
- **日期**: 2026-08-20
- **方法**: git diff 逐行核验 + 临时 vitest 探针 16 断言块（`sa4r2.temp.test.ts`，用后即删，git status 复原）+ 独立复跑 typecheck/全量

---

## Verdict: **pass**

修复真实、完整、无越界：`236f271` 恰为 F1+F2 两处守卫（合计 3 行语义改动），r1 §六.1 回归清单 16/16 探针全绿，守卫角点攻击未击穿，typecheck 0 错误 + 287/287 全绿。兑现 r1 预告「修完 F1（含 F2）即可放行」。新增发现仅 1 条 INFO 级在案观察（N1，修复前既有、非本次回归，不阻断）。

---

## 一、diff 范围核验：✅ 恰为 F1+F2，零越界、零冻结面触碰

- `95fade0..236f271` 区间**恰一个 commit**；触碰文件**仅 `packages/vfsl/src/validate.ts`**（+4/−3）
- **F2**（`validate.ts:133`）：`ctx.values[node.name]` → `Object.hasOwn(ctx.values, node.name) ? … : undefined`——继承名命中回落 `:134` loud `值树未声明别名`。与 r1 建议修法逐字一致
- **F1**（`validate.ts:400-402`）：快路径入口收敛 `typeof raw ∈ {string, number, boolean}`（判别键仅来自三类字面量，`String()` 永不抛——杀子面 b）+ `Object.hasOwn(byValue, key)` 守卫。与 r1 建议的双管修法逐字一致
- **冻结面零触碰**：消息模板（`值树未声明别名`/`不匹配任何联合成员`/E100 前缀）、100 条上限、WORK_LIMIT 2×10⁸、截断标记、计费行——diff 未涉及任何一行；测试文件零改动；DENY LIST 零触碰
- **守卫族完备性复核**：`ctx.values` 查表全仓仅两处——`:133`（攻击者可控 ref 名，已守卫）与 `:599`（常量键 `'ROOT'`，永不命中原型链继承名，无需守卫）；`byValue` 消费仅 `:402`（已守卫）；快照侧 `present()`（`:160`）本就 `hasOwn`
- 工作树生产代码与 HEAD 逐字一致（`git diff HEAD` 仅预先存在的 TASK.md/dispatch.md 文档改动）

## 二、r1 §六.1 回归清单独立复测：✅ 16/16 全绿

探针 `packages/vfsl/test/sa4r2.temp.test.ts`（已删，git status 复原至会话起始态）：

| 块 | 内容 | 结果 |
|---|---|---|
| P1 | Object.prototype **动态枚举全部继承名**（Node 现状 12 个：constructor/`__proto__`/hasOwnProperty/isPrototypeOf/propertyIsEnumerable/toLocaleString/toString/valueOf/`__defineGetter__`/`__defineSetter__`/`__lookupGetter__`/`__lookupSetter__`）+ `then`，共 13 名作 fixture 联合 kind | 全部 ok:false、**零 E100**、报 `不匹配任何联合成员` ✓ |
| P1b | 抛异常 toString 对象 / Symbol / `{}` / null / undefined / 0 / 1 / true / false / NaN / −0 / 10n / `[]` / `['image']` / boxed `new String('image')` 共 15 种 kind | 全部 ok:false、**零 E100**（含 r1 E100 复发面 boom）✓ |
| P1c | 两成员平局联合 × kind="constructor"（r1 E100 复发面） | ok:false、零 E100 ✓ |
| P1d | 合法快照 | `{ok:true}`——快路径无回归 ✓ |
| P2 | **own 声明的继承名判别键**：`kind:"constructor"`/`"zzz"` 字面量联合 | 照常 ok:true/ok:true；未知 kind no-match 零 E100——**hasOwn 不误伤合法 own** ✓ |
| P2b | 数字判别键 0/1（−0≡0 接受、2 拒绝） | 符合 JS 严格相等语义，零 E100 ✓ |
| P3a | 手造 ref 名 constructor/toString/valueOf/`__proto__`/hasOwnProperty/then | 全部 **loud E100 `值树未声明别名: <name>`** ✓ |
| P3b | 对照真未知名 `zzz` | 行为不变（loud E100）✓ |
| P3c | 对照合法 own：ROOT→ref `Audit` | 照常解析 ok:true ✓ |
| P3d | 对照 own 声明名为 `constructor` 的别名 | 照常解析 ok:true——**F2 守卫不误伤 own** ✓ |
| P5 | 有/无判别式缓存输出全等（合法输入 + 继承名输入 ×3） | `JSON.stringify` 逐字全等——段 0「仅加速静默接受」纪律保持 ✓ |

## 三、守卫实现角点攻击：✅ 未击穿；1 条 INFO 在案（N1，pre-existing）

| 角点 | 结果 |
|---|---|
| byValue 手造 **null 原型**（`Object.create(null)` + own 属性） | own 键照常命中：合法快照 ok:true；继承名 kind 仍 no-match 零 E100——`Object.hasOwn` 不依赖 Object.prototype ✓ |
| byValue 手造 **null** | `Object.hasOwn(null,·)` TypeError → 顶层 catch 收编 **loud E100**（fail-closed 不伪装成功）；联合不可达的快照不受影响 ✓ |
| values 手造 **null** | `:599` 常量键读抛 TypeError → loud E100 ✓ |
| values 手造 **String 包装对象** + own ROOT→ref `"length"`（hasOwn 接收者装箱转换角） | 解析为 `3`（非 schema）→ 静默 ok:true——见 N1，**修复前后同态** |
| boxed `new String('image')` 作 kind | typeof 'object' → 跳过快路径 → 完整流程 no-match——与 P5 输出等价性互证 |

### N1【INFO｜pre-existing，非本次回归，不阻断】values 表内容为非 schema 值 → validateValue switch 无 default → 静默 ok:true

- **复现**（探针 P4d/P4e，已钉住现状）：手造 `derived.values['ROOT'] = 3`（或 values 为 String 包装对象、ref `"length"` 解析得 `3`）→ `resolveValues` 原样返回 `3` → `validateValue` switch 无任何 case 命中、**无 default 抛错** → 快照根本不被检查 → `{ok:true}`
- **与 F2 的界**：F2 是「schema 形状的 ref 节点指向继承名」（名解析族，已修）；N1 是「values 表本身塞非 schema 值」（更深层篡改，`:599` 与 switch 均**不在本次修复 diff 内，修复前后行为逐字相同**）
- **可达性**：管线不可达（evaluate 产物 values 恒为 ValueSchema；接缝前置条件「derived 须为 evaluate 的 ok:true 产物」）；仅直接手造派生物可触发
- **设计张力**：§10 崩溃边界「篡改数据……不静默产出 ok:true」按宽读法覆盖此族；但该句枚举例（引用环/未知名/深嵌套）恰为 resolveValues/顶层 catch 已 loud 的三类。fail-open 方向与 F2 同，可达性比 F2 更苛刻（F2 本身已定级 LOW）
- **路由**：**SA1** 设计 §10 补一词注记（「values 项非 ValueSchema」族的立场：要么豁免要么承诺 invariant）；若立项修复，SA3 侧一行 `default: throw new InternalError(...)` 即闭合全族。不构成本次放行障碍

## 四、独立复跑验收

| 项 | 结果 |
|---|---|
| `pnpm typecheck`（删净探针后复跑坐实） | **exit 0，0 错误** |
| `pnpm test` | **287/287 全绿**（11 个测试文件，与 r1 基线及 SA3 声明一致） |

## 五、动态审核重点（SA7）——r1 清单修订版

1. ~~F1/F2 修复回归~~ → **已完成（本轮静态+探针闭环），销项**
2. WorkBudgetExceeded 首次动态触发（>1.1×10⁸ 键封闭对象 / 大乘积联合）——维持
3. 四类 pattern loud 消息补样（子集外构造 `\1`、程序规模超限）——维持
4. RangeError 收编面可达性（schema 深度×100 × 多栈帧叠加）——维持
5. ReDoS 耗时曲线 500→10⁵ 抽样——维持
6. lookMemo 内存抽样（200 空前瞻 × 10⁷ 码元 RSS）——维持
7. F7/F9 wall-clock 面（深别名链 / 大区间字符类）——维持
8. **（新）N1 族运行时面**：若 SA1 决定收编，SA7 补「values 塞非 schema → loud E100」动态样例；若豁免则验证 JSDoc 前置条件表述与行为一致

## 六、结论

`236f271` 对 F1/F2 的修复与 r1 建议逐字对应且经独立攻击复测成立：合法管线输入上的假 E100 消失（13 继承名 + 15 种异型 kind 全 no-match 零 E100），手造继承名 ref 转为 loud E100，own 声明两向正对照均不误伤，段 0 输出等价性保持，守卫角点（null 原型 / null 接收者 / 装箱转换）全部 fail-closed 或与修复前同态。范围内四项核验全部通过，无新阻断发现。**pass——SA3 修复放行，可进入后续流程。**
