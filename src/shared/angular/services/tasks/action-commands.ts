import { DirectoryEntry, DirectoryListing } from '@shared/api/workspace-channels';
import { ProjectAction, ProjectEntry } from '@shared/api/project-system';

/**
 * The build toolchain a workspace root is driven by. Finer-grained than a project system's `kind`: the
 * JVM's kind covers both Gradle and Maven, and C/C++'s covers both CMake and Make, but each names a
 * project differently and so compiles its own commands.
 */
export type BuildFamily =
  | 'dotnet'
  | 'gradle'
  | 'maven'
  | 'cmake'
  | 'make'
  | 'cargo'
  | 'go'
  | 'node';

/**
 * Matches a .NET solution or project file by extension, used to detect a .NET workspace root.
 */
const DOTNET_PROJECT_PATTERN: RegExp = /\.(sln|slnx|csproj|fsproj|vbproj)$/i;

/**
 * Matches a Gradle build or settings script (Groovy or Kotlin DSL), used to detect a Gradle workspace
 * root.
 */
const GRADLE_SCRIPT_PATTERN: RegExp = /^(build|settings)\.gradle(\.kts)?$/;

/**
 * Matches a GNU or POSIX makefile, used to detect a Make workspace root.
 */
const MAKEFILE_PATTERN: RegExp = /^(GNUmakefile|[Mm]akefile)$/;

/**
 * Determines whether the root holds a file with the given name.
 * @param root The workspace root listing.
 * @param name The file name.
 * @returns Returns true when the file is present.
 */
function hasEntry(root: DirectoryListing, name: string): boolean {
  return root.entries.some(
    (entry: DirectoryEntry): boolean => entry.type === 'file' && entry.name === name,
  );
}

/**
 * Determines whether the root holds a file matching the given pattern.
 * @param root The workspace root listing.
 * @param pattern The pattern to match file names against.
 * @returns Returns true when a matching file is present.
 */
function hasMatch(root: DirectoryListing, pattern: RegExp): boolean {
  return root.entries.some(
    (entry: DirectoryEntry): boolean => entry.type === 'file' && pattern.test(entry.name),
  );
}

/**
 * Determines whether the workspace root holds a .NET solution or project file.
 * @param root The workspace root listing.
 * @returns Returns true when a .NET project is present.
 */
export function hasDotnetProject(root: DirectoryListing): boolean {
  return hasMatch(root, DOTNET_PROJECT_PATTERN);
}

/**
 * Determines whether the workspace root holds a Gradle build (a build or settings script).
 * @param root The workspace root listing.
 * @returns Returns true when a Gradle script is present.
 */
export function hasGradleProject(root: DirectoryListing): boolean {
  return hasMatch(root, GRADLE_SCRIPT_PATTERN);
}

/**
 * Determines whether the workspace root holds a Maven project (a `pom.xml`).
 * @param root The workspace root listing.
 * @returns Returns true when a pom is present.
 */
export function hasMavenProject(root: DirectoryListing): boolean {
  return hasEntry(root, 'pom.xml');
}

/**
 * Determines whether the workspace root holds a CMake project (a `CMakeLists.txt`).
 * @param root The workspace root listing.
 * @returns Returns true when a `CMakeLists.txt` is present.
 */
export function hasCmakeProject(root: DirectoryListing): boolean {
  return hasEntry(root, 'CMakeLists.txt');
}

/**
 * Determines whether the workspace root holds a Make project (a GNU or POSIX makefile).
 * @param root The workspace root listing.
 * @returns Returns true when a makefile is present.
 */
export function hasMakeProject(root: DirectoryListing): boolean {
  return hasMatch(root, MAKEFILE_PATTERN);
}

/**
 * Determines whether the workspace root holds a Cargo project (a `Cargo.toml`).
 * @param root The workspace root listing.
 * @returns Returns true when a Cargo manifest is present.
 */
export function hasCargoProject(root: DirectoryListing): boolean {
  return hasEntry(root, 'Cargo.toml');
}

/**
 * Determines whether the workspace root holds a Go module (a `go.mod`).
 * @param root The workspace root listing.
 * @returns Returns true when a Go module manifest is present.
 */
export function hasGoProject(root: DirectoryListing): boolean {
  return hasEntry(root, 'go.mod');
}

/**
 * Determines whether the workspace root holds a Node package manifest.
 * @param root The workspace root listing.
 * @returns Returns true when a `package.json` is present.
 */
export function hasNodeProject(root: DirectoryListing): boolean {
  return hasEntry(root, 'package.json');
}

