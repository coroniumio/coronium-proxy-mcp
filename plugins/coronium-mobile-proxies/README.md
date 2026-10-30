# Coronium Mobile Proxies

Manage the dedicated mobile proxies you rent from [Coronium.io](https://www.coronium.io) from Claude Code, claude.ai and Cowork. Each Coronium proxy runs on a real 4G/5G SIM device on a mobile carrier network. With this plugin, Claude can list your proxies, check their health, run a connectivity test, rotate the IP, show connection details for your tools, compare plans and renewal quotes, and open or follow support tickets.

This plugin cannot make purchases. Buying, renewing, topping up and cancelling happen in the dashboard at https://dashboard.coronium.io.

Spending is off by default in the Coronium MCP server as well. If you want an agent to buy, run the server yourself (outside this plugin) with `CORONIUM_TOOL_PROFILE=buyer` and `CORONIUM_ENABLE_SPENDING=1`. In that profile a purchase needs the exact expected total, an explicit confirmation and an idempotency key, and the server enforces a maximum total. See the [server README](https://github.com/coroniumio/coronium-proxy-mcp#connect).

## Requirements

- A Coronium account with at least one proxy.
- Claude Code, claude.ai, the Claude desktop app or Cowork. Nothing is installed on your computer and there is no token to copy: you sign in with your Coronium account in the browser.

## Setup in Claude Code

1. Install the plugin from Coronium's marketplace:
   ```
   /plugin marketplace add coroniumio/coronium-proxy-mcp
   /plugin install coronium-mobile-proxies@coronium
   ```
   For local testing, run `claude --plugin-dir ./plugins/coronium-mobile-proxies` from a clone of this repository.
2. Run `/mcp`, select `plugin:coronium-mobile-proxies:coronium` and choose Authenticate.
3. Your browser opens a Coronium page. If you are already signed in to https://dashboard.coronium.io in that browser, you only check the app name and the permissions it asks for, and approve. Otherwise sign in first.
4. Back in Claude Code, `/mcp` shows the server as connected. Ask "Which of my Coronium proxies are unhealthy right now?" to try it.

## Use it in claude.ai and Cowork

1. Open the plugin's Connectors tab and connect Coronium. Without the plugin, add a custom connector with the URL `https://api.coronium.io/mcp`.
2. Approve the Coronium sign-in page in the same way.

To see or disconnect AI apps, open https://dashboard.coronium.io/api/v1/oauth/connections while signed in. Disconnecting stops that app at once. The hosted directory address never buys, renews, tops up or cancels, whatever you approve.

Prefer a local server with an API token instead of the browser sign-in? Run the npm package yourself, as shown in the [server README](https://github.com/coroniumio/coronium-proxy-mcp#connect).

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

The plugin declares one MCP server, `coronium`: the hosted Coronium server at `https://api.coronium.io/mcp`, reached over HTTPS with the sign-in you approve on the Coronium page. Source code: https://github.com/coroniumio/coronium-proxy-mcp.

It runs the `directory` profile. In this profile it has no tools that buy, renew, top up, cancel or refund, and no login tool. No tool asks for your Coronium account password or API token in the chat.

## What it will not do

- It will not buy, renew, top up, cancel or refund anything. Claude can show plans, prices and renewal quotes, and then points you to https://dashboard.coronium.io to pay.
- It will not rotate, restart or change a proxy without asking you first. These actions interrupt live connections, so Claude explains the impact and waits for an explicit yes.
- It will not retry a change automatically. If a rotation is still in progress, Claude checks its status instead of starting another one.

## Data handling

- Claude connects only to `https://api.coronium.io/mcp`, operated by Coronium. The address is fixed in the plugin configuration.
- With your approval it reads your Coronium account details, balance, owned proxies and their connection credentials, plans and prices, and your support tickets. It sends only what you ask for, such as a rotation request or the text of a ticket.
- Nothing is stored by the plugin. Claude Code keeps the sign-in tokens in your system's secure credential store.
- The hosted server keeps no copy of your data. Coronium stores only a record of each connected AI app (its name and address, the permissions you approved and when it was last used) and hashes of its sign-in tokens, never the tokens themselves. Access tokens last one hour and are renewed by your AI app until you disconnect it. Request logs hold the tool name and argument names, never their values, credentials or ticket text.
- There is no analytics or telemetry.
- Proxy credentials are secrets. Claude shows them to you and does not write them to files unless you ask.
- Coronium's privacy policy: https://www.coronium.io/privacy-policy

## Acceptable use

Coronium proxies are for lawful purposes, such as app and website QA, ad verification, localisation testing and monitoring public information. You must follow Coronium's Terms (https://www.coronium.io/terms-and-conditions), Anthropic's Usage Policy, and the terms of every site or service you reach through a proxy. Do not use this plugin or Coronium proxies for fraud, spam, creating fake or bulk accounts, account abuse, evading bans or rate limits, bypassing any platform's security, bot-detection controls or terms, or accessing systems without authorisation. Coronium suspends accounts that break these rules.

## Troubleshooting

- `/mcp` shows "needs authentication": select the server and choose Authenticate to open the Coronium sign-in page.
- It asks you to sign in again: the connection was disconnected in the dashboard or has not been used for 30 days. Authenticate again from `/mcp` or the Connectors tab.
- The browser page says you are not signed in: sign in at https://dashboard.coronium.io in that browser, then retry Authenticate.
- A rotation says it is still running: ask Claude to check the rotation status in a minute. Do not start another rotation in the meantime.
- A rotation is refused with a wait time: the proxy has a cooldown between rotations. Try again after the time shown.

## Support

Email hello@coronium.io for help with your account or proxies, and for security reports about this plugin or the Coronium API.

## License

MIT. See [LICENSE](LICENSE).
