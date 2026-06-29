import { Service, signal, Signal, WritableSignal } from '@angular/core';

/**
 * The location of an open code editor: which document it backs and the file it shows. Editors
 * register this against their Monaco model URI so global Monaco diagnostics can be mapped back to a
 * document, regardless of which workspace owns it.
 */
export interface EditorLocation {
  /**
   * Gets the identifier of the document the editor backs (its owning tab/panel id).
   */
  readonly documentId: string;

  /**
   * Gets the document's absolute file path, or null when it has never been saved.
   */
  readonly path: string | null;

  /**
   * Gets the document's display file name.
   */
  readonly name: string;
}

/**
 * A request to reveal a position in the editor backing a given document.
 */
export interface RevealRequest {
  /**
   * Gets the identifier of the document whose editor should reveal the position.
   */
  readonly documentId: string;

  /**
   * Gets the 1-based line to reveal.
   */
  readonly line: number;

  /**
   * Gets the 1-based column to place the cursor at.
   */
  readonly column: number;

  /**
   * Gets a monotonically increasing token so two requests for the same position still re-trigger.
   */
  readonly nonce: number;
}

/**
 * Coordinates the open code editors across every workspace. Each editor registers its Monaco model
 * URI against the document it backs (so the global Monaco markers can be resolved to a document and
 * file), and a reveal request lets a consumer such as the Problems panel jump the right editor to a
 * diagnostic's line. This service is a root singleton because Monaco models, and the markers raised
 * against them, are global while {@link Documents} and {@link Diagnostics} are per-workspace.
 */
@Service()
export class Editors {
  /**
   * Holds the registered editor locations, keyed by their Monaco model URI.
   */
  private readonly locations: Map<string, EditorLocation> = new Map<string, EditorLocation>();

  /**
   * Holds the current reveal request, or null when none is pending.
   */
  private readonly reveal: WritableSignal<RevealRequest | null> = signal<RevealRequest | null>(
    null,
  );

  /**
   * Holds the running token that distinguishes successive reveal requests.
   */
  private nonce: number = 0;

  /**
   * Gets the current reveal request.
   */
  public readonly revealRequest: Signal<RevealRequest | null> = this.reveal.asReadonly();

  /**
   * Registers (or updates) the editor backing a document, keyed by its Monaco model URI.
   * @param modelUri The editor's Monaco model URI.
   * @param location The document the editor backs.
   */
  public register(modelUri: string, location: EditorLocation): void {
    this.locations.set(modelUri, location);
  }

  /**
   * Removes a registered editor.
   * @param modelUri The editor's Monaco model URI.
   */
  public unregister(modelUri: string): void {
    this.locations.delete(modelUri);
  }

  /**
   * Resolves the document an editor backs from its Monaco model URI.
   * @param modelUri The Monaco model URI to resolve.
   * @returns Returns the editor location, or undefined when the URI is not a registered editor.
   */
  public locate(modelUri: string): EditorLocation | undefined {
    return this.locations.get(modelUri);
  }

  /**
   * Resolves the Monaco model URI of the editor backing the given file path, so a consumer such as
   * the language-server client can set markers on the file's model.
   * @param path The absolute file path to resolve.
   * @returns Returns the model URI, or undefined when no registered editor backs the path.
   */
  public modelUriForPath(path: string): string | undefined {
    for (const [modelUri, location] of this.locations) {
      if (location.path === path) {
        return modelUri;
      }
    }
    return undefined;
  }

  /**
   * Requests that the editor backing the given document reveal a position.
   * @param documentId The identifier of the document to reveal in.
   * @param line The 1-based line to reveal.
   * @param column The 1-based column to place the cursor at.
   */
  public requestReveal(documentId: string, line: number, column: number): void {
    this.nonce += 1;
    this.reveal.set({ documentId, line, column, nonce: this.nonce });
  }
}
