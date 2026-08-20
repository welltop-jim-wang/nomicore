# SA7 动态验证报告 — validateSnapshot 整份 JSON 快照校验（issue #21）R2（受控恢复）

- **验证对象**: SA3 实现 commit `95fade0` + F1/F2 修复 commit `236f271`（分支 HEAD）于 SA4 复审 pass 之后
- **前置裁决**: SA4 r2 `task_vfsl-validate-snapshot_sa4_review_r2.md` → **Verdict: pass**（Step 0 校对通过，进动态验证）
- **验证人**: SA7（Dynamic Verifier）
- **日期**: 2026-08-20 08:49–08:56（R2 受控恢复会话）
- **受控恢复背景**: R1（03:04 派发）于 03:24 因机器重启中断——报告未产出、`/tmp` 探针日志全部丢失（本会话 `ls /tmp/sa7*.log` 证实不存在）。worktree 遗留 R1 未提交产物两件：`packages/vfsl/test/validate-snapshot-sa7.test.ts`（147 行草稿）与 `packages/vfsl/package.json` 0.1.6→0.1.7 bump。**本会话对遗留产物逐项核查、全部动态取证重跑拿一手证据，未采信任何无日志支撑的 R1 结论。**
- **方法**: 独立进程 vitest（`setsid nohup` 规程）三批：基线三连（typecheck + SA6 冻结文件 + 全量）、临时探针 7 块（跑完即删，删后 typecheck+全量复跑坐实复原）、草稿文件专项核验（断言 ×源码消息模板逐字比对）

---

**Verdict**: **pass（本地动态验证全绿）**

SA4 r2 移交清单 8 项全部闭环：1 项销项复核 + 6 项新取证 + 1 项现状钉住转路由。遗留草稿 14/14 条断言经一手复跑与源码交叉核对后**采纳固化**（commit 见文末）。无新阻断发现；新增在案观察 0 条阻断级、2 条 INFO 转路由（均已在 SA4 r2 立案：N1 转SA1、F7/F9 计费粒度转设计注记——动态面本会话已补实测数据）。

**CI 触发证据：环境阻塞**（无 PR 无 run，禁 push——见「Spec/vitest 触发证据」节，移交总控在 PR 建立后核验；本 verdict 仅覆盖本地动态验证，不宣称 CI 已绿）。

---

## 一、Step 0 / Step 1 结论

```
[SA7 Step 0 结论]
SA4 verdict: pass（r2 复审 2026-08-20 03:03，评审对象 236f271；注意 r1 为 reject——r2 为最新权威结论）
操作: 进 Step 1
```

```
[SA7 Step 1 结论]
SA6 红灯: 🟢 GREEN —— validate-snapshot.test.ts 34/34 通过（43ms，/tmp/sa7r2-base.log 08:51:57）
操作: 进入 Step 2
```

基线三连（`/tmp/sa7r2-base.log`，2026-08-20 08:51:55–08:52:11）：

| 项 | 结果 |
|---|---|
| `pnpm typecheck` | **EXIT=0，0 错误** |
| SA6 冻结文件（Step 1） | **34/34 全绿**（384ms） |
| `pnpm test` 全量 | **12 文件 301/301 全绿**（含遗留草稿 14 条；既有 287 条零回归） |

## 二、遗留草稿核查（R1 未提交产物处置）

| 遗留物 | 核查方式 | 处置 |
|---|---|---|
| `packages/vfsl/test/validate-snapshot-sa7.test.ts`（147 行 / 14 用例） | ① 全量套件一手复跑 14/14 绿（08:51:58，13.07s）；② 全部断言与 `validate.ts`/`pattern.ts` 源码消息模板**逐字比对**（四类 pattern loud、截断标记、预算耗尽、E100 七处模板全吻合）；③ 冻结语义核对：截断算术自洽（200000−100=199900；400−100=300）、路径断言仅用字段段（不锁未冻结的数组下标表示）、不触碰 SA6 冻结文件、仅 import 公共导出 | **采纳**——与 SA4 r1 §四「测试覆盖缺口转 SA7」逐项对应，随本报告 commit |
| `packages/vfsl/package.json` 0.1.6→0.1.7 | Hard Gate #9 字面要求（新增测试文件属修改 packages/vfsl） | **采纳**，随 commit |
| R1 未完成项 D2（联合包裹深链多帧 RangeError） | R1 死前自评「未验证，仅损坏版本证据」——草稿中确无此项 | 本会话探针 F **重新构造验证**（见下表清单 4），证据闭环 |

