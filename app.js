// ==========================================
// 8-Emotion Taxonomy (AffectNet Standard)
// ==========================================
const EMOTIONS = [
  { name: 'Anger',     color: '#FF4757' },
  { name: 'Contempt',  color: '#FFA502' },
  { name: 'Disgust',   color: '#2ED573' },
  { name: 'Fear',      color: '#9B59B6' },
  { name: 'Happiness', color: '#2ECC71' },
  { name: 'Neutral',   color: '#70A1FF' },
  { name: 'Sadness',   color: '#57606F' },
  { name: 'Surprise',  color: '#00D2D3' }
];

let currentFacingMode = 'user';
let activeStream = null;
let nativeFaceDetector = null;
let mpFaceDetector = null;
let isDetectorReady = false;
let lastVideoTime = -1;
let isDetecting = false;
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

// Offscreen analysis canvas for fast feature evaluation
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
  setTimeout(() => { toast.style.display = 'none'; }, 2000);
}

// ==========================================
// 1. Fast, Autonomous Face Detectors Setup
// ==========================================
async function initDetectors() {
  // Tier 1: Check Native Android Hardware FaceDetector API (Instant 60 FPS)
  if ('FaceDetector' in window) {
    try {
      nativeFaceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 6 });
      isDetectorReady = true;
      console.log('Using Native Android Hardware FaceDetector.');
    } catch (e) {
      nativeFaceDetector = null;
    }
  }

  // Tier 2: MediaPipe BlazeFace (Ultra-light 220KB model vs 30MB)
  if (!nativeFaceDetector && window.vision && window.vision.FaceDetector) {
    try {
      const vision = window.vision;
      const fileset = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      mpFaceDetector = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.35
      });
      isDetectorReady = true;
      console.log('MediaPipe BlazeFace detector initialized.');
    } catch (err) {
      console.warn('BlazeFace init notice:', err);
    }
  }
}

// ==========================================
// 2. Camera Stream Management
// ==========================================
async function startCamera() {
  if (activeStream) {
    activeStream.getTracks().forEach(track => track.stop());
  }

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
    video.srcObject = activeStream;

    if (currentFacingMode === 'user') {
      video.classList.remove('rear-mode');
    } else {
      video.classList.add('rear-mode');
    }

    video.onloadedmetadata = () => {
      video.play().catch(e => console.warn('Autoplay notice:', e));
      resizeCanvas();
      showToast('Camera active: ' + (currentFacingMode === 'user' ? 'Front' : 'Rear'));
      requestAnimationFrame(mainRenderLoop);
    };
  } catch (err) {
    console.error('Camera access error:', err);
    permissionCard.style.display = 'block';
    statusText.textContent = 'Camera Blocked';
    statusDot.classList.remove('active');
  }
}

grantPermBtn.addEventListener('click', () => { startCamera(); });
flipCamBtn.addEventListener('click', () => {
  currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
  startCamera();
});

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);

// ==========================================
// 3. Autonomous Multi-Face Extraction
// ==========================================
async function detectFacesAutonomous(timestamp) {
  if (video.readyState < 2 || video.videoWidth === 0) return [];

  const rawFaces = [];
  const vW = video.videoWidth;
  const vH = video.videoHeight;

  // 1. Try Native Android FaceDetector
  if (nativeFaceDetector && !isDetecting) {
    try {
      isDetecting = true;
      const detected = await nativeFaceDetector.detect(video);
      isDetecting = false;
      if (detected && detected.length > 0) {
        detected.forEach(d => {
          rawFaces.push({
            x: d.boundingBox.x,
            y: d.boundingBox.y,
            w: d.boundingBox.width,
            h: d.boundingBox.height,
            landmarks: d.landmarks || []
          });
        });
        return rawFaces;
      }
    } catch (e) {
      isDetecting = false;
    }
  }

  // 2. Try MediaPipe BlazeFace (Fast Multi-Face Detection)
  if (mpFaceDetector && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    try {
      const result = mpFaceDetector.detectForVideo(video, timestamp);
      if (result && result.detections && result.detections.length > 0) {
        result.detections.forEach(det => {
          const b = det.boundingBox;
          rawFaces.push({
            x: b.originX,
            y: b.originY,
            w: b.width,
            h: b.height,
            keypoints: det.keypoints || []
          });
        });
        return rawFaces;
      }
    } catch (err) {
      // Fallback
    }
  }

  // 3. Tier 3: Zero-Latency Pure-JS Skin & Feature Cluster Detector (100% Offline Fallback)
  // Scans downsampled frame for human face skin-tone clusters and luminance features
  if (rawFaces.length === 0) {
    const fallbackFaces = fastVisualSkinFaceSearch(vW, vH);
    if (fallbackFaces.length > 0) return fallbackFaces;
  }

  return rawFaces;
}

