import { TestBed } from '@angular/core/testing';
import { Studio } from '@shared/angular/services/studio/studio';
import { Tabs } from '@shared/angular/services/tabs/tabs';

import { ShellPresence } from './shell-presence';

/**
 * Records the window operations the presence asks for.
 */
class FakeStudio {
  public shown: number = 0;
  public hidden: number = 0;

  public showWindow(): void {
    this.shown += 1;
  }

  public hideWindow(): void {
    this.hidden += 1;
  }
}

describe('ShellPresence', () => {
  let studio: FakeStudio;
  let tabs: Tabs;

  beforeEach(() => {
    studio = new FakeStudio();
    TestBed.configureTestingModule({
      providers: [ShellPresence, { provide: Studio, useValue: studio }],
    });
    TestBed.inject(ShellPresence);
    tabs = TestBed.inject(Tabs);
  });

  it('withNoTabs_hidesTheMainWindow', () => {
    TestBed.tick();

    expect(studio.hidden).toBeGreaterThan(0);
    expect(studio.shown).toBe(0);
  });

  it('whenATabOpens_showsTheMainWindow', () => {
    TestBed.tick();

    tabs.open('code');
    TestBed.tick();

    expect(studio.shown).toBe(1);
  });

  it('whenTheLastTabCloses_hidesTheMainWindowAgain', () => {
    tabs.open('code');
    TestBed.tick();
    const hiddenBefore: number = studio.hidden;

    tabs.close(tabs.tabs()[0].id);
    TestBed.tick();

    expect(studio.hidden).toBe(hiddenBefore + 1);
  });
});
