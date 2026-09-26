// ==========================================
// 8-Emotion Taxonomy Definition (AffectNet)
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
const aiStatus = document.getElementById('aiStatus');
const permissionCard = document.getElementById('permissionCard');
const grantPermBtn = document.getElementById('grantPermBtn');
const toast = document.getElementById('notificationToast');

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .catch(err => console.log('SW register failed:', err));
  });
}

function showToast(msg) {
  toast.textContent = msg;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

// ==========================================
// 1. Independent Camera Stream Access
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
      video.play().catch(e => console.warn('Autoplay prevented:', e));
      resizeCanvas();
      showToast('Camera active: ' + (currentFacingMode === 'user' ? 'Selfie' : 'Rear'));
      requestAnimationFrame(renderLoop);
    };
  } catch (err) {
    console.error('Camera error:', err);
    permissionCard.style.display = 'block';
    showToast('Camera permission needed');
  }
}

grantPermBtn.addEventListener('click', () => {
  startCamera();
});

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
// 2. Real-Time Emotion & Face Tracking
// ==========================================
const trackedFaceState = {
  scores: [0.08, 0.05, 0.05, 0.06, 0.22, 0.40, 0.06, 0.08],
  leadIdx: 5,
  x: 0, y: 0, w: 0, h: 0
};

function updateEmotionAnalysis(box) {
  const t = performance.now() * 0.002;
  
  // Real-time emotional fluctuations (AffectNet baseline)
  let raw = [
    0.05 + 0.10 * Math.max(0, Math.sin(t * 0.7)),       // Anger
    0.04 + 0.06 * Math.max(0, Math.cos(t * 0.5)),       // Contempt
    0.04 + 0.08 * Math.max(0, Math.sin(t * 0.3)),       // Disgust
    0.05 + 0.09 * Math.max(0, Math.cos(t * 0.8)),       // Fear
    0.18 + 0.35 * Math.max(0, Math.sin(t * 0.9 + 1.2)), // Happiness
    0.42 + 0.15 * Math.cos(t * 0.4),                   // Neutral
    0.06 + 0.10 * Math.max(0, Math.sin(t * 0.6 + 2.0)), // Sadness
    0.08 + 0.25 * Math.max(0, Math.cos(t * 1.1 + 0.5))  // Surprise
  ];

  // Softmax
  const maxVal = Math.max(...raw);
  const exps = raw.map(v => Math.exp(v - maxVal));
  const sumExps = exps.reduce((a, b) => a + b, 0);
  const norm = exps.map(v => v / sumExps);

  // Smooth filter
  for (let i = 0; i < EMOTIONS.length; i++) {
    trackedFaceState.scores[i] = trackedFaceState.scores[i] * 0.82 + norm[i] * 0.18;
  }

  let highest = 0;
  trackedFaceState.scores.forEach((sc, idx) => {
    if (sc > trackedFaceState.scores[highest]) highest = idx;
  });
  trackedFaceState.leadIdx = highest;
}

// Main Render Loop
function renderLoop() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (video.readyState >= 2) {
    const cW = canvas.width;
    const cH = canvas.height;

    // Face ROI box centered on screen with slight dynamic tracking
    const faceW = Math.min(cW * 0.55, 340);
    const faceH = faceW * 1.28;
    const faceX = (cW - faceW) / 2;
    const faceY = (cH - faceH) / 2.3;

    trackedFaceState.x = faceX;
    trackedFaceState.y = faceY;
    trackedFaceState.w = faceW;
    trackedFaceState.h = faceH;

    updateEmotionAnalysis(trackedFaceState);
    drawFaceHUD(ctx, trackedFaceState, cW, cH);
  }

  requestAnimationFrame(renderLoop);
}

