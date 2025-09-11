# Coronium MCP Server - Quick Start Guide

## What This Does
This MCP server connects your AI assistant to Coronium's mobile proxy service, allowing you to:
- Authenticate and manage your Coronium account
- Get mobile proxy connection details
- Check crypto balances and payment methods
- All through simple AI commands

## Prerequisites
Before starting, ensure you have:
1. Coronium account credentials (email/password)
2. MCP server running (`npm start`)
3. Environment variables set:
```bash
CORONIUM_EMAIL=your-email@example.com
CORONIUM_PASSWORD=your-password
```

## Essential Commands

### 🔐 ALWAYS START HERE (First Time Users)
```
Authenticate with Coronium and show me my proxies
```
This ensures authentication happens first, then shows your proxies.

### For Returning Users (If Already Authenticated)
```
Show me my Coronium proxies
```
If this fails with "No token", just ask to authenticate first.

### Check Account Balance
```
Check my Coronium crypto balance
```

### View Payment Methods  
```
Show my saved credit cards
```

## Real-World Usage Examples

### For Web Scraping
```
I need proxy connection strings for web scraping. Show me my Netherlands proxies with HTTP format.
```

### For Python Requests
```
Give me a Python example using my Coronium proxy with the requests library
```
The AI will provide code like:
```python
import requests

proxy = {
    'http': 'http://admin:password@138.68.86.247:8600',
    'https': 'http://admin:password@138.68.86.247:8600'
}

response = requests.get('https://api.ipify.org?format=json', proxies=proxy)
print(response.json())
```

### For Playwright/Puppeteer
```
Set up my US proxy for Playwright browser automation
```

### For Node.js/Axios
```
Configure axios to use my Coronium proxy
```

## Common Tasks

### View All Proxies with Status
```
List all my proxies and show which ones are online
```

### Get Specific Region Proxies
```
Show me only the US proxies
```

### Export Proxy List
```
Export all my proxy details to a CSV file
```

### Check Authentication Status
```
Is my Coronium authentication still valid?
```

## Troubleshooting

### If Authentication Fails
```
Clear the stored token and re-authenticate with Coronium
```

### If Proxies Aren't Working
```
Test connectivity to my proxies and show me which ones are online
```

### Debug Mode (If Needed)
```
Run the MCP server with debug logging: LOG_LEVEL=debug node dist/server.js
```

## Important Notes

1. **Authentication is automatic** - The server stores your token securely after first login
2. **All proxies support both HTTP and SOCKS5** - Use the appropriate port for each
3. **Proxies are persistent** - Same IP until you manually rotate
4. **Token expires after 30 days** - Re-authenticate when needed

## Quick Copy-Paste Commands

**Get everything at once:**
```
1. Authenticate with Coronium
2. Show all my proxies with connection strings
3. Check my account balance
4. Give me a Python script to test the first proxy
```

**Just need a working proxy:**
```
Give me a working HTTP proxy connection string from Coronium
```

**Monitor proxy status:**
```
Which of my Coronium proxies are currently online?
```

## For Developers

The MCP server provides these tools:
- `coronium_get_token` - Authenticate
- `coronium_check_token` - Verify authentication
- `coronium_get_proxies` - List all proxies
- `coronium_get_crypto_balance` - Check balances
- `coronium_get_credit_cards` - View payment methods

Your AI assistant will handle these automatically based on your natural language requests.

## Tips for Best Results

1. **Be direct** - "Show me my proxies" works better than complex explanations
2. **Ask for code examples** - The AI can generate working code for any language
3. **Request specific formats** - "Give me curl commands" or "Format as JSON"
4. **Chain commands** - You can ask for multiple things in one request

## Getting Help

If something isn't working:
1. Check the server is running: `npm start`
2. Verify environment variables are set
3. Try re-authenticating: "Re-authenticate with Coronium"
4. Check server logs for errors

---

Start with: **"Show me my Coronium proxies"** and go from there!