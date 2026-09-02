# SA1 设计文档 — yjs-server 根锁 stale 回收原子化（Issue #191 / Bug 修复）

- **Worktree**: `/home/wangjian/nomicore-fix-issue-191`（branch `refactor/yjs-server-make-stale-root-lock-reclamation-atomic`，基线 `b66615c` = PR #130 合入 main）
- **任务简报**: `TASK.md`（worktree 根）+ GitHub issue #191 全文（已核对，与 TASK.md 一致）；dispatch 记录 `wiki/raw/task_191_dispatch.md`
- **红灯契约**: 本文档 §5 定义（SA6 据此落盘 `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`）
- **文档路径说明**: 总控指令明确要求产出 `wiki/raw/task_191_sa1.md`（而非技能默认 `task_<name>_design.md` 后缀），本文档即该产出
- **版本**: R2（2026-08-30。R1 被 SA2 reject（评审报告 `wiki/raw/task_191_sa2.md`，verdict reject / 1 MAJOR + 2 披露性必改）。本修订落实全部必需项：RC1（unlink 前原始字节守卫 + 撤回 §7.1 错误论断 + **显式选定增设 seam② `beforeStaleUnlink` 与 T8**）、RC2（部分写入可见窗披露 + T6 空文件 pin）、RC3（release 不可读文件矩阵 delta + T9 锚），并采纳攻击点 4/5/7 与 §3 加固建议；SA2 §6 六项冻结面全部维持不动。逐条映射见 §11）

---

## §1. 任务定性与根因分析

**Bug 修复**。缺陷主体：`apps/yjs-server/src/lifecycle.ts::acquireRootLock()`。issue #191 判词与代码现状逐行核对一致，本设计不重考据 issue 文本，直接给出两个缺陷的深层机理与可达路径。

### D1 — stale 回收用非独占覆写（竞态双持锁）

- **缺陷行**: `lifecycle.ts:81`
  ```ts
  // stale（pid 已死）：覆盖重取。
  writeFileSync(lockPath(rootDir), payload, { flag: 'w' });
  ```
- **机理**: 首次获取用 `flag: 'wx'`（O_EXCL，原子独占，`lifecycle.ts:66`）是对的；但撞 `EEXIST` 且判定 pid 已死后，回收路径放弃了独占原语，改用 `flag: 'w'`（truncate 已存在文件，**无条件成功**）。"读锁内容 → 判死 → 覆写" 三步之间无任何原子性保证，判死结论在下笔瞬间已经过期。
- **竞态时序**（两个进程 A、B 同时对同一 stale root 竞争）：
  ```text
  t0  锁文件 F1 = {instanceId:'dead', pid:P}（P 已死）存在
  t1  A: wx → EEXIST；读 F1 → P 死 ✓
  t2  B: wx → EEXIST；读 F1 → P 死 ✓        ← 两者都基于 F1 判死
  t3  A: flag:'w' 覆写 → 成功，A 自认持锁
  t4  B: flag:'w' 覆写 → 成功（静默清掉 A 的 payload），B 自认持锁
  t5  A、B 各自持有 handle 继续用同一 FilePersistence root
  ```
  违反应用级规则：**每个活跃进程独占自己的 rootDir**（`docs/integration/hub-peer-deployment.md:194-207` 的锁语义承诺）。两个进程并发写同一 `users/` 子树 → 快照互踩、归档交错，且零诊断（t4 的覆写完全无声）。
- **注意窗口的宽广性**: t1 与 t4 之间是"读文件 + process.kill(pid,0) 存活性探测 + 再写文件"的整段应用逻辑，不是纳秒级内核窗口——重启风暴（supervisor 反复拉起）下两个 tsx 子进程极易双双落进此窗。这不是理论边角，是重启场景的主路径风险。

### D2 — release() 无所有权校验（迟到释放误删后继者锁）

- **缺陷行**: `lifecycle.ts:93`（release 闭包内）
  ```ts
  release(): void {
    try {
      unlinkSync(lockPath(rootDir));   // ← 无条件删除，不管文件里现在写的是谁
    } catch { /* 已删除/不存在——释放幂等。 */ }
  ```
- **机理**: handle 与锁文件内容零绑定。任何拿到 handle 的代码路径在任意时刻调用 `release()`，都会删掉当时磁盘上**任何人**的锁。
- **生产可达路径**（不依赖臆造，逐条对照 `main.ts`）：
  1. **reload 换装到 memory 后残留 stale handle**：`main.ts:118` `state.lock?.release()` 后**未把 `state.lock` 置 undefined**；若新 config 是 `persistence.kind === 'memory'`（`main.ts:120` 条件不成立），`state.lock` 仍是旧 handle。此后进程 B 以同一 rootDir 正常启动取锁（wx 成功），原进程再收 SIGTERM → `main.ts:71` `state.lock?.release()` → **无条件 unlink 删掉 B 的活锁** → 第三个进程 C 又能取锁 → B、C 双持。
  2. **D1 的下游放大**：A、B 双持锁后，A 干净停机 → `release()` 删掉的是 B 的锁文件 → 后续进程畅通无阻进入 rootDir，B 仍在运行。
- issue 原文判词"late release must not remove a lock acquired by another contender"即指此。

### 深层根因（一句话）

**互斥协议只在一半路径上使用了原子独占原语**：`wx` 的存在性 test-and-set 只覆盖"锁不存在"分支；"锁存在但 owner 已死"分支退化为 read-check-write 竞态（D1），而释放侧完全没有把"handle ↔ 锁内容"绑定起来（D2）。修复 = 让**每一次所有权转移都经过独占创建（O_EXCL）裁决**，并让**释放只作用于仍属于自己的文件**。

---

## §2. 现状行为矩阵（修复前，作为契约锚点）

| 场景 | 现行为 | 位置 | 修复后必须 |
|---|---|---|---|
| root 无锁，首次获取 | `wx` 独占创建 → 持锁 | lifecycle.ts:66 | **不变**（本来就是对的） |
| 锁在、pid 活、同 instanceId | loud throw「held by the same instance … pid reuse caveat」 | lifecycle.ts:74-76 | **文案逐字保留** |
| 锁在、pid 活、异 instanceId | loud throw「shared file persistence root is unsupported …」 | lifecycle.ts:77 | **文案逐字保留** |
| 锁在、pid 死、单回收者 | `flag:'w'` 覆写 → 持锁 | lifecycle.ts:81 | 改为 unlink+wx 原子环，**可观测结果等价**（拿到锁、文件为本进程 payload） |
| 锁在、pid 死、≥2 回收者竞态 | **双双成功（bug）** | lifecycle.ts:81 | 恰一胜者；败者读到胜者活 pid → loud「held」类诊断 |
| rootDir 不可写（EACCES/EPERM） | loud throw「cannot write .nomicore-lock.json …」 | lifecycle.ts:82-85 | **文案保留**，且 mkdir/wx/unlink/wx 四个 fs 动作同映射 |
| 锁内容非法 JSON / 空文件 | readLockInfo 吞错 → {} → pid undefined → 视作 stale 回收 | lifecycle.ts:35-42 | **语义不变**（parse 吞错 → {} → 判死 → 守卫字节全等 → 回收；pin 住，见 §5 T6 含 RC2 空串变体） |
| release：自己持锁 | unlink 成功 | lifecycle.ts:93 | 不变（内容校验通过后 unlink） |
| release：文件已不存在 | 吞 ENOENT，幂等无异常 | lifecycle.ts:94-96 | 不变（幂等保留） |
| release：文件是后继者的 | **误删（bug）** | lifecycle.ts:93 | **不再删除**（§4.3 所有权校验） |
| release：文件存在但不可读（如被 chmod 000） | 不读内容、无条件 unlink（unlink 只需父目录写权限）→ **文件被删** | lifecycle.ts:93 | **行为 delta（接受，RC3）**：`readFileSync` EACCES → 吞错 no-op → **锁残留**；理由与依据见 §7.6 |
| acquire：锁文件不可读（病态，如被 chmod 000） | loud `cannot write`（'w' 覆写撞 EACCES） | lifecycle.ts:81-84 | loud `did not converge`（判定读/守卫读均失败 → 回环 → 护栏收口）；同为 loud、仅文案不同，见 §7.6 |
| acquire：读到空/半截锁文件（并发部分写窗） | `JSON.parse` 抛 → {} → 判 stale → 可能删活进程刚建的锁 | lifecycle.ts:35-42 / :66 | **同窗保留**（现状既有、非本设计引入），RC1 守卫使触发需两次读+unlink 全落在竞争者单次 write 窗内；披露见 §7.5（RC2） |
| payload schema | `{instanceId, pid}` | lifecycle.ts:61 | 增补 `nonce` 字段（§4.1，向后兼容论证见 §6.3） |

