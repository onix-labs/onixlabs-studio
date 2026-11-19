import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { Icon } from '@shared/angular/icons/icon';
import { Output, OutputChannel } from '@shared/angular/services/output/output';

import { OutputPanel } from './output-panel';

describe('OutputPanel', () => {
  let fixture: ComponentFixture<OutputPanel>;
  let output: Output;

  const panel: DockPanel = {
    id: 'output',
    title: 'Output',
    icon: Icon.OUTPUT,
    role: 'tool',
    component: OutputPanel,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [OutputPanel],
    }).compileComponents();

    output = TestBed.inject(Output);
    fixture = TestBed.createComponent(OutputPanel);
    fixture.componentRef.setInput('panel', panel);
    await fixture.whenStable();
  });

  /**
   * Gets the rendered root.
   * @returns Returns the element.
   */
  function element(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Reads the table's rows as text, one array of cells per row.
   * @returns Returns the cells.
   */
  function cells(): string[][] {
    return [...element().querySelectorAll<HTMLElement>('.table-row')].map(
      (row: HTMLElement): string[] =>
        [...row.querySelectorAll('td')].map(
          (cell: Element): string => cell.textContent?.trim() ?? '',
        ),
    );
  }

  /**
   * Chooses from one of the toolbar's dropdowns.
   * @param testId The dropdown's test id.
   * @param value The value to choose.
   * @returns Resolves once rendered.
   */
  async function choose(testId: string, value: string): Promise<void> {
    const select: HTMLSelectElement | null = element().querySelector(
      `[data-testid="${testId}"] select`,
    );
    if (select !== null) {
      select.value = value;
      select.dispatchEvent(new Event('change'));
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('listsTheChannelsLines_asATableOfTimeLevelAndMessage', async () => {
    output.channel('lsp:ts', 'LSP: ts').appendLine('Using TypeScript 6.0.3', 'info');
    output.channel('lsp:ts', 'LSP: ts').appendLine('Project load failed', 'error');
    output.setActive('lsp:ts');
    fixture.detectChanges();
    await fixture.whenStable();

    const rows: string[][] = cells();
    expect(rows.map((row: string[]): string[] => row.slice(1))).toEqual([
      ['INFO', 'Using TypeScript 6.0.3'],
      ['ERROR', 'Project load failed'],
    ]);
    expect(rows[0][0]).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(element().querySelectorAll('app-chip')).toHaveLength(2);
  });

  it('allChannels_addsASourceColumn', async () => {
    output.channel('lsp:ts', 'LSP: ts').appendLine('one');
    output.channel('debug', 'Debug').appendLine('two', 'warning');

    await choose('logs-channel', '*');

    expect(cells().map((row: string[]): string[] => row.slice(1))).toEqual([
      ['INFO', 'LSP: ts', 'one'],
      ['WARNING', 'Debug', 'two'],
    ]);
  });

  it('filtersByLevel_andByText', async () => {
    const channel: OutputChannel = output.channel('build', 'Build');
    channel.appendLine('compiling', 'debug');
    channel.appendLine('unused variable', 'warning');
    channel.appendLine('missing semicolon', 'error');
    output.setActive('build');

    await choose('logs-level', 'warning');
    expect(cells().map((row: string[]): string => row[2])).toEqual([
      'unused variable',
      'missing semicolon',
    ]);

    const search: HTMLInputElement | null = element().querySelector('.logs__search input');
    if (search !== null) {
      search.value = 'semicolon';
      search.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();
    await fixture.whenStable();
    expect(cells().map((row: string[]): string => row[2])).toEqual(['missing semicolon']);
  });

  it('clear_emptiesTheChannelShown', async () => {
    output.channel('build', 'Build').appendLine('x');
    output.setActive('build');
    fixture.detectChanges();
    await fixture.whenStable();

    element().querySelector<HTMLButtonElement>('button[aria-label="Clear output"]')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(output.entriesOf('build')).toEqual([]);
    expect(element().textContent).toContain('Nothing has been logged here yet.');
  });
});
