#!/bin/bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

APP_DIR="/Applications/Gemini Transcribe.app"
echo "🔨 Building Gemini Transcribe.app in /Applications..."

rm -rf "$APP_DIR"
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Resources"

# Copy Icon
if [ -f "$DIR/AppIcon.icns" ]; then
    cp "$DIR/AppIcon.icns" "$APP_DIR/Contents/Resources/AppIcon.icns"
fi

# PkgInfo
echo -n "APPL????" > "$APP_DIR/Contents/PkgInfo"

# Info.plist
cat << 'EOF' > "$APP_DIR/Contents/Info.plist"
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleDevelopmentRegion</key>
    <string>ko_KR</string>
    <key>CFBundleDisplayName</key>
    <string>Gemini Transcribe</string>
    <key>CFBundleExecutable</key>
    <string>Gemini Transcribe</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleIdentifier</key>
    <string>com.nodongjun.gemini-transcribe</string>
    <key>CFBundleInfoDictionaryVersion</key>
    <string>6.0</string>
    <key>CFBundleName</key>
    <string>Gemini Transcribe</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSHighResolutionCapable</key>
    <true/>
    <key>NSMicrophoneUsageDescription</key>
    <string>음성을 실시간으로 전사하기 위해 마이크 권한이 필요합니다.</string>
</dict>
</plist>
EOF

# Launcher
cat << EOF > "$APP_DIR/Contents/MacOS/Gemini Transcribe"
#!/bin/bash
PROJECT_DIR="$DIR"
PORT=8765
URL="http://127.0.0.1:\$PORT"

if ! curl -s --max-time 1 "\$URL/api/settings" >/dev/null 2>&1; then
    cd "\$PROJECT_DIR"
    nohup "\$PROJECT_DIR/.venv/bin/uvicorn" server:app --host 127.0.0.1 --port \$PORT > "\$PROJECT_DIR/data/server.log" 2>&1 &
    for i in {1..30}; do
        if curl -s --max-time 1 "\$URL/api/settings" >/dev/null 2>&1; then
            break
        fi
        sleep 0.2
    done
fi

if [ -d "/Applications/Google Chrome.app" ]; then
    open -na "Google Chrome" --args --app="\$URL" --window-size=1200,820
else
    open "\$URL"
fi
EOF

chmod +x "$APP_DIR/Contents/MacOS/Gemini Transcribe"

# Register with LaunchServices
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$APP_DIR" 2>/dev/null || true

echo "✅ Gemini Transcribe.app successfully installed in /Applications!"
echo "Spotlight(Cmd+Space) or Launchpad에서 'Gemini Transcribe'를 검색해 실행하세요."
