# Contributing to ONIXLabs Studio

Thanks for your interest. Studio is an early, fast-moving project, and contributions of every size are
welcome — bug reports, fixes, features, documentation, and questions.

The **[wiki](https://github.com/onix-labs/onixlabs-studio/wiki)** is the documentation home:
architecture, conventions, decisions, and the release process all live there. This file is the short
version: how to get set up, what a change must satisfy, and how it reaches `main`.

## Ways to contribute

- **Report a bug** or **request a feature** through the
  [issue forms](https://github.com/onix-labs/onixlabs-studio/issues/new/choose). Search first — the
  answer may already be in an issue.
- **Ask a question** in [Discussions](https://github.com/onix-labs/onixlabs-studio/discussions).
- **Report a vulnerability** privately — see [SECURITY.md](SECURITY.md). Never in a public issue.
- **Send a pull request.** For anything larger than a small fix, open an issue first so the approach
  can be agreed before the work is done.

Issues labelled [`good first issue`](https://github.com/onix-labs/onixlabs-studio/labels/good%20first%20issue)
and [`help wanted`](https://github.com/onix-labs/onixlabs-studio/labels/help%20wanted) are good places
to start.

## Getting set up

- **Node.js 24** — the exact version is in `.nvmrc` (`nvm use`). Older majors are not supported.
- Platform build tools for native modules: `node-pty` is rebuilt against Electron on install.

```bash
npm install              # also rebuilds node-pty for the Electron ABI
npm run electron:serve   # renderer with live reload + the Electron shell
```

## The green gate

Every change must leave the tree green. Run this before every commit; CI runs the same steps on every
pull request and nothing merges without them passing:

```bash
npm run format:check     # Prettier
npm run lint             # ESLint (typed rules)
npm run test:coverage    # Vitest, with coverage thresholds
npm run build            # Angular renderer
npm run build:electron   # main + preload: typecheck and bundle
```

There is no tolerated baseline of failures. If a step can't stay green, the change is too big — split
it. The E2E suite (`npm run e2e`, after a build) and a packaging smoke also run in CI; they are not
required to merge but a failure will be looked at.

Coverage thresholds live in `angular.json` and only ever go up. A change that lowers coverage needs
tests, not a lower threshold.

## How a change reaches `main`

1. **Fork** the repository and create a branch from `main`, named `<type>/<short-description>`, for
   example `fix/dock-collapsed-gutter` or `feat/plugin-detail-panel`.
2. Make the change and keep the green gate green after every commit.
3. **Open a pull request** against `main`. The title becomes the commit subject on merge and the line
   in the release notes, so it must follow the [convention below](#commit-and-pr-titles). Give the PR
   its kind label (`feature`, `enhancement`, `bug`, or `documentation`) — the release notes group by it.
4. CI runs. Fix anything red.
5. A maintainer reviews and merges. Only repository admins can merge into `main` or `release`; that
   applies to their own pull requests too — nothing reaches those branches except through a PR with a
   passing gate.

The pull request template carries the checklist a change is reviewed against. Read it before opening
the PR, not after.

### Commit and PR titles

```
type(scope): subject
```

- **type** — one of `feat`, `fix`, `perf`, `refactor`, `chore`, `docs`, `test`, `build`, `ci`.
- **scope** — the area touched, lower-case: a feature (`agent`, `dock`, `plugins`, `workspace`,
  `terminal`, `lsp`, `git`, `shell`, `settings`, …) or `repo` for repository plumbing. Optional.
- **subject** — lower-case, no trailing full stop, and written as a statement of the behaviour after
  the change rather than a description of the edit. `fix(dock): a collapsed gutter keeps its width`
  says what a reader gains; `fix(dock): update gutter css` does not.

A breaking change to a published contract (the plugin manifest, `.studio` files) adds `!` after the
scope and a `BREAKING CHANGE:` paragraph in the body.

## Conventions

The full conventions are on the wiki; the ones that most often come up in review:

- **TypeScript is strict** — every member has an explicit access modifier, every parameter, return and
  local is typed, and `any` does not appear. Every member, including private ones, has TSDoc that says
  what it is for.
- **Angular** — standalone components, signals and `computed`, `OnPush`, `inject()`, built-in control
  flow. Feature templates use the shared **control atoms** (`app-button`, `app-input`, …) and never a
  raw `<button>` or `<input>`.
- **Architecture invariants** — `shared` never names a feature; a feature imports only `@shared` and
  `@features`; new tab views register through a descriptor plus one line in `config.ts`. The renderer
  never touches Node directly — everything crosses the Bridge IPC.
- **Comments say why**, not what. No commented-out code, no untracked `TODO`s.
- **Tests** are Vitest, AAA-structured, named `method_condition_expectation`, and exercise behaviour
  through the public API.

## The plugin API version

`src/shared/api/plugin-manifest.ts` is the contract every plugin manifest is written against, and
`PLUGIN_API_VERSION` says which contract this build implements. Change the contract and the version
must move with it, in the same PR:

- **Minor** — the contract only grows: a new optional field, a new contribution point, a new
  provisioning kind. Every manifest written against the previous version still validates and still
  means what it meant.
- **Major** — an existing field changes meaning, is removed, or becomes required. Plugins written for
  the old major are refused by the new one.

Record the reason in the comment block above the constant, as the earlier bumps do.

## AI-assisted contributions

Studio is an agentic development environment, and pull requests written with an agent are welcome —
Studio's own history is full of them. The rule is ownership: the person who opens the PR has read the
change, run the green gate, and can answer for every line in review. No disclosure is required.

## Versioning and releases

Studio uses calendar versioning, `YYYY.MINOR.PATCH` — `2026.1.0` is the first release of 2026,
`2026.2.0` the next feature release, `2026.1.1` a fix to the first. The plugin API version and the
curated-catalogue revision are separate numbers with their own rules. Releases are cut from the
`release` branch by a maintainer; the process is on the wiki.

## Code of conduct

Everyone participating in this project is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

ONIXLabs Studio is [MIT-licensed](LICENSE). By contributing you agree that your contributions are
licensed under the same terms. No contributor licence agreement is required.
