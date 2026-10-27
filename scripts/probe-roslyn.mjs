#!/usr/bin/env node
// Asks a Roslyn C# language server what it offers, and checks each feature with a real request.
//
// Studio advertises a deliberately narrow set of client capabilities, and a server only reveals what
// it offers in answer to what the client says it can do. This probe advertises a feature-complete
// client instead, opens a real solution, waits for the load to finish, then exercises every feature
// epic #1139 builds on: formatting, navigation, folding, highlights, inlay hints, code lens, symbols,
// hierarchies, file operations, workspace diagnostics, auto-insert and fix-all. It writes the whole
// answer — capabilities, dynamic registrations, the semantic-token legend and each check's result — to
// a JSON file, so two server versions can be diffed (#1140).
//
// Not part of any gate: it needs a .NET SDK, an installed server and a solution to load. Run it when
// moving the Roslyn pin, or before building a feature that depends on what the server does.
//
// ⚠️ Run it outside the agent sandbox: inside it the server answers `initialize` but the solution load
// never completes (the MSBuild build host cannot be reached; see #1163).
//
//   node scripts/probe-roslyn.mjs --solution ~/src/app/app.slnx
//   node scripts/probe-roslyn.mjs --solution app.slnx --file src/Program.cs --server <path> --out x.json
//   node scripts/probe-roslyn.mjs --solution app.slnx --verbose      # print the server's errors

import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { argv, env, exit, platform } from 'node:process';
import { pathToFileURL } from 'node:url';

/**
 * Reads a `--name value` argument.
 * @param {string} name The argument name, without dashes.
 * @returns {string | null} Returns its value, or null when absent.
 */
function option(name) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 || index + 1 >= argv.length ? null : argv[index + 1];
}

/**
 * Finds the newest Roslyn server Studio has installed for this machine, in the release profile.
 * @returns {string | null} Returns the server binary's path, or null when none is installed.
 */
