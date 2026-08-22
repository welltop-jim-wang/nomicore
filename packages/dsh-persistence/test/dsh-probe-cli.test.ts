/**
 * SA6 红灯验收测试 — Issue #59 AC8「探针结果形成可复制的命令 + 输出记录」
 *
 * 契约来源：任务简报 AC8 + ADR-0006 实施顺序 4（记录供后续 NomicoreServer Host 复用验收）；
 * 冲突门禁结论提示 4（degraded 记录完整：拒绝路径经 saveDoc 观测）。
 *
 * 复制的含义（本文件锚定）：
 * 1. 同一命令 + 相同参数两次运行 → stdout 逐字节一致（记录不得含墙钟时间戳、rootDir 绝对路径
 *    等运行环境痕迹）；
 * 2. 记录必须覆盖 AC2/AC3/AC4 链路标记（create/dirty/flush/release/evict/observed/
 *    duplicate/meta-mismatch/degraded/save-degraded/recovered）；
 * 3. file adapter 运行同时产生磁盘副作用（users/<user>/<doc>.snapshot），且不污染记录；
 * 4. 异常输入（file 缺 rootDir、未知 adapter）→ 非零退出 + stderr 报错。
 *
 * 命令形式：`pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter <memory|file>
 * [--rootDir <dir>] [--fail-first-flushes <n>]`（package.json scripts.dsh:probe 固化入口）。
 *
 * 红灯现状：src/cli.ts 尚不存在 → 子进程非零退出，全部断言红灯（真红：命令未实现）。
 */
import { describe, expect, it } from 'vitest'
import * as childProcess from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const cliEntry = path.join(repoRoot, 'packages', 'dsh-persistence', 'src', 'cli.ts')

interface CliResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

function runCli(args: readonly string[], timeoutMs = 60_000): Promise<CliResult> {
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

describe('DSH 探针命令（AC8：可复制的命令 + 输出记录）', () => {
  it('memory profile：命令输出完整记录（AC2/AC3 链路标记）并以 0 退出', async () => {
    const result = await runCli(['--adapter', 'memory'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('create user-a/doc-alpha')
    expect(result.stdout).toContain('dirty doc-alpha generation=1')
    expect(result.stdout).toContain('flush doc-alpha generation=1 ok')
    expect(result.stdout).toContain('release doc-alpha refs=0')
    expect(result.stdout).toContain('evict doc-alpha')
    expect(result.stdout).toContain('observed user-a/doc-alpha entries=SCHEMA,META,ROOT metaDocId=doc-alpha')
    expect(result.stdout).toContain('duplicate user-a/doc-alpha code=DOC_DUPLICATE')
    expect(result.stdout).toContain('meta-mismatch user-a/doc-alpha expected=doc-alpha actual=doc-other')
  })

  it('可复制性：同一命令两次运行 stdout 逐字节一致', async () => {
    const [first, second] = await Promise.all([
      runCli(['--adapter', 'memory']),
      runCli(['--adapter', 'memory']),
    ])
    expect(first.code).toBe(0)
    expect(second.code).toBe(0)
    expect(first.stdout).toBe(second.stdout)
  })

  it('file profile：命令落盘快照（users/<user>/<doc>.snapshot），记录不携带 rootDir 痕迹；两次运行记录一致', async () => {
    const rootDirA = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cli-file-a-'))
    const rootDirB = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-cli-file-b-'))
    try {
      const [first, second] = await Promise.all([
        runCli(['--adapter', 'file', '--rootDir', rootDirA]),
        runCli(['--adapter', 'file', '--rootDir', rootDirB]),
      ])
      expect(first.code).toBe(0)
      expect(second.code).toBe(0)
      expect(first.stdout).toContain('create user-a/doc-alpha')
      expect(fs.existsSync(path.join(rootDirA, 'users', 'user-a', 'doc-alpha.snapshot'))).toBe(true)
      expect(fs.existsSync(path.join(rootDirB, 'users', 'user-b', 'doc-alpha.snapshot'))).toBe(true)
      // 记录不得包含运行环境痕迹（rootDir 绝对路径），否则不可复制
      expect(first.stdout).not.toContain(rootDirA)
      expect(second.stdout).not.toContain(rootDirB)
      expect(first.stdout).toBe(second.stdout)
    } finally {
      fs.rmSync(rootDirA, { recursive: true, force: true })
      fs.rmSync(rootDirB, { recursive: true, force: true })
    }
  })

  it('AC4 完整性：--fail-first-flushes 1 使记录包含 degraded → save-degraded → recovered 完整序列', async () => {
    const result = await runCli(['--adapter', 'memory', '--fail-first-flushes', '1'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('flush doc-degraded generation=1 ok=false')
    expect(result.stdout).toContain('degraded doc-degraded')
    expect(result.stdout).toContain('save-degraded doc-degraded')
    expect(result.stdout).toContain('recovered doc-degraded')
  })

  it('异常输入：file adapter 缺 rootDir → 非零退出并报错', async () => {
    const result = await runCli(['--adapter', 'file'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/rootDir/)
  })

  it('异常输入：未知 adapter → 非零退出并报错', async () => {
    const result = await runCli(['--adapter', 'bogus'])
    expect(result.code).not.toBe(0)
    expect(result.stderr).toMatch(/adapter/)
  })

  it('命令以包脚本固化：package.json 提供 dsh:probe 入口（可复制的命令）', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, 'packages', 'dsh-persistence', 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> }
    expect(manifest.scripts?.['dsh:probe']).toBeDefined()
  })
})
