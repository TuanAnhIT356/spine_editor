"""FastAPI app factory. Run with:  uv run uvicorn app.main:app --port 8100"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import auth, generate, keys, projects, settings
from .config import config
from .db import Base, engine


def create_app() -> FastAPI:
    Base.metadata.create_all(engine)
    app = FastAPI(title="Spine Editor Server", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth.router)
    app.include_router(projects.router)
    app.include_router(keys.router)
    app.include_router(settings.router)
    app.include_router(generate.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "spine-editor-server"}

    return app


app = create_app()
