# @nomicore/instance

Cordis service providing the immutable local Nomicore `instanceId` and static
`role` (`hub` or `peer`). Both fields are restart-only and are configured once
by the composition root.

`createInstancePlugin(overrides?)` merges defined factory overrides over its
host configuration, strictly rejects unknown keys, validates the final merged
configuration, and publishes `ctx.nomicoreInstance`. Fiber disposal revokes the
service.

```ts
import { Context } from '@deepseek-ai/cordis'
import { createInstancePlugin, requireNomicoreInstance } from '@nomicore/instance'

const ctx = new Context()
createInstancePlugin().apply(ctx, { instanceId: 'peer-west-1', role: 'peer' })
const instance = requireNomicoreInstance(ctx)
```
