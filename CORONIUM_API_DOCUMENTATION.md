# Coronium.io API Documentation

## Base URL
```
https://api.coronium.io/v1
```

## Authentication

All authenticated endpoints require an `auth_token` parameter passed as a query parameter.

---

## Endpoints

### Authentication Endpoints

#### 1. Sign Up New User
```http
POST /signup
```

Creates a new user account on the Coronium platform.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "securePassword123",
  "name": "John Doe"  // Optional
}
```

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "user_id": "user_id_here"
}
```

---

#### 2. Get Authentication Token
```http
POST /get-token
```

Authenticates a user and returns an access token valid for 30 days.

**Request Body:**
```json
{
  "login": "user@example.com",
  "password": "yourPassword"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9..."
}
```

**Error Response (401):**
```json
{
  "error": "Invalid credentials"
}
```

---

#### 3. Check Token Validity
```http
POST /check-token
```

Verifies if the provided authentication token is still valid.

**Request Body:**
```json
{
  "token": "eyJhbGciOiJIUzUxMiIsInR5cCI6IkpXVCJ9..."
}
```

**Response:**
```json
{
  "valid": true,
  "expires_at": "2025-12-14T10:30:00Z"
}
```

---

### Account Management Endpoints

#### 4. Get User Proxies (Servers)
```http
GET /account/proxies
```

Retrieves the list of mobile proxy servers associated with the user's account.

**Query Parameters:**
- `auth_token` (required): Authentication token

**Request Example:**
```
GET /account/proxies?auth_token=eyJhbGciOiJIUzUxMiIs...
```

**Response:**
```json
{
  "data": [
    {
      "_id": "67e7fa6332501826402869ac",
      "name": "cor_UA_5f6e24c946e34469127e586aac6cee46",
      "ip_address": "176.97.62.93",
      "ext_ip": "5.248.176.4",
      "http_port": "8017",
      "socks_port": "5017",
      "proxy_login": "admin",
      "proxy_password": "6wW4R1Y5B8xK",
      "isOnline": true,
      "white_list": [],
      "carrier_id": "661cc45c315231989c85a2be",
      "region_id": "661cc443315231989c845555",
      "country_id": "661588c6855e2f7287acb30c",
      "tariff_id": "661cc5e1315231989c9a73ac",
      "rotation_interval": 0,
      "rotated_at": 1756723138300,
      "restartByToken": "https://mreset.xyz/restart-modem/a380e8ed11a59d687a1749b25b4672e9",
      "statusByToken": "https://mreset.xyz/get-modem-status/a380e8ed11a59d687a1749b25b4672e9",
      "restartToken": "a380e8ed11a59d687a1749b25b4672e9"
    }
  ]
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Unique proxy identifier |
| `name` | string | Proxy name (format: cor_COUNTRY_hash) |
| `ip_address` | string | Connection IP/hostname for the proxy |
| `ext_ip` | string | External/public IP address |
| `http_port` | string | Port for HTTP proxy connections |
| `socks_port` | string | Port for SOCKS5 proxy connections |
| `proxy_login` | string | Username for proxy authentication |
| `proxy_password` | string | Password for proxy authentication |
| `isOnline` | boolean | Current online status |
| `white_list` | array | List of whitelisted IPs (if any) |
| `carrier_id` | string | Mobile carrier identifier |
| `region_id` | string | Geographic region identifier |
| `country_id` | string | Country identifier |
| `tariff_id` | string | Pricing plan identifier |
| `rotation_interval` | number | Auto-rotation interval in minutes (0 = manual) |
| `rotated_at` | number | Unix timestamp of last rotation |
| `restartByToken` | string | URL to restart/rotate the proxy using token |
| `statusByToken` | string | URL to check proxy status using token |
| `restartToken` | string | Token for proxy rotation API calls |

**Connection Strings:**
- HTTP: `http://[proxy_login]:[proxy_password]@[ip_address]:[http_port]`
- SOCKS5: `socks5://[proxy_login]:[proxy_password]@[ip_address]:[socks_port]`

**Example:**
- HTTP: `http://admin:6wW4R1Y5B8xK@176.97.62.93:8017`
- SOCKS5: `socks5://admin:6wW4R1Y5B8xK@176.97.62.93:5017`

