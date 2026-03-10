"""Eval platform FastAPI server — port 8100."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from config import HOST, PORT
from storage.database import init_db
from api.datasets import router as datasets_router
from api.experiments import router as experiments_router
from api.traces import router as traces_router
from runner.progress import get_manager


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="AIAzora Eval Platform", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5200",
        "http://127.0.0.1:5200",
        "https://azorashopping.site",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(datasets_router)
app.include_router(experiments_router)
app.include_router(traces_router)


@app.get("/api/health")
async def health():
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
