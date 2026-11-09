// The files a new repository can start with: the New Project wizard's choices, as GitHub offers them.
// The renderer names a template and the main process writes it, so a request can only ever put these
// texts in a project.

/**
 * Describes a template the wizard offers.
 */
export interface RepositoryFileTemplate {
  /**
   * Gets the template's name, as the wizard lists it.
   */
  readonly label: string;

  /**
   * Gets the file's text. A licence's names its year and holder with `{year}` and `{holder}`.
   */
  readonly text: string;
}

/**
 * The `.gitignore` templates, by id.
 */
export const GITIGNORE_TEMPLATES: Readonly<Record<string, RepositoryFileTemplate>> = {
  node: { label: 'Node', text: 'node_modules/\ndist/\ncoverage/\n*.log\n.env\n' },
  python: {
    label: 'Python',
    text: '__pycache__/\n*.py[cod]\n.venv/\nvenv/\ndist/\nbuild/\n*.egg-info/\n.env\n',
  },
  dotnet: { label: '.NET', text: 'bin/\nobj/\n*.user\n.vs/\nTestResults/\n' },
  java: { label: 'Java', text: '*.class\ntarget/\nbuild/\n.gradle/\n*.jar\n' },
  rust: { label: 'Rust', text: 'target/\n' },
  go: { label: 'Go', text: '*.exe\n*.test\n*.out\nvendor/\n' },
  cpp: { label: 'C++', text: 'build/\ncmake-build-*/\n*.o\n*.obj\n*.a\n*.so\n*.dylib\n*.dll\n' },
};

/**
 * The licence templates, by id: the short permissive ones, whose whole text sits comfortably here.
 */
export const LICENCE_TEMPLATES: Readonly<Record<string, RepositoryFileTemplate>> = {
  mit: {
    label: 'MIT',
    text: `MIT License

Copyright (c) {year} {holder}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  },
  isc: {
    label: 'ISC',
    text: `ISC License

Copyright (c) {year} {holder}

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`,
  },
  unlicense: {
    label: 'The Unlicense',
    text: `This is free and unencumbered software released into the public domain.

Anyone is free to copy, modify, publish, use, compile, sell, or distribute this
software, either in source code form or as a compiled binary, for any purpose,
commercial or non-commercial, and by any means.

In jurisdictions that recognize copyright laws, the author or authors of this
software dedicate any and all copyright interest in the software to the public
domain. We make this dedication for the benefit of the public at large and to
the detriment of our heirs and successors. We intend this dedication to be an
overt act of relinquishment in perpetuity of all present and future rights to
this software under copyright law.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

For more information, please refer to <https://unlicense.org/>
`,
  },
};

/**
 * Describes the files a new repository starts with.
 */
export interface InitialRepositoryFiles {
  /**
   * Gets the `.gitignore` template's id, or undefined for none.
   */
  readonly gitignore?: string;

  /**
   * Gets the licence template's id, or undefined for none.
   */
  readonly licence?: string;

  /**
   * Gets whether it starts with a README naming the project.
   */
  readonly readme: boolean;

  /**
   * Gets whether those files are committed as the repository's first commit.
   */
  readonly commit: boolean;
}

/**
 * Describes a file to write.
 */
export interface RepositoryFile {
  /**
   * Gets its name, in the project's folder.
   */
  readonly name: string;

  /**
   * Gets its text.
   */
  readonly text: string;
}

/**
 * Builds the files a new repository starts with.
 * @param choices What was chosen.
 * @param project The project's name, which holds the licence's copyright.
 * @param year The year.
 * @returns Returns the files.
 */
export function repositoryFiles(
  choices: InitialRepositoryFiles,
  project: string,
  year: number,
): readonly RepositoryFile[] {
  const gitignore: RepositoryFileTemplate | undefined =
    choices.gitignore === undefined ? undefined : GITIGNORE_TEMPLATES[choices.gitignore];
  const licence: RepositoryFileTemplate | undefined =
    choices.licence === undefined ? undefined : LICENCE_TEMPLATES[choices.licence];
  return [
    ...(gitignore === undefined ? [] : [{ name: '.gitignore', text: gitignore.text }]),
    ...(licence === undefined
      ? []
      : [
          {
            name: 'LICENSE',
            text: licence.text
              .replace('{year}', String(year))
              .replace('{holder}', `${project} contributors`),
          },
        ]),
    ...(choices.readme ? [{ name: 'README.md', text: `# ${project}\n` }] : []),
  ];
}

/**
 * Reads a wizard's choices from an untrusted value, dropping anything that names no template.
 * @param value The value.
 * @returns Returns the choices, or undefined when the value is not a set of them.
 */
export function parseInitialFiles(value: unknown): InitialRepositoryFiles | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const { gitignore, licence, readme, commit } = value as Record<string, unknown>;
  return {
    ...(typeof gitignore === 'string' && Object.hasOwn(GITIGNORE_TEMPLATES, gitignore)
      ? { gitignore }
      : {}),
    ...(typeof licence === 'string' && Object.hasOwn(LICENCE_TEMPLATES, licence)
      ? { licence }
      : {}),
    readme: readme === true,
    commit: commit === true,
  };
}
