import { describe, expect, it } from 'vitest';
import {
  addDay,
  addExercise,
  blankTemplate,
  bumpVersion,
  cloneTemplate,
  defaultPlanExercise,
  isSameTemplate,
  moveExercise,
  removeDay,
  removeExercise,
  templateSummary,
  updateDay,
  updateExercise,
  validateTemplate,
} from './template';
import type { Template } from '../content/types';

function tpl(): Template {
  return {
    id: 't1',
    title: '测试模板',
    subtitle: '',
    daysPerWeek: 2,
    level: 'beginner',
    equipment: 'gym',
    version: 1,
    progression: '',
    days: [
      {
        id: 'd0',
        title: '第 1 天',
        slot: 0,
        exercises: [defaultPlanExercise('bb-squat')],
      },
      {
        id: 'd1',
        title: '第 2 天',
        slot: 3,
        exercises: [defaultPlanExercise('bb-bench')],
      },
    ],
  };
}

describe('validateTemplate', () => {
  it('合法模板无问题', () => {
    expect(validateTemplate(tpl())).toHaveLength(0);
  });

  it('名称为空报错', () => {
    const t = tpl();
    t.title = '  ';
    expect(validateTemplate(t)[0]?.message).toContain('名称');
  });

  it('同一天不能有两个训练日', () => {
    const t = tpl();
    t.days[1]!.slot = 0;
    expect(validateTemplate(t).some((i) => i.message.includes('同一天'))).toBe(true);
  });

  it('训练日为空报错', () => {
    const t = tpl();
    t.days[0]!.exercises = [];
    expect(validateTemplate(t).some((i) => i.message.includes('至少需要一个动作'))).toBe(true);
  });

  it('组数越界报错', () => {
    const t = tpl();
    t.days[0]!.exercises[0]!.sets = 0;
    expect(validateTemplate(t).some((i) => i.message.includes('组数'))).toBe(true);
  });

  it('次数上限小于下限报错', () => {
    const t = tpl();
    t.days[0]!.exercises[0]!.repMin = 12;
    t.days[0]!.exercises[0]!.repMax = 8;
    expect(validateTemplate(t).some((i) => i.message.includes('上限'))).toBe(true);
  });

  it('未知动作报错', () => {
    const t = tpl();
    t.days[0]!.exercises[0]!.exerciseId = 'not-exist';
    expect(validateTemplate(t).some((i) => i.message.includes('不存在'))).toBe(true);
  });

  it('休息时间越界报错', () => {
    const t = tpl();
    t.days[0]!.exercises[0]!.restSeconds = 999;
    expect(validateTemplate(t).some((i) => i.message.includes('休息'))).toBe(true);
  });
});

describe('模板编辑不修改原对象', () => {
  it('addExercise 返回新对象，原模板不变', () => {
    const original = tpl();
    const next = addExercise(original, 'd0', defaultPlanExercise('rdl'));
    expect(original.days[0]!.exercises).toHaveLength(1);
    expect(next.days[0]!.exercises).toHaveLength(2);
  });

  it('updateExercise 只改目标动作', () => {
    const original = tpl();
    const next = updateExercise(original, 'd0', 0, { sets: 5 });
    expect(next.days[0]!.exercises[0]!.sets).toBe(5);
    expect(original.days[0]!.exercises[0]!.sets).toBe(3);
  });

  it('removeExercise 按索引删除', () => {
    let t = tpl();
    t = addExercise(t, 'd0', defaultPlanExercise('rdl'));
    const next = removeExercise(t, 'd0', 0);
    expect(next.days[0]!.exercises).toHaveLength(1);
    expect(next.days[0]!.exercises[0]!.exerciseId).toBe('rdl');
  });

  it('moveExercise 调整顺序', () => {
    let t = tpl();
    t = addExercise(t, 'd0', defaultPlanExercise('rdl'));
    const next = moveExercise(t, 'd0', 1, -1);
    expect(next.days[0]!.exercises[0]!.exerciseId).toBe('rdl');
  });

  it('moveExercise 越界不动', () => {
    const t = tpl();
    const next = moveExercise(t, 'd0', 0, -1);
    expect(next.days[0]!.exercises[0]!.exerciseId).toBe('bb-squat');
  });
});

describe('训练日管理', () => {
  it('addDay 增加一天并同步 daysPerWeek', () => {
    const next = addDay(tpl(), 'd2', 5);
    expect(next.days).toHaveLength(3);
    expect(next.daysPerWeek).toBe(3);
  });

  it('removeDay 删除并同步 daysPerWeek', () => {
    const next = removeDay(tpl(), 'd1');
    expect(next.days).toHaveLength(1);
    expect(next.daysPerWeek).toBe(1);
  });

  it('updateDay 修改标题与星期', () => {
    const next = updateDay(tpl(), 'd0', { title: '推日', slot: 1 });
    expect(next.days[0]!.title).toBe('推日');
    expect(next.days[0]!.slot).toBe(1);
  });
});

describe('版本化', () => {
  it('bumpVersion 版本加一并深拷贝', () => {
    const original = tpl();
    const next = bumpVersion(original);
    expect(next.version).toBe(2);
    next.days[0]!.exercises[0]!.sets = 9;
    expect(original.days[0]!.exercises[0]!.sets).toBe(3);
  });

  it('isSameTemplate 忽略版本差异', () => {
    const a = tpl();
    const b = { ...cloneTemplate(a), version: 7 };
    expect(isSameTemplate(a, b)).toBe(true);
  });

  it('内容不同则 isSameTemplate 为 false', () => {
    const a = tpl();
    const b = updateExercise(a, 'd0', 0, { sets: 4 });
    expect(isSameTemplate(a, b)).toBe(false);
  });
});

describe('blankTemplate 与摘要', () => {
  it('空白模板可校验（虽有动作数为 0 的问题）', () => {
    const t = blankTemplate('new');
    expect(t.days).toHaveLength(1);
    expect(validateTemplate(t).some((i) => i.message.includes('至少需要一个动作'))).toBe(true);
  });

  it('摘要显示天数与动作数', () => {
    expect(templateSummary(tpl())).toBe('2 天 · 2 个动作');
  });
});
