# SA3 实现报告 — issue #191 yjs-server 根锁 stale 回收原子化

- **Date**: 2026-08-30（UTC；本报告落盘于实现验证后）
- **实现对象**: `wiki/raw/task_191_sa1.md`（R2，SA2 复审 verdict = pass/APPROVE，含 N1 勘误）+ `wiki/raw/task_191_sa2.md`（R2 复审节）；红灯契约 = SA6 落盘 `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`（T1-T9，11 用例，基线 5 failed | 6 passed）
- **实现范围（ALLOW LIST 命中 3 文件，DENY LIST 零触碰）**:
  - `apps/yjs-server/src/lifecycle.ts` — 修改（D1/D2 修复本体）
  - `apps/yjs-server/src/index.ts` — 修改（+1 行类型 re-export）
  - `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts` — [SA6 owned] 原样保留（SA3 未改动一字）
  - `docs/integration/hub-peer-deployment.md` — 修改（锁语义段 ~5 行，纯文档）
  - 未触碰：`main.ts`、四个存量测试、packages、配置文件

---

## §1. 交付内容（对 SA1 R2 §4 逐条落实）

| 设计条款 | 落实位置 | 摘要 |
|---|---|---|
| §4.1 nonce | lifecycle.ts:108 | `payload = JSON.stringify({ instanceId, pid: process.pid, nonce: randomUUID() })`（`node:crypto` import） |
| §4.2 原子独占重取环 | lifecycle.ts:103-218 | 框图与伪码逐条一致：① mkdir（EACCES/EPERM → loudUnwritable）→ 回环 { ② `wx` 首取（唯一持锁出口，break）；EEXIST → ③ seam① → 判定读（grounding `raw`，读失败→''）+ parseLockInfo → 活 pid → 双态 loud（逐字）→ ④ `attempt >= MAX_RECLAIM_ATTEMPTS(=8)` → `did not converge` loud → ⑤a seam②(raw) → ⑤b 守卫重读字节全等/读失败继续（catch → continue）→ ⑤c unlink（ENOENT→continue；EACCES/EPERM→loudUnwritable）→ ⑤d `wx` 重取（EEXIST→continue；EACCES/EPERM→loudUnwritable）} |
| §4.2 关键点 6 `parseLockInfo` | lifecycle.ts:39-47 | `readLockInfo(rootDir)` → `parseLockInfo(raw: string)` 私有等价重构（字段挑选、吞 parse 错 → {}、nonce 键天然忽略） |
| §4.3 release 所有权校验 | lifecycle.ts:199-217 | 读全文与本次 payload 字节串全等才 unlink；不等/文件不存在/不可读 → 吞错 no-op（幂等保留）；JSDoc 明示「静默 no-op 是刻意选择」（SA2 攻击点 7） |
| §4.4 seam①② 与 JSDoc | lifecycle.ts:59-77 | `RootLockAcquireHooks` 导出接口：`beforeStaleReclaimDecision?: () => void`（EEXIST 后/判定读前）+ `beforeStaleUnlink?: (rawStaleContent: string) => void`（判定读后/守卫重读前）；JSDoc「测试编排用、生产调用方不得传」；seam 内异常原样传播 |
| §4.5 文案逐字 | lifecycle.ts:146-150, 157, 89 | 三族 loud 文案 + 护栏 `did not converge` 文案与设计逐字一致（held-by-same-instance / shared-root unsupported / cannot write … writable rootDir） |
| §4.6 护栏 | lifecycle.ts:84, 155-159 | `MAX_RECLAIM_ATTEMPTS = 8`（非导出常量）；所有 `continue` 路径必经 for 循环 `attempt += 1`，且 ④ 检查先于 ⑤a/⑤c（SA2 R2.4 移交点 1） |
| §9 index.ts re-export | index.ts:60 | `export type { EventSink, RootLockAcquireHooks, RootLockHandle } from './lifecycle.ts';` |
| §6.2/§10 docs | docs/integration/hub-peer-deployment.md「锁文件与共享 root」 | payload `{instanceId, pid, nonce}`；stale = 守卫+unlink+wx 原子重取（败者 loud）；release 只删所有权对应锁；pid 复用误判保留 |

**硬约束自查**：`flag:'w'` 在 `lifecycle.ts` 生产代码零残留（`writeFileSync` 仅两处 `{ flag: 'wx' }`）；
无 env-override / fallback / 测试专用分支；无 try/catch 空返（守卫 catch → continue 为设计语义，非降级）。