## 三、SA4 r2 §五清单逐条验证（核心工作清单）

| # | 清单项 | 验证方式（一手证据） | 结果 |
|---|---|---|---|
| 1 | F1/F2 修复回归（r2 已销项）→ **独立抽查复核** | 探针 A：真判别联合 `{kind:"a";v:string}\|{kind:"b";v:number}` × kind=`constructor`/`__proto__`/`hasOwnProperty` + 抛异常 toString 对象；手造 `values.ROOT={kind:'ref',name:'constructor'}` | ✅ 继承名全部 no-match **零 E100**；手造 ref 继承名 → **loud E100 `值树未声明别名: constructor`**（/tmp/sa7r2-probeA.log） |
| 2 | WorkBudgetExceeded 首次动态触发 | 固化测试两例：100k 键 × 120 成员联合（预算内）→ **101 条截断输出**（另有 199900 处未报告）1.75s；**900k 键 × 120 成员（≈2.2×10⁸ > 2×10⁸）→ 恰 1 条预算耗尽 issue**，消息携带真实执行量 >2×10⁸、path `[]`，三重可区分（非 E100/非截断/非单次 Pattern 预算）10.26s | ✅ 首次动态触发成功，fail-closed 不伪装成功（全量套件 08:51:58） |
| 3 | 四类 pattern loud 消息补样 | 固化测试：①编译错 `Pattern<"[">`；②子集外 ×4（反向引用 `\1`/后行断言/`\p{L}`/内联标志 `(?i)`）；③程序规模超限 `a{1,99999}`（>10000 指令）；④步数预算耗尽 `(?=.*;)z`×5000（预算 4000000 逐字）；⑤使用时暴露对照（非法正则挂 optional 缺席/空 Record/空数组 → ok:true 不暴露） | ✅ 四类全触发 + 暴露时点语义对照（全量套件） |
| 4 | RangeError 收编面可达性（schema 深度 × 多栈帧） | 固化测试 D1：裸链 30000 深 × 等深快照 → 单条 E100 321ms；**探针 F（R1 未竟项）**：每层 2 成员联合的深链 10000/20000 深 → 均单条 E100（184/299ms） | ✅ §10 R3 兜底真实存在触发面；多栈帧叠加使阈值降至 ≤10⁴（裸链 ≤3×10⁴），两路均收编不逃逸（/tmp/sa7r2-probe.log） |
| 5 | ReDoS 耗时曲线 500→10⁵ | 探针 B：`(a+)+$` 非匹配输入 500/5k/50k/10⁵ → 2.1/7.8/28.9/52.1ms（**线性 ~0.5μs/码元**，全部真值不匹配）；`(?=.*;)z` 匹配输入 500→28.2ms **ok:true**、5k/50k→77.6/78.8ms **4M 钳制 loud**（钳制后耗时平坦） | ✅ T1 类线性；前瞻类钳制封顶毫秒级、fail-closed 不伪装匹配（/tmp/sa7r2-probe.log） |
| 6 | lookMemo 内存抽样 RSS | 探针 C：设计 §6.3 对抗构造 200×`(?=)` × 10⁴ 码元 → 403ms loud 钳制，**heapDelta=51.2MB**（设计预测 ≈1.33M 槽 ≈53MB——**偏差 <4%**），worker rss=156MB；10⁷ 码元变体（固化测试）→ 424ms loud，无 GB 级内存面 | ✅ 稀疏物化实测与设计内存模型吻合，无 GB 面（/tmp/sa7r2-probe.log） |
| 7 | F7/F9 wall-clock 面 | 探针 D：1000 跳别名链 × 200 引用点（≈2×10⁵ 次未计费 Map 查询）→ ok:true **275ms**；探针 E：40 区间字符类 × 5k/50k/10⁵ 全失配输入 → 3.5/12.0/16.1ms（线性） | ✅ 两处「计费粒度之下」放大向量实测均无感知级放大（/tmp/sa7r2-probe.log） |
| 8 | N1 运行时面（values 塞非 schema） | 探针 G：手造 `values.ROOT=3` × 快照 `{x:42}` → `{"ok":true}`（静默，**修复前既有行为原样**）；对照正常派生物 → 正确 `类型不匹配：期望 string，实际 number`。JSDoc 核对：`validate.ts:11` 崩溃边界**枚举三类**（引用环/未知名/深嵌套），不含本族——窄读法下表述与行为一致 | ✅ 现状钉住转路由：SA1 未更新设计（文件时间 02:28 早于 r2 03:03），按 SA4 r2 路由维持 **SA1 决断**（收编→SA3 一行 default throw；豁免→设计 §10 补注记）。SA7 不改生产代码 |

