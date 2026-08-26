import { describe, expect, it } from 'vitest';
import {
  installedContributions,
  PluginContribution,
  PluginState,
  PluginSummary,
} from './plugin-channels';

/**
 * Builds a plugin summary for the tests.
 * @param id The plugin identifier.
 * @param state The plugin's state.
 * @param contributions The implementations it contributes.
 * @returns Returns the summary.
 */
function plugin(
  id: string,
  state: PluginState,
  contributions: readonly PluginContribution[],
): PluginSummary {
  return {
    id,
    name: id,
    description: '',
    state,
    contributions,
    version: '1.0.0',
    detail: null,
  };
}

/**
 * Builds a language-server contribution.
 * @param id The server identifier.
 * @param languages The languages it serves.
 * @returns Returns the contribution.
 */
function server(id: string, languages: readonly string[]): PluginContribution {
  return { slot: 'language-server', id, displayName: id, languages, priority: 100 };
}

/**
 * Builds a debug-adapter contribution.
 * @param id The adapter identifier.
 * @param languages The languages it debugs.
 * @returns Returns the contribution.
 */
function adapter(id: string, languages: readonly string[]): PluginContribution {
  return { slot: 'debug-adapter', id, displayName: id, languages, priority: 100 };
}

describe('installedContributions', (): void => {
  const plugins: readonly PluginSummary[] = [
    plugin('pyright', 'installed', [server('pyright', ['python'])]),
    plugin('ty', 'available', [server('ty', ['python'])]),
    plugin('netcoredbg', 'installed', [adapter('netcoredbg', ['csharp'])]),
    plugin('clangd', 'unavailable', [server('clangd', ['cpp', 'c'])]),
    plugin('busy-one', 'busy', [server('busy-one', ['go'])]),
  ];

  it('returns only what installed plugins contribute', (): void => {
    expect(
      installedContributions(plugins, 'language-server').map(
        (contribution: PluginContribution): string => contribution.id,
      ),
    ).toEqual(['pyright']);
  });

  it('excludes an available plugin, so what is not installed is never offered', (): void => {
    const ids: readonly string[] = installedContributions(plugins, 'language-server').map(
      (contribution: PluginContribution): string => contribution.id,
    );

    expect(ids).not.toContain('ty');
  });

  it('excludes an undetected external tool', (): void => {
    const ids: readonly string[] = installedContributions(plugins, 'language-server').map(
      (contribution: PluginContribution): string => contribution.id,
    );

    expect(ids).not.toContain('clangd');
  });

  it('excludes a plugin mid-install, so a half-installed plugin is not used', (): void => {
    const ids: readonly string[] = installedContributions(plugins, 'language-server').map(
      (contribution: PluginContribution): string => contribution.id,
    );

    expect(ids).not.toContain('busy-one');
  });

  it('filters by slot, so a debugger is not offered as a language server', (): void => {
    expect(
      installedContributions(plugins, 'debug-adapter').map(
        (contribution: PluginContribution): string => contribution.id,
      ),
    ).toEqual(['netcoredbg']);
  });

  it('returns nothing when nothing is installed', (): void => {
    expect(installedContributions([], 'language-server')).toEqual([]);
  });

  it('excludesAPluginUnsupportedOnThisPlatform', () => {
    // A publisher that ships no build for this machine is not "not installed yet"; its contribution
    // must never reach a slot, or a language would offer a server that cannot exist here.
    const unsupported: readonly PluginSummary[] = [
      plugin('sqls', 'unavailable', [server('sqls', ['sql'])]),
    ];

    expect(installedContributions(unsupported, 'language-server')).toEqual([]);
  });
});
