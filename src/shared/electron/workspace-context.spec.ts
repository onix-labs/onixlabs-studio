import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceContext } from './workspace-context';

describe('WorkspaceContext', () => {
  let folder: string;
  let context: WorkspaceContext;

  beforeEach(() => {
    folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workspace-context-')));
    context = new WorkspaceContext();
  });

  afterEach(() => {
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it('holdsRealPath_ofARootAndWhatIsInsideIt_isTrue', () => {
    context.addRoot(folder);

    expect(context.holdsRealPath(folder)).toBe(true);
    expect(context.holdsRealPath(path.join(folder, 'a', 'b.txt'))).toBe(true);
  });

  it('holdsRealPath_ofASiblingSharingThePrefix_isFalse', () => {
    context.addRoot(folder);

    expect(context.holdsRealPath(`${folder}-other/a.txt`)).toBe(false);
  });

  it('holdsRealPath_withARootReachedThroughALink_comparesWhereTheRootReallyIs', () => {
    const real: string = path.join(folder, 'real');
    const link: string = path.join(folder, 'link');
    fs.mkdirSync(real);
    fs.symlinkSync(real, link);
    context.addRoot(link);

    expect(context.holdsRealPath(path.join(real, 'a.txt'))).toBe(true);
  });

  it('holdsRealPath_withNoRootOpen_isFalse', () => {
    expect(context.holdsRealPath(folder)).toBe(false);
  });
});
