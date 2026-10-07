// Opens the conversation canvas (#855) in an Electron window: the same Chromium Studio renders in, so what
// is reviewed is what ships. Started by `npm run canvas`, which serves the app with `ng serve`, so an
// edit to a card, its styles or a fixture reloads the window live.
//
// Deliberately not Studio's main process: the canvas renders components from fixtures, so it needs no
// plugins, no settings and no profile — and touches none of yours.

import { app, BrowserWindow } from 'electron';

const url = process.env.CANVAS_URL ?? 'http://127.0.0.1:4210/?canvas';

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    title: 'Conversation canvas',
    backgroundColor: '#1e1f22',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  void window.loadURL(url);
});

app.on('window-all-closed', () => app.quit());
