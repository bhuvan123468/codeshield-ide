# CodeShield IDE branding

The root `branding/` directory now contains artwork based on the existing CodeShield activity-bar shield, added with your approval. `icon.svg` is the editable vector source; PNG, ICO and ICNS files provide platform icons. You may replace them later while keeping the filenames below.

| File | Required format and size | Used for |
| --- | --- | --- |
| `icon.png` | 512×512 PNG, preferably transparent | Welcome icon, Linux window and application icon |
| `icon.ico` | ICO containing 16×16, 32×32, 48×48, and 256×256 images | Browser favicon, Windows app and installer icons |
| `icon.icns` | macOS ICNS containing standard sizes through 1024×1024 | macOS app icon |
| `logo.svg` | Standalone SVG with a `viewBox`; use scalable artwork and embedded shapes/fonts | About logo and desktop splash |

The splash window is 446×276. Choose a logo viewBox/aspect ratio that fits that window, or adjust `splashScreenOptions` in the two Electron manifests. Avoid external assets in the SVG; it must work offline.

Browser builds require PNG, SVG and ICO assets. Electron development requires PNG and SVG; Windows/macOS packaging additionally needs the platform icon. The build helper gives a clear missing-artwork error for PNG/SVG. Electron packaging reads platform icons directly from this directory. Do not copy artwork manually into upstream resource directories.

## Configuration

All three application variants have product/application name `CodeShield IDE`, and preferences folder `.codeshield-ide`. Both Electron variants use application ID `com.codeshield.ide` and URL scheme `codeshield`. The preview and normal desktop builds intentionally share their application identity and settings; install/test one variant at a time.

CSS points to the source PNG/SVG here and ESBuild emits their frontend assets. The build helper stages PNG/SVG in each app's ignored `resources/branding/` folder for the Electron splash/window icon. Electron packaging includes those staged resources. The browser favicon is copied from `icon.ico`. The upstream Windows installer sidebars have been removed from the packaging configuration; default installer layout is used.

The shared Welcome/About copy says **CodeShield IDE: AI-assisted secure Java development**. Product help links point to this repository. Eclipse license headers, LICENSE files, attribution notices and upstream source artwork remain preserved.

The inherited updater is excluded from both Electron application dependencies, its feed configuration has been removed, and packaging scripts use `--publish never`. Its source remains for future adaptation. No dependency versions changed. Re-enable only after configuring your own release feed. Old Theia settings are not migrated automatically.

## Build and check in a Codespace

Add the four files above before building. With Node 24 and Yarn Classic 1.x, from the repository root:

```sh
yarn install --frozen-lockfile
yarn build:dev
yarn download:plugins
yarn browser start --hostname=0.0.0.0 --port=3000
```

Forward port 3000. Check the window/browser title, favicon, Welcome wording and image, About title/logo, CodeShield help links and dashboard. Confirm settings are stored under `.codeshield-ide` on the application host.

On a local machine with a graphical desktop, after the development build and plugin staging:

```sh
yarn electron rebuild
yarn electron start
```

Check the splash logo, window icon/title, About dialog, and that Check for Updates is absent. On Linux, check launcher prompts display CodeShield IDE. Verify the backend can access the selected Java file, then test scanning, fix preview, Apply/Discard and Ctrl+Z using the extension README checklist.

The optional preview variant can be built with `yarn build:extensions` followed by `yarn electron-next build`, then started with `yarn electron-next start`. It shares the same branding assets and app identity.

No full application build or Electron packaging was run during the branding phase; missing artwork and runtime appearance must be checked after you supply the files.

## Phase 4 file changes

```text
.gitignore
applications/browser/package.json
applications/browser/esbuild.mjs
applications/electron/package.json
applications/electron/electron-builder.yml
applications/electron/esbuild.mjs
applications/electron/scripts/theia-electron-main.js
applications/electron-next/package.json
applications/electron-next/electron-builder.yml
applications/electron-next/esbuild.mjs
applications/electron-next/scripts/theia-electron-main.js
theia-extensions/product/src/browser/branding-util.tsx
theia-extensions/product/src/browser/style/index.css
theia-extensions/product/src/browser/theia-ide-contribution.tsx
theia-extensions/product/src/browser/theia-ide-getting-started-widget.tsx
theia-extensions/product/src/electron-main/icon-contribution.ts
theia-extensions/launcher/src/browser/create-launcher-contribution.ts
theia-extensions/launcher/src/node/launcher-endpoint.ts
theia-extensions/updater/src/electron-browser/updater/theia-updater-frontend-contribution.ts
scripts/branding-assets.js                              (new)
branding/README.md                                     (new)
```
