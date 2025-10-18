#!/bin/bash
# s-nomp complete installation script
# Handles dependency checking, npm installation, native module building, and patching

echo "========================================="
echo "s-nomp Installation Script"
echo "========================================="
echo ""

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo "❌ Error: Must be run from s-nomp root directory"
    echo ""
    echo "   Navigate to the s-nomp directory and run:"
    echo "   cd s-nomp"
    echo "   bash scripts/install.sh"
    exit 1
fi

echo "Checking system dependencies..."
echo "--------------------------------"
MISSING_CRITICAL=0
MISSING_OPTIONAL=0

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found"
    echo "   Install with:"
    echo "   sudo apt-get update"
    echo "   sudo apt-get install npm"
    echo "   sudo npm install -g n"
    echo "   sudo n stable"
    echo ""
    MISSING_CRITICAL=1
else
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 20 ]; then
        echo "❌ Node.js $(node -v) is too old (need 20.x or higher)"
        echo "   Upgrade with:"
        echo "   sudo npm install -g n"
        echo "   sudo n stable"
        echo ""
        MISSING_CRITICAL=1
    else
        echo "✓ Node.js $(node -v)"
    fi
fi

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm not found"
    echo "   Install with:"
    echo "   sudo apt-get install npm"
    echo ""
    MISSING_CRITICAL=1
else
    echo "✓ npm $(npm -v)"
fi

# Check Redis
if ! command -v redis-cli &> /dev/null; then
    echo "❌ Redis not found"
    echo "   Install with:"
    echo "   sudo apt-get install redis-server"
    echo "   sudo systemctl enable redis-server"
    echo "   sudo systemctl start redis-server"
    echo ""
    MISSING_CRITICAL=1
else
    if redis-cli ping &> /dev/null 2>&1; then
        echo "✓ Redis is running"
    else
        echo "❌ Redis is installed but not running"
        echo "   Start with:"
        echo "   sudo systemctl start redis-server"
        echo ""
        MISSING_CRITICAL=1
    fi
fi

# Check build tools
if ! command -v gcc &> /dev/null; then
    echo "❌ gcc not found"
    echo "   Install with:"
    echo "   sudo apt-get install build-essential"
    echo ""
    MISSING_CRITICAL=1
else
    echo "✓ gcc $(gcc --version | head -n1 | awk '{print $NF}')"
fi

if ! command -v make &> /dev/null; then
    echo "❌ make not found"
    echo "   Install with:"
    echo "   sudo apt-get install build-essential"
    echo ""
    MISSING_CRITICAL=1
else
    echo "✓ make"
fi

if ! command -v g++ &> /dev/null; then
    echo "❌ g++ not found"
    echo "   Install with:"
    echo "   sudo apt-get install build-essential"
    echo ""
    MISSING_CRITICAL=1
else
    echo "✓ g++"
fi

# Check Python (required by node-gyp)
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 not found (required by node-gyp)"
    echo "   Install with:"
    echo "   sudo apt-get install python3"
    echo ""
    MISSING_CRITICAL=1
else
    echo "✓ Python $(python3 --version | awk '{print $2}')"
fi

# Check optional libraries
if ! dpkg -l 2>/dev/null | grep -q libsodium-dev; then
    echo "⚠ libsodium-dev not found (optional but recommended)"
    echo "   Install with:"
    echo "   sudo apt-get install libsodium-dev"
    echo ""
    MISSING_OPTIONAL=1
else
    echo "✓ libsodium-dev"
fi

if ! dpkg -l 2>/dev/null | grep -q libboost-all-dev; then
    echo "⚠ libboost-all-dev not found (optional but recommended)"
    echo "   Install with:"
    echo "   sudo apt-get install libboost-all-dev"
    echo ""
    MISSING_OPTIONAL=1
else
    echo "✓ libboost-all-dev"
fi

# Check PM2
if ! command -v pm2 &> /dev/null; then
    echo "⚠ PM2 not found (optional but recommended for production)"
    echo "   Install with:"
    echo "   sudo npm install -g pm2"
    echo ""
    MISSING_OPTIONAL=1
else
    echo "✓ PM2 $(pm2 -v)"
fi

# Summary
if [ $MISSING_CRITICAL -eq 1 ]; then
    echo "========================================"
    echo "❌ MISSING REQUIRED DEPENDENCIES"
    echo "========================================"
    echo ""
    echo "Please install the missing dependencies above and run this script again."
    echo ""
    echo "Quick install command for all dependencies:"
    echo ""
    echo "sudo apt-get update && sudo apt-get install -y build-essential libsodium-dev libboost-all-dev redis-server npm python3"
    echo "sudo npm install -g n pm2"
    echo "sudo n stable"
    echo "sudo systemctl enable redis-server"
    echo "sudo systemctl start redis-server"
    echo ""
    exit 1
