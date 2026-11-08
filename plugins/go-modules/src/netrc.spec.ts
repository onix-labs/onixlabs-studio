import { describe, expect, it } from 'vitest';
import { NetrcEntry, netrcFor, parseNetrc } from './netrc';

describe('parseNetrc', () => {
  it('parseNetrc_entriesOnOneOrManyLines_areRead', () => {
    // Arrange
    const text: string = [
      'machine one.example login alice password secret1',
      'machine two.example',
      '  login bob',
      '  password secret2',
    ].join('\n');

    // Act
    const entries: readonly NetrcEntry[] = parseNetrc(text);

    // Assert
    expect(entries).toEqual([
      { machine: 'one.example', login: 'alice', password: 'secret1' },
      { machine: 'two.example', login: 'bob', password: 'secret2' },
    ]);
  });

  it('parseNetrc_defaultAndMacros_areSkipped', () => {
    // Arrange
    const text: string = [
      'default login anyone password everywhere',
      'macdef init',
      'machine inside.macro login x password y',
      '',
      'machine real.example login carol password secret3',
    ].join('\n');

    // Act
    const entries: readonly NetrcEntry[] = parseNetrc(text);

    // Assert
    expect(entries).toEqual([{ machine: 'real.example', login: 'carol', password: 'secret3' }]);
  });

  it('parseNetrc_entryWithoutAPassword_isDropped', () => {
    expect(parseNetrc('machine a.example login alice')).toEqual([]);
  });
});

describe('netrcFor', () => {
  it('netrcFor_host_findsTheLastEntryForIt', () => {
    // Arrange
    const entries: readonly NetrcEntry[] = [
      { machine: 'a.example', login: 'old', password: 'p1' },
      { machine: 'A.example', login: 'new', password: 'p2' },
    ];

    // Act, Assert
    expect(netrcFor(entries, 'a.example')?.login).toBe('new');
    expect(netrcFor(entries, 'b.example')).toBeNull();
  });
});
