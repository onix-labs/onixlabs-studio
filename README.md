# ONIXLabs Studio

[![CI](https://github.com/onix-labs/onixlabs-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/onix-labs/onixlabs-studio/actions/workflows/ci.yml)

**The first of its kind: an Agentic Development Environment (ADE).**

ONIXLabs Studio is a cross-platform, language-agnostic desktop **ADE** — built from scratch on
**Electron** and **Angular** (standalone, zoneless, signal-driven), in TypeScript. Where an IDE is
built around a human editing files and _adds_ an AI chat, an ADE is built around **humans and AI
agents developing together** — so live agents are a native primitive of the workbench, not a bolt-on
panel.

Every capability you expect from a serious IDE is here — a fully custom docking workbench, Monaco
editing with language servers, from-scratch debugging, integrated terminals, and source control — but
they double as the **shared substrate agents operate in**: agents read the same project model, run in
the same terminals, edit through the same editor, and are watched and steered from one place. One
window replaces an editor, a terminal, a git client, and several separate AI chats.

> ⚠️ **Status: early / pre-release.** The application is under active development and APIs, layouts,
> and features move quickly. Releases are unsigned for now — see the notes on each release.

---

## Highlights

### The agentic core

- **Live, persistent agent sessions** per tab — a held-open subprocess conversation, not a stateless
  transcript — over the **Claude Agent SDK** and **OpenAI Codex SDK**, alongside stateless model
  providers (Anthropic, OpenAI, xAI, Google, DeepSeek, Ollama, and OpenAI-compatible endpoints) via the
  Vercel AI SDK, with **MCP** support.
- Agents are **wired into the workbench**, not a chat box beside it: they share the workspace's project
  model, open and drive its terminals, and edit through its editor.
- **Mission Control** — a singleton surface that mirrors every live agent as a column, so you run,
  watch, and steer many agents at once, with per-agent model/effort, history, and hide toggles.
- Rich agent bubbles: Markdown with **math (KaTeX)** and code fences with **copy** and, for shell
  commands, **run-in-terminal** actions.
- **Safe by design** — agent file writes are **confined to the workspace**, actions are **audited**,
  and per-tool policies gate what an agent may do; the renderer runs under a strict
  Content-Security-Policy.

The rest of the environment is a first-class IDE in its own right — and the shared substrate those
agents operate in.

### Workbench

- **Custom dock framework** — drag to dock, split, stack, float, and collapse panels; drag panels out
  into **real, independent OS windows** (multi-window), with layout **presets** persisted per surface.
- **Documents-only wells** with tool panels around the edges, plus a singleton **Mission Control** for
  watching and driving every live agent at once.
- **Contextual ribbon** that follows the active tab, **customisable keybindings**, **toast
  notifications**, and modal dialogs rendered as genuine Electron child windows.
- Modern UI polish (squircle corners, GPU-gated effects) that degrades gracefully.

### Language-agnostic workspace

- Pluggable **project systems**: .NET (`.sln`/`.slnx`), Node/npm (incl. workspaces), JVM
  (Gradle/Maven), Python, C/C++ (CMake/Make), Rust (Cargo), and Go — each contributing structure,
  build/run actions, and target/configuration axes from data.
- **Solution & File explorers** with virtualised trees for large repositories.
- **Package Management** panel: view installed dependencies and available upgrades, and browse/search a
  source's catalogue (npm and NuGet), honouring private feeds and credentials from `.npmrc` /
  `nuget.config`.

### Editing, language intelligence & debugging

- **Monaco**-based code editing with a shared **Language Server (LSP)** layer — TypeScript, Python
  (Pyright), C# (Roslyn), Java/Kotlin (jdtls), Rust (rust-analyzer), Go (gopls), C/C++ (clangd).
- Uniform **Error List** / diagnostics, VS-style **code folding**, dirty/change margin,
  **find & replace** across files (ripgrep), and **print / export to PDF**.
- From-scratch **DAP debugging** — breakpoints, call stack, scopes, locals, and watch — verified with
  netcoredbg (.NET) and js-debug (Node).
- **Binary / hex editor** for very large files, and a **markdown editor** (Milkdown) with Mermaid and
  KaTeX.

### Integrated tooling

- **Terminals** built on node-pty + xterm: interactive shells, command-backed **run**/**build**
  sessions (with stdin), a shell picker, and buffer search.
- **Git integration** — a source-control view with diffs and a commit graph, plus **worktrees**.

---

## Tech stack

| Area      | Technology                                                  |
| --------- | ----------------------------------------------------------- |
| Shell     | Electron 42 (main + preload in TypeScript, esbuild-bundled) |
| UI        | Angular 22 — standalone components, **zoneless**, signals   |
| Language  | TypeScript 6                                                |
| Editor    | Monaco                                                      |
| Terminal  | node-pty + xterm                                            |
| Markdown  | Milkdown (Crepe), Mermaid, KaTeX                            |
| Search    | `@vscode/ripgrep`                                           |
| AI        | Claude Agent SDK, OpenAI Codex SDK, Vercel AI SDK, MCP      |
| Testing   | Vitest (unit), Playwright (E2E)                             |
| Quality   | ESLint (typed rules) + Prettier                             |
| Packaging | electron-builder                                            |

---

## Getting started

### Prerequisites

- **Node.js 24** (the exact version is in `.nvmrc`) and npm.
- Platform build tools for native modules — `node-pty` is rebuilt against Electron on install (via
  `electron-rebuild`).

### Install

```bash
npm install
```

`postinstall` automatically rebuilds the native `node-pty` binding for Electron.

### Run (development)

```bash
npm run electron:serve
```

This serves the Angular renderer with live reload, builds the Electron main/preload bundles, and
launches the app pointed at the dev server.

### Build & package

```bash
npm run build            # build the Angular renderer
npm run build:electron   # type-check + bundle main and preload
npm run dist             # package a distributable for the current platform
npm run dist:mac         # …or target a specific platform
npm run dist:win
npm run dist:linux
```

### Test, lint & format

```bash
npm test                 # unit tests (Vitest)
npm run test:coverage    # unit tests with coverage
npm run e2e              # end-to-end tests (Playwright)
npm run lint             # ESLint
npm run format           # Prettier (write)
```

---

## Project structure

```
src/
  features/        Feature areas — each self-contained
    agent/         Standalone agent surface
    binary/        Binary / hex editor
    code/          Code (Monaco) editing surface
    markdown/      Markdown editing surface
    mission-control/ Multi-agent overview
    settings/      Settings surface
    terminal/      Terminal surface
    welcome/       Welcome / start page
    workspace/     Language-agnostic workspace (project systems, panels, debug, git)
  shared/
    angular/       Shared components, services, atoms, styles (the design system)
    electron/      Main-process code — managers, LSP, DAP, project systems, AI, security
    api/           Platform-neutral IPC contracts and shared types
    app/           App bootstrap (index.html, entry points)
docs/              Architecture and design notes (start with docs/agents.md)
e2e/               Playwright end-to-end suite
```

The renderer talks to the main process over a generic **Bridge** IPC transport; feature UI never
touches Node directly. The **[wiki](https://github.com/onix-labs/onixlabs-studio/wiki)** holds the
architecture guide, the conventions all contributions follow, and the project's decisions.

---

## Contributing

Bug reports, feature requests and pull requests are welcome — start with
**[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, the green gate every change must pass, and how a
pull request reaches `main`. Questions go to
[Discussions](https://github.com/onix-labs/onixlabs-studio/discussions); vulnerabilities are reported
privately per [SECURITY.md](SECURITY.md). Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © ONIXLabs
