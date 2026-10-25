import { execSync } from 'node:child_process';
import { join } from 'node:path';

/** 每个 Vitest 调用只构建一次，worker 只读共享 dist；独立测试也天然验证当前源码。 */
export default function setup(): void {
  const root = join(__dirname, '..');
  execSync('pnpm build', { cwd: root, stdio: 'inherit' });
}
