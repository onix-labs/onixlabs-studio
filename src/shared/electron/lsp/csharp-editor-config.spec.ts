import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CUSTOM_AFTER_COMMON_TARGETS,
  csharpBraceConfig,
  csharpBraceTargets,
  writeCsharpBraceConfig,
} from './csharp-editor-config';

describe('csharp-editor-config (#1177)', () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'studio-brace-'));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  it('braceConfig_isAGlobalConfigBelowEveryProjectConfig_mappingEachStyleToRoslynsOptions', () => {
    const kr: string = csharpBraceConfig('kr');

    expect(kr).toContain('is_global = true');
    expect(kr).toContain('global_level = -100');
    expect(kr).toContain('csharp_new_line_before_open_brace = none');
    expect(kr).toContain('csharp_indent_braces = false');
    expect(csharpBraceConfig('allman')).toContain('csharp_new_line_before_open_brace = all');
    expect(csharpBraceConfig('allman')).toContain('csharp_indent_braces = false');
    expect(csharpBraceConfig('gnu')).toContain('csharp_new_line_before_open_brace = all');
    expect(csharpBraceConfig('gnu')).toContain('csharp_indent_braces = true');
  });

  it('braceTargets_addTheConfigToEditorConfigFiles_whichTheCompilerReads', () => {
    const targets: string = csharpBraceTargets('/data/studio-brace-style.globalconfig');

    expect(targets).toContain(
      '<EditorConfigFiles Include="/data/studio-brace-style.globalconfig" />',
    );
    expect(targets).not.toContain('<Import');
  });

  it('braceTargets_keepATargetsFileTheUserAlreadyNamed_andEscapeThePaths', () => {
    const targets: string = csharpBraceTargets(
      "/data/R&D/it's.globalconfig",
      '/home/me/mine.targets',
    );

    expect(targets).toContain(
      `<Import Project="/home/me/mine.targets" Condition="Exists('/home/me/mine.targets')" />`,
    );
    expect(targets).toContain('Include="/data/R&amp;D/it&apos;s.globalconfig"');
  });

  it('write_putsBothFilesInStudiosOwnDirectory_andNamesTheTargetsForMsBuild', async () => {
    const env: Record<string, string> = await writeCsharpBraceConfig(directory, 'kr');
    const targetsPath: string = path.join(directory, 'studio-brace-style.targets');
    const configPath: string = path.join(directory, 'studio-brace-style.globalconfig');

    expect(env).toEqual({ [CUSTOM_AFTER_COMMON_TARGETS]: targetsPath });
    expect(readFileSync(configPath, 'utf8')).toBe(csharpBraceConfig('kr'));
    expect(readFileSync(targetsPath, 'utf8')).toBe(csharpBraceTargets(configPath));
  });
});
