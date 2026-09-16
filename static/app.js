// Gemini Transcribe (Alt-like UX) Frontend Logic

let isRecording = false;
let audioContext = null;
let mediaStream = null;
let scriptProcessor = null;
let analyser = null;
let liveWebSocket = null;
let recordTimerInterval = null;
let recordStartTime = 0;
let activeNote = null;
let isPaused = false;
let pauseStartTime = 0;
let totalPausedDuration = 0;

// DOM Elements
const btnRecordToggle = document.getElementById("btn-record-toggle");
const btnPauseToggle = document.getElementById("btn-pause-toggle");
const pauseIcon = document.getElementById("pause-icon");
const btnFinishRecording = document.getElementById("btn-finish-recording");
const recordTimer = document.getElementById("record-timer");
const recordStatusLabel = document.getElementById("record-status-label");
const waveformCanvas = document.getElementById("waveform-canvas");
const canvasCtx = waveformCanvas.getContext("2d");

const livePanel = document.getElementById("live-panel");
const resultPanel = document.getElementById("result-panel");
const liveTranscriptBox = document.getElementById("live-transcript-box");
const streamingIndicator = document.getElementById("streaming-indicator");

const activeNoteTitle = document.getElementById("active-note-title");
const activeNoteDate = document.getElementById("active-note-date");
const activeNoteDuration = document.getElementById("active-note-duration");
const activeNoteCalendarBadge = document.getElementById("active-note-calendar-badge");
const activeNoteTags = document.getElementById("active-note-tags");

const summaryContent = document.getElementById("summary-content");
const actionItemsList = document.getElementById("action-items-list");
const smartTranscriptContent = document.getElementById("smart-transcript-content");
const diarizationTranscriptContent = document.getElementById("diarization-transcript-content");
const rawTranscriptContent = document.getElementById("raw-transcript-content");

const userMemoEditor = document.getElementById("user-memo-editor");
const memoSyncIndicator = document.getElementById("memo-sync-indicator");
const btnInsertTimestamp = document.getElementById("btn-insert-timestamp");
const btnSaveMemo = document.getElementById("btn-save-memo");
const btnGenerateStudyNote = document.getElementById("btn-generate-study-note");
const btnGenerateStudyNoteTab = document.getElementById("btn-generate-study-note-tab");
const studyGenerateSpinner = document.getElementById("study-generate-spinner");
const studyNoteContent = document.getElementById("study-note-content");
const studyNoteEmpty = document.getElementById("study-note-empty");
let memoAutosaveTimer = null;

const notesListEl = document.getElementById("notes-list");
const notesCountEl = document.getElementById("notes-count");
const noteSearchInput = document.getElementById("note-search");
const btnNewNote = document.getElementById("btn-new-note");

const btnCopyMd = document.getElementById("btn-copy-md");
const btnDownloadMd = document.getElementById("btn-download-md");
const btnUploadAudio = document.getElementById("btn-upload-audio");
const btnOpenGdrive = document.getElementById("btn-open-gdrive");
const audioFileInput = document.getElementById("audio-file-input");

const btnOpenSettings = document.getElementById("btn-open-settings");
const btnCloseSettings = document.getElementById("btn-close-settings");
const settingsModal = document.getElementById("settings-modal");
const inputApiKey = document.getElementById("input-api-key");
const btnToggleKeyVisibility = document.getElementById("btn-toggle-key-visibility");
const inputCustomVocab = document.getElementById("input-custom-vocab");
const inputCalendarUrl = document.getElementById("input-calendar-url");
const btnSaveSettings = document.getElementById("btn-save-settings");
const settingsFeedback = document.getElementById("settings-save-feedback");
const apiStatusIndicator = document.getElementById("api-status-indicator");

const loadingOverlay = document.getElementById("loading-overlay");
const loadingText = document.getElementById("loading-text");

const audioDeviceSelect = document.getElementById("audio-device-select");
const btnRefreshDevices = document.getElementById("btn-refresh-devices");
const iphoneDetectedBadge = document.getElementById("iphone-detected-badge");

// Initialize
document.addEventListener("DOMContentLoaded", () => {
  checkSettings();
  loadNotes();
  loadAudioDevices();
  setupEventListeners();
  setupWorkspaceResizer();
  drawIdleWaveform();

  // Listen for device connects/disconnects (e.g., iPhone continuity mic toggled)
  if (navigator.mediaDevices && navigator.mediaDevices.ondevicechange !== undefined) {
    navigator.mediaDevices.ondevicechange = () => {
      loadAudioDevices();
    };
  }
});

