import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { publishPackages } from './package-catalog.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2).filter((arg) => arg !== '--'))
const publish = args.delete('--publish')
const provenance = args.delete('--provenance')
const outArg = [...args][0]
if (args.size > (outArg === undefined ? 0 : 1)) usage()
const outDir = resolve(root, outArg ?? 'artifacts/local-packages')

if (publish) {
  const status = await capture('git', ['status', '--porcelain'], root)
  if (status.trim() !== '') throw new Error('refusing to publish from a dirty working tree')
  const branch = (await capture('git', ['branch', '--show-current'], root)).trim()
  if (branch !== 'main') throw new Error(`refusing to publish from branch ${JSON.stringify(branch)}; expected main`)
}

await run('node', [join(root, 'scripts/verify-package-tarballs.mjs'), outDir], root)
const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'))
const npmCache = join(root, '.cache', 'npm-publish')
await rm(npmCache, { recursive: true, force: true })
await mkdir(npmCache, { recursive: true })

for (const entry of publishPackages) {
  const pkg = JSON.parse(await readFile(join(root, entry.root, entry.name, 'package.json'), 'utf8'))
  const tarball = join(outDir, manifest[pkg.name])
  const command = ['publish', tarball, '--access', 'public', '--ignore-scripts']
  if (!publish) command.push('--dry-run')
  if (provenance) command.push('--provenance')
  process.stdout.write(`${publish ? 'publishing' : 'dry-run'} ${pkg.name}@${pkg.version}\n`)
  await run('npm', command, root, { npm_config_cache: npmCache })
}

process.stdout.write(publish
  ? `published ${publishPackages.length} packages\n`
  : `dry-run complete for ${publishPackages.length} packages; pass --publish for a real release\n`)

function usage() {
  process.stderr.write('usage: pnpm publish:packages -- [--publish] [--provenance] [outputDir]\n')
  process.exit(2)
}

function run(command, commandArgs, cwd, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} ${commandArgs.join(' ')} failed (${signal ?? code})`)))
  })
}

function capture(command, commandArgs, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, commandArgs, { cwd, stdio: ['ignore', 'pipe', 'inherit'] })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { output += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0
      ? resolvePromise(output)
      : reject(new Error(`${command} ${commandArgs.join(' ')} failed (${signal ?? code})`)))
  })
}
