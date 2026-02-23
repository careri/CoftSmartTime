#!/bin/bash
set -e
rm *.vsix || true
echo "Packaging VSIX extension..."
npx @vscode/vsce package
