#!/bin/bash
# CV-Git Service Setup Script
# Automatically detects available ports and starts Docker services

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}CV-Git Service Setup${NC}"
echo "======================================"

# Function to check if a port is in use
is_port_in_use() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        return 0  # Port is in use
    else
        return 1  # Port is available
    fi
}

# Function to find next available port starting from a base port
find_available_port() {
    local base_port=$1
    local port=$base_port
    
    while is_port_in_use $port; do
        port=$((port + 1))
        if [ $port -gt $((base_port + 100)) ]; then
            echo -e "${RED}Error: Could not find available port in range $base_port-$((base_port + 100))${NC}"
            return 1
        fi
    done
    
    echo $port
}

# Check if .env exists, if not create it
if [ ! -f .env ]; then
    echo -e "${YELLOW}Creating .env file...${NC}"
    cp .env.example .env
fi

# Detect available ports
echo -e "\n${YELLOW}Detecting available ports...${NC}"

FALKORDB_PORT=$(find_available_port 6379)
if [ $? -eq 0 ]; then
    echo -e "FalkorDB: ${GREEN}$FALKORDB_PORT${NC}"
else
    echo -e "${RED}Failed to find available port for FalkorDB${NC}"
    exit 1
fi

QDRANT_PORT=$(find_available_port 6333)
if [ $? -eq 0 ]; then
    echo -e "Qdrant HTTP: ${GREEN}$QDRANT_PORT${NC}"
else
    echo -e "${RED}Failed to find available port for Qdrant${NC}"
    exit 1
fi

QDRANT_GRPC_PORT=$(find_available_port 6334)
if [ $? -eq 0 ]; then
    echo -e "Qdrant gRPC: ${GREEN}$QDRANT_GRPC_PORT${NC}"
else
    echo -e "${RED}Failed to find available port for Qdrant gRPC${NC}"
    exit 1
fi

# Update .env file
echo -e "\n${YELLOW}Updating .env file...${NC}"
sed -i "s/^FALKORDB_PORT=.*/FALKORDB_PORT=$FALKORDB_PORT/" .env
sed -i "s/^QDRANT_PORT=.*/QDRANT_PORT=$QDRANT_PORT/" .env
sed -i "s/^QDRANT_GRPC_PORT=.*/QDRANT_GRPC_PORT=$QDRANT_GRPC_PORT/" .env

# Stop any existing services
echo -e "\n${YELLOW}Stopping existing services...${NC}"
docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true

# Start services
echo -e "\n${YELLOW}Starting services...${NC}"
docker compose up -d 2>/dev/null || docker-compose up -d

# Wait for services to be ready
echo -e "\n${YELLOW}Waiting for services to be ready...${NC}"
sleep 3

# Check FalkorDB
if docker exec cv-git-falkordb redis-cli ping >/dev/null 2>&1; then
    echo -e "FalkorDB: ${GREEN}✓ Running on port $FALKORDB_PORT${NC}"
else
    echo -e "FalkorDB: ${RED}✗ Failed to start${NC}"
    exit 1
fi

# Check Qdrant
if curl -sf http://localhost:$QDRANT_PORT/health >/dev/null 2>&1; then
    echo -e "Qdrant: ${GREEN}✓ Running on port $QDRANT_PORT${NC}"
else
    echo -e "Qdrant: ${YELLOW}⚠ Not responding (may still be starting)${NC}"
fi

# Update CV-Git configuration
echo -e "\n${YELLOW}Updating CV-Git configuration...${NC}"
CONFIG_FILE="$HOME/.cv-git/config.json"

if [ -f "$CONFIG_FILE" ]; then
    # Use jq if available, otherwise use sed
    if command -v jq >/dev/null 2>&1; then
        tmp=$(mktemp)
        jq ".graph.port = $FALKORDB_PORT | .vector.port = $QDRANT_PORT" "$CONFIG_FILE" > "$tmp"
        mv "$tmp" "$CONFIG_FILE"
        echo -e "Config updated: ${GREEN}✓${NC}"
    else
        echo -e "${YELLOW}⚠ jq not found. Please manually update $CONFIG_FILE:${NC}"
        echo -e "  graph.port: $FALKORDB_PORT"
        echo -e "  vector.port: $QDRANT_PORT"
    fi
else
    echo -e "${YELLOW}⚠ Config file not found at $CONFIG_FILE${NC}"
    echo -e "Run 'cv init' to create it, then update these values:"
    echo -e "  graph.port: $FALKORDB_PORT"
    echo -e "  vector.port: $QDRANT_PORT"
fi

echo -e "\n${GREEN}✓ Setup complete!${NC}"
echo -e "\nServices running on:"
echo -e "  FalkorDB: localhost:$FALKORDB_PORT"
echo -e "  Qdrant:   localhost:$QDRANT_PORT"
echo -e "\nRun 'cv doctor' to verify the setup."
