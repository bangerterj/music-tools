"""Project persistence — save/load project JSON and manage project directory."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path

from models import Project, Track, TRACK_COLORS

# Projects live under ~/Music/Studio Projects/<name>/
PROJECTS_ROOT = Path.home() / "Music" / "Studio Projects"
PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def project_dir(project_id: str) -> Path | None:
    """Locate the directory for a project by scanning PROJECTS_ROOT."""
    for d in PROJECTS_ROOT.iterdir():
        if d.is_dir():
            meta = d / "project.json"
            if meta.exists():
                try:
                    data = json.loads(meta.read_text())
                    if data.get("id") == project_id:
                        return d
                except Exception:
                    pass
    return None


def create_project(name: str) -> Project:
    """Create a new empty project, persist it, and return the Project model."""
    project_id = str(uuid.uuid4())
    pdir = PROJECTS_ROOT / name
    # Avoid collisions on duplicate names
    if pdir.exists():
        pdir = PROJECTS_ROOT / f"{name}-{project_id[:8]}"
    pdir.mkdir(parents=True, exist_ok=True)

    project = Project(
        id=project_id,
        name=name,
        tracks=[],
        created_at=_now_iso(),
        updated_at=_now_iso(),
    )
    _write(project, pdir)
    return project


def load_project(project_id: str) -> Project | None:
    """Load and return a Project, or None if not found."""
    pdir = project_dir(project_id)
    if pdir is None:
        return None
    meta = pdir / "project.json"
    if not meta.exists():
        return None
    try:
        data = json.loads(meta.read_text())
        return Project(**data)
    except Exception:
        return None


def save_project(project: Project) -> bool:
    """Persist an updated project. Returns True on success."""
    pdir = project_dir(project.id)
    if pdir is None:
        # Create directory if somehow missing
        pdir = PROJECTS_ROOT / project.name
        pdir.mkdir(parents=True, exist_ok=True)
    project.updated_at = _now_iso()
    _write(project, pdir)
    return True


def get_project_dir(project_id: str) -> Path | None:
    return project_dir(project_id)


def _write(project: Project, pdir: Path) -> None:
    meta = pdir / "project.json"
    meta.write_text(project.model_dump_json(indent=2))


def add_track(project: Project, name: str, stem_type: str = "other") -> Track:
    """Create a new Track with the next color and default effects preset."""
    from models import STEM_PRESETS

    color_idx = len(project.tracks) % len(TRACK_COLORS)
    color = TRACK_COLORS[color_idx]

    preset_fn = STEM_PRESETS.get(stem_type, STEM_PRESETS["other"])
    track = Track(
        id=str(uuid.uuid4()),
        name=name,
        color=color,
        effects=preset_fn(),
    )
    project.tracks.append(track)
    return track


def audio_path(project_id: str, track_id: str, clip_id: str) -> Path | None:
    """Resolve the filesystem path for a clip's audio file."""
    project = load_project(project_id)
    if project is None:
        return None
    for track in project.tracks:
        if track.id != track_id:
            continue
        for clip in track.clips:
            if clip.id != clip_id:
                continue
            pdir = project_dir(project_id)
            if pdir is None:
                return None
            candidate = pdir / clip.file
            return candidate if candidate.exists() else None
    return None
