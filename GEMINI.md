# GEMINI.md - Natrium RTC (MiroTalk P2P WebRTC Platform)

Welcome to the **Natrium RTC** workspace. This repository contains the real-time WebRTC audio, video, screen-sharing, and collaboration system powering `natrium.sh`.

---

## 1. Architecture & Dual-Environment Structure

The RTC system is organized into a single parent folder (`/root/projects/rtc/`) containing two completely isolated codebases running side-by-side:

```
/root/projects/rtc/
├── rtc_main/              # PRODUCTION environment (Port 3000 -> https://rtc.natrium.sh)
│   ├── app/src/           # Server-side signaling, REST API, WebSocket handlers
│   ├── public/            # Client frontend assets (HTML, CSS, WebRTC client JS)
│   ├── tests/             # Automated test suite (400 test cases)
│   └── .env               # Production environment configuration (PORT=3000)
│
├── rtc_stage/             # STAGING environment (Port 3001 -> https://stage-rtc.natrium.sh)
│   ├── app/src/           # Server-side signaling
│   ├── public/            # Client frontend assets (with [STAGE] tab title indicator)
│   ├── tests/             # Automated test suite
│   └── .env               # Staging environment configuration (PORT=3001)
│
├── ecosystem.config.cjs   # Unified PM2 process configuration for both environments
└── GEMINI.md              # This engineering manual & AI agent guide
```

### Environment Matrix

