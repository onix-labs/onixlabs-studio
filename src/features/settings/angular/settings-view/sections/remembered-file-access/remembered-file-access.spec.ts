import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Security } from '@shared/angular/services/security/security';
import { RememberedFileAccess } from './remembered-file-access';

describe('RememberedFileAccess', () => {
  let remembered: string[];
  let fixture: ComponentFixture<RememberedFileAccess>;

  /**
   * Lets the list's round trips to the (stubbed) main process settle, then renders.
   */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    remembered = ['/projects/b', '/projects/a'];
    TestBed.configureTestingModule({
      imports: [RememberedFileAccess],
      providers: [
        {
          provide: Security,
          useValue: {
            rememberedAccess: (): Promise<readonly string[]> => Promise.resolve([...remembered]),
            forgetRememberedAccess: (path: string): Promise<readonly string[]> => {
              remembered = remembered.filter((entry: string): boolean => entry !== path);
              return Promise.resolve([...remembered]);
            },
            clearRememberedAccess: (): Promise<readonly string[]> => {
              remembered = [];
              return Promise.resolve([]);
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(RememberedFileAccess);
    fixture.detectChanges();
    await settle();
  });

  /**
   * Reads the listed paths.
   * @returns Returns the paths shown.
   */
  function shown(): string[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.remembered-access__path'),
    ).map((element: Element): string => element.textContent?.trim() ?? '');
  }

  it('render_listsWhatIsRemembered', () => {
    expect(shown()).toEqual(['/projects/b', '/projects/a']);
  });

  it('forget_removesThatPath', async () => {
    const forget: HTMLElement | null = (fixture.nativeElement as HTMLElement).querySelector(
      '[aria-label="Forget /projects/a"]',
    );
    forget?.click();
    await settle();

    expect(shown()).toEqual(['/projects/b']);
  });

  it('clearAll_emptiesTheList', async () => {
    const clearAll: HTMLButtonElement | undefined = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button: HTMLButtonElement): boolean => button.textContent?.trim() === 'Clear All');
    clearAll?.click();
    await settle();

    expect(shown()).toEqual([]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('Nothing is remembered.');
  });
});