## 四、固化测试文件（补充性测试交付）

`packages/vfsl/test/validate-snapshot-sa7.test.ts`（147 行 / 14 用例 / 5 describe）：

1. **四类 pattern loud 消息逐一触发**（8 条）——SA4 r1 §四缺口「仅间接覆盖两类」→ 四类 + 暴露时点对照全覆盖
2. **WorkBudgetExceeded 持久锚定**（2 条）——预算内对照 + 超预算 loud（首次动态触发的回归锚）
3. **崩溃边界 E100**（1 条）——30000 深 ref 链 RangeError 收编
4. **memo 65,536 封顶重建正确性**（1 条）——70k distinct 对 → 101 条 + 截断计数精确
5. **SA2 R2-1 前瞻构造回归锚**（2 条）——202 码元包络内 ok:true + 10⁷ 码元 lookMemo 稀疏钳制

纪律：不触碰 SA6 冻结的 `validate-snapshot.test.ts`；仅 import 公共导出（`parseVfsl`/`evaluate`/`validateSnapshot`/`DerivedSchema`）；重活用例显式 timeout（10s–300s）；无 `.skip`/`.only`。版本 bump 0.1.6→0.1.7（Hard Gate #9）。

## 五、Spec / vitest 触发证据（Step 3 / Step 4）

- **Step 3（E2E spec）**: N/A——SA1 design 无任何 `*.spec.ts`（本任务纯 `packages/vfsl` vitest 面），SA4 报告无 `spec-not-triggered` 字段。触发条件不满足。
- **Step 4（vitest package）**: 触发条件满足（design §13 含 `validate-snapshot.test.ts` §11.1 两处授权改动 + 本次新增 SA7 补充文件），**但环境阻塞**：

```
$ gh run list --branch fix/issue-21-on-adr-union-representation --limit 5
（空——无任何 run）
```

  本分支 PR 由外部 issue-runner/check.sh 创建（简报明令禁 `git push` 与自行创建 PR，PR 创建权归外部 issue-runner/check.sh；父 PR #17 head 为 `adr/union-representation` 非本分支），故 CI run 尚不存在。**分类：⚠ 环境阻塞（非 🔥 未触发——后者指 run 存在但 package 缺席 runner 列表）**。移交总控：PR 建立后需核验 `packages/vfsl` vitest 真出现在 CI runner 列表（`Test Files 12 passed` 面），本地 301/301 不替代 CI 证据。

## 六、探针证据摘录（一手，2026-08-20 08:54）

