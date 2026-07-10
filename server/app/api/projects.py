"""Per-user project storage: list (without payload), CRUD, autosave via PUT."""

import json

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from ..deps import CurrentUser, DbSession
from ..models import Project
from ..schemas import ProjectIn, ProjectOut, ProjectPatch, ProjectSummary

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _own_project(db: DbSession, user_id: int, project_id: int) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.user_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _summary(p: Project) -> ProjectSummary:
    return ProjectSummary(
        id=p.id,
        name=p.name,
        thumbnail=p.thumbnail,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _full(p: Project) -> ProjectOut:
    return ProjectOut(**_summary(p).model_dump(), data=json.loads(p.data))


@router.get("", response_model=list[ProjectSummary])
def list_projects(user: CurrentUser, db: DbSession) -> list[ProjectSummary]:
    rows = db.scalars(
        select(Project).where(Project.user_id == user.id).order_by(Project.updated_at.desc())
    )
    return [_summary(p) for p in rows]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectIn, user: CurrentUser, db: DbSession) -> ProjectOut:
    project = Project(
        user_id=user.id, name=body.name, data=json.dumps(body.data), thumbnail=body.thumbnail
    )
    db.add(project)
    db.flush()
    return _full(project)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: int, user: CurrentUser, db: DbSession) -> ProjectOut:
    return _full(_own_project(db, user.id, project_id))


@router.put("/{project_id}", response_model=ProjectSummary)
def update_project(
    project_id: int, body: ProjectPatch, user: CurrentUser, db: DbSession
) -> ProjectSummary:
    project = _own_project(db, user.id, project_id)
    if body.name is not None:
        project.name = body.name
    if body.data is not None:
        project.data = json.dumps(body.data)
    if body.thumbnail is not None:
        project.thumbnail = body.thumbnail
    db.flush()
    return _summary(project)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, user: CurrentUser, db: DbSession) -> None:
    db.delete(_own_project(db, user.id, project_id))
