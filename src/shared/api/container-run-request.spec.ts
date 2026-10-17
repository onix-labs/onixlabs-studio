import { describe, expect, it } from 'vitest';
import { describeRunRequest, readRunRequest } from './container-run-request';

describe('describeRunRequest', () => {
  it('saysEverythingTheCardMustShow_mountsAboveAll', () => {
    // Audit S3: the permission card for run_container showed nothing, so a mount of the whole disk
    // was approved blind. Every mount is named, read-only or not, and nothing is cut short.
    expect(
      describeRunRequest({
        image: 'postgres:16',
        name: 'db',
        ports: [{ host: 5432, container: 5432, protocol: 'tcp' }],
        env: { POSTGRES_PASSWORD: 'x', A: 'b' },
        volumes: [
          { source: '/Users/me/project/data', target: '/var/lib/postgresql/data' },
          { source: 'pgdata', target: '/backup', readOnly: true },
        ],
      }),
    ).toBe(
      'postgres:16; as db; publishes 5432->5432/tcp; mounts /Users/me/project/data -> ' +
        '/var/lib/postgresql/data, pgdata -> /backup (read-only); 2 environment variables',
    );
    expect(describeRunRequest({ image: 'nginx' })).toBe('nginx');
  });
});

describe('readRunRequest', () => {
  it('keepsOnlyTheWellFormedParts', () => {
    // #974: what the renderer sends is untrusted; bad ports, mounts and variables are dropped.
    expect(
      readRunRequest({
        image: ' postgres:16 ',
        name: ' db ',
        ports: [
          { host: 5432, container: 5432 },
          { host: 0, container: 1 },
          { host: 53, container: 53, protocol: 'udp' },
        ],
        env: { A: 'b', ' ': 'x', B: 3 },
        volumes: [
          { source: 'pgdata', target: '/data' },
          { source: 'x', target: 'relative' },
        ],
      }),
    ).toEqual({
      image: 'postgres:16',
      name: 'db',
      ports: [
        { host: 5432, container: 5432, protocol: 'tcp' },
        { host: 53, container: 53, protocol: 'udp' },
      ],
      env: { A: 'b' },
      volumes: [{ source: 'pgdata', target: '/data', readOnly: false }],
    });
  });

  it('refusesARequestWithNoImage', () => {
    expect(readRunRequest({ image: ' ' })).toBeNull();
    expect(readRunRequest('nope')).toBeNull();
  });
});
