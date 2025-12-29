#!/bin/bash

# SSRS Reports Viewer - Ubuntu 24 Server Installer
# https://github.com/ruolez/ssrs-reports

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
APP_NAME="ssrs-reports"
GITHUB_REPO="https://github.com/ruolez/ssrs-reports.git"
INSTALL_DIR="/opt/ssrs-reports"
DEFAULT_PORT=5557

# Print banner
print_banner() {
    echo -e "${BLUE}"
    echo "╔═══════════════════════════════════════════════════════════╗"
    echo "║           SSRS Reports Viewer - Installer                 ║"
    echo "║     Microsoft RDL Report Viewer for Web Browsers          ║"
    echo "╚═══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Print colored messages
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        print_error "Please run as root (sudo)"
        exit 1
    fi
}

# Check Ubuntu version
check_ubuntu() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        if [ "$ID" != "ubuntu" ]; then
            print_warning "This script is designed for Ubuntu. Detected: $ID"
            read -p "Continue anyway? (y/n): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi
    fi
}

# Install Docker if not present
install_docker() {
    if command -v docker &> /dev/null; then
        print_info "Docker is already installed"
        return
    fi

    print_info "Installing Docker..."

    # Remove old versions
    apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

    # Install prerequisites
    apt-get update
    apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release

    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    # Set up repository
    echo \
        "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
        tee /etc/apt/sources.list.d/docker.list > /dev/null

    # Install Docker
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    # Start and enable Docker
    systemctl start docker
    systemctl enable docker

    print_success "Docker installed successfully"
}

# Get server IP address
get_ip_address() {
    # Try to get the main IP address
    IP=$(hostname -I | awk '{print $1}')
    if [ -z "$IP" ]; then
        IP="localhost"
    fi
    echo "$IP"
}

# Clean install
clean_install() {
    print_info "Starting clean installation..."

    # Check if already installed
    if [ -d "$INSTALL_DIR" ]; then
        print_warning "Installation directory already exists: $INSTALL_DIR"
        read -p "Remove existing installation and continue? (y/n): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            complete_removal
        else
            print_info "Installation cancelled"
            return
        fi
    fi

    # Install Docker
    install_docker

    # Clone repository
    print_info "Cloning repository..."
    git clone "$GITHUB_REPO" "$INSTALL_DIR"
    cd "$INSTALL_DIR"

    # Create data directories
    mkdir -p data/reports

    # Ask for port
    read -p "Enter port number (default: $DEFAULT_PORT): " PORT
    PORT=${PORT:-$DEFAULT_PORT}

    # Update port in docker-compose.yml if different from default
    if [ "$PORT" != "5557" ]; then
        sed -i "s/5557:5000/$PORT:5000/g" docker-compose.yml
    fi

    # Build and start containers
    print_info "Building and starting containers..."
    docker compose up -d --build

    # Wait for containers to be healthy with retries
    print_info "Waiting for containers to be ready..."
    MAX_RETRIES=30
    RETRY_COUNT=0

    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/health" 2>/dev/null | grep -q "200"; then
            break
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        sleep 2
    done

    # Check if running
    if curl -s "http://localhost:$PORT/health" 2>/dev/null | grep -q "healthy"; then
        IP=$(get_ip_address)
        echo
        print_success "Installation complete!"
        echo
        echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
        echo -e "${GREEN}  SSRS Reports Viewer is now running!${NC}"
        echo -e "${GREEN}  Access the application at: http://${IP}:${PORT}${NC}"
        echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
        echo
        echo "Next steps:"
        echo "  1. Open the web interface"
        echo "  2. Go to Data Sources and add your SQL Server connection"
        echo "  3. Copy your RDL files to: $INSTALL_DIR/data/reports/"
        echo "  4. Click 'Scan Reports' to discover your reports"
        echo
    else
        print_error "Installation failed. Check logs with: docker compose logs"
        exit 1
    fi
}

