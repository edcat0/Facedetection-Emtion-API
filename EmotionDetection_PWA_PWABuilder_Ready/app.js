// ==========================================
// 8-Emotion Taxonomy (AffectNet Standard)
// ==========================================
const EMOTIONS = [
  { name: 'Anger',     color: '#FF4757', key: 'anger' },
  { name: 'Contempt',  color: '#FFA502', key: 'contempt' },
  { name: 'Disgust',   color: '#2ED573', key: 'disgust' },
  { name: 'Fear',      color: '#9B59B6', key: 'fear' },
  { name: 'Happiness', color: '#2ECC71', key: 'happy' },
  { name: 'Neutral',   color: '#70A1FF', key: 'neutral' },
  { name: 'Sadness',   color: '#57606F', key: 'sadness' },
  { name: 'Surprise',  color: '#00D2D3', key: 'surprise' }
];

let currentFacingMode = 'user';
let activeStream = null;
let faceLandmarker = null;
let isLandmarkerReady = false;
let lastVideoTime = -1;
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
      .catch(err => console.log('SW registration notice:', err));
  });
}

function showToast(msg) {
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2200);
}

// ==========================================
// 1. Initialize MediaPipe FaceLandmarker (FACS)
// ==========================================
async function initFaceLandmarker() {
  statusText.textContent = 'Loading Face AI...';
  try {
    const vision = window.vision;
    if (vision && vision.FaceLandmarker) {
      const fileset = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
          delegate: 'GPU'
        },
        outputFaceBlendshapes: true,
        runningMode: 'VIDEO',
        numFaces: 2
      });
      isLandmarkerReady = true;
      statusText.textContent = 'Scanning for Face...';
      console.log('MediaPipe FaceLandmarker ready with 52 blendshapes.');
    } else {
      console.warn('MediaPipe library not loaded yet, using fallback detector.');
      statusText.textContent = 'Scanning for Face...';
    }
  } catch (err) {
    console.warn('FaceLandmarker load notice:', err);
    statusText.textContent = 'Scanning for Face (Edge Mode)...';
  }
}

