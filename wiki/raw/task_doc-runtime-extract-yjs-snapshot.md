# 任务简报 — 建立 @nomicore/doc-runtime 并提取验证 Yjs ROOT

- Issue: #73 (welltop-jim-wang/nomicore)
- run_id: issue-73-1787369064-158976
- branch: fix/issue-73-on-docs-doc-runtime-validation
- base: docs/doc-runtime-validation
- Task Type: feature（功能开发）

## Parent

PR #70（docs/doc-runtime-validation）

## What to build

建立独立的 `@nomicore/doc-runtime` workspace 包，并实现 `extractYjsSnapshot(derived, doc)`：只读取固定 ROOT，严格区分 Y.Map/Y.Array/Y.XmlFragment/plain 载体，首个结构错误即停止；成功返回普通 logical ROOT snapshot。SCHEMA 与 META 不在本能力范围。

## Acceptance criteria

- [ ] 新包依赖 `@nomicore/vfsl + yjs`；VFSL 不新增 yjs 依赖，Persistence 不新增 VFSL/doc-runtime 依赖
- [ ] ROOT 结构遍历覆盖 root/map/array/xml/leaf/plain/union/ref，Yjs 与 plain 载体错位响亮失败
- [ ] fail-fast 单 issue 携带精确 string/number path、expected 与 actual，错误节点不继续下钻
- [ ] 成功快照与 live doc 解耦；XML 保证语义等价而非逐字 round-trip
- [ ] 新 workspace 被根 typecheck 与 CI Node 20/24 显式覆盖
- [ ] 行为测试覆盖结构错位、Record、union/ref、plain 与 XML

## Blocked by

Blocked by: #71（已合入：f07462d refactor(vfsl)!: rename validateSnapshot to validateLogicalSnapshot (ADR-0007, #71) (#78)）

## Working Directory

/home/wangjian/nomicore-fix-issue-73

---

# SA6 Phase 1 验收测试锚定记录（2026-08-22）

## 产出

- 测试文件：`packages/doc-runtime/test/extract-yjs-snapshot.test.ts`（21 条用例，10 组）
- 脚手架（供测试可解析运行的包清单，SA3 可按实现需要调整）：`packages/doc-runtime/package.json`
  （deps: `@nomicore/vfsl: workspace:*` + `yjs: ^13.6.30`；devDeps: @types/node/typescript/vitest；
  `exports["."] = "./src/index.ts"`，与仓内其他包同款）+ `pnpm-lock.yaml` 已更新（新增 importer）
- 未触碰任何 `src/` 业务代码；`packages/doc-runtime/src/` 不存在（SA3 交付物）

## 冻结契约（SA3 实现的行为锚点；SA1 设计不得收窄，仅可补充）

- 接缝：`extractYjsSnapshot(derived: DerivedSchema, doc: Y.Doc)` 经 `../src/index.js` 公共入口导出
- 结果联合（沿仓内 `{ ok, issues }` 惯例，ADR-0007「领域化结果联合」）：
  `{ ok: true; snapshot: unknown } | { ok: false; issues: ExtractIssue[] }`；fail-fast = `issues.length === 1`
- `ExtractIssue = { message: string; path: Array<string | number>; expected: string; actual: string }`
  - path：精确 string/number 段数组（map/object/Record 用 string，Y.Array 用 number；`[]` = ROOT 自身）
  - expected/actual 词汇表（冻结）：`'Y.Map' / 'Y.Array' / 'Y.XmlFragment' / 'Y.Text' / 'plain value'`
    ——root/map → 'Y.Map'，array → 'Y.Array'，xml-fragment → 'Y.XmlFragment'，leaf/plain → 'plain value'
  - message 仅要求非空字符串（措辞 SA1 自由）
- 不外抛纪律：yjs 对异型 ROOT 的 `getMap('ROOT')` 原生 throw（"already been defined with a
  different constructor"）必须收敛为 `{ ok:false, issues:[...] }`（T1/T2 锚定，path []）