// Event Listeners
function setupEventListeners() {
  btnRecordToggle.addEventListener("click", toggleRecording);
  btnPauseToggle.addEventListener("click", togglePauseRecording);
  btnFinishRecording.addEventListener("click", stopRecording);
  btnNewNote.addEventListener("click", startNewNote);

  // Settings
  btnOpenSettings.addEventListener("click", openSettings);
  btnCloseSettings.addEventListener("click", closeSettings);
  btnSaveSettings.addEventListener("click", saveSettings);
  btnToggleKeyVisibility.addEventListener("click", () => {
    inputApiKey.type = inputApiKey.type === "password" ? "text" : "password";
    btnToggleKeyVisibility.textContent = inputApiKey.type === "password" ? "보기" : "숨김";
  });

  // Search
  noteSearchInput.addEventListener("input", filterNotes);

  // Tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const target = document.getElementById(btn.dataset.tab);
      if (target) target.classList.add("active");
    });
  });

  // Title edit
  activeNoteTitle.addEventListener("change", updateCurrentNoteTitle);

  // Markdown actions
  btnCopyMd.addEventListener("click", copyMarkdown);
  btnDownloadMd.addEventListener("click", downloadMarkdownFile);

  // Audio upload
  btnUploadAudio.addEventListener("click", () => audioFileInput.click());
  audioFileInput.addEventListener("change", handleAudioFileUpload);

  // Google Drive
  btnOpenGdrive.addEventListener("click", openGoogleDriveFolder);

  // Audio Device Refresh
  btnRefreshDevices.addEventListener("click", requestMicPermissionAndRefresh);
  audioDeviceSelect.addEventListener("click", () => {
    if (audioDeviceSelect.options.length <= 1 && audioDeviceSelect.options[0]?.text.includes("권한")) {
      requestMicPermissionAndRefresh();
    }
  });

  // Insight Notepad & Study Note
  if (userMemoEditor) {
    userMemoEditor.addEventListener("input", handleMemoInput);
  }
  if (btnSaveMemo) {
    btnSaveMemo.addEventListener("click", () => saveActiveNoteMemo(true));
  }
  if (btnInsertTimestamp) {
    btnInsertTimestamp.addEventListener("click", insertTimestampIntoMemo);
  }
  if (btnGenerateStudyNoteTab) {
    btnGenerateStudyNoteTab.addEventListener("click", generateStudyNoteWithGemini);
  }
  if (btnGenerateStudyNote) {
    btnGenerateStudyNote.addEventListener("click", generateStudyNoteWithGemini);
  }
}

// -------------------------------------------------------------
// Settings & API Key Check
// -------------------------------------------------------------
async function checkSettings() {
  try {
    const res = await fetch("/api/settings");
    const data = await res.json();
    if (data.has_api_key) {
      apiStatusIndicator.innerHTML = `
        <span class="status-dot success"></span>
        <span class="status-label">Gemini 연결됨 (${data.masked_key})</span>
      `;
    } else {
      apiStatusIndicator.innerHTML = `
        <span class="status-dot warning"></span>
        <span class="status-label">API Key 등록 필요</span>
      `;
      // Open settings if no key
      openSettings();
    }
    if (data.custom_vocab) {
      inputCustomVocab.value = data.custom_vocab.join(", ");
    }
    if (data.google_calendar_url) {
      inputCalendarUrl.value = data.google_calendar_url;
    }
  } catch (err) {
    console.error("Failed to check settings:", err);
  }
}

function openSettings() {
  settingsModal.classList.remove("hidden");
  settingsFeedback.classList.add("hidden");
}

function closeSettings() {
  settingsModal.classList.add("hidden");
}

async function saveSettings() {
  const key = inputApiKey.value.trim();
  const vocabRaw = inputCustomVocab.value.trim();
  const vocabList = vocabRaw ? vocabRaw.split(",").map(v => v.trim()).filter(Boolean) : [];
  const calUrl = inputCalendarUrl.value.trim();

  try {
    const payload = {};
    if (key) payload.gemini_api_key = key;
    payload.custom_vocab = vocabList;
    payload.google_calendar_url = calUrl;

    const res = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (res.ok) {
      settingsFeedback.textContent = "설정이 성공적으로 저장되었습니다!";
      settingsFeedback.className = "feedback-msg success";
      settingsFeedback.classList.remove("hidden");
      inputApiKey.value = "";
      setTimeout(() => {
        closeSettings();
        checkSettings();
      }, 900);
    }
  } catch (err) {
    alert("설정 저장 실패: " + err);
  }
}

// -------------------------------------------------------------
// Audio Input Device Enumeration & iPhone Continuity Mic
// -------------------------------------------------------------
async function requestMicPermissionAndRefresh() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    await loadAudioDevices();
  } catch (err) {
    alert("마이크 권한이 필요합니다. 브라우저 주소창 좌측의 설정/자물쇠 아이콘에서 마이크 권한을 '허용'해 주세요.");
  }
}

