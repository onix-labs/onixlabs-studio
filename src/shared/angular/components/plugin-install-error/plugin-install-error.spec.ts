import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Log } from '@shared/angular/services/log/log';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { PluginInstallError } from './plugin-install-error';

describe('PluginInstallError', () => {
  let fixture: ComponentFixture<PluginInstallError>;
  let host: HTMLElement;
  let error: WritableSignal<string | null>;
  let failedInstall: WritableSignal<string | null>;
  let install: ReturnType<typeof vi.fn>;
  let openFolder: ReturnType<typeof vi.fn>;

  /**
   * Renders the component and settles it.
   * @returns Returns a promise that resolves once the view has settled.
   */
  async function render(): Promise<void> {
    fixture = TestBed.createComponent(PluginInstallError);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    await fixture.whenStable();
  }

  /**
   * Finds a button by its test id.
   * @param id The test id.
   * @returns Returns the button, or null.
   */
  function button(id: string): HTMLButtonElement | null {
    return host.querySelector<HTMLButtonElement>(`[data-testid="${id}"] button`);
  }

  beforeEach(async () => {
    error = signal<string | null>(null);
    failedInstall = signal<string | null>(null);
    install = vi.fn().mockResolvedValue(undefined);
    openFolder = vi.fn().mockResolvedValue(undefined);
    await TestBed.configureTestingModule({
      imports: [PluginInstallError],
      providers: [
        {
          provide: Plugins,
          useValue: { error, failedInstall, busy: signal<boolean>(false), install },
        },
        { provide: Log, useValue: { openFolder } },
      ],
    }).compileComponents();
  });

  it('render_withNoError_rendersNothing', async () => {
    await render();

    expect(host.querySelector('.install-error')).toBeNull();
  });

  it('render_whenAnInstallFailed_saysWhy_andOffersToTryAgain', async () => {
    error.set('Git could not be installed: Studio could not reach the download server.');
    failedInstall.set('onixlabs.git');
    await render();

    expect(host.querySelector('.install-error__message')?.textContent).toContain(
      'could not reach the download server',
    );
    button('plugin-install-retry')!.click();

    expect(install).toHaveBeenCalledWith('onixlabs.git');
  });

  it('render_whenAnotherActionFailed_offersNoRetry', async () => {
    error.set('Git could not be removed.');
    await render();

    expect(button('plugin-install-retry')).toBeNull();
    expect(button('plugin-install-log')).not.toBeNull();
  });

  it('openLog_opensTheLogFolder', async () => {
    error.set('Git could not be installed.');
    await render();

    button('plugin-install-log')!.click();

    expect(openFolder).toHaveBeenCalled();
  });
});
