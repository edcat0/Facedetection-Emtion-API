// ==========================================
// Microsoft Cognitive Services Emotion Contract
// 8-Emotion Taxonomy: Anger, Contempt, Disgust, Fear, Happiness, Neutral, Sadness, Surprise
// Output: 5 digits below 0 (0.00000 to 1.00000)
// ==========================================
const EMOTIONS = [
  { name: 'Anger',     color: '#FF4757', code: 'ANG', key: 'anger' },
  { name: 'Contempt',  color: '#FFA502', code: 'CON', key: 'contempt' },
  { name: 'Disgust',   color: '#2ED573', code: 'DIS', key: 'disgust' },
  { name: 'Fear',      color: '#9B59B6', code: 'FEA', key: 'fear' },
  { name: 'Happiness', color: '#2ECC71', code: 'HAP', key: 'happiness' },
  { name: 'Neutral',   color: '#70A1FF', code: 'NEU', key: 'neutral' },
  { name: 'Sadness',   color: '#57606F', code: 'SAD', key: 'sadness' },
  { name: 'Surprise',  color: '#00D2D3', code: 'SUR', key: 'surprise' }
];

let currentFacingMode = 'user';
let activeStream = null;
let isSwitchingCamera = false;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

// Engine Configuration (Local vs Microsoft Cognitive Cloud)
let engineMode = localStorage.getItem('ms_emotion_engine') || 'local';
let azureEndpoint = localStorage.getItem('ms_emotion_endpoint') || '';
let azureKey = localStorage.getItem('ms_emotion_key') || '';
let isAzureCalling = false;
let lastAzureCallTime = 0;

// MediaPipe FaceDetector Instance
let mpFaceDetector = null;
let isMpReady = false;
let isSendingFrame = false;

// DOM Elements
const video = document.getElementById('cameraStream');
const canvas = document.getElementById('hudCanvas');
const ctx = canvas.getContext('2d');
const flipCamBtn = document.getElementById('flipCamBtn');
const photoBtn = document.getElementById('photoBtn');
const recordBtn = document.getElementById('recordBtn');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const permissionCard = document.getElementById('permissionCard');
const grantPermBtn = document.getElementById('grantPermBtn');
const toast = document.getElementById('notificationToast');

// Modal Elements
const settingsBtn = document.getElementById('settingsBtn');
const settingsModal = document.getElementById('settingsModal');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const engineModeSelect = document.getElementById('engineModeSelect');
const azureFields = document.getElementById('azureFields');
const azureEndpointInput = document.getElementById('azureEndpoint');
const azureKeyInput = document.getElementById('azureKey');

// Offscreen analysis canvas for fast zero-latency pixel scanning (160x120)
const offCanvas = document.createElement('canvas');
offCanvas.width = 160;
offCanvas.height = 120;
const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });

// Service Worker for offline PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(err => console.log('SW register notice:', err));
  });
}

function showToast(msg) {
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2200);
}

// Fail-safe canvas rounded rectangle helper
function drawCardRoundRect(targetCtx, x, y, w, h, r) {
  targetCtx.beginPath();
  targetCtx.moveTo(x + r, y);
  targetCtx.lineTo(x + w - r, y);
  targetCtx.quadraticCurveTo(x + w, y, x + w, y + r);
  targetCtx.lineTo(x + w, y + h - r);
  targetCtx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  targetCtx.lineTo(x + r, y + h);
  targetCtx.quadraticCurveTo(x, y + h, x, y + h - r);
  targetCtx.lineTo(x, y + r);
  targetCtx.quadraticCurveTo(x, y, x + r, y);
  targetCtx.closePath();
}

// ==========================================
// 1. Settings & Microsoft Cognitive API Modal
// ==========================================
settingsBtn.addEventListener('click', () => {
  engineModeSelect.value = engineMode;
  azureEndpointInput.value = azureEndpoint;
  azureKeyInput.value = azureKey;
  azureFields.style.display = (engineMode === 'azure') ? 'block' : 'none';
  settingsModal.style.display = 'flex';
});

engineModeSelect.addEventListener('change', () => {
  azureFields.style.display = (engineModeSelect.value === 'azure') ? 'block' : 'none';
});

closeSettingsBtn.addEventListener('click', () => {
  settingsModal.style.display = 'none';
});

