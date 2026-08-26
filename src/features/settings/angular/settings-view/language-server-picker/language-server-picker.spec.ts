import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LspServerSummary } from '@shared/api/lsp-channels';
import { LspSettings } from '@shared/angular/services/lsp-settings/lsp-settings';
import { LanguageServerPicker } from './language-server-picker';

/**
 * Builds a server summary for the tests.
 * @param id The server identifier.
 * @param languages The languages it serves.
 * @returns Returns the summary.
 */
function server(id: string, languages: readonly string[]): LspServerSummary {
  return { id, displayName: id, languages, priority: 100 };
}

describe('LanguageServerPicker', () => {
  let installed: Record<string, readonly LspServerSummary[]>;
  let chosen: { language: string; serverId: string | null }[];
  let selection: Record<string, string>;

  /**
   * Renders the picker with a fake settings service.
   * @returns Returns the rendered element.
   */
  async function render(): Promise<HTMLElement> {
    TestBed.configureTestingModule({
      imports: [LanguageServerPicker],
      providers: [
        {
          provide: LspSettings,
          useValue: {
            serversForLanguage: (language: string): readonly LspServerSummary[] =>
              installed[language] ?? [],
            serverForLanguage: (language: string): string | null => selection[language] ?? null,
            setServerForLanguage: (language: string, serverId: string | null): Promise<void> => {
              chosen.push({ language, serverId });
              return Promise.resolve();
            },
          },
        },
      ],
    });
    const fixture: ComponentFixture<LanguageServerPicker> =
      TestBed.createComponent(LanguageServerPicker);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    installed = {};
    selection = {};
    chosen = [];
  });

  it('nothingInstalled_showsTheEmptyState', async () => {
    const element: HTMLElement = await render();

    expect(element.querySelector('.language-server-picker__empty')).not.toBeNull();
    expect(element.querySelectorAll('.language-server-picker__choice')).toHaveLength(0);
  });

  it('oneImplementation_isNotAChoice', async () => {
    // A dropdown with one option asks the user to make a decision that does not exist.
    installed = { python: [server('pyright', ['python'])] };
    const element: HTMLElement = await render();

    expect(element.querySelectorAll('.language-server-picker__choice')).toHaveLength(0);
  });

  it('twoImplementations_offersTheChoice', async () => {
    installed = { python: [server('pyright', ['python']), server('ty', ['python'])] };
    selection = { python: 'pyright' };
    const element: HTMLElement = await render();

    const rows: NodeListOf<Element> = element.querySelectorAll('.language-server-picker__choice');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('Python');
  });

  it('twoImplementations_showsTheServerInEffect', async () => {
    installed = { python: [server('pyright', ['python']), server('ty', ['python'])] };
    selection = { python: 'ty' };
    const element: HTMLElement = await render();
    const select: HTMLSelectElement | null = element.querySelector('select');

    expect(select?.value).toBe('ty');
  });

  it('choosing_writesTheSelection', async () => {
    installed = { python: [server('pyright', ['python']), server('ty', ['python'])] };
    selection = { python: 'pyright' };
    const element: HTMLElement = await render();
    const select: HTMLSelectElement = element.querySelector('select')!;
    select.value = 'ty';
    select.dispatchEvent(new Event('change'));

    expect(chosen).toEqual([{ language: 'python', serverId: 'ty' }]);
  });

  it('severalLanguages_eachGetsItsOwnRow', async () => {
    installed = {
      python: [server('pyright', ['python']), server('ty', ['python'])],
      rust: [server('rust', ['rust']), server('other-rust', ['rust'])],
    };
    const element: HTMLElement = await render();

    expect(element.querySelectorAll('.language-server-picker__choice')).toHaveLength(2);
  });
});