---

## §3. 设计目标与不变量

修复后 `acquireRootLock` / `release` 必须维持的不变量（每条映射到 §5 的可测契约）：

- **I1（独占转移）**: 任何时刻、任何交错下，对同一 rootDir 恰有 ≤1 个进程自认持锁。所有权只能经 `wx`（O_EXCL）独占创建裁决，**永不**经非独占覆写（`flag:'w'` / 无条件 rename 覆盖）转移。→ T4
- **I2（败者 loud）**: 竞争败者得到的不是沉默成功，而是现有"held/unsupported"族诊断（含锁内 `{instanceId, pid}`），与活 owner 冲突的两种既有文案语义同源。→ T4
- **I3（释放守恒）**: `release()` 只删除内容仍等于本 handle 获取时写入的 payload 的锁文件；否则不动磁盘。幂等（重复 release / 文件已消失 → 无异常）。→ T1、T5
- **I4（诊断保全）**: 活 owner 双态文案、pid 复用 caveat、不可写 root 指向部署文档——全部逐字保留。→ T3
- **I5（存量行为零回归）**: 单进程正常获取/释放、单回收者 stale 回收、真进程级"crash → 同 rootDir 重启重取"（phase5 AC6）、"共享活跃 root loud 拒绝"（smoke AC2）全绿。→ T1、T2、T6 + 存量测试清单（§6.2）

---

## §4. 详细设计

### §4.1 数据模型：payload 增补 `nonce`

```ts
import { randomUUID } from 'node:crypto';
// payload: {instanceId, pid, nonce}
const payload = JSON.stringify({ instanceId, pid: process.pid, nonce: randomUUID() });
```

- **为什么需要 nonce**: release 的所有权校验需要"这个文件是不是**本次获取**写下的"的判据。仅比较 `{instanceId, pid}` 时，同进程同 instanceId 的两次获取产生**字节级相同**的 payload，旧 handle 理论上可误删新 handle 的锁（当前 `main.ts` 不可达此态——release 先于再获取、单线程、handle 重赋值——但 I3 要求的是"per-handle"精确性，issue 原文即 "still owned by **that handle**"）。nonce（122 bit 随机）使 payload 每次获取唯一，`content === payload` 即"仍是我写的"。
- **兼容性**: 见 §6.3（消费方逐一核对，均为字段挑选式解析，新增键无影响；docs 同步一句话）。

### §4.2 acquireRootLock：原子独占重取环（替换 lifecycle.ts:60-99 主体）

伪代码（错误文案变量沿用现有字符串，见 §4.5）：

```ts
export interface RootLockAcquireHooks {
  /**
   * 测试编排 seam①（生产调用方不传 → 行为零差异）：
   * wx 撞 EEXIST 之后、stale 判定读之前同步回调。
   * 用于确定性注入「另一竞争者恰在此窗口完成重取」的交错（§5 T4）。
   * seam 内抛出的异常原样向外传播（不吞）。
   */
  beforeStaleReclaimDecision?: () => void;
  /**
   * 测试编排 seam②（R2 依 SA2 RC1 增设，生产调用方不传 → 行为零差异）：
   * 判定读已完成、pid 已判死、护栏未触发，RC1 内容守卫重读之前同步回调，
   * 携带判定读读到的原始字节（grounding 依据，测试可断言其等于种子内容）。
   * 用于确定性注入「竞争者在判定读与 unlink 之间完成回收」的交错（§5 T8）——
   * 即 RC1 守卫直接针对的最可几竞态变体。
   * seam 内抛出的异常原样向外传播（不吞）。
   */
  beforeStaleUnlink?: (rawStaleContent: string) => void;
}

const MAX_RECLAIM_ATTEMPTS = 8;

export function acquireRootLock(
  rootDir: string,
  instanceId: string,
  hooks?: RootLockAcquireHooks,
): RootLockHandle {
  const payload = JSON.stringify({ instanceId, pid: process.pid, nonce: randomUUID() });

  // ① rootDir 缺省语义 = 创建（保持现状）；EACCES/EPERM → loud 不可写诊断（同现文案）。
  try {
    mkdirSync(rootDir, { recursive: true });
  } catch (error) {
    dispatchMkdirError(error);            // EACCES/EPERM → loudUnwritable(errno)；else rethrow
  }

  for (let attempt = 0; ; attempt += 1) {
    // ② 首选路径：独占创建。成功 = 持锁（fresh 或「他人已把 stale 清走」后的重试）。
    try {
      writeFileSync(lockPath(rootDir), payload, { flag: 'wx' });
      break;                              // ← 唯一的持锁出口，全部经 O_EXCL 裁决
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      if (errno !== 'EEXIST') throw error;
    }

    // ③ EEXIST：先给测试 seam① 一个确定性编排点（生产无操作），再做判定读。
    hooks?.beforeStaleReclaimDecision?.();

    // 判定读（RC1）：一次性取原始字节——守卫比对的 grounding 依据。读失败 → ''，
    // 与现状 readLockInfo「读失败/parse 失败同归 {}」语义等价（不可读/消失均作 stale
    // 判定输入；可观测差异见 §2「不可读」行与 §7.6）。
    let raw = '';
    try {
      raw = readFileSync(lockPath(rootDir), 'utf8');
    } catch {
      // 读失败 → ''（下行 parse 亦失败 → {} → 判 stale；后续走向见 §4.2 关键点 7）
    }
    const info = parseLockInfo(raw);      // '' / 非法 JSON → {instanceId:undefined,pid:undefined}（现状语义保留）
    const owner = `{instanceId: ${JSON.stringify(info.instanceId)}, pid: ${JSON.stringify(info.pid)}}`;
    if (isPidAlive(info.pid)) {
      // 活 owner：loud 双态文案（逐字保留）。竞争败者在下一轮回环走到这里 → "sees held"。
      throw new Error(
        info.instanceId === instanceId
          ? `rootDir lock ${ROOT_LOCK_FILE_NAME} is held by the same instance (${owner}): previous instance did not shut down cleanly — remove the lock file manually if you are certain it is stale (pid reuse caveat: see docs/integration/hub-peer-deployment.md)`
          : `shared file persistence root is unsupported: another instance holds ${ROOT_LOCK_FILE_NAME} (${owner}) — each process needs its own rootDir (see docs/integration/hub-peer-deployment.md)`,
      );
    }

    // ④ 活锁护栏：每轮 continue 都要求「有他人在本轮内完成 取锁→死亡→再被顶替」的全周期，
    //    现实重启竞争 ≤2-3 方；8 轮远超物理需求，超限 = churn 异常 → loud（禁止 boot 期死循环）。
    if (attempt >= MAX_RECLAIM_ATTEMPTS) {
      throw new Error(
        `root lock reclaim for ${ROOT_LOCK_FILE_NAME} did not converge after ${MAX_RECLAIM_ATTEMPTS} attempts (concurrent reclaim churn on this rootDir) — retry boot`,
      );
    }

    // ⑤ 原子重取（RC1 守卫 + 两步独占，绝不使用 flag:'w' 非独占覆写）：
    //    5a. seam②（测试编排点，生产无操作）：携带 grounding 原始字节，置于守卫重读之前
    //        （T8 在此把锁文件整体替换为胜者 payload，模拟「判定读→unlink 窗内被顶替」）。
    hooks?.beforeStaleUnlink?.(raw);

    //    5b. RC1 内容守卫：紧贴 unlink 重读原始字节，与 grounding 字节全等才允许删。
    //        竞争者 B 在 A 的 kill 探测/簿记期间完成「unlink stale + wx 建新锁」时，此重读
    //        必不等 → 回环重判 → 读到 B 活 pid → loud held（最可几变体就此关闭，§7.1 表）。
    //        重读失败（消失/不可读）同样回环（② wx 可能直接成功）。
    let recheck: string;
    try {
      recheck = readFileSync(lockPath(rootDir), 'utf8');
    } catch {
      continue;
    }
    if (recheck !== raw) continue;         // 内容已被换 → 判死结论过期 → 回环重判

    //    5c. 删 stale 文件；ENOENT = 他人已删/已换 → 回环重判（不是错误）。
    try {
      unlinkSync(lockPath(rootDir));
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'ENOENT') continue;
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      throw error;
    }
    //    5d. 独占创建。EEXIST = 输掉重取竞争（胜者已持锁）→ 回环 → ③ 读到胜者活 pid → loud held。
    try {
      writeFileSync(lockPath(rootDir), payload, { flag: 'wx' });
      break;                              // 赢得重取
    } catch (error) {
      const errno = (error as NodeJS.ErrnoException).code;
      if (errno === 'EEXIST') continue;   // 败者回环，不覆写胜者
      if (errno === 'EACCES' || errno === 'EPERM') throw loudUnwritable(errno);
      throw error;
    }
  }

  // ⑥ release：所有权校验删除（§4.3）。
  return {
    release(): void {
      try {
        const current = readFileSync(lockPath(rootDir), 'utf8');
        if (current !== payload) return;  // 后继者（或任何人）持锁 —— 绝不误删（I3）
        unlinkSync(lockPath(rootDir));
      } catch {
        // 文件不存在/不可读 —— 释放幂等（现状语义保留）。
      }
    },
  };
}
```

