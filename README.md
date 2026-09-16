# ✨ Gemini Transcribe

> **구글의 최신 Gemini 3.5 Transcribe를 탑재한 Mac용 실시간 AI 음성 전사 & 스마트 노트 애플리케이션**  
> 유료 구독료나 시간 제한 없이, 개인 Gemini API Key(무료)를 통해 마이크 음성을 실시간 전사하고 AI 요약 회의록을 자동 생성합니다.

[![License: MIT](https://img.shields.io/badge/License-MIT-purple.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/Platform-macOS-black.svg)]()
[![Model: Gemini 3.5](https://img.shields.io/badge/Engine-Gemini%203.5%20Transcribe-blue.svg)]()

---

## 🌟 주요 특징

1. **저지연 실시간 스트리밍 전사 (Live Streaming)**
   - 브라우저의 고성능 Web Audio API(16kHz PCM 모노)를 통해 발화 즉시 글자가 화면에 타이핑되는 실시간 피드 제공.
   - `gemini-3.5-transcribe-live` 기반 양방향 WebSocket 통신.

2. **스마트 정제 (Smart Mode) & 추임새 제거**
   - 녹음 종료 시 "어", "음", "그" 등 불필요한 말버릇과 반복 말실수를 문맥에 맞춰 완벽히 정돈.
   - 단락과 문장 구조를 출판물 수준의 가독성 높은 텍스트로 재구성.

3. **화자 분리 대화록 (Speaker Diarization)**
   - `[화자 1]`, `[화자 2]` 등 복수 발언자를 자동으로 식별하여 대화록 작성.

4. **AI 핵심 요약 & 액션 아이템 추출**
   - 3~5개 글머리 기호 형태의 핵심 논점 요약.
   - 체크리스트 형태의 후속 액션 아이템 자동 도출.

5. **📱 아이폰 연속성 마이크(Continuity Mic) 무선 연동**
   - Mac 근처에 있는 iPhone을 고음질 외장 마이크로 자동 감지 (`📱 아이폰 마이크 감지됨` 배지).
   - 아이폰을 강의대나 발표자 근처에 두고, 맥북으로 실시간 전사 가능.

6. **📅 구글 캘린더 연동 (수업/회의 제목 자동 입력)**
   - 구글 캘린더 iCal 비공개 주소를 등록해 두면, 녹음 시작 시 **현재 진행 중이거나 곧 시작하는 일정의 제목을 노트 제목으로 자동 입력**.

7. **☁️ 구글 드라이브(Google Drive) 자동 클라우드 백업**
   - 녹음이 끝나는 즉시 원본 오디오(`.wav`)와 마크다운 회의록(`.md`)이 Mac의 구글 드라이브(`내 드라이브/Gemini_Transcribe_녹음`)로 자동 저장되어 아이폰·아이패드에서도 즉시 열람 가능.

8. **⏸️ 녹음 일시정지 & 재개**
   - 회의 중간 휴식 시 타이머와 오디오 전송을 잠시 멈추고 이어서 녹음 가능.

9. **🖥️ Mac 독립 데스크톱 앱 (`Gemini Transcribe.app`)**
   - 브라우저 창이 아닌 독립된 전용 앱 창(App Mode)으로 실행.
   - Spotlight(`Cmd + Space`), Launchpad, Dock 고정 지원.

---

## 🚀 빠른 시작 (Quick Start)

### 1. 저장소 클론 및 이동
```bash
git clone https://github.com/YOUR_USERNAME/gemini-transcribe-mac.git
cd gemini-transcribe-mac
```

### 2. 의존 패키지 설치
Python 3.10 이상이 필요합니다:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```
*(또는 빠른 설치를 위해 `uv pip install -r requirements.txt` 사용 가능)*

### 3. 앱 실행
```bash
./start.sh
```
서버가 기동되고 브라우저([http://127.0.0.1:8765](http://127.0.0.1:8765))가 자동으로 열립니다.

#### 💡 Mac 응용 프로그램에 등록하고 싶다면?
```bash
./build_app.sh
```
실행 시 `/Applications/Gemini Transcribe.app`이 생성되어 Spotlight(`Cmd + Space`)에서 앱처럼 바로 켤 수 있습니다.

---

## ⚙️ 설정 가이드

1. **Gemini API Key 등록 (필수)**
   - [Google AI Studio (ai.google.dev)](https://aistudio.google.com/)에서 무료 API 키를 발급받습니다.
   - 앱 화면 우측 하단 **설정(⚙️)**을 누르고 붙여넣은 뒤 저장합니다.
2. **구글 캘린더 연동 (선택)**
   - 구글 캘린더 웹 > [설정] > 내 캘린더 > [캘린더 통합] 메뉴의 **"iCal 형식의 비공개 주소"**를 복사해 앱 설정에 등록합니다.
3. **커스텀 어휘 사전 (선택)**
   - 자주 쓰는 학술 용어나 인명(예: 하우어워스, 지라르 등)을 쉼표로 등록하면 인식률이 극대화됩니다.

---

## 🔒 보안 및 개인정보 (Privacy & Security)

- **BYOK (Bring Your Own Key)**: 모든 음성 처리와 텍스트 분석은 사용자의 개인 API Key를 통해 사용자의 맥북과 Google Gemini API 간에 1:1 직접 통신으로 이루어집니다.
- **로컬 저장**: 녹음된 오디오와 생성된 노트는 오직 사용자의 로컬 디렉토리 및 개인 구글 드라이브에만 저장됩니다.

---

## 📄 라이선스 (License)

This project is licensed under the [MIT License](LICENSE).
*(본 프로젝트는 Google Gemini API를 활용한 비공식 오픈소스 프로젝트입니다.)*