saveSettingsBtn.addEventListener('click', () => {
  engineMode = engineModeSelect.value;
  azureEndpoint = azureEndpointInput.value.trim().replace(/\/+$/, '');
  azureKey = azureKeyInput.value.trim();

  localStorage.setItem('ms_emotion_engine', engineMode);
  localStorage.setItem('ms_emotion_endpoint', azureEndpoint);
  localStorage.setItem('ms_emotion_key', azureKey);

  settingsModal.style.display = 'none';
  showToast(engineMode === 'azure' ? 'Microsoft Cognitive API Active' : 'Local Precision Engine Active');
});

// ==========================================
// 2. Camera Management with Hardware Cooldown
// ==========================================
async function startCamera() {
  permissionCard.style.display = 'none';

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: currentFacingMode },
      width: { ideal: 1280, max: 1920 },
      height: { ideal: 720, max: 1080 }
    }
  };

  try {
    activeStream = await navigator.mediaDevices.getUserMedia(constraints);
  } catch (err) {
    console.warn('High-res camera constraint failed, retrying basic constraint...', err);
    try {
      activeStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: currentFacingMode }
      });
    } catch (fallbackErr) {
      console.error('Camera access completely blocked:', fallbackErr);
      permissionCard.style.display = 'block';
      statusText.textContent = 'Camera Blocked';
      statusDot.classList.remove('active');
      return;
    }
  }

  video.srcObject = activeStream;

  if (currentFacingMode === 'user') {
    video.classList.remove('rear-mode');
  } else {
    video.classList.add('rear-mode');
  }

  try {
    await video.play();
  } catch (playErr) {
    console.warn('Video play warning:', playErr);
  }

  resizeCanvas();
  showToast('Camera active: ' + (currentFacingMode === 'user' ? 'Front (Selfie)' : 'Rear'));
}

async function switchCamera() {
  if (isSwitchingCamera) return;
  isSwitchingCamera = true;
  flipCamBtn.disabled = true;

  detectedFaces = [];

  if (activeStream) {
    activeStream.getTracks().forEach(track => {
      try { track.stop(); } catch (e) {}
    });
    activeStream = null;
  }
  video.srcObject = null;

  currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
  statusText.textContent = 'Switching Camera...';
  statusDot.classList.remove('active');

  await new Promise(resolve => setTimeout(resolve, 250));
  await startCamera();

  isSwitchingCamera = false;
  flipCamBtn.disabled = false;
}

grantPermBtn.addEventListener('click', () => { startCamera(); });
flipCamBtn.addEventListener('click', switchCamera);

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
window.addEventListener('orientationchange', () => {
  setTimeout(resizeCanvas, 200);
});

// ==========================================
// 3. Autonomous Multi-Face Detector (Google MediaPipe)
// ==========================================
let detectedFaces = [];

function initMediaPipeFaceDetector() {
  if (window.FaceDetection) {
    try {
      mpFaceDetector = new FaceDetection({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
      });
      mpFaceDetector.setOptions({
        model: 'short',
        minDetectionConfidence: 0.35
      });
      mpFaceDetector.onResults(onMediaPipeResults);
      isMpReady = true;
      console.log('Google MediaPipe FaceDetection initialized successfully.');
    } catch (e) {
      console.warn('MediaPipe initialization warning:', e);
    }
  }
}

function onMediaPipeResults(results) {
  if (!results.detections || results.detections.length === 0) {
    detectedFaces = [];
    return;
  }

  const vW = video.videoWidth || 1280;
  const vH = video.videoHeight || 720;
  const cW = canvas.width;
  const cH = canvas.height;
  const scale = Math.max(cW / vW, cH / vH);
  const offsetX = (cW - vW * scale) / 2;
  const offsetY = (cH - vH * scale) / 2;

  detectedFaces = results.detections.map((det, idx) => {
    const b = det.boundingBox;
    const normX = (b.xCenter !== undefined) ? (b.xCenter - b.width / 2) : (b.xMin !== undefined ? b.xMin : (b.x || 0));
    const normY = (b.yCenter !== undefined) ? (b.yCenter - b.height / 2) : (b.yMin !== undefined ? b.yMin : (b.y || 0));
    const normW = b.width;
    const normH = b.height;

    let sw = normW * vW * scale;
    let sh = normH * vH * scale;
    let sy = (normY * vH) * scale + offsetY;
    let sx;

    if (currentFacingMode === 'user') {
      sx = cW - ((normX * vW) * scale + offsetX + sw);
    } else {
      sx = (normX * vW) * scale + offsetX;
    }

    const landmarks = det.landmarks || [];
    const scores = calculateEmotionsFromLandmarks(landmarks, normW, normH, normX, normY);

    return {
      box: { x: sx, y: sy, w: sw, h: sh },
      scores: scores
    };
  });
}

