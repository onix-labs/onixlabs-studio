import type { ClaudeAuthStatus } from '@shared/api/ai-types';
import { extractLoginUrl, parseLoggedIn } from './claude-login-parse';

describe('claude-login-parse', () => {
  describe('parseLoggedIn', () => {
    it('reads a signed-in status with its email', () => {
      const status: ClaudeAuthStatus = parseLoggedIn(
        JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          email: 'user@example.com',
          subscriptionType: 'max',
        }),
      );
      expect(status).toEqual({ loggedIn: true, email: 'user@example.com' });
    });

    it('reads a signed-in status with no email', () => {
      expect(parseLoggedIn(JSON.stringify({ loggedIn: true }))).toEqual({ loggedIn: true });
    });

    it('reads an explicitly signed-out status', () => {
      expect(parseLoggedIn(JSON.stringify({ loggedIn: false }))).toEqual({ loggedIn: false });
    });

    it('tolerates surrounding whitespace', () => {
      expect(parseLoggedIn('\n  {"loggedIn": true}\n ')).toEqual({ loggedIn: true });
    });

    it('fails safe (signed-out) on unparseable output', () => {
      expect(parseLoggedIn('not json at all')).toEqual({ loggedIn: false });
      expect(parseLoggedIn('')).toEqual({ loggedIn: false });
    });

    it('fails safe on a non-object payload', () => {
      expect(parseLoggedIn('true')).toEqual({ loggedIn: false });
      expect(parseLoggedIn('null')).toEqual({ loggedIn: false });
    });

    it('treats a non-boolean loggedIn as signed-out', () => {
      expect(parseLoggedIn(JSON.stringify({ loggedIn: 'yes' }))).toEqual({ loggedIn: false });
    });
  });

  describe('extractLoginUrl', () => {
    it('finds an https sign-in URL in a line of output', () => {
      const url: string | undefined = extractLoginUrl(
        'Opening browser to https://claude.ai/oauth/authorize?code=abc&state=xyz to sign in',
      );
      expect(url).toBe('https://claude.ai/oauth/authorize?code=abc&state=xyz');
    });

    it('trims trailing punctuation the terminal wrapped the URL in', () => {
      expect(extractLoginUrl('Visit (https://claude.ai/login).')).toBe('https://claude.ai/login');
    });

    it('returns undefined when there is no URL', () => {
      expect(extractLoginUrl('Waiting for sign-in to complete…')).toBeUndefined();
    });

    it('ignores a non-https URL', () => {
      expect(extractLoginUrl('see http://localhost:1234/callback')).toBeUndefined();
    });
  });
});
