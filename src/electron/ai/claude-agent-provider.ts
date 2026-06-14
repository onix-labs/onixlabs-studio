import { homedir } from 'node:os';
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AiVerifyResult } from '../../shared/ai-types';
import type { AiCredential } from './ai-auth-manager';

/**
 * Holds the model the verification turn runs with.
 */
const MODEL: string = 'claude-opus-4-8';

/**
 * Holds how long (ms) to wait for the verification turn before aborting.
 */
const VERIFY_TIMEOUT_MS: number = 45_000;

/**
 * A minimal Claude Agent SDK provider. This first slice exists to prove the resolved credential
 * authenticates end-to-end; the full streaming/tool/permission provider arrives with the agent
 * runtime (#107). The SDK is ESM-only and the Electron main process compiles to CommonJS, so it is
 * loaded with a dynamic `import()`.
 */
export class ClaudeAgentProvider {
  /**
   * Runs a single trivial turn to confirm the credential authenticates and the agent responds.
   * @param credential The credential to authenticate with.
   * @returns Returns the {@link AiVerifyResult}; never throws.
   */
  public async verify(credential: AiCredential): Promise<AiVerifyResult> {
    if (credential.source === 'none') {
      return { ok: false, detail: 'No Claude credential is available.' };
    }
    const controller: AbortController = new AbortController();
    const timeout: NodeJS.Timeout = setTimeout((): void => controller.abort(), VERIFY_TIMEOUT_MS);
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      const options: Options = {
        model: MODEL,
        cwd: homedir(),
        maxTurns: 1,
        abortController: controller,
        ...(credential.apiKey === null ? {} : { env: this.envWithApiKey(credential.apiKey) }),
      };
      const response: Query = query({ prompt: 'Reply with the single word: OK', options });
      for await (const message of response) {
        const typed: SDKMessage = message;
        if (typed.type === 'assistant') {
          return { ok: true, detail: this.describeSource(credential) };
        }
      }
      return { ok: false, detail: 'The agent did not produce a response.' };
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      return { ok: false, detail: `Authentication check failed: ${message}` };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Builds an environment for the agent process that injects the API key while preserving the rest of
   * the current environment (PATH, HOME, …) the CLI needs.
   * @param apiKey The API key to inject.
   * @returns Returns a string-valued environment map.
   */
  private envWithApiKey(apiKey: string): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (typeof value === 'string') {
        env[name] = value;
      }
    }
    env['ANTHROPIC_API_KEY'] = apiKey;
    return env;
  }

  /**
   * Describes a successful verification for display.
   * @param credential The credential that authenticated.
   * @returns Returns a short human-readable description.
   */
  private describeSource(credential: AiCredential): string {
    return credential.source === 'local-login'
      ? 'Authenticated with your local Claude login.'
      : 'Authenticated with your Anthropic API key.';
  }
}
