import { beforeEach, describe, expect, it } from 'vitest';
import { forgetArrival, originOf, peekIntent, resetNavigation, setIntent, takeIntent } from './useNavigation';

/**
 * 导航意图与来源。
 *
 * 这里测的是"跳转语义"，不是渲染：
 * 目的地是否拿得到意图、来源是否记得住、主动切标签是否作废来源。
 */

beforeEach(() => {
  resetNavigation();
});

describe('意图', () => {
  it('设置后能取到', () => {
    setIntent({ to: 'train', focus: { kind: 'history' } });
    expect(takeIntent()?.focus).toEqual({ kind: 'history' });
  });

  it('取走即清空，不会重复生效', () => {
    setIntent({ to: 'train', focus: { kind: 'history' } });
    takeIntent();
    expect(takeIntent()).toBeNull();
  });

  it('peek 不消费', () => {
    setIntent({ to: 'plan', focus: { kind: 'week', start: '2026-10-19' } });
    expect(peekIntent()?.to).toBe('plan');
    expect(peekIntent()?.to).toBe('plan');
    expect(takeIntent()?.to).toBe('plan');
  });
});

describe('来源', () => {
  it('带 from 的跳转记得住来源', () => {
    setIntent({ to: 'train', from: 'today' });
    expect(originOf('train')).toBe('today');
  });

  it('不带 from 的跳转不产生来源', () => {
    setIntent({ to: 'train' });
    expect(originOf('train')).toBeNull();
  });

  it('主动切标签后来源作废', () => {
    setIntent({ to: 'train', from: 'today' });
    expect(originOf('train')).toBe('today');
    forgetArrival('train');
    expect(originOf('train')).toBeNull();
  });

  it('重复同一条跳转不会重复压栈', () => {
    setIntent({ to: 'train', from: 'today' });
    setIntent({ to: 'train', from: 'today' });
    expect(originOf('train')).toBe('today');
    forgetArrival('train');
    // 只压了一条，清一次就干净
    expect(originOf('train')).toBeNull();
  });

  it('多条来源互不影响', () => {
    setIntent({ to: 'train', from: 'today' });
    setIntent({ to: 'plan', from: 'coach' });
    expect(originOf('train')).toBe('today');
    expect(originOf('plan')).toBe('coach');
  });
});

describe('重置', () => {
  it('清空全部状态', () => {
    setIntent({ to: 'train', from: 'today' });
    resetNavigation();
    expect(takeIntent()).toBeNull();
    expect(originOf('train')).toBeNull();
  });
});