关键点逐条：

1. **持锁唯一出口 = `wx` 成功**。stale 回收不再是"覆写"而是"删除后独占重建"，每一步失败模式都收敛：unlink 撞 ENOENT → 回环；wx 撞 EEXIST → 回环；回环重读 → 活 pid → loud。**不存在任何"写成功但可能已覆盖他人"的路径**——`flag:'w'` 从函数中彻底消失。
2. **竞争败者路径（I2）**：5d 撞 EEXIST → continue → ② 再 wx 撞 EEXIST → ③ 读到胜者 payload，胜者 pid 活 → loud throw。A/B 交错下败者必然走到这里（胜者是刚 `wx` 成功的活进程）；RC1 守卫拒绝删除的路径（⑤b 不等 → continue）同样汇入此处。
3. **seam① 位置在 EEXIST 之后、判定读之前**：测试在 seam 里同步跑完竞争者 B 的完整 acquire，A 的判定读将看到 B 的活 pid → loud。这让"双 stale 回收者"可以在单线程内被**确定性**编排（§5 T4），无需真实并行、无需 sleep。**seam② 位置在判定读之后、守卫重读之前**（R2/RC1）：编排「判定→unlink 窗内被顶替」交错（§5 T8），携带 grounding 字节。
4. **attempt 计数只计回环轮次**：首轮 fresh wx 成功不计冲突；护栏触发点在破坏性 unlink 之前。
5. **错误映射四点全覆盖**：mkdir / 首次 wx / unlink / 重取 wx 的 EACCES/EPERM 全部映射同一 loudUnwritable 文案（现 lifecycle.ts:83-85 逐字），其他 errno 原样 rethrow（含 EISDIR 等奇异态，与现状一致）。
6. **RC1 守卫的 grounding 语义**：`recheck !== raw` 判定的是"将判死结论落盘时的文件字节"。字节全等 ⇒ 同一 pid ⇒ 判死结论仍有效，无需重新 kill 探测；不等 ⇒ 结论过期必须回环。内部 `readLockInfo`（lifecycle.ts:35-42）相应重构为 `parseLockInfo(raw: string)`（原始字节 → 字段挑选、吞 parse 错 → {}）——私有函数、语义等价、非导出面变化。
7. **守卫重读失败 → continue（而非 loud）的理由**：失败只可能是「文件已消失」（竞争者已删，回环后 ② wx 直接成功，T7 锚定）或「不可读」（病态环境，回环后由护栏 loud 收口，§7.6 第二行）。二者都不是可行动的错误场景，回环是正确语义而非静默降级。

### §4.3 release()：内容所有权校验删除（替换 lifecycle.ts:90-98）

- 读锁文件全文，**与本次获取写入的 payload 字节串全等**才 unlink；否则立即返回（不动磁盘）。
- 文件不存在 / 读失败 → 吞掉，幂等（保留现状注释语义"已删除/不存在——释放幂等"）。
- **为什么用全字节比较而非字段比较**: nonce 使 payload 每次获取唯一；`content === payload` ⇔ "这文件就是我这次获取写下的"。字段级比较在同进程重复获取场景退化为"同 instanceId+pid 即认领"，不满足 per-handle 语义（I3）。
- **release 自身的 TOCTOU（读→删窗）为何可接受**: 窗内能插入删除/顶替的第三方只可能是 (a) 合法回收者——但其前提是看到我们的 pid 已死，而正在执行 release() 的我们必然活着，矛盾；(b) 误删型攻击者——本修复后已不存在（D2 关闭）。极端交错下即便发生，我方正处于停机路径（release 仅在 shutdown/reload/boot-fail 调用），存活的仍是对方唯一持锁者，I1 不破。详见 §7.2。
- **内容不等 → 静默 no-op 是刻意选择（SA2 攻击点 7 采纳）**: 正常流程中 release 时文件必然是自己写的；不等只可能来自真实竞争/接管，此时不动磁盘恰是保守正确行为。lifecycle.ts 无事件通道、main.ts 在 DENY LIST——为零概率排障场景开诊断通道不值得扩大半径。此声明随实现落入 release 的 JSDoc。

### §4.4 测试 seam（`beforeStaleReclaimDecision`）的取舍

| 备选 | 否决理由 |
|---|---|
| 不加 seam，真进程并发对撞 | 非确定性：OS 调度可能串行化（一者先回收，另一者读到活 pid 直接 loud）→ 测试对**现行坏代码**也可能绿 → 不满足 AC「deterministic concurrency test」，且引入 flake |
| worker_threads 真并行 + Atomics 栅栏 | 并行必然触碰 §7.1 声明的残余窗口（recheck→unlink），在**修复后**代码上仍可能偶发双持 → flaky green，比没有更糟 |
| 注入 fs adapter / 时钟 | 改动面大（签名膨胀、生产路径掺测试对象），违背最小侵入 |
| **采纳：可选第 3 参 hooks，seam①=单一同步回调点**（R2 增 seam②，见下） | 生产调用方（main.ts:122/:183）两参调用不变、零行为差异；seam 在协议里有精确、可推理的位置；先例：`test/harness.ts:209`「testing seam」模式 |

