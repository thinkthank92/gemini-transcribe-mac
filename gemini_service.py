import os
import io
import json
import asyncio
import logging
from pathlib import Path
from typing import Optional, AsyncGenerator, Dict, Any, List
from dotenv import load_dotenv

# Load local .env if present
ENV_PATH = Path(__file__).parent / ".env"
load_dotenv(ENV_PATH)

from google import genai
from google.genai import types

logger = logging.getLogger("gemini_service")
logging.basicConfig(level=logging.INFO)

CONFIG_FILE = Path(__file__).parent / "data" / "config.json"


def get_api_key() -> Optional[str]:
    """Retrieve Gemini API key from file, env, or settings."""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                key = data.get("gemini_api_key")
                if key:
                    return key.strip()
        except Exception:
            pass
    return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")


def set_api_key(key: str, custom_vocab: Optional[List[str]] = None):
    """Save Gemini API key and settings locally."""
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {}
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    data["gemini_api_key"] = key.strip()
    if custom_vocab is not None:
        data["custom_vocab"] = custom_vocab
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def get_custom_vocab() -> List[str]:
    """Get custom vocabulary terms."""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return data.get("custom_vocab", [])
        except Exception:
            pass
    return []


def get_client(api_key: Optional[str] = None) -> genai.Client:
    key = api_key or get_api_key()
    if not key:
        raise ValueError("Gemini API Key가 등록되어 있지 않습니다. 설정(Settings)에서 키를 입력해주세요.")
    return genai.Client(api_key=key)


class LiveTranscribeSession:
    """Manages real-time streaming speech-to-text via Gemini Live API."""

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or get_api_key()
        self.client = get_client(self.api_key)
        self.live_session = None
        self.is_connected = False
        self._receive_task = None
        self._output_queue = asyncio.Queue()

    async def connect(self):
        """Establish connection with Gemini Live API."""
        models_to_try = [
            "gemini-3.5-transcribe-live",
            "gemini-3.1-flash-live-preview",
            "gemini-3.6-flash"
        ]

        last_err = None
        for model in models_to_try:
            try:
                logger.info(f"Connecting to Gemini Live with model: {model}")
                # We configure for pure text output transcription
                try:
                    config = types.LiveConnectConfig(
                        response_modalities=["TEXT"],
                        input_audio_transcription=types.AudioTranscriptionConfig(
                            mode="SMART"
                        ),
                        system_instruction=types.Content(
                            parts=[
                                types.Part.from_text(
                                    text=(
                                        "You are an ultra-accurate real-time speech transcription assistant. "
                                        "Transcribe what the user says into clean, grammatically correct text in real-time. "
                                        "Do not respond to questions or engage in conversation. ONLY transcribe."
                                    )
                                )
                            ]
                        )
                    )
                except Exception:
                    # Fallback config without specific AudioTranscriptionConfig if version varies
                    config = types.LiveConnectConfig(
                        response_modalities=["TEXT"]
                    )

                self.live_context = self.client.aio.live.connect(
                    model=model,
                    config=config
                )
                self.live_session = await self.live_context.__aenter__()
                self.is_connected = True
                self._receive_task = asyncio.create_task(self._listen_loop())
                logger.info(f"Successfully connected to Gemini Live model: {model}")
                return
            except Exception as e:
                logger.warning(f"Failed to connect using model {model}: {e}")
                last_err = e
                continue

        raise RuntimeError(f"Could not connect to any Gemini Live model: {last_err}")

    async def send_audio_chunk(self, pcm_bytes: bytes):
        """Send a chunk of 16kHz 16-bit mono PCM audio to the live session."""
        if not self.is_connected or not self.live_session:
            return

        try:
            await self.live_session.send_realtime_input(
                media=types.Blob(
                    data=pcm_bytes,
                    mime_type="audio/pcm;rate=16000"
                )
            )
        except Exception as e:
            logger.error(f"Error sending audio chunk to Gemini Live: {e}")

    async def _listen_loop(self):
        """Listen for transcription events from Gemini Live."""
        try:
            async for message in self.live_session.receive():
                # 1. Check for dedicated input transcription events
                server_content = getattr(message, "server_content", None)
                if server_content:
                    interim = getattr(server_content, "interim_input_transcription", None)
                    if interim:
                        txt = getattr(interim, "text", "") or str(interim)
                        if txt:
                            await self._output_queue.put({"type": "interim", "text": txt})

                    in_trans = getattr(server_content, "input_transcription", None)
                    if in_trans:
                        txt = getattr(in_trans, "text", "") or str(in_trans)
                        if txt:
                            await self._output_queue.put({"type": "final", "text": txt})

                    # 2. Check model turn text if standard Live model
                    model_turn = getattr(server_content, "model_turn", None)
                    if model_turn and hasattr(model_turn, "parts"):
                        for part in model_turn.parts:
                            if hasattr(part, "text") and part.text:
                                await self._output_queue.put({"type": "chunk", "text": part.text})

                # Also check direct message text
                if hasattr(message, "text") and message.text:
                    await self._output_queue.put({"type": "chunk", "text": message.text})

        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in Gemini Live receive loop: {e}")
            await self._output_queue.put({"type": "error", "text": str(e)})

    async def get_next_message(self) -> Optional[Dict[str, Any]]:
        """Get the next transcribed chunk/event from the queue."""
        try:
            return await self._output_queue.get()
        except asyncio.CancelledError:
            return None

    async def close(self):
        """Gracefully close the live session."""
        self.is_connected = False
        if self._receive_task:
            self._receive_task.cancel()
            try:
                await self._receive_task
            except asyncio.CancelledError:
                pass
        if self.live_session and hasattr(self, "live_context"):
            try:
                await self.live_context.__aexit__(None, None, None)
            except Exception as e:
                logger.debug(f"Exception during Live session exit: {e}")