---

## §2. 验证结果

### §2.1 红灯契约（聚焦，已完成实现后全绿）

命令（required background mode：setsid/nohup 独立进程）：

```bash
cd /home/wangjian/nomicore-fix-issue-191
setsid nohup pnpm exec vitest run apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts > /tmp/sa3-issue191-green.log 2>&1 < /dev/null & disown
```

**结果（vitest 3.2.7 / Node v24.13.0）**：

```
 ✓ apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts (11 tests) 11ms
 Test Files  1 passed (1)
      Tests  11 passed (11)
Type Errors  no errors
```

基线（b66615c，SA6 记录）= 5 failed | 6 passed；实现后 = **11/11 全绿**。
关键锚逐条：T1 nonce schema pin ✅（实现 payload 含 nonce）；T4 seam① 编排恰一胜 +
败者 loud held + 胜者锁保全 ✅；T5 迟到 release 逐字节不误删 ✅；T8 seam② 守卫四重红锚
（nothrow / unlinkHookFired=1 / rawSeen=种子字节 / survivor=winnerPayload 字节）✅；
T9 release 不可读文件 no-op 残留 ✅；T2/T3×2/T6a/T6b/T7 绿锚保持 ✅。

### §2.2 类型面（root `pnpm typecheck`）

```
TYPECHECK_EXIT=0   （12 个 tsc -p 项目全过，含 apps/yjs-server/tsconfig.json；
                    verbatimModuleSyntax / exactOptionalPropertyTypes 下无错误）
```

### §2.3 存量 app 级回归（锁面四个真进程测试，顺序执行）

```bash
pnpm exec vitest run --no-file-parallelism apps/yjs-server/test/smoke-skeleton-red.test.ts \
  apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts \
  apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts apps/yjs-server/test/lifecycle-watchdog-red.test.ts
```

**结果：Test Files 4 passed (4) / Tests 16 passed (16)，exit 0**（104s）——干净停机释放、
共享活跃 root loud 拒绝、SIGKILL 崩溃 → 同 rootDir 重启 stale 重取（AC6）、管理动词
套件、watchdog 全部保持绿（I5 零回归证据）。

### §2.4 环境提示（SA4/SA7 知悉，非实现问题）

首次以 **4 文件并行**（vitest 默认 file-parallel）运行同一回归组时出现 13 failed
（`spawn tsx EAGAIN` / `pthread_create: Resource temporarily unavailable` / code 134
空 stderr）。**在 pristine 基线（git stash 后）以同一 4 文件并行命令复跑，同样失败
（5 failed + 3 unhandled errors，同为 EAGAIN spawn / code 134）**——确认为本机
进程/线程资源限额在「多个真进程测试文件并行」下被击穿的**环境伪影**，与实现无关；
`--no-file-parallelism` 顺序执行（§2.3）全绿。建议 SA7 全量回归亦采用顺序文件执行
或调低并行度（CI ubuntu 无此问题）。

### §2.5 其它清理检查

- `git diff --check`：无 whitespace 错误。
- `git status`：仅 3 个允许文件修改 + 新测试文件 + wiki 记录，无越界改动。

---

## §3. 实现与设计的偏差说明

- 无功能偏差。代码组织结构微调：`loudUnwritable(errno)` 收敛为返回 `Error` 的
  私有辅助函数（文案逐字不变），供 ①/②/⑤c/⑤d 四点映射复用——合设计「四点全覆盖」。
- `attempt` 计数按设计只计回环轮次（for 循环 `attempt += 1`），首轮 fresh wx 成功不计数。
- N1 勘误（§7.6 现状行为描述与源码不符）仅影响 SA1 文档文字，SA3 未据以改代码
  （acquire 侧不可读 → 回环 → 护栏 `did not converge` 实现与 SA2 R2 复审一致）。

---

## §4. 移交

- **SA4**：静态核对锚点（⑤b 原始字节比对 `recheck !== raw` / continue 必经 attempt
  计数 / ④ 先于 ⑤a/⑤c / `flag:'w'` 零残留 / seam JSDoc「测试编排用、生产调用方
  不得传」/ release「静默是刻意选择」注释 / index.ts re-export / 三族文案逐字）。
- **SA7**：动态域 = 并发部分写窗（§7.5）+ 守卫重读→unlink 残余窗（§7.1 变体 3），
  均推演/披露域；全量回归建议顺序执行（§2.4）。
