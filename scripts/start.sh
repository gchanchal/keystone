#!/bin/bash

echo "=== KeyStone Startup ==="

# Install pdfplumber - show output for debugging
echo "Installing pdfplumber..."
pip3 install pdfplumber 2>&1 || \
pip3 install --user pdfplumber 2>&1 || \
python3 -m pip install pdfplumber 2>&1 || \
echo "ERROR: All pip install methods failed"

# Verify installation
echo "Verifying pdfplumber..."
python3 -c "import pdfplumber; print('SUCCESS: pdfplumber version', pdfplumber.__version__)" 2>&1 || \
echo "ERROR: pdfplumber import failed"

# Start the server
echo "Starting KeyStone server..."
NODE_ENV=production node packages/server/dist/index.js
