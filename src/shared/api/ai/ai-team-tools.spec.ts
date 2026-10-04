import { describe, expect, it } from 'vitest';
import {
  boundedText,
  isSafeBranchName,
  MAX_TEAM_TITLE,
  parsePostToBoardInput,
  parseStartWorkerInput,
  PostToBoardInput,
  StartWorkerInput,
} from './ai-team-tools';

describe('isSafeBranchName', () => {
  it.each(['main', 'agent/789-settings', 'feature/x.y', 'release-2026.10', 'a_b'])(
    'accepts %s',
    (name: string) => {
      expect(isSafeBranchName(name)).toBe(true);
    },
  );

  it.each([
    '',
    '-rf',
    '--upload-pack=evil',
    '/abs',
    'trailing/',
    'a..b',
    'a//b',
    'x@{1}',
    '@',
    'name.lock',
    'dot.',
    '.hidden',
    'a/.hidden',
    'has space',
    'tab\there',
    'tilde~1',
    'caret^',
    'colon:x',
    'q?',
    'star*',
    'brack[et',
    'back\\slash',
    'x'.repeat(201),
  ])('refuses %j', (name: string) => {
    expect(isSafeBranchName(name)).toBe(false);
  });

  it('refusesNonStrings', () => {
    expect(isSafeBranchName(42)).toBe(false);
    expect(isSafeBranchName(null)).toBe(false);
  });
});

describe('boundedText', () => {
  it('trimsAndBounds', () => {
    expect(boundedText('  hello  ')).toBe('hello');
    expect(boundedText('abcdef', 3)).toBe('abc');
  });

  it('refusesBlankAndNonStrings', () => {
    expect(boundedText('   ')).toBeNull();
    expect(boundedText(undefined)).toBeNull();
    expect(boundedText(7)).toBeNull();
  });
});

describe('parseStartWorkerInput', () => {
  it('parsesAFullRequest', () => {
    const parsed: StartWorkerInput | string = parseStartWorkerInput({
      title: ' Settings schema ',
      task: 'Add the schema.',
      branch: ' agent/789-settings ',
      base: 'main',
    });

    expect(parsed).toEqual({
      title: 'Settings schema',
      task: 'Add the schema.',
      branch: 'agent/789-settings',
      base: 'main',
    });
  });

  it('omitsABlankBase', () => {
    expect(parseStartWorkerInput({ title: 't', task: 'x', branch: 'b', base: ' ' })).toEqual({
      title: 't',
      task: 'x',
      branch: 'b',
    });
  });

  it('boundsTheTitle', () => {
    const parsed: StartWorkerInput | string = parseStartWorkerInput({
      title: 'x'.repeat(500),
      task: 'x',
      branch: 'b',
    });

    expect(typeof parsed === 'string' ? parsed : parsed.title).toHaveLength(MAX_TEAM_TITLE);
  });

  it('explainsWhatIsMissingOrUnsafe', () => {
    expect(parseStartWorkerInput({ task: 'x', branch: 'b' })).toContain('title');
    expect(parseStartWorkerInput({ title: 't', branch: 'b' })).toContain('task');
    expect(parseStartWorkerInput({ title: 't', task: 'x', branch: '--force' })).toContain(
      'not a branch name',
    );
    expect(parseStartWorkerInput({ title: 't', task: 'x', branch: 'b', base: 'a..b' })).toContain(
      'not a branch name',
    );
    expect(parseStartWorkerInput(null)).toContain('title');
  });
});

describe('parsePostToBoardInput', () => {
  it('parsesAKnownKind', () => {
    const parsed: PostToBoardInput | string = parsePostToBoardInput({
      kind: 'change',
      text: ' Renamed Settings.theme ',
    });

    expect(parsed).toEqual({ kind: 'change', text: 'Renamed Settings.theme' });
  });

  it('refusesAnUnknownKindOrNoText', () => {
    expect(parsePostToBoardInput({ kind: 'shout', text: 'hi' })).toContain('one of');
    expect(parsePostToBoardInput({ kind: 'note', text: '' })).toContain('text');
  });
});
