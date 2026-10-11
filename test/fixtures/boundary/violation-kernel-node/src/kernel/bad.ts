// 违规 fixture：kernel 不得引入 node: 内置模块（NFR-5 纯函数内核）。
import { readFileSync } from 'node:fs';

export const x = readFileSync;
