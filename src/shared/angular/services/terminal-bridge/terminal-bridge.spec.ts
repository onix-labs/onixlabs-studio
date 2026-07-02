import { TestBed } from '@angular/core/testing';

import { TerminalCreateResult } from '@shared/api/terminal-channels';
import { TerminalBridge } from './terminal-bridge';

describe('TerminalBridge', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(TestBed.inject(TerminalBridge)).toBeTruthy();
  });

  it('isElectron_whenBridgeAbsent_isFalse', () => {
    expect(TestBed.inject(TerminalBridge).isElectron).toBe(false);
  });

  it('create_whenBridgeAbsent_resolvesUnavailable', async () => {
    const result: TerminalCreateResult = await TestBed.inject(TerminalBridge).create({ id: 't1' });
    expect(result.success).toBe(false);
  });

  it('write_whenBridgeAbsent_resolvesFalse', async () => {
    expect(await TestBed.inject(TerminalBridge).write('t1', 'ls')).toBe(false);
  });

  it('onData_whenBridgeAbsent_returnsANoopUnsubscribe', () => {
    const unsubscribe: () => void = TestBed.inject(TerminalBridge).onData((): void => undefined);
    expect(() => unsubscribe()).not.toThrow();
  });
});
