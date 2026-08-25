/**
 * 【探针 · 副作用导入（side-effect import）】`import '<specifier>'` 无绑定再导出。
 * 反馈 1 点名的绕过形态之一：只允许 Registry 生产代码消费的 internal subpath 若被
 * 副作用导入，审计必须检测到并判违规（旧 from/import() 正则对此形态漏检）。
 */
import '@nomicore/namespace-runtime/internal';
