import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import type { MergedBranch } from '@shared/angular/services/repository/merged-branch';
import { DeleteMergedBranches } from './delete-merged-branches';

/**
 * A branch merged by ancestry, with its upstream still on the remote.
 */
const DONE: MergedBranch = {
  name: 'feature/done',
  merge: { kind: 'local', into: 'main' },
  remoteBranch: { remote: 'origin', name: 'feature/done' },
};

/**
 * A branch merged by squash through a pull request, with no remote copy left.
 */
const SQUASHED: MergedBranch = {
  name: 'feature/squashed',
  merge: { kind: 'pull-request', number: 42 },
};

describe('DeleteMergedBranches (#887)', () => {
  let fixture: ComponentFixture<DeleteMergedBranches>;
  let windows: FakeModalWindows;
  let confirmed: boolean[];
  let dismissed: number;

  /**
   * Finds an element in the open dialog by its test id.
   * @param testId The test id.
   * @returns Returns the element, or null.
   */
  function find(testId: string): HTMLElement | null {
    return windows.contentHost?.querySelector<HTMLElement>(`[data-testid="${testId}"]`) ?? null;
  }

  /**
   * Presses a button in the open dialog.
   * @param testId The button's test id.
   */
  async function press(testId: string): Promise<void> {
    find(testId)?.querySelector<HTMLElement>('button')?.click();
    await fixture.whenStable();
  }

  /**
   * Ticks the remote branches checkbox.
   */
  async function tickRemotes(): Promise<void> {
    find('merged-branches-remote')?.querySelector<HTMLInputElement>('input')?.click();
    await fixture.whenStable();
  }

  /**
   * Opens the dialog on branches.
   * @param branches The branches.
   * @param canDeleteRemotes Whether the plugin can delete remote branches.
   */
  async function open(
    branches: readonly MergedBranch[] | null,
    canDeleteRemotes: boolean = true,
  ): Promise<void> {
    fixture.componentRef.setInput('branches', branches);
    fixture.componentRef.setInput('canDeleteRemotes', canDeleteRemotes);
    await fixture.whenStable();
  }

  beforeEach(async (): Promise<void> => {
    windows = new FakeModalWindows();
    confirmed = [];
    dismissed = 0;
    await TestBed.configureTestingModule({
      imports: [DeleteMergedBranches],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();
    fixture = TestBed.createComponent(DeleteMergedBranches);
    fixture.componentInstance.confirmed.subscribe((includeRemotes: boolean): void => {
      confirmed.push(includeRemotes);
    });
    fixture.componentInstance.dismissed.subscribe((): void => {
      dismissed += 1;
    });
    await fixture.whenStable();
  });

  it('staysClosed_whileThereAreNoBranches', async (): Promise<void> => {
    await open(null);

    expect(windows.openWindows).toBe(0);
  });

  it('listsTheLocalBranchesItWillDelete_withWhereEachWasMerged', async (): Promise<void> => {
    await open([DONE, SQUASHED]);

    const list: string = find('merged-branches-list')?.textContent ?? '';
    expect(find('merged-branches-message')?.textContent).toContain('2 local branches are deleted');
    expect(list).toContain('feature/done');
    expect(list).toContain('merged into main');
    expect(list).toContain('feature/squashed');
    expect(list).toContain('merged via pull request #42');
  });

  it('offersTheRemoteBranchesThatStillExist_unticked', async (): Promise<void> => {
    await open([DONE, SQUASHED]);

    const option: HTMLInputElement | null | undefined =
      find('merged-branches-remote')?.querySelector<HTMLInputElement>('input');
    expect(option?.checked).toBe(false);
    expect(windows.contentHost?.textContent).toContain('Also delete 1 remote branch');
    expect(find('merged-branches-remote-note')?.textContent).toContain('origin/feature/done');
  });

  it('confirms_withoutTheRemotes_unlessTheBoxIsTicked', async (): Promise<void> => {
    await open([DONE]);

    await press('merged-branches-delete');

    expect(confirmed).toEqual([false]);
  });

  it('confirms_withTheRemotes_onceTheBoxIsTicked', async (): Promise<void> => {
    await open([DONE]);
    await tickRemotes();

    await press('merged-branches-delete');

    expect(confirmed).toEqual([true]);
  });

  it('startsUnticked_eachTimeItOpens', async (): Promise<void> => {
    await open([DONE]);
    await tickRemotes();
    await open(null);

    await open([DONE]);

    expect(find('merged-branches-remote')?.querySelector<HTMLInputElement>('input')?.checked).toBe(
      false,
    );
  });

  it('offersNoCheckbox_whenNoRemoteBranchIsLeft', async (): Promise<void> => {
    await open([SQUASHED]);

    expect(find('merged-branches-remote')).toBeNull();
    expect(find('merged-branches-message')?.textContent).toContain('1 local branch is deleted');
  });

  it('offersNoCheckbox_whenThePluginCannotDeleteRemoteBranches', async (): Promise<void> => {
    await open([DONE], false);

    expect(find('merged-branches-remote')).toBeNull();
  });

  it('cancel_dismissesWithoutConfirming', async (): Promise<void> => {
    await open([DONE]);

    await press('merged-branches-cancel');

    expect(dismissed).toBe(1);
    expect(confirmed).toEqual([]);
  });
});
