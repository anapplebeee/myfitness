import { describe, expect, it } from 'vitest';
import {
  bodyweightProgress,
  diffSessions,
  frequencyProgress,
  goalLabel,
  goalProgress,
  isOverdue,
  previousComparableSession,
  strengthProgress,
  summarizeSession,
  validateGoal,
  type BodyweightGoal,
  type FrequencyGoal,
  type StrengthGoal,
} from './goals';
import type { Session, SetRecord } from './types';

function set(id: string, loadGrams: number, reps: number, partial: Partial<SetRecord> = {}): SetRecord {
  return {
    id,
    kind: 'work',
    status: 'completed',
    loadGrams,
    reps,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-20T10:00:00.000Z',
    ...partial,
  };
}

function session(
  id: string,
  date: string,
  sets: SetRecord[],
  partial: Partial<Session> = {},
): Session {
  return {
    id,
    templateId: null,
    dayId: null,
    title: '训练',
    status: 'completed',
    startedAt: `${date}T10:00:00.000Z`,
    endedAt: `${date}T11:00:00.000Z`,
    businessDate: date,
    restEndsAt: null,
    note: '',
    exercises: [
      {
        id: 'se_' + id,
        exerciseId: 'bb-squat',
        order: 0,
        targetSets: 3,
        repMin: 5,
        repMax: 8,
        restSeconds: 120,
        incrementGrams: 2500,
        sets,
      },
    ],
    ...partial,
  };
}

const bwGoal = (targetKg: number, startKg: number | null): BodyweightGoal => ({
  kind: 'bodyweight',
  targetGrams: targetKg * 1000,
  startGrams: startKg === null ? null : startKg * 1000,
  targetDate: null,
  createdAt: '2026-10-01T00:00:00.000Z',
});

describe('AC-N07 · 体重目标进度（方向正确性）', () => {
  it('减重：从 80 向 75 走，走到 77.5 是 50%', () => {
    const p = bodyweightProgress(bwGoal(75, 80), 77500);
    expect(p.ratio).toBeCloseTo(0.5, 2);
    expect(p.achieved).toBe(false);
  });

  it('减重：达成时 ratio 为 1', () => {
    const p = bodyweightProgress(bwGoal(75, 80), 75000);
    expect(p.ratio).toBe(1);
    expect(p.achieved).toBe(true);
  });

  it('减重：反向变化时进度不为负', () => {
    const p = bodyweightProgress(bwGoal(75, 80), 82000);
    expect(p.ratio).toBe(0);
    expect(p.achieved).toBe(false);
  });

  it('增重：从 60 向 65 走，走到 62.5 是 50%', () => {
    const p = bodyweightProgress(bwGoal(65, 60), 62500);
    expect(p.ratio).toBeCloseTo(0.5, 2);
  });

  it('增重：反向（变轻）时进度为 0', () => {
    const p = bodyweightProgress(bwGoal(65, 60), 58000);
    expect(p.ratio).toBe(0);
  });

  it('超额完成时 ratio 封顶为 1，不给 1.2 这种值', () => {
    const p = bodyweightProgress(bwGoal(75, 80), 70000);
    expect(p.ratio).toBe(1);
    expect(p.achieved).toBe(true);
  });

  it('没有当前体重时给出明确文案', () => {
    const p = bodyweightProgress(bwGoal(75, 80), null);
    expect(p.text).toContain('还没有体重记录');
    expect(p.achieved).toBe(false);
  });

  it('没有起始体重时不能算进度', () => {
    const p = bodyweightProgress(bwGoal(75, null), 78000);
    expect(p.text).toContain('缺少起始体重');
    expect(p.ratio).toBe(0);
  });

  it('剩余量按绝对值给出，减重与增重都为正', () => {
    expect(bodyweightProgress(bwGoal(75, 80), 78000).remaining).toBeCloseTo(3, 1);
    expect(bodyweightProgress(bwGoal(65, 60), 62000).remaining).toBeCloseTo(3, 1);
  });

  it('刚设定目标（起始=当前）时文案说明"从今天开始算"而不是只给 0%', () => {
    const p = bodyweightProgress(bwGoal(70, 78.2), 78200);
    expect(p.ratio).toBe(0);
    expect(p.text).toContain('从今天开始算');
    expect(p.text).not.toContain('0%');
  });

  it('已经走了一段后不再显示"从今天开始算"', () => {
    const p = bodyweightProgress(bwGoal(70, 80), 78000);
    expect(p.text).not.toContain('从今天开始算');
    expect(p.text).toContain('还差');
  });
  it('目标等于起始时只有精确命中才算达成', () => {
    expect(bodyweightProgress(bwGoal(75, 75), 75000).achieved).toBe(true);
    expect(bodyweightProgress(bwGoal(75, 75), 76000).achieved).toBe(false);
  });
});

