import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Settings } from '@shared/angular/services/settings/settings';
import {
  DEFAULT_FILE_NESTING_RULES,
  FileNestingRule,
} from '@shared/angular/services/workspace/file-nesting';
import { FileNestingRules } from './file-nesting-rules';

describe('FileNestingRules', () => {
  let fixture: ComponentFixture<FileNestingRules>;
  let settings: Settings;

  /**
   * Reads the parent patterns listed.
   * @returns Returns each listed rule's parent pattern.
   */
  function listed(): readonly string[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-testid="nesting-rule-parent"]',
      ),
    ].map((pattern: Element): string => pattern.textContent?.trim() ?? '');
  }

  /**
   * Types into one of the fields.
   * @param testId The field's test id.
   * @param text The text to type.
   */
  async function type(testId: string, text: string): Promise<void> {
    const input: HTMLInputElement | null = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLInputElement>(`[data-testid="${testId}"] input`);
    if (input !== null) {
      input.value = text;
      input.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
  }

  /**
   * Clicks one of the buttons.
   * @param selector The button host's selector.
   */
  async function click(selector: string): Promise<void> {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(selector)?.click();
    await fixture.whenStable();
  }

  beforeEach(async (): Promise<void> => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [FileNestingRules] }).compileComponents();
    settings = TestBed.inject(Settings);
    fixture = TestBed.createComponent(FileNestingRules);
    await fixture.whenStable();
  });

  afterEach((): void => {
    localStorage.clear();
  });

  it('listsTheDefaultRules', (): void => {
    expect(listed()).toEqual(
      DEFAULT_FILE_NESTING_RULES.map((rule: FileNestingRule): string => rule.parent),
    );
  });

  it('add_appendsTheTypedRuleAndClearsTheFields', async (): Promise<void> => {
    await type('nesting-parent', '*.ts');
    await type('nesting-children', '${capture}.spec.ts');

    await click('[data-testid="nesting-add"] button');

    expect(settings.get('workspaces.fileNesting').at(-1)).toEqual({
      parent: '*.ts',
      children: '${capture}.spec.ts',
    });
    expect(listed().at(-1)).toBe('*.ts');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
        '[data-testid="nesting-parent"] input',
      )?.value,
    ).toBe('');
  });

  it('add_replacesTheRuleForAParentAlreadyListed', async (): Promise<void> => {
    await type('nesting-parent', '*.cs');
    await type('nesting-children', '${capture}.Designer.cs');

    await click('[data-testid="nesting-add"] button');

    expect(
      settings
        .get('workspaces.fileNesting')
        .filter((rule: FileNestingRule): boolean => rule.parent === '*.cs'),
    ).toEqual([{ parent: '*.cs', children: '${capture}.Designer.cs' }]);
  });

  it('remove_takesTheRuleOut', async (): Promise<void> => {
    await click('[aria-label="Remove the rule for *.cs"]');

    expect(listed()).not.toContain('*.cs');
  });

  it('restoreDefaults_putsBackTheRulesItStartedWith', async (): Promise<void> => {
    settings.set('workspaces.fileNesting', []);
    await fixture.whenStable();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('nothing nests');

    await click('[data-testid="nesting-restore"] button');

    expect(listed()).toEqual(
      DEFAULT_FILE_NESTING_RULES.map((rule: FileNestingRule): string => rule.parent),
    );
  });
});
