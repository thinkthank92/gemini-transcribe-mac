#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "========================================================"
echo "✨ Gemini 3.5 Transcribe (Alt-style AI Audio Notes)"
echo "========================================================"

# Check virtualenv
if [ ! -d ".venv" ]; then
    echo "가상환경(.venv)을 생성하고 패키지를 설치합니다..."
    uv venv .venv
    uv pip install -r requirements.txt
fi

PORT=8765
URL="http://127.0.0.1:$PORT"

echo "서버를 실행합니다: $URL"
echo "브라우저에서 마이크 권한을 허용해 주십시오."

# Launch browser after a brief delay in background
(sleep 1.5 && open "$URL") &

# Start Uvicorn
exec "$DIR/.venv/bin/uvicorn" server:app --host 127.0.0.1 --port $PORT --reload
