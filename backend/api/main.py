"""
FastAPI application entrypoint.
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import redis.asyncio as aioredis

from backend.config import settings
from backend.storage.database import init_db
from backend.api.routes import router
from backend.api.websocket import manager, event_tailer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

_tailer_task = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _tailer_task
    await init_db()
    logger.info("Database initialized")

    _tailer_task = asyncio.create_task(event_tailer(settings.redis_url))
    logger.info("Event tailer started")

    yield

    if _tailer_task:
        _tailer_task.cancel()
        try:
            await _tailer_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Advanced Web Crawler API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api/v1")


@app.websocket("/ws")
async def ws_all(websocket: WebSocket):
    """WebSocket for all jobs (dashboard overview)."""
    await manager.connect(websocket, job_id=None)
    try:
        while True:
            # Keep alive — client can also send pings
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket, job_id=None)


@app.websocket("/ws/{job_id}")
async def ws_job(websocket: WebSocket, job_id: str):
    """WebSocket for a specific job (detailed view)."""
    await manager.connect(websocket, job_id=job_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket, job_id=job_id)


@app.get("/health")
async def health():
    return {"status": "ok", "ws_connections": manager.count()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=settings.api_host, port=settings.api_port, reload=True)