---

#### 5. Get Cryptocurrency Balance
```http
GET /account/crypto-balance
```

Retrieves cryptocurrency balances and deposit addresses for the user's account.

**Query Parameters:**
- `auth_token` (required): Authentication token

**Request Example:**
```
GET /account/crypto-balance?auth_token=eyJhbGciOiJIUzUxMiIs...
```

**Response:**
```json
[
  {
    "coin": "btc",
    "balance": 0,
    "address": "bc1qg2uyraxtvd06pm9gv68xwqffhpku3g28m305m6"
  },
  {
    "coin": "usdt",
    "balance": 10,
    "address": "TG7t1JgGhU8J1LGasqcWbN1pfRr7oxc4Lg"
  }
]
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `coin` | string | Cryptocurrency type (btc, eth, usdt, usdc) |
| `balance` | number | Current balance |
| `address` | string | Deposit address for this cryptocurrency |

---

#### 6. Get Saved Credit Cards
```http
GET /account/card-list
```

Retrieves the list of saved payment methods (credit/debit cards) on the account.

**Query Parameters:**
- `auth_token` (required): Authentication token

**Request Example:**
```
GET /account/card-list?auth_token=eyJhbGciOiJIUzUxMiIs...
```

**Response:**
```json
{
  "data": [
    {
      "_id": "card_id_here",
      "brand": "visa",
      "last4": "4242",
      "exp_month": 12,
      "exp_year": 2025,
      "country": "US",
      "funding": "credit",
      "is_default": true
    }
  ]
}
```

**Field Descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | Unique card identifier |
| `brand` | string | Card brand (visa, mastercard, etc.) |
| `last4` | string | Last 4 digits of card number |
| `exp_month` | number | Expiration month (1-12) |
| `exp_year` | number | Expiration year |
| `country` | string | Card issuing country |
| `funding` | string | Card type (credit or debit) |
| `is_default` | boolean | Whether this is the default payment method |

---

## Proxy Rotation API

### Using Rotation Tokens

Each proxy includes a `restartToken` that can be used to rotate the proxy's IP address programmatically.

#### Rotate Proxy IP
```http
GET https://mreset.xyz/restart-modem/{restartToken}
```

**Example:**
```
GET https://mreset.xyz/restart-modem/a380e8ed11a59d687a1749b25b4672e9
```

**Response:**
```json
{
  "success": true,
  "message": "Modem restart initiated",
  "new_ip": "5.248.176.5"
}
```

#### Check Proxy Status
```http
GET https://mreset.xyz/get-modem-status/{restartToken}
```

**Example:**
```
GET https://mreset.xyz/get-modem-status/a380e8ed11a59d687a1749b25b4672e9
```

**Response:**
```json
{
  "online": true,
  "current_ip": "5.248.176.4",
  "uptime": 3600,
  "last_rotation": "2025-11-14T10:30:00Z"
}
```

---

## Error Codes

| HTTP Status | Description |
|-------------|-------------|
| 200 | Success |
| 400 | Bad Request - Invalid parameters |
| 401 | Unauthorized - Invalid or expired token |
| 403 | Forbidden - Access denied |
| 404 | Not Found - Resource doesn't exist |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |

**Standard Error Response:**
```json
{
  "error": "Error message description",
  "code": "ERROR_CODE",
  "details": {}
}
```

---

## Rate Limiting

The API implements rate limiting to prevent abuse:
- **Authentication endpoints**: 5 requests per minute
- **Account endpoints**: 60 requests per minute
- **Proxy rotation**: 1 request per proxy per minute

When rate limited, you'll receive a 429 status code with headers:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1699962000
```

---

## Code Examples

