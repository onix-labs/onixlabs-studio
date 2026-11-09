import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Bridge } from '@shared/api/bridge';
import { PackageChannel, PackageRegistryToken } from '@shared/api/package-channels';
import type { PluginSummary } from '@shared/api/plugin-channels';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { PackageRegistryTokens } from './package-registry-tokens';

/**
 * An installed npm plugin.
 */
const NPM_PLUGIN: PluginSummary = {
  id: 'onixlabs.npm',
  name: 'npm',
  state: 'installed',
  contributions: [{ slot: 'package-manager', id: 'onixlabs.npm', displayName: 'npm', priority: 1 }],
} as unknown as PluginSummary;

describe('PackageRegistryTokens', () => {
  let fixture: ComponentFixture<PackageRegistryTokens>;
  let saved: PackageRegistryToken[];
  let calls: unknown[][];

  /**
   * Lets the bridge's answers land and the view update.
   * @returns Returns a promise that resolves once they have.
   */
  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    saved = [{ pluginId: 'onixlabs.npm', registry: 'https://npm.pkg.github.com' }];
    calls = [];
    const bridge: Bridge = {
      invoke: <T>(channel: string, ...args: unknown[]): Promise<T> => {
        calls.push([channel, ...args]);
        if (channel === (PackageChannel.SaveToken as string)) {
          saved = [...saved, { pluginId: args[0] as string, registry: args[1] as string }];
          return Promise.resolve({ ok: true, tokens: saved } as T);
        }
        if (channel === (PackageChannel.ClearToken as string)) {
          saved = [];
          return Promise.resolve({ ok: true, tokens: saved } as T);
        }
        return Promise.resolve(saved as T);
      },
      send: (): void => undefined,
      on: (): (() => void) => (): void => undefined,
    };
    (window as unknown as { bridge: Bridge }).bridge = bridge;
    await TestBed.configureTestingModule({
      imports: [PackageRegistryTokens],
      providers: [{ provide: Plugins, useValue: { plugins: signal([NPM_PLUGIN]) } }],
    }).compileComponents();
    fixture = TestBed.createComponent(PackageRegistryTokens);
    fixture.detectChanges();
    await settle();
  });

  afterEach(() => {
    delete (window as unknown as { bridge?: unknown }).bridge;
  });

  /**
   * Finds a button by its text.
   * @param text The text.
   * @returns Returns the button.
   */
  function button(text: string): HTMLButtonElement {
    return [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (candidate: HTMLButtonElement): boolean => candidate.textContent?.trim() === text,
    )!;
  }

  it('list_namesEachSavedRegistryAndItsPackageManager', () => {
    const text: string = (fixture.nativeElement as HTMLElement).textContent ?? '';

    expect(text).toContain('https://npm.pkg.github.com');
    expect(text).toContain('Saved for npm');
  });

  it('save_withoutARegistryAndToken_isDisabled', () => {
    expect(button('Save').disabled).toBe(true);
  });

  it('save_sendsThePluginRegistryAndToken_andClearsTheDraft', async () => {
    const component: PackageRegistryTokens = fixture.componentInstance;
    (component as unknown as { draftRegistry: { set(v: string): void } }).draftRegistry.set(
      'https://feed.example.com',
    );
    (component as unknown as { draftToken: { set(v: string): void } }).draftToken.set('secret');
    fixture.detectChanges();

    button('Save').click();
    await settle();

    expect(calls).toContainEqual([
      PackageChannel.SaveToken,
      'onixlabs.npm',
      'https://feed.example.com',
      'secret',
    ]);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(
      'https://feed.example.com',
    );
  });

  it('remove_forgetsTheToken', async () => {
    button('Remove').click();
    await settle();

    expect(calls).toContainEqual([
      PackageChannel.ClearToken,
      'onixlabs.npm',
      'https://npm.pkg.github.com',
    ]);
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain('Saved for npm');
  });
});