fi

if [ $MISSING_OPTIONAL -eq 1 ]; then
    echo "========================================"
    echo "⚠  OPTIONAL DEPENDENCIES MISSING"
    echo "========================================"
    echo ""
    echo "Some optional dependencies are missing. The pool may work but could have issues."
    echo "It's recommended to install them with:"
    echo ""
    echo "sudo apt-get install libsodium-dev libboost-all-dev"
    echo "sudo npm install -g pm2"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Installation cancelled."
        exit 1
    fi
fi

echo ""
echo "✓ All required dependencies are installed"
echo ""

# Install npm dependencies
echo "Step 1: Installing npm dependencies..."
echo "---------------------------------------"

echo "Running npm install (skipping build scripts)..."
npm install --legacy-peer-deps --ignore-scripts

echo "✓ npm dependencies installed"
echo ""

# Build native modules
echo "Step 2: Building native modules..."
echo "-----------------------------------"

if [ -d "node_modules/equihashverify" ]; then
    echo "Building equihashverify..."
    cd node_modules/equihashverify
    ../../node_modules/.bin/node-gyp rebuild
    cd ../..
    echo "✓ equihashverify built successfully"
else
    echo "❌ equihashverify not found in node_modules"
    exit 1
fi

if [ -d "node_modules/bignum" ]; then
    echo "Building bignum..."
    cd node_modules/bignum
    ../../node_modules/.bin/node-gyp rebuild
    cd ../..
    echo "✓ bignum built successfully"
else
    echo "❌ bignum not found in node_modules"
    exit 1
fi

echo ""

# Patch jobManager.js
echo "Step 3: Patching jobManager.js..."
echo "----------------------------------"

JOBMANAGER="node_modules/stratum-pool/lib/jobManager.js"

if [ ! -f "$JOBMANAGER" ]; then
    echo "❌ $JOBMANAGER not found"
    exit 1
fi

# Check if already patched
if grep -q "lazy load verushash" "$JOBMANAGER"; then
    echo "✓ jobManager.js already patched"
else
    echo "Patching jobManager.js to make verushash optional..."

    # Create backup
    cp "$JOBMANAGER" "$JOBMANAGER.backup"

    # Patch line 9: require('verushash') -> null with comment
    sed -i "s/var vh = require('verushash');/var vh = null; \/\/ lazy load verushash only when needed/" "$JOBMANAGER"

    # Patch the verushash case to add lazy loading
    # Find the line with "headerHash = vh.hash(headerSolnBuffer);" and add the if statement before it
    sed -i "/case 'verushash':/,/break;/ {
        /headerHash = vh\.hash(headerSolnBuffer);/ {
            i\                if (!vh) vh = require('verushash'); // lazy load only when needed
        }
    }" "$JOBMANAGER"

    # Verify patch was applied
    if grep -q "lazy load verushash" "$JOBMANAGER"; then
        echo "✓ jobManager.js patched successfully (backup saved as $JOBMANAGER.backup)"
    else
        echo "❌ Failed to patch jobManager.js"
        mv "$JOBMANAGER.backup" "$JOBMANAGER"
        exit 1
    fi
fi

echo ""

# Check PM2
echo "Step 4: Checking PM2..."
echo "-----------------------"
if command -v pm2 &> /dev/null; then
    echo "✓ PM2 is installed (version $(pm2 -v))"
else
    echo "⚠ PM2 not found (recommended for production)"
    echo "   Install with: sudo npm install pm2 -g"
fi

echo ""
echo "========================================="
echo "✓ Installation Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Configure the pool:"
echo "   cp config_example.json config.json"
echo "   # Edit config.json with your Redis settings"
echo ""
echo "2. Configure your coin:"
echo "   # Create pool_configs/yourcoin.json"
echo "   # See examples in pool_configs/ directory"
echo "   # Configure: address, daemon settings, ports, etc."
echo ""
echo "3. Start your coin daemon:"
echo "   # Make sure your coin daemon is running and synced"
echo "   # Example: zerod -daemon"
echo ""
echo "4. Start the pool:"
echo "   pm2 start ecosystem.config.js"
echo "   pm2 save"
echo "   pm2 logs s-nomp"
echo ""
echo "   Or for development/testing:"
echo "   npm start"
echo ""
