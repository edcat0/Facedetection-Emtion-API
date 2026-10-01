// ==========================================
// 8-Emotion Taxonomy (AffectNet / Ekman Standard)
// ==========================================
const EMOTIONS = [
  { name: 'Anger',     color: '#FF4757', key: 'angry' },
  { name: 'Contempt',  color: '#FFA502', key: 'contempt' },
  { name: 'Disgust',   color: '#2ED573', key: 'disgusted' },
  { name: 'Fear',      color: '#9B59B6', key: 'fearful' },
  { name: 'Happiness', color: '#2ECC71', key: 'happy' },
  { name: 'Neutral',   color: '#70A1FF', key: 'neutral' },
  { name: 'Sadness',   color: '#57606F', key: 'sad' },
  { name: 'Surprise',  color: '#00D2D3', key: 'surprised' }
];

let currentFacingMode = 'user';
let activeStream = null;
let isModelsLoaded = false;
let isDetecting = false;
let lastInferenceTime = 0;
let isSwitchingCamera = false;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;

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

// ==========================================
// 1. Neural Network Model Loading (face-api)
// ==========================================
const MODEL_URLS = [
  'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/',
  'https://unpkg.com/@vladmandic/face-api@1.7.12/model/',
  'https://raw.githubusercontent.com/vladmandic/face-api/master/model/'
];

async function loadNeuralModels() {
  statusText.textContent = 'Loading Neural AI...';
  for (const baseUrl of MODEL_URLS) {
    try {
      console.log('Loading face-api models from:', baseUrl);
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(baseUrl),
        faceapi.nets.faceLandmark68Net.loadFromUri(baseUrl),
        faceapi.nets.faceExpressionNet.loadFromUri(baseUrl)
      ]);
      isModelsLoaded = true;
      statusText.textContent = 'Scanning: No Face Detected';
      console.log('Neural models successfully loaded.');
      return;
    } catch (err) {
      console.warn('Failed loading models from ' + baseUrl + ', trying next mirror...', err);
    }
  }
  statusText.textContent = 'Neural Engine Offline';
}

// ==========================================
// 2. Camera Management with Clean Switching
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
    console.warn('Initial camera constraint failed, retrying simple constraint...', err);
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

  // Await playback explicitly
  try {
    await video.play();
  } catch (playErr) {
    console.warn('Video play warning:', playErr);
  }

  resizeCanvas();
  showToast('Camera active: ' + (currentFacingMode === 'user' ? 'Front (Selfie)' : 'Rear'));
}

