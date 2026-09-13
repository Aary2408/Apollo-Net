from __future__ import annotations

import asyncio
import math
import random
import time
from dataclasses import dataclass, asdict
from typing import Optional

import cv2
import numpy as np
import networkx as nx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

GRID_SIZE = 100
TICK_SECONDS = 0.08
MAX_DRONES = 500


# ============================================================
# DATA MODELS
# ============================================================

@dataclass
class Drone:
    id: str
    x: float
    y: float
    vx: float = 0.0
    vy: float = 0.0
    state: str = "SEARCH"
    active: bool = True


@dataclass
class Survivor:
    id: str
    x: int
    y: int
    found: bool = False


class StartRequest(BaseModel):
    drone_count: int = Field(default=80, ge=5, le=MAX_DRONES)


class SpeedRequest(BaseModel):
    speed: float = Field(default=1.0, ge=0.25, le=2.0)


# ============================================================
# SIMULATION ENGINE
# ============================================================

class ApolloSimulation:
    """
    Disaster-response swarm simulation.

    The engine is intentionally generic:
      - restricted_grid = unsafe/hazardous cells
      - rubble_grid = search-priority cells
      - pheromone = collective search memory
      - coverage_grid = cells already searched

    It does not control real hardware.
    """

    def __init__(self):
        self.lock = asyncio.Lock()
        self.running = False
        self.speed = 1.0
        self.tick = 0
        self.started_at: Optional[float] = None

        self.rng = random.Random(42)

        self.restricted = np.zeros((GRID_SIZE, GRID_SIZE), dtype=np.uint8)
        self.rubble = np.zeros((GRID_SIZE, GRID_SIZE), dtype=np.uint8)
        self.coverage = np.zeros((GRID_SIZE, GRID_SIZE), dtype=np.uint8)
        self.pheromone = np.zeros((GRID_SIZE, GRID_SIZE), dtype=np.float32)

        self.drones: list[Drone] = []
        self.survivors: list[Survivor] = []
        self.buildings: list[dict] = []
        self.target: Optional[dict] = None
        self.extraction_path: list[dict] = []
        self.sos_events = 0
        self.event_queue: list[dict] = []
        self.coverage_percent = 0.0

        self.reset(80)

    # --------------------------------------------------------
    # SCENARIO
    # --------------------------------------------------------

    def reset(self, drone_count: int = 80):
        drone_count = max(5, min(MAX_DRONES, int(drone_count)))

        self.running = False
        self.tick = 0
        self.started_at = None
        self.target = None
        self.extraction_path = []
        self.sos_events = 0
        self.event_queue = []
        self.coverage_percent = 0.0

        self.restricted.fill(0)
        self.rubble.fill(0)
        self.coverage.fill(0)
        self.pheromone.fill(0)

        # Generic hazardous/restricted areas.
        self._paint_rect(12, 12, 25, 28, self.restricted, 1)
        self._paint_rect(64, 10, 86, 25, self.restricted, 1)
        self._paint_rect(70, 68, 91, 89, self.restricted, 1)

        # Rubble/search-priority areas.
        self._paint_rect(28, 58, 48, 82, self.rubble, 1)
        self._paint_rect(52, 25, 72, 43, self.rubble, 1)
        self._paint_rect(74, 42, 91, 61, self.rubble, 1)
        self._paint_rect(8, 64, 23, 86, self.rubble, 1)

        # Do not mark restricted cells as rubble.
        self.rubble[self.restricted == 1] = 0

        self.buildings = []
        for i in range(16):
            x = self.rng.randint(5, 92)
            y = self.rng.randint(5, 92)
            w = self.rng.randint(5, 10)
            d = self.rng.randint(5, 10)
            if self._rect_hits_restricted(x, y, w, d):
                continue
            self.buildings.append({
                "id": i,
                "x": x,
                "y": y,
                "width": w,
                "depth": d,
                "height": self.rng.randint(6, 20),
            })

        survivor_positions = [
            (72, 67), (34, 77), (83, 30), (21, 35), (58, 20)
        ]
        self.survivors = [
            Survivor(f"S-{i+1:02d}", x, y)
            for i, (x, y) in enumerate(survivor_positions)
        ]

        self.drones = []
        for i in range(drone_count):
            x, y = self._random_safe_position()
            self.drones.append(
                Drone(f"D-{i+1:03d}", x, y)
            )

        self._emit(
            "SYSTEM",
            f"Scenario initialized — {drone_count} virtual scouts, "
            f"{len(self.survivors)} survivor targets"
        )

    def _paint_rect(self, x1, y1, x2, y2, grid, value):
        x1, x2 = sorted((max(0, x1), min(GRID_SIZE - 1, x2)))
        y1, y2 = sorted((max(0, y1), min(GRID_SIZE - 1, y2)))
        grid[y1:y2 + 1, x1:x2 + 1] = value

    def _rect_hits_restricted(self, x, y, w, d):
        x2 = min(GRID_SIZE - 1, x + w)
        y2 = min(GRID_SIZE - 1, y + d)
        return bool(self.restricted[y:y2 + 1, x:x2 + 1].any())

    def _random_safe_position(self):
        for _ in range(10000):
            x = self.rng.uniform(2, 97)
            y = self.rng.uniform(2, 97)
            if not self.is_restricted(x, y):
                return x, y
        return 50.0, 50.0

    # --------------------------------------------------------
    # CONTROL
    # --------------------------------------------------------

    def start(self, drone_count: Optional[int] = None):
        if drone_count is not None and (
            drone_count != len(self.drones)
        ):
            self.reset(drone_count)

        self.running = True
        if self.started_at is None:
            self.started_at = time.time()
        self._emit("SYSTEM", "Swarm deployment initiated")

    def stop(self):
        self.running = False
        for d in self.drones:
            d.vx *= 0.2
            d.vy *= 0.2
        self._emit("SYSTEM", "Swarm movement paused")

    # --------------------------------------------------------
    # GRID / MOVEMENT
    # --------------------------------------------------------

    def is_restricted(self, x, y):
        ix = int(round(clamp(x, 0, GRID_SIZE - 1)))
        iy = int(round(clamp(y, 0, GRID_SIZE - 1)))
        return bool(self.restricted[iy, ix])

    def cell_value(self, x, y):
        ix = int(round(clamp(x, 0, GRID_SIZE - 1)))
        iy = int(round(clamp(y, 0, GRID_SIZE - 1)))
        return {
            "restricted": int(self.restricted[iy, ix]),
            "rubble": int(self.rubble[iy, ix]),
            "coverage": int(self.coverage[iy, ix]),
            "pheromone": float(self.pheromone[iy, ix]),
        }

    def valid_position(self, x, y):
        return 1 <= x <= 98 and 1 <= y <= 98 and not self.is_restricted(x, y)

    def _separation(self, drone):
        ax = ay = 0.0
        neighbors = 0

        for other in self.drones:
            if other is drone:
                continue

            dx = drone.x - other.x
            dy = drone.y - other.y
            dist = math.hypot(dx, dy)

            if 0 < dist < 5.0:
                weight = (5.0 - dist) / 5.0
                ax += (dx / dist) * weight
                ay += (dy / dist) * weight
                neighbors += 1

        if neighbors:
            ax /= neighbors
            ay /= neighbors

        return ax, ay

    def _hazard_avoidance(self, drone):
        ax = ay = 0.0

        # Look around the drone and push away from restricted cells.
        for dx, dy in (
            (-3, 0), (3, 0), (0, -3), (0, 3),
            (-3, -3), (-3, 3), (3, -3), (3, 3)
        ):
            x = drone.x + dx
            y = drone.y + dy

            if self.is_restricted(x, y):
                dist = math.hypot(dx, dy) or 1
                ax -= dx / dist
                ay -= dy / dist

        return ax, ay

    def _exploration_bias(self, drone):
        """
        Encourage:
          - rubble
          - low coverage
          - low pheromone
        """

        best_score = -1e9
        best = (0.0, 0.0)

        for dx, dy in (
            (-1, -1), (0, -1), (1, -1),
            (-1, 0), (1, 0),
            (-1, 1), (0, 1), (1, 1)
        ):
            nxp = drone.x + dx * 3
            nyp = drone.y + dy * 3

            if not self.valid_position(nxp, nyp):
                continue

            c = self.cell_value(nxp, nyp)

            # High score = desirable search location.
            score = (
                c["rubble"] * 4.0
                + (1 - c["coverage"]) * 3.0
                - c["pheromone"] * 0.7
                + self.rng.random() * 0.4
            )

            if score > best_score:
                best_score = score
                best = (dx, dy)

        return best

    def _target_attraction(self, drone):
        if not self.target:
            return 0.0, 0.0

        dx = self.target["x"] - drone.x
        dy = self.target["y"] - drone.y
        dist = math.hypot(dx, dy) or 1.0

        return dx / dist, dy / dist

    def _safe_move(self, drone, nxp, nyp):
        if self.valid_position(nxp, nyp):
            drone.x = nxp
            drone.y = nyp
            return True

        # Try small alternatives.
        for angle in (0.5, -0.5, 1.0, -1.0, 1.5, -1.5):
            cs, sn = math.cos(angle), math.sin(angle)
            dx = nxp - drone.x
            dy = nyp - drone.y
            rx = dx * cs - dy * sn
            ry = dx * sn + dy * cs
            ax = drone.x + rx
            ay = drone.y + ry
            if self.valid_position(ax, ay):
                drone.x, drone.y = ax, ay
                return True

        return False

    # --------------------------------------------------------
    # MAIN TICK
    # --------------------------------------------------------

    def step(self):
        if not self.running:
            return

        self.tick += 1

        # Pheromone evaporation.
        self.pheromone *= 0.95

        for drone in self.drones:
            if not drone.active:
                continue

            sep_x, sep_y = self._separation(drone)
            haz_x, haz_y = self._hazard_avoidance(drone)

            if self.target:
                tx, ty = self._target_attraction(drone)
                drone.state = "SOS"
                ax = sep_x * 0.55 + haz_x * 1.4 + tx * 1.7
                ay = sep_y * 0.55 + haz_y * 1.4 + ty * 1.7
            else:
                ex, ey = self._exploration_bias(drone)
                drone.state = "SEARCH"
                ax = sep_x * 0.65 + haz_x * 1.5 + ex * 0.9
                ay = sep_y * 0.65 + haz_y * 1.5 + ey * 0.9

            # Small stochastic component avoids synchronized movement.
            ax += self.rng.uniform(-0.25, 0.25)
            ay += self.rng.uniform(-0.25, 0.25)

            drone.vx = drone.vx * 0.72 + ax * 0.28
            drone.vy = drone.vy * 0.72 + ay * 0.28

            max_speed = 1.25 * self.speed
            velocity = math.hypot(drone.vx, drone.vy)
            if velocity > max_speed:
                scale = max_speed / velocity
                drone.vx *= scale
                drone.vy *= scale

            nxp = clamp(drone.x + drone.vx * 0.9, 1, 98)
            nyp = clamp(drone.y + drone.vy * 0.9, 1, 98)

            moved = self._safe_move(drone, nxp, nyp)

            if moved:
                ix = int(drone.x)
                iy = int(drone.y)

                self.coverage[iy, ix] = 1
                self.pheromone[iy, ix] += 1.0

            # Survivor detection.
            for survivor in self.survivors:
                if survivor.found:
                    continue

                if math.hypot(
                    drone.x - survivor.x,
                    drone.y - survivor.y
                ) <= 2.7:
                    self._detect_survivor(drone, survivor)

        # Coverage metric.
        self.coverage_percent = float(
            self.coverage.sum() / self.coverage.size * 100
        )

    # --------------------------------------------------------
    # SURVIVOR / SOS / A*
    # --------------------------------------------------------

    def _detect_survivor(self, drone, survivor):
        survivor.found = True
        self.target = {
            "id": survivor.id,
            "x": survivor.x,
            "y": survivor.y
        }
        self.sos_events += 1

        self._emit(
            "SOS",
            f"{drone.id} LOCATED {survivor.id} — SOS BROADCAST"
        )

        self._emit(
            "SYSTEM",
            "Swarm attraction switched to target-lock mode"
        )

        self.extraction_path = self.astar(
            start=(8, 8),
            goal=(survivor.x, survivor.y)
        )

        if self.extraction_path:
            self._emit(
                "ASTAR",
                f"SAFE EXTRACTION ROUTE CALCULATED — "
                f"{len(self.extraction_path)} NODES"
            )

    def astar(self, start, goal):
        sx, sy = start
        gx, gy = goal

        if self.is_restricted(gx, gy):
            return []

        graph = nx.Graph()

        for y in range(GRID_SIZE):
            for x in range(GRID_SIZE):
                if self.restricted[y, x]:
                    continue

                node = (x, y)
                for dx, dy in (
                    (1, 0), (-1, 0), (0, 1), (0, -1),
                    (1, 1), (-1, -1), (1, -1), (-1, 1)
                ):
                    nxp, nyp = x + dx, y + dy
                    if not (0 <= nxp < GRID_SIZE and 0 <= nyp < GRID_SIZE):
                        continue
                    if self.restricted[nyp, nxp]:
                        continue

                    # Rubble is traversable but slightly more costly.
                    base = math.sqrt(dx * dx + dy * dy)
                    rubble_cost = 0.15 if self.rubble[nyp, nxp] else 0.0
                    graph.add_edge(
                        node,
                        (nxp, nyp),
                        weight=base + rubble_cost
                    )

        try:
            path = nx.astar_path(
                graph,
                (int(sx), int(sy)),
                (int(gx), int(gy)),
                heuristic=lambda a, b: math.hypot(
                    a[0] - b[0], a[1] - b[1]
                ),
                weight="weight"
            )
            return [{"x": x, "y": y} for x, y in path]
        except (nx.NetworkXNoPath, nx.NodeNotFound):
            return []

    # --------------------------------------------------------
    # SERIALIZATION
    # --------------------------------------------------------

    def _emit(self, event_type, message):
        self.event_queue.append({
            "type": event_type,
            "message": message,
            "timestamp": time.time()
        })
        self.event_queue = self.event_queue[-20:]

    def pop_events(self):
        events = self.event_queue[:]
        self.event_queue.clear()
        return events

    def metrics(self):
        return {
            "total_drones": len(self.drones),
            "active_drones": sum(d.active for d in self.drones),
            "survivors_found": sum(s.found for s in self.survivors),
            "survivors_total": len(self.survivors),
            "coverage": round(self.coverage_percent, 2),
            "sos_events": self.sos_events
        }

    def payload(self):
        return {
            "type": "telemetry",
            "tick": self.tick,
            "running": self.running,
            "speed": self.speed,
            "metrics": self.metrics(),
            "drones": [
                {
                    "id": d.id,
                    "x": round(d.x, 2),
                    "y": round(d.y, 2),
                    "vx": round(d.vx, 3),
                    "vy": round(d.vy, 3),
                    "state": d.state,
                    "active": d.active
                }
                for d in self.drones
            ],
            "survivors": [
                asdict(s) for s in self.survivors
            ],
            "buildings": self.buildings,
            "extraction_path": self.extraction_path,
            "target": self.target
        }


