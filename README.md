<div align="center">

# Twinscape

### A living 3D twin of your infrastructure.

Web dashboard for **real-time hardware & server monitoring**, with interactive
**2D / 3D visualization** — see your infrastructure the way it actually sits on the floor.

![Twinscape 3D view](docs/twinscape-3d.jpeg)

<sub>3D view — live device status on a digital twin of the real facility</sub>

![Twinscape 2D view](docs/twinscape-2d.jpeg)

<sub>2D floor-map view — the same live data, top-down</sub>

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/node-%3E%3D16-brightgreen)
![Three.js](https://img.shields.io/badge/3D-three.js-black)

</div>

---

## What is it?

Twinscape watches the hardware and servers you care about and shows their status
**live** — up, down, or silent — over WebSocket. Instead of a wall of rows, the
flagship **v2** renders your devices onto an interactive **3D digital twin** (and a
matching **2D floor map**) built from your real layout: rooms, racks, gates, machines.
A device going down lights up exactly where it physically is.

> **Monitoring only** for now — Twinscape observes and visualizes; it does not send
> commands to devices.

## Features

- **Real-time monitoring** — live device status via WebSocket, no page refresh.
- **2D / 3D visualization** — interactive digital twin of the real facility (v2); orbit, zoom, click a device for details.
- **Multi-location / multi-floor** — switch between sites and floors, each with its own scene.
- **Status at a glance** — health score, up/down counts, down-timers, search, and status filters.
- **Alerts** — toast + optional sound when a device drops or recovers.
- **Resilient client** — auto-reconnect with backoff, stale-data indicator, and a **lite graphics mode** for weak GPUs.
- **Light / dark theme**, shareable read-only deep-links, and a settings panel.
- **Zero-build frontend** — vanilla JS + vendored Three.js; **dependency-free auth** (Node `crypto`).

## Versions

Twinscape ships in two flavors that consume the same live data:

| | **Classic (v1)** | **Twinscape (v2)** ⭐ |
|---|---|---|
| View | Card grid | **Interactive 2D / 3D** |
| Best for | On-site local server | The main experience / showcase |
| Folder | `legacy/` | `twinscape/` |
| Port (default) | `10101` | `10102` |

**Twinscape (in [`twinscape/`](twinscape/)) is the flagship** — the 2D/3D twin is what
this project is about, and it's what `npm start` runs. The classic v1 card dashboard
lives in [`legacy/`](legacy/) for simple on-site local-server setups.

> A companion **Scene Builder** ([`builder/`](builder/), port `10103`) authors the 2D/3D
> scenes that Twinscape renders. It's part of Twinscape and will be folded in over time.

**Repo layout:**

```
twinscape/   ← ⭐ the flagship 2D/3D app  (npm start)
builder/     ← Scene Builder (authors scenes for Twinscape)
legacy/      ← classic v1 card dashboard
docs/        ← deployment & performance guides
```

## Installation

Requires **Node.js ≥ 16**.

```bash
git clone <repo-url> twinscape && cd twinscape
npm install
```

## Usage

```bash
# Twinscape — the 2D/3D digital twin (flagship)
npm start             # → http://localhost:10102

# Classic card dashboard (v1)
npm run classic       # → http://localhost:10101

# Scene Builder — author 2D/3D scenes for Twinscape
npm run builder       # → http://localhost:10103
```

Twinscape is login-gated. Create an account:

```bash
node twinscape/adduser.js
```

**Production (PM2):**

```bash
npm run pulse:start     # start Twinscape under PM2 (app name: twinscape-v2)
npm run classic:start   # start the classic v1 dashboard under PM2
```

See [`docs/`](docs/) for deployment guides (incl. Cloudflare Tunnel).

## Configuration

- **Data sources / hosts (Twinscape)** — [`twinscape/locations.json`](twinscape/locations.json):
  each location points at an upstream WebSocket (`"ws": "ws://<host>:<port>/ws"`) and its
  2D/3D scene files. Add locations and floors here.
- **Classic (v1) settings** — [`legacy/config.json`](legacy/config.json): `webPort`, `wsPath`,
  `monitorInterval`, `timezone`, data/log dirs.
- **Auth secret (Twinscape)** — env `PULSE_SECRET`, else auto-generated to `twinscape/.pulse-secret`.
- **Scenes** — authored in the Scene Builder and saved as JSON under `twinscape/public/assets/`.

## Tech Stack

- **Backend** — Node.js, [Express](https://expressjs.com/), [`ws`](https://github.com/websockets/ws) (WebSocket), [`ping`](https://www.npmjs.com/package/ping).
- **3D** — [Three.js](https://threejs.org/) (vendored, offline via import-map).
- **2D** — hand-rolled SVG floor maps.
- **Frontend** — vanilla JavaScript, no build step.
- **Auth** — dependency-free: Node `crypto` (scrypt password hash + HMAC-signed cookie session).
- **Ops** — PM2 process management; Cloudflare Tunnel for public access.

## License

[MIT](LICENSE) © Rifky Andigta Al-Fathir

<sub>Originally built for hardware ops at Stechoq.</sub>
