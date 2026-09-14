import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the one rule model discovery has to obey: **route on the connection that arrived, never on
 * the cached provider map.**
 *
 * `AiManager` holds two answers to "what runs this connection": the `providers` map, and the harness
 * registry. The map is a *cache*, rebuilt only when the renderer calls `listProviders` — and the only
 * caller of that is `AgentEngine`, which exists solely once the agent view has been opened. Discovery,
 * however, is reached from **Settings**, which a user can open without ever visiting the agent. On that
 * path the map is empty, and an empty map is indistinguishable from "no harness runs this".
 *
 * 🔥 That is not hypothetical — it shipped. A subscription connection pointed at the Claude harness
 * answered *"Add an API key to discover this provider's models"*, because discovery read the empty map,
 * fell through to the HTTP path, and that path quite reasonably wants a key. Two log lines a session
 * apart told the whole story: with the agent view open, `Harness set` was followed 2ms later by
 * `Rebuilt providers`; from a fresh launch straight into Settings, the rebuild never came (#697).
 *
 * ⚠️ Deliberately a source scan. `AiManager` registers IPC handlers in its constructor and reaches for
 * contributed plugins and a `BrowserWindow`, so there is no cheap unit test of this decision — which is
 * precisely how three routing defects reached a user through this class unseen. A scan costs nothing
 * and fails loudly the moment the cache creeps back in.
 *
 * ⛔ This checks a *decision*, not a spelling. If `discoverModels` is restructured, move the assertion
 * with it rather than deleting it; the rule is what matters, not the line it currently lives on.
 */

/**
 * The manager whose discovery routing is under contract.
 */
const MANAGER: string = 'src/shared/electron/ai/ai-manager.ts';

/**
 * Reads a repository file. Resolved from the working directory rather than from `import.meta.url`,
 * because a spec is transformed and its module URL is not a path on disk under every runner config.
 * @param relativePath The repository-relative path.
 * @returns Returns the file's contents.
 */
function source(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

/**
 * Extracts the body of a method, from its signature to the first line that closes it at method indent.
 * @param text The file's contents.
 * @param name The method name.
 * @returns Returns the body.
 */
function methodBody(text: string, name: string): string {
  const start: number = text.indexOf(`private ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const end: number = text.indexOf('\n  }', start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe('model discovery routing', () => {
  it('routesOnTheConnectionItWasGivenRatherThanTheProviderCache', () => {
    const body: string = methodBody(source(MANAGER), 'discoverModels');

    expect(body).toContain('this.harnesses.providerFor(connection)');
  });

  it('doesNotReadTheProviderCache', () => {
    // The cache is populated by a different window's lifecycle, so reading it here makes the answer
    // depend on where the user has been rather than on what the connection says.
    const body: string = methodBody(source(MANAGER), 'discoverModels');

    expect(body).not.toContain('this.providers.get(');
  });
});
