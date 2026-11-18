# Adding a language server to Studio

How to bring a new language server into Studio (F#, OCaml, Zig, or any other) and get it to support as much of the
protocol as the server offers, without having to relearn what the C# work (#1139) and the language-parity
epics (#1202) found out the hard way.

The steps run in order. Each one ends with a check that doesn't depend on anyone's memory: a probe
report, a spec, or a live check in a second instance.

## 1. Describe the server

A server is a **descriptor**: an id, the languages it serves, how it is installed, and how it is started.
There are two kinds, and nearly every server should be the first.

**A curated manifest** (data). This is an entry in
`src/shared/electron/contributions/plugins/curated-plugins.json`, validated by
`src/shared/api/plugin-manifest.ts`. Use it whenever starting the server means "run the entry point of
what we installed":

- **First check the build you mean to pin really contains the server.** Run its language-server
  command by hand before writing anything. Some projects leave the server out of a build: `@taplo/cli`
  on npm is a WASM build that answers `taplo lsp stdio` with "the LSP is not part of this build", and
  calls itself `taplo 0.9.0` while the package is 0.7.0. Taplo's native release binaries have it.
- `provision`:
  - `kind: 'archive'`: a release download per platform (`darwin-arm64`, `darwin-x64`, `linux-arm64`, `linux-x64`, `win32-x64`), each with a `url`, a `sha256` (of the file as downloaded), an `archive` type (`tar.gz`, `zip`, or `gz` for a single compressed binary) and an `executablePath`. A `zip` holding more than the server takes `members` (rust-analyzer's Windows build). An npm package with **no** dependencies is provisioned this way too, from its registry tarball (`https://registry.npmjs.org/<name>/-/<name>-<version>.tgz`, `executablePath: "package/…"`), as Pyright is.
  - `kind: 'npm'`: for an npm package that has dependencies. It needs a `lockfileUrl` (the raw `main` URL of a file under `contributions/plugins/lockfiles/`), that file's `sha256`, and the package's `executablePath` (`node_modules/<package>/…`). The lockfile is the `package-lock.json` of a wrapper package named after the plugin that depends on the server. **Register it in `contributions/plugins/bundled-lockfiles.ts` too**: a spec holds every lockfile the seed index pins to a bundled copy, so an install works without the network. A third-party server's lockfile is named for its version (`<id>-<version>.lock.json`) and served from `main`; a new version is a new file, never an edit to an old one, so the bytes under a URL an index already pins never change. Regenerating the lockfile for a version that already has one (a dependency fix, say) is a new file too, with a counter: `<id>-<version>-1.lock.json`, then `-2`. Each version-named file is frozen once it lands: `bundled-lockfiles.spec.ts` records its hash, and adding a file means adding its hash there, never changing one.
- `contributes.languageServers[]`:
  - `id`: names the **implementation, never the language** (`pyright`, not `python`). A second server for the same language is a slot the user picks from.
  - `languages`: Monaco language ids. For a language Studio hasn't served before, see "A new language" below.
  - `priority`: the default among installed servers; higher wins.
  - `command`: `executable`, `node` (run under Electron in Node mode) or `python`, plus `args`. ⚠️ A `node` command is always started as `<entry point> --stdio <args…>`: Studio puts `--stdio` straight after the entry point, ahead of `args`, and the manifest can't turn it off. A server whose command line rejects an unknown leading flag (taplo's `taplo lsp stdio` does) can't run as `node`. Use its native build as an `executable`.
  - `entryPoint`: for a payload that holds several servers.
  - `initializationOptions`: fixed start-up options.
  - `settings` and `settingsDelivery`: see step 3.
- `requires`: a runtime from the closed list (`java`, `dotnet`, `go`, `node`, `python`). A manifest can say a runtime is needed; it can't teach Studio how to find one.

**A code-first descriptor** (`src/shared/electron/lsp/language-server-catalogue.ts`). Use this only when
resolving the server is a computation:

- gopls is built with the user's Go toolchain;
- Roslyn's `solution/open` is derived from the workspace;
- jdtls needs a data directory per workspace;
- TypeScript chooses between the workspace's own compiler and the bundled one.

Only a code-first descriptor can set `servesWorkspaceDiagnostics` (step 4). If the probe shows the
server needs it, that alone is not enough reason to move a server out of the index; ask first.

Things to know before touching the index:

- 🔥 **The index is fetched from `main` by every running Studio.** Merging a change to it is a shipping
  decision. Bump `revision` with every change, or a cached copy at the old revision ties with the seed,
  and the seed wins.
- **Keep `apiVersion` as low as the entry allows.** A Studio older than the version refuses the entry
  and loses the server. Fields it doesn't know are ignored. #1220, #1381 and #1398 all added settings
  without raising it. The floor comes from the shapes the entry uses, and the version history above
  `PLUGIN_API_VERSION` in `src/shared/api/plugin-manifest.ts` says when each arrived: `npm` provision
  1.2.0, `members` 1.6.0, the `python` command 1.7.0, a `gz` archive 1.8.0.
- **When a new release has to raise `apiVersion`, list the previous one under `releases`.** An entry's
  top-level fields are always its newest release: the only shape builds before #1467 read. Beside them,
  an optional `releases` array offers older releases, and a build installs the highest `version` whose
  `apiVersion` it can honour (falling back to its own bundled entry only when it can run none). Each
  release must state its own `version`, `apiVersion` and `provision` (for a first-party plugin, the
  lockfile URL at _that_ release's tag and its hash), and inherits everything else from the top level,
  which is the _newest_ release. So restate everything that differs, `contributes` and `requires`
  above all, or an older release claims contributions it doesn't implement. For a first-party plugin
  that means, in practice, its whole `plugin.json` at its tag minus `id`; a spec holds each listed
  release to `git show plugin-<x>-v<version>:plugins/<x>/plugin.json`. The shape (contributions
  abbreviated):

  ```json
  {
    "id": "onixlabs.github",
    "version": "0.7.0",
    "apiVersion": "1.29.0",
    "provision": { "kind": "npm", "lockfileUrl": "…/plugin-github-v0.7.0/…", "sha256": "…" },
    "contributes": { "…": "…" },
    "releases": [
      {
        "name": "GitHub",
        "description": "…",
        "version": "0.6.5",
        "apiVersion": "1.28.0",
        "provision": { "kind": "npm", "lockfileUrl": "…/plugin-github-v0.6.5/…", "sha256": "…" },
        "contributes": { "…": "0.6.5's own" },
        "requires": []
      }
    ]
  }
  ```

  Prune a release from the list once no supported build needs it, that is, once every supported build
  can run a newer one. `verify-plugin-index.mjs` checks the pins of every listed release.

- **Keep the file's layout.** Rewriting it through `JSON.stringify` re-lays every other entry. Change
  the entries you mean to change, and leave the rest byte for byte.
- A plugin that also has a folder under `plugins/` has its index entry as an exact copy of its
  `plugin.json`. Repinning one touches four places: the lockfile, `plugin.json`'s `sha256`, the
  index's copy of it, and the index `revision`. The language servers in the index have no folder.
- Run `node scripts/verify-plugin-index.mjs --all` before the unit specs. Without `--all` it checks
  only this machine's platform, and a new archive entry pins five. It needs the network, so run it
  where the release hosts can be reached. In an agent's sandbox, Node's `fetch` ignores the proxy, and
  every download fails with "fetch failed" until it's run with `NODE_USE_ENV_PROXY=1`.

**A new language.** When the server serves a language no other server does (TOML, say), the
language id has to be known in several places. A spec catches only some of them:

- `src/shared/angular/services/monaco/monaco-languages.ts`: the extension (or whole file name) and
  the display name (#1338).
- `src/shared/angular/services/plugins/language-names.ts`: the display name again, for the Plugin
  Manager and the settings tree.
- `FEATURE_LANGUAGES` in `src/shared/angular/services/lsp/lsp-features.ts`: the languages the editor's
  providers are registered for. Without it, no feature reaches the file. The spec checks it against
  both catalogues.
- **Monaco itself.** Check `node_modules/monaco-editor/esm/vs/languages/definitions/`. A model whose
  language Monaco doesn't know falls back to `plaintext`, so a provider registered for the id never
  runs. A language Monaco lacks needs a `monaco-<lang>-language.ts` that registers it, with a Monarch
  grammar (follow `monaco-cypher-language.ts`). Call it in both places in `monaco.ts` (the main
  window and `loadIntoChild`).
- `EXTENSIONS` in `scripts/probe-lsp.mjs`, so the probe finds a file to open.

## 2. Probe it first

Before writing any wiring, find out what the server really offers. **Studio advertises a narrow set of
client capabilities, and a server only reveals what it offers in answer to what the client says it can do.**

```sh
node scripts/probe-lsp.mjs --list                                  # the catalogue, and what is installed
node scripts/probe-lsp.mjs --server <id> --workspace .cache/<fixture> [--file <path>] \
  --profile .cache/<scratch-profile> [--settings '<json>'] [--init-options '<json>']
```

- **Use a scratch profile under `.cache/`, never Matthew's.** Copy an install into it, or install one the
  way the provisioner does (a verified download, or `npm ci --ignore-scripts` from the pinned lockfile,
  then the `.studio-install-complete` marker). Check the path the probe prints. The install goes in
  `<profile>/lsp-servers/<plugin id>/<version>/<platform>-<arch>/` (`darwin-x64`, …). Archives are
  extracted unstripped, so `executablePath` is relative to that folder. A `gz` is decompressed to
  `executablePath` itself. Make the executable `chmod 755`, as the provisioner does. Write the marker
  last.
- `--server <id>` resolves the server from the descriptor, so write the descriptor (step 1) first. The
  `--server "<command line>"` form runs a command as it stands, from the workspace folder, so give it
  absolute paths.
- **Mark the fixture.** Put `@probe type=… member=… call=… interface=… value=… completion=…` in comments
  so each check lands on a real symbol. A marker's value must be a plain identifier (`[\w$]+`), so
  point it at `service_name`, not at `serde-json`.
- **Run it at least twice:** once as Studio starts the server today, and once with the settings you plan
  to declare (`--settings` answers `workspace/configuration` and is pushed; `--init-options` merges into
  `initializationOptions`). The difference is what Studio would gain.
- Run under `--node` when `node_modules/electron` has no binary (`npm ci --ignore-scripts`).
- A server that builds or caches (gopls, Go's build cache) needs `GOCACHE` and the like pointed under
  `$TMPDIR` to run sandboxed.
- Some servers can't run in an agent's macOS sandbox at all. taplo 0.10.0 panics as it starts, in
  `system-configuration` ("Attempted to create a NULL object"), because its HTTP client reads the
  system proxy settings and the sandbox denies that lookup. `taplo fmt` dies the same way. No
  environment variable avoids it. Such a probe has to run outside the sandbox, and that needs
  Matthew's say-so.

Read the report (`.cache/lsp-probe/<id>/<version>.json`) for:

- each feature's advertised value and its live result;
- the semantic-token legend and any custom types;
- every `workspace/configuration` section it asks for, and when;
- every client command it sends (lens, code action, completion, hint);
- every request it sends the client.

Then add the server's row to the capability matrix: name the report in
`docs/language-servers/capability-wiring.json` and run `node scripts/probe-lsp.mjs --matrix --docs`.

## 3. Settings: pulled, pushed, at start-up, or on the command line

Studio answers `workspace/configuration` with the user's value for each declared setting, or its declared
default. For anything undeclared it answers **null**, and null breaks some servers outright. Declare the
settings a user would recognise, with the server's own default unless there's a reason (then say so in
the PR). Labels are Title Case.

| The server…                                         | `settingsDelivery`                                                                                              | Examples                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| asks, and asks again after `didChangeConfiguration` | none (pull is the default)                                                                                      | Roslyn, gopls, Pyright, Lua, YAML                              |
| never asks; reads what it is pushed                 | `{ pull: false, push: ['<section>'] }`                                                                          | typescript-language-server, jdtls, JSON                        |
| reads `initializationOptions` only as it starts     | `startup: { section, key? }`; every such setting `startupOnly`, and its description says it restarts the server | ty (flat), jdtls (`settings.java`), TypeScript (`preferences`) |
| takes options only on its command line              | `arguments: [{ section, flag }]`                                                                                | clangd                                                         |
| never asks and takes nothing                        | `{ pull: false }`, so it is never sent `{ settings: null }`                                                     | Svelte, sqls                                                   |

- A section that holds other settings is answered **nested**: `gopls.hints.parameterNames` reaches gopls as `{ hints: { parameterNames } }`.
- Text settings render as a text field. `${workspaceFolder}` in a value is filled in with the session's root, which is how Pyright's interpreter defaults to the workspace's `.venv` (#1381).
- A server's **own switches for kinds of code lens** aren't declared on its page. They're answered from Code › Code Lenses through `CODE_LENS_SERVER_SWITCHES` in `src/shared/angular/services/lsp/code-lens-kinds.ts` (#1394).

## 4. What works generically, and what needs wiring

Most of the protocol is capability-driven and works for any server that advertises it:

- definition, declaration, implementation, type definition and references;
- hover, completion with resolve, and signature help;
- document, range and on-type formatting;
- rename with prepare;
- code actions with resolve;
- code lens with resolve;
- inlay hints with resolve;
- folding, highlights, selection range and linked editing;
- semantic tokens, full and range;
- document and workspace symbols;
- call and type hierarchy;
- pushed and pulled diagnostics;
- `willRenameFiles`;
- `workspace/applyEdit`, `window/showMessageRequest`, `window/showDocument` and `workspace/workspaceFolders`;
- progress and refresh requests.

Verify each one rather than assume it works, then mark it in the matrix.

What needs wiring per server:

- **Client commands.** A command in the server's `executeCommandProvider` runs on the server. Any other command (`editor.action.showReferences`, `rust-analyzer.runSingle`, `roslyn.client.peekReferences`, `java.show.references`) needs a mapping in `lensCommand` / the code-action path in `src/shared/angular/services/lsp/lsp-features.ts`. Otherwise its item shows and does nothing. Code lenses also need their kind recognised in `codeLensKind`.
- **Experimental client capabilities**, for a server that hides features without them (rust-analyzer's `commands`, `serverStatusNotification`). They go in `src/shared/electron/lsp/lsp-client-capabilities.ts`, per server where the answer changes what it sends.
- **Custom requests and notifications** (`rust-analyzer/parentModule`, `clangd/switchSourceHeader`, Roslyn's `_roslyn_*`). Add them only where the server advertises them.
- **Workspace diagnostics** a server answers but doesn't advertise: `servesWorkspaceDiagnostics` (code-first only).
- **Tests.** A server's test lenses route through the Tests slot (#802) once it exists. Until then, Roslyn runs them on its session and rust-analyzer through the workspace runner.

## 5. Fixture, specs and a live check

- **Fixture:** a small project under `.cache/<language>-fixture`. Give it two modules referencing each other, an interface and an implementation, a test, a deliberate error, and a dependency if the language has a package manager. A data or configuration language (TOML, YAML, JSON) has none of those. Give it what its server works from instead: a document bound to a local JSON schema (so the probe needs no network), the server's own config file (`.taplo.toml`), a second document, and a value the schema rejects as the deliberate error. Never use one of Matthew's repositories, not even a copy. If the fixture needs a git repo, use `set -euo pipefail` and `git -C "$F"`, and check `rev-parse --show-toplevel` equals the fixture before anything mutates. `.cache/` sits inside the real repo, so a failed `git init` falls through to it.
- **Specs:** build the descriptor from the real curated entry (`parsePluginManifest` and `toLanguageServerDescriptors`), as `lsp-server-registry.spec.ts` does. Assert what the server is answered, pushed and started with, and which settings restart it. Run single specs (`npx ng test --watch=false --include <file>`, the path relative to `src/`, such as `shared/electron/lsp/lsp-server-registry.spec.ts`; the flag can be repeated). Leave the full suite to CI; it saturates the machine.
- **Live check:** a second instance on a scratch profile (`STUDIO_USER_DATA_DIR`) against the fixture, feature by feature. Only then does a cell turn ✅.

## 6. Gotchas, each found the hard way

- **Never send `didOpen` twice.** Roslyn aborts; the manager tracks open documents per window (#1190).
- **A null answer can mean "unchanged".** Roslyn keeps its previous value, so Studio answers declared defaults (#1145).
- **A null answer can crash the server.** The CSS server threw on `null.validProperties` and gave no diagnostics at all (#1218). Svelte and the JSON server throw on `{ settings: null }` (#1219).
- **A feature can sit behind a setting or an init option:**
  - the HTML, CSS and JSON formatters need `provideFormatter: true`;
  - YAML's formatter needs `yaml.format.enable`;
  - gopls's semantic tokens need `semanticTokens`;
  - Lua's hints need `Lua.hint.enable`.

  The probe's second run finds these.

- **A server can ignore a change.** ty has no `didChangeConfiguration` handler, so its settings are `startupOnly`.
- **vscode-jsonrpc consumes `$/progress` itself:** use `onUnhandledProgress` (#1144).
- **Workspace diagnostics are long-held and streamed.** Analysis is done at the first pull completed after the load (#1182).
- **A window that joins late must be caught up** with the session's state (#1182).
- **A server that dies says why on stderr or in `window/logMessage`, and nowhere else.** Keep the tail; there's a crash policy (#1136).
- **Snippet edits need `adjustWhitespace: false`** (#1148).
- **Re-sync breakpoints after a debugger attaches** (#1150).
- **`window/showDocument`** for web pages goes through the content link opener; other schemes are refused (#1364).
- **Studio advertises workspace folders, so it must answer `workspace/workspaceFolders`.** A null answer means "none open" (#1398).

## 7. Done when

- The server installs from the Plugin Manager, or builds as gopls does.
- It starts for its languages.
- Its settings reach it the way it reads them.
- Its matrix row comes from a real probe run, with every offered feature either ✅ after a live check or 🟡 with an issue saying why not.
