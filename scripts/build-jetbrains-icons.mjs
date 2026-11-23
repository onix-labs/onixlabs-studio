#!/usr/bin/env node
// SPIKE (#1551): builds a VS Code icon theme from the IntelliJ Platform's file icons, for looking at.
//
// The artwork is downloaded from JetBrains' public repository at a fixed commit into `.cache`, which Git
// ignores: none of it is committed, bundled or published. Most icons carry an Apache 2.0 notice, and the
// build reports the ones that do not, since those need confirming before anything ships.
//
//   node scripts/build-jetbrains-icons.mjs                 every icon
//   node scripts/build-jetbrains-icons.mjs --marked-only   only icons carrying the notice

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

// Anchored to this file, so it runs the same from any working directory.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = join(REPO, '.cache', 'icon-themes', 'jetbrains');
const COMMIT = 'b131167ab6e123d544b9bc1e53688eb5a9e27c62';
const SOURCE = `https://raw.githubusercontent.com/JetBrains/intellij-community/${COMMIT}`;
const MARKED_ONLY = argv.includes('--marked-only');

const TYPES = 'platform/icons/src/expui/fileTypes';
const NODES = 'platform/icons/src/expui/nodes';
const LANGUAGE = 'platform/icons/src/language';
const KOTLIN = 'plugins/kotlin/base/resources/resources/org/jetbrains/kotlin/idea/icons/expui';
const PYTHON = 'python/python-parser/resources/icons/com/jetbrains/python/parser/expui';

