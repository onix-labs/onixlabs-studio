import { parseMirrorAction } from './terminal-mirror-channels';

describe('parseMirrorAction', () => {
  it('withValidActions_roundTripsThem', () => {
    expect(parseMirrorAction({ kind: 'activate', id: 'a' })).toEqual({ kind: 'activate', id: 'a' });
    expect(parseMirrorAction({ kind: 'close', id: 'a' })).toEqual({ kind: 'close', id: 'a' });
    expect(parseMirrorAction({ kind: 'rename', id: 'a', name: 'Build' })).toEqual({
      kind: 'rename',
      id: 'a',
      name: 'Build',
    });
    expect(parseMirrorAction({ kind: 'new-shell' })).toEqual({ kind: 'new-shell' });
    expect(parseMirrorAction({ kind: 'dock-back' })).toEqual({ kind: 'dock-back' });
  });

  it('withNonObjects_returnsNull', () => {
    expect(parseMirrorAction(null)).toBeNull();
    expect(parseMirrorAction(undefined)).toBeNull();
    expect(parseMirrorAction('activate')).toBeNull();
  });

  it('withUnknownOrMissingKinds_returnsNull', () => {
    expect(parseMirrorAction({})).toBeNull();
    expect(parseMirrorAction({ kind: 'detonate' })).toBeNull();
    expect(parseMirrorAction({ kind: 42 })).toBeNull();
  });

  it('withMalformedFields_returnsNull', () => {
    expect(parseMirrorAction({ kind: 'activate', id: 42 })).toBeNull();
    expect(parseMirrorAction({ kind: 'rename', id: 'a', name: 42 })).toBeNull();
  });

  it('dropsUnknownExtraFields', () => {
    expect(parseMirrorAction({ kind: 'activate', id: 'a', extra: 'x' })).toEqual({
      kind: 'activate',
      id: 'a',
    });
  });
});
