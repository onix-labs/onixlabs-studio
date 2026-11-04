import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BinaryEditor, BinaryVisibleRange, formatAddress, textOf } from './binary-editor';

describe('BinaryEditor', () => {
  function create(): ComponentFixture<BinaryEditor> {
    const fixture: ComponentFixture<BinaryEditor> = TestBed.createComponent(BinaryEditor);
    fixture.componentRef.setInput('size', 4096);
    fixture.componentRef.setInput('bytesPerRow', 16);
    fixture.componentRef.setInput('byteAt', (): number | null => 0x41);
    return fixture;
  }

  it('sizer_capsItsHeightForGigabyteFiles', async () => {
    // Browsers clamp element heights around 33.5M px; a 2 GiB file's true pixel height (~3.5B px)
    // would leave most of the file unreachable by scrollbar. Above the cap the compressed mapping
    // takes over (verified end-to-end against a 2 GiB fixture).
    const fixture: ComponentFixture<BinaryEditor> = create();
    fixture.componentRef.setInput('size', 2 * 1024 * 1024 * 1024);
    await fixture.whenStable();

    const sizer: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.binary-editor__sizer',
    );
    expect(sizer?.style.height).toBe('24000000px');
  });

  it('sizer_usesTheTruePixelHeightForOrdinaryFiles', async () => {
    const fixture: ComponentFixture<BinaryEditor> = create();
    await fixture.whenStable();

    // 4096 bytes / 16 per row = 256 rows × 26 px.
    const sizer: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '.binary-editor__sizer',
    );
    expect(sizer?.style.height).toBe(`${256 * 26}px`);
  });

  it('render_showsTheColumnHeaderLabelsForEachByteInARow', async () => {
    const fixture: ComponentFixture<BinaryEditor> = create();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    const labels: (string | null)[] = Array.from(
      host.querySelectorAll('.binary-editor__hexcell--header'),
    ).map((element: Element): string | null => element.textContent);
    expect(labels).toEqual([
      '00',
      '01',
      '02',
      '03',
      '04',
      '05',
      '06',
      '07',
      '08',
      '09',
      '0A',
      '0B',
      '0C',
      '0D',
      '0E',
      '0F',
    ]);
    expect(host.querySelector('.binary-editor__addr--header')?.textContent).toContain('Offset');
    expect(host.querySelector('.binary-editor__ascii--header')?.textContent).toContain('ASCII');
  });

  it('render_reportsTheVisibleByteWindowSoTheHostCanLoadIt', async () => {
    const fixture: ComponentFixture<BinaryEditor> = create();
    const ranges: BinaryVisibleRange[] = [];
    fixture.componentInstance.visibleRangeChange.subscribe((range: BinaryVisibleRange): void => {
      ranges.push(range);
    });
    await fixture.whenStable();

    // The virtualiser reports a window starting at the top of the file; jsdom has no layout, so only
    // the overscan rows above the (zero-height) viewport are requested, but the offset is the origin.
    expect(ranges.length).toBeGreaterThan(0);
    expect(ranges[ranges.length - 1].offset).toBe(0);
  });
});

describe('binary text and addresses', () => {
  it('formatAddress_writesEachFormat', () => {
    expect(formatAddress(0xabcdef)).toBe('00AB:CDEF');
    expect(formatAddress(0xabcdef, 'hex', 'lower')).toBe('00abcdef');
    expect(formatAddress(255, 'decimal')).toBe('000000255');
  });

  it('textOf_readsTheByteInEachEncoding', () => {
    const none: () => null = (): null => null;
    expect(textOf(0, 0xe9, 'ascii', none)).toBe('·');
    expect(textOf(0, 0xe9, 'latin1', none)).toBe('é');
    expect(textOf(0, 0xc3, 'utf8', (): number => 0xa9)).toBe('é');
  });
});
