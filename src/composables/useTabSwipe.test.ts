import { describe, expect, it } from 'vitest';
import { resolveTabSwipe } from './useTabSwipe';

describe('resolveTabSwipe', () => {
  it('向左滑够远 → 下一页', () => {
    expect(resolveTabSwipe(-80, 6)).toBe('next');
  });

  it('向右滑够远 → 上一页', () => {
    expect(resolveTabSwipe(80, -6)).toBe('prev');
  });

  it('位移不足 → 不切页', () => {
    expect(resolveTabSwipe(-40, 2)).toBeNull();
    expect(resolveTabSwipe(20, 0)).toBeNull();
  });

  it('竖向为主 → 不切页（把手势还给滚动）', () => {
    expect(resolveTabSwipe(-70, 80)).toBeNull();
    expect(resolveTabSwipe(70, -90)).toBeNull();
  });

  it('横向刚好压过竖向 1.4 倍才算，避免斜滑误触', () => {
    expect(resolveTabSwipe(-84, 60)).toBe('next'); // 84 > 60*1.4=84 边界
    expect(resolveTabSwipe(-83, 60)).toBeNull();
  });

  it('阈值可调', () => {
    expect(resolveTabSwipe(-40, 0, 30)).toBe('next');
    expect(resolveTabSwipe(-40, 0, 90)).toBeNull();
  });
});
