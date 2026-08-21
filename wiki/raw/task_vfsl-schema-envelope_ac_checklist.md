# AC 逐条确认门禁 — task_vfsl-schema-envelope（Issue #52 / H1 parseSchemaEnvelope）

> 阶段：Phase 3.5（写 .mabf-done 前）。AC 来源：任务简报 wiki/raw/task_vfsl-schema-envelope.md（= Issue #52 body）。
> 验证基线：commits cb7a2c7（实现）+ 14f56f0（F1 修复）；总控亲跑 `pnpm typecheck && pnpm test` 两轮 exit 0（.mabf-bg/verify-sa3.log、verify-sa3-r2.log），全量 31 文件 / 465 用例全绿；SA4 R2 verdict pass；SA7 verdict pass。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 接缝形状：同步、纯函数、不抛错（与既有接缝同款纪律） | ✅ | SA6 用例 AC1 组（packages/vfsl/test/parse-schema-envelope.test.ts）：返回值非 Promise、任意非信封输入（undefined/null/42/string/true/[]/{}/函数）→ 结构化拒绝不抛错；SA4 R1 发现 F1（对抗 thrown 值二次抛出逃逸）→ SA3 修复（crashDetail 守卫）+ SA6 第 13 条回归锚（getter/Proxy 三向量）→ SA4 R2 穷尽 13 向量实跑全过；SA7 复跑 13/13 绿 | SA4 R1 reject → SA6 红灯锚 + SA3 修复 → SA4 R2 pass 闭环 |
| AC2 | 信封形状负例：缺键 / 多键不拒 / 类型错误 → 结构化拒绝 | ✅ | SA6 用例 AC2 组：缺键 ×4 + 空对象、类型错误（version:'1'/text:42/lang:1/id:42）→ ENV-2/ENV-3 结构化拒绝；多键（+extra/flag）→ ok:true 恰四键原值透传。13/13 绿 | 无追加 |
| AC3 | 方言断言：{lang:'vfsl',version:2} / {lang:'other'} → 拒绝且错误身份可区分为「未知方言（只读）」 | ✅ | SA6 用例 AC3 组：两向量拒绝 + 消息指向方言层（/方言\|dialect/i）+ 顺序锚（同一非法文本+未知方言 → 方言错误先于文本错误）；实现复用 assertVfslDialect 单点转译 ENV-4（SA4 R2 核验）；SA2 R1→R2 加固：动态值 sanitizer 防伪造行级 VFSL-E 前缀 | SA2 R1 reject（MINOR #1 转义）→ SA1 R2 → SA2 R2 pass 闭环 |
| AC4 | 合法信封透传：parseVfsl 的 ok/issues 原样返回（含行列） | ✅ | SA6 用例 AC4 组：module/issues 与直调 parseVfsl(text) 全等（引用直通），fixture BAD_TEXT 显式断言 VFSL-E100 @ line 3, column 7；SA7 超长 text（4.71 MB / 60,001 行）透传保真全等 + 零内存放大（retained heap 增量 −0.03 MB） | 无追加 |
| AC5 | id 任意字符串（含空串、撞名场景）不影响判定 | ✅ | SA6 用例 AC5 组：空串 / 特殊字符（`a/b\c..中文 🎉`）/ 同 id 撞名两信封 → 判定不受影响、各自按自己文本解析。13/13 绿 | 无追加 |
| AC6 | 错误码/消息不与 parseVfsl 的 VFSL-E 码空间混淆 | ✅ | SA6 用例 AC6 组：信封/方言拒绝每条 issue `not.toMatch(/^VFSL-E\d+:/)`，对照文本错误透传保留 VFSL-E 前缀；实现双正交判别器：`VFSL-ENV-E<码>:` 独立前缀 + 坐标哨兵 line:0/column:0（文本层恒 ≥1，SA2/SA4 四路亲证不变式） | 无追加 |

**结论：6/6 全 ✅，无 ❌ 条目，无追加派发，进入 Phase 4 收尾。**
