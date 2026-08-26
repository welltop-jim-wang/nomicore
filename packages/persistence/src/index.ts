export {
  NOMICORE_PERSISTENCE_SERVICE,
  DEFAULT_PERSISTENCE_SCHEDULE,
  DocDuplicateError,
  DOC_CREATE_FATAL_PHASE_COMMITTED,
  DocCreateFatalError,
  DocCreateOperationalError,
  DocLoadOperationalError,
  type DocCreateFatalPhase,
  provideNomicorePersistence,
  requireNomicorePersistence,
  resolvePersistenceSchedule,
  type DocHandle,
  type DocHandleStatus,
  type DocPersistence,
  type PersistenceSchedule,
  type PersistenceScheduler,
  type User,
} from './contract.js'

export { type PersistenceIO } from './lifecycle.js'

export {
  MemoryPersistence,
  createMemoryPersistence,
  createMemoryPersistencePlugin,
  type MemoryPersistenceOptions,
  type MemoryPersistenceStatus,
} from './memory.js'
export {
  FilePersistence,
  createFilePersistencePlugin,
  type FilePersistenceOptions,
  type FilePersistenceStatus,
} from './file.js'
