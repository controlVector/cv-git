#!/bin/bash
set -e

# CV-Git Mac Installer
# Supports both user-mode and system-mode installation

VERSION="${CV_GIT_VERSION:-latest}"
INSTALL_MODE="${CV_GIT_INSTALL_MODE:-user}"  # 'user' or 'system'

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${BLUE}[STEP]${NC} $1"; }

# Detect if we should use user mode
detect_install_mode() {
  if [[ "$INSTALL_MODE" == "system" ]]; then
    if [[ $EUID -ne 0 ]]; then
      log_error "System install requires root. Run with sudo or use: CV_GIT_INSTALL_MODE=user"
      exit 1
    fi
    return
  fi

  # Default to user mode on Mac
  INSTALL_MODE="user"
  log_info "Installing in user mode (no root required)"
}

# Set paths based on mode
set_paths() {
  if [[ "$INSTALL_MODE" == "user" ]]; then
    BIN_DIR="$HOME/.local/bin"
    DATA_DIR="$HOME/Library/Application Support/cv-git"
    CONFIG_DIR="$HOME/Library/Application Support/cv-git/config"
    CACHE_DIR="$HOME/Library/Caches/cv-git"
    LOG_DIR="$HOME/Library/Logs/cv-git"
    LAUNCH_DIR="$HOME/Library/LaunchAgents"
  else
    BIN_DIR="/usr/local/bin"
    DATA_DIR="/var/lib/cv-git"
    CONFIG_DIR="/etc/cv-git"
    CACHE_DIR="/var/cache/cv-git"
    LOG_DIR="/var/log/cv-git"
    LAUNCH_DIR="/Library/LaunchDaemons"
  fi
}

# Check dependencies
check_dependencies() {
  log_step "Checking dependencies..."

  # Node.js
  if ! command -v node &> /dev/null; then
    log_warn "Node.js not found. Installing via Homebrew..."
    if command -v brew &> /dev/null; then
      brew install node
    else
      log_error "Please install Homebrew first: https://brew.sh"
      log_error "Or install Node.js manually: https://nodejs.org"
      exit 1
    fi
  else
    local node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [[ $node_version -lt 18 ]]; then
      log_warn "Node.js version 18+ recommended. Current: $(node -v)"
    else
      log_info "Node.js $(node -v) found"
    fi
  fi

  # pnpm
  if ! command -v pnpm &> /dev/null; then
    log_info "Installing pnpm..."
    npm install -g pnpm
  else
    log_info "pnpm $(pnpm -v) found"
  fi

  # Git
  if ! command -v git &> /dev/null; then
    log_error "Git is required. Install with: brew install git"
    exit 1
  fi

  # Docker (optional)
  if ! command -v docker &> /dev/null; then
    log_warn "Docker not found. CV-Git will use external database connections."
    log_warn "Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
    log_warn "Or install via Homebrew: brew install --cask docker"
  else
    log_info "Docker found"
  fi
}

# Setup Docker (rootless preferred on Mac)
setup_docker() {
  if ! command -v docker &> /dev/null; then
    log_warn "Skipping Docker setup - not installed"
    return
  fi

  # Docker Desktop on Mac doesn't require root
  # Just verify it's running
  if ! docker info &> /dev/null 2>&1; then
    log_warn "Docker is installed but not running. Please start Docker Desktop."
    log_warn "You can start services later with: cv services start"
    return
  fi

  log_info "Docker is available and running"

  # Create docker-compose override for user mode
  if [[ "$INSTALL_MODE" == "user" ]]; then
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
    log_info "Created Docker Compose override for user-mode volumes"
  fi
}

# Install CV-Git
install_cv_git() {
  log_step "Installing CV-Git..."

  # Create directories
  mkdir -p "$BIN_DIR" "$DATA_DIR" "$CONFIG_DIR" "$CACHE_DIR" "$LOG_DIR"

  # Clone or download
  TEMP_DIR=$(mktemp -d)
  cd "$TEMP_DIR"

  log_info "Cloning CV-Git repository..."
  if [[ "$VERSION" == "latest" ]]; then
    git clone --depth 1 https://github.com/controlVector/cv-git.git
  else
    git clone --depth 1 --branch "$VERSION" https://github.com/controlVector/cv-git.git
  fi

  cd cv-git

  # Install dependencies and build
  log_info "Installing dependencies..."
  pnpm install

  log_info "Building packages..."
  pnpm build

  # Link CLI
  if [[ "$INSTALL_MODE" == "user" ]]; then
    # User-local link
    log_info "Linking CLI to $BIN_DIR..."
    cd packages/cli

    # Create wrapper script instead of npm link
    cat > "$BIN_DIR/cv" << EOF
#!/bin/bash
node "$DATA_DIR/cli/dist/index.js" "\$@"
EOF
    chmod +x "$BIN_DIR/cv"

    # Copy built CLI
    mkdir -p "$DATA_DIR/cli"
    cp -r dist "$DATA_DIR/cli/"
    cp package.json "$DATA_DIR/cli/"

    cd ../..
  else
    # Global link
    cd packages/cli
    npm link
    cd ../..
  fi

  # Copy MCP server
  log_info "Installing MCP server..."
  mkdir -p "$DATA_DIR/mcp-server"
  cp -r packages/mcp-server/dist "$DATA_DIR/mcp-server/"
  cp packages/mcp-server/package.json "$DATA_DIR/mcp-server/"

  # Create config
  create_default_config

  # Cleanup
  cd /
  rm -rf "$TEMP_DIR"

  log_info "CV-Git installed successfully!"
}

