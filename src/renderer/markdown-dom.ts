import { parseMarkdown, type Inline } from '../shared/markdown';

/** Builds DOM nodes for an AI answer (no innerHTML: model output is never parsed as HTML). */
export function renderMarkdown(source: string, openLink: (url: string) => void): DocumentFragment {
  const frag = document.createDocumentFragment();
  const inline = (nodes: Inline[], parent: Node) => {
    for (const n of nodes) {
      if (n.type === 'text') parent.appendChild(document.createTextNode(n.text));
      else if (n.type === 'code') {
        const code = document.createElement('code');
        code.textContent = n.text;
        parent.appendChild(code);
      } else if (n.type === 'link') {
        const a = document.createElement('a');
        a.href = n.href;
        a.title = n.href;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          openLink(n.href);
        });
        inline(n.children, a);
        parent.appendChild(a);
      } else {
        const el = document.createElement(n.type === 'strong' ? 'strong' : 'em');
        inline(n.children, el);
        parent.appendChild(el);
      }
    }
  };
  for (const block of parseMarkdown(source)) {
    if (block.type === 'code') {
      const pre = document.createElement('pre');
      pre.textContent = block.text;
      frag.appendChild(pre);
    } else if (block.type === 'list') {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const li = document.createElement('li');
        inline(item, li);
        list.appendChild(li);
      }
      frag.appendChild(list);
    } else {
      const el = document.createElement(block.type === 'heading' ? `h${Math.min(6, block.level + 3)}` : 'p');
      inline(block.children, el);
      frag.appendChild(el);
    }
  }
  return frag;
}
