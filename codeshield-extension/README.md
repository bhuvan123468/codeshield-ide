# CodeShield

CodeShield provides AI-assisted secure Java development through a VS Code API extension. It uses your existing Spring Boot backend without changing it.

## Requirements and settings

- Run Spring Boot and MySQL. Default backend: `http://127.0.0.1:8080`.
- For fixes, start Ollama and install `llama3.2`. Default Ollama: `http://127.0.0.1:11434`.
- Set `codeshield.backendUrl`, `codeshield.ollamaUrl`, and `codeshield.timeoutSeconds` in IDE settings. The default timeout is 120 seconds per request.
- The backend must be able to read the Java file at the absolute path sent by the extension. A Codespace path is not a laptop path, and Codespace loopback URLs do not reach your laptop.
- Use a Node-based extension host with global `fetch` (Node 18+). This is not a browser-only web extension.

## Usage

1. Open a local `.java` file and select the CodeShield shield in the Activity Bar.
2. Choose **Scan file**, or run **CodeShield: Scan File**. The extension saves the file, scans it, and shows diagnostics plus clickable findings and an issue count.
3. Choose **Auto-fix and validate**, run the corresponding command, or use the quick fix on a CodeShield diagnostic. The backend selects the vulnerability; the quick fix does not force it to fix the diagnostic under the cursor.
4. Review the original/patched diff. The notification shows the backend safety score and status. Select **Apply Fix** for SAFE results, **Apply Anyway** for other statuses, or **Discard**. Dismissing the notification also discards the proposal.
5. An applied fix uses WorkspaceEdit, saves, and re-scans. Use Ctrl+Z to undo. Editing a document clears its stale diagnostics and findings.

Cancel the progress notification to abort the current HTTP request. Cancelling the client request may not stop a backend operation that has already started. During diff review, use Discard. Backend status is checked on activation, opening the dashboard, changing the URL setting, and operations; it is not continuously polled.

The dashboard displays SAFE as green. Other statuses are amber at scores of at least 50 and red below 50. This presentation assumes a 0–100 safety score; the backend status determines whether the action says Apply Fix or Apply Anyway.

## Patch placement

The extension matches the returned vulnerability type and nearest original CVSS score to the backend's findings for this file. It refuses ties across different lines. It strips a single surrounding Markdown Java fence and locates a statement through the next `;`, `{`, or `}`, accounting for strings, comments, text blocks, and parentheses.

Ambiguous same-line statements, comment-bearing snippets, class/file replacements, missing delimiters, and unsafe block-header replacements are refused. The backend should return only the replacement statement or header. A changed or closed source document invalidates the proposal. Preview before applying: this delimiter-based placement is not a Java AST transformation, and the backend's validation is not an IDE compilation check.

## Extension-only checks and packaging

From this directory, using Node 24:

```sh
npm install
npm run check
npm run compile
npm test
npm run package
```

After the initial install, use `npm ci` to reproduce the committed lockfile. The tests use a lightweight VS Code API stub and mocked backend responses; they do not contact Spring Boot or Ollama or replace the real Theia checklist below.

Packaging creates `codeshield-0.1.0.vsix`; only compiled code, the manifest, icon, license and README are shipped. No external HTTP libraries or runtime dependencies are used.

## Built-in Theia plugin

The root `yarn download:plugins` command downloads the upstream plugins, then runs `yarn bundle:codeshield`, then makes the plugin files writable. The bundling script compiles this extension, packages it without runtime dependencies, and stages `plugins/codeshield.codeshield.vsix`. A stable filename replaces the previous CodeShield bundle when its version changes. Other plugins are preserved, and failed compilation or packaging leaves the previous staged bundle in place.

The extension stays separate from the root Yarn workspaces. `yarn bundle:codeshield` first installs only its development dependencies with `npm --prefix codeshield-extension ci --no-audit --no-fund`, using its lockfile, so the existing plugin pipeline also works on a fresh CI checkout. The Node staging script itself does not install dependencies, and no Theia dependency versions change. Generated VSIX files, compiled output and the root plugins directory are ignored by Git. No registry publication or manual extension installation is needed for the built-in bundle.

Both app development start commands load the root `plugins/` directory. The existing Electron packaging configuration also copies that directory into the packaged application, where its startup script loads it as default plugins. This phase does not run or change Electron packaging.

### Codespace development build

Use Node 24 and Yarn Classic 1.x. From the repository root:

```sh
npm --prefix codeshield-extension ci
npm --prefix codeshield-extension test
yarn install --frozen-lockfile
yarn build:dev
yarn download:plugins
ls -lh plugins/codeshield.codeshield.vsix
yarn browser start --hostname=0.0.0.0 --port=3000
```

Forward port 3000 in the Codespace and open it in your browser. You should see the CodeShield shield and Dashboard, and both CodeShield commands in the command palette. Built-in plugins load at startup; restart the app after changing the staged VSIX.

For a browser-only development build, replace `yarn build:dev` with:

```sh
yarn build:extensions
yarn browser build
```

For extension-only updates after dependencies are installed, without rebuilding Theia or downloading upstream plugins:

```sh
node scripts/bundle-codeshield.js
```

For Electron development on a machine with a graphical desktop, after the development build and plugin staging:

```sh
yarn electron rebuild
yarn electron start
```

The Electron rebuild selects Electron-compatible native dependencies after using the browser target. A normal headless Codespace cannot show the Electron window without a configured graphical session.

### Integration test

1. Verify that the CodeShield shield, Dashboard, palette commands and Java status bar item appear without installing the VSIX manually.
2. With Spring Boot and Ollama reachable from the extension host, open a Java file at a path the backend can access.
3. Scan it, inspect CodeShield diagnostics and click a finding to jump to its line.
4. Request a fix, inspect the diff, and Discard once to confirm the file stays unchanged.
5. Request another fix, Apply it, confirm save/re-scan, and test Ctrl+Z.
6. Run the full compatibility checklist below, including cancellation and offline services.

The Codespace can test plugin loading and UI. Its default loopback URLs do not reach your laptop, and changing the URLs alone does not make the backend able to read Codespace file paths. Run end-to-end laptop scans in the local desktop app or supply shared paths and connectivity yourself; this project does not change the backend.

## Theia compatibility checklist

Test against the application's pinned Theia version. Upstream implements these APIs, but compilation against VS Code typings cannot establish runtime compatibility.

- [ ] DiagnosticCollection: correct Java lines, severity mapping, CodeShield source; edits clear diagnostics.
- [ ] WebviewViewProvider: shield/container appears, Dashboard opens, strict CSP permits only nonce scripts/styles; navigation/reopening retains state.
- [ ] Commands: palette and dashboard scan/fix actions; non-Java documents show a clear error.
- [ ] withProgress: visible busy state, cancellable notification, cancellation aborts a slow request.
- [ ] WorkspaceEdit: Apply updates only the target snippet, saves and re-scans; Ctrl+Z undoes it; changes during review invalidate the proposal.
- [ ] vscode.diff: original/patched Java documents display side-by-side; no edit is applied before approval.
- [ ] TextDocumentContentProvider: virtual preview documents load and stay readable during review.
- [ ] Code actions: CodeShield diagnostics offer Auto-Fix and Validate, other diagnostics do not.
- [ ] Status bar: issue count follows the active Java file and clears after editing.
- [ ] Failure paths: stopped backend, stopped Ollama, timeout, HTTP error, malformed JSON, ambiguous target and Discard leave the source unchanged.

Webview CSP handling, progress cancellation, virtual-document diff rendering and undo grouping deserve particular attention in Theia. The backend cannot access laptop files from a remote extension host without shared paths and connectivity.
