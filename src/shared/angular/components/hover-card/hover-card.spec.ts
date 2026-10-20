import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  HoverCardContent,
  HoverProblem,
  MARKER_SEVERITY,
} from '@shared/angular/services/hover/hover-content';
import { Shell } from '@shared/angular/services/shell/shell';
import { HoverCard } from './hover-card';

/**
 * A problem on the hovered spot.
 */
const PROBLEM: HoverProblem = {
  message: "Cannot find name 'greting'.",
  severity: MARKER_SEVERITY.error,
  source: 'ts',
  code: '2304',
  range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 8 },
};

/**
 * A card's content: a signature, documentation with a link, a problem and both actions.
 */
const CONTENT: HoverCardContent = {
  sections: [
    '```typescript\nconst greeting: string\n```',
    'Says hello. See [the docs](https://example.com/docs) or [run](command:editor.action.x).',
  ],
  problems: [PROBLEM, { ...PROBLEM, severity: MARKER_SEVERITY.warning, source: null, code: null }],
  quickFix: true,
  actions: { definition: true, references: true, referencesListed: true },
};

describe('HoverCard (#1020)', () => {
  let fixture: ComponentFixture<HoverCard>;
  let opened: string[];

  /**
   * Renders the card with some content.
   * @param content The content.
   * @returns Returns the card's element.
   */
  async function render(content: HoverCardContent): Promise<HTMLElement> {
    fixture.componentRef.setInput('content', content);
    await fixture.whenStable();
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Finds a button of the card by its label.
   * @param element The card's element.
   * @param label The label.
   * @returns Returns the button, or undefined.
   */
  function button(element: HTMLElement, label: string): HTMLButtonElement | undefined {
    return [...element.querySelectorAll('button')].find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === label,
    );
  }

  beforeEach(async () => {
    opened = [];
    await TestBed.configureTestingModule({
      imports: [HoverCard],
      providers: [
        {
          provide: Shell,
          useValue: {
            openExternal: (url: string): Promise<void> => {
              opened.push(url);
              return Promise.resolve();
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HoverCard);
  });

  it('showsTheTypeAndDocs_asMarkdown_withTheSnippetBare_noCopyOrRunFooter', async () => {
    const element: HTMLElement = await render(CONTENT);

    const sections: NodeListOf<HTMLElement> = element.querySelectorAll('.hover-card__section');
    expect(sections).toHaveLength(2);
    expect(sections[0].querySelector('.code-block--bare code')?.textContent).toContain(
      'const greeting: string',
    );
    expect(element.querySelector('.code-block__footer')).toBeNull();
    expect(sections[1].querySelector('a')?.textContent).toBe('the docs');
  });

  it('listsEachProblem_withItsSeverityDetailAndLinks', async () => {
    const element: HTMLElement = await render(CONTENT);

    const problems: NodeListOf<HTMLElement> = element.querySelectorAll('.hover-card__problem');
    expect(problems).toHaveLength(2);
    expect(problems[0].querySelector('.hover-card__message')?.textContent).toBe(
      "Cannot find name 'greting'.",
    );
    expect(problems[0].querySelector('.hover-card__detail')?.textContent).toBe('ts(2304)');
    expect(problems[1].querySelector('.hover-card__detail')).toBeNull();
    expect(problems[0].querySelector('.ph-x-circle')).not.toBeNull();
    expect(problems[1].querySelector('.ph-warning')).not.toBeNull();
    expect(element.querySelectorAll('.hover-card__links app-button')).toHaveLength(4);
  });

  it('eachChoice_isRaised', async () => {
    const element: HTMLElement = await render(CONTENT);
    const raised: string[] = [];
    fixture.componentInstance.quickFix.subscribe(
      (problem: HoverProblem): void => void raised.push(`fix ${problem.message}`),
    );
    fixture.componentInstance.goToProblem.subscribe(
      (problem: HoverProblem): void => void raised.push(`go ${problem.severity}`),
    );
    fixture.componentInstance.goToDefinition.subscribe((): void => void raised.push('definition'));
    fixture.componentInstance.findReferences.subscribe((): void => void raised.push('references'));
    fixture.componentInstance.dismissed.subscribe((): void => void raised.push('dismissed'));

    button(element, 'Quick Fix…')?.click();
    button(element, 'Go to Problem')?.click();
    button(element, 'Go to Definition')?.click();
    button(element, 'Find All References')?.click();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(raised).toEqual([
      "fix Cannot find name 'greting'.",
      `go ${MARKER_SEVERITY.error}`,
      'definition',
      'references',
      'dismissed',
    ]);
  });

  it('aWebLink_opensInTheBrowser_andNoLinkNavigatesTheWindow', async () => {
    const element: HTMLElement = await render(CONTENT);
    const links: NodeListOf<HTMLAnchorElement> = element.querySelectorAll('a');
    const web: MouseEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    const command: MouseEvent = new MouseEvent('click', { bubbles: true, cancelable: true });

    links[0].dispatchEvent(web);
    links[1].dispatchEvent(command);

    expect(web.defaultPrevented).toBe(true);
    expect(command.defaultPrevented).toBe(true);
    expect(opened).toEqual(['https://example.com/docs']);
  });

  it('withoutFixesOrASymbol_showsNoQuickFixAndNoActionsRow', async () => {
    const element: HTMLElement = await render({
      sections: ['Breakpoint'],
      problems: [PROBLEM],
      quickFix: false,
      actions: null,
    });

    expect(button(element, 'Quick Fix…')).toBeUndefined();
    expect(button(element, 'Go to Problem')).toBeDefined();
    expect(element.querySelector('.hover-card__actions')).toBeNull();
  });

  it('anActionTheLanguageCannotAnswer_isLeftOut', async () => {
    const element: HTMLElement = await render({
      ...CONTENT,
      actions: { definition: false, references: true, referencesListed: false },
    });

    expect(button(element, 'Go to Definition')).toBeUndefined();
    expect(button(element, 'Find All References')?.disabled).toBe(true);
  });
});
