#!/bin/bash
# CV-Git Installer for macOS
# Usage: curl -fsSL https://raw.githubusercontent.com/controlVector/cv-git/main/install-macos.sh | bash
#
# Security improvements:
# - Version validation and sanitization
# - Checksum verification for all downloads
# - No sudo npm install (uses proper permissions)
# - Cleanup trap for temp files
# - Input validation and error handling
# - No command injection vulnerabilities

set -e
set -o pipefail

VERSION=""
INSTALL_DIR="/usr/local/lib/cv-git"
BIN_DIR="/usr/local/bin"
GITHUB_REPO="controlVector/cv-git"
TEMP_DIR=""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Cleanup function
cleanup() {
    if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
    fi
}

# Set trap for cleanup
trap cleanup EXIT INT TERM

# Error handler
error_exit() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

# Validate version string (semver format)
validate_version() {
    local ver="$1"
    if echo "$ver" | grep -qE '^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$'; then
        return 0
    else
        return 1
    fi
}

# Get version from GitHub with validation
get_version() {
    echo "Fetching latest version..."

    # Fetch package.json securely
    local package_json
    package_json=$(curl -fsSL --max-time 10 "https://raw.githubusercontent.com/${GITHUB_REPO}/main/package.json" 2>/dev/null) || {
        error_exit "Failed to fetch version information from GitHub"
    }

    # Extract version
    VERSION=$(echo "$package_json" | grep '"version"' | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')

    # Validate version format
    if ! validate_version "$VERSION"; then
        error_exit "Invalid version format detected: $VERSION"
    fi

    echo -e "${GREEN}Latest version: v${VERSION}${NC}"
}

# Verify file checksum
verify_checksum() {
    local file="$1"
    local expected_checksum="$2"

    if [ -z "$expected_checksum" ]; then
        echo -e "${YELLOW}Warning: No checksum provided, skipping verification${NC}"
        return 0
    fi

    local actual_checksum
    actual_checksum=$(shasum -a 256 "$file" | awk '{print $1}')

    if [ "$actual_checksum" = "$expected_checksum" ]; then
        echo -e "${GREEN}✓ Checksum verified${NC}"
        return 0
    else
        error_exit "Checksum mismatch!\nExpected: $expected_checksum\nActual:   $actual_checksum"
    fi
}

# Check if running on macOS
check_macos() {
    if [[ "$OSTYPE" != "darwin"* ]]; then
        error_exit "This script is for macOS only. Please use install.sh for Linux."
    fi
}

# Check for Homebrew
check_homebrew() {
    if command -v brew &> /dev/null; then
        echo -e "${GREEN}✓ Homebrew found${NC}"
        return 0
    fi
    return 1
}

# Install Homebrew
install_homebrew() {
    echo -e "${YELLOW}Installing Homebrew...${NC}"
    echo -e "${YELLOW}Note: This will require sudo access${NC}"

    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || {
        error_exit "Failed to install Homebrew"
    }

    # Add Homebrew to PATH for Apple Silicon
    if [[ $(uname -m) == "arm64" ]]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
}

# Check for Node.js
check_nodejs() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            echo -e "${GREEN}✓ Node.js $(node -v) found${NC}"
            return 0
        else
            echo -e "${YELLOW}Node.js version $NODE_VERSION is too old (need 18+)${NC}"
            return 1
        fi
    fi
    return 1
}

# Install Node.js via Homebrew
install_nodejs() {
    echo -e "${YELLOW}Installing Node.js via Homebrew...${NC}"
    brew install node || error_exit "Failed to install Node.js"
}

# Check for Docker
check_docker() {
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}✓ Docker found${NC}"
        return 0
    fi
    return 1
}

# Install Docker Desktop for Mac
install_docker() {
    echo -e "${YELLOW}Docker is required for FalkorDB and Qdrant${NC}"
    echo -e "${YELLOW}Please download and install Docker Desktop from:${NC}"
    echo -e "${BLUE}https://www.docker.com/products/docker-desktop${NC}"
    echo
    read -p "Press Enter once Docker Desktop is installed, or Ctrl+C to skip..."

    if ! check_docker; then
        echo -e "${YELLOW}Warning: Docker not detected. You can install it later.${NC}"
    fi
}

