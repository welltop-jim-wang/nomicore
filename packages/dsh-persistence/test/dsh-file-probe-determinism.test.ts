/**
 * SA7 补充回归锚（Phase 3 动态验证，2026-08-22）— file 通道探针确定性（Issue #59 AC8）
 *
 * 发现背景（wiki/raw/task_dsh-persistence-inspector_sa7_report.md F-A/F-B）：
 * file 通道 observeFlush 的等待谓词 =「getStatus()==='ready' 且磁盘快照 rev 达标」（设计
 * §6.2 原文规定）。但快照读取走 fs.readFileSync 直读磁盘，可早于内核 flush 记账回调
 * （savedGeneration / flushing / maybeEvict，须经线程池→事件循环交接）观察到提交态；
 * 探针随即推进虚拟时钟 / release，产生两类症状（SA7 本机实测 52 跑 2 异常，≈4%）：
 *   - 症状 A（静默 record 失真）：最终 evict 丢失 → `events=27`、exit 0；
 *   - 症状 B（响亮超时）：后续 flush 被内核单飞锁跳过并在虚拟时钟上重排、探针不再推进 →
 *     `probe-failed file-settle-timeout:doc-degraded:g2`、exit 1。
 * 两者均违反 AC8「同参两跑逐字节一致」与设计 §5 钉死时间线（file n=0 = 28 条事件）。
 * memory 通道不受影响（同步注入缝，20 跑哈希唯一——SA7 实测）。
 *
 * 本锚（SA6 R5 同款精确计数哲学）：file n=0 每跑必须精确命中设计钉死值——
 * events=28、`flush doc-degraded generation=2 ok=true t=2008`、
 * `evict doc-degraded t=2009`，且连跑互为逐字节一致。
 * 修复前：间歇红（单跑异常率 ~4%，3 连跑理论捕获率 ~11%）；
 * 修复后：确定性绿——任何重新引入该竞争的回归将以 events≠28 / 缺 evict / 超时形态立即爆红。
 *
 * 断言纪律：全部为运行时行为断言（探针 API 返回值、CLI 子进程 stdout/退出码），
 * 无源码文本形状断言。
 */
import { describe, expect, it } from 'vitest'
import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPersistenceProbe } from '../src/index.js'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const cliEntry = path.join(repoRoot, 'packages', 'dsh-persistence', 'src', 'cli.ts')

/** file n=0 的设计 §5 钉死值（与 memory 同刻度；SA6 R5 已在 memory 通道锚定 28）。 */
function expectPinnedFileRecord(record: string): void {
  const lines = record.trimEnd().split('\n')
  expect(lines[lines.length - 1]).toBe('probe ok=true events=28')
  expect(record).toContain('flush doc-degraded generation=2 ok=true t=2008')
  expect(record).toContain('release doc-degraded refs=0 t=2009')
  expect(record).toContain('evict doc-degraded t=2009')
  expect(record).not.toContain('probe-failed')
}

function runCli(args: readonly string[], timeoutMs = 60_000): Promise<{ code: number, stdout: string, stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn('pnpm', ['exec', 'tsx', cliEntry, ...args], {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    const guard = globalThis.setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`CLI 超时 ${timeoutMs}ms: ${JSON.stringify(args)}`))
    }, timeoutMs)
    child.on('error', (error) => { globalThis.clearTimeout(guard); reject(error) })
    child.on('close', (code) => {
      globalThis.clearTimeout(guard)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

describe('SA7 补充回归锚：file 通道探针确定性（AC8 + 设计 §5 钉死时间线）', () => {
  it('进程内连跑 3 次：每次 ok=true、record 精确 28 事件含最终 evict，且三次逐字节一致', { timeout: 60_000 }, async () => {
    const records: string[] = []
    for (let round = 1; round <= 3; round += 1) {
      const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), `dsh-file-det-${round}-`))
      try {
        const result = await runPersistenceProbe({ adapter: 'file', rootDir })
        expect(result.ok, `round ${round} 应成功（症状 B 下 ok=false）`).toBe(true)
        expectPinnedFileRecord(result.record)
        records.push(result.record)
      } finally {
        fs.rmSync(rootDir, { recursive: true, force: true })
      }
    }
    expect(records[1]).toBe(records[0])
    expect(records[2]).toBe(records[0])
  })

  it('CLI 连跑 2 次（各自独立 rootDir）：均以 0 退出、尾行精确 events=28，且 stdout 逐字节一致', { timeout: 60_000 }, async () => {
    const rootDirs = [
      fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-file-det-cli-a-')),
      fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-file-det-cli-b-')),
    ]
    try {
      const results: { code: number, stdout: string }[] = []
      for (const rootDir of rootDirs) {
        results.push(await runCli(['--adapter', 'file', '--rootDir', rootDir]))
      }
      for (const [index, result] of results.entries()) {
        expect(result.code, `CLI run ${index + 1} 应以 0 退出`).toBe(0)
        expectPinnedFileRecord(result.stdout)
      }
      expect(results[1]!.stdout).toBe(results[0]!.stdout)
    } finally {
      for (const rootDir of rootDirs) fs.rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
