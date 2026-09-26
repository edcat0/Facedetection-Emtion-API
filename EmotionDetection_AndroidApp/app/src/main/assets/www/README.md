# 8-Emotion Detection HUD (Progressive Web App)

A lightweight, real-time emotion detection camera web application built with the **8-Emotion Taxonomy** (Anger, Contempt, Disgust, Fear, Happiness, Neutral, Sadness, Surprise).

## Features
- Real-time on-device face tracking using Google MediaPipe Tasks Vision.
- Full 8-Emotion quantified score meters with live animated HUD bars adjacent to each face.
- Front/rear camera toggle with automatic mirrored coordinates for selfie view.
- 100% client-side privacy (no video streaming or server uploads).
- Offline PWA support with Service Worker and Web App Manifest.

## How to Install and Run on Android

### Method 1: Instant Install via Mobile Chrome
1. Upload the contents of this folder to any free static host supporting HTTPS (e.g., GitHub Pages, Cloudflare Pages, Netlify, or Vercel).
2. Open the URL in **Google Chrome** or **Samsung Internet** on your Android phone.
3. Tap the **three dots menu (⋮)** in the browser.
4. Tap **"Install app"** or **"Add to Home screen"**.
5. The app will install as a standalone full-screen native-like app on your Android home screen!

### Method 2: Local Wi-Fi Testing (No external host)
1. On your PC (connected to the same Wi-Fi as your phone), run:
   ```bash
   python3 -m http.server 8080
   ```
2. On your Android phone, open Chrome and navigate to `http://<YOUR_PC_IP>:8080`.
   *(Note: Chrome requires HTTPS for camera access unless you add your local IP to `chrome://flags/#unsafely-treat-insecure-origin-as-secure`)*.
