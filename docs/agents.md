# ONIXLabs Studio — Agent Guide

**The documentation lives on the wiki: <https://github.com/onix-labs/onixlabs-studio/wiki>.** This
file holds only the rules that must be read before touching the code, and tells you where the rest is.

## Read the wiki before you work

Fetch pages as raw markdown from
`https://raw.githubusercontent.com/wiki/onix-labs/onixlabs-studio/<Page>.md`, or clone it:

```bash
git clone https://github.com/onix-labs/onixlabs-studio.wiki.git
```

| Page                                                                                                           | When you need it                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Architecture](https://github.com/onix-labs/onixlabs-studio/wiki/Architecture)                                 | Before adding or moving anything — feature-first layout, kitchen vs recipe, the assembler          |
| [Runtime seams](https://github.com/onix-labs/onixlabs-studio/wiki/Runtime-Seams)                               | Before touching a feature, the dock, IPC, keybindings, project systems, debugging, windows, modals |
| [Conventions](https://github.com/onix-labs/onixlabs-studio/wiki/Conventions)                                   | Before writing code — types, TSDoc, Angular, Electron, testing, control atoms                      |
| [Build, test and tooling](https://github.com/onix-labs/onixlabs-studio/wiki/Build-Test-and-Tooling)            | Commands, the green gate, toolchain gotchas, the relocation recipe, the pre-PR checklist           |
| [Agent access and permissions](https://github.com/onix-labs/onixlabs-studio/wiki/Agent-Access-and-Permissions) | Before touching `src/shared/electron/ai` or the agent surfaces                                     |
| [Contributing](https://github.com/onix-labs/onixlabs-studio/wiki/Contributing)                                 | How a change reaches `main`; PR titles and labels; the plugin-API bump policy                      |
| [Decisions](https://github.com/onix-labs/onixlabs-studio/wiki/Decisions)                                       | Why things are the way they are — read before proposing to change one                              |

## The non-negotiables

These are enforced — by ESLint, by specs, by CI, or by review — and a change that breaks one is
rejected whatever else it does.

1. **No feature code lands in `shared`.** `shared/{angular,api,electron}` never names or imports a
   feature; `shared/app` — the composition root — is the sole exception.
2. **Features are isolated like plugins.** A feature imports only `@shared/*` and its own
   `@features/<self>/*`, never a sibling feature (ESLint bans it). Removing a feature's folder removes
   the feature; the only permitted straggler is one line in `src/shared/app/config.ts`. The fix for a
   cross-feature need is always to promote the shared surface to `@shared`.
3. **The renderer is untrusted.** `contextIsolation` and `sandbox` on, `nodeIntegration` off; the
   only bridge is the generic `window.bridge` (`invoke`/`send`/`on`) plus `window.host`; every IPC
   payload is validated in main.
4. **Agent write confinement is a hard boundary.** A granted file write outside the workspace root is
   refused regardless of the permission prompt; widening it is configuration, never a per-action
   override.
5. **No feature binds ⌘Z, ⌘⇧Z, ⌘X, ⌘C, ⌘V or ⌘A.** The core menu carries them once as native roles;
   a feature wanting clipboard or history puts it on a ribbon button. A source-scan spec enforces this.
6. **Feature templates use the control atoms**, never a raw `<button>`, `<input>`, `<select>`,
   `<textarea>`, checkbox or radio. The welcome screen is the one sanctioned exception.
7. **The plugin manifest contract moves with `PLUGIN_API_VERSION`.** Change
   `src/shared/api/plugin-manifest.ts` and bump the version in the same change; a fingerprint spec
   fails otherwise.
8. **TypeScript is strict and documented.** Explicit access modifiers; every member, parameter,
   return and local typed; no `any`; genuine TSDoc on every member including private ones; comments
   say _why_.
9. **The green gate is green after every commit** — `format:check`, `lint`, `test:coverage`, `build`,
   `build:electron`. No tolerated baseline; coverage thresholds only go up. If a step cannot stay
   green the change is too big — split it.
10. **Everything reaches `main` through a pull request**, titled `type(scope): subject`, merged by an
    admin. Nothing is pushed to `main` or `release` directly.

## If you drive the Bash tool here (it runs zsh)

- `path` is a reserved zsh variable tied to `$PATH` — never loop with `path`/`fpath`/`cdpath`.
- zsh does not word-split unquoted `$var`; iterate with `while IFS= read -r f`.
- macOS BSD `sed` has no `\b`.
