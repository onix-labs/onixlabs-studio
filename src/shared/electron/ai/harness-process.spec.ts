import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { AgentModelReport, AgentRunContext } from './agent-provider';

// `HarnessProcess` reaches the pid journal and the process-tree helpers, both of which are Electron's
// world. Nothing here depends on what they do.
// ⛔ The relative modules cannot be mocked — the Angular unit-test system refuses `vi.mock` on a
// relative import — so the dependency is cut at the bare specifier.
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: (): string => '/tmp' } }));

const { HarnessAgentProvider } = await import('./harness-agent-provider');
const { HarnessProcess } = await import('./harness-process');

/**
 * The reference harness, spawned for real by these tests.
 *
 * This is the only place the transport is exercised end to end. Everything else in the agent-protocol
 * stack is driven by a fake, which is the right trade for logic — but a fake transport cannot show
 * that a real pipe carries the protocol, that stderr does not corrupt it, or that a line arriving in
 * pieces is still one message.
 */
const ECHO_HARNESS: string = path.join(
  process.cwd(),
  'src',
  'shared',
  'electron',
  'ai',
  'testing',
  'echo-harness.mjs',
);

// ⛔ Resolved from the working directory, not from `import.meta.url`. A spec is transformed before it
// runs, so its module URL is not a path on disk under every runner configuration — resolving from it
// worked under `ng test` and silently produced a path that does not exist under `--coverage`, where
// the only symptom was a harness that would not start. Fail loudly here instead.
if (!existsSync(ECHO_HARNESS)) {
  throw new Error(`The reference harness is missing: ${ECHO_HARNESS}`);
}

/**
 * Builds a provider that runs the reference harness in a real child process.
 * @returns Returns the provider.
 */
function echoProvider(
  settings: Readonly<Record<string, unknown>> = {},
): InstanceType<typeof HarnessAgentProvider> {
  return new HarnessAgentProvider({
    id: 'echo',
    label: 'Echo Harness',
    models: [{ id: 'm1', label: 'M1', contextWindow: 100 }],
    defaultModelId: 'm1',
    connect: (): InstanceType<typeof HarnessProcess> =>
      new HarnessProcess({ command: process.execPath, args: [ECHO_HARNESS] }),
    sessionModel: 'stateless',
    remoteControl: false,
    settings,
  });
}

/**
 * Builds a run context, recording what the harness emitted and what it asked.
 * @param prompt The prompt, which is what tells the reference harness what to do.
 * @param overrides Context fields to replace.
 * @returns Returns the context and what it recorded.
 */
function contextFor(
  prompt: string,
  overrides: Partial<Record<string, unknown>> = {},
): { context: AgentRunContext; texts: string[]; audits: string[] } {
  const texts: string[] = [];
  const audits: string[] = [];
  const context: Record<string, unknown> = {
    requestId: 'r1',
    prompt,
    workspaceRoot: null,
    model: 'm1',
    agentSessionId: null,
    effort: null,
    mode: 'agent',
    surface: 'editor',
    allowedWritePaths: [],
    deniedWritePaths: [],
    allowedNetworkLocations: [],
    deniedNetworkLocations: [],
    tokenCap: 1000,
    resumeSessionId: null,
    forkSession: false,
    signal: new AbortController().signal,
    auth: { apiKey: null },
    resumeSessionAt: null,
    permissionPosture: 'prompt',
    toolPolicies: {},
    images: [],
    contextPaths: [],
    remoteControl: 'off',
    agentShell: null,
    owningTabId: null,
    claudeExecutable: { mode: 'bundled' },
    bridge: { request: (): Promise<unknown> => Promise.resolve(null) },
    emit: (event: unknown): void => {
      const typed: { kind?: string; delta?: string } = event as { kind?: string; delta?: string };
      if (typed.kind === 'text' && typed.delta !== undefined) {
        texts.push(typed.delta);
      }
    },
    recordAudit: (name: string): void => void audits.push(name),
    setSteerHandler: (): void => undefined,
    requestPermission: (): Promise<boolean> => Promise.resolve(true),
    requestInput: (): Promise<string | null> => Promise.resolve('hello'),
    requestEditDecision: (): Promise<string> => Promise.resolve('yes'),
    ...overrides,
  };
  return { context: context as unknown as AgentRunContext, texts, audits };
}

