/**
 * Identifies the Monaco marker owner under which language-server diagnostics are set, so they render
 * in the editor. The built-in Monaco-markers diagnostics provider skips this owner to avoid surfacing
 * the same diagnostics in the Problems panel twice. Kept in its own module so both the language-server
 * client and the Monaco diagnostics provider can share it without importing one another.
 */
export const LSP_MARKER_OWNER: string = 'lsp';
