import { inject, Service, Signal, signal, WritableSignal } from '@angular/core';
import { ApiEnvironment, ApiFolder, HttpField } from '@shared/api/api-client-types';
import { Log } from '@shared/angular/services/log/log';
import { ApiWorkspace, newField } from '../api-workspace/api-workspace';

/**
 * The variable an environment's root address is stored as. Requests are written against it, so a new
 * environment with an address is usable by every request that already exists.
 */
const BASE_URL_VARIABLE: string = 'base_url';

/**
 * Owns the dialogs that name a new collection or environment: whether each is open, what has been
 * typed into it, and what confirming it adds to the workspace.
 *
 * It exists because two surfaces raise the same two dialogs — the explorer panel's more-actions menu
 * and the ribbon's New group — and "New Collection" must mean one thing wherever it is pressed. The
 * state lives here rather than in the panel for a second reason: the panel is a dock panel and can be
 * closed, while the ribbon is always there, so a dialog owned by the panel would be a ribbon command
 * that silently did nothing.
 *
 * Provided by the API Explorer view, which renders the dialogs; it lives as long as the tab.
 */
@Service()
export class ApiPrompts {
  /**
   * Holds the workspace a confirmed dialog adds to.
   */
  private readonly workspace: ApiWorkspace = inject(ApiWorkspace);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds whether the new-collection dialog is open.
   */
  private readonly collectionOpenSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the new-environment dialog is open.
   */
  private readonly environmentOpenSignal: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Gets whether the new-collection dialog is open.
   */
  public readonly collectionOpen: Signal<boolean> = this.collectionOpenSignal.asReadonly();

  /**
   * Gets whether the new-environment dialog is open.
   */
  public readonly environmentOpen: Signal<boolean> = this.environmentOpenSignal.asReadonly();

  /**
   * Holds the name typed into the new-collection dialog.
   */
  public readonly collectionName: WritableSignal<string> = signal<string>('');

  /**
   * Holds the name typed into the new-environment dialog.
   */
  public readonly environmentName: WritableSignal<string> = signal<string>('');

  /**
   * Holds the root address typed into the new-environment dialog, stored as the environment's
   * `base_url` variable.
   */
  public readonly environmentRootUrl: WritableSignal<string> = signal<string>('');

  /**
   * Opens the dialog that names a new collection, on a blank field.
   */
  public promptCollection(): void {
    this.collectionName.set('');
    this.collectionOpenSignal.set(true);
  }

  /**
   * Closes the new-collection dialog without adding anything.
   */
  public cancelCollection(): void {
    this.collectionOpenSignal.set(false);
  }

  /**
   * Adds the named collection and closes the dialog. An empty name is ignored, so the dialog's Add
   * button and the Enter key agree.
   * @returns Returns the new collection, or null when the name was empty.
   */
  public confirmCollection(): ApiFolder | null {
    const name: string = this.collectionName().trim();
    if (name === '') {
      return null;
    }
    this.collectionOpenSignal.set(false);
    this.log.info('api-explorer.prompts', 'Added collection', { name });
    return this.workspace.addCollection(name);
  }

  /**
   * Opens the dialog that names a new environment and gives it a root address, on blank fields.
   */
  public promptEnvironment(): void {
    this.environmentName.set('');
    this.environmentRootUrl.set('');
    this.environmentOpenSignal.set(true);
  }

  /**
   * Closes the new-environment dialog without adding anything.
   */
  public cancelEnvironment(): void {
    this.environmentOpenSignal.set(false);
  }

  /**
   * Adds the named environment, seeding it with the root address as its `base_url` variable — the
   * variable seeded requests are written against, so a new environment is usable straight away.
   * @returns Returns the new environment, or null when the name was empty.
   */
  public confirmEnvironment(): ApiEnvironment | null {
    const name: string = this.environmentName().trim();
    if (name === '') {
      return null;
    }
    const rootUrl: string = this.environmentRootUrl().trim();
    const variables: readonly HttpField[] =
      rootUrl === '' ? [] : [newField(BASE_URL_VARIABLE, rootUrl)];
    this.environmentOpenSignal.set(false);
    this.log.info('api-explorer.prompts', 'Added environment', { name, rooted: rootUrl !== '' });
    return this.workspace.addEnvironment(name, variables);
  }
}
