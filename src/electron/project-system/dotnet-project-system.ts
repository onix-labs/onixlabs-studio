import { Dirent } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ProjectEntry, ProjectModel, ProjectNode } from '../../shared/project-system';
import { ProjectSystem } from './project-system';

/**
 * The project-file extensions the .NET project system recognises.
 */
const PROJECT_EXTENSIONS: readonly string[] = ['.csproj', '.fsproj', '.vbproj'];

/**
 * The directories skipped when scanning for loose projects: hidden, dependency, and build-output
 * directories never hold the project files to open.
 */
const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>(['node_modules', 'bin', 'obj']);

/**
 * How many directory levels deep to scan for loose projects when there is no solution (1 searches only
 * the root itself).
 */
const PROJECT_SCAN_DEPTH: number = 2;

/**
 * Models a .NET workspace: an `.slnx` or `.sln` solution when one is present (parsed into its solution
 * folders and projects), or the loose projects discovered under the root otherwise. Reads only the
 * solution file's own listing — it does not evaluate the projects (that is the language server's job).
 */
export class DotnetProjectSystem implements ProjectSystem {
  /**
   * Gets the kind identifier of this project system.
   */
  public readonly kind: string = 'dotnet';

  /**
   * Determines whether the root holds a .NET solution or any .NET projects.
   * @param root The absolute workspace root.
   * @returns Returns true when a solution file or at least one project is found.
   */
  public async detect(root: string): Promise<boolean> {
    if ((await this.solutionFile(root)) !== null) {
      return true;
    }
    return (await this.findProjects(root, PROJECT_SCAN_DEPTH)).length > 0;
  }

  /**
   * Builds the .NET project model: from the solution file when present, otherwise from loose projects.
   * @param root The absolute workspace root.
   * @returns Returns the model, or null when no solution or projects are found.
   */
  public async load(root: string): Promise<ProjectModel | null> {
    const solution: { name: string; path: string } | null = await this.solutionFile(root);
    if (solution !== null) {
      const tree: readonly ProjectNode[] = await this.parseSolution(solution.path);
      const projects: readonly ProjectEntry[] = this.flatten(tree);
      return { kind: this.kind, root, solution, projects, tree };
    }
    const files: string[] = await this.findProjects(root, PROJECT_SCAN_DEPTH);
    if (files.length === 0) {
      return null;
    }
    const tree: readonly ProjectNode[] = files.map((file: string): ProjectNode => this.toNode(file));
    return { kind: this.kind, root, solution: null, projects: this.flatten(tree), tree };
  }

