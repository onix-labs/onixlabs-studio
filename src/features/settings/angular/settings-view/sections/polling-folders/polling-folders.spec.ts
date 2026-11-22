import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { Settings } from '@shared/angular/services/settings/settings';
import { PollingFolders } from './polling-folders';

describe('PollingFolders', () => {
  let fixture: ComponentFixture<PollingFolders>;
  let settings: Settings;

  /**
   * Gets the host element.
   * @returns Returns the element.
   */
  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /**
   * Reads the folders listed.
   * @returns Returns each listed folder.
   */
  function listed(): readonly string[] {
    return [...host().querySelectorAll('[data-testid="polling-folder"]')].map(
      (folder: Element): string => folder.textContent?.trim() ?? '',
    );
  }

  /**
   * Types a folder into the field.
   * @param text The text to type.
   */
  async function type(text: string): Promise<void> {
    const input: HTMLInputElement | null = host().querySelector<HTMLInputElement>(
      '[data-testid="polling-draft"] input',
    );
    if (input !== null) {
      input.value = text;
      input.dispatchEvent(new Event('input'));
    }
    await fixture.whenStable();
  }

  /**
   * Clicks a button.
   * @param selector The button host's selector.
   */
  async function click(selector: string): Promise<void> {
    host().querySelector<HTMLElement>(`${selector} button`)?.click();
    await fixture.whenStable();
  }

  beforeEach(async (): Promise<void> => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [PollingFolders] }).compileComponents();
    settings = TestBed.inject(Settings);
    fixture = TestBed.createComponent(PollingFolders);
    await fixture.whenStable();
  });

  afterEach((): void => {
    localStorage.clear();
  });

  it('saysNothingIsPolled_byDefault', () => {
    expect(listed()).toEqual([]);
    expect(host().querySelector('.polling__empty')).not.toBeNull();
  });

  it('addsATypedFolder_withoutItsTrailingSlash', async () => {
    await type('/Volumes/Share/');
    await click('[data-testid="polling-add"]');

    expect(settings.get('workspaces.pollingFolders')).toEqual(['/Volumes/Share']);
    expect(listed()).toEqual(['/Volumes/Share']);
  });

  it('refusesARelativeFolder_orOneAlreadyListed', async () => {
    settings.set('workspaces.pollingFolders', ['/Volumes/Share']);
    await fixture.whenStable();

    await type('share');
    await click('[data-testid="polling-add"]');
    await type('/Volumes/Share/');
    await click('[data-testid="polling-add"]');

    expect(settings.get('workspaces.pollingFolders')).toEqual(['/Volumes/Share']);
  });

  it('addsAFolderChosenInTheDialog', async () => {
    vi.spyOn(TestBed.inject(FileSystem), 'pickPath').mockResolvedValue('/mnt/nfs');

    await click('[data-testid="polling-choose"]');
    await fixture.whenStable();

    expect(settings.get('workspaces.pollingFolders')).toEqual(['/mnt/nfs']);
  });

  it('removesAFolder', async () => {
    settings.set('workspaces.pollingFolders', ['/Volumes/Share', '/mnt/nfs']);
    await fixture.whenStable();

    await click('[data-testid="polling-remove"]');

    expect(settings.get('workspaces.pollingFolders')).toEqual(['/mnt/nfs']);
  });
});
