# Issue #228 — SA6 验收契约与红灯证据（acceptance-contract，round 1）

> SA6 产物（dispatch `sa-bfed89d8-d51d-450d-867a-795603abe69a`，phase acceptance-contract，
> iteration 0）。任务简报权威来源 = GitHub issue #228（`wiki/raw/task_228.md` 不存在；
> REST 评论读取 = 空数组，无 Owner 追加要求）。SA8 前置门禁 verdict=clear，本契约遵守
> B1–B3 边界（见 §6）。本文件 = 任务归档：契约设计、可执行用例、红灯运行证据、AC2 阶段
> 验收覆盖图、仲裁注记。未修改任何生产业务代码；未 commit/push。
>
> **iteration-1 追认（dispatch `sa-42b98fd2-f2f3-4fa5-a2cb-3852ef660000`）**：§2 D4 行
> 「namespaceId 确定性派生」前提经 F-1 追认修订（verdict=approve；详见 §7 与
> `wiki/raw/task_228_sa6_f1_ratification.md`）。

## 1. 契约范围

Issue #228 AC1（联动实现面，本轮红灯契约主体）：

> Host 的 namespace 数据删除工作流同步触发诊断日志删除，清理 active locator、stream
> manifests、JSONL/BIN、deletion markers 与 adapter indexes，同时只承诺活跃存储的逻辑删除
> 而不暗示 secure erase。

Issue #228 AC2（阶段级验收范围，覆盖图见 §4）：create / ROOT·SCHEMA / trusted
replication / restart / retention / logging failure / bounded shutdown /
complete·partial·failed replay。

现状事实（亲证）：Host（`apps/yjs-server`）NDJSON 控制通道 op 闭集 = 11 个
（`status/shutdown/read/verify-write/add-target/remove-target/notify-auth-changed/
request-reauth/replace-schema/bump-epoch/reset-replica`，`app.ts` dispatch switch），
**无 delete 类 op**；Registry/Persistence 公共面无删除 seam（ADR-0009/0006 闭集）。
被调能力 `deleteNamespaceDiagnosticLog(rootDir, namespaceId)` 已由 #154 交付
（package 级；deleted/absent 词汇、`.deleting` 收尾、orphan 清理、INV-12 租约释放）。

## 2. 契约设计（AC1 红灯测试）

文件：`apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts`
（进程级 E2E：真实 `main.ts` hub + file persistence + diagnostics enabled + provision
`p1/alice`；NDJSON stdin 控制通道；真实文件产物断言；零源码 grep；零新静态 import——
红灯只来自运行时缺失面，不会因编译失败假红）。

表面提案（PROPOSAL，供 SA1/SA2/设计后 SA8 仲裁；先例 #155「裁定不同按设计仲裁修订」）：

- Host 控制通道新增 op `delete-namespace`，参数 `{ namespaceId }`。**语义红线不变**：
  ack `ok:true` ⇒ 同一回执周期内（同步窗口、无轮询）该 namespace 数据快照与诊断日志
  逻辑删除完成（`{logRoot}/namespaces/{namespaceId}` 目录树 absent = locator/manifests/
  JSONL/BIN/marker/indexes 全清）；二次 delete 幂等 ok；非法 namespaceId →
  `invalid-op-args` 且零文件触达；删除后进程重启不复活、进程健康。
- 数据删除的持久层 seam 与公共面演进（B1）不在本契约钉死——只钉可观察结局（删除前
  存在的 `.snapshot` 文件删除后全部 absent；快照路径按 ADR-0006 布局
  `{persistRoot}/users/{userId}/{namespaceId}.snapshot` 泛化收集，不钉文件名形状）。
- 今日基线（诚实红灯）：dispatch 无该分支 → 回执 `{ok:false, code:'unknown-op'}`，
  每个用例在首个回执断言处红。