| Property | Production (`rtc_main`) | Staging (`rtc_stage`) |
| :--- | :--- | :--- |
| **Public URL** | [https://rtc.natrium.sh](https://rtc.natrium.sh) | [https://stage-rtc.natrium.sh](https://stage-rtc.natrium.sh) |
| **Origin Port** | `3000` | `3001` |
| **Directory** | `/root/projects/rtc/rtc_main` | `/root/projects/rtc/rtc_stage` |
| **PM2 Process** | `rtc-prod` | `rtc-stage` |
| **Node Environment** | `production` | `development` |
| **Browser Indicator**| Standard MiroTalk branding | `[STAGE]` prefix in browser tab title |
| **Firewall (UFW)** | `3000/tcp` (ALLOWED) | `3001/tcp` (ALLOWED) |

---

## 2. Process Management & The `rtc` CLI Tool

Both instances run 24/7 as supervised daemon services managed by **PM2** and integrated with **systemd** (`pm2-root.service`). They automatically recover from crashes and persist across server reboots.

A dedicated CLI script [`/usr/local/bin/rtc`](file:///usr/local/bin/rtc) is installed globally.

### Everyday Commands

```bash
# Check status and live HTTP health of both servers
rtc status

# Restart only staging (leaves production completely untouched)
rtc restart stage

# Restart only production
rtc restart prod

# Restart both servers
rtc restart all

# View live log streams
rtc logs stage
rtc logs prod

# Run the 400 automated unit tests in staging
rtc test

# Safely promote tested code from staging to production (prompts for confirmation or use -y)
rtc promote -y
```

### How `rtc promote` Works (Safe Zero-Downtime Deployment)
1. **Automated Verification**: Runs `npm test` inside `rtc_stage`. If any test fails, promotion **halts immediately**.
2. **Commit & Sync**: Commits any unstaged work in `rtc_stage` and pulls it directly into `rtc_main`.
3. **Graceful Reload**: Triggers `pm2 reload rtc-prod` to load new code with zero dropped connections.
4. **Health Check**: Executes a live HTTP request to port `3000`. Verifies `HTTP 200 OK` before confirming success.

---

## 3. Critical WebRTC & Engineering Rules

> [!CAUTION]
> **Audio Container Rendering (Do NOT use `display: none`)**:
> In [`public/css/client.css`](file:///root/projects/rtc/rtc_main/public/css/client.css), `#audioMediaContainer` MUST remain actively rendered in the browser layout tree:
> ```css
> #audioMediaContainer {
>     position: fixed;
>     top: -10000px;
>     left: -10000px;
>     width: 0;
>     height: 0;
>     opacity: 0;
>     pointer-events: none;
> }
> ```
> Changing this to `display: none` causes Chrome, Safari, and WebKit to aggressively suspend or pause background audio playback when the tab loses focus or when a user locks their screen.

> [!IMPORTANT]
> **Cloudflare Rocket Loader Compatibility**:
> In [`public/views/client.html`](file:///root/projects/rtc/rtc_main/public/views/client.html), all application `<script>` tags MUST include `data-cfasync="false"`:
> ```html
> <script data-cfasync="false" defer src="../js/client.js"></script>
> ```
> Cloudflare Rocket Loader attempts to asynchronously defer scripts. Without `data-cfasync="false"`, scripts execute out of order, leading to `ReferenceError` crashes and broken WebRTC handshakes.

> [!TIP]
> **DataChannel SCTP Message Throttling**:
> In [`public/js/volumeProcessor.js`](file:///root/projects/rtc/rtc_main/public/js/volumeProcessor.js), volume and speech indicators sent over WebRTC DataChannels must be throttled to ~20Hz (every 50ms). Sending messages on every 128-sample audio quantum (~375 messages/sec) will saturate SCTP buffers and cause `InvalidModificationError: Failed to start SCTP transport`.

> [!WARNING]
> **Zombie Socket Eviction on Sleep / Reconnection**:
> When a user sleeps their laptop or locks their screen, Socket.IO's TCP ping timeout takes 20–45s to detect the disconnect. In [`app/src/server.js`](file:///root/projects/rtc/rtc_main/app/src/server.js), `handleJoin` must actively evict stale sockets belonging to the same peer/user ID before adding the new connection.

> [!NOTE]
> **Credential & Password Sanitization**:
> Never broadcast plaintext room passwords or private credentials over signaling channels or API responses. In [`app/src/server.js`](file:///root/projects/rtc/rtc_main/app/src/server.js), `getSanitizedPeers` strips password fields, and [`app/src/api.js`](file:///root/projects/rtc/rtc_main/app/src/api.js) masks meeting secrets.

---

## 4. Developer & AI Agent Workflow

> [!CAUTION]
> **Mandatory User Approval Before Promoting to Main (Production)**:
> The AI agent MUST NEVER run `rtc promote` or modify `rtc_main` autonomously. Upon completing any task, bug fix, feature, or test expansion in staging, the AI agent MUST ALWAYS stop and explicitly ask the user for approval to promote the verified changes to main/production before proceeding. Promotion to production may only occur after receiving direct, affirmative user authorization.

When making any code changes, bug fixes, or enhancements:

1. **Always Work in `rtc_stage` First**:
   ```bash
   cd /root/projects/rtc/rtc_stage
   ```
2. **Make Edits & Test Locally**:
   - Run tests: `npm test` (or `rtc test`)
   - Test in browser: [https://stage-rtc.natrium.sh](https://stage-rtc.natrium.sh)
   - Inspect stage logs: `rtc logs stage`
3. **Verify Zero Regressions**:
   - Ensure all 400 test cases pass.
   - Verify audio, video, and screen sharing connect cleanly.
4. **Always Ask the User for Approval to Promote**:
   - Report to the user that changes in staging are completed, verified, and passing tests.
   - Ask explicitly: *"Staging is verified and all 400 unit tests pass. Would you like me to promote this to production (main)?"*
   - Stop and wait for the user's response. **NEVER proceed with promotion without user approval.**
5. **Promote to Production (Only After Explicit Approval)**:
   ```bash
   rtc promote -y
   ```
6. **Verify Production**:
   - Check [https://rtc.natrium.sh](https://rtc.natrium.sh)
   - Run `rtc status` to ensure both services remain green.

---

## 5. Reverse Proxy & Cloudflare Networking

- Both domains resolve to Cloudflare Anycast IPs (`172.67.171.239`, `104.21.88.14`).
- Cloudflare terminates TLS on port 443 and applies **Origin Rules** to route traffic to the VPS (`45.141.116.81`):
  - `rtc.natrium.sh` -> Destination Port **3000**
  - `stage-rtc.natrium.sh` -> Destination Port **3001**
- Both ports (`3000/tcp` and `3001/tcp`) are open in the VPS **UFW firewall**.
