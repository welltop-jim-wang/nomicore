# SA7 动态验证报告 — issue #308（readData 语义投影 docs 切片并入 memberDocs）

- Dispatch：`sa-b9ae6a65-e174-42e3-8f9a-40305b3587e8`（mabf-sa7 / final-verification / iteration 0）
- 验证对象：worktree `/home/wangjian/nomicore-fix-issue-308`，分支 `mabf/issue-308`，HEAD `3fa05f4`（实现已提交；SA8 已放行权威基线 rebase，rebase 干跑对 `packages/vfsl`/`docs/adr` 面逐字节稳定）
- 上游门禁状态：SA6 契约 approve、SA4 实现审查 approve（0 BLOCKER/0 MAJOR/0 MINOR）；Issue REST comments `[]`（无附加 Owner 要求）
- 裁决：**approve** —— 38/38 项动态断言全绿；设计声明改变的数据流按设计变化、声明保持的逐字节保持、错误与清理符合设计、临时诊断已清理。

---

## 1. Inputs

| 输入 | 位置 | 用途 |
|---|---|---|
| 任务简报（Issue #308 body；REST comments `[]`） | `wiki/raw/task_issue-308.md` | AC1–AC3 需求全集 |
| SA1 设计（iteration 1，SA2 approve） | `wiki/raw/task_issue-308_design.md` | §7-D1–D8 决策、§8 数据流三路线、§10 验证命令、§11 ALLOW/DENY |
| SA6 验收契约 | `wiki/raw/task_issue-308_sa6_contract.md` | §12.1–12.5 契约口径、§12.4 冻结摘要（41 个唯一 sha256，本报告独立复算的权威基准） |
| SA3 实现报告 | `wiki/raw/task_issue-308_sa3_impl.md` | 交付面与验证记录 |
| SA4 实现审查 | `wiki/raw/task_issue-308_sa4_review.md` | §11 后续动态验证项（CI 分片/规模曲线）与本轮重点风险 |
| SA8 冲突门禁 + rebase 复审 | `wiki/raw/task_issue-308_sa8_conflict.md`、`wiki/raw/task_issue-308_rebase_sa8_conflict.md` | 不可改变协议边界（F3.1/F3.2/F3.3、C1–C12） |
| 被测实现 | `packages/vfsl/src/resolve-schema-at-path.ts`（`sliceDocs` L454–489）、`packages/namespace-runtime/src/read-schema-projection.ts`（零改动组合面）、`docs/adr/0016-…md`（+20/-0 增补节） | 动态观察对象 |

## 2. Runtime environment

| 项 | 值 |
|---|---|
| HEAD / 分支 | `3fa05f4b079ea6f91ecda6e31e30c7ae7056fe9e` / `mabf/issue-308` |
| Node / pnpm | `v24.13.0` / `10.28.2`（与 SA6 §4 基线一致） |
| 依赖 | 离线就绪（无网络依赖；探针经 `--conditions=nomicore-source` 直连 `src/index.ts` 活源码，非 dist） |
| 起点/收尾工作树 | `git status` 仅 Host 拥有的 2 份未跟踪 wiki 简报；tracked 文件零 diff（动态验证零生产改动） |
| 服务/进程 | 无服务、无后台作业；全部命令前台完成 |

## 3. Changed Data Flow Verification

设计 §8 声明三条路线：①派生表建立（#306 前置，本票不改）、②每次读的 docs 切片（本票变更点）、③detached 深拷贝（零改动组合边界）。逐跳动态证据：