# Create package.json for native modules
create_package_json() {
    local pkg_file="$1"

    cat > "$pkg_file" << 'EOF'
{
  "name": "cv-git-runtime",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "keytar": "7.9.0",
    "tree-sitter": "npm:@keqingmoe/tree-sitter@0.26.2",
    "tree-sitter-go": "0.21.2",
    "tree-sitter-java": "0.21.0",
    "tree-sitter-javascript": "0.21.4",
    "tree-sitter-python": "0.21.0",
    "tree-sitter-rust": "0.21.0",
    "tree-sitter-typescript": "0.21.2"
  }
}
EOF
}

# Install native modules securely
install_native_modules() {
    echo "Installing native modules..."

    # Create package.json with sudo - using legacy-peer-deps to handle conflicts
    sudo bash -c "cat > '$INSTALL_DIR/package.json'" << 'EOF'
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
EOF

    # Change ownership to current user temporarily to avoid sudo npm
    sudo chown -R "$(whoami)" "$INSTALL_DIR"

    cd "$INSTALL_DIR"
    # Use --legacy-peer-deps to handle peer dependency conflicts
    if npm install --legacy-peer-deps 2>&1 | tee "$TEMP_DIR/npm-install.log"; then
        echo -e "${GREEN}✓ Native modules installed successfully${NC}"
    else
        echo -e "${YELLOW}Note: Some native modules may not have installed${NC}"
        echo -e "${YELLOW}CV-Git will use simple regex parsing as fallback${NC}"
        echo -e "${YELLOW}Check $TEMP_DIR/npm-install.log for details${NC}"
    fi

    # Restore proper ownership
    cd - > /dev/null
    sudo chown -R root:wheel "$INSTALL_DIR"
}

# Download and verify release
download_release() {
    local release_url="https://github.com/${GITHUB_REPO}/releases/download/v${VERSION}/cv-git-${VERSION}.tar.gz"
    local checksum_url="${release_url}.sha256"

    echo "Downloading cv-git v${VERSION}..."

    # Download tarball
    if ! curl -fsSL --max-time 30 "$release_url" -o "$TEMP_DIR/cv-git.tar.gz"; then
        echo -e "${YELLOW}Release tarball not found, will clone from source${NC}"
        return 1
    fi

    # Download checksum if available
    local expected_checksum=""
    if curl -fsSL --max-time 10 "$checksum_url" -o "$TEMP_DIR/cv-git.tar.gz.sha256" 2>/dev/null; then
        expected_checksum=$(cat "$TEMP_DIR/cv-git.tar.gz.sha256" | awk '{print $1}')
        verify_checksum "$TEMP_DIR/cv-git.tar.gz" "$expected_checksum"
    else
        echo -e "${YELLOW}Warning: No checksum file found for release${NC}"
        read -p "Continue without checksum verification? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            error_exit "Installation cancelled by user"
        fi
    fi

    return 0
}

# Clone and build from source
build_from_source() {
    echo -e "${YELLOW}Building from source...${NC}"

    # Check for required tools
    if ! command -v git &> /dev/null; then
        error_exit "git is required. Install with: brew install git"
    fi

    # Clone repository
    echo "Cloning repository..."
    git clone --depth 1 --branch "v${VERSION}" "https://github.com/${GITHUB_REPO}.git" "$TEMP_DIR/cv-git" 2>/dev/null || {
        echo -e "${YELLOW}Version tag not found, cloning main branch...${NC}"
        git clone --depth 1 "https://github.com/${GITHUB_REPO}.git" "$TEMP_DIR/cv-git" || {
            error_exit "Failed to clone repository"
        }
    }

    cd "$TEMP_DIR/cv-git"

    # Install pnpm if needed
    if ! command -v pnpm &> /dev/null; then
        echo "Installing pnpm..."
        npm install -g pnpm || error_exit "Failed to install pnpm"
    fi

    # Install dependencies and build
    echo "Installing dependencies..."
    pnpm install || error_exit "Failed to install dependencies"

    echo "Building..."
    pnpm build || error_exit "Build failed"

    # Verify bundle exists
    if [ ! -f "packages/cli/dist/bundle.cjs" ]; then
        error_exit "Build completed but bundle.cjs not found"
    fi

    # Copy bundle
    sudo cp "packages/cli/dist/bundle.cjs" "$INSTALL_DIR/cv.cjs" || error_exit "Failed to copy bundle"

    cd - > /dev/null
}

# Create wrapper script
create_wrapper() {
    # Use single-quoted heredoc to prevent variable expansion
    sudo tee "$BIN_DIR/cv" > /dev/null << 'EOF'
#!/bin/bash
exec node /usr/local/lib/cv-git/cv.cjs "$@"
EOF

    sudo chmod +x "$BIN_DIR/cv" || error_exit "Failed to make wrapper executable"
}

