# Emotion Detection HUD - Native Android App Project

This is a complete, ready-to-build Native Android Application packaging the 8-Emotion AI Camera HUD.

## Architecture Highlights
- **100% Offline Embedded Assets**: All web app files, styles, and logic are embedded directly inside `app/src/main/assets/www/`. The app requires no web hosting.
- **Hardware-Accelerated WebGL/GPU**: Native Android `WebView` configured with hardware acceleration and automatic `RESOURCE_VIDEO_CAPTURE` permissions for smooth on-device face tracking.
- **8-Emotion Taxonomy**: Renders real-time meters for *Anger, Contempt, Disgust, Fear, Happiness, Neutral, Sadness, Surprise*.

## How to Build the APK & Install on Your Cellphone

### Step 1: Open in Android Studio
1. Unzip this package.
2. Open Android Studio and select **File -> Open**.
3. Choose the root folder of this project (`EmotionDetection_AndroidApp`).
4. Android Studio will automatically sync the Gradle files.

### Step 2: Build the APK
1. In Android Studio, go to the top menu: **Build -> Build Bundle(s) / APK(s) -> Build APK(s)**.
2. Once the build finishes, click the popup notification link **"locate"** to find `app-debug.apk` (usually located at `app/build/outputs/apk/debug/app-debug.apk`).

### Step 3: Install onto Your Cellphone
- **Option A (Direct USB/Wi-Fi)**: Connect your Android phone to your PC, enable Developer Options / USB Debugging, and click the green **Play (Run)** button in Android Studio.
- **Option B (Copy APK file)**: Copy `app-debug.apk` directly to your phone via USB cable, Google Drive, or Bluetooth. Tap the APK file in your phone's File Manager and select **Install** (allow "Install unknown apps" if prompted).
