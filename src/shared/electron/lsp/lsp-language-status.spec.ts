import { serverStatusOf } from './lsp-language-status';

describe('serverStatusOf (#1208)', () => {
  it('starting_isLoading', () => {
    expect(serverStatusOf({ type: 'Starting', message: 'Init...' }, false)).toEqual({
      health: 'ok',
      quiescent: false,
    });
  });

  it('serviceReady_hasFinishedLoading', () => {
    expect(serverStatusOf({ type: 'ServiceReady', message: 'ServiceReady' }, false)).toEqual({
      health: 'ok',
      quiescent: true,
    });
  });

  it('startingAfterServiceReady_isNotANewLoad_asNothingWouldEndIt', () => {
    expect(serverStatusOf({ type: 'Starting', message: '100% Starting' }, true)).toBeNull();
  });

  it('anError_hasFinished_andSaysWhatIsWrong', () => {
    expect(serverStatusOf({ type: 'Error', message: 'Initialization failed' }, false)).toEqual({
      health: 'error',
      quiescent: true,
      message: 'Initialization failed',
    });
  });

  it('anErrorWithNoMessage_stillSaysSomething', () => {
    expect(serverStatusOf({ type: 'Error' }, false)?.message).toBe(
      'The Java language server could not start.',
    );
  });

  it.each([
    [{ type: 'Started', message: 'Ready' }],
    [{ type: 'ProjectStatus', message: 'OK' }],
    [{ type: 'Message', message: 'hello' }],
    [null],
    [{ type: 7 }],
  ])('%j_changesNothing', (params: unknown) => {
    expect(serverStatusOf(params, false)).toBeNull();
  });
});
