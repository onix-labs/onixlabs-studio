import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Tab } from '@shared/angular/services/tabs/tab';
import { Tabs } from '@shared/angular/services/tabs/tabs';
import { ContentHost } from './content-host';

describe('ContentHost', () => {
  let fixture: ComponentFixture<ContentHost>;
  let tabs: Tabs;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContentHost],
    }).compileComponents();

    tabs = TestBed.inject(Tabs);
  });

  it('should create', async () => {
    fixture = TestBed.createComponent(ContentHost);
    await fixture.whenStable();

    expect(fixture.componentInstance).toBeTruthy();
  });

  it('render_whenMultipleTabsOpen_mountsEveryViewAndHidesOnlyTheInactiveOnes', async () => {
    // The first tab is opened then deactivated by opening the second, so it is the inactive one.
    tabs.open('code');
    tabs.open('markdown');

    fixture = TestBed.createComponent(ContentHost);
    await fixture.whenStable();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const wrappers: readonly HTMLElement[] = Array.from(
      host.querySelectorAll<HTMLElement>('.tab-view'),
    );
    const codeWrapper: HTMLElement | undefined = wrappers.find(
      (wrapper: HTMLElement): boolean => wrapper.querySelector('app-code-view') !== null,
    );
    const markdownWrapper: HTMLElement | undefined = wrappers.find(
      (wrapper: HTMLElement): boolean => wrapper.querySelector('app-markdown-view') !== null,
    );

    // Both views are mounted (one wrapper each), proving inactive tabs are not destroyed.
    expect(wrappers.length).toBe(2);
    expect(codeWrapper).toBeDefined();
    expect(markdownWrapper).toBeDefined();

    // Only the inactive (code) view is hidden; the active (markdown) view is visible.
    expect(codeWrapper?.classList.contains('tab-view--hidden')).toBe(true);
    expect(markdownWrapper?.classList.contains('tab-view--hidden')).toBe(false);
  });

  it('render_whenActiveTabChanges_keepsThePreviouslyActiveViewMountedInTheDom', async () => {
    const first: Tab = tabs.open('code');
    tabs.open('markdown');

    fixture = TestBed.createComponent(ContentHost);
    await fixture.whenStable();

    // Switch back to the first tab; the markdown view must remain in the DOM, merely hidden.
    tabs.activate(first.id);
    await fixture.whenStable();

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('app-code-view')).not.toBeNull();
    expect(host.querySelector('app-markdown-view')).not.toBeNull();
  });
});
