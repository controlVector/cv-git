#!/bin/bash
# CV-Git Installer for Ubuntu/Debian
# Usage: curl -fsSL https://raw.githubusercontent.com/controlVector/cv-git/main/install.sh | bash

set -e

VERSION=""  # Will be populated by get_version()
INSTALL_DIR="/usr/local/lib/cv-git"
BIN_DIR="/usr/local/bin"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get version dynamically from package.json
get_version() {
    # Try local package.json first (for local installs)
    if [ -f "package.json" ]; then
        VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
    fi
    # Fallback: fetch from GitHub
    if [ -z "$VERSION" ]; then
        VERSION=$(curl -fsSL https://raw.githubusercontent.com/controlVector/cv-git/main/package.json 2>/dev/null | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
    fi
    # Ultimate fallback
    if [ -z "$VERSION" ]; then
        VERSION="0.4.0"
    fi
}

# Install native modules using npm
# This ensures all dependencies are properly resolved
install_native_modules() {
    echo "Installing native modules..."

    # Create a minimal package.json for the native modules
    sudo tee "$INSTALL_DIR/package.json" > /dev/null << 'PKGJSON'
{
  "name": "cv-git-runtime",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "keytar": "7.9.0",
    "tree-sitter": "0.21.1",
    "tree-sitter-go": "0.21.2",
    "tree-sitter-java": "0.21.0",
    "tree-sitter-javascript": "0.21.4",
    "tree-sitter-python": "0.21.0",
    "tree-sitter-rust": "0.21.0",
    "tree-sitter-typescript": "0.21.2"
  }
}
PKGJSON

    # Install dependencies
    cd "$INSTALL_DIR"
    if sudo npm install --production --silent 2>/dev/null; then
        echo -e "${GREEN}  Native modules installed successfully${NC}"
        return 0
    else
        echo -e "${YELLOW}  Warning: Some native modules may not have installed correctly${NC}"
        return 1
    fi
}

# Get version before showing banner
get_version

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════╗"
echo "║        CV-Git Installer v${VERSION}        ║"
echo "║  AI-Native Version Control Layer      ║"
echo "╚═══════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root for system install
if [ "$EUID" -ne 0 ]; then
    echo -e "${YELLOW}Note: Running without sudo - will install to ~/.local${NC}"
    INSTALL_DIR="$HOME/.local/lib/cv-git"
    BIN_DIR="$HOME/.local/bin"
    mkdir -p "$BIN_DIR"
fi

# Check for Node.js
check_nodejs() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            echo -e "${GREEN}✓ Node.js $(node -v) found${NC}"
            return 0
        fi
    fi
    return 1
}

# Install Node.js if needed
install_nodejs() {
    echo -e "${YELLOW}Installing Node.js 20.x...${NC}"

    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
        sudo apt-get install -y nodejs
    elif command -v dnf &> /dev/null; then
        # Fedora
        sudo dnf install -y nodejs
    elif command -v pacman &> /dev/null; then
        # Arch
        sudo pacman -S nodejs npm
    else
        echo -e "${RED}Could not install Node.js. Please install Node.js 18+ manually.${NC}"
        exit 1
    fi
}

# Check for Docker
check_docker() {
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}✓ Docker found${NC}"
        return 0
    fi
    return 1
}

# Install Docker if needed
install_docker() {
    echo -e "${YELLOW}Installing Docker...${NC}"

    if command -v apt-get &> /dev/null; then
        # Debian/Ubuntu
        sudo apt-get update
        sudo apt-get install -y ca-certificates curl gnupg
        sudo install -m 0755 -d /etc/apt/keyrings
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        sudo chmod a+r /etc/apt/keyrings/docker.gpg

        echo \
          "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
          $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
          sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

        sudo apt-get update
        sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

        # Add user to docker group
        sudo usermod -aG docker $USER
        echo -e "${YELLOW}Note: Log out and back in for Docker group membership to take effect${NC}"
    else
        echo -e "${RED}Please install Docker manually: https://docs.docker.com/engine/install/${NC}"
        exit 1
    fi
}

# Main installation
main() {
    echo "Checking dependencies..."
    echo

    # Check/install Node.js
    if ! check_nodejs; then
        read -p "Node.js 18+ not found. Install it? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_nodejs
        else
            echo -e "${RED}Node.js 18+ is required. Exiting.${NC}"
            exit 1
        fi
    fi

    # Check/install Docker
    if ! check_docker; then
        read -p "Docker not found. Install it? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_docker
        else
            echo -e "${YELLOW}Warning: Docker is required for FalkorDB and Qdrant${NC}"
        fi
    fi

    echo
    echo "Installing cv-git..."

    # Create install directory
    sudo mkdir -p "$INSTALL_DIR"

    # Download and extract release (or clone for development)
    if [ -f "packages/cli/dist/bundle.cjs" ]; then
        # Local development install
        echo "Installing from local build..."
        sudo cp packages/cli/dist/bundle.cjs "$INSTALL_DIR/cv.cjs"

        # Install native modules via npm
        install_native_modules
    else
        # Download release
        RELEASE_URL="https://github.com/controlVector/cv-git/releases/download/v${VERSION}/cv-git-${VERSION}.tar.gz"
        echo "Downloading cv-git v${VERSION}..."

        TEMP_DIR=$(mktemp -d)
        curl -fsSL "$RELEASE_URL" -o "$TEMP_DIR/cv-git.tar.gz" || {
            echo -e "${YELLOW}Release not found. Cloning repository...${NC}"
            git clone --depth 1 https://github.com/controlVector/cv-git.git "$TEMP_DIR/cv-git"
            cd "$TEMP_DIR/cv-git"
            npm install -g pnpm
            pnpm install
            pnpm build

            # Rebuild native modules for the target system
            echo "Rebuilding native modules..."
            pnpm rebuild keytar tree-sitter 2>/dev/null || echo -e "${YELLOW}Native module rebuild warning (may be OK)${NC}"

            # Copy bundle and install native modules
            sudo cp packages/cli/dist/bundle.cjs "$INSTALL_DIR/cv.cjs"
            install_native_modules

            cd -
            rm -rf "$TEMP_DIR"
        }

        if [ -f "$TEMP_DIR/cv-git.tar.gz" ]; then
            tar -xzf "$TEMP_DIR/cv-git.tar.gz" -C "$INSTALL_DIR"
            rm -rf "$TEMP_DIR"
        fi
    fi

    # Create wrapper script with correct install path
    sudo tee "$BIN_DIR/cv" > /dev/null << WRAPPER
#!/bin/bash
exec node "${INSTALL_DIR}/cv.cjs" "\$@"
WRAPPER

    sudo chmod +x "$BIN_DIR/cv"

    # Verify installation
    echo
    if cv --version &> /dev/null; then
        echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║     CV-Git installed successfully!    ║${NC}"
        echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
        echo
        echo "Next steps:"
        echo "  1. Initialize a repository:  cv init"
        echo "  2. Check system status:      cv doctor"
        echo "  3. Sync your codebase:       cv sync"
        echo "  4. Search code:              cv find \"authentication\""
        echo
    else
        echo -e "${RED}Installation failed. Please check the errors above.${NC}"
        exit 1
    fi
}

# Run uninstall if requested
if [ "$1" = "uninstall" ]; then
    echo "Uninstalling cv-git..."
    sudo rm -rf "$INSTALL_DIR"
    sudo rm -f "$BIN_DIR/cv"
    echo -e "${GREEN}CV-Git uninstalled successfully${NC}"
    exit 0
fi

main