# ============================================================
# HELPERS
# ============================================================

def clamp(v, a, b):
    return max(a, min(b, v))


SIM = ApolloSimulation()


# ============================================================
# FASTAPI
# ============================================================

app = FastAPI(
    title="Apollo-Net v4 Backend",
    description="Vision-guided swarm search-and-rescue simulation backend.",
    version="4.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "name": "Apollo-Net v4",
        "status": "online",
        "docs": "/docs"
    }


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "service": "apollo-net-backend",
        "running": SIM.running
    }


@app.get("/api/scenario")
async def scenario():
    return SIM.payload()


@app.post("/api/control/start")
async def start(request: StartRequest):
    async with SIM.lock:
        SIM.start(request.drone_count)
        return SIM.payload()


@app.post("/api/control/stop")
async def stop():
    async with SIM.lock:
        SIM.stop()
        return SIM.payload()


@app.post("/api/control/reset")
async def reset(request: StartRequest):
    async with SIM.lock:
        SIM.reset(request.drone_count)
        return SIM.payload()


@app.post("/api/control/speed")
async def speed(request: SpeedRequest):
    async with SIM.lock:
        SIM.speed = request.speed
        return {
            "speed": SIM.speed,
            "status": "updated"
        }


@app.post("/api/vision/analyze")
async def analyze_image(file: UploadFile = File(...)):
    """
    Prototype computer-vision endpoint.

    This performs basic OpenCV analysis and returns:
      - image dimensions
      - edge density
      - brightness
      - a coarse terrain estimate

    It is intentionally a prototype adapter. A trained segmentation
    model can later replace this endpoint without changing the dashboard.
    """

    raw = await file.read()
    if not raw:
        raise HTTPException(400, "Empty image")

    data = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)

    if image is None:
        raise HTTPException(400, "Could not decode image")

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 80, 160)

    edge_density = float(np.mean(edges > 0))
    brightness = float(np.mean(gray))

    if brightness < 70:
        terrain = "dense_structure_or_low_light"
    elif edge_density > 0.18:
        terrain = "high_structure_density"
    else:
        terrain = "open_or_mixed_terrain"

    return {
        "filename": file.filename,
        "width": int(image.shape[1]),
        "height": int(image.shape[0]),
        "edge_density": round(edge_density, 4),
        "mean_brightness": round(brightness, 2),
        "terrain_estimate": terrain,
        "status": "analysis_complete"
    }


