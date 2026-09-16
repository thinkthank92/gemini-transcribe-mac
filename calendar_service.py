import os
import json
import time
import httpx
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any, List
from dateutil import tz
import icalendar

logger = logging.getLogger("calendar_service")
CONFIG_FILE = Path(__file__).parent / "data" / "config.json"
CACHE_FILE = Path(__file__).parent / "data" / "calendar_cache.ics"

_cached_events: Optional[List[Dict[str, Any]]] = None
_last_fetch_time: float = 0
CACHE_DURATION_SECONDS = 300  # 5 minutes


def get_calendar_url() -> Optional[str]:
    """Retrieve saved Google Calendar iCal URL."""
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                url = data.get("google_calendar_url")
                if url:
                    return url.strip()
        except Exception:
            pass
    return os.getenv("GOOGLE_CALENDAR_ICAL_URL")


def set_calendar_url(url: str):
    """Save Google Calendar iCal URL."""
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    data = {}
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            pass
    data["google_calendar_url"] = url.strip()
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    # Invalidate in-memory cache
    global _last_fetch_time
    _last_fetch_time = 0


async def fetch_calendar_data(url: str) -> Optional[str]:
    """Fetch iCal (.ics) data from Google Calendar URL."""
    global _last_fetch_time
    now = time.time()

    # Use disk cache if recent
    if CACHE_FILE.exists() and (now - _last_fetch_time < CACHE_DURATION_SECONDS):
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            pass

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code == 200:
                content = resp.text
                with open(CACHE_FILE, "w", encoding="utf-8") as f:
                    f.write(content)
                _last_fetch_time = now
                return content
            else:
                logger.warning(f"Failed to fetch calendar: HTTP {resp.status_code}")
    except Exception as e:
        logger.error(f"Error fetching iCal feed: {e}")

    # Fallback to existing cache if network error
    if CACHE_FILE.exists():
        try:
            with open(CACHE_FILE, "r", encoding="utf-8") as f:
                return f.read()
        except Exception:
            pass

    return None


def parse_datetime(dt_prop) -> Optional[datetime]:
    """Normalize iCalendar date/datetime to timezone-aware UTC datetime."""
    if dt_prop is None:
        return None
    val = getattr(dt_prop, "dt", dt_prop)
    if isinstance(val, datetime):
        if val.tzinfo is None:
            # Assume local system timezone
            local_tz = tz.tzlocal()
            val = val.replace(tzinfo=local_tz)
        return val.astimezone(timezone.utc)
    elif isinstance(val, (datetime, icalendar.prop.vDDDTypes)):
        return val
    elif hasattr(val, "year") and hasattr(val, "month") and hasattr(val, "day"):
        # Whole-day event date
        dt = datetime(val.year, val.month, val.day, 0, 0, 0, tzinfo=tz.tzlocal())
        return dt.astimezone(timezone.utc)
    return None


async def get_current_event(custom_url: Optional[str] = None) -> Dict[str, Any]:
    """
    Find event that matches current time:
    - Ongoing event: start <= now <= end
    - Soon upcoming: start is within 15 minutes
    """
    url = custom_url or get_calendar_url()
    if not url:
        return {
            "has_event": False,
            "has_calendar_url": False,
            "title": None,
            "message": "구글 캘린더 iCal URL이 등록되지 않았습니다."
        }

    content = await fetch_calendar_data(url)
    if not content:
        return {
            "has_event": False,
            "has_calendar_url": True,
            "title": None,
            "message": "캘린더 데이터를 가져올 수 없습니다."
        }

    try:
        cal = icalendar.Calendar.from_ical(content)
        now_utc = datetime.now(timezone.utc)

        ongoing_events = []
        upcoming_events = []

        for component in cal.walk("VEVENT"):
            summary = str(component.get("summary", "일정"))
            start_dt = parse_datetime(component.get("dtstart"))
            end_dt = parse_datetime(component.get("dtend"))

            if not start_dt:
                continue
            if not end_dt:
                end_dt = start_dt + timedelta(hours=1)

            # Ongoing event
            if start_dt <= now_utc <= end_dt:
                ongoing_events.append({
                    "title": summary,
                    "location": str(component.get("location", "")),
                    "description": str(component.get("description", "")),
                    "start": start_dt.isoformat(),
                    "end": end_dt.isoformat(),
                    "is_ongoing": True
                })
            # Upcoming within 15 mins
            elif timedelta(0) <= (start_dt - now_utc) <= timedelta(minutes=15):
                upcoming_events.append({
                    "title": summary,
                    "location": str(component.get("location", "")),
                    "description": str(component.get("description", "")),
                    "start": start_dt.isoformat(),
                    "end": end_dt.isoformat(),
                    "is_ongoing": False
                })

        # Prioritize ongoing, then soonest upcoming
        if ongoing_events:
            ev = ongoing_events[0]
            return {
                "has_event": True,
                "has_calendar_url": True,
                "title": ev["title"],
                "event": ev,
                "type": "ongoing"
            }
        elif upcoming_events:
            upcoming_events.sort(key=lambda x: x["start"])
            ev = upcoming_events[0]
            return {
                "has_event": True,
                "has_calendar_url": True,
                "title": ev["title"],
                "event": ev,
                "type": "upcoming"
            }

        return {
            "has_event": False,
            "has_calendar_url": True,
            "title": None,
            "message": "현재 시간대에 진행 중인 일정이 없습니다."
        }

    except Exception as e:
        logger.error(f"Error parsing iCalendar: {e}")
        return {
            "has_event": False,
            "has_calendar_url": True,
            "title": None,
            "error": str(e)
        }
