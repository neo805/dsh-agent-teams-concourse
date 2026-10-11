# D-P0 · 工程环境决议（2026-10-11）

## 决议

本仓库的一切 node/pnpm 命令使用**系统 Node.js**（`C:\Program Files\nodejs\node.exe`，v24.18.1 + pnpm 11.7.0），
**不使用** DSH bundled runtime node（`~/.dsh/dsh-runtimes/*/node/bin/node.exe`）。

## 原因（实测）

bundled node.exe 在本机被安全策略禁止一切文件写入（包括 `$TEMP`）：
`fs.writeFileSync` 在任意目录均抛 `EPERM`。系统 node 与 pwsh/cmd 进程写文件正常。
具体拦截机制（AppLocker / AV 策略）未确认，也不在本项目范围内——按既定事实处理。

## 影响

- 所有 pwsh 命令前缀：`$env:PATH = [Environment]::GetEnvironmentVariable('PATH','Machine') + ';' + [Environment]::GetEnvironmentVariable('PATH','User')`
- `pnpm pack` 派生行为：`scripts/pack-smoke.mjs` 经 `npm_execpath` 定位 pnpm。
- pnpm 构建白名单写在 `pnpm-workspace.yaml`（`allowBuilds`/`onlyBuiltDependencies`），package.json 的 `pnpm` 字段已被 pnpm 11 废弃。
- tsdown 输出需 `fixedExtension: false`，否则 platform:node 产出 `.mjs` 与 package.json 的 `dist/index.js` 主入口不符。
