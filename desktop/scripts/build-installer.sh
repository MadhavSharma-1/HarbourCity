#!/usr/bin/env bash
# Builds dist/HarborCity-Setup-<version>.exe on Linux/macOS without Wine:
#   1) electron-builder packages the Windows app (dist/win-unpacked)
#   2) resedit sets the exe icon + version info (pure JS)
#   3) makensis compiles installer/installer.nsi
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
npx electron-builder --win dir --x64 --publish never
[ -f dist/.icon-ico/icon.ico ] || npx electron-builder --win nsis --x64 --publish never || true
node scripts/set-exe-icon.mjs "dist/win-unpacked/Harbor City.exe" dist/.icon-ico/icon.ico "$VERSION"
NSIS="${NSIS_DIR:-$HOME/.cache/electron-builder/nsis/nsis-3.0.4.1}"
case "$(uname)" in Darwin) MK="$NSIS/mac/makensis" ;; *) MK="$NSIS/linux/makensis" ;; esac
cd installer && NSISDIR="$NSIS" "$MK" -V2 -DVERSION="$VERSION" installer.nsi
echo "Built: dist/HarborCity-Setup-$VERSION.exe"
