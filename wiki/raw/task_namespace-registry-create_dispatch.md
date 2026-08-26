# task_namespace-registry-create dispatch log

issue #111（round 1）· branch fix/issue-111-on-docs-namespace-registry · base cdcf28b（origin/docs/namespace-registry）
run_id: issue-111-1787716046-810703

基线（总控亲跑，后台独立进程）：`pnpm test` 106 files / 1274 passed（exit 0）；`pnpm typecheck` 九包 tsc exit 0。

| time | SA | 任务 | 产出 |
|---|---|---|---|
| 11:57 | SA1 | 冻结设计（ADR-0009 §Create + #110 基座 + DQ-1..DQ-9 显式裁决） | wiki/raw/task_namespace-registry-create_design.md ✅（368 行；DQ-1 最小 identity 接纳+槽内 payload 快照、DQ-2 doc-runtime 自持 createInitialDocument、DQ-3 Clock 必需、DQ-4 sanitized issues[存疑待裁]、DQ-5/6/7 映射表、DQ-8 observer/testing 扩展、DQ-9 测试矩阵） |
| 12:05 | 总控 | 设计预审取证 | vfsl validate/buildTopEntries issue message 实测会内嵌 Record 键/字段名/schema 正则；既有 lease 写路径（mutateRoot/replaceSchema）对同类 issues 逐字透传（MutateRootResult.issues: unknown[]）——DQ-4 sanitized projection 与既有公共面契约不一致，移交 SA2 攻击 |
| 12:06 | SA2 | 设计对抗评审（11 攻击面 + DQ-4/DQ-6 点名裁决） | design_conflict_report.md ✅ REJECT（3H/6M/2m+3 新面）：H1 DQ-4 半 sanitize 两头不占→总控裁决 verbatim 透传；H2 DQ-6 一律 true 谎报→总控裁决 false（重试自愈不对称性）；H3 敌意输入措辞不可实现→采纳精确化措辞 |
| 12:12 | 总控 | 独立性核验 | DQ-7 恢复路径亲核 persistence lifecycle.ts:110-114/334-360/511-516：release 同步摘挂+loadDoc 双路恢复成立；fatal 词表 fatal.ts:12-15 三相确认 |
| 12:12 | SA1 | R1 闭合轮（总控双裁决 + 9 项处置指引） | ✅ 14 项全闭合（设计增至 ~400 行；verbatim/committed:false/Proxy 诚实措辞/clock caller 全量表/测试矩阵补齐）；补充裁决（XML 值摘录→内嵌 issues 零负锁）已并入 |
| 12:20 | SA2 | R2 验证轮（逐条核验 R1 闭合 + 独立再攻击） | R2 REJECT：R1 十四项全闭合；新 HIGH R2-H1（createInitialDocument 公共 union 无 input-invalid 分支，与「envelope/meta 领域失败返回 result」自相矛盾）+ 残留 R2-M1（closing+undefined closePromise 静默放行） |
| 12:26 | SA1 | R2 闭合轮（总控裁决：seam union 扩三类 + input-invalid 于 Registry 路径不可达即 fatal；closing 无 promise fail-loud） | ✅ 闭合（§5/§6/§7/§9/§11 同步；open closing 残留登记 #112） |
| 12:32 | SA2 | R3 验证轮 | ✅ **PASS**（设计冻结；38862B；#112 closing 状态机为登记残留风险） |
| 12:35 | SA6 | 红灯锚定（7 测试文件：create 主矩阵 + seam 直调 + 迁移） | ✅ 56 红全断言失败/意外绿 0/迁移 354 绿；sa6_red.md（含 SA3 七点指引）；总控复跑红门一致（exit 1，56 failed/354 passed） |
| 13:05 | SA3 | TDD 实现（registry create 全链 + doc-runtime createInitialDocument + Clock 必需化） | 51/56 转绿、354 既有全保持；5 灯登记为测试自相矛盾；impl 档案 sa3_impl.md |
| 13:35 | 总控 | 逐项亲核 5 争议灯 + 3 偏离 | 5 灯全部确认测试侧缺陷（①fixture `??` 吞 null ②sentinel 应取 .cause.cause ③persisted 段与 entry 保留引脚互斥 ④⑤恒丢工厂使恢复断言不可达）→ SA6 修测试；偏离裁决：D1 恢复 typed create(CreateNamespaceInput)（open 测试 as never 先例）；D2 驳回镜像 comparator，复用共享 verifySnapshotIntact + SA6 改 per-doc afterTransaction 锚（scratch 重放不污染 target 计数）；D3 授权 pnpm install 刷新锁文件（package.json 依赖变更的必需伴随物，CI frozen-lockfile 需要） |
| 13:45 | SA6 | R-fix 测试修订（5 缺陷灯 + typed 签名配套 + per-doc probe） | ✅ 410/410 + 全仓 1329/1329 全绿、tsc 零错误；sa6_red.md 追加 R-fix 节 |
| 14:00 | SA3 | 修订轮 R1（typed 签名恢复 + verifySnapshotIntact 共享复用[-190 行镜像] + 锁文件收口） | ✅ 410/410、全仓 1329/1329、typecheck/聚合 tsc/frozen-lockfile 全 exit 0；偏离登记全闭合 |
| 14:10 | SA4 | 静态实现评审（设计逐行对照 + 敌意源码审查） | changes-required（1H/1M/2m）：H1 closing await 后仍 closing 静默放行→裁决 fail-closed+reject 同形+对照绿锚；M2 clonePlainData 数组漏四查→裁决对齐 write.ts copyFrozen；CI 缺口指控总控亲核驳回（ci.yml pnpm test 全量+Node20/24 矩阵已覆盖；显式存在性门禁为三个历史关键文件惯例）→登记残留风险；sa4_review.md |
| 14:20 | 总控 | SA4 裁决与分流 | SA6 锚 H1 三变体+M2 四变体红灯；SA1 设计补遗（testEntries §8/§12 收口、closing §5 精确化、CI §11 残留）；MINOR-3 仅注释、MINOR-4 保留+文档化 |
| 14:20 | SA1 | 设计补遗轮 | ✅ §8 testEntries 冻结、§5/§7/§9 closing 三态 fail-closed、§11 CI 说明、文末 SA4 落点节 |
| 14:20 | SA6 | 红灯追加轮（H1 三变体 + M2 四变体） | ✅ 4 新灯全红（变体 C 驱动 testEntries 种子函数形态扩展）；410 既有全绿；R-fix2 节落盘 |
| 14:25 | SA3 | 修订轮 R2（closing 三态 fail-closed + testEntries 函数形态 + clonePlainData 四查 + 双层签名注释） | ✅ 414/414 + 全仓 1333/1333 + typecheck/聚合 tsc 全 exit 0；4 新灯转绿零回归 |
| 14:35 | SA4 | 复审轮（H1/M2/Minor 闭合核验 + 补丁再攻击） | ✅ **pass**（四项全闭合；新灯强度核验通过） |
| 14:40 | SA7 | 动态攻击验证（mutation 抽查/压力/敌意注入/Node 20） | fail-needs-fix 3 项上报（仅跑完部分攻击面） |
| 14:55 | 总控 | SA7 三发现逐项裁决 | ①②declaration-emit 超时=SA7 自身并行变异/docker/基线的 CPU 争抢（总控无负载复跑 414/414 exit 0 实证）→ 仍裁决加固：SA6 给 emit 用例显式 testTimeout 30s（断言不变，非弱化）；③carrier 1/0=误读 #110 §5 冻结语义（成功 create 后 entry 存留→carrier 设计性共存，成对断言只适用 entry-less key）→驳回为假阳性，probe 语义修正 |
| 15:00 | SA6 | emit 用例 timeout 加固轮 | ✅ 4 用例（registry-surface×3 + doc-runtime-surface×1）加 `{timeout:30000}`，断言零改动；414/414 exit 0 |
| 15:05 | SA7 | 续跑轮（5 变异串行 + 真实 persistence fault seam + 零泄漏 + 时序补全 + 压力修正语义 + Node 20 复跑 + 自由攻击） | 进行中 |
| 15:20 | SA7-r2 | 续跑轮（新会话 57a313f8） | 5/5 变异击红、真实 Memory fault 映射/duplicate/恢复 pass、零泄漏 pass、时序 pass、Node20 docker exit 0（412 pass/2 skip 为 #110 既有条件跳过）；报 1 found-issue（createDoc=151） |
| 15:35 | 总控 | SA7-r2 found-issue 复核 | 亲写探针双场景实测：A（首 create 成功）createCalls=1/loadCalls=0 完全吻合设计；C（persisted-never-opened）createCalls=150 零 entry 属设计内——裁决**假阳性**（探针 stub 未让 entry 登记）；SA7 合并结论 **pass**；裁决节追加进 sa7_report.md |
| 15:40 | 总控 | AC 门禁核对 | ac_checklist.md 落盘：12/12 ✅ |

## 续跑 dispatch（第二次受控恢复，总控续跑 2026-08-26 16:4x）

- SA3 修订轮派发（subagent_sa3 d5624f15）：D1 getter 零执行锚闭合（identity.ts acceptCreateIdentity descriptor-only）+ Standards BLOCKER-1 version bump 0.1.1→0.1.2 + ADVISORY-1 Entry 头注 / ADVISORY-2 assertClockShape 去 export / ADVISORY-3 identity 头注 provenance / ADVISORY-4 残留 node-dispose 双空行。最小改动，冻结阶段结论不动。
- SA4 Standards 闭合轮复审派发（subagent_sa4 4feaf0a7）：只读核对 5 处修订落地、BLOCKER-1 闭合、无新增 HIGH/MEDIUM；结论追加进 standards_review.md。
- 总控亲跑最终全量验证启动：.mabf-bg/final-test.log（npx vitest run --typecheck 全仓，后台独立进程；完成后串行跑 pnpm typecheck）。
