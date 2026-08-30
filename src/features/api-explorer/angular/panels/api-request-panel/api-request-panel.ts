import { DecimalPipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { Dropdown, DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { PasswordField } from '@shared/angular/components/forms/password-field/password-field';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Textarea } from '@shared/angular/components/forms/textarea/textarea';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import {
  PropertyGrid,
  PropertyGridEdit,
  PropertyGridRow,
} from '@shared/angular/components/property-grid/property-grid';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import {
  ApiRequest,
  HttpAuth,
  HttpBody,
  HttpBodyKind,
  HttpField,
  HttpMethod,
  HTTP_METHODS,
  HttpOutcome,
  HttpResponse,
} from '@shared/api/api-client-types';
import { ApiRequestOpener } from '../../api-request-opener/api-request-opener';
import { ApiWorkspace } from '../../api-workspace/api-workspace';

/**
 * The editor sections of a request, in the order the tab strip offers them.
 */
type RequestSection = 'params' | 'auth' | 'headers' | 'body' | 'tests' | 'settings';

/**
 * The sections shown in the tab strip, with the label each carries.
 */
const SECTIONS: readonly { readonly id: RequestSection; readonly label: string }[] = [
  { id: 'params', label: 'Params' },
  { id: 'auth', label: 'Auth' },
  { id: 'headers', label: 'Headers' },
  { id: 'body', label: 'Body' },
  { id: 'tests', label: 'Tests' },
  { id: 'settings', label: 'Settings' },
];

/**
 * Names the request's three name/value lists, so one set of grid handlers serves all of them.
 */
type FieldList = 'params' | 'headers' | 'body';

/**
 * The body kinds offered by the body-kind picker.
 */
const BODY_KINDS: readonly { readonly id: HttpBodyKind; readonly label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'json', label: 'JSON' },
  { id: 'text', label: 'Text' },
  { id: 'xml', label: 'XML' },
  { id: 'form', label: 'Form data' },
  { id: 'urlencoded', label: 'URL encoded' },
];

/**
 * One request open in the API well — the API Explorer's document. It is to this view what an open file
 * is to a workspace: the dock panel's id *is* the request's id, so the well tabs, splits, floats and
 * pops these out with no knowledge that they are HTTP calls.
 *
 * Every edit writes straight through to the {@link ApiWorkspace}, which persists. There is no separate
 * dirty state and no Save: a request is a small piece of data the user is iterating on, and losing an
 * unsaved URL because a tab was closed is the kind of papercut this view exists to avoid. Sending is
 * likewise routed through the workspace, so the History panel and the status strip see every send
 * without this panel telling them about it.
 */