async function loadAudioDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === "audioinput");

    audioDeviceSelect.innerHTML = "";
    let hasIphone = false;
    let iphoneDevice = null;
    const preferredId = localStorage.getItem("preferred_audio_device");

    // Check if browser hid labels because permission hasn't been granted yet
    const hasLabels = audioInputs.some(d => d.label && d.label.trim().length > 0);

    if (!hasLabels && audioInputs.length > 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "👉 클릭하여 마이크 권한 허용 (장치 검색)";
      audioDeviceSelect.appendChild(opt);
      iphoneDetectedBadge.classList.add("hidden");
      return;
    }

    if (audioInputs.length === 0) {
      audioDeviceSelect.innerHTML = '<option value="">마이크 장치 없음</option>';
      return;
    }

    audioInputs.forEach((device, idx) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      let label = device.label || `마이크 장치 ${idx + 1}`;

      // Detect iPhone Continuity Microphone
      const isIphone = /iphone|아이폰/i.test(label);
      if (isIphone) {
        hasIphone = true;
        iphoneDevice = device;
        label = `📱 ${label}`;
      } else if (/macbook|built-in|내장/i.test(label)) {
        label = `💻 ${label}`;
      } else if (/airpod|headset|이어폰/i.test(label)) {
        label = `🎧 ${label}`;
      }

      option.textContent = label;
      if (preferredId === device.deviceId) {
        option.selected = true;
      }
      audioDeviceSelect.appendChild(option);
    });

    if (hasIphone && iphoneDevice) {
      iphoneDetectedBadge.classList.remove("hidden");
      iphoneDetectedBadge.textContent = `📱 아이폰 마이크 감지됨`;
      // Auto-select iPhone if no other preference exists
      if (!preferredId) {
        audioDeviceSelect.value = iphoneDevice.deviceId;
      }
    } else {
      iphoneDetectedBadge.classList.add("hidden");
    }

    audioDeviceSelect.onchange = () => {
      if (audioDeviceSelect.value === "") {
        requestMicPermissionAndRefresh();
        return;
      }
      localStorage.setItem("preferred_audio_device", audioDeviceSelect.value);
    };

  } catch (err) {
    console.error("Error loading audio devices:", err);
  }
}

// -------------------------------------------------------------
// Audio Recording & Web Audio API (16kHz PCM Little Endian)
// -------------------------------------------------------------
async function toggleRecording() {
  if (!isRecording) {
    await startRecording();
  } else {
    await stopRecording();
  }
}

