import { describe, expect, it } from 'vitest';
import { isLimited } from './is-limited';
import { VersionControlOp } from './protocol';

describe('isLimited', () => {
  it.each<VersionControlOp>(['fetch', 'pull', 'push', 'clone'])(
    'isLimited_withTheNetworkRequest_%s_isFalse',
    (op: VersionControlOp) => {
      expect(isLimited(op)).toBe(false);
    },
  );

  it.each<VersionControlOp>(['status', 'stage', 'checkout'])(
    'isLimited_withTheLocalRequest_%s_isTrue',
    (op: VersionControlOp) => {
      expect(isLimited(op)).toBe(true);
    },
  );
});
