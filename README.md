# 8-Emotion Detection HUD (v6 - Front Camera Switch Fix & Stable Inference)

This release resolves the issue where face detection halted when switching between front and rear cameras on mobile devices.

## What Was Fixed in v6

1. **Front/Rear Camera Switching Fix**:
   - **Hardware Lock Release**: Android requires a brief cooldown period (250ms) to release the camera hardware before another camera lens (front/rear) can be initialized.
   - **Duplicate Render Loop Prevention**: Previously, reinitializing the camera spawned concurrent render loops that collided and locked the detection state. The render loop is now strictly governed by a single master animation loop.
   - **Video Playback & Dimension Watchdog**: Detects when video stream tracks transition, safely re-binds playback, and ensures video dimensions are non-zero before inference runs.
   - **Mirror Transform Alignment**: Properly calculates mirrored screen coordinates on the front selfie camera while preserving standard orientation on the rear camera.

2. **Accurate Neural Network Engine**:
   - Powered by `@vladmandic/face-api` (TinyFaceDetector, FaceExpressionNet, and 68-Point FaceLandmarks).
   - Real, authentic emotional responses across the 8-emotion taxonomy (*Anger, Contempt, Disgust, Fear, Happiness, Neutral, Sadness, Surprise*).

3. **Strict Zeroing When No Face Detected**:
   - When 0 faces are in view (or camera is covered):
     - All 8 emotion meters strictly show **0%**.
     - Top status badge turns red: **"Scanning: No Face Detected"**.
     - No face bounding boxes are drawn.
   - As soon as a face enters the frame, the status badge turns bright green (**"Face Confirmed"**) and meters immediately report live values.

4. **Compact, Anti-Collision Meters**:
   - Pinned beside each detected face with a compact width of 114px.
   - Spatial collision detector prevents overlapping between faces and meters.

5. **Photo & Video Capture**:
   - White shutter button: Saves high-res photo with live meters.
   - Red record button: Records video of camera stream with live HUD meters.