async def process_full_audio(
    audio_path: str,
    raw_live_text: str = "",
    custom_vocab: Optional[List[str]] = None,
    api_key: Optional[str] = None
) -> Dict[str, Any]:
    """
    Process full recorded audio after recording stops.
    Performs:
    1. Smart Transcription (filler words removal, punctuation, paragraphing)
    2. Speaker Diarization (speaker tags)
    3. Executive Summary and Action Items
    4. Auto-title generation
    """
    client = get_client(api_key)
    vocab = custom_vocab or get_custom_vocab()
    vocab_str = ", ".join(vocab) if vocab else "없음"

    # Read audio bytes
    audio_file = Path(audio_path)
    if not audio_file.exists():
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    with open(audio_file, "rb") as f:
        audio_bytes = f.read()

    # Determine audio mime type
    suffix = audio_file.suffix.lower()
    mime_type = "audio/wav" if suffix == ".wav" else "audio/mp3" if suffix == ".mp3" else "audio/m4a"

    system_prompt = f"""
당신은 세계 최고 수준의 한국어/영어 음성 전사 및 회의록 분석 전문가입니다.
사용자가 녹음한 오디오와 실시간으로 임시 전사된 원본 텍스트(Raw Text)를 바탕으로, 아래 요구사항을 완벽히 충족하는 JSON 객체를 생성하십시오.

[분석 요구사항]
1. Smart Transcription (정제된 전사문):
   - "어", "음", "그", "아", "저기" 등 불필요한 추임새 및 반복되는 말실수(stuttering)를 완전히 제거합니다.
   - 문맥과 어조를 살려 완전하고 자연스러운 한국어 문장으로 정돈하고 문단 구분을 적용합니다.
   - 전문 용어 힌트({vocab_str})가 오디오에 등장하면 정확하게 반영합니다.

2. Speaker Diarization (화자 분리 대화록):
   - 목소리와 발언 흐름을 분석하여 `[화자 1]`, `[화자 2]` 등으로 화자를 구분하고 발언 내용을 정리합니다.
   - 단독 화자(발표/독백)일 경우 `[발표자]`로 통일합니다.

3. Executive Summary (AI 핵심 요약):
   - 전체 대화/발언의 핵심 논지와 주요 내용을 3~6개의 명확한 글머리 기호(- )로 요약합니다.

4. Action Items (액션 아이템 & 키포인트):
   - 언급된 후속 작업, 결정 사항, 실천 과제 또는 핵심 체크포인트를 간결한 문장 목록으로 추출합니다. 없으면 빈 배열.

5. Title & Tags:
   - 본 녹음 내용을 가장 잘 나타내는 직관적인 제목(Title)을 15자 이내로 짓고, 핵심 키워드 태그(2~4개)를 생성합니다.

반드시 다음 필드를 포함하는 순수 JSON(Markdown 코드블록 없이 또는 ```json ... ``` 형식)으로만 응답하십시오:
{{
  "title": "...",
  "smart_transcript": "...",
  "diarization_transcript": "...",
  "summary": "...",
  "action_items": ["...", "..."],
  "tags": ["...", "..."]
}}
"""

    models_to_try = [
        "gemini-3.6-flash",
        "gemini-3.5-flash",
        "gemini-3.1-flash-lite"
    ]

    # Create audio part
    audio_part = types.Part.from_bytes(
        data=audio_bytes,
        mime_type=mime_type
    )

    prompt_text = f"실시간으로 임시 기록된 텍스트:\n{raw_live_text if raw_live_text else '(없음)'}\n\n위 첨부된 오디오를 정밀하게 분석하여 요구된 JSON 형식으로 작성해 주십시오."

    response = None
    last_error = None
    for model_name in models_to_try:
        try:
            logger.info(f"Processing audio with model: {model_name}")
            response = client.models.generate_content(
                model=model_name,
                contents=[
                    audio_part,
                    prompt_text
                ],
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    temperature=0.2
                )
            )
            if response and response.text:
                break
        except Exception as e:
            logger.warning(f"Error calling {model_name}: {e}")
            last_error = e
            continue

    if not response or not response.text:
        # If audio upload failed (e.g. file too big for inline or API restriction), try text-only fallback using raw_live_text
        if raw_live_text:
            logger.info("Falling back to text-only processing from raw_live_text")
            response = client.models.generate_content(
                model="gemini-3.6-flash",
                contents=[prompt_text],
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    response_mime_type="application/json",
                    temperature=0.2
                )
            )

    if not response or not response.text:
        raise RuntimeError(f"Audio processing failed: {last_error}")

    text_resp = response.text.strip()
    if text_resp.startswith("```json"):
        text_resp = text_resp[7:]
    if text_resp.startswith("```"):
        text_resp = text_resp[3:]
    if text_resp.endswith("```"):
        text_resp = text_resp[:-3]
    text_resp = text_resp.strip()

    try:
        result = json.loads(text_resp)
        return result
    except Exception as e:
        logger.error(f"Failed to parse JSON response: {e}, raw: {text_resp}")
        return {
            "title": "음성 전사 기록",
            "smart_transcript": text_resp,
            "diarization_transcript": raw_live_text,
            "summary": "AI 요약 생성 중 형식이 다소 불일치했습니다. 정제된 본문을 확인해 주세요.",
            "action_items": [],
            "tags": ["음성기록"]
        }