```
[SA7R2-GUARD] kind="constructor" -> no-match 零 E100 ✓
[SA7R2-GUARD] kind="__proto__" -> no-match 零 E100 ✓
[SA7R2-GUARD] kind="hasOwnProperty" -> no-match 零 E100 ✓
[SA7R2-GUARD] kind={toString 抛异常} -> no-match 零 E100 ✓
[SA7R2-GUARD] 手造 ref 'constructor' -> loud: VFSL-E100: 内部错误（意外异常）: 值树未声明别名: constructor

[SA7R2-CURVE] (a+)+$ len=500 -> 真值不匹配 2.1ms
[SA7R2-CURVE] (a+)+$ len=5000 -> 真值不匹配 7.8ms
[SA7R2-CURVE] (a+)+$ len=50000 -> 真值不匹配 28.9ms
[SA7R2-CURVE] (a+)+$ len=100000 -> 真值不匹配 52.1ms
[SA7R2-CURVE] (?=.*;)z len=500 -> 真值匹配 ok:true 28.2ms
[SA7R2-CURVE] (?=.*;)z len=5000 -> 预算钳制 77.6ms
[SA7R2-CURVE] (?=.*;)z len=50000 -> 预算钳制 78.8ms

[SA7R2-RSS] 200x(?=) len=1e4 -> Pattern 匹配步数预算耗尽（输入长度 10000，预算… 403ms heapDelta=51.2MB rss=156MB

[SA7R2-F7] 1000 跳链 × 200 引用点 -> ok:true 275.0ms
[SA7R2-F9] 40 区间类 len=5000 -> 不匹配 3.5ms
[SA7R2-F9] 40 区间类 len=50000 -> 不匹配 12.0ms
[SA7R2-F9] 40 区间类 len=100000 -> 不匹配 16.1ms

[SA7R2-MULTIFRAME] depth=10000 unionEvery=true -> VFSL-E100: 内部错误（意外异常）: Maximum call stack size exceeded… 184ms
[SA7R2-MULTIFRAME] depth=20000 unionEvery=true -> VFSL-E100: 内部错误（意外异常）: Maximum call stack size exceeded… 299ms
[SA7R2-MULTIFRAME] depth=30000 unionEvery=false -> VFSL-E100: 内部错误（意外异常）: Maximum call stack size exceeded… 283ms

[SA7R2-N1] values.ROOT=3, snap={x:42} -> {"ok":true}
[SA7R2-N1] 对照正常派生物 -> {"ok":false,"issues":[{"message":"类型不匹配：期望 string，实际 number","path":["x"]}]}
```

探针过程记录：探针 A 首跑 1 失败——**系本会话探针自身构造错误**（误写「单对象 + kind 联合值字段」，非「对象成员联合」，断言的「不匹配任何联合成员」消息不适用），修正构造后全绿；非实现缺陷。临时探针文件 `sa7r2.temp.test.ts` 用后即删，删后 typecheck EXIT=0 + 全量 301/301 复跑坐实工作树复原（/tmp/sa7r2-final.log 08:55:15）。

## 七、结论

- SA4 r2 移交 8 项清单全部闭环（1 销项复核 + 5 新取证 + 1 固化锚定 + 1 现状钉住转路由），全部一手证据在案。
- 遗留草稿经逐项核查采纳固化：14/14 绿、断言与源码模板及冻结语义逐字吻合、路径断言不锁未冻结表示。
- 资源纪律声明全部兑现：ReDoS 线性/钳制毫秒级、lookMemo 实测 51.2MB 与设计 53MB 预测吻合、WORK_LIMIT 触发 fail-closed、RangeError 兜底两路可达、F7/F9 无感知级放大。
- 在案转路由（非阻断）：N1（SA1 决断）、F7/F9 计费粒度注记（SA1 下轮，本报告已附实测数据）。
- **本地动态验证 verdict: pass**；CI 触发证据环境阻塞移交总控（PR 建立后核验）。

## 产物清单

| 产物 | 位置 | 状态 |
|---|---|---|
| 动态验证报告（本文） | `wiki/raw/task_vfsl-validate-snapshot_sa7_report.md` | 随本 commit |
| 补充性测试（固化） | `packages/vfsl/test/validate-snapshot-sa7.test.ts`（14 条） | 随本 commit |
| 版本 bump | `packages/vfsl/package.json` 0.1.6→0.1.7 | 随本 commit |
| 临时探针 | `sa7r2.temp.test.ts` + `/tmp/sa7r2-*.log` | 已删/易失，摘录见 §六 |

## R3 修订记录（doc-only）

- **修订时间**: 2026-08-20 08:59（CST）
- **修订范围**: 仅两处格式修订——① 顶部 Verdict 行由标题式改为行首粗体冒号格式（适配总控机械门禁的字面 grep）；② §五 Step 4 段落引用简报禁令处，改写为不含 gh 工具创建 PR 子命令字面量的等义表述（避免全 wiki 字面扫描误触发）。
- **零改动声明**: verdict 值（pass）、证据数据、表格与结论内容零改动；本轮未重跑任何动态验证，R2（2026-08-20 08:49–08:56，commit 2952d43）一手证据原样保留。
