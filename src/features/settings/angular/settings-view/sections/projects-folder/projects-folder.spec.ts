import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NewProject } from '@shared/angular/services/new-project/new-project';
import { ProjectsFolder } from './projects-folder';

describe('ProjectsFolder', () => {
  let fixture: ComponentFixture<ProjectsFolder>;
  let chosen: string | null;

  beforeEach(async () => {
    chosen = '/Users/me/Projects';
    TestBed.configureTestingModule({
      providers: [
        {
          provide: NewProject,
          useValue: {
            defaultFolder: (): Promise<string | null> => Promise.resolve('/Users/me/Development'),
            pickDefaultFolder: (): Promise<string | null> => Promise.resolve(chosen),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(ProjectsFolder);
    await fixture.whenStable();
  });

  /**
   * Reads what the row says.
   * @returns Returns its text.
   */
  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent;
  }

  /**
   * Presses the row's button.
   */
  async function choose(): Promise<void> {
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLElement>('[data-testid="projects-folder-choose"] button')
      ?.click();
    await fixture.whenStable();
  }

  it('namesTheFolder', () => {
    expect(text()).toContain('/Users/me/Development');
  });

  it('showsTheFolderChosen', async () => {
    await choose();

    expect(text()).toContain('/Users/me/Projects');
  });

  it('keepsTheFolder_whenTheDialogIsCancelled', async () => {
    chosen = null;

    await choose();

    expect(text()).toContain('/Users/me/Development');
  });
});