- 缺失字段不报结构错（缺 optional → snapshot 省略该键；ROOT 缺失按空 map）——缺失/未知键属
  validateLogicalSnapshot 逻辑域（ADR-0007「ROOT 载体提取和逻辑校验」两步分离）
- XML 快照值为 XML 字符串；语义等价锚=归一化（折叠标签间空白）后结构与文本内容一致，
  不承诺逐字 round-trip（AC4）

## 覆盖映射（简报 AC1–AC6）

| 组 | 用例 | 锚定 AC |
|---|---|---|
| 幸福路径 | 全 fixture（spec §10 vfs3.assets）正确 doc → ok:true，snapshot 深等 + JSON 往返无损（普通逻辑快照） | AC「成功返回普通 logical ROOT snapshot」 |
| 解耦 | 提取后突变 live doc（map 覆写/嵌套 map/Y.Array/Y.XmlFragment/plain 值）→ snapshot 不变 | AC4 解耦 |
| root | ROOT 为 Y.Array / Y.XmlFragment → 单 issue path []，expected Y.Map，不外抛 | AC2 root |
| map + fail-fast | 首字段错位→单 issue 只锚首错位字段；错位节点不继续下钻（a 为 Y.Array 内含垃圾→只锚 ['a']） | AC2 map / AC3 |
| array | 元素 Y.Map → 锚 ['tags',1]（number 下标段）；array 节点放 plain 数组 → expected Y.Array/actual plain value（错位方向一） | AC2 array / AC3 路径 |
| plain | plain 节点放 Y.Array → expected plain value/actual Y.Array（错位方向二）；plain 节点放 plain 数组 → ok | AC2 plain / AC6 plain |
| leaf | leaf 位放 Y.Text / Y.Map → 锚 ['profile','name'] | AC2 leaf |
| Record | Record 多动态键正确提取；Record 值放 plain 对象 → 锚 ['assets','img1'] | AC6 Record |
| union/ref | 判别联合三成员（image/text/file）各自提取；成员内字段错位 → 锚 ['assets','img1','url']（Record+union+ref 链路）；ref 目标（Audit）载体错位 → 锚 ['assets','img1','audit'] | AC6 union/ref |
| XML | 正确 Y.XmlFragment → XML 字符串 + 归一化语义等价；xml 位放 plain 字符串 → 锚 ['assets','doc1','body'] | AC2 xml / AC4 / AC6 XML |
| SCHEMA/META | SCHEMA=Y.Array 垃圾 + META=数字垃圾 + ROOT 正确 → 仍 ok；全 optional ROOT + 空 doc → ok snapshot {} | AC「只读取固定 ROOT」 |

## 红灯证据（必须真实）

- 构造性红灯（终态）：`pnpm exec vitest run packages/doc-runtime/test/extract-yjs-snapshot.test.ts --passWithNoTests=false`
  → `Error: Cannot find module '../src/index.js'`（Failed Suites 1，Tests no tests，EXIT=1）——
  新包公共接缝不存在，同 parse-schema-envelope.test.ts / schemasource-seam.test.ts 先例；
- 行为级红证明（临时 throw-stub，验证后已删除，无残留）：stub 下 21/21 用例全部执行并失败
  （Error: SA6 stub: extractYjsSnapshot 未实现）——证明测试文件可收集、可执行、每条断言真实
  失败（非假红/非空转）；stub 已删除，终态恢复构造性红灯。

## 对下游 SA 的提示

- SA1：issue 字段名（issues/path/expected/actual/message）与 expected/actual 词汇表已冻结，
  设计如需偏离必须显式说明并由 SA4 复核；`message` 措辞自由。
- SA3：实现需处理 yjs 异型 ROOT 的 getMap 原生 throw（收敛为 fail-fast issue）；success 分支
  snapshot 必须是普通 JSON（无 Yjs 对象泄漏）；`derived.aliases` 需按 ref 解析（Audit 用例）。
