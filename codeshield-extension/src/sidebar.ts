import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { Finding, FixResult } from './api';

export interface DashboardState {
    backend: 'unknown' | 'online' | 'offline';
    busy: string;
    file: string;
    findings: Finding[];
    result?: FixResult;
}
export class Sidebar implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private readonly listeners: vscode.Disposable[] = [];
    private state: DashboardState = { backend: 'unknown', busy: '', file: '', findings: [] };
    constructor(private readonly command: (action: string, line?: number) => void) { }
    update(state: Partial<DashboardState>): void {
        this.state = { ...this.state, ...state };
        try {
            void this.view?.webview.postMessage({ ...this.state, result: this.state.result ? { safetyScore: this.state.result.safetyScore, status: this.state.result.status } : undefined })
                .then(undefined, () => undefined);
        } catch { /* A view may have been disposed while a background status check completed. */ }
    }
    resolveWebviewView(view: vscode.WebviewView): void {
        this.disposeListeners();
        this.view = view;
        view.webview.options = { enableScripts: true, localResourceRoots: [] };
        const nonce = randomBytes(24).toString('base64');
        view.webview.html = this.html(nonce);
        this.listeners.push(view.webview.onDidReceiveMessage(message => {
            if (!message || typeof message !== 'object') { return; }
            if (message.action === 'ready') { this.update({}); this.command('refresh'); }
            else if (['scan', 'fix'].includes(message.action)) { this.command(message.action); }
            else if (message.action === 'jump' && Number.isInteger(message.line) && message.line > 0) { this.command('jump', message.line); }
        }), view.onDidDispose(() => { this.view = undefined; this.disposeListeners(); }));
    }
    private disposeListeners(): void { for (const listener of this.listeners.splice(0)) { listener.dispose(); } }
    dispose(): void { this.disposeListeners(); }
    private html(nonce: string): string {
        return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none';">
<title>CodeShield Dashboard</title><style nonce="${nonce}">
body{padding:12px;font-family:var(--vscode-font-family);color:var(--vscode-foreground);background:var(--vscode-sideBar-background)}
h2{font-size:17px}.status{display:flex;gap:8px;align-items:center}.dot{height:9px;width:9px;border-radius:50%;background:#999}.online{background:#46a66c}.offline{background:#dc5959}
button{font:inherit;color:var(--vscode-button-foreground);background:var(--vscode-button-background);border:0;padding:8px;cursor:pointer;margin:6px 0;width:100%}button:disabled{opacity:.55;cursor:default}button:focus-visible{outline:2px solid var(--vscode-focusBorder)}
#busy{display:flex;align-items:center;gap:8px;margin:12px 0}.spinner{height:13px;width:13px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
[hidden]{display:none!important}#file{overflow-wrap:anywhere;font-size:12px}ul{list-style:none;padding:0}li button{text-align:left;background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1px solid var(--vscode-panel-border);overflow-wrap:anywhere}
#result{padding:12px;border:1px solid var(--vscode-panel-border);margin-top:12px}.badge{display:inline-block;padding:4px 7px;font-weight:bold;color:#fff}.safe{background:#237742}.mid{background:#8b6500}.unsafe{background:#ae3030}
</style></head><body><h2>CodeShield</h2><p class="status"><span id="dot" class="dot"></span><span id="backend">Backend: checking…</span></p>
<p id="file">Open a Java file to begin.</p><button id="scan">Scan file</button><button id="fix">Auto-fix and validate</button>
<div id="busy" role="status" aria-live="polite" hidden><span class="spinner" aria-hidden="true"></span><span id="busyText"></span></div>
<h3>Findings</h3><p id="empty">No findings for the selected file.</p><ul id="findings"></ul>
<section id="result" aria-live="polite" hidden><h3>Validation result</h3><p id="score"></p><span id="badge" class="badge"></span></section>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const get = id => document.getElementById(id);
get('scan').addEventListener('click', () => vscode.postMessage({action:'scan'}));
get('fix').addEventListener('click', () => vscode.postMessage({action:'fix'}));
window.addEventListener('message', event => {
 const state=event.data;
 get('dot').className='dot '+state.backend;
get('backend').textContent=state.backend==='offline'?'Backend offline':state.backend==='online'?'Backend online':'Backend: checking…';
 get('file').textContent=state.file || 'Open a Java file to begin.';
 get('scan').disabled=!!state.busy;get('fix').disabled=!!state.busy;
 get('busy').hidden=!state.busy;get('busyText').textContent=state.busy;
 get('findings').replaceChildren();get('empty').hidden=state.findings.length>0;
 for(const finding of state.findings){const li=document.createElement('li');const button=document.createElement('button');
  button.textContent='Line '+finding.lineNumber+' · '+finding.vulnerabilityType+' · CVSS '+finding.cvssScore;
  button.title=finding.description;button.addEventListener('click',()=>vscode.postMessage({action:'jump',line:finding.lineNumber}));li.appendChild(button);get('findings').appendChild(li);}
 get('result').hidden=!state.result;
 if(state.result){get('score').textContent='Safety score: '+state.result.safetyScore;const safe=state.result.status.trim().toUpperCase()==='SAFE';
  get('badge').className='badge '+(safe?'safe':state.result.safetyScore>=50?'mid':'unsafe');get('badge').textContent=state.result.status;}
});vscode.postMessage({action:'ready'});
</script></body></html>`;
    }
}
