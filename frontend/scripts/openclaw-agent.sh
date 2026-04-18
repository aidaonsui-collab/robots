#!/bin/bash
# OpenClaw Agent Spawner for Odyssey
# Run this to start the OpenClaw agent listener

echo "🤖 Starting Odyssey OpenClaw Agent..."

# Check if OpenClaw is installed
if ! command -v openclaw &> /dev/null; then
    echo "❌ OpenClaw not found. Install with: npm install -g openclaw"
    exit 1
fi

# Create agent workspace
AGENT_DIR="$HOME/.openclaw-odyssey-agents"
mkdir -p "$AGENT_DIR"

echo "📁 Agent directory: $AGENT_DIR"
echo ""
echo "Options:"
echo "1. Start agent listener (listen for messages)"
echo "2. Spawn new agent manually"
echo "3. Test message"
read -p "Choose (1-3): " choice

case $choice in
    1)
        echo "🎧 Starting listener..."
        # This would run the agent in a loop
        echo "This would run an OpenClaw agent in listen mode"
        echo "For now, agents respond via the API's simulated responses"
        ;;
    2)
        echo "🆕 Creating new agent..."
        openclaw agents add odyssey-agent --name "Odyssey Agent" --emoji 🤖
        ;;
    3)
        echo "📨 Testing message..."
        # Would send a test message
        echo "This would test the message flow"
        ;;
    *)
        echo "Invalid choice"
        ;;
esac

echo ""
echo "📝 For full OpenClaw integration:"
echo "1. Run 'openclaw dev' in another terminal"
echo "2. Configure the agent to bind to a channel"
echo "3. Messages will flow through OpenClaw's infrastructure"