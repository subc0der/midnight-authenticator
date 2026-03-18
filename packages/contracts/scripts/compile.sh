#!/bin/bash
#
# Compile Compact contracts using WSL
# Run from packages/contracts directory
#

set -e

CONTRACT_NAME="totp-verifier"
SRC_DIR="src"
OUT_DIR="src/managed"

echo "Compiling $CONTRACT_NAME..."

# Convert Windows path to WSL path
WIN_PATH=$(pwd)
WSL_PATH=$(wslpath -u "$WIN_PATH" 2>/dev/null || echo "/mnt/c${WIN_PATH:2}" | tr '\\' '/')

# Run compact compiler in WSL
wsl -e bash -c "
  source ~/.local/bin/env 2>/dev/null || true
  cd '$WSL_PATH'
  compact compile $SRC_DIR/$CONTRACT_NAME.compact $OUT_DIR/$CONTRACT_NAME
"

echo "Done! Output in $OUT_DIR/$CONTRACT_NAME/"
echo "  - contract/  TypeScript bindings"
echo "  - keys/      Proving/verifying keys"
echo "  - zkir/      ZK circuit IR"
