import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BinaryDocumentEntry } from '../binary-document/binary-document';
import { BinaryInspector } from './binary-inspector';

/**
 * A fake binary document together with the ranges the inspector asked to load.
 */
interface FakeDocument {
  /**
   * Gets the duck-typed document entry bound to the inspector.
   */
  readonly entry: BinaryDocumentEntry;

  /**
   * Gets the cursor signal, so tests can move the cursor.
   */
  readonly cursor: WritableSignal<number | null>;

  /**
   * Gets the byte ranges the inspector ensured were loaded.
   */
  readonly ensured: { offset: number; length: number }[];
}

/**
 * Builds a fake binary document serving bytes from an in-memory array, exposing just the surface the
 * inspector consumes.
 * @param bytes The document's bytes.
 * @returns Returns the fake document.
 */
function fakeDocument(bytes: readonly number[]): FakeDocument {
  const cursor: WritableSignal<number | null> = signal<number | null>(null);
  const loadedVersion: WritableSignal<number> = signal<number>(0);
  const ensured: { offset: number; length: number }[] = [];
  const entry: BinaryDocumentEntry = {
    cursor,
    loadedVersion,
    byteAt: (offset: number): number | null => (offset < bytes.length ? bytes[offset] : null),
    ensureRange: (offset: number, length: number): void => {
      ensured.push({ offset, length });
    },
  } as unknown as BinaryDocumentEntry;
  return { entry, cursor, ensured };
}

describe('BinaryInspector', () => {
  /**
   * Creates the inspector bound to a fake document.
   * @param document The fake document to bind.
   * @returns Returns the settled fixture.
   */
  async function create(document: FakeDocument): Promise<ComponentFixture<BinaryInspector>> {
    const fixture: ComponentFixture<BinaryInspector> = TestBed.createComponent(BinaryInspector);
    fixture.componentRef.setInput('document', document.entry);
    await fixture.whenStable();
    return fixture;
  }

  /**
   * Reads the rendered inspector rows as a label-to-value map.
   * @param fixture The inspector fixture.
   * @returns Returns the rendered rows.
   */
  function rowsOf(fixture: ComponentFixture<BinaryInspector>): Map<string, string> {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const rows: Map<string, string> = new Map<string, string>();
    for (const row of Array.from(host.querySelectorAll('.inspector__row'))) {
      rows.set(
        row.querySelector('.inspector__label')?.textContent?.trim() ?? '',
        row.querySelector('.inspector__value')?.textContent?.trim() ?? '',
      );
    }
    return rows;
  }

  it('render_withoutACursor_showsTheEmptyNote', async () => {
    const fixture: ComponentFixture<BinaryInspector> = await create(fakeDocument([0x00]));
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.inspector__empty')?.textContent).toContain('Select a byte');
    expect(host.querySelectorAll('.inspector__row').length).toBe(0);
  });

  it('rows_decodeTheBytesAtTheCursorAsEachType', async () => {
    const document: FakeDocument = fakeDocument([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    document.cursor.set(0);
    const fixture: ComponentFixture<BinaryInspector> = await create(document);
    const rows: Map<string, string> = rowsOf(fixture);
    expect(rows.get('Byte')).toBe('1');
    expect(rows.get('Word')).toBe('1');
    expect(rows.get('Integer')).toBe('1');
    expect(rows.get('Long')).toBe('1');
  });

  it('setEndian_bigEndian_reinterpretsMultiByteValues', async () => {
    const document: FakeDocument = fakeDocument([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    document.cursor.set(0);
    const fixture: ComponentFixture<BinaryInspector> = await create(document);
    const buttons: HTMLButtonElement[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.inspector__seg-btn',
      ),
    );

    // The second segment button is BE.
    buttons[1].click();
    await fixture.whenStable();

    expect(rowsOf(fixture).get('Word')).toBe('256');
  });

  it('setSigned_unsigned_reinterpretsTheIntegerValues', async () => {
    const document: FakeDocument = fakeDocument([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    document.cursor.set(0);
    const fixture: ComponentFixture<BinaryInspector> = await create(document);
    expect(rowsOf(fixture).get('Byte')).toBe('-1');
    const buttons: HTMLButtonElement[] = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.inspector__seg-btn',
      ),
    );

    // The fourth segment button is Unsigned.
    buttons[3].click();
    await fixture.whenStable();

    expect(rowsOf(fixture).get('Byte')).toBe('255');
  });

  it('cursorMove_ensuresTheCursorBytesAreLoaded', async () => {
    const document: FakeDocument = fakeDocument([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]);
    const fixture: ComponentFixture<BinaryInspector> = await create(document);

    document.cursor.set(5);
    await fixture.whenStable();

    expect(document.ensured).toContainEqual({ offset: 5, length: 8 });
  });
});
