/**
 * Keeps a session's server's view of which documents are open consistent with the windows that hold
 * them (#1190). A server tracks open documents itself, and Roslyn treats a `didOpen` for a document it
 * already has open as a broken contract and aborts — which is what a window reloading while its
 * session keeps running did: the reloaded window opened its documents again, and nothing had closed
 * them.
 *
 * Each document records the windows holding it open. A window opening one the server already has
 * open has it closed first, so the server takes the newer text; a window closing one others still
 * hold leaves it open; and a window that goes away has the documents only it held closed.
 * @typeParam THolder What a window is identified by — its `WebContents`.
 */
export class LspOpenDocuments<THolder> {
  /**
   * Holds the windows holding each open document, keyed by its URI.
   */
  private readonly holders: Map<string, Set<THolder>> = new Map<string, Set<THolder>>();

  /**
   * Records a window opening a document.
   * @param uri The document.
   * @param holder The window opening it.
   * @returns Returns true when the server already has it open, and must be told it closed first.
   */
  public open(uri: string, holder: THolder): boolean {
    const holders: Set<THolder> = this.holders.get(uri) ?? new Set<THolder>();
    const alreadyOpen: boolean = holders.size > 0;
    holders.add(holder);
    this.holders.set(uri, holders);
    return alreadyOpen;
  }

  /**
   * Records a window closing a document.
   * @param uri The document.
   * @param holder The window closing it.
   * @returns Returns true when no window holds it any longer, and the server is to be told it closed.
   */
  public close(uri: string, holder: THolder): boolean {
    const holders: Set<THolder> | undefined = this.holders.get(uri);
    if (holders === undefined) {
      return true;
    }
    holders.delete(holder);
    if (holders.size > 0) {
      return false;
    }
    this.holders.delete(uri);
    return true;
  }

  /**
   * Releases a window that has gone away: the documents it held are no longer its.
   * @param holder The window.
   * @returns Returns the documents no window holds any longer, which the server is to be told closed.
   */
  public release(holder: THolder): string[] {
    const closed: string[] = [];
    for (const [uri, holders] of this.holders) {
      if (holders.delete(holder) && holders.size === 0) {
        this.holders.delete(uri);
        closed.push(uri);
      }
    }
    return closed;
  }
}