# Create default configuration
create_default_config() {
  if [[ ! -f "$CONFIG_DIR/config.json" ]]; then
    log_info "Creating default configuration..."
    cat > "$CONFIG_DIR/config.json" << EOF
{
  "version": "1",
  "privilege": {
    "mode": "$INSTALL_MODE",
    "allowSudo": false,
    "warnOnRoot": true
  },
  "containers": {
    "runtime": "docker",
    "rootless": true
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
  }
}
EOF
  fi
}

# Create LaunchAgent for auto-start (optional)
setup_autostart() {
  local plist_name="com.controlvector.cv-git"
  local plist_file="$LAUNCH_DIR/${plist_name}.plist"

  mkdir -p "$LAUNCH_DIR"

  if [[ "$INSTALL_MODE" == "user" ]]; then
    cat > "$plist_file" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${plist_name}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BIN_DIR}/cv</string>
        <string>services</string>
        <string>start</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>${LOG_DIR}/cv-git.log</string>
    <key>StandardErrorPath</key>
    <string>${LOG_DIR}/cv-git.error.log</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>CV_GIT_CONFIG</key>
        <string>${CONFIG_DIR}/config.json</string>
    </dict>
</dict>
</plist>
EOF

    # Don't auto-load, just inform user
    log_info "LaunchAgent created at $plist_file"
    log_info "To enable auto-start: launchctl load $plist_file"
  fi
}

# Update PATH
update_path() {
  if [[ "$INSTALL_MODE" == "user" ]]; then
    local shell_rc=""

    # Detect shell config file
    if [[ -f "$HOME/.zshrc" ]]; then
      shell_rc="$HOME/.zshrc"
    elif [[ -f "$HOME/.bashrc" ]]; then
      shell_rc="$HOME/.bashrc"
    elif [[ -f "$HOME/.bash_profile" ]]; then
      shell_rc="$HOME/.bash_profile"
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
  fi
}

# Print summary
print_summary() {
  echo ""
  echo "========================================"
  echo "  CV-Git Installation Complete!"
  echo "========================================"
  echo ""
  echo "Install mode: $INSTALL_MODE"
  echo "Binary:       $BIN_DIR/cv"
  echo "Config:       $CONFIG_DIR/config.json"
  echo "Data:         $DATA_DIR"
  echo ""
  echo "Next steps:"
  echo "  1. source ~/.zshrc           # Reload shell config"
  echo "  2. cv doctor                  # Check system status"
  echo "  3. cv services start          # Start FalkorDB & Qdrant"
  echo "  4. cd your-project && cv init # Initialize a project"
  echo "  5. cv sync                    # Sync codebase"
  echo ""

  if [[ "$INSTALL_MODE" == "user" ]]; then
    echo "Note: Running in user mode (no root required)"
    echo ""
    echo "MCP Server for Claude Code:"
    echo "  $DATA_DIR/mcp-server/dist/index.js"
    echo ""
  fi

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
    rm -f "$BIN_DIR/cv"
    log_info "Removed $BIN_DIR/cv"
  fi

  # Remove LaunchAgent
  local plist_file="$LAUNCH_DIR/com.controlvector.cv-git.plist"
  if [[ -f "$plist_file" ]]; then
    launchctl unload "$plist_file" 2>/dev/null || true
    rm -f "$plist_file"
    log_info "Removed LaunchAgent"
  fi

  # Ask about data
  read -p "Remove CV-Git data directory ($DATA_DIR)? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$DATA_DIR"
    log_info "Removed $DATA_DIR"
  fi

  read -p "Remove CV-Git config ($CONFIG_DIR)? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$CONFIG_DIR"
    log_info "Removed $CONFIG_DIR"
  fi

  read -p "Remove CV-Git cache ($CACHE_DIR)? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    rm -rf "$CACHE_DIR"
    log_info "Removed $CACHE_DIR"
  fi

  log_info "CV-Git uninstalled."
}

# Main
main() {
  echo ""
  echo "CV-Git Installer for macOS"
  echo "=========================="
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
  check_dependencies
  setup_docker
  install_cv_git
  setup_autostart
  update_path
  print_summary
}

main "$@"
