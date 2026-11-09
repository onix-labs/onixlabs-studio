import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TrustedPaths } from './trusted-paths';

describe('TrustedPaths', () => {
  it('rememberChosen_ofALink_trustsTheNameAndWhereItReallyIs', () => {
    const folder: string = realpathSync(mkdtempSync(join(tmpdir(), 'trusted-chosen-')));
    const target: string = join(folder, 'target.txt');
    const link: string = join(folder, 'link.txt');
    writeFileSync(target, 'x');
    symlinkSync(target, link);
    const trusted: TrustedPaths = new TrustedPaths(join(folder, 'trusted.json'));

    trusted.rememberChosen(link);

    expect(trusted.has(link)).toBe(true);
    expect(trusted.has(target)).toBe(true);
    rmSync(folder, { recursive: true, force: true });
  });

  it('rememberChosen_ofAPlainFile_remembersItOnce', () => {
    const folder: string = realpathSync(mkdtempSync(join(tmpdir(), 'trusted-chosen-')));
    const trusted: TrustedPaths = new TrustedPaths(join(folder, 'trusted.json'));

    trusted.rememberChosen(join(folder, 'new.txt'));

    expect(trusted.list()).toEqual([join(folder, 'new.txt')]);
    rmSync(folder, { recursive: true, force: true });
  });

  it('remember_ofALink_trustsOnlyTheName', () => {
    const folder: string = realpathSync(mkdtempSync(join(tmpdir(), 'trusted-chosen-')));
    const target: string = join(folder, 'target.txt');
    const link: string = join(folder, 'link.txt');
    writeFileSync(target, 'x');
    symlinkSync(target, link);
    const trusted: TrustedPaths = new TrustedPaths(join(folder, 'trusted.json'));

    trusted.remember(link);

    expect(trusted.has(target)).toBe(false);
    rmSync(folder, { recursive: true, force: true });
  });

  let folder: string;
  let file: string;

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'trusted-paths-'));
    file = join(folder, 'trusted-paths.json');
  });

  afterEach(() => {
    rmSync(folder, { recursive: true, force: true });
  });

  it('list_returnsTheRememberedPaths_newestFirst', () => {
    const trusted: TrustedPaths = new TrustedPaths(file);
    trusted.remember('/a');
    trusted.remember('/b');

    expect(trusted.list()).toEqual(['/b', '/a']);
  });

  it('forget_dropsOnePath_andPersistsTheRest', () => {
    const trusted: TrustedPaths = new TrustedPaths(file);
    trusted.remember('/a');
    trusted.remember('/b');

    trusted.forget('/a');

    expect(trusted.has('/a')).toBe(false);
    expect(new TrustedPaths(file).list()).toEqual(['/b']);
  });

  it('forget_whenThePathIsNotRemembered_changesNothing', () => {
    const trusted: TrustedPaths = new TrustedPaths(file);
    trusted.remember('/a');

    trusted.forget('/elsewhere');
    trusted.forget(42);

    expect(trusted.list()).toEqual(['/a']);
  });

  it('clear_forgetsEverything', () => {
    const trusted: TrustedPaths = new TrustedPaths(file);
    trusted.remember('/a');

    trusted.clear();

    expect(trusted.has('/a')).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
  });
});
