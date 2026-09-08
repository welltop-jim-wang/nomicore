// CI 单元测试分片器：把仓内全部 *.test.ts（与 vitest.config 的 test.include 完全同源的枚举）
// 用 LPT（最长优先）贪心装箱成 N 个时长均衡的分片，供 CI 矩阵作业各跑一片。
//
// 用法：
//   node scripts/ci-test-shard.mjs <index> <count>   打印该分片的测试文件（空格分隔，供 vitest CLI 过滤）
//   node scripts/ci-test-shard.mjs --stats <count>   打印所有分片的预估耗时（调试用，不输出文件列表）
//   node scripts/ci-test-shard.mjs --update <vitest-json-report>  用 vitest --reporter=json 的产物
//                                                      重新生成 .github/ci/test-durations.json
//
// 权重来自 .github/ci/test-durations.json（毫秒）。该文件只影响均衡、不影响正确性：
// 文件列表永远由磁盘枚举决定——新增测试文件即使不在权重表里，也会按全表平均权重装箱，
// 保证每个测试文件恰好落入一个分片，绝无静默漏跑。权重漂移只会让分片变不均衡，不会假绿。
//
// 刷新权重（建议在 main 上、机器空闲时跑）：
//   NODE_OPTIONS=--conditions=nomicore-source pnpm exec vitest run --reporter=json --outputFile=artifacts/vitest-report.json
//   node scripts/ci-test-shard.mjs --update artifacts/vitest-report.json

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const durationsPath = join(root, '.github/ci/test-durations.json')

// 与 vitest.config.* 的 test.include 保持一致：packages|domains|apps 下 */test/**/*.test.ts。
// 注意 *.test-d.ts 不匹配 *.test.ts（后缀不同），类型检查测试由 CI 的 typecheck 作业单独跑。
const TEST_ROOTS = ['packages', 'domains', 'apps']

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

export function listTestFiles() {
  const files = []
  for (const top of TEST_ROOTS) {
    const topDir = join(root, top)
    for (const entry of readdirSync(topDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const testDir = join(topDir, entry.name, 'test')
      try {
        if (!statSync(testDir).isDirectory()) continue
      } catch {
        continue
      }
      for (const file of walk(testDir)) {
        if (file.endsWith('.test.ts')) files.push(relative(root, file).split(sep).join('/'))
      }
    }
  }
  return files.sort()
}

export function loadDurations() {
  const data = JSON.parse(readFileSync(durationsPath, 'utf8'))
  return data.durations ?? {}
}

// LPT 装箱：按权重降序（同权重按路径字典序，保证确定性）逐一放进当前最轻的桶。
// 未收录文件取全表平均权重兜底。返回 bins[index] = { files, totalMs }。
export function shard(files, durations, count) {
  const known = Object.values(durations)
  const fallback = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1000
  const weighted = files
    .map((file) => ({ file, ms: durations[file] ?? fallback }))
    .sort((a, b) => b.ms - a.ms || (a.file < b.file ? -1 : 1))
  const bins = Array.from({ length: count }, () => ({ files: [], totalMs: 0 }))
  for (const { file, ms } of weighted) {
    let lightest = 0
    for (let i = 1; i < bins.length; i++) if (bins[i].totalMs < bins[lightest].totalMs) lightest = i
    bins[lightest].files.push(file)
    bins[lightest].totalMs += ms
  }
  for (const bin of bins) bin.files.sort()
  return bins
}

function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--update') {
    const report = JSON.parse(readFileSync(args[1], 'utf8'))
    const durations = {}
    for (const t of report.testResults ?? []) {
      if (!t.name.endsWith('.test.ts') || t.name.endsWith('.test-d.ts')) continue
      const rel = relative(root, t.name).split(sep).join('/')
      if (rel.startsWith('..')) continue
      durations[rel] = Math.round(t.endTime - t.startTime)
    }
    const sorted = Object.fromEntries(Object.entries(durations).sort(([a], [b]) => (a < b ? -1 : 1)))
    writeFileSync(
      durationsPath,
      `${JSON.stringify(
        {
          $comment:
            'CI 测试分片权重（毫秒）。由 scripts/ci-test-shard.mjs --update 从 vitest JSON 报告再生成；未收录的新测试文件自动取全表平均值兜底，不会漏跑。手工微调亦可——只影响分片均衡，不影响覆盖。',
          durations: sorted,
        },
        null,
        2,
      )}\n`,
    )
    process.stderr.write(`updated ${durationsPath}: ${sorted.length} entries\n`)
    return
  }

  const files = listTestFiles()
  const durations = loadDurations()

  if (args[0] === '--stats') {
    const count = Number(args[1])
    const bins = shard(files, durations, count)
    bins.forEach((bin, i) =>
      process.stderr.write(`shard ${i + 1}/${count}: ${bin.files.length} files, ~${Math.round(bin.totalMs / 1000)}s\n`),
    )
    return
  }

  const index = Number(args[0])
  const count = Number(args[1])
  if (!Number.isInteger(index) || !Number.isInteger(count) || index < 1 || index > count) {
    throw new Error(`usage: ci-test-shard.mjs <index 1..N> <count N> | --stats <count> | --update <report.json>`)
  }
  const bins = shard(files, durations, count)
  const mine = bins[index - 1]
  process.stderr.write(
    `shard ${index}/${count}: ${mine.files.length} files, ~${Math.round(mine.totalMs / 1000)}s estimated\n`,
  )
  process.stdout.write(`${mine.files.join(' ')}\n`)
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === join(process.argv[1])
if (isMain) main()