/**
 * Detects the build family a workspace root is driven by.
 *
 * Unlike task discovery — where a root may legitimately yield both .NET and npm tasks — a root has
 * exactly one family that owns its capability actions, so the first match wins. The order is
 * deliberate and load-bearing: a compiled ecosystem's root very often also carries a `package.json`
 * for its tooling, and the toolchain that compiles the sources owns the actions, so Node is tested
 * last and only wins when nothing else claims the root.
 * @param root The workspace root listing.
 * @returns Returns the build family, or null when the root belongs to none.
 */
export function detectBuildFamily(root: DirectoryListing): BuildFamily | null {
  if (hasDotnetProject(root)) {
    return 'dotnet';
  }
  if (hasGradleProject(root)) {
    return 'gradle';
  }
  if (hasMavenProject(root)) {
    return 'maven';
  }
  if (hasCmakeProject(root)) {
    return 'cmake';
  }
  if (hasMakeProject(root)) {
    return 'make';
  }
  if (hasCargoProject(root)) {
    return 'cargo';
  }
  if (hasGoProject(root)) {
    return 'go';
  }
  if (hasNodeProject(root)) {
    return 'node';
  }
  return null;
}

/**
 * Resolves the Gradle invocation for a root, preferring the checked-in wrapper over a system Gradle.
 * @param root The workspace root listing.
 * @returns Returns `./gradlew` when the wrapper is present, else `gradle`.
 */
export function gradleCommand(root: DirectoryListing): string {
  return hasEntry(root, 'gradlew') ? './gradlew' : 'gradle';
}

/**
 * Resolves the Maven invocation for a root, preferring the checked-in wrapper over a system Maven.
 * @param root The workspace root listing.
 * @returns Returns `./mvnw` when the wrapper is present, else `mvn`.
 */
export function mavenCommand(root: DirectoryListing): string {
  return hasEntry(root, 'mvnw') ? './mvnw' : 'mvn';
}

/**
 * Compiles a capability action into a shell command for the workspace as a whole, or null when the
 * family has no command for it.
 * @param action The action.
 * @param family The workspace's build family.
 * @param root The workspace root listing, used to prefer a checked-in wrapper.
 * @returns Returns the command, or null.
 */
export function commandForAction(
  action: ProjectAction,
  family: BuildFamily,
  root: DirectoryListing,
): string | null {
  switch (family) {
    case 'dotnet':
      return dotnetAction(action);
    case 'gradle':
      return gradleAction(action, gradleCommand(root));
    case 'maven':
      return mavenAction(action, mavenCommand(root));
    case 'cmake':
      return cmakeAction(action);
    case 'make':
      return makeAction(action);
    case 'cargo':
      return cargoAction(action);
    case 'go':
      return goAction(action);
    case 'node':
      return nodeAction(action);
  }
}

/**
 * Determines whether a build family can express an action against a single project.
 *
 * A family is listed here only when naming one project means something the whole-workspace command
 * does not already mean:
 *
 * - **CMake, Make and Go** model exactly one project per root (the root build, makefile, or module),
 *   so a per-project verb would compile to the workspace verb — offering it would be the silent
 *   whole-workspace build this feature exists to prevent.
 * - **npm** derives its actions from a manifest's own scripts, and only the root manifest is read into
 *   the project model; which verbs a workspace member backs is therefore unknown, and guessing would
 *   offer verbs with no script behind them.
 * @param action The action.
 * @param family The workspace's build family.
 * @returns Returns true when the family has a per-project form for the action.
 */
export function supportsProjectAction(action: ProjectAction, family: BuildFamily): boolean {
  switch (family) {
    case 'dotnet':
      return true;
    case 'gradle':
    case 'maven':
      return action === 'build' || action === 'clean' || action === 'test';
    case 'cargo':
      return action === 'build' || action === 'clean' || action === 'rebuild';
    case 'cmake':
    case 'make':
    case 'go':
    case 'node':
      return false;
  }
}

/**
 * Compiles a capability action into a shell command targeting a single project, or null when the
 * family has no per-project form for it or the project cannot be located beneath the root.
 *
 * A null is never a licence to run the workspace command instead — the caller surfaces it rather than
 * quietly widening what the user asked for.
 * @param action The action.
 * @param family The workspace's build family.
 * @param root The workspace root listing, used to prefer a checked-in wrapper.
 * @param project The project to target.
 * @returns Returns the command, or null.
 */