- 依赖边界（AC1）：doc-runtime 依赖 vfsl+yjs（package.json 已就位）；不得反向给 vfsl 加 yjs、
  不得给 persistence 加 doc-runtime 依赖。
- CI/typecheck 覆盖（AC5）：根 `pnpm typecheck` 需新增 `tsc -p packages/doc-runtime/tsconfig.json`
  （tsconfig.json 属 SA3 交付物；CI workflow 无需改动——node 20/24 matrix 已存在，新包随
  `pnpm test` include 模式自动入测）。

---

## SA6 复核增补（2026-08-22 第二趟，终态收口）

- **修正（与上文契约对齐）**：幸福路径/解耦/union 三处 `expect(snapshot).toEqual(EXPECTED_SNAPSHOT)`
  原按逐字比较（含 XML body），与 AC4「XML 只承诺语义等价」自相矛盾——已改为
  `withNormalizedXml(snapshot)` 归一化后比较（折叠标签间空白；新增 helper 位于
  `normalizeXml` 之后）。XML 专项用例不变（`normalizeXml(body) === '<p>Hello <b>world</b></p>'`）。
- **可实现性 dry-run（一次性，已删除，无残留）**：独立文件以忠实实现桩（含判别式 union 选择、
  ref 经 aliases 解析、Record `<key>` 下钻、ROOT 异型 throw 收敛、missing-ROOT 按空 map）
  驱动同一断言集 → **21/21 通过**（vitest 3.2.7，11:42:17，EXIT=0）——证明 fixture 与断言
  内部一致、契约可实现；红灯唯一成因为 `../src/index.js` 缺失。
- **终态红灯复跑**（2026-08-22 11:43:18，vitest 3.2.7 / Node 24）：
  `pnpm exec vitest run packages/doc-runtime/test/extract-yjs-snapshot.test.ts` →
  `Error: Cannot find module '../src/index.js'`，Failed Suites 1 / Tests no tests / EXIT=1。
- 终态文件清单：`packages/doc-runtime/test/extract-yjs-snapshot.test.ts`（21 用例）+
  `packages/doc-runtime/package.json`（骨架）；`test/` 下无任何 scratch/桩残留。

---

# SA6 Phase 1 补充红灯测试记录（R2 增补，2026-08-22 12:5x）

落位依据：SA2 R2 评审 verdict: pass 的「残留处置建议②」（R2 修复行为面零锚定）→ 总控
按设计 §11 ALLOW LIST 增补流程派发（dispatch 第 13 行）。行为语义以 R2 设计
§4.1/§4.5/§4.6/§4.8 + D9② 为准（含 SA2 R2 复审 R-2 改判：function/symbol 直接位 set
期即抛不可达、plain 子树内嵌可达 → 真 issue，总控增补指令明示采纳）。

## 产出文件（新增两份，ALLOW 名单命名）

1. `packages/doc-runtime/test/extract-union-trial.test.ts` — **8 用例**，union 试验语义行为面（SA2 红线 1/4）
2. `packages/doc-runtime/test/extract-plain-domain.test.ts` — **9 用例**，plain 值域违规行为面（SA2 红线 2/3/5）

未改动冻结文件 `extract-yjs-snapshot.test.ts` 的任何既有断言（其现行版本 = 分裂脑收敛后
终态，含 withNormalizedXml 归一化比较，dispatch 第 4 行已记）；未创建 `src/`。

## 覆盖映射（SA2 红线 1–5 逐条对应）

