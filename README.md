# Microsoft Cognitive Emotion HUD (v9 - 5-Decimal Precision & Microsoft Emotion Standard)

This release implements the Microsoft Cognitive Services Emotion standard ([microsoft/Cognitive-Emotion-Windows](https://github.com/microsoft/Cognitive-Emotion-Windows)) with **5-digit decimal point precision (`0.00000` to `1.00000`)** and dual engine support (On-Device Local Engine + Microsoft Cognitive Services Cloud API).

## What Was Added & Changed in v9

1. **Microsoft Cognitive Emotion Contract**:
   - Matches the official Microsoft Cognitive Services Emotion schema:
     - `anger`
     - `contempt`
     - `disgust`
     - `fear`
     - `happiness`
     - `neutral`
     - `sadness`
     - `surprise`
   - Added an in-app **Settings Dialog** (gear/key icon in the top bar) allowing you to connect directly to your **Microsoft Azure Cognitive Services / Face API** endpoint and subscription key if desired, streaming frames for cloud analysis.

2. **5 Decimal Digits Below 0 (`0.00000` to `1.00000`)**:
   - Replaced integer percentage values (`%`) with exact 5-decimal floating point scores:
     - Example:
       - `ANG: 0.00012`
       - `CON: 0.00005`
       - `DIS: 0.00003`
       - `FEA: 0.00008`
       - `HAP: 0.88412`
       - `NEU: 0.11520`
       - `SAD: 0.00015`
       - `SUR: 0.00025`
   - When no face is detected, all 8 values strictly show:
     - `ANG: 0.00000`
     - `CON: 0.00000`
     - `DIS: 0.00000`
     - `FEA: 0.00000`
     - `HAP: 0.00000`
     - `NEU: 0.00000`
     - `SAD: 0.00000`
     - `SUR: 0.00000`

3. **Guaranteed Floating Meter Pop-Up**:
   - Pinned directly beside the face bounding reticle with a dashed cyan pointer line.
   - Sized at `138px` width x `160px` height to comfortably fit 5-decimal numbers without cramping.
   - Rendered using universal quadratic-curve canvas math (`drawCardRoundRect`), preventing runtime canvas errors on all mobile browsers and WebViews.

4. **Front & Rear Camera Switching**:
   - Includes hardware cooldown preventing sensor locks on Android.
   - Front camera is accurately mirrored for selfie view; rear camera displays in natural orientation.
