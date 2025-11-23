# Coronium Mobile Proxy MCP Server

[![MCP](https://img.shields.io/badge/MCP-1.0-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Coronium.io](https://img.shields.io/badge/Coronium.io-Mobile%20Proxies-orange)](https://coronium.io)
[![Dashboard](https://img.shields.io/badge/Dashboard-Manage%20Proxies-green)](https://dashboard.coronium.io)
[![Version](https://img.shields.io/badge/Version-1.1.2-success)](https://github.com/coroniumio/coronium-proxy-mcp/releases)

MCP (Model Context Protocol) server for [Coronium.io](https://coronium.io) mobile proxy management. Control 4G/5G mobile proxies directly from Claude, Cursor, Cline, VS Code and other MCP-compatible AI tools. Manage your proxies via [Coronium Dashboard](https://dashboard.coronium.io).

## Prerequisites

- [Coronium.io Account](https://coronium.io) - Sign up for mobile proxies
- [Buy Mobile Proxies](https://www.coronium.io/buy-mobile-proxies) - Purchase guide
- Node.js 18+ installed

## Quick Start

### 1. Install

```bash
git clone https://github.com/coroniumio/coronium-proxy-mcp.git
cd coronium-proxy-mcp
npm install
npm run build
```

### 2. Configure Your AI Tool

#### Option A: Claude Desktop

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`  
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "coronium": {
      "command": "node",
      "args": ["/path/to/coronium-proxy-mcp/dist/server.js"],
      "env": {
        "CORONIUM_LOGIN": "your-email@example.com",
        "CORONIUM_PASSWORD": "your-password"
      }
    }
  }
}
```

#### Option B: Cursor IDE

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "coronium": {
      "command": "node",
      "args": ["/path/to/coronium-proxy-mcp/dist/server.js"],
      "env": {
        "CORONIUM_LOGIN": "your-email@example.com",
        "CORONIUM_PASSWORD": "your-password"
      }
    }
  }
}
```

#### Option C: Cline (VS Code Extension)

1. Click MCP Servers icon in Cline panel
2. Click "Configure MCP Servers"
3. Add the configuration above
4. Save - Cline auto-reloads

#### Option D: VS Code with Copilot

VS Code 1.102+ has built-in MCP support. Add to your VS Code settings or project config.

**Fully MCP-Compatible Tools:**
- ✅ [Claude Desktop](https://claude.ai) - Native support
- ✅ [Cursor IDE](https://cursor.sh) - Full MCP support with one-click setup
- ✅ [Cline](https://github.com/clinebot/cline) - VS Code extension with MCP
- ✅ [VS Code](https://code.visualstudio.com) - v1.102+ with Copilot
- ✅ [Zed](https://zed.dev) - Native MCP support
- ✅ [Sourcegraph Cody](https://sourcegraph.com/cody) - Full support
- ✅ [Continue](https://continue.dev) - Recent MCP support added

### 3. Restart Your Tool

Restart your AI tool to load the MCP server.

## Usage Examples

Simply ask your AI assistant:

### Authentication
- "Authenticate with Coronium" - Sets up your connection (auto-runs when needed)
- "Check if I'm authenticated" - Verify your authentication status

### Proxy Management
- "Show my Coronium proxies" - List all your mobile proxies with connection details
- "Get my mobile proxies" - Alternative command to list proxies
- "Fetch all MCP proxies from my account" - Detailed proxy information

### IP Rotation (v1.1.0)
- "Rotate my USA proxy" - Rotate specific country proxy (US, UA, etc.)
- "Rotate modem US" - Alternative rotation command
- "Rotate proxy cor_US_41f8d8ff" - Rotate by proxy name or ID
- "Rotate all proxies" - Rotate all proxy IPs simultaneously
- "Rotate the proxy 5f6e24c9" - Rotate by dongle ID (first 8+ chars)

### Account Management
- "Check my crypto balance" - View BTC/USDT balances and deposit addresses
- "List my saved cards" - Show payment methods on file
- "Show my payment methods" - Alternative command for cards

The AI will authenticate automatically on first use.

## Table of Contents

- [Features](#features)
- [Available MCP Tools](#available-mcp-tools)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
- [Security](#security)
- [Development](#development)
- [Changelog](#changelog)
- [Support](#support)

## Features

- 🔐 Secure token storage (AES-256-CBC encryption)
- 📱 [Mobile proxy](https://coronium.io) management for 4G/5G networks
- 🔄 **Proxy IP rotation** - Rotate mobile proxy IPs instantly on demand
- 🎯 Smart proxy selection - By country, name, dongle ID, or rotate all
- 💰 Crypto balance tracking (BTC/USDT with deposit addresses)
- 💳 Payment method management
- 🔄 Auto-authentication with [Coronium API](https://dashboard.coronium.io)
- 🌍 Full access from [Dashboard](https://dashboard.coronium.io)
- 📊 Rotation history tracking with detailed logs
- ⚡ Lightning-fast proxy status verification with fallback methods

## Available MCP Tools

### Core Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `coronium_get_token` | Authenticate with Coronium (auto-runs when needed) | None - uses env vars |
| `coronium_check_token` | Verify authentication status | None |
| `coronium_get_proxies` | List all proxies with connection strings | None |
| `coronium_get_crypto_balance` | Show BTC/USDT balances and deposit addresses | None |
| `coronium_get_credit_cards` | Show saved payment methods | None |

### Rotation Tool (v1.1.0)

| Tool | Description | Parameters |
|------|-------------|------------|
| `coronium_rotate_modem` | Rotate proxy IP addresses | `proxy_identifier`: Name, ID, country code, or "all" |

#### Rotation Examples

```javascript
// Rotate by country
coronium_rotate_modem({ proxy_identifier: "US" })  // Rotates USA proxy
coronium_rotate_modem({ proxy_identifier: "UA" })  // Rotates Ukraine proxy

// Rotate by proxy name
coronium_rotate_modem({ proxy_identifier: "cor_US_41f8d8ff52eecd18ce695f3649156cef" })

// Rotate by dongle ID (partial)
coronium_rotate_modem({ proxy_identifier: "5f6e24c9" })  // First 8+ chars

// Rotate all proxies
coronium_rotate_modem({ proxy_identifier: "all" })
```

## Environment Variables

Create `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Then edit `.env`:

```env
CORONIUM_LOGIN=your-email@example.com
CORONIUM_PASSWORD=your-password
```

## API Documentation

### Authentication Flow

1. First request triggers `coronium_get_token`
2. Token stored encrypted for 30 days
3. Auto-refreshes when expired

### Response Format

```typescript
{
  content: [{
    type: "text",
    text: "Response message"
  }]
}
```

### Tool Response Examples

#### Proxy List Output
```
🔌 Found 2 Proxy Connection(s):

Proxy 1: cor_UA_5f6e24c946e34469127e586aac6cee46
├─ Connection IP: 176.97.62.93
├─ HTTP Port: 8017
├─ SOCKS5 Port: 5017
├─ Username: admin
├─ Password: 6wW4R1Y5B8xK
├─ External IP: 46.211.66.101
├─ Status: 🟢 Online
├─ Last Rotated: 11/14/2025, 11:49:03 PM

Connection Strings:
HTTP: http://admin:6wW4R1Y5B8xK@176.97.62.93:8017
SOCKS5: socks5://admin:6wW4R1Y5B8xK@176.97.62.93:5017
```

#### Rotation Success Output
```
✅ Successfully rotated cor_US_41f8d8ff52eecd18ce695f3649156cef

├─ Old IP: 172.56.171.66
├─ New IP: 45.123.67.89
└─ Rotation time: 13.5s

🌐 Verified new external IP: 45.123.67.89

💡 Tip: Your proxy is now using the new IP address.
```

## Security

- Tokens encrypted with AES-256-CBC
- Credentials never stored in plain text
- Secure storage in `~/.coronium/`
- Environment variable isolation

## Development

```bash
# Run development mode
npm run dev

# Run tests
npm test

# Build for production
npm run build

# Enable debug logging
LOG_LEVEL=debug npm run dev
```

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for detailed version history.

### Latest Updates (v1.1.0)
- ✨ Added IP rotation feature with smart proxy selection
- 🐛 Fixed country code matching bug (US vs UA)
- 📊 Added rotation history tracking
- 🔒 Enhanced security and credential handling
- 📚 Expanded documentation with detailed examples

## Support

- **Issues**: [GitHub Issues](https://github.com/coroniumio/coronium-proxy-mcp/issues)
- **Email**: hello@coronium.io
- **Main Site**: [Coronium.io](https://coronium.io) - Mobile Proxy Marketplace
- **Dashboard**: [dashboard.coronium.io](https://dashboard.coronium.io) - Manage Your Proxies
- **Buy Proxies**: [Purchase Guide](https://www.coronium.io/buy-mobile-proxies)

## License

MIT License - see [LICENSE](LICENSE) file