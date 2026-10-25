import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdownLite } from './markdown-lite';

describe('行内解析', () => {
  it('粗体被识别', () => {
    const segs = parseInline('这是**重点**内容');
    expect(segs).toHaveLength(3);
    expect(segs.some((s) => s.bold && s.text === '重点')).toBe(true);
  });

  it('行内代码被识别', () => {
    const segs = parseInline('用 `2.5kg` 递增');
    expect(segs.some((s) => s.code && s.text === '2.5kg')).toBe(true);
  });

  it('普通文本原样保留', () => {
    const segs = parseInline('没有任何标记');
    expect(segs).toHaveLength(1);
    expect(segs[0]!.text).toBe('没有任何标记');
  });

  it('未闭合的星号当普通文本（不吞内容）', () => {
    const segs = parseInline('未闭合 **粗体');
    const all = segs.map((s) => s.text).join('');
    expect(all).toContain('粗体');
    expect(segs.every((s) => !s.bold)).toBe(true);
  });

  it('空粗体 ** 不算标记', () => {
    const segs = parseInline('a****b');
    expect(segs.every((s) => !s.bold)).toBe(true);
  });

  it('多个粗体分别识别', () => {
    const segs = parseInline('**A** 和 **B**');
    expect(segs.filter((s) => s.bold).map((s) => s.text)).toEqual(['A', 'B']);
  });
});

describe('块级解析', () => {
  it('空行分段', () => {
    const blocks = parseMarkdownLite('第一段\n\n第二段');
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b.kind === 'paragraph')).toBe(true);
  });

  it('无序列表被识别', () => {
    const blocks = parseMarkdownLite('- 第一项\n- 第二项\n- 第三项');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('list');
    if (blocks[0]!.kind === 'list') {
      expect(blocks[0]!.ordered).toBe(false);
      expect(blocks[0]!.items).toHaveLength(3);
    }
  });

  it('有序列表被识别', () => {
    const blocks = parseMarkdownLite('1. 满足条件一\n2. 满足条件二\n3. 满足条件三');
    expect(blocks[0]!.kind).toBe('list');
    if (blocks[0]!.kind === 'list') {
      expect(blocks[0]!.ordered).toBe(true);
      expect(blocks[0]!.items).toHaveLength(3);
    }
  });

  it('标题被识别', () => {
    const blocks = parseMarkdownLite('## 结论\n内容');
    expect(blocks[0]!.kind).toBe('heading');
  });

  it('列表项内的粗体保留', () => {
    const blocks = parseMarkdownLite('- **重点**说明');
    if (blocks[0]!.kind === 'list') {
      expect(blocks[0]!.items[0]!.some((s) => s.bold)).toBe(true);
    }
  });

  it('纯文本仍能解析', () => {
    const blocks = parseMarkdownLite('就是一句话');
    expect(blocks).toHaveLength(1);
  });

  it('空字符串返回空数组', () => {
    expect(parseMarkdownLite('')).toHaveLength(0);
  });

  it('只含空白返回空数组', () => {
    expect(parseMarkdownLite('   \n\n  ')).toHaveLength(0);
  });
});

describe('安全：模型输出不可信', () => {
  it('HTML 标签保持为纯文本，不被当作标记', () => {
    const blocks = parseMarkdownLite('<script>alert(1)</script>');
    const seg = blocks[0]!.kind === 'paragraph' ? blocks[0]!.segments[0]! : null;
    // 解析结果里保留原样字符串——渲染层用 {{ }} 插值，不会执行
    expect(seg!.text).toContain('<script>');
  });

  it('img onerror 不会产生可执行结构', () => {
    const blocks = parseMarkdownLite('<img src=x onerror=alert(1)>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.kind).toBe('paragraph');
  });

  it('javascript: 链接保持纯文本', () => {
    const segs = parseInline('[点我](javascript:alert(1))');
    expect(segs.map((s) => s.text).join('')).toContain('javascript:');
  });
});

describe('真实模型回复形态', () => {
  const sample = `满足以下 3 条就加，否则不加：

1. **上周深蹲全部组次都按计划完成**，最后一组还能剩 1–2 次力气（RPE ≤ 8）；
2. **动作质量稳定**，没有明显塌腰；
3. **本周睡眠正常**。

**结论**：满足就加 2.5kg。`;

  it('能解析出列表与段落', () => {
    const blocks = parseMarkdownLite(sample);
    expect(blocks.some((b) => b.kind === 'list')).toBe(true);
    expect(blocks.some((b) => b.kind === 'paragraph')).toBe(true);
  });

  it('粗体不残留星号', () => {
    const blocks = parseMarkdownLite(sample);
    const allText = JSON.stringify(blocks);
    // 星号只应作为标记被消耗，不应留在输出文本里
    expect(allText.includes('**上周深蹲')).toBe(false);
  });

  it('有序列表三项都被保留', () => {
    const blocks = parseMarkdownLite(sample);
    const list = blocks.find((b) => b.kind === 'list');
    expect(list && list.kind === 'list' ? list.items.length : 0).toBe(3);
  });
});
