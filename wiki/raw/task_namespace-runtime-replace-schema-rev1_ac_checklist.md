# AC 门禁清单（round 2 修订轮）— issue #91 review 反馈 7 条逐条核验

核验人：总控（亲自逐条核对，证据全部实读/实跑）；时间：2026-08-24 23:40 前后
基线对照：round 1 交付态（commit 7770f2f）→ 本论工作树（未 commit 待收尾）

| # | 修订要求 | 状态 | 证据 | 处理 |
|---|---------|------|------|------|
| 1 | 删除 provided-root 路径的 `projectDeclaredRootKeys()` 静默投影 | ✅ | `grep -c 'projectDeclaredRootKeys' packages/doc-runtime/src/schema-replace.ts` = 0（函数本体 :318-337 与 :170 调用一并删除，imports 清理 plainObjectOf/recordSlotOf/makeRefResolver）；SA4 红线①全仓 grep 零残留（sa4_review.md 红线 1） | SA3 实现，SA4 核验 |
| 2 | 完整 ROOT 原样传给 validateLogicalSnapshot() 与 detached builder | ✅ | schema-replace.ts:168-171 `const snapshot = input.root.snapshot;`（无拷贝）→ `validateLogicalSnapshot(input.derived, snapshot)` → `buildTopEntries(input.derived, snapshot)`；⑥ verifySnapshotIntact(:126) 同吃 `ready.snapshot` 原样引用；SA4 红线②证实三消费者同一引用 | SA3 实现，SA2 D3 恒等性论证 + SA4 核验 |
| 3 | 未声明顶层键响亮失败：ok:false + 明确指向未知键的 issue | ✅ | vfsl validate.ts:577 封闭对象「未知字段 "<k>"：封闭对象不接受未声明键」path=[k] 天然覆盖顶层（path 起点 []，validate.ts:602）；R2-1 用例断言 `issues.find(i => i.path.length===1 && i.path[0]==='b')` 且 message 含 `"b"`；SA7 独立复跑 R2-1 绿、T2 对抗锚（环 derived×未声明键 b → ok:false + path=['b']）动态钉死 | SA6 锚定，SA7 动态实证 |
| 4 | 失败时 SCHEMA/ROOT/active tools 完全不变、不调 dirty notifier（0 Yjs update） | ✅ | R2-1 用例断言：`updates.count===0`、`notifierCalls===0`、`stateBytes(doc)` 逐字节不变、`getSchemaEnvelope().id==='ns-1'`、`getActiveSchema().id==='ns-1'`、`doc.getMap('ROOT')` 同一实例且键集恰 {a,n} 无 b、fatal 为 null 且 schemaWrite 仍 enabled；失败返回在 prepare 阶段（事务前），槽内 S5 ok:false 透传先于 installActive/notifyDirty（schema-write.ts:174） | SA6 锚定，SA4/SA7 复核 |
| 5 | 删除/修订静默剥离契约文档：CONTEXT.md、schema-write.ts JSDoc、其他设计材料 | ✅ | CONTEXT.md:17-19「顶层声明域投影」条目已更替为「原样封闭校验（provided-root as-is closed validation）」（_Avoid_ 行点名旧条目已废止）；schema-write.ts:76-80 JSDoc 改写为「未声明键一律响亮拒绝（顶层与嵌套同族）」新契约段；schema-replace.ts 注释面 8 处按设计 D5 表改写；`grep -rn '顶层声明域投影\|静默剥离' docs/ README.md TASK.md` 零命中（SA2 核验）；round 1 wiki 档案为历史记录不改写，由 rev1 档案 §0 取代声明显式废止（SA8 设计复审裁决「取代声明完备」） | SA3 实现，SA2/SA4/SA8 三方核验 |
| 6 | 修订测试：顶层未知键 → ok:false、issue 指向键、0 update、0 notifier、三不变 | ✅ | runtime-replace-schema-sa7-dynamic.test.ts:439-482 R2-1 用例（原「A2-顶层剥离」翻转）逐断言覆盖；describe/头部注释同步修订；相关用例 = runtime-replace-schema-sequencer.test.ts:672-697 快照时点用例（root 去 b，「槽起点快照获胜」断言未削弱——SA7 回归确认 ok:true + notifier 1 + n=999 + ns-2b）；嵌套 loud / union loud / 幸福路径保持项零改动 | SA6 锚定，SA7 动态回归 |
| 7 | 保留既有正确行为，全量门禁绿（基线 84 files / 1078 tests） | ✅ | 总控亲跑：`pnpm test` → Test Files 84 passed (84) / Tests 1078 passed (1078) / Type Errors no errors / exit 0（.mabf-bg/verify-p3-r2.log）；SA7 独立复跑三门禁全绿：gate1 pnpm typecheck exit 0、gate2 pnpm test 84/1078 exit 0、gate3 tsc -p tsconfig.typecheck.json --noEmit exit 0；保持项回归（γ/A2-union/A2-嵌套/AC3/⑥/α/β/A1/AC9/persistence 2/2）全绿；设计 §4 零回归清单 14 项 SA2 逐条核对无漏项 | 总控亲跑 + SA7 独立复跑 |

## 结论

7/7 ✅ 全部满足，无 ❌ 条目。评审双清（SA4 pass + SA7 pass）+ SA8 双门禁 clear 已在此前完成。
