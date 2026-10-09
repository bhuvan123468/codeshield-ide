const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function harness(options = {}) {
    const commands = new Map();
    const requests = [];
    const messages = [];
    const diffs = [];
    const providers = new Map();
    const editListeners = [];
    const webviewProviders = new Map();
    let text = 'class Demo {\n    void run() {\n        query(user);\n    }\n}';
    let applies = 0;
    const disposable = () => ({ dispose() {} });
    const uri = value => ({ scheme: value.split(':')[0], toString: () => value });
    class Range {
        constructor(a, b, c, d) { this.start = typeof a === 'number' ? { line: a, character: b } : a; this.end = typeof a === 'number' ? { line: c, character: d } : b; }
    }
    class CancellationTokenSource {
        constructor() { const listeners = [];
            this.token = { isCancellationRequested: false, onCancellationRequested: callback => { listeners.push(callback); return disposable(); } };
            this.cancel = () => { this.token.isCancellationRequested = true; listeners.forEach(callback => callback()); };
        }
        dispose() {}
    }
    const document = {
        uri: uri('file:///Demo.java'), fileName: '/Demo.java', languageId: 'java', version: 1, isClosed: false, eol: 1,
        get lineCount() { return text.split('\n').length; }, getText: () => text, save: async () => true,
        lineAt(index) { const value = text.split('\n')[index]; return { text: value, lineNumber: index, firstNonWhitespaceCharacterIndex: /^\s*/.exec(value)[0].length, range: new Range(index, 0, index, value.length) }; },
        offsetAt(position) { return text.split('\n').slice(0, position.line).reduce((n, line) => n + line.length + 1, 0) + position.character; },
        positionAt(offset) { const before = text.slice(0, offset).split('\n'); return { line: before.length - 1, character: before.at(-1).length }; }
    };
    const edited = () => { document.version++; editListeners.forEach(callback => callback({ document, contentChanges: [{}] })); };
    const token = new CancellationTokenSource();
    const vscode = {
        Range, CancellationTokenSource, Uri: { parse: uri }, EndOfLine: { LF: 1, CRLF: 2 },
        StatusBarAlignment: { Left: 1 }, ProgressLocation: { Notification: 15 },
        DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 }, CodeActionKind: { QuickFix: 'quickfix' },
        WorkspaceEdit: class { replace(uri, range, replacement) { Object.assign(this, { uri, range, replacement }); } },
        Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
        workspace: {
            getConfiguration: () => ({ get: (key, fallback) => ({ backendUrl: 'http://127.0.0.1:8080', ollamaUrl: 'http://127.0.0.1:11434', timeoutSeconds: 120 }[key] ?? fallback) }),
            openTextDocument: async () => document,
            registerTextDocumentContentProvider: (scheme, provider) => { providers.set(scheme, provider); return disposable(); },
            onDidChangeTextDocument: callback => { editListeners.push(callback); return disposable(); },
            onDidCloseTextDocument: disposable, onDidChangeConfiguration: disposable,
            applyEdit: async edit => { applies++; const start = document.offsetAt(edit.range.start); const end = document.offsetAt(edit.range.end);
                text = text.slice(0, start) + edit.replacement + text.slice(end); edited(); return true; }
        },
        window: {
            activeTextEditor: options.noEditor ? undefined : { document },
            createStatusBarItem: () => ({ ...disposable(), show() {}, hide() {} }),
            registerWebviewViewProvider: (id, provider) => { webviewProviders.set(id, provider); return disposable(); }, onDidChangeActiveTextEditor: disposable,
            showTextDocument: async () => ({ document }),
            withProgress: async (_options, task) => task({}, token.token),
            showInformationMessage: async (message, ...choices) => { messages.push({ message, choices });
                if (choices.length) { if (options.editDuringReview) { edited(); } return options.decision; } },
            showErrorMessage: async message => { messages.push({ error: message }); }
        },
        languages: { createDiagnosticCollection: () => ({ ...disposable(), set() {}, delete() {} }), registerCodeActionsProvider: disposable },
        commands: {
            registerCommand: (id, callback) => { commands.set(id, callback); return disposable(); },
            executeCommand: async (id, ...args) => {
                if (id === 'vscode.diff') { diffs.push(args.map((value, index) => index < 2 ? providers.get(value.scheme).provideTextDocumentContent(value) : value)); return; }
                return commands.get(id)?.(...args);
            }
        }
    };
    const originalLoad = Module._load;
    for (const name of ['extension', 'api', 'fixer', 'diagnostics', 'sidebar']) { delete require.cache[require.resolve(`../dist/${name}`)]; }
    Module._load = function(id, ...args) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
    let activate;
    try { ({ activate } = require('../dist/extension')); } finally { Module._load = originalLoad; }
    const savedFetch = global.fetch;
    global.fetch = async (url, request) => {
        const path = url.pathname; requests.push(path);
        if (options.backendDown && url.port === '8080') { throw new TypeError('offline'); }
        if (path === '/api/tags') { if (options.ollamaDown) { throw new TypeError('offline'); } return new Response('{"models":[]}'); }
        if (path === '/api/smart-fix') {
            assert.deepEqual(JSON.parse(request.body), { filePath: '/Demo.java' });
            if (options.cancel) { token.cancel(); request.signal.throwIfAborted(); }
            return new Response(JSON.stringify({ targetedVulnerability: 'SQL_INJECTION', originalCvssScore: 9,
                fixedCode: 'safeQuery(user);', safetyScore: 90, status: options.status ?? 'SAFE' }));
        }
        if (path === '/api/scan') { return new Response('Scanned'); }
        return new Response(JSON.stringify([{ filePath: '/Demo.java', vulnerabilityType: 'SQL_INJECTION', lineNumber: 3,
            severity: 'HIGH', cvssScore: 9, description: 'unsafe' }]));
    };
    const context = { subscriptions: [] };
    activate(context);
    return { run: () => commands.get('codeshield.autoFix')(), scan: () => commands.get('codeshield.scanFile')(), webviewProviders, requests, messages, diffs, document,
        get applies() { return applies; }, get text() { return text; },
        close: () => { context.subscriptions.forEach(subscription => subscription.dispose()); global.fetch = savedFetch; } };
}
test('Discard previews the patch without applying an edit', async () => {
    const host = harness({ decision: 'Discard' });
    try { await host.run(); assert.equal(host.applies, 0); assert.match(host.text, /query\(user\)/);
        assert.equal(host.diffs.length, 1); assert.match(host.diffs[0][0], /query\(user\)/); assert.match(host.diffs[0][1], /safeQuery/); }
    finally { host.close(); }
});
test('SAFE apply uses WorkspaceEdit and re-scans after the preview', async () => {
    const host = harness({ decision: 'Apply Fix' });
    try { await host.run(); assert.equal(host.applies, 1); assert.match(host.text, /safeQuery/);
        assert.ok(host.requests.includes('/api/scan')); assert.ok(host.messages.some(item => item.choices?.includes('Apply Fix'))); }
    finally { host.close(); }
});
test('non-SAFE results require Apply Anyway', async () => {
    const host = harness({ decision: 'Apply Anyway', status: 'UNSAFE' });
    try { await host.run(); assert.equal(host.applies, 1); assert.ok(host.messages.some(item => item.choices?.includes('Apply Anyway'))); }
    finally { host.close(); }
});
test('editing during review invalidates the proposal', async () => {
    const host = harness({ decision: 'Apply Fix', editDuringReview: true });
    try { await host.run(); assert.equal(host.applies, 0); assert.ok(host.messages.some(item => /file changed/.test(item.error ?? ''))); }
    finally { host.close(); }
});
test('Ollama failure prevents smart-fix and displays a clear error', async () => {
    const host = harness({ ollamaDown: true });
    try { await host.run(); assert.equal(host.applies, 0); assert.ok(!host.requests.includes('/api/smart-fix'));
        assert.ok(host.messages.some(item => /Ollama is unavailable/.test(item.error ?? ''))); }
    finally { host.close(); }
});
test('cancellation during smart-fix prevents a diff or edit', async () => {
    const host = harness({ cancel: true });
    try { await host.run(); assert.equal(host.applies, 0); assert.equal(host.diffs.length, 0);
        assert.ok(host.messages.some(item => /operation cancelled/.test(item.message ?? ''))); }
    finally { host.close(); }
});
test('offline startup stays quiet and both commands show one backend message without an editor', async () => {
    const host = harness({ backendDown: true, noEditor: true });
    try {
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(host.messages.length, 0, 'startup must not show an offline error notification');
        const updates = [];
        let onMessage;
        const provider = host.webviewProviders.get('codeshield.dashboard');
        const view = { webview: { options: {}, html: '',
            postMessage: state => { updates.push(state); return Promise.resolve(true); },
            onDidReceiveMessage: callback => { onMessage = callback; return { dispose() {} }; } },
            onDidDispose: () => ({ dispose() {} }) };
        provider.resolveWebviewView(view);
        assert.match(view.webview.html, /Scan file/);
        assert.match(view.webview.html, /Auto-fix and validate/);
        assert.match(view.webview.html, /Backend offline/);
        assert.match(view.webview.html, /\.offline\{background:#dc5959\}/);
        onMessage({ action: 'ready' });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(updates.at(-1).backend, 'offline');
        await host.scan();
        await host.run();
        assert.deepEqual(host.messages.map(item => item.error), [
            'Cannot reach the CodeShield backend. Start it on port 8080.',
            'Cannot reach the CodeShield backend. Start it on port 8080.'
        ]);
        assert.equal(host.applies, 0);
        assert.ok(!host.requests.includes('/api/tags'));
        assert.ok(!host.requests.includes('/api/scan'));
        assert.ok(!host.requests.includes('/api/smart-fix'));
    } finally { host.close(); }
});