# ============================================================
# WEBSOCKET
# ============================================================

connected_clients: set[WebSocket] = set()


async def broadcast(payload):
    dead = []

    for ws in connected_clients:
        try:
            await ws.send_json(payload)
        except Exception:
            dead.append(ws)

    for ws in dead:
        connected_clients.discard(ws)


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    connected_clients.add(websocket)

    try:
        await websocket.send_json(SIM.payload())

        while True:
            # Keep connection alive and allow client messages.
            await asyncio.sleep(10)
            await websocket.send_json({
                "type": "heartbeat",
                "tick": SIM.tick,
                "running": SIM.running
            })

    except WebSocketDisconnect:
        connected_clients.discard(websocket)
    except Exception:
        connected_clients.discard(websocket)


# ============================================================
# SIMULATION LOOP
# ============================================================

async def simulation_loop():
    while True:
        async with SIM.lock:
            if SIM.running:
                SIM.step()
                events = SIM.pop_events()
                payload = SIM.payload()

                if events:
                    # Send each event before telemetry.
                    for event in events:
                        await broadcast({
                            "type": "event",
                            "event": event
                        })

                await broadcast(payload)

        await asyncio.sleep(TICK_SECONDS)


@app.on_event("startup")
async def startup():
    asyncio.create_task(simulation_loop())


# Run directly:
# python main.py
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )
