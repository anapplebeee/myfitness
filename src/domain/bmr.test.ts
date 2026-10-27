import { describe, expect, it } from 'vitest';
import { ageFromBirthYear, mifflinStJeor } from './bmr';

/** BMR 估算：只验公式与边界，不验"这个数字对你合适吗"。 */

describe('Mifflin-St Jeor', () => {
  it('男性：10w + 6.25h − 5a + 5', () => {
    // 80kg, 180cm, 30岁 → 800 + 1125 - 150 + 5 = 1780
    const r = mifflinStJeor({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' });
    expect(r?.bmr).toBe(1780);
  });

  it('女性：10w + 6.25h − 5a − 161', () => {
    // 60kg, 165cm, 28岁 → 600 + 1031.25 - 140 - 161 = 1330.25 → 1330
    const r = mifflinStJeor({ weightKg: 60, heightCm: 165, ageYears: 28, sex: 'female' });
    expect(r?.bmr).toBe(1330);
  });

  it('给出公式说明，便于界面上解释数字来源', () => {
    const r = mifflinStJeor({ weightKg: 80, heightCm: 180, ageYears: 30, sex: 'male' });
    expect(r?.basis).toContain('Mifflin');
    expect(r?.basis).toContain('80');
  });
});

describe('输入不合理时返回 null', () => {
  it('体重为 0', () => {
    expect(mifflinStJeor({ weightKg: 0, heightCm: 180, ageYears: 30, sex: 'male' })).toBeNull();
  });

  it('身高为 0', () => {
    expect(mifflinStJeor({ weightKg: 80, heightCm: 0, ageYears: 30, sex: 'male' })).toBeNull();
  });

  it('年龄超范围', () => {
    expect(mifflinStJeor({ weightKg: 80, heightCm: 180, ageYears: 0, sex: 'male' })).toBeNull();
    expect(mifflinStJeor({ weightKg: 80, heightCm: 180, ageYears: 200, sex: 'male' })).toBeNull();
  });

  it('负数输入', () => {
    expect(mifflinStJeor({ weightKg: -10, heightCm: 180, ageYears: 30, sex: 'male' })).toBeNull();
  });

  it('NaN 输入', () => {
    expect(mifflinStJeor({ weightKg: Number.NaN, heightCm: 180, ageYears: 30, sex: 'male' })).toBeNull();
  });
});

describe('年龄', () => {
  it('由出生年算年龄', () => {
    expect(ageFromBirthYear(1996, new Date('2026-10-27T00:00:00'))).toBe(30);
  });

  it('未填出生年返回 null', () => {
    expect(ageFromBirthYear(null)).toBeNull();
  });

  it('未来年份返回 null', () => {
    expect(ageFromBirthYear(2030, new Date('2026-10-27T00:00:00'))).toBeNull();
  });
});
