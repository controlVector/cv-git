#!/bin/bash
# Test script for cv explain functionality
# Tests the fix for "No relevant code found" bug when using OpenRouter

set -e

echo "=== CV Explain Test Script ==="
echo ""

# Check prerequisites
echo "1. Checking prerequisites..."

if ! command -v cv &> /dev/null; then
    echo "   ✗ cv command not found"
    exit 1
fi
echo "   ✓ cv command found: $(cv --version)"

# Check if we're in a cv-git repo
if [ ! -d ".cv" ]; then
    echo "   ✗ Not in a cv-git repository (.cv directory missing)"
    echo "   Run 'cv init' first"
    exit 1
fi
echo "   ✓ .cv directory exists"

# Check API keys
echo ""
echo "2. Checking API keys..."

ANTHROPIC_OK=$(cv auth test anthropic 2>&1 | grep -c "✔" || true)
if [ "$ANTHROPIC_OK" -eq 0 ]; then
    echo "   ✗ Anthropic API key not configured"
    echo "   Run: cv auth setup anthropic"
    exit 1
fi
echo "   ✓ Anthropic API key configured"

# Check for embedding API key (OpenRouter or OpenAI)
OPENROUTER_OK=$(cv auth test openrouter 2>&1 | grep -c "✔" || true)
OPENAI_OK=$(cv auth test openai 2>&1 | grep -c "✔" || true)

if [ "$OPENROUTER_OK" -eq 0 ] && [ "$OPENAI_OK" -eq 0 ]; then
    echo "   ✗ No embedding API key (OpenRouter or OpenAI) configured"
    echo "   Run: cv auth setup openrouter"
    exit 1
fi

if [ "$OPENROUTER_OK" -gt 0 ]; then
    echo "   ✓ OpenRouter API key configured (for embeddings)"
elif [ "$OPENAI_OK" -gt 0 ]; then
    echo "   ✓ OpenAI API key configured (for embeddings)"
fi

# Check services
echo ""
echo "3. Checking services..."

QDRANT_OK=$(curl -s http://localhost:6334/collections 2>/dev/null | grep -c '"status":"ok"' || true)
if [ "$QDRANT_OK" -eq 0 ]; then
    echo "   ✗ Qdrant not responding on localhost:6334"
    exit 1
fi
echo "   ✓ Qdrant is running"

FALKOR_OK=$(redis-cli -p 6379 ping 2>/dev/null | grep -c "PONG" || true)
if [ "$FALKOR_OK" -eq 0 ]; then
    echo "   ✗ FalkorDB not responding on localhost:6379"
    exit 1
fi
echo "   ✓ FalkorDB is running"

# Check if synced
echo ""
echo "4. Checking sync status..."

VECTOR_COUNT=$(curl -s http://localhost:6334/collections/code_chunks 2>/dev/null | jq -r '.result.points_count // 0')
if [ "$VECTOR_COUNT" -eq 0 ]; then
    echo "   ✗ No vectors in code_chunks collection"
    echo "   Run: cv sync"
    exit 1
fi
echo "   ✓ Found $VECTOR_COUNT vectors in code_chunks"

# Test cv explain
echo ""
echo "5. Testing cv explain..."

# Run cv explain with a test query
EXPLAIN_OUTPUT=$(cv explain "how does sync work" 2>&1 || true)

# Check for success indicators
if echo "$EXPLAIN_OUTPUT" | grep -q "Found.*code chunks"; then
    CHUNKS=$(echo "$EXPLAIN_OUTPUT" | grep -oP 'Found \K\d+(?= code chunks)')
    echo "   ✓ Vector search working: found $CHUNKS code chunks"
else
    echo "   ✗ Vector search failed"
    echo "   Output: $EXPLAIN_OUTPUT"
    exit 1
fi

if echo "$EXPLAIN_OUTPUT" | grep -q "Explanation:"; then
    echo "   ✓ Claude API working: explanation generated"
else
    echo "   ✗ Claude API failed - no explanation generated"
    echo "   Output: $EXPLAIN_OUTPUT"
    exit 1
fi

# Check for known failure patterns
if echo "$EXPLAIN_OUTPUT" | grep -q "No relevant code found"; then
    echo "   ✗ REGRESSION: 'No relevant code found' error appeared"
    exit 1
fi

if echo "$EXPLAIN_OUTPUT" | grep -q "API key not found"; then
    echo "   ✗ REGRESSION: API key error appeared"
    exit 1
fi

echo ""
echo "=== All tests passed! ==="
echo ""
echo "cv explain is working correctly with:"
echo "  - Vector search (embeddings via OpenRouter/OpenAI)"
echo "  - Claude API (explanations via Anthropic)"