**R2 增补决策（SA2 RC1「二选一」，此处显式选定）**：**采纳增设 seam② `beforeStaleUnlink`**（签名 `(rawStaleContent: string) => void`，触发点 = 判定读之后、守卫重读之前），为 RC1 守卫提供直接确定性红锚 T8。理由：

1. 守卫是 RC1 的修复本体——若仅靠"既有绿契约在守卫加入后仍绿"间接锚定，SA3 漏写或写错守卫（例如只重读不比对、或比对用解析后字段而非原始字节）时 T1-T7 **仍全绿**，无任何用例能抓住；
2. 成本仅 hooks 接口一个可选成员，生产零传参零差异，§7.4 回退对 seam①/seam② 一并覆盖；
3. SA2 §3 RC1 亦推荐此路径（"推荐新增 T8"）。

**否决项**：不为护栏（`MAX_RECLAIM_ATTEMPTS`）增设第三个 seam——该分支不可确定性编排（回环多轮要求在 unlink 与 wx 之间反复插层），以声明 + 静态审查保障（§7.3，SA2 攻击点 4 同判"公共面膨胀不值"）。

### §4.5 诊断文案保留清单（逐字，SA3/SA6 不得改写）

| 文案 | 现位置 | 用途 |
|---|---|---|
| `rootDir lock ${ROOT_LOCK_FILE_NAME} is held by the same instance (${owner}): previous instance did not shut down cleanly — remove the lock file manually if you are certain it is stale (pid reuse caveat: see docs/integration/hub-peer-deployment.md)` | lifecycle.ts:76 | 活 owner + 同 instanceId |
| `shared file persistence root is unsupported: another instance holds ${ROOT_LOCK_FILE_NAME} (${owner}) — each process needs its own rootDir (see docs/integration/hub-peer-deployment.md)` | lifecycle.ts:77 | 活 owner + 异 instanceId（**竞争败者走此文案**，"another instance holds" 即 AC 所指 "reports the root as held"） |
| `cannot write ${ROOT_LOCK_FILE_NAME} in rootDir (${errno}): file persistence requires a writable rootDir — see docs/integration/hub-peer-deployment.md` | lifecycle.ts:84 | EACCES/EPERM 四点映射 |

### §4.6 迭代上限 `MAX_RECLAIM_ATTEMPTS = 8`

每轮 continue 的必要条件是"有他人在本轮内完成了 取锁→死亡→被顶替"的完整周期。现实竞争方 ≤2-3（supervisor 重启风暴），8 轮是两个数量级冗余。超限 loud throw 而非死循环，符合本应用「boot 期任何异常路径 loud exit」的一贯哲学（对照 main.ts boot 失败即 exit 1）。该上限**不是**可调配置——它是护栏不是策略。

---

## §5. 确定性红灯契约（SA6 落盘 `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`）

通用约定：

- import 走**冻结公共入口** `../src/index.js`（`acquireRootLock` / `ROOT_LOCK_FILE_NAME`；先例 issue164 系列测试），不直引 `lifecycle.ts` 内部符号。类型导入必须写 `import { acquireRootLock, ROOT_LOCK_FILE_NAME, type RootLockAcquireHooks } from '../src/index.js'`——`apps/yjs-server` tsconfig 启用 `verbatimModuleSyntax`，裸类型导入会使 `pnpm typecheck` 红（SA2 E8/攻击点 5）。
- 每用例 `mkdtempSync` 独立 rootDir，`afterEach` `rmSync(recursive, force)`（沿 smoke 测试清理模式）。
- **确定性死 pid**：`const DEAD_PID = 2 ** 31 - 1;`（> Linux `pid_max` 上限 4194304，恒 ESRCH）。用例内前置断言 `expect(() => process.kill(DEAD_PID, 0)).toThrow()` 防环境异常。
- **零 sleep、零真并发、零进程 spawn**（T3-unwritable 的 chmod 是唯一 fs 权限操作）→ 全部确定性。
- 锁文件路径：`join(rootDir, ROOT_LOCK_FILE_NAME)`。

### T1 — 正常获取/所有权/幂等释放（绿锚，修复前后均绿）

1. `h = acquireRootLock(root, 'instance-A')` → `existsSync(lockFile)` true；解析 JSON：`instanceId === 'instance-A'`、`pid === process.pid`、`typeof nonce === 'string'`（schema pin）。
2. `h.release()` → 文件不存在。
3. 再 `h.release()` → 不抛（幂等保留）。

### T2 — 单回收者 stale 回收（绿锚；AC4 单进程 stale 恢复的单元级形态）

1. 种子 `writeFileSync(lockFile, JSON.stringify({ instanceId: 'dead-instance', pid: DEAD_PID }), { flag: 'w' })`。
2. `h = acquireRootLock(root, 'instance-A')`（不传 hooks）→ 成功；文件内容为**本进程** payload（解析比对 instanceId/pid，不比对 nonce）。
3. `h.release()` → 文件不存在。

### T3 — 活 owner 双态诊断 + 不可写 root（绿锚，文案逐字 pin）

1. 种子 `{instanceId:'instance-A', pid: process.pid}`（活）→ `acquire(root, 'instance-A')` throw `/held by the same instance/` 且 `/pid reuse caveat/`。
2. 种子 `{instanceId:'instance-B', pid: process.pid}` → `acquire(root, 'instance-A')` throw `/shared file persistence root is unsupported/` 且 `/another instance holds/`。
3. （root 环境跳过：`process.getuid?.() === 0` 时 `it.skip`）`chmodSync(root, 0o500)` → `acquire` throw `/cannot write \.nomicore-lock\.json/` 且 `/writable rootDir/`。**chmod 还原必须包进 `try/finally`**（断言先抛也保证 `0o700` 还原，afterEach 的 `rmSync` 才能清得动目录——SA2 攻击点 5 采纳）。

### T4 — 双 stale 回收者确定性竞态：恰一胜、败者 held、胜者锁不被覆写（**核心红灯**，AC1+AC2）

```ts
let winner: RootLockHandle | undefined;
let hookFired = 0;
const loserAttempt = () =>
  acquireRootLock(root, 'instance-A', {
    beforeStaleReclaimDecision: () => {
      hookFired += 1;
      if (hookFired === 1) {
        // 竞争者 B 在 A 的「EEXIST 之后、判定读取之前」窗口内完整完成重取：
        // B: wx→EEXIST(种子 stale) → 读 DEAD_PID 判死 → unlink 种子 → wx 成功 → 持锁返回。
        winner = acquireRootLock(root, 'instance-B');
      }
    },
  });

// 败者：读到 B 的活 pid → loud「held」，绝不覆写 B 的锁
expect(loserAttempt).toThrow(/another instance holds|shared file persistence root is unsupported/);
expect(hookFired).toBe(1);                    // A 只走到判定一次即抛
expect(winner, 'exactly one reclaimer acquires').toBeDefined();

// 胜者锁存活：内容仍是 B（A 的失败尝试没有碰它）
const survivor = JSON.parse(readFileSync(lockFile, 'utf8'));
expect(survivor.instanceId).toBe('instance-B');
expect(survivor.pid).toBe(process.pid);

winner!.release();
expect(existsSync(lockFile)).toBe(false);     // 胜者正常释放
```

- **红（现状）**: 现函数签名两参，第 3 参被 JS 静默忽略 → seam 不触发 → `hookFired === 0`、`winner === undefined`，且 `loserAttempt()` 经 `flag:'w'` 覆写**正常返回 handle**（不 throw）→ `toThrow` 断言失败 = **确定性红**（无概率成分）。
- **绿（修复后）**: seam 触发 → B 完整持锁 → A 判定读见 B 活 pid → loud throw；A 从未执行 unlink/覆写。
- 附带覆盖：恰一胜者（B）、败者 held（A）、胜者锁不被败者覆写/删除——AC1+AC2+AC3 的败者侧全在此。
- **三重红锚（nothrow / `hookFired===0` / survivor 字节）SA6 必须齐备**——任一单锚在实现走样时都可能假绿（SA2 §3 加固建议采纳，SA6 不得削减）。

