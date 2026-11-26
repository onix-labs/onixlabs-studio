import { describe, expect, it } from 'vitest';
import { contentTypeOf, FALLBACK_CONTENT_TYPE, isPage } from './content-types';
import { changeKind, CLIENT_PATH, withReloadClient } from './reload-client';

describe('the reload client (#1062)', () => {
  it('adds_theScript_beforeTheClosingBodyTag', () => {
    expect(withReloadClient('<html><BODY><p>x</p></BODY></html>')).toBe(
      `<html><BODY><p>x</p><script src="${CLIENT_PATH}"></script>\n</BODY></html>`,
    );
  });

  it('adds_theScript_atTheEnd_ofAPageWithNoBodyTag', () => {
    expect(withReloadClient('<p>x</p>')).toBe(`<p>x</p>\n<script src="${CLIENT_PATH}"></script>\n`);
  });

  it('restyles_whenOnlyStylesheetsChanged', () => {
    expect(changeKind(['a.css', 'theme/B.CSS'])).toBe('css');
  });

  it('reloads_whenAnythingElseChanged', () => {
    expect(changeKind(['a.css', 'index.html'])).toBe('reload');
    expect(changeKind(['app.js'])).toBe('reload');
    expect(changeKind([])).toBe('reload');
  });
});

describe('content types (#1062)', () => {
  it.each<[string, string]>([
    ['index.html', 'text/html; charset=utf-8'],
    ['styles/site.CSS', 'text/css; charset=utf-8'],
    ['app.mjs', 'text/javascript; charset=utf-8'],
    ['logo.svg', 'image/svg+xml'],
    ['font.woff2', 'font/woff2'],
    ['module.wasm', 'application/wasm'],
  ])('serves %s as %s', (file: string, type: string) => {
    expect(contentTypeOf(file)).toBe(type);
  });

  it('serves_anUnknownFile_asBytes', () => {
    expect(contentTypeOf('data.bin')).toBe(FALLBACK_CONTENT_TYPE);
    expect(contentTypeOf('folder.d/Makefile')).toBe(FALLBACK_CONTENT_TYPE);
  });

  it('knows_aPage', () => {
    expect(isPage('a.htm')).toBe(true);
    expect(isPage('a.css')).toBe(false);
  });
});
