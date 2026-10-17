---
name: connect-my-proxy
description: Use when the user wants to connect to one of their Coronium mobile proxies, asks for its host, port, username, password, HTTP or SOCKS5 URL, wants it set up in curl, Python, Node.js, a browser or an app, or needs its OpenVPN configuration or rotation link.
---

# Connect my proxy

Help the user use one Coronium proxy in the tool they choose. Only use the Coronium tools this plugin provides.

## 1. Pick the proxy

If the user named a proxy (by name, ID or country), use it. Otherwise call `coronium_get_proxies` and ask which one, listing only name, country and online state.

## 2. Read the connection details

Call `coronium_get_proxy` for that proxy. Use the HTTP and SOCKS5 URLs it returns. If both exist, prefer what the user's tool supports; HTTP is the safer default.

Treat the result as secrets:
- Show credentials only in your reply to the user.
- Do not write them to a file, commit them, or paste them into a command that runs, unless the user asks you to.
- When writing code or config, read the URL from an environment variable such as `PROXY_URL` and tell the user to set it themselves.
- The rotation token or link in the result changes the proxy's IP when opened. Share it only if the user asks for it, and say what it does.

## 3. Show how to use it

Give the snippet for the tool the user named, with placeholders where the real values go, for example:

- curl: `curl -x "$PROXY_URL" <the URL the user wants to load>`
- Python requests: `proxies = {"http": os.environ["PROXY_URL"], "https": os.environ["PROXY_URL"]}`
- Node.js: use `undici`'s `ProxyAgent` with `process.env.PROXY_URL`
- Browser or operating system: host, port, username and password fields, and which protocol to pick

For SOCKS5 in curl, use `socks5h://` so DNS also goes through the proxy.

## 4. Check it works

Offer `coronium_test_modem` to confirm the proxy answers from Coronium's side. Report the result as returned. Do not run network commands through the proxy on the user's behalf unless they ask.

## 5. OpenVPN

Only when the user asks for OpenVPN and the proxy's capabilities show it is supported:
1. Tell the user that the file contains secrets and that on some proxies each download issues a new certificate. Ask before downloading.
2. Call `coronium_get_openvpn_config`.
3. Save it to a file only if the user asks, at the path they choose, and remind them not to share it.

## Limits

This plugin cannot change what the user pays for. Buying, renewing or cancelling a proxy happens at https://dashboard.coronium.io. To get a fresh IP, use the `check-my-proxies` skill, which asks before rotating.
