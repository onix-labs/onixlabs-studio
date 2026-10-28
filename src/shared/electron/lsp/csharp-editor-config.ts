import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { LspBraceStyle } from '@shared/api/lsp-channels';

/**
 * Names the MSBuild property, read from the environment, whose targets file every project imports
 * after the common targets.
 */
export const CUSTOM_AFTER_COMMON_TARGETS: string = 'CustomAfterMicrosoftCommonTargets';

/**
 * Builds the global analyzer config that tells Roslyn the user's C# brace style (#1177).
 *
 * Roslyn reads brace placement only from analyzer config — never from `workspace/configuration`, nor
 * from the formatting request's options. A global config ranks below every `.editorconfig`, and its
 * low `global_level` below any global config the project ships, so a project that sets its own brace
 * style keeps it: the user's settings fill in only what the project leaves unsaid.
 * @param braceStyle The brace style.
 * @returns Returns the config's text.
 */
export function csharpBraceConfig(braceStyle: LspBraceStyle): string {
  const newLine: string = braceStyle === 'kr' ? 'none' : 'all';
  const indented: boolean = braceStyle === 'gnu';
  return [
    '# Written by ONIXLabs Studio from the Text Editor Brace style setting. A project .editorconfig',
    '# overrides it.',
    'is_global = true',
    'global_level = -100',
    '',
    `csharp_new_line_before_open_brace = ${newLine}`,
    `csharp_indent_braces = ${indented}`,
    '',
  ].join('\n');
}

/**
 * Builds the targets file that adds the global config to every project's analyzer config. It goes
 * into `EditorConfigFiles` itself: the SDK has already merged `GlobalAnalyzerConfigFiles` into it by
 * the time a custom-after import is read. A targets file the user had already named through the same
 * property is imported too, so theirs keeps working.
 * @param configPath The absolute path of the global config.
 * @param inherited The targets file the environment already named, if any.
 * @returns Returns the targets file's text.
 */
export function csharpBraceTargets(configPath: string, inherited?: string): string {
  const lines: string[] = ['<Project>'];
  if (inherited !== undefined && inherited.length > 0) {
    const escaped: string = escapeXml(inherited);
    lines.push(`  <Import Project="${escaped}" Condition="Exists('${escaped}')" />`);
  }
  lines.push(
    '  <ItemGroup>',
    `    <EditorConfigFiles Include="${escapeXml(configPath)}" />`,
    '  </ItemGroup>',
    '</Project>',
    '',
  );
  return lines.join('\n');
}

/**
 * Writes the brace-style config and its targets file into a directory of Studio's own — never into
 * the user's project — and returns the environment that makes Roslyn's project loads read them.
 * @param directory The directory to write into: the session's per-workspace data directory.
 * @param braceStyle The brace style.
 * @param inherited The targets file the environment already named, if any.
 * @returns Returns the environment variables to start the server with.
 */
export async function writeCsharpBraceConfig(
  directory: string,
  braceStyle: LspBraceStyle,
  inherited?: string,
): Promise<Record<string, string>> {
  const configPath: string = path.join(directory, 'studio-brace-style.globalconfig');
  const targetsPath: string = path.join(directory, 'studio-brace-style.targets');
  await writeFile(configPath, csharpBraceConfig(braceStyle), 'utf8');
  await writeFile(targetsPath, csharpBraceTargets(configPath, inherited), 'utf8');
  return { [CUSTOM_AFTER_COMMON_TARGETS]: targetsPath };
}

/**
 * Escapes text for an XML attribute.
 * @param text The text.
 * @returns Returns the escaped text.
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
