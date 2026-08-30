![ONIX Labs](https://raw.githubusercontent.com/onix-labs/onixlabs-website/refs/heads/main/OnixLabs.Web/wwwroot/onixlabs/images/logo/logo-full-light.svg 'ONIX Labs')

# ONIXLabs Studio

[![CI](https://github.com/onix-labs/onixlabs-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/onix-labs/onixlabs-studio/actions/workflows/ci.yml)

ONIXLabs Studio is a cross-platform desktop **ADE** — an _agentic development environment_. Where a
traditional IDE is built around a person editing files and _adds_ an AI chat on the side, an ADE is
built around **people and AI agents working together**, so agents are part of the workbench itself
rather than a panel bolted onto it.

Everything you expect from a serious development environment is here — a workbench you arrange to
suit you, code editing with real language intelligence, debugging, terminals, and source control —
and your agents work in exactly the same place you do: the same project, the same terminals, the
same editor, all watched and steered from one screen. One window replaces an editor, a terminal, a
git client, and several separate AI chats.

> [!WARNING]
>
> **The application is under active development.**
>
> APIs, layouts, and features move quickly, and releases are unsigned for now — see the notes on each
> release.

## Highlights

### The Agentic Core

Each agent tab holds a **live, persistent session** — a real conversation that stays open and keeps
its context, rather than a transcript replayed from scratch each time. Sessions run on the **Claude
Agent SDK** and the **OpenAI Codex SDK**, and you can also talk directly to models from Anthropic,
OpenAI, xAI, Google, DeepSeek, Ollama, and any OpenAI-compatible endpoint. **MCP** servers are
supported throughout, so agents can reach the tools you already use.

Agents are **part of the workbench**, not merely a chat box beside it. They see the same project you do,
open and drive the same terminals, and make their edits through the same editor — so you watch the
work happen rather than paste results back and forth. When several are running at once,
**Mission Control** puts each one in its own column on a single screen, with its own model, effort
level, and history, so you can start, follow, and redirect all of them from one place. Replies are
fully formatted: Markdown with **maths**, and code blocks you can copy or, for shell commands, send
straight to a terminal.

It is also **safe by design**. Agents can only write inside your workspace, every action they take
is recorded, and you decide through per-tool policies what each one is allowed to do. Everything
else in the app is a capable development environment in its own right — and it is the very same
environment your agents are working in.

### Workbench

The whole workbench is yours to arrange. Drag panels to dock, split, stack, float, or collapse them,
and pull any of them out into a **real, independent window** — useful when you have a second monitor,
or want an agent running in view while you work elsewhere. Your files and documents always occupy the
centre, with tool panels around the edges, and you can save arrangements as **layouts** to return to
later.

Day to day, the **ribbon at the top follows whatever you are working on**, so the actions on offer
suit the current tab rather than everything at once. **Keyboard shortcuts are yours to change**,
notifications appear as unobtrusive toasts, and dialogs open as proper windows rather than trapping
you behind an overlay. The interface is deliberately modern — softly rounded corners and subtle
depth — and quietly scales back its effects on machines that cannot spare them.

### Language-Agnostic Workspace

Studio does not favour one language. Open a project and it is understood on its own terms — **.NET**,
**Node**, **Java and Kotlin**, **Python**, **C and C++**, **Rust**, or **Go** — each bringing its own
structure, its own build and run actions, and its own choice of targets and configurations. Mixed
repositories are fine; you are not forced into a single toolchain, and support for further languages
slots in the same way.

Two explorers sit alongside your work: one showing the project as its tooling sees it, the other
showing plain files on disk. Both stay responsive in very large repositories. A **package management**
panel rounds it out, listing what a project depends on, flagging what has a newer version available,
and letting you search a registry for something new — including **private feeds**, using the
credentials your project is already configured with.

### Editing, Language Intelligence, and Debugging

The code editor understands what you are writing, not just how to colour it. Completion, navigation,
inline errors, and refactoring work across TypeScript, Python, C#, Java, Kotlin, Rust, Go, and C and
C++, because Studio speaks to the same language tooling those communities already maintain. Alongside
that you get the everyday essentials: a single list of every problem in the project, collapsible code,
a margin showing what you have changed, **find and replace across every file** in the repository, and
printing or export to PDF.

Debugging is built in rather than delegated — set breakpoints, step through your code, and inspect the
call stack, local variables, and watched expressions. It is proven today with **.NET** and **Node**,
with other languages following.

Not everything is code, so Studio includes a **markdown editor** with live diagrams and maths for
notes and documentation, and a **binary editor** for the times you need to look at a file byte by
byte — including files far too large for an ordinary editor to open.

### Integrated tooling

**Terminals** are fully interactive and behave exactly as they do outside Studio — pick whichever
shell you prefer, search back through the output, and run or build your project in a session you can
type into when it asks you something. **Source control** is here too: review your changes side by
side, read the history as a commit graph, and keep several branches checked out at once.

When your project runs in **containers**, you can see and control them without dropping to the
command line — browse images, start, stop and remove containers, and watch their state change as it
happens — so the day-to-day "is it running, and why not" questions are answered in the window you
are already in.

Studio also covers the tool most developers keep open beside their editor: an **API explorer** that
lets you compose and send requests, save them with your project, and read responses properly
formatted — no separate REST client needed.

Finally, three panels manage Studio itself. The **model manager** runs local models on your own
machine — installing the runtime, pulling and removing weights — while hosted providers are
configured in Settings. The **plugin manager** installs and removes the language servers and debug
adapters your languages need. The **system monitor** shows what Studio is doing: resource use, and a
searchable log of the session.

### On the way

Studio is a beta, and some of what it will be is still being built. Named here so you know what is
coming rather than discovering it missing:

- **Container logs and shells** — reading a container's output and opening a shell inside it.
- **Cluster orchestration** — a view over deployed workloads, their health, and their logs.
- **A database explorer** — connections, schema browsing, and queries with results in a grid.
- **Installing packages** — the package panel lists dependencies, flags upgrades and searches
  registries today; adding and updating from it is next.
- **Signed releases** — until then, macOS and Windows will warn on first launch.

> [!WARNING]
>
> **Studio is a beta, and some tooling is incomplete.**
>
> Expect rough edges: controls that are not wired up yet, and features that do less than they will.
> Anything you hit is worth [reporting](https://github.com/onix-labs/onixlabs-studio/issues/new/choose)
> — it is the fastest way to get it fixed.

## Technology Stack

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

## Getting Started

### Prerequisites

- **Node.js 24** (the exact version is in `.nvmrc`) and npm.

- Platform build tools for native modules — `node-pty` is rebuilt against Electron on install (via
  `electron-rebuild`).

### Install

Install the dependencies from the repository root. A `postinstall` step then rebuilds the native
`node-pty` binding against Electron's own Node version, so expect the first install to take rather
longer than a plain dependency fetch.

```bash
npm install
```

### Run (Development)

This is the command you will use most. It serves the Angular renderer with live reload, builds the
Electron main and preload bundles, and launches the app pointed at the dev server, so edits to the
renderer appear in the running window without a restart.

```bash
npm run electron:serve
```

### Build & Package

Building is done in two halves — the Angular renderer and the Electron main and preload bundles —
and packaging wraps the result into a distributable application. `dist` targets whichever platform
you are currently on, while the platform-specific targets name one explicitly; each is most reliable
when run on the operating system it produces.

```bash
npm run build            # build the Angular renderer
npm run build:electron   # type-check + bundle main and preload
npm run dist             # package a distributable for the current platform
npm run dist:mac         # …or target a specific platform
npm run dist:win
npm run dist:linux
```

### Test, Lint, and Format

These are the same checks CI runs, so it is worth running them locally before opening a pull request.
Unit tests cover the bulk of the codebase, the end-to-end suite drives the packaged app, and the lint
and format commands enforce the house style — `npm run format` rewrites files in place rather than
just reporting on them.

```bash
npm test                 # unit tests (Vitest)
npm run test:coverage    # unit tests with coverage
npm run e2e              # end-to-end tests (Playwright)
npm run lint             # ESLint
npm run format           # Prettier (write)
```

## Project Structure

The codebase is organised by feature rather than by file type, so most work stays within a single
directory. Each surface you see in the running app — the agent, the editor, the terminal — is a
self-contained feature under `src/features`, while anything used by more than one of them lives in
`src/shared`: the design system, the platform contracts, and all main-process code. Outside `src`,
`docs` holds the project's own documentation and `e2e` holds the end-to-end suite.

```
src/
  features/             Feature areas — each self-contained
    agent/              Standalone agent surface
    binary/             Binary / hex editor
    code/               Code (Monaco) editing surface
    markdown/           Markdown editing surface
    mission-control/    Multi-agent overview
    settings/           Settings surface
    terminal/           Terminal surface
    welcome/            Welcome / start page
    workspace/          Language-agnostic workspace (project systems, panels, debug, git)
  shared/
    angular/            Shared components, services, atoms, styles (the design system)
    electron/           Main-process code — managers, LSP, DAP, project systems, AI, security
    api/                Platform-neutral IPC contracts and shared types
    app/                App bootstrap (index.html, entry points)
docs/                   agents.md — the invariants, and where the documentation (the wiki) lives
e2e/                    Playwright end-to-end suite
```

The renderer talks to the main process over a generic **Bridge** IPC transport; feature UI never
touches Node directly. The **[wiki](https://github.com/onix-labs/onixlabs-studio/wiki)** holds the
architecture guide, the conventions all contributions follow, and the project's decisions.

## Contributing

Bug reports, feature requests and pull requests are welcome — start with
**[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, the green gate every change must pass, and how a
pull request reaches `main`. Questions go to
[Discussions](https://github.com/onix-labs/onixlabs-studio/discussions); vulnerabilities are reported
privately per [SECURITY.md](SECURITY.md). Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## License

[MIT](LICENSE) © ONIXLabs