describe('AC-N07 · 力量目标进度', () => {
  const goal: StrengthGoal = {
    kind: 'strength',
    exerciseId: 'bb-squat',
    targetGrams: 120000,
    targetDate: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  };

  it('取历史最佳单组重量', () => {
    const sessions = [
      session('s1', '2026-10-10', [set('a', 100000, 5)]),
      session('s2', '2026-10-15', [set('b', 110000, 3)]),
    ];
    const p = strengthProgress(goal, sessions);
    expect(p.current).toBe(110);
    expect(p.ratio).toBeCloseTo(110 / 120, 3);
  });

  it('达成时 achieved 为 true', () => {
    const sessions = [session('s1', '2026-10-10', [set('a', 125000, 2)])];
    const p = strengthProgress(goal, sessions);
    expect(p.achieved).toBe(true);
    expect(p.ratio).toBe(1);
  });

  it('没有记录时给出明确文案', () => {
    const p = strengthProgress(goal, []);
    expect(p.text).toContain('还没有该动作的负重记录');
    expect(p.current).toBe(0);
  });

  it('无效场次不计入', () => {
    const sessions = [session('s1', '2026-10-10', [set('a', 200000, 1)], { status: 'discarded' })];
    expect(strengthProgress(goal, sessions).current).toBe(0);
  });
});

describe('AC-N07 · 频率目标进度', () => {
  const goal: FrequencyGoal = { kind: 'frequency', perWeek: 3, createdAt: '2026-10-01T00:00:00.000Z' };

  it('用最近数周平均，不是只看本周', () => {
    // 两周各 3 次，本周 0 次
    const sessions = [
      session('a', '2026-10-06', [set('1', 100000, 5)]),
      session('b', '2026-10-07', [set('2', 100000, 5)]),
      session('c', '2026-10-08', [set('3', 100000, 5)]),
      session('d', '2026-10-13', [set('4', 100000, 5)]),
      session('e', '2026-10-14', [set('5', 100000, 5)]),
      session('f', '2026-10-15', [set('6', 100000, 5)]),
    ];
    const p = frequencyProgress(goal, sessions, '2026-10-20', 4);
    // 4 周里 6 次 → 平均 1.5
    expect(p.current).toBeCloseTo(1.5, 1);
    expect(p.achieved).toBe(false);
  });

  it('达到目标时 achieved 为 true', () => {
    const sessions = Array.from({ length: 12 }, (_, i) =>
      session(`s${i}`, `2026-10-${String(6 + (i % 5)).padStart(2, '0')}`, [set(`x${i}`, 100000, 5)]),
    );
    const p = frequencyProgress(goal, sessions, '2026-10-20', 4);
    expect(p.achieved).toBe(true);
  });

  it('没有记录时平均为 0', () => {
    const p = frequencyProgress(goal, [], '2026-10-20', 4);
    expect(p.current).toBe(0);
    expect(p.achieved).toBe(false);
  });
});

describe('AC-N07 · 目标校验', () => {
  it('体重目标过低被拒', () => {
    expect(validateGoal(bwGoal(30, 70))).toContain('35–250');
  });

  it('体重目标过高被拒', () => {
    expect(validateGoal(bwGoal(300, 70))).toContain('35–250');
  });

  it('与当前差距过小被拒', () => {
    expect(validateGoal(bwGoal(75.2, 75))).toContain('差距太小');
  });

  it('差距过大建议分阶段', () => {
    expect(validateGoal(bwGoal(50, 120))).toContain('差距过大');
  });

  it('合理体重目标通过', () => {
    expect(validateGoal(bwGoal(72, 80))).toBeNull();
  });

  it('力量目标必须大于 0', () => {
    expect(
      validateGoal({
        kind: 'strength',
        exerciseId: 'x',
        targetGrams: 0,
        targetDate: null,
        createdAt: '',
      }),
    ).toContain('大于 0');
  });

  it('频率目标范围 1–21', () => {
    expect(validateGoal({ kind: 'frequency', perWeek: 0, createdAt: '' })).toContain('1–21');
    expect(validateGoal({ kind: 'frequency', perWeek: 25, createdAt: '' })).toContain('1–21');
    expect(validateGoal({ kind: 'frequency', perWeek: 4, createdAt: '' })).toBeNull();
  });
});

