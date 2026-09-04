import {
  computed,
  DOCUMENT,
  effect,
  inject,
  Service,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { AppChannel } from '@shared/api/app-channels';
import type { Bridge } from '@shared/api/bridge';
import type { DisplayStartup, GraphicsAcceleration } from '@shared/api/host';
import {
  renderGraphicsAcceleration,
  ResolvedGraphicsAcceleration,
  resolveGraphicsAcceleration,
  startupGraphicsAcceleration,
  wantsHardwareAcceleration,
} from './display-policy';

/**
 * Represents the owner of the graphics-acceleration policy: one ladder — off, limited, full, or the
 * automatic mode that picks between the upper two from the GPU the main process detected — replacing
 * what were three settings that only ever made sense in combination.
 *
 * It resolves the user's choice and applies the result to the document root by an effect. Below
 * `full`, the `data-corners='round'` and `data-reduced-gpu` attributes the SCSS switches on are set,
 * falling the UI back to plain rounded corners and reduced decorative effects; at `full` they are
 * removed. The workspace texture is gated on the same resolved level (see `DockContainer`).
 *
 * Only the `off` rung needs a relaunch, because hardware acceleration can only be toggled before the
 * app is ready. The rest apply immediately, so moving between `limited` and `full` is instant and
 * only the escape hatch costs a restart.
 *
 * Outside Electron (where `window.host`/`window.bridge` are undefined) the level resolves to `full`
 * and hardware acceleration reports enabled, so the browser-served build behaves as before.
 */
@Service()
export class Display {
  /**
   * Holds the document the display policy is applied to.
   */
  private readonly document: Document = inject(DOCUMENT);

  /**
   * Holds the display startup snapshot from the static host object, or undefined outside Electron.
   */
  private readonly startup: DisplayStartup | undefined = window.host?.display;

  /**
   * Holds the generic transport used to persist the level and relaunch, or undefined outside
   * Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Gets whether the bridge is available (true when running inside Electron). The level can only be
   * changed when it is, since it is persisted by the main process.
   */
  public readonly isAvailable: boolean = this.bridge !== undefined;

  /**
   * Holds whether the active GPU is flagged as likely to render the heavier effects poorly. Used to
   * resolve the automatic mode and to label the recommendation in the settings hint.
   */
  public readonly recommendReducedEffects: boolean =
    this.startup?.gpuRendering.recommendReducedEffects ?? false;

  /**
   * Holds a human-readable description of the active GPU for the settings hint, or an empty string
   * when it could not be identified.
   */
  public readonly gpuDescription: string = this.startup?.gpuRendering.description ?? '';

  /**
   * Holds whether hardware acceleration was actually applied for this launch, which the restart
   * prompt compares against. Not derived from the level: the `STUDIO_DISABLE_GPU` diagnostic can
   * force it off, and a restart prompt should reflect the running process rather than the file.
   */
  private readonly launchedWithHardwareAcceleration: boolean =
    this.startup?.hardwareAccelerationEnabled ?? true;

  /**
   * Holds the chosen graphics-acceleration level, seeded from the persisted preference (migrating the
   * pre-merge settings when there is none).
   */
  private readonly levelSignal: WritableSignal<GraphicsAcceleration> = signal<GraphicsAcceleration>(
    startupGraphicsAcceleration(this.startup),
  );

  /**
   * Gets the chosen graphics-acceleration level, as chosen — `auto` reads as `auto`. The settings
   * dropdown binds to this; everything that renders binds to {@link resolvedGraphicsAcceleration}.
   */
  public readonly graphicsAcceleration: Signal<GraphicsAcceleration> =
    this.levelSignal.asReadonly();

  /**
   * Gets the graphics-acceleration level actually in force: the automatic mode resolved against the
   * detected GPU, then clamped to what this launch can afford. This is the level the UI is drawn at,
   * and what a setting qualified on a level is qualified against.
   */
  public readonly resolvedGraphicsAcceleration: Signal<ResolvedGraphicsAcceleration> = computed(
    (): ResolvedGraphicsAcceleration =>
      renderGraphicsAcceleration(
        this.levelSignal(),
        this.recommendReducedEffects,
        this.launchedWithHardwareAcceleration,
      ),
  );

  /**
   * Gets the level the automatic mode resolves to on this system, for the settings hint.
   */
  public readonly recommendedGraphicsAcceleration: ResolvedGraphicsAcceleration =
    resolveGraphicsAcceleration('auto', this.recommendReducedEffects);

  /**
   * Gets whether a change is awaiting a relaunch: the chosen level wants hardware acceleration in a
   * state this process was not launched in. Moving between the accelerated rungs never sets it.
   */
  public readonly restartRequired: Signal<boolean> = computed(
    (): boolean =>
      wantsHardwareAcceleration(this.levelSignal()) !== this.launchedWithHardwareAcceleration,
  );

  /**
   * Applies the resolved display policy to the document root whenever the level changes, and
   * persists the migrated level on first construction so the main process can act on it at the next
   * launch (a no-op once one has been persisted).
   */
  public constructor() {
    if (this.startup?.graphicsAcceleration == null) {
      this.persist(this.levelSignal());
    }

    effect((): void => {
      this.applyDisplayPolicy(this.resolvedGraphicsAcceleration());
    });
  }

  /**
   * Sets the graphics-acceleration level, applying it immediately and persisting it for the next
   * launch. Moving on or off the `off` rung additionally flags a relaunch, which is what
   * {@link restartRequired} reports.
   * @param level The graphics-acceleration level to apply.
   */
  public setGraphicsAcceleration(level: GraphicsAcceleration): void {
    this.levelSignal.set(level);
    this.persist(level);
  }

  /**
   * Relaunches the application so a pending hardware-acceleration change can take effect.
   */
  public relaunch(): void {
    this.bridge?.send(AppChannel.Relaunch);
  }

  /**
   * Persists a level through the main process. A no-op outside Electron, where there is nowhere to
   * persist it to.
   * @param level The level to persist.
   */
  private persist(level: GraphicsAcceleration): void {
    void this.bridge?.invoke(AppChannel.SetGraphicsAcceleration, level);
  }

  /**
   * Toggles the document attributes the SCSS uses to fall back to plain rounded corners and reduced
   * decorative effects, from the resolved level.
   *
   * Anything below `full` reduces, and both lower rungs reduce for the same reason: the modern
   * features are the most expensive thing on screen to draw. Squircle corner masks resolve to
   * `corner-shape: squircle` on 100+ declarations and the decorative effects are large blurs — which
   * is a poor trade on a GPU that renders them badly (`limited`), and an outright waste of a CPU core
   * when there is no GPU in the path at all (`off`).
   * @param level The resolved graphics-acceleration level to apply.
   */
  private applyDisplayPolicy(level: ResolvedGraphicsAcceleration): void {
    const root: HTMLElement = this.document.documentElement;

    if (level === 'full') {
      root.removeAttribute('data-corners');
      root.removeAttribute('data-reduced-gpu');
    } else {
      root.setAttribute('data-corners', 'round');
      root.setAttribute('data-reduced-gpu', 'true');
    }
  }
}
