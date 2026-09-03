import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { publishPackages } from './package-catalog.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const first = await mkdtemp(join(tmpdir(), 'nomicore-repro-a-'))
const second = await mkdtemp(join(tmpdir(), 'nomicore-repro-b-'))
try {
  await run('node', [join(root, 'scripts/build-local-packages.mjs'), first])
  await run('node', [join(root, 'scripts/build-local-packages.mjs'), second])
  for (const entry of publishPackages) {
    const pkg = JSON.parse(await readFile(join(root, entry.root, entry.name, 'package.json'), 'utf8'))
    const filename = `${pkg.name.replace('@', '').replace('/', '-')}-${pkg.version}.tgz`
    const [left, right] = await Promise.all([
      digest(join(first, filename)),
      digest(join(second, filename)),
    ])
    if (left !== right) throw new Error(`${pkg.name}@${pkg.version}: tarball is not reproducible`)
  }
  process.stdout.write(`reproducible tarballs verified for ${publishPackages.length} packages\n`)
} finally {
  await rm(first, { recursive: true, force: true })
  await rm(second, { recursive: true, force: true })
}

async function digest(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

function run(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`)))
  })
}
