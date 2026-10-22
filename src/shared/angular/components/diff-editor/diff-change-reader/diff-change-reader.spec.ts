import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  describeChange,
  DiffChangeReader,
  DiffReaderView,
  MAX_READER_LINES,
  readerViewOf,
} from './diff-change-reader';

describe('describeChange (#1026)', () => {
  it('saysRemovedAddedOrBoth_inPlainWords', () => {
    expect(
      describeChange({
        originalStartLineNumber: 12,
        originalEndLineNumber: 12,
        modifiedStartLineNumber: 11,
        modifiedEndLineNumber: 0,
      }),
    ).toBe('Line 12 removed');
    expect(
      describeChange({
        originalStartLineNumber: 13,
        originalEndLineNumber: 0,
        modifiedStartLineNumber: 14,
        modifiedEndLineNumber: 15,
      }),
    ).toBe('Lines 14–15 added');
    expect(
      describeChange({
        originalStartLineNumber: 12,
        originalEndLineNumber: 12,
        modifiedStartLineNumber: 14,
        modifiedEndLineNumber: 15,
      }),
    ).toBe('Line 12 removed, lines 14–15 added');
  });
});

describe('readerViewOf (#1026)', () => {
  it('listsTheRemovedThenTheAddedLines_eachWithItsOwnSidesNumber', () => {
    const view: DiffReaderView = readerViewOf(
      {
        originalStartLineNumber: 3,
        originalEndLineNumber: 3,
        modifiedStartLineNumber: 3,
        modifiedEndLineNumber: 4,
      },
      2,
      5,
      (line: number): string => `old ${line}`,
      (line: number): string => `new ${line}`,
    );

    expect(view).toEqual({
      index: 2,
      total: 5,
      label: 'Line 3 removed, lines 3–4 added',
      lines: [
        { kind: 'removed', number: 3, text: 'old 3' },
        { kind: 'added', number: 3, text: 'new 3' },
        { kind: 'added', number: 4, text: 'new 4' },
      ],
      hidden: 0,
    });
  });

  it('capsAHugeChange_andCountsWhatItLeftOut', () => {
    const view: DiffReaderView = readerViewOf(
      {
        originalStartLineNumber: 1,
        originalEndLineNumber: 0,
        modifiedStartLineNumber: 1,
        modifiedEndLineNumber: MAX_READER_LINES + 50,
      },
      1,
      1,
      (): string => '',
      (): string => 'x',
    );

    expect(view.lines).toHaveLength(MAX_READER_LINES);
    expect(view.hidden).toBe(50);
  });
});

describe('DiffChangeReader (#1026)', () => {
  let fixture: ComponentFixture<DiffChangeReader>;
  let events: string[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DiffChangeReader] }).compileComponents();
    fixture = TestBed.createComponent(DiffChangeReader);
    events = [];
    fixture.componentInstance.next.subscribe((): number => events.push('next'));
    fixture.componentInstance.previous.subscribe((): number => events.push('previous'));
    fixture.componentInstance.closed.subscribe((): number => events.push('closed'));
    fixture.componentRef.setInput(
      'view',
      readerViewOf(
        {
          originalStartLineNumber: 12,
          originalEndLineNumber: 12,
          modifiedStartLineNumber: 12,
          modifiedEndLineNumber: 0,
        },
        2,
        3,
        (): string => 'gone',
        (): string => '',
      ),
    );
    fixture.detectChanges();
  });

  /**
   * Gets the reader's element.
   * @returns Returns the element.
   */
  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  it('announcesTheChange_andShowsItsLines', () => {
    expect(host().getAttribute('role')).toBe('region');
    expect(host().querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'Change 2 of 3: Line 12 removed',
    );
    expect(host().querySelector('.diff-change-reader__line--removed')?.textContent).toContain(
      'gone',
    );
  });

  it('keys_f7Steps_shiftF7StepsBack_escapeCloses', () => {
    for (const init of [{ key: 'F7' }, { key: 'F7', shiftKey: true }, { key: 'Escape' }]) {
      host().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
    }

    expect(events).toEqual(['next', 'previous', 'closed']);
  });

  it('withNoChanges_saysSo_andDisablesStepping', () => {
    fixture.componentRef.setInput('view', { index: 0, total: 0, label: '', lines: [], hidden: 0 });
    fixture.detectChanges();

    expect(host().querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'There are no changes to read.',
    );
    const disabled: number = Array.from(host().querySelectorAll('button')).filter(
      (button: HTMLButtonElement): boolean => button.disabled,
    ).length;
    expect(disabled).toBe(2);
  });
});