### T5 — 迟到/过期 handle 不能删后继者的锁（**核心红灯**，AC3）

```ts
const stale = acquireRootLock(root, 'instance-A');            // 本 handle 获取时的 payload 含 nonce₁
const successorPayload = JSON.stringify({ instanceId: 'instance-B', pid: process.pid, nonce: 'successor' });
writeFileSync(lockFile, successorPayload, { flag: 'w' });     // 模拟后继者已顶替（内容 ≠ stale 的 payload）
stale.release();
expect(existsSync(lockFile), 'late release must not unlink successor lock').toBe(true);
expect(readFileSync(lockFile, 'utf8'), 'successor payload byte-identical after late release').toBe(successorPayload);  // 逐字节（SA2 §3 加固采纳，不只查 instanceId）
rmSync(lockFile);                                             // 清理
```

- **红（现状）**: release 无条件 `unlinkSync` → 文件被删 → `toBe(true)` 失败 = 确定性红。
- **绿（修复后）**: 内容 ≠ 本 handle payload → 立即返回，文件存活。

### T6 — 空文件 / 非法 JSON 锁视作 stale 可回收（绿锚，pin 现状防回归；R2 增 RC2 空串变体）

两个子用例（同构断言，仅种子不同）：

1. 种子 A：`writeFileSync(lockFile, 'not-json', { flag: 'w' })`（非法 JSON）。
2. 种子 B：`writeFileSync(lockFile, '', { flag: 'w' })`（**空文件**——并发部分写窗的可观测投影，RC2 pin：`JSON.parse('')` 抛 → {} → 判死 → 回收）。
3. 各自 `acquire(root, 'instance-A')` → 成功持锁（parse 吞错 → {} → pid undefined → 判死 → 守卫字节全等（`'not-json' === 'not-json'` / `'' === ''`）→ unlink → wx 原子重取）；文件为本进程 payload；release 清理。
4. 真正的**并发**部分写窗不可确定性测试（需两次读+unlink 全落在竞争者单次 write 窗内）——如实标注为 SA7 动态/推演域（§7.5）。

### T7 —（pin）seam① 中他人已删 stale → 守卫重读 ENOENT 回环仍可取锁

seam① 内 `rmSync(lockFile)`（模拟竞争者删完 stale 还没建新锁）→ A 判定读失败（raw='' → {} → 判死）→ 守卫重读 ENOENT → continue → ② wx 成功持锁。修复后绿（真回环路径，§4.2 关键点 7 的"消失"分支）；现状代码因 seam 被忽略直接 `flag:'w'` 覆写种子也绿——**行为 pin，非红灯**，用于锁住「读失败→回环→wx 直取」语义。

### T8 — RC1 守卫直接红锚：判定读→unlink 窗内被竞争者顶替 → 回环重判 loud held、胜者锁逐字节存活（**核心红灯**，R2 依 SA2 RC1 增设，seam②）

```ts
const seedPayload = JSON.stringify({ instanceId: 'dead-instance', pid: DEAD_PID });
writeFileSync(lockFile, seedPayload, { flag: 'w' });             // 种子 stale 锁 F1
const winnerPayload = JSON.stringify({ instanceId: 'instance-B', pid: process.pid, nonce: 'winner' });
let rawSeen: string | undefined;
let unlinkHookFired = 0;

const loserAttempt = () =>
  acquireRootLock(root, 'instance-A', {
    beforeStaleUnlink: (rawStaleContent) => {
      unlinkHookFired += 1;
      rawSeen = rawStaleContent;
      if (unlinkHookFired === 1) {
        // 模拟竞争者 B 恰在 A 的「判定读 → unlink」窗内完成完整回收
        // （B: unlink F1 + wx 建新锁；测试侧以整体替换等价模拟——生产代码无 flag:'w'）。
        writeFileSync(lockFile, winnerPayload, { flag: 'w' });
      }
    },
  });

expect(loserAttempt).toThrow(/another instance holds|shared file persistence root is unsupported/);
expect(unlinkHookFired).toBe(1);
expect(rawSeen, 'grounding bytes = seed payload').toBe(seedPayload);
// 胜者锁逐字节存活（A 的守卫拒绝了删除，回环重判后 loud 退出）：
expect(readFileSync(lockFile, 'utf8')).toBe(winnerPayload);
rmSync(lockFile);
```

- **红（现状）**：第 3 参被忽略 → seam② 不触发（`unlinkHookFired === 0`）→ A 经 `flag:'w'` 覆写**正常返回 handle**（无 throw）且文件被覆写为本进程 payload——`toThrow` 失败 + `unlinkHookFired===0` + `rawSeen===undefined` + 文件 ≠ winnerPayload **四重红锚**。
- **绿（修复后）**：判定读 grounding = F1 字节 → seam② 注入顶替 → 守卫重读 ≠ grounding → continue → ② wx 撞 EEXIST → ③ 判定读 = winnerPayload → pid 活 → loud throw（instance-B ≠ instance-A → shared-root 文案）。A 从未执行 5c unlink，胜者锁逐字节无损。

### T9 —（pin，root 跳过）release 遇不可读锁文件：no-op 不抛、文件残留（RC3 行为 delta 锚）

1. `h = acquireRootLock(root, 'instance-A')` → `chmodSync(lockFile, 0o000)`。
2. `h.release()` → **不抛**；`existsSync(lockFile)` true（修复后语义：读失败 → 吞错 no-op，§7.6）。
3. **root 环境跳过**（`process.getuid?.() === 0` 时 `it.skip`）：root 读不受 000 限制 → 修复后代码会读到自己的 payload 并正常删除，断言必假。
4. 清理：`chmodSync(lockFile, 0o600)` 后 `rmSync`（包 try/finally）。

- **红（现状）**：现状 release 不读内容、无条件 unlink（unlink 只需父目录写权限）→ 文件被删 → `toBe(true)` 失败——在现状即确定性红，兼作 RC3 delta 的防回归锚。

### 红/绿矩阵

| 契约 | 现状代码 | 修复后 |
|---|---|---|
| T1 正常获取/释放/幂等 | 🟢 | 🟢 |
| T2 单回收者 stale | 🟢 | 🟢 |
| T3 双态诊断 + 不可写 | 🟢 | 🟢 |
| **T4 竞态恰一胜 + 败者 held**（seam①） | 🔴（seam 被忽略 → 无 throw + winner undefined） | 🟢 |
| **T5 迟到 release 不误删** | 🔴（无条件 unlink） | 🟢 |
| T6 空文件/非法 JSON 视 stale（RC2 pin） | 🟢 | 🟢 |
| T7 守卫重读 ENOENT 回环（pin） | 🟢（假绿：seam 忽略） | 🟢（真回环路径） |
| **T8 判定→unlink 窗被顶替 → 守卫拒绝 + loud held**（seam②，RC1） | 🔴（seam 被忽略 → 无 throw + `unlinkHookFired===0` + 文件被覆写） | 🟢 |
| T9 release 不可读文件 no-op（RC3 delta，root skip） | 🔴（无条件 unlink 删掉文件） | 🟢（非 root） |

