import { describe, expect, it } from 'vitest';
import type { ApiProxy } from '@shared/api/api-client-types';
import {
  isBypassed,
  isLocalHost,
  proxyFor,
  redirected,
  TransportRequest,
} from './api-client-transport';

/**
 * Describes what a redirect carries over.
 */
type Hop = Pick<TransportRequest, 'method' | 'url' | 'headers' | 'body'>;

describe('isLocalHost', () => {
  it('isLocalHost_knowsThisMachinesNames', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('app.localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('[::1]')).toBe(true);
    expect(isLocalHost('example.com')).toBe(false);
  });
});

describe('isBypassed', () => {
  it('isBypassed_matchesNamesAndSuffixes', () => {
    expect(isBypassed('a.test', 'a.test, b.test')).toBe(true);
    expect(isBypassed('x.corp.test', '*.corp.test')).toBe(true);
    expect(isBypassed('corp.test', '*.corp.test')).toBe(false);
    expect(isBypassed('a.test', '')).toBe(false);
  });
});

describe('proxyFor', () => {
  const direct: () => Promise<string> = (): Promise<string> => Promise.resolve('DIRECT');

  it('proxyFor_whenNone_goesDirect', async () => {
    expect(
      await proxyFor(
        new URL('https://a.test'),
        { mode: 'none', address: 'p:1', bypass: '' },
        direct,
      ),
    ).toBeNull();
  });

  it('proxyFor_whenCustom_usesItsAddressUnlessBypassed', async () => {
    const proxy: ApiProxy = { mode: 'custom', address: 'http://p:1', bypass: 'b.test' };

    expect(await proxyFor(new URL('https://a.test'), proxy, direct)).toBe('p:1');
    expect(await proxyFor(new URL('https://b.test'), proxy, direct)).toBeNull();
    expect(await proxyFor(new URL('http://localhost:80'), proxy, direct)).toBeNull();
  });

  it('proxyFor_whenSystem_takesTheFirstAnswer', async () => {
    const proxy: ApiProxy = { mode: 'system', address: '', bypass: '' };

    expect(
      await proxyFor(new URL('https://a.test'), proxy, (): Promise<string> =>
        Promise.resolve('PROXY q:8080; DIRECT'),
      ),
    ).toBe('q:8080');
    expect(await proxyFor(new URL('https://a.test'), proxy, direct)).toBeNull();
  });
});

describe('redirected', () => {
  const post: Hop = {
    method: 'POST',
    url: 'https://a.test/x',
    headers: { Authorization: 'secret', 'Content-Type': 'text/plain', Accept: 'a' },
    body: 'b',
  };

  it('redirected_whenA303_becomesAGetWithoutItsBody', () => {
    const next: Hop = redirected(post, 303, 'https://a.test/y');

    expect(next.method).toBe('GET');
    expect(next.body).toBeNull();
    expect(next.headers).toEqual({ Authorization: 'secret', Accept: 'a' });
  });

  it('redirected_whenA307_keepsTheMethodAndBody', () => {
    const next: Hop = redirected(post, 307, 'https://a.test/y');

    expect(next.method).toBe('POST');
    expect(next.body).toBe('b');
  });

  it('redirected_toAnotherOrigin_dropsCredentials', () => {
    expect(redirected(post, 307, 'https://b.test/').headers).not.toHaveProperty('Authorization');
  });
});