// Bulletproof Front/Rear Camera Switching
async function switchCamera() {
  if (isSwitchingCamera) return;
  isSwitchingCamera = true;
  flipCamBtn.disabled = true;

  // 1. Reset state and release detection lock
  isDetecting = false;
  detectedFacesData = [];
  faceSmoother.clear();

  // 2. Stop existing tracks cleanly
  if (activeStream) {
    activeStream.getTracks().forEach(track => {
      try { track.stop(); } catch (e) {}
    });
    activeStream = null;
  }
  video.srcObject = null;

  // 3. Toggle facing mode
  currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
  statusText.textContent = 'Switching Camera...';
  statusDot.classList.remove('active');

  // 4. CRITICAL: Wait 250ms for Android Camera HAL to cleanly release hardware
  await new Promise(resolve => setTimeout(resolve, 250));

  // 5. Start new camera
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

// ==========================================
// 3. Autonomous Multi-Face Emotion Inference
// ==========================================
let detectedFacesData = [];
const faceSmoother = new Map();

async function runFaceEmotionInference() {
  // Pre-condition guards: must have model, active video frame, and no stuck lock
  if (!isModelsLoaded || !video || video.paused || video.ended || video.readyState < 2 || isSwitchingCamera) {
    return;
  }

  // Ensure video dimensions are valid
  if (!video.videoWidth || !video.videoHeight || video.videoWidth < 10) {
    return;
  }

  // Watchdog timer: if previous detection is taking > 1200ms, unlock it
  if (isDetecting) {
    if (Date.now() - lastInferenceTime > 1200) {
      console.warn('Watchdog: resetting stuck detection lock');
      isDetecting = false;
    } else {
      return;
    }
  }

  isDetecting = true;
  lastInferenceTime = Date.now();

  try {
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 });
    const detections = await faceapi
      .detectAllFaces(video, options)
      .withFaceLandmarks()
      .withFaceExpressions();

    // Check if camera switch started while detecting
    if (isSwitchingCamera || !video.srcObject) {
      isDetecting = false;
      return;
    }

    if (!detections || detections.length === 0) {
      detectedFacesData = [];
      faceSmoother.clear();
      isDetecting = false;
      return;
    }

    const vW = video.videoWidth;
    const vH = video.videoHeight;
    const cW = canvas.width;
    const cH = canvas.height;
    const scale = Math.max(cW / vW, cH / vH);
    const offsetX = (cW - vW * scale) / 2;
    const offsetY = (cH - vH * scale) / 2;

    const freshFaces = [];

    detections.forEach((det, idx) => {
      const b = det.detection.box;

      // Coordinate mapping
      let sx, sy, sw, sh;
      sw = b.width * scale;
      sh = b.height * scale;
      sy = b.y * scale + offsetY;

      // Mirror transform calculation for front camera
      if (currentFacingMode === 'user') {
        sx = cW - (b.x * scale + offsetX + sw);
      } else {
        sx = b.x * scale + offsetX;
      }

      const expr = det.expressions;

      // Compute Contempt from 68 landmarks (mouth corner asymmetry)
      let contempt = 0.01;
      if (det.landmarks && det.landmarks.positions) {
        const pts = det.landmarks.positions;
        const mouthL = pts[48]; // left mouth corner
        const mouthR = pts[54]; // right mouth corner
        const asym = Math.abs(mouthL.y - mouthR.y) / (b.height || 1);
        if (asym > 0.038 && expr.happy < 0.55) {
          contempt = Math.min(0.85, asym * 5.0);
        }
      }

      // Assemble 8 emotion taxonomy
      const rawScores = [
        expr.angry || 0,
        contempt,
        expr.disgusted || 0,
        expr.fearful || 0,
        expr.happy || 0,
        expr.neutral || 0,
        expr.sad || 0,
        expr.surprised || 0
      ];

      // Smooth scores across frames for stability
      const faceKey = 'face_' + idx;
      let prev = faceSmoother.get(faceKey);
      if (!prev) {
        prev = [...rawScores];
        faceSmoother.set(faceKey, prev);
      } else {
        for (let i = 0; i < rawScores.length; i++) {
          prev[i] = prev[i] * 0.6 + rawScores[i] * 0.4;
        }
      }

      freshFaces.push({
        id: faceKey,
        box: { x: sx, y: sy, w: sw, h: sh },
        scores: prev
      });
    });

    detectedFacesData = freshFaces;
  } catch (err) {
    console.warn('Inference notice:', err);
  } finally {
    isDetecting = false;
  }
}

// ==========================================
// 4. Non-Overlapping Layout Calculator
// ==========================================
function calculateNonOverlappingPanel(box, panelW, panelH, cW, cH, occupiedRects) {
  const gap = 8;
  const candidates = [
    // 1. Right side of face
    { x: box.x + box.w + gap, y: box.y },
    // 2. Left side of face
    { x: box.x - panelW - gap, y: box.y },
    // 3. Below face
    { x: Math.max(gap, box.x + (box.w - panelW) / 2), y: box.y + box.h + gap },
    // 4. Above face
    { x: Math.max(gap, box.x + (box.w - panelW) / 2), y: box.y - panelH - gap }
  ];

  for (const cand of candidates) {
    const x = Math.max(gap, Math.min(cW - panelW - gap, cand.x));
    const y = Math.max(16, Math.min(cH - panelH - 75, cand.y));
    const rect = { x, y, w: panelW, h: panelH };

    let collides = false;
    for (const occ of occupiedRects) {
      if (!(rect.x + rect.w < occ.x || rect.x > occ.x + occ.w ||
            rect.y + rect.h < occ.y || rect.y > occ.y + occ.h)) {
        collides = true;
        break;
      }
    }

    if (!collides) {
      occupiedRects.push(rect);
      return rect;
    }
  }

  // Fallback
  let fallbackX = (box.x + box.w + panelW + gap < cW) ? box.x + box.w + gap : Math.max(gap, box.x - panelW - gap);
  let fallbackY = Math.max(16, Math.min(cH - panelH - 75, box.y));
  const fallbackRect = { x: fallbackX, y: fallbackY, w: panelW, h: panelH };
  occupiedRects.push(fallbackRect);
  return fallbackRect;
}

