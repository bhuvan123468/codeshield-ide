#!/usr/bin/env node

// SPDX-License-Identifier: MIT
// Builds the local VS Code extension and stages it alongside downloaded plugins.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const extensionDirectory = path.join(root, 'codeshield-extension');

function runTool(relativePath, args) {
    const tool = path.join(extensionDirectory, 'node_modules', relativePath);
    if (!fs.existsSync(tool)) {
        throw new Error('CodeShield development dependencies are missing. Run: npm --prefix codeshield-extension ci');
    }
    const result = spawnSync(process.execPath, [tool, ...args], {
        cwd: extensionDirectory,
        stdio: 'inherit'
    });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        throw new Error(`CodeShield ${relativePath} failed (${result.signal || result.status}). The bundled plugin was not updated.`);
    }
}

function bundle() {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDirectory, 'package.json'), 'utf8'));
    if (manifest.publisher !== 'codeshield' || manifest.name !== 'codeshield') {
        throw new Error('Expected extension identity codeshield.codeshield. Update this bundling script if the identity changes.');
    }
    const archive = path.join(extensionDirectory, 'codeshield-builtin.vsix');
    runTool(path.join('typescript', 'bin', 'tsc'), ['-p', '.']);
    runTool(path.join('@vscode', 'vsce', 'vsce'), ['package', '--no-dependencies', '--out', archive]);

    const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (rootManifest.theiaPluginsDir !== 'plugins') {
        throw new Error('Expected the root Theia plugins directory to be plugins.');
    }
    const plugins = path.join(root, 'plugins');
    const destination = path.join(plugins, 'codeshield.codeshield.vsix');
    const temporary = path.join(plugins, `.codeshield-${process.pid}.tmp`);
    fs.mkdirSync(plugins, { recursive: true });
    try {
        fs.copyFileSync(archive, temporary);
        fs.renameSync(temporary, destination);
    } finally {
        if (fs.existsSync(temporary)) {
            fs.unlinkSync(temporary);
        }
    }
    console.log(`Bundled ${manifest.publisher}.${manifest.name} ${manifest.version}: ${destination}`);
}

try {
    bundle();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