async function startRecording() {
  try {
    // 1. Check API Key
    const setRes = await fetch("/api/settings");
    const setData = await setRes.json();
    if (!setData.has_api_key) {
      alert("먼저 우측 상단 설정(⚙️)에서 Gemini API Key를 등록해주세요!");
      openSettings();
      return;
    }

    // 2. Request mic access with selected device (iPhone / Mac mic)
    const selectedDeviceId = audioDeviceSelect.value;
    const audioConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    };
    if (selectedDeviceId) {
      audioConstraints.deviceId = { exact: selectedDeviceId };
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    } catch (deviceErr) {
      console.warn("Failed with selected device, falling back to default:", deviceErr);
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    // Refresh devices now that permission is granted
    await loadAudioDevices();

    // 3. Setup Web Audio Context
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioContext.createMediaStreamSource(mediaStream);

    // Setup Analyser for visualizer
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);

    // Setup ScriptProcessor for PCM audio extraction (bufferSize: 4096)
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(scriptProcessor);
    scriptProcessor.connect(audioContext.destination);

    // 4. Connect WebSocket
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws/live`;
    liveWebSocket = new WebSocket(wsUrl);
    liveWebSocket.binaryType = "arraybuffer";

    liveWebSocket.onopen = () => {
      console.log("WebSocket connected to Gemini Live");
      streamingIndicator.classList.remove("hidden");
      recordStatusLabel.textContent = "실시간 전사 중...";
    };

    liveWebSocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWebSocketMessage(data);
      } catch (err) {
        console.error("Error parsing WS message:", err);
      }
    };

    liveWebSocket.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    liveWebSocket.onclose = () => {
      console.log("WebSocket closed");
      streamingIndicator.classList.add("hidden");
    };

    // 5. Audio chunk processing & downsampling to 16kHz
    const targetSampleRate = 16000;
    const inputSampleRate = audioContext.sampleRate;

    scriptProcessor.onaudioprocess = (e) => {
      if (!isRecording || isPaused || !liveWebSocket || liveWebSocket.readyState !== WebSocket.OPEN) return;

      const inputData = e.inputBuffer.getChannelData(0);
      const downsampledBuffer = downsampleTo16k(inputData, inputSampleRate, targetSampleRate);
      const pcm16 = floatTo16BitPCM(downsampledBuffer);

      // Send raw binary PCM chunk
      liveWebSocket.send(pcm16);
    };

    // 6. UI Updates
    isRecording = true;
    isPaused = false;
    totalPausedDuration = 0;
    btnRecordToggle.classList.add("recording");
    btnPauseToggle.classList.remove("hidden");
    btnPauseToggle.classList.remove("paused");
    pauseIcon.textContent = "⏸️";
    btnFinishRecording.classList.remove("hidden");

    recordStartTime = Date.now();
    recordTimerInterval = setInterval(updateTimer, 1000);
    updateTimer();

    // Reset views
    livePanel.classList.remove("hidden");
    resultPanel.classList.add("hidden");
    liveTranscriptBox.innerHTML = '<span class="live-stream-text"></span><span class="live-interim"></span>';
    activeNoteCalendarBadge.classList.add("hidden");

    // Check Google Calendar for ongoing/upcoming event
    let initialTitle = `${new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} 음성 기록`;
    try {
      const calRes = await fetch("/api/calendar/current-event");
      const calData = await calRes.json();
      if (calData.has_event && calData.title) {
        initialTitle = calData.title;
        activeNoteCalendarBadge.classList.remove("hidden");
        const statusType = calData.type === "ongoing" ? "진행 중" : "곧 시작";
        activeNoteCalendarBadge.textContent = `📅 ${statusType}: ${calData.title}`;
        activeNoteTags.innerHTML = '<span class="tag-badge">#라이브</span> <span class="tag-badge">#캘린더</span>';
      } else {
        activeNoteTags.innerHTML = '<span class="tag-badge">#라이브</span>';
      }
    } catch (calErr) {
      activeNoteTags.innerHTML = '<span class="tag-badge">#라이브</span>';
    }
    activeNoteTitle.value = initialTitle;

    // Start wave visualizer
    drawActiveWaveform();

  } catch (err) {
    console.error("Microphone access error:", err);
    alert("마이크 접근 권한이 필요합니다: " + err.message);
  }
}

function downsampleTo16k(buffer, inputSampleRate, targetSampleRate) {
  if (inputSampleRate === targetSampleRate) return buffer;
  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function floatTo16BitPCM(float32Array) {
  const buffer = new ArrayBuffer(float32Array.length * 2);
  const view = new DataView(buffer);
  let offset = 0;
  for (let i = 0; i < float32Array.length; i++, offset += 2) {
    let s = Math.max(-1, Math.min(1, float32Array[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buffer;
}

function togglePauseRecording() {
  if (!isRecording) return;

  if (!isPaused) {
    // Pause recording
    isPaused = true;
    pauseStartTime = Date.now();
    clearInterval(recordTimerInterval);
    btnPauseToggle.classList.add("paused");
    pauseIcon.textContent = "▶️";
    btnPauseToggle.title = "녹음 계속하기";
    recordStatusLabel.textContent = "⏸️ 일시정지됨";
    drawIdleWaveform();
  } else {
    // Resume recording
    isPaused = false;
    totalPausedDuration += (Date.now() - pauseStartTime);
    recordTimerInterval = setInterval(updateTimer, 1000);
    btnPauseToggle.classList.remove("paused");
    pauseIcon.textContent = "⏸️";
    btnPauseToggle.title = "일시정지";
    recordStatusLabel.textContent = "실시간 전사 중...";
    drawActiveWaveform();
  }
}

async function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  isPaused = false;

  btnRecordToggle.classList.remove("recording");
  btnPauseToggle.classList.add("hidden");
  btnPauseToggle.classList.remove("paused");
  btnFinishRecording.classList.add("hidden");
  recordStatusLabel.textContent = "분석 중...";
  clearInterval(recordTimerInterval);

  // Stop media tracks
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => track.stop());
  }
  if (scriptProcessor) {
    scriptProcessor.disconnect();
  }
  if (audioContext && audioContext.state !== "closed") {
    audioContext.close();
  }

  // Show loading overlay
  loadingOverlay.classList.remove("hidden");
  loadingText.textContent = "Gemini 3.5 고정밀 스마트 전사 및 AI 요약 중...";

  // Tell server to stop and trigger full post-transcription, passing current user memo
  if (liveWebSocket && liveWebSocket.readyState === WebSocket.OPEN) {
    const memoText = userMemoEditor ? userMemoEditor.value : "";
    liveWebSocket.send(JSON.stringify({ type: "stop", user_memo: memoText }));
  }

  drawIdleWaveform();
}

function updateTimer() {
  const currentDuration = isPaused
    ? (pauseStartTime - recordStartTime - totalPausedDuration)
    : (Date.now() - recordStartTime - totalPausedDuration);
  const elapsedSec = Math.max(0, Math.floor(currentDuration / 1000));
  const mins = String(Math.floor(elapsedSec / 60)).padStart(2, "0");
  const secs = String(elapsedSec % 60).padStart(2, "0");
  recordTimer.textContent = `${mins}:${secs}`;
}

// -------------------------------------------------------------
// WebSocket Message Dispatcher
// -------------------------------------------------------------
function handleWebSocketMessage(data) {
  const streamSpan = liveTranscriptBox.querySelector(".live-stream-text");
  const interimSpan = liveTranscriptBox.querySelector(".live-interim");

  if (data.type === "live_text") {
    if (data.is_interim) {
      if (interimSpan) interimSpan.textContent = " " + data.text;
    } else {
      if (streamSpan) streamSpan.textContent += data.text + " ";
      if (interimSpan) interimSpan.textContent = "";
    }
    liveTranscriptBox.scrollTop = liveTranscriptBox.scrollHeight;

  } else if (data.type === "complete") {
    loadingOverlay.classList.add("hidden");
    recordStatusLabel.textContent = "완료됨";
    const note = data.note;
    activeNote = note;
    displayNoteDetail(note);
    loadNotes();

  } else if (data.type === "warning") {
    recordStatusLabel.textContent = data.message;

  } else if (data.type === "error") {
    loadingOverlay.classList.add("hidden");
    alert("오류: " + data.message);
  }
}

// -------------------------------------------------------------
// Canvas Waveform Visualizer
// -------------------------------------------------------------
function drawIdleWaveform() {
  if (animationFrameId) cancelAnimationFrame(animationFrameId);
  const width = waveformCanvas.width;
  const height = waveformCanvas.height;
  canvasCtx.clearRect(0, 0, width, height);

  canvasCtx.beginPath();
  canvasCtx.strokeStyle = "#383d47";
  canvasCtx.lineWidth = 2;
  canvasCtx.moveTo(0, height / 2);
  canvasCtx.lineTo(width, height / 2);
  canvasCtx.stroke();
}

function drawActiveWaveform() {
  if (!isRecording || isPaused || !analyser) return;

  const width = waveformCanvas.width;
  const height = waveformCanvas.height;
  const dataArray = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(dataArray);

  canvasCtx.clearRect(0, 0, width, height);
  canvasCtx.lineWidth = 2.5;

  const gradient = canvasCtx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "#7952ff");
  gradient.addColorStop(0.5, "#ef4444");
  gradient.addColorStop(1, "#38bdf8");
  canvasCtx.strokeStyle = gradient;

  canvasCtx.beginPath();
  const sliceWidth = width / dataArray.length;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * height) / 2;
    if (i === 0) canvasCtx.moveTo(x, y);
    else canvasCtx.lineTo(x, y);
    x += sliceWidth;
  }

  canvasCtx.lineTo(width, height / 2);
  canvasCtx.stroke();

  animationFrameId = requestAnimationFrame(drawActiveWaveform);
}

// -------------------------------------------------------------
// Notes Management & Rendering
// -------------------------------------------------------------
async function loadNotes() {
  try {
    const res = await fetch("/api/notes");
    const notes = await res.json();
    notesCountEl.textContent = notes.length;
    renderNotesList(notes);
  } catch (err) {
    console.error("Failed to load notes:", err);
  }
}

function renderNotesList(notes) {
  notesListEl.innerHTML = "";
  if (notes.length === 0) {
    notesListEl.innerHTML = '<div style="padding:12px;color:var(--text-faint);font-size:0.8rem;">기록된 노트가 없습니다.</div>';
    return;
  }

  notes.forEach(note => {
    const item = document.createElement("div");
    item.className = `note-item ${activeNote && activeNote.id === note.id ? "active" : ""}`;
    const dateStr = new Date(note.created_at * 1000).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
    const mins = Math.floor(note.duration_seconds / 60);
    const secs = Math.floor(note.duration_seconds % 60);
    const durationStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    item.innerHTML = `
      <div class="note-item-header">
        <span class="note-item-title">${escapeHtml(note.title)}</span>
        <span class="note-item-duration">${durationStr}</span>
      </div>
      <div class="note-item-preview">${escapeHtml(note.preview || "내용 없음")}</div>
      <div class="note-item-footer">
        <span>${dateStr}</span>
        <button class="btn-delete-note" title="삭제" onclick="deleteNote(event, '${note.id}')">🗑️</button>
      </div>
    `;

    item.addEventListener("click", () => selectNote(note.id));
    notesListEl.appendChild(item);
  });
}

async function selectNote(noteId) {
  try {
    const res = await fetch(`/api/notes/${noteId}`);
    if (!res.ok) return;
    const note = await res.json();
    activeNote = note;
    displayNoteDetail(note);

    document.querySelectorAll(".note-item").forEach(el => el.classList.remove("active"));
    loadNotes();
  } catch (err) {
    console.error("Failed to select note:", err);
  }
}

function displayNoteDetail(note) {
  // Switch panels
  livePanel.classList.add("hidden");
  resultPanel.classList.remove("hidden");

  // Meta
  activeNoteTitle.value = note.title || "무제 노트";
  const dateStr = new Date(note.created_at * 1000).toLocaleDateString("ko-KR", {
    year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit"
  });
  activeNoteDate.textContent = dateStr;
  const mins = Math.floor(note.duration_seconds / 60);
  const secs = Math.floor(note.duration_seconds % 60);
  activeNoteDuration.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  activeNoteTags.innerHTML = (note.tags || []).map(t => `<span class="tag-badge">#${escapeHtml(t)}</span>`).join("");

  if (note.tags && note.tags.includes("캘린더")) {
    activeNoteCalendarBadge.classList.remove("hidden");
    activeNoteCalendarBadge.textContent = "📅 캘린더 연동됨";
  } else {
    activeNoteCalendarBadge.classList.add("hidden");
  }

  // Tab 1: Summary (parsed with marked.js)
  summaryContent.innerHTML = marked.parse(note.summary || "*(요약 내용이 없습니다)*");

  actionItemsList.innerHTML = "";
  if (note.action_items && note.action_items.length > 0) {
    note.action_items.forEach(itemText => {
      const li = document.createElement("li");
      li.innerHTML = `
        <input type="checkbox">
        <span>${escapeHtml(itemText)}</span>
      `;
      const chk = li.querySelector("input");
      chk.addEventListener("change", () => {
        li.classList.toggle("checked", chk.checked);
      });
      actionItemsList.appendChild(li);
    });
  } else {
    actionItemsList.innerHTML = '<li style="color:var(--text-faint);border:none;">추출된 액션 아이템이 없습니다.</li>';
  }

  // Tab 2: Smart Transcript
  smartTranscriptContent.textContent = note.smart_transcript || "*(정제된 본문 없음)*";

  // Tab 3: Speaker Diarization
  diarizationTranscriptContent.textContent = note.diarization_transcript || note.smart_transcript || "";

  // Tab 4: Raw Log
  rawTranscriptContent.textContent = note.live_transcript || note.smart_transcript || "";

  // Populate User Insight Memo
  if (userMemoEditor) {
    userMemoEditor.value = note.user_memo || "";
    memoSyncIndicator.textContent = "☁️ Google Drive 동기화됨";
    memoSyncIndicator.classList.remove("syncing");
  }

  // Populate Gemini 3.8 Flash Study Note
  if (note.study_note && note.study_note.trim()) {
    studyNoteContent.innerHTML = marked.parse(note.study_note);
    studyNoteContent.classList.remove("hidden");
    studyNoteEmpty.classList.add("hidden");
    if (btnGenerateStudyNoteTab) {
      btnGenerateStudyNoteTab.innerHTML = '<span class="btn-icon">✨</span> Gemini 3.8 Flash 종합 정리 다시 생성';
    }
    activateTab("tab-study");
  } else {
    studyNoteContent.innerHTML = "";
    studyNoteContent.classList.add("hidden");
    studyNoteEmpty.classList.remove("hidden");
    if (btnGenerateStudyNoteTab) {
      btnGenerateStudyNoteTab.innerHTML = '<span class="btn-icon">✨</span> Gemini 3.8 Flash 종합 정리 생성';
    }
    activateTab("tab-study");
  }
}

function activateTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.tab === tabId);
  });
  document.querySelectorAll(".tab-pane").forEach(p => {
    p.classList.toggle("active", p.id === tabId);
  });
}

function handleMemoInput() {
  if (memoSyncIndicator) {
    memoSyncIndicator.textContent = "☁️ 동기화 중...";
    memoSyncIndicator.classList.add("syncing");
  }

  if (memoAutosaveTimer) {
    clearTimeout(memoAutosaveTimer);
  }

  memoAutosaveTimer = setTimeout(() => {
    saveActiveNoteMemo(false);
  }, 1000);
}

async function saveActiveNoteMemo(showNotification = false) {
  if (!userMemoEditor) return;
  const memoText = userMemoEditor.value;

  // If live recording is in progress, relay draft to backend buffer
  if (isRecording && liveWebSocket && liveWebSocket.readyState === WebSocket.OPEN) {
    liveWebSocket.send(JSON.stringify({ type: "memo_draft", memo: memoText }));
    if (memoSyncIndicator) {
      memoSyncIndicator.textContent = "☁️ 녹음 세션 임시 저장";
      memoSyncIndicator.classList.remove("syncing");
    }
    return;
  }

  // If saving to existing active note
  if (activeNote && activeNote.id) {
    try {
      const res = await fetch(`/api/notes/${activeNote.id}/memo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo: memoText })
      });
      if (res.ok) {
        const updated = await res.json();
        activeNote.user_memo = memoText;
        if (memoSyncIndicator) {
          memoSyncIndicator.textContent = "☁️ Google Drive 동기화됨";
          memoSyncIndicator.classList.remove("syncing");
        }
        if (showNotification) {
          alert("인사이트 메모가 맥북 로컬 및 구글 드라이브에 동기화되었습니다!");
        }
      } else {
        if (memoSyncIndicator) {
          memoSyncIndicator.textContent = "⚠️ 동기화 실패";
        }
      }
    } catch (err) {
      console.error("Failed to save memo:", err);
      if (memoSyncIndicator) {
        memoSyncIndicator.textContent = "⚠️ 연결 오류";
      }
    }
  } else {
    if (memoSyncIndicator) {
      memoSyncIndicator.textContent = "☁️ 로컬 작성 중";
      memoSyncIndicator.classList.remove("syncing");
    }
  }
}

function insertTimestampIntoMemo() {
  if (!userMemoEditor) return;
  let tag = "";
  if (isRecording) {
    const timerText = recordTimer.textContent || "00:00";
    tag = `[${timerText}] `;
  } else {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    tag = `[${hh}:${mm}] `;
  }

  const start = userMemoEditor.selectionStart;
  const end = userMemoEditor.selectionEnd;
  const text = userMemoEditor.value;
  userMemoEditor.value = text.substring(0, start) + tag + text.substring(end);
  userMemoEditor.selectionStart = userMemoEditor.selectionEnd = start + tag.length;
  userMemoEditor.focus();
  handleMemoInput();
}

async function generateStudyNoteWithGemini() {
  if (!activeNote || !activeNote.id) {
    alert("먼저 녹음을 완료하거나 좌측 목록에서 저장된 노트를 선택해 주세요.");
    return;
  }

  // Save current memo first
  await saveActiveNoteMemo(false);

  if (studyGenerateSpinner) studyGenerateSpinner.classList.remove("hidden");
  if (btnGenerateStudyNoteTab) btnGenerateStudyNoteTab.disabled = true;
  if (btnGenerateStudyNote) btnGenerateStudyNote.disabled = true;

  try {
    const res = await fetch(`/api/notes/${activeNote.id}/generate-study-note`, {
      method: "POST"
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "종합 정리 노트 생성에 실패했습니다.");
    }

    const updated = await res.json();
    activeNote = updated;

    if (updated.study_note) {
      studyNoteContent.innerHTML = marked.parse(updated.study_note);
      studyNoteContent.classList.remove("hidden");
      studyNoteEmpty.classList.add("hidden");
      if (btnGenerateStudyNoteTab) {
        btnGenerateStudyNoteTab.innerHTML = '<span class="btn-icon">✨</span> Gemini 3.8 Flash 종합 정리 다시 생성';
      }
      activateTab("tab-study");
      loadNotes();
    }
  } catch (err) {
    alert("Gemini 3.8 Flash 종합 정리 실패: " + err.message);
  } finally {
    if (studyGenerateSpinner) studyGenerateSpinner.classList.add("hidden");
    if (btnGenerateStudyNoteTab) btnGenerateStudyNoteTab.disabled = false;
    if (btnGenerateStudyNote) btnGenerateStudyNote.disabled = false;
  }
}

function startNewNote() {
  activeNote = null;
  livePanel.classList.remove("hidden");
  resultPanel.classList.add("hidden");
  liveTranscriptBox.innerHTML = '<p class="placeholder-text">아래 녹음 버튼(●)을 눌러 말씀하시면 Gemini 3.5 Transcribe가 실시간으로 텍스트를 전사합니다.</p>';
  activeNoteTitle.value = `${new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric" })} 새로운 기록`;
  activeNoteDate.textContent = "지금";
  activeNoteDuration.textContent = "00:00";
  activeNoteTags.innerHTML = "";
  activeNoteCalendarBadge.classList.add("hidden");
  recordTimer.textContent = "00:00";
  recordStatusLabel.textContent = "녹음 대기 중";

  if (userMemoEditor) {
    userMemoEditor.value = "";
    if (memoSyncIndicator) {
      memoSyncIndicator.textContent = "☁️ 준비됨";
      memoSyncIndicator.classList.remove("syncing");
    }
  }
  if (studyNoteContent) {
    studyNoteContent.innerHTML = "";
    studyNoteContent.classList.add("hidden");
  }
  if (studyNoteEmpty) {
    studyNoteEmpty.classList.remove("hidden");
  }
  if (btnGenerateStudyNoteTab) {
    btnGenerateStudyNoteTab.innerHTML = '<span class="btn-icon">✨</span> Gemini 3.8 Flash 종합 정리 생성';
  }
  activateTab("tab-study");
  loadNotes();
}

async function updateCurrentNoteTitle() {
  if (!activeNote) return;
  const newTitle = activeNoteTitle.value.trim();
  if (!newTitle) return;

  try {
    await fetch(`/api/notes/${activeNote.id}/title`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle })
    });
    activeNote.title = newTitle;
    loadNotes();
  } catch (err) {
    console.error("Failed to update title:", err);
  }
}

async function deleteNote(event, noteId) {
  event.stopPropagation();
  if (!confirm("이 음성 기록을 삭제하시겠습니까?")) return;

  try {
    await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
    if (activeNote && activeNote.id === noteId) {
      startNewNote();
    }
    loadNotes();
  } catch (err) {
    alert("삭제 실패: " + err);
  }
}

function filterNotes() {
  const q = noteSearchInput.value.toLowerCase().trim();
  const items = document.querySelectorAll(".note-item");
  items.forEach(item => {
    const title = item.querySelector(".note-item-title").textContent.toLowerCase();
    const prev = item.querySelector(".note-item-preview").textContent.toLowerCase();
    if (title.includes(q) || prev.includes(q)) {
      item.style.display = "";
    } else {
      item.style.display = "none";
    }
  });
}

// -------------------------------------------------------------
// Markdown Actions & Direct File Upload
// -------------------------------------------------------------
function copyMarkdown() {
  if (!activeNote) {
    alert("복사할 활성 노트가 없습니다.");
    return;
  }

  const mins = Math.floor(activeNote.duration_seconds / 60);
  const secs = Math.floor(activeNote.duration_seconds % 60);
  const durationStr = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const dateStr = new Date(activeNote.created_at * 1000).toLocaleString("ko-KR");

  const mdParts = [
    `# ${activeNote.title}`,
    `- **일시**: ${dateStr}`,
    `- **녹음 시간**: ${durationStr}`,
    `- **태그**: ${(activeNote.tags || []).map(t => '#' + t).join(' ')}`,
    '',
    '---',
    '',
  ];

  if (activeNote.user_memo && activeNote.user_memo.trim()) {
    mdParts.push('## ✍️ 나의 인사이트 메모 (User Memo)', '', activeNote.user_memo.trim(), '', '---', '');
  }

  if (activeNote.study_note && activeNote.study_note.trim()) {
    mdParts.push('## 📚 Gemini 3.8 Flash 종합 정리 노트', '', activeNote.study_note.trim(), '', '---', '');
  }

  mdParts.push(
    '## 💡 AI 핵심 요약',
    activeNote.summary || '',
    '',
    '## 📌 액션 아이템 & 키포인트',
    ...(activeNote.action_items || []).map(i => `- [ ] ${i}`),
    '',
    '## 📝 정제된 전사문 (Smart Transcript)',
    activeNote.smart_transcript || '',
    '',
    '## 👥 화자 분리 대화록',
    activeNote.diarization_transcript || '',
  );

  const md = mdParts.join('\n');

  navigator.clipboard.writeText(md).then(() => {
    alert("마크다운이 클립보드에 복사되었습니다! 옵시디언이나 노트에 붙여넣으세요.");
  }).catch(err => {
    alert("복사 실패: " + err);
  });
}

function downloadMarkdownFile() {
  if (!activeNote) {
    alert("다운로드할 활성 노트가 없습니다.");
    return;
  }
  window.open(`/api/notes/${activeNote.id}/download-md`, "_blank");
}

function copyPaneText(elementId) {
  const el = document.getElementById(elementId);
  if (!el) return;
  navigator.clipboard.writeText(el.innerText || el.textContent).then(() => {
    alert("텍스트가 복사되었습니다.");
  });
}

async function handleAudioFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  loadingOverlay.classList.remove("hidden");
  loadingText.textContent = `오디오 파일(${file.name}) 업로드 및 Gemini 전사 중...`;

  const formData = new FormData();
  formData.append("file", file);
  if (userMemoEditor && userMemoEditor.value.trim()) {
    formData.append("user_memo", userMemoEditor.value.trim());
  }

  try {
    const res = await fetch("/api/upload-audio", {
      method: "POST",
      body: formData
    });
    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.detail || "업로드 실패");
    }
    const note = await res.json();
    loadingOverlay.classList.add("hidden");
    activeNote = note;
    displayNoteDetail(note);
    loadNotes();
    alert("오디오 전사 및 요약이 완료되었습니다!");
  } catch (err) {
    loadingOverlay.classList.add("hidden");
    alert("오디오 전사 처리 실패: " + err.message);
  } finally {
    audioFileInput.value = "";
  }
}

