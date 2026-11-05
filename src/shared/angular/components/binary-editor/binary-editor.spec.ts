import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { Mock } from 'vitest';
import {
  BinaryEditOp,
  BinaryEditor,
  BinaryRange,
  BinaryVisibleRange,
  formatAddress,
  textOf,
} from './binary-editor';

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

describe('BinaryEditor editing', () => {
  /**
   * A stand-in for the document behind the grid: it applies ops and feeds the selection back in, as
   * the host does.
   */
  class FakeHost {
    public readonly bytes: number[];
    public readonly ops: BinaryEditOp[] = [];
    public readonly selections: BinaryRange[] = [];
    public readonly cursors: number[] = [];
    public readonly fixture: ComponentFixture<BinaryEditor>;

    public constructor(size: number, viewportHeight: number = 260) {
      this.bytes = new Array<number>(size).fill(0x41);
      this.fixture = TestBed.createComponent(BinaryEditor);
      const ref: ComponentFixture<BinaryEditor>['componentRef'] = this.fixture.componentRef;
      ref.setInput('size', size);
      ref.setInput('bytesPerRow', 16);
      ref.setInput('byteAt', (offset: number): number | null => this.bytes[offset] ?? null);
      const editor: BinaryEditor = this.fixture.componentInstance;
      editor.op.subscribe((op: BinaryEditOp): void => {
        this.ops.push(op);
        if (op.kind === 'overwrite') {
          this.bytes[op.offset] = op.value;
        } else if (op.kind === 'insert') {
          this.bytes.splice(op.offset, 0, op.value);
        } else {
          this.bytes.splice(op.offset, op.count);
        }
        ref.setInput('size', this.bytes.length);
        ref.setInput('dataVersion', this.ops.length);
      });
      editor.selectionChange.subscribe((range: BinaryRange): void => {
        this.selections.push(range);
        ref.setInput('selection', range);
      });
      editor.cursorChange.subscribe((offset: number): void => {
        this.cursors.push(offset);
      });
      const scroller: HTMLElement = this.scroller();
      Object.defineProperty(scroller, 'clientHeight', {
        configurable: true,
        value: viewportHeight,
      });
    }

    /**
     * Gets the scroll container, once the view exists.
     */
    public scroller(): HTMLElement {
      this.fixture.detectChanges();
      const found: HTMLElement | null = this.host().querySelector<HTMLElement>('.binary-editor');
      if (found === null) {
        throw new Error('The editor did not render its scroller');
      }
      return found;
    }

    /**
     * Gets the host element.
     */
    public host(): HTMLElement {
      const host: unknown = this.fixture.nativeElement;
      if (!(host instanceof HTMLElement)) {
        throw new Error('The fixture has no element');
      }
      return host;
    }

    /**
     * Presses a key on the grid, resolving whether the grid consumed it.
     */
    public async press(key: string, init: KeyboardEventInit = {}): Promise<boolean> {
      const event: KeyboardEvent = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...init,
      });
      this.scroller().dispatchEvent(event);
      await this.fixture.whenStable();
      return event.defaultPrevented;
    }

    /**
     * Presses a pointer on a cell of the given column.
     */
    public async cell(
      kind: 'hexcell' | 'asciicell',
      index: number,
      type: string = 'pointerdown',
    ): Promise<void> {
      const cells: NodeListOf<HTMLElement> = this.host().querySelectorAll<HTMLElement>(
        `.binary-editor__${kind}:not(.binary-editor__hexcell--header)`,
      );
      cells[index]?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      await this.fixture.whenStable();
    }

    /**
     * Reads the hex text of the cells that are drawn as selected.
     */
    public selectedCells(): number {
      return this.host().querySelectorAll('.binary-editor__hexcell.binary-editor__cell--selected')
        .length;
    }
  }

  describe('moving', () => {
    it('arrows_moveTheCaretAndSelection_withinTheFile', async () => {
      const host: FakeHost = new FakeHost(32);

      await host.press('ArrowRight');
      await host.press('ArrowDown');
      await host.press('ArrowLeft');
      await host.press('ArrowUp');

      expect(host.cursors).toEqual([1, 17, 16, 0]);
      expect(host.selections.at(-1)).toEqual({ start: 0, end: 1 });
    });

    it('arrows_stopAtTheEndsOfTheFile', async () => {
      const host: FakeHost = new FakeHost(4);

      await host.press('ArrowUp');
      await host.press('ArrowDown');

      expect(host.cursors).toEqual([0, 3]);
    });

    it('homeAndEnd_goToTheEndsOfTheRow', async () => {
      const host: FakeHost = new FakeHost(32);
      await host.press('ArrowDown');
      await host.press('ArrowRight');

      await host.press('End');
      await host.press('Home');

      expect(host.cursors.slice(-2)).toEqual([31, 16]);
    });

    it('insert_asksForTheModeToChange', async () => {
      const host: FakeHost = new FakeHost(4);
      let toggled: number = 0;
      host.fixture.componentInstance.toggleInsertMode.subscribe((): void => {
        toggled += 1;
      });

      await host.press('Insert');

      expect(toggled).toBe(1);
    });

    it('otherKeys_areLeftToTheBrowser', async () => {
      const host: FakeHost = new FakeHost(4);

      expect(await host.press('Escape')).toBe(false);
      expect(host.ops).toEqual([]);
    });
  });

  describe('typing', () => {
    it('hexDigits_overwriteTheByteOneNibbleAtATime_thenMoveOn', async () => {
      const host: FakeHost = new FakeHost(4);

      await host.press('b');
      expect(host.bytes[0]).toBe(0xb1);
      await host.press('7');

      expect(host.bytes[0]).toBe(0xb7);
      expect(host.cursors.at(-1)).toBe(1);
    });

    it('hexDigits_inInsertMode_addABytePerPair', async () => {
      const host: FakeHost = new FakeHost(2);
      host.fixture.componentRef.setInput('insertMode', true);

      await host.press('1');
      await host.press('2');

      expect(host.bytes).toEqual([0x12, 0x41, 0x41]);
      expect(host.cursors.at(-1)).toBe(1);
    });

    it('nonHexKeys_inTheHexColumn_doNothing', async () => {
      const host: FakeHost = new FakeHost(2);

      expect(await host.press('z')).toBe(false);
      expect(host.ops).toEqual([]);
    });

    it('text_inTheTextColumn_writesTheCharacter', async () => {
      const host: FakeHost = new FakeHost(2);
      await host.press('Tab');

      await host.press('z');

      expect(host.bytes[0]).toBe(0x7a);
      expect(host.cursors.at(-1)).toBe(1);
    });

    it('nonPrintableKeys_inTheTextColumn_doNothing', async () => {
      const host: FakeHost = new FakeHost(2);
      await host.press('Tab');

      expect(await host.press('\u00e9')).toBe(false);
      expect(host.ops).toEqual([]);
    });

    it('text_inInsertMode_addsAByte', async () => {
      const host: FakeHost = new FakeHost(1);
      host.fixture.componentRef.setInput('insertMode', true);
      await host.press('Tab');

      await host.press('z');

      expect(host.bytes).toEqual([0x7a, 0x41]);
    });

    it('caret_canSitOnTheAppendPoint_inInsertModeOnly', async () => {
      const host: FakeHost = new FakeHost(1);
      await host.press('ArrowRight');
      expect(host.cursors.at(-1)).toBe(0);

      host.fixture.componentRef.setInput('insertMode', true);
      await host.press('ArrowRight');

      expect(host.cursors.at(-1)).toBe(1);
    });

    it.each(['c', 'a', 'v', 'x'])('commandChord_%s_isAShortcutNotADigit', async (key: string) => {
      const host: FakeHost = new FakeHost(4);

      const consumed: boolean = await host.press(key, { metaKey: true });

      expect(host.ops).toEqual([]);
      expect(host.bytes[0]).toBe(0x41);
      expect(consumed).toBe(false);
    });

    it('controlChord_inTheTextColumn_isAShortcutNotAnEdit', async () => {
      const host: FakeHost = new FakeHost(4);
      await host.press('Tab');

      await host.press('v', { ctrlKey: true });

      expect(host.ops).toEqual([]);
    });

    it('altGr_stillTypes', async () => {
      const host: FakeHost = new FakeHost(4);
      await host.press('Tab');

      await host.press('@', { ctrlKey: true, altKey: true, modifierAltGraph: true });

      expect(host.bytes[0]).toBe(0x40);
    });

    it('anExternalSelection_abandonsAHalfTypedByte', async () => {
      const host: FakeHost = new FakeHost(4);
      await host.press('b');

      host.fixture.componentRef.setInput('selection', { start: 2, end: 3 });
      await host.fixture.whenStable();
      await host.press('c');

      // A fresh high nibble at the new caret, not a low nibble written over it.
      expect(host.bytes[2]).toBe(0xc1);
    });

    it('clicking_abandonsAHalfTypedByte', async () => {
      const host: FakeHost = new FakeHost(4);
      await host.fixture.whenStable();
      await host.press('b');

      await host.cell('hexcell', 2);
      await host.press('c');

      expect(host.bytes[2]).toBe(0xc1);
    });

    it('readOnly_refusesTypingAndDeleting_butKeepsMoving', async () => {
      const host: FakeHost = new FakeHost(4);
      host.fixture.componentRef.setInput('readOnly', true);

      expect(await host.press('b')).toBe(false);
      await host.press('Delete');
      await host.press('Backspace');
      await host.press('ArrowRight');

      expect(host.ops).toEqual([]);
      expect(host.cursors).toEqual([1]);
    });
  });

  describe('deleting', () => {
    it('delete_removesTheByteAtTheCaret', async () => {
      const host: FakeHost = new FakeHost(3);
      await host.press('ArrowRight');

      await host.press('Delete');

      expect(host.ops).toEqual([{ kind: 'delete', offset: 1, count: 1 }]);
    });

    it('backspace_removesTheByteBeforeTheCaret', async () => {
      const host: FakeHost = new FakeHost(3);
      await host.press('ArrowRight');

      await host.press('Backspace');

      expect(host.ops).toEqual([{ kind: 'delete', offset: 0, count: 1 }]);
      expect(host.cursors.at(-1)).toBe(0);
    });

    it('backspace_atTheStart_doesNothing', async () => {
      const host: FakeHost = new FakeHost(3);

      await host.press('Backspace');

      expect(host.ops).toEqual([]);
    });

    it('delete_inAnEmptyFile_doesNothing', async () => {
      const host: FakeHost = new FakeHost(0);

      await host.press('Delete');

      expect(host.ops).toEqual([]);
    });
  });

  describe('selecting with the pointer', () => {
    it('press_selectsTheByteAndFocusesTheGrid', async () => {
      const host: FakeHost = new FakeHost(32);
      await host.fixture.whenStable();

      await host.cell('hexcell', 3);

      expect(host.selections).toEqual([{ start: 3, end: 4 }]);
      expect(host.selectedCells()).toBe(1);
    });

    it('drag_extendsTheRange_inEitherDirection', async () => {
      const host: FakeHost = new FakeHost(32);
      await host.fixture.whenStable();
      await host.cell('hexcell', 5);

      await host.cell('hexcell', 8, 'pointerenter');
      expect(host.selections.at(-1)).toEqual({ start: 5, end: 9 });

      await host.cell('hexcell', 2, 'pointerenter');
      expect(host.selections.at(-1)).toEqual({ start: 2, end: 6 });
    });

    it('moving_afterTheRelease_selectsNothing', async () => {
      const host: FakeHost = new FakeHost(32);
      await host.fixture.whenStable();
      await host.cell('hexcell', 5);
      window.dispatchEvent(new MouseEvent('pointerup'));

      await host.cell('hexcell', 8, 'pointerenter');

      expect(host.selections).toEqual([{ start: 5, end: 6 }]);
    });

    it('pressingTheTextColumn_makesItTheTypingColumn', async () => {
      const host: FakeHost = new FakeHost(4);
      await host.fixture.whenStable();
      await host.cell('asciicell', 1);

      await host.press('z');

      expect(host.bytes[1]).toBe(0x7a);
    });

    it('doubleClick_asksForTheWholeUnit', async () => {
      const host: FakeHost = new FakeHost(4);
      await host.fixture.whenStable();
      const units: number[] = [];
      host.fixture.componentInstance.unitSelect.subscribe((offset: number): void => {
        units.push(offset);
      });

      await host.cell('hexcell', 2, 'dblclick');

      expect(units).toEqual([2]);
    });
  });

  describe('scrolling', () => {
    /**
     * Scrolls the grid as the user would.
     */
    async function scrollTo(host: FakeHost, top: number): Promise<void> {
      const scroller: HTMLElement = host.scroller();
      scroller.scrollTop = top;
      scroller.dispatchEvent(new Event('scroll'));
      await host.fixture.whenStable();
    }

    it('scroll_movesTheWindowOfRowsDrawn', async () => {
      const host: FakeHost = new FakeHost(16 * 1000);
      const ranges: BinaryVisibleRange[] = [];
      host.fixture.componentInstance.visibleRangeChange.subscribe(
        (range: BinaryVisibleRange): void => {
          ranges.push(range);
        },
      );
      await scrollTo(host, 26 * 500);

      expect(ranges.at(-1)?.offset).toBeGreaterThan(16 * 480);
      expect(ranges.at(-1)?.offset).toBeLessThanOrEqual(16 * 500);
      expect(
        host.host().querySelector('.binary-editor__addr:not(.binary-editor__addr--header)')
          ?.textContent,
      ).not.toBe('0000:0000');
    });

    it('reveal_centresTheTargetRow', async () => {
      const host: FakeHost = new FakeHost(16 * 1000);
      await host.fixture.whenStable();

      host.fixture.componentRef.setInput('revealOffset', 16 * 500);
      host.fixture.componentRef.setInput('revealVersion', 1);
      await host.fixture.whenStable();

      expect(host.scroller().scrollTop).toBe((500 - 5) * 26);
    });

    it('reveal_doesNotDragTheViewBack_whenTheFileChangesSizeLater', async () => {
      const host: FakeHost = new FakeHost(16 * 1000);
      host.fixture.componentRef.setInput('revealOffset', 16 * 500);
      host.fixture.componentRef.setInput('revealVersion', 1);
      await host.fixture.whenStable();
      await scrollTo(host, 0);

      host.fixture.componentRef.setInput('size', 16 * 1200);
      await host.fixture.whenStable();

      expect(host.scroller().scrollTop).toBe(0);
    });

    it('caret_movingOffTheBottom_scrollsTheGridAlong', async () => {
      const host: FakeHost = new FakeHost(16 * 100);
      await host.fixture.whenStable();

      for (let row: number = 0; row < 12; row += 1) {
        await host.press('ArrowDown');
      }

      expect(host.scroller().scrollTop).toBe(3 * 26);
    });

    it('caret_movingAboveTheTop_scrollsBack', async () => {
      const host: FakeHost = new FakeHost(16 * 100);
      await scrollTo(host, 26 * 50);

      await host.press('ArrowRight');

      expect(host.scroller().scrollTop).toBe(0);
    });

    describe('past the browser height limit', () => {
      const gigabytes: number = 2 * 1024 * 1024 * 1024;

      /**
       * A grid over a file too tall for a real scrollbar.
       */
      async function largeFile(): Promise<FakeHost> {
        const host: FakeHost = new FakeHost(0);
        host.fixture.componentRef.setInput('size', gigabytes);
        Object.defineProperty(host.scroller(), 'scrollHeight', {
          configurable: true,
          value: 24_000_000,
        });
        await host.fixture.whenStable();
        return host;
      }

      it('wheel_movesByRowsAndKeepsThemExact', async () => {
        const host: FakeHost = await largeFile();
        const wheel: WheelEvent = new WheelEvent('wheel', {
          deltaY: 26 * 10,
          bubbles: true,
          cancelable: true,
        });
        const ranges: BinaryVisibleRange[] = [];
        host.fixture.componentInstance.visibleRangeChange.subscribe(
          (range: BinaryVisibleRange): void => {
            ranges.push(range);
          },
        );

        host.scroller().dispatchEvent(wheel);
        await host.fixture.whenStable();

        expect(wheel.defaultPrevented).toBe(true);
        // Ten rows down, less the eight the window keeps drawn above the viewport.
        expect(ranges.at(-1)?.offset).toBe(16 * 2);
      });

      it('wheel_inAnOrdinaryFile_isLeftToTheBrowser', () => {
        const host: FakeHost = new FakeHost(64);
        const wheel: WheelEvent = new WheelEvent('wheel', {
          deltaY: 10,
          bubbles: true,
          cancelable: true,
        });

        host.scroller().dispatchEvent(wheel);

        expect(wheel.defaultPrevented).toBe(false);
      });

      it('scrollbarDrag_mapsProportionallyAcrossTheWholeFile', async () => {
        const host: FakeHost = await largeFile();
        const ranges: BinaryVisibleRange[] = [];
        host.fixture.componentInstance.visibleRangeChange.subscribe(
          (range: BinaryVisibleRange): void => {
            ranges.push(range);
          },
        );

        await scrollTo(host, (24_000_000 - 260) / 2);

        expect(Math.abs((ranges.at(-1)?.offset ?? 0) - gigabytes / 2)).toBeLessThan(16 * 100);
      });

      it('caret_reachingARowOffscreen_doesNotLoseItsPlaceToTheScrollEcho', async () => {
        const host: FakeHost = await largeFile();
        host.fixture.componentRef.setInput('revealOffset', gigabytes - 16);
        host.fixture.componentRef.setInput('revealVersion', 1);
        await host.fixture.whenStable();
        const ranges: BinaryVisibleRange[] = [];
        host.fixture.componentInstance.visibleRangeChange.subscribe(
          (range: BinaryVisibleRange): void => {
            ranges.push(range);
          },
        );

        // The browser's scroll event echoing the write must not re-derive the row.
        host.scroller().dispatchEvent(new Event('scroll'));
        host
          .scroller()
          .dispatchEvent(new WheelEvent('wheel', { deltaY: -26, bubbles: true, cancelable: true }));
        await host.fixture.whenStable();

        expect(ranges.at(-1)?.offset).toBeGreaterThan(gigabytes - 16 * 100);
      });
    });
  });

  describe('teardown', () => {
    it('viewportObserver_isReleasedWithTheComponent', async () => {
      const disconnect: Mock<() => void> = vi.fn<() => void>();
      class RecordingObserver {
        public observe(): void {
          /* jsdom has no layout to observe */
        }

        public disconnect(): void {
          disconnect();
        }
      }
      vi.stubGlobal('ResizeObserver', RecordingObserver);
      const host: FakeHost = new FakeHost(16);
      await host.fixture.whenStable();

      host.fixture.destroy();

      expect(disconnect).toHaveBeenCalledOnce();
      vi.unstubAllGlobals();
    });
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

  it('textOf_withATruncatedOrBrokenSequence_showsADot', () => {
    expect(textOf(0, 0xe2, 'utf8', (): null => null)).toContain('·');
    expect(textOf(0, 0xf0, 'utf8', (): number => 0x20)).toContain('·');
    expect(textOf(0, 0x41, 'utf8', (): null => null)).toBe('A');
    expect(textOf(0, 0x80, 'latin1', (): null => null)).toBe('·');
  });
});
