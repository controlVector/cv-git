#!/bin/bash
# CV-Git Installer for Linux
# Supports both user-mode and system-mode installation
# Usage: curl -fsSL https://raw.githubusercontent.com/controlVector/cv-git/main/install.sh | bash
#
# Environment variables:
#   CV_GIT_VERSION        - Version to install (default: latest)
#   CV_GIT_INSTALL_MODE   - 'user' or 'system' (default: auto-detect)

set -e

VERSION="${CV_GIT_VERSION:-}"
INSTALL_MODE="${CV_GIT_INSTALL_MODE:-}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

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
        VERSION="0.5.0"
    fi
}

# Detect install mode based on environment
detect_install_mode() {
    if [[ -n "$INSTALL_MODE" ]]; then
        # User specified mode
        if [[ "$INSTALL_MODE" == "system" ]] && [[ $EUID -ne 0 ]]; then
            log_error "System install requires root. Run with sudo or use: CV_GIT_INSTALL_MODE=user"
            exit 1
        fi
        return
    fi

    # Auto-detect based on context
    if [[ $EUID -eq 0 ]]; then
        INSTALL_MODE="system"
        log_info "Running as root - using system mode"
    else
        INSTALL_MODE="user"
        log_info "Installing in user mode (no root required)"
    fi
}

# Set paths based on mode (XDG Base Directory compliant)
set_paths() {
    if [[ "$INSTALL_MODE" == "user" ]]; then
        # User mode - XDG Base Directory spec
        BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
        DATA_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/cv-git"
        CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/cv-git"
        CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/cv-git"
        LOG_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/cv-git/logs"
        INSTALL_DIR="$DATA_DIR/lib"
    else
        # System mode
        BIN_DIR="/usr/local/bin"
        DATA_DIR="/var/lib/cv-git"
        CONFIG_DIR="/etc/cv-git"
        CACHE_DIR="/var/cache/cv-git"
        LOG_DIR="/var/log/cv-git"
        INSTALL_DIR="/usr/local/lib/cv-git"
    fi
}

# Check for Node.js
check_nodejs() {
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge 18 ]; then
            log_info "Node.js $(node -v) found"
            return 0
        fi
    fi
    return 1
}

# Install Node.js if needed
install_nodejs() {
    log_step "Installing Node.js 20.x..."

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
    elif command -v apk &> /dev/null; then
        # Alpine
        sudo apk add nodejs npm
    else
        log_error "Could not install Node.js. Please install Node.js 18+ manually."
        exit 1
    fi
}

# Check for Docker/Podman
check_container_runtime() {
    if command -v docker &> /dev/null; then
        # Check if rootless
        if docker info 2>/dev/null | grep -q "rootless"; then
            log_info "Docker found (rootless)"
            CONTAINER_RUNTIME="docker"
            CONTAINER_ROOTLESS=true
            return 0
        else
            log_info "Docker found"
            CONTAINER_RUNTIME="docker"
            CONTAINER_ROOTLESS=false
            return 0
        fi
    elif command -v podman &> /dev/null; then
        log_info "Podman found (rootless)"
        CONTAINER_RUNTIME="podman"
        CONTAINER_ROOTLESS=true
        return 0
    fi
    CONTAINER_RUNTIME="external"
    CONTAINER_ROOTLESS=true
    return 1
}

# Install Docker if needed
install_docker() {
    log_step "Installing Docker..."

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

        # Add user to docker group (allows rootless-like access)
        if [[ "$INSTALL_MODE" == "user" ]]; then
            sudo usermod -aG docker "$USER"
            log_warn "Log out and back in for Docker group membership to take effect"
        fi
    elif command -v dnf &> /dev/null; then
        # Fedora
        sudo dnf install -y podman podman-compose
        CONTAINER_RUNTIME="podman"
        CONTAINER_ROOTLESS=true
        log_info "Installed Podman (rootless preferred on Fedora)"
    else
        log_warn "Please install Docker/Podman manually"
        log_warn "Docker: https://docs.docker.com/engine/install/"
        log_warn "CV-Git will use external database connections instead"
        CONTAINER_RUNTIME="external"
    fi
}

