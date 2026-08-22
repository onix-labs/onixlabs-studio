import { ApplicationRef, Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ModalWindows } from '@shared/angular/services/modal-windows/modal-windows';
import { FakeModalWindows } from '@shared/angular/services/modal-windows/modal-windows.fake';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import { MarkdownEmojiModal } from './markdown-emoji-modal';

@Component({
  imports: [MarkdownEmojiModal],
  template: `
    <app-markdown-emoji-modal
      [open]="open()"
      (submitted)="onSubmit($event)"
      (closed)="open.set(false)"
    />
  `,
})
class TestHost {
  public readonly open: WritableSignal<boolean> = signal<boolean>(true);
  public submitted: string | null = null;

  public onSubmit(emoji: string): void {
    this.submitted = emoji;
  }
}

describe('MarkdownEmojiModal', () => {
  let fixture: ComponentFixture<TestHost>;
  let windows: FakeModalWindows;
  let host: HTMLElement;
  let component: TestHost;

  beforeEach(async () => {
    windows = new FakeModalWindows();
    await TestBed.configureTestingModule({
      imports: [TestHost],
      providers: [{ provide: ModalWindows, useValue: windows }],
    }).compileComponents();

    TestBed.inject(SettingsStore).set('markdown.recent-emoji', []);

    fixture = TestBed.createComponent(TestHost);
    component = fixture.componentInstance;
    fixture.detectChanges();
    // The modal is presented in a window; its content renders into that window's host.
    host = windows.contentHost!;
  });

  /**
   * Flushes change detection through the modal window's attached view, then re-points the content
   * host at the current window (a reopen presents a fresh one).
   */
  function flush(): void {
    TestBed.inject(ApplicationRef).tick();
    host = windows.contentHost!;
  }

  function categoryTitles(): string[] {
    return Array.from(host.querySelectorAll('.emoji-category-title')).map(
      (title: Element): string => title.textContent?.trim() ?? '',
    );
  }

  function setSearch(value: string): void {
    const input: HTMLInputElement = host.querySelector<HTMLInputElement>('#emoji-search')!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    flush();
  }

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('default_whenIdle_showsTheOrderedCategories', () => {
    const titles: string[] = categoryTitles();

    expect(titles).toEqual([
      'Smileys & People',
      'Animals & Nature',
      'Food & Drink',
      'Activity',
      'Travel & Places',
      'Objects',
      'Symbols',
      'Flags',
    ]);
  });

  it('tabs_whenNoRecent_showOneTabPerCategory', () => {
    const tabs: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.emoji-tab'),
    );

    expect(tabs.length).toBe(8);
    expect(tabs[0].classList).toContain('emoji-tab--active');
    expect(tabs[0].getAttribute('aria-label')).toBe('Smileys & People');
  });

  it('tabClick_whenClicked_marksTheTabActive', () => {
    const flags: HTMLButtonElement = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.emoji-tab'),
    ).find((tab: HTMLButtonElement): boolean => tab.getAttribute('aria-label') === 'Flags')!;

    flags.click();
    flush();

    expect(flags.classList).toContain('emoji-tab--active');
  });

  it('tabs_whenSearching_areHidden', () => {
    setSearch('rocket');

    expect(host.querySelector('.emoji-tab')).toBeNull();
  });

  it('search_whenQueried_showsAFlatFilteredGrid', () => {
    setSearch('rocket');

    expect(categoryTitles()).toEqual([]);
    const cells: HTMLButtonElement[] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.emoji-cell'),
    );
    expect(cells.length).toBeGreaterThan(0);
    expect(
      cells.some((cell: HTMLButtonElement): boolean => cell.textContent?.trim() === '🚀'),
    ).toBe(true);
  });

  it('pick_whenChosen_emitsTheEmojiAndRecordsItAsRecent', () => {
    setSearch('rocket');
    const rocket: HTMLButtonElement = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.emoji-cell'),
    ).find((cell: HTMLButtonElement): boolean => cell.textContent?.trim() === '🚀')!;

    rocket.click();

    expect(component.submitted).toBe('🚀');
    expect(TestBed.inject(SettingsStore).get<string[]>('markdown.recent-emoji', [])).toContain(
      '🚀',
    );
  });

  it('recent_whenPresent_showsARecentSection', () => {
    TestBed.inject(SettingsStore).set('markdown.recent-emoji', ['🚀']);

    const recentFixture: ComponentFixture<TestHost> = TestBed.createComponent(TestHost);
    recentFixture.detectChanges();
    // The modal is presented in a window; its content renders into that window's host.
    const recentHost: HTMLElement = windows.contentHost!;

    const titles: string[] = Array.from(recentHost.querySelectorAll('.emoji-category-title')).map(
      (title: Element): string => title.textContent?.trim() ?? '',
    );
    expect(titles[0]).toBe('Recent');
  });
});
