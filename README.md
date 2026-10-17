# BlueBod

A fully static browser app for MediaPipe pose estimation, Bluetooth LE notification capture, and direct device connections over LAN. No application server, signaling service, or runtime Node process is required once built.

## Build

```sh
npm ci
npm run build
```

Deploy the contents of `dist/` to any static HTTPS host. All asset paths support subdirectories such as `/blueBod/`. The build copies MediaPipe JavaScript/WASM and downloads its pose model into the output; no model CDN is used at runtime. An internet connection is needed during the build.

For local preview, run `npm start` (requires Python 3) and open http://localhost:3000. This builds and serves static files only. Camera/Bluetooth permissions work on localhost or HTTPS.

## GitHub Pages

`.github/workflows/pages.yml` tests, builds and deploys `dist/` on pushes to `main`, or via manual workflow dispatch. Repository Settings → Pages → Source must be **GitHub Actions**. The deployed URL is https://shubin123.github.io/blueBod/.

## Pair devices

1. Open the HTTPS app on both devices, on the same LAN.
2. On A, select **Create device offer** and send its pairing code to B.
3. On B, paste that offer into **Code from the other device**, select **Apply pairing code**, and send B's generated answer back to A.
4. On A, paste the answer and select **Apply pairing code**.
5. Repeat for more devices. Existing links remain connected, so A–B–C chains are supported. Packets carry unique IDs to avoid loops and duplicate recording.

Codes are manually exchanged WebRTC descriptions containing network connection information; share them only with intended peers. There is no automatic discovery, external signaling, STUN, or TURN server. Direct WebRTC connectivity depends on browser/network policy and can fail with Wi-Fi client isolation, VPNs, or restrictive firewalls. Re-pair after a failed connection or page reload. Counts show directly connected peers. Each device performs inference locally; only landmarks and sensor bytes are transmitted. Incoming camera poses are shown when local camera/demo capture is off.

## Bluetooth

Use a supported browser/platform with Web Bluetooth, such as Chrome on supported desktop/Android systems. Enter your peripheral's GATT service and notification characteristic UUIDs, then pair it. Notifications are captured as raw bytes and forwarded through connected peers. Firmware-specific parsing and IMU fusion are not implemented. Bluetooth does not transport camera video.

## Capture and export

The 3D stick figure appears immediately as a labeled reference pose. Start the camera for 33-landmark MediaPipe Pose Landmarker Lite inference; the figure follows estimated world landmarks with hip-centered coordinates. Drag to orbit, scroll or use +/− to zoom, or select Front/Side/Reset view. Keyboard arrows rotate the focused canvas. Low-visibility limbs are hidden, and tracking loss marks the last pose as stale. Local and remote streams include world landmarks in exports; older peers fall back to approximate normalized depth.

Start the camera to begin live tracking. Demo mode is synthetic and excluded from transmission/exports. JSON export retains the latest 18,000 records in browser memory, including device IDs and source-device timestamps. Timestamps are not synchronized between devices. Camera coordinates are per view; no calibrated multi-view fusion or accuracy gain is claimed. Accuracy fusion needs camera calibration, synchronization and triangulation. Reloading clears the session.

## Checks

```sh
npm test
```

Tests cover pairing-code validation, packet validation, and chain forwarding/deduplication. Camera, Bluetooth, and real multi-device WebRTC require hardware/browser validation.
