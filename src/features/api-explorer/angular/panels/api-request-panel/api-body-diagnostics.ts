import { CodeFieldMarker } from '@shared/angular/components/forms/code-field/code-field';
import { Diagnostic } from '@shared/angular/services/diagnostics/diagnostics';
import { ApiRequest } from '@shared/api/api-client-types';
import { languageForBodyKind } from './api-body-language';

/**
 * The name a request with no name is reported under.
 */
const UNNAMED_REQUEST: string = 'Untitled request';

/**
 * Converts the problems marked in a request's body editor into diagnostics for the well's status
 * strip: a JSON syntax error or an XML well-formedness error, filed under the request's name. They are
 * workspace-scoped because the body is not a document the diagnostics service knows; the request is
 * the file, and its name is what the strip and any problems list show.
 * @param request The request whose body was marked.
 * @param markers The problems marked in the body.
 * @returns Returns the diagnostics.
 */
export function diagnosticsForBody(
  request: ApiRequest,
  markers: readonly CodeFieldMarker[],
): readonly Diagnostic[] {
  const name: string = request.name.trim();
  const file: string = name.length > 0 ? name : UNNAMED_REQUEST;
  const language: string = languageForBodyKind(request.body.kind);
  return markers.map((marker: CodeFieldMarker): Diagnostic => ({
    file,
    message: marker.message,
    severity: marker.severity,
    line: marker.line,
    column: marker.column,
    source: marker.source.length > 0 ? marker.source : language,
    documentId: null,
    path: null,
    scope: 'workspace',
  }));
}
