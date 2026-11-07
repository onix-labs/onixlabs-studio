import type { RunConfiguration } from '@shared/api/studio';
import { cargoRunConfiguration } from './lsp-cargo-runnable';

describe('cargoRunConfiguration (#1210)', () => {
  /**
   * Builds a rust-analyzer runnable, as its Run Tests lens carries one.
   * @param args What to change in its arguments.
   * @returns Returns the runnable.
   */
  function runnable(args: object = {}): object {
    return {
      label: 'test-mod tests',
      kind: 'cargo',
      location: { targetUri: 'file:///w/src/lib.rs' },
      args: {
        cwd: '/w/shapes',
        workspaceRoot: '/w',
        environment: { RUSTC_TOOLCHAIN: '/toolchain' },
        cargoArgs: ['test', '--package', 'shapes', '--lib'],
        executableArgs: ['tests', '--show-output'],
        ...args,
      },
    };
  }

  it('runsCargo_withTheTestArgumentsAfterADoubleDash', () => {
    const configuration: RunConfiguration | null = cargoRunConfiguration(runnable());

    expect(configuration).toMatchObject({
      name: 'test-mod tests',
      mode: 'run',
      program: 'cargo',
      args: ['test', '--package', 'shapes', '--lib', '--', 'tests', '--show-output'],
      cwd: '/w/shapes',
      env: { RUSTC_TOOLCHAIN: '/toolchain' },
    });
  });

  it('leavesTheDoubleDashOff_whenThereIsNothingAfterIt', () => {
    expect(
      cargoRunConfiguration(runnable({ cargoArgs: ['run', '--bin', 'app'], executableArgs: [] }))
        ?.args,
    ).toEqual(['run', '--bin', 'app']);
  });

  it('keepsOneConfigurationPerRunnable_soARunAgainReusesItsTerminal', () => {
    expect(cargoRunConfiguration(runnable())?.id).toBe(cargoRunConfiguration(runnable())?.id);
    expect(cargoRunConfiguration(runnable())?.id).not.toBe(
      cargoRunConfiguration({ ...runnable(), label: 'test-mod other' })?.id,
    );
  });

  it('runsCargo_whateverTheServersSettingsSayToRunInstead', () => {
    expect(cargoRunConfiguration(runnable({ overrideCargo: './evil' }))?.program).toBe('cargo');
  });

  it('keepsOnlyStringsOfTheEnvironment', () => {
    expect(cargoRunConfiguration(runnable({ environment: { GOOD: 'yes', BAD: 1 } }))?.env).toEqual({
      GOOD: 'yes',
    });
  });

  it.each([
    ['nothing', null],
    ['a text', 'cargo'],
    ['a shell runnable', { label: 'x', kind: 'shell', args: { cwd: '/', cargoArgs: [] } }],
    ['no label', { kind: 'cargo', args: { cwd: '/', cargoArgs: [] } }],
    ['no folder', { label: 'x', kind: 'cargo', args: { cargoArgs: [] } }],
    ['no arguments', { label: 'x', kind: 'cargo', args: { cwd: '/' } }],
    [
      'arguments that are not text',
      { label: 'x', kind: 'cargo', args: { cwd: '/', cargoArgs: [1] } },
    ],
  ])('refuses %s', (_name: string, value: unknown) => {
    expect(cargoRunConfiguration(value)).toBeNull();
  });
});
