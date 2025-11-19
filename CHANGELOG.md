# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2025-11-14

### Added
- 🔄 **IP Rotation Feature**: New `coronium_rotate_modem` tool for rotating proxy IPs
  - Rotate by country code (US, UA, etc.)
  - Rotate by proxy name or ID
  - Rotate by dongle ID (partial match supported)
  - Rotate all proxies simultaneously
  - Rotation history tracking in ~/.coronium/rotation_history.json
- 📊 Enhanced proxy status verification with multiple fallback methods
- ⏱️ Improved rotation timing with smart retry logic
- 🔍 Better proxy identification system with exact and partial matching

### Fixed
- 🐛 Fixed critical bug where "US" rotation incorrectly selected Ukraine (UA) proxy
- 🔧 Improved country code matching to ensure exact matches only
- 📝 Enhanced error messages for ambiguous proxy selections

### Changed
- 📚 Expanded README documentation with detailed usage examples
- 🔒 Improved security with better credential handling
- 📦 Updated package.json with correct repository URLs
- 🛠️ Enhanced logging throughout the rotation process

### Security
- Added .env.example for secure configuration
- Removed any hardcoded credentials from source code
- Enhanced .gitignore to prevent credential leaks

## [1.0.0] - 2025-11-10

### Initial Release
- 🔐 Secure authentication with Coronium.io API
- 📡 List all mobile proxies with connection details
- 💰 Check cryptocurrency balances (BTC/USDT)
- 💳 View saved payment methods
- 🔒 AES-256-CBC encryption for token storage
- 📦 Full MCP (Model Context Protocol) compatibility
- 🤖 Support for Claude Desktop, Cursor, Cline, VS Code, and other MCP tools

### Features
- Automatic token management with 30-day persistence
- Detailed proxy information including HTTP/SOCKS5 connection strings
- Crypto deposit addresses for account funding
- Comprehensive error handling and logging
- TypeScript implementation for type safety