| Route | Design change | Runtime driver | Observed hops | Expected result | Actual result | Verdict |
|---|---|---|---|---|---|---|
| ① 事实源：`evaluate` 产 `memberDocs` 条件稀疏表 | 不变（#306 面），作为本票输入 | 探针 S1：`parseVfsl(M4_TEXT)` → `evaluate`（公共入口） | 表在场、23 键；`fieldDocs` 在 23 个 `<member N>` 键上 0 条目（ADR 0019 §7 前提实测成立）；M4-free 文本派生物整键缺席 | 表在场 ⇔ M4 使用；条件稀疏 | S1a/S1b/S1c 全 PASS | ✅ |
| ② 输入从正确入口进入（`readData(path)` 成功 → `projectReadDataSchema` → `resolveSchemaAtPath`） | 消费侧接线（ADR 0019 §7） | 探针 S10：真实 runtime（SCHEMA 信封 → P0 → ready）`readData(['st'])`/`readData(['pair2'])` | 成功分支恰三键 `{ok,value,schema}`；schema.docs 携带 `Mode.<member 0/1>`（闭包腿）与 `ROOT.pair2.<member 0/1>`（终点腿）逐字成员 doc | 新 docs 条目经唯一直接调用方流入 readData 载荷 | S10a/S10b PASS | ✅ |
| ② 关键转换值：三源合并 `field → marker → member` 末位 | D1 单点合并 | 探针 S2：16 契约路径逐键机械对账（docs 键 ⊆ 三表键并集、不发明键、每键内容 === `[...field,...marker,...member]` 逐字拼接）；S2b 闭包腿机械不变量（凡锚 ∈ `r.aliases` 的 memberDocs 键必在场且等于三源拼接） | 合并为空不成键、内容逐字 | 0 违例 / 0 缺失 | S2a/S2b PASS | ✅ |
| ② 合并次序 marker 前、member 后（AC1/M7） | D1 | 探针 S3a：`JSON.stringify(docs['Mixed.<member 0>'])` | `[" 载体甲 "," 成员甲 "]` 逐字两元素次序；`Mixed.<member 1>` 三源空合并不成键（S3b） | marker 在前 member 在后 | 与目标逐字相同 | ✅ |
| ② 两腿选键独立命中（选键规则零改动下 `<member N>` 天然覆盖） | D2 | 探针 S3e/S3f/S3g：`['u']`（闭包腿，`aliases=['U']`）、`['pair']`/`['mode']`（终点腿，`aliases=[]` 且枚举值树无成员结构、键只能来自 memberDocs 表） | 两腿路径 docs 均含逐字成员键；`['mode']` valueSchema 仍 `{kind:'enum',values:['on','off']}` | 只接单腿的实现必红一组 | 两腿均绿 | ✅ |
| ② 全量读 `[]` | M8b | 探针 S3c/S3d | 23 键全量逐字 = SA6 §12.3；`aliases` 顺序 `['Status','U','Mixed','Choice','Inl','InlEnum','InlItem','InlRec']` 同旧实现 | 23 键 + 8 名闭包 | 全等 | ✅ |
| ③ detached 深拷贝承接新条目（零改动） | C6 | 探针 S10c：两次 `readData` 返回物互异引用；对返回 `docs` 数组 push 与 `aliases.Mode.kind` 变异后再读，结果 pristine | 克隆器泛化深拷贝、每次读新鲜、零缓存 | 变异不泄漏 | distinct=true；pristine=true | ✅ |
| 旧路径不再被调用 | 两来源切片废弃 | 行为反证：S1（表 23 键在场）+ S2/S3（投影 docs 实际产出全部 23 键）——若旧两来源扫描仍在生效，S2/S3 必红 | memberDocs 已被消费 | member 键可达公共投影 | 证实 | ✅ |
| 缓存/失效 | 零缓存、每读现算 | S7b/S7d + S10c：同输入两次调用 JSON 全等；结果数组与表条目非同引用；变异结果不污染事实源（派生物不可变） | 无缓存可失效；新鲜产物 | 成立 | ✅ |

## 4. Preserved Data Flow Verification