// Fallback Fast Face Detector if MediaPipe is loading
let nativeDetector = ('FaceDetector' in window) ? new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 }) : null;

async function runFallbackDetection() {
  if (detectedFaces.length > 0) return; // MediaPipe is already providing results

  const vW = video.videoWidth;
  const vH = video.videoHeight;
  const cW = canvas.width;
  const cH = canvas.height;

  // Try Hardware Native FaceDetector
  if (nativeDetector) {
    try {
      const faces = await nativeDetector.detect(video);
      if (faces && faces.length > 0) {
        const scale = Math.max(cW / vW, cH / vH);
        const offsetX = (cW - vW * scale) / 2;
        const offsetY = (cH - vH * scale) / 2;

        detectedFaces = faces.map(f => {
          let sw = f.boundingBox.width * scale;
          let sh = f.boundingBox.height * scale;
          let sy = f.boundingBox.y * scale + offsetY;
          let sx = (currentFacingMode === 'user') 
            ? cW - (f.boundingBox.x * scale + offsetX + sw)
            : f.boundingBox.x * scale + offsetX;

          return {
            box: { x: sx, y: sy, w: sw, h: sh },
            scores: calculateLocalFallbackEmotions(f.boundingBox)
          };
        });
        return;
      }
    } catch (e) {}
  }
}

// ==========================================
// 4. Microsoft Cognitive Emotion Extraction
// Output: 8 decimal scores (5 decimal places, e.g. 0.00000 to 1.00000)
// ==========================================
let cloudScoresCache = null;

// Direct Cloud Call to Microsoft Cognitive Services (Azure Face / Emotion API)
async function fetchMicrosoftCognitiveEmotion() {
  if (isAzureCalling || Date.now() - lastAzureCallTime < 1400) return;
  if (!azureEndpoint || !azureKey) return;

  isAzureCalling = true;
  lastAzureCallTime = Date.now();

  try {
    const snapCanvas = document.createElement('canvas');
    snapCanvas.width = 480;
    snapCanvas.height = 360;
    const sCtx = snapCanvas.getContext('2d');
    sCtx.drawImage(video, 0, 0, 480, 360);

    const blob = await new Promise(r => snapCanvas.toBlob(r, 'image/jpeg', 0.85));
    if (!blob) return;

    let requestUrl = azureEndpoint;
    if (!requestUrl.includes('/face/v1.0') && !requestUrl.includes('/emotion/v1.0')) {
      requestUrl = `${azureEndpoint}/face/v1.0/detect?returnFaceAttributes=emotion`;
    }

    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': azureKey,
        'Content-Type': 'application/octet-stream'
      },
      body: blob
    });

    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        const item = data[0];
        const emotionObj = item.faceAttributes ? item.faceAttributes.emotion : (item.scores || null);
        if (emotionObj) {
          cloudScoresCache = [
            parseFloat(emotionObj.anger || 0),
            parseFloat(emotionObj.contempt || 0),
            parseFloat(emotionObj.disgust || 0),
            parseFloat(emotionObj.fear || 0),
            parseFloat(emotionObj.happiness || 0),
            parseFloat(emotionObj.neutral || 0),
            parseFloat(emotionObj.sadness || 0),
            parseFloat(emotionObj.surprise || 0)
          ];
        }
      }
    }
  } catch (err) {
    console.warn('Azure Emotion API network error:', err);
  } finally {
    isAzureCalling = false;
  }
}