# Update from GitHub
update_install() {
    print_info "Starting update..."

    if [ ! -d "$INSTALL_DIR" ]; then
        print_error "Installation not found at $INSTALL_DIR"
        print_info "Please run a clean install first"
        return
    fi

    cd "$INSTALL_DIR"

    # Check for local changes
    if [ -n "$(git status --porcelain)" ]; then
        print_warning "Local changes detected"
        read -p "Discard local changes and update? (y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_info "Update cancelled"
            return
        fi
        git reset --hard HEAD
        git clean -fd
    fi

    # Pull latest changes
    print_info "Pulling latest changes from GitHub..."
    git fetch origin
    git pull origin main

    # Stop containers
    print_info "Stopping containers..."
    docker compose down

    # Rebuild and start (keeping volumes)
    print_info "Rebuilding containers..."
    docker compose up -d --build

    # Clean up unused Docker images
    print_info "Cleaning up unused Docker images..."
    docker image prune -f

    # Also clean up dangling images
    docker images -q --filter "dangling=true" | xargs -r docker rmi 2>/dev/null || true

    # Wait for containers to be ready with retries
    print_info "Waiting for containers to be ready..."
    PORT=$(grep -oP '\d+(?=:5000)' docker-compose.yml 2>/dev/null || echo "5557")
    MAX_RETRIES=30
    RETRY_COUNT=0

    while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
        if curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/health" 2>/dev/null | grep -q "200"; then
            break
        fi
        RETRY_COUNT=$((RETRY_COUNT + 1))
        sleep 2
    done

    # Check if running
    if curl -s "http://localhost:$PORT/health" 2>/dev/null | grep -q "healthy"; then
        IP=$(get_ip_address)
        echo
        print_success "Update complete!"
        echo -e "${GREEN}Application running at: http://${IP}:${PORT}${NC}"
        echo
        print_info "Your data and settings have been preserved"
    else
        print_error "Update failed. Check logs with: docker compose logs"
        exit 1
    fi
}

# Complete removal
complete_removal() {
    print_warning "This will completely remove SSRS Reports Viewer"
    print_warning "All data, settings, and Docker volumes will be deleted!"
    echo
    read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

    if [ "$CONFIRM" != "yes" ]; then
        print_info "Removal cancelled"
        return
    fi

    if [ -d "$INSTALL_DIR" ]; then
        cd "$INSTALL_DIR"

        # Stop and remove containers, networks, and volumes
        print_info "Stopping and removing containers..."
        docker compose down -v --remove-orphans 2>/dev/null || true

        # Remove Docker images
        print_info "Removing Docker images..."
        docker images --filter "reference=*ssrs*" -q | xargs -r docker rmi -f 2>/dev/null || true
        docker images --filter "reference=*reports*" -q | xargs -r docker rmi -f 2>/dev/null || true

        cd /

        # Remove installation directory
        print_info "Removing installation directory..."
        rm -rf "$INSTALL_DIR"

        # Clean up unused Docker resources
        print_info "Cleaning up Docker resources..."
        docker system prune -f 2>/dev/null || true

        print_success "SSRS Reports Viewer has been completely removed"
    else
        print_warning "Installation directory not found: $INSTALL_DIR"
        print_info "Nothing to remove"
    fi
}

# Show status
show_status() {
    if [ ! -d "$INSTALL_DIR" ]; then
        print_warning "SSRS Reports Viewer is not installed"
        return
    fi

    cd "$INSTALL_DIR"

    echo
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  SSRS Reports Viewer - Status${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo

    echo "Installation directory: $INSTALL_DIR"
    echo "Git branch: $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'N/A')"
    echo "Last commit: $(git log -1 --format='%h %s' 2>/dev/null || echo 'N/A')"
    echo

    echo "Container status:"
    docker compose ps
    echo

    # Check health
    PORT=$(grep -oP '\d+(?=:5000)' docker-compose.yml 2>/dev/null || echo "5557")
    if curl -s "http://localhost:$PORT/health" | grep -q "healthy"; then
        IP=$(get_ip_address)
        echo -e "${GREEN}Health check: PASSED${NC}"
        echo -e "Access URL: http://${IP}:${PORT}"
    else
        echo -e "${RED}Health check: FAILED${NC}"
    fi
    echo
}

# View logs
view_logs() {
    if [ ! -d "$INSTALL_DIR" ]; then
        print_warning "SSRS Reports Viewer is not installed"
        return
    fi

    cd "$INSTALL_DIR"
    docker compose logs -f --tail=100
}

# Main menu
show_menu() {
    echo
    echo "Please select an option:"
    echo
    echo "  1) Clean Install     - Fresh installation on this server"
    echo "  2) Update            - Update from GitHub (preserves data)"
    echo "  3) Remove            - Complete removal of application"
    echo "  4) Status            - Show installation status"
    echo "  5) View Logs         - View container logs"
    echo "  6) Exit"
    echo
}

# Main function
main() {
    print_banner
    check_root
    check_ubuntu

    while true; do
        show_menu
        read -p "Enter your choice [1-6]: " choice
        echo

        case $choice in
            1)
                clean_install
                ;;
            2)
                update_install
                ;;
            3)
                complete_removal
                ;;
            4)
                show_status
                ;;
            5)
                view_logs
                ;;
            6)
                print_info "Goodbye!"
                exit 0
                ;;
            *)
                print_error "Invalid option. Please try again."
                ;;
        esac
    done
}

# Run main function
main "$@"
