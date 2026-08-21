# AC 逐条确认门禁 — task_vfsl-domains-assets-dogfood（issue #27）

门禁时间：2026-08-21 07:00 · 总控逐条核对 · 评审双清（SA4 pass + SA7 pass）之后、Phase 4 之前

| AC# | 描述 | 状态 | 证据 | 处理 |
|-----|------|------|------|------|
| AC1 | 包结构符合 ADR 0005 §5（schema.vfsl + generated.ts + index.ts + test/ + package.json 纯类型） | ✅ | 五件齐备：domains/vfs3-assets/{schema.vfsl, generated.ts, index.ts, package.json, test/×3}；package.json 纯类型（无 dependencies、exports→./index.ts，SA6 空模块断言 `Object.keys(await import(pkg))=[]` 绿）；SA4 review §1 设计一致性 pass；SA7 Step1 复跑绿 | SA3 实现（commit 7c49901），SA4/SA7 双验 |
| AC2 | §8.4 正负例在真实 fixture 类型表上全过（expectTypeOf / @ts-expect-error） | ✅ | domains/vfs3-assets/test/vfs3-assets-projection.test-d.ts 19 tests 全绿（真实生成物增广的 VfslPathMap 上；Record 键空间/判别联合三成员/D2 宽度/裸 T[]=array vs YPlainArray=plain/xml 终态/序列编辑三件套）；SA7 Step1：`vitest run domains/vfs3-assets --typecheck` exit 0；总控亲验全量 452/452 | SA6 锚定 → SA3 转绿（前置：vfsl-protocol 可选成员坍缩修复，SA1 D2 选型 A，SA8/SA2 裁决 no-conflict/pass） |
| AC3 | 迁移演示：模拟字段重命名后旧路径全部编译错误（每行一个 @ts-expect-error） | ✅ | domains/vfs3-assets/test/vfs3-assets-migration.test-d.ts 6 tests 全绿：file 成员 name→label 模拟迁移，旧路径清单每行一个 @ts-expect-error + 精确 `UnknownPath<['name']>` 等价锚 + 对照组/新路径正例 | SA6 锚定 → SA3 转绿 |
| AC4 | CI regen-diff 覆盖本包（含移除 F2 阶段门 --allow-empty-domains——零领域重新成为响亮失败） | ✅ | ci.yml regen-diff 步骤 run=`pnpm generate --check`（SA7 grep flag 计数=0，TODO(#27) 两处注记已清，cli.ts flag 本体保留为本地逃生门）；总控亲验 generate --check exit 0；SA7 反向探针：移空 domains/ → exit 2「零领域集」响亮失败，还原复绿；破坏性 1 字节漂移探针（源/生成物）均被 exit 1 抓住 | SA3 实现；SA7 动态兑现。远端 CI run 触发摘录由发布后 CI 到绿流程兜底（runner 职责） |
| AC5 | docs 三锚位 TSDoc 断言：生成物中别名/字段/标记位的 fixture JSDoc 全部出现在 TSDoc 注释上 | ✅（标记臂 vacuous，缺口已路由 follow-up） | domains/vfs3-assets/test/vfs3-assets-tsdoc.test.ts 6 tests 全绿：别名臂 AST 挂载断言 + ≥5 防空转守门、字段臂 AST + ≥1 守门；标记臂 fixture 驱动空转 + 守门链在场（§10 fixture 无标记位 JSDoc，SA8 裁决 no-conflict 数据属性）；SA2 MEDIUM#1 emitter 侧缺口 → 规格轴 follow-up 已登记（PR #46 comment-5362799602：§10 fixture 补标记位 JSDoc + 同步 #32/#21 副本 + 标记臂升级位置感知断言） | SA6 锚定 → SA3 转绿；SA2 放行条件（总控登记 follow-up）已闭环 |

结论：5/5 全 ✅（AC5 标记臂按设计 D3(a) vacuous + 守门 + follow-up 登记，SA2 verdict=pass 的放行条件已兑现）。无 ❌ 条目，无需补派 SA。进入 Phase 4 收尾。