| Route | Preserved invariant | Runtime driver | Baseline observation | Current observation | Verdict |
|---|---|---|---|---|---|
| M4-free 整投影逐字节（AC2/C1） | `FIXTURE_TEXT` 6 路径 sha256 冻结 | 探针 S8a：独立复算 `sha256(JSON.stringify(resolve结果))` vs SA6 §12.4 表 1（期望值自 SA6 文档转写，不依赖被测 fixture 常量） | SA6 录制于旧实现 `4d4208b` | 6/6 路径逐字节相同 | ✅ |
| 存量金样本逐字节（C2） | `SPEC_FIXTURE` 4 路径 + `FIXTURE_B` 3 路径 | 探针 S8b/S8c 同法 | 同上 | 4/4 + 3/3 逐字节相同 | ✅ |
| 表缺席惰性（C3） | `M4_TEXT` 派生物剥离 `memberDocs` 后 17 路径逐字节 | 探针 S8d（shallow clone + delete key） | 同上（表 2） | 17/17 逐字节相同（含 `['u','x']` 深读路径） | ✅ |
| 非 docs 部分不变（F3.3/C8） | 16 契约路径 `{valueSchema,aliases,aliasDocs}` 摘要 | 探针 S8e 独立复算 vs 表 3 | 同上 | 16/16 相同（Record 值位路径 payload 实测 `{"valueSchema":{"kind":"enum","values":["x","y"]},"aliases":{},"aliasDocs":{}}`） | ✅ |
| M4-free 面无成员键泄漏 | docs 无 `<member ` 子串 | 探针 S8f + S10d（runtime 面） | 旧实现天然无 | 均无 | ✅ |
| 空条目过滤（C4） | 空数组合并不得成键 | 探针 S4a：`memberDocs['U.<member 0>']=[]` → 键缺席而 `'U.<member 1>'` 在场 | 旧实现绿（天然缺席） | 保持 | ✅ |
| 未选中键不泄漏（C5） | 见表全量倾倒必红 | 探针 S4b：整表替换 `{'Unrelated.<member 0>':[' 不应出现 ']}` → 16 路径零泄漏；`['m']` 仍 marker-only `{"Mixed.<member 0>":[" 载体甲 "]}` | 旧实现绿 | 保持 | ✅ |
| 四件套形状/确定性/可序列化（C5/C7） | ok 分支恰 5 键；两次调用全等；JSON 往返全等 | 探针 S7a/S7b/S7c | SA6 §6 | `["aliasDocs","aliases","docs","ok","valueSchema"]`；全等 | ✅ |
| 深读不扩展（D6/SA6 §15.1 不冻结面） | `['u','x']` 不携带途经成员 doc（设计显式保持现状） | 探针 S5a | 旧实现 `{}` | docs 无 `<member ` 键（保持） | ✅（记录性） |
| 可信域六键守卫（F3.1） | 必填清单不含 `memberDocs`；删必备键仍 loud | 探针 S6d/S6e：删 `markerDocs` → `InternalError`；删 `memberDocs` → `ok:true` | 旧实现行为 | 逐项保持 | ✅ |
| runtime 组合面零改动（C6/#273 面） | 既有保真测试原样绿 | 既有 `runtime-readdata-schema-projection-{red,control}.test.ts`（本票未触碰的存量测试） | SA3 记录 21 passed | 21/21 passed（本轮独立复跑）；失败分支不带 schema 键、敌意 path → `schema:null` 收敛（探针 S10e：`['rogue']` 与 keyPattern 失配 `['skus','ZZ1']` 均 null） | ✅ |
| 既有 vfsl 测试零改动仍绿（C9） | 4 旧文件 55 tests | 聚焦 6 文件运行（设计 §10 ①） | SA6 §4 基线 | 4 旧文件全绿（80 tests 含新增两文件；git 零修改） | ✅ |

## 5. State Machine Verification

纯同步函数、零 memo、无状态机（设计 §8）；可动态验证的「状态面」= 结果联合收敛次序、守卫次序与 runtime 生命周期：

