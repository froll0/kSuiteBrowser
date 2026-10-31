import { describe, expect, it } from 'vitest';
import { debounce } from '../src/shared/debounce';
import { cookieBelongsTo, openSites, sitesToForget } from '../src/shared/forget-sites';

describe('bounce links', () => {
  it('go straight to the destination', () => {
    expect(debounce('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&h=AT0')).toBe('https://example.com/a?b=1');
    expect(debounce('https://www.google.com/url?q=https://example.org/&sa=D&ust=1')).toBe('https://example.org/');
    expect(debounce('https://out.reddit.com/t3_x?url=https%3A%2F%2Fnews.example%2F&token=1')).toBe('https://news.example/');
    expect(debounce('https://www.youtube.com/redirect?event=video_description&q=https%3A%2F%2Fshop.example%2F')).toBe('https://shop.example/');
    expect(debounce('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.net%2F')).toBe('https://example.net/');
  });

  it('leave everything else alone', () => {
    expect(debounce('https://www.google.com/search?q=velo')).toBeNull();
    expect(debounce('https://example.com/?url=https://other.example/')).toBeNull();
    expect(debounce('https://l.facebook.com/l.php?u=javascript%3Aalert(1)')).toBeNull();
    expect(debounce('https://l.facebook.com/l.php?u=https%3A%2F%2Fout.reddit.com%2F%3Furl%3Dhttps%3A%2F%2Fx.example')).toBeNull();
    expect(debounce('not a url')).toBeNull();
  });
});

describe('forgetting sites when their tabs close', () => {
  it('clears the sites no tab shows any more, except the remembered ones', () => {
    const before = openSites(['https://www.news.example/a', 'https://mail.example.com/', 'https://shop.example/', 'velo://newtab/']);
    const now = openSites(['https://news.example/b']);
    expect(sitesToForget(before, now, ['example.com'])).toEqual(['shop.example']);
  });

  it('matches cookies of the site and its subdomains only', () => {
    expect(cookieBelongsTo('.example.com', 'example.com')).toBe(true);
    expect(cookieBelongsTo('accounts.example.com', 'example.com')).toBe(true);
    expect(cookieBelongsTo('notexample.com', 'example.com')).toBe(false);
  });
});
