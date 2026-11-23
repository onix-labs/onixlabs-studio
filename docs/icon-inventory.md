# Studio icon inventory

Generated on 23 November 2026 from the code on `spike/icon-themes-jetbrains`.

**How to read it.** _Today_ is the Phosphor drawing Studio uses. _JetBrains_ is the closest drawing found in the IntelliJ Platform repository, which is sometimes only a stand-in; **(no notice)** means the file carries no Apache 2.0 notice and needs confirming. _Same_ marks a drawing already listed above, which needs no new artwork.

## Summary

| Part                                      | Count                                 |
| ----------------------------------------- | ------------------------------------- |
| 1a. Explorer rows today                   | 6                                     |
| 1b. Suggested extra explorer rows         | 7                                     |
| 1c. Suggested folder types                | 10                                    |
| 1d. File types Studio already knows       | 75                                    |
| 1e. Suggested extra file types            | 50                                    |
| 2a. Suggestion list kinds                 | 29                                    |
| 2b. Further symbol kinds                  | 10                                    |
| 2c. Suggested extra symbols               | 13                                    |
| 2d. Suggested markers                     | 7                                     |
| 3. Every entry in Studio's icon set today | 537 entries, 425 drawings, 275 shapes |

_Drawings_ counts each weight of a shape separately; _shapes_ does not. 27 entries have no use that a search of the code can find; they are marked in part 3.

Every icon needs a light and a dark version, drawn as SVG on a 16×16 grid.

## 1. Explorers

### 1a. Rows drawn today

| Row                                 | Today                         | JetBrains     | Note                               |
| ----------------------------------- | ----------------------------- | ------------- | ---------------------------------- |
| Solution                            | `ph-tree-structure`           | `moduleGroup` | Stand-in only                      |
| Project, any language               | `ph-duotone ph-cube`          | `module`      | Stand-in only                      |
| Folder, closed                      | `ph-duotone ph-folder-simple` | `folder`      |                                    |
| Folder, open                        | `ph-duotone ph-folder-open`   | None found    | JetBrains uses one folder for both |
| Solution folder (no folder on disk) | `ph-duotone ph-folder-simple` | None found    | Same drawing as a folder today     |
| Workspace root, no solution file    | `ph-tree-structure`           | `workspace`   |                                    |

### 1b. Suggested extra rows

Studio draws these the same as any other project or folder, or not at all.

| Row                                   | Where                 |
| ------------------------------------- | --------------------- |
| .NET project: C#                      | .csproj               |
| .NET project: F#                      | .fsproj               |
| .NET project: VB                      | .vbproj               |
| C++ project                           | .vcxproj              |
| Test project                          | by its test framework |
| Web project                           | by its SDK            |
| Dependencies, packages and references | under a project       |

### 1c. Suggested folder types

Studio draws every folder the same today.

| Folder              | Names                              | JetBrains       |
| ------------------- | ---------------------------------- | --------------- |
| Source              | src, source                        | `sourceRoot`    |
| Tests               | test, tests, spec, e2e             | `testRoot`      |
| Resources or assets | resources, assets                  | `resourcesRoot` |
| Build output        | bin, obj, dist, build, out, target | `excludeRoot`   |
| Packages            | node_modules, packages, lib        | `libraryFolder` |
| Web root            | wwwroot, public                    | `webFolder`     |
| GitHub              | .github                            | `folderGithub`  |
| Properties          | Properties                         | None found      |
| Documentation       | docs                               | None found      |
| Scripts             | scripts, tools                     | None found      |

### 1d. File types Studio already knows

From its languages, project systems, image viewer, decoders and document types. _Generic_ means a plain file icon today. _Today_ goes by the first extension listed. The two explorers differ: only the File Explorer has icons for stylesheets, HTML and hidden files, and only the Solution Explorer has one for XML, C# projects and build properties.

#### .NET

| Icon                      | Files                                  | Today               | JetBrains            |
| ------------------------- | -------------------------------------- | ------------------- | -------------------- |
| C#                        | .cs                                    | `ph-file`           | `Csharp` (no notice) |
| C# project                | .csproj                                | `ph-brackets-curly` | `module`             |
| F# project                | .fsproj                                | Generic             | `module`             |
| VB project                | .vbproj                                | Generic             | `module`             |
| Solution                  | .sln, .slnx                            | Generic             | `moduleGroup`        |
| Build properties          | .props, .targets, Directory.Build.*    | `ph-brackets-curly` | `xml`                |
| NuGet configuration       | nuget.config, packages.config, .nuspec | Generic             | None found           |
| Application configuration | app.config, web.config                 | Generic             | `config`             |
| Resources                 | .resx                                  | Generic             | None found           |
| XAML                      | .xaml, .axaml                          | Generic             | `xml`                |
| Razor                     | .razor, .cshtml                        | Generic             | None found           |
| Web Forms page            | .aspx                                  | Generic             | None found           |
| VB                        | .vb                                    | Generic             | None found           |
| Debug symbols             | .pdb                                   | Generic             | `binaryData`         |

#### JVM

| Icon                 | Files                    | Today   | JetBrains            |
| -------------------- | ------------------------ | ------- | -------------------- |
| Java                 | .java                    | Generic | `java`               |
| Java class, compiled | .class                   | Generic | `javaClass`          |
| Kotlin               | .kt                      | Generic | `kotlin`             |
| Kotlin script        | .kts                     | Generic | `kotlinScript`       |
| Gradle               | .gradle, settings.gradle | Generic | `gradle`             |
| Gradle, Kotlin       | build.gradle.kts         | Generic | `kotlinGradleScript` |
| Maven                | pom.xml                  | Generic | `maven`              |
| Version catalogue    | libs.versions.toml       | Generic | `toml`               |

#### Web

| Icon                     | Files                                        | Today               | JetBrains         |
| ------------------------ | -------------------------------------------- | ------------------- | ----------------- |
| JavaScript               | .js, .mjs, .cjs                              | `ph-file-js`        | `javaScript`      |
| React, JavaScript        | .jsx                                         | Generic             | None found        |
| TypeScript               | .ts, .mts, .cts                              | `ph-file-ts`        | `typeScript`      |
| React, TypeScript        | .tsx                                         | Generic             | None found        |
| TypeScript declarations  | .d.ts                                        | `ph-file-ts`        | None found        |
| HTML                     | .html, .htm                                  | `ph-file-html`      | `html`            |
| CSS                      | .css                                         | `ph-file-css`       | `css`             |
| Sass                     | .scss, .sass                                 | `ph-file-css`       | None found        |
| Less                     | .less                                        | `ph-file-css`       | None found        |
| Vue                      | .vue                                         | Generic             | `vue` (no notice) |
| Svelte                   | .svelte                                      | Generic             | None found        |
| Node package             | package.json                                 | `ph-brackets-curly` | None found        |
| TypeScript configuration | tsconfig.json                                | `ph-brackets-curly` | None found        |
| Package lock             | package-lock.json, yarn.lock, pnpm-lock.yaml | Generic             | None found        |

#### Other languages

| Icon            | Files                                                               | Today   | JetBrains               |
| --------------- | ------------------------------------------------------------------- | ------- | ----------------------- |
| C               | .c                                                                  | Generic | `c` (no notice)         |
| C++             | .cpp, .cc, .cxx, .c++, .cppm, .ixx                                  | Generic | `cpp` (no notice)       |
| C or C++ header | .h, .hpp, .hh, .hxx, .inl, .ipp, .tpp                               | Generic | `h` (no notice)         |
| Go              | .go                                                                 | Generic | `go` (no notice)        |
| Go module       | go.mod, go.sum, go.work                                             | Generic | `go` (no notice)        |
| Rust            | .rs                                                                 | Generic | `rust` (no notice)      |
| Cargo           | Cargo.toml, Cargo.lock                                              | Generic | `toml`                  |
| Python          | .py, .pyi, .pyw                                                     | Generic | `python`                |
| Python project  | pyproject.toml, requirements.txt, setup.py, setup.cfg, Pipfile.lock | Generic | None found              |
| PHP             | .php                                                                | Generic | `php` (no notice)       |
| Ruby            | .rb                                                                 | Generic | `ruby` (no notice)      |
| Swift           | .swift                                                              | Generic | `swiftLang` (no notice) |
| R               | .r                                                                  | Generic | None found              |
| Lua             | .lua                                                                | Generic | None found              |
| Perl            | .pl                                                                 | Generic | `perl`                  |
| Shell           | .sh, .bash, .zsh                                                    | Generic | `shell`                 |
| PowerShell      | .ps1                                                                | Generic | None found              |

#### Build and infrastructure

| Icon   | Files                                  | Today   | JetBrains  |
| ------ | -------------------------------------- | ------- | ---------- |
| CMake  | CMakeLists.txt, .cmake                 | Generic | None found |
| Make   | Makefile                               | Generic | None found |
| Docker | Dockerfile, Containerfile, .dockerfile | Generic | `docker`   |

#### Data and configuration

| Icon                     | Files          | Today               | JetBrains  |
| ------------------------ | -------------- | ------------------- | ---------- |
| JSON                     | .json          | `ph-brackets-curly` | `json`     |
| XML                      | .xml, .plist   | `ph-brackets-curly` | `xml`      |
| XML schema               | .xsd           | Generic             | `xsd`      |
| XSLT                     | .xsl, .xslt    | Generic             | None found |
| YAML                     | .yaml, .yml    | Generic             | `yaml`     |
| TOML                     | .toml          | Generic             | `toml`     |
| SQL                      | .sql           | Generic             | `sql`      |
| Cypher                   | .cypher, .cql  | Generic             | None found |
| GraphQL                  | .graphql       | Generic             | `graphql`  |
| Studio API document      | .api.json      | `ph-brackets-curly` | None found |
| Studio database document | .database.json | `ph-brackets-curly` | None found |

#### Documents, media and binaries

| Icon                  | Files                                                    | Today            | JetBrains    |
| --------------------- | -------------------------------------------------------- | ---------------- | ------------ |
| Markdown              | .md                                                      | `ph-file-md`     | `markdown`   |
| Text                  | .txt                                                     | Generic          | `text`       |
| Image                 | .png, .jpg, .jpeg, .gif, .webp, .avif, .bmp, .ico, .apng | Generic          | `image`      |
| SVG                   | .svg                                                     | Generic          | `image`      |
| Executable or library | PE, ELF and Mach-O files                                 | Generic          | `binaryData` |
| WebAssembly           | .wasm                                                    | Generic          | None found   |
| Hidden file           | any dotfile                                              | `ph-file-dashed` | None found   |
| Any other file        |                                                          | `ph-file`        | `anyType`    |

### 1e. Suggested extra file types

Common in projects Studio opens. A few are recognised elsewhere in Studio, but none has an icon or language of its own today.

