import * as vscode from 'vscode';
import { Finding } from './api';

export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').toLowerCase();
}
export function forFile(rows: Finding[], filePath: string): Finding[] {
    const unique = new Map<string, Finding>();
    for (const row of rows) {
        if (normalizePath(row.filePath) !== normalizePath(filePath)) { continue; }
        const key = `${row.vulnerabilityType.toLowerCase()}\0${row.lineNumber}`;
        const previous = unique.get(key);
        if (!previous || row.cvssScore > previous.cvssScore ||
            (row.cvssScore === previous.cvssScore && (row.timestamp ?? '') > (previous.timestamp ?? ''))) { unique.set(key, row); }
    }
    return [...unique.values()].sort((a, b) => a.lineNumber - b.lineNumber);
}
export function publish(collection: vscode.DiagnosticCollection, document: vscode.TextDocument, findings: Finding[]): void {
    const diagnostics = findings.filter(f => f.lineNumber <= document.lineCount).map(f => {
        const line = document.lineAt(f.lineNumber - 1);
        const start = line.firstNonWhitespaceCharacterIndex;
        const end = line.text.trimEnd().length;
        const severity = f.severity.toUpperCase();
        const diagnostic = new vscode.Diagnostic(
            new vscode.Range(line.lineNumber, start, line.lineNumber, Math.max(start, end)),
            `${f.vulnerabilityType} (CVSS ${f.cvssScore}): ${f.description}`,
            ['CRITICAL', 'HIGH'].includes(severity) ? vscode.DiagnosticSeverity.Error :
                severity === 'MEDIUM' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information
        );
        diagnostic.source = 'CodeShield';
        diagnostic.code = f.vulnerabilityType;
        return diagnostic;
    });
    collection.set(document.uri, diagnostics);
}
export class FixActions implements vscode.CodeActionProvider {
    provideCodeActions(document: vscode.TextDocument, _range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
        const diagnostics = context.diagnostics.filter(d => d.source === 'CodeShield');
        if (!diagnostics.length) { return []; }
        const action = new vscode.CodeAction('CodeShield: Auto-Fix and Validate', vscode.CodeActionKind.QuickFix);
        action.diagnostics = diagnostics;
        action.command = { command: 'codeshield.autoFix', title: action.title, arguments: [document.uri] };
        return [action];
    }
}