function installedServer() {
  const profile =
    platform === 'darwin'
      ? path.join(homedir(), 'Library', 'Application Support', 'onixlabs-studio')
      : platform === 'win32'
        ? path.join(env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'onixlabs-studio')
        : path.join(env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'onixlabs-studio');
  const versions = path.join(profile, 'lsp-servers', 'roslyn');
  if (!existsSync(versions)) {
    return null;
  }
  const binary =
    platform === 'win32'
      ? 'Microsoft.CodeAnalysis.LanguageServer.exe'
      : 'Microsoft.CodeAnalysis.LanguageServer';
  // Newest first, comparing each dot-separated part as a number (5.13 is newer than 5.4); both the
  // nuget.org layout (tools/net10.0/<rid>) and the older vs-impl one (content/LanguageServer/<rid>).
  const numeric = (version) => version.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const newestFirst = readdirSync(versions).sort((left, right) => {
    const a = numeric(left);
    const b = numeric(right);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      if ((a[index] ?? 0) !== (b[index] ?? 0)) {
        return (b[index] ?? 0) - (a[index] ?? 0);
      }
    }
    return 0;
  });
  for (const version of newestFirst) {
    for (const rid of readdirSync(path.join(versions, version))) {
      for (const layout of [
        ['tools', 'net10.0'],
        ['content', 'LanguageServer'],
      ]) {
        const candidate = path.join(versions, version, rid, ...layout, rid, binary);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

/**
 * Finds the .NET root the server's apphost needs, from `DOTNET_ROOT` or the `dotnet` on the PATH.
 * @returns {string | undefined} Returns the folder, or undefined to let the apphost search.
 */
function dotnetRoot() {
  if (env.DOTNET_ROOT) {
    return env.DOTNET_ROOT;
  }
  try {
    const which = execFileSync(platform === 'win32' ? 'where' : 'which', ['dotnet'], {
      encoding: 'utf8',
    });
    return path.dirname(realpathSync(which.split(/\r?\n/)[0].trim()));
  } catch {
    return undefined;
  }
}

/**
 * Finds a C# source file to probe with: the first one under the solution's folder outside bin/obj.
 * @param {string} root The folder to search.
 * @returns {string | null} Returns its path, or null.
 */
function firstSourceFile(root) {
  const queue = [root];
  while (queue.length > 0) {
    const folder = queue.shift();
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory() && !['bin', 'obj', 'node_modules', '.git'].includes(entry.name)) {
        queue.push(path.join(folder, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.cs')) {
        return path.join(folder, entry.name);
      }
    }
  }
  return null;
}

const solutionArg = option('solution');
if (solutionArg === null) {
  console.error(
    'Usage: node scripts/probe-roslyn.mjs --solution <path.sln|path.slnx> [--file <path.cs>] [--server <path>] [--out <file.json>] [--verbose]',
  );
  exit(2);
}
const SOLUTION = path.resolve(solutionArg);
const ROOT = path.dirname(SOLUTION);
const SERVER = option('server') ?? installedServer();
const FILE = option('file') !== null ? path.resolve(option('file')) : firstSourceFile(ROOT);
const OUT = path.resolve(option('out') ?? path.join('.cache', 'roslyn-probe', 'capabilities.json'));
const VERBOSE = argv.includes('--verbose');
if (SERVER === null || !existsSync(SERVER)) {
  console.error(
    "No Roslyn server found. Install it from Studio's Plugin Manager, or pass --server.",
  );
  exit(2);
}
if (FILE === null) {
  console.error(`No .cs file found under ${ROOT}; pass --file.`);
  exit(2);
}

const t0 = Date.now();
const log = (...parts) => console.error(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...parts);
const logDir = path.join(tmpdir(), `probe-roslyn-${process.pid}`);
mkdirSync(logDir, { recursive: true });

const child = spawn(
  SERVER,
  ['--logLevel', 'Warning', '--extensionLogDirectory', logDir, '--stdio'],
  {
    cwd: ROOT,
    env: {
      ...env,
      DOTNET_ROOT: dotnetRoot(),
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
      DOTNET_NOLOGO: '1',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  },
);
let stderr = '';
let done = false;
child.stderr.on('data', (data) => (stderr += data));
child.on('exit', (code, signal) => {
  if (!done) {
    log(`The server exited early (code=${code}, signal=${signal}).\n${stderr.slice(-1500)}`);
    exit(1);
  }
});

// ---- JSON-RPC over stdio ---------------------------------------------------------------------

let nextId = 1;
const pending = new Map();
const waiters = {};
const registrations = [];
let buffer = Buffer.alloc(0);
child.stdout.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf('\r\n\r\n');
    if (end < 0) {
      return;
    }
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1]);
    if (buffer.length < end + 4 + length) {
      return;
    }
    const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
    buffer = buffer.subarray(end + 4 + length);
    handle(message);
  }
});
const send = (message) => {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
};
const request = (method, params, timeoutMs = 30000) =>
  new Promise((resolve) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ __error: 'timeout' });
    }, timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(
        message.error
          ? { __error: `${message.error.code} ${message.error.message}`.slice(0, 200) }
          : message.result,
      );
    });
    send({ id, method, params });
  });
const notify = (method, params) => send({ method, params });
const waitFor = (method) => new Promise((resolve) => (waiters[method] ??= []).push(resolve));

function handle(message) {
  if (message.id !== undefined && message.method === undefined) {
    pending.get(message.id)?.(message);
    pending.delete(message.id);
    return;
  }
  if (message.id !== undefined) {
    // Answered as Studio answers them: registrations recorded, configuration left at its defaults.
    if (message.method === 'client/registerCapability') {
      registrations.push(...(message.params.registrations ?? []));
    }
    const result =
      message.method === 'workspace/configuration'
        ? (message.params.items ?? []).map(() => null)
        : null;
    send({ id: message.id, result });
    return;
  }
  if (VERBOSE && message.method === 'window/logMessage' && message.params.type <= 2) {
    log(
      `server ${message.params.type === 1 ? 'error' : 'warning'}: ${String(message.params.message).split('\n')[0].slice(0, 260)}`,
    );
  }
  for (const resolve of waiters[message.method] ?? []) {
    resolve(message.params);
  }
  waiters[message.method] = [];
}

// ---- The handshake, advertising everything a client could support -----------------------------

