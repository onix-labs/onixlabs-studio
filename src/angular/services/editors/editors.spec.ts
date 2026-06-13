import { Editors, EditorLocation, RevealRequest } from './editors';

describe('Editors', () => {
  let editors: Editors;

  beforeEach(() => {
    editors = new Editors();
  });

  it('locate_whenRegistered_returnsTheLocation', () => {
    const location: EditorLocation = { documentId: 'doc-1', path: '/ws/a.ts', name: 'a.ts' };
    editors.register('inmemory://model/1', location);

    expect(editors.locate('inmemory://model/1')).toEqual(location);
  });

  it('locate_whenUnregistered_returnsUndefined', () => {
    expect(editors.locate('inmemory://model/missing')).toBeUndefined();
  });

  it('unregister_whenCalled_dropsTheLocation', () => {
    editors.register('inmemory://model/1', { documentId: 'doc-1', path: null, name: 'a.ts' });

    editors.unregister('inmemory://model/1');

    expect(editors.locate('inmemory://model/1')).toBeUndefined();
  });

  it('requestReveal_whenCalledTwiceForTheSamePosition_changesTheNonce', () => {
    editors.requestReveal('doc-1', 3, 5);
    const first: RevealRequest | null = editors.revealRequest();
    editors.requestReveal('doc-1', 3, 5);
    const second: RevealRequest | null = editors.revealRequest();

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first!.line).toBe(3);
    expect(first!.column).toBe(5);
    expect(second!.nonce).not.toBe(first!.nonce);
  });
});
