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

  it('rememberOpened_howeverMany_forgetsNoChosenPath', () => {
    const trusted: TrustedPaths = new TrustedPaths(file, 2);
    trusted.remember('/repo');
    trusted.remember('/repo/worktrees/one');

    for (const name of ['a', 'b', 'c']) {
      trusted.rememberOpened(`/repo/src/${name}.ts`);
    }

    expect(trusted.list()).toEqual([
      '/repo/src/c.ts',
      '/repo/src/b.ts',
      '/repo/worktrees/one',
      '/repo',
    ]);
  });

  it('remember_whenFull_forgetsTheOldestChosenPath_andNoOpenedOne', () => {
    const trusted: TrustedPaths = new TrustedPaths(file, 2);
    trusted.rememberOpened('/a/opened.ts');
    trusted.remember('/a');
    trusted.remember('/b');

    trusted.remember('/c');

    expect(trusted.list()).toEqual(['/c', '/b', '/a/opened.ts']);
  });

  it('rememberOpened_ofAChosenPath_leavesItChosen', () => {
    const trusted: TrustedPaths = new TrustedPaths(file, 1);
    trusted.remember('/a/chosen.ts');

    trusted.rememberOpened('/a/chosen.ts');
    trusted.rememberOpened('/a/b.ts');
    trusted.rememberOpened('/a/c.ts');

    expect(trusted.has('/a/chosen.ts')).toBe(true);
  });

  it('remember_ofAnOpenedPath_makesItChosen', () => {
    const trusted: TrustedPaths = new TrustedPaths(file, 1);
    trusted.rememberOpened('/a/b.ts');

    trusted.remember('/a/b.ts');
    trusted.rememberOpened('/a/c.ts');
    trusted.rememberOpened('/a/d.ts');

    expect(trusted.has('/a/b.ts')).toBe(true);
  });

  it('refresh_makesARememberedPathTheNewest_andGrantsNothing', () => {
    const trusted: TrustedPaths = new TrustedPaths(file, 2);
    trusted.remember('/a');
    trusted.remember('/b');

    trusted.refresh('/a');
    trusted.refresh('/never-remembered');
    trusted.remember('/c');

    expect(trusted.list()).toEqual(['/c', '/a']);
  });

  it('origins_survivePersisting', () => {
    const trusted: TrustedPaths = new TrustedPaths(file, 1);
    trusted.remember('/a');
    trusted.rememberOpened('/a/b.ts');

    const reloaded: TrustedPaths = new TrustedPaths(file, 1);
    reloaded.rememberOpened('/a/c.ts');

    expect(reloaded.list()).toEqual(['/a/c.ts', '/a']);
  });

  it('load_ofAListFromBeforeOriginsWereRecorded_keepsItsFoldersWhenMoreAreChosen', () => {
    writeFileSync(
      file,
      JSON.stringify(['/a', '/repo', '/repo/nested', '/repo/b.ts', '/repo/c.ts', '/else/d.ts']),
    );
    const trusted: TrustedPaths = new TrustedPaths(file, 5);

    trusted.remember('/new');

    expect(trusted.list()).toEqual([
      '/new',
      '/else/d.ts',
      '/repo/c.ts',
      '/repo/b.ts',
      '/repo/nested',
      '/repo',
      '/a',
    ]);
  });

  it('load_onceOriginsAreRecorded_infersNone', () => {
    writeFileSync(file, JSON.stringify(['/repo/chosen.ts', { opened: '/repo' }]));

    const reloaded: TrustedPaths = new TrustedPaths(file, 1);
    reloaded.rememberOpened('/repo/b.ts');
    reloaded.rememberOpened('/repo/c.ts');

    expect(reloaded.has('/repo/chosen.ts')).toBe(true);
  });

  it('load_takesAListFromBeforeOriginsWereRecorded_andIgnoresWhatIsNotAPath', () => {
    writeFileSync(file, JSON.stringify(['/a', '', null, 42, {}, { opened: 7 }, '/a/b.ts']));

    expect(new TrustedPaths(file).list()).toEqual(['/a/b.ts', '/a']);
  });

  it('clear_forgetsEverything', () => {
    const trusted: TrustedPaths = new TrustedPaths(file);
    trusted.remember('/a');

    trusted.clear();

    expect(trusted.has('/a')).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual([]);
  });
});