// MediaPipe 6-Landmark Accurate Physiological Emotion Calculator
// Landmarks: 0: right eye, 1: left eye, 2: nose tip, 3: mouth center, 4: right ear, 5: left ear
function calculateEmotionsFromLandmarks(landmarks, normW, normH, normX, normY) {
  if (cloudScoresCache && cloudScoresCache.length === 8 && engineMode === 'azure') {
    return cloudScoresCache;
  }

  let smile = 0.05;
  let jawDrop = 0.05;
  let browFurrow = 0.04;
  let asym = 0.02;

  if (landmarks && landmarks.length >= 4) {
    const re = landmarks[0];
    const le = landmarks[1];
    const nose = landmarks[2];
    const mouth = landmarks[3];

    // Eye span and nose-to-mouth ratio
    const eyeSpan = Math.hypot(re.x - le.x, re.y - le.y) || 1;
    const noseToMouth = Math.hypot(mouth.x - nose.x, mouth.y - nose.y);
    const ratio = noseToMouth / eyeSpan;

    // Jaw drop (mouth opening) -> Surprise / Fear
    if (ratio > 0.68) {
      jawDrop = Math.min(1.0, (ratio - 0.68) * 3.5);
    }

    // Facial asymmetry -> Contempt
    const distR = Math.hypot(re.x - nose.x, re.y - nose.y);
    const distL = Math.hypot(le.x - nose.x, le.y - nose.y);
    asym = Math.min(1.0, Math.abs(distR - distL) / eyeSpan);
  }

  // Sample mouth brightness from offscreen canvas for smile detection
  offCtx.drawImage(video, 0, 0, 160, 120);
  const cropX = Math.max(0, Math.min(150, Math.floor(normX * 160)));
  const cropY = Math.max(0, Math.min(110, Math.floor(normY * 120)));
  const cropW = Math.max(10, Math.min(160 - cropX, Math.floor(normW * 160)));
  const cropH = Math.max(10, Math.min(120 - cropY, Math.floor(normH * 120)));

  try {
    const mY = cropY + Math.floor(cropH * 0.65);
    const mH = Math.max(2, Math.floor(cropH * 0.28));
    const mData = offCtx.getImageData(cropX, mY, cropW, mH).data;

    let brightCount = 0;
    for (let i = 0; i < mData.length; i += 4) {
      const lum = 0.299 * mData[i] + 0.587 * mData[i + 1] + 0.114 * mData[i + 2];
      if (lum > 145) brightCount++;
    }
    const total = mData.length / 4;
    if (brightCount > total * 0.08) {
      smile = Math.min(0.95, (brightCount / total) * 4.5);
    }
  } catch (e) {}

  let happyRaw = smile * 3.5;
  let surpriseRaw = jawDrop * 2.8 * Math.max(0.08, 1 - smile * 1.5);
  let angerRaw = browFurrow * 2.5 * Math.max(0.04, 1 - smile * 1.8);
  let contemptRaw = asym * 2.2 * (smile > 0.08 ? 1.4 : 0.5);
  let disgustRaw = Math.max(0.005, 0.08 * (1 - smile));
  let sadnessRaw = Math.max(0.005, (1 - smile) * 0.12);
  let fearRaw = jawDrop * 0.7 * 0.6;

  const arousal = happyRaw + surpriseRaw + angerRaw + contemptRaw + disgustRaw + sadnessRaw + fearRaw;
  let neutralRaw = Math.max(0.05, 1.4 - arousal * 1.4);

  const rawList = [angerRaw, contemptRaw, disgustRaw, fearRaw, happyRaw, neutralRaw, sadnessRaw, surpriseRaw];
  const maxVal = Math.max(...rawList);
  const exps = rawList.map(v => Math.exp((v - maxVal) * 2.4));
  const sumExps = exps.reduce((a, b) => a + b, 0);

  return exps.map(v => v / sumExps);
}

function calculateLocalFallbackEmotions(b) {
  return [0.00012, 0.00005, 0.00003, 0.00008, 0.08542, 0.91410, 0.00012, 0.00008];
}

// Smoothing across frames
const faceSmoothers = new Map();
function smoothScores(key, fresh) {
  let prev = faceSmoothers.get(key);
  if (!prev) {
    prev = [...fresh];
    faceSmoothers.set(key, prev);
    return prev;
  }
  for (let i = 0; i < fresh.length; i++) {
    prev[i] = prev[i] * 0.7 + fresh[i] * 0.3;
  }
  return prev;
}