// Each icon: where it is, then the extensions, names and folders it is drawn for.
const ICONS = {
  'any-type': { from: `${TYPES}/anyType` },
  text: { from: `${TYPES}/text`, extensions: ['txt', 'log', 'text'], names: ['license'] },
  csharp: { from: `${TYPES}/Csharp`, extensions: ['cs', 'csx', 'razor', 'cshtml'] },
  // No .NET project or solution icon is open source, so IntelliJ's module icons stand in.
  project: {
    from: `${NODES}/module`,
    extensions: ['csproj', 'fsproj', 'vbproj', 'vcxproj', 'sqlproj', 'proj', 'shproj'],
  },
  solution: { from: `${NODES}/moduleGroup`, extensions: ['sln', 'slnx', 'slnf'] },
  c: { from: `${TYPES}/c`, extensions: ['c'] },
  cpp: { from: `${TYPES}/cpp`, extensions: ['cpp', 'cc', 'cxx', 'ixx', 'cppm'] },
  h: { from: `${TYPES}/h`, extensions: ['h', 'hpp', 'hh', 'hxx'] },
  java: { from: `${TYPES}/java`, extensions: ['java'] },
  'java-class': { from: `${TYPES}/javaClass`, extensions: ['class'] },
  kotlin: { from: `${KOTLIN}/kotlin`, extensions: ['kt'] },
  'kotlin-script': { from: `${KOTLIN}/kotlinScript`, extensions: ['kts'] },
  'kotlin-gradle': { from: `${KOTLIN}/kotlinGradleScript`, extensions: ['gradle.kts'] },
  groovy: { from: `${TYPES}/groovy`, extensions: ['groovy'] },
  gradle: { from: `${TYPES}/gradle`, extensions: ['gradle'] },
  maven: { from: 'java/openapi/resources/icons/expui/maven', names: ['pom.xml'] },
  scala: { from: `${LANGUAGE}/scala`, extensions: ['scala', 'sbt', 'sc'] },
  python: { from: `${PYTHON}/python`, extensions: ['py', 'pyi', 'pyw'] },
  jupyter: { from: `${TYPES}/jupyter`, extensions: ['ipynb'] },
  go: { from: `${LANGUAGE}/go`, extensions: ['go'], names: ['go.mod', 'go.sum', 'go.work'] },
  rust: { from: `${LANGUAGE}/rust`, extensions: ['rs'] },
  ruby: { from: `${LANGUAGE}/ruby`, extensions: ['rb', 'erb', 'gemspec'], names: ['gemfile'] },
  php: { from: `${LANGUAGE}/php`, extensions: ['php'] },
  swift: { from: `${TYPES}/swiftLang`, extensions: ['swift'] },
  perl: { from: `${TYPES}/perl`, extensions: ['pl', 'pm'] },
  typescript: { from: `${TYPES}/typeScript`, extensions: ['ts', 'mts', 'cts', 'tsx'] },
  javascript: { from: `${TYPES}/javaScript`, extensions: ['js', 'mjs', 'cjs', 'jsx'] },
  vue: { from: `${TYPES}/vue`, extensions: ['vue'] },
  html: { from: `${TYPES}/html`, extensions: ['html', 'htm'] },
  xhtml: { from: `${TYPES}/xhtml`, extensions: ['xhtml'] },
  css: { from: `${TYPES}/css`, extensions: ['css', 'scss', 'sass', 'less'] },
  json: { from: `${TYPES}/json`, extensions: ['json', 'jsonc', 'json5', 'webmanifest'] },
  'json-schema': { from: `${TYPES}/jsonSchema`, extensions: ['schema.json'] },
  xml: {
    from: `${TYPES}/xml`,
    extensions: ['xml', 'props', 'targets', 'resx', 'xaml', 'axaml', 'plist', 'nuspec'],
    names: ['nuget.config', 'app.config', 'web.config', 'packages.config'],
  },
  xsd: { from: `${TYPES}/xsd`, extensions: ['xsd', 'xsl', 'xslt'] },
  wsdl: { from: `${TYPES}/wsdl`, extensions: ['wsdl'] },
  yaml: { from: `${TYPES}/yaml`, extensions: ['yml', 'yaml'] },
  toml: { from: `${TYPES}/toml`, extensions: ['toml'] },
  properties: { from: `${TYPES}/properties`, extensions: ['properties'] },
  config: { from: `${TYPES}/config`, extensions: ['config', 'conf', 'cfg', 'ini', 'env'] },
  'editor-config': { from: `${TYPES}/editorConfig`, extensions: ['editorconfig'] },
  'git-ignore': {
    from: `${TYPES}/gitignore`,
    extensions: ['gitignore', 'gitattributes', 'gitmodules', 'gitkeep'],
  },
  ignored: { from: `${TYPES}/ignored`, extensions: ['dockerignore', 'npmignore'] },
  docker: {
    from: `${TYPES}/docker`,
    extensions: ['dockerfile'],
    names: ['dockerfile', 'docker-compose.yml', 'compose.yml', 'compose.yaml'],
  },
  terraform: { from: `${TYPES}/terraform`, extensions: ['tf', 'tfvars'] },
  jenkins: { from: `${TYPES}/jenkins`, names: ['jenkinsfile'] },
  bazel: { from: `${TYPES}/bazel`, extensions: ['bzl', 'bazel'], names: ['build', 'workspace'] },
  markdown: { from: `${TYPES}/markdown`, extensions: ['md', 'markdown', 'mdx'] },
  rst: { from: `${TYPES}/rst`, extensions: ['rst'] },
  shell: { from: `${TYPES}/shell`, extensions: ['sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd'] },
  sql: { from: `${TYPES}/sql`, extensions: ['sql'] },
  csv: { from: `${TYPES}/csv`, extensions: ['csv', 'tsv'] },
  graphql: { from: `${TYPES}/graphql`, extensions: ['graphql', 'gql'] },
  http: { from: `${TYPES}/http`, extensions: ['http', 'rest'] },
  patch: { from: `${TYPES}/patch`, extensions: ['patch', 'diff'] },
  diagram: { from: `${TYPES}/diagram`, extensions: ['drawio', 'puml'] },
  'source-map': { from: `${TYPES}/sourceMap`, extensions: ['map'] },
  image: {
    from: `${TYPES}/image`,
    extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'icns', 'bmp', 'avif'],
  },
  font: { from: `${TYPES}/font`, extensions: ['ttf', 'otf', 'woff', 'woff2'] },
  archive: {
    from: `${TYPES}/archive`,
    extensions: ['zip', 'tar', 'gz', 'tgz', '7z', 'jar', 'war', 'nupkg', 'vsix'],
  },
  binary: { from: `${TYPES}/binaryData`, extensions: ['exe', 'dll', 'so', 'dylib', 'bin', 'pdb'] },
  folder: { from: `${NODES}/folder` },
  workspace: { from: `${NODES}/workspace` },
  'source-root': { from: `${NODES}/sourceRoot`, folders: ['src', 'source', 'sources'] },
  'test-root': {
    from: `${NODES}/testRoot`,
    folders: ['test', 'tests', 'spec', 'specs', '__tests__', 'e2e'],
  },
  'resources-root': { from: `${NODES}/resourcesRoot`, folders: ['resources', 'assets'] },
  'exclude-root': {
    from: `${NODES}/excludeRoot`,
    folders: ['bin', 'obj', 'node_modules', 'dist', 'build', 'out', 'target', 'coverage', '.cache'],
  },
  'web-folder': { from: `${NODES}/webFolder`, folders: ['wwwroot', 'public', 'www'] },
  'library-folder': { from: `${NODES}/libraryFolder`, folders: ['lib', 'libs', 'packages'] },
  'github-folder': { from: `${NODES}/folderGithub`, folders: ['.github'] },
};