| 用例 | 契约点 | 断言（今日状态） |
|---|---|---|
| D1 | 同步联动 + 逻辑删除完成 + 干净停机 | delete 回执 ok:true（今日 unknown-op → 红）；随后目录树 absent、全部快照 absent；SIGTERM exit 0 |
| D2 | 幂等收敛（deleted/absent 二值重入） | 首删 + 二删均 ok:true（今日红），目录保持 absent |
| D3 | 参数门 + 进程存活 | 非法 id → ok:false + code `invalid-op-args`（今日红），进程不退出 |
| D4 | 重启不复活已删流 + 健康 | delete ok:true（今日红）→ SIGTERM → 同根重启 → ready；重建 = **新 identity**（≠ 已删 id；原「namespaceId 确定性派生」前提 ✗——物理不可满足，已按 R-1 追认修订，见 §7）；已删旧日志目录树/旧 stream 目录保持缺席（零复活）；重建新流 ≠ 旧流 + 无 deletion.json 半态残留 |

## 3. 红灯运行证据

命令（后台独立进程；worktree 首次运行前执行 `pnpm install --frozen-lockfile`，1.8s 完成）：

```bash
cd /home/wangjian/nomicore-fix-issue-228 && \
NODE_OPTIONS=--conditions=nomicore-source ./node_modules/.bin/vitest run \
  apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts
```

实测结果（2026-09-07；vitest 3.2.7；`Type Errors: no errors`）：

```
Test Files  1 failed (1)
Tests       4 failed (4)
```

逐用例失败均落在**首个回执断言**（红灯锚），前置条件（provisioned/ready 事件、日志建流
落盘、快照落盘）全部真实通过：

| 用例 | 实测失败点 | 失败原因（真实回执） |
|---|---|---|
| D1 | `expect(reply.ok).toBe(true)` | `{"op":"delete-namespace","ok":false,"code":"unknown-op"}` |
| D2 | 首次 delete 回执 | `code:"unknown-op"`（同 D1） |
| D3 | 拒绝码断言 | 期望 `invalid-op-args`，实测 `unknown-op` |
| D4 | delete 回执 | `code:"unknown-op"`（同 D1） |

结论：Host 数据删除→诊断日志逻辑删除联动缺失面**真实存在且被契约钉死**（非源码 grep、
非假红）；SA3 按 PROPOSAL/仲裁结果实现 `delete-namespace` 后 D1–D4 应全部转绿。

## 4. AC2 阶段级验收覆盖图（矩阵 → 权威套件）

| 矩阵行 | 可执行锚（现有套件，收尾验收组合时随全量 `pnpm test` 运行） | 缺口注记 |
|---|---|---|
| create | Host：`diagnostic-replay-host-lifecycle-red.test.ts` E1（provision → genesis + namespace-create + replication-enable）；Registry：`registry-create-diagnostic-*` | — |
| ROOT/SCHEMA | Host：同文件 E2（verify-write / replace-schema → committed 记录 sequence 连续） | — |
| trusted replication | Registry：`registry-phase5-replication*`（#200 trusted/management 记录）；Host：`node-hub-peer-live`、C1 归因并发（`diagnostic-replay-host-lifecycle-sa7`） | host 级 trusted+diag 组合断言建议在最终验收组合中补足 |
| restart | package：`file-adapter-reopen-roll-repair*`（#153 stream 续写）；本票 D4 增加 host 级「删除后重启不复活」负向行 | host 级正向「重启续写诊断流」建议最终验收组合补足 |
| retention | package：`file-adapter-retention*`/`-history`/`-deletion-windows`/`-lease-gate`；Host config→adapter retention 透传已接线（`config.ts` + `diagnostics.ts`） | host 级 retention sweep 场景建议最终验收组合补足 |
| logging failure | Host：E4（logRoot 指向普通文件 → stream init 失败 → provision/read 照常）；package：`emitter-isolation`/`observer-isolation` | — |
| bounded shutdown | Host：E3（SIGTERM exit 0 + strict 一致）+ `diagnostic-replay-host-lifecycle-sa7` D8（恰一次 `diagnostics-closed`）+ `ordered-shutdown-red` | — |
| replay complete/partial/failed | Host：`diagnostic-replay-host-lifecycle-red` R1–R11（complete / genesis 缺 / retention 裁剪 / gap / invalid-json / generation 断裂 / 无日志 failed）+ sa7 M2/K-1 | — |

结论：AC2 每行均有可执行锚；host 级 3 个补足项（restart 正向、retention、trusted+diag
组合）建议由总控在实现轮后的最终阶段验收（AC2 门）编排或补测，不属本前置契约轮的红灯面。

