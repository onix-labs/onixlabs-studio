/**
 * The label for showing a path in the operating system's file manager.
 *
 * One wording for every such command, whatever it does underneath. A row's command opens the folder the
 * entry sits in, with the entry selected; a root's opens the folder's own contents. Both are the user
 * asking to see the thing on disk, so it is always "Open".
 *
 * One wording on every platform, too. Naming the platform's own app was tried and dropped: "Finder" is
 * wrong anywhere but a Mac, and "File Explorer" is also the name of Studio's own tree panel, so inside
 * that panel the command read as pointing at itself. "File System" names where the thing lives without
 * naming any app.
 *
 * Shared rather than restated per surface: every surface that can point at a path offers this command,
 * and each spelling out its own wording is another chance for one of them to drift — the Terminal
 * ribbon said "Finder" on Windows.
 */
export const OPEN_IN_FILE_SYSTEM_LABEL: string = 'Open in File System';
