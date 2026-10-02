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

// Universal Canvas Rounded Rectangle Helper (Fail-safe on all browsers)
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
        faceapi.nets.faceExpressionNet.loadFromUri(baseUrl),
        faceapi.nets.faceLandmark68Net.loadFromUri(baseUrl).catch(e => console.warn('Landmark optional fallback:', e))
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
    console.warn('High-res camera constraint failed, retrying simple constraint...', err);
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

  isDetecting = false;
  detectedFacesData = [];
  faceSmoother.clear();

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
// 3. Autonomous Multi-Face Emotion Inference
// ==========================================
let detectedFacesData = [];
const faceSmoother = new Map();

async function runFaceEmotionInference() {
  if (!isModelsLoaded || !video || video.paused || video.ended || video.readyState < 2 || isSwitchingCamera) {
    return;
  }

  if (!video.videoWidth || !video.videoHeight || video.videoWidth < 10) {
    return;
  }

  if (isDetecting) {
    if (Date.now() - lastInferenceTime > 1200) {
      isDetecting = false;
    } else {
      return;
    }
  }

  isDetecting = true;
  lastInferenceTime = Date.now();

  try {
    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.3 });
    
    // Robust detection query: uses landmarks if loaded, falls back to pure expressions
    let detections = [];
    if (faceapi.nets.faceLandmark68Net && faceapi.nets.faceLandmark68Net.isLoaded) {
      try {
        detections = await faceapi
          .detectAllFaces(video, options)
          .withFaceLandmarks()
          .withFaceExpressions();
      } catch (landmarkErr) {
        detections = await faceapi
          .detectAllFaces(video, options)
          .withFaceExpressions();
      }
    } else {
      detections = await faceapi
        .detectAllFaces(video, options)
        .withFaceExpressions();
    }

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

      let sw = b.width * scale;
      let sh = b.height * scale;
      let sy = b.y * scale + offsetY;
      let sx;

      // Coordinate mapping with mirror support
      if (currentFacingMode === 'user') {
        sx = cW - (b.x * scale + offsetX + sw);
      } else {
        sx = b.x * scale + offsetX;
      }

      const expr = det.expressions;

      // Compute Contempt if landmarks available
      let contempt = 0.01;
      if (det.landmarks && det.landmarks.positions) {
        const pts = det.landmarks.positions;
        const mouthL = pts[48];
        const mouthR = pts[54];
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

      // Smooth scores across frames
      const faceKey = 'face_' + idx;
      let prev = faceSmoother.get(faceKey);
      if (!prev) {
        prev = [...rawScores];
        faceSmoother.set(faceKey, prev);
      } else {
        for (let i = 0; i < rawScores.length; i++) {
          prev[i] = prev[i] * 0.55 + rawScores[i] * 0.45;
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
// 4. Guaranteed Non-Overlapping Placement
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
    // Face occupies majority of screen width: place on the roomier side
    if (spaceRight >= spaceLeft) {
      x = Math.max(gap, cW - panelW - gap);
    } else {
      x = gap;
    }
  }

  // Anchor vertically with the face, clamped to stay safely inside screen
  y = Math.max(65, Math.min(cH - panelH - 85, box.y));

  return { x, y, w: panelW, h: panelH };
}

// ==========================================
// 5. Main Render Loop
// ==========================================
function mainRenderLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (video.readyState >= 2 && !video.paused && video.videoWidth > 10 && !isSwitchingCamera) {
    runFaceEmotionInference();

    const cW = canvas.width;
    const cH = canvas.height;

    if (detectedFacesData.length === 0) {
      statusDot.classList.remove('active');
      statusText.textContent = 'Scanning: No Face Detected';
      drawZeroedMetersHUD(ctx, cW, cH);
    } else {
      statusDot.classList.add('active');
      statusText.textContent = `Face Confirmed (${detectedFacesData.length} Detected)`;

      detectedFacesData.forEach((faceData, idx) => {
        drawFaceAndFloatingMeter(ctx, faceData, idx + 1, cW, cH);
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
  const panelH = EMOTIONS.length * 15 + 24;
  const panelX = Math.max(12, cW - panelW - 12);
  const panelY = 70;

  targetCtx.fillStyle = 'rgba(8, 12, 20, 0.92)';
  targetCtx.strokeStyle = 'rgba(255, 71, 87, 0.4)';
  targetCtx.lineWidth = 1;
  drawCardRoundRect(targetCtx, panelX, panelY, panelW, panelH, 8);
  targetCtx.fill();
  targetCtx.stroke();

  targetCtx.textAlign = 'left';
  targetCtx.fillStyle = '#ff4757';
  targetCtx.font = 'bold 9px -apple-system, sans-serif';
  targetCtx.fillText('NO FACE (0%)', panelX + 8, panelY + 14);

  let itemY = panelY + 28;
  EMOTIONS.forEach(emo => {
    targetCtx.font = '9px monospace';
    targetCtx.fillStyle = '#718096';
    targetCtx.fillText(emo.name.slice(0, 3).toUpperCase(), panelX + 8, itemY);

    targetCtx.textAlign = 'right';
    targetCtx.fillText('0%', panelX + panelW - 8, itemY);
    targetCtx.textAlign = 'left';

    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    targetCtx.fillRect(panelX + 34, itemY - 6, 44, 3.5);

    itemY += 15;
  });

  targetCtx.restore();
}

// ==========================================
// Render 2: DETECTED FACE + FLOATING LIVE METER
// ==========================================
function drawFaceAndFloatingMeter(targetCtx, faceData, faceNum, cW, cH) {
  const box = faceData.box;
  const scores = faceData.scores;

  let maxIdx = 0;
  scores.forEach((sc, i) => { if (sc > scores[maxIdx]) maxIdx = i; });
  const dominant = EMOTIONS[maxIdx];
  const domPct = Math.min(100, Math.round(scores[maxIdx] * 100));

  targetCtx.save();

  // 1. Sleek Reticle around Confirmed Face
  targetCtx.strokeStyle = dominant.color;
  targetCtx.lineWidth = 2.5;
  targetCtx.shadowColor = dominant.color;
  targetCtx.shadowBlur = 8;

  const corner = Math.min(box.w, box.h) * 0.2;
  targetCtx.beginPath();
  targetCtx.moveTo(box.x, box.y + corner); targetCtx.lineTo(box.x, box.y); targetCtx.lineTo(box.x + corner, box.y);
  targetCtx.moveTo(box.x + box.w - corner, box.y); targetCtx.lineTo(box.x + box.w, box.y); targetCtx.lineTo(box.x + box.w, box.y + corner);
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

  // 2. Guaranteed Floating Meter Position
  const panelW = 114;
  const panelH = EMOTIONS.length * 15 + 24;
  const panelPos = getFloatingPanelPosition(box, panelW, panelH, cW, cH);

  // Dashed Tech Pointer Line from Face Box to Floating Meter
  targetCtx.strokeStyle = 'rgba(0, 255, 196, 0.5)';
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
  targetCtx.strokeStyle = 'rgba(0, 255, 196, 0.55)';
  targetCtx.lineWidth = 1.2;
  drawCardRoundRect(targetCtx, panelPos.x, panelPos.y, panelW, panelH, 8);
  targetCtx.fill();
  targetCtx.stroke();

  // Panel Title Header
  targetCtx.fillStyle = '#00ffc4';
  targetCtx.font = 'bold 9px -apple-system, sans-serif';
  targetCtx.textAlign = 'left';
  targetCtx.fillText(`FACE #${faceNum} METERS`, panelPos.x + 8, panelPos.y + 14);

  // Render 8 Values for this face
  let itemY = panelPos.y + 28;
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
    detectedFacesData.forEach((f, idx) => {
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
      detectedFacesData.forEach((f, idx) => {
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

// Start loading neural models, initialize single animation loop, and start camera
loadNeuralModels();
startCamera();
requestAnimationFrame(mainRenderLoop);