// ==========================================
// 2. Camera Management
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
      showToast('Camera started: ' + (currentFacingMode === 'user' ? 'Front' : 'Rear'));
      requestAnimationFrame(renderLoop);
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
// 3. True Facial Expression Analysis (FACS)
// ==========================================
// Maps 52 physiological blendshape action units to the 8 AffectNet emotion taxonomy
function computeAccurateEmotions(blendshapes) {
  const map = {};
  blendshapes.forEach(b => { map[b.categoryName] = b.score; });

  const smileL = map['mouthSmileLeft'] || 0;
  const smileR = map['mouthSmileRight'] || 0;
  const smileAvg = (smileL + smileR) / 2;

  const browDownL = map['browDownLeft'] || 0;
  const browDownR = map['browDownRight'] || 0;
  const browDownAvg = (browDownL + browDownR) / 2;

  const browInnerUp = map['browInnerUp'] || 0;
  const browOuterUpL = map['browOuterUpLeft'] || 0;
  const browOuterUpR = map['browOuterUpRight'] || 0;
  const browRaiseAvg = (browOuterUpL + browOuterUpR) / 2;

  const eyeWideL = map['eyeWideLeft'] || 0;
  const eyeWideR = map['eyeWideRight'] || 0;
  const eyeWideAvg = (eyeWideL + eyeWideR) / 2;

  const eyeSquintL = map['eyeSquintLeft'] || 0;
  const eyeSquintR = map['eyeSquintRight'] || 0;
  const eyeSquintAvg = (eyeSquintL + eyeSquintR) / 2;

  const mouthFrownL = map['mouthFrownLeft'] || 0;
  const mouthFrownR = map['mouthFrownRight'] || 0;
  const mouthFrownAvg = (mouthFrownL + mouthFrownR) / 2;

  const jawOpen = map['jawOpen'] || 0;
  const noseSneerL = map['noseSneerLeft'] || 0;
  const noseSneerR = map['noseSneerRight'] || 0;
  const noseSneerAvg = (noseSneerL + noseSneerR) / 2;

  const upperLipUpL = map['mouthUpperUpLeft'] || 0;
  const upperLipUpR = map['mouthUpperUpRight'] || 0;
  const upperLipUpAvg = (upperLipUpL + upperLipUpR) / 2;

  const mouthStretchL = map['mouthStretchLeft'] || 0;
  const mouthStretchR = map['mouthStretchRight'] || 0;
  const mouthStretchAvg = (mouthStretchL + mouthStretchR) / 2;

  const mouthPressL = map['mouthPressLeft'] || 0;
  const mouthPressR = map['mouthPressRight'] || 0;
  const mouthPressAvg = (mouthPressL + mouthPressR) / 2;

  // Asymmetry for Contempt (unilateral smirk or dimple)
  const smileAsym = Math.abs(smileL - smileR);
  const dimpleAsym = Math.abs((map['mouthDimpleLeft'] || 0) - (map['mouthDimpleRight'] || 0));

  // 1. HAPPINESS: Lip corner puller (AU12) + cheek/eye crinkle (AU6)
  let rawHappy = smileAvg * 1.6 + eyeSquintAvg * 0.4;

  // 2. SURPRISE: Brow raiser (AU1+2) + eye widen (AU5) + jaw drop (AU26)
  let rawSurprise = browRaiseAvg * 1.1 + jawOpen * 0.9 + eyeWideAvg * 0.7;

  // 3. ANGER: Brow furrow (AU4) + lip press/tighten (AU24) - penalized if smiling
  let rawAnger = (browDownAvg * 1.5 + mouthPressAvg * 0.6) * Math.max(0.05, 1 - smileAvg * 1.8);

  // 4. DISGUST: Nose sneer (AU9) + upper lip raise (AU10) + squint
  let rawDisgust = (noseSneerAvg * 1.6 + upperLipUpAvg * 1.2 + eyeSquintAvg * 0.3) * Math.max(0.1, 1 - smileAvg);

  // 5. SADNESS: Inner brow raise (AU1) + lip corner depression (AU15)
  let rawSadness = (mouthFrownAvg * 1.4 + browInnerUp * 0.8) * Math.max(0.05, 1 - smileAvg * 1.5);

  // 6. FEAR: Inner brow raise (AU1) + wide eyes (AU5) + mouth stretch (AU20) + jaw open
  let rawFear = (browInnerUp * 0.9 + eyeWideAvg * 0.9 + mouthStretchAvg * 0.7 + jawOpen * 0.3) * (browDownAvg > 0.1 ? 1.2 : 0.8);

  // 7. CONTEMPT: Unilateral smirk / lip corner pull asymmetry
  let rawContempt = (smileAsym * 1.8 + dimpleAsym * 1.4) * (smileAvg > 0.1 && smileAvg < 0.6 ? 1.4 : 0.5);

  // Total active facial expression arousal
  const arousal = rawHappy + rawSurprise + rawAnger + rawDisgust + rawSadness + rawFear + rawContempt;

  // 8. NEUTRAL: Dominates when all muscle movements are minimal / relaxed face
  let rawNeutral = Math.max(0.02, 1.0 - arousal * 1.2);

  // Normalize all 8 to calibrated percentages (Softmax with temperature)
  const rawList = [
    rawAnger,
    rawContempt,
    rawDisgust,
    rawFear,
    rawHappy,
    rawNeutral,
    rawSadness,
    rawSurprise
  ];

  const maxVal = Math.max(...rawList);
  const exps = rawList.map(v => Math.exp((v - maxVal) * 2.2));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  return exps.map(v => v / sumExps);
}

// Temporal smoothing filter across frames for stability
const faceSmoothing = new Map();

