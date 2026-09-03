import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { publishPackages } from './package-catalog.mjs'
import { decidePublication, localTarballIntegrity, queryRegistryVersion } from './publish-state.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, process.argv[2] ?? 'artifacts/local-packages')
const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8'))
const expectedNames = []
const failures = []

for (const entry of publishPackages) {
  const source = JSON.parse(await readFile(join(root, entry.root, entry.name, 'package.json'), 'utf8'))
  expectedNames.push(source.name)
  const filename = manifest[source.name]
  if (filename !== `${source.name.replace('@', '').replace('/', '-')}-${source.version}.tgz`) {
    failures.push(`${source.name}: manifest filename does not match package version`)
    continue
  }
  const tarball = join(outDir, filename)
  const temp = await mkdtemp(join(tmpdir(), 'nomicore-package-verify-'))
  try {
    await run('tar', ['-xzf', tarball, '-C', temp])
    const packageRoot = join(temp, 'package')
    const packed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    check(packed.name === source.name, `${source.name}: packed name mismatch`)
    check(packed.version === source.version, `${source.name}: packed version mismatch`)
    check(packed.private !== true, `${source.name}: packed package is private`)
    check(packed.license === 'MIT', `${source.name}: packed license is not MIT`)
    check(packed.publishConfig?.access === 'public', `${source.name}: publishConfig.access is not public`)
    check(packed.publishConfig?.registry === 'https://registry.npmjs.org/', `${source.name}: registry is not npmjs`)
    checkNoWorkspace(packed.dependencies, source.name, 'dependencies')
    checkNoWorkspace(packed.optionalDependencies, source.name, 'optionalDependencies')
    checkNoWorkspace(packed.peerDependencies, source.name, 'peerDependencies')
    await checkExports(packageRoot, packed.exports, source.name)
    await checkBin(packageRoot, packed.bin, source.name)
    const registry = await queryRegistryVersion(source.name, source.version)
    const decision = decidePublication({
      packageId: `${source.name}@${source.version}`,
      localIntegrity: await localTarballIntegrity(tarball),
      registry,
    })
    if (decision.kind === 'publish') {
      const npmOutput = await runCapture('npm', ['publish', tarball, '--dry-run', '--json', '--ignore-scripts'], {
        npm_config_cache: join(temp, 'npm-cache'),
      })
      const report = JSON.parse(npmOutput)
      const npmPackage = report[source.name] ?? report
      check(npmPackage.id === `${source.name}@${source.version}`, `${source.name}: npm dry-run id mismatch`)
    }
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

for (const key of Object.keys(manifest)) {
  if (!expectedNames.includes(key)) failures.push(`manifest contains unexpected package ${key}`)
}

if (failures.length > 0) {
  for (const failure of failures) process.stderr.write(`ERROR: ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`verified ${expectedNames.length} publishable tarballs in ${outDir}\n`)

function check(condition, message) {
  if (!condition) throw new Error(message)
}

function checkNoWorkspace(dependencies, name, field) {
  if (dependencies === undefined) return
  for (const [dependency, range] of Object.entries(dependencies)) {
    check(typeof range === 'string' && !range.startsWith('workspace:'), `${name}: ${field}.${dependency} contains workspace protocol`)
    check(typeof range === 'string' && !range.startsWith('file:'), `${name}: ${field}.${dependency} contains local file protocol`)
  }
}

async function checkExports(packageRoot, exportsField, name) {
  if (exportsField === undefined) return
  const targets = []
  collectTargets(exportsField, targets)
  for (const target of targets) {
    if (target.startsWith('./src/')) continue // source condition is intentionally development-only
    if (!target.startsWith('./')) continue
    await readFile(join(packageRoot, target.slice(2))).catch(() => {
      throw new Error(`${name}: export target missing from tarball: ${target}`)
    })
  }
}

function collectTargets(value, targets) {
  if (typeof value === 'string') {
    targets.push(value)
    return
  }
  if (value === null || typeof value !== 'object') return
  for (const child of Object.values(value)) collectTargets(child, targets)
}

async function checkBin(packageRoot, bin, name) {
  if (bin === undefined) return
  const values = typeof bin === 'string' ? [bin] : Object.values(bin)
  for (const target of values) {
    await readFile(join(packageRoot, String(target).replace(/^\.\//, ''))).catch(() => {
      throw new Error(`${name}: bin target missing from tarball: ${target}`)
    })
  }
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`)))
  })
}

function runCapture(command, args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'inherit'],
      env: { ...process.env, ...env },
    })
    let output = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { output += chunk })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0
      ? resolvePromise(output)
      : reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`)))
  })
}