@Component({
  selector: 'app-api-request-panel',
  imports: [
    Button,
    DecimalPipe,
    Dropdown,
    AppIcon,
    NgTemplateOutlet,
    PanelToolbar,
    PasswordField,
    PropertyGrid,
    Textarea,
    TextField,
  ],
  templateUrl: './api-request-panel.html',
  styleUrl: './api-request-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApiRequestPanel {
  /**
   * Gets the dock panel this component is projected into; its id is the request's id.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the API workspace the request is read from and written to.
   */
  private readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Holds the opener, so renaming a request re-titles its tab.
   */
  private readonly opener: ApiRequestOpener = inject(ApiRequestOpener);

  /**
   * Holds the icon tokens used by the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the sections offered by the tab strip.
   */
  protected readonly sections: readonly { readonly id: RequestSection; readonly label: string }[] =
    SECTIONS;

  /**
   * Holds the section currently shown.
   */
  protected readonly section: WritableSignal<RequestSection> = signal<RequestSection>('params');

  /**
   * Holds whether the response is shown as headers rather than as its body.
   */
  protected readonly showResponseHeaders: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets the method options offered by the method picker.
   */
  protected readonly methodOptions: readonly DropdownOption[] = HTTP_METHODS.map(
    (method: HttpMethod): DropdownOption => ({ value: method, label: method }),
  );

  /**
   * Gets the body-kind options offered by the body-kind picker.
   */
  protected readonly bodyKindOptions: readonly DropdownOption[] = BODY_KINDS.map(
    (kind: { readonly id: HttpBodyKind; readonly label: string }): DropdownOption => ({
      value: kind.id,
      label: kind.label,
    }),
  );

  /**
   * Gets the auth-scheme options offered by the auth picker.
   */
  protected readonly authOptions: readonly DropdownOption[] = [
    { value: 'none', label: 'No auth' },
    { value: 'bearer', label: 'Bearer token' },
    { value: 'basic', label: 'Basic' },
    { value: 'api-key', label: 'API key' },
  ];

  /**
   * Gets where an API key is carried.
   */
  protected readonly apiKeyInOptions: readonly DropdownOption[] = [
    { value: 'header', label: 'Header' },
    { value: 'query', label: 'Query' },
  ];

  /**
   * Gets the request being edited, or undefined once it has been deleted from under this tab.
   */
  protected readonly request: Signal<ApiRequest | undefined> = computed(
    (): ApiRequest | undefined =>
      this.workspace
        .requests()
        .find((candidate: ApiRequest): boolean => candidate.id === this.panel().id),
  );

  /**
   * Gets whether this request is currently in flight.
   */
  protected readonly sending: Signal<boolean> = computed((): boolean =>
    this.workspace.inFlight().has(this.panel().id),
  );

  /**
   * Gets the latest outcome for this request, or null when it has not been sent this session.
   */
  protected readonly outcome: Signal<HttpOutcome | null> = computed((): HttpOutcome | null => {
    // Read the in-flight set so a completed send re-evaluates this: the outcome map is written before
    // the id is removed from the set, so the set is the later of the two signals to settle.
    this.workspace.inFlight();
    return this.workspace.outcome(this.panel().id);
  });

  /**
   * Gets the latest response, or null when the request has not been sent or did not produce one.
   */
  protected readonly response: Signal<HttpResponse | null> = computed((): HttpResponse | null => {
    const outcome: HttpOutcome | null = this.outcome();
    return outcome !== null && outcome.kind === 'response' ? outcome : null;
  });

  /**
   * Gets the URL as it will actually be sent, with `{{variables}}` substituted from the active
   * environment. Shown beneath the URL bar whenever it differs from what was typed, so a wrong or
   * missing variable is visible before the request is sent rather than after it fails.
   */
  protected readonly resolvedUrl: Signal<string> = computed((): string => {
    const request: ApiRequest | undefined = this.request();
    if (request === undefined) {
      return '';
    }
    // Track the active environment so a change to it re-resolves the preview.
    this.workspace.activeEnvironment();
    const resolved: string = this.workspace.substitute(request.url);
    return resolved === request.url ? '' : resolved;
  });

  /**
   * Sends the request, or cancels it when it is already in flight.
   */
  protected send(): void {
    const id: string = this.panel().id;
    if (this.sending()) {
      this.workspace.cancel(id);
      return;
    }
    void this.workspace.send(id);
  }

  /**
   * Renames the request, keeping its tab title in step.
   * @param name The new name.
   */
  protected rename(name: string): void {
    this.workspace.updateRequest(this.panel().id, { name });
    this.opener.retitle(this.panel().id, name);
  }

  /**
   * Applies a partial change to the request.
   * @param changes The fields to change.
   */
  protected update(changes: Partial<ApiRequest>): void {
    this.workspace.updateRequest(this.panel().id, changes);
  }

  /**
   * Applies an edit from a property grid to one row of a field list, dropping a row the user has
   * blanked out entirely.
   * @param list Which list the row belongs to.
   * @param edit The edit reported by the grid.
   */
  protected updateField(list: FieldList, edit: PropertyGridEdit): void {
    this.writeFields(list, (fields: readonly HttpField[]): readonly HttpField[] =>
      fields
        .map((field: HttpField): HttpField =>
          field.id === edit.id
            ? {
                ...field,
                ...(edit.name !== undefined ? { name: edit.name } : {}),
                ...(edit.value !== undefined ? { value: edit.value } : {}),
                ...(edit.enabled !== undefined ? { enabled: edit.enabled } : {}),
              }
            : field,
        )
        .filter((field: HttpField): boolean => field.name !== '' || field.value !== ''),
    );
  }

  /**
   * Stores a row the user has started typing into the grid's blank row, under the identity the grid
   * handed over — which is what keeps the caret in the cell being typed into.
   * @param list Which list the row belongs to.
   * @param row The new row.
   */
  protected addField(list: FieldList, row: PropertyGridRow): void {
    this.writeFields(list, (fields: readonly HttpField[]): readonly HttpField[] => [
      ...fields,
      { id: row.id, name: row.name, value: row.value, enabled: row.enabled !== false },
    ]);
  }

  /**
   * Removes a row from a field list.
   * @param list Which list the row belongs to.
   * @param id The row identifier.
   */
  protected removeField(list: FieldList, id: string): void {
    this.writeFields(list, (fields: readonly HttpField[]): readonly HttpField[] =>
      fields.filter((field: HttpField): boolean => field.id !== id),
    );
  }

  /**
   * Applies a transformation to one of the request's field lists and writes it back.
   * @param list Which list to transform.
   * @param transform The transformation to apply.
   */
  private writeFields(
    list: FieldList,
    transform: (fields: readonly HttpField[]) => readonly HttpField[],
  ): void {
    const request: ApiRequest | undefined = this.request();
    if (request === undefined) {
      return;
    }
    switch (list) {
      case 'params':
        this.update({ params: transform(request.params) });
        return;
      case 'headers':
        this.update({ headers: transform(request.headers) });
        return;
      case 'body':
        this.update({ body: { ...request.body, fields: transform(request.body.fields) } });
        return;
    }
  }

  /**
   * Changes the body kind, keeping whatever was typed under the previous kind.
   * @param kind The kind to switch to.
   */
  protected setBodyKind(kind: string): void {
    const request: ApiRequest | undefined = this.request();
    if (request === undefined) {
      return;
    }
    const body: HttpBody = { ...request.body, kind: kind as HttpBodyKind };
    this.update({ body });
  }

  /**
   * Changes the auth scheme, resetting its fields to the new scheme's empty form.
   * @param kind The scheme to switch to.
   */
  protected setAuthKind(kind: string): void {
    const schemes: Readonly<Record<string, HttpAuth>> = {
      none: { kind: 'none' },
      bearer: { kind: 'bearer', token: '' },
      basic: { kind: 'basic', username: '', password: '' },
      'api-key': { kind: 'api-key', key: '', value: '', in: 'header' },
    };
    this.update({ auth: schemes[kind] ?? { kind: 'none' } });
  }

  /**
   * Applies a partial change to the current auth scheme.
   * @param changes The auth fields to change.
   */
  protected updateAuth(changes: Record<string, string>): void {
    const request: ApiRequest | undefined = this.request();
    if (request === undefined) {
      return;
    }
    const auth: HttpAuth = { ...request.auth, ...changes };
    this.update({ auth });
  }

  /**
   * Formats a byte count for the response summary.
   * @param bytes The byte count.
   * @returns Returns the formatted size.
   */
  protected formatSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /**
   * Renders the response body for display, pretty-printing JSON so a one-line payload is readable.
   * Anything that does not parse is shown exactly as it arrived.
   * @param response The response to render.
   * @returns Returns the body text to show.
   */
  protected prettyBody(response: HttpResponse): string {
    const type: string = response.headers['content-type'] ?? '';
    if (!type.includes('json')) {
      return response.body;
    }
    try {
      return JSON.stringify(JSON.parse(response.body), null, 2);
    } catch {
      return response.body;
    }
  }

  /**
   * Gets the response headers as rows for display.
   * @param response The response whose headers are shown.
   * @returns Returns the header rows.
   */
  protected headerEntries(response: HttpResponse): readonly (readonly [string, string])[] {
    return Object.entries(response.headers);
  }

  /**
   * Classifies a status code, so the summary can colour it.
   * @param status The status code.
   * @returns Returns the class suffix for the status.
   */
  protected statusTone(status: number): string {
    if (status < 300) {
      return 'ok';
    }
    return status < 400 ? 'redirect' : 'error';
  }
}
