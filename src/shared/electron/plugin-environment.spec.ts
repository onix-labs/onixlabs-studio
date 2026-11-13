import { describe, expect, it } from 'vitest';
import { isPluginVariable, pluginEnvironment } from './plugin-environment';

describe('pluginEnvironment', () => {
  it('passesWhatAProgramNeedsToRun_andNothingElse', () => {
    // Audit S6: the whole login shell used to go to every plugin, secrets included.
    const environment: Record<string, string> = pluginEnvironment(undefined, {
      PATH: '/usr/bin',
      HOME: '/Users/me',
      LANG: 'en_GB.UTF-8',
      LC_ALL: 'C',
      TMPDIR: '/tmp',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      HTTPS_PROXY: 'http://proxy:3128',
      XDG_CONFIG_HOME: '/Users/me/.config',
      GIT_SSH_COMMAND: 'ssh -i key',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      CODEX_HOME: '/Users/me/.codex',
      GITHUB_TOKEN: 'ghp_secret',
      OPENAI_API_KEY: 'sk-secret',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      NODE_OPTIONS: '--require evil.js',
      ELECTRON_RUN_AS_NODE: '1',
      EMPTY: undefined,
    });

    expect(environment).toEqual({
      PATH: '/usr/bin',
      HOME: '/Users/me',
      LANG: 'en_GB.UTF-8',
      LC_ALL: 'C',
      TMPDIR: '/tmp',
      SSH_AUTH_SOCK: '/tmp/agent.sock',
      HTTPS_PROXY: 'http://proxy:3128',
      XDG_CONFIG_HOME: '/Users/me/.config',
      GIT_SSH_COMMAND: 'ssh -i key',
      DOCKER_HOST: 'unix:///var/run/docker.sock',
      CODEX_HOME: '/Users/me/.codex',
    });
  });

  it('laysTheCallersVariablesOverTheRest', () => {
    expect(
      pluginEnvironment({ ELECTRON_RUN_AS_NODE: '1', PATH: '/override' }, { PATH: '/usr/bin' }),
    ).toEqual({ PATH: '/override', ELECTRON_RUN_AS_NODE: '1' });
  });

  it('isPluginVariable_namesTheFamiliesTheToolsRead', () => {
    for (const name of ['PATH', 'LC_MESSAGES', 'XDG_DATA_HOME', 'GIT_DIR', 'CONTAINER_HOST']) {
      expect(isPluginVariable(name)).toBe(true);
    }
    for (const name of [
      'GH_TOKEN',
      'ANTHROPIC_API_KEY',
      'NODE_OPTIONS',
      'NPM_TOKEN',
      'KUBECONFIG',
    ]) {
      expect(isPluginVariable(name)).toBe(false);
    }
  });

  it.each([
    ['GOPROXY', 'https://goproxy.corp.example'],
    ['GOPRIVATE', 'git.corp.example/*'],
    ['GONOSUMDB', 'git.corp.example/*'],
    ['GONOPROXY', 'git.corp.example/*'],
    ['GOFLAGS', '-mod=mod'],
    ['CARGO_HOME', '/Users/me/.cargo-alt'],
    ['PIP_INDEX_URL', 'https://pypi.corp.example/simple'],
    ['PIP_EXTRA_INDEX_URL', 'https://pypi.extra.example/simple'],
    ['PIP_CONFIG_FILE', '/Users/me/pip.conf'],
  ])('passes %s_toThePackageManagerPlugins', (name: string, value: string) => {
    // #1423: a registry setting made in the shell reaches the plugin that resolves packages. Without
    // GOPRIVATE, a shell-only private module was looked up on proxy.golang.org.
    expect(pluginEnvironment(undefined, { [name]: value })).toEqual({ [name]: value });
  });

  it.each([
    ['GOOGLE_APPLICATION_CREDENTIALS'],
    ['GOPATH_SECRET'],
    ['PIP_PASSWORD'],
    ['CARGO_REGISTRY_TOKEN'],
  ])('doesNotPass %s_theLookAlikesOfTheRegistrySettings', (name: string) => {
    // By exact name, never a prefix: `GO*` would hand a plugin the user's cloud credentials.
    expect(isPluginVariable(name)).toBe(false);
  });

  it('drawsFromThisProcessByDefault', () => {
    expect(pluginEnvironment()['PATH']).toBe(process.env['PATH']);
    expect(pluginEnvironment()['NODE_OPTIONS']).toBeUndefined();
  });
});
