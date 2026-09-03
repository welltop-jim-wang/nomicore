import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export function decidePublication({ packageId, localIntegrity, registry }) {
  if (registry.kind === 'missing') return { kind: 'publish' }
  if (registry.integrity !== localIntegrity) {
    throw new Error(`${packageId}: published version integrity mismatch (local ${localIntegrity}, registry ${registry.integrity})`)
  }
  return { kind: 'already-published' }
}

export async function localTarballIntegrity(path) {
  const digest = createHash('sha512').update(await readFile(path)).digest('base64')
  return `sha512-${digest}`
}

export async function queryRegistryVersion(packageName, version, { fetchImpl = fetch } = {}) {
  const encoded = packageName.replace('/', '%2f')
  const response = await fetchImpl(`https://registry.npmjs.org/${encoded}/${version}`, {
    headers: { accept: 'application/json' },
  })
  if (response.status === 404) return { kind: 'missing' }
  if (!response.ok) throw new Error(`${packageName}@${version}: registry query failed (${response.status})`)
  const metadata = await response.json()
  const integrity = metadata?.dist?.integrity
  if (typeof integrity !== 'string' || !integrity.startsWith('sha512-')) {
    throw new Error(`${packageName}@${version}: registry returned invalid integrity`)
  }
  return { kind: 'published', integrity }
}
