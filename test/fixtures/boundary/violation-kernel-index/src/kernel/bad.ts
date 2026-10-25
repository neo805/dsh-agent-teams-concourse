/**
 * kernel 经 src/index.ts 间接依赖 host：旧的 forbidDirs 黑名单会放行。
 */
import '../index.js';
