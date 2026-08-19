import { describe, expect, it } from 'vitest';
import {
  OllamaAsset,
  ollamaAsset,
  ollamaAssetUrl,
  ollamaExecutableName,
  ollamaSystemLocations,
  OLLAMA_VERSION,
} from './ollama-assets';

describe('ollamaAsset', () => {
  it('resolves an asset for every platform Studio can provision', () => {
    for (const [platform, arch] of [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['win32', 'x64'],
      ['win32', 'arm64'],
    ]) {
      expect(ollamaAsset(platform, arch), `${platform}-${arch}`).not.toBeNull();
    }
  });

  it('returns null for a platform Studio cannot provision, so the caller can degrade', () => {
    expect(ollamaAsset('freebsd', 'x64')).toBeNull();
    expect(ollamaAsset('darwin', 'ppc')).toBeNull();
  });

  it('serves both macOS architectures from the one universal archive', () => {
    expect(ollamaAsset('darwin', 'arm64')).toEqual(ollamaAsset('darwin', 'x64'));
  });

  it('pins a full 64-character SHA-256 for every asset', () => {
    for (const [platform, arch] of [
      ['darwin', 'arm64'],
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['win32', 'x64'],
      ['win32', 'arm64'],
    ]) {
      const asset: OllamaAsset | null = ollamaAsset(platform, arch);
      expect(asset?.sha256, `${platform}-${arch}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('builds a download URL inside the pinned release', () => {
    const asset: OllamaAsset = ollamaAsset('darwin', 'arm64')!;

    expect(ollamaAssetUrl(asset)).toBe(
      `https://github.com/ollama/ollama/releases/download/v${OLLAMA_VERSION}/${asset.name}`,
    );
  });
});

describe('ollamaExecutableName', () => {
  it('adds the extension on Windows only', () => {
    expect(ollamaExecutableName('win32')).toBe('ollama.exe');
    expect(ollamaExecutableName('darwin')).toBe('ollama');
    expect(ollamaExecutableName('linux')).toBe('ollama');
  });
});

describe('ollamaSystemLocations', () => {
  it('probes the standard macOS locations, including inside the app bundle', () => {
    const locations: string[] = ollamaSystemLocations('darwin', {});

    expect(locations).toContain('/usr/local/bin/ollama');
    expect(locations).toContain('/opt/homebrew/bin/ollama');
    expect(locations).toContain('/Applications/Ollama.app/Contents/Resources/ollama');
  });

  it('prefers the per-user Windows install when LOCALAPPDATA is set', () => {
    const locations: string[] = ollamaSystemLocations('win32', {
      LOCALAPPDATA: 'C:\\Users\\m\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files',
    });

    expect(locations[0]).toBe('C:\\Users\\m\\AppData\\Local\\Programs\\Ollama\\ollama.exe');
    expect(locations).toContain('C:\\Program Files\\Ollama\\ollama.exe');
  });

  it('returns nothing for a platform with no standard location', () => {
    expect(ollamaSystemLocations('freebsd', {})).toEqual([]);
  });
});
