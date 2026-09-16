import os
import json
import time
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

DATA_DIR = Path(__file__).parent / "data" / "notes"
AUDIO_DIR = Path(__file__).parent / "data" / "audio"
DATA_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


class NoteItem(BaseModel):
    id: str
    title: str
    created_at: float = Field(default_factory=time.time)
    duration_seconds: float = 0.0
    audio_path: Optional[str] = None
    live_transcript: str = ""
    smart_transcript: str = ""
    diarization_transcript: str = ""
    summary: str = ""
    action_items: List[str] = Field(default_factory=list)
    tags: List[str] = Field(default_factory=list)
    user_memo: str = ""
    study_note: str = ""


def list_notes() -> List[Dict[str, Any]]:
    """List all notes sorted by creation time (newest first)."""
    notes = []
    for file in DATA_DIR.glob("*.json"):
        try:
            with open(file, "r", encoding="utf-8") as f:
                data = json.load(f)
                notes.append({
                    "id": data.get("id"),
                    "title": data.get("title", "무제 노트"),
                    "created_at": data.get("created_at", 0),
                    "duration_seconds": data.get("duration_seconds", 0),
                    "tags": data.get("tags", []),
                    "has_memo": bool(data.get("user_memo")),
                    "has_study_note": bool(data.get("study_note")),
                    "preview": (data.get("user_memo") or data.get("smart_transcript") or data.get("live_transcript") or "")[:120]
                })
        except Exception:
            continue
    notes.sort(key=lambda x: x["created_at"], reverse=True)
    return notes


def get_note(note_id: str) -> Optional[Dict[str, Any]]:
    """Get single note by ID."""
    file_path = DATA_DIR / f"{note_id}.json"
    if not file_path.exists():
        return None
    with open(file_path, "r", encoding="utf-8") as f:
        return json.load(f)


def get_google_drive_dir() -> Optional[Path]:
    """Auto-detect user's Google Drive local mount path in macOS CloudStorage."""
    cloud_storage = Path.home() / "Library" / "CloudStorage"
    if cloud_storage.exists():
        for d in cloud_storage.glob("GoogleDrive-*"):
            # Check both Korean and English folder names
            for drive_name in ["내 드라이브", "내 드라이브", "My Drive"]:
                my_drive = d / drive_name
                if my_drive.exists():
                    target_folder = my_drive / "Gemini_Transcribe_녹음"
                    target_folder.mkdir(parents=True, exist_ok=True)
                    return target_folder
    return None


def save_note(note: NoteItem) -> Dict[str, Any]:
    """Save note to JSON and generate corresponding Markdown note + sync to Google Drive."""
    file_path = DATA_DIR / f"{note.id}.json"
    note_dict = note.model_dump()
    with open(file_path, "w", encoding="utf-8") as f:
        json.dump(note_dict, f, ensure_ascii=False, indent=2)

    # Generate Markdown export
    md_content = generate_markdown_file(note)

    # Sync to Google Drive
    gdrive_dir = get_google_drive_dir()
    if gdrive_dir and gdrive_dir.exists():
        try:
            date_str = time.strftime("%Y%m%d_%H%M", time.localtime(note.created_at))
            safe_title = "".join(c for c in note.title if c.isalnum() or c in " _-가-힣").strip() or "음성기록"
            base_name = f"{date_str}_{safe_title}"

            # 1. Save Markdown to Google Drive
            gdrive_md = gdrive_dir / f"{base_name}.md"
            with open(gdrive_md, "w", encoding="utf-8") as f:
                f.write(md_content)

            # 2. Copy Audio to Google Drive
            if note.audio_path and Path(note.audio_path).exists():
                audio_ext = Path(note.audio_path).suffix or ".wav"
                gdrive_audio = gdrive_dir / f"{base_name}{audio_ext}"
                import shutil
                shutil.copy2(note.audio_path, gdrive_audio)

        except Exception as e:
            print(f"[Warning] Failed to sync to Google Drive: {e}")

    return note_dict


def delete_note(note_id: str) -> bool:
    """Delete a note and its corresponding markdown/audio if existing."""
    json_path = DATA_DIR / f"{note_id}.json"
    md_path = DATA_DIR / f"{note_id}.md"
    deleted = False
    if json_path.exists():
        json_path.unlink()
        deleted = True
    if md_path.exists():
        md_path.unlink()
    return deleted


def generate_markdown_file(note: NoteItem) -> str:
    """Create a formatted markdown note suitable for Obsidian or notes archives."""
    formatted_date = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(note.created_at))
    mins = int(note.duration_seconds // 60)
    secs = int(note.duration_seconds % 60)
    duration_str = f"{mins:02d}:{secs:02d}"

    lines = [
        f"# {note.title}",
        "",
        f"- **일시**: {formatted_date}",
        f"- **녹음 시간**: {duration_str}",
        f"- **태그**: {', '.join(['#' + t for t in note.tags]) if note.tags else '#음성기록 #전사'}",
        "",
        "---",
        "",
    ]

    # 1. User Insight Memo (High priority personal field notes)
    if note.user_memo and note.user_memo.strip():
        lines.extend([
            "## ✍️ 나의 인사이트 메모 (User Memo)",
            "",
            note.user_memo.strip(),
            "",
            "---",
            "",
        ])

    # 2. Gemini 3.8 Flash Comprehensive Study Note (Synthesized structured note)
    if note.study_note and note.study_note.strip():
        lines.extend([
            "## 📚 Gemini 3.8 Flash 종합 정리 노트 (Study Note)",
            "",
            note.study_note.strip(),
            "",
            "---",
            "",
        ])

    # 3. AI Executive Summary
    lines.extend([
        "## 💡 AI 핵심 요약 (Summary)",
        "",
        note.summary if note.summary else "*(요약 내용 없음)*",
        "",
    ])

    # 4. Action items
    if note.action_items:
        lines.extend([
            "## 📌 주요 액션 아이템 & 키포인트",
            "",
            "\n".join([f"- [ ] {item}" for item in note.action_items]),
            "",
        ])

    # 5. Speaker Diarization
    if note.diarization_transcript:
        lines.extend([
            "## 👥 화자 분리 대화록 (Speaker Diarization)",
            "",
            note.diarization_transcript,
            "",
        ])

    # 6. Smart Transcript
    if note.smart_transcript:
        lines.extend([
            "## 📝 정제된 전사문 (Smart Transcript)",
            "",
            note.smart_transcript,
            "",
        ])

    # 7. Raw Log
    if note.live_transcript:
        lines.extend([
            "## 🎙️ 실시간 원본 로그 (Raw Live Stream)",
            "",
            note.live_transcript,
            "",
        ])

    content = "\n".join(lines)
    md_path = DATA_DIR / f"{note.id}.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(content)
    return content


def update_note_memo(note_id: str, memo: str) -> Optional[Dict[str, Any]]:
    """Update user insight memo for a note and re-sync to Google Drive."""
    raw = get_note(note_id)
    if not raw:
        return None
    note = NoteItem(**raw)
    note.user_memo = memo
    return save_note(note)


def update_study_note(note_id: str, study_note: str) -> Optional[Dict[str, Any]]:
    """Update Gemini study note for a note and re-sync to Google Drive."""
    raw = get_note(note_id)
    if not raw:
        return None
    note = NoteItem(**raw)
    note.study_note = study_note
    return save_note(note)

