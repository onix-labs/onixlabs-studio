import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RowEditField, RowEditSelection, stemSelection } from './row-edit-field';

@Component({
  imports: [RowEditField],
  template: `
    <div class="probe-row" tabindex="-1" (keydown)="onRowKey()" (click)="onRowClick()">
      <app-row-edit-field
        [initial]="initial"
        [selection]="selection"
        [(value)]="value"
        (commit)="committed.push($event)"
        (abandon)="cancelled = cancelled + 1"
      />
    </div>
  `,
})
class TestHost {
  public initial: string = 'component.ts';
  public selection: RowEditSelection = 'stem';
  public readonly value: WritableSignal<string> = signal<string>('component.ts');
  public readonly committed: string[] = [];
  public cancelled: number = 0;
  public rowKeys: number = 0;
  public rowClicks: number = 0;

  public onRowKey(): void {
    this.rowKeys += 1;
  }

  public onRowClick(): void {
    this.rowClicks += 1;
  }
}

describe('stemSelection', () => {
  it('stemSelection_withAnExtension_selectsTheNameBeforeTheLastDot', () => {
    expect(stemSelection('component.spec.ts')).toEqual({ start: 0, end: 14 });
  });

  it('stemSelection_withNoDot_selectsTheWholeName', () => {
    expect(stemSelection('Makefile')).toEqual({ start: 0, end: 8 });
  });

  it('stemSelection_withOnlyALeadingDot_selectsTheWholeName', () => {
    // The dot of a dotfile is part of its name, not the start of an extension.
    expect(stemSelection('.gitignore')).toEqual({ start: 0, end: 10 });
  });
});

describe('RowEditField', () => {
  let fixture: ComponentFixture<TestHost>;
  let component: TestHost;
  let input: HTMLInputElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();
    fixture = TestBed.createComponent(TestHost);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    input = (fixture.nativeElement as HTMLElement).querySelector('input')!;
  });

  /**
   * Types a value into the field, as a keystroke would.
   * @param value The field's new text.
   */
  function type(value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  /**
   * Presses a key in the field.
   * @param key The key's name.
   */
  function press(key: string): void {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  it('opens_focusedWithTheStemSelected_soTypingKeepsTheExtension', () => {
    expect(document.activeElement).toBe(input);
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 9]);
  });

  it('enter_withANewName_commitsItTrimmed', () => {
    type('  widget.ts ');
    press('Enter');

    expect(component.committed).toEqual(['widget.ts']);
    expect(component.cancelled).toBe(0);
  });

  it('enter_withTheNameUnchanged_cancelsInstead', () => {
    press('Enter');

    expect(component.committed).toEqual([]);
    expect(component.cancelled).toBe(1);
  });

  it('enter_withNothingButWhitespace_cancelsInstead', () => {
    type('   ');
    press('Enter');

    expect(component.committed).toEqual([]);
    expect(component.cancelled).toBe(1);
  });

  it('escape_cancels_evenWithANewNameTyped', () => {
    type('widget.ts');
    press('Escape');

    expect(component.committed).toEqual([]);
    expect(component.cancelled).toBe(1);
  });

  it('blur_commits_asClickingAwayDoesInOtherEditorsTrees', () => {
    type('widget.ts');
    input.dispatchEvent(new FocusEvent('blur'));

    expect(component.committed).toEqual(['widget.ts']);
  });

  it('blur_afterEnterOrEscape_doesNotReportTheEditASecondTime', () => {
    type('widget.ts');
    press('Enter');
    input.dispatchEvent(new FocusEvent('blur'));
    press('Escape');

    expect(component.committed).toEqual(['widget.ts']);
    expect(component.cancelled).toBe(0);
  });

  it('keysAndClicksTheRowAnswers_stopAtTheField', () => {
    press('Enter');
    press(' ');
    input.click();

    expect(component.rowKeys).toBe(0);
    expect(component.rowClicks).toBe(0);
  });

  it('otherKeys_stillBubble_soApplicationShortcutsKeepWorking', () => {
    press('s');

    expect(component.rowKeys).toBe(1);
  });
});