async function openGoogleDriveFolder() {
  try {
    const res = await fetch("/api/gdrive-open", { method: "POST" });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "폴더를 열 수 없습니다.");
    }
  } catch (err) {
    alert("구글 드라이브 폴더 열기 실패: " + err.message);
  }
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// -------------------------------------------------------------
// Workspace Resizer (Draggable Splitter between Left & Right Panes)
// -------------------------------------------------------------
function setupWorkspaceResizer() {
  const container = document.getElementById("split-workspace");
  const leftPane = document.getElementById("workspace-left-pane");
  const rightPane = document.getElementById("workspace-right-pane");
  const resizer = document.getElementById("workspace-resizer");

  if (!container || !leftPane || !rightPane || !resizer) return;

  function applySplitRatio(leftPercent) {
    leftPane.style.flex = `0 0 ${leftPercent}%`;
    leftPane.style.width = `${leftPercent}%`;
    rightPane.style.flex = `0 0 ${100 - leftPercent}%`;
    rightPane.style.width = `${100 - leftPercent}%`;
  }

  // Restore saved ratio from localStorage (default 50:50)
  const savedRatio = localStorage.getItem("gemini_transcribe_split_ratio");
  if (savedRatio) {
    const ratio = parseFloat(savedRatio);
    if (!isNaN(ratio) && ratio >= 20 && ratio <= 80) {
      applySplitRatio(ratio);
    }
  }

  let isDragging = false;

  function onPointerDown(e) {
    if (e.button !== 0) return; // Left mouse only
    isDragging = true;
    resizer.classList.add("is-dragging");
    document.body.classList.add("resizing-active");
    resizer.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!isDragging) return;
    const containerRect = container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    if (containerWidth <= 0) return;

    const mouseX = e.clientX - containerRect.left;
    let leftPercent = (mouseX / containerWidth) * 100;

    // Minimum width constraint (min 260px for each side)
    const minPercent = (260 / containerWidth) * 100;
    const maxPercent = 100 - minPercent;

    leftPercent = Math.max(minPercent, Math.min(maxPercent, leftPercent));
    applySplitRatio(leftPercent);
  }

  function onPointerUp(e) {
    if (!isDragging) return;
    isDragging = false;
    resizer.classList.remove("is-dragging");
    document.body.classList.remove("resizing-active");
    try {
      resizer.releasePointerCapture(e.pointerId);
    } catch (_) {}

    // Save ratio to localStorage
    const containerRect = container.getBoundingClientRect();
    const leftRect = leftPane.getBoundingClientRect();
    if (containerRect.width > 0) {
      const ratio = (leftRect.width / containerRect.width) * 100;
      localStorage.setItem("gemini_transcribe_split_ratio", ratio.toFixed(1));
    }
  }

  // Double-click to reset back to 50:50
  resizer.addEventListener("dblclick", () => {
    applySplitRatio(50);
    localStorage.setItem("gemini_transcribe_split_ratio", "50");
  });

  resizer.addEventListener("pointerdown", onPointerDown);
  resizer.addEventListener("pointermove", onPointerMove);
  resizer.addEventListener("pointerup", onPointerUp);
  resizer.addEventListener("pointercancel", onPointerUp);
}

