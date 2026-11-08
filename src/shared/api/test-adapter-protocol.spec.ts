import { describe, expect, it } from 'vitest';
import {
  isCompatibleTestAdapterProtocol,
  isTestAdapterCapability,
  TEST_ADAPTER_PROTOCOL_VERSION,
  TEST_OP_CAPABILITY,
} from './test-adapter-protocol';

describe('test-adapter protocol (#1351)', () => {
  it.each<[unknown, boolean]>([
    [TEST_ADAPTER_PROTOCOL_VERSION, true],
    ['1.7', true],
    ['1', true],
    ['2.0', false],
    ['0.9', false],
    ['1.x', false],
    [1, false],
    [undefined, false],
  ])('isCompatibleTestAdapterProtocol(%s) is %s', (announced: unknown, expected: boolean) => {
    expect(isCompatibleTestAdapterProtocol(announced)).toBe(expected);
  });

  it.each<[unknown, boolean]>([
    ['run', true],
    ['runSelected', true],
    ['debug', true],
    ['watch', false],
    ['discover', false],
    [null, false],
  ])('isTestAdapterCapability(%s) is %s', (value: unknown, expected: boolean) => {
    expect(isTestAdapterCapability(value)).toBe(expected);
  });

  it('readingResultsNeedsTheSameCapabilityAsRunning_andDiscoveryNeedsNone', () => {
    expect(TEST_OP_CAPABILITY.results).toBe(TEST_OP_CAPABILITY.run);
    expect(TEST_OP_CAPABILITY.discover).toBeUndefined();
  });
});