# Install native modules using npm
install_native_modules() {
    log_step "Installing native modules..."

    # Create a minimal package.json for the native modules
    local pkg_json="$INSTALL_DIR/package.json"

    if [[ "$INSTALL_MODE" == "user" ]]; then
        mkdir -p "$INSTALL_DIR"
        cat > "$pkg_json" << 'PKGJSON'
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
PKGJSON
        cd "$INSTALL_DIR"
        if npm install --production 2>/dev/null; then
            log_info "Native modules installed successfully"
        else
            log_warn "Some native modules may not have installed"
            log_warn "CV-Git will use simple regex parsing as fallback"
        fi
    else
        # System mode - use sudo
        sudo mkdir -p "$INSTALL_DIR"
        sudo tee "$pkg_json" > /dev/null << 'PKGJSON'
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
PKGJSON
        cd "$INSTALL_DIR"
        if sudo npm install --production 2>/dev/null; then
            log_info "Native modules installed successfully"
        else
            log_warn "Some native modules may not have installed"
            log_warn "CV-Git will use simple regex parsing as fallback"
        fi
    fi
}

# Create default global configuration
create_global_config() {
    log_step "Creating global configuration..."

    local config_file="$CONFIG_DIR/config.json"

    if [[ -f "$config_file" ]]; then
        log_info "Configuration already exists at $config_file"
        return
    fi

    if [[ "$INSTALL_MODE" == "user" ]]; then
        mkdir -p "$CONFIG_DIR"
        cat > "$config_file" << EOF
{
  "version": "1",
  "privilege": {
    "mode": "user",
    "allowSudo": false,
    "warnOnRoot": true
  },
  "containers": {
    "runtime": "$CONTAINER_RUNTIME",
    "rootless": $CONTAINER_ROOTLESS
  },
  "databases": {
    "falkordb": {
      "host": "localhost",
      "port": 6379,
      "external": false
    },
    "qdrant": {
      "host": "localhost",
      "port": 6333,
      "external": false
    }
  },
  "credentials": {
    "storage": "file",
    "keyringService": "cv-git"
  },
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  }
}
EOF
    else
        sudo mkdir -p "$CONFIG_DIR"
        sudo tee "$config_file" > /dev/null << EOF
{
  "version": "1",
  "privilege": {
    "mode": "root",
    "allowSudo": true,
    "warnOnRoot": false
  },
  "containers": {
    "runtime": "$CONTAINER_RUNTIME",
    "rootless": $CONTAINER_ROOTLESS
  },
  "databases": {
    "falkordb": {
      "host": "localhost",
      "port": 6379,
      "external": false
    },
    "qdrant": {
      "host": "localhost",
      "port": 6333,
      "external": false
    }
  },
  "credentials": {
    "storage": "keychain",
    "keyringService": "cv-git"
  },
  "ai": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514"
  }
}
EOF
    fi

    log_info "Global configuration created at $config_file"
}

# Create Docker Compose override for user mode volumes
create_docker_compose_override() {
    if [[ "$INSTALL_MODE" != "user" ]] || [[ "$CONTAINER_RUNTIME" == "external" ]]; then
        return
    fi

    mkdir -p "$DATA_DIR"
    cat > "$DATA_DIR/docker-compose.override.yml" << EOF
# CV-Git User Mode Docker Override
version: '3.8'
services:
  falkordb:
    volumes:
      - ${DATA_DIR}/falkordb:/data
  qdrant:
    volumes:
      - ${DATA_DIR}/qdrant:/qdrant/storage
EOF
    log_info "Docker Compose override created for user-mode volumes"
}

