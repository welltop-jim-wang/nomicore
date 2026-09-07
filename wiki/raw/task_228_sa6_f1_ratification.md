# Issue #228 — SA6 追认：D4 断言仲裁（F-1）独立验收契约追认

> SA6 追认轮产物（dispatch `sa-42b98fd2-f2f3-4fa5-a2cb-3852ef660000`，phase
> acceptance-contract，iteration 1）。任务简报权威来源 = GitHub issue #228；REST 评论
> 读取 = 空数组，无 Owner 追加要求（评论 ID/updated_at：无）。输入（全部亲读）：
> `task_228_sa4_review.md`（F-1~F-7）、`task_228_sa3_implementation_notes.md`（§3.1
> 证据包）、`task_228_sa6_acceptance_contract.md`（round-0 契约 D1–D4 + AC2 覆盖图）、
> `task_228_design.md`（AD-1~AD-9、R-1）、`task_228_sa2_review.md`、SA8 冲突报告、
> 红灯契约测试文件、registry/app 源码事实区。零业务代码改动；未 commit/push。

## 0. Verdict

**approve**（`requiresConflictRecheck: false`）。

SA4 F-1 所指向的 D4 断言仲裁**追认成立**：由「重启后 namespaceId 确定性派生
`.toBe(已删 id)`」调整为受 CSPRNG `randomBytes(16)` 事实支持的
「重启健康 ready + 重建新 id（`.not.toBe(已删 id)`）+ 已删旧 generation（日志目录树/
stream 目录）重启后零复活 + 重建新流 ≠ 旧流 + 重建树无 deletion.json 半态残留」
行为断言——**正确、充分、且未削弱 issue #228 验收义务**。测试无需回滚。

## 1. 追认对象与分歧面

- **原契约意图（round-0 SA6 契约 §2 D4 行 + 原测试实现）**：delete ok → SIGTERM →
  同根重启 → ready；「namespaceId 确定性派生」（实现为 `.toBe(已删 id)`）；已删旧
  stream 目录保持缺席；「若 provision 重建，新流替换 + 无 deletion.json 半态残留」。
- **实现轮修订（SA3）**：D4 断言改为 §0 所列行为集；测试文件头注（L5-12）、用例内仲裁
  注记（L383-391）、REPORT.md（L102-109）、SA3 notes §3.1 四处披露。
- **分歧声明链**：design AD-2（L92「D1–D4 断言零改动即应转绿」）、SA2 §5.2（L214
  「重启 provision 重建同 namespaceId（确定性派生）」）、SA8 冲突报告（§3「断言零改动
  转绿的路径成立」）均以「断言零改动」为前提 → 与 SA3 修订矛盾 → SA4 F-1 要求本
  追认轮（SA6/SA8）+ SA1 design 勘误。
- **本追认裁决**：修订是对**物理不可满足断言**的必要纠错，方向与已批准设计 R-1 逐字
  一致（见 §3）；「断言零改动」三方声明的错误在于其共享的错误前提（「重建同
  namespaceId」物理不可能），不构成对修订的反对。

## 2. 事实核验（亲证，非转述）

| # | 事实 | 证据 | 亲证结果 |
|---|---|---|---|
| T1 | namespaceId 每次 `registry.create` 由受控 128-bit CSPRNG 派生：`randomBytes(16)` → `ns-`+32 小写 hex；形状违约 → 立即 fatal；调用方不得携带 namespaceId | registry.ts L854-892 `generateNamespaceId`；L204 `NAMESPACE_ID_RANDOM_BYTES = 16 // 128-bit CSPRNG`；types.ts L248 create 输入契约 | ✅ |
| T2 | Host 每次启动对每条 provision 条目无条件执行 `registry.create`（fresh id；known-set 由 boot 重建） | app.ts `bootHub` L274-280 → `provision()` L315-328（`registry.create({owner, schema, root})` → `lease.namespaceId`） | ✅ |
| T3 | 删除 = 终态：数据快照与 `{logRoot}/namespaces/{ns}` 目录树同回执周期消失（registry.deleteNamespace + persistence.deleteDoc + deleteNamespaceDiagnosticLog）；重启前无任何旧 generation 持久残留 | design AD-3/AD-5/AD-6；D1 绿锚（本追认轮复跑） | ✅ |
| T4 | 「确定性派生（同 id）」仅存在于**数据仍存续**的重启形态：直引 authorization 显式 namespaceId 恢复同一持久化条目（第二 boot **不带 provision**） | T-H6 boot2（无 provision、直引恢复、streamId 不变）；#155 E5/T6 先例（SA3 §3.1 引用） | ✅ |
| T5 | D4 场景（删除后重启，config 仍带 provision p1）无 T4 前提：旧条目已删除、日志树已删除 → provision → `registry.create` → 全新 CSPRNG id | T1×T2×T3 组合 | ✅ |
| T6 | 等 id 概率 = 2^-128（CSPRNG 均匀 16 字节；无任何「按配置固定 id」机制或设计） | T1；design R-1「新 namespace、新流、新身份」 | ✅ |
| T7 | 原断言（重启后 `.toBe(已删 id)`）对**任何正确实现**物理不可满足 → 保留原断言 = 测试永远红 = 契约自毁 | T1-T6 | ✅ |
| T8 | 修订后断言当前实现可满足（非过度约束、非空转） | 本追认轮独立复跑：D4 17.9s 绿；文件 4/4 绿 exit 0，Type Errors no errors | ✅ |

