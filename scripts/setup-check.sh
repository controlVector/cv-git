#!/bin/bash
# CV-Git Setup Verification Script

echo "=========================================
CV-Git Setup Verification
========================================="

# Check Node.js
if command -v node &> /dev/null; then
    echo "✓ Node.js $(node -v)"
else
    echo "✗ Node.js not found"
fi

# Check Docker
if command -v docker &> /dev/null; then
    echo "✓ Docker installed"
    
    # Check services
    if docker ps | grep -q falkordb; then
        echo "✓ FalkorDB running"
    else
        echo "⚠ FalkorDB not running"
    fi
    
    if docker ps | grep -q qdrant; then
        echo "✓ Qdrant running"
    else
        echo "⚠ Qdrant not running"
    fi
else
    echo "✗ Docker not found"
fi

# Check API keys
if [ ! -z "$ANTHROPIC_API_KEY" ]; then
    echo "✓ ANTHROPIC_API_KEY set"
else
    echo "✗ ANTHROPIC_API_KEY not set"
fi

if [ ! -z "$OPENAI_API_KEY" ]; then
    echo "✓ OPENAI_API_KEY set"
else
    echo "✗ OPENAI_API_KEY not set"
fi

echo "=========================================
Run 'cv init' and 'cv sync' to get started!
"
