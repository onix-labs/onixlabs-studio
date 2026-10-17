import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DetectedRepository } from '@shared/api/source-control-channels';
import { VersionControlPrompt } from '@shared/angular/services/plugins/version-control-prompt';
import { VersionControlMissing } from './version-control-missing';

describe('VersionControlMissing', () => {
  let needed: WritableSignal<DetectedRepository | null>;
  let installs: number;
  let fixture: ComponentFixture<VersionControlMissing>;

  beforeEach(() => {
    needed = signal<DetectedRepository | null>(null);
    installs = 0;
    TestBed.configureTestingModule({
      imports: [VersionControlMissing],
      providers: [
        {
          provide: VersionControlPrompt,
          useValue: {
            needed,
            install: (): Promise<void> => {
              installs += 1;
              return Promise.resolve();
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(VersionControlMissing);
    fixture.detectChanges();
  });

  it('rendersNothing_whenNoRepositoryNeedsAPlugin', () => {
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('namesTheRepositoryAndInstallsItsPlugin', () => {
    needed.set({ pluginId: 'onixlabs.git', displayName: 'Git', installed: false });
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain('This folder is a Git repository');
    element.querySelector<HTMLButtonElement>('app-button button')!.click();
    expect(installs).toBe(1);
  });
});
