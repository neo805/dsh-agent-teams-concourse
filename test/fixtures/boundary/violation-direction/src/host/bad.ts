// 违规 fixture：逆向依赖 host → service（正确方向是 service → host）。
import { s } from '../service/s.js';

export const b = s;
