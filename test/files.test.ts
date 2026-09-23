import { describe, expect, it } from 'vitest';
import { fileNameFromContentDisposition, fileNameFromUrl, safeFileName } from '../src/main/files';

describe('file names', () => {
  it('sanitizes invalid characters', () => {
    expect(safeFileName('a/b:c*?.pdf')).toBe('a_b_c__.pdf');
    expect(safeFileName('   ')).toBe('file');
  });

  it('derives names from URLs', () => {
    expect(fileNameFromUrl('https://example.com/docs/report%202026.pdf?x=1')).toBe('report 2026.pdf');
    expect(fileNameFromUrl('https://example.com/')).toBe('example.com');
  });

  it('parses Content-Disposition', () => {
    expect(fileNameFromContentDisposition('attachment; filename="fattura.pdf"')).toBe('fattura.pdf');
    expect(fileNameFromContentDisposition("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf")).toBe('résumé.pdf');
    expect(fileNameFromContentDisposition(null)).toBeNull();
  });
});