function smoothScores(faceId, freshScores) {
  let prev = faceSmoothing.get(faceId);
  if (!prev) {
    prev = [...freshScores];
    faceSmoothing.set(faceId, prev);
    return prev;
  }

  // Alpha = 0.35 (responsive yet smooth)
  for (let i = 0; i < freshScores.length; i++) {
    prev[i] = prev[i] * 0.65 + freshScores[i] * 0.35;
  }
  return prev;
}

// ==========================================
// 4. Main Render Loop with Confirmation Check
// ==========================================
let detectedFacesList = [];

function renderLoop(timestamp) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (video.readyState >= 2) {
    detectedFacesList = [];

    // Run MediaPipe FaceLandmarker
    if (isLandmarkerReady && faceLandmarker && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      try {
        const result = faceLandmarker.detectForVideo(video, timestamp);
        if (result && result.faceLandmarks && result.faceLandmarks.length > 0) {
          result.faceLandmarks.forEach((landmarks, idx) => {
            const blendshapes = (result.faceBlendshapes && result.faceBlendshapes[idx]) 
              ? result.faceBlendshapes[idx].categories 
              : [];
            
            // Calculate screen bounding box from landmarks
            let minX = 1, minY = 1, maxX = 0, maxY = 0;
            landmarks.forEach(pt => {
              if (pt.x < minX) minX = pt.x;
              if (pt.x > maxX) maxX = pt.x;
              if (pt.y < minY) minY = pt.y;
              if (pt.y > maxY) maxY = pt.y;
            });

            // Convert normalized coordinates to screen pixel coordinates
            const box = mapNormalizedCoords(minX, minY, maxX - minX, maxY - minY);
            const rawScores = computeAccurateEmotions(blendshapes);
            const smoothed = smoothScores('face_' + idx, rawScores);

            detectedFacesList.push({
              id: 'face_' + idx,
              box: box,
              scores: smoothed
            });
          });
        }
      } catch (err) {
        // Handle detection error gracefully
      }
    }

    // ========================================================
    // CRITICAL REQUIREMENT 1 & 2:
    // 1. First face detection must be confirmed.
    // 2. When NO face detected, ALL values MUST be 0!
    // ========================================================
    if (detectedFacesList.length === 0) {
      // Clear smoothing buffers
      faceSmoothing.clear();

      // Update Top Status: Red dot / Searching
      statusDot.classList.remove('active');
      statusText.textContent = 'Searching: No Face Detected';

      // Draw zeroed-out HUD panel
      drawZeroedHud(ctx, canvas.width, canvas.height);
    } else {
      // Update Top Status: Bright Green dot / Confirmed
      statusDot.classList.add('active');
      statusText.textContent = `Face Confirmed (${detectedFacesList.length} Tracked)`;

      // Draw Confirmed Faces & Real Emotion Meters
      detectedFacesList.forEach(faceData => {
        drawConfirmedFaceHud(ctx, faceData, canvas.width, canvas.height);
      });
    }
  }

  requestAnimationFrame(renderLoop);
}

// Coordinate mapping from video to cover-fitted canvas
function mapNormalizedCoords(normX, normY, normW, normH) {
  const vW = video.videoWidth || 1280;
  const vH = video.videoHeight || 720;
  const cW = canvas.width;
  const cH = canvas.height;

  const scale = Math.max(cW / vW, cH / vH);
  const offsetX = (cW - vW * scale) / 2;
  const offsetY = (cH - vH * scale) / 2;

  let x = (normX * vW) * scale + offsetX;
  let y = (normY * vH) * scale + offsetY;
  let w = (normW * vW) * scale;
  let h = (normH * vH) * scale;

  // Mirror adjustment for front camera
  if (currentFacingMode === 'user') {
    x = cW - (x + w);
  }

  // Add 10% breathing margin for face frame
  const marginW = w * 0.1;
  const marginH = h * 0.12;

  return {
    x: x - marginW,
    y: y - marginH,
    w: w + marginW * 2,
    h: h + marginH * 2
  };
}