存量真进程级测试（**不改动、必须保持绿**，构成 AC4/AC5 的进程级证据）：`smoke-skeleton-red.test.ts`（:272 干净停机释放锁+同 rootDir 重启；:319 共享活跃 root loud 拒绝）、`phase5-three-instance-acceptance-red.test.ts`（:361 AC6 SIGKILL 硬崩溃 → 同 rootDir 重启 stale 重取）、`phase5-mgmt-verbs-sa7.test.ts`、`lifecycle-watchdog-red.test.ts`。

---

## §6. 兼容性影响评估

### §6.1 `main.ts` 调用路径逐条（**零改动**）

| 路径 | 行号 | 修复后行为 | 差异 |
|---|---|---|---|
| boot 获取 | main.ts:183 | 2 参调用，签名向后兼容；fresh/stale/活 owner 三态文案不变 | 无 |
| reload 重取 | main.ts:122 | 同上 | 无 |
| shutdown 释放 | main.ts:71 | 本 handle 持锁 → 内容相等 → unlink（与现状同效） | 无 |
| reload 释放 | main.ts:118 | 同上 | 无 |
| reload→memory 残留 handle 再释放 | main.ts:71（二次信号时） | **行为改进**：现状会误删他人锁（§1 D2 路径 1）→ 修复后内容不等 → no-op | 修复目标 |
| boot ready 失败释放 | main.ts:206 | 本 handle 持锁 → unlink | 无 |

### §6.2 依赖锁文件可观测面的测试（**零改动、保持绿**）

| 测试 | 依赖点 | nonce 影响 |
|---|---|---|
| `phase5-three-instance-acceptance-red.test.ts:196` `hardCrashByLock` | `JSON.parse(lock).pid` → SIGKILL 真实进程 | 无（字段挑选式解析） |
| `phase5-mgmt-verbs-sa7.test.ts:206` 同上 | 同上 | 无 |
| `smoke-skeleton-red.test.ts:334` | stderr 匹配 `/\.nomicore-lock\.json\|lock/i` | 无（文案保留） |
| `docs/integration/hub-peer-deployment.md:196` | 文档描述 payload `{instanceId, pid}` | docs 随设计更新一句话（ALLOW LIST） |

### §6.3 payload schema `{instanceId, pid}` → `{instanceId, pid, nonce}`

全仓 `grep 'nomicore-lock'` 消费面核对（证据命令见 §9）：消费方全部是"解析后挑字段"（pid / instanceId）或"正则匹配文件名"，无任何"全量字节比对"或 schema 白名单校验。新增键是纯加法。`readLockInfo`（lifecycle.ts:35-42）本就只显式挑 `instanceId`/`pid` 两键，天然忽略 nonce（R2：该私有函数重构为 `parseLockInfo(raw)`，字段挑选语义不变，见 §4.2 关键点 6）。

### §6.4 依赖与构建

- 新增 import 仅 `node:crypto` 的 `randomUUID`（Node ≥14.17 内建；repo engines `>=20`），**零新增第三方依赖**。
- vitest 收集模式 `apps/*/test/**/*.test.ts` 已覆盖新测试文件；root `pnpm typecheck` 已含 `apps/yjs-server`。

---

## §7. 残余风险与边界声明（对 SA2 预先亮牌）

### §7.1 acquire 侧残余窗口（R2 依 RC1 重述：撤回 R1 错误论断，剩余窗 = 相邻「守卫重读 → unlink」）

真并行下（非 seam 编排）残余窗口**非零**。R1 第 3 点曾断言"窗口已压到该协议形态的最小值"——**该断言错误，予以撤回**（SA2 攻击点 1）：R1 伪码中判死结论（③ 判定读）与 unlink（⑤）之间还插着 `isPidAlive` 的 kill(2) 探测与回环簿记，最可几的竞态变体（竞争者 B 在 A 探测/簿记期间完成「unlink stale + wx 建新锁」）恰好落在这个宽窗里——A 的 unlink 删掉的是 B 的活锁，A 随后 wx 成功 → 双持，恰是 issue 要消灭的 bug 类。

**R2 修复（RC1）**：unlink 前增设**内容守卫**——判定读保存 grounding 原始字节，紧贴 unlink 重读并逐字节比对，不等或读失败 → `continue` 回环重判（§4.2 ⑤b）。三变体对照：

| 交错变体 | R1（无守卫） | R2（有守卫） |
|---|---|---|
| B 在 A 判定读**之前**完成回收（含 seam①/T4 编排位） | A 判定读见 B 活 pid → loud held ✅ | 同左（守卫不可达）✅ |
| B 在 A「判定读 → kill 探测/簿记」期间完成回收（**最可几宽窗**，seam②/T8 编排位） | A unlink 删 B 活锁 → A wx 成功 → **双持 ❌** | 守卫重读 ≠ grounding → 回环 → 判定读见 B 活 pid → loud held ✅ |
| B 在 A「守卫重读 → unlink」两相邻系统调用之间完成「unlink stale + wx 建新锁」 | （经同一缺陷路径）❌ | A unlink 删 B 活锁 → A wx 成功 → 双持 ❌ **残余窗（唯一存活变体）** |

剩余窗定性：read → unlink 两条相邻系统调用，B 须在其中完成自身 unlink+wx 两条系统调用——四条系统调用精确对撞，亚微秒级。它非零的根因是用户态文件锁（O_EXCL + stale-break，即 dotlockfile/lockfile(1) 族）的固有语义；彻底消除需内核原语（flock/fcntl——进程死亡时内核自动释放、根本无需 stale 回收），Node 核心不暴露 flock，引入原生依赖超出本 issue 半径（SA2 §5「明确不要求」亦确认 rename-quarantine 无窗方案不做）。issue #191 的处方（atomic exclusive-acquisition loop, never through a non-exclusive overwrite）本设计完整满足：所有权转移全部经 `wx` 裁决，`flag:'w'` 从函数中彻底消失。

部署形态补充：docs 明确每进程独立 rootDir（共享仅是误配），同 rootDir 竞争方 ≤2-3；确定性测试（T4/T5/T8）编排的交错均落在守卫可裁决的变体行，其断言属性在任何调度下由不变量 I1-I3 保证。

### §7.2 release 侧读→删窗：良性论证

见 §4.3 第 3 点。唯一能合法进入"删他人锁"位置的主体是"看到我 pid 已死的回收者"，而 release 执行者必然活着——逻辑互斥。极端交错下我方已处停机路径，I1 仍不破。

### §7.3 `MAX_RECLAIM_ATTEMPTS` 超限是新的 loud 失败路径

仅在"回收churn 风暴"（本轮内他人取锁→死亡→被顶替 ≥8 个周期）触发，生产不可达；触发时 loud throw 而非 boot 期死循环。这是防活性（liveness）护栏，不改变任何现有可达路径的判定。

**护栏不可确定性测试（SA2 攻击点 4 声明）**：seam①/② 均无法在「unlink 与 wx 之间」或「wx 撞 EEXIST 后连续多轮」插层编排 churn，故该分支无直接确定性用例。保障方式 = (a) 有界回环不变量（所有 `continue` 路径必经 attempt 计数，SA4 静态审查核对）+ (b) throw 文案含 `did not converge`（可 grep 锚定）。**不为它增设第三个 seam**（公共面膨胀不值，SA2 同判）。

### §7.4 seam 是生产 API 面的永久增项

可选参数 + 导出类型，文档注释明示"测试编排用"；生产调用方零传参零差异。若 SA2 认为污染公共面，降级备选是把 hooks 类型从 `index.ts` 公共导出撤回、仅 `lifecycle.ts` 导出（测试直引 `../src/lifecycle.ts`，先例 `ws-server-upgrade-admission.test.ts:3`）——**预留此回退，不改变协议本体**。（R2：回退对 seam①/seam② 两个成员一并覆盖；SA2 攻击点 6 维持观察，JSDoc「测试编排用、生产调用方不得传」注释随实现落地。）