| Initial state | Trigger | Expected transitions | Observed transitions | Forbidden transitions absent | Verdict |
|---|---|---|---|---|---|
| 任意 derived + 敌意 path（非数组） | `resolveSchemaAtPath(d, 'not-an-array')` | path 形状守卫最先结算 → `SCHEMA_PATH_INVALID`（path=[]），不触 derived | S6c：即便 memberDocs 同时畸形也返回 INVALID 不 throw——敌意通道优先于可信域守卫的次序保持 | 无 throw、无 derived 访问副作用 | ✅ |
| 畸形 memberDocs + 可解析路径 | `resolveSchemaAtPath(d, ['u'])` | 六键守卫过 → 路径解析 ok → `sliceDocs` 内表级守卫 → `InternalError`（可信域 loud，不进结果联合） | S6a：null/数组/字符串/数字四形全部 `InternalError`（构造器名逐一核对，非裸 TypeError） | 无降级码、无伪 ok、无裸 TypeError 泄漏 | ✅ |
| 畸形 memberDocs + 不可解析路径 | `resolveSchemaAtPath(d, ['nope'])` | 路径解析失败先结算 → `SCHEMA_PATH_NOT_FOUND` 两码联合，不额外 throw（守卫在 sliceDocs 内、解析失败时不被调用的设计偏好 N-4） | S6b：`SCHEMA_PATH_NOT_FOUND`，零 throw | 无「解析失败+畸形表」双罚 throw | ✅ |
| runtime ready | `readData(['st'])` 成功 | 值读先行 → schema 投影附加（恰三键） | S10a | 无 schema 进失败分支（#273 负控复跑绿） | ✅ |
| runtime ready | 路径偏离 schema / 静态解析失败 | 两码同收敛 `schema:null`（读恒 ok） | S10e | 无外抛 | ✅ |
| runtime ready | `close()` 后再读 | 同步停接纳 → `RUNTIME_READ_DISABLED` | S10f/S10g（两个 runtime 实例均复现；close 幂等收尾） | 无 close 后读成功/挂起 | ✅ |
| 重复触发/幂等 | 同输入多次调用 | 逐字节确定（零 memo） | S7b 两次全等；S10c 多次读 pristine | 无跨调用状态 | ✅ |

## 6. Error and Cleanup Flow

- **错误分类**：`memberDocs` 在场但表级畸形（null / 数组 / 字符串 / 数字）→ 唯一新增失败路径，实测全部收敛为 `InternalError`（S6a），沿既有可信域 throw 通道，不进结果联合、不降级两码、无裸 `TypeError` 泄漏（对比：不设守卫时 `Object.keys(null)` 会泄漏 TypeError——本实现已堵）。
- **部分完成诚实性**：纯函数无部分态；三遍扫描单点合并（S2a 0 违例）。
- **清理时序**：探针 runtime 两个实例 `close()` 后读均 `RUNTIME_READ_DISABLED`（S10f/S10g）——close 停接纳语义保持；无遗留服务/进程/后台作业（全部前台命令，无 nohup/setsid/PID 文件）。
- **retry/restart 不复活旧路径**：零缓存 + 逐调用确定（S7b/S7d）——重复调用持续走三源合并路径；对「重试复活旧两来源行为」的反证 = S2/S3 在多次独立进程（探针三轮 + vitest 多轮）中一致产出成员键。
- **性能性失败排除**（SA4 §11 第 3 行后续动态项）：第三遍扫描增量实测近线性——N=100（200 键）37.28 µs/次、N=400（800 键）112.53 µs/次（比值 3.02 ≈ 键数比 4；另一次运行 33.17/167.56 µs，比值 5.05，JIT 预热方差内）。均为亚毫秒级、随键数近线性，未触发 SA4 失败条件（非线性增长或毫秒级以上单读增量）；相对旧基线（N=400 53.65 µs）约 2–3× 属第三遍扫描 O(memberDocs 键数) 的设计内增量（SA6 §7 已预告），记录为观察项非缺陷。