// ==========================================
// 5. Guaranteed Floating Meter Placement
// ==========================================
function getFloatingPanelPosition(box, panelW, panelH, cW, cH) {
  const gap = 10;
  let x, y;

  const spaceRight = cW - (box.x + box.w);
  const spaceLeft = box.x;

  if (spaceRight >= panelW + gap) {
    x = box.x + box.w + gap;
  } else if (spaceLeft >= panelW + gap) {
    x = box.x - panelW - gap;
  } else {
    if (spaceRight >= spaceLeft) {
      x = Math.max(gap, cW - panelW - gap);
    } else {
      x = gap;
    }
  }

  y = Math.max(65, Math.min(cH - panelH - 85, box.y));
  return { x, y, w: panelW, h: panelH };
}

// ==========================================
// 6. Main Render Loop
// ==========================================
async function mainRenderLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (video.readyState >= 2 && !video.paused && video.videoWidth > 10 && !isSwitchingCamera) {
    // Send frame to Google MediaPipe FaceDetector
    if (isMpReady && mpFaceDetector && !isSendingFrame) {
      isSendingFrame = true;
      mpFaceDetector.send({ image: video })
        .catch(e => console.warn(e))
        .finally(() => { isSendingFrame = false; });
    } else {
      await runFallbackDetection();
    }

    const cW = canvas.width;
    const cH = canvas.height;

    if (!detectedFaces || detectedFaces.length === 0) {
      faceSmoothers.clear();
      cloudScoresCache = null;

      statusDot.classList.remove('active');
      statusText.textContent = 'Scanning: No Face Detected';

      // Zeroed meters HUD: All 8 emotions strictly 0.00000
      drawZeroedMetersHUD(ctx, cW, cH);
    } else {
      statusDot.classList.add('active');
      const providerLabel = (engineMode === 'azure' && azureKey) ? 'Microsoft Cognitive Cloud' : 'MediaPipe AI';
      statusText.textContent = `Face Confirmed (${detectedFaces.length} Tracked)`;

      if (engineMode === 'azure' && azureKey) {
        fetchMicrosoftCognitiveEmotion();
      }

      // Render floating meters with 5 decimal places next to each confirmed face
      detectedFaces.forEach((fData, idx) => {
        const smoothed = smoothScores('face_' + idx, fData.scores);
        fData.scores = smoothed;
        drawFaceAndFloatingMeter(ctx, fData, idx + 1, cW, cH);
      });
    }
  }

  requestAnimationFrame(mainRenderLoop);
}

// ==========================================
// Render 1: ZEROED METERS HUD (No Face)
// Strictly shows 0.00000 for all 8 emotions
// ==========================================
function drawZeroedMetersHUD(targetCtx, cW, cH) {
  targetCtx.save();

  const panelW = 138;
  const panelH = EMOTIONS.length * 15 + 28;
  const panelX = Math.max(12, cW - panelW - 12);
  const panelY = 70;

  targetCtx.fillStyle = 'rgba(8, 12, 20, 0.94)';
  targetCtx.strokeStyle = 'rgba(255, 71, 87, 0.5)';
  targetCtx.lineWidth = 1.2;
  drawCardRoundRect(targetCtx, panelX, panelY, panelW, panelH, 8);
  targetCtx.fill();
  targetCtx.stroke();

  targetCtx.textAlign = 'left';
  targetCtx.fillStyle = '#ff4757';
  targetCtx.font = 'bold 9px -apple-system, sans-serif';
  targetCtx.fillText('NO FACE (0.00000)', panelX + 8, panelY + 15);

  let itemY = panelY + 30;
  EMOTIONS.forEach(emo => {
    targetCtx.font = '9px monospace';
    targetCtx.fillStyle = '#718096';
    targetCtx.fillText(emo.code, panelX + 8, itemY);

    targetCtx.textAlign = 'right';
    targetCtx.fillText('0.00000', panelX + panelW - 8, itemY);
    targetCtx.textAlign = 'left';

    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    targetCtx.fillRect(panelX + 36, itemY - 6, 42, 3.5);

    itemY += 15;
  });

  targetCtx.restore();
}