export function commandForProjectAction(
  action: ProjectAction,
  family: BuildFamily,
  root: DirectoryListing,
  project: ProjectEntry,
): string | null {
  if (!supportsProjectAction(action, family)) {
    return null;
  }
  switch (family) {
    case 'dotnet':
      return dotnetProjectAction(action, project.path);
    case 'gradle':
      return gradleProjectAction(
        action,
        gradleCommand(root),
        relativeDirectory(root.path, project),
      );
    case 'maven':
      return mavenProjectAction(action, mavenCommand(root), relativeDirectory(root.path, project));
    case 'cargo':
      return cargoProjectAction(action, project.name);
    default:
      return null;
  }
}

/**
 * Resolves the directory a project's manifest sits in, expressed relative to the workspace root with
 * forward slashes. An empty string means the project *is* the root build; null means it lies outside
 * the root altogether, which the reactor- and build-path-addressed families cannot name.
 * @param root The absolute workspace root.
 * @param project The project.
 * @returns Returns the relative directory, an empty string for the root project, or null.
 */
function relativeDirectory(root: string, project: ProjectEntry): string | null {
  const base: string = root.replace(/[\\/]+$/, '');
  const separator: number = Math.max(project.path.lastIndexOf('/'), project.path.lastIndexOf('\\'));
  const directory: string = separator <= 0 ? '' : project.path.slice(0, separator);
  if (directory === base) {
    return '';
  }
  if (!directory.startsWith(`${base}/`) && !directory.startsWith(`${base}\\`)) {
    return null;
  }
  return directory.slice(base.length + 1).replace(/\\/g, '/');
}

/**
 * Compiles a per-project action into a `dotnet` command. Every .NET verb takes a project file, so all
 * six narrow cleanly.
 * @param action The action.
 * @param projectPath The absolute path of the project file.
 * @returns Returns the command, or null.
 */
function dotnetProjectAction(action: ProjectAction, projectPath: string): string | null {
  switch (action) {
    case 'build':
      return `dotnet build "${projectPath}"`;
    case 'clean':
      return `dotnet clean "${projectPath}"`;
    case 'rebuild':
      return `dotnet build "${projectPath}" --no-incremental`;
    case 'test':
      return `dotnet test "${projectPath}"`;
    case 'publish':
      return `dotnet publish "${projectPath}"`;
    case 'restore':
      return `dotnet restore "${projectPath}"`;
  }
}

/**
 * Compiles a per-project action into a Gradle command, addressing the module by its Gradle project
 * path (`:a:b:build`). The root project takes the unprefixed task, which is the whole build — and is
 * what the root row honestly stands for.
 * @param action The action.
 * @param gradle The Gradle invocation (the wrapper when present, else `gradle`).
 * @param relative The module's directory relative to the root, or null when it lies outside.
 * @returns Returns the command, or null.
 */
function gradleProjectAction(
  action: ProjectAction,
  gradle: string,
  relative: string | null,
): string | null {
  const task: string | null = gradleAction(action, gradle);
  if (task === null || relative === null) {
    return null;
  }
  if (relative === '') {
    return task;
  }
  // Gradle's task name is the action's own name for each of the three verbs it declares.
  return `${gradle} :${relative.split('/').join(':')}:${action}`;
}

/**
 * Compiles a per-project action into a Maven command, selecting the module with `-pl`.
 *
 * Build and test also pass `-am`, so the module's sibling dependencies are made as needed: without it
 * a reactor module fails the moment it depends on a sibling that has not been installed, which reads
 * as the feature being broken rather than as Maven being asked for too little. Clean does not, since
 * cleaning a module's dependencies is not what cleaning it means.
 * @param action The action.
 * @param mvn The Maven invocation (the wrapper when present, else `mvn`).
 * @param relative The module's directory relative to the root, or null when it lies outside.
 * @returns Returns the command, or null.
 */
function mavenProjectAction(
  action: ProjectAction,
  mvn: string,
  relative: string | null,
): string | null {
  const whole: string | null = mavenAction(action, mvn);
  if (whole === null || relative === null) {
    return null;
  }
  if (relative === '') {
    return whole;
  }
  const goal: string = action === 'build' ? 'package' : action;
  const alsoMake: string = action === 'clean' ? '' : ' -am';
  return `${mvn} -pl "${relative}"${alsoMake} ${goal}`;
}

/**
 * Compiles a per-project action into a Cargo command, selecting the package with `-p`. Cargo addresses
 * a workspace member by package name, which is what the Rust project system records as a project's
 * name.
 * @param action The action.
 * @param name The package name.
 * @returns Returns the command, or null.
 */
