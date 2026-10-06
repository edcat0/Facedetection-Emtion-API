# Microsoft Cognitive Emotion HUD (v10 - MediaPipe Face Detection & 5-Decimal Precision)

This release integrates Google's official `@mediapipe/face_detection` engine to guarantee immediate, autonomous face detection initiation on mobile devices, paired with the Microsoft Cognitive Services Emotion standard and **5-decimal precision (`0.00000` to `1.00000`)**.

## What Was Fixed & Upgraded in v10

1. **Guaranteed Face Detection Initiation**:
   * Replaced brittle optical color heuristics with **Google's official MediaPipe Face Detection engine** (`@mediapipe/face_detection`).
   * Automatically initializes on camera startup, scanning the entire camera feed and instantly locking onto human faces with normalized landmarks and 3D bounding geometry.
   * Native hardware `window.FaceDetector` fallback included for zero-latency execution.

2. **Guaranteed Floating Meter Pop-Up**:
   * Pinned directly beside each detected face with a dashed cyan pointer line.
   * Floating meter card (`138px` width x `160px` height) displays all 8 emotions with **5 digits below 0** (`0.00000` to `1.00000`).
   * Rendered using universal quadratic-curve canvas math (`drawCardRoundRect`), preventing canvas runtime exceptions.

3. **Strict Zeroing When No Face Detected**:
   * When 0 faces are in view (or camera is covered):
     - All 8 emotion meters strictly show **`0.00000`**.
     - Top status badge turns red: **"Scanning: No Face Detected"**.
     - Reticles and floating meters disappear.
   * As soon as a face enters the frame, the status badge turns bright green (**"Face Confirmed"**) and the floating meter immediately pops up with live values.

4. **Microsoft Cognitive Emotion API Support**:
   * Contract: `anger, contempt, disgust, fear, happiness, neutral, sadness, surprise`.
   * Tap the **Settings (gear) icon** in the top bar to connect your Microsoft Azure Cognitive Services Face / Emotion API endpoint and key, or run locally using on-device physiological emotion mapping.

5. **Front & Rear Camera Switching**:
   * 250ms hardware release cooldown prevents sensor locks on Android.
   * Front camera is mirrored; rear camera maintains natural orientation.
