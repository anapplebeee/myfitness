/**
 * 轻量 Markdown 解析（只用于展示 AI 回复）。
 *
 * 为什么不用现成库、也不用 v-html：
 * 模型输出是**不可信内容**。用 v-html 渲染它等于把 XSS 的风险交给模型。
 * 所以这里把文本解析成**结构化数据**，再由 Vue 模板渲染成元素——
 * 恶意 HTML 只会变成纯文本，不会被解释执行。
 *
 * 只支持模型最常用的写法：
 *   **粗体**、`代码`、- 列表、1. 有序列表、空行分段
 * 其余一律当普通文本。
 */

export type InlineSegment = { text: string; bold: boolean; code: boolean };

export type Block =
  | { kind: 'paragraph'; segments: InlineSegment[] }
  | { kind: 'heading'; segments: InlineSegment[] }
  | { kind: 'list'; ordered: boolean; items: InlineSegment[][] };

/**
 * 解析行内标记。
 *
 * 用简单的字符扫描而不是正则替换，避免嵌套与转义带来的边界问题。
 * 未闭合的标记一律当普通文本——宁可显示星号，也不要吞掉用户内容。
 */
export function parseInline(text: string): InlineSegment[] {
  const out: InlineSegment[] = [];
  let buf = '';
  let i = 0;

  const flush = () => {
    if (buf) {
      out.push({ text: buf, bold: false, code: false });
      buf = '';
    }
  };

  while (i < text.length) {
    // 粗体：**...**
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ text: text.slice(i + 2, end), bold: true, code: false });
        i = end + 2;
        continue;
      }
    }

    // 行内代码：`...`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ text: text.slice(i + 1, end), bold: false, code: true });
        i = end + 1;
        continue;
      }
    }

    buf += text[i];
    i += 1;
  }

  flush();
  return out.length ? out : [{ text, bold: false, code: false }];
}

/** 把整段文本解析成块。 */
export function parseMarkdownLite(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 标题：## 或 ###
    if (/^#{1,4}\s+/.test(trimmed)) {
      blocks.push({ kind: 'heading', segments: parseInline(trimmed.replace(/^#{1,4}\s+/, '')) });
      i += 1;
      continue;
    }

    // 有序列表：1. 2) 等
    if (/^\d+[.)]\s+/.test(trimmed)) {
      const items: InlineSegment[][] = [];
      while (i < lines.length) {
        const t = (lines[i] ?? '').trim();
        const m = /^\d+[.)]\s+(.*)$/.exec(t);
        if (!m) break;
        items.push(parseInline(m[1] ?? ''));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered: true, items });
      continue;
    }

    // 无序列表：- 或 *
    if (/^[-*]\s+/.test(trimmed)) {
      const items: InlineSegment[][] = [];
      while (i < lines.length) {
        const t = (lines[i] ?? '').trim();
        const m = /^[-*]\s+(.*)$/.exec(t);
        if (!m) break;
        items.push(parseInline(m[1] ?? ''));
        i += 1;
      }
      blocks.push({ kind: 'list', ordered: false, items });
      continue;
    }

    // 普通段落：连续非空行合并（中文换行通常不是分段）
    const para: string[] = [];
    while (i < lines.length) {
      const t = (lines[i] ?? '').trim();
      if (!t || /^(#{1,4}\s|[-*]\s|\d+[.)]\s)/.test(t)) break;
      para.push(t);
      i += 1;
    }
    blocks.push({ kind: 'paragraph', segments: parseInline(para.join(' ')) });
  }

  return blocks;
}
