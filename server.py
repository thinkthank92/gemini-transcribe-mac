import os
import io
import wave
import uuid
import time
import json
import base64
import asyncio
import logging
from pathlib import Path
from typing import Optional, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import note_storage
import gemini_service
import calendar_service

logger = logging.getLogger("server")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Gemini Transcribe (Alt UX)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent
STATIC_DIR = BASE_DIR / "static"
AUDIO_DIR = BASE_DIR / "data" / "audio"
AUDIO_DIR.mkdir(parents=True, exist_ok=True)


class SettingsPayload(BaseModel):
    gemini_api_key: Optional[str] = None
    custom_vocab: Optional[List[str]] = None
    google_calendar_url: Optional[str] = None


class TitleUpdatePayload(BaseModel):
    title: str


class MemoUpdatePayload(BaseModel):
    memo: str


@app.get("/api/gdrive-status")
async def get_gdrive_status():
    gdrive_dir = note_storage.get_google_drive_dir()
    has_gdrive = bool(gdrive_dir and gdrive_dir.exists())
    return {
        "enabled": has_gdrive,
        "folder_path": str(gdrive_dir) if gdrive_dir else None,
        "display_name": "Google Drive (Gemini_Transcribe_녹음)" if has_gdrive else "미연결"
    }


@app.post("/api/gdrive-open")
async def open_gdrive_folder():
    import subprocess
    gdrive_dir = note_storage.get_google_drive_dir()
    if not gdrive_dir or not gdrive_dir.exists():
        raise HTTPException(status_code=404, detail="구글 드라이브 폴더를 찾을 수 없습니다.")
    subprocess.run(["open", str(gdrive_dir)])
    return {"status": "ok"}


@app.get("/api/calendar/current-event")
async def get_current_calendar_event():
    return await calendar_service.get_current_event()


@app.get("/api/settings")
async def get_settings():
    key = gemini_service.get_api_key()
    has_key = bool(key and len(key) > 5)
    masked_key = f"{key[:4]}...{key[-4:]}" if has_key else ""
    cal_url = calendar_service.get_calendar_url()
    has_cal = bool(cal_url and len(cal_url) > 10)
    return {
        "has_api_key": has_key,
        "masked_key": masked_key,
        "custom_vocab": gemini_service.get_custom_vocab(),
        "has_calendar_url": has_cal,
        "google_calendar_url": cal_url if cal_url else ""
    }


@app.post("/api/settings")
async def update_settings(payload: SettingsPayload):
    if payload.gemini_api_key is not None and payload.gemini_api_key.strip():
        gemini_service.set_api_key(payload.gemini_api_key.strip(), payload.custom_vocab)
    elif payload.custom_vocab is not None:
        gemini_service.set_api_key(gemini_service.get_api_key() or "", payload.custom_vocab)

    if payload.google_calendar_url is not None:
        calendar_service.set_calendar_url(payload.google_calendar_url)

    return {"status": "ok"}


@app.get("/api/notes")
async def get_notes():
    return note_storage.list_notes()


@app.get("/api/notes/{note_id}")
async def get_note_detail(note_id: str):
    note = note_storage.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@app.delete("/api/notes/{note_id}")
async def delete_note_endpoint(note_id: str):
    success = note_storage.delete_note(note_id)
    return {"status": "ok", "deleted": success}


@app.post("/api/notes/{note_id}/title")
async def update_title(note_id: str, payload: TitleUpdatePayload):
    raw_note = note_storage.get_note(note_id)
    if not raw_note:
        raise HTTPException(status_code=404, detail="Note not found")
    note = note_storage.NoteItem(**raw_note)
    note.title = payload.title
    updated = note_storage.save_note(note)
    return updated


@app.put("/api/notes/{note_id}/memo")
async def update_memo_endpoint(note_id: str, payload: MemoUpdatePayload):
    """Save user insight memo and auto-sync to Google Drive."""
    updated = note_storage.update_note_memo(note_id, payload.memo)
    if not updated:
        raise HTTPException(status_code=404, detail="Note not found")
    return updated


