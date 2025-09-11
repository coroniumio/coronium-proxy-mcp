# Coronium Mobile Proxy MCP Server

[![MCP](https://img.shields.io/badge/MCP-1.0-blue)](https://modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Coronium.io](https://img.shields.io/badge/Coronium.io-Mobile%20Proxies-orange)](https://coronium.io)
[![Dashboard](https://img.shields.io/badge/Dashboard-Manage%20Proxies-green)](https://dashboard.coronium.io)

MCP server for [Coronium.io](https://coronium.io) mobile proxy management. Control 4G/5G proxies directly from Claude, Cursor, Cline, VS Code and other MCP-compatible tools. Manage your proxies via [Coronium Dashboard](https://dashboard.coronium.io).

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

## Usage

Simply ask your AI:
- "Show my Coronium proxies"
- "Check my crypto balance"
- "List my saved cards"

The AI will authenticate automatically on first use.

## Table of Contents

- [Features](#features)
- [Available Commands](#available-commands)
- [Environment Variables](#environment-variables)
- [API Documentation](#api-documentation)
- [Security](#security)
- [Development](#development)
- [Support](#support)

## Features

- 🔐 Secure token storage (AES-256-CBC)
- 📱 [Mobile proxy](https://coronium.io) management
- 💰 Crypto balance tracking
- 💳 Payment method management  
- 🔄 Auto-authentication with [Coronium API](https://dashboard.coronium.io)
- 🌍 Access proxies from [Dashboard](https://dashboard.coronium.io)

## Available Commands

| Command | Description |
|---------|-------------|
| `coronium_get_token` | Authenticate (auto-runs when needed) |
| `coronium_get_proxies` | List all proxies with connection strings |
| `coronium_get_crypto_balance` | Show BTC/USDT balances |
| `coronium_get_credit_cards` | Show saved payment methods |
| `coronium_check_token` | Verify authentication status |

## Environment Variables

Create `.env` file:

```env
# Required
CORONIUM_LOGIN=your-email@example.com
CORONIUM_PASSWORD=your-password

# Optional
TOKEN_ENCRYPTION_KEY=your-32-byte-hex-key  # Generate: openssl rand -hex 32
LOG_LEVEL=info  # debug, info, warn, error
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

### Proxy Output Example

```
🔌 Found 4 Proxy Connection(s):

Proxy 1: dongle600_nl
├─ Connection IP: 138.68.86.247
├─ HTTP Port: 8600
├─ Username: admin
├─ Password: ********
├─ Status: 🟢 Online

HTTP: http://admin:password@138.68.86.247:8600
SOCKS5: socks5://admin:password@138.68.86.247:5600
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

## Support

- **Issues**: [GitHub Issues](https://github.com/coroniumio/coronium-proxy-mcp/issues)
- **Email**: hello@coronium.io
- **Main Site**: [Coronium.io](https://coronium.io) - Mobile Proxy Marketplace
- **Dashboard**: [dashboard.coronium.io](https://dashboard.coronium.io) - Manage Your Proxies
- **Buy Proxies**: [Purchase Guide](https://www.coronium.io/buy-mobile-proxies)

## License

MIT License - see [LICENSE](LICENSE) file