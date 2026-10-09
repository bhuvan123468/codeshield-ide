const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

class Range {
    constructor(a, b, c, d) {
        this.start = typeof a === 'number' ? { line: a, character: b } : a;
        this.end = typeof a === 'number' ? { line: c, character: d } : b;
    }
}
const settings = { backendUrl: 'http://127.0.0.1:8080', ollamaUrl: 'http://127.0.0.1:11434', timeoutSeconds: 120 };
const vscode = {
    Range, EndOfLine: { LF: 1, CRLF: 2 }, DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
    Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => settings[key] ?? fallback }) }
};
const originalLoad = Module._load;
Module._load = function(id, ...args) { return id === 'vscode' ? vscode : originalLoad.call(this, id, ...args); };
const { makePatch, selectTarget, stripFences } = require('../dist/fixer');
const { forFile, publish } = require('../dist/diagnostics');
const { Api, Cancelled } = require('../dist/api');
Module._load = originalLoad;

function document(text, crlf = false) {
    const eol = crlf ? '\r\n' : '\n';
    const lines = text.split(eol);
    const offsets = [];
    let offset = 0;
    for (const line of lines) { offsets.push(offset); offset += line.length + eol.length; }
    return {
        eol: crlf ? 2 : 1, lineCount: lines.length, uri: 'test', getText: () => text,
        lineAt: index => ({ text: lines[index], lineNumber: index, firstNonWhitespaceCharacterIndex: /^\s*/.exec(lines[index])[0].length,
            range: new Range(index, 0, index, lines[index].length) }),
        offsetAt: position => offsets[position.line] + position.character,
        positionAt: value => { let line = offsets.findLastIndex(offset => offset <= value); return { line, character: value - offsets[line] }; }
    };
}
const row = (lineNumber, cvssScore = 8, vulnerabilityType = 'SQL_INJECTION') => ({
    filePath: 'C:\\Java\\Demo.java', lineNumber, cvssScore, vulnerabilityType, severity: 'HIGH', description: 'Finding'
});
test('patch only the vulnerable statement and preserve surrounding code', () => {
    const text = 'class Demo {\n    void run() {\n        query(user);\n        next();\n    }\n}';
    const patch = makePatch(document(text), 3, '```java\nquerySafe(user);\n```');
    assert.equal(patch.patchedText, text.replace('query(user);', 'querySafe(user);'));
});
test('expand backwards and forwards for a multiline statement', () => {
    const text = 'void run() {\n    query(\n        user,\n        mode);\n    next();\n}';
    assert.equal(makePatch(document(text), 3, 'querySafe(user);').patchedText,
        'void run() {\n    querySafe(user);\n    next();\n}');
});
test('ignore delimiter characters inside escaped Java strings', () => {
    const text = 'void run() {\n    query(";{\\\"}");\n    next();\n}';
    assert.equal(makePatch(document(text), 2, 'safe();').patchedText, 'void run() {\n    safe();\n    next();\n}');
});
test('retain CRLF and relative indentation in multiline replacements', () => {
    const text = 'void run() {\r\n    query(user);\r\n}';
    assert.equal(makePatch(document(text, true), 2, '  safe(\n      user\n  );').patchedText,
        'void run() {\r\n    safe(\r\n        user\r\n    );\r\n}');
});
test('URLs in string literals are not mistaken for comments', () => {
    const text = 'void run() {\n    fetchUrl("http://example.test");\n}';
    assert.equal(makePatch(document(text), 2, 'safeFetch();').patchedText, 'void run() {\n    safeFetch();\n}');
});
test('for headers do not terminate at their internal semicolons', () => {
    const text = 'void run() {\n    for (int i=0; i<10; i++) {\n        query(i);\n    }\n}';
    assert.equal(makePatch(document(text), 2, 'for (int i=0; i<5; i++) {').patchedText, text.replace('i<10', 'i<5'));
});
test('ignore Java text-block delimiters', () => {
    const text = 'void run() {\n    String sql = """\n        SELECT ";{"\n        """;\n    next();\n}';
    assert.equal(makePatch(document(text), 3, 'String sql = "safe";').patchedText,
        'void run() {\n    String sql = "safe";\n    next();\n}');
});
test('refuse multiple statements, comments, complete classes and broken block headers', () => {
    assert.throws(() => makePatch(document('void x() {\n    a(); b();\n}'), 2, 'safe();'), /multiple statement/);
    assert.throws(() => makePatch(document('void x() {\n    query( /* comment */ user);\n}'), 2, 'safe();'), /comments/);
    assert.throws(() => makePatch(document('void x() {\n    query(user);\n}'), 2, 'class X {}'), /file\/class/);
    assert.throws(() => makePatch(document('void x() {\n    if (unsafe) {\n        a();\n    }\n}'), 2, 'if (safe) { a(); }'), /brace boundary/);
    assert.throws(() => makePatch(document('void x() {\n    a();\n}'), 2, 'safe()'), /semicolon/);
});
test('choose closest CVSS and reject ties even after duplicate rows', () => {
    const result = { targetedVulnerability: 'sql_injection', originalCvssScore: 9 };
    assert.equal(selectTarget([row(2, 5), row(3, 8)], result).lineNumber, 3);
    assert.throws(() => selectTarget([row(2, 8), row(2, 8), row(3, 10)], result), /multiple lines/);
    assert.throws(() => selectTarget([], result), /no matching line/);
});
test('deduplicate file findings by type and line after slash/case normalization', () => {
    const rows = [row(3, 5), row(3, 9), row(4, 7), { ...row(5), filePath: 'C:/Java/Other.java' }];
    assert.deepEqual(forFile(rows, 'c:/java/demo.JAVA').map(row => [row.lineNumber, row.cvssScore]), [[3, 9], [4, 7]]);
});
test('diagnostics trim line ranges and map severities without out-of-range crashes', () => {
    let published;
    publish({ set: (_uri, values) => { published = values; } }, document('  a();  \n  b();'),
        [{ ...row(1), severity: 'CRITICAL' }, { ...row(2), severity: 'MEDIUM' }, row(99)]);
    assert.equal(published.length, 2);
    assert.equal(published[0].source, 'CodeShield');
    assert.equal(published[0].severity, 0);
    assert.equal(published[1].severity, 1);
    assert.deepEqual(published[0].range, new Range(0, 2, 0, 6));
});
test('strip fences and reject embedded Markdown', () => {
    assert.equal(stripFences('```java\na();\n```'), 'a();');
    assert.throws(() => stripFences('Explanation\n```java\na();\n```'), /Markdown/);
});
function token() {
    let listeners = [];
    return { isCancellationRequested: false,
        onCancellationRequested(callback) { listeners.push(callback); return { dispose: () => { listeners = listeners.filter(item => item !== callback); } }; },
        cancel() { this.isCancellationRequested = true; for (const callback of listeners) { callback(); } }
    };
}
test('API sends exact scan body and accepts plain text', async () => {
    const saved = global.fetch;
    global.fetch = async (url, options) => { assert.equal(url.toString(), 'http://127.0.0.1:8080/api/scan');
        assert.equal(options.method, 'POST'); assert.deepEqual(JSON.parse(options.body), { filePath: 'C:/Java/Demo.java' });
        return new Response('Scanned'); };
    try { assert.equal(await new Api().request('/api/scan', token(), { filePath: 'C:/Java/Demo.java' }), 'Scanned'); }
    finally { global.fetch = saved; }
});
test('API distinguishes HTTP errors, offline service and malformed JSON', async () => {
    const saved = global.fetch;
    try {
        global.fetch = async () => new Response('bad', { status: 500 });
        await assert.rejects(new Api().findings(token()), /HTTP 500/);
        global.fetch = async () => { throw new TypeError('fetch failed'); };
        await assert.rejects(new Api().findings(token()), /backend is unreachable/);
        global.fetch = async () => new Response('not JSON');
        await assert.rejects(new Api().findings(token()), /invalid JSON/);
        global.fetch = async () => new Response(JSON.stringify([{ lineNumber: 0 }]));
        await assert.rejects(new Api().findings(token()), /invalid finding/);
    } finally { global.fetch = saved; }
});
test('timeout and cancellation abort fetch, including a pre-cancelled token', async () => {
    const saved = global.fetch;
    global.fetch = (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });
    try {
        await assert.rejects(new Api().request('/api/tags', token(), undefined, true, 10), /timed out/);
        const cancel = token(); const request = new Api().findings(cancel); cancel.cancel();
        await assert.rejects(request, Cancelled);
        await assert.rejects(new Api().findings(cancel), Cancelled);
    } finally { global.fetch = saved; }
});
