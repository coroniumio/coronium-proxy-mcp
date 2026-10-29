# Coronium Mobile Proxies

Manage the dedicated mobile proxies you rent from [Coronium.io](https://www.coronium.io) without leaving Claude Code. Each Coronium proxy runs on a real 4G/5G SIM device on a mobile carrier network. With this plugin, Claude can list your proxies, check their health, run a connectivity test, rotate the IP, show connection details for your tools, compare plans and renewal quotes, and open or follow support tickets.

This version cannot make purchases. Buying, renewing, topping up and cancelling happen in the dashboard at https://dashboard.coronium.io.

## Requirements

- A Coronium account with at least one proxy, and its dashboard API token.
- Claude Code. The plugin starts a local server, so claude.ai chat and Cowork are not supported yet. This README will be updated when they are.
- Node.js 20 or later, because Claude Code starts the server with `npx`.

## Setup

1. Install the plugin from the Claude plugin directory (`/plugin`, then Discover), or add Coronium's own marketplace and install it from there:
   ```
   /plugin marketplace add coroniumio/coronium-proxy-mcp
   /plugin install coronium-mobile-proxies@coronium
   ```
   For local testing, run `claude --plugin-dir ./plugins/coronium-mobile-proxies` from a clone of this repository.
2. Create your API token in the Coronium dashboard: https://dashboard.coronium.io, then Account -> API Access.
3. When you enable the plugin, Claude Code asks for the token. Paste it into that dialog, never into the chat. Claude Code stores it in your system's secure credential store, marked as sensitive.
4. Run `/mcp` and check that `plugin:coronium-mobile-proxies:coronium` is connected.

Use the dashboard API token, not a login session token. You can revoke it at any time by rotating it in the dashboard, and the plugin stops working until you enter the new one.

Rotation waits for the carrier to hand out a new IP, which can take a minute or more. If Claude Code reports a tool timeout, start it with a longer limit, for example `MCP_TOOL_TIMEOUT=200000 claude`.

## Example prompts

- "Which of my Coronium proxies are unhealthy right now?"
- "Rotate the IP on my US proxy and tell me the new IP."
- "Give me the SOCKS5 connection details for my UK proxy and a curl command to use it."
- "Which countries have 5G plans, and what does 30 days cost in Germany?"
- "Get me a renewal quote for all proxies that expire this week."
- "Open a support ticket: my German proxy has been slow since this morning."

## Skills

- `check-my-proxies` - a health check across your proxies: status, expiry, connectivity test, and a guided rotation when a proxy needs a fresh IP.
- `connect-my-proxy` - finds the right connection details for one proxy and shows how to use them in curl, code, a browser or OpenVPN.

## What it runs

The plugin declares one local MCP server. Claude Code starts it with `npx -y coronium-proxy-mcp@2.2.1`, which downloads that exact, pinned version from the npm registry and runs it on your computer over stdio. Source code: https://github.com/coroniumio/coronium-proxy-mcp.

The server runs in its `directory` profile. In this profile it has no tools that buy, renew, top up, cancel or refund, and no login tool. No tool asks for your Coronium account password or API token in the chat; the token comes only from the plugin setting.

## What it will not do

- It will not buy, renew, top up, cancel or refund anything. Claude can show plans, prices and renewal quotes, and then points you to https://dashboard.coronium.io to pay.
- It will not rotate, restart or change a proxy without asking you first. These actions interrupt live connections, so Claude explains the impact and waits for an explicit yes.
- It will not retry a change automatically. If a rotation is still in progress, Claude checks its status instead of starting another one.

## Data handling

- The server sends requests only to `https://api.coronium.io`, operated by Coronium: the customer API at `/api/v3` with your API token, and the public plan catalogue at `/api/v1/tariffs` without it. The address is fixed in the plugin configuration.
- The only other network traffic is `npx` downloading the pinned package from registry.npmjs.org when the server starts.
- With your token it reads your Coronium account details, balance, owned proxies and their connection credentials, plans and prices, and your support tickets. It sends only what you ask for, such as a rotation request or the text of a ticket.
- Nothing is stored by the plugin. The server keeps data in memory while it runs and writes no files. Your token is held by Claude Code as a sensitive setting, not by the plugin.
- There is no analytics or telemetry.
- Proxy credentials are secrets. Claude shows them to you and does not write them to files unless you ask.
- Coronium's privacy policy: https://www.coronium.io/privacy-policy

## Acceptable use

Coronium proxies are for lawful purposes, such as app and website QA, ad verification, localisation testing and monitoring public information. You must follow Coronium's Terms (https://www.coronium.io/terms-and-conditions), Anthropic's Usage Policy, and the terms of every site or service you reach through a proxy. Do not use this plugin or Coronium proxies for fraud, spam, creating fake or bulk accounts, account abuse, evading bans or rate limits, bypassing any platform's security, bot-detection controls or terms, or accessing systems without authorisation. Coronium suspends accounts that break these rules.

## Troubleshooting

- `401` or "invalid token": the token is wrong, expired or was rotated. Create a new one in the dashboard and update it in the plugin settings.
- The server does not start: the token is not set, or Node.js 20+ is missing. `/mcp` shows the connection state and the error.
- A rotation says it is still running: ask Claude to check the rotation status in a minute. Do not start another rotation in the meantime.
- A rotation is refused with a wait time: the proxy has a cooldown between rotations. Try again after the time shown.

## Support

Email hello@coronium.io for help with your account or proxies, and for security reports about this plugin or the Coronium API.

## License

MIT. See [LICENSE](LICENSE).
