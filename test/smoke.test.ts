import { describe, expect, it } from 'vitest';
import { apply, name } from '../src/index.js';
import * as client from '../src/client/index.js';

describe('P0 冒烟', () => {
  it('宿主入口导出 name 与 apply', () => {
    expect(name).toBe('dsh-agent-teams-concourse');
    expect(typeof apply).toBe('function');
  });

  it('未启用时 apply 零行为（NFR-1 惰性安装）', async () => {
    await expect(apply(undefined, {})).resolves.toBeUndefined();
    await expect(apply(undefined)).resolves.toBeUndefined();
    await expect(apply(undefined, { enabled: false })).resolves.toBeUndefined();
  });

  it('客户端入口可装载且零注册', () => {
    expect(client.name).toBe('dsh-agent-teams-concourse-client');
    expect(typeof client.apply).toBe('function');
    expect(() => client.apply()).not.toThrow();
  });
});
