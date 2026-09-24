// Runs in an isolated world of a web page: extracts the article (on a copy, the page is not changed).
import type { Readability as ReadabilityType } from '@mozilla/readability';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Readability: typeof ReadabilityType = require('@mozilla/readability/Readability.js');

(globalThis as unknown as { __ksReadability: () => unknown }).__ksReadability = () => {
  const article = new Readability(document.cloneNode(true) as Document, { charThreshold: 400, keepClasses: false }).parse();
  if (!article?.content) return null;
  return {
    title: article.title || document.title,
    byline: article.byline ?? null,
    siteName: article.siteName ?? null,
    lang: article.lang || document.documentElement.lang || null,
    dir: article.dir ?? null,
    publishedTime: article.publishedTime ?? null,
    excerpt: article.excerpt ?? null,
    content: article.content,
    length: article.length ?? 0,
  };
};