const capabilities = {
  textDocument: {
    synchronization: {
      dynamicRegistration: true,
      didSave: true,
      willSave: true,
      willSaveWaitUntil: true,
    },
    diagnostic: { dynamicRegistration: true, relatedDocumentSupport: true },
    completion: {
      dynamicRegistration: true,
      completionItem: {
        snippetSupport: true,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
      },
      contextSupport: true,
    },
    hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: { dynamicRegistration: true },
    definition: { dynamicRegistration: true, linkSupport: true },
    typeDefinition: { dynamicRegistration: true, linkSupport: true },
    implementation: { dynamicRegistration: true, linkSupport: true },
    references: { dynamicRegistration: true },
    documentHighlight: { dynamicRegistration: true },
    documentSymbol: { dynamicRegistration: true, hierarchicalDocumentSymbolSupport: true },
    codeAction: {
      dynamicRegistration: true,
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            '',
            'quickfix',
            'refactor',
            'refactor.extract',
            'refactor.inline',
            'refactor.rewrite',
            'source',
            'source.organizeImports',
            'source.fixAll',
          ],
        },
      },
      isPreferredSupport: true,
      disabledSupport: true,
      dataSupport: true,
      resolveSupport: { properties: ['edit', 'command'] },
    },
    codeLens: { dynamicRegistration: true },
    documentLink: { dynamicRegistration: true },
    formatting: { dynamicRegistration: true },
    rangeFormatting: { dynamicRegistration: true },
    onTypeFormatting: { dynamicRegistration: true },
    rename: { dynamicRegistration: true, prepareSupport: true },
    foldingRange: { dynamicRegistration: true, lineFoldingOnly: true },
    selectionRange: { dynamicRegistration: true },
    linkedEditingRange: { dynamicRegistration: true },
    callHierarchy: { dynamicRegistration: true },
    typeHierarchy: { dynamicRegistration: true },
    semanticTokens: {
      dynamicRegistration: true,
      requests: { full: { delta: true }, range: true },
      tokenTypes: [],
      tokenModifiers: [],
      formats: ['relative'],
    },
    inlayHint: {
      dynamicRegistration: true,
      resolveSupport: {
        properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command'],
      },
    },
  },
  workspace: {
    workspaceFolders: true,
    configuration: true,
    applyEdit: true,
    workspaceEdit: { documentChanges: true, resourceOperations: ['create', 'rename', 'delete'] },
    didChangeConfiguration: { dynamicRegistration: true },
    didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
    symbol: { dynamicRegistration: true, resolveSupport: { properties: ['location.range'] } },
    executeCommand: { dynamicRegistration: true },
    semanticTokens: { refreshSupport: true },
    codeLens: { refreshSupport: true },
    inlayHint: { refreshSupport: true },
    diagnostics: { refreshSupport: true },
    fileOperations: {
      dynamicRegistration: true,
      willRename: true,
      didRename: true,
      willCreate: true,
      didCreate: true,
      willDelete: true,
      didDelete: true,
    },
  },
  window: {
    workDoneProgress: true,
    showMessage: { messageActionItem: { additionalPropertiesSupport: true } },
  },
};

log(`server ${SERVER}`);
log(`solution ${SOLUTION}`);
const init = await request('initialize', {
  processId: process.pid,
  rootUri: pathToFileURL(ROOT).href,
  workspaceFolders: [{ uri: pathToFileURL(ROOT).href, name: path.basename(ROOT) }],
  capabilities,
});
if (init?.__error) {
  log(`initialize failed: ${init.__error}`);
  exit(1);
}
notify('initialized', {});
notify('solution/open', { solution: pathToFileURL(SOLUTION).href });
const uri = pathToFileURL(FILE).href;
const text = readFileSync(FILE, 'utf8');
notify('textDocument/didOpen', { textDocument: { uri, languageId: 'csharp', version: 1, text } });
log('waiting for the solution to load');
const loadTimer = setTimeout(() => {
  log('The solution did not finish loading in 5 minutes (inside the agent sandbox it never will).');
  exit(1);
}, 300000);
await waitFor('workspace/projectInitializationComplete');
clearTimeout(loadTimer);
log('solution loaded');
await new Promise((resolve) => setTimeout(resolve, 2000));

// ---- The checks --------------------------------------------------------------------------------