### §7.5 部分写入可见窗（R2 依 RC2 披露：现状既有、非本设计引入）

`writeFileSync(..., { flag: 'wx' })` 是 open(O_EXCL) → write → close 三段，**不是**原子的"带内容创建"。并发者的判定读可能落在 open 与 write 完成之间，读到空/半截文件 → `JSON.parse` 抛 → {} → 判 stale → 可能 unlink 一个**活进程刚创建**的锁。

- **现状既有**：main 现网 `lifecycle.ts:66` 首取即存在同窗（任何并发读者都可能读到空锁）；本设计的 wx 写入形态与之相同（payload <200B，单次 write），**不使风险变大**。
- **本设计的净效果是收窄**：判定读与 unlink 之间多了守卫重读（RC1）——竞争者的 write 若在两次读之间完成，守卫即不相等 → 回环 → loud held。触发残余需**判定读与守卫重读两次都落在同一竞争者的单次 write 窗内**（三次相邻系统调用对撞），概率远低于 R1 形态。
- **硬化路径（本 issue 半径外，仅记录不做）**：先写唯一 temp 文件再 `link(2)` 原子发布完整内容（解决内容原子性；注意它不解决 stale 替换问题，与 RC1 守卫正交）。若未来引入需另立 issue。
- **可观测锚点**：T6 种子 B（空文件）pin 住「空/半截内容 = 可回收」这一语义本身——该语义与部分写窗的组合风险以本节披露为准；真正的并发部分写窗不可确定性测试，归 SA7 动态/推演域。

### §7.6 不可读锁文件的两个行为 delta（R2 依 RC3 披露并声明接受）

| 面 | 现状 | 修复后 | 定性 |
|---|---|---|---|
| release：文件存在但不可读（如被 chmod 000） | 不读内容、无条件 unlink（unlink 只需父目录写权限）→ **文件被删** | `readFileSync` EACCES → 吞错 no-op → **锁残留** | **接受 delta（RC3）**。理由：部署不变量 = 锁文件由本进程以默认权限（0o644）创建，被外部 chmod 000 的锁不在支持流程内；且"读不到就当作不是自己的而不删"是保守正确方向（fail-safe：绝不删无法证明所有权的文件）。T9 钉住该行为防回归漂移 |
| acquire：锁文件不可读（病态） | loud `cannot write .nomicore-lock.json`（'w' 覆写撞 EACCES） | 判定读/守卫读均失败 → 回环 → 护栏 loud `did not converge` | 两者均 loud 退出、仅文案不同；触发前提是被外部 chmod 的病态环境，不构成回归面（§2 矩阵「不可读」两行） |

---

## §8. 协议假设依据 (Protocol Assumption Evidence)

本设计**无 HTTP/WS/端口级假设**（不涉及网络面）；涉及的是本地文件系统与信号原语语义，逐条给出依据：

| # | 假设 | 依据类型 | 依据内容（具体引用） | 风险等级 |
|---|---|---|---|---|
| P1 | `writeFileSync(path, data, {flag:'wx'})` = O_EXCL 原子独占创建，已存在 → 抛 EEXIST | 源码引用 + 现有测试引用 + 官方文档 | Node 官方文档 fs file-system-flags：`wx`/`wx+` "fails if the path exists"（对应 open(2) O_EXCL，POSIX 保证 check-and-create 原子）；现网已在依赖此语义：`lifecycle.ts:66` 首取 + `smoke-skeleton-red.test.ts:319`「共享活跃 root loud 拒绝」在 main 上绿 | 低 |
| P2 | `unlinkSync` 无条件删除，路径不存在 → 抛 ENOENT | 官方文档 + 源码引用 | POSIX unlink(2)；现网已依赖：`lifecycle.ts:93-96` release 的幂等性即建立在"吞 ENOENT"上 | 低 |
| P3 | `process.kill(pid, 0)`：进程不存在 → 抛 ESRCH；存在但无权限 → 抛 EPERM（视作活） | 源码引用 | `lifecycle.ts:44-52` `isPidAlive` 现实现逐字依赖（EPERM → true）；本设计不改动该函数 | 低（零改动） |
| P4 | `DEAD_PID = 2**31-1` 恒为死 pid | 类比已有系统参数 + 设计期验证 | Linux `pid_max` 上限 4194304（`/proc/sys/kernel/pid_max`，2^22），2^31-1 不可能被分配；用例内前置断言 `process.kill(DEAD_PID,0)` 抛错兜底（SA6 落盘时执行验证） | 低 |
| P5 | `randomUUID()` 每次获取唯一 | 官方文档 | node:crypto `randomUUID`（RFC 4122 v4，122 bit 随机）；唯一性只需单机同时代不碰撞，概率可忽略 | 极低 |
| P6 | chmod 0o500 目录 → 写入抛 EACCES（非 root） | 设计期验证约定 | T3 用例带 `process.getuid?.() === 0` skip 守卫 + 文案断言 `/cannot write/` 兜底；SA6 落盘时在 CI 环境实测（若 root 环境则该子用例 skip，不影响红灯主体） | 低 |
| P7 | chmod 000 的**文件**：属主读取抛 EACCES（非 root）；unlink 仅需**父目录**写+执行权限、与文件自身 mode 无关 | 官方文档（POSIX） | POSIX `unlink(2)`：删除要求的是对**目录**的写权限（"write permission is denied for the directory"），文件自身权限不参与；读取按文件 mode 判定（`access(2)` 语义）。T9 带 root skip 守卫 + 双断言（不抛 + 文件仍在）兜底；SA6 落盘时实测 | 低 |

---

## §9. 契约改动连锁审计 (Contract Change Caller Audit)

### 改动函数

| 函数 | 文件 | 改动前契约 | 改动后契约 |
|---|---|---|---|
| `acquireRootLock` | `apps/yjs-server/src/lifecycle.ts:60` | `(rootDir: string, instanceId: string) => RootLockHandle`；stale 经 `flag:'w'` 覆写回收 | `(rootDir: string, instanceId: string, hooks?: RootLockAcquireHooks{beforeStaleReclaimDecision?, beforeStaleUnlink?}) => RootLockHandle`；stale 经 守卫+unlink+wx 原子环回收；**无新增 throw 类型**（现有三族 loud 文案语义保留，另增护栏文案，均为 `Error`；R2 hooks 增第二可选成员，向后兼容不变） |
| `RootLockHandle.release` | `apps/yjs-server/src/lifecycle.ts:90-98` | `() => void`；无条件 `unlinkSync`（吞一切错） | `() => void`；内容等于本 handle payload 才 unlink，否则 no-op（仍吞一切错）——**throw 面不变（永不 throw）** |

**契约形态结论**: 两个函数的返回类型、throw 类型、await 形态（均同步）不变；`acquireRootLock` 新参为可选尾参（向后兼容）。`release()` 的磁盘副作用收窄是本 issue 的修复目标本身。

### Caller 清单（抓取命令：`git grep -n "acquireRootLock\|\.release()" -- 'apps/**/*.ts'`）

