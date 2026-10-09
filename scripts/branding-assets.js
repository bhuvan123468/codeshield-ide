// SPDX-License-Identifier: MIT
const fs = require('fs');
const path = require('path');

function stageBranding(applicationDirectory) {
    const source = path.resolve(__dirname, '..', 'branding');
    const files = ['icon.png', 'logo.svg'];
    for (const name of files) {
        if (!fs.existsSync(path.join(source, name))) {
            throw new Error(`Missing branding/${name}. Add your CodeShield artwork as described in branding/README.md before building.`);
        }
    }
    const destination = path.join(applicationDirectory, 'resources', 'branding');
    fs.mkdirSync(destination, { recursive: true });
    for (const name of files) {
        fs.copyFileSync(path.join(source, name), path.join(destination, name));
    }
}

module.exports = { stageBranding };
