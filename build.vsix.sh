#!/bin/bash
set -e
echo "Packaging VSIX extension... ignoring warnings about missing README and CHANGELOG"
npx @vscode/vsce package --baseContentUrl https://tmp.coft.smarttime.com --skip-license
