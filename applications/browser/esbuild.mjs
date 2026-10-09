/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch, __dirname } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import fs from 'node:fs';
import path from 'node:path';

import esbuild from 'esbuild';
import { stageBranding } from '../../scripts/branding-assets.js';

stageBranding(__dirname);
const faviconSource = path.resolve(__dirname, '../../branding/icon.ico');
if (!fs.existsSync(faviconSource)) {
    throw new Error('Missing branding/icon.ico. Add your CodeShield favicon before building.');
}

// serve favicon from root and inject link tag into index.html
browserOptions.plugins.push(
    {
        name: 'favicon-link',
        setup(build) {
            build.onEnd(() => {
                const indexPath = path.join(__dirname, 'lib', 'frontend', 'index.html');
                if (fs.existsSync(indexPath)) {
                    fs.copyFileSync(faviconSource, path.join(__dirname, 'lib', 'frontend', 'favicon.ico'));
                    let html = fs.readFileSync(indexPath, 'utf8');
                    if (!html.includes('rel="icon"')) {
                        html = html.replace('</head>', '  <link rel="icon" type="image/x-icon" href="./favicon.ico">\n</head>');
                        fs.writeFileSync(indexPath, html);
                    }
                }
            });
        }
    }
);

const browserContext = await esbuild.context(browserOptions);
const nodeContext = await esbuild.context(nodeOptions);


if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
    } catch {
        process.exit(1);
    }
}
