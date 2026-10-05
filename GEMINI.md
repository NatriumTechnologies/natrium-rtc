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
│   ├── tests/             # Automated test suite (407 test cases)
│   └── .env               # Production environment configuration (PORT=3000)
│
├── rtc_stage/             # STAGING environment (Port 3001 -> https://stage-rtc.natrium.sh)
│   ├── app/src/           # Server-side signaling
│   ├── public/            # Client frontend assets (with [STAGE] tab title indicator)
│   ├── tests/             # Automated test suite (407 test cases)
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

# Run all 407 automated unit tests in staging
rtc test

# Safely promote tested code from staging to production with descriptive commit message
rtc promote "<type>(<scope>): <descriptive message>"
```

### How `rtc promote` Works (Safe Zero-Downtime Deployment)
1. **Automated Verification**: Runs `npm test` inside `rtc_stage`. If any of the 407 tests fail, promotion **halts immediately**.
2. **Commit Validation**: Ensures any unstaged or new work in `rtc_stage` is committed using a meaningful, change-specific commit message (generic messages like `stage: update promoted to prod at...` are strictly rejected).
3. **Sync to Production**: Pulls verified commits directly from `rtc_stage` into `rtc_main`.
4. **Graceful Reload**: Triggers `pm2 reload rtc-prod` to reload production workers with zero dropped connections.
5. **Health Check**: Executes a live HTTP request to port `3000`. Verifies `HTTP 200 OK` before confirming success.
6. **GitHub Synchronization**: Automatically pushes verified branches to GitHub remote (`origin/stage` and `origin/main`).

---

## 3. Commit Message Standards (Conventional Commits)

> [!IMPORTANT]
> **Mandatory Semantic Commit Messages**:
> All commits must follow the **Conventional Commits** specification. Generic messages like `"stage: update promoted to prod at..."` or `"update"` are **STRICTLY PROHIBITED**.
>
> Format:
> ```
> <type>(<scope>): <short description>
>
> [optional longer body explaining context, changes, and rationale]
> ```
>
> Acceptable Types:
> - `feat`: A new feature (e.g. `feat(audio): separate screen share stream volume from participant voice volume`)
> - `fix`: A bug fix (e.g. `fix(client): decouple participant count from screen tiles`)
> - `test`: Adding or updating tests (e.g. `test(volume): add unit tests for stream volume separation`)
> - `docs`: Documentation changes (e.g. `docs: update GEMINI.md commit guidelines`)
> - `refactor`: Code restructuring without behavioral changes (e.g. `refactor(audio): clean up volume change handlers`)
> - `perf`: Performance improvements (e.g. `perf(datachannel): throttle SCTP messages to 20Hz`)
> - `chore`: Build scripts, dependencies, or configuration updates (e.g. `chore(cli): add commit validation to rtc CLI`)

---

## 4. Critical WebRTC & Engineering Rules

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
> In [`public/views/client.html`](file:///root/projects/rtc/rtc_main/public/views/client.html) and all other views, all application `<script>` tags MUST include `data-cfasync="false"`:
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

> [!IMPORTANT]
> **Independent Screen Audio Routing & Controls**:
> Screen share audio and microphone voice tracks must travel over distinct `RTCRtpSender` channels (`_mediaType = 'mic'` and `_mediaType = 'screen_audio'`) and play through separate HTML elements (`<audio id="${peer_id}">` for voice, and `<audio id="${peer_id}___screen_audio">` for screen). This ensures participant voice and screen stream volume can be adjusted, muted, and recovered independently.

---

## 5. Developer & AI Agent Workflow

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
3. **Commit with Meaningful Semantic Messages**:
   - Commit changes using Conventional Commits: `git commit -m "feat(scope): descriptive message"`
   - Never use generic commit messages.
4. **Verify Zero Regressions**:
   - Ensure all 407 test cases pass (`rtc test`).
   - Verify audio, video, and screen sharing connect cleanly.
5. **Always Ask the User for Approval to Promote**:
   - Report to the user that changes in staging are completed, tested, and passing all 407 tests.
   - Ask explicitly: *"Staging is verified and all 407 unit tests pass. Would you like me to promote this to production (main)?"*
   - Stop and wait for the user's response. **NEVER proceed with promotion without user approval.**
6. **Promote to Production (Only After Explicit Approval)**:
   ```bash
   rtc promote "feat(scope): descriptive message"
   ```
7. **Verify Production**:
   - Check [https://rtc.natrium.sh](https://rtc.natrium.sh)
   - Run `rtc status` to ensure both services remain green.

---

## 6. Reverse Proxy & Cloudflare Networking

- Both domains resolve to Cloudflare Anycast IPs (`172.67.171.239`, `104.21.88.14`).
- Cloudflare terminates TLS on port 443 and applies **Origin Rules** to route traffic to the VPS (`45.141.116.81`):
  - `rtc.natrium.sh` -> Destination Port **3000**
  - `stage-rtc.natrium.sh` -> Destination Port **3001**
- Both ports (`3000/tcp` and `3001/tcp`) are open in the VPS **UFW firewall**.
