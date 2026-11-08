import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { LspGeneratedViewResult } from '@shared/api/lsp-channels';
import { metadataAsSourcePath } from './metadata-as-source';
import {
  generatedViewRequest,
  readableBytes,
  renderGeneratedView,
  safeFileName,
  writeGeneratedView,
} from './lsp-generated-views';

/**
 * The document the requests in these specs ask about.
 */
const LIB: string = pathToFileURL(path.resolve('/work/shapes/src/lib.rs')).href;

describe('lsp-generated-views', () => {
  let scratch: string | null = null;

  afterEach(async () => {
    if (scratch !== null) {
      await rm(scratch, { recursive: true, force: true });
      scratch = null;
    }
  });

  describe('generatedViewRequest', () => {
    it('asksRustAnalyzer_aboutThePlace_forItsViews', () => {
      expect(generatedViewRequest('expandMacro', { uri: LIB, line: 24, character: 5 })).toEqual({
        kind: 'expandMacro',
        method: 'rust-analyzer/expandMacro',
        params: { textDocument: { uri: LIB }, position: { line: 24, character: 5 } },
        where: { file: 'lib.rs', line: 25 },
      });
      expect(generatedViewRequest('hir', { uri: LIB, line: 0, character: 0 })?.method).toBe(
        'rust-analyzer/viewHir',
      );
      expect(generatedViewRequest('mir', { uri: LIB, line: 0, character: 0 })?.method).toBe(
        'rust-analyzer/viewMir',
      );
    });

    it('asksClangd_forTheTreeOverWhatIsSelected_andForItsMemoryWithNoPlace', () => {
      expect(
        generatedViewRequest('syntaxTree', {
          uri: LIB,
          line: 4,
          character: 30,
          endLine: 4,
          endCharacter: 40,
        })?.params,
      ).toEqual({
        textDocument: { uri: LIB },
        range: { start: { line: 4, character: 30 }, end: { line: 4, character: 40 } },
      });
      expect(generatedViewRequest('memoryUsage', 'anything')).toMatchObject({
        method: '$/memoryUsage',
        params: null,
      });
    });

    it('refusesAKindNotInTheTable_orAPlaceThatIsNotOne', () => {
      expect(generatedViewRequest('workspace/executeCommand', { uri: LIB })).toBeNull();
      expect(
        generatedViewRequest('hir', { uri: 'https://example.com/a.rs', line: 0, character: 0 }),
      ).toBeNull();
      expect(generatedViewRequest('hir', { uri: LIB, line: -1, character: 0 })).toBeNull();
      expect(generatedViewRequest('hir', { uri: LIB, line: 1.5, character: 0 })).toBeNull();
      expect(generatedViewRequest('hir', null)).toBeNull();
    });
  });

  describe('renderGeneratedView', () => {
    const where: { file: string; line: number } = { file: 'lib.rs', line: 25 };

    it('namesAMacrosExpansionAfterTheMacro', () => {
      // What rust-analyzer 2026-07-13 answered at `square!(side)`.
      expect(
        renderGeneratedView('expandMacro', { name: 'square!', expansion: 'side * side\n' }, where),
      ).toEqual({
        name: 'square! expanded.rs',
        text: '// Recursive expansion of square!\n\nside * side\n',
      });
    });

    it('showsHirAndMir_asTheServerWroteThem', () => {
      const hir: string = 'fn square_of(side) {\n    side * side\n}';
      expect(renderGeneratedView('hir', hir, where)).toEqual({
        name: 'lib.rs line 25 HIR.rs',
        text: hir,
      });
      expect(renderGeneratedView('mir', '   ', where)).toBeNull();
      expect(renderGeneratedView('expandMacro', null, where)).toBeNull();
    });

    it('indentsClangdsSyntaxTree_withEachNodesRoleAndStart', () => {
      // Trimmed from what clangd 22.1.6 answered inside `Circle::area`.
      const tree: unknown = {
        kind: 'Return',
        role: 'statement',
        range: { start: { line: 4, character: 30 } },
        arcana: 'ReturnStmt 0x7fef8d01cd40 <…>',
        children: [
          {
            kind: 'BinaryOperator',
            role: 'expression',
            detail: '*',
            range: { start: { line: 4, character: 37 } },
            children: [{ kind: 'FloatingLiteral', role: 'expression', detail: '3.14159' }],
          },
        ],
      };

      expect(renderGeneratedView('syntaxTree', tree, { file: 'shapes.cpp', line: 5 })).toEqual({
        name: 'shapes.cpp line 5 AST.txt',
        text:
          'Return  [statement 5:31]\n' +
          '  BinaryOperator *  [expression 5:38]\n' +
          '    FloatingLiteral 3.14159  [expression]\n',
      });
      expect(renderGeneratedView('syntaxTree', { role: 'nothing' }, where)).toBeNull();
    });

    it('listsClangdsMemory_biggestFirst_withFilesByPath', () => {
      const file: string = pathToFileURL(path.resolve('/work/shapes.cpp')).href;
      const memory: unknown = {
        _self: 0,
        _total: 3 * 1024 * 1024,
        index: { _self: 512, _total: 512 },
        tuscheduler: { _self: 0, _total: 2048, [file]: { _self: 2048, _total: 2048 } },
      };

      expect(renderGeneratedView('memoryUsage', memory, where)?.text).toBe(
        'Total  3.0 MB\n' +
          '  tuscheduler  2.0 KB\n' +
          `    ${path.resolve('/work/shapes.cpp')}  2.0 KB\n` +
          '  index  512 B\n',
      );
      expect(renderGeneratedView('memoryUsage', {}, where)).toBeNull();
    });
  });

  it('readableBytes_readsAsAPersonWould', () => {
    expect(readableBytes(0)).toBe('0 B');
    expect(readableBytes(1536)).toBe('1.5 KB');
    expect(readableBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });

  it('safeFileName_keepsAViewInItsFolder', () => {
    expect(safeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(safeFileName('a:b*c?.rs')).toBe('a_b_c_.rs');
    expect(safeFileName('..')).toBe('view.txt');
    expect(safeFileName(`${'x'.repeat(200)}.rs`)).toHaveLength(120);
    expect(safeFileName(`${'x'.repeat(200)}.rs`).endsWith('.rs')).toBe(true);
  });

  it('writeGeneratedView_writesWhereTheEditorOpensItReadOnly', async () => {
    scratch = await mkdtemp(path.join(tmpdir(), 'generated-views-'));

    const first: LspGeneratedViewResult = await writeGeneratedView(
      { name: 'square! expanded.rs', text: 'side * side\n' },
      scratch,
    );
    const second: LspGeneratedViewResult = await writeGeneratedView(
      { name: 'square! expanded.rs', text: 'side * side\n' },
      scratch,
    );

    expect('path' in first && 'path' in second).toBe(true);
    if (!('path' in first) || !('path' in second)) {
      return;
    }
    expect(path.basename(first.path)).toBe('square! expanded.rs');
    // Asked again, a fresh document rather than the one already open.
    expect(first.path).not.toBe(second.path);
    expect(await readFile(first.path, 'utf8')).toBe('side * side\n');
    // The rule that lets the editor open a decompiled source read-only lets it open this.
    expect(await metadataAsSourcePath(first.path, scratch)).not.toBeNull();
  });
});
