import { isNotLoggedInReply, looksLikeAuthFailure } from './auth-failure';

describe('looksLikeAuthFailure', () => {
  it('matches the CLI "not logged in" error verbatim', () => {
    expect(looksLikeAuthFailure('Not logged in. Please run /login')).toBe(true);
  });

  it('matches regardless of case', () => {
    expect(looksLikeAuthFailure('NOT LOGGED IN')).toBe(true);
  });

  it.each([
    'OAuth token has expired',
    'Request failed: 401 Unauthorized',
    'authentication_error: invalid credentials',
    'Please run `claude` to log in',
    'Run `claude setup-token` to authenticate',
    'invalid x-api-key',
  ])('matches known sign-in failure text: %s', (detail: string) => {
    expect(looksLikeAuthFailure(detail)).toBe(true);
  });

  it.each([
    'The model returned no output.',
    'Tool "Edit" failed: file not found',
    'ECONNREFUSED connecting to localhost:11434',
    'Rate limit exceeded, please retry',
    'Context window exceeded',
  ])('does not match an ordinary failure: %s', (detail: string) => {
    expect(looksLikeAuthFailure(detail)).toBe(false);
  });
});

describe('isNotLoggedInReply', () => {
  it.each([
    'Not logged in · Please run /login',
    'Not logged in. Please run /login',
    '  not logged in — please run /login  ',
  ])('matches a reply that is the sign-in message: %s', (reply: string) => {
    expect(isNotLoggedInReply(reply)).toBe(true);
  });

  it.each([
    'Hello! 👋 How can I help you today?',
    'To sign in, run /login in your terminal.',
    'You appear to be not logged in to the remote service.',
    '',
  ])('does not match a genuine reply: %s', (reply: string) => {
    expect(isNotLoggedInReply(reply)).toBe(false);
  });
});