function cargoProjectAction(action: ProjectAction, name: string): string | null {
  switch (action) {
    case 'build':
      return `cargo build -p ${name}`;
    case 'clean':
      return `cargo clean -p ${name}`;
    case 'rebuild':
      return `cargo clean -p ${name} && cargo build -p ${name}`;
    default:
      return null;
  }
}

/**
 * Compiles a capability action into a `dotnet` command, or null when .NET has none for it.
 * @param action The action.
 * @returns Returns the command, or null.
 */
function dotnetAction(action: ProjectAction): string | null {
  switch (action) {
    case 'build':
      return 'dotnet build';
    case 'clean':
      return 'dotnet clean';
    case 'rebuild':
      return 'dotnet build --no-incremental';
    case 'test':
      return 'dotnet test';
    case 'publish':
      return 'dotnet publish';
    case 'restore':
      return 'dotnet restore';
  }
}

/**
 * Compiles a capability action into a Gradle command, or null when Gradle has none for it. Gradle
 * declares only Build/Clean/Test (see the JVM project system's capabilities).
 * @param action The action.
 * @param gradle The Gradle invocation (the wrapper when present, else `gradle`).
 * @returns Returns the command, or null.
 */
function gradleAction(action: ProjectAction, gradle: string): string | null {
  switch (action) {
    case 'build':
      return `${gradle} build`;
    case 'clean':
      return `${gradle} clean`;
    case 'test':
      return `${gradle} test`;
    default:
      return null;
  }
}

/**
 * Compiles a capability action into a Maven command, or null when Maven has none for it. Maven
 * declares only Build/Clean/Test (see the JVM project system's capabilities).
 * @param action The action.
 * @param mvn The Maven invocation (the wrapper when present, else `mvn`).
 * @returns Returns the command, or null.
 */
function mavenAction(action: ProjectAction, mvn: string): string | null {
  switch (action) {
    case 'build':
      return `${mvn} package`;
    case 'clean':
      return `${mvn} clean`;
    case 'test':
      return `${mvn} test`;
    default:
      return null;
  }
}

/**
 * Compiles a capability action into a CMake command, or null when CMake has none for it. The build
 * configures into a `build/` directory first (idempotent), so Build works from a fresh checkout;
 * Clean and Rebuild act on that configured tree. CMake declares Build/Clean/Rebuild (see the C/C++
 * project system's capabilities).
 * @param action The action.
 * @returns Returns the command, or null.
 */
function cmakeAction(action: ProjectAction): string | null {
  switch (action) {
    case 'build':
      return 'cmake -S . -B build && cmake --build build';
    case 'clean':
      return 'cmake --build build --target clean';
    case 'rebuild':
      return 'cmake -S . -B build && cmake --build build --clean-first';
    default:
      return null;
  }
}

/**
 * Compiles a capability action into a Make command, or null when Make has none for it.
 * @param action The action.
 * @returns Returns the command, or null.
 */
function makeAction(action: ProjectAction): string | null {
  switch (action) {
    case 'build':
      return 'make';
    case 'clean':
      return 'make clean';
    case 'rebuild':
      return 'make clean && make';
    default:
      return null;
  }
}

/**
 * Compiles a capability action into a Cargo command, or null when Cargo has none for it. Cargo
 * declares Build/Clean/Rebuild (see the Rust project system's capabilities).
 * @param action The action.
 * @returns Returns the command, or null.
 */
function cargoAction(action: ProjectAction): string | null {
  switch (action) {
    case 'build':
      return 'cargo build';
    case 'clean':
      return 'cargo clean';
    case 'rebuild':
      return 'cargo clean && cargo build';
    default:
      return null;
  }
}

/**
 * Compiles a capability action into a Go command, or null when Go has none for it. Go declares
 * Build/Clean/Rebuild (see the Go project system's capabilities); rebuild forces a full recompile
 * with `-a`.
 * @param action The action.
 * @returns Returns the command, or null.
 */
function goAction(action: ProjectAction): string | null {
  switch (action) {
    case 'build':
      return 'go build ./...';
    case 'clean':
      return 'go clean';
    case 'rebuild':
      return 'go build -a ./...';
    default:
      return null;
  }
}

/**
 * Compiles a capability action into an npm command, or null when npm has none for it. Each action
 * runs the conventional script of the same name — the scripts the Node project system declares its
 * actions from, so a declared action always has a script behind it. Rebuild is never declared: npm
 * scripts have no incremental/from-clean distinction to honour.
 * @param action The action.
 * @returns Returns the command, or null.
 */
function nodeAction(action: ProjectAction): string | null {
  switch (action) {
    case 'build':
    case 'clean':
    case 'test':
      return `npm run ${action}`;
    default:
      return null;
  }
}
