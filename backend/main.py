"""Eval platform FastAPI server — port 8100."""

import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config import HOST, PORT
from storage.database import init_db
from api.datasets import router as datasets_router
from api.experiments import router as experiments_router
from api.traces import router as traces_router
from api.agent import router as agent_router
from api.production import router as production_router
from api.graders import router as graders_router
from runner.progress import get_manager
from adapters.open_acciowork.api import router as acciowork_router


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Agent Eval Platform", version="1.0.0", lifespan=lifespan)

# Comma-separated origins; extend via EVAL_CORS_ORIGINS for deployed setups.
_cors_origins = os.getenv(
    "EVAL_CORS_ORIGINS", "http://localhost:5200,http://127.0.0.1:5200"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(datasets_router)
app.include_router(experiments_router)
app.include_router(traces_router)
app.include_router(agent_router)
app.include_router(production_router)
app.include_router(graders_router)
app.include_router(acciowork_router)


@app.get("/api/health")
async def health():
    """Health check with eval system diagnostics."""
    from storage import queries
    try:
        db = await queries.get_db()
        rows = await db.execute_fetchall("SELECT status, COUNT(*) as c FROM traces GROUP BY status")
        total = sum(r["c"] for r in rows)
        graded = sum(r["c"] for r in rows if r["status"] == "graded")
        ann_rows = await db.execute_fetchall("SELECT COUNT(*) as c FROM traces WHERE human_pass IS NOT NULL")
        annotated = ann_rows[0]["c"] if ann_rows else 0
        val_rows = await db.execute_fetchall("SELECT COUNT(*) as c FROM grader_validations")
        validations = val_rows[0]["c"] if val_rows else 0
        warnings = []
        if annotated < 50:
            warnings.append(f"Only {annotated} human annotations (need 100+ for judge validation)")
        if validations == 0:
            warnings.append("No grader validations — judges are unvalidated")
        if graded < total * 0.5:
            warnings.append(f"Only {graded}/{total} traces graded ({round(graded/max(total,1)*100)}%)")
        return {"status": "ok" if not warnings else "degraded", "service": "eval-platform",
                "traces": total, "graded": graded, "annotated": annotated, "validations": validations,
                "warnings": warnings}
    except Exception:
        return {"status": "ok", "service": "eval-platform"}


@app.websocket("/ws/experiments/{experiment_id}")
async def experiment_ws(websocket: WebSocket, experiment_id: int):
    await websocket.accept()
    manager = get_manager()
    queue: asyncio.Queue[dict] = asyncio.Queue()
    manager.subscribe(experiment_id, queue)
    try:
        while True:
            msg = await queue.get()
            await websocket.send_json(msg)
            if msg.get("type") == "experiment_done":
                break
    except WebSocketDisconnect:
        pass
    finally:
        manager.unsubscribe(experiment_id, queue)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