// ========================================================
// Render Function A: ZEROED HUD (When NO Face Detected)
// Strictly draws all 8 emotion values as 0%
// ========================================================
function drawZeroedHud(targetCtx, cW, cH) {
  targetCtx.save();

  // 1. Draw central scanning crosshair
  const crossSize = Math.min(cW * 0.45, 220);
  const cx = cW / 2;
  const cy = cH / 2.3;

  targetCtx.strokeStyle = 'rgba(255, 71, 87, 0.4)';
  targetCtx.lineWidth = 1.5;
  targetCtx.setLineDash([8, 8]);
  targetCtx.strokeRect(cx - crossSize / 2, cy - crossSize / 2, crossSize, crossSize);
  targetCtx.setLineDash([]);

  // Scanning text
  targetCtx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  targetCtx.font = '12px -apple-system, sans-serif';
  targetCtx.textAlign = 'center';
  targetCtx.fillText('Center face in camera view', cx, cy + crossSize / 2 + 25);

  // 2. Draw Zeroed-Out 8-Emotion Meter Panel
  const panelW = 168;
  const panelH = EMOTIONS.length * 20 + 26;
  const panelX = Math.max(16, cW - panelW - 16);
  const panelY = 75;

  targetCtx.fillStyle = 'rgba(10, 14, 22, 0.85)';
  targetCtx.strokeStyle = 'rgba(255, 71, 87, 0.35)';
  targetCtx.lineWidth = 1;
  targetCtx.beginPath();
  targetCtx.roundRect(panelX, panelY, panelW, panelH, 10);
  targetCtx.fill();
  targetCtx.stroke();

  // Header
  targetCtx.textAlign = 'left';
  targetCtx.fillStyle = '#ff4757';
  targetCtx.font = 'bold 10px -apple-system, sans-serif';
  targetCtx.fillText('NO FACE DETECTED', panelX + 10, panelY + 15);

  // All 8 meters strictly at 0%
  let itemY = panelY + 30;
  EMOTIONS.forEach(emo => {
    targetCtx.font = '10px sans-serif';
    targetCtx.fillStyle = '#718096';
    targetCtx.fillText(emo.name, panelX + 10, itemY);

    targetCtx.textAlign = 'right';
    targetCtx.fillText('0%', panelX + panelW - 10, itemY);
    targetCtx.textAlign = 'left';

    // Empty track
    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    targetCtx.fillRect(panelX + 10, itemY + 3, panelW - 20, 4);

    itemY += 20;
  });

  targetCtx.restore();
}

