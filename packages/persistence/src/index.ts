export {
  NOMICORE_PERSISTENCE_SERVICE,
  DEFAULT_PERSISTENCE_SCHEDULE,
  DocDuplicateError,
  DOC_CREATE_FATAL_PHASE_COMMITTED,
  DocCreateFatalError,
  DocCreateOperationalError,
  DocLoadOperationalError,
  // Phase 5（issue #133）：受控复制导入/归档错误族 + 冻结归档 phase→committed 映射
  DocArchiveActiveHandleError,
  DocArchiveDuplicateError,
  DocArchiveFatalError,
  DocArchiveIdentityError,
  DocArchiveOperationalError,
  DOC_ARCHIVE_FATAL_PHASE_COMMITTED,
  DocImportIdentityError,
  type DocCreateFatalPhase,
  provideNomicorePersistence,
  requireNomicorePersistence,
  resolvePersistenceSchedule,
  type DocArchiveFatalPhase,
  type DocHandle,
  type DocHandleStatus,
  type DocPersistence,
  type PersistenceSchedule,
  type PersistenceScheduler,
  type ReplicaPersistence,
  type ReplicationIdentityRef,
  type User,
  type YjsDoc,
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
