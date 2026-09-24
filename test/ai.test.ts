import { describe, expect, it } from 'vitest';
import { pickDefaultModel } from '../src/api/ai';
import { quoted, textActionMessages } from '../src/shared/ai-prompts';
import { parseInline, parseMarkdown } from '../src/shared/markdown';
import { ChatStreamParser } from '../src/shared/sse';

describe('ChatStreamParser', () => {
  it('extracts deltas across chunk boundaries', () => {
    const p = new ChatStreamParser();
    const a = p.push('data: {"choices":[{"delta":{"content":"Cia"}}]}\n\ndata: {"choices":[{"del');
    const b = p.push('ta":{"content":"o!"}}]}\n\ndata: [DONE]\n\n');
    expect([...a, ...b]).toEqual(['Cia', 'o!']);
    expect(p.done).toBe(true);
  });

  it('ignores comments, empty deltas and bad JSON', () => {
    const p = new ChatStreamParser();
    expect(p.push(': keep-alive\n\ndata: {"choices":[{"delta":{}}]}\n\ndata: {oops\n\n')).toEqual([]);
    expect(p.push('data: {"choices":[{"delta":{"content":"x"}}]}')).toEqual([]);
    expect(p.flush()).toEqual(['x']);
  });
});

describe('markdown', () => {
  it('parses the subset used by AI answers', () => {
    expect(parseMarkdown('# Titolo\n\nCiao **mondo** e *tutti*.\n\n- uno\n- due `x`\n\n1. primo\n2. secondo\n\n```\ncodice\n```')).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', text: 'Titolo' }] },
      { type: 'paragraph', children: [
        { type: 'text', text: 'Ciao ' }, { type: 'strong', children: [{ type: 'text', text: 'mondo' }] },
        { type: 'text', text: ' e ' }, { type: 'em', children: [{ type: 'text', text: 'tutti' }] }, { type: 'text', text: '.' },
      ] },
      { type: 'list', ordered: false, items: [[{ type: 'text', text: 'uno' }], [{ type: 'text', text: 'due ' }, { type: 'code', text: 'x' }]] },
      { type: 'list', ordered: true, items: [[{ type: 'text', text: 'primo' }], [{ type: 'text', text: 'secondo' }]] },
      { type: 'code', text: 'codice' },
    ]);
  });

  it('only turns web links into links', () => {
    const nodes = parseInline('[sito](https://ik.me) e [male](javascript:alert(1))');
    expect(nodes[0]).toEqual({ type: 'link', href: 'https://ik.me', children: [{ type: 'text', text: 'sito' }] });
    expect(nodes.filter((n) => n.type === 'link')).toHaveLength(1);
    expect(nodes.some((n) => n.type === 'text' && n.text === 'male')).toBe(true);
  });
});

describe('prompts', () => {
  it('quotes untrusted text and clips it', () => {
    const q = quoted('Pagina', 'a"""b', 3);
    expect(q).toContain('Pagina:');
    expect(q).toContain('[…testo troncato…]');
    expect(q.match(/"""/g)).toHaveLength(2);
    expect(textActionMessages('summarize', 'ciao')[0].content).toMatch(/^Riassumi/);
  });
});

describe('pickDefaultModel', () => {
  const m = (name: string) => ({ name, type: 'llm', description: null });
  it('prefers Mistral/Mixtral, then Qwen, then Llama', () => {
    expect(pickDefaultModel([m('llama3'), m('qwen3'), m('mixtral')])).toBe('mixtral');
    expect(pickDefaultModel([m('llama3'), m('qwen3')])).toBe('qwen3');
    expect(pickDefaultModel([m('gemma')])).toBe('gemma');
    expect(pickDefaultModel([])).toBeNull();
  });
});
