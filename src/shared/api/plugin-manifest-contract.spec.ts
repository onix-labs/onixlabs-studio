import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PLUGIN_API_VERSION } from './plugin-manifest';

/**
 * The contract's shape, fingerprinted per API version.
 *
 * The plugin manifest is the one contract outside contributors write against, and the version says
 * which shape a build honours. The two must move together, and nothing else enforces that: a field
 * added without a bump ships a 1.3.0 that accepts what 1.3.0 never did, and a build refusing manifests
 * by version becomes a lie. So the exported types are reduced to their structure — names, members,
 * optionality, type text; no comments — and hashed, and the hash is pinned to the version here.
 *
 * When this fails, one of two things is true. The shape changed and the version did not: bump
 * `PLUGIN_API_VERSION` (minor when the contract only grows, major when a field changes meaning), record
 * why above the constant, and add the new version with the printed fingerprint. Or the version was
 * bumped without adding it here: add it. Never edit an existing entry — a published version's shape is
 * history.
 */
const FINGERPRINTS: Readonly<Record<string, string>> = {
  '1.3.0': 'ac21fce464a40790842d4c6f5a3b19e19d4fe6169ae0faf0af44f2d13c73c4a4',
  '1.4.0': '9c77f18a2e7cb7b380519c200c0af02ebeec8b9758684c89144eecd53babdabc',
  '1.5.0': '29eaeea4d996aaade5c5bdb0d96da1b1f18a2b250006a9e4b3b1ca91f1791f4a',
};

/**
 * Collapses runs of whitespace so a reformatted type reads the same as before.
 * @param text The source text.
 * @returns Returns the text with single spaces.
 */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Renders one exported declaration as a single canonical line, or null when it is not part of the
 * contract's shape (functions, private helpers, the version constant itself).
 * @param node The top-level statement.
 * @param source The file it came from.
 * @returns Returns the canonical line, or null.
 */
function describeDeclaration(node: ts.Node, source: ts.SourceFile): string | null {
  const isExported: boolean =
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier: ts.Modifier): boolean => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
  if (!isExported) {
    return null;
  }
  if (ts.isInterfaceDeclaration(node)) {
    const members: string[] = node.members.map((member: ts.TypeElement): string => {
      const name: string = member.name === undefined ? '' : member.name.getText(source);
      const optional: string = member.questionToken === undefined ? '' : '?';
      const type: string =
        ts.isPropertySignature(member) && member.type !== undefined
          ? collapse(member.type.getText(source))
          : collapse(member.getText(source));
      return `${name}${optional}: ${type}`;
    });
    return `interface ${node.name.text} { ${members.join('; ')} }`;
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return `type ${node.name.text} = ${collapse(node.type.getText(source))}`;
  }
  if (ts.isVariableStatement(node)) {
    const constants: string[] = node.declarationList.declarations
      .filter(
        (declaration: ts.VariableDeclaration): boolean =>
          declaration.initializer !== undefined &&
          ts.isArrayLiteralExpression(declaration.initializer),
      )
      .map(
        (declaration: ts.VariableDeclaration): string =>
          `const ${declaration.name.getText(source)} = ${collapse(declaration.initializer!.getText(source))}`,
      );
    return constants.length === 0 ? null : constants.join('\n');
  }
  return null;
}

/**
 * Reduces the contract file to its shape and hashes it.
 * @returns Returns the shape's SHA-256, and the shape itself for the failure message.
 */
function fingerprint(): { readonly hash: string; readonly shape: string } {
  const source: ts.SourceFile = ts.createSourceFile(
    'plugin-manifest.ts',
    readFileSync('src/shared/api/plugin-manifest.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const lines: string[] = source.statements
    .map((statement: ts.Statement): string | null => describeDeclaration(statement, source))
    .filter((line: string | null): line is string => line !== null);
  const shape: string = lines.join('\n');
  return { hash: createHash('sha256').update(shape).digest('hex'), shape };
}

describe('plugin manifest contract', () => {
  it('currentVersion_isRecorded', () => {
    expect(
      Object.keys(FINGERPRINTS),
      `PLUGIN_API_VERSION is ${PLUGIN_API_VERSION} but no fingerprint is recorded for it — add it`,
    ).toContain(PLUGIN_API_VERSION);
  });

  it('shape_matchesTheFingerprintOfItsVersion', () => {
    const { hash, shape } = fingerprint();
    expect(
      hash,
      `The plugin manifest's shape changed but PLUGIN_API_VERSION is still ${PLUGIN_API_VERSION}. ` +
        `Bump the version, record why, and pin the new fingerprint ${hash}.\n\nShape:\n${shape}`,
    ).toBe(FINGERPRINTS[PLUGIN_API_VERSION]);
  });
});
