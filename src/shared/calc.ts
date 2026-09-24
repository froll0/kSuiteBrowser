/**
 * Small calculator for the search page: + - * / ^ %, parentheses, decimals with "." or ",".
 * Parses the expression itself (never eval) and returns null for anything that is not arithmetic.
 */
export function calculate(input: string): number | null {
  const text = input.replace(/\s+/g, '').replace(/,/g, '.').replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/=$/, '');
  if (!/^[\d.+\-*/^%()]+$/.test(text) || !/\d/.test(text) || !/[+\-*/^%]/.test(text.replace(/^-/, ''))) return null;
  // Dates (2026-09-24, 24/09/2026) and phone numbers (079-123-45-67) are not calculations.
  if (/^\d+([-/.])\d+(\1\d+)+$/.test(input.trim().replace(/\s+/g, ''))) return null;

  let pos = 0;
  const peek = () => text[pos];
  const fail = (): never => {
    throw new Error('syntax');
  };

  // expr := term (('+'|'-') term)*
  const expr = (): number => {
    let value = term();
    while (peek() === '+' || peek() === '-') value = text[pos++] === '+' ? value + term() : value - term();
    return value;
  };
  // term := power (('*'|'/'|'%') power)*
  const term = (): number => {
    let value = power();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = text[pos++];
      const right = power();
      value = op === '*' ? value * right : op === '/' ? value / right : value % right;
    }
    return value;
  };
  // power := unary ('^' power)?
  const power = (): number => {
    const base = unary();
    if (peek() === '^') {
      pos++;
      return base ** power();
    }
    return base;
  };
  const unary = (): number => {
    if (peek() === '-') {
      pos++;
      return -unary();
    }
    if (peek() === '+') {
      pos++;
      return unary();
    }
    return atom();
  };
  const atom = (): number => {
    if (peek() === '(') {
      pos++;
      const value = expr();
      if (peek() !== ')') fail();
      pos++;
      return value;
    }
    const match = /^\d+(\.\d+)?|^\.\d+/.exec(text.slice(pos));
    if (!match) fail();
    pos += match![0].length;
    return Number(match![0]);
  };

  try {
    const value = expr();
    if (pos !== text.length || !Number.isFinite(value)) return null;
    return Math.round(value * 1e12) / 1e12;
  } catch {
    return null;
  }
}

export function formatNumber(value: number): string {
  return value.toLocaleString('it-IT', { maximumFractionDigits: 10 });
}
