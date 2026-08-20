# AC 逐条确认清单 — Issue #26 / F2 投影生成器 @nomicore/vfsl-codegen

> Phase 3.5 AC 门禁（2026-08-21 立法）。AC 来源：issue #26 body「Acceptance criteria」
> （任务简报 wiki/raw/task_vfsl-codegen.md 逐字收录）。核对时点：SA3 R2 返修（9cd33d2）
> 总控亲验全绿 + SA4 verdict: pass 之后，SA7 动态验证并行收尾。

| AC# | 描述 | 状态 | 证据 | 处理 |
|---|---|---|---|---|
| AC1 | 映射表逐行有发射断言（含 `YPlainArray` 终态、联合 `T \| undefined` 宽度） | ✅ | `packages/vfsl-codegen/test/generate-mapping-table.test.ts`：映射表逐行断言（YMap→'map'/YLeaf→'leaf'/YXmlFragment→'xml-fragment'/裸数组与 YArray→`Record<\`${number}\`,…>`/'array'/**YPlainArray→`PathSchema<V[],'plain'>` 终态**（正例 L113 + 负例 L115 R3 修订）/Record<Pattern 键>→Record<string,…>/ref→别名引用 byId 双正则）+ R2 修订 L102/L107/L133 数组载体正则 + R4 增补 leafRef/metaRef 钉死规则 0 + R5/E optional 剥壳四断言；**联合 `T \| undefined` 宽度** = `generate-discriminated-narrow.test-d.ts` 以 `read` 投影断言成员独有字段为 `T \| undefined`（D2，§7 接线后真编译绿）；总控亲验 408/408 全绿（.mabf-bg/orch-r2-accept-test.log） | 无 |
| AC2 | docs 出现在生成的 TSDoc 上（依赖 #20/#29 派生 schema 携带 docs） | ✅ | mapping 测试 aliasDocs×3 断言（`根文档说明`/`实体的判别联合`/`Id：Pattern 键约束` 原文在场）+ TSDoc 配平断言（opens ≤ closes）；设计 §3.7 walkDocs 文法镜像经 SA2 V6 逐行核对成立；SA4 §3 算法对齐抽查通过 | 无 |
| AC3 | 判别式联合发射为可窄化的 TS 判别联合 | ✅ | 文案级 = `generate-discriminated-emission.test.ts` 9 断言（`['"]kind['"]` 精确字面量判别字段、成员互异、联合形状）；**编译级** = `generate-discriminated-narrow.test-d.ts` 6 tests（expectTypeOf 窄化断言——§7 接线（根 tsconfig.typecheck.json + vitest typecheck 重指）后从空转绿变为真编译，SA2 V4 端到端实证 6/6 真绿 + 既有 test-d 零回归；总控亲验 Type Errors no errors） | 无 |
| AC4 | `generate --check` 对过期生成物退出非零；CI 接入 | ✅ | `generate-cli-check.test.ts` 三断言（generate 退 0 / --check 新鲜退 0 / 过期退非零，hermetic fixture）；CI = `.github/workflows/ci.yml` regen-diff 步骤 `pnpm generate --check --allow-empty-domains`（全量重生成 + 逐字节 diff，源漂移/生成器漂移双抓；TODO(#27) 注记 G 落地移除 flag）；总控亲验 `pnpm generate --check --allow-empty-domains` exit 0（.mabf-bg/orch-r2-accept-gen.log）；SA4 基线复跑一致 | 无 |
| AC5 | 零运行时依赖纪律不适用于本包但依赖最小化 | ✅ | 设计 §8：新包运行时依赖仅 `@nomicore/vfsl: workspace:*`（CLI 必需），发射器仅用 node 内建（node:crypto）——**零第三方运行时依赖**；全仓实质新增一直接依赖 = tsx（根 devDep，重依赖 esbuild 已在树内）；devDeps = vfsl-protocol workspace 链 + @types/node ^20（SA2 #5）+ typescript/vitest 兄弟包同版；既有包 vfsl 0.1.8 / vfsl-protocol 0.1.0 零改动零 bump（SA4 核对④ git diff 0 行）；SA4 核对⑤ ALLOW/DENY 干净 | 无 |

## 结论

五条 AC 全部 ✅，证据链完整（红灯契约断言 → 总控亲验日志 → SA4/SA7 复核）。无 ❌ 条目，
无追加 SA 派发。**SA7 verdict: pass 已落地**（wiki/raw/task_vfsl-codegen_sa7_report.md）；
SA7 新发现 N1/N2/N3 与 EACCES 归并经总控裁决为 G 票前移风险、不违 F2 AC，已开
**#45** 登记（协议层扩展限界交接 = **#44**）。本清单随分支一并 commit，进入第四阶段收尾。
