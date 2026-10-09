import { promises as fs } from 'node:fs';
import * as nodePath from 'node:path';
import { ReplaceFailure, ReplaceRequest, ReplaceResponse } from '@shared/api/search-channels';
import { logger } from './logger';
import { ReplaceOptions, ReplaceOutcome, replaceAll, replaceAt } from './search-replace';
import { WorkspaceContext } from './workspace-context';

/**
 * Caps how many files one replace may write, so a request cannot rewrite a whole tree in one go. A
 * search lists far fewer files than this; reaching it means the request did not come from one.
 */
const MAX_REPLACE_FILES: number = 5000;

/**
 * Determines whether an unknown value is a well-formed {@link ReplaceRequest}.
 * @param request The value to check.
 * @returns Returns true when the value has the expected shape.
 */
export function isReplaceRequest(request: unknown): request is ReplaceRequest {
  if (typeof request !== 'object' || request === null) {
    return false;
  }
  const candidate: Partial<Record<keyof ReplaceRequest, unknown>> = request;
  const target: unknown = candidate.target;
  return (
    typeof candidate.query === 'string' &&
    typeof candidate.root === 'string' &&
    typeof candidate.caseSensitive === 'boolean' &&
    typeof candidate.wholeWord === 'boolean' &&
    typeof candidate.regexp === 'boolean' &&
    typeof candidate.replacement === 'string' &&
    Array.isArray(candidate.files) &&
    candidate.files.every((file: unknown): boolean => typeof file === 'string') &&
    (target === undefined ||
      (typeof target === 'object' &&
        target !== null &&
        typeof (target as { path?: unknown }).path === 'string' &&
        Number.isInteger((target as { line?: unknown }).line) &&
        Number.isInteger((target as { column?: unknown }).column)))
  );
}

/**
 * Replaces matches of a query in a workspace's files on disk (#882): every match in each named file
 * (Replace All), or the one match a {@link ReplaceRequest.target} names (Replace).
 *
 * ⛔ Confinement is the whole of its trust. The renderer names the files, so each one must lie inside
 * the request's root — an OPEN workspace root — both as named and as resolved through any symlink: a
 * link inside the workspace pointing out of it would otherwise let a replace write anywhere the user
 * can. A file that fails either test is refused and reported, never written.
 *
 * Files are read, replaced and written one at a time, and only written when something changed, so a
 * file the query no longer matches is left exactly as it was.
 * @param request The validated request.
 * @param workspace The workspace context deciding which roots are open.
 * @returns Returns what was replaced, and what could not be.
 */
export async function replaceInFiles(
  request: ReplaceRequest,
  workspace: WorkspaceContext,
): Promise<ReplaceResponse> {
  const failed: ReplaceFailure[] = [];
  if (request.query.length === 0 || !workspace.isRoot(request.root)) {
    logger.warn('SearchReplace', 'Refused a replace with an empty query or an unknown root');
    return { replaced: 0, files: 0, failed };
  }
  const files: readonly string[] =
    request.target === undefined ? request.files : [request.target.path];
  if (files.length > MAX_REPLACE_FILES) {
    logger.warn('SearchReplace', `Refused a replace naming ${files.length} files`);
    return { replaced: 0, files: 0, failed };
  }
  const root: string = nodePath.resolve(request.root);
  let realRoot: string;
  try {
    realRoot = await fs.realpath(root);
  } catch (error: unknown) {
    logger.warn('SearchReplace', `The root ${root} could not be resolved`, error);
    return { replaced: 0, files: 0, failed };
  }
  const options: ReplaceOptions = request;
  let replaced: number = 0;
  let written: number = 0;
  for (const file of new Set<string>(files)) {
    const resolved: string = nodePath.resolve(file);
    if (!isInside(resolved, root)) {
      failed.push({ path: file, reason: 'It is outside the workspace.' });
      continue;
    }
    try {
      const real: string = await fs.realpath(resolved);
      if (!isInside(real, realRoot)) {
        failed.push({ path: file, reason: 'It links to somewhere outside the workspace.' });
        continue;
      }
      const text: string = await fs.readFile(real, 'utf8');
      const outcome: ReplaceOutcome =
        request.target === undefined
          ? replaceAll(text, options)
          : replaceAt(text, options, request.target.line, request.target.column);
      if (outcome.count === 0) {
        if (request.target !== undefined) {
          failed.push({ path: file, reason: 'The match is no longer there.' });
        }
        continue;
      }
      await fs.writeFile(real, outcome.text, 'utf8');
      replaced += outcome.count;
      written += 1;
    } catch (error: unknown) {
      logger.warn('SearchReplace', `Could not replace in ${file}`, error);
      failed.push({ path: file, reason: 'It could not be read or written.' });
    }
  }
  logger.info(
    'SearchReplace',
    `Replaced ${replaced} match(es) in ${written} file(s)${failed.length > 0 ? `; ${failed.length} refused` : ''}`,
  );
  return { replaced, files: written, failed };
}

/**
 * Determines whether a resolved path lies strictly inside a directory.
 * @param target The resolved path.
 * @param directory The resolved directory.
 * @returns Returns true when the path is inside it.
 */
function isInside(target: string, directory: string): boolean {
  return target.startsWith(directory + nodePath.sep);
}