## 7. Temporary Diagnostics

| 项 | 处置 |
|---|---|
| 添加项 | `packages/namespace-runtime/test/sa7-308-probe.ts`（观察者探针：38 项断言，统一 `[SA7-DATAFLOW]` 前缀，仅最小字段；只经公共入口读取，未改任何生产语义/控制流，未打印 secret/未 dump live 对象）；`sa7-308-debug.ts`（S8e 排障用的两轮 bisect 小脚本，同目录） |
| 删除项 | 两者均已删除（`rm` 后 `ls | grep sa7-308` 无匹配；工作树仅剩 Host 的 2 份未跟踪 wiki 简报） |
| post-removal 验证 | 删除后重跑关键场景：聚焦 6 文件 `--typecheck` → 6 files / 80 tests passed / Type Errors 无；namespace-runtime 投影 red+control → 2 files / 21 tests passed——与删除前逐项一致 |
| 残留检查 | `git diff HEAD` 对 tracked 文件为空；`grep -rn "SA7-DATAFLOW"` 于 `packages/ apps/ domains/ docs/` 零命中 |
| 备注 | 探针文件名不匹配 `*.test.ts`（同 `real-persistence-scheduler.ts` 惯例），存在期间也不会被 runner 收集 |

## 8. Dynamic Evidence Matrix

| Source | Requirement or risk | Driver | Expected | Actual | Evidence | Result | Suggested routing |
|---|---|---|---|---|---|---|---|
| SA6 §5/§12.2 | AC1：`<member N>` 逐字成员 doc（16 路径） | 探针 S2/S3 + 红契约 M1–M9（vitest） | docs 逐字 = 三源拼接/字面期望 | 全绿（0 违例） | `/tmp` 捕获输出 + vitest 80/80 | ✅ | — |
| SA6 §9.5/§12.2 M7 | 合并序 marker 前 member 后 | 探针 S3a JSON 逐字 | `[" 载体甲 "," 成员甲 "]` | 相同 | S3a | ✅ | — |
| SA6 §9.3 | 两腿选键独立（单腿实现蒙混必红） | 探针 S3e–S3g | 两腿均命中 | 均命中 | S3 | ✅ | — |
| SA6 §12.4 表 1/2（AC2/C1/C2/C3） | M4-free/剥离面逐字节不变 | 探针 S8a–S8d 独立复算（期望值转写自 SA6 文档，非被测 fixture） | 41 摘要逐路径相等 | 6+4+3+17 全等 | S8 | ✅ | — |
| SA6 §12.4 表 3（C8/F3.3） | 非 docs 部分不变 | 探针 S8e | 16 路径相等 | 相等 | S8e | ✅ | — |
| SA6 §12.5 C4/C5 | 空过滤/不泄漏 | 探针 S4 | 键缺席/零泄漏 | 保持 | S4 | ✅ | — |
| SA6 §12.5 C7 | 形状/确定性/可序列化 | 探针 S7 | 5 键/全等/往返全等 | 全部成立 | S7 | ✅ | — |
| SA4 §11 第 3 行 | 第三遍扫描规模增量 | 探针 S9（SA6 §7 同款曲线 N=100/400） | 近线性、亚毫秒 | 37.28→112.53 µs（比值 3.02≈键数线性） | S9 | ✅ | 例行观测（非本票阻塞） |
| SA4 §8/设计 D4 | 畸形 → InternalError 而非裸 TypeError；守卫次序 | 探针 S6 | InternalError×4 形；INVALID/NOT_FOUND 先结算 | 逐项成立 | S6 | ✅ | — |
| SA8 F3.1 | 必填清单不得加 memberDocs | 探针 S6d/S6e | 删必备键 loud；删 memberDocs ok | 保持 | S6 | ✅ | — |
| SA8 C6/设计 §8 路线③ | detached 克隆零改动承接新条目 | 探针 S10a–S10c（真实 runtime 全链） | 成员键流过 + 变异隔离 | 成立 | S10 | ✅ | — |
| Design D6/SA6 §15.1 | 深读不扩展（不冻结面） | 探针 S5a | 保持 `{}` 无成员键 | 保持 | S5 | ✅ | 记录性；未来需求另立票 |
| Design §10/AC3 | 验证门槛 | §9 命令表 | 全绿 | 全绿 | 命令退出码 | ✅ | — |
| 额外发现 | 无新 finding（本轮唯一 FAIL 为探针自身转写笔误，见 Deviations 1） | — | — | — | — | — | — |