| 文件 | 用例 | 锚定 |
|---|---|---|
| union-trial | Record 形成员接受：`Record<string,YLeaf<string>> \| { b: YArray<...> }` + live `{x:'hello', b:'plainstring'}` → ok:true `{x:'hello', b:'plainstring'}` | 红线 1 主锚（any-of 兑现；R1 字面实现得 ok:false 的红灯） |
| union-trial | 成员选择序 ×2：Record 在前 → Record 视角胜（k 保留）；对象在前 → 对象视角胜（k 跳过） | 红线 1b 仲裁锚（声明序前者胜，INV-8） |
| union-trial | any-of 载体分流：Record 拒（b 为 Y.Array 落 leaf 位）、对象成员接受 → ok:true `{b:['a']}` | 红线 1 邻近面 |
| union-trial | 跨成员 fail-fast：x=bigint → 报声明序首真 issue `['x']` 'bigint' | 红线 1×2 交叉 |
| union-trial | 前置判定 ×3：u=plain 数组 → `['u']` Y.Map/plain value 非 internal；u=plain string 全可选成员不裸接受；u=Y.Array 正确载体 → ok:true | 红线 4 主锚（TypeError→E100 回归守卫） |
| plain-domain | bigint ×3：leaf 直存 / 跨端 encode→applyUpdate（E1）/ plain 数组内嵌 → `actual:'bigint'` 非 internal | 红线 2（含协作可达性） |
| plain-domain | undefined：plain 数组内元素 → `actual:'undefined'` loud（禁 JSON null 化） | 红线 3 对照（D1） |
| plain-domain | Date（类实例代表）：leaf 位 → `actual:'non-plain object'` 非 internal（禁静默投影 {}） | 红线 3 主锚（C1 原型守卫） |
| plain-domain | function / symbol：plain 数组内嵌 → `actual:'function'/'symbol'` | R-2 改判（N1/N3 路由） |
| plain-domain | Y 类型内嵌 plain 子树：`[new Y.Map()]` → `actual:'Y.Map'` | §4.6 nested 再分类（P22） |
| plain-domain | 正向对照：合法 JSON 值 → ok:true + JSON 往返（plain 域不误伤） | 防御过约束 |

全部失败断言经统一 helper：fail-fast 单 issue + **四字段形状完整**（message 非空 /
path 精确 / expected / actual，红线 5 防省略字段违约）+ `expected/actual !== 'internal'`
（E100 误分类回归守卫）。

## 红灯证据（必须真实，实测）

- 构造性红灯（终态）：`pnpm exec vitest run packages/doc-runtime/test/extract-union-trial.test.ts
  packages/doc-runtime/test/extract-plain-domain.test.ts --passWithNoTests=false` →
  `Error: Cannot find module '../src/index.js'`，Test Files 2 failed / Tests no tests / EXIT=1
  （与冻结 21 用例同构的构造性红灯）。
- 行为级红证明（临时 throw-stub，验证后已删除，无残留）：stub 下 17/17 用例（8+9）全部
  执行并失败（Error: SA6 stub: extractYjsSnapshot 未实现）——证明两份文件可收集、可执行、
  断言真实失败；stub 删除后终态恢复构造性红灯。
- 类型清洁：临时 tsconfig（已删）下三份测试文件仅报预期 TS2307（../src/index.js 缺失），
  无其他类型错误。
- 全量回归：`pnpm test` → 既有 47 files/669 tests 通过，新增 3 份红灯文件按预期失败，
  无 TypeCheckError 噪音、零回归。

## 对下游 SA 的提示（增补面）

- SA1/SA3：本增补冻结的 plain 域违规契约 = D9② 申报词（'bigint'/'undefined'/
  'non-plain object' 可达 + 'function'/'symbol' 内嵌可达改判）四字段形状 + 非 internal 守卫；
  union 试验契约 = 前置判定 + Record 形成员直接 walk + 声明序仲裁。实现时除 §4.5/§4.6 外
  无需其他改动；两份文件与冻结 21 用例同构红灯，SA3 建立 src 后一并转绿。
- SA4：D9 家族偏离裁决（§10 R2/#4 登记块）的验证面现已由本增补锚定（actual 词与四字段
  形状的直接断言）。