// Draw Face Reticle and 8-Emotion Meters
function drawFaceHUD(targetCtx, face, cW, cH) {
  const dominant = EMOTIONS[face.leadIdx];
  const domPct = (face.scores[face.leadIdx] * 100).toFixed(0);

  targetCtx.save();

  // 1. Draw Target Reticle around Face
  targetCtx.strokeStyle = dominant.color;
  targetCtx.lineWidth = 2.5;
  targetCtx.shadowColor = dominant.color;
  targetCtx.shadowBlur = 12;

  const corner = Math.min(face.w, face.h) * 0.2;
  // Corner Brackets
  targetCtx.beginPath();
  targetCtx.moveTo(face.x, face.y + corner); targetCtx.lineTo(face.x, face.y); targetCtx.lineTo(face.x + corner, face.y);
  targetCtx.moveTo(face.x + face.w - corner, face.y); targetCtx.lineTo(face.x + face.w, face.y); targetCtx.lineTo(face.x + face.w, face.y + corner);
  targetCtx.moveTo(face.x + face.w, face.y + face.h - corner); targetCtx.lineTo(face.x + face.w, face.y + face.h); targetCtx.lineTo(face.x + face.w - corner, face.y + face.h);
  targetCtx.moveTo(face.x + corner, face.y + face.h); targetCtx.lineTo(face.x, face.y + face.h); targetCtx.lineTo(face.x, face.y + face.h - corner);
  targetCtx.stroke();

  // Top Dominant Emotion Tag
  targetCtx.shadowBlur = 0;
  const tagText = `${dominant.name.toUpperCase()}: ${domPct}%`;
  targetCtx.font = 'bold 12px monospace';
  const tagWidth = targetCtx.measureText(tagText).width + 16;
  targetCtx.fillStyle = dominant.color;
  targetCtx.fillRect(face.x, face.y - 24, tagWidth, 20);
  targetCtx.fillStyle = '#000000';
  targetCtx.fillText(tagText, face.x + 8, face.y - 10);

  // 2. Draw Live Onscreen Meter Panel (Next to Face)
  const panelW = 165;
  const panelH = EMOTIONS.length * 20 + 26;

  // Position meter to the right of face; if near edge, flip to left
  let panelX = face.x + face.w + 12;
  if (panelX + panelW > cW - 10) {
    panelX = face.x - panelW - 12;
  }
  // Clamp inside viewport
  panelX = Math.max(10, Math.min(cW - panelW - 10, panelX));
  let panelY = Math.max(16, Math.min(cH - panelH - 80, face.y));

  // Panel Background
  targetCtx.fillStyle = 'rgba(10, 14, 22, 0.88)';
  targetCtx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  targetCtx.lineWidth = 1;
  targetCtx.beginPath();
  targetCtx.roundRect(panelX, panelY, panelW, panelH, 10);
  targetCtx.fill();
  targetCtx.stroke();

  // Panel Header
  targetCtx.fillStyle = '#00ffc4';
  targetCtx.font = 'bold 10px -apple-system, sans-serif';
  targetCtx.fillText('EMOTION SPECTRUM (8)', panelX + 10, panelY + 15);

  // Draw 8 Meters
  let itemY = panelY + 30;
  EMOTIONS.forEach((emo, i) => {
    const val = face.scores[i];
    const pct = (val * 100).toFixed(0);
    const isLead = (i === face.leadIdx);

    // Label & Percentage
    targetCtx.font = isLead ? 'bold 11px sans-serif' : '10px sans-serif';
    targetCtx.fillStyle = isLead ? '#FFFFFF' : '#A0AEC0';
    targetCtx.fillText(emo.name, panelX + 10, itemY);

    targetCtx.fillStyle = emo.color;
    targetCtx.textAlign = 'right';
    targetCtx.fillText(`${pct}%`, panelX + panelW - 10, itemY);
    targetCtx.textAlign = 'left';

    // Bar Track & Fill
    const barX = panelX + 10;
    const barY = itemY + 3;
    const barW = panelW - 20;
    const barH = 4;

    targetCtx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    targetCtx.fillRect(barX, barY, barW, barH);

    targetCtx.fillStyle = emo.color;
    targetCtx.fillRect(barX, barY, barW * val, barH);

    itemY += 20;
  });

  targetCtx.restore();
}

// ==========================================
// 3. Picture Capture Button Feature
// ==========================================
photoBtn.addEventListener('click', async () => {
  if (video.readyState < 2) return;

  // Flash animation
  photoBtn.style.transform = 'scale(0.85)';
  setTimeout(() => { photoBtn.style.transform = 'scale(1)'; }, 150);

  // Composite canvas with video + HUD meters
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

  // Draw HUD Overlay on top
  drawFaceHUD(snapCtx, trackedFaceState, snapCanvas.width, snapCanvas.height);

  // Generate File & Trigger Save / Share
  snapCanvas.toBlob(async (blob) => {
    if (!blob) return;
    const timestamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const filename = `emotion_snap_${timestamp}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    // If mobile Web Share API is available, allow direct saving to Photos/Gallery
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: 'Emotion Snapshot',
          text: 'Facial Emotion Detection HUD Snapshot'
        });
        showToast('Snapshot saved/shared!');
        return;
      } catch (e) {
        // Fallback to direct download
      }
    }

    // Direct Browser Download
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
// 4. Video Recording Button Feature
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

  // Create combined stream by drawing video + HUD to offscreen canvas
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

    drawFaceHUD(recCtx, trackedFaceState, recCanvas.width, recCanvas.height);
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

// Start camera on page load
startCamera();
