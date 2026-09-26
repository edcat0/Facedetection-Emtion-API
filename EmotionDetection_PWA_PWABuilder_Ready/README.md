# 8-Emotion Detection HUD - PWA Package (v2)

This package contains the recompiled Progressive Web App (PWA) specifically optimized for **PWABuilder.com** and mobile browser deployment.

## What Was Added & Fixed
1. **PWABuilder Compliance**:
   - Clean, relative `manifest.json` with standard `id`, `start_url`, `scope`, `maskable` icons, and mobile screenshot specs.
   - Offline-first `service-worker.js` with relative asset resolution matching GitHub Pages repository subpaths.
2. **Independent Mobile Camera & Media Access**:
   - Independent camera stream management (`navigator.mediaDevices.getUserMedia`) with front/rear flip button.
   - Automatic fallback and permission request card if camera access is initially blocked.
3. **Picture Capture Button**:
   - White shutter button on the bottom center.
   - Captures the live camera frame composited with the 8-emotion HUD meters and downloads `emotion_snap_<timestamp>.png` directly to your phone (or opens the Android Share / Save to Gallery sheet).
4. **Video Recording Button**:
   - Red recording button on the bottom left.
   - Encodes a live video of your camera stream and HUD meters in real time, saving `emotion_video_<timestamp>.webm` or `.mp4` to your device.
5. **The 8-Emotion Taxonomy**:
   - Displays real-time meters for *Anger, Contempt, Disgust, Fear, Happiness, Neutral, Sadness, Surprise*.

---

## Why PWABuilder Failed on your GitHub Link & How to Fix in 2 Steps

### The Problem:
`https://github.com/edcat0/Facedetection-Emtion-API` is the GitHub code repository view (HTML source code viewer), NOT a running web server. PWABuilder needs to access a live HTTPS website.

### The 2-Step Fix:
1. **Enable GitHub Pages on your repository**:
   - Open your repo: `https://github.com/edcat0/Facedetection-Emtion-API`
   - Click **Settings** (top tab) -> **Pages** (in the left sidebar).
   - Under **Build and deployment > Source**, select **Deploy from a branch**.
   - Select Branch: **main** (or **master**) and folder: **/ (root)**.
   - Click **Save**.
2. **Use the GitHub Pages URL on PWABuilder**:
   - Within 1–2 minutes, GitHub will publish your site to:
     `https://edcat0.github.io/Facedetection-Emtion-API/`
   - Enter `https://edcat0.github.io/Facedetection-Emtion-API/` into **pwabuilder.com**.
   - PWABuilder will detect the manifest, service worker, and icons, allowing you to generate your Android APK package with 1 click!