| Caller | 文件:行号 | 是否 await | 直接 try/catch | 顶层 catch-all | 处置方案 |
|---|---|---|---|---|---|
| boot 获取 | `apps/yjs-server/src/main.ts:183` | 否（同步） | ✅ try/catch → stderr + `process.exit(1)` | N/A | 零改动；新增护栏 throw 同样被此 catch 接住 loud 退出 |
| reload 重取 | `apps/yjs-server/src/main.ts:122` | 否 | ✅ try/catch → `failBoot`（exit 1） | N/A | 零改动 |
| shutdown 释放 | `apps/yjs-server/src/main.ts:71` | 否 | ✅ 外层 try/catch（:69-76）→ exit 1 | N/A | 零改动；release 永不 throw，行为对正当 owner 等价 |
| reload 释放 | `apps/yjs-server/src/main.ts:118` | 否 | ✅ reload 整体 try/finally（:96-137） | ✅ watchdog 兜底 exit(1) | 零改动 |
| boot ready 失败释放 | `apps/yjs-server/src/main.ts:206` | 否 | ✅ `.catch`（:204-208）→ exit 1 | N/A | 零改动 |
| 真进程测试（经公共入口） | `apps/yjs-server/test/smoke-skeleton-red.test.ts:272/:319`、`phase5-three-instance-acceptance-red.test.ts:361`、`phase5-mgmt-verbs-sa7.test.ts` | N/A（子进程面） | N/A | N/A | 零改动，必须保持绿（§6.2） |
| 新红灯测试 | `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts`（新建） | 否 | 按用例 `toThrow` | N/A | [SA6 owned] |

### 风险评估

- 遗漏 caller 的代价：本设计无 `return→throw` 类契约翻转、无 async 化、无 nullable 变化；最坏情形是某个未列 caller 依赖了"release 必删文件"——全仓 grep 证明 release 语义消费方仅 `main.ts` 三处 + handle 内部（上表已全覆盖），且"必删他人锁"恰是要修的 bug。
- `index.ts:59-60` 需同步 re-export `type RootLockAcquireHooks`（1 行，公共入口测试导入依赖它；若 SA2 攻击公共面污染，按 §7.4 回退）。

---

## §10. 文件清单（File Scope）

### ALLOW LIST

- `apps/yjs-server/src/lifecycle.ts` — 修改：§4.2 守卫+原子重取环替换 :60-99 主体（删 :81 `flag:'w'`）、§4.1 nonce、§4.3 所有权校验 release（含"静默是刻意选择"JSDoc）、§4.4 seam①② 类型与 JSDoc、`readLockInfo`→`parseLockInfo(raw)` 内部重构、`node:crypto` import（R2 估 +75/−22 行）
- `apps/yjs-server/src/index.ts` — 修改：re-export `type RootLockAcquireHooks`（含 seam①② 两成员，+1 行，§9 caller 审计）
- `apps/yjs-server/test/root-lock-atomic-reclaim-red.test.ts` — `[SA6 owned]` 新建：§5 T1-T9 确定性红灯/绿锚契约（含 R2 增设 T8 守卫红锚、T9 RC3 delta 锚、T6 空文件 pin；估 ~280 行）
- `docs/integration/hub-peer-deployment.md` — 修改：:194-207 锁语义段同步（payload 增 nonce、stale 改"守卫+原子独占重取环"、release "仅删本 handle 所有权对应的锁、读不到即不动"）（~8 行，纯文档）

### DENY LIST

- `apps/yjs-server/src/main.ts` — 全部 caller 兼容（§9 审计），零改动
- `apps/yjs-server/test/smoke-skeleton-red.test.ts` — 存量契约，只许绿不许动
- `apps/yjs-server/test/phase5-three-instance-acceptance-red.test.ts` — 同上
- `apps/yjs-server/test/phase5-mgmt-verbs-sa7.test.ts` — 同上
- `apps/yjs-server/test/lifecycle-watchdog-red.test.ts` — 同上
- `packages/**` — 本 issue 半径外（锁只在 app 层）
- 根/应用 `package.json`、`vitest.config.ts`、`tsconfig*.json` — 零新依赖、零构建变更（§6.4）
- `apps/yjs-server/src/config.ts`、`app.ts`、`transport/**` — 与锁无关

---

## §11. SA2 反馈逐条回应

> R1 评审报告：`wiki/raw/task_191_sa2.md`（verdict: reject；必需修订清单 = 其 §5 的 RC1/RC2/RC3）。R2 逐条落实如下；SA2 §6 六项攻击存活确认（wx 唯一出口 / nonce 字节级 release / seam① 位置与 T4/T5 机制 / 三族文案 / 存量测试零改动 / ALLOW-DENY 边界）本修订全部维持，未做任何削弱。

| 要求 | 是否落实 | 修订位置 | 修订内容摘要 |
|------|:--:|------|------|
| RC1-a（MAJOR）：unlink 前内容再验证（保存判定读原始字节、紧贴 unlink 重读比对；不等/读失败 → continue） | ✅ | §4.2 ③/⑤a/⑤b 伪码、关键点 6/7 | 判定读改取原始字节（grounding，读失败→'' 语义等价 readLockInfo 吞错→{}）；⑤b 新增守卫重读逐字节比对，不等或读失败即 continue 回环重判；`readLockInfo` 重构为 `parseLockInfo(raw)`（私有、语义等价） |
| RC1-b（MAJOR）：撤回 §7.1.3「最小值」错误论断，如实重述剩余窗 | ✅ | §7.1（整节重写） | 显式撤回 R1 论断；三变体对照表：最可几宽窗（判定读→kill 探测期间被顶替）由守卫关闭；剩余窗如实定为相邻「守卫重读 → unlink」两条系统调用（四条系统调用精确对撞） |
| RC1-c（MAJOR）：`beforeStaleUnlink` + T8 二选一，文档显式选定 | ✅ | §4.4「R2 增补决策」、§4.2 hooks 接口、§5 T8 | **选定：增设 seam② `beforeStaleUnlink(rawStaleContent)`（判定读后/守卫重读前）+ T8 直接红锚（四重锚：nothrow / unlinkHookFired / rawSeen / survivor 字节）**；理由 = 守卫为修复本体需直接锚定（间接回归锚抓不住漏写/写错）+ 成本一个可选成员 + SA2 §3 推荐；护栏不设第三 seam |
| RC2（MINOR）：§7 增补部分写入可见窗披露；§5 可选补空文件 pin | ✅ | §7.5（新增）、§5 T6 种子 B、§2 矩阵行 | 披露：现状既有（lifecycle.ts:66 同窗）、非本设计引入、RC1 守卫反而收窄（需两次读都落单次 write 窗）、硬化路径 temp+link(2) 半径外仅记录；T6 增空文件子用例 pin「空内容=可回收」 |
| RC3（MINOR）：§2 矩阵补「release：文件存在但不可读」行并声明接受 delta | ✅ | §2 矩阵行、§7.6（新增）、§5 T9 | 现状「unlink 成功（无需读权限）」→ 修复后「no-op 残留」；接受理由 = 部署不变量（本进程默认权限创建）+ fail-safe 方向；T9（root skip）钉行为；顺带披露 acquire 侧不可读的文案级 delta（§7.6 第二行） |
| 攻击点 4（建议）：护栏不可确定性测试的如实声明 | ✅ | §7.3 增补 | 声明 seam①/② 均无法编排 churn 多轮；保障 = 有界回环不变量 + SA4 静态核对 continue 必经计数 + `did not converge` 可 grep；不为它增设第三 seam |
| 攻击点 5（建议）：T3 chmod 还原 try/finally；`import type` 形式 | ✅ | §5 通用约定、T3.3 | 类型导入明确 `import { ..., type RootLockAcquireHooks }`（verbatimModuleSyntax 下裸类型导入 typecheck 红）；chmod 0o700 还原入 try/finally |
| 攻击点 7（OBSERVATION）：release 静默 no-op 的刻意性声明 | ✅ | §4.3 增补 | 「静默是刻意选择」入设计文档并要求随实现落 release JSDoc；不开诊断通道（main.ts 在 DENY LIST） |
| §3 加固建议（非必改）：T5 逐字节断言；T4 三重红锚保持 | ✅ | §5 T5、T4 | T5 增 `toBe(successorPayload)` 逐字节断言；T4 明示三重锚 SA6 不得削减 |