### Python Example
```python
import requests

# Authenticate
auth_response = requests.post('https://api.coronium.io/v1/get-token', json={
    'login': 'user@example.com',
    'password': 'password123'
})
token = auth_response.json()['token']

# Get proxies
proxies_response = requests.get('https://api.coronium.io/v1/account/proxies', params={
    'auth_token': token
})
proxies = proxies_response.json()['data']

# Use first proxy
if proxies:
    proxy = proxies[0]
    proxy_url = f"http://{proxy['proxy_login']}:{proxy['proxy_password']}@{proxy['ip_address']}:{proxy['http_port']}"

    # Make request through proxy
    response = requests.get('https://api.ipify.org?format=json', proxies={
        'http': proxy_url,
        'https': proxy_url
    })
    print(f"Current IP: {response.json()['ip']}")

    # Rotate proxy IP
    rotation_response = requests.get(proxy['restartByToken'])
    print(f"Rotation result: {rotation_response.json()}")
```

### Node.js Example
```javascript
import axios from 'axios';

// Authenticate
const authResponse = await axios.post('https://api.coronium.io/v1/get-token', {
  login: 'user@example.com',
  password: 'password123'
});
const token = authResponse.data.token;

// Get proxies
const proxiesResponse = await axios.get('https://api.coronium.io/v1/account/proxies', {
  params: { auth_token: token }
});
const proxies = proxiesResponse.data.data;

// Use first proxy
if (proxies.length > 0) {
  const proxy = proxies[0];
  const proxyUrl = `http://${proxy.proxy_login}:${proxy.proxy_password}@${proxy.ip_address}:${proxy.http_port}`;

  // Configure axios with proxy
  const proxyConfig = {
    proxy: {
      protocol: 'http',
      host: proxy.ip_address,
      port: parseInt(proxy.http_port),
      auth: {
        username: proxy.proxy_login,
        password: proxy.proxy_password
      }
    }
  };

  // Make request through proxy
  const response = await axios.get('https://api.ipify.org?format=json', proxyConfig);
  console.log(`Current IP: ${response.data.ip}`);

  // Rotate proxy IP
  const rotationResponse = await axios.get(proxy.restartByToken);
  console.log('Rotation result:', rotationResponse.data);
}
```

### cURL Examples
```bash
# Authenticate
curl -X POST https://api.coronium.io/v1/get-token \
  -H "Content-Type: application/json" \
  -d '{"login":"user@example.com","password":"password123"}'

# Get proxies (replace TOKEN with actual token)
curl "https://api.coronium.io/v1/account/proxies?auth_token=TOKEN"

# Use proxy for request
curl -x http://admin:6wW4R1Y5B8xK@176.97.62.93:8017 https://api.ipify.org

# Rotate proxy IP
curl https://mreset.xyz/restart-modem/a380e8ed11a59d687a1749b25b4672e9
```

---

## Security Best Practices

1. **Token Storage**: Store authentication tokens securely, never in plain text
2. **HTTPS Only**: Always use HTTPS for API requests
3. **Token Rotation**: Regularly refresh authentication tokens
4. **IP Whitelisting**: Use the `white_list` feature for additional security
5. **Environment Variables**: Store credentials in environment variables, not in code
6. **Rate Limit Handling**: Implement exponential backoff for rate-limited requests
7. **Error Handling**: Never expose tokens or passwords in error messages or logs

---

## Webhook Support

Coronium supports webhooks for real-time notifications about proxy status changes.

### Webhook Events
- `proxy.online` - Proxy came online
- `proxy.offline` - Proxy went offline
- `proxy.rotated` - Proxy IP was rotated
- `balance.low` - Account balance is low
- `payment.success` - Payment processed successfully
- `payment.failed` - Payment failed

### Webhook Configuration
Configure webhooks through the Coronium dashboard or API (endpoint documentation pending).

---

## Support

- **Email**: support@coronium.io
- **Dashboard**: https://coronium.io/dashboard
- **Status Page**: https://status.coronium.io

---

## Changelog

### Version 1.0 (Current)
- Initial API release
- Authentication endpoints
- Proxy management
- Cryptocurrency balance tracking
- Credit card management
- Rotation token support

---

## Notes

1. All timestamps are in Unix milliseconds format
2. Proxy passwords are randomly generated and unique per proxy
3. Rotation tokens are permanent unless manually regenerated
4. The `rotation_interval` field:
   - `0` = Manual rotation only
   - `> 0` = Auto-rotation interval in minutes
5. External IPs (`ext_ip`) represent the actual outgoing IP address
6. Connection IPs (`ip_address`) can be either IP addresses or hostnames