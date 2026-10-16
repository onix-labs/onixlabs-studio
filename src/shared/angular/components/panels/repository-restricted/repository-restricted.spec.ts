import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WorkspaceGit } from '@features/workspace/angular/workspace-git/workspace-git';
import { RepositoryRestricted } from './repository-restricted';

describe('RepositoryRestricted', () => {
  let restricted: WritableSignal<boolean>;
  let trusts: number;
  let fixture: ComponentFixture<RepositoryRestricted>;

  beforeEach(() => {
    restricted = signal<boolean>(false);
    trusts = 0;
    TestBed.configureTestingModule({
      imports: [RepositoryRestricted],
      providers: [
        {
          provide: WorkspaceGit,
          useValue: {
            isRestricted: restricted,
            trustRepository: (): Promise<void> => {
              trusts += 1;
              return Promise.resolve();
            },
          },
        },
      ],
    });
    fixture = TestBed.createComponent(RepositoryRestricted);
    fixture.detectChanges();
  });

  it('rendersNothing_whenTheRepositoryIsTrustedOrAbsent', () => {
    expect((fixture.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });

  it('saysTheRepositoryIsNotTrusted_andTrustsItOnRequest', () => {
    restricted.set(true);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(element.textContent).toContain("This repository isn't trusted");
    element.querySelector<HTMLButtonElement>('app-button button')!.click();
    expect(trusts).toBe(1);
  });

  it('rendersNothing_outsideAWorkspaceTab', () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [RepositoryRestricted] });
    const alone: ComponentFixture<RepositoryRestricted> =
      TestBed.createComponent(RepositoryRestricted);
    alone.detectChanges();

    expect((alone.nativeElement as HTMLElement).textContent?.trim()).toBe('');
  });
});
