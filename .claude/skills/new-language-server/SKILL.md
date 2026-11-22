---
name: new-language-server
description: Add a language server to ONIXLabs Studio end to end — descriptor, probe, settings, client-command wiring, specs, live check and capability-matrix row. Use when asked to add, support or improve a language (F#, OCaml, Zig, …) or a language server, or to close a gap in a server's parity epic.
---

# Adding a language server to Studio

Follow `docs/language-servers/adding-a-server.md` (also on the wiki as
[Language Servers — Adding a server](https://github.com/onix-labs/onixlabs-studio/wiki/Language-Servers-Adding-a-Server));
it's the reference. This skill is the checklist. Do the steps in order, and don't skip the probe.

## Before you start

- Read the server's epic or issue, and `docs/language-servers/capability-matrix.md`.
  - No issue for the server or the language? Don't stop for one, and don't open one yourself. Work from the request, link the issue that asked for the work (or none), and say at the top of the PR that no server issue exists, so Matthew can decide whether to open one.
- Work on a branch from `origin/main`: one PR per issue, with a commit per area.
- ⛔ Never probe or test against the user's own repositories. Fixtures go under `.cache/`, and the profile is a scratch one under `.cache/`.
- Default to the sandbox. Set `GOCACHE`, `UV_CACHE_DIR` and the like under `$TMPDIR` rather than disabling it.

## Checklist

1. **Descriptor.**
   - Prefer a curated manifest entry in `src/shared/electron/contributions/plugins/curated-plugins.json` (archive or npm provision; `executable`, `node` or `python` command).
   - Use a code-first descriptor in `src/shared/electron/lsp/language-server-catalogue.ts` only for a computation (build, per-workspace data, a derived `postInitialize`).
   - The `id` names the implementation, not the language.
   - Add any new file extension to `src/shared/angular/services/monaco/monaco-languages.ts`.
   - Bump the index `revision`. Keep `apiVersion` low. Leave other entries' layout byte for byte.
2. **Install into a scratch profile** as the provisioner does: verified download, or `npm ci --ignore-scripts` from the pinned lockfile, then the `.studio-install-complete` marker.
3. **Fixture** under `.cache/<lang>-fixture`, with `@probe` markers: two modules referencing each other, an interface and an implementation, a test, a deliberate error.
4. **Probe twice:**
   - `node scripts/probe-lsp.mjs --server <id> --workspace <fixture> --profile <scratch>`;
   - then the same with `--settings '<json>'` / `--init-options '<json>'` for the settings you mean to declare.
   - Give `--file` an absolute path: it's read from the current folder, not the workspace.
   - A server that can't start in the macOS sandbox (taplo reads the system proxy settings) needs Matthew's go-ahead to probe unsandboxed. Run only the server and its probe that way.
5. **Read the report:** what's offered; which sections it asks for, and when; the client commands it sends; the requests it sends the client; anything that throws on a `null` answer.
6. **Declare settings** on the descriptor, choosing pull, push, startup (`startupOnly`, "restarts" in the description) or arguments.
   - Use the server's own defaults unless a feature is otherwise unreachable; say so in the PR.
   - Labels are Title Case.
   - A server that never asks gets `pull: false`.
   - A lens switch goes in `CODE_LENS_SERVER_SWITCHES` (`src/shared/angular/services/lsp/code-lens-kinds.ts`), not on the server's page.
7. **Wire what isn't generic:**
   - client commands in `src/shared/angular/services/lsp/lsp-features.ts` (`lensCommand`, code actions) and `codeLensKind`;
   - experimental client capabilities in `src/shared/electron/lsp/lsp-client-capabilities.ts`;
   - custom requests only where advertised.
8. **Specs.** Build from the real curated entry. Assert the answered, pushed and start-up shapes, and which settings restart the server. Run single specs only: `npx ng test --watch=false --include <file>`.
9. **Live check** in a second instance on a scratch profile, against the fixture, feature by feature.
10. **Matrix.** Name the report in `docs/language-servers/capability-wiring.json`, add the checked features under `verified`, and run `node scripts/probe-lsp.mjs --matrix --docs`. This is the only place the row is added: after the live check, never straight after probing (the guide's §2 points here). The run rewrites `capability-matrix.md` whole, so restore any hand-written note it drops.
11. **Gate and PR:**
    - `npm run format:check` and lint, then push, then a **draft** PR.
    - The title matches the conventional regex, with a lower-case subject.
    - Write "Part of #N", never a closing keyword.
    - Put "Decision taken on Matthew's behalf" at the top for anything chosen.
    - List "Release owed" (an index revision is a shipping decision).
    - Watch CI in the background until it's green.

## Gotchas

- Never `didOpen` twice (Roslyn aborts).
- Edit the document in the live check, then check again: a server that goes dark after the first keystroke has lost the text (full-sync servers needed the whole text, #1206).
- Null can mean "unchanged" (Roslyn), or crash the server (CSS; JSON and Svelte on `{ settings: null }`).
- Features hide behind settings and init options: `provideFormatter`, `yaml.format.enable`, gopls `semanticTokens`, `Lua.hint.enable`.
- ty ignores changes, so its settings are `startupOnly`.
- `$/progress` needs `onUnhandledProgress`.
- Workspace diagnostics are long-held.
- Catch a late window up.
- Snippet edits need `adjustWhitespace: false`.
- Re-sync breakpoints after attaching a debugger.
- Answer `workspace/workspaceFolders`.
- `window/showDocument` opens only web pages and files.
