import type { RepositoryTrustDecision } from '@shared/api/source-control-channels';
import { RunToken, RunTokens } from './launch';

/**
 * Issues tokens for every folder, for the tests that are about something other than trust.
 */
export const TRUSTED_TOKENS: RunTokens = new RunTokens({
  decisionFor: (): RepositoryTrustDecision => 'trusted',
});

/**
 * Issues no token for any folder, for the tests of what an untrusted folder refuses.
 */
export const UNTRUSTED_TOKENS: RunTokens = new RunTokens({
  decisionFor: (): RepositoryTrustDecision => 'unknown',
});

/**
 * Issues a real token for a folder, as a trusted folder would have.
 * @param folder The folder.
 * @returns Returns the token.
 */
export function trustedToken(folder: string): RunToken {
  return TRUSTED_TOKENS.issue(folder)!;
}
