import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Sideloading } from '@shared/angular/services/plugins/sideloading';
import { vi } from 'vitest';
import { PluginsFolder } from './plugins-folder';

describe('PluginsFolder', () => {
  let fixture: ComponentFixture<PluginsFolder>;
  const openFolder: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(undefined);

  beforeEach(async () => {
    openFolder.mockClear();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Sideloading,
          useValue: { directory: signal('/Users/me/Library/Studio/plugins'), openFolder },
        },
      ],
    });
    fixture = TestBed.createComponent(PluginsFolder);
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it('namesTheFolder_andOpensIt', () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('/Users/me/Library/Studio/plugins');

    host.querySelector<HTMLButtonElement>('[data-testid="plugins-folder-open"] button')?.click();

    expect(openFolder).toHaveBeenCalledOnce();
  });
});