const lines = text.split('\n');
// Finds the first line matching a pattern, outside `using` and `namespace` lines, and puts the caret
// inside the pattern's named `name` group — on the identifier itself, not on the keyword before it
// (a request made on `public` or on a namespace answers nothing, which reads like a missing feature).
const find = (pattern) => {
  for (let line = 0; line < lines.length; line++) {
    if (/^\s*(using|namespace) /.test(lines[line])) {
      continue;
    }
    const match = pattern.exec(lines[line]);
    if (match) {
      const name = match.groups?.name ?? match[0];
      const start = match.index + match[0].indexOf(name);
      return { line, character: start + 1, text: name };
    }
  }
  return null;
};
const typeName =
  find(/\b(?:class|interface|record|struct|enum)\s+(?<name>[A-Z]\w*)/) ??
  find(/\b(?<name>[A-Z][A-Za-z]{3,})\b/);
const call = find(/\.\s*(?<name>[A-Z][A-Za-z]+)\s*\(/) ?? typeName;
const member =
  find(
    /\b(?:public|private|internal|protected)\s+(?:static\s+|async\s+|override\s+|virtual\s+)*[\w<>?,.[\]]+\s+(?<name>[A-Z]\w*)\s*\(/,
  ) ?? typeName;
if (typeName === null) {
  log(`${FILE} has no identifier to probe with; pass a different --file.`);
  exit(1);
}
const doc = { textDocument: { uri } };
const at = (position) => ({
  ...doc,
  position: { line: position.line, character: position.character },
});
const head = {
  start: { line: 0, character: 0 },
  end: { line: Math.min(lines.length - 1, 60), character: 0 },
};
const all = { start: { line: 0, character: 0 }, end: { line: lines.length - 1, character: 0 } };
const formatting = { tabSize: 4, insertSpaces: true };

const checks = {};
const summarise = (value) => {
  if (value?.__error) return `ERROR ${value.__error}`;
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `${value.length} item(s)`;
  if (Array.isArray(value.data)) return `${value.data.length / 5} token(s)`;
  if (Array.isArray(value.items)) return `${value.kind ?? ''} ${value.items.length} item(s)`.trim();
  return typeof value === 'object'
    ? `object {${Object.keys(value).slice(0, 6).join(', ')}}`
    : String(value);
};
const check = async (name, method, params, timeoutMs) => {
  const value = await request(method, params, timeoutMs);
  checks[name] = { method, result: summarise(value), sample: JSON.stringify(value)?.slice(0, 600) };
  log(`${name.padEnd(28)} ${checks[name].result}`);
  return value;
};

await check('typeDefinition', 'textDocument/typeDefinition', at(typeName));
await check('implementation', 'textDocument/implementation', at(typeName));
await check('documentHighlight', 'textDocument/documentHighlight', at(call));
await check('foldingRange', 'textDocument/foldingRange', doc);
await check('selectionRange', 'textDocument/selectionRange', {
  ...doc,
  positions: [{ line: call.line, character: call.character }],
});
await check('semanticTokens/full', 'textDocument/semanticTokens/full', doc);
await check('semanticTokens/range', 'textDocument/semanticTokens/range', { ...doc, range: head });
await check('formatting', 'textDocument/formatting', { ...doc, options: formatting });
await check('rangeFormatting', 'textDocument/rangeFormatting', {
  ...doc,
  range: head,
  options: formatting,
});
await check('onTypeFormatting', 'textDocument/onTypeFormatting', {
  ...doc,
  position: { line: member.line, character: 0 },
  ch: '}',
  options: formatting,
});
await check('inlayHint', 'textDocument/inlayHint', { ...doc, range: all });
await check('codeLens', 'textDocument/codeLens', doc);
await check('workspace/symbol', 'workspace/symbol', { query: typeName.text });
const callHierarchy = await check(
  'prepareCallHierarchy',
  'textDocument/prepareCallHierarchy',
  at(member),
);
if (Array.isArray(callHierarchy) && callHierarchy.length > 0) {
  await check('callHierarchy/incomingCalls', 'callHierarchy/incomingCalls', {
    item: callHierarchy[0],
  });
}
const typeHierarchy = await check(
  'prepareTypeHierarchy',
  'textDocument/prepareTypeHierarchy',
  at(typeName),
);
if (Array.isArray(typeHierarchy) && typeHierarchy.length > 0) {
  await check('typeHierarchy/subtypes', 'typeHierarchy/subtypes', { item: typeHierarchy[0] });
}
await check('willRenameFiles', 'workspace/willRenameFiles', {
  files: [{ oldUri: uri, newUri: uri.replace(/\.cs$/, '.Renamed.cs') }],
});
await check('workspace/diagnostic', 'workspace/diagnostic', { previousResultIds: [] }, 60000);
await check('_vs_onAutoInsert', 'textDocument/_vs_onAutoInsert', {
  _vs_textDocument: { uri },
  _vs_position: { line: member.line, character: 3 },
  _vs_ch: '/',
  _vs_options: formatting,
});

// Fix-all needs a diagnostic to act on: insert an unused local (CS0219) into the first method body.
// The edit is made to the server's copy of the document only; nothing is written to disk.
let bodyLine = member.line;
while (bodyLine < lines.length - 1 && !lines[bodyLine].includes('{')) {
  bodyLine++;
}
notify('textDocument/didChange', {
  textDocument: { uri, version: 2 },
  contentChanges: [
    {
      range: {
        start: { line: bodyLine + 1, character: 0 },
        end: { line: bodyLine + 1, character: 0 },
      },
      text: '        int __probeUnused = 0;\n',
    },
  ],
});
await new Promise((resolve) => setTimeout(resolve, 1500));
const pulled = await request('textDocument/diagnostic', doc, 30000);
const diagnostic = (pulled?.items ?? []).find((item) => /__probeUnused/.test(`${item.message}`));
checks['injected diagnostic'] = {
  method: 'textDocument/diagnostic',
  result: diagnostic ? `found ${diagnostic.code}` : `not found (${summarise(pulled)})`,
};
log(`${'injected diagnostic'.padEnd(28)} ${checks['injected diagnostic'].result}`);
if (diagnostic) {
  const actions = await request('textDocument/codeAction', {
    ...doc,
    range: diagnostic.range,
    context: { diagnostics: [diagnostic], triggerKind: 1 },
  });
  const list = Array.isArray(actions) ? actions : [];
  const fixAll = list.filter(
    (action) =>
      action?.data?.FixAllFlavors || action?.command?.command === 'roslyn.client.fixAllCodeAction',
  );
  checks['codeAction fix-all'] = {
    method: 'textDocument/codeAction',
    result: `${list.length} action(s), ${fixAll.length} fix-all: ${list
      .map((action) => action.title)
      .join(' | ')
      .slice(0, 240)}`,
    sample: JSON.stringify(fixAll[0] ?? list[0])?.slice(0, 1500),
  };
  log(`${'codeAction fix-all'.padEnd(28)} ${checks['codeAction fix-all'].result}`);
}

// ---- The report --------------------------------------------------------------------------------

done = true;
const legend = init.capabilities?.semanticTokensProvider?.legend ?? null;
const STANDARD_TOKENS = new Set(
  'namespace type class enum interface struct typeParameter parameter variable property enumMember event function method macro keyword modifier comment string number regexp operator decorator'.split(
    ' ',
  ),
);
const report = {
  probedAt: new Date().toISOString(),
  server: SERVER,
  solution: SOLUTION,
  file: FILE,
  serverInfo: init.serverInfo ?? null,
  capabilities: init.capabilities,
  dynamicRegistrations: registrations.map((registration) => ({
    id: registration.id,
    method: registration.method,
    options: registration.registerOptions ?? null,
  })),
  legend,
  customTokenTypes: (legend?.tokenTypes ?? []).filter((type) => !STANDARD_TOKENS.has(type)),
  checks,
};
mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 2));
const watchCount = registrations.filter(
  (registration) => registration.method === 'workspace/didChangeWatchedFiles',
).length;
log(`${registrations.length} dynamic registration(s), ${watchCount} of them file watches`);
log(`wrote ${OUT}`);
await request('shutdown', null, 5000);
notify('exit', null);
setTimeout(() => exit(0), 1500);
