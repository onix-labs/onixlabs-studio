import { TestBed } from '@angular/core/testing';

import { Terminals } from './terminals';

describe('Terminals', () => {
  let terminals: Terminals;

  beforeEach(() => {
    terminals = TestBed.inject(Terminals);
  });

  it('readText_whenNothingRegistered_returnsNull', () => {
    expect(terminals.readText('term-1')).toBeNull();
  });

  it('readText_whenRegistered_returnsTheHandlesText', () => {
    terminals.register('term-1', { readText: (): string => 'hello' });
    expect(terminals.readText('term-1')).toBe('hello');
  });

  it('readText_whenRegisteredById_readsThatTerminal', () => {
    terminals.register('term-1', { readText: (): string => 'one' });
    terminals.register('term-2', { readText: (): string => 'two' });
    expect(terminals.readText('term-1')).toBe('one');
    expect(terminals.readText('term-2')).toBe('two');
  });

  it('unregister_whenCalled_dropsTheHandle', () => {
    terminals.register('term-1', { readText: (): string => 'hello' });
    terminals.unregister('term-1');
    expect(terminals.readText('term-1')).toBeNull();
  });
});
