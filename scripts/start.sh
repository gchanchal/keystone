#!/bin/bash

# Install pdfplumber (try multiple methods)
echo "Installing pdfplumber..."
pip3 install --user pdfplumber 2>/dev/null || \
pip3 install --break-system-packages pdfplumber 2>/dev/null || \
python3 -m pip install --user pdfplumber 2>/dev/null || \
echo "Warning: Could not install pdfplumber"

# Verify installation
python3 -c "import pdfplumber; print('pdfplumber installed successfully')" 2>/dev/null || \
echo "Warning: pdfplumber not available"

# Start the server
echo "Starting KeyStone server..."
NODE_ENV=production node packages/server/dist/index.js