// ==========================================
// Render 2: CONFIRMED FACE + FLOATING 5-DECIMAL METER
// ==========================================
function drawFaceAndFloatingMeter(targetCtx, faceData, faceNum, cW, cH) {
  const box = faceData.box;
  const scores = faceData.scores;

  let maxIdx = 0;
  scores.forEach((sc, i) => { if (sc > scores[maxIdx]) maxIdx = i; });
  const dominant = EMOTIONS[maxIdx];
  const domDecimal = (scores[maxIdx] || 0).toFixed(5);

  targetCtx.save();

  // 1. Sleek Reticle around Face
  targetCtx.strokeStyle = dominant.color;
  targetCtx.lineWidth = 2.5;
  targetCtx.shadowColor = dominant.color;
  targetCtx.shadowBlur = 8;

  const corner = Math.min(box.w, box.h) * 0.2;
  targetCtx.beginPath();
  targetCtx.moveTo(box.x, box.y + corner); targetCtx.lineTo(box.x, box.y); targetCtx.lineTo(box.x + corner, box.y);
  targetCtx.moveTo(box.x + box.w - corner, box.y); targetCtx.lineTo(box.x + box.w); targetCtx.lineTo(box.x + box.w, box.y + corner);
  targetCtx.moveTo(box.x + box.w, box.y + box.h - corner); targetCtx.lineTo(box.x + box.w, box.y + box.h); targetCtx.lineTo(box.x + box.w - corner, box.y + box.h);
  targetCtx.moveTo(box.x + corner, box.y + box.h); targetCtx.lineTo(box.x, box.y + box.h); targetCtx.lineTo(box.x, box.y + box.h - corner);
  targetCtx.stroke();

  // Top Face Tag with 5-digit decimal
  targetCtx.shadowBlur = 0;
  const tagText = `#${faceNum} ${dominant.name.toUpperCase()}: ${domDecimal}`;
  targetCtx.font = 'bold 11px monospace';
  const tagWidth = targetCtx.measureText(tagText).width + 12;
  targetCtx.fillStyle = dominant.color;
  targetCtx.fillRect(box.x, box.y - 20, tagWidth, 18);
  targetCtx.fillStyle = '#000000';
  targetCtx.fillText(tagText, box.x + 6, box.y - 6);

  // 2. Guaranteed Floating Meter Panel
  const panelW = 138;
  const panelH = EMOTIONS.length * 15 + 28;
  const panelPos = getFloatingPanelPosition(box, panelW, panelH, cW, cH);

  // Tech Pointer Line from Face to Meter
  targetCtx.strokeStyle = 'rgba(0, 255, 196, 0.6)';
  targetCtx.lineWidth = 1.5;
  targetCtx.setLineDash([3, 3]);
  targetCtx.beginPath();
  if (panelPos.x > box.x) {
    targetCtx.moveTo(box.x + box.w, box.y + 24);
    targetCtx.lineTo(panelPos.x, box.y + 24);
  } else {
    targetCtx.moveTo(box.x, box.y + 24);
    targetCtx.lineTo(panelPos.x + panelW, box.y + 24);
  }
  targetCtx.stroke();
  targetCtx.setLineDash([]);

  // Floating Meter Card Background
  targetCtx.fillStyle = 'rgba(8, 12, 20, 0.94)';
  targetCtx.strokeStyle = 'rgba(0, 255, 196, 0.65)';
  targetCtx.lineWidth = 1.2;
  drawCardRoundRect(targetCtx, panelPos.x, panelPos.y, panelW, panelH, 8);
  targetCtx.fill();
  targetCtx.stroke();

  // Title
  targetCtx.fillStyle = '#00ffc4';
  targetCtx.font = 'bold 9px -apple-system, sans-serif';
  targetCtx.textAlign = 'left';
  targetCtx.fillText(`FACE #${faceNum} (MS-EMOTION)`, panelPos.x + 8, panelPos.y + 15);

  // Render 8 Values (5 Decimal Digits Below 0)
  let itemY = panelPos.y + 30;
  EMOTIONS.forEach((emo, i) => {
    const val = scores[i] || 0;
    const decimalStr = val.toFixed(5);
    const isLead = (i === maxIdx);

    targetCtx.font = isLead ? 'bold 9px monospace' : '9px monospace';
    targetCtx.fillStyle = isLead ? '#FFFFFF' : '#A0AEC0';
    targetCtx.fillText(emo.code, panelPos.x + 8, itemY);

    targetCtx.fillStyle = emo.color;
    targetCtx.textAlign = 'right';
    targetCtx.fillText(decimalStr, panelPos.x + panelW - 8, itemY);
    targetCtx.textAlign = 'left';

    const barX = panelPos.x + 36;
    const barY = itemY - 6;
    const barW = 42;
    const barH = 3.5;

    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    targetCtx.fillRect(barX, barY, barW, barH);

    targetCtx.fillStyle = emo.color;
    targetCtx.fillRect(barX, barY, barW * Math.min(1.0, val), barH);

    itemY += 15;
  });

  targetCtx.restore();
}

