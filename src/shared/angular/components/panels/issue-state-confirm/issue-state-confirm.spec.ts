import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ForgeCloseReason, ForgeIssue } from '@shared/api/forge-types';
import { ForgeRepository } from '@shared/angular/services/forge-repository/forge-repository';
import { IssueActions } from '@shared/angular/services/issues/issue-actions';
import { IssueStateConfirm } from './issue-state-confirm';

/**
 * Builds an issue.
 * @param number The issue's number.
 * @param title Its title.
 * @returns Returns the issue.
 */
function makeIssue(number: number, title: string): ForgeIssue {
  return {
    number,
    title,
    author: 'matthew',
    url: `https://example.com/${number}`,
    labels: [],
    assignees: [],
    state: 'open',
    body: '',
    createdAt: '2026-08-01T10:00:00Z',
    updatedAt: '2026-08-02T10:00:00Z',
    commentCount: 0,
  };
}

/**
 * The parts of the dialog the tests reach into.
 */
interface DialogInternals {
  reasons(): readonly { value: string }[];
  reason: WritableSignal<ForgeCloseReason>;
  duplicateOf: WritableSignal<number>;
  canClose(): boolean;
  close(): void;
  chooseReason(value: string): void;
}

describe('IssueStateConfirm', () => {
  let fixture: ComponentFixture<IssueStateConfirm>;
  let dialog: DialogInternals;
  let actions: IssueActions;
  let closeReasons: WritableSignal<readonly ForgeCloseReason[]>;
  let confirmed: unknown[][];
  let release: () => void;

  beforeEach(() => {
    closeReasons = signal<readonly ForgeCloseReason[]>(['completed', 'notPlanned', 'duplicate']);
    confirmed = [];
    TestBed.configureTestingModule({
      imports: [IssueStateConfirm],
      providers: [
        IssueActions,
        {
          provide: ForgeRepository,
          useValue: {
            closeReasons,
            issues: signal({
              state: 'ready',
              items: [makeIssue(7, 'The original'), makeIssue(12, 'The copy')],
              message: null,
              stale: false,
            }),
          },
        },
      ],
    });
    actions = TestBed.inject(IssueActions);
    vi.spyOn(actions, 'confirm').mockImplementation((...args: unknown[]): Promise<void> => {
      confirmed.push(args);
      return Promise.resolve();
    });
    // The modal cannot open its window here and dismisses itself; holding the question open keeps
    // the dialog's state about the issue being asked about.
    const dismiss: () => void = actions.dismiss.bind(actions);
    const holdOpen: { active: boolean } = { active: true };
    vi.spyOn(actions, 'dismiss').mockImplementation((): void => {
      if (!holdOpen.active) {
        dismiss();
      }
    });
    release = (): void => {
      holdOpen.active = false;
    };
    fixture = TestBed.createComponent(IssueStateConfirm);
    dialog = fixture.componentInstance as unknown as DialogInternals;
    actions.requestToggle(makeIssue(12, 'The copy'));
    fixture.detectChanges();
  });

  it('reasons_offerDuplicate_onlyWhenTheRepositoryAllowsIt', () => {
    expect(dialog.reasons().map((option: { value: string }): string => option.value)).toEqual([
      'completed',
      'notPlanned',
      'duplicate',
    ]);

    closeReasons.set(['completed', 'notPlanned']);

    expect(dialog.reasons().map((option: { value: string }): string => option.value)).toEqual([
      'completed',
      'notPlanned',
    ]);
  });

  it('close_sendsTheReasonChosen_andNoOriginalUnlessADuplicate', () => {
    dialog.reason.set('notPlanned');
    dialog.duplicateOf.set(7);

    dialog.close();

    expect(confirmed).toEqual([['notPlanned', undefined]]);
  });

  it('duplicate_needsAnOriginalThatIsNotTheIssueItself', () => {
    dialog.reason.set('duplicate');
    expect(dialog.canClose()).toBe(false);

    dialog.duplicateOf.set(12);
    expect(dialog.canClose()).toBe(false);

    dialog.duplicateOf.set(7);
    expect(dialog.canClose()).toBe(true);

    dialog.close();
    expect(confirmed).toEqual([['duplicate', 7]]);
  });

  it('chooseReason_ignoresAReasonTheRepositoryDoesNotAllow', () => {
    closeReasons.set(['completed', 'notPlanned']);

    dialog.chooseReason('duplicate');

    expect(dialog.reason()).toBe('completed');
  });

  it('eachQuestion_startsAfresh', () => {
    dialog.reason.set('duplicate');
    dialog.duplicateOf.set(7);
    release();
    actions.dismiss();
    fixture.detectChanges();

    actions.requestToggle(makeIssue(12, 'The copy'));
    fixture.detectChanges();

    expect(dialog.reason()).toBe('completed');
    expect(dialog.duplicateOf()).toBe(0);
  });
});
