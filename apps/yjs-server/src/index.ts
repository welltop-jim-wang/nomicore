/**
 * `@nomicore/yjs-server` 公共库入口（设计 §3.1）：嵌入宿主与测试用的组合面。
 *
 *  - `parseAppConfig(raw)` —— 严格配置校验（§3.2），违规 loud TypeError，成功
 *    返回深冻结 `AppConfig`；
 *  - `createNomicoreApp(config)` —— 进程内有序组装 + `stop()` 单一拆卸链。
 *
 * 进程级 CLI（`--config`、stdin NDJSON 控制通道、信号处理、SIGHUP 换装）在
 * `./main.ts`——库入口不代理进程级职责。
 */
export { parseAppConfig, ConfigValidationError, INSTANCE_ID_PATTERN, NAMESPACE_ID_PATTERN } from './config.ts';
export type {
  AppConfig,
  AuthorizationEntry,
  HubConfig,
  PeerConfig,
  PersistenceConfig,
  ProvisionEntry,
} from './config.ts';
export { createNomicoreApp } from './app.ts';
export type { CreateNomicoreAppOptions, NomicoreApp } from './app.ts';
export { acquireRootLock, createStdoutEventSink, ROOT_LOCK_FILE_NAME, STABLE_OP_ERROR_CODES } from './lifecycle.ts';
export type { EventSink, RootLockHandle } from './lifecycle.ts';
