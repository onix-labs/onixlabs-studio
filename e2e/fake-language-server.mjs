#!/usr/bin/env node
// A test-only language server, for the suites that need one to kill. It imports nothing, answers the
// handshake, and otherwise sits quietly: no real server can be installed in CI.

/**
 * Writes one framed message.
 * @param {object} message The message.
 */
function send(message) {
  const body = JSON.stringify({ jsonrpc: '2.0', ...message });
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

/**
 * Handles one message from the client.
 * @param {{ id?: number, method?: string, params?: { textDocument: { uri: string } } }} message The message.
 */
function receive(message) {
  if (message.method === 'initialize') {
    send({ id: message.id, result: { capabilities: { textDocumentSync: 1 } } });
  } else if (message.method === 'textDocument/didOpen') {
    // An opened document has no problems. Saying so is what a real server does, and what turns its
    // row Ready, so a test can tell a running server from one still starting.
    send({
      method: 'textDocument/publishDiagnostics',
      params: { uri: message.params.textDocument.uri, diagnostics: [] },
    });
  } else if (message.method === 'shutdown') {
    send({ id: message.id, result: null });
  } else if (message.method === 'exit') {
    process.exit(0);
  } else if (message.id !== undefined && message.method !== undefined) {
    send({ id: message.id, result: null });
  }
}

let buffered = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  buffered = Buffer.concat([buffered, chunk]);
  for (;;) {
    const headerEnd = buffered.indexOf('\r\n\r\n');
    if (headerEnd < 0) {
      return;
    }
    const length = Number(
      /Content-Length: (\d+)/i.exec(buffered.toString('utf8', 0, headerEnd))?.[1],
    );
    if (buffered.length < headerEnd + 4 + length) {
      return;
    }
    const body = buffered.toString('utf8', headerEnd + 4, headerEnd + 4 + length);
    buffered = buffered.subarray(headerEnd + 4 + length);
    receive(JSON.parse(body));
  }
});
process.stdin.on('end', () => process.exit(0));