// ==========================================
// 5. Main Single Animation Render Loop
// ==========================================
function mainRenderLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (video.readyState >= 2 && !video.paused && video.videoWidth > 10 && !isSwitchingCamera) {
    runFaceEmotionInference();

    const cW = canvas.width;
    const cH = canvas.height;

    // Zero-face vs Confirmed face display
    if (detectedFacesData.length === 0) {
      statusDot.classList.remove('active');
      statusText.textContent = 'Scanning: No Face Detected';
      drawZeroedMetersHUD(ctx, cW, cH);
    } else {
      statusDot.classList.add('active');
      statusText.textContent = `Face Confirmed (${detectedFacesData.length} Detected)`;

      const occupiedRects = detectedFacesData.map(f => ({
        x: f.box.x - 4,
        y: f.box.y - 4,
        w: f.box.w + 8,
        h: f.box.h + 8
      }));

      detectedFacesData.forEach((faceData, idx) => {
        drawFaceAndNonOverlappingMeter(ctx, faceData, idx + 1, cW, cH, occupiedRects);
      });
    }
  } else {
    if (isSwitchingCamera) {
      statusDot.classList.remove('active');
      statusText.textContent = 'Switching Camera...';
    }
  }

  requestAnimationFrame(mainRenderLoop);
}

// ==========================================
// Render 1: ZEROED METERS HUD (No Face)
// ==========================================
function drawZeroedMetersHUD(targetCtx, cW, cH) {
  targetCtx.save();

  const panelW = 114;
  const panelH = EMOTIONS.length * 15 + 22;
  const panelX = Math.max(12, cW - panelW - 12);
  const panelY = 70;

  targetCtx.fillStyle = 'rgba(8, 12, 20, 0.92)';
  targetCtx.strokeStyle = 'rgba(255, 71, 87, 0.4)';
  targetCtx.lineWidth = 1;
  targetCtx.beginPath();
  targetCtx.roundRect(panelX, panelY, panelW, panelH, 8);
  targetCtx.fill();
  targetCtx.stroke();

  targetCtx.textAlign = 'left';
  targetCtx.fillStyle = '#ff4757';
  targetCtx.font = 'bold 9px -apple-system, sans-serif';
  targetCtx.fillText('NO FACE (0%)', panelX + 8, panelY + 13);

  let itemY = panelY + 26;
  EMOTIONS.forEach(emo => {
    targetCtx.font = '9px monospace';
    targetCtx.fillStyle = '#718096';
    targetCtx.fillText(emo.name.slice(0, 3).toUpperCase(), panelX + 8, itemY);

    targetCtx.textAlign = 'right';
    targetCtx.fillText('0%', panelX + panelW - 8, itemY);
    targetCtx.textAlign = 'left';

    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    targetCtx.fillRect(panelX + 34, itemY - 6, 44, 3);

    itemY += 15;
  });

  targetCtx.restore();
}

