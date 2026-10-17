import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Studio } from '@shared/angular/services/studio/studio';
import { WindowControls } from './window-controls';

/**
 * A stand-in for the app-shell wrapper, recording what the controls ask of it.
 */
class FakeStudio {
  public drawsWindowControls: boolean = true;
  public maximized: boolean = false;
  public readonly calls: string[] = [];
  public readonly views: Window[] = [];

  public minimizeWindow(view: Window): void {
    this.record('minimize', view);
  }

  public toggleMaximizeWindow(view: Window): void {
    this.record('toggleMaximize', view);
  }

  public closeWindow(view: Window): void {
    this.record('close', view);
  }

  public isWindowMaximized(): Promise<boolean> {
    return Promise.resolve(this.maximized);
  }

  private record(call: string, view: Window): void {
    this.calls.push(call);
    this.views.push(view);
  }
}

describe('WindowControls', () => {
  let studio: FakeStudio;

  /**
   * Creates the controls against the fake studio.
   * @param inputs The inputs to set before the first render.
   * @returns Returns the rendered fixture.
   */
  async function create(
    inputs: Partial<Record<'minimizable' | 'maximizable' | 'closable', boolean>> = {},
  ): Promise<ComponentFixture<WindowControls>> {
    TestBed.configureTestingModule({
      imports: [WindowControls],
      providers: [{ provide: Studio, useValue: studio }],
    });
    const fixture: ComponentFixture<WindowControls> = TestBed.createComponent(WindowControls);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  /**
   * Reads the accessible names of the rendered buttons, in order.
   * @param fixture The rendered fixture.
   * @returns Returns the button labels.
   */
  function labels(fixture: ComponentFixture<WindowControls>): string[] {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].map(
      (button: HTMLButtonElement): string => button.getAttribute('aria-label') ?? '',
    );
  }

  /**
   * Clicks the rendered button with the given accessible name.
   * @param fixture The rendered fixture.
   * @param label The button's accessible name.
   */
  function click(fixture: ComponentFixture<WindowControls>, label: string): void {
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
      ?.click();
  }

  beforeEach(() => {
    studio = new FakeStudio();
  });

  it('render_wherePlatformDrawsItsOwnControls_rendersNothing', async () => {
    studio.drawsWindowControls = false;

    const fixture: ComponentFixture<WindowControls> = await create();

    expect(labels(fixture)).toEqual([]);
  });

  it('render_onLinux_drawsMinimizeMaximizeAndCloseInOrder', async () => {
    const fixture: ComponentFixture<WindowControls> = await create();

    expect(labels(fixture)).toEqual(['Minimize', 'Maximize', 'Close']);
  });

  it('render_whenWindowIsMaximized_offersRestore', async () => {
    studio.maximized = true;

    const fixture: ComponentFixture<WindowControls> = await create();

    expect(labels(fixture)).toEqual(['Minimize', 'Restore', 'Close']);
  });

  it('render_forAModal_drawsOnlyWhatTheWindowAllows', async () => {
    const fixture: ComponentFixture<WindowControls> = await create({
      minimizable: false,
      maximizable: false,
    });

    expect(labels(fixture)).toEqual(['Close']);
  });

  it('click_eachButton_actsOnTheWindowItRendersIn', async () => {
    const fixture: ComponentFixture<WindowControls> = await create();

    click(fixture, 'Minimize');
    click(fixture, 'Maximize');
    click(fixture, 'Close');

    expect(studio.calls).toEqual(['minimize', 'toggleMaximize', 'close']);
    expect(studio.views.every((view: Window): boolean => view === window)).toBe(true);
  });
});
