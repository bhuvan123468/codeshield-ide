# Preview CodeShield IDE

You can view the IDE without Spring Boot, MySQL or Ollama. No mock backend is provided or needed. Scanning and AI fixes stay unavailable until you connect your real backend.

## Before starting

These changes must be committed and pushed to your repository. In GitHub, create a Codespace on the branch containing them (currently `codex/phase-5-preview`). The commands below run in the Codespace's Bash terminal, at the repository root.

If the phase changes are still uncommitted in your local workspace, after adding your artwork run these commands there first. They include the accumulated Phase 2–5 changes and leave your local `AGENTS.md` untouched:

```bash
git add .gitignore package.json applications theia-extensions scripts/bundle-codeshield.js scripts/branding-assets.js codeshield-extension branding PREVIEW.md .github/workflows/windows-installer.yml
git commit -m "Add CodeShield IDE preview and Windows installer workflow"
git push -u origin codex/phase-5-preview
```

Add your own artwork first:

- `branding/icon.png`: 512×512 PNG.
- `branding/icon.ico`: ICO with 16, 32, 48 and 256 pixel images; used as the browser favicon and Windows installer icon.
- `branding/logo.svg`: standalone SVG with a `viewBox`.
- `branding/icon.icns`: macOS icon set, only needed for macOS packaging, not this browser preview or Windows workflow.

Do not use placeholders or the old upstream artwork. See `branding/README.md` for details. Builds cannot complete without the required files.

## 1. Select the source and tools

The repository requires Node.js **24 or newer** and Yarn Classic **1.x** (`>=1.7.0 <2`). Use Node **24** and Yarn **1.22.22**, matching the Windows workflow.

```bash
git fetch origin
git switch codex/phase-5-preview
nvm install 24
nvm use 24
npm install --global yarn@1.22.22
node --version
yarn --version
```

Codespaces normally provides `nvm`. If it is not loaded in the terminal:

```bash
export NVM_DIR="$HOME/.nvm"
source "$NVM_DIR/nvm.sh"
nvm install 24
nvm use 24
```

## 2. Check assets and install dependencies

```bash
test -f branding/icon.png && test -f branding/icon.ico && test -f branding/logo.svg
yarn install --frozen-lockfile --network-timeout 100000
```

Stop if the asset check fails and add the missing files. This root install is for you to run in the Codespace; it was not run by Codex during Phase 5.

## 3. Build only the browser application in development mode

```bash
yarn build:extensions
yarn browser build
yarn download:plugins
ls -lh plugins/codeshield.codeshield.vsix
```

These are the real root scripts. `build:extensions` compiles the custom Theia extensions; `browser build` invokes the browser target with `--mode development`; `download:plugins` downloads existing plugins and installs/compiles/packages CodeShield from its extension lockfile. Do not use `yarn build:dev` for this preview because that also builds the Electron application.

If a small Codespace runs out of memory, choose a larger machine. You can set this before retrying the browser build:

```bash
export NODE_OPTIONS=--max_old_space_size=4096
yarn browser build
```

## 4. Start the browser IDE

```bash
yarn browser start --hostname=0.0.0.0 --port=3000
```

Leave that terminal running. Use a second terminal for other commands. Stop the IDE with Ctrl+C.

## 5. Open the forwarded port

In the Codespace's **Ports** tab, find port **3000**. If it is not listed, choose **Forward a Port** and enter `3000`. Keep its visibility **Private**, then choose **Open in Browser** (the globe icon).

To print the forwarded URL from a second Codespace terminal:

```bash
printf 'https://%s-3000.app.github.dev\n' "$CODESPACE_NAME"
```

After forwarding the port, click the printed link to open it in your browser. The Ports tab also provides the exact URL. Do not open `127.0.0.1:3000` on your laptop expecting to reach the Codespace automatically.

## What you should see

- [ ] Browser/window title identifies **CodeShield IDE** (a file or workspace name may also appear).
- [ ] Welcome page shows **CodeShield IDE: AI-assisted secure Java development**, with your supplied artwork. If it is closed, search for **Getting Started** in the command palette.
- [ ] **Help → About** shows CodeShield IDE and your logo, while retaining Eclipse attribution and version information.
- [ ] The activity bar includes the monochrome **CodeShield shield**.
- [ ] Clicking the shield opens the **Dashboard** view with **Scan file** and **Auto-fix and validate** buttons.
- [ ] With no backend running, after the brief status check the Dashboard says **Backend offline** and shows a red dot. No startup error notification is expected.
- [ ] Clicking either button shows one notification: **Cannot reach the CodeShield backend. Start it on port 8080.** No Java file, Ollama, or backend is needed for this offline check.

If CodeShield is absent, confirm the VSIX exists in `plugins/`, restart the browser app, and inspect the running terminal for plugin deployment errors. Installing a VSIX manually is not required for this bundled preview.

## Optional: build a Windows installer in GitHub Actions

Commit and push `.github/workflows/windows-installer.yml` and all source/branding files. GitHub requires a manually dispatched workflow to exist on the repository's default branch before offering it in the Actions interface. Merge the completed source into the default branch when ready, then:

1. Open **Actions → CodeShield IDE Windows Installer → Run workflow**.
2. Select the branch containing the finished source and artwork, and run it.
3. Wait for the single `windows-latest` job.
4. Download **CodeShield-IDE-Windows-unsigned** from the run's Artifacts section, extract it, and run the `.exe` on Windows.

The workflow uses the repo's extension build, Electron dev build, plugin download/bundle, and Electron package scripts. It builds an x64 NSIS installer without signing or publishing. The updater is excluded. There are no macOS/Linux jobs. No signing secrets or backend services are needed. Windows may show a SmartScreen warning because the installer is unsigned.

This new workflow runs only on manual dispatch. Existing inherited workflows are unchanged and may have their own push, pull-request or scheduled triggers.

## Phase 5 report

Changed/new files:

```text
PREVIEW.md                                             (new)
.github/workflows/windows-installer.yml                 (new)
codeshield-extension/package.json
codeshield-extension/src/extension.ts
codeshield-extension/src/sidebar.ts
codeshield-extension/tests/commands.test.cjs
```

Manual order: supply artwork → commit/push source → create/open Codespace on the branch → select Node/Yarn → install dependencies → compile Theia extensions → build browser → download/bundle plugins → start browser → open private forwarded port 3000 → run the visual/offline checklist. The Windows workflow is optional and separate from the browser preview.

Codex did not run a root install, a full app build or Electron packaging. Extension checks use in-process test doubles, not a mock backend server. Live Theia appearance and the cloud installer must be verified by running the steps above.