## 9. Commands and Evidence

| 命令 | 结果 |
|---|---|
| `pnpm vitest run <设计 §10 ① 六文件> --typecheck` | **6 files / 80 tests passed；Type Errors no errors**（删除探针前后各跑一次，一致） |
| `npx tsc -p packages/vfsl/tsconfig.json` | exit 0 |
| `pnpm typecheck`（14 个 tsconfig 串行） | exit 0 |
| `pnpm vitest run packages/namespace-runtime/test/runtime-readdata-schema-projection-{red,control}.test.ts` | 2 files / 21 tests passed；Type Errors 无（存量保真测试复跑） |
| `NODE_OPTIONS="--conditions=nomicore-source" npx tsx packages/namespace-runtime/test/sa7-308-probe.ts`（已删除） | `[SA7-DATAFLOW] SUMMARY total=38 failed=0`（输出 60 行捕获存档于报告转述；探针经 `nomicore-source` 条件直连 `src/index.ts` 活源码） |
| `git status --short`（收尾） | 仅 `?? wiki/raw/task_issue-308.md`、`?? wiki/raw/task_issue-308_rebase_sa8_conflict.md`（Host 拥有，先于本轮存在） |
| `git diff HEAD -- . ':!wiki'`（收尾） | 空（tracked 文件零改动） |

## 10. Deviations

1. **探针 S8e 首轮 FAIL → 定位为探针自身转写笔误**：探针内一处 C8 期望常量把 SA6 §12.4 的 `…3315660dd…` 误抄为 `…331566e0dd…`（65 字符，非法 sha256 长度）。经独立复算（standalone 脚本 + python 逐字节对账 SA6 文档 41 个唯一摘要）确认：被测实现的 16 路径非 docs 摘要与 SA6 权威值逐字节一致、被测 fixture 常量与 SA6 一致；修正探针常量后全绿。该 FAIL 是验证器误差而非实现缺陷（顺带证实摘要对账具备判别力）。排障过程中的 `evaluate(parseVfsl(…))` 未解包 `.module` 报错同为探针侧笔误。
2. **计时数值波动**：S9 规模曲线两次运行 33.17/167.56 µs 与 37.28/112.53 µs（JIT/机器负载方差），均近线性、亚毫秒；结论不受影响。
3. **深读路径 `['u','x']`**：仅作保持性观察（SA6 §15.1 明确不冻结；设计 D6 显式保持现状），未设契约断言。

## 11. Verdict

**approve**。

- 设计声明改变的数据流（路线②三源切片 + 路线③新条目经零改动克隆流入 readData 载荷）按设计变化，关键中间跳点（事实源表、逐键三源拼接、合并次序、两腿选键、端到端载荷）均有运行时证据；
- 设计声明保持的路线（M4-free 逐字节 41 摘要、剥离惰性、非 docs 部分、空过滤、不泄漏、四件套形状、六键守卫、runtime 失败分支与 #273 面）全部保持，基线对账逐字节/逐路径成立；
- 状态/守卫次序、错误分类（InternalError 通道纯度）、close 清理与幂等、确定性均符合设计；禁止状态（伪成功、裸 TypeError、降级码、close 后读成功、跨调用状态）未出现；
- 临时诊断已删除，删除后关键场景复跑结果不变，工作树无残留；
- 无新增 finding；SA4 approve 基础上无独立 fail 发现。
