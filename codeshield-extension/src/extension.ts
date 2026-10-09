import * as vscode from 'vscode';
import { Api, Cancelled, Finding, FixResult } from './api';
import { FixActions, forFile, publish } from './diagnostics';
import { makePatch, PreviewProvider, selectTarget } from './fixer';
import { Sidebar } from './sidebar';

export function activate(context: vscode.ExtensionContext): void {
    const api = new Api();
    const diagnostics = vscode.languages.createDiagnosticCollection('CodeShield');
    const previews = new PreviewProvider();
    const findings = new Map<string, Finding[]>();
    const results = new Map<string, FixResult>();
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    status.command = 'codeshield.scanFile';
    status.tooltip = 'CodeShield: scan the active Java file';
    let busy = false;
    let selected: vscode.TextDocument | undefined;
    let running: vscode.CancellationTokenSource | undefined;
    let disposed = false;
    const sidebar = new Sidebar((action, line) => {
        if (action === 'scan') { void vscode.commands.executeCommand('codeshield.scanFile'); }
        if (action === 'fix') { void vscode.commands.executeCommand('codeshield.autoFix'); }
        if (action === 'refresh') { void refreshBackend(); }
        if (action === 'jump') { void jump(line!).catch(error => { void vscode.window.showErrorMessage(`CodeShield: could not open the finding. ${error instanceof Error ? error.message : ''}`); }); }
    });
    function updateSelected(document?: vscode.TextDocument): void {
        // Diff previews should keep the dashboard attached to the real source document.
        if (document?.uri.scheme === 'codeshield-preview') { return; }
        selected = document?.uri.scheme === 'file' && /\.java$/i.test(document.fileName) ? document : undefined;
        const key = selected?.uri.toString();
        const rows = key ? findings.get(key) ?? [] : [];
        sidebar.update({ file: selected?.fileName ?? '', findings: rows, result: key ? results.get(key) : undefined });
        status.text = `$(shield) CodeShield: ${rows.length} issue${rows.length === 1 ? '' : 's'}`;
        selected ? status.show() : status.hide();
    }
    async function refreshBackend(): Promise<void> {
        const source = new vscode.CancellationTokenSource();
        try { await api.request('/api/vulnerabilities', source.token, undefined, false, 2500); if (!disposed) { sidebar.update({ backend: 'online' }); } }
        catch { if (!disposed) { sidebar.update({ backend: 'offline' }); } }
        finally { source.dispose(); }
    }
    async function jump(line: number): Promise<void> {
        if (!selected || line > selected.lineCount) { return; }
        const editor = await vscode.window.showTextDocument(selected);
        const range = selected.lineAt(line - 1).range;
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
    }
    async function requireDocument(uri?: vscode.Uri): Promise<vscode.TextDocument> {
        const document = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
        if (!document || document.uri.scheme !== 'file' || !/\.java$/i.test(document.fileName)) {
            throw new Error('CodeShield: open a local .java file before running this command.');
        }
        await vscode.window.showTextDocument(document);
        updateSelected(document);
        return document;
    }
    function assertUnchanged(document: vscode.TextDocument, version: number): void {
        if (document.isClosed || document.version !== version) {
            throw new Error('CodeShield: the file changed during this operation. Run the command again on the updated file.');
        }
    }
    async function scan(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<Finding[]> {
        const version = document.version;
        diagnostics.delete(document.uri);
        findings.delete(document.uri.toString());
        updateSelected(vscode.window.activeTextEditor?.document);
        await api.request('/api/scan', token, { filePath: document.fileName });
        const rows = forFile(await api.findings(token), document.fileName);
        assertUnchanged(document, version);
        if (token.isCancellationRequested) { throw new Cancelled(); }
        findings.set(document.uri.toString(), rows);
        publish(diagnostics, document, rows);
        sidebar.update({ backend: 'online' });
        updateSelected(vscode.window.activeTextEditor?.document);
        return rows;
    }
    async function progress<T>(message: string, task: (token: vscode.CancellationToken) => Promise<T>): Promise<T> {
        sidebar.update({ busy: message });
        return vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `CodeShield: ${message}`, cancellable: true }, async (_progress, token) => {
            const source = new vscode.CancellationTokenSource();
            running = source;
            const listener = token.onCancellationRequested(() => source.cancel());
            if (token.isCancellationRequested) { source.cancel(); }
            try { return await task(source.token); }
            finally { listener.dispose(); source.dispose(); running = undefined; }
        });
    }
    async function run(action: 'scan' | 'fix', uri?: vscode.Uri): Promise<void> {
        if (busy) { void vscode.window.showInformationMessage('CodeShield: another operation is already in progress.'); return; }
        busy = true;
        let previewUris: vscode.Uri[] = [];
        try {
            // Check the backend before document validation or Ollama, so both dashboard
            // buttons have the same useful behavior during an offline UI preview.
            await progress('Checking CodeShield backend…', async token => {
                try {
                    await api.request('/api/vulnerabilities', token, undefined, false, 2500);
                    sidebar.update({ backend: 'online' });
                } catch (error) {
                    if (error instanceof Cancelled) { throw error; }
                    sidebar.update({ backend: 'offline' });
                    if (error instanceof Error && /backend.*(unreachable|timed out)/i.test(error.message)) {
                        const url = vscode.workspace.getConfiguration('codeshield').get<string>('backendUrl', 'http://127.0.0.1:8080');
                        throw new Error(url.replace(/\/+$/, '') === 'http://127.0.0.1:8080'
                            ? 'Cannot reach the CodeShield backend. Start it on port 8080.'
                            : `Cannot reach the CodeShield backend. Start it at ${url} or update codeshield.backendUrl.`);
                    }
                    throw error;
                }
            });
            const document = await requireDocument(uri);
            results.delete(document.uri.toString());
            updateSelected(document);
            if (action === 'scan') {
                const rows = await progress('Scanning Java file…', async token => {
                    if (!await document.save()) { throw new Error('CodeShield: could not save the Java file.'); }
                    if (token.isCancellationRequested) { throw new Cancelled(); }
                    return scan(document, token);
                });
                void vscode.window.showInformationMessage(`CodeShield: ${rows.length} issue${rows.length === 1 ? '' : 's'} found.`);
                return;
            }
            const prepared = await progress('Checking Ollama and generating a validated fix…', async token => {
                try { await api.request('/api/tags', token, undefined, true, 2500); }
                catch (error) {
                    if (error instanceof Cancelled) { throw error; }
                    throw new Error(`CodeShield: Ollama is unavailable. Start Ollama with llama3.2 and check codeshield.ollamaUrl. ${error instanceof Error ? error.message : ''}`);
                }
                if (!await document.save()) { throw new Error('CodeShield: could not save the Java file.'); }
                if (token.isCancellationRequested) { throw new Cancelled(); }
                const version = document.version;
                const originalText = document.getText();
                // Use undeduplicated rows so closest-CVSS matching retains all backend candidates.
                const result = await api.smartFix(document.fileName, token);
                const rows = (await api.findings(token)).filter(row => forFile([row], document.fileName).length > 0);
                assertUnchanged(document, version);
                if (token.isCancellationRequested) { throw new Cancelled(); }
                const target = selectTarget(rows, result);
                const patch = makePatch(document, target.lineNumber, result.fixedCode);
                sidebar.update({ backend: 'online' });
                return { result, patch, version, originalText };
            });
            const { result, patch, version, originalText } = prepared;
            results.set(document.uri.toString(), result);
            updateSelected(vscode.window.activeTextEditor?.document);
            previewUris = [previews.create('Original', originalText), previews.create('Patched', patch.patchedText)];
            sidebar.update({ busy: 'Review the diff, then choose Apply or Discard in the notification.' });
            await vscode.commands.executeCommand('vscode.diff', previewUris[0], previewUris[1], `CodeShield: ${result.targetedVulnerability} — proposed fix`);
            const applyLabel = result.status.trim().toUpperCase() === 'SAFE' ? 'Apply Fix' : 'Apply Anyway';
            const decision = await vscode.window.showInformationMessage(
                `CodeShield: safety score ${result.safetyScore}, status ${result.status}. Review the diff before applying.`, applyLabel, 'Discard'
            );
            if (decision !== applyLabel) { return; }
            assertUnchanged(document, version);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, patch.range, patch.replacement);
            if (!await vscode.workspace.applyEdit(edit)) { throw new Error('CodeShield: could not apply the fix.'); }
            if (!await document.save()) { throw new Error('CodeShield: fix applied but saving failed. Save the file manually; Ctrl+Z can undo the fix.'); }
            results.set(document.uri.toString(), result);
            await vscode.window.showTextDocument(document);
            await progress('Fix applied; re-scanning Java file…', token => scan(document, token));
            void vscode.window.showInformationMessage('CodeShield: fix applied, saved, and re-scanned. Ctrl+Z can undo the edit.');
        } catch (error) {
            if (error instanceof Cancelled) { void vscode.window.showInformationMessage('CodeShield: operation cancelled.'); }
            else {
                const message = error instanceof Error ? error.message : 'CodeShield: unexpected operation failure.';
                if (/backend.*(unreachable|timed out|HTTP)/i.test(message)) { sidebar.update({ backend: 'offline' }); }
                void vscode.window.showErrorMessage(message);
            }
        } finally { previews.release(previewUris); busy = false; sidebar.update({ busy: '' }); }
    }
    context.subscriptions.push(
        diagnostics, previews, status, sidebar,
        vscode.workspace.registerTextDocumentContentProvider('codeshield-preview', previews),
        vscode.window.registerWebviewViewProvider('codeshield.dashboard', sidebar),
        vscode.commands.registerCommand('codeshield.scanFile', (uri?: vscode.Uri) => run('scan', uri)),
        vscode.commands.registerCommand('codeshield.autoFix', (uri?: vscode.Uri) => run('fix', uri)),
        vscode.languages.registerCodeActionsProvider({ scheme: 'file', language: 'java' }, new FixActions(), { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }),
        vscode.window.onDidChangeActiveTextEditor(editor => updateSelected(editor?.document)),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (!event.contentChanges.length) { return; }
            diagnostics.delete(event.document.uri);
            findings.delete(event.document.uri.toString());
            results.delete(event.document.uri.toString());
            if (event.document === selected) { updateSelected(selected); }
        }),
        vscode.workspace.onDidCloseTextDocument(document => {
            diagnostics.delete(document.uri); findings.delete(document.uri.toString()); results.delete(document.uri.toString());
        }),
        vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('codeshield.backendUrl')) { void refreshBackend(); } }),
        { dispose: () => { disposed = true; running?.cancel(); } }
    );
    updateSelected(vscode.window.activeTextEditor?.document);
    void refreshBackend();
}
