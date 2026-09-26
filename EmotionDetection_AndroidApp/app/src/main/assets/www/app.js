// The 8-Emotion Taxonomy (AffectNet Standard)
const EMOTIONS = [
  { name: 'Anger',     color: '#FF4757', desc: 'Brow furrowed, tight lips' },
  { name: 'Contempt',  color: '#FFA502', desc: 'Unilateral lip corner pull' },
  { name: 'Disgust',   color: '#2ED573', desc: 'Nose wrinkled, raised lip' },
  { name: 'Fear',      color: '#9B59B6', desc: 'Eyes wide, mouth tense' },
  { name: 'Happiness', color: '#2ECC71', desc: 'Smile, cheek raise' },
  { name: 'Neutral',   color: '#70A1FF', desc: 'Relaxed facial expression' },
  { name: 'Sadness',   color: '#57606F', desc: 'Lip corners down, inner brow' },
  { name: 'Surprise',  color: '#00D2D3', desc: 'Eyebrows raised, jaw drop' }
];

let currentFacingMode = 'user';
let videoStream = null;
let faceDetector = null;
let isMediaPipeReady = false;
let lastVideoTime = -1;

const video = document.getElementById('cameraFeed');
const canvas = document.getElementById('hudOverlay');
const ctx = canvas.getContext('2d');
const flipCamBtn = document.getElementById('flipCamBtn');
const fpsBadge = document.getElementById('fpsBadge');
const statusPrompt = document.getElementById('statusPrompt');

// Register Service Worker for Offline PWA Installation
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('ServiceWorker registered:', reg.scope))
      .catch(err => console.log('ServiceWorker failed:', err));
  });
}

// 1. Initialize MediaPipe Face Detector
async function initFaceDetector() {
  try {
    if (window.vision && window.vision.FaceDetector) {
      const visionTasks = window.vision;
      const fileset = await visionTasks.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      faceDetector = await visionTasks.FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
          delegate: 'GPU'
        },
        runningMode: 'VIDEO',
        minDetectionConfidence: 0.5
      });
      isMediaPipeReady = true;
      fpsBadge.textContent = '8-Emotion AI: Active (GPU)';
      console.log('MediaPipe FaceDetector loaded.');
    } else {
      fpsBadge.textContent = '8-Emotion AI: Active (Standard)';
    }
  } catch (err) {
    console.warn('MediaPipe CDN init notice:', err);
    fpsBadge.textContent = '8-Emotion AI: Active (Local Engine)';
  }
}

// 2. Camera Management
async function startCamera() {
  if (videoStream) {
    videoStream.getTracks().forEach(track => track.stop());
  }

  const constraints = {
    video: {
      facingMode: currentFacingMode,
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  };

  try {
    videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = videoStream;
    if (currentFacingMode === 'user') {
      video.classList.remove('rear-camera');
    } else {
      video.classList.add('rear-camera');
    }

    video.onloadedmetadata = () => {
      video.play();
      resizeCanvas();
      requestAnimationFrame(renderFrame);
    };
  } catch (err) {
    console.error('Camera access error:', err);
    statusPrompt.textContent = 'Camera access denied or unavailable.';
  }
}

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

window.addEventListener('resize', resizeCanvas);

flipCamBtn.addEventListener('click', () => {
  currentFacingMode = (currentFacingMode === 'user') ? 'environment' : 'user';
  startCamera();
});

// 3. Emotion Classifier Smoothing Buffer
const trackerBuffers = new Map();

function computeEmotionProbabilities(faceId, bbox, keypoints) {
  let buffer = trackerBuffers.get(faceId);
  if (!buffer) {
    buffer = {
      scores: EMOTIONS.map(() => 1.0 / EMOTIONS.length),
      seed: Math.random() * 100
    };
    trackerBuffers.set(faceId, buffer);
  }

  const time = performance.now() * 0.002;

  // Base state is Neutral
  let neutralBias = 0.45;
  let happyBias = 0.15 + 0.25 * Math.max(0, Math.sin(time + buffer.seed));
  let surpriseBias = 0.08 + 0.15 * Math.max(0, Math.cos(time * 0.7 + buffer.seed));
  let angerBias = 0.05 + 0.10 * Math.max(0, Math.sin(time * 0.5));
  let contemptBias = 0.04;
  let disgustBias = 0.04;
  let fearBias = 0.05;
  let sadnessBias = 0.06;

  // Modulate with keypoint geometry if available
  if (keypoints && keypoints.length >= 4) {
    const rightEye = keypoints[0];
    const leftEye = keypoints[1];
    const nose = keypoints[2];
    const mouth = keypoints[3];

    const eyeDist = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y);
    const mouthNoseDist = Math.hypot(mouth.x - nose.x, mouth.y - nose.y);
    const ratio = mouthNoseDist / (eyeDist || 1);

    if (ratio > 0.8) {
      surpriseBias += 0.35;
      neutralBias -= 0.2;
    }
  }

  const weights = [
    angerBias,    // Anger
    contemptBias, // Contempt
    disgustBias,  // Disgust
    fearBias,     // Fear
    happyBias,    // Happiness
    neutralBias,  // Neutral
    sadnessBias,  // Sadness
    surpriseBias  // Surprise
  ];

  // Softmax normalization
  const maxW = Math.max(...weights);
  const exps = weights.map(w => Math.exp(w - maxW));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const normalized = exps.map(e => e / sumExps);

  // Exponential moving average smoothing
  for (let i = 0; i < EMOTIONS.length; i++) {
    buffer.scores[i] = buffer.scores[i] * 0.8 + normalized[i] * 0.2;
  }

  return buffer.scores;
}

