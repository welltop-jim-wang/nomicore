/**
 * @nomicore/namespace-api —— 公共入口。
 *
 * ADR 0015 L18：首版只公开 REST router（`@nomicore/namespace-api/rest` 与 `.` 同面）；
 * create 编排（`src/create-namespace.ts`）保持包内私有——不进 exports 白名单。
 */
export { createRestRouter } from './rest.js';
export type {
  RestDiagnosticEvent,
  RestHandledResult,
  RestMetricsEvent,
  RestRouter,
  RestRouterLimits,
  RestRouterOptions,
} from './rest.js';
