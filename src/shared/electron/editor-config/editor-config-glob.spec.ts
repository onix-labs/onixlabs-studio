import { describe, expect, it } from 'vitest';
import { matchesEditorConfigGlob } from './editor-config-glob';

describe('matchesEditorConfigGlob', () => {
  it.each<[string, string, boolean]>([
    ['*', 'app.ts', true],
    ['*', 'src/deep/app.ts', true],
    ['*.ts', 'src/app.ts', true],
    ['*.ts', 'app.ts', true],
    ['*.ts', 'app.js', false],
    ['app.ts', 'src/app.ts', true],
    ['lib/*.ts', 'lib/app.ts', true],
    ['lib/*.ts', 'lib/deep/app.ts', false],
    ['lib/*.ts', 'src/lib/app.ts', false],
    ['/lib/*.ts', 'lib/app.ts', true],
    ['lib/**.ts', 'lib/deep/app.ts', true],
    ['**/app.ts', 'app.ts', true],
    ['**/app.ts', 'a/b/app.ts', true],
    ['a?c.ts', 'abc.ts', true],
    ['a?c.ts', 'a/c.ts', false],
    ['[abc].ts', 'b.ts', true],
    ['[abc].ts', 'd.ts', false],
    ['[!abc].ts', 'd.ts', true],
    ['[!abc].ts', 'a.ts', false],
    ['[a-c].ts', 'b.ts', true],
    ['{a,b}.ts', 'b.ts', true],
    ['{a,b}.ts', 'c.ts', false],
    ['*.{ts,js}', 'src/app.js', true],
    ['{src/a,lib/b}.ts', 'lib/b.ts', true],
    ['*.{a,{b,c}}', 'x.c', true],
    ['{single}.ts', '{single}.ts', true],
    ['{single}.ts', 'single.ts', false],
    ['{unclosed.ts', '{unclosed.ts', true],
    ['file{1..3}.ts', 'file2.ts', true],
    ['file{1..3}.ts', 'file4.ts', false],
    ['file{3..1}.ts', 'file2.ts', true],
    ['file{-2..2}.ts', 'file-1.ts', true],
    ['file{1..30}.ts', 'file007.ts', false],
    ['\\*.ts', '*.ts', true],
    ['\\*.ts', 'a.ts', false],
  ])('%s against %s is %s', (pattern: string, path: string, expected: boolean) => {
    expect(matchesEditorConfigGlob(pattern, path)).toBe(expected);
  });

  it('refuses a name longer than the specification allows', () => {
    expect(matchesEditorConfigGlob(`${'a'.repeat(2000)}`, 'a'.repeat(2000))).toBe(false);
  });

  it('refuses braces that would expand past reason', () => {
    expect(matchesEditorConfigGlob('{a,b}'.repeat(12), 'a'.repeat(12))).toBe(false);
  });

  it('stays quick on a pattern built to backtrack', () => {
    const started: number = performance.now();

    matchesEditorConfigGlob(`${'*a'.repeat(100)}b`, 'a'.repeat(200));

    expect(performance.now() - started).toBeLessThan(500);
  });
});
