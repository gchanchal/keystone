#!/bin/bash
# Install pdfplumber at startup (ensures it's available in runtime)
pip3 install --break-system-packages pdfplumber 2>/dev/null || pip install pdfplumber 2>/dev/null || echo "pdfplumber installation skipped"

# Start the Node.js server
NODE_ENV=production node packages/server/dist/index.js
