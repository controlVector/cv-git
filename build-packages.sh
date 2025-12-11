#!/bin/bash
# Build distribution packages for cv-git
# Usage: ./build-packages.sh [snap|deb|all]

set -e

VERSION=$(grep '"version"' package.json | head -1 | sed 's/.*: "\(.*\)".*/\1/')
BUILD_DIR="dist/packages"

echo "Building cv-git v${VERSION} packages..."
echo

mkdir -p "$BUILD_DIR"

build_snap() {
    echo "=== Building Snap Package ==="

    if ! command -v snapcraft &> /dev/null; then
        echo "Installing snapcraft..."
        sudo snap install snapcraft --classic
    fi

    # Build snap
    snapcraft

    # Move to dist
    mv cv-git_*.snap "$BUILD_DIR/" 2>/dev/null || true

    echo "Snap package built: $BUILD_DIR/cv-git_${VERSION}_amd64.snap"
    echo
    echo "To test locally:"
    echo "  sudo snap install $BUILD_DIR/cv-git_${VERSION}_amd64.snap --dangerous --classic"
    echo
    echo "To publish to Snap Store:"
    echo "  snapcraft login"
    echo "  snapcraft upload --release=stable $BUILD_DIR/cv-git_${VERSION}_amd64.snap"
    echo
}

build_deb() {
    echo "=== Building Debian Package ==="

    # Install build dependencies
    if ! command -v dpkg-buildpackage &> /dev/null; then
        echo "Installing build dependencies..."
        sudo apt-get update
        sudo apt-get install -y build-essential devscripts debhelper
    fi

    # Build package
    dpkg-buildpackage -us -uc -b

    # Move to dist
    mv ../cv-git_*.deb "$BUILD_DIR/" 2>/dev/null || true
    mv ../cv-git_*.buildinfo "$BUILD_DIR/" 2>/dev/null || true
    mv ../cv-git_*.changes "$BUILD_DIR/" 2>/dev/null || true

    echo "Debian package built: $BUILD_DIR/cv-git_${VERSION}-1_amd64.deb"
    echo
    echo "To install locally:"
    echo "  sudo dpkg -i $BUILD_DIR/cv-git_${VERSION}-1_amd64.deb"
    echo "  sudo apt-get install -f  # Fix dependencies if needed"
    echo
}

build_tarball() {
    echo "=== Building Release Tarball ==="

    # Ensure built
    pnpm build

    # Create tarball
    TARBALL="$BUILD_DIR/cv-git-${VERSION}.tar.gz"

    tar -czf "$TARBALL" \
        --transform "s|^|cv-git-${VERSION}/|" \
        packages/cli/dist/bundle.cjs \
        install.sh \
        README.md \
        LICENSE

    echo "Tarball built: $TARBALL"
    echo
}

case "${1:-all}" in
    snap)
        build_snap
        ;;
    deb)
        build_deb
        ;;
    tarball)
        build_tarball
        ;;
    all)
        build_tarball
        echo
        build_snap
        echo
        build_deb
        ;;
    *)
        echo "Usage: $0 [snap|deb|tarball|all]"
        exit 1
        ;;
esac

echo
echo "=== Build Complete ==="
ls -la "$BUILD_DIR/"