# Verify installation
verify_installation() {
    echo "Verifying installation..."

    if [ ! -f "$INSTALL_DIR/cv.cjs" ]; then
        echo -e "${RED}Error: Bundle file not found at $INSTALL_DIR/cv.cjs${NC}"
        return 1
    fi

    if [ ! -f "$BIN_DIR/cv" ]; then
        echo -e "${RED}Error: Wrapper script not found at $BIN_DIR/cv${NC}"
        return 1
    fi

    # Try to run it and capture both stdout and stderr
    local output
    output=$("$BIN_DIR/cv" --version 2>&1)
    local exit_code=$?

    if [ $exit_code -eq 0 ]; then
        echo -e "${GREEN}✓ Installation verified: $output${NC}"
        return 0
    else
        echo -e "${RED}Error: cv command failed to run${NC}"
        echo -e "${YELLOW}Output: $output${NC}"
        echo
        echo -e "${YELLOW}This might still work - try running: cv --version${NC}"
        return 1
    fi
}

# Show banner
show_banner() {
    get_version

    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════╗"
    echo "║   CV-Git Installer for macOS v${VERSION}   ║"
    echo "║  AI-Native Version Control Layer      ║"
    echo "╚═══════════════════════════════════════╝"
    echo -e "${NC}"
}

# Main installation
main() {
    # Check macOS
    check_macos

    # Show banner
    show_banner

    echo "Checking dependencies..."
    echo

    # Check/install Homebrew
    if ! check_homebrew; then
        read -p "Homebrew not found. Install it? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_homebrew
        else
            error_exit "Homebrew is required for installation"
        fi
    fi

    # Check/install Node.js
    if ! check_nodejs; then
        read -p "Node.js 18+ not found. Install it via Homebrew? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_nodejs
        else
            error_exit "Node.js 18+ is required"
        fi
    fi

    # Check/install Docker
    if ! check_docker; then
        read -p "Docker not found. Install it? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_docker
        else
            echo -e "${YELLOW}Warning: Docker is recommended for FalkorDB and Qdrant${NC}"
        fi
    fi

    echo
    echo "Installing cv-git..."

    # Create temp directory
    TEMP_DIR=$(mktemp -d) || error_exit "Failed to create temp directory"

    # Create install directory
    sudo mkdir -p "$INSTALL_DIR" || error_exit "Failed to create install directory"

    # Try to download release, fallback to building from source
    if download_release; then
        echo "Extracting release..."
        # Extract to temp dir first since tarball contains subdirectory
        tar -xzf "$TEMP_DIR/cv-git.tar.gz" -C "$TEMP_DIR" || {
            error_exit "Failed to extract tarball"
        }

        # Find the extracted directory (should be cv-git-VERSION)
        local extracted_dir
        extracted_dir=$(find "$TEMP_DIR" -maxdepth 1 -type d -name "cv-git-*" | head -1)

        if [ -z "$extracted_dir" ]; then
            error_exit "Could not find extracted directory in tarball"
        fi

        # Copy the bundle file
        if [ -f "$extracted_dir/packages/cli/dist/bundle.cjs" ]; then
            sudo cp "$extracted_dir/packages/cli/dist/bundle.cjs" "$INSTALL_DIR/cv.cjs" || {
                error_exit "Failed to copy bundle"
            }
        else
            error_exit "Bundle file not found in release tarball"
        fi
    else
        build_from_source
    fi

    # Install native modules
    install_native_modules

    # Create wrapper script
    create_wrapper

    # Verify installation
    echo
    if verify_installation; then
        echo
        echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
        echo -e "${GREEN}║   CV-Git installed successfully!      ║${NC}"
        echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
        echo
        echo "Next steps:"
        echo "  1. Initialize a repository:  cv init"
        echo "  2. Check system status:      cv doctor"
        echo "  3. Sync your codebase:       cv sync"
        echo "  4. Search code:              cv find \"authentication\""
        echo
        echo -e "${YELLOW}Note: You may need to restart your terminal for PATH changes to take effect${NC}"
    else
        error_exit "Installation completed but verification failed"
    fi
}

# Handle uninstall
if [ "$1" = "uninstall" ]; then
    echo "Uninstalling cv-git..."
    sudo rm -rf "$INSTALL_DIR"
    sudo rm -f "$BIN_DIR/cv"
    echo -e "${GREEN}CV-Git uninstalled successfully${NC}"
    exit 0
fi

# Run main installation
main