/**
 * Downloads a file of the source repository.
 * @param {string} path Its path.
 * @returns {Promise<string | null>} Returns its text, or null when there is no such file.
 */
async function download(path) {
  const response = await fetch(`${SOURCE}/${path}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }
  return response.text();
}

/**
 * Builds one set of associations.
 * @param {readonly (readonly [string, object])[]} icons The icons, by identifier.
 * @param {string} suffix The suffix of the set's pictures.
 * @returns {object} Returns the set.
 */
function associations(icons, suffix) {
  const named = (key) =>
    Object.fromEntries(
      icons.flatMap(([id, icon]) => (icon[key] ?? []).map((name) => [name, `${id}${suffix}`])),
    );
  return {
    file: `any-type${suffix}`,
    folder: `folder${suffix}`,
    rootFolder: `workspace${suffix}`,
    fileExtensions: named('extensions'),
    fileNames: named('names'),
    folderNames: named('folders'),
  };
}

const unmarked = [];
const built = [];
rmSync(OUTPUT, { recursive: true, force: true });
mkdirSync(join(OUTPUT, 'icons'), { recursive: true });
await Promise.all(
  Object.entries(ICONS).map(async ([id, icon]) => {
    const light = await download(`${icon.from}.svg`);
    if (light === null) {
      console.error(`No such icon: ${icon.from}.svg`);
      exit(1);
    }
    const dark = (await download(`${icon.from}_dark.svg`)) ?? light;
    if (![light, dark].every((svg) => svg.includes('Apache 2.0'))) {
      unmarked.push(id);
      if (MARKED_ONLY) {
        return;
      }
    }
    writeFileSync(join(OUTPUT, 'icons', `${id}.svg`), light);
    writeFileSync(join(OUTPUT, 'icons', `${id}_dark.svg`), dark);
    built.push([id, icon]);
  }),
);
const pictures = built.flatMap(([id]) => [
  [id, { iconPath: `./icons/${id}.svg` }],
  [`${id}_dark`, { iconPath: `./icons/${id}_dark.svg` }],
]);
writeFileSync(
  join(OUTPUT, 'theme.json'),
  JSON.stringify({
    iconDefinitions: Object.fromEntries(pictures),
    ...associations(built, '_dark'),
    light: associations(built, ''),
  }),
);
writeFileSync(
  join(OUTPUT, 'package.json'),
  JSON.stringify({
    contributes: { iconThemes: [{ id: 'jetbrains', label: 'JetBrains', path: './theme.json' }] },
  }),
);
writeFileSync(join(OUTPUT, 'NOTICE.txt'), (await download('NOTICE.txt')) ?? '');
console.log(`Built ${built.length} icons in ${OUTPUT}`);
console.log(`Without an Apache 2.0 notice (${unmarked.length}): ${unmarked.sort().join(', ')}`);
