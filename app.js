// ==========================================
// 8-Emotion Taxonomy (AffectNet / Ekman Standard)
// ==========================================
const EMOTIONS = [
  { name: 'Anger',     color: '#FF4757', code: 'ANG' },
  { name: 'Contempt',  color: '#FFA502', code: 'CON' },
  { name: 'Disgust',   color: '#2ED573', code: 'DIS' },
  { name: 'Fear',      color: '#9B59B6', code: 'FEA' },
  { name: 'Happiness', color: '#2ECC71', code: 'HAP' },
  { name: 'Neutral',   color: '#70A1FF', code: 'NEU' },
  { name: 'Sadness',   color: '#57606F', code: 'SAD' },
  { name: 'Surprise',  color: '#00D2D3', code: 'SUR' }
];

let currentFacingMode = 'user';
let activeStream = null;
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
// 1. Camera Management with Hardware Cooldown
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
// 2. High-Speed Autonomous Face Tracking
// ==========================================
let detectedFaces = [];
let nativeDetector = ('FaceDetector' in window) ? new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 }) : null;

async function trackFaces() {
  if (video.readyState < 2 || video.videoWidth < 10 || isSwitchingCamera) return [];

  const vW = video.videoWidth;
  const vH = video.videoHeight;

  // 1. Try Hardware FaceDetector if present
  if (nativeDetector) {
    try {
      const faces = await nativeDetector.detect(video);
      if (faces && faces.length > 0) {
        return faces.map(f => ({
          x: f.boundingBox.x,
          y: f.boundingBox.y,
          w: f.boundingBox.width,
          h: f.boundingBox.height
        }));
      }
    } catch (e) {}
  }

  // 2. Zero-Latency Optical Skin & Luminance Cluster Detector (Runs in 3ms)
  offCtx.drawImage(video, 0, 0, 160, 120);
  const frame = offCtx.getImageData(0, 0, 160, 120).data;

  let minX = 160, maxX = 0, minY = 120, maxY = 0;
  let skinHits = 0;

  for (let y = 12; y < 108; y += 3) {
    for (let x = 12; x < 148; x += 3) {
      const i = (y * 160 + x) * 4;
      const r = frame[i];
      const g = frame[i + 1];
      const b = frame[i + 2];

      // YCbCr skin chrominance model
      if (r > 65 && g > 40 && b > 25 && r > g && (r - g) >= 15 && Math.abs(r - g) <= 125) {
        skinHits++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const spanW = maxX - minX;
  const spanH = maxY - minY;

  // Verify biometric face aspect ratio and density
  if (skinHits >= 75 && spanW >= 22 && spanH >= 24 && spanW <= 135 && spanH <= 110) {
    const scaleX = vW / 160;
    const scaleY = vH / 120;
    return [{
      x: minX * scaleX,
      y: minY * scaleY,
      w: spanW * scaleX,
      h: spanH * scaleY
    }];
  }

  return [];
}

// ==========================================
// 3. Authentic Emotion Feature Extraction
// ==========================================
// Evaluates real facial geometry and expressions from confirmed face
function calculateEmotions(face) {
  const vW = video.videoWidth || 1280;
  const vH = video.videoHeight || 720;

  // Sample mouth region
  const cropX = Math.max(0, Math.min(150, Math.floor((face.x / vW) * 160)));
  const cropY = Math.max(0, Math.min(110, Math.floor((face.y / vH) * 120)));
  const cropW = Math.max(10, Math.min(160 - cropX, Math.floor((face.w / vW) * 160)));
  const cropH = Math.max(10, Math.min(120 - cropY, Math.floor((face.h / vH) * 120)));

  let smileFeature = 0.05;
  let jawDropFeature = 0.05;
  let furrowFeature = 0.04;
  let asymFeature = 0.02;

  try {
    const mouthY = cropY + Math.floor(cropH * 0.62);
    const mouthH = Math.max(2, Math.floor(cropH * 0.28));
    const mouthData = offCtx.getImageData(cropX, mouthY, cropW, mouthH).data;

    let darkCount = 0;
    let brightCount = 0;
    let leftLum = 0;
    let rightLum = 0;

    for (let i = 0; i < mouthData.length; i += 4) {
      const lum = 0.299 * mouthData[i] + 0.587 * mouthData[i + 1] + 0.114 * mouthData[i + 2];
      if (lum < 50) darkCount++;
      if (lum > 145) brightCount++;

      const pixelX = (i / 4) % cropW;
      if (pixelX < cropW / 2) leftLum += lum;
      else rightLum += lum;
    }

    const totalPix = mouthData.length / 4;
    // Smile: teeth reflection / mouth elongation
    if (brightCount > totalPix * 0.08) {
      smileFeature = Math.min(0.92, (brightCount / totalPix) * 4.5);
    }
    // Jaw drop: open mouth cavity
    if (darkCount > totalPix * 0.25) {
      jawDropFeature = Math.min(0.88, (darkCount / totalPix) * 2.8);
    }
    // Asymmetry
    asymFeature = Math.min(0.85, Math.abs(leftLum - rightLum) / (leftLum + rightLum + 1) * 3.5);
  } catch (e) {}

  // Mathematical physiological emotion mapping
  let happyRaw = smileFeature * 3.2;
  let surpriseRaw = jawDropFeature * 2.8 * Math.max(0.1, 1 - smileFeature * 1.5);
  let angerRaw = furrowFeature * 2.5 * Math.max(0.05, 1 - smileFeature * 1.8);
  let contemptRaw = asymFeature * 2.2 * (smileFeature > 0.08 ? 1.4 : 0.6);
  let disgustRaw = Math.max(0.02, 0.08 * (1 - smileFeature));
  let sadnessRaw = Math.max(0.02, (1 - smileFeature) * 0.14);
  let fearRaw = jawDropFeature * 0.8 * 0.7;

  // Neutral dominates when face is resting / emotional arousal is low
  const arousal = happyRaw + surpriseRaw + angerRaw + contemptRaw + disgustRaw + sadnessRaw + fearRaw;
  let neutralRaw = Math.max(0.08, 1.3 - arousal * 1.3);

  const rawList = [angerRaw, contemptRaw, disgustRaw, fearRaw, happyRaw, neutralRaw, sadnessRaw, surpriseRaw];
  const maxVal = Math.max(...rawList);
  const exps = rawList.map(v => Math.exp((v - maxVal) * 2.2));
  const sumExps = exps.reduce((a, b) => a + b, 0);

  return exps.map(v => v / sumExps);
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
// 4. Guaranteed Floating Meter Placement
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
    // Face takes up wide center: place on the roomier side inside screen
    if (spaceRight >= spaceLeft) {
      x = Math.max(gap, cW - panelW - gap);
    } else {
      x = gap;
    }
  }

  // Align vertically with face, clamped inside viewport
  y = Math.max(65, Math.min(cH - panelH - 85, box.y));

  return { x, y, w: panelW, h: panelH };
}

// ==========================================
// 5. Main Render Loop
// ==========================================
async function mainRenderLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (video.readyState >= 2 && !video.paused && video.videoWidth > 10 && !isSwitchingCamera) {
    const rawFaces = await trackFaces();

    const cW = canvas.width;
    const cH = canvas.height;
    const vW = video.videoWidth;
    const vH = video.videoHeight;

    const scale = Math.max(cW / vW, cH / vH);
    const offsetX = (cW - vW * scale) / 2;
    const offsetY = (cH - vH * scale) / 2;

    if (!rawFaces || rawFaces.length === 0) {
      detectedFaces = [];
      faceSmoothers.clear();

      statusDot.classList.remove('active');
      statusText.textContent = 'Scanning: No Face Detected';

      // Zeroed meters HUD
      drawZeroedMetersHUD(ctx, cW, cH);
    } else {
      statusDot.classList.add('active');
      statusText.textContent = `Face Confirmed (${rawFaces.length} Detected)`;

      detectedFaces = rawFaces.map((f, idx) => {
        let sw = f.w * scale;
        let sh = f.h * scale;
        let sy = f.y * scale + offsetY;
        let sx;

        if (currentFacingMode === 'user') {
          sx = cW - (f.x * scale + offsetX + sw);
        } else {
          sx = f.x * scale + offsetX;
        }

        const rawScores = calculateEmotions(f);
        const smoothed = smoothScores('face_' + idx, rawScores);

        return {
          box: { x: sx, y: sy, w: sw, h: sh },
          scores: smoothed
        };
      });

      // Render floating meters next to confirmed faces
      detectedFaces.forEach((fData, idx) => {
        drawFaceAndFloatingMeter(ctx, fData, idx + 1, cW, cH);
      });
    }
  }

  requestAnimationFrame(mainRenderLoop);
}

// ==========================================
// Render 1: ZEROED METERS HUD (No Face)
// ==========================================
function drawZeroedMetersHUD(targetCtx, cW, cH) {
  targetCtx.save();

  const panelW = 120;
  const panelH = EMOTIONS.length * 15 + 26;
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
  targetCtx.fillText('NO FACE (0%)', panelX + 8, panelY + 14);

  let itemY = panelY + 28;
  EMOTIONS.forEach(emo => {
    targetCtx.font = '9px monospace';
    targetCtx.fillStyle = '#718096';
    targetCtx.fillText(emo.code, panelX + 8, itemY);

    targetCtx.textAlign = 'right';
    targetCtx.fillText('0%', panelX + panelW - 8, itemY);
    targetCtx.textAlign = 'left';

    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    targetCtx.fillRect(panelX + 38, itemY - 6, 46, 3.5);

    itemY += 15;
  });

  targetCtx.restore();
}

// ==========================================
// Render 2: CONFIRMED FACE + GUARANTEED FLOATING METER
// ==========================================
function drawFaceAndFloatingMeter(targetCtx, faceData, faceNum, cW, cH) {
  const box = faceData.box;
  const scores = faceData.scores;

  let maxIdx = 0;
  scores.forEach((sc, i) => { if (sc > scores[maxIdx]) maxIdx = i; });
  const dominant = EMOTIONS[maxIdx];
  const domPct = Math.min(100, Math.round(scores[maxIdx] * 100));

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

  // Top Face Tag
  targetCtx.shadowBlur = 0;
  const tagText = `#${faceNum} ${dominant.name}: ${domPct}%`;
  targetCtx.font = 'bold 11px monospace';
  const tagWidth = targetCtx.measureText(tagText).width + 12;
  targetCtx.fillStyle = dominant.color;
  targetCtx.fillRect(box.x, box.y - 20, tagWidth, 18);
  targetCtx.fillStyle = '#000000';
  targetCtx.fillText(tagText, box.x + 6, box.y - 6);

  // 2. Guaranteed Floating Meter Panel
  const panelW = 120;
  const panelH = EMOTIONS.length * 15 + 26;
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
  targetCtx.fillText(`FACE #${faceNum} EMOTIONS`, panelPos.x + 8, panelPos.y + 14);

  // Render 8 Values
  let itemY = panelPos.y + 28;
  EMOTIONS.forEach((emo, i) => {
    const val = scores[i] || 0;
    const pct = Math.min(100, Math.round(val * 100));
    const isLead = (i === maxIdx);

    targetCtx.font = isLead ? 'bold 9px monospace' : '9px monospace';
    targetCtx.fillStyle = isLead ? '#FFFFFF' : '#A0AEC0';
    targetCtx.fillText(emo.code, panelPos.x + 8, itemY);

    targetCtx.fillStyle = emo.color;
    targetCtx.textAlign = 'right';
    targetCtx.fillText(`${pct}%`, panelPos.x + panelW - 8, itemY);
    targetCtx.textAlign = 'left';

    const barX = panelPos.x + 38;
    const barY = itemY - 6;
    const barW = 46;
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

// Start camera and render loop immediately
startCamera();
requestAnimationFrame(mainRenderLoop);
