import { runPersistenceProbe } from './probe.js'

/**
 * DSH 探针 CLI（AC8 可复制命令）：stdout=记录，stderr=错误。
 * 退出码纪律：0 成功 / 1 领域失败（probe ok=false）/ 2 用法错误。
 * file 模式不清理 rootDir（快照是 AC8 要的可观察副作用）。
 */

class CliUsageError extends Error {}

interface ParsedArgs {
  adapter?: string
  rootDir?: string
  failFirstFlushes?: string
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--adapter' || arg === '--rootDir' || arg === '--fail-first-flushes') {
      const value = argv[index + 1]
      if (value === undefined) throw new CliUsageError(`missing value for ${arg}`)
      if (arg === '--adapter') out.adapter = value
      else if (arg === '--rootDir') out.rootDir = value
      else out.failFirstFlushes = value
      index += 1
    } else {
      throw new CliUsageError(`unknown argument ${JSON.stringify(arg)}`)
    }
  }
  return out
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  if (args.adapter === undefined) throw new CliUsageError('missing required --adapter <memory|file>')
  if (args.adapter !== 'memory' && args.adapter !== 'file') {
    throw new CliUsageError(`unknown adapter ${JSON.stringify(args.adapter)}: expected "memory" or "file"`)
  }
  let failFirstFlushes: number | undefined
  if (args.failFirstFlushes !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(args.failFirstFlushes)) {
      throw new CliUsageError(`--fail-first-flushes must be a non-negative integer, got ${JSON.stringify(args.failFirstFlushes)}`)
    }
    failFirstFlushes = Number(args.failFirstFlushes)
  }

  const result = await runPersistenceProbe({
    adapter: args.adapter,
    ...(args.rootDir !== undefined ? { rootDir: args.rootDir } : {}),
    ...(failFirstFlushes !== undefined ? { failFirstFlushes } : {}),
  })
  process.stdout.write(result.record)
  if (!result.ok) {
    process.stderr.write(`probe failed: ${result.failureReason ?? 'unknown'}\n`)
    return 1
  }
  return 0
}

main().then(
  (code) => { process.exitCode = code },
  (error: unknown) => {
    if (error instanceof CliUsageError) {
      process.stderr.write(
        `usage: pnpm exec tsx packages/dsh-persistence/src/cli.ts --adapter <memory|file> [--rootDir <dir>] [--fail-first-flushes <n>]\n${error.message}\n`,
      )
      process.exitCode = 2
    } else {
      process.stderr.write(`probe error: ${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 2
    }
  },
)