## 5. 交付物

- `apps/yjs-server/test/host-namespace-delete-diagnostic-link-red.test.ts`（AC1 红灯契约，
  4 用例；SA3 实现后按 PROPOSAL 仲裁结果修订 op 名/回执行并转绿）
- `wiki/raw/task_228_sa6_acceptance_contract.md`（本档案）

## 6. SA8 B1–B3 边界遵守声明

- B1：本契约未扩展任何冻结 v1 公共接口、未新增包公共导出、未触碰存储布局实现；只锚定
  Host 可观察结局。op 命名/数据删除 seam 落点（Persistence/Registry/组合）留给 SA1 设计，
  若扩展公共面须显式 ADR 修订节备案；app 侧只消费包公共导出（测试仅走 `main.ts` 进程
  面与真实文件产物）。
- B2：「同步触发」语义在本契约中即「ack 同一周期完成」（无异步轮询等待）；失败/重入
  收敛语义（重试收敛、`deleteNamespaceDiagnosticLog` 同步 fs 在 write sequencer slot 外）
  归 SA1 设计显式裁决，D2 只钉幂等结局。
- B3：本契约零文档面；AC3 措辞对齐方向 = ADR-0012-LOG 首切片 amendment（后决优先），
  归文档轮。

## 7. F-1 追认修订 — D4「确定性派生 .toBe」→ CSPRNG 事实下的重启/不复活行为断言

> iteration-1 追认节（SA6 追认轮 dispatch `sa-42b98fd2-f2f3-4fa5-a2cb-3852ef660000`；
> 处理 SA4 F-1「契约修订需追认」；完整证据与事实核验见
> `wiki/raw/task_228_sa6_f1_ratification.md`，本节约述与档案一致）。

**裁决：approve**——SA3 implementation round 将 D4 断言由「重启后 namespaceId 确定性
派生 `.toBe(已删 id)`」修订为「重启健康 ready + 重建新 id `.not.toBe(已删 id)` +
已删旧 generation（日志目录树/stream 目录）重启后零复活 + 重建新流 ≠ 旧流 + 重建树
无 deletion.json 半态残留」，**正确、充分、未削弱本契约与 issue #228 的验收义务**；
测试不回滚（回滚 = 恢复物理不可满足断言）。

追认要点（亲证事实，非转述）：

1. **根因 = 评审链共享事实错误**：namespaceId 由受控 128-bit CSPRNG
   （`randomBytes(16)` → `ns-`+32hex）在每次 `registry.create` 时生成
   （registry.ts `generateNamespaceId` L854-892、L204；types.ts L248 契约）；Host
   provision 每次启动对每条目无条件 `registry.create`（app.ts bootHub→provision
   L274-328）。删除 = 终态（数据 + 日志树同回执周期消失）→ 重启无旧 generation 可
   恢复——「确定性派生同 id」仅存在于**数据仍存续的直引恢复**重启形态（#155
   E5/T6、T-H6：boot2 无 provision、显式 namespaceId），与 D4「删除后重启」场景无
   交集。原断言对任何正确实现物理不可满足（等 id 概率 2^-128）。
2. **修订方向与已批准设计逐字一致**：design R-1（重建 = 新 namespace、新流、新身份）
   + AD-4（D4 第二分支：重建走全新流）。
3. **义务面未减、断言强度净增**：D4 语义红线（重启不复活 + 进程健康 + 无 marker 半态）
   全部保留（追认档案 `task_228_sa6_f1_ratification.md` §3.2 对照表）；新增
   `.not.toBe(oldId)` / `.not.toBe(oldStreamId)` 防身份
   与流复用反锚；D1–D3（AC1 主体义务锚）零断言改动不受影响。
4. **可满足性亲证**：本追认轮独立复跑 4/4 绿 exit 0（D4 17.9s；Type Errors no
   errors）——修订后断言非过度约束、非空转。
5. **移交（不属本追认）**：SA1 勘误 design AD-2 L92 + SA2 review §5.2 D4 行表述
   （同源错误前提）；SA8 收尾门禁轮追认与 design 勘误后的一致性。
