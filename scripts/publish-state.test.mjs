import assert from 'node:assert/strict'
import test from 'node:test'
import { decidePublication } from './publish-state.mjs'

test('already published matching integrity is skipped', () => {
  assert.deepEqual(decidePublication({
    packageId: '@nomicore/a@1.0.0',
    localIntegrity: 'sha512-match',
    registry: { kind: 'published', integrity: 'sha512-match' },
  }), { kind: 'already-published' })
})

test('already published mismatched integrity fails closed', () => {
  assert.throws(() => decidePublication({
    packageId: '@nomicore/a@1.0.0',
    localIntegrity: 'sha512-local',
    registry: { kind: 'published', integrity: 'sha512-remote' },
  }), /integrity mismatch/)
})

test('missing registry version proceeds to publish', () => {
  assert.deepEqual(decidePublication({
    packageId: '@nomicore/a@1.0.0',
    localIntegrity: 'sha512-local',
    registry: { kind: 'missing' },
  }), { kind: 'publish' })
})
