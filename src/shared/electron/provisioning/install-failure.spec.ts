import {
  classifyInstallError,
  installFailureMessage,
  recordInstallFailure,
  takeInstallFailure,
} from './install-failure';

describe('classifyInstallError', () => {
  it('readsAnUnsuccessfulDownload_asTheStatusItWasAnswered', () => {
    expect(classifyInstallError(new Error('Download failed: 404'))).toEqual({
      kind: 'unreachable',
      status: 404,
    });
  });

  it('readsFetchThatGotNoResponse_asOffline', () => {
    const error: Error = new TypeError('fetch failed');
    (error as { cause?: unknown }).cause = Object.assign(new Error('getaddrinfo'), {
      code: 'ENOTFOUND',
    });

    expect(classifyInstallError(error)).toEqual({ kind: 'offline' });
    expect(classifyInstallError(new TypeError('fetch failed'))).toEqual({ kind: 'offline' });
  });

  it('readsAFullOrUnwritableDisk_asDisk', () => {
    expect(classifyInstallError(Object.assign(new Error('nope'), { code: 'ENOSPC' }))).toEqual({
      kind: 'disk',
      code: 'ENOSPC',
    });
  });

  it('readsAnythingElse_asBroken', () => {
    expect(
      classifyInstallError(new Error('Archive refused: the symlink x points outside')),
    ).toEqual({ kind: 'broken' });
  });
});

describe('takeInstallFailure', () => {
  it('givesTheReasonOnce', () => {
    recordInstallFailure('demo', { kind: 'offline' });

    expect(takeInstallFailure('demo')).toEqual({ kind: 'offline' });
    expect(takeInstallFailure('demo')).toBeNull();
  });

  it('keepsTheLastReason_whenAnInstallFailsTwice', () => {
    recordInstallFailure('demo', { kind: 'offline' });
    recordInstallFailure('demo', { kind: 'mismatch' });

    expect(takeInstallFailure('demo')).toEqual({ kind: 'mismatch' });
  });
});

describe('installFailureMessage', () => {
  it.each([
    [{ kind: 'offline' } as const, 'could not reach the download server'],
    [{ kind: 'unreachable', status: 404 } as const, 'answered 404'],
    [{ kind: 'mismatch' } as const, 'updating Studio usually fixes it'],
    [{ kind: 'disk', code: 'EACCES' } as const, '(EACCES)'],
    [{ kind: 'broken' } as const, 'did not contain what it should'],
  ])('says what to do about %o', (failure, expected: string) => {
    const message: string = installFailureMessage('Git', failure);

    expect(message.startsWith('Git could not be installed')).toBe(true);
    expect(message).toContain(expected);
  });

  it('fallsBackToTheTruthfulGeneric_whenNothingWasRecorded', () => {
    expect(installFailureMessage('Git', null)).toBe(
      'Git could not be installed. The application log records what failed.',
    );
  });
});
