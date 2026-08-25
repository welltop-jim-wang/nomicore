/**
 * 【控制组】消费的是其他包的 specifier（@nomicore/persistence，非 internal subpath）——
 * 不得被检测为 internal 消费方。
 */
export type { User } from '@nomicore/persistence';