| Icon                | Files                                              | JetBrains             |
| ------------------- | -------------------------------------------------- | --------------------- |
| F#                  | .fs, .fsx, .fsi                                    | None found            |
| C# script           | .csx                                               | None found            |
| Solution filter     | .slnf                                              | None found            |
| C++ project         | .vcxproj                                           | None found            |
| SQL project         | .sqlproj                                           | None found            |
| T4 template         | .tt                                                | None found            |
| Launch settings     | launchSettings.json, appsettings.json, global.json | None found            |
| Scala               | .scala, .sbt                                       | `scala` (no notice)   |
| Groovy              | .groovy                                            | `groovy`              |
| Dart                | .dart                                              | None found            |
| Elixir              | .ex, .exs                                          | None found            |
| Haskell             | .hs                                                | None found            |
| OCaml               | .ml, .mli                                          | None found            |
| Zig                 | .zig                                               | None found            |
| Clojure             | .clj                                               | None found            |
| Objective-C         | .m, .mm                                            | None found            |
| Assembly            | .asm, .s                                           | None found            |
| Batch               | .bat, .cmd                                         | None found            |
| Jupyter notebook    | .ipynb                                             | `jupyter` (no notice) |
| Git files           | .gitignore, .gitattributes, .gitmodules            | `gitignore`           |
| EditorConfig        | .editorconfig                                      | `editorConfig`        |
| Ignore files        | .dockerignore, .npmignore                          | `ignored`             |
| Environment         | .env                                               | None found            |
| INI and similar     | .ini, .conf, .cfg                                  | `config`              |
| Properties          | .properties                                        | `properties`          |
| CSV                 | .csv, .tsv                                         | `csv`                 |
| HTTP requests       | .http, .rest                                       | `http`                |
| Patch               | .patch, .diff                                      | `patch`               |
| Log                 | .log                                               | None found            |
| Licence             | LICENSE                                            | None found            |
| Read me             | README                                             | None found            |
| Terraform           | .tf                                                | `terraform`           |
| Compose             | compose.yaml                                       | `docker`              |
| Kubernetes          | manifests, Chart.yaml                              | None found            |
| GitHub workflow     | .github/workflows/*.yml                            | None found            |
| Protocol Buffers    | .proto                                             | None found            |
| Archive             | .zip, .tar, .gz, .7z                               | `archive`             |
| Package             | .nupkg, .jar, .vsix                                | `archive`             |
| Font                | .ttf, .otf, .woff2                                 | `font`                |
| Certificate or key  | .pem, .pfx, .crt, .key                             | None found            |
| Database file       | .db, .sqlite, .mdf                                 | None found            |
| PDF                 | .pdf                                               | None found            |
| Office documents    | .docx, .xlsx, .pptx                                | None found            |
| Audio               | .mp3, .wav                                         | None found            |
| Video               | .mp4, .mov                                         | None found            |
| Source map          | .map                                               | `sourceMap`           |
| Diagram             | .drawio, .puml                                     | `diagram`             |
| Angular             | angular.json, component files                      | None found            |
| ESLint and Prettier | eslint.config.*, .prettierrc                       | None found            |
| Test files          | *.spec.ts, *_test.go                               | None found            |

## 2. Code symbols

### 2a. The suggestion list (IntelliSense)

All 29 kinds the editor knows. **Shared** marks a kind that looks the same as another today.

| Kind           | Today                 | Shared | JetBrains          |
| -------------- | --------------------- | ------ | ------------------ |
| Method         | `ph-function`         | Yes    | `method`           |
| Function       | `ph-function`         | Yes    | `function`         |
| Constructor    | `ph-function`         | Yes    | `constructor`      |
| Field          | `ph-tag`              |        | `field`            |
| Variable       | `ph-cube-transparent` |        | `variable`         |
| Class          | `ph-cube`             | Yes    | `class`            |
| Struct         | `ph-cube`             | Yes    | None found         |
| Interface      | `ph-plugs`            |        | `interface`        |
| Module         | `ph-brackets-curly`   |        | `module`           |
| Property       | `ph-wrench`           |        | `property`         |
| Event          | `ph-lightning`        |        | None found         |
| Operator       | `ph-plus-minus`       |        | None found         |
| Unit           | `ph-ruler`            |        | None found         |
| Value          | `ph-hash`             |        | None found         |
| Constant       | `ph-pi`               |        | `constant`         |
| Enum           | `ph-list-numbers`     | Yes    | `enum`             |
| Enum member    | `ph-list-numbers`     | Yes    | None found         |
| Keyword        | `ph-key`              |        | None found         |
| Text           | `ph-text-aa`          |        | `word` (no notice) |
| Colour         | `ph-palette`          | Yes    | None found         |
| Custom colour  | `ph-palette`          | Yes    | None found         |
| File           | `ph-file`             |        | `anyType`          |
| Reference      | `ph-link`             |        | `methodReference`  |
| Folder         | `ph-folder`           |        | `folder`           |
| Type parameter | `ph-brackets-angle`   |        | `type`             |
| Snippet        | `ph-code-block`       |        | `template`         |
| User           | `ph-dot-outline`      | Yes    | None found         |
| Issue          | `ph-dot-outline`      | Yes    | None found         |
| Tool           | `ph-dot-outline`      | Yes    | None found         |

### 2b. Further kinds, in Go to Symbol

The other kinds a language server can report. Most share one dot today, and so do operators and type parameters in this list.

| Kind      | Today               | JetBrains  |
| --------- | ------------------- | ---------- |
| Namespace | `ph-brackets-curly` | `package`  |
| Package   | `ph-brackets-curly` | `package`  |
| File      | `ph-brackets-curly` | `anyType`  |
| String    | `ph-dot-outline`    | None found |
| Number    | `ph-dot-outline`    | None found |
| Boolean   | `ph-dot-outline`    | None found |
| Array     | `ph-dot-outline`    | None found |
| Object    | `ph-dot-outline`    | None found |
| Key       | `ph-dot-outline`    | None found |
| Null      | `ph-dot-outline`    | None found |

### 2c. Suggested extra symbols

Language servers fold these into the kinds above, so some need Studio to work them out first.

| Symbol                  | JetBrains        |
| ----------------------- | ---------------- |
| Abstract class          | `classAbstract`  |
| Static class            | None found       |
| Record                  | `record`         |
| Delegate                | None found       |
| Exception               | `exception`      |
| Attribute or annotation | `annotation`     |
| Extension method        | None found       |
| Abstract method         | `methodAbstract` |
| Lambda                  | `lambda`         |
| Local variable          | `variable`       |
| Parameter               | `parameter`      |
| Type alias              | `alias`          |
| Test                    | `test`           |

### 2d. Suggested markers

Small marks over a symbol. Studio draws none today.

| Marker              | JetBrains         |
| ------------------- | ----------------- |
| Public              | `accessPublic`    |
| Protected           | `accessProtected` |
| Private             | `accessPrivate`   |
| Internal or package | `accessLocal`     |
| Static              | `staticMark`      |
| Final or sealed     | `finalMark`       |
| Deprecated          | None found        |

## 3. Every icon in Studio's set

Grouped as the code groups them; some sit in a group for historical reasons. _Files_ is how many code files use the icon, tests aside. **Unused** means a search found none.

### Title strip: action buttons (14)

| Purpose                                                                                                                       | Name             | Today                         | Files |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------- | ----------------------------- | ----- |
| Settings icon, shown on the settings button and the settings tab                                                              | `SETTINGS`       | `ph-gear-six`                 | 6     |
| New-tab (grid-dots) icon shown on the new-tab button                                                                          | `GRID_DOTS`      | `ph-bold ph-dots-nine`        | 1     |
| Mission-control (rocket-launch) icon shown on the title-strip button that opens the Mission Control tab and on the tab itself | `ROCKET_LAUNCH`  | `ph-duotone ph-rocket-launch` | 2     |
| Hide-empty-agents icon shown on Mission Control's View group toggle                                                           | `HIDE_EMPTY`     | `ph-duotone ph-circle-dashed` | 1     |
| Hide-idle-agents icon shown on Mission Control's View group toggle                                                            | `HIDE_IDLE`      | `ph-duotone ph-pause-circle`  | 1     |
| Hide-working-agents icon shown on Mission Control's View group toggle                                                         | `HIDE_WORKING`   | `ph-duotone ph-play-circle`   | 1     |
| Icon marking a shown agent on Mission Control's per-agent hide toggle                                                         | `AGENT_VISIBLE`  | `ph-duotone ph-eye`           | 2     |
| Icon marking a hidden agent on Mission Control's per-agent hide toggle                                                        | `AGENT_HIDDEN`   | `ph-duotone ph-eye-slash`     | 2     |
| Remote-control icon shown on an agent's Remote toggle (its tool strip and ribbon) and on Mission Control's…                   | `REMOTE_CONTROL` | `ph-duotone ph-devices`       | 3     |
| Close icon shown on tab close buttons                                                                                         | `CLOSE`          | `ph-x`                        | 32    |
| Bold close icon, used on the document well's close-all button beside its grip and document-list caret                         | `CLOSE_BOLD`     | `ph-bold ph-x`                | 1     |
| Expand icon shown on a modal's expand-to-fill control                                                                         | `ARROWS_OUT`     | `ph-arrows-out-simple`        | 1     |
| Restore icon shown on a modal's expand control once expanded                                                                  | `ARROWS_IN`      | `ph-arrows-in-simple`         | 1     |
| Frame-corners icon shown on a panel's focus control, presenting the panel in a large modal                                    | `FRAME_CORNERS`  | `ph-duotone ph-frame-corners` | 1     |

### Title strip: window lock (2)

| Purpose                                                      | Name        | Today                         | Files |
| ------------------------------------------------------------ | ----------- | ----------------------------- | ----- |
| Closed-padlock icon shown when the window is locked in place | `LOCK`      | `ph-fill ph-lock-simple`      | 7     |
| Open-padlock icon shown when the window is free to move      | `LOCK_OPEN` | `ph-bold ph-lock-simple-open` | 3     |

### Window controls (drawn by Studio on Linux) (4)

| Purpose                                                                       | Name              | Today                    | Files |
| ----------------------------------------------------------------------------- | ----------------- | ------------------------ | ----- |
| Minimize-window icon                                                          | `WINDOW_MINIMIZE` | `ph-bold ph-minus`       | 1     |
| Maximize-window icon, shown while the window is not maximized                 | `WINDOW_MAXIMIZE` | `ph-bold ph-square`      | 1     |
| Restore-window icon, shown in place of maximize while the window is maximized | `WINDOW_RESTORE`  | `ph-bold ph-copy-simple` | 1     |
| Close-window icon                                                             | `WINDOW_CLOSE`    | `ph-bold ph-x` _Same_    | 1     |

### Content types (tabs, welcome, document wells) (11)

| Purpose                                                                                 | Name                | Today                              | Files      |
| --------------------------------------------------------------------------------------- | ------------------- | ---------------------------------- | ---------- |
| Directory (workspace) content icon                                                      | `DIRECTORY`         | `ph-duotone ph-folder-simple`      | 8          |
| Code content icon                                                                       | `CODE`              | `ph-duotone ph-brackets-curly`     | 12         |
| Markdown content icon                                                                   | `MARKDOWN`          | `ph-duotone ph-markdown-logo`      | 5          |
| Filled markdown-logo icon shown on the agent composer's Edit (write-in-markdown) button | `MARKDOWN_FILL`     | `ph-fill ph-markdown-logo`         | **Unused** |
| Binary/hex content icon                                                                 | `BINARY`            | `ph-duotone ph-binary`             | 5          |
| Image content icon, shown on image tabs, image well documents and the welcome filter    | `IMAGE_FILE`        | `ph-duotone ph-image`              | 4          |
| Terminal content icon                                                                   | `TERMINAL`          | `ph-duotone ph-terminal-window`    | 15         |
| Containers (Docker) content icon                                                        | `CONTAINERS`        | `ph-duotone ph-shipping-container` | 6          |
| Icon for container images, in the Containers view's side panel                          | `CONTAINER_IMAGES`  | `ph-duotone ph-stack`              | 1          |
| The container engine's volumes (#974)                                                   | `CONTAINER_VOLUMES` | `ph-duotone ph-hard-drives`        | 1          |
| System Monitor content icon                                                             | `SYSTEM_MONITOR`    | `ph-duotone ph-gauge`              | 3          |

### System Monitor: its views (the ribbon's View group, and the Overview's cards) (83)

| Purpose                                                                                | Name                     | Today                                    | Files |
| -------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------- | ----- |
| System Monitor's Overview icon                                                         | `MONITOR_OVERVIEW`       | `ph-duotone ph-squares-four`             | 1     |
| System Monitor's CPU icon                                                              | `MONITOR_CPU`            | `ph-duotone ph-cpu`                      | 6     |
| System Monitor's Memory icon                                                           | `MONITOR_MEMORY`         | `ph-duotone ph-memory`                   | 7     |
| System Monitor's GPU icon                                                              | `MONITOR_GPU`            | `ph-duotone ph-graphics-card`            | 6     |
| System Monitor's Processes icon                                                        | `MONITOR_PROCESSES`      | `ph-duotone ph-stack` _Same_             | 4     |
| System Monitor's Storage icon                                                          | `MONITOR_STORAGE`        | `ph-duotone ph-hard-drives` _Same_       | 5     |
| System Monitor's Network icon                                                          | `MONITOR_NETWORK`        | `ph-duotone ph-wifi-high`                | 6     |
| System Monitor's System icon                                                           | `MONITOR_SYSTEM`         | `ph-duotone ph-info`                     | 4     |
| System Monitor's Logs icon                                                             | `MONITOR_LOGS`           | `ph-duotone ph-file-text`                | 3     |
| Icon for a graph over time in the System Monitor                                       | `MONITOR_TREND`          | `ph-duotone ph-chart-line`               | 3     |
| Icon for readings grouped into bars in the System Monitor                              | `MONITOR_GROUPED`        | `ph-duotone ph-chart-bar-horizontal`     | 2     |
| Icon for a ranked list in the System Monitor                                           | `MONITOR_RANKED`         | `ph-duotone ph-list-numbers`             | 3     |
| Icon for swap in the System Monitor                                                    | `MONITOR_SWAP`           | `ph-duotone ph-arrows-left-right`        | 1     |
| Icon for statistics in the System Monitor                                              | `MONITOR_STATISTICS`     | `ph-duotone ph-chart-bar`                | 4     |
| Icon for a composition over time in the System Monitor                                 | `MONITOR_COMPOSITION`    | `ph-duotone ph-stack-simple`             | 1     |
| Icon for temperature in the System Monitor                                             | `MONITOR_TEMPERATURE`    | `ph-thermometer`                         | 3     |
| Icon for power in the System Monitor                                                   | `MONITOR_POWER`          | `ph-lightning`                           | 1     |
| Icon for a fan in the System Monitor                                                   | `MONITOR_FAN`            | `ph-fan`                                 | 1     |
| Icon for the GPU's 3D engine in the System Monitor                                     | `MONITOR_ENGINE_3D`      | `ph-cube`                                | 1     |
| Icon for the GPU's video decoder in the System Monitor                                 | `MONITOR_ENGINE_DECODE`  | `ph-film-strip`                          | 1     |
| Icon for the GPU's video encoder in the System Monitor                                 | `MONITOR_ENGINE_ENCODE`  | `ph-video-camera`                        | 1     |
| Icon for the GPU's copy engine in the System Monitor                                   | `MONITOR_ENGINE_COPY`    | `ph-copy-simple`                         | 1     |
| Icon for the GPU's compute engine in the System Monitor                                | `MONITOR_ENGINE_COMPUTE` | `ph-function`                            | 1     |
| Icon for a grid layout in the System Monitor                                           | `MONITOR_GRID`           | `ph-squares-four`                        | 1     |
| Icon for a list layout in the System Monitor                                           | `MONITOR_LIST`           | `ph-rows`                                | 1     |
| Icon for the System Monitor's process list with roomy rows that carry graphs           | `MONITOR_COMFORTABLE`    | `ph-rows` _Same_                         | 1     |
| Icon for the System Monitor's process list with dense rows                             | `MONITOR_COMPACT`        | `ph-list`                                | 1     |
| Icon for choosing the columns the System Monitor's process list shows                  | `MONITOR_COLUMNS`        | `ph-columns`                             | 1     |
| Icon for going to the first page of a paged list                                       | `PAGE_FIRST`             | `ph-caret-double-left`                   | 1     |
| Icon for going to the last page of a paged list                                        | `PAGE_LAST`              | `ph-caret-double-right`                  | 1     |
| Icon for a GPU's video memory in the System Monitor                                    | `MONITOR_VRAM`           | `ph-duotone ph-circuitry`                | 1     |
| Icon for a log record's context (the values logged with its message)                   | `MONITOR_CONTEXT`        | `ph-brackets-curly`                      | 1     |
| Icon for a log record as it is stored                                                  | `MONITOR_RAW`            | `ph-code`                                | 1     |
| Icon for a storage device in the System Monitor's Storage view                         | `MONITOR_DRIVE`          | `ph-duotone ph-hard-drive`               | 1     |
| Icon for a USB storage device in the System Monitor's Storage view                     | `MONITOR_DRIVE_USB`      | `ph-duotone ph-usb`                      | 1     |
| Icon for a storage device's input/output operations in the System Monitor              | `MONITOR_IOPS`           | `ph-duotone ph-speedometer`              | 2     |
| Icon for a device's activity (how busy it is) in the System Monitor                    | `MONITOR_ACTIVITY`       | `ph-duotone ph-pulse`                    | 2     |
| Icon for a wired (Ethernet) network interface in the System Monitor                    | `MONITOR_ETHERNET`       | `ph-duotone ph-network`                  | 1     |
| Icon for a Wi-Fi network interface in the System Monitor                               | `MONITOR_WIFI`           | `ph-duotone ph-wifi-high` _Same_         | 1     |
| Icon for the loopback network interface in the System Monitor                          | `MONITOR_LOOPBACK`       | `ph-duotone ph-arrows-clockwise`         | 1     |
| Icon for a VPN or tunnel network interface in the System Monitor                       | `MONITOR_VPN`            | `ph-duotone ph-lock-key`                 | 1     |
| Icon for a bridge network interface in the System Monitor                              | `MONITOR_BRIDGE`         | `ph-duotone ph-share-network`            | 1     |
| Icon for a virtual network interface in the System Monitor                             | `MONITOR_VIRTUAL`        | `ph-duotone ph-cube`                     | 1     |
| Icon for network packets in the System Monitor                                         | `MONITOR_PACKETS`        | `ph-duotone ph-package`                  | 1     |
| Icon for network connections in the System Monitor                                     | `MONITOR_CONNECTIONS`    | `ph-duotone ph-arrows-left-right` _Same_ | 1     |
| Icon for a volume in the System Monitor's storage list                                 | `MONITOR_VOLUME`         | `ph-hard-drive`                          | 2     |
| Icon for a process in the System Monitor's process lists                               | `MONITOR_PROCESS`        | `ph-app-window`                          | 3     |
| Icon for a shell process in the System Monitor's process lists                         | `MONITOR_SHELL`          | `ph-terminal-window`                     | 2     |
| Icon for the operating system in the System Monitor's system facts                     | `MONITOR_OS`             | `ph-desktop-tower`                       | 1     |
| Icon for uptime in the System Monitor's system facts                                   | `MONITOR_UPTIME`         | `ph-clock`                               | 1     |
| Icon for the logging session in the System Monitor's system facts                      | `MONITOR_SESSION`        | `ph-user`                                | 1     |
| Arrow marking a received or read rate in the System Monitor                            | `MONITOR_IN`             | `ph-bold ph-arrow-down`                  | 4     |
| Arrow marking a sent or written rate in the System Monitor                             | `MONITOR_OUT`            | `ph-bold ph-arrow-up`                    | 4     |
| AI Manager content icon, which also stands for its Local Models sub-view               | `AI_MODELS`              | `ph-duotone ph-cpu` _Same_               | 6     |
| AI Manager's Persona sub-view icon (#1514), which replaced Prompt Profiles             | `AI_PERSONA`             | `ph-duotone ph-user-circle`              | 2     |
| Icon of a persona core entry: what every conversation is given                         | `PERSONA_CORE`           | `ph-duotone ph-push-pin`                 | 3     |
| Icon of a persona memory: what an agent looks up when it is relevant                   | `PERSONA_MEMORY`         | `ph-duotone ph-brain`                    | 5     |
| AI Manager's Skills sub-view icon                                                      | `AI_SKILLS`              | `ph-duotone ph-sparkle`                  | 3     |
| Plugins content icon, which also stands for every category at once                     | `PLUGINS`                | `ph-duotone ph-puzzle-piece`             | 3     |
| Decoders category icon                                                                 | `DECODERS`               | `ph-duotone ph-cpu` _Same_               | 1     |
| Language servers category icon                                                         | `LANGUAGE_SERVERS`       | `ph-duotone ph-desktop-tower`            | 1     |
| Light weight of each category's glyph, used on a plugin row                            | `PLUGINS_LIGHT`          | `ph-light ph-puzzle-piece`               | 1     |
| Light weight of the AI agents glyph, for a plugin row                                  | `AGENT_LIGHT`            | `ph-light ph-brain`                      | 1     |
| Light weight of the container engines glyph, for a plugin row                          | `CONTAINERS_LIGHT`       | `ph-light ph-shipping-container`         | 1     |
| Light weight of the debug adapters glyph, for a plugin row                             | `DEBUG_LIGHT`            | `ph-light ph-bug`                        | 1     |
| Light weight of the decoders glyph, for a plugin row                                   | `DECODERS_LIGHT`         | `ph-light ph-cpu`                        | 1     |
| Light weight of the language servers glyph, for a plugin row                           | `LANGUAGE_SERVERS_LIGHT` | `ph-light ph-desktop-tower`              | 1     |
| Agent content icon                                                                     | `AGENT`                  | `ph-duotone ph-brain` _Same_             | 25    |
| The bell shown when agent requests are waiting for the user                            | `BELL`                   | `ph-duotone ph-bell-ringing`             | 1     |
| The bell shown on the notification tray's trigger while notifications are muted        | `BELL_SLASH`             | `ph-duotone ph-bell-slash`               | 1     |
| Thin agent (brain) glyph shown large in the agent panel's empty state                  | `AGENT_EMPTY`            | `ph-thin ph-brain`                       | 1     |
| Glyph marking the agent's reasoning (a settled thinking disclosure in the transcript)  | `THINKING`               | `ph-brain`                               | 1     |
| Glyph for an attached editor selection (agent context)                                 | `SELECTION`              | `ph-selection`                           | 3     |
| Glyph marking a sub-agent lane (a Task spawning nested work) in the agent transcript   | `SUBAGENT`               | `ph-duotone ph-robot`                    | 2     |
| Sparkle glyph marking an AI-assisted action (for example generating a commit message)  | `SPARKLE`                | `ph-sparkle`                             | 3     |
| Generic action glyph shown on an agent tool-call timeline node                         | `ACTION`                 | `ph-lightning` _Same_                    | 3     |
| Glyph on a timeline node for a tool that reads a file or document                      | `TOOL_READ`              | `ph-newspaper-clipping`                  | 1     |
| Glyph on a timeline node for a tool that writes or edits a file or document            | `TOOL_WRITE`             | `ph-pencil-simple`                       | 1     |
| Glyph on a timeline node for a permission prompt (the agent asking to run something)   | `PROMPT_PERMISSION`      | `ph-shield`                              | 1     |
| Glyph on a timeline node for a question the agent asks the user                        | `PROMPT_QUESTION`        | `ph-question`                            | 1     |
| Glyph on a timeline node for an edit decision (a staged edit awaiting apply or reject) | `PROMPT_EDIT`            | `ph-git-diff`                            | 1     |
| Glyph on a timeline node for a workspace an agent tab offers to make (#876)            | `WORKSPACE_PROPOSAL`     | `ph-folder-simple-plus`                  | 1     |
| Glyph on a timeline node for a failed run                                              | `PROMPT_ERROR`           | `ph-x-circle`                            | 1     |

### Ribbon: file commands (10)

| Purpose                                                                    | Name            | Today                              | Files      |
| -------------------------------------------------------------------------- | --------------- | ---------------------------------- | ---------- |
| Open-file/folder icon                                                      | `FOLDER_OPEN`   | `ph-duotone ph-folder-open`        | 13         |
| Save icon                                                                  | `SAVE`          | `ph-duotone ph-floppy-disk`        | 8          |
| Save-as (save to a new file) icon                                          | `SAVE_AS`       | `ph-duotone ph-floppy-disk-back`   | 5          |
| Save-all (save every unsaved document) icon                                | `SAVE_ALL`      | `ph-duotone ph-copy-simple`        | 1          |
| Code-cleanup icon (organise imports, then format)                          | `CODE_CLEANUP`  | `ph-duotone ph-sparkle` _Same_     | **Unused** |
| Layout-preset icon, used by the ribbon's View group for the default layout | `LAYOUT_PRESET` | `ph-duotone ph-layout`             | 1          |
| Manage/settings-list icon, used for management dialogs                     | `MANAGE`        | `ph-duotone ph-sliders-horizontal` | 1          |
| Default-marker (star) icon                                                 | `STAR`          | `ph-fill ph-star`                  | **Unused** |
| Export-to-PDF icon                                                         | `EXPORT_PDF`    | `ph-duotone ph-file-pdf`           | 2          |
| Print icon                                                                 | `PRINT`         | `ph-duotone ph-printer`            | 2          |

### Ribbon: edit commands (9)

| Purpose                                                         | Name        | Today                              | Files |
| --------------------------------------------------------------- | ----------- | ---------------------------------- | ----- |
| Cut icon                                                        | `CUT`       | `ph-duotone ph-scissors`           | 9     |
| Copy icon                                                       | `COPY`      | `ph-duotone ph-copy-simple` _Same_ | 25    |
| Paste icon                                                      | `PASTE`     | `ph-duotone ph-clipboard`          | 6     |
| Undo icon                                                       | `UNDO`      | `ph-arrow-u-up-left`               | 8     |
| Bold undo glyph used by the markdown tool strip                 | `UNDO_BOLD` | `ph-bold ph-arrow-u-up-left`       | 2     |
| Redo icon                                                       | `REDO`      | `ph-arrow-u-down-right`            | 5     |
| Bold redo glyph used by the markdown tool strip                 | `REDO_BOLD` | `ph-bold ph-arrow-u-down-right`    | 2     |
| Find/search icon                                                | `SEARCH`    | `ph-duotone ph-magnifying-glass`   | 18    |
| Replace icon: two opposing arrows, one text swapped for another | `REPLACE`   | `ph-duotone ph-swap`               | 1     |

### Ribbon: run, format and session (10)

| Purpose                                                                       | Name           | Today                        | Files |
| ----------------------------------------------------------------------------- | -------------- | ---------------------------- | ----- |
| Run/play/start icon                                                           | `PLAY`         | `ph-duotone ph-play`         | 15    |
| Stop icon                                                                     | `STOP`         | `ph-duotone ph-stop`         | 16    |
| Pause icon, shown on the Reader panel's transport toggle while playing        | `PAUSE`        | `ph-fill ph-pause`           | 4     |
| Filled play icon, shown on the Reader panel's transport toggle while paused   | `PLAY_FILL`    | `ph-fill ph-play`            | 2     |
| Skip-to-previous icon, shown on the Reader panel's previous-paragraph control | `SKIP_BACK`    | `ph-fill ph-skip-back`       | 1     |
| Skip-to-next icon, shown on the Reader panel's next-paragraph control         | `SKIP_FORWARD` | `ph-fill ph-skip-forward`    | 1     |
| Debug icon                                                                    | `DEBUG`        | `ph-duotone ph-bug`          | 4     |
| Format-document (magic wand) icon                                             | `FORMAT`       | `ph-duotone ph-magic-wand`   | 1     |
| Clear icon (terminal screen, agent conversation)                              | `CLEAR`        | `ph-duotone ph-trash-simple` | 3     |
| Compact-conversation icon                                                     | `COMPACT`      | `ph-duotone ph-trash`        | 2     |

### Ribbon: markdown text formatting (40)

| Purpose                                                                                                                   | Name                   | Today                                   | Files      |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------- | ---------- |
| Bold icon                                                                                                                 | `BOLD`                 | `ph-text-b`                             | 1          |
| Bold-weight variant of the bold-formatting glyph, used by the markdown tool strip                                         | `BOLD_BOLD`            | `ph-bold ph-text-b`                     | 1          |
| Italic icon                                                                                                               | `ITALIC`               | `ph-text-italic`                        | 1          |
| Bold italic-formatting glyph used by the markdown tool strip                                                              | `ITALIC_BOLD`          | `ph-bold ph-text-italic`                | 1          |
| Strikethrough icon                                                                                                        | `STRIKETHROUGH`        | `ph-text-strikethrough`                 | 1          |
| Bold strikethrough-formatting glyph used by the markdown tool strip                                                       | `STRIKETHROUGH_BOLD`   | `ph-bold ph-text-strikethrough`         | 1          |
| Inline-code icon                                                                                                          | `CODE_INLINE`          | `ph-code` _Same_                        | 2          |
| Bold inline-code glyph used by the markdown tool strip                                                                    | `CODE_INLINE_BOLD`     | `ph-bold ph-code`                       | 1          |
| Align-left icon                                                                                                           | `ALIGN_LEFT`           | `ph-text-align-left`                    | **Unused** |
| Align-center icon                                                                                                         | `ALIGN_CENTER`         | `ph-text-align-center`                  | **Unused** |
| Align-right icon                                                                                                          | `ALIGN_RIGHT`          | `ph-text-align-right`                   | **Unused** |
| Table icon                                                                                                                | `TABLE`                | `ph-duotone ph-grid-nine`               | 1          |
| Bold table glyph used by the markdown tool strip                                                                          | `TABLE_BOLD`           | `ph-bold ph-grid-nine`                  | 1          |
| Horizontal-divider icon                                                                                                   | `DIVIDER`              | `ph-minus`                              | 1          |
| Bold divider glyph used by the markdown tool strip                                                                        | `DIVIDER_BOLD`         | `ph-bold ph-minus` _Same_               | 1          |
| Image icon, shown on the markdown Insert group's Image button                                                             | `IMAGE`                | `ph-image`                              | 1          |
| Link icon, shown on the markdown Insert group's Link button                                                               | `LINK`                 | `ph-link`                               | 2          |
| Open-externally icon, shown on a control that leaves Studio for the user's browser (a pull request or issue on its forge) | `OPEN_EXTERNAL`        | `ph-arrow-square-out`                   | 5          |
| Close-issue icon, on the issue document's strip while the issue is open                                                   | `ISSUE_CLOSE`          | `ph-duotone ph-check-circle`            | 1          |
| Reopen-issue icon, on the issue document's strip while the issue is closed                                                | `ISSUE_REOPEN`         | `ph-duotone ph-arrow-counter-clockwise` | 1          |
| Bold open-external glyph used by the markdown tool strip's open-in-tab button                                             | `OPEN_EXTERNAL_BOLD`   | `ph-bold ph-arrow-square-out`           | **Unused** |
| Open-editor glyph on the agent composer's button that opens the Markdown Prompt Editor                                    | `COMPOSER_OPEN_EDITOR` | `ph-duotone ph-arrow-square-out`        | 1          |
| Math icon, shown on the markdown Insert group's Math button                                                               | `MATH`                 | `ph-function` _Same_                    | 1          |
| Diagram icon, shown on the markdown Insert group's Diagram button                                                         | `DIAGRAM`              | `ph-graph`                              | 1          |
| Footnote icon, shown on the markdown Insert group's Footnote button                                                       | `FOOTNOTE`             | `ph-asterisk`                           | 1          |
| Collapse (details/summary) icon, shown on the markdown Insert group's Collapse button                                     | `COLLAPSE`             | `ph-caret-circle-down`                  | 1          |
| Emoji icon, shown on the markdown Insert group's Emoji button                                                             | `EMOJI`                | `ph-smiley`                             | 1          |
| Outline icon, shown on the markdown Tools group's Outline button                                                          | `OUTLINE`              | `ph-list-dashes`                        | 2          |
| Review (spelling and grammar) icon, shown on the markdown Tools group's Review button                                     | `REVIEW`               | `ph-duotone ph-text-aa`                 | 2          |
| Reader (read-aloud) icon, shown on the markdown Tools group's Reader button                                               | `READER`               | `ph-duotone ph-speaker-high`            | 2          |
| Refresh icon, shown on the Review panel's re-analyse action                                                               | `REFRESH`              | `ph-arrow-clockwise`                    | 17         |
| Refresh icon in the duotone weight, for a ribbon's Refresh action                                                         | `REFRESH_DUOTONE`      | `ph-duotone ph-arrow-clockwise`         | 2          |
| Check icon, shown on the Review panel's primary suggestion                                                                | `CHECK`                | `ph-check`                              | 19         |
| Dictionary (book) icon, shown on the Review panel's add-to-dictionary action                                              | `DICTIONARY`           | `ph-book-bookmark`                      | **Unused** |
| Bullet-list icon                                                                                                          | `BULLET_LIST`          | `ph-list-bullets`                       | 1          |
| Bold bullet-list glyph used by the markdown tool strip                                                                    | `BULLET_LIST_BOLD`     | `ph-bold ph-list-bullets`               | 1          |
| Numbered-list icon                                                                                                        | `NUMBERED_LIST`        | `ph-list-numbers`                       | 1          |
| Bold numbered-list glyph used by the markdown tool strip                                                                  | `NUMBERED_LIST_BOLD`   | `ph-bold ph-list-numbers`               | 1          |
| Task-list icon                                                                                                            | `TASK_LIST`            | `ph-list-checks`                        | 1          |
| Bold task-list glyph used by the markdown tool strip                                                                      | `TASK_LIST_BOLD`       | `ph-bold ph-list-checks`                | 1          |

### Ribbon: build and source control (68)

| Purpose                                                                                                                       | Name                    | Today                                          | Files      |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ---------------------------------------------- | ---------- |
| Build icon                                                                                                                    | `BUILD`                 | `ph-duotone ph-stack` _Same_                   | 1          |
| Rebuild icon                                                                                                                  | `REBUILD`               | `ph-duotone ph-stack-plus`                     | 1          |
| Clean icon                                                                                                                    | `CLEAN`                 | `ph-duotone ph-broom`                          | 1          |
| Test icon                                                                                                                     | `TEST`                  | `ph-duotone ph-flask`                          | 4          |
| Publish icon                                                                                                                  | `PUBLISH`               | `ph-duotone ph-package` _Same_                 | 1          |
| Restore icon                                                                                                                  | `RESTORE`               | `ph-duotone ph-arrow-counter-clockwise` _Same_ | 2          |
| Git-commit icon                                                                                                               | `GIT_COMMIT`            | `ph-duotone ph-git-commit`                     | 6          |
| Filter (funnel) icon on the History strip's Filter toggle                                                                     | `FILTER`                | `ph-duotone ph-funnel`                         | 4          |
| All-branches (fork) icon on the History strip's All Branches toggle                                                           | `ALL_BRANCHES`          | `ph-duotone ph-git-fork`                       | 1          |
| Go-to-HEAD (crosshair) icon on the History strip                                                                              | `GO_TO_HEAD`            | `ph-duotone ph-crosshair`                      | 1          |
| Go-to-symbol icon on a code file's strip menu                                                                                 | `GO_TO_SYMBOL`          | `ph-duotone ph-crosshair-simple`               | 3          |
| Go-to-line icon on a code file's strip menu                                                                                   | `GO_TO_LINE`            | `ph-duotone ph-list-numbers` _Same_            | 2          |
| References panel's icon: a list searched through (#1014)                                                                      | `REFERENCES`            | `ph-duotone ph-list-magnifying-glass`          | 3          |
| Hierarchy panel's icon (#1153), and Show Type Hierarchy's: a tree of types                                                    | `HIERARCHY`             | `ph-duotone ph-tree-structure`                 | 1          |
| Error List's Group by Project and File toggle's icon (#1182): a list folded into a tree                                       | `GROUP_BY_TREE`         | `ph-duotone ph-tree-view`                      | **Unused** |
| Icon of a type in Go to Symbol's list: a class or a struct (#1009)                                                            | `SYMBOL_CLASS`          | `ph-cube` _Same_                               | 3          |
| Icon of an interface in Go to Symbol's list                                                                                   | `SYMBOL_INTERFACE`      | `ph-plugs`                                     | 2          |
| Icon of an enum, or one of its values, in Go to Symbol's list                                                                 | `SYMBOL_ENUM`           | `ph-list-numbers` _Same_                       | 2          |
| Icon of a function, method or constructor in Go to Symbol's list                                                              | `SYMBOL_FUNCTION`       | `ph-function` _Same_                           | 2          |
| Icon of a property in Go to Symbol's list                                                                                     | `SYMBOL_PROPERTY`       | `ph-wrench`                                    | 2          |
| Icon of a field in Go to Symbol's list                                                                                        | `SYMBOL_FIELD`          | `ph-tag`                                       | 2          |
| Icon of a variable in Go to Symbol's list                                                                                     | `SYMBOL_VARIABLE`       | `ph-cube-transparent`                          | 2          |
| Icon of a constant in Go to Symbol's list                                                                                     | `SYMBOL_CONSTANT`       | `ph-pi`                                        | 2          |
| Icon of a namespace, module or package in Go to Symbol's list                                                                 | `SYMBOL_NAMESPACE`      | `ph-brackets-curly` _Same_                     | 2          |
| Icon of an event in Go to Symbol's list                                                                                       | `SYMBOL_EVENT`          | `ph-lightning` _Same_                          | 2          |
| Icon of any other symbol in Go to Symbol's list: an operator, a type parameter, a key                                         | `SYMBOL_OTHER`          | `ph-dot-outline`                               | 2          |
| Icon of a keyword in the completion list (#1021)                                                                              | `SYMBOL_KEYWORD`        | `ph-key`                                       | 1          |
| Icon of a snippet in the completion list: text with tab stops to fill in                                                      | `SYMBOL_SNIPPET`        | `ph-code-block`                                | 1          |
| Icon of plain text in the completion list: a word from the document, say                                                      | `SYMBOL_TEXT`           | `ph-text-aa`                                   | 1          |
| Icon of a colour in the completion list                                                                                       | `SYMBOL_COLOR`          | `ph-palette`                                   | 1          |
| Icon of an operator in the completion list                                                                                    | `SYMBOL_OPERATOR`       | `ph-plus-minus`                                | 1          |
| Icon of a unit in the completion list (`px`, `em`)                                                                            | `SYMBOL_UNIT`           | `ph-ruler`                                     | 1          |
| Icon of a value in the completion list                                                                                        | `SYMBOL_VALUE`          | `ph-hash`                                      | 1          |
| Icon of a type parameter in the completion list                                                                               | `SYMBOL_TYPE_PARAMETER` | `ph-brackets-angle`                            | 1          |
| Open-file icon on a diff's strip, which opens the compared file to edit                                                       | `OPEN_FILE`             | `ph-duotone ph-file-text` _Same_               | 3          |
| Source-control (git-branch) icon shown on the source-control tab                                                              | `SOURCE_CONTROL`        | `ph-duotone ph-git-branch`                     | 7          |
| Git-merge icon shown on merge commits and the ribbon's Merge action                                                           | `GIT_MERGE`             | `ph-duotone ph-git-merge`                      | 5          |
| Git-diff icon shown on the diff surface and the ribbon's compare action                                                       | `GIT_DIFF`              | `ph-duotone ph-git-diff`                       | 6          |
| Icon of a diff's Ignore Whitespace switch                                                                                     | `DIFF_WHITESPACE`       | `ph-duotone ph-paragraph`                      | 1          |
| Icon of the explorers' Ignore command, which adds a path to version control's ignore list (#1043)                             | `GIT_IGNORE`            | `ph-duotone ph-eye-slash` _Same_               | 1          |
| Icon of the explorers' Exclude command, which takes an entry out of the explorers, Expand All and Find (#1252)                | `EXPLORER_EXCLUDE`      | `ph-duotone ph-prohibit`                       | 2          |
| Icon of the explorers' Include command, which brings an excluded entry back (#1252)                                           | `EXPLORER_INCLUDE`      | `ph-duotone ph-check-circle` _Same_            | 2          |
| Icon of the explorers' Stop Tracking command, which takes a path out of version control while keeping it on disk (#1043)      | `GIT_STOP_TRACKING`     | `ph-duotone ph-file-minus`                     | 1          |
| Icon of the explorers' Show History command, which lists the commits that touched a path (#1044)                              | `GIT_HISTORY`           | `ph-duotone ph-clock-counter-clockwise`        | 1          |
| Pull-request icon shown on the ribbon's Pull Request action                                                                   | `GIT_PULL_REQUEST`      | `ph-duotone ph-git-pull-request`               | 1          |
| Tag icon shown on the source-control tags section and tag refs                                                                | `TAG`                   | `ph-duotone ph-tag`                            | 2          |
| Stash icon shown on the source-control stashes section and the ribbon's Stash action                                          | `STASH`                 | `ph-duotone ph-archive`                        | 3          |
| Worktree icon shown on the Repository panel's worktrees, the ribbon's Promote action, and the status strip's active-checkout… | `WORKTREE`              | `ph-duotone ph-tree-structure` _Same_          | 3          |
| Glyph on the worktree the view is showing, in the Repository panel                                                            | `WORKTREE_SHOWN`        | `ph-duotone ph-eye` _Same_                     | 1          |
| Glyph on a worktree the view is not showing, in the Repository panel                                                          | `WORKTREE_HIDDEN`       | `ph-duotone ph-eye-slash` _Same_               | 1          |
| Remote (cloud) icon shown on the source-control remotes section                                                               | `CLOUD`                 | `ph-duotone ph-cloud`                          | 1          |
| Code-hosting icon (GitHub, GitLab — where a repository is hosted), for the Plugin Manager's Hosting category                  | `HOSTING`               | `ph-duotone ph-cloud` _Same_                   | 1          |
| Code-hosting icon at the light weight, for a plugin row in the Hosting category                                               | `HOSTING_LIGHT`         | `ph-light ph-cloud`                            | 1          |
| Lines-added icon, for a tally of what a change adds                                                                           | `PLUS_CIRCLE`           | `ph-duotone ph-plus-circle`                    | 4          |
| Lines-removed icon, for a tally of what a change removes                                                                      | `MINUS_CIRCLE`          | `ph-duotone ph-minus-circle`                   | 3          |
| Push (cloud with an up arrow) icon                                                                                            | `CLOUD_UP`              | `ph-duotone ph-cloud-arrow-up`                 | 1          |
| Pull (cloud with a down arrow) icon                                                                                           | `CLOUD_DOWN`            | `ph-duotone ph-cloud-arrow-down`               | 2          |
| Sync (cloud with a tick) icon: the state a pull and a push together leave a branch in                                         | `CLOUD_CHECK`           | `ph-duotone ph-cloud-check`                    | 1          |
| Check-out (tray with an up arrow) icon                                                                                        | `TRAY_UP`               | `ph-duotone ph-tray-arrow-up`                  | 1          |
| Working-changes (pencil) icon shown on the source-control uncommitted-changes node                                            | `PENCIL`                | `ph-duotone ph-pencil-simple`                  | 13         |
| Text-cursor icon: put text where the user types, to edit before sending (#1420)                                               | `CURSOR_TEXT`           | `ph-duotone ph-cursor-text`                    | 1          |
| Upward-arrow (push) icon                                                                                                      | `ARROW_UP`              | `ph-arrow-up`                                  | 12         |
| Downward-arrow (pull) icon                                                                                                    | `ARROW_DOWN`            | `ph-arrow-down`                                | 9          |
| Commits-to-push (bold up arrow) icon shown on the workspace status bar's ahead count                                          | `COMMITS_AHEAD`         | `ph-bold ph-arrow-up` _Same_                   | 1          |
| Commits-to-pull (bold down arrow) icon shown on the workspace status bar's behind count                                       | `COMMITS_BEHIND`        | `ph-bold ph-arrow-down` _Same_                 | 1          |
| Branch (bold git-branch) icon shown on the workspace status bar's branch segment                                              | `BRANCH`                | `ph-duotone ph-git-branch` _Same_              | 3          |
| Workspace-folder icon shown on the workspace status bar's name segment                                                        | `FOLDER_SIMPLE`         | `ph-fill ph-folder-simple`                     | **Unused** |
| Language-servers (article) icon shown on the workspace status bar's language-server menu                                      | `ARTICLE`               | `ph-duotone ph-article`                        | 3          |

### Ribbon: agent and terminal (13)

| Purpose                                                                  | Name                | Today                              | Files |
| ------------------------------------------------------------------------ | ------------------- | ---------------------------------- | ----- |
| Ask-every-time icon, shown on the `prompt` permission posture            | `PERMISSION_PROMPT` | `ph-duotone ph-hand-palm`          | 1     |
| Auto-allow-file-edits icon, shown on the `auto-edits` permission posture | `PERMISSION_EDITS`  | `ph-duotone ph-pencil-line`        | 1     |
| Auto-allow-everything icon, shown on the `auto-all` permission posture   | `PERMISSION_ALL`    | `ph-duotone ph-lock-simple-open`   | 1     |
| Attach-file icon                                                         | `ATTACH`            | `ph-duotone ph-file-plus`          | 2     |
| Add-folder icon                                                          | `FOLDER_PLUS`       | `ph-duotone ph-folder-simple-plus` | 4     |
| List icon                                                                | `LIST`              | `ph-list` _Same_                   | 2     |
| Detailed-list icon                                                       | `LIST_ALL`          | `ph-list-dashes` _Same_            | 6     |
| Home-directory icon                                                      | `HOME`              | `ph-duotone ph-house-line`         | 1     |
| Root-directory icon                                                      | `ROOT`              | `ph-duotone ph-hard-drive` _Same_  | 1     |
| Size-sorted listing icon                                                 | `SORT_BY_SIZE`      | `ph-sort-descending`               | 1     |
| Previous-directory icon                                                  | `PREVIOUS_FOLDER`   | `ph-arrow-bend-up-left`            | 1     |
| Desktop folder icon                                                      | `DESKTOP`           | `ph-desktop`                       | 1     |
| Documents folder icon                                                    | `DOCUMENTS`         | `ph-file-text`                     | 1     |

### Dock: panels (4)

| Purpose                                                  | Name                | Today                       | Files |
| -------------------------------------------------------- | ------------------- | --------------------------- | ----- |
| File Explorer panel icon (the filesystem tree)           | `FILE_EXPLORER`     | `ph-folder-open`            | 1     |
| Solution Explorer panel icon (the logical project model) | `SOLUTION_EXPLORER` | `ph-tree-structure`         | 2     |
| Output panel icon                                        | `OUTPUT`            | `ph-terminal-window` _Same_ | 2     |
| Error List (problems) panel icon                         | `PROBLEMS`          | `ph-warning`                | 1     |

### Dock: chrome affordances (13)

| Purpose                                                                                                                         | Name                  | Today                              | Files      |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------- | ---------- |
| Auto-hide (collapse to strip) icon                                                                                              | `AUTO_HIDE`           | `ph-sidebar-simple`                | **Unused** |
| Collapse icon for a panel docked on a left or right edge (rotated 180° for the left)                                            | `COLLAPSE_HORIZONTAL` | `ph-duotone ph-square-half`        | 4          |
| Collapse icon for a panel docked on a top or bottom edge (rotated 180° for the top)                                             | `COLLAPSE_VERTICAL`   | `ph-duotone ph-square-half-bottom` | 4          |
| Full-square icon shown in the compass centre (tab-into) target                                                                  | `SQUARE`              | `ph-duotone ph-square`             | 1          |
| Float icon shown on a docked panel to detach it into a floating window                                                          | `FLOAT`               | `ph-duotone ph-push-pin-slash`     | 2          |
| Re-dock icon shown on a floating panel to dock it back into the layout                                                          | `DOCK`                | `ph-duotone ph-push-pin` _Same_    | 1          |
| Pin (re-dock from auto-hide) icon                                                                                               | `PIN`                 | `ph-push-pin`                      | **Unused** |
| Pop-out icon, shown in a dock group's title bar for panels that can move into their own OS window                               | `POP_OUT`             | `ph-duotone ph-cards`              | 1          |
| Filled pin icon, used to show an item is pinned                                                                                 | `PIN_FILLED`          | `ph-fill ph-push-pin`              | **Unused** |
| Drag-handle (grip) icon                                                                                                         | `GRIP`                | `ph-dots-six`                      | **Unused** |
| Bold drag-handle (grip) icon, used on the document well's move handle and as the reorder handle on Mission Control's agent rail | `GRIP_BOLD`           | `ph-bold ph-dots-six`              | 2          |
| Vertical drag-handle (grip) icon, used as a reorder handle on the trailing edge of a list row                                   | `GRIP_VERTICAL`       | `ph-dots-six-vertical`             | 2          |
| Bold vertical drag-handle (grip) icon, for a reorder handle that should read heavier than the default                           | `GRIP_VERTICAL_BOLD`  | `ph-bold ph-dots-six-vertical`     | **Unused** |

### File Explorer: tree files (16)

| Purpose                                                                               | Name              | Today                          | Files |
| ------------------------------------------------------------------------------------- | ----------------- | ------------------------------ | ----- |
| Collapsed-folder icon used outside the tree (such as the terminal cwd segment)        | `FOLDER`          | `ph-folder`                    | 4     |
| Generic file icon                                                                     | `FILE`            | `ph-file`                      | 6     |
| Icon for a project node in the Solution Explorer                                      | `PROJECT`         | `ph-duotone ph-cube` _Same_    | 4     |
| Icon for the Package Management panel                                                 | `PACKAGES`        | `ph-duotone ph-package` _Same_ | 2     |
| Hidden (dotfile) icon                                                                 | `FILE_HIDDEN`     | `ph-file-dashed`               | 1     |
| TypeScript file icon                                                                  | `FILE_TYPESCRIPT` | `ph-file-ts`                   | 2     |
| JavaScript file icon                                                                  | `FILE_JAVASCRIPT` | `ph-file-js`                   | 2     |
| JSON file icon                                                                        | `FILE_JSON`       | `ph-brackets-curly` _Same_     | 2     |
| Markdown file icon                                                                    | `FILE_MARKDOWN`   | `ph-file-md`                   | 2     |
| Stylesheet (CSS/SCSS) file icon                                                       | `FILE_STYLESHEET` | `ph-file-css`                  | 1     |
| HTML file icon                                                                        | `FILE_HTML`       | `ph-file-html`                 | 1     |
| Spinner icon shown while a directory loads                                            | `SPINNER`         | `ph-circle-notch`              | 19    |
| Restart icon shown on the language-server menu's restart action                       | `RESTART`         | `ph-arrow-clockwise` _Same_    | 3     |
| Step-over icon shown on the debug toolbar (execute the current line, not into calls)  | `STEP_OVER`       | `ph-arrow-bend-down-right`     | 1     |
| Step-into icon shown on the debug toolbar (descend into the call at the current line) | `STEP_INTO`       | `ph-arrow-line-down`           | 1     |
| Step-out icon shown on the debug toolbar (finish the current function and return)     | `STEP_OUT`        | `ph-arrow-line-up`             | 1     |

### Problems: severities and markdown alerts (21)

| Purpose                                                                                                                          | Name                   | Today                               | Files |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------- | ----- |
| Error-severity icon                                                                                                              | `ERROR`                | `ph-x-circle` _Same_                | 6     |
| Filled error icon, the counterpart to SUCCESS_FILL where a status warrants a solid, semantically-coloured badge (for example a…  | `ERROR_FILL`           | `ph-fill ph-x-circle`               | 6     |
| In-progress status icon: a plain circle, pulsing, for a run or checks still going                                                | `STATUS_RUNNING`       | `ph-duotone ph-circle`              | 1     |
| Stopped status icon, for a run that was cancelled rather than finished                                                           | `STATUS_STOPPED`       | `ph-duotone ph-x-circle`            | 1     |
| Warning-severity icon                                                                                                            | `WARNING`              | `ph-warning` _Same_                 | 17    |
| Filled warning-severity icon, used where a status warrants a solid, semantically-coloured badge (for example an unconfigured…    | `WARNING_FILL`         | `ph-fill ph-warning`                | 8     |
| Information-severity icon                                                                                                        | `INFO`                 | `ph-info`                           | 9     |
| Filled information-severity icon, used where a status is stated as a solid, semantically-coloured badge rather than as body text | `INFO_FILL`            | `ph-fill ph-info`                   | 4     |
| Filled warning-severity icon in its circled form                                                                                 | `WARNING_CIRCLE_FILL`  | `ph-fill ph-warning-circle`         | 1     |
| Filled success icon in its circled form, for a status badge stating that something is present and healthy                        | `CHECK_CIRCLE_FILL`    | `ph-fill ph-check-circle`           | 2     |
| Filled download icon in its circled form, for a status badge stating that something is available to bring down rather than an…   | `DOWNLOAD_CIRCLE_FILL` | `ph-fill ph-arrow-circle-down`      | 2     |
| Hint-severity icon                                                                                                               | `HINT`                 | `ph-lightbulb`                      | 3     |
| Fix icon Studio draws beside an editor's caret line while fixes exist at the caret (#1016), in place of Monaco's own lightbulb   | `QUICK_FIX`            | `ph-fill ph-lightbulb`              | 1     |
| Success icon shown when there are no problems                                                                                    | `SUCCESS`              | `ph-check-circle`                   | 2     |
| Filled success icon, used where a status warrants a solid, semantically-coloured badge (for example a working provider…          | `SUCCESS_FILL`         | `ph-fill ph-check-circle` _Same_    | 6     |
| Success icon in duotone, large in an empty view that has found nothing wrong (#1182)                                             | `SUCCESS_DUOTONE`      | `ph-duotone ph-check-circle` _Same_ | 1     |
| Duotone Note icon used by markdown alerts                                                                                        | `ALERT_NOTE`           | `ph-duotone ph-info` _Same_         | 2     |
| Duotone Tip icon used by markdown alerts                                                                                         | `ALERT_TIP`            | `ph-duotone ph-lightbulb`           | 2     |
| Duotone Important icon used by markdown alerts                                                                                   | `ALERT_IMPORTANT`      | `ph-duotone ph-warning-circle`      | 2     |
| Duotone Warning icon used by markdown alerts                                                                                     | `ALERT_WARNING`        | `ph-duotone ph-warning`             | 2     |
| Duotone Caution icon used by markdown alerts                                                                                     | `ALERT_CAUTION`        | `ph-duotone ph-warning-octagon`     | 2     |

### Agent chat (8)

| Purpose                                                                                                                         | Name                    | Today                                | Files |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------ | ----- |
| New-conversation icon (a chat bubble with dots), shown on the agent ribbon's New button and on the agent tool strip's New chat… | `CHAT_NEW`              | `ph-duotone ph-chat-teardrop-dots`   | 2     |
| User avatar icon                                                                                                                | `USER`                  | `ph-user` _Same_                     | 2     |
| Send-message icon                                                                                                               | `SEND`                  | `ph-fill ph-paper-plane-right`       | 3     |
| Keyboard-shortcuts icon, shown on the composer's shortcut menu                                                                  | `KEYBOARD_SHORTCUTS`    | `ph-duotone ph-keyboard`             | 2     |
| Quick-response icon, shown on the composer's saved-replies menu                                                                 | `QUICK_RESPONSE`        | `ph-duotone ph-quotes`               | 1     |
| Jump-to-the-latest-message icon, shown on the controls that scroll a transcript to its tail                                     | `SCROLL_TO_BOTTOM`      | `ph-duotone ph-arrow-fat-lines-down` | 2     |
| Jump-to-the-start icon, shown on the controls that scroll a transcript to its beginning                                         | `SCROLL_TO_TOP`         | `ph-duotone ph-arrow-fat-lines-up`   | 2     |
| Jump-to-the-last-prompt icon, shown on the controls that scroll a transcript back to the most recent thing the user asked       | `SCROLL_TO_LAST_PROMPT` | `ph-duotone ph-arrow-line-up`        | 2     |

### Settings (9)

| Purpose                                                                                 | Name                   | Today                  | Files      |
| --------------------------------------------------------------------------------------- | ---------------------- | ---------------------- | ---------- |
| Appearance (palette) settings-section icon                                              | `PALETTE`              | `ph-palette` _Same_    | **Unused** |
| Application settings-section icon                                                       | `APPLICATION`          | `ph-app-window` _Same_ | 1          |
| Text-editor settings-section icon (regular weight keeps the settings nav uniform)       | `SETTINGS_TEXT_EDITOR` | `ph-file-code`         | 1          |
| Markdown settings-section icon (regular weight keeps the settings nav uniform)          | `SETTINGS_MARKDOWN`    | `ph-markdown-logo`     | 1          |
| Keyboard settings-section icon (regular weight keeps the settings nav uniform)          | `KEYBOARD`             | `ph-keyboard`          | **Unused** |
| Icon heading each skill in the Skills list (regular weight matches the accordion caret) | `SKILL`                | `ph-sparkle` _Same_    | **Unused** |
| Light-theme icon                                                                        | `THEME_LIGHT`          | `ph-sun`               | **Unused** |
| Dark-theme icon                                                                         | `THEME_DARK`           | `ph-moon`              | **Unused** |
| System-theme icon                                                                       | `THEME_SYSTEM`         | `ph-monitor`           | **Unused** |

### Welcome (12)

| Purpose                                                             | Name                     | Today                                     | Files |
| ------------------------------------------------------------------- | ------------------------ | ----------------------------------------- | ----- |
| Recent-items icon                                                   | `RECENT`                 | `ph-clock-counter-clockwise`              | 6     |
| Thin recent-items glyph shown large in the recent-items empty state | `RECENT_EMPTY`           | `ph-thin ph-clock-counter-clockwise`      | 1     |
| Duotone directory icon shown on the welcome screen                  | `WELCOME_DIRECTORY`      | `ph-duotone ph-folder-simple` _Same_      | 1     |
| Light-weight source-control icon shown on the welcome screen        | `WELCOME_SOURCE_CONTROL` | `ph-light ph-git-branch`                  | 1     |
| Duotone code icon shown on the welcome screen                       | `WELCOME_CODE`           | `ph-duotone ph-brackets-curly` _Same_     | 1     |
| Duotone markdown icon shown on the welcome screen                   | `WELCOME_MARKDOWN`       | `ph-duotone ph-markdown-logo` _Same_      | 1     |
| Duotone terminal icon shown on the welcome screen                   | `WELCOME_TERMINAL`       | `ph-duotone ph-terminal-window` _Same_    | 1     |
| Duotone Containers icon shown on the welcome screen                 | `WELCOME_CONTAINERS`     | `ph-duotone ph-shipping-container` _Same_ | 1     |
| Duotone agent icon shown on the welcome screen                      | `WELCOME_AGENT`          | `ph-duotone ph-brain` _Same_              | 1     |
| Duotone AI Manager icon shown on the welcome screen                 | `WELCOME_AI_MODELS`      | `ph-duotone ph-cpu` _Same_                | 1     |
| Duotone API Explorer icon shown on the welcome screen               | `WELCOME_API_EXPLORER`   | `ph-duotone ph-plugs-connected`           | 1     |
| Duotone Database Explorer icon shown on the welcome screen          | `WELCOME_DATABASE`       | `ph-duotone ph-database`                  | 1     |

### API Explorer (5)

| Purpose                                                                | Name              | Today                                          | Files |
| ---------------------------------------------------------------------- | ----------------- | ---------------------------------------------- | ----- |
| Icon of the API Explorer tab and of its explorer panel                 | `API_EXPLORER`    | `ph-duotone ph-plugs-connected` _Same_         | 5     |
| Icon of a single saved API request, shown on its tab in the API well   | `API_REQUEST`     | `ph-duotone ph-brackets-angle`                 | 4     |
| Icon of an API collection in the explorer tree                         | `API_COLLECTION`  | `ph-duotone ph-folder-simple` _Same_           | 6     |
| Icon of an API environment — the variable set requests resolve against | `API_ENVIRONMENT` | `ph-duotone ph-stack` _Same_                   | 5     |
| Icon of the API send history                                           | `API_HISTORY`     | `ph-duotone ph-clock-counter-clockwise` _Same_ | 1     |

### Database Explorer (40)

| Purpose                                                                                                  | Name                         | Today                                      | Files      |
| -------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------ | ---------- |
| Icon of the Database Explorer tab, and of a database in its object tree                                  | `DATABASE`                   | `ph-duotone ph-database` _Same_            | 5          |
| Thin database glyph shown large in the Object Explorer's empty state, as the agent panel shows its brain | `DATABASE_EMPTY`             | `ph-thin ph-database`                      | 1          |
| Icon of a saved connection in the object tree, and of the ribbon's Connect                               | `DATABASE_CONNECTION`        | `ph-duotone ph-hard-drives` _Same_         | 5          |
| Icon of the ribbon's Disconnect                                                                          | `DATABASE_DISCONNECT`        | `ph-duotone ph-link-break`                 | 2          |
| Icon of the Database Explorer ribbon's Connect                                                           | `DATABASE_CONNECT`           | `ph-duotone ph-plugs-connected` _Same_     | 1          |
| Icon of the Object Explorer panel                                                                        | `DATABASE_OBJECTS`           | `ph-duotone ph-tree-structure` _Same_      | 1          |
| Icon of a query document in the well                                                                     | `DATABASE_QUERY`             | `ph-duotone ph-file-sql`                   | 4          |
| Icon of the Database Explorer ribbon's Reset Layout                                                      | `DATABASE_RESET_LAYOUT`      | `ph-duotone ph-layout` _Same_              | **Unused** |
| Icon of the Database Explorer's Set / Change Passphrase                                                  | `DATABASE_PASSPHRASE`        | `ph-duotone ph-key`                        | 1          |
| Icon of the Database Explorer's Unlock Passwords                                                         | `DATABASE_UNLOCK`            | `ph-duotone ph-lock-key-open`              | 1          |
| Icon of the Database Explorer's Remove Passphrase                                                        | `DATABASE_REMOVE_PASSPHRASE` | `ph-duotone ph-lock-simple-open` _Same_    | 1          |
| Icon of a schema in the object tree                                                                      | `DATABASE_SCHEMA`            | `ph-duotone ph-tree-structure` _Same_      | 1          |
| Icon of a table                                                                                          | `DATABASE_TABLE`             | `ph-duotone ph-table`                      | 1          |
| Icon of a view                                                                                           | `DATABASE_VIEW`              | `ph-duotone ph-eye` _Same_                 | 1          |
| Icon of a column                                                                                         | `DATABASE_COLUMN`            | `ph-duotone ph-columns`                    | 1          |
| Icon of a key: a primary-key column or a foreign key                                                     | `DATABASE_KEY`               | `ph-duotone ph-key` _Same_                 | 1          |
| Icon of an index                                                                                         | `DATABASE_INDEX`             | `ph-duotone ph-magnifying-glass` _Same_    | 1          |
| Icon of a function or procedure                                                                          | `DATABASE_FUNCTION`          | `ph-duotone ph-function`                   | 1          |
| Icon of a trigger                                                                                        | `DATABASE_TRIGGER`           | `ph-duotone ph-lightning`                  | 1          |
| Icon of a sequence                                                                                       | `DATABASE_SEQUENCE`          | `ph-duotone ph-list-numbers` _Same_        | 1          |
| Icon of a constraint                                                                                     | `DATABASE_CONSTRAINT`        | `ph-duotone ph-shield-check`               | 1          |
| Icon of a graph node label                                                                               | `DATABASE_LABEL`             | `ph-duotone ph-tag` _Same_                 | 1          |
| Icon of a graph relationship type                                                                        | `DATABASE_RELATIONSHIP`      | `ph-duotone ph-flow-arrow`                 | 1          |
| Icon of a graph property key                                                                             | `DATABASE_PROPERTY`          | `ph-duotone ph-brackets-curly` _Same_      | 1          |
| Icon of the Properties panel                                                                             | `DATABASE_PROPERTIES`        | `ph-duotone ph-list-bullets`               | 1          |
| Icon of the Graph result view                                                                            | `DATABASE_GRAPH`             | `ph-duotone ph-graph`                      | 1          |
| Icon of the Table result view                                                                            | `DATABASE_GRID`              | `ph-duotone ph-rows`                       | 1          |
| Icon of the Raw result view                                                                              | `DATABASE_RAW`               | `ph-duotone ph-brackets-curly` _Same_      | 1          |
| Icon of Explain, and of the Plan tab's Tree view: a query's plan, a tree of steps                        | `DATABASE_EXPLAIN`           | `ph-duotone ph-tree-view` _Same_           | 3          |
| Icon of Explain Analyze, which runs the query to time its plan                                           | `DATABASE_EXPLAIN_ANALYZE`   | `ph-duotone ph-gauge` _Same_               | 2          |
| Icon of the Fit to View column sizing: the columns share the grid's width                                | `DATABASE_FIT_VIEW`          | `ph-duotone ph-arrows-in-line-horizontal`  | 1          |
| Icon of the Fit to Data column sizing: each column is as wide as its values                              | `DATABASE_FIT_DATA`          | `ph-duotone ph-arrows-out-line-horizontal` | 1          |
| Icon of a result column that is the primary key, or part of it                                           | `DATABASE_PRIMARY_KEY`       | `ph-bold ph-key`                           | 1          |
| Icon of a result column that belongs to a key other than the primary key                                 | `DATABASE_SECONDARY_KEY`     | `ph-duotone ph-key` _Same_                 | 1          |
| Duotone Orchestration icon shown on the welcome screen                                                   | `WELCOME_ORCHESTRATION`      | `ph-duotone ph-computer-tower`             | 1          |
| Duotone System Monitor icon shown on the welcome screen                                                  | `WELCOME_SYSTEM_MONITOR`     | `ph-duotone ph-gauge` _Same_               | 1          |
| Light-weight Plugin Manager icon shown on the welcome screen                                             | `WELCOME_PLUGINS`            | `ph-light ph-puzzle-piece` _Same_          | 3          |
| Light-weight Settings icon shown on the welcome screen                                                   | `WELCOME_SETTINGS`           | `ph-light ph-gear-six`                     | 1          |
| Duotone settings icon of the welcome screen's Tools card                                                 | `WELCOME_TOOL_SETTINGS`      | `ph-duotone ph-gear-six`                   | 2          |
| Duotone plugins icon of the welcome screen's Tools card                                                  | `WELCOME_TOOL_PLUGINS`       | `ph-duotone ph-puzzle-piece` _Same_        | 1          |

### Welcome screen: tabs, Create Something, Version Control (72)

| Purpose                                                                                       | Name                                  | Today                                   | Files      |
| --------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------- | ---------- |
| Duotone icon of the welcome screen's Get Started tab                                          | `WELCOME_TAB_GET_STARTED`             | `ph-duotone ph-house`                   | 1          |
| Duotone icon of the welcome screen's Create Something tab                                     | `WELCOME_TAB_CREATE`                  | `ph-duotone ph-cube` _Same_             | 1          |
| Duotone icon of the welcome screen's Version Control tab                                      | `WELCOME_TAB_SOURCE_CONTROL`          | `ph-duotone ph-git-branch` _Same_       | 1          |
| Duotone icon of the welcome screen's Tools tab                                                | `WELCOME_TAB_TOOLS`                   | `ph-duotone ph-wrench`                  | 1          |
| Light-weight chevron trailing each welcome action and card                                    | `WELCOME_CHEVRON`                     | `ph-light ph-caret-right`               | 2          |
| Light-weight link glyph leading the clone-by-URL field                                        | `WELCOME_LINK`                        | `ph-light ph-link`                      | 1          |
| Bold download glyph on the Clone Repository buttons                                           | `WELCOME_CLONE`                       | `ph-bold ph-download-simple`            | 1          |
| Bold glyph on a repository's Open on GitHub (or other host) button                            | `WELCOME_OPEN_EXTERNAL`               | `ph-bold ph-arrow-square-out` _Same_    | 1          |
| Light-weight glyph beside a repository's homepage link                                        | `WELCOME_HOMEPAGE`                    | `ph-light ph-globe-simple`              | 1          |
| Light-weight icon of a public repository                                                      | `WELCOME_REPOSITORY`                  | `ph-light ph-book-open`                 | 1          |
| Light-weight icon of a private repository                                                     | `WELCOME_REPOSITORY_PRIVATE`          | `ph-light ph-lock-simple`               | 1          |
| Regular-weight outline star on a recent item that is not starred                              | `WELCOME_STAR`                        | `ph-star`                               | 1          |
| Filled star on a starred recent item                                                          | `WELCOME_STAR_FILLED`                 | `ph-fill ph-star` _Same_                | 1          |
| Light-weight refresh glyph of the repository browser                                          | `WELCOME_REFRESH`                     | `ph-light ph-arrows-clockwise`          | **Unused** |
| Thin glyph shown large in the repository browser's empty state                                | `WELCOME_REPOSITORIES_EMPTY`          | `ph-thin ph-git-branch`                 | 1          |
| Light-weight folder on Create Something's Browse button, which picks where a project goes     | `WELCOME_PROJECT_BROWSE`              | `ph-light ph-folder-simple`             | 1          |
| Light-weight desktop icon of a New Project template                                           | `WELCOME_TEMPLATE_DESKTOP`            | `ph-light ph-desktop`                   | 1          |
| Light-weight globe icon of a New Project template                                             | `WELCOME_TEMPLATE_GLOBE`              | `ph-light ph-globe`                     | 1          |
| Light-weight device mobile icon of a New Project template                                     | `WELCOME_TEMPLATE_DEVICE_MOBILE`      | `ph-light ph-device-mobile`             | 1          |
| Light-weight storefront icon of a New Project template                                        | `WELCOME_TEMPLATE_STOREFRONT`         | `ph-light ph-storefront`                | 1          |
| Light-weight app window icon of a New Project template                                        | `WELCOME_TEMPLATE_APP_WINDOW`         | `ph-light ph-app-window`                | 1          |
| Light-weight file html icon of a New Project template                                         | `WELCOME_TEMPLATE_FILE_HTML`          | `ph-light ph-file-html`                 | 1          |
| Light-weight terminal window icon of a New Project template                                   | `WELCOME_TEMPLATE_TERMINAL_WINDOW`    | `ph-light ph-terminal-window`           | 1          |
| Light-weight terminal icon of a New Project template                                          | `WELCOME_TEMPLATE_TERMINAL`           | `ph-light ph-terminal`                  | 1          |
| Light-weight cloud icon of a New Project template                                             | `WELCOME_TEMPLATE_CLOUD`              | `ph-light ph-cloud` _Same_              | 1          |
| Light-weight graph icon of a New Project template                                             | `WELCOME_TEMPLATE_GRAPH`              | `ph-light ph-graph`                     | 1          |
| Light-weight share network icon of a New Project template                                     | `WELCOME_TEMPLATE_SHARE_NETWORK`      | `ph-light ph-share-network`             | 1          |
| Light-weight lightning icon of a New Project template                                         | `WELCOME_TEMPLATE_LIGHTNING`          | `ph-light ph-lightning`                 | 1          |
| Light-weight broadcast icon of a New Project template                                         | `WELCOME_TEMPLATE_BROADCAST`          | `ph-light ph-broadcast`                 | 1          |
| Light-weight stack icon of a New Project template                                             | `WELCOME_TEMPLATE_STACK`              | `ph-light ph-stack`                     | 1          |
| Light-weight robot icon of a New Project template                                             | `WELCOME_TEMPLATE_ROBOT`              | `ph-light ph-robot`                     | 1          |
| Light-weight users three icon of a New Project template                                       | `WELCOME_TEMPLATE_USERS_THREE`        | `ph-light ph-users-three`               | 1          |
| Light-weight plugs connected icon of a New Project template                                   | `WELCOME_TEMPLATE_PLUGS_CONNECTED`    | `ph-light ph-plugs-connected`           | 1          |
| Light-weight chats circle icon of a New Project template                                      | `WELCOME_TEMPLATE_CHATS_CIRCLE`       | `ph-light ph-chats-circle`              | 1          |
| Light-weight brain icon of a New Project template                                             | `WELCOME_TEMPLATE_BRAIN`              | `ph-light ph-brain` _Same_              | 1          |
| Light-weight eye icon of a New Project template                                               | `WELCOME_TEMPLATE_EYE`                | `ph-light ph-eye`                       | 1          |
| Light-weight microphone icon of a New Project template                                        | `WELCOME_TEMPLATE_MICROPHONE`         | `ph-light ph-microphone`                | 1          |
| Light-weight chart scatter icon of a New Project template                                     | `WELCOME_TEMPLATE_CHART_SCATTER`      | `ph-light ph-chart-scatter`             | 1          |
| Light-weight flow arrow icon of a New Project template                                        | `WELCOME_TEMPLATE_FLOW_ARROW`         | `ph-light ph-flow-arrow`                | 1          |
| Light-weight chart bar icon of a New Project template                                         | `WELCOME_TEMPLATE_CHART_BAR`          | `ph-light ph-chart-bar`                 | 1          |
| Light-weight database icon of a New Project template                                          | `WELCOME_TEMPLATE_DATABASE`           | `ph-light ph-database`                  | 1          |
| Light-weight magnifying glass icon of a New Project template                                  | `WELCOME_TEMPLATE_MAGNIFYING_GLASS`   | `ph-light ph-magnifying-glass`          | 1          |
| Light-weight cube icon of a New Project template                                              | `WELCOME_TEMPLATE_CUBE`               | `ph-light ph-cube`                      | 1          |
| Light-weight shipping container icon of a New Project template                                | `WELCOME_TEMPLATE_SHIPPING_CONTAINER` | `ph-light ph-shipping-container` _Same_ | 1          |
| Light-weight infinity icon of a New Project template                                          | `WELCOME_TEMPLATE_INFINITY`           | `ph-light ph-infinity`                  | 1          |
| Light-weight puzzle piece icon of a New Project template                                      | `WELCOME_TEMPLATE_PUZZLE_PIECE`       | `ph-light ph-puzzle-piece` _Same_       | 1          |
| Light-weight code icon of a New Project template                                              | `WELCOME_TEMPLATE_CODE`               | `ph-light ph-code`                      | 1          |
| Light-weight browser icon of a New Project template                                           | `WELCOME_TEMPLATE_BROWSER`            | `ph-light ph-browser`                   | 1          |
| Light-weight chat circle dots icon of a New Project template                                  | `WELCOME_TEMPLATE_CHAT_CIRCLE_DOTS`   | `ph-light ph-chat-circle-dots`          | 1          |
| Light-weight repeat icon of a New Project template                                            | `WELCOME_TEMPLATE_REPEAT`             | `ph-light ph-repeat`                    | 1          |
| Light-weight file doc icon of a New Project template                                          | `WELCOME_TEMPLATE_FILE_DOC`           | `ph-light ph-file-doc`                  | 1          |
| Light-weight package icon of a New Project template                                           | `WELCOME_TEMPLATE_PACKAGE`            | `ph-light ph-package`                   | 1          |
| Light-weight toolbox icon of a New Project template                                           | `WELCOME_TEMPLATE_TOOLBOX`            | `ph-light ph-toolbox`                   | 1          |
| Light-weight brackets angle icon of a New Project template                                    | `WELCOME_TEMPLATE_BRACKETS_ANGLE`     | `ph-light ph-brackets-angle`            | 1          |
| Light-weight wrench icon of a New Project template                                            | `WELCOME_TEMPLATE_WRENCH`             | `ph-light ph-wrench`                    | 1          |
| Light-weight game controller icon of a New Project template                                   | `WELCOME_TEMPLATE_GAME_CONTROLLER`    | `ph-light ph-game-controller`           | 1          |
| Light-weight sword icon of a New Project template                                             | `WELCOME_TEMPLATE_SWORD`              | `ph-light ph-sword`                     | 1          |
| Light-weight cube focus icon of a New Project template                                        | `WELCOME_TEMPLATE_CUBE_FOCUS`         | `ph-light ph-cube-focus`                | 1          |
| Light-weight cpu icon of a New Project template                                               | `WELCOME_TEMPLATE_CPU`                | `ph-light ph-cpu` _Same_                | 1          |
| Light-weight circuitry icon of a New Project template                                         | `WELCOME_TEMPLATE_CIRCUITRY`          | `ph-light ph-circuitry`                 | 1          |
| Light-weight house line icon of a New Project template                                        | `WELCOME_TEMPLATE_HOUSE_LINE`         | `ph-light ph-house-line`                | 1          |
| Light-weight cube transparent icon of a New Project template                                  | `WELCOME_TEMPLATE_CUBE_TRANSPARENT`   | `ph-light ph-cube-transparent`          | 1          |
| Light-weight flask icon of a New Project template                                             | `WELCOME_TEMPLATE_FLASK`              | `ph-light ph-flask`                     | 1          |
| Light-weight sparkle of a skill in the New Project wizard's Skills step: Studio's skill glyph | `WELCOME_SKILL`                       | `ph-light ph-sparkle`                   | 1          |
| Icon of the New Project wizard's Import Skill button                                          | `WELCOME_SKILL_IMPORT`                | `ph-light ph-download-simple`           | 1          |
| Icon of a New Project wizard step not yet visited                                             | `WELCOME_STEP_TODO`                   | `ph-light ph-circle`                    | 1          |
| Icon of a New Project wizard step the user filled in                                          | `WELCOME_STEP_DONE`                   | `ph-fill ph-check-circle` _Same_        | 3          |
| Icon of a New Project wizard step the user passed without filling in                          | `WELCOME_STEP_SKIPPED`                | `ph-light ph-minus-circle`              | 1          |
| Plus on the Technology step's field for adding one that is not listed                         | `WELCOME_TECH_ADD`                    | `ph-light ph-plus`                      | 1          |
| Icon of a supporting document attached to a new project                                       | `WELCOME_DOCUMENT`                    | `ph-light ph-file-text`                 | 1          |
| Icon of an image attached to a new project                                                    | `WELCOME_DOCUMENT_IMAGE`              | `ph-light ph-image`                     | 1          |
| Icon of the New Project wizard's Add Documents button                                         | `WELCOME_DOCUMENT_ADD`                | `ph-light ph-paperclip`                 | 1          |

### Setup wizard (30)

| Purpose                                                                                                                         | Name                      | Today                                          | Files |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------- | ----- |
| Icon of the setup wizard's welcome step                                                                                         | `SETUP_WELCOME`           | `ph-house-line`                                | 1     |
| Icon of the setup wizard's what's-new step                                                                                      | `SETUP_WHATS_NEW`         | `ph-megaphone`                                 | 1     |
| Icon of the setup wizard's appearance step                                                                                      | `SETUP_APPEARANCE`        | `ph-monitor` _Same_                            | 1     |
| Icon of the setup wizard's summary step: the whole setup on one page                                                            | `SETUP_SUMMARY`           | `ph-list-checks` _Same_                        | 1     |
| Icon of the setup wizard's language servers step                                                                                | `SETUP_LANGUAGE_SERVERS`  | `ph-desktop-tower` _Same_                      | 1     |
| Icon of the setup wizard's debug adapters step                                                                                  | `SETUP_DEBUG_ADAPTERS`    | `ph-bug`                                       | 1     |
| Icon of the setup wizard's decoders step                                                                                        | `SETUP_DECODERS`          | `ph-cpu`                                       | 1     |
| Icon of the setup wizard's container engines step                                                                               | `SETUP_CONTAINER_ENGINES` | `ph-shipping-container`                        | 1     |
| Icon of the setup wizard's database engines step                                                                                | `SETUP_DATABASE_ENGINES`  | `ph-database`                                  | 1     |
| Setup step for package-manager plugins                                                                                          | `SETUP_PACKAGE_MANAGERS`  | `ph-package`                                   | 1     |
| Setup step for test-adapter plugins                                                                                             | `SETUP_TEST_ADAPTERS`     | `ph-flask`                                     | 1     |
| Icon of Live Server (#1062): Open with Live Server, and the status chip of a running one                                        | `LIVE_SERVER`             | `ph-broadcast`                                 | 3     |
| Setup step for live-server plugins                                                                                              | `SETUP_LIVE_SERVERS`      | `ph-broadcast` _Same_                          | 1     |
| Tests panel's mark for a test that passed (#1352)                                                                               | `TEST_PASSED`             | `ph-fill ph-check-circle` _Same_               | 2     |
| Tests panel's mark for a test that failed                                                                                       | `TEST_FAILED`             | `ph-fill ph-x-circle` _Same_                   | 2     |
| Tests panel's mark for a test that could not run: a crash, a timeout, a broken build                                            | `TEST_ERRORED`            | `ph-fill ph-warning-circle` _Same_             | 2     |
| Tests panel's mark for a test that was skipped                                                                                  | `TEST_SKIPPED`            | `ph-duotone ph-minus-circle` _Same_            | 2     |
| Tests panel's mark for a test that has not run                                                                                  | `TEST_NOT_RUN`            | `ph-circle-dashed`                             | 1     |
| Tests panel's mark for a test waiting its turn in a run                                                                         | `TEST_QUEUED`             | `ph-clock` _Same_                              | 1     |
| Tests panel's Run Failed command                                                                                                | `TEST_RUN_FAILED`         | `ph-duotone ph-arrow-counter-clockwise` _Same_ | 1     |
| Icon of the setup wizard's AI providers step                                                                                    | `SETUP_AI_PROVIDER`       | `ph-brain` _Same_                              | 1     |
| Icon of the setup wizard's security step                                                                                        | `SETUP_SECURITY`          | `ph-shield` _Same_                             | 1     |
| Icon of the setup wizard's terminal step                                                                                        | `SETUP_TERMINAL`          | `ph-terminal-window` _Same_                    | 1     |
| Setup wizard's version-control plugin step: the tool that reads repositories (#818)                                             | `SETUP_VERSION_CONTROL`   | `ph-git-fork`                                  | 1     |
| Setup wizard's hosting plugin step: where repositories are hosted (#820)                                                        | `SETUP_HOSTING`           | `ph-git-pull-request`                          | 1     |
| Mark against something the setup wizard's summary could not find                                                                | `SETUP_MISSING`           | `ph-x-circle` _Same_                           | 1     |
| Mark against something present but incompletely set up, or that could not be checked                                            | `SETUP_WARNING`           | `ph-warning-circle`                            | 1     |
| Mark against something the setup wizard's summary reports as simply not set — nothing installed in a category, no forge signed… | `SETUP_NOT_SET`           | `ph-minus-circle`                              | 1     |
| Arrow leading the setup wizard's Back button, mirroring Next's                                                                  | `ARROW_LEFT`              | `ph-bold ph-arrow-left`                        | 1     |
| Arrow trailing the setup wizard's Next button                                                                                   | `ARROW_RIGHT`             | `ph-bold ph-arrow-right`                       | 1     |

### Status bar (1)

| Purpose                                                    | Name      | Today                | Files |
| ---------------------------------------------------------- | --------- | -------------------- | ----- |
| Notches icon pinned to the trailing edge of the status bar | `NOTCHES` | `ph-bold ph-notches` | 1     |

### Shared affordances (27)

| Purpose                                                                                                                        | Name                   | Today                        | Files      |
| ------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------- | ---------- |
| Split-layout (toggle layout) icon                                                                                              | `LAYOUT_SPLIT`         | `ph-columns` _Same_          | 3          |
| Add (plus) icon                                                                                                                | `PLUS`                 | `ph-plus`                    | 16         |
| Delete (trash) icon                                                                                                            | `TRASH`                | `ph-trash`                   | 16         |
| Delete icon in the duotone weight, for a filled destructive button — the tinted body keeps the bin legible against the…        | `TRASH_DUOTONE`        | `ph-duotone ph-trash` _Same_ | 6          |
| Delete icon in its lidless form, for a destructive action stated as a button beside other buttons, where the lidded bin's…     | `TRASH_SIMPLE`         | `ph-trash-simple`            | **Unused** |
| Download icon, used for actions that fetch something over the network                                                          | `DOWNLOAD`             | `ph-download-simple`         | 12         |
| Download icon in the duotone weight, for a filled button that installs or updates a plugin — the tinted tray keeps it legible… | `DOWNLOAD_DUOTONE`     | `ph-duotone ph-download`     | 3          |
| Upload icon, for an Export action — the counterpart of DOWNLOAD on Import                                                      | `UPLOAD_SIMPLE`        | `ph-upload-simple`           | 1          |
| Select-all (double check) icon                                                                                                 | `SELECT_ALL`           | `ph-checks`                  | 1          |
| Options icon: a checked list, for the menu row gathering a panel's standing switches                                           | `OPTIONS`              | `ph-list-checks` _Same_      | 2          |
| Downward caret used on menus and split buttons                                                                                 | `CARET_DOWN`           | `ph-caret-down`              | 10         |
| Bold downward caret, used on the document well's document-list menu button                                                     | `CARET_DOWN_BOLD`      | `ph-bold ph-caret-down`      | 4          |
| Upward caret used on drop-up menus that open above their trigger                                                               | `CARET_UP`             | `ph-caret-up`                | 3          |
| Leftward caret used on back navigation and collapsed nodes in right-to-left layouts                                            | `CARET_LEFT`           | `ph-caret-left`              | 3          |
| Rightward caret used on collapsed nodes                                                                                        | `CARET_RIGHT`          | `ph-caret-right`             | 8          |
| Bold rightward caret on the welcome screen's accordion headers                                                                 | `CARET_RIGHT_BOLD`     | `ph-bold ph-caret-right`     | 2          |
| Filled downward caret used on expanded tree nodes                                                                              | `CARET_DOWN_FILL`      | `ph-fill ph-caret-down`      | 2          |
| Filled upward caret used on expanded tree nodes that open above their trigger                                                  | `CARET_UP_FILL`        | `ph-fill ph-caret-up`        | **Unused** |
| Filled leftward caret used on collapsed tree nodes in right-to-left layouts                                                    | `CARET_LEFT_FILL`      | `ph-fill ph-caret-left`      | **Unused** |
| Filled rightward caret used on collapsed tree nodes                                                                            | `CARET_RIGHT_FILL`     | `ph-fill ph-caret-right`     | 1          |
| Plus-square glyph used to expand every node in a tree                                                                          | `PLUS_SQUARE`          | `ph-plus-square`             | 2          |
| Minus-square glyph used to collapse every node in a tree                                                                       | `MINUS_SQUARE`         | `ph-minus-square`            | 2          |
| Duotone plus-square glyph used by the explorer tool strips' expand-all button                                                  | `PLUS_SQUARE_DUOTONE`  | `ph-duotone ph-plus-square`  | 6          |
| Duotone minus-square glyph used by the explorer tool strips' collapse-all button                                               | `MINUS_SQUARE_DUOTONE` | `ph-duotone ph-minus-square` | 6          |
| Three-dots glyph used to open an overflow menu of further actions                                                              | `DOTS_THREE`           | `ph-dots-three`              | **Unused** |
| Bold three-dots glyph used by the explorer tool strips' more-actions menu button, where the regular weight reads too faint…    | `DOTS_THREE_BOLD`      | `ph-bold ph-dots-three`      | 15         |
| Vertical three-dots glyph used for a row's overflow menu                                                                       | `DOTS_THREE_VERTICAL`  | `ph-dots-three-vertical`     | 1          |

### Image viewer (15)

| Purpose                                                                          | Name                       | Today                                          | Files |
| -------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------- | ----- |
| Zoom-in icon shown on the image viewer's View group                              | `ZOOM_IN`                  | `ph-duotone ph-magnifying-glass-plus`          | 2     |
| Zoom-out icon shown on the image viewer's View group                             | `ZOOM_OUT`                 | `ph-duotone ph-magnifying-glass-minus`         | 2     |
| Fit-to-window icon shown on the image viewer's View group                        | `ZOOM_FIT`                 | `ph-duotone ph-corners-in`                     | 2     |
| Actual-size (1:1) icon shown on the image viewer's View group                    | `ZOOM_ACTUAL`              | `ph-duotone ph-number-square-one`              | 2     |
| Checkerboard icon shown on the image viewer's background choice for transparency | `CHECKERBOARD`             | `ph-duotone ph-checkerboard`                   | 2     |
| Light-background icon shown on the image viewer's background choice              | `BACKGROUND_LIGHT`         | `ph-duotone ph-sun`                            | 2     |
| Dark-background icon shown on the image viewer's background choice               | `BACKGROUND_DARK`          | `ph-duotone ph-moon`                           | 2     |
| Rotate-clockwise icon shown on the image viewer's Edit group                     | `ROTATE_CLOCKWISE`         | `ph-duotone ph-arrow-clockwise` _Same_         | 2     |
| Rotate-counter-clockwise icon shown on the image viewer's Edit group             | `ROTATE_COUNTER_CLOCKWISE` | `ph-duotone ph-arrow-counter-clockwise` _Same_ | 2     |
| Flip-horizontal icon shown on the image viewer's Edit group                      | `FLIP_HORIZONTAL`          | `ph-duotone ph-flip-horizontal`                | 2     |
| Flip-vertical icon shown on the image viewer's Edit group                        | `FLIP_VERTICAL`            | `ph-duotone ph-flip-vertical`                  | 2     |
| Crop icon shown on the image viewer's Edit group                                 | `CROP`                     | `ph-duotone ph-crop`                           | 2     |
| Resize icon shown on the image viewer's Edit group                               | `RESIZE`                   | `ph-duotone ph-resize`                         | 2     |
| Export icon shown on the image viewer's Export As action                         | `EXPORT`                   | `ph-duotone ph-export`                         | 4     |
| Open-source icon shown on the image viewer's action that opens an SVG as text    | `OPEN_SOURCE`              | `ph-duotone ph-file-code`                      | 3     |

## 4. Drawn without the icon set

These are drawn by styles or by the editor itself, so replacing the icon set would not change them. Found by searching the editor's styles; there may be others.

| What                                                                           | How it is drawn                                              |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Breakpoint, conditional breakpoint, logpoint, disabled and verified breakpoint | Styles (`_breakpoints.scss`)                                 |
| Current line while debugging                                                   | Styles (`_debug-execution.scss`)                             |
| Folding arrows in the editor                                                   | Studio's styles replacing the editor's own (`_folding.scss`) |
| Change bars beside lines                                                       | Styles                                                       |
| Icons inside the editor's remaining built-in controls                          | The editor's own icon font                                   |
