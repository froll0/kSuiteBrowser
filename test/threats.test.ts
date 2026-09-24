import { describe, expect, it } from 'vitest';
import { ThreatIndex, parseThreatList } from '../src/shared/threat-match';

const LIST = `! Title: Phishing URL Blocklist
! Updated: today
||evil-login.example^
||bank-verify.test^$all
||docs.google.com/forms/d/e/1faipqlsbad^
|https://sites.example.org/scam/page.html|
0.0.0.0 hosts-style.example
plain-domain.example
@@||allowed.example^
example.com##.ad
||bad*.example^
1.2.3.4
`;

describe('threat lists', () => {
  const parsed = parseThreatList(LIST);
  it('parses adblock, hosts and plain formats', () => {
    expect(parsed.hosts).toEqual(['evil-login.example', 'bank-verify.test', 'hosts-style.example', 'plain-domain.example', '1.2.3.4']);
    expect(parsed.urls).toEqual(['docs.google.com/forms/d/e/1faipqlsbad', 'sites.example.org/scam/page.html']);
  });
  it('matches hosts, subdomains and bad pages only', () => {
    const index = new ThreatIndex();
    index.add('phishing', parsed);
    index.add('malware', { hosts: ['malware.example', 'evil-login.example'], urls: [] });
    expect(index.match('https://evil-login.example/')).toBe('phishing');
    expect(index.match('http://www.bank-verify.test/login?x=1')).toBe('phishing');
    expect(index.match('https://malware.example/file.exe')).toBe('malware');
    expect(index.match('https://docs.google.com/forms/d/e/1FAIpQLSbad/viewform')).toBe('phishing');
    expect(index.match('https://docs.google.com/forms/d/e/other/viewform')).toBeNull();
    expect(index.match('https://example.org/')).toBeNull();
    expect(index.match('https://notevil-login.example/')).toBeNull();
    expect(index.match('ksuite://settings/')).toBeNull();
    expect(index.match('http://1.2.3.4/x')).toBe('phishing');
    expect(index.size).toBe(8);
  });
});

describe('dangerous files', () => {
  it('recognises programs, scripts and macro documents', async () => {
    const { dangerousFileKind } = await import('../src/shared/dangerous-files');
    expect(dangerousFileKind('Setup.EXE')).toBe('un programma');
    expect(dangerousFileKind('fattura.pdf.js')).toBe('uno script');
    expect(dangerousFileKind('report.xlsm')).toBe('un documento con macro');
    expect(dangerousFileKind('foto.jpg')).toBeNull();
    expect(dangerousFileKind('README')).toBeNull();
  });
});
