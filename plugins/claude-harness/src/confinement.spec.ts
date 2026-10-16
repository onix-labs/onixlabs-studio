import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isWriteDenied, isWriteWithinRoots, realPathOf } from './confinement';

describe('write confinement', () => {
  it('containsByNormalisedPath_asBefore', () => {
    const root: string = '/home/dev/project';
    expect(isWriteWithinRoots('/home/dev/project/src/a.ts', [root])).toBe(true);
    expect(isWriteWithinRoots('src/a.ts', [root])).toBe(true);
    expect(isWriteWithinRoots('/home/dev/project/../secret', [root])).toBe(false);
    expect(isWriteWithinRoots('/home/dev/project-evil/a.ts', [root])).toBe(false);
    expect(isWriteWithinRoots('/etc/passwd', [])).toBe(true);
    expect(isWriteDenied('/home/dev/project/.env', ['.env'], root)).toBe(true);
    expect(isWriteDenied('/home/dev/project/.environment', ['.env'], root)).toBe(false);
  });

  describe('symbolic links (audit S8)', () => {
    let base: string;
    let root: string;
    let outside: string;

    beforeEach(() => {
      base = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-confinement-'));
      root = path.join(base, 'ws');
      outside = path.join(base, 'elsewhere');
      fs.mkdirSync(path.join(root, 'src'), { recursive: true });
      fs.mkdirSync(outside);
      fs.symlinkSync(outside, path.join(root, 'out'));
    });

    afterEach(() => {
      fs.rmSync(base, { recursive: true, force: true });
    });

    it('aLinkInsideTheRootThatPointsOutside_isOutside', () => {
      // Checked out of a cloned repository, or made by the agent's own shell: `Write ws/out/x` was a
      // write to `elsewhere/x` that passed the textual check.
      expect(isWriteWithinRoots(path.join(root, 'out', 'plugin.json'), [root])).toBe(false);
      expect(isWriteWithinRoots('out/x', [root])).toBe(false);
      expect(isWriteWithinRoots(path.join(root, 'src', 'a.ts'), [root])).toBe(true);
    });

    it('aRootReachedThroughALink_stillContainsItsFiles', () => {
      const linkedRoot: string = path.join(base, 'ws-link');
      fs.symlinkSync(root, linkedRoot);
      expect(isWriteWithinRoots(path.join(linkedRoot, 'src', 'a.ts'), [root])).toBe(true);
      expect(isWriteWithinRoots(path.join(root, 'src', 'a.ts'), [linkedRoot])).toBe(true);
    });

    it('aLinkToADeniedPlace_isDenied', () => {
      const secrets: string = path.join(root, 'secrets');
      fs.mkdirSync(secrets);
      fs.symlinkSync(secrets, path.join(root, 'harmless'));
      expect(isWriteDenied(path.join(root, 'harmless', 'key.pem'), ['secrets'], root)).toBe(true);
      expect(isWriteDenied(path.join(root, 'harmless', 'key.pem'), [secrets], root)).toBe(true);
    });

    it('realPathOf_resolvesWhatExists_andKeepsTheRest', () => {
      expect(realPathOf(path.join(root, 'out', 'new', 'file.txt'))).toBe(
        path.join(fs.realpathSync.native(outside), 'new', 'file.txt'),
      );
      expect(realPathOf('/no/such/place')).toBe('/no/such/place');
    });
  });
});
