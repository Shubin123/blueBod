# BlueBod

A fully static browser app that senses body movement **without cameras**. ESP32 boards measure WiFi Channel State Information (CSI), which is how each subcarrier of a WiFi signal arrives after bouncing around a room, and how your body disturbs it. The app learns your movements from guided prompts and then estimates them from the radio alone. It drives a 3D stick figure with the result. No application server, signaling service, or runtime Node process is required once built.

The approach follows [RuView](https://github.com/ruvnet/RuView) and [wifi-sensing-kit](https://github.com/andrisgauracs/wifi-sensing-kit), as tested in Better Stack's video [I Turned My Wi-Fi Into a Surveillance System](https://www.youtube.com/watch?v=9Tihk9_jUyo). In that test, three $10 ESP32-S3 boards recognised 8 movements about 80% of the time on a separate test session.

## What it does and doesn't do

- **Does:** recognise a set of whole-body movements (standing, walking, sitting, squatting, jumping, waving, spinning, nobody in the room) from WiFi CSI after you train it in your room.
- **Doesn't:** measure a skeleton. The 3D figure shows an animated template of the predicted movement. If a camera taught that movement during training, it shows the average of the camera poses recorded for the nearest matching WiFi windows. RuView reports 3% PCK for its live single-board WiFi pose model; per-joint WiFi pose isn't practical with this hardware.
- **Locked to the setup:** move a board, the router or big furniture, change rooms, or add a person, and you need to retrain.

## Hardware

- 1–3+ **ESP32 or ESP32-S3** boards on a **2.4 GHz** WiFi network. Three boards around the room at chest height work best, since each adds sensing links that cross the room.
- Firmware, either of:
  - Espressif's stock [`esp-csi`](https://github.com/espressif/esp-csi) `csi_recv_router` example (USB serial, `CSI_DATA` lines), or
  - `firmware/bluebod-csi/bluebod-csi.ino` (Arduino-ESP32 core 3.x), which pings the router 50×/s and streams each CSI frame over **Bluetooth LE** (RuView ADR-018 binary frames) and USB serial. Set your WiFi name, password and a unique `NODE_ID` before flashing. This sketch has not been compiled or run on hardware yet.

No hardware? **Try synthetic room** runs the whole pipeline on generated signals. That data is labelled as synthetic and never shared with peers.

## Use it

1. Open https://shubin123.github.io/blueBod/ in desktop Chrome or Edge (Web Serial and Web Bluetooth).
2. Connect boards: **Connect USB board** (pick the baud rate under *WiFi sensing boards*; esp-csi defaults to 921600) or **Pair Bluetooth CSI board**. Each transmitter→receiver pair appears as a link in the heat map.
3. **Movement model → Record training round.** Spoken and on-screen prompts tell you what to do (20 s each by default; you're given time to leave the room for *Nobody*). The prompt is the label, so no camera is needed. Record 2–3 rounds.
4. **Record test round** for an honest score: a separate session, scored by a model that never saw it, with a confusion table. A leave-one-round-out score is also shown.
5. Live: every 0.5 s the app predicts from the last 1.5 s of WiFi, averaged over 3 s, and the 3D figure follows.

Training data is stored in this browser (IndexedDB). **Save / Load training data** moves it as JSON.

### Optional camera teacher

A camera is never required. If you start one under *Camera teacher* while recording, MediaPipe Pose Landmarker runs locally and each recorded window also stores your 3D world landmarks. The live figure then shows recorded poses instead of templates. Video never leaves the page.

## Pipeline

Per received frame: take the 52 real LLTF subcarriers (bins 1–26 and 38–63; DC and guard bands are empty). Compute amplitude from the I/Q pairs (ESP-IDF order: imaginary, real). Divide by the frame's mean, because the receiver's automatic gain jumps between packets.

Every 0.5 s, for each link over the last 1.5 s: mean band shape, per-band spread, and mean frame-to-frame change (52 × 3 values per link). The features are standardised, and a k-nearest-neighbour model (k = 7) votes on the movement. The link set is fixed at the first training recording, and later recordings require the same links.

## Chain devices over LAN

Each browser can host its own boards. Linked devices forward their CSI frames to each other over WebRTC data channels, so a laptop in one corner and a phone or laptop in another add their links to the same model.

1. Open the app on both devices, on the same LAN.
2. On A, **Create device offer** and send the pairing code to B.
3. On B, paste it into **Code from the other device**, **Apply pairing code**, and send B's answer back to A.
4. On A, paste the answer and **Apply pairing code**. Repeat for more devices; A–B–C chains work, with packet IDs preventing loops and duplicates.

Codes are manually exchanged WebRTC descriptions containing network connection information; share them only with intended peers. There is no discovery, STUN or TURN server. Connectivity can fail with Wi-Fi client isolation, VPNs or restrictive firewalls. Re-pair after a reload.

## Privacy

WiFi signals pass through walls. Only sense spaces and people who know about it. All processing happens in the browser; only CSI amplitudes, movement estimates and (if a camera is on) landmarks are sent, and only to devices you pair.

## Build and deploy

```sh
npm ci
npm test
npm run build
```

`dist/` contains everything, including MediaPipe's WASM and pose model for the optional camera teacher. For a local preview, run `npm start` (Python 3) and open http://localhost:3000. `.github/workflows/pages.yml` tests, builds and deploys to GitHub Pages on every push to `main`.

Tests cover CSI parsing (esp-csi lines and RuView frames), gain normalisation, link features, k-NN training and honest scoring on synthetic data, movement templates, packet validation, chain forwarding and the 3D renderer. Real boards, Bluetooth throughput and multi-device WebRTC still need hardware validation.
