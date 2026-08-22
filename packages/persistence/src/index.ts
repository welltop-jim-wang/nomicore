export {
  DOC_PERSISTENCE_SERVICE,
  DEFAULT_PERSISTENCE_SCHEDULE,
  DocDuplicateError,
  provideDocPersistence,
  requireDocPersistence,
  resolvePersistenceSchedule,
  systemPersistenceTimer,
  type DocHandle,
  type DocPersistence,
  type PersistenceSchedule,
  type PersistenceTimer,
  type User,
} from './contract.js'

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
