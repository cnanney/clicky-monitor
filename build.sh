#!/bin/bash

# Build script for Clicky Monitor Chrome Extension
# Creates a distributable zip file from the current repository

set -e  # Exit on any error

echo "Building Clicky Monitor extension..."

# Extract version from manifest.json
VERSION=$(grep '"version"' manifest.json | sed 's/.*"version": "\(.*\)".*/\1/')

if [ -z "$VERSION" ]; then
    echo "Error: Could not extract version from manifest.json"
    exit 1
fi

echo "Version: $VERSION"

# Create builds directory if it doesn't exist
mkdir -p builds

# Output filename
OUTPUT_FILE="builds/clicky-monitor-${VERSION}.zip"

# Remove existing zip file if it exists
if [ -f "$OUTPUT_FILE" ]; then
    echo "Removing existing $OUTPUT_FILE"
    rm "$OUTPUT_FILE"
fi

# Create zip file excluding specified files and directories
echo "Creating $OUTPUT_FILE..."
zip -r "$OUTPUT_FILE" . \
    -x ".*" \
    -x ".idea/*" \
    -x "builds/*" \
    -x "CLAUDE.md" \
    -x "store_listing.txt" \
    -x "build.sh" \
    -x "clicky-monitor*.zip" \
    -x "clicky-monitor*.tar.gz"

echo "✅ Successfully created $OUTPUT_FILE"
echo "📦 Extension package ready for Chrome Web Store upload"