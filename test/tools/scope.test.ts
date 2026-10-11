/**
 * test/tools/scope — FR-2.4 能力剥夺：按调用方身份分流工具注册。
 */
import { describe, expect, test } from 'vitest';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import {
  ALL_TOOL_NAMES,
  MEMBER_TOOL_NAMES,
  createTeamTools,
  registerTeamTools,
  resolveScope,
} from '../../src/tools/index.js';
import { makeFixture } from './helpers.js';

function collect() {
  const names: string[] = [];
  const register = (def: ToolDefinition) => {
    names.push(def.name);
  };
  return { names, register };
}

describe('resolveScope（防御式身份探测）', () => {
  test('undefined / 空对象 → leader（根/领队会话）', () => {
    expect(resolveScope(undefined)).toBe('leader');
    expect(resolveScope({})).toBe('leader');
  });
  test('显式字符串身份', () => {
    expect(resolveScope('leader')).toBe('leader');
    expect(resolveScope('member')).toBe('member');
  });
  test('带父引用字段的对象 → member（子节点会话）', () => {
    expect(resolveScope({ parent: { id: 'p' } })).toBe('member');
    expect(resolveScope({ parentId: 'p' })).toBe('member');
    expect(resolveScope({ parentSessionId: 's' })).toBe('member');
    expect(resolveScope({ parentAgentId: 'a' })).toBe('member');
  });
  test('带 concourse 顶点标记 → member', () => {
    expect(resolveScope({ vertexId: 'a' })).toBe('member');
    expect(resolveScope({ concourseVertex: { id: 'a' } })).toBe('member');
  });
});

describe('registerTeamTools 分流', () => {
  test('leader：注册全部 6 个', () => {
    const fx = makeFixture();
    const { names, register } = collect();
    const registered = registerTeamTools(register, fx.deps, undefined);
    expect(names).toEqual([...ALL_TOOL_NAMES]);
    expect(registered).toEqual([...ALL_TOOL_NAMES]);
  });
  test('member（子节点）：仅 team_send / team_status，topology/plan/link/assign 不可见', () => {
    const fx = makeFixture();
    const { names, register } = collect();
    registerTeamTools(register, fx.deps, { parent: { id: 'p' } });
    expect(names).toEqual([...MEMBER_TOOL_NAMES]);
    expect(names).not.toContain('team_topology');
    expect(names).not.toContain('team_plan');
    expect(names).not.toContain('team_link');
    expect(names).not.toContain('team_assign');
  });
});

describe('createTeamTools', () => {
  test('六工具齐、name 唯一、输出 schema 全为闭合对象', () => {
    const fx = makeFixture();
    const tools = createTeamTools(fx.deps);
    expect(tools.map((t) => t.name)).toEqual([...ALL_TOOL_NAMES]);
    for (const t of tools) {
      expect(t.output.schema).toMatchObject({ type: 'object', additionalProperties: false });
    }
  });
});