describe('HarnessProcess, against the reference harness', () => {
  it('carriesAWholeTurnOverARealPipe', async () => {
    const { context, texts } = contextFor('hello there');

    await echoProvider().run(context);

    // Spawn, handshake, turn envelope, streamed event, settle — over stdin and stdout of an actual
    // process, with nothing faked.
    expect(texts).toEqual(['echo: hello there']);
  }, 20_000);

  it('putsTheHarnessQuestionToTheUserAndCarriesTheAnswerBack', async () => {
    const { context, texts } = contextFor('ask');

    await echoProvider().run(context);

    // The harness blocked, Studio answered, and the harness saw the answer: the round-trip this whole
    // protocol exists for, proved across a process boundary.
    expect(texts).toEqual(['permitted']);
  }, 20_000);

  it('carriesTheUsersAnswerToAQuestionBackAsText', async () => {
    const { context, texts } = contextFor('input');

    await echoProvider().run(context);

    expect(texts).toEqual(['hello']);
  }, 20_000);

  it('stderrAndNonJsonOnStdoutDoNotCorruptTheProtocol', async () => {
    const { context, texts } = contextFor('noise');

    await echoProvider().run(context);

    // The failure #541 was, proved against a real stream: a harness writing diagnostics cannot have
    // them mistaken for content, and a stray line cannot derail the turn.
    expect(texts).toEqual(['survived the noise']);
  }, 20_000);

  it('recordsAnAuditEntryTheHarnessReports', async () => {
    const { context, audits } = contextFor('hello');

    await echoProvider().run(context);

    expect(audits).toEqual(['Echo']);
  }, 20_000);

  it('carriesACredentialToARealHarnessOverTheRealTransport', async () => {
    // The only end-to-end coverage of the credential round-trip: a spawned process asks, and the key
    // crosses the pipe as an answer rather than riding in the turn envelope. The fixture reports the
    // key's length rather than the key, so no test output can ever contain a secret.
    const { context, texts } = contextFor('credential', {
      auth: { apiKey: 'sk-abcdef' },
    });

    await echoProvider().run(context);

    expect(texts).toEqual(['credential of 9']);
  }, 20_000);

  it('tellsARealHarnessThereIsNoCredentialRatherThanFailingTheTurn', async () => {
    const { context, texts } = contextFor('credential');

    await echoProvider().run(context);

    // An unconfigured connection is a turn the harness can still settle, having decided for itself
    // that it cannot authenticate. Studio does not pre-empt that decision.
    expect(texts).toEqual(['no credential']);
  }, 20_000);

  it('discoversModelsFromARealHarnessOverTheRealTransport', async () => {
    // 🔑 Discovery correlates like a run, so the harness asks for a credential *under the discovery id*
    // and the ordinary request path carries the answer. Proving that against a spawned process is the
    // point: the alternative design — a request belonging to no run — would have needed the host's
    // unknown-run refusal relaxed, and this shows it did not.
    // The label carries back what the *handshake* told the harness (1.8.0), which is the only way to
    // see that the connection's shape reached a real process: a discovery has no turn envelope, so
    // before this the harness had nothing saying which endpoint it was being asked about.
    const report: AgentModelReport | null = await echoProvider({
      connectionKind: 'ollama',
    }).discoverModels({
      apiKey: 'sk-abcdef',
    });

    expect(report?.models).toEqual([{ id: 'echo-authenticated', label: 'Echo (ollama)' }]);
  }, 20_000);

  it('discoversWithoutACredentialWhenTheConnectionHasNone', async () => {
    const report: AgentModelReport | null = await echoProvider().discoverModels({
      apiKey: null,
    });

    expect(report?.models).toEqual([{ id: 'echo-anonymous' }]);
  }, 20_000);

  it('describesAndRunsStudiosToolsForARealHarnessOverTheRealTransport', async () => {
    // The end-to-end proof of what makes a plain model API reachable as a plugin: the harness asks what
    // Studio offers, picks one, asks Studio to run it, and gets a result — all over a spawned process's
    // pipe, with the tool's implementation never leaving Studio.
    const { context, texts } = contextFor('tools', { surface: 'editor', mode: 'agent' });

    await echoProvider().run(context);

    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('tools:');
    expect(texts[0]).not.toContain('has no tool called');
  }, 20_000);

  it('failsTheTurnWhenTheHarnessFailsIt', async () => {
    const { context } = contextFor('fail');

    await expect(echoProvider().run(context)).rejects.toThrow('asked to fail');
  }, 20_000);

  it('failsTheTurnWhenTheHarnessCannotBeStarted', async () => {
    const provider: InstanceType<typeof HarnessAgentProvider> = new HarnessAgentProvider({
      id: 'missing',
      label: 'Missing Harness',
      models: [{ id: 'm1', label: 'M1', contextWindow: 100 }],
      defaultModelId: 'm1',
      connect: (): InstanceType<typeof HarnessProcess> =>
        new HarnessProcess({ command: path.join(path.sep, 'nonexistent-harness'), args: [] }),
      sessionModel: 'stateless',
      remoteControl: false,
      settings: {},
    });

    // A harness that never starts must fail the turn rather than leave it waiting on a handshake that
    // will never come.
    await expect(provider.run(contextFor('hello').context)).rejects.toThrow();
  }, 20_000);
});
