import { describe, expect, it } from 'vitest';
import { buildShareCardData } from './share-card';
import type { Session, SetRecord, SessionExercise } from './types';

/**
 * 分享卡片的数据投影。
 *
 * 只测"卡片上显示什么"，不测 canvas 像素——像素靠人眼看截图，
 * 断言颜色的十六进制值意义不大且极易脆断。
 */

function set(partial: Partial<SetRecord> & { id: string }): SetRecord {
  return {
    kind: 'work',
    status: 'completed',
    loadGrams: null,
    reps: null,
    durationSeconds: null,
    distanceMeters: null,
    rpe: null,
    completedAt: '2026-10-26T10:00:00.000Z',
    ...partial,
  };
}

function exercise(exerciseId: string, sets: SetRecord[]): SessionExercise {
  return {
    id: `se_${exerciseId}`,
    exerciseId,
    order: 0,
    targetSets: sets.length,
    repMin: 5,
    repMax: 8,
    restSeconds: 120,
    incrementGrams: 2500,
    sets,
  };
}

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1',
    templateId: null,
    dayId: null,
    title: '上肢 A · 水平推拉',
    status: 'completed',
    startedAt: '2026-10-26T10:00:00.000Z',
    endedAt: '2026-10-26T11:00:00.000Z',
    businessDate: '2026-10-26',
    restEndsAt: null,
    note: '',
    exercises: [
      exercise('bb-squat', [
        set({ id: 'a1', loadGrams: 100000, reps: 5 }),
        set({ id: 'a2', loadGrams: 110000, reps: 3 }),
      ]),
      exercise('bb-bench-press', [set({ id: 'b1', loadGrams: 80000, reps: 8 })]),
    ],
    ...over,
  };
}

describe('卡片基本信息', () => {
  it('标题与日期来自场次', () => {
    const d = buildShareCardData(session());
    expect(d.title).toBe('上肢 A · 水平推拉');
    expect(d.dateLabel).toContain('10月26日');
    expect(d.dateLabel).toContain('周一');
  });

  it('已删除的场次标记为无效', () => {
    const d = buildShareCardData(session({ deletedAt: '2026-10-27T00:00:00.000Z' }));
    expect(d.valid).toBe(false);
  });

  it('未完成的场次标记为无效', () => {
    const d = buildShareCardData(session({ status: 'active', endedAt: null }));
    expect(d.valid).toBe(false);
  });
});

describe('核心数字', () => {
  it('组数只算完成的工作组', () => {
    const s = session({
      exercises: [
        exercise('bb-squat', [
          set({ id: '1', loadGrams: 100000, reps: 5 }),
          set({ id: '2', loadGrams: 100000, reps: 5, status: 'planned' }),
          set({ id: '3', kind: 'warmup', loadGrams: 40000, reps: 10 }),
        ]),
      ],
    });
    expect(buildShareCardData(s).setsValue).toBe('1');
  });

  it('时长不足 1 分钟时不显示', () => {
    const s = session({
      startedAt: '2026-10-26T10:00:00.000Z',
      endedAt: '2026-10-26T10:00:30.000Z',
    });
    expect(buildShareCardData(s).durationValue).toBeNull();
  });

  it('时长满 1 分钟才显示', () => {
    expect(buildShareCardData(session()).durationValue).not.toBeNull();
  });
});

describe('主要动作', () => {
  it('最多三条，按重量降序', () => {
    const s = session({
      exercises: [
        exercise('bb-squat', [set({ id: '1', loadGrams: 60000, reps: 10 })]),
        exercise('bb-deadlift', [set({ id: '2', loadGrams: 150000, reps: 3 })]),
        exercise('bb-bench-press', [set({ id: '3', loadGrams: 80000, reps: 8 })]),
        exercise('bb-row', [set({ id: '4', loadGrams: 70000, reps: 8 })]),
      ],
    });
    const d = buildShareCardData(s);
    expect(d.lifts).toHaveLength(3);
    expect(d.lifts[0]!.weightGrams).toBe(150000);
    expect(d.lifts[1]!.weightGrams).toBe(80000);
    expect(d.lifts[2]!.weightGrams).toBe(70000);
  });

  it('每个动作只取最好一组', () => {
    const d = buildShareCardData(session());
    const squat = d.lifts.find((l) => l.name.includes('深蹲'));
    expect(squat).toBeDefined();
    // 110kg×3 的 e1RM 高于 100kg×5
    expect(squat!.detail).toContain('110');
  });

  it('空动作列表不崩溃', () => {
    const d = buildShareCardData(session({ exercises: [] }));
    expect(d.lifts).toHaveLength(0);
  });

  it('自重动作显示自重而非 0 kg', () => {
    const s = session({
      exercises: [exercise('pull-up', [set({ id: '1', loadGrams: null, reps: 12 })])],
    });
    const d = buildShareCardData(s);
    expect(d.lifts[0]!.detail).toContain('自重');
    expect(d.lifts[0]!.detail).toContain('12');
  });
});
