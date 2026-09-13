# Apollo-Net v4 Frontend

This is the complete React + Vite frontend for the Apollo-Net hybrid swarm command center.

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

You can override these with `.env`:

```env
VITE_BACKEND_URL=http://127.0.0.1:8000
VITE_WS_URL=ws://127.0.0.1:8000/ws
```

## Important

Node.js is used here as the frontend development/build tool. It is NOT the Apollo-Net AI backend. The planned AI/backend remains Python + FastAPI.