## 3. 三问判定

### 3.1 正确性 —— ✅ 修订正确

- 原「确定性派生」前提与 T1–T6 直接冲突：D4 断言的重启形态**没有**可确定性恢复的
  旧 generation（T4 的恢复前提是数据仍在；删除后不存在）。唯一能让 `.toBe` 通过的
  实现 = 删除未生效（D1 违约），或为 provision 引入「按配置固定 id」机制（无此设计、
  且违反 R-1「新身份」的已批准裁决）。
- 修订后断言锚定全部为**可观察运行时行为**：NDJSON `provisioned`（新 id）/`ready` 事件、
  真实文件产物（旧树/旧 stream/新树/current.json locator/deletion.json）、进程退出码；
  零源码 grep、零 skip、无软兜底；前置条件真实（删除前日志建流+快照落盘、重建后新流
  落盘，均经 expect.poll 让出事件循环）——无假绿/空转风险。
- 修订与已批准设计一致：design R-1（删除后重启按配置重建 = 新 namespace、新流、新
  身份）、AD-4（initStream 先 un-retire——「同进程内以同 namespaceId 重新 create 时新
  namespace 可正常建流（D4 第二分支的进程内同构）」）、冲突报告 §「D4 第二分支语义
  自洽」。

### 3.2 充分性 —— ✅ 修订充分（且更强）

原 D4 可满足义务逐项仍在，另增反锚：

| 原义务（语义红线） | 修订后锚点 |
|---|---|
| 重启后进程健康（无崩溃、ready 照常） | `bootHub` 等 provisioned + ready、exitCode null；SIGTERM exit 0 |
| 已删旧 stream 目录保持缺席 | L396-397 重启后旧日志目录树 + 旧 stream 目录双 absent |
| 删除后不复活 | 旧树 absent + 新 id `.not.toBe(旧 id)`（新身份反锚，**增强**：排除以旧身份复活）+ 新流 `.not.toBe(旧流)`（排除流复用复活） |
| 无 deletion.json 半态残留 | 重建树 deletion.json absent + 旧树整树 absent（marker 随旧树消失） |
| （原「确定性派生 .toBe」） | ✗ 物理不可满足 → 按 R-1 语义以 `.not.toBe` 反锚替代（身份复用同样被排除，安全语义只增不减） |

### 3.3 未削弱 issue #228 验收义务 —— ✅

- **AC1 主体（本契约主体义务）不依赖 D4**：同步联动 + 全清单逻辑删除（locator/
  manifests/JSONL/BIN/deletion markers/adapter indexes = 目录树整体 absent）+ 幂等 +
  参数门分别由 D1/D2/D3 钉死，D1–D3 **零断言改动转绿**（SA3 notes §2.1 + SA4 独立复跑
  + 本追认轮复跑），未受影响。
- D4 属契约自加的「重启不复活」红线（round-0 SA6 契约 §2.1「删除后进程重启不复活、
  进程健康」），修订保留全部该红线且新增防身份/流复用锚（§3.2）——义务面未减，断言
  强度净增。
- issue #228 的权威验收文本（AC1 措辞）与 Owner 评论（[]，无追加要求）从未要求
  「删除后 provision 重建必须复现同一 namespaceId」；相反，设计 R-1 明确重建 = 新身份。
- 修订走 round-0 SA6 契约自载的 #155 先例「裁定不同按设计仲裁修订」通道，且四处披露
  （测试头注/用例内注记/REPORT/SA3 notes）——程序合规。

## 4. 可满足性复跑证据（本追认轮独立运行）

```
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts
→ Test Files 1 passed (1)；Tests 4 passed (4)；Type Errors no errors；exit 0
  D1 8774ms / D2 7433ms / D3 7269ms / D4 17860ms（总计 42.57s；2026-09-07 本地）
```

结论：修订后 D4 由正确实现可满足（非过度约束）；D1–D3 零断言改动保持（AC1 义务锚
未漂移）。与 SA3/SA4 实测数字一致（4/4 绿）。

## 5. 追认边界与移交（不属本追认、供总控路由）

1. **SA1（收尾勘误批次）**：design AD-2 L92「D1–D4 断言零改动」→ 改述为「D1–D3 零
   断言改动；D4 断言级仲裁（R-1 修订，见 SA3 notes §3.1 / 本追认）」；SA2 review
   §5.2 D4 行「重建同 namespaceId（确定性派生）」同源错误一并勘误（SA4 F-1 原文）;
   design §7 残余风险补 R-1×D4 交叉注记；design §3.3/§6.1 表内「断言零改动」表述同批。
2. **SA8（收尾门禁轮）**：追认本仲裁 + design 勘误后的一致性（SA4 F-1 处置清单原定）。
3. **SA6 契约档案**：round-0 档案 D4 行已同步修正并注记（见
   `task_228_sa6_acceptance_contract.md` §2 行内标记 + §7）。
4. 测试文件不回滚（回滚 = 恢复物理不可满足断言 → D4 永红 → 契约自毁）。

## 6. 交付物

- 本文件：`wiki/raw/task_228_sa6_f1_ratification.md`（追认档案，verdict=approve）。
- `wiki/raw/task_228_sa6_acceptance_contract.md`：§2 D4 行修正标记 + §7 追认节（归档
  修正，验收档案更新）。
- 结构化结果：`verdict = approve`，`requiresConflictRecheck = false`，
  artifactPaths 见 tool call。
