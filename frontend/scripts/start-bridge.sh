#!/bin/bash
# Start the Odyssey ↔ OpenClaw Bridge
# This connects your dashboard to your local OpenClaw instance

cd "$(dirname "$0")/.."

# Check for dependencies
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install express cors dotenv --save-dev
fi

# Check if OpenClaw is available
if ! command -v openclaw &> /dev/null; then
    echo "⚠️  OpenClaw not found in PATH"
    echo "   Install with: npm install -g openclaw"
    echo "   Or continue anyway - bridge will use fallback responses"
fi

# Start the bridge
echo "🚀 Starting Odyssey ↔ OpenClaw Bridge..."
echo ""

# Check if PORT is set
if [ -z "$BRIDGE_PORT" ]; then
    BRIDGE_PORT=3001
fi

export BRIDGE_PORT

# Run the bridge
node scripts/odyssey-openclaw-bridge.js