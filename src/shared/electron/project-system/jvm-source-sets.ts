/**
 * Matches the prefix Maven resolves to the module's own directory.
 */
const MAVEN_BASE_DIRECTORY: RegExp = /^\$\{(project\.basedir|basedir)\}\/?/;

/**
 * Removes an XML document's comments, keeping only what lies outside them, so what is left can never
 * join up into a comment that was not there. An unclosed comment runs to the end of the document.
 * @param xml The document.
 * @returns Returns the document without its comments.
 */
function withoutXmlComments(xml: string): string {
  let result: string = '';
  let index: number = 0;
  while (index < xml.length) {
    const open: number = xml.indexOf('<!--', index);
    if (open === -1) {
      return result + xml.slice(index);
    }
    result += xml.slice(index, open);
    const close: number = xml.indexOf('-->', open + 4);
    index = close === -1 ? xml.length : close + 3;
  }
  return result;
}

/**
 * Reads the source folders a Maven pom moves away from the `src` convention: `<sourceDirectory>`,
 * `<testSourceDirectory>`, and the `<directory>` of each resource. The pom is only read, never
 * evaluated, so a path built from any property but the module's own directory is left out.
 * @param pom The pom content, or null when absent.
 * @returns Returns the declared folders relative to the module, untrusted: the caller confines them.
 */
export function mavenSourceDirectories(pom: string | null): readonly string[] {
  if (pom === null) {
    return [];
  }
  const body: string = withoutXmlComments(pom);
  const declared: string[] = [];
  for (const match of body.matchAll(
    /<(?:sourceDirectory|testSourceDirectory)>\s*([^<]+?)\s*<\//g,
  )) {
    declared.push(match[1]);
  }
  for (const block of body.matchAll(/<(resources|testResources)>([\s\S]*?)<\/\1>/g)) {
    for (const match of block[2].matchAll(/<directory>\s*([^<]+?)\s*<\/directory>/g)) {
      declared.push(match[1]);
    }
  }
  return declared
    .map((directory: string): string => directory.replace(MAVEN_BASE_DIRECTORY, ''))
    .filter((directory: string): boolean => directory.length > 0 && !directory.includes('${'));
}

/**
 * Reads the source folders a Gradle build script names in its `sourceSets`, from every `srcDir`,
 * `srcDirs` and `setSrcDirs` line. A build script is a program, so running it to ask is exactly what a
 * scan must not do: only quoted literals are read, and one built from a variable is left out.
 * @param script The build-script content, or null when absent.
 * @returns Returns the declared folders relative to the module, untrusted: the caller confines them.
 */
export function gradleSourceDirectories(script: string | null): readonly string[] {
  if (script === null) {
    return [];
  }
  const body: string = script.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const declared: string[] = [];
  for (const statement of body.matchAll(/\b(?:setSrcDirs|srcDirs?)\b([^\n]*)/g)) {
    for (const quoted of statement[1].matchAll(/['"]([^'"]+)['"]/g)) {
      if (!quoted[1].includes('$')) {
        declared.push(quoted[1]);
      }
    }
  }
  return declared;
}
