#!/bin/bash
set -e
echo "Packaging VSIX extension..."
npx @vscode/vsce package