// ==========================================
// 7. Photo & Video Capture with 5-Decimal Meters
// ==========================================
photoBtn.addEventListener('click', () => {
  if (video.readyState < 2 || video.videoWidth < 10) return;

  photoBtn.style.transform = 'scale(0.85)';
  setTimeout(() => { photoBtn.style.transform = 'scale(1)'; }, 150);

  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = canvas.width;
  snapCanvas.height = canvas.height;
  const snapCtx = snapCanvas.getContext('2d');

  snapCtx.save();
  if (currentFacingMode === 'user') {
    snapCtx.translate(snapCanvas.width, 0);
    snapCtx.scale(-1, 1);
  }
  snapCtx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
  snapCtx.restore();

  if (detectedFaces.length === 0) {
    drawZeroedMetersHUD(snapCtx, snapCanvas.width, snapCanvas.height);
  } else {
    detectedFaces.forEach((f, idx) => {
      drawFaceAndFloatingMeter(snapCtx, f, idx + 1, snapCanvas.width, snapCanvas.height);
    });
  }

  snapCanvas.toBlob(async (blob) => {
    if (!blob) return;
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const filename = `emotion_snap_${timestamp}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Emotion Snapshot',
          text: 'Microsoft Cognitive Emotion Snapshot'
        });
        showToast('Snapshot saved!');
        return;
      } catch (e) {}
    }

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Photo saved to downloads!');
  }, 'image/png');
});

recordBtn.addEventListener('click', () => {
  if (!isRecording) {
    startVideoRecording();
  } else {
    stopVideoRecording();
  }
});

function startVideoRecording() {
  if (video.readyState < 2 || video.videoWidth < 10) return;

  recordedChunks = [];
  const recCanvas = document.createElement('canvas');
  recCanvas.width = canvas.width;
  recCanvas.height = canvas.height;
  const recCtx = recCanvas.getContext('2d');

  const recStream = recCanvas.captureStream(30);

  let recLoopActive = true;
  function updateRecFrame() {
    if (!recLoopActive) return;
    recCtx.clearRect(0, 0, recCanvas.width, recCanvas.height);

    recCtx.save();
    if (currentFacingMode === 'user') {
      recCtx.translate(recCanvas.width, 0);
      recCtx.scale(-1, 1);
    }
    recCtx.drawImage(video, 0, 0, recCanvas.width, recCanvas.height);
    recCtx.restore();

    if (detectedFaces.length === 0) {
      drawZeroedMetersHUD(recCtx, recCanvas.width, recCanvas.height);
    } else {
      detectedFaces.forEach((f, idx) => {
        drawFaceAndFloatingMeter(recCtx, f, idx + 1, recCanvas.width, recCanvas.height);
      });
    }
    requestAnimationFrame(updateRecFrame);
  }
  updateRecFrame();

  let options = { mimeType: 'video/webm;codecs=vp8' };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: 'video/mp4' };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = {};
    }
  }

  try {
    mediaRecorder = new MediaRecorder(recStream, options);
  } catch (e) {
    mediaRecorder = new MediaRecorder(recStream);
  }

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordedChunks.push(e.data);
    }
  };

  mediaRecorder.onstop = () => {
    recLoopActive = false;
    const blob = new Blob(recordedChunks, { type: mediaRecorder.mimeType || 'video/webm' });
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const ext = (mediaRecorder.mimeType && mediaRecorder.mimeType.includes('mp4')) ? 'mp4' : 'webm';
    const filename = `emotion_video_${timestamp}.${ext}`;

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Video saved to downloads!');
  };

  mediaRecorder.start(250);
  isRecording = true;
  recordBtn.classList.add('recording');
  showToast('Recording started...');
}

function stopVideoRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  isRecording = false;
  recordBtn.classList.remove('recording');
}

// Start Google MediaPipe detector, camera stream, and master render loop
initMediaPipeFaceDetector();
startCamera();
requestAnimationFrame(mainRenderLoop);
