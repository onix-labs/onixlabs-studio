import { beforeEach, describe, expect, it } from 'vitest';
import { TestBed } from '@angular/core/testing';
import {
  ApiEnvironment,
  ApiFolder,
  ApiRequest,
  HttpField,
  HttpOutcome,
  ResolvedHttpRequest,
} from '@shared/api/api-client-types';
import { ApiHttp } from '../api-http/api-http';
import { ApiWorkspace, newField } from './api-workspace';

/**
 * A stand-in engine recording what it was asked to send, so the tests assert on the resolved request
 * rather than on a live socket.
 */
class FakeHttp {
  /**
   * Holds every request the workspace handed over, in order.
   */
  public readonly sent: ResolvedHttpRequest[] = [];

  /**
   * Holds the ids the workspace asked to cancel.
   */
  public readonly cancelled: string[] = [];

  /**
   * Holds the outcome the next send resolves with.
   */
  public outcome: HttpOutcome = {
    kind: 'response',
    id: '',
    status: 200,
    statusText: 'OK',
    headers: {},
    body: '{}',
    sizeBytes: 2,
    finalUrl: 'https://example.test/',
    redirected: false,
    timings: { firstByteMs: 1, totalMs: 2 },
  };

  /**
   * Records the send and resolves the configured outcome.
   * @param request The resolved request.
   * @returns Returns the configured outcome.
   */
  public send(request: ResolvedHttpRequest): Promise<HttpOutcome> {
    this.sent.push(request);
    return Promise.resolve(this.outcome);
  }

  /**
   * Records a cancellation.
   * @param id The request id.
   */
  public cancel(id: string): void {
    this.cancelled.push(id);
  }
}

