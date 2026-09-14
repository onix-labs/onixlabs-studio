import { compareStudioVersions } from './studio-version';

/**
 * Describes what one release brought, in the terms a user cares about.
 *
 * This is deliberately curated rather than derived. `docs/releases/*.md` exists and is generated per
 * release, but it is a commit table written for developers — and `docs/` is not in electron-builder's
 * `files` list, so in a packaged build it does not exist at all. Neither problem is worth solving by
 * shipping the changelog: a user upgrading wants four sentences about what is different for them, not
 * fifty rows of commit subjects.
 *
 * Cutting a release therefore means adding an entry here, and a release with no entry simply reports
 * nothing — the wizard says so rather than inventing a summary.
 */
export interface ReleaseHighlights {
  /**
   * Gets the version these highlights describe, exactly as published.
   */
  readonly version: string;

  /**
   * Gets the headlines, most significant first. A handful at most: this is read by someone who wants
   * to get on with their work.
   */
  readonly headlines: readonly ReleaseHeadline[];
}

/**
 * One thing a release changed: what it is, and why it matters.
 */
export interface ReleaseHeadline {
  /**
   * Gets the short title of the change.
   */
  readonly title: string;

  /**
   * Gets the sentence explaining what it means for the user.
   */
  readonly detail: string;
}

/**
 * Holds the curated highlights per release, oldest first.
 */
export const RELEASE_HIGHLIGHTS: readonly ReleaseHighlights[] = [
  {
    version: '2026.1.0-beta.4',
    headlines: [
      {
        title: 'Container engines are plugins now',
        detail:
          'Studio ships with no engine of its own and talks to whichever one you actually run — ' +
          'Docker, Podman, Colima or another. It no longer launches Docker Desktop behind your back, ' +
          'and it says plainly when nothing is installed.',
      },
      {
        title: 'Disassembly and bytecode listings',
        detail:
          'The binary editor and generated-code panel read .NET IL, native, JVM and WebAssembly, ' +
          'each delivered as a plugin you install when you need it.',
      },
      {
        title: 'One graphics setting instead of three',
        detail:
          'Hardware acceleration, modern effects and the workspace texture collapsed into a single ' +
          'Graphics Acceleration level that resolves itself from your GPU.',
      },
      {
        title: 'A Stop button that always lands',
        detail:
          'The agent panel gained per-conversation task controls, and stopping a run now works even ' +
          'for a turn Studio adopted rather than started.',
      },
    ],
  },
  {
    version: '2026.1.0-beta.5',
    headlines: [
      {
        title: 'Every AI provider is a plugin',
        detail:
          'Claude, Codex and the AI SDK each run out of process as a plugin you install from the ' +
          'Plugin Manager; Studio ships with none built in, and a configuration names the plugin ' +
          'that runs it.',
      },
      {
        title: 'A setup wizard on first launch and after an upgrade',
        detail:
          'It walks what is installed — languages, AI providers, engines — one step per category, ' +
          'and shows what changed since the version you last ran.',
      },
      {
        title: 'A workspace agent that can act like the Explorer',
        detail:
          'The agent docked in a workspace can open files and diffs, read source control, drive ' +
          'the terminal panel, and create, rename or delete entries in the tree. Standing prompt ' +
          'profiles and a skill library scope instructions by surface and language.',
      },
      {
        title: 'Background tasks report back, and Stop always lands',
        detail:
          'A task that finishes while the conversation is idle is now reported with the agent’s ' +
          'own follow-up; stopping one settles it within a second, and a task Studio can no longer ' +
          'reach is untracked with a note rather than listed forever.',
      },
      {
        title: 'Markdown editing in the well',
        detail:
          'A formatting toolstrip, open-in-tab, selectable dividers, stable GitHub alerts and ' +
          'sub/superscript, and mermaid 12 with its new layout engine. Previous messages recall on ' +
          'Alt+Up/Down (Option on macOS), giving Shift+Up/Down back to selecting text.',
      },
    ],
  },
];

/**
 * Returns the highlights for every release the user is moving across, oldest first.
 *
 * Someone who skips versions — beta.3 straight to the stable release — is owed everything they missed,
 * not just the last hop, because from where they are standing it all arrived at once. A first run
 * (no previous version) reports nothing: there is no "what changed" for someone who has not run it
 * before.
 * @param from The version last set up, or null on a first run.
 * @param to The version now running.
 * @returns Returns the highlights to show, oldest release first.
 */
export function highlightsBetween(from: string | null, to: string): readonly ReleaseHighlights[] {
  if (from === null) {
    return [];
  }
  return RELEASE_HIGHLIGHTS.filter(
    (release: ReleaseHighlights): boolean =>
      compareStudioVersions(release.version, from) > 0 &&
      compareStudioVersions(release.version, to) <= 0,
  );
}
