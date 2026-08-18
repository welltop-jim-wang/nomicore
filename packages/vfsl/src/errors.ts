/** VFSL 包的错误基类。 */
export class VfslError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * 骨架占位：模块契约已冻结、实现尚未落地时抛出。
 * 随 Phase 0 各步（parser → 求值器 → 路径索引 → validateSnapshot → JSDoc）逐步消除。
 */
export class VfslNotImplementedError extends VfslError {
  constructor(scope: string) {
    super(`not implemented yet: ${scope}`);
  }
}
