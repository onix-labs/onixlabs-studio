# Code Quality Guidelines

> **Code is clean if it can be read, and enhanced by a developer other than its original author.**

These guidelines define the code quality standard for **ONIXLabs Studio** (TypeScript, Angular, Electron).
Code must be readable and maintainable by developers other than the original author — every line must justify
its existence through clear naming and thorough documentation explaining _why_ it exists.

---

## Non-negotiable baseline

Three rules are mandatory and mechanically enforced (see [Enforcement](#16-enforcement)). The rest of this
document elaborates on and surrounds them.

1. **Object-orientation first.** Favour OOP. Reach for functional programming only where it genuinely
   expresses the problem better than OOP.
2. **Explicit member accessibility.** Every class member is explicitly marked `public`, `protected`, or
   `private`. No implicit visibility.
3. **Explicit, total type annotations.** Annotate every type — class members, parameters, return types,
   **and local variables**. `any` is forbidden.

---

## 1. Language & Tooling

- Target the latest stable TypeScript and Angular releases the project pins.
- **`strict` mode is mandatory** (`tsconfig.json`) — it turns the type system's full safety guarantees on,
  including strict null checks.
- All code passes **ESLint** (typed rules) and is formatted by **Prettier** before commit.
- Node version is pinned via `.nvmrc`; run `nvm use` before working.

---

## 2. Paradigm — OOP first, FP where it fits

Model the domain with classes, interfaces, and clear responsibilities. Use object-orientation as the
default tool for structure, encapsulation, and polymorphism.

Use functional techniques when they are the clearer expression of intent:

- **Pure functions** for stateless transformations and calculations.
- **Array methods** (`map`, `filter`, `reduce`, `some`, `every`) over manual loops when they read better.
  Mind that they allocate; on a hot path, justify with a `// Why:` comment if a manual loop is faster.
- **Signals** (`signal`, `computed`, `effect`) for reactive state and derived values (see
  [Angular Conventions](#12-angular-conventions)).

```typescript
// FP is clearer here: a stateless transformation.
function toDisplayNames(users: readonly User[]): readonly string[] {
  return users.map((user: User): string => `${user.firstName} ${user.lastName}`);
}

// OOP is clearer here: state + behaviour + identity.
class UserSession {
  private readonly startedAt: Date;
  private lastSeenAt: Date;

  public constructor(startedAt: Date) {
    this.startedAt = startedAt;
    this.lastSeenAt = startedAt;
  }

  public touch(now: Date): void {
    this.lastSeenAt = now;
  }
}
```

Do not force a paradigm where it does not fit. A class with a single method and no state is usually a
function; a tangle of free functions sharing mutable state is usually a class.

---

## 3. Type Safety

- **Annotate everything**, including local variables, even where TypeScript could infer the type. Explicit
  annotations are documentation and a guard against unintended inference drift.

  ```typescript
  const retryLimit: number = 5;
  const users: readonly User[] = await this.repository.loadAll();
  const isExpired: boolean = session.expiresAt.getTime() < now.getTime();
  ```

- **`any` is forbidden.** When a type is genuinely unknown, use `unknown` and narrow it explicitly.

  ```typescript
  function parseConfig(raw: unknown): Config {
    if (!isConfig(raw)) {
      throw new InvalidConfigError('Configuration payload is not a valid Config.');
    }

    return raw;
  }
  ```

- **`null` vs `undefined`.** Prefer `undefined` for "absent". Reserve `null` for values that are explicitly,
  intentionally empty (and for interop with APIs that use it). Never silently return `null`/`undefined` to
  signal failure — see [Error Handling](#8-error-handling).
- **Immutability by type.** Use `readonly` modifiers, `readonly T[]`, `Readonly<T>`, and `as const` to make
  illegal mutation unrepresentable.
- **Prefer narrow types.** Use union literals (`'idle' | 'loading' | 'error'`) and discriminated unions over
  loose `string`/`number` and over boolean flags that encode state.

---

## 4. Access Modifiers

- **Every member carries an explicit modifier** — `public`, `protected`, or `private`. No exceptions.
- **Start at the narrowest scope** (`private`) and widen only when a real consumer needs it.
- Mark members `readonly` wherever they are not reassigned after construction.
- TypeScript requires `this.` to access instance members, so there is no field/parameter ambiguity to
  resolve — **never prefix private members with an underscore.** (`private name`, not `private _name`.)
- **Angular templates:** members bound in a component's template should be `protected`, not `public`. They
  are part of the template contract, not the component's public API. `private` members are not
  template-accessible.

  ```typescript
  @Component({
    /* ... */
  })
  export class UserPanel {
    protected readonly title: WritableSignal<string> = signal('Users');
    private readonly repository: UserRepository = inject(UserRepository);
  }
  ```

- Prefer `#private` JavaScript fields only when hard runtime privacy is required (e.g. guarding secrets in
  the Electron main process); otherwise use `private`, which the compiler and ESLint enforce.

---

## 5. Naming Conventions

- **Intention-revealing names.** `elapsedTimeInDays`, not `d`. Names must be pronounceable and searchable.
- **Classes are nouns** (`Customer`, `WindowManager`); **methods and functions are verbs** (`postPayment`,
  `createWindow`).
- **Booleans read as predicates**: `isActive`, `hasChildren`, `canRetry`.
- **No misleading names.** Don't call something a `list` if it is a `Map`.
- **Casing:**
  | Construct | Case |
  | --- | --- |
  | Classes, interfaces, type aliases, enums, decorators | `PascalCase` |
  | Methods, functions, properties, variables, parameters | `camelCase` |
  | Enum members | `PascalCase` |
  | Genuine compile-time global constants | `UPPER_SNAKE_CASE` |
  | File names | `kebab-case` (Angular convention, e.g. `user-panel.ts`) |
- **No `I` prefix on interfaces.** Name the interface for the concept (`Repository`) and, if needed, suffix
  the implementation (`HttpRepository`).
- **No Hungarian or type-encoding prefixes.** The type system carries the type.

---

## 6. Classes & Structure

- **Single Responsibility Principle.** A class has one reason to change.
- **Stepdown rule.** A file reads top-to-bottom as a narrative: public API first, private helpers below, each
  one level of abstraction beneath the last.
- **Composition over inheritance.** Inject collaborators; reserve inheritance for genuine _is-a_
  relationships. Treat classes as not designed for extension unless documented otherwise.
- **Immutability.** Prefer constructing fully-initialised, `readonly` objects over mutable ones with setters.
  For plain data, prefer `readonly` interfaces / `Readonly<T>` over classes with public setters.

---

## 7. Functions & Methods

- **Small and focused.** Typically under ~20 lines; do exactly one thing at one level of abstraction.
- **Few parameters.** 0–2 ideal. Three or more demands a parameter object (an options interface).

  ```typescript
  interface CreateWindowOptions {
    readonly width: number;
    readonly height: number;
    readonly preloadPath: string;
  }

  function createWindow(options: CreateWindowOptions): BrowserWindow {
    /* ... */
  }
  ```

- **Explicit return types on every function and method**, including `void` and `Promise<void>`. Never rely on
  inferred return types for declared functions.
- **No unintended side effects.** A function named for a query must not mutate state.
- **Async:** prefer `async`/`await` over raw `.then()` chains. **Never leave a floating promise** — `await`
  it, return it, or explicitly mark it handled. Surface cancellation where it matters via `AbortSignal`.
- Use arrow functions for callbacks and to preserve `this`; use methods for class behaviour.

---

## 8. Error Handling

- **Throw errors; don't return error codes.** Throw `Error` (or a domain-specific subclass), never a string
  or a bare object.

  ```typescript
  export class CustomerNotFoundError extends Error {
    public constructor(customerId: string) {
      super(`Customer '${customerId}' was not found.`);
      this.name = 'CustomerNotFoundError';
    }
  }
  ```

- **Don't return `null`/`undefined` silently to signal failure.** Either throw, or make the absence explicit
  in the type (`User | undefined`) and document it.
- **Define operation scope early** with `try`/`catch`/`finally`; release resources in `finally`.
- For _expected_, non-exceptional failure, a result type (`{ ok: true; value: T } | { ok: false; error: E }`)
  is acceptable. Use it deliberately, not everywhere.
- Catch `unknown` and narrow: `catch (error: unknown) { if (error instanceof DomainError) ... }`.

---

## 9. Documentation (TSDoc)

**Every member is documented — regardless of visibility**, including `private` members. Use
[TSDoc](https://tsdoc.org/). Documentation is genuine, descriptive prose: capitalised, ending with a period,
never placeholder or copy-pasted text. Reference other symbols with `{@link Symbol}`.

**Opening phrases** are conventional and carry meaning:

| Member                           | Opening phrase                                              |
| -------------------------------- | ----------------------------------------------------------- |
| Class                            | `Represents ...`                                            |
| Interface / type / function-type | `Defines ...`                                               |
| Enum                             | `Specifies ...`                                             |
| Constructor                      | `Initializes a new instance of the {@link TypeName} class.` |
| Read-only property/accessor      | `Gets ...`                                                  |
| Write-only accessor              | `Sets ...`                                                  |
| Read/write property/accessor     | `Gets or sets ...`                                          |
| Boolean property                 | `Gets a value indicating whether ...`                       |
| Method                           | A verb phrase describing the action                         |

**Required tags:**

- Methods/functions: `@param` for every parameter; `@returns` for every non-`void` return. **`@returns`
  text begins with "Returns".**
- Generic type parameters: `@typeParam` matching the parameter name exactly.
- Throwable errors: `@throws {@link ErrorType}` describing when it is thrown.

```typescript
/**
 * Represents a repository that loads and persists customers.
 */
export interface CustomerRepository {
  /**
   * Loads the customer with the specified identifier.
   * @param customerId The unique identifier of the customer to load.
   * @returns Returns a promise for the matching customer.
   * @throws {@link CustomerNotFoundError} when no customer matches the identifier.
   */
  load(customerId: string): Promise<Customer>;
}
```

Avoid empty tags, default editor templates, and identical summaries across unrelated members.

---

## 10. Comments (non-documentation)

- Comments are rare. **Prefer rewriting unclear code over explaining it.**
- When present, a comment explains **why**, never **what**. Lead performance- or correctness-driven choices
  with `// Why:`.
- **No commented-out code** — version control is the history.
- **No `TODO` without a tracked issue reference** (e.g. `// TODO(#123): ...`).
- Legal/licence headers and genuine clarifications are acceptable.

---

## 11. Formatting

- **Line length: 100 characters** (enforced by Prettier — `printWidth: 100`).
- One statement per line; one declaration per line.
- Single quotes, semicolons, trailing commas — as configured by Prettier; never hand-format against it.
- Instance members are always accessed via `this.` (language-required).
- Group related lines; separate logical paragraphs with a blank line. Declare variables close to first use.
- Break long fluent / pipeline chains one operator per line.
- Import order: external packages, then internal modules, then relative imports; no unused imports.

---

## 12. Angular Conventions

- **Standalone components only.** No `NgModule`s. Declare dependencies in the component's `imports`.
- **Signals are the default reactive model.** Use `signal()` for state, `computed()` for derived state, and
  `effect()` for reactive side effects. The project runs zoneless change detection — do not depend on Zone.js
  side effects.
- **`ChangeDetectionStrategy.OnPush`** on every component.
- **Reactivity decision:** reach for signals first.
  - **State** → `signal()`.
  - **Derived/computed state** → `computed()` (synchronous, memoised, glitch-free, auto-tracked — this is
    why derived values should _not_ be hand-wired through RxJS).
  - **Reactive side effects** → `effect()`.
  - **Genuine asynchronous _streams_ of events** (debounced input, websocket/IPC feeds, multi-event
    coordination) and **unavoidable `Observable` interop** (`HttpClient`, router events) → **RxJS**, bridged
    back to signals at the component boundary with `toSignal()`. Use RxJS for the stream, signals for the
    state it produces — not as a substitute for `computed()`.
- **Dependency injection via `inject()`**, not constructor parameters, in components, directives, and
  services.

  ```typescript
  @Component({
    selector: 'app-user-panel',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [
      /* ... */
    ],
    templateUrl: './user-panel.html',
    styleUrl: './user-panel.scss',
  })
  export class UserPanel {
    private readonly repository: UserRepository = inject(UserRepository);

    // Derived state via computed() — not a manual RxJS subscription.
    protected readonly activeUsers: Signal<readonly User[]> = computed((): readonly User[] =>
      this.repository.users().filter((user: User): boolean => user.isActive),
    );
  }
  ```

- **Signal-based inputs/outputs:** `input()`, `output()`, `model()` over the `@Input()`/`@Output()`
  decorators.
- **Template-bound members are `protected`** (see [Access Modifiers](#4-access-modifiers)).
- **Built-in control flow** (`@if`, `@for`, `@switch`) over the legacy structural directives. Always provide
  `@for` `track`.
- When RxJS is used, never leak a manual subscription: consume via the `async` pipe, `toSignal()`, or
  `takeUntilDestroyed()`.
- **`@Injectable({ providedIn: 'root' })`** for singleton services.
- **Selectors:** components `app-` prefix + `kebab-case`; directives `app` prefix + `camelCase`.
- **Services hold logic; components orchestrate.** Keep components thin (presentation + delegation).

---

## 13. Electron Conventions

Security is a first-class quality concern. The process model must stay strictly separated.

- **Process separation:** `electron/main.js` (Node/main process) and `electron/preload.js` (bridge) are
  trusted; the Angular renderer is **untrusted** and runs sandboxed.
- **Locked-down `webPreferences`:** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
  These are mandatory and must never be relaxed.
- **Expose a minimal API via `contextBridge`** in the preload script. **Never expose `ipcRenderer` (or any
  Node API) directly** to the renderer — expose a narrow, purpose-named surface.

  ```javascript
  // preload — narrow, explicit, named API only.
  contextBridge.exposeInMainWorld('studio', {
    openProject: (path) => ipcRenderer.invoke('project:open', path),
  });
  ```

- **Validate every IPC payload in the main process** before acting on it — treat all renderer input as
  hostile. Prefer `ipcMain.handle`/`ipcRenderer.invoke` (request/response) over fire-and-forget `send`.
- **Name IPC channels by domain:** `project:open`, `window:minimize`.
- **Restrict navigation and window creation** (`will-navigate`, `setWindowOpenHandler`) to trusted origins.
- **Set a Content-Security-Policy** for loaded content; do not load remote, untrusted URLs into a privileged
  renderer.
- The renderer reaches privileged capability **only** through the typed `contextBridge` surface — type that
  surface and share the interface with the Angular side.

---

## 14. Testing (Vitest)

- **TDD by default:** failing test → minimum code to pass → refactor.
- **F.I.R.S.T.:** Fast, Independent, Repeatable, Self-validating, Timely.
- **Arrange / Act / Assert**, separated by blank lines.
- **One logical assertion per test.**
- **Test naming** describes method, condition, and expectation:
  `load_whenCustomerMissing_throwsCustomerNotFoundError`.
- **Test behaviour through the public API.** Private logic is exercised via the public surface, not reached
  into directly.
- Async tests `await`; never leave a floating promise in a test.
- Maximise meaningful coverage; cover the documented contract, including error paths.

```typescript
describe('CustomerService', () => {
  it('load_whenCustomerMissing_throwsCustomerNotFoundError', async () => {
    const repository: CustomerRepository = new InMemoryCustomerRepository([]);
    const service: CustomerService = new CustomerService(repository);

    const act: Promise<Customer> = service.load('missing-id');

    await expect(act).rejects.toBeInstanceOf(CustomerNotFoundError);
  });
});
```

---

## 15. Code Smells

Watch for and refactor away:

- **Rigidity** — small changes force cascading changes.
- **Fragility** — changes break unrelated parts.
- **Immobility** — code can't be reused without dragging dependencies along.
- **Viscosity** — doing the right thing is harder than the wrong thing.
- **Needless complexity** and **speculative generality** — abstraction for a future that hasn't arrived.
- **Repetition** — duplicated logic.
- **Law of Demeter violations** — `a.b.c.doSomething()`; talk only to immediate collaborators.

---

## 16. Enforcement

The baseline rules are enforced mechanically, not by review alone:

- **`tsconfig.json`:** `"strict": true` (plus the Angular strict flags) — total type safety and null checks.
- **ESLint** (`eslint.config.js`, typed rules):
  - `@typescript-eslint/explicit-member-accessibility` — enforces rule 2 (explicit modifiers).
  - `@typescript-eslint/no-explicit-any` — enforces rule 3 (no `any`).
  - `@typescript-eslint/explicit-function-return-type` — explicit return types.
  - `@typescript-eslint/typedef` (`variableDeclaration`) — explicit local-variable annotations.
  - `angular-eslint` recommended + template rules.
- **Prettier** — formatting (`printWidth: 100`).
- **Scripts:** `npm run lint` and `npm run format` must pass before a commit is pushed.

---

## Checklist

Before opening a pull request:

- [ ] Every class member has an explicit `public` / `protected` / `private` modifier.
- [ ] Every type is annotated — members, parameters, return types, **and locals**. No `any`.
- [ ] OOP by default; FP used only where it reads better.
- [ ] Names are intention-revealing; classes are nouns, methods are verbs, booleans are predicates.
- [ ] Functions are small, do one thing, and take ≤ 2 parameters (or a parameter object).
- [ ] No silent `null`/`undefined`; failures throw typed errors; no floating promises.
- [ ] Every member — including `private` — has genuine TSDoc with the correct opening phrase.
- [ ] Comments explain _why_; no commented-out code; no untracked `TODO`s.
- [ ] Angular: standalone, signals/`computed`, `OnPush`, `inject()`, `protected` template members, built-in
      control flow.
- [ ] Electron: `contextIsolation`/`sandbox` on, `nodeIntegration` off, narrow `contextBridge` API, IPC
      validated.
- [ ] Tests follow AAA + FIRST, named `method_condition_expectation`, behaviour tested via public API.
- [ ] `npm run lint` and Prettier pass.
