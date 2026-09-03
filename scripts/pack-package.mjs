import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'

const [packageDirArg, outputArg] = process.argv.slice(2)
if (packageDirArg === undefined || outputArg === undefined) {
  throw new Error('usage: pack-package <packageDir> <output.tgz>')
}
const packageDir = resolve(packageDirArg)
const output = resolve(outputArg)
const pkg = JSON.parse(await readFile(join(packageDir, 'package.json'), 'utf8'))
const stage = await mkdtemp(join(tmpdir(), 'nomicore-pack-stage-'))
const packageRoot = join(stage, 'package')
try {
  await mkdir(packageRoot, { recursive: true })
  for (const entry of pkg.files ?? ['dist']) {
    await cp(join(packageDir, entry), join(packageRoot, entry), { recursive: true })
  }
  for (const optional of ['README.md', 'LICENSE']) {
    const local = join(packageDir, optional)
    const root = join(packageDir, '..', '..', optional)
    try {
      await cp(local, join(packageRoot, optional))
    } catch {
      try { await cp(root, join(packageRoot, optional)) } catch { /* optional */ }
    }
  }
  const manifestPath = join(packageRoot, 'package.json')
  const script = resolve(dirname(new URL(import.meta.url).pathname), 'create-publish-manifest.mjs')
  await run('node', [script, join(packageDir, 'package.json'), manifestPath])
  await normalizeTree(packageRoot)
  await mkdir(dirname(output), { recursive: true })
  await rm(output, { force: true })
  await run('tar', [
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--format=ustar',
    '-czf', output,
    '-C', stage,
    'package',
  ], { GZIP: '-n' })
  process.stdout.write(`${pkg.name}@${pkg.version} -> ${output}\n`)
} finally {
  await rm(stage, { recursive: true, force: true })
}

async function normalizeTree(path) {
  // GNU tar overrides metadata, but normalizing the manifest bytes makes the
  // package payload itself deterministic before archiving.
  const manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'))
  await writeFile(join(path, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

function run(command, args, env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => code === 0
      ? resolvePromise()
      : reject(new Error(`${command} ${args.join(' ')} failed (${signal ?? code})`)))
  })
}
