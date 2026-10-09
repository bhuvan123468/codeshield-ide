import * as vscode from 'vscode';

export interface Finding {
    id?: number;
    filePath: string;
    vulnerabilityType: string;
    lineNumber: number;
    severity: string;
    cvssScore: number;
    description: string;
    timestamp?: string;
}
export interface FixResult {
    targetedVulnerability: string;
    originalCvssScore: number;
    fixedCode: string;
    safetyScore: number;
    status: string;
}
export class Cancelled extends Error {
    constructor() { super('CodeShield operation cancelled.'); }
}
export class Api {
    async request(path: string, token: vscode.CancellationToken, body?: object, ollama = false, timeoutMs?: number): Promise<unknown> {
        if (token.isCancellationRequested) { throw new Cancelled(); }
        if (typeof fetch !== 'function') { throw new Error('CodeShield: this extension requires an extension host with global fetch (Node 18 or newer).'); }
        const config = vscode.workspace.getConfiguration('codeshield');
        const base = config.get<string>(ollama ? 'ollamaUrl' : 'backendUrl')!;
        let url: URL;
        try {
            url = new URL(base);
            if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) { throw new Error(); }
            url = new URL(`${base.replace(/\/+$/, '')}${path}`);
        } catch { throw new Error(`CodeShield: set a valid ${ollama ? 'ollamaUrl' : 'backendUrl'} HTTP(S) URL without credentials.`); }
        const seconds = config.get<number>('timeoutSeconds', 120);
        const duration = timeoutMs ?? (Number.isFinite(seconds) ? Math.min(600, Math.max(1, seconds)) : 120) * 1000;
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; controller.abort(); }, duration);
        const cancellation = token.onCancellationRequested(() => controller.abort());
        try {
            const response = await fetch(url, {
                method: body ? 'POST' : 'GET', signal: controller.signal,
                headers: body ? { 'Content-Type': 'application/json' } : undefined,
                body: body ? JSON.stringify(body) : undefined
            });
            if (!response.ok) { throw new Error(`CodeShield: ${ollama ? 'Ollama' : 'backend'} returned HTTP ${response.status} for ${path}.`); }
            const text = await response.text();
            if (token.isCancellationRequested) { throw new Cancelled(); }
            if (path === '/api/scan') { return text; }
            try { return JSON.parse(text) as unknown; }
            catch { throw new Error(`CodeShield: invalid JSON response from ${path}.`); }
        } catch (error) {
            if (token.isCancellationRequested) { throw new Cancelled(); }
            if (timedOut) { throw new Error(`CodeShield: ${ollama ? 'Ollama' : 'backend'} request timed out after ${duration / 1000}s. Check the service or increase codeshield.timeoutSeconds.`); }
            if (error instanceof TypeError) { throw new Error(`CodeShield: ${ollama ? 'Ollama' : 'backend'} is unreachable at ${base}. Start it and check the URL setting.`); }
            throw error;
        } finally { clearTimeout(timer); cancellation.dispose(); }
    }
    async findings(token: vscode.CancellationToken): Promise<Finding[]> {
        const rows = await this.request('/api/vulnerabilities', token);
        if (!Array.isArray(rows)) { throw new Error('CodeShield: backend findings response must be an array.'); }
        return rows.map(row => {
            if (!row || typeof row.filePath !== 'string' || typeof row.vulnerabilityType !== 'string' ||
                !Number.isInteger(row.lineNumber) || row.lineNumber < 1 || typeof row.severity !== 'string' ||
                typeof row.cvssScore !== 'number' || !Number.isFinite(row.cvssScore) || typeof row.description !== 'string') {
                throw new Error('CodeShield: backend returned an invalid finding.');
            }
            return row as Finding;
        });
    }
    async smartFix(filePath: string, token: vscode.CancellationToken): Promise<FixResult> {
        const value = await this.request('/api/smart-fix', token, { filePath }) as Partial<FixResult> | null;
        if (!value || typeof value.targetedVulnerability !== 'string' || typeof value.fixedCode !== 'string' ||
            !value.fixedCode.trim() || typeof value.status !== 'string' ||
            typeof value.safetyScore !== 'number' || !Number.isFinite(value.safetyScore) ||
            typeof value.originalCvssScore !== 'number' || !Number.isFinite(value.originalCvssScore)) {
            throw new Error('CodeShield: backend returned an invalid smart-fix result.');
        }
        return value as FixResult;
    }
}
