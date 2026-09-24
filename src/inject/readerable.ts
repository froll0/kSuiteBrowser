// Runs in an isolated world of a web page: is it an article worth offering reader mode for?
// Only the small check, not the whole library (it runs on every page load).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const isProbablyReaderable: (doc: Document, options?: { minContentLength?: number; minScore?: number }) => boolean = require('@mozilla/readability/Readability-readerable.js');

(globalThis as unknown as { __ksReaderable: () => boolean }).__ksReaderable = () =>
  isProbablyReaderable(document, { minContentLength: 140, minScore: 20 });
