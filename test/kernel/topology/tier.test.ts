import { describe, expect, it } from 'vitest';
import { classify, decideTier, TIER_LABELS } from '../../../src/kernel/topology/tier.js';
import {
  t0Single,
  t15Hybrid,
  t1aStar,
  t1bTree,
  t2aForest,
} from '../../fixtures/topology/index.js';

describe('kernel/topology/tier · classify（按形状判定谱系，§7.2.2）', () => {
  it('五种形态：单点→T0、星→T1a、多层树→T1b、树+横向边→T1.5、森林→T2a', () => {
    expect(classify(t0Single.vertices, t0Single.edges)).toBe('T0');
    expect(classify(t1aStar.vertices, t1aStar.edges)).toBe('T1a');
    expect(classify(t1bTree.vertices, t1bTree.edges)).toBe('T1b');
    expect(classify(t15Hybrid.vertices, t15Hybrid.edges)).toBe('T1.5');
    expect(classify(t2aForest.vertices, t2aForest.edges)).toBe('T2a');
  });

  it('空顶点集按 ≤1 处理 → T0', () => {
    expect(classify([], [])).toBe('T0');
  });

  it('树边的反向应答边不算横向边（半双工 A2 不误判 T1.5）', () => {
    // t1a-star 的 treeEdges 含 parent→child 与 child→parent 双向，仍应判 T1a
    expect(classify(t1aStar.vertices, t1aStar.edges)).toBe('T1a');
  });
});

describe('kernel/topology/tier · TIER_LABELS', () => {
  it('五个谱系各有中文标签', () => {
    expect(TIER_LABELS.T0).toBe('T0 单体');
    expect(TIER_LABELS.T1a).toBe('T1a 单层领队');
    expect(TIER_LABELS.T1b).toBe('T1b 多层领队');
    expect(TIER_LABELS['T1.5']).toBe('T1.5 混合');
    expect(TIER_LABELS.T2a).toBe('T2a 多领队并列');
  });
});

describe('kernel/topology/tier · decideTier（§7.2.5 决策树 Q1–Q5 全分支）', () => {
  it('Q1 是 → T0', () => {
    expect(decideTier({ fitsInOneContext: true })).toBe('T0');
  });

  it('Q2 是 + Q2.1 否 → T1a；Q2.1 是 → T1b', () => {
    expect(decideTier({ fitsInOneContext: false, canDecomposeUpfront: true, needsSubLayers: false })).toBe('T1a');
    expect(decideTier({ fitsInOneContext: false, canDecomposeUpfront: true, needsSubLayers: true })).toBe('T1b');
  });

  it('Q2 否 + Q3 是 → T1.5', () => {
    expect(decideTier({ fitsInOneContext: false, canDecomposeUpfront: false, subTeamNeedsConsensus: true })).toBe('T1.5');
  });

  it('Q2 否 + Q3 否 → 保守默认按 needsSubLayers 取 T1b/T1a', () => {
    expect(decideTier({
      fitsInOneContext: false,
      canDecomposeUpfront: false,
      subTeamNeedsConsensus: false,
      needsSubLayers: true,
    })).toBe('T1b');
    expect(decideTier({
      fitsInOneContext: false,
      canDecomposeUpfront: false,
      subTeamNeedsConsensus: false,
      needsSubLayers: false,
    })).toBe('T1a');
  });

  it('第二阶段优先：joinRole=child → T1.5（即使 Q1 为是）', () => {
    expect(decideTier({ fitsInOneContext: true, hasExistingSessions: true, joinRole: 'child' })).toBe('T1.5');
  });

  it('第二阶段优先：joinRole=peer-leader → T2a', () => {
    expect(decideTier({ fitsInOneContext: true, hasExistingSessions: true, joinRole: 'peer-leader' })).toBe('T2a');
  });

  it('hasExistingSessions 为 true 但 joinRole 未给出 → 不进入第二阶段', () => {
    expect(decideTier({ fitsInOneContext: true, hasExistingSessions: true })).toBe('T0');
  });

  it('空答案 → 保守默认 T1a', () => {
    expect(decideTier({})).toBe('T1a');
  });
});
