# Apollo-Net v4

Apollo-Net is a React + Vite frontend with a FastAPI simulation backend for the hybrid swarm command center.

## Requirements

- Node.js 18+ (20+ recommended)
- npm
- A modern browser

## Run

```bash
npm install
npm run dev
```

Open the URL printed by Vite, normally:

http://localhost:5173

Run the backend separately during local development:

```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

## What is already functional

- Deploy Swarm button
- Pause Swarm
- Reset Scenario
- Scout count control
- Simulation speed control
- Layer toggles
- Interactive Three.js 3D tactical map (orbit/zoom/rotate)
- Animated virtual scouts
- Survivor detection
- SOS event generation
- Swarm target attraction
- A* extraction-path visualization
- Live event feed
- Performance chart
- Local demo mode when FastAPI is not running
- FastAPI REST/WebSocket connection points

## Backend connection

The frontend expects:

REST:
- POST /api/control/start
- POST /api/control/stop
- POST /api/control/reset

WebSocket:
- ws://127.0.0.1:8000/ws

The frontend reads production URLs from `VITE_BACKEND_URL` and `VITE_WS_URL`. If they are not set, it uses the localhost values above so the browser simulation remains usable when the backend is unavailable. Copy `.env.example` to `.env.local` for local overrides:

```env
VITE_BACKEND_URL=http://127.0.0.1:8000
VITE_WS_URL=ws://127.0.0.1:8000/ws
```

## Vercel deployment

The repository is configured as one Vercel project: the Vite build is served from `dist`, and the FastAPI app is exposed through `api/index.py`. The rewrite rules send `/api/*` to FastAPI and keep the client-side dashboard available for browser routes. The backend entrypoint only imports `app`; it does not create a virtual environment, launch Vite, open a browser, or start a development server.

Set these project environment variables in Vercel before deploying:

Frontend build variables:

```env
VITE_BACKEND_URL=https://YOUR-BACKEND-URL
VITE_WS_URL=wss://YOUR-BACKEND-URL/ws
```

Backend variable:

```env
FRONTEND_ORIGIN=https://YOUR-FRONTEND-URL
```

For this combined configuration, `YOUR-BACKEND-URL` and `YOUR-FRONTEND-URL` are the same Vercel deployment URL. A separate frontend and backend project is also possible: deploy the frontend from the repository root, deploy the same repository with `api/index.py` as the backend project, and use each project's URL in the variables above.

## WebSocket and state limitations

The existing `/ws` endpoint is preserved for local ASGI hosting and compatible long-lived runtimes. Vercel Functions are request-oriented and do not provide a durable WebSocket server or durable process memory across invocations. On Vercel, REST requests remain available, but telemetry WebSocket connections may close or be unsupported and simulation state must not be treated as shared durable state between instances. The frontend detects this condition and continues in its existing local browser simulation mode. Use a long-running ASGI host or a managed realtime service when durable multi-client telemetry is required.

## Testing

```bash
npm install
npm run build
python -m py_compile main.py test_backend.py
```

`test_backend.py` is a smoke script that expects a backend already running at `http://127.0.0.1:8000`; run it after starting `uvicorn main:app`.

## Important

Node.js is used here as the frontend development/build tool. The backend is Python + FastAPI. Do not commit `.env`, virtual environments, `node_modules`, `dist`, or Python cache files.