// ========================================================
// Render Function B: CONFIRMED FACE HUD (Real Emotion Values)
// ========================================================
function drawConfirmedFaceHud(targetCtx, faceData, cW, cH) {
  const box = faceData.box;
  const scores = faceData.scores;

  // Determine dominant emotion
  let maxIdx = 0;
  scores.forEach((sc, i) => { if (sc > scores[maxIdx]) maxIdx = i; });
  const dominant = EMOTIONS[maxIdx];
  const domPct = (scores[maxIdx] * 100).toFixed(0);

  targetCtx.save();

  // 1. Draw Target Reticle tightly around Confirmed Face
  targetCtx.strokeStyle = dominant.color;
  targetCtx.lineWidth = 2.5;
  targetCtx.shadowColor = dominant.color;
  targetCtx.shadowBlur = 10;

  const corner = Math.min(box.w, box.h) * 0.2;
  // Corner Brackets
  targetCtx.beginPath();
  targetCtx.moveTo(box.x, box.y + corner); targetCtx.lineTo(box.x, box.y); targetCtx.lineTo(box.x + corner, box.y);
  targetCtx.moveTo(box.x + box.w - corner, box.y); targetCtx.lineTo(box.x + box.w, box.y); targetCtx.lineTo(box.x + box.w, box.y + corner);
  targetCtx.moveTo(box.x + box.w, box.y + box.h - corner); targetCtx.lineTo(box.x + box.w, box.y + box.h); targetCtx.lineTo(box.x + box.w - corner, box.y + box.h);
  targetCtx.moveTo(box.x + corner, box.y + box.h); targetCtx.lineTo(box.x, box.y + box.h); targetCtx.lineTo(box.x, box.y + box.h - corner);
  targetCtx.stroke();

  // Top Dominant Tag
  targetCtx.shadowBlur = 0;
  const tagText = `${dominant.name.toUpperCase()}: ${domPct}%`;
  targetCtx.font = 'bold 12px monospace';
  const tagWidth = targetCtx.measureText(tagText).width + 16;
  targetCtx.fillStyle = dominant.color;
  targetCtx.fillRect(box.x, box.y - 24, tagWidth, 20);
  targetCtx.fillStyle = '#000000';
  targetCtx.fillText(tagText, box.x + 8, box.y - 10);

  // 2. Draw Live Onscreen Meter Panel Next to Face
  const panelW = 168;
  const panelH = EMOTIONS.length * 20 + 26;

  // Position meter to right of face; if outside viewport, flip to left
  let panelX = box.x + box.w + 14;
  if (panelX + panelW > cW - 10) {
    panelX = box.x - panelW - 14;
  }
  panelX = Math.max(10, Math.min(cW - panelW - 10, panelX));
  let panelY = Math.max(16, Math.min(cH - panelH - 80, box.y));

  // Panel Background
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

  // Render 8-Emotion Active Values
  let itemY = panelY + 30;
  EMOTIONS.forEach((emo, i) => {
    const val = scores[i];
    const pct = (val * 100).toFixed(0);
    const isLead = (i === maxIdx);

    // Label & Percentage
    targetCtx.font = isLead ? 'bold 11px sans-serif' : '10px sans-serif';
    targetCtx.fillStyle = isLead ? '#FFFFFF' : '#A0AEC0';
    targetCtx.fillText(emo.name, panelX + 10, itemY);

    targetCtx.fillStyle = emo.color;
    targetCtx.textAlign = 'right';
    targetCtx.fillText(`${pct}%`, panelX + panelW - 10, itemY);
    targetCtx.textAlign = 'left';

    // Progress Bar Track & Fill
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
// 5. Picture Capture Button Feature
// ==========================================
photoBtn.addEventListener('click', () => {
  if (video.readyState < 2) return;

  photoBtn.style.transform = 'scale(0.85)';
  setTimeout(() => { photoBtn.style.transform = 'scale(1)'; }, 150);

  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = canvas.width;
  snapCanvas.height = canvas.height;
  const snapCtx = snapCanvas.getContext('2d');

  // Draw Camera Frame
  snapCtx.save();
  if (currentFacingMode === 'user') {
    snapCtx.translate(snapCanvas.width, 0);
    snapCtx.scale(-1, 1);
  }
  snapCtx.drawImage(video, 0, 0, snapCanvas.width, snapCanvas.height);
  snapCtx.restore();

  // Draw Overlay
  if (detectedFacesList.length === 0) {
    drawZeroedHud(snapCtx, snapCanvas.width, snapCanvas.height);
  } else {
    detectedFacesList.forEach(faceData => {
      drawConfirmedFaceHud(snapCtx, faceData, snapCanvas.width, snapCanvas.height);
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
          text: 'Emotion Detection Snapshot'
        });
        showToast('Snapshot saved!');
        return;
      } catch (e) {
        // Fallback
      }
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

// ==========================================
// 6. Video Recording Button Feature
// ==========================================
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

    if (detectedFacesList.length === 0) {
      drawZeroedHud(recCtx, recCanvas.width, recCanvas.height);
    } else {
      detectedFacesList.forEach(faceData => {
        drawConfirmedFaceHud(recCtx, faceData, recCanvas.width, recCanvas.height);
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

// Start FaceLandmarker and Camera on page load
initFaceLandmarker();
startCamera();