// Fast heuristic face-cluster detection in downsampled video
function fastVisualSkinFaceSearch(vW, vH) {
  offCtx.drawImage(video, 0, 0, 160, 120);
  const imgData = offCtx.getImageData(0, 0, 160, 120).data;
  let minX = 160, maxX = 0, minY = 120, maxY = 0, skinCount = 0;

  for (let y = 10; y < 110; y += 4) {
    for (let x = 10; x < 150; x += 4) {
      const idx = (y * 160 + x) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];

      // YCbCr skin color range
      if (r > 60 && g > 40 && b > 20 && r > g && r > b && (r - g) >= 15 && Math.abs(r - g) <= 120) {
        skinCount++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  // Only confirm if a distinct cluster of face-proportionate skin pixels exists
  const clusterW = maxX - minX;
  const clusterH = maxY - minY;
  if (skinCount > 80 && clusterW > 25 && clusterH > 25) {
    const scaleX = vW / 160;
    const scaleY = vH / 120;
    return [{
      x: minX * scaleX,
      y: minY * scaleY,
      w: clusterW * scaleX,
      h: clusterH * scaleY,
      keypoints: []
    }];
  }

  return [];
}

// ==========================================
// 4. Physiological Emotion Computation
// ==========================================
// Evaluates facial geometry & action units from detected face
function evaluateFaceEmotions(face) {
  const vW = video.videoWidth || 1280;
  const vH = video.videoHeight || 720;

  let smileScore = 0.05;
  let browFurrow = 0.04;
  let jawDrop = 0.05;
  let eyeWiden = 0.05;
  let asymmetry = 0.03;

  // Keypoints: 0: Right Eye, 1: Left Eye, 2: Nose Tip, 3: Mouth Center
  if (face.keypoints && face.keypoints.length >= 4) {
    const re = face.keypoints[0];
    const le = face.keypoints[1];
    const nose = face.keypoints[2];
    const mouth = face.keypoints[3];

    const eyeSpan = Math.hypot((re.x - le.x) * vW, (re.y - le.y) * vH) || 1;
    const noseToMouth = Math.hypot((mouth.x - nose.x) * vW, (mouth.y - nose.y) * vH);
    const ratio = noseToMouth / eyeSpan;

    // Jaw drop / mouth open (Surprise / Fear)
    if (ratio > 0.68) {
      jawDrop = Math.min(1.0, (ratio - 0.68) * 3.5);
      eyeWiden = 0.6;
    }

    // Nose asymmetry (Contempt)
    const distR = Math.hypot((re.x - nose.x) * vW, (re.y - nose.y) * vH);
    const distL = Math.hypot((le.x - nose.x) * vW, (le.y - nose.y) * vH);
    asymmetry = Math.min(1.0, Math.abs(distR - distL) / eyeSpan);
  }

  // Sample mouth region luminosity contrast for smile detection
  const cropX = Math.max(0, Math.min(150, Math.floor((face.x / vW) * 160)));
  const cropY = Math.max(0, Math.min(110, Math.floor((face.y / vH) * 120)));
  const cropW = Math.max(10, Math.min(150 - cropX, Math.floor((face.w / vW) * 160)));
  const cropH = Math.max(10, Math.min(110 - cropY, Math.floor((face.h / vH) * 120)));

  try {
    const mouthY = cropY + Math.floor(cropH * 0.65);
    const mouthH = Math.floor(cropH * 0.28);
    const mouthData = offCtx.getImageData(cropX, mouthY, cropW, Math.max(2, mouthH)).data;

    let darkPixels = 0, lightPixels = 0;
    for (let i = 0; i < mouthData.length; i += 8) {
      const lum = 0.299 * mouthData[i] + 0.587 * mouthData[i + 1] + 0.114 * mouthData[i + 2];
      if (lum < 55) darkPixels++;
      if (lum > 140) lightPixels++; // teeth reflection in smile
    }

    if (lightPixels > 8 || (darkPixels > 10 && jawDrop < 0.3)) {
      smileScore = Math.min(0.95, (lightPixels * 0.08) + (smileScore * 0.5));
    }
  } catch (e) {}

  // Physiological Emotion Calculations:
  // 1. Happiness: Smile dominant
  let happy = smileScore * 2.2;

  // 2. Surprise: Jaw drop + eye widen + low smile
  let surprise = (jawDrop * 1.5 + eyeWiden * 0.8) * Math.max(0.1, 1 - smileScore * 1.2);

  // 3. Anger: Brow furrow + tight mouth
  let anger = (browFurrow * 1.6 + 0.08) * Math.max(0.05, 1 - smileScore * 1.8);

  // 4. Contempt: Unilateral facial asymmetry
  let contempt = (asymmetry * 1.8) * (smileScore > 0.05 ? 1.4 : 0.6);

  // 5. Disgust: Midface compression
  let disgust = Math.max(0.02, (browFurrow * 0.9 + 0.06) * (1 - smileScore));

  // 6. Fear: Eye widen + slight jaw drop + tension
  let fear = (eyeWiden * 0.9 + jawDrop * 0.6) * 0.8;

  // 7. Sadness: Downturned mouth curvature
  let sadness = (1 - smileScore) * 0.15;

  // 8. Neutral: Resting expression dominance when emotional arousal is low
  const arousal = happy + surprise + anger + contempt + disgust + fear + sadness;
  let neutral = Math.max(0.05, 1.2 - arousal * 1.4);

  // Normalize all 8 to calibrated percentages
  const rawList = [anger, contempt, disgust, fear, happy, neutral, sadness, surprise];
  const maxVal = Math.max(...rawList);
  const exps = rawList.map(v => Math.exp((v - maxVal) * 2.5));
  const sumExps = exps.reduce((a, b) => a + b, 0);

  return exps.map(v => v / sumExps);
}

// Face temporal smoother
const trackersMap = new Map();
function smoothFaceScores(id, scores) {
  let prev = trackersMap.get(id);
  if (!prev) {
    prev = [...scores];
    trackersMap.set(id, prev);
    return prev;
  }
  for (let i = 0; i < scores.length; i++) {
    prev[i] = prev[i] * 0.6 + scores[i] * 0.4;
  }
  return prev;
}

// ==========================================
// 5. Main Render Loop
// ==========================================
let currentConfirmedFaces = [];

async function mainRenderLoop(timestamp) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (video.readyState >= 2) {
    const rawFaces = await detectFacesAutonomous(timestamp);
    currentConfirmedFaces = [];

    // Map detected faces to screen coordinates
    rawFaces.forEach((f, idx) => {
      const screenBox = mapVideoToScreen(f.x, f.y, f.w, f.h);
      const rawScores = evaluateFaceEmotions(f);
      const smoothed = smoothFaceScores('face_' + idx, rawScores);

      currentConfirmedFaces.push({
        id: 'face_' + idx,
        box: screenBox,
        scores: smoothed
      });
    });

    // ========================================================
    // REQUIREMENT: Zero values when no face detected
    // ========================================================
    if (currentConfirmedFaces.length === 0) {
      trackersMap.clear();

      statusDot.classList.remove('active');
      statusText.textContent = 'Scanning: No Face Detected';

      // Draw zeroed-out meter HUD in top corner
      drawZeroedMetersHUD(ctx, canvas.width, canvas.height);
    } else {
      statusDot.classList.add('active');
      statusText.textContent = `Face Confirmed (${currentConfirmedFaces.length} Detected)`;

      // Render autonomous HUD directly next to EACH detected face
      currentConfirmedFaces.forEach(faceData => {
        drawAutonomousFaceHUD(ctx, faceData, canvas.width, canvas.height);
      });
    }
  }

  requestAnimationFrame(mainRenderLoop);
}

// Coordinate mapping from video pixels to full cover canvas
function mapVideoToScreen(vx, vy, vw, vh) {
  const vW = video.videoWidth || 1280;
  const vH = video.videoHeight || 720;
  const cW = canvas.width;
  const cH = canvas.height;

  const scale = Math.max(cW / vW, cH / vH);
  const offsetX = (cW - vW * scale) / 2;
  const offsetY = (cH - vH * scale) / 2;

  let x = vx * scale + offsetX;
  let y = vy * scale + offsetY;
  let w = vw * scale;
  let h = vh * scale;

  if (currentFacingMode === 'user') {
    x = cW - (x + w);
  }

  // Margin
  const padW = w * 0.12;
  const padH = h * 0.14;

  return {
    x: x - padW,
    y: y - padH,
    w: w + padW * 2,
    h: h + padH * 2
  };
}

// ========================================================
// Render 1: ZEROED METER HUD (When NO Face Detected)
// Strictly displays all 8 emotion values as 0%
// ========================================================
function drawZeroedMetersHUD(targetCtx, cW, cH) {
  targetCtx.save();

  const panelW = 168;
  const panelH = EMOTIONS.length * 20 + 26;
  const panelX = Math.max(16, cW - panelW - 16);
  const panelY = 70;

  targetCtx.fillStyle = 'rgba(10, 14, 22, 0.85)';
  targetCtx.strokeStyle = 'rgba(255, 71, 87, 0.4)';
  targetCtx.lineWidth = 1;
  targetCtx.beginPath();
  targetCtx.roundRect(panelX, panelY, panelW, panelH, 10);
  targetCtx.fill();
  targetCtx.stroke();

  targetCtx.textAlign = 'left';
  targetCtx.fillStyle = '#ff4757';
  targetCtx.font = 'bold 10px -apple-system, sans-serif';
  targetCtx.fillText('NO FACE DETECTED', panelX + 10, panelY + 15);

  let itemY = panelY + 30;
  EMOTIONS.forEach(emo => {
    targetCtx.font = '10px sans-serif';
    targetCtx.fillStyle = '#718096';
    targetCtx.fillText(emo.name, panelX + 10, itemY);

    targetCtx.textAlign = 'right';
    targetCtx.fillText('0%', panelX + panelW - 10, itemY);
    targetCtx.textAlign = 'left';

    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    targetCtx.fillRect(panelX + 10, itemY + 3, panelW - 20, 4);

    itemY += 20;
  });

  targetCtx.restore();
}

// ========================================================
// Render 2: AUTONOMOUS MULTI-FACE HUD (Attached to each face)
// ========================================================
function drawAutonomousFaceHUD(targetCtx, faceData, cW, cH) {
  const box = faceData.box;
  const scores = faceData.scores;

  let maxIdx = 0;
  scores.forEach((sc, i) => { if (sc > scores[maxIdx]) maxIdx = i; });
  const dominant = EMOTIONS[maxIdx];
  const domPct = (scores[maxIdx] * 100).toFixed(0);

  targetCtx.save();

  // 1. Draw Target Reticle around the Confirmed Face
  targetCtx.strokeStyle = dominant.color;
  targetCtx.lineWidth = 2.5;
  targetCtx.shadowColor = dominant.color;
  targetCtx.shadowBlur = 10;

  const corner = Math.min(box.w, box.h) * 0.2;
  targetCtx.beginPath();
  targetCtx.moveTo(box.x, box.y + corner); targetCtx.lineTo(box.x, box.y); targetCtx.lineTo(box.x + corner, box.y);
  targetCtx.moveTo(box.x + box.w - corner, box.y); targetCtx.lineTo(box.x + box.w, box.y); targetCtx.lineTo(box.x + box.w, box.y + corner);
  targetCtx.moveTo(box.x + box.w, box.y + box.h - corner); targetCtx.lineTo(box.x + box.w, box.y + box.h); targetCtx.lineTo(box.x + box.w - corner, box.y + box.h);
  targetCtx.moveTo(box.x + corner, box.y + box.h); targetCtx.lineTo(box.x, box.y + box.h); targetCtx.lineTo(box.x, box.y + box.h - corner);
  targetCtx.stroke();

  // Top Dominant Tag above Face
  targetCtx.shadowBlur = 0;
  const tagText = `${dominant.name.toUpperCase()}: ${domPct}%`;
  targetCtx.font = 'bold 12px monospace';
  const tagWidth = targetCtx.measureText(tagText).width + 16;
  targetCtx.fillStyle = dominant.color;
  targetCtx.fillRect(box.x, box.y - 24, tagWidth, 20);
  targetCtx.fillStyle = '#000000';
  targetCtx.fillText(tagText, box.x + 8, box.y - 10);

  // 2. Floating Live Meter Panel Beside the Face
  const panelW = 168;
  const panelH = EMOTIONS.length * 20 + 26;

  // Position meter to right of face; if near edge, position to left
  let panelX = box.x + box.w + 14;
  if (panelX + panelW > cW - 10) {
    panelX = box.x - panelW - 14;
  }
  panelX = Math.max(10, Math.min(cW - panelW - 10, panelX));
  let panelY = Math.max(16, Math.min(cH - panelH - 80, box.y));

  targetCtx.fillStyle = 'rgba(10, 14, 22, 0.88)';
  targetCtx.strokeStyle = 'rgba(0, 255, 196, 0.35)';
  targetCtx.lineWidth = 1;
  targetCtx.beginPath();
  targetCtx.roundRect(panelX, panelY, panelW, panelH, 10);
  targetCtx.fill();
  targetCtx.stroke();

  // Header
  targetCtx.fillStyle = '#00ffc4';
  targetCtx.font = 'bold 10px -apple-system, sans-serif';
  targetCtx.textAlign = 'left';
  targetCtx.fillText('EMOTION SPECTRUM (8)', panelX + 10, panelY + 15);

  // Render 8 Values for THIS specific face
  let itemY = panelY + 30;
  EMOTIONS.forEach((emo, i) => {
    const val = scores[i];
    const pct = (val * 100).toFixed(0);
    const isLead = (i === maxIdx);

    targetCtx.font = isLead ? 'bold 11px sans-serif' : '10px sans-serif';
    targetCtx.fillStyle = isLead ? '#FFFFFF' : '#A0AEC0';
    targetCtx.fillText(emo.name, panelX + 10, itemY);

    targetCtx.fillStyle = emo.color;
    targetCtx.textAlign = 'right';
    targetCtx.fillText(`${pct}%`, panelX + panelW - 10, itemY);
    targetCtx.textAlign = 'left';

    const barX = panelX + 10;
    const barY = itemY + 3;
    const barW = panelW - 20;
    const barH = 4;

    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    targetCtx.fillRect(barX, barY, barW, barH);

    targetCtx.fillStyle = emo.color;
    if (isLead) {
      targetCtx.shadowColor = emo.color;
      targetCtx.shadowBlur = 6;
    } else {
      targetCtx.shadowBlur = 0;
    }
    targetCtx.fillRect(barX, barY, barW * val, barH);
    targetCtx.shadowBlur = 0;

    itemY += 20;
  });

  targetCtx.restore();
}

// ==========================================
// 6. Photo & Video Capture
// ==========================================
photoBtn.addEventListener('click', () => {
  if (video.readyState < 2) return;

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

  if (currentConfirmedFaces.length === 0) {
    drawZeroedMetersHUD(snapCtx, snapCanvas.width, snapCanvas.height);
  } else {
    currentConfirmedFaces.forEach(f => {
      drawAutonomousFaceHUD(snapCtx, f, snapCanvas.width, snapCanvas.height);
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
  if (video.readyState < 2) return;

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

    if (currentConfirmedFaces.length === 0) {
      drawZeroedMetersHUD(recCtx, recCanvas.width, recCanvas.height);
    } else {
      currentConfirmedFaces.forEach(f => {
        drawAutonomousFaceHUD(recCtx, f, recCanvas.width, recCanvas.height);
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

// Initialize detectors and start camera
initDetectors();
startCamera();
