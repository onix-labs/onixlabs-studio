import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Clone } from '@shared/angular/services/clone/clone';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CloneFolder } from './clone-folder';

describe('CloneFolder', () => {
  let fixture: ComponentFixture<CloneFolder>;
  let cloner: {
    isAvailable: boolean;
    parent: ReturnType<typeof vi.fn>;
    pickParent: ReturnType<typeof vi.fn>;
  };

  /**
   * Reads the row's text, once it has caught up.
   * @returns Returns its text.
   */
  function description(): string {
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  beforeEach(async () => {
    cloner = {
      isAvailable: true,
      parent: vi.fn().mockResolvedValue('/Users/me/Code'),
      pickParent: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: Clone, useValue: cloner }] });
    fixture = TestBed.createComponent(CloneFolder);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('showsTheRememberedFolder', () => {
    expect(description()).toContain('/Users/me/Code');
  });

  it('choosesANewFolder_andKeepsTheOldOneWhenCancelled', async () => {
    const button: HTMLButtonElement = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="clone-folder-choose"] button',
    )!;

    cloner.pickParent.mockResolvedValue(null);
    button.click();
    await fixture.whenStable();
    expect(description()).toContain('/Users/me/Code');

    cloner.pickParent.mockResolvedValue('/Users/me/Elsewhere');
    button.click();
    await fixture.whenStable();
    expect(description()).toContain('/Users/me/Elsewhere');
  });
});