describe('AC-N07 · 目标描述与过期', () => {
  it('体重目标描述', () => {
    expect(goalLabel(bwGoal(75, 80))).toContain('75.0 kg');
  });

  it('力量目标描述用动作名', () => {
    const g: StrengthGoal = {
      kind: 'strength',
      exerciseId: 'bb-squat',
      targetGrams: 120000,
      targetDate: null,
      createdAt: '',
    };
    expect(goalLabel(g, () => '杠铃深蹲')).toContain('杠铃深蹲');
  });

  it('超过目标日期且未达成 → 过期', () => {
    const g: BodyweightGoal = {
      ...bwGoal(75, 80),
      targetDate: '2026-10-01',
    };
    const p = bodyweightProgress(g, 78000);
    expect(isOverdue(g, '2026-10-25', p)).toBe(true);
  });

  it('已达成则不算过期', () => {
    const g: BodyweightGoal = { ...bwGoal(75, 80), targetDate: '2026-10-01' };
    const p = bodyweightProgress(g, 74000);
    expect(isOverdue(g, '2026-10-25', p)).toBe(false);
  });

  it('无期限目标不算过期', () => {
    const g = bwGoal(75, 80);
    expect(isOverdue(g, '2030-01-01', bodyweightProgress(g, 78000))).toBe(false);
  });
});

describe('AC-N07 · 分派', () => {
  it('按 kind 选择对应计算', () => {
    const ctx = { currentWeightGrams: 78000, sessions: [], today: '2026-10-25' };
    expect(goalProgress(bwGoal(75, 80), ctx).unit).toBe('kg');
    expect(goalProgress({ kind: 'frequency', perWeek: 3, createdAt: '' }, ctx).unit).toBe('次/周');
  });
});

describe('训练对比（本次 vs 上次）', () => {
  it('汇总组数、容量、时长、最佳单组', () => {
    const s = session('s1', '2026-10-20', [set('a', 100000, 5), set('b', 110000, 3)]);
    const sum = summarizeSession(s);
    expect(sum.sets).toBe(2);
    expect(sum.volumeGrams).toBe(100000 * 5 + 110000 * 3);
    expect(sum.durationSeconds).toBe(3600);
    expect(sum.bestSetGrams).toBe(110000);
  });

  it('热身组不计入', () => {
    const s = session('s1', '2026-10-20', [
      set('a', 60000, 10, { kind: 'warmup' }),
      set('b', 100000, 5),
    ]);
    expect(summarizeSession(s).sets).toBe(1);
  });

  it('找同一天模板的上一次训练', () => {
    const prev = session('p1', '2026-10-13', [set('a', 100000, 5)], { dayId: 'day-a' });
    const cur = session('c1', '2026-10-20', [set('b', 105000, 5)], { dayId: 'day-a' });
    const other = session('o1', '2026-10-18', [set('c', 90000, 5)], { dayId: 'day-b' });
    expect(previousComparableSession(cur, [prev, other, cur])?.id).toBe('p1');
  });

  it('没有同 dayId 时按标题回退', () => {
    const prev = session('p1', '2026-10-13', [set('a', 100000, 5)], { title: '上肢 A' });
    const cur = session('c1', '2026-10-20', [set('b', 105000, 5)], { title: '上肢 A' });
    expect(previousComparableSession(cur, [prev, cur])?.id).toBe('p1');
  });

  it('没有上次时返回 null', () => {
    const cur = session('c1', '2026-10-20', [set('b', 105000, 5)]);
    expect(previousComparableSession(cur, [cur])).toBeNull();
  });

  it('不拿未来的场次做对比', () => {
    const future = session('f1', '2026-10-27', [set('a', 100000, 5)]);
    const cur = session('c1', '2026-10-20', [set('b', 105000, 5)]);
    expect(previousComparableSession(cur, [future, cur])).toBeNull();
  });

  it('容量增加给出正百分比', () => {
    const cur = summarizeSession(session('c', '2026-10-20', [set('b', 110000, 5)]));
    const prev = summarizeSession(session('p', '2026-10-13', [set('a', 100000, 5)]));
    const d = diffSessions(cur, prev);
    expect(d.volumeDeltaPct).toBe(10);
    expect(d.text).toContain('+10%');
  });

  it('容量下降给出负百分比', () => {
    const cur = summarizeSession(session('c', '2026-10-20', [set('b', 90000, 5)]));
    const prev = summarizeSession(session('p', '2026-10-13', [set('a', 100000, 5)]));
    expect(diffSessions(cur, prev).volumeDeltaPct).toBe(-10);
  });

  it('完全持平时文案明确', () => {
    const same = [set('x', 100000, 5)];
    const cur = summarizeSession(session('c', '2026-10-20', same));
    const prev = summarizeSession(session('p', '2026-10-13', same));
    expect(diffSessions(cur, prev).text).toBe('与上次持平');
  });

  it('上次容量为 0 时不给出误导性百分比', () => {
    const cur = summarizeSession(session('c', '2026-10-20', [set('b', 100000, 5)]));
    const prev = summarizeSession(session('p', '2026-10-13', [set('a', 0, 5, { loadGrams: 0 })]));
    expect(diffSessions(cur, prev).volumeDeltaPct).toBeNull();
  });
});

