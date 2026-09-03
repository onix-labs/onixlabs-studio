import { computed, signal, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DecodedInstruction } from '@shared/api/binary-channels';
import { CodeListing, listingFromInstructions } from '@shared/api/code-listing';
import { BinaryDocumentEntry, BinarySelection } from '../binary-document/binary-document';
import { BinaryFormat, disassemblyArchitecture } from '../binary-format/binary-format';
import { BinaryDisasmPanel } from './binary-disasm-panel';
import { LineRow } from '@shared/angular/services/decoders/listing-content';

/**
 * Exposes the protected listing state, so the built text and line map can be asserted directly (the
 * composed Monaco editor never boots under jsdom, so the listing is not observable through the DOM).
 */
interface BinaryDisasmPanelInternals {
  content(): {
    text: string;
    lines: readonly (LineRow | null)[];
  };
}

/**
 * A fake binary document exposing the signals the panel consumes.
 */
interface FakeDocument {
  /**
   * Gets the duck-typed document entry bound to the panel.
   */
  readonly entry: BinaryDocumentEntry;

  /**
   * Gets the decoded-instructions signal, so tests can change the listing.
   */
  readonly instructions: WritableSignal<readonly DecodedInstruction[]>;

  /**
   * Gets the format signal, so tests can resolve the container format.
   */
  readonly format: WritableSignal<BinaryFormat>;
}

/**
 * Builds a fake binary document whose instructions, selection, cursor, and format are plain signals.
 * @param format The initial container format.
 * @returns Returns the fake document.
 */
function fakeDocument(format: BinaryFormat): FakeDocument {
  const instructions: WritableSignal<readonly DecodedInstruction[]> = signal<
    readonly DecodedInstruction[]
  >([]);
  const formatSignal: WritableSignal<BinaryFormat> = signal<BinaryFormat>(format);
  // Mirrors the real document: native disassembly is flat, so it becomes a one-section listing.
  const listing: Signal<CodeListing | null> = computed((): CodeListing | null => {
    const architecture: string | null = disassemblyArchitecture(formatSignal());
    const decoded: readonly DecodedInstruction[] = instructions();
    return architecture === null || decoded.length === 0
      ? null
      : listingFromInstructions(decoded, architecture, null);
  });
  const entry: BinaryDocumentEntry = {
    instructions,
    listing,
    format: formatSignal,
    selection: signal<BinarySelection | null>(null),
    cursor: signal<number | null>(null),
    revealVersion: signal<number>(0),
    revealOffset: null,
  } as unknown as BinaryDocumentEntry;
  return { entry, instructions, format: formatSignal };
}

describe('BinaryDisasmPanel', () => {
  /**
   * Creates the panel bound to a fake document.
   * @param document The fake document to bind.
   * @returns Returns the settled fixture.
   */
  async function create(document: FakeDocument): Promise<ComponentFixture<BinaryDisasmPanel>> {
    const fixture: ComponentFixture<BinaryDisasmPanel> = TestBed.createComponent(BinaryDisasmPanel);
    fixture.componentRef.setInput('document', document.entry);
    await fixture.whenStable();
    return fixture;
  }

  it('render_showsTheTitleBarOverTheComposedEditor', async () => {
    const fixture: ComponentFixture<BinaryDisasmPanel> = await create(
      fakeDocument({ kind: 'pe', architecture: 'x64', managed: false }),
    );
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.tool-panel__title')?.textContent).toContain('Assembly');
    expect(host.querySelector('app-text-editor')).not.toBeNull();
  });

  it('content_buildsOneListingLinePerDecodedInstruction', async () => {
    const document: FakeDocument = fakeDocument({
      kind: 'pe',
      architecture: 'x64',
      managed: false,
    });
    document.instructions.set([
      { startOffset: 16, byteLength: 3, mnemonic: 'mov', operands: 'rax, rbx', raw: [0, 0, 0] },
      { startOffset: 19, byteLength: 1, mnemonic: 'ret', operands: '', raw: [0] },
    ]);
    const fixture: ComponentFixture<BinaryDisasmPanel> = await create(document);
    const internals: BinaryDisasmPanelInternals =
      fixture.componentInstance as unknown as BinaryDisasmPanelInternals;

    expect(internals.content().text).toBe('00000010  mov rax, rbx\n00000013  ret');
    expect(internals.content().lines).toEqual([
      { fileOffset: 16, byteLength: 3 },
      { fileOffset: 19, byteLength: 1 },
    ]);
  });

  it('content_tracksInstructionUpdates', async () => {
    const document: FakeDocument = fakeDocument({
      kind: 'elf',
      architecture: 'x64',
    });
    const fixture: ComponentFixture<BinaryDisasmPanel> = await create(document);
    const internals: BinaryDisasmPanelInternals =
      fixture.componentInstance as unknown as BinaryDisasmPanelInternals;
    expect(internals.content().text).toBe('');

    document.instructions.set([
      { startOffset: 0, byteLength: 1, mnemonic: 'nop', operands: '', raw: [0x90] },
    ]);
    await fixture.whenStable();

    expect(internals.content().text).toBe('00000000  nop');
  });

  it('render_showsTheEmptyNoteOnlyForFormatsWithoutNativeDisassembly', async () => {
    const document: FakeDocument = fakeDocument({ kind: 'unknown' });
    const fixture: ComponentFixture<BinaryDisasmPanel> = await create(document);
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.disasm__empty')?.textContent).toContain('No listing available');

    document.format.set({ kind: 'pe', architecture: 'x64', managed: false });
    await fixture.whenStable();

    // A format the in-core disassembler handles says nothing while it has simply not decoded yet.
    expect(host.querySelector('.disasm__empty')).toBeNull();
  });

  it('render_namesTheFormatWhenNoDecoderCanDecodeIt', async () => {
    // A JVM class is recognised but nothing in core decodes it, so the note names the format rather
    // than saying nothing at all.
    const fixture: ComponentFixture<BinaryDisasmPanel> = await create(
      fakeDocument({ kind: 'jvm' }),
    );
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.disasm__empty')?.textContent).toContain('JVM class');
  });

  it('close_clickEmitsTheClosedOutput', async () => {
    const fixture: ComponentFixture<BinaryDisasmPanel> = await create(
      fakeDocument({ kind: 'unknown' }),
    );
    let closed: number = 0;
    fixture.componentInstance.closed.subscribe((): void => {
      closed += 1;
    });

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.tool-panel__header button')
      ?.click();

    expect(closed).toBe(1);
  });
});
