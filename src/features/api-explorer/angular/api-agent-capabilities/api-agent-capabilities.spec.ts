import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { AiRuntime } from '@shared/angular/services/ai-runtime/ai-runtime';
import {
  CREATE_API_REQUEST,
  LIST_API_REQUESTS,
  SEND_API_REQUEST,
  SET_API_VARIABLE,
  UPDATE_API_REQUEST,
} from '@shared/api/ai-types';
import { ApiEnvironment, ApiRequest, HttpOutcome } from '@shared/api/api-client-types';
import { ApiHttp } from '../api-http/api-http';
import { ApiRequestOpener } from '../api-request-opener/api-request-opener';
import { ApiWorkspace } from '../api-workspace/api-workspace';
import { ApiAgentCapabilities } from './api-agent-capabilities';

/**
 * A stand-in runtime capturing the capabilities registered against it.
 */
class FakeRuntime {
  /**
   * Holds the registered capability handlers, keyed by name.
   */
  public readonly capabilities: Map<string, (input: unknown) => unknown> = new Map<
    string,
    (input: unknown) => unknown
  >();

  /**
   * Holds the names released when the owner was destroyed.
   */
  public readonly released: string[] = [];

  /**
   * Records a capability and returns its release.
   * @param name The capability name.
   * @param handler The handler.
   * @returns Returns the release function.
   */
  public registerCapability(name: string, handler: (input: unknown) => unknown): () => void {
    this.capabilities.set(name, handler);
    return (): void => {
      this.released.push(name);
    };
  }
}

/**
 * A stand-in engine resolving a fixed response.
 */
class FakeHttp {
  /**
   * Holds the outcome every send resolves with.
   */
  public outcome: HttpOutcome = {
    kind: 'response',
    id: '',
    status: 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"ok":true}',
    sizeBytes: 11,
    finalUrl: 'https://api.test/',
    redirected: false,
    timings: { firstByteMs: 1, totalMs: 7 },
  };

  /**
   * Resolves the configured outcome.
   * @returns Returns the outcome.
   */
  public send(): Promise<HttpOutcome> {
    return Promise.resolve(this.outcome);
  }

  /**
   * Ignores cancellation.
   */
  public cancel(): void {
    // Nothing to cancel in the fake.
  }
}

/**
 * A stand-in opener recording which requests were shown.
 */
class FakeOpener {
  /**
   * Holds the ids opened, in order.
   */
  public readonly opened: string[] = [];

  /**
   * Records an open.
   * @param id The request id.
   */
  public open(id: string): void {
    this.opened.push(id);
  }

  /**
   * Ignores re-titling.
   */
  public retitle(): void {
    // The dock registry is not exercised here.
  }
}

describe('ApiAgentCapabilities', () => {
  let workspace: ApiWorkspace;
  let runtime: FakeRuntime;
  let opener: FakeOpener;

  /**
   * Invokes a registered capability by name.
   */
  async function invoke(name: string, input: unknown = {}): Promise<Record<string, unknown>> {
    const handler: (value: unknown) => unknown = runtime.capabilities.get(name)!;
    return (await handler(input)) as Record<string, unknown>;
  }

  beforeEach(() => {
    globalThis.localStorage?.clear();
    runtime = new FakeRuntime();
    opener = new FakeOpener();
    TestBed.configureTestingModule({
      providers: [
        ApiWorkspace,
        ApiAgentCapabilities,
        { provide: ApiHttp, useValue: new FakeHttp() },
        { provide: AiRuntime, useValue: runtime },
        { provide: ApiRequestOpener, useValue: opener },
      ],
    });
    workspace = TestBed.inject(ApiWorkspace);
    TestBed.inject(ApiAgentCapabilities);
  });

  it('constructor_registersEveryApiCapability', () => {
    for (const name of [
      LIST_API_REQUESTS,
      CREATE_API_REQUEST,
      UPDATE_API_REQUEST,
      SEND_API_REQUEST,
      SET_API_VARIABLE,
    ]) {
      expect(runtime.capabilities.has(name)).toBe(true);
    }
  });

  it('list_reportsTheCollectionsTheirRequestsAndWhichEnvironmentIsActive', async () => {
    const result: Record<string, unknown> = await invoke(LIST_API_REQUESTS);

    expect(result['available']).toBe(true);
    expect((result['collections'] as unknown[]).length).toBeGreaterThan(0);
    const environments: { active: boolean }[] = result['environments'] as { active: boolean }[];
    expect(
      environments.some((environment: { active: boolean }): boolean => environment.active),
    ).toBe(true);
  });

  it('create_savesTheRequestAndOpensItSoTheUserSeesIt', async () => {
    const result: Record<string, unknown> = await invoke(CREATE_API_REQUEST, {
      name: 'List users',
      method: 'GET',
      url: '{{base_url}}/users',
      description: 'Returns every user.',
      headers: { Accept: 'application/json' },
    });

    expect(result['ok']).toBe(true);
    const saved: ApiRequest | undefined = workspace.request(String(result['id']));
    expect(saved?.name).toBe('List users');
    expect(saved?.url).toBe('{{base_url}}/users');
    expect(saved?.headers[0].name).toBe('Accept');
    // Creating without showing would leave the user to hunt for what the agent just made.
    expect(opener.opened).toContain(saved?.id);
  });

  it('create_withoutANameOrUrl_isRefusedWithAReasonRatherThanSavingRubbish', async () => {
    const result: Record<string, unknown> = await invoke(CREATE_API_REQUEST, { name: 'No URL' });

    expect(result['ok']).toBe(false);
    expect(String(result['error'])).toContain('URL');
  });

  it('create_intoANamedCollection_createsThatCollectionWhenItIsNew', async () => {
    await invoke(CREATE_API_REQUEST, {
      name: 'Ping',
      method: 'GET',
      url: 'https://api.test/ping',
      collection: 'Health',
    });

    expect(workspace.folders().some((folder): boolean => folder.name === 'Health')).toBe(true);
  });

  it('create_withABodyAndNoStatedKind_treatsItAsJson', async () => {
    const result: Record<string, unknown> = await invoke(CREATE_API_REQUEST, {
      name: 'Create user',
      method: 'POST',
      url: 'https://api.test/users',
      body: '{"name":"Ada"}',
    });

    expect(workspace.request(String(result['id']))?.body.kind).toBe('json');
  });

  it('update_changesOnlyWhatItNames', async () => {
    const created: Record<string, unknown> = await invoke(CREATE_API_REQUEST, {
      name: 'Original',
      method: 'GET',
      url: 'https://api.test/a',
      description: 'Kept.',
    });
    const id: string = String(created['id']);

    await invoke(UPDATE_API_REQUEST, { id, url: 'https://api.test/b' });

    const saved: ApiRequest | undefined = workspace.request(id);
    expect(saved?.url).toBe('https://api.test/b');
    expect(saved?.name).toBe('Original');
    expect(saved?.description).toBe('Kept.');
  });

  it('update_whenTheRequestIsUnknown_isRefusedWithAReason', async () => {
    const result: Record<string, unknown> = await invoke(UPDATE_API_REQUEST, { id: 'nope' });

    expect(result['ok']).toBe(false);
  });

  it('send_returnsTheStatusHeadersAndBodyAndRecordsItInTheHistory', async () => {
    const created: Record<string, unknown> = await invoke(CREATE_API_REQUEST, {
      name: 'Ping',
      method: 'GET',
      url: 'https://api.test/ping',
    });

    const result: Record<string, unknown> = await invoke(SEND_API_REQUEST, {
      id: String(created['id']),
    });

    expect(result['ok']).toBe(true);
    expect(result['status']).toBe(200);
    expect(String(result['body'])).toContain('ok');
    // The agent's send is the user's send: it lands in the history like any other.
    expect(workspace.history().length).toBe(1);
  });

  it('send_whenTheRequestIsUnknown_isRefusedWithoutSending', async () => {
    const result: Record<string, unknown> = await invoke(SEND_API_REQUEST, { id: 'nope' });

    expect(result['ok']).toBe(false);
    expect(workspace.history().length).toBe(0);
  });

  it('setVariable_addsItToTheActiveEnvironmentSoRequestsResolveIt', async () => {
    const result: Record<string, unknown> = await invoke(SET_API_VARIABLE, {
      name: 'token',
      value: 'secret',
    });

    expect(result['ok']).toBe(true);
    expect(workspace.substitute('{{token}}')).toBe('secret');
  });

  it('setVariable_whenTheNameAlreadyExists_replacesItRatherThanDuplicatingIt', async () => {
    await invoke(SET_API_VARIABLE, { name: 'token', value: 'first' });
    await invoke(SET_API_VARIABLE, { name: 'token', value: 'second' });

    const active: ApiEnvironment | null = workspace.activeEnvironment();
    expect(active?.variables.filter((variable): boolean => variable.name === 'token').length).toBe(
      1,
    );
    expect(workspace.substitute('{{token}}')).toBe('second');
  });

  it('capability_whenGivenANonStringArgument_treatsItAsAbsentRatherThanStringifyingAnObject', async () => {
    // A model can emit anything; "[object Object]" must never reach a saved request.
    const result: Record<string, unknown> = await invoke(CREATE_API_REQUEST, {
      name: { unexpected: true },
      url: 'https://api.test/x',
    });

    expect(result['ok']).toBe(false);
  });
});