describe('ApiWorkspace', () => {
  let workspace: ApiWorkspace;
  let http: FakeHttp;

  beforeEach(() => {
    globalThis.localStorage?.clear();
    http = new FakeHttp();
    TestBed.configureTestingModule({
      providers: [ApiWorkspace, { provide: ApiHttp, useValue: http }],
    });
    workspace = TestBed.inject(ApiWorkspace);
  });

  /**
   * Adds a request to a fresh collection with the given values.
   */
  function request(values: Partial<ApiRequest>): ApiRequest {
    return workspace.addRequest(workspace.addCollection('Tests').id, values);
  }

  it('constructor_onFirstRun_seedsACollectionAnEnvironmentAndASendableRequest', () => {
    // The first-run seed is what makes the view openable-and-usable rather than an empty tree.
    expect(workspace.folders().length).toBeGreaterThan(0);
    expect(workspace.environments().length).toBeGreaterThan(0);
    expect(workspace.requests()[0].url).not.toBe('');
  });

  it('substitute_whenTheVariableIsDefined_replacesItFromTheActiveEnvironment', () => {
    const environment: ApiEnvironment = workspace.addEnvironment('Test', [
      newField('host', 'https://api.test'),
    ]);
    workspace.activateEnvironment(environment.id);

    expect(workspace.substitute('{{host}}/users')).toBe('https://api.test/users');
  });

  it('substitute_whenTheVariableIsUnknown_leavesItWrittenSoTheGapIsVisible', () => {
    const environment: ApiEnvironment = workspace.addEnvironment('Test', []);
    workspace.activateEnvironment(environment.id);

    // Blanking it would send a malformed URL silently; leaving it shows up in the URL bar.
    expect(workspace.substitute('{{missing}}/users')).toBe('{{missing}}/users');
  });

  it('substitute_whenTheVariableIsDisabled_leavesItWritten', () => {
    const disabled: HttpField = { ...newField('host', 'https://api.test'), enabled: false };
    const environment: ApiEnvironment = workspace.addEnvironment('Test', [disabled]);
    workspace.activateEnvironment(environment.id);

    expect(workspace.substitute('{{host}}/x')).toBe('{{host}}/x');
  });

  it('resolve_appliesEnabledParamsToTheUrlAndDropsDisabledOnes', () => {
    const disabled: HttpField = { ...newField('debug', 'true'), enabled: false };
    const saved: ApiRequest = request({
      url: 'https://api.test/search',
      params: [newField('q', 'kotlin'), disabled],
    });

    const resolved: ResolvedHttpRequest = workspace.resolve(saved);

    expect(resolved.url).toBe('https://api.test/search?q=kotlin');
  });

  it('resolve_whenTheUrlAlreadyHasAQuery_appendsWithAnAmpersand', () => {
    const saved: ApiRequest = request({
      url: 'https://api.test/x?a=1',
      params: [newField('b', '2')],
    });

    expect(workspace.resolve(saved).url).toBe('https://api.test/x?a=1&b=2');
  });

  it('resolve_encodesParamNamesAndValues', () => {
    const saved: ApiRequest = request({
      url: 'https://api.test/x',
      params: [newField('a b', 'c&d')],
    });

    expect(workspace.resolve(saved).url).toBe('https://api.test/x?a%20b=c%26d');
  });

  it('resolve_withBearerAuth_setsTheAuthorizationHeader', () => {
    const saved: ApiRequest = request({
      url: 'https://api.test',
      auth: { kind: 'bearer', token: 'abc' },
    });

    expect(workspace.resolve(saved).headers['Authorization']).toBe('Bearer abc');
  });

  it('resolve_withBasicAuth_base64EncodesTheCredentials', () => {
    const saved: ApiRequest = request({
      url: 'https://api.test',
      auth: { kind: 'basic', username: 'user', password: 'pass' },
    });

    expect(workspace.resolve(saved).headers['Authorization']).toBe(`Basic ${btoa('user:pass')}`);
  });

  it('resolve_withAnApiKeyInTheQuery_appendsItRatherThanSettingAHeader', () => {
    const saved: ApiRequest = request({
      url: 'https://api.test',
      auth: { kind: 'api-key', key: 'token', value: 'xyz', in: 'query' },
    });

    const resolved: ResolvedHttpRequest = workspace.resolve(saved);

    expect(resolved.url).toBe('https://api.test?token=xyz');
    expect(resolved.headers['token']).toBeUndefined();
  });

  it('resolve_substitutesVariablesInHeadersAndAuthNotJustTheUrl', () => {
    const environment: ApiEnvironment = workspace.addEnvironment('Test', [
      newField('key', 'secret'),
    ]);
    workspace.activateEnvironment(environment.id);
    const saved: ApiRequest = request({
      url: 'https://api.test',
      headers: [newField('X-Key', '{{key}}')],
      auth: { kind: 'bearer', token: '{{key}}' },
    });

    const resolved: ResolvedHttpRequest = workspace.resolve(saved);

    expect(resolved.headers['X-Key']).toBe('secret');
    expect(resolved.headers['Authorization']).toBe('Bearer secret');
  });

  it('resolve_withAJsonBody_setsTheContentTypeWhenTheUserHasNotSetOne', () => {
    const saved: ApiRequest = request({
      url: 'https://api.test',
      method: 'POST',
      body: { kind: 'json', text: '{"a":1}', fields: [] },
    });

    const resolved: ResolvedHttpRequest = workspace.resolve(saved);

    expect(resolved.headers['Content-Type']).toBe('application/json');
    expect(resolved.body).toBe('{"a":1}');
  });

  it('resolve_withAnExplicitContentType_leavesTheUsersHeaderAlone', () => {
    // Overriding the content type is a legitimate thing to be testing, so the guess must not win.
    const saved: ApiRequest = request({
      url: 'https://api.test',
      method: 'POST',
      headers: [newField('Content-Type', 'application/vnd.custom+json')],
      body: { kind: 'json', text: '{}', fields: [] },
    });

    expect(workspace.resolve(saved).headers['Content-Type']).toBe('application/vnd.custom+json');
  });

  it('resolve_withAUrlEncodedBody_encodesTheEnabledFields', () => {
    const saved: ApiRequest = request({
      url: 'https://api.test',
      method: 'POST',
      body: { kind: 'urlencoded', text: '', fields: [newField('a', '1'), newField('b', 'x y')] },
    });

    expect(workspace.resolve(saved).body).toBe('a=1&b=x%20y');
  });

  it('resolve_withNoBody_sendsNull', () => {
    const saved: ApiRequest = request({ url: 'https://api.test' });

    expect(workspace.resolve(saved).body).toBeNull();
  });

  it('send_recordsTheOutcomeAgainstTheRequestAndInTheHistory', async () => {
    const saved: ApiRequest = request({ url: 'https://api.test' });

    await workspace.send(saved.id);

    expect(workspace.outcome(saved.id)).not.toBeNull();
    expect(workspace.history()[0].requestId).toBe(saved.id);
    expect(http.sent[0].url).toBe('https://api.test');
  });

  it('send_whileInFlight_reportsTheRequestAsInFlightAndClearsItAfterwards', async () => {
    const saved: ApiRequest = request({ url: 'https://api.test' });

    const pending: Promise<HttpOutcome | null> = workspace.send(saved.id);
    expect(workspace.inFlight().has(saved.id)).toBe(true);
    await pending;

    expect(workspace.inFlight().has(saved.id)).toBe(false);
  });

  it('send_whenTheRequestIsUnknown_resolvesNullWithoutSending', async () => {
    expect(await workspace.send('nonexistent')).toBeNull();
    expect(http.sent.length).toBe(0);
  });

  it('removeFolder_removesTheCollectionAndTheRequestsInside', () => {
    const collection: ApiFolder = workspace.addCollection('Doomed');
    workspace.addRequest(collection.id, { name: 'inside' });

    workspace.removeFolder(collection.id);

    expect(
      workspace.folders().some((folder: ApiFolder): boolean => folder.id === collection.id),
    ).toBe(false);
    expect(
      workspace.requests().some((entry: ApiRequest): boolean => entry.parentId === collection.id),
    ).toBe(false);
  });

  it('persist_thenRestore_bringsBackTheCollectionsAndTheActiveEnvironment', () => {
    const environment: ApiEnvironment = workspace.addEnvironment('Staging', [
      newField('base_url', 'https://s.test'),
    ]);
    workspace.activateEnvironment(environment.id);
    const saved: ApiRequest = request({ name: 'Kept', url: '{{base_url}}/kept' });

    // A second instance reads the same store, standing in for reopening the tab.
    const restored: ApiWorkspace = TestBed.runInInjectionContext(
      (): ApiWorkspace => new ApiWorkspace(),
    );

    expect(restored.request(saved.id)?.name).toBe('Kept');
    expect(restored.activeEnvironmentId()).toBe(environment.id);
    expect(restored.substitute('{{base_url}}/x')).toBe('https://s.test/x');
  });
});