  /**
   * Finds the solution file at the root, preferring the modern `.slnx` over a classic `.sln`.
   * @param root The absolute workspace root.
   * @returns Returns the solution name and path, or null when none is present at the root.
   */
  private async solutionFile(root: string): Promise<{ name: string; path: string } | null> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
      return null;
    }
    const names: string[] = entries
      .filter((entry: Dirent): boolean => entry.isFile())
      .map((entry: Dirent): string => entry.name);
    const file: string | undefined =
      names.find((name: string): boolean => name.endsWith('.slnx')) ??
      names.find((name: string): boolean => name.endsWith('.sln'));
    if (file === undefined) {
      return null;
    }
    return { name: path.basename(file, path.extname(file)), path: path.join(root, file) };
  }

  /**
   * Parses a solution file into its logical tree, dispatching on its format.
   * @param solutionPath The absolute path of the solution file.
   * @returns Returns the tree of folders and projects.
   */
  private async parseSolution(solutionPath: string): Promise<readonly ProjectNode[]> {
    let content: string;
    try {
      content = await fs.readFile(solutionPath, 'utf8');
    } catch {
      return [];
    }
    const directory: string = path.dirname(solutionPath);
    return solutionPath.endsWith('.slnx')
      ? this.parseSlnx(content, directory)
      : this.parseSln(content, directory);
  }

  /**
   * Parses the XML `.slnx` solution format into a tree, preserving its solution folders.
   * @param content The file content.
   * @param directory The solution's directory, project paths are resolved against.
   * @returns Returns the tree of folders and projects.
   */
  private parseSlnx(content: string, directory: string): readonly ProjectNode[] {
    const root: { children: ProjectNode[] } = { children: [] };
    const stack: { children: ProjectNode[] }[] = [root];
    // Walk the Folder/Project tags in order, maintaining a stack of the open folders so a project is
    // attached to the folder it sits in. The format is simple, well-formed XML, so a tag scan suffices.
    const tags: RegExpMatchArray[] = [...content.matchAll(/<(\/?)(Folder|Project)\b([^>]*?)(\/?)>/g)];
    for (const tag of tags) {
      const closing: boolean = tag[1] === '/';
      const element: string = tag[2];
      const attributes: string = tag[3];
      const selfClosing: boolean = tag[4] === '/';
      const parent: { children: ProjectNode[] } = stack[stack.length - 1];
      if (element === 'Project') {
        const relative: string | null = this.attribute(attributes, 'Path');
        if (relative !== null) {
          parent.children.push(this.toNode(this.resolve(directory, relative)));
        }
        continue;
      }
      if (closing) {
        if (stack.length > 1) {
          stack.pop();
        }
        continue;
      }
      const folder: ProjectNode & { type: 'folder'; children: ProjectNode[] } = {
        type: 'folder',
        name: this.folderName(this.attribute(attributes, 'Name') ?? ''),
        children: [],
      };
      parent.children.push(folder);
      if (!selfClosing) {
        stack.push(folder);
      }
    }
    return root.children;
  }

  /**
   * Parses the classic `.sln` solution format into a flat list of project nodes. Solution folders
   * (whose entry names a folder rather than a project file) are skipped; the classic format records
   * folder nesting separately, which is not reconstructed here.
   * @param content The file content.
   * @param directory The solution's directory, project paths are resolved against.
   * @returns Returns the project nodes.
   */
  private parseSln(content: string, directory: string): readonly ProjectNode[] {
    const pattern: RegExp = /^Project\("\{[^}]+\}"\)\s*=\s*"[^"]+",\s*"([^"]+)"/gm;
    const nodes: ProjectNode[] = [];
    for (const match of content.matchAll(pattern)) {
      const relative: string = match[1];
      if (PROJECT_EXTENSIONS.includes(path.extname(relative).toLowerCase())) {
        nodes.push(this.toNode(this.resolve(directory, relative)));
      }
    }
    return nodes;
  }

  /**
   * Reads a double-quoted XML attribute value from a tag's attribute text.
   * @param attributes The attribute text.
   * @param name The attribute name.
   * @returns Returns the value, or null when the attribute is absent.
   */
  private attribute(attributes: string, name: string): string | null {
    const match: RegExpExecArray | null = new RegExp(`${name}="([^"]*)"`).exec(attributes);
    return match === null ? null : match[1];
  }

  /**
   * Normalises a solution-folder name (the `.slnx` format wraps names in slashes, e.g. `/Core/`).
   * @param name The raw folder name.
   * @returns Returns the trimmed name.
   */
  private folderName(name: string): string {
    return name.replace(/^\/+|\/+$/g, '');
  }

  /**
   * Resolves a solution-relative project path (which may use either slash) to an absolute path.
   * @param directory The solution's directory.
   * @param relative The relative project path.
   * @returns Returns the absolute path.
   */
  private resolve(directory: string, relative: string): string {
    return path.resolve(directory, relative.replace(/\\/g, '/'));
  }

  /**
   * Builds a project node from an absolute project-file path.
   * @param file The absolute project-file path.
   * @returns Returns the project node.
   */
  private toNode(file: string): ProjectNode {
    return { type: 'project', name: path.basename(file, path.extname(file)), path: file };
  }

  /**
   * Flattens a tree into its projects, in tree order.
   * @param tree The tree to flatten.
   * @returns Returns the projects.
   */
  private flatten(tree: readonly ProjectNode[]): readonly ProjectEntry[] {
    const projects: ProjectEntry[] = [];
    for (const node of tree) {
      if (node.type === 'project') {
        projects.push({ name: node.name, path: node.path });
      } else {
        projects.push(...this.flatten(node.children));
      }
    }
    return projects;
  }

  /**
   * Finds project files under a directory, descending at most `depth` levels and skipping hidden,
   * dependency, and build-output directories.
   * @param directory The directory to search.
   * @param depth The number of directory levels to descend (1 searches only the directory itself).
   * @returns Returns the matching absolute project-file paths.
   */
  private async findProjects(directory: string, depth: number): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const results: string[] = [];
    for (const entry of entries) {
      const full: string = path.join(directory, entry.name);
      if (entry.isFile() && PROJECT_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())) {
        results.push(full);
      } else if (entry.isDirectory() && depth > 1 && !this.isSkipped(entry.name)) {
        results.push(...(await this.findProjects(full, depth - 1)));
      }
    }
    return results;
  }

  /**
   * Determines whether a directory is skipped when scanning for loose projects.
   * @param name The directory name.
   * @returns Returns true when the directory should be skipped.
   */
  private isSkipped(name: string): boolean {
    return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
  }
}
