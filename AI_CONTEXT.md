# 🤖 AI Assistant Context for Coronium MCP

## Critical Authentication Flow ⚠️

**IMPORTANT:** Coronium tools require authentication. The token is stored locally and reused, but you MUST ensure authentication before other operations.

### Authentication State Machine:

```
┌─────────────┐  coronium_get_token   ┌─────────────┐
│   No Auth   │ ────────────────────> │Authenticated│
│   (START)   │                       │  (READY)    │
└─────────────┘                       └─────────────┘
      ↑                                      │
      │          Token Expired/Invalid       │
      └──────────────────────────────────────┘
```

### Smart Response Patterns:

1. **User asks for proxies/balance/cards WITHOUT prior auth:**
   ```
   ❌ DON'T: "Fetching your proxies..." [fails with no token]
   ✅ DO: "I'll authenticate first, then get your proxies..."
   ```

2. **User is troubleshooting:**
   ```
   First run coronium_check_token to diagnose
   If false → run coronium_get_token
   If true → proceed with requested operation
   ```

3. **Batch operations (OPTIMAL):**
   ```
   // Run these in sequence, not parallel
   1. coronium_get_token (if needed)
   2. coronium_get_proxies
   3. coronium_get_crypto_balance  
   4. coronium_get_credit_cards
   ```

## Tool Intelligence Matrix

| Tool | Prerequisites | Auto-Recovery | Cache Duration |
|------|--------------|---------------|----------------|
| `coronium_get_token` | ENV vars set | N/A | 30 days |
| `coronium_check_token` | None | Suggests get_token | Instant |
| `coronium_get_proxies` | Valid token | Tell user to auth | Per request |
| `coronium_get_crypto_balance` | Valid token | Tell user to auth | Saves addresses |
| `coronium_get_credit_cards` | Valid token | Tell user to auth | Per request |

## Intelligent Response Templates

### First-Time User
```yaml
trigger: "show me my proxies" (no prior auth in conversation)
response: |
  I'll help you access your Coronium proxies. Let me authenticate first, 
  then fetch your proxy list.
  [Run coronium_get_token]
  [Run coronium_get_proxies]
```

### Returning User (Token Exists)
```yaml
trigger: "list my proxies"
response: |
  [Run coronium_get_proxies directly]
  If error → "Your session expired, let me re-authenticate"
  [Run coronium_get_token then retry]
```

### Debug Mode
```yaml
trigger: "my proxies aren't working"
response: |
  Let me check your authentication status first.
  [Run coronium_check_token]
  Based on result, either:
  - Re-authenticate if needed
  - Or proceed to test proxy connectivity
```

## Code Generation Context

When generating code examples, ALWAYS include authentication:

### Python Example Template
```python
# ALWAYS include this auth check in generated code
import requests
import json
import os

# Load stored token (if exists)
token_path = os.path.expanduser("~/.coronium/auth.json")
if os.path.exists(token_path):
    with open(token_path, 'r') as f:
        auth_data = json.load(f)
        token = auth_data.get('token')
else:
    print("Please authenticate first using the MCP server")
    # Include instructions to auth via MCP
```

### Error Handling Pattern
```python
try:
    # Attempt operation
    response = api_call_with_token()
except AuthenticationError:
    # Guide user to re-authenticate
    print("Token expired. Please run: coronium_get_token")
```

## Natural Language Understanding

### Intent Mapping
- "show proxies" → CHECK AUTH → coronium_get_proxies
- "what's my balance" → CHECK AUTH → coronium_get_crypto_balance  
- "list cards" → CHECK AUTH → coronium_get_credit_cards
- "authenticate" → coronium_get_token (always)
- "is my token valid" → coronium_check_token

### Multi-Step Requests
User: "Set up everything for web scraping"
1. coronium_get_token (ensure auth)
2. coronium_get_proxies (get proxy list)
3. Generate code with proxy from step 2
4. Include rotation logic if multiple proxies

## State Awareness Rules

1. **Token Persistence**: Token stored at `~/.coronium/auth.json` (encrypted)
2. **Token Lifetime**: 30 days from authentication
3. **Graceful Degradation**: If any operation fails with 401, immediately suggest re-authentication
4. **Proactive Checks**: For complex workflows, run coronium_check_token first

## Optimization Strategies

### DO ✅
- Cache proxy list in conversation for re-use
- Authenticate once at conversation start
- Batch related requests after auth
- Provide connection strings ready for copy-paste

### DON'T ❌
- Call get_token repeatedly if already authenticated
- Fetch proxies multiple times in same conversation
- Assume token is valid without checking after errors
- Show raw API responses without formatting

## Example Conversation Flows

### Optimal Flow
```
User: "I need to scrape data with proxies"
AI: "I'll set up your Coronium proxies for web scraping. Let me authenticate and get your proxy list."
[coronium_get_token] ✅
[coronium_get_proxies] ✅
AI: "You have 4 proxies available. Here's a Python script using your Netherlands proxy..."
[Generates code with actual proxy credentials]
```

### Recovery Flow
```
User: "List my proxies"
[coronium_get_proxies] ❌ No token
AI: "I need to authenticate first. Let me do that now."
[coronium_get_token] ✅
[coronium_get_proxies] ✅
AI: "Here are your 4 mobile proxies..."
```

### Diagnostic Flow
```
User: "Something's wrong with my setup"
AI: "Let me diagnose your Coronium connection."
[coronium_check_token] 
If false: "Token expired, re-authenticating..." → [coronium_get_token]
If true: "Authentication valid, checking proxies..." → [coronium_get_proxies]
```

## Quick Reference Card

```javascript
// Decision tree for any Coronium request
if (user_wants_any_coronium_data) {
  if (!confirmed_authenticated_this_session) {
    if (user_explicitly_said_authenticated) {
      try_operation()
    } else {
      authenticate_first()
    }
  }
  perform_requested_operation()
  handle_errors_gracefully()
}
```

## Remember

🔐 **Authentication is NOT automatic** - The MCP server does not auto-authenticate when calling other tools. You must explicitly ensure authentication before operations that require it.

💡 **Be Proactive** - Don't wait for errors. If unsure about auth status, check or authenticate preemptively.

🎯 **User Experience** - Make it seamless. Handle auth behind the scenes with clear communication about what you're doing.

---

*This context helps AI assistants properly orchestrate Coronium MCP tools for the best user experience.*