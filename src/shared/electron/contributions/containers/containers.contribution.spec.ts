import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: (): string => '/tmp' } }));

const { readRunRequest } = await import('./containers.contribution');

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
