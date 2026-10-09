import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { Finding, FixResult } from './api';

export function selectTarget(rows: Finding[], result: FixResult): Finding {
    const candidates = rows.filter(row => row.vulnerabilityType.trim().toLowerCase() === result.targetedVulnerability.trim().toLowerCase());
    candidates.sort((a, b) => Math.abs(a.cvssScore - result.originalCvssScore) - Math.abs(b.cvssScore - result.originalCvssScore));
    if (!candidates.length) { throw new Error('CodeShield: the targeted vulnerability has no matching line. Re-scan before fixing.'); }
    const closestDistance = Math.abs(candidates[0].cvssScore - result.originalCvssScore);
    if (candidates.some(row => row.lineNumber !== candidates[0].lineNumber && Math.abs(row.cvssScore - result.originalCvssScore) === closestDistance)) {
        throw new Error('CodeShield: multiple lines match this fix equally. The backend must identify a unique target before it can be applied.');
    }
    return candidates[0];
}
export function stripFences(code: string): string {
    const trimmed = code.trim();
    const fenced = /^```(?:java)?\s*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(trimmed);
    const rawLines = (fenced ? fenced[1] : code).replace(/^\s*\r?\n|\r?\n\s*$/g, '').split(/\r?\n/);
    const nonEmpty = rawLines.filter(line => line.trim());
    const common = nonEmpty.length ? Math.min(...nonEmpty.map(line => /^\s*/.exec(line)![0].length)) : 0;
    const result = rawLines.map(line => line.slice(common)).join('\n').trim();
    if (!result || result.includes('```')) { throw new Error('CodeShield: the fix is empty or contains unrecognized Markdown fences.'); }
    return result;
}

// Lex delimiters outside strings/comments. Parentheses protect semicolons in for headers.
function delimiters(text: string, commentStarts: number[] = []): number[] {
    const result: number[] = [];
    let state: 'code' | 'string' | 'char' | 'line' | 'block' | 'textblock' = 'code';
    let parentheses = 0;
    let brackets = 0;
    for (let index = 0; index < text.length; index++) {
        const char = text[index];
        const next = text[index + 1];
        if (state === 'line') { if (char === '\n') { state = 'code'; } continue; }
        if (state === 'block') { if (char === '*' && next === '/') { state = 'code'; index++; } continue; }
        if (state === 'textblock') {
            if (char === '\\') { index++; continue; }
            if (text.slice(index, index + 3) === '"""') { state = 'code'; index += 2; }
            continue;
        }
        if (state === 'string' || state === 'char') {
            if (char === '\\') { index++; continue; }
            if (char === (state === 'string' ? '"' : "'")) { state = 'code'; }
            continue;
        }
        if (char === '/' && next === '/') { commentStarts.push(index); state = 'line'; index++; continue; }
        if (char === '/' && next === '*') { commentStarts.push(index); state = 'block'; index++; continue; }
        if (text.slice(index, index + 3) === '"""') { state = 'textblock'; index += 2; continue; }
        if (char === '"') { state = 'string'; continue; }
        if (char === "'") { state = 'char'; continue; }
        if (char === '(') { parentheses++; }
        else if (char === ')') { parentheses--; }
        else if (char === '[') { brackets++; }
        else if (char === ']') { brackets--; }
        else if ((char === ';' && parentheses === 0 && brackets === 0) || char === '{' || char === '}') { result.push(index); }
    }
    return result;
}
export interface Patch { range: vscode.Range; replacement: string; patchedText: string; }
export function makePatch(document: vscode.TextDocument, lineNumber: number, fixedCode: string): Patch {
    if (lineNumber < 1 || lineNumber > document.lineCount) { throw new Error('CodeShield: targeted line is outside this document. Re-scan.'); }
    const text = document.getText();
    const line = document.lineAt(lineNumber - 1);
    if (!line.text.trim() || /^\s*(\/\/|\/\*|\*)/.test(line.text)) { throw new Error('CodeShield: targeted line is blank or a comment; cannot safely place a fix.'); }
    const startOfLine = document.offsetAt(line.range.start);
    const endOfLine = document.offsetAt(line.range.end);
    const commentStarts: number[] = [];
    const boundaries = delimiters(text, commentStarts);
    const previous = [...boundaries].reverse().find(offset => offset < startOfLine) ?? -1;
    let start = previous + 1;
    while (start < text.length && /\s/.test(text[start])) { start++; }
    const endDelimiter = boundaries.find(offset => offset >= Math.max(start, startOfLine));
    if (endDelimiter === undefined || start > endOfLine || endDelimiter - start > 20000) {
        throw new Error('CodeShield: could not locate a bounded Java statement for the targeted line.');
    }
    // Multiple statements on one reported line cannot be uniquely identified by line number.
    if (boundaries.filter(offset => offset >= startOfLine && offset < endOfLine).length > 1) {
        throw new Error('CodeShield: the target line has multiple statement boundaries. Split the statements onto separate lines and re-scan.');
    }
    const end = endDelimiter + 1;
    if (commentStarts.some(offset => offset >= start && offset < end)) { throw new Error('CodeShield: the target statement contains comments; review and edit it manually.'); }
    const code = stripFences(fixedCode);
    // smart-fix must return the replacement snippet, not an entire class or file.
    if (/\b(package\s+[\w.]|import\s+|class\s+|interface\s+|record\s+)/.test(code)) {
        throw new Error('CodeShield: smart-fix returned file/class code rather than a replacement statement. No changes applied.');
    }
    const terminal = text[endDelimiter];
    if ((terminal === '{' || terminal === '}') && (code.at(-1) !== terminal || delimiters(code).filter(i => '{}'.includes(code[i])).length !== 1)) {
        throw new Error('CodeShield: a block-header fix must preserve its single brace boundary. No changes applied.');
    }
    if (terminal === ';' && code.at(-1) !== ';') { throw new Error('CodeShield: the replacement statement must end in a semicolon.'); }
    const startPosition = document.positionAt(start);
    if (document.lineAt(startPosition.line).text.slice(0, startPosition.character).trim()) {
        throw new Error('CodeShield: statement begins after other code on the same line; cannot safely place a fix.');
    }
    const indent = document.lineAt(startPosition.line).text.slice(0, startPosition.character);
    const lines = code.split(/\r?\n/);
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const replacement = [lines[0].trimStart(), ...lines.slice(1).map(value => value.trim() ? indent + value : '')].join(eol);
    return { range: new vscode.Range(startPosition, document.positionAt(end)), replacement, patchedText: text.slice(0, start) + replacement + text.slice(end) };
}
export class PreviewProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
    private readonly texts = new Map<string, string>();
    provideTextDocumentContent(uri: vscode.Uri): string { return this.texts.get(uri.toString()) ?? ''; }
    create(label: string, text: string): vscode.Uri {
        const uri = vscode.Uri.parse(`codeshield-preview:/${randomUUID()}/${label}.java`);
        this.texts.set(uri.toString(), text);
        return uri;
    }
    release(uris: vscode.Uri[]): void { for (const uri of uris) { this.texts.delete(uri.toString()); } }
    dispose(): void { this.texts.clear(); }
}
