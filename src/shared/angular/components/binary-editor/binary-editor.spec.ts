import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BinaryEditor, BinaryVisibleRange } from './binary-editor';

describe('BinaryEditor', () => {
  function create(): ComponentFixture<BinaryEditor> {
    const fixture: ComponentFixture<BinaryEditor> = TestBed.createComponent(BinaryEditor);
    fixture.componentRef.setInput('size', 4096);
    fixture.componentRef.setInput('bytesPerRow', 16);
    fixture.componentRef.setInput('byteAt', (): number | null => 0x41);
    return fixture;
  }

  it('render_showsTheColumnHeaderLabelsForEachByteInARow', async () => {
    const fixture: ComponentFixture<BinaryEditor> = create();
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    const labels: (string | null)[] = Array.from(
      host.querySelectorAll('.binary-editor__hexcell--header'),
    ).map((element: Element): string | null => element.textContent);
    expect(labels).toEqual([
      '00', '01', '02', '03', '04', '05', '06', '07',
      '08', '09', '0A', '0B', '0C', '0D', '0E', '0F',
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