// ==========================================
// Render 2: DETECTED FACE + NON-OVERLAPPING METER
// ==========================================
function drawFaceAndNonOverlappingMeter(targetCtx, faceData, faceNum, cW, cH, occupiedRects) {
  const box = faceData.box;
  const scores = faceData.scores;

  let maxIdx = 0;
  scores.forEach((sc, i) => { if (sc > scores[maxIdx]) maxIdx = i; });
  const dominant = EMOTIONS[maxIdx];
  const domPct = Math.min(100, Math.round(scores[maxIdx] * 100));

  targetCtx.save();

  // 1. Sleek Reticle around Confirmed Face
  targetCtx.strokeStyle = dominant.color;
  targetCtx.lineWidth = 2;
  targetCtx.shadowColor = dominant.color;
  targetCtx.shadowBlur = 8;

  const corner = Math.min(box.w, box.h) * 0.2;
  targetCtx.beginPath();
  targetCtx.moveTo(box.x, box.y + corner); targetCtx.lineTo(box.x, box.y); targetCtx.lineTo(box.x + corner, box.y);
  targetCtx.moveTo(box.x + box.w - corner, box.y); targetCtx.lineTo(box.x + box.w); targetCtx.lineTo(box.x + box.w, box.y + corner);
  targetCtx.moveTo(box.x + box.w, box.y + box.h - corner); targetCtx.lineTo(box.x + box.w, box.y + box.h); targetCtx.lineTo(box.x + box.w - corner, box.y + box.h);
  targetCtx.moveTo(box.x + corner, box.y + box.h); targetCtx.lineTo(box.x, box.y + box.h); targetCtx.lineTo(box.x, box.y + box.h - corner);
  targetCtx.stroke();

  // Top Face Tag
  targetCtx.shadowBlur = 0;
  const tagText = `#${faceNum} ${dominant.name}: ${domPct}%`;
  targetCtx.font = 'bold 11px monospace';
  const tagWidth = targetCtx.measureText(tagText).width + 12;
  targetCtx.fillStyle = dominant.color;
  targetCtx.fillRect(box.x, box.y - 20, tagWidth, 18);
  targetCtx.fillStyle = '#000000';
  targetCtx.fillText(tagText, box.x + 6, box.y - 6);

  // 2. Non-Overlapping Position for Smaller Live Meter
  const panelW = 114;
  const panelH = EMOTIONS.length * 15 + 22;
  const panelPos = calculateNonOverlappingPanel(box, panelW, panelH, cW, cH, occupiedRects);

  targetCtx.fillStyle = 'rgba(8, 12, 20, 0.92)';
  targetCtx.strokeStyle = 'rgba(0, 255, 196, 0.4)';
  targetCtx.lineWidth = 1;
  targetCtx.beginPath();
  targetCtx.roundRect(panelPos.x, panelPos.y, panelW, panelH, 8);
  targetCtx.fill();
  targetCtx.stroke();

  targetCtx.fillStyle = '#00ffc4';
  targetCtx.font = 'bold 9px -apple-system, sans-serif';
  targetCtx.textAlign = 'left';
  targetCtx.fillText(`FACE #${faceNum} METERS`, panelPos.x + 8, panelPos.y + 13);

  let itemY = panelPos.y + 26;
  EMOTIONS.forEach((emo, i) => {
    const val = scores[i] || 0;
    const pct = Math.min(100, Math.round(val * 100));
    const isLead = (i === maxIdx);

    targetCtx.font = isLead ? 'bold 9px monospace' : '9px monospace';
    targetCtx.fillStyle = isLead ? '#FFFFFF' : '#A0AEC0';
    targetCtx.fillText(emo.name.slice(0, 3).toUpperCase(), panelPos.x + 8, itemY);

    targetCtx.fillStyle = emo.color;
    targetCtx.textAlign = 'right';
    targetCtx.fillText(`${pct}%`, panelPos.x + panelW - 8, itemY);
    targetCtx.textAlign = 'left';

    const barX = panelPos.x + 34;
    const barY = itemY - 6;
    const barW = 44;
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
// 6. Photo & Video Capture
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

  if (detectedFacesData.length === 0) {
    drawZeroedMetersHUD(snapCtx, snapCanvas.width, snapCanvas.height);
  } else {
    const occupiedRects = detectedFacesData.map(f => ({
      x: f.box.x - 4, y: f.box.y - 4, w: f.box.w + 8, h: f.box.h + 8
    }));
    detectedFacesData.forEach((f, idx) => {
      drawFaceAndNonOverlappingMeter(snapCtx, f, idx + 1, snapCanvas.width, snapCanvas.height, occupiedRects);
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
          text: 'Emotion HUD Snapshot'
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

    if (detectedFacesData.length === 0) {
      drawZeroedMetersHUD(recCtx, recCanvas.width, recCanvas.height);
    } else {
      const occupiedRects = detectedFacesData.map(f => ({
        x: f.box.x - 4, y: f.box.y - 4, w: f.box.w + 8, h: f.box.h + 8
      }));
      detectedFacesData.forEach((f, idx) => {
        drawFaceAndNonOverlappingMeter(recCtx, f, idx + 1, recCanvas.width, recCanvas.height, occupiedRects);
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

// Start loading neural models, initialize single animation loop, and start camera
loadNeuralModels();
startCamera();
requestAnimationFrame(mainRenderLoop);
