import { describe, expect, it } from 'vitest';
import {
  NetworkConnection,
  NetworkSnapshot,
  ProcessesSnapshot,
} from '@shared/api/system-monitor-channels';
import { describeGpu, describeNetwork, MAX_CONNECTIONS, readProcessQuery } from './agent-resources';

describe('readProcessQuery', () => {
  it('fallsBackToTheBusiest25ByCpu_andCapsTheLimit', () => {
    expect(readProcessQuery(null)).toEqual({ sort: 'cpu', scope: 'all', text: '', limit: 25 });
    expect(readProcessQuery({ sort: 'nope', scope: 'studio', text: ' Node ', limit: 999 })).toEqual(
      { sort: 'cpu', scope: 'studio', text: 'node', limit: 100 },
    );
  });
});

describe('describeNetwork', () => {
  it('countsTheConnectionsByStateAndProtocol_andListsABoundedNumber', () => {
    const connections: NetworkConnection[] = Array.from(
      { length: MAX_CONNECTIONS + 5 },
      (_: unknown, index: number): NetworkConnection => ({
        protocol: index % 2 === 0 ? 'TCP' : 'UDP',
        local: `10.0.0.1:${index}`,
        remote: index % 2 === 0 ? '1.1.1.1:443' : '',
        state: index % 2 === 0 ? 'ESTABLISHED' : '',
      }),
    );
    const snapshot: NetworkSnapshot = {
      info: {
        interfaces: [{ id: 'en0', name: 'Wi-Fi', kind: 'wifi', up: true, isDefault: true }],
        dnsServers: ['192.168.1.1'],
        gateway: '192.168.1.1',
      },
      reading: { timestamp: 't', interfaces: [], connections, dnsLatencyMs: 12 },
    };

    const network: Record<string, unknown> = describeNetwork(snapshot);
    const listed: {
      total: number;
      byState: Record<string, number>;
      byProtocol: Record<string, number>;
      listed: unknown[];
      more: number;
    } = network['connections'] as {
      total: number;
      byState: Record<string, number>;
      byProtocol: Record<string, number>;
      listed: unknown[];
      more: number;
    };

    expect(network['dnsLatencyMs']).toBe(12);
    expect(listed.total).toBe(MAX_CONNECTIONS + 5);
    expect(listed.byState).toEqual({ ESTABLISHED: 78, NONE: 77 });
    expect(listed.byProtocol).toEqual({ TCP: 78, UDP: 77 });
    expect(listed.listed).toHaveLength(MAX_CONNECTIONS);
    expect(listed.more).toBe(5);
  });
});

describe('describeGpu', () => {
  it('namesTheGpusProcesses_fromAListing', () => {
    const snapshot: ProcessesSnapshot = {
      timestamp: 't',
      total: 1,
      user: 'me',
      processes: [
        {
          pid: 7,
          parentPid: 1,
          name: 'WindowServer',
          command: 'WindowServer',
          user: '_windowserver',
          cpuPercent: 1,
          memoryBytes: 1,
          memoryPercent: 0,
        },
      ],
    };

    expect(
      describeGpu(
        { timestamp: 't', engines: [], processes: [{ pid: 7, gpuPercent: 3 }] },
        snapshot,
      )['processes'],
    ).toEqual([{ pid: 7, gpuPercent: 3, name: 'WindowServer' }]);
  });
});