# Install CV-Git
install_cv_git() {
    log_step "Installing CV-Git..."

    # Create directories
    if [[ "$INSTALL_MODE" == "user" ]]; then
        mkdir -p "$BIN_DIR" "$DATA_DIR" "$CONFIG_DIR" "$CACHE_DIR" "$LOG_DIR" "$INSTALL_DIR"
    else
        sudo mkdir -p "$BIN_DIR" "$DATA_DIR" "$CONFIG_DIR" "$CACHE_DIR" "$LOG_DIR" "$INSTALL_DIR"
    fi

    # Check for local build first
    if [ -f "packages/cli/dist/bundle.cjs" ]; then
        log_info "Installing from local build..."
        if [[ "$INSTALL_MODE" == "user" ]]; then
            cp packages/cli/dist/bundle.cjs "$INSTALL_DIR/cv.cjs"
        else
            sudo cp packages/cli/dist/bundle.cjs "$INSTALL_DIR/cv.cjs"
        fi
    else
        # Download release or clone
        RELEASE_URL="https://github.com/controlVector/cv-git/releases/download/v${VERSION}/cv-git-${VERSION}.tar.gz"
        log_info "Downloading cv-git v${VERSION}..."

        TEMP_DIR=$(mktemp -d)

        if curl -fsSL "$RELEASE_URL" -o "$TEMP_DIR/cv-git.tar.gz" 2>/dev/null; then
            # Extract release
            if [[ "$INSTALL_MODE" == "user" ]]; then
                tar -xzf "$TEMP_DIR/cv-git.tar.gz" -C "$INSTALL_DIR"
            else
                sudo tar -xzf "$TEMP_DIR/cv-git.tar.gz" -C "$INSTALL_DIR"
            fi
        else
            log_warn "Release not found. Cloning repository..."
            git clone --depth 1 https://github.com/controlVector/cv-git.git "$TEMP_DIR/cv-git"
            cd "$TEMP_DIR/cv-git"

            # Install pnpm if needed
            if ! command -v pnpm &> /dev/null; then
                npm install -g pnpm
            fi

            pnpm install
            pnpm build

            # Rebuild native modules
            log_info "Rebuilding native modules..."
            pnpm rebuild keytar tree-sitter 2>/dev/null || log_warn "Native module rebuild warning (may be OK)"

            # Copy bundle
            if [[ "$INSTALL_MODE" == "user" ]]; then
                cp packages/cli/dist/bundle.cjs "$INSTALL_DIR/cv.cjs"
            else
                sudo cp packages/cli/dist/bundle.cjs "$INSTALL_DIR/cv.cjs"
            fi

            cd - > /dev/null
        fi

        rm -rf "$TEMP_DIR"
    fi

    # Install native modules
    install_native_modules

    # Create wrapper script
    local wrapper_script="$BIN_DIR/cv"
    if [[ "$INSTALL_MODE" == "user" ]]; then
        cat > "$wrapper_script" << WRAPPER
#!/bin/bash
export CV_GIT_CONFIG="${CONFIG_DIR}/config.json"
exec node "${INSTALL_DIR}/cv.cjs" "\$@"
WRAPPER
        chmod +x "$wrapper_script"
    else
        sudo tee "$wrapper_script" > /dev/null << WRAPPER
#!/bin/bash
exec node "${INSTALL_DIR}/cv.cjs" "\$@"
WRAPPER
        sudo chmod +x "$wrapper_script"
    fi

    log_info "CV-Git binary installed at $wrapper_script"
}

# Update PATH for user mode
update_path() {
    if [[ "$INSTALL_MODE" != "user" ]]; then
        return
    fi

    local shell_rc=""

    # Detect shell config file
    if [[ -n "$BASH_VERSION" ]] && [[ -f "$HOME/.bashrc" ]]; then
        shell_rc="$HOME/.bashrc"
    elif [[ -n "$ZSH_VERSION" ]] && [[ -f "$HOME/.zshrc" ]]; then
        shell_rc="$HOME/.zshrc"
    elif [[ -f "$HOME/.profile" ]]; then
        shell_rc="$HOME/.profile"
    fi

    if [[ -n "$shell_rc" ]]; then
        if ! grep -q "\.local/bin" "$shell_rc" 2>/dev/null; then
            echo "" >> "$shell_rc"
            echo "# CV-Git" >> "$shell_rc"
            echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$shell_rc"
            log_info "Added $BIN_DIR to PATH in $shell_rc"
            log_warn "Run 'source $shell_rc' or restart your terminal to update PATH"
        else
            log_info "PATH already includes $BIN_DIR"
        fi
    else
        log_warn "Could not detect shell config file. Add manually:"
        log_warn "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
}

