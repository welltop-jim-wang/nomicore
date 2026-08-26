/**
 * 测试共享：有界轮询磁盘持久化事实（FilePersistence crash-restart 竞态守卫）。
 *
 * 背景（issue #108 CI 修复轮，run 32882227927 / job 97914236174）：AC5 追加块 U-3
 * 以固定 sleep(100) + 一次性 restart().loadDoc 断言 committed 值落盘，在重载 CI
 * 上偶现「expected 1 to be 9」（1222/1223，Node 24 矩阵偶现）。根因是**最终持久化**
 * 的时序假设错误：saveDoc 只是 dirty 登记（ADR-0006——登记后由持久层内部 retry 以
 * 完整 Y.Doc 状态最终持久化），落盘由 debounce(5ms) + 内部 retry 保证最终完成，
 * 契约不承诺固定时限内完成；并发 crash-restart 读的 readFile 可落入 flush 的
 * writeFile→rename 之间读到落盘前旧快照——固定时间采样与异步 flush 写读竞态。
 * 本文件中与 U-3 同款的 sleep(100)+一次性读模式（AC1 File 全链）及
 * production-assembly T5.2 同源。
 *
 * 本模块从测试侧提供确定性等待：直接原子读磁盘 committed 快照文件（与 FilePersistence
 * 的 writeCommittedSnapshot/resolveSnapshotPaths 同布局：rootDir/users/{userId}/
 * {docId}.snapshot），直到目标字段等于期望值或有界超时（超时响亮失败——真实持久化
 * 缺陷仍会被抓，不削弱断言）。**刻意不使用 loadDoc 轮询**：loadDoc 的读路径会清理
 * 残留 tmp（readCommittedSnapshot 的 rm），在 flush 尚未完成的窗口内会销毁其
 * writeFile 产物、令当次 rename ENOENT 转 retry——放大延迟下会与慢 flush 形成
 * 读-清理打搅（确定性验证脚本实测）；直接文件读只观测 rename 后的 committed 内容，
 * 不干扰写路径。一次性 restart().loadDoc 断言（含 rm 清理）仍保留在轮询之后：
 * 磁盘事实已成立且无在途写时，它不再有竞态。
 *
 * 文件名不匹配 vitest include 的 *.test.ts / *.test-d.ts 模式，不被收集为测试文件。
 */
import { expect } from 'vitest';
import * as Y from 'yjs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import type { User } from '@nomicore/persistence';

const POLL_OPTIONS = { interval: 25, timeout: 5_000 } as const;
const MISSING = 'missing';

/**
 * 有界轮询：直到磁盘 committed 快照文件中 field(doc) === expected。
 * 每次轮询直接 readFile 快照文件并 decode（rename 原子性保证读到整份新/旧快照，
 * 无半写状态）；磁盘事实达成后不再有任何后续写，随后的一次性断言即确定。
 */
export async function waitDurableSnapshot(
  owner: User,
  docId: string,
  rootDir: string,
  field: (doc: Y.Doc) => unknown,
  expected: unknown,
): Promise<void> {
  const snapshotPath = path.join(rootDir, 'users', owner.userId, `${docId}.snapshot`);
  await expect
    .poll(
      async () => {
        const raw = await fsp.readFile(snapshotPath).catch(() => null);
        if (raw === null) return MISSING;
        const doc = new Y.Doc();
        Y.applyUpdate(doc, raw);
        const value = field(doc);
        doc.destroy();
        return value;
      },
      POLL_OPTIONS,
    )
    .toBe(expected);
}