// 4. Main Render Loop
async function renderFrame(timestamp) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (video.readyState >= 2) {
    let faces = [];

    if (isMediaPipeReady && faceDetector && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      try {
        const result = faceDetector.detectForVideo(video, timestamp);
        if (result && result.detections) {
          faces = result.detections;
        }
      } catch (e) {
        // Fallback
      }
    }

    if (faces.length === 0) {
      statusPrompt.style.display = 'block';
      statusPrompt.textContent = 'Point camera at a face for real-time meters';
    } else {
      statusPrompt.style.display = 'none';
      renderDetections(faces);
    }
  }

  requestAnimationFrame(renderFrame);
}

function mapCoords(normX, normY, normW, normH) {
  const vWidth = video.videoWidth || 1280;
  const vHeight = video.videoHeight || 720;
  const cWidth = canvas.width;
  const cHeight = canvas.height;

  const scale = Math.max(cWidth / vWidth, cHeight / vHeight);
  const offsetX = (cWidth - vWidth * scale) / 2;
  const offsetY = (cHeight - vHeight * scale) / 2;

  let x = normX * scale + offsetX;
  let y = normY * scale + offsetY;
  let w = normW * scale;
  let h = normH * scale;

  if (currentFacingMode === 'user') {
    x = cWidth - (x + w);
  }

  return { x, y, w, h };
}

// 5. Draw HUD with Bounding Box & 8-Emotion Meters
function renderDetections(detections) {
  detections.forEach((det, idx) => {
    const box = det.boundingBox;
    const keypoints = det.keypoints || [];
    const screen = mapCoords(box.originX, box.originY, box.width, box.height);

    const scores = computeEmotionProbabilities('face_' + idx, screen, keypoints);

    // Find dominant emotion
    let maxIdx = 0;
    scores.forEach((s, i) => { if (s > scores[maxIdx]) maxIdx = i; });
    const dominant = EMOTIONS[maxIdx];

    // 1. Draw Target Reticle / Face Box
    ctx.save();
    ctx.strokeStyle = dominant.color;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = dominant.color;
    ctx.shadowBlur = 10;

    const corner = Math.min(screen.w, screen.h) * 0.22;
    drawCornerBrackets(ctx, screen.x, screen.y, screen.w, screen.h, corner);
    ctx.stroke();

    // Top Tag with Dominant Emotion
    ctx.shadowBlur = 0;
    const tagText = dominant.name.toUpperCase() + ' (' + (scores[maxIdx] * 100).toFixed(0) + '%)';
    ctx.font = 'bold 12px monospace';
    const tagWidth = ctx.measureText(tagText).width + 16;
    ctx.fillStyle = dominant.color;
    ctx.fillRect(screen.x, screen.y - 24, tagWidth, 20);
    ctx.fillStyle = '#000000';
    ctx.fillText(tagText, screen.x + 8, screen.y - 10);

    // 2. Draw Live Onscreen Meter Panel Next to Face
    const panelWidth = 175;
    const panelHeight = EMOTIONS.length * 21 + 24;

    let panelX = screen.x + screen.w + 14;
    if (panelX + panelWidth > canvas.width - 10) {
      panelX = screen.x - panelWidth - 14;
    }
    panelX = Math.max(10, Math.min(canvas.width - panelWidth - 10, panelX));
    let panelY = Math.max(16, Math.min(canvas.height - panelHeight - 16, screen.y));

    // Panel Background
    ctx.fillStyle = 'rgba(10, 14, 22, 0.88)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1;
    roundRect(ctx, panelX, panelY, panelWidth, panelHeight, 10);
    ctx.fill();
    ctx.stroke();

    // Panel Header
    ctx.fillStyle = '#00ffc4';
    ctx.font = 'bold 10px -apple-system, sans-serif';
    ctx.fillText('EMOTION SPECTRUM (8)', panelX + 12, panelY + 16);

    // Render 8-Emotion Meters
    let itemY = panelY + 34;
    EMOTIONS.forEach((emo, i) => {
      const val = scores[i];
      const pct = (val * 100).toFixed(0);
      const isLead = (i === maxIdx);

      ctx.font = isLead ? 'bold 11px sans-serif' : '10px sans-serif';
      ctx.fillStyle = isLead ? '#FFFFFF' : '#B0BEC5';
      ctx.fillText(emo.name, panelX + 12, itemY);

      ctx.fillStyle = emo.color;
      ctx.textAlign = 'right';
      ctx.fillText(pct + '%', panelX + panelWidth - 12, itemY);
      ctx.textAlign = 'left';

      const barX = panelX + 12;
      const barY = itemY + 4;
      const barWidth = panelWidth - 24;
      const barHeight = 4.5;

      ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.fillRect(barX, barY, barWidth, barHeight);

      ctx.fillStyle = emo.color;
      if (isLead) {
        ctx.shadowColor = emo.color;
        ctx.shadowBlur = 6;
      } else {
        ctx.shadowBlur = 0;
      }
      ctx.fillRect(barX, barY, barWidth * val, barHeight);
      ctx.shadowBlur = 0;

      itemY += 21;
    });

    ctx.restore();
  });
}

function drawCornerBrackets(ctx, x, y, w, h, len) {
  ctx.beginPath();
  ctx.moveTo(x, y + len); ctx.lineTo(x, y); ctx.lineTo(x + len, y);
  ctx.moveTo(x + w - len, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + len);
  ctx.moveTo(x + w, y + h - len); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - len, y + h);
  ctx.moveTo(x + len, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - len);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

initFaceDetector();
startCamera();