@app.post("/api/notes/{note_id}/generate-study-note")
async def generate_study_note_endpoint(note_id: str):
    """Synthesize transcript and user insight notes using Gemini 3.8 Flash."""
    raw_note = note_storage.get_note(note_id)
    if not raw_note:
        raise HTTPException(status_code=404, detail="Note not found")

    transcript = raw_note.get("smart_transcript") or raw_note.get("live_transcript") or ""
    user_memo = raw_note.get("user_memo") or ""
    title = raw_note.get("title") or ""

    if not transcript.strip() and not user_memo.strip():
        raise HTTPException(status_code=400, detail="전사문이나 작성된 메모가 없어 정리 노트를 생성할 수 없습니다.")

    try:
        study_note = await gemini_service.generate_study_note(
            transcript=transcript,
            user_memo=user_memo,
            note_title=title
        )
    except Exception as e:
        logger.error(f"Error generating study note: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    updated = note_storage.update_study_note(note_id, study_note)
    return updated


@app.get("/api/notes/{note_id}/download-md")
async def download_markdown(note_id: str):
    md_path = note_storage.DATA_DIR / f"{note_id}.md"
    if not md_path.exists():
        raw_note = note_storage.get_note(note_id)
        if not raw_note:
            raise HTTPException(status_code=404, detail="Note not found")
        note = note_storage.NoteItem(**raw_note)
        note_storage.generate_markdown_file(note)

    return FileResponse(
        path=md_path,
        media_type="text/markdown",
        filename=f"transcribe_{note_id[:8]}.md"
    )


@app.post("/api/upload-audio")
async def upload_audio_file(
    file: UploadFile = File(...),
    custom_vocab: Optional[str] = Form(None),
    user_memo: Optional[str] = Form(None)
):
    """Allow uploading pre-recorded audio file (.mp3, .m4a, .wav) to transcribe directly."""
    note_id = str(uuid.uuid4())
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    saved_audio_path = AUDIO_DIR / f"{note_id}{suffix}"

    content = await file.read()
    with open(saved_audio_path, "wb") as f:
        f.write(content)

    vocab_list = [v.strip() for v in custom_vocab.split(",") if v.strip()] if custom_vocab else None

    # Process using Gemini
    try:
        analysis = await gemini_service.process_full_audio(
            audio_path=str(saved_audio_path),
            raw_live_text="",
            custom_vocab=vocab_list
        )
    except Exception as e:
        logger.error(f"Error processing uploaded audio: {e}")
        raise HTTPException(status_code=500, detail=str(e))

    note_item = note_storage.NoteItem(
        id=note_id,
        title=analysis.get("title") or (file.filename or "업로드 음성 노트"),
        audio_path=str(saved_audio_path),
        live_transcript=analysis.get("smart_transcript", ""),
        smart_transcript=analysis.get("smart_transcript", ""),
        diarization_transcript=analysis.get("diarization_transcript", ""),
        summary=analysis.get("summary", ""),
        action_items=analysis.get("action_items", []),
        tags=analysis.get("tags", ["업로드"]),
        user_memo=user_memo or ""
    )
    saved = note_storage.save_note(note_item)
    return saved


@app.websocket("/ws/live")
async def websocket_live_transcribe(websocket: WebSocket):
    """
    WebSocket endpoint for real-time live streaming audio transcription.
    Handles:
    - Inbound PCM audio frames from browser microphone (16kHz 16-bit mono)
    - Relay to Gemini Live API
    - Outbound live text streaming to browser
    - Post-processing when recording stops
    """
    await websocket.accept()
    logger.info("Client connected to /ws/live")

    note_id = str(uuid.uuid4())
    pcm_audio_buffer = bytearray()
    raw_live_tokens = []
    client_user_memo = ""
    live_session = None
    receive_task = None
    start_time = time.time()

    try:
        # Check API key
        api_key = gemini_service.get_api_key()
        if not api_key:
            await websocket.send_json({
                "type": "error",
                "message": "Gemini API Key가 설정되지 않았습니다. 우측 상단 설정에서 API Key를 입력해주세요."
            })
            await websocket.close()
            return

        live_session = gemini_service.LiveTranscribeSession(api_key=api_key)
        try:
            await live_session.connect()
            await websocket.send_json({"type": "status", "message": "Gemini Live 연결 완료. 발화를 시작하세요."})
        except Exception as e:
            logger.warning(f"Could not connect live session: {e}. Falling back to recording & post-transcription mode.")
            await websocket.send_json({
                "type": "warning",
                "message": f"실시간 스트리밍 모델 연결 지연({e}). 녹음 완료 후 고정밀 스마트 전사로 자동 전환됩니다."
            })
            live_session = None

        # Background task to push live text events to frontend
        async def stream_gemini_to_client():
            if not live_session:
                return
            while True:
                msg = await live_session.get_next_message()
                if not msg:
                    break
                m_type = msg.get("type")
                text = msg.get("text", "")
                if text:
                    raw_live_tokens.append(text)
                    await websocket.send_json({
                        "type": "live_text",
                        "text": text,
                        "is_interim": (m_type == "interim")
                    })

        if live_session:
            receive_task = asyncio.create_task(stream_gemini_to_client())

        # Main message loop receiving audio from browser
        while True:
            # We can receive either binary PCM frames or JSON control messages
            message = await websocket.receive()
            if "bytes" in message and message["bytes"]:
                chunk = message["bytes"]
                pcm_audio_buffer.extend(chunk)
                if live_session and live_session.is_connected:
                    await live_session.send_audio_chunk(chunk)

            elif "text" in message and message["text"]:
                try:
                    payload = json.loads(message["text"])
                except Exception:
                    continue

                p_type = payload.get("type")

                if p_type == "audio_chunk":
                    # Base64 encoded audio chunk
                    b64_data = payload.get("data", "")
                    if b64_data:
                        chunk = base64.b64decode(b64_data)
                        pcm_audio_buffer.extend(chunk)
                        if live_session and live_session.is_connected:
                            await live_session.send_audio_chunk(chunk)

                elif p_type == "memo_draft":
                    client_user_memo = payload.get("memo", "")

                elif p_type == "stop":
                    logger.info("Received stop command from client")
                    if "user_memo" in payload:
                        client_user_memo = payload.get("user_memo", "")
                    break

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected by client")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        duration = time.time() - start_time
        # Clean up live streaming tasks
        if receive_task:
            receive_task.cancel()
        if live_session:
            await live_session.close()

        # If audio was recorded, save to WAV and perform post-processing
        if len(pcm_audio_buffer) > 3200:  # at least ~0.1s of audio
            wav_path = AUDIO_DIR / f"{note_id}.wav"
            try:
                # Write 16kHz, 16bit, Mono WAV
                with wave.open(str(wav_path), "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(16000)
                    wf.writeframes(bytes(pcm_audio_buffer))

                try:
                    await websocket.send_json({
                        "type": "status",
                        "message": "녹음 완료! Gemini 3.5 고정밀 스마트 전사 및 AI 요약 분석 중..."
                    })
                except Exception:
                    pass

                raw_live_text = "".join(raw_live_tokens).strip()

                # Call Gemini post-processing
                analysis = await gemini_service.process_full_audio(
                    audio_path=str(wav_path),
                    raw_live_text=raw_live_text
                )

                note_item = note_storage.NoteItem(
                    id=note_id,
                    title=analysis.get("title") or f"{time.strftime('%m/%d %H:%M')} 음성 기록",
                    duration_seconds=round(duration, 1),
                    audio_path=str(wav_path),
                    live_transcript=raw_live_text,
                    smart_transcript=analysis.get("smart_transcript", raw_live_text),
                    diarization_transcript=analysis.get("diarization_transcript", ""),
                    summary=analysis.get("summary", ""),
                    action_items=analysis.get("action_items", []),
                    tags=analysis.get("tags", ["음성기록"]),
                    user_memo=client_user_memo
                )
                saved = note_storage.save_note(note_item)

                try:
                    await websocket.send_json({
                        "type": "complete",
                        "note": saved
                    })
                except Exception:
                    pass

            except Exception as e:
                logger.error(f"Error finalizing recording: {e}")
                try:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"분석 중 오류 발생: {e}"
                    })
                except Exception:
                    pass


# Mount static files
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/")
async def get_index():
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return HTMLResponse("<h1>Gemini Transcribe</h1><p>Static files loading...</p>")