# Print summary
print_summary() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║     CV-Git v${VERSION} Installed!          ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════╝${NC}"
    echo ""
    echo "Install mode:  $INSTALL_MODE"
    echo "Binary:        $BIN_DIR/cv"
    echo "Config:        $CONFIG_DIR/config.json"
    echo "Data:          $DATA_DIR"
    echo "Runtime:       $CONTAINER_RUNTIME (rootless: $CONTAINER_ROOTLESS)"
    echo ""
    echo "Next steps:"
    echo "  1. $([ "$INSTALL_MODE" == "user" ] && echo "source ~/.bashrc           # Reload shell config")"
    echo "  2. cv doctor                  # Check system status"
    echo "  3. cv services start          # Start FalkorDB & Qdrant"
    echo "  4. cd your-project && cv init # Initialize a project"
    echo "  5. cv sync                    # Sync codebase"
    echo ""

    # Check for API keys
    if [[ -z "$ANTHROPIC_API_KEY" ]] && [[ -z "$CV_ANTHROPIC_KEY" ]]; then
        log_warn "No Anthropic API key detected."
        log_warn "Set ANTHROPIC_API_KEY environment variable for AI features."
    fi
}

# Uninstall function
uninstall() {
    log_step "Uninstalling CV-Git..."

    # Remove binary
    if [[ -f "$BIN_DIR/cv" ]]; then
        if [[ "$INSTALL_MODE" == "user" ]]; then
            rm -f "$BIN_DIR/cv"
        else
            sudo rm -f "$BIN_DIR/cv"
        fi
        log_info "Removed $BIN_DIR/cv"
    fi

    # Remove install directory
    if [[ -d "$INSTALL_DIR" ]]; then
        if [[ "$INSTALL_MODE" == "user" ]]; then
            rm -rf "$INSTALL_DIR"
        else
            sudo rm -rf "$INSTALL_DIR"
        fi
        log_info "Removed $INSTALL_DIR"
    fi

    # Ask about data
    read -p "Remove CV-Git data directory ($DATA_DIR)? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [[ "$INSTALL_MODE" == "user" ]]; then
            rm -rf "$DATA_DIR"
        else
            sudo rm -rf "$DATA_DIR"
        fi
        log_info "Removed $DATA_DIR"
    fi

    read -p "Remove CV-Git config ($CONFIG_DIR)? [y/N] " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        if [[ "$INSTALL_MODE" == "user" ]]; then
            rm -rf "$CONFIG_DIR"
        else
            sudo rm -rf "$CONFIG_DIR"
        fi
        log_info "Removed $CONFIG_DIR"
    fi

    log_info "CV-Git uninstalled."
}

# Main installation
main() {
    # Get version
    get_version

    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║        CV-Git Installer v${VERSION}        ║${NC}"
    echo -e "${BLUE}║   AI-Native Version Control Layer     ║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════╝${NC}"
    echo ""

    # Handle uninstall
    if [[ "$1" == "uninstall" ]] || [[ "$1" == "--uninstall" ]]; then
        detect_install_mode
        set_paths
        uninstall
        exit 0
    fi

    detect_install_mode
    set_paths

    log_step "Checking dependencies..."
    echo

    # Check/install Node.js
    if ! check_nodejs; then
        read -p "Node.js 18+ not found. Install it? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_nodejs
        else
            log_error "Node.js 18+ is required. Exiting."
            exit 1
        fi
    fi

    # Check/install container runtime
    if ! check_container_runtime; then
        read -p "Docker/Podman not found. Install Docker? [Y/n] " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
            install_docker
        else
            log_warn "No container runtime. CV-Git will use external databases."
            CONTAINER_RUNTIME="external"
            CONTAINER_ROOTLESS=true
        fi
    fi

    echo
    install_cv_git
    create_global_config
    create_docker_compose_override
    update_path

    # Verify installation
    if "$BIN_DIR/cv" --version &> /dev/null; then
        print_summary
    else
        log_error "Installation failed. Please check the errors above."
        exit 1
    fi
}

main "$@"
