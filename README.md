# BlueBod

A fully static browser app that senses body movement using **one device's own radios**: no ESP32 boards, no pairing, and no camera for tracking. Open the page, press **Start sensing**, and teach it a few movements. It then estimates them from radio alone and drives a 3D stick figure with the result. Training on the fly is backed by a model learnt offline from the public [WiMANS](https://github.com/huangshk/WiMANS) WiFi sensing dataset, and the figure shows motion recorded from real people in that dataset. An optional camera teacher (MediaPipe Pose) can make training better still, but tracking never uses it. No server, signaling service or runtime Node process is needed once built.

## How it senses

- **WiFi link timing (main source).** Browsers can't read WiFi signal strength or CSI. A page can time round trips over its own WiFi link, though. The app finds your router and sends it up to 10 tiny HTTP `HEAD` requests a second, and only the timing is used. A body moving near the path between this device and the router changes the radio channel. That changes retries and rate control, which shows up in how long round trips take and how much they vary.
- **Bluetooth signal strength (optional).** Where Chrome allows Bluetooth scanning, the app also listens to advertisements from nearby phones, watches, speakers and similar devices, and uses their signal strength. Phones change their Bluetooth address every few minutes, so the features pool all devices instead of following any one.

## What to expect

- **Coarse.** One WiFi link timed from a browser carries far less information than ESP32 CSI. Expect it to separate big differences, such as nobody, still and moving, and only when you move near the line between this device and the router. Fine distinctions like sitting vs. standing still are unlikely. The test round gives an honest score for your room.
- **Not yet validated with a moving person.** In development the probe ran against a real home router from desktop Chrome. It found the router automatically and timed 9–11 probes/s at 30–90 ms; that router rate-limits with `503` replies, which still time the link. A full training round, model and live estimate ran on that real data. Whether movement separates from stillness on real links has not been measured yet.
- **The router's web server adds its own delay and jitter.** The model learns whatever stays consistent.
- **Locked to the setup.** Move this device or the router, change rooms, or add a person, and you need to retrain.
- The 3D figure shows recorded motion for the predicted movement: your own, if the camera teacher was on during training (the closest training window), otherwise the most typical WiMANS motion for that movement, or an animated template for movements WiMANS doesn't have (sitting, squatting). Either way it's the movement the radio recognised, not a skeleton measured live.

## Browser support

- **WiFi:** desktop Chrome or Edge 142+. On first use it asks to allow *local network access*; the router can't be reached without it. From the hosted HTTPS page, other browsers block plain-HTTP requests to the router as mixed content.
- **Bluetooth:** Chrome's Web Bluetooth scanning is still experimental, so Bluetooth mode needs `chrome://flags/#enable-experimental-web-platform-features` set to Enabled (then relaunch Chrome). When it's off, the app shows this flag on the start screen and in the Bluetooth panel, and **Scan nearby Bluetooth** copies the flag address for you. WiFi works without it. Bluetooth scanning is untested in this version.
- Keep the tab in front while sensing. Background tabs slow timers, the probe rate falls below what the model needs, and recordings skip those windows.

## Use it

1. Open https://shubin123.github.io/blueBod/ in desktop Chrome or Edge, on a device connected to your home WiFi.
2. Press **Start sensing** and allow local network access. The app tries common router addresses in parallel (192.168.1.1, 192.168.0.1, 10.0.0.1, 192.168.1.254 and others) and uses the first one that answers. If none answers, type your router's address under *This device's radios*. Any device on your network with a web page works, such as a printer or NAS.
3. **Movement model → Record training round.** Spoken and on-screen prompts tell you what to do (20 s each by default; you get time to leave the room for *Nobody*). The prompt is the label. The default set is Standing, Walking, Waving (one hand above your head, as in WiMANS) and Nobody. Move between this device and the router, and record 2–3 rounds.
4. **Record test round** for an honest score: a separate session, scored by a model that never saw it, with a confusion table. A leave-one-round-out score is also shown.
5. Live: every 0.5 s the app predicts from the last 3 s of radio, averages over 2 s, and the 3D figure follows. With Bluetooth on, this works before any training too, using the WiMANS model as it is.

Training data is stored in this browser (IndexedDB). **Save / Load training data** moves it as JSON.

### Optional camera teacher

A camera is never needed for tracking. Turn on **Camera teacher** while you record and MediaPipe Pose Landmarker runs on this device (GPU where available, heavy model by default, full model if heavy is too slow); video never leaves the page. The teacher:

- **Saves your 3D motion with each window.** Over each 3 s window it keeps the camera's world landmarks (metres, hip-centred) as 12 frames, 0.25 s apart, for the 17 joints the figure draws. A frame only counts when shoulders and hips are clearly seen, and a window only gets motion if most of its frames did.
- **Checks the prompts.** A *Nobody* window is dropped if the camera still sees someone in it.
- **Gives the radio a body to show.** Live, the figure replays the taught motion of the closest training window for the recognised movement. It's whole recorded motion; averaging several windows would blur it into a stiff pose.
- **Scores the radio's posture.** With the camera on during the test round, the score adds the per-joint distance between the radio's chosen posture and the camera's, next to the error of always guessing the average taught posture. If the radio doesn't beat that baseline, its posture isn't telling you anything.

Stand where the camera sees your whole body. Turn the camera off once training is done; live tracking is radio-only either way.

## Dataset model (WiMANS)

Training on the fly only has the few minutes you record. [WiMANS](https://github.com/huangshk/WiMANS) (Huang et al., ECCV 2024) has six people standing still, walking, turning, jumping and waving in three rooms, plus those rooms empty: 2,574 three-second clips of per-packet WiFi signal strength at 2.4 and 5 GHz, each with synchronised video. `scripts/wimans/` turns it into a model this app can use:

- **Signals.** Each receiver antenna's signal strength (1 dB steps, as a Bluetooth scan reports) is read at a Bluetooth-like 2–10 adverts per second and run through the app's own `bleFeatures`. The dataset model uses five of the six Bluetooth features: signal spread, maximum spread, reading-to-reading change, and the two level shifts. It leaves out the device count, which depends on what's nearby rather than on movement.
- **Motion.** MediaPipe Pose heavy, the camera teacher's model with the same settings, ran over the 1,980 one-person videos. People stand 5–8 m from the camera, so each person is first found in tiles and then tracked in a crop. 97% of clips gave usable motion. The app ships the most typical clip per movement.
- **In the app.** The vote needs Bluetooth. Before any training, Bluetooth windows go to the dataset model as it is. Once you've recorded, its features are standardised per room by each movement's average, the WiMANS rooms by theirs and your room by your windows. Its votes then multiply the k-NN's, over the movements both know; a movement it doesn't know keeps the k-NN's share. The scores show leave-one-round-out and test accuracy with and without it, so you can see whether it helps in your room. With WiFi only it can't vote, but its motion still drives the figure.

Scores come from the app's own code. Each room is held out in turn, and the model is built from the other two. One person trains in the held-out room with *k* windows per movement; it is then scored on everyone else in that room, as balanced accuracy averaged over 3 rooms × 2 bands × 6 people (`node scripts/wimans/train.js`):

| Default 4 movements (chance 25%) | 3 windows | 5 | 10 |
|---|---|---|---|
| On the fly (previous model) | 50.8% | 55.2% | 57.1% |
| **On the fly + WiMANS** | **57.2%** | **58.4%** | **59.2%** |
| WiMANS only, no training (picks among all 6) | 46.1% | 46.1% | 46.1% |

| All 6 WiMANS movements (chance 17%) | 3 windows | 5 | 10 |
|---|---|---|---|
| On the fly | 34.0% | 37.7% | 39.4% |
| **On the fly + WiMANS** | **39.8%** | **40.7%** | **41.6%** |
| WiMANS only, no training | 41.9% | 41.9% | 41.9% |

Scored on the trainer's own remaining windows, the combined model gains more: 55.6% → 62.7% with 3 windows, 60.7% → 61.3% with 5 (6 movements: 36.9% → 45.0% and 40.9% → 45.5%).

For the figure, compared with held-out people's camera-measured motion, the typical WiMANS motion is 11.7 cm per joint off in posture and 14.5 cm frame by frame. The animated templates are 33.7 cm and 36.4 cm off. Picking the clip with the nearest Bluetooth features instead was worse, at 13.5 / 16.6 cm, so the app uses the typical clip.

**Limits.** These are simulated Bluetooth readings, not real ones. WiMANS was recorded with Intel 5300 WiFi cards between fixed antennas. Real Bluetooth hops between three advertising channels and comes from phones that may move with you, so the true gain on Bluetooth is unknown until it's measured. That's why the app reports it in your room. The untrained mode is the most exposed, because it reads signal levels as recorded. The WiFi timing features have no WiMANS counterpart.

WiMANS is licensed [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), and so is the derived `public/models/wimans-prior.json`: non-commercial use, with attribution, under the same licence. To rebuild it (about 7.5 GB of downloads, about an hour of pose extraction):

```sh
python3 -m venv .venv && .venv/bin/pip install -r scripts/wimans/requirements.txt
.venv/bin/python scripts/wimans/fetch.py wimans        # only the needed parts of the 53 GB archive
.venv/bin/python scripts/wimans/rssi.py wimans rssi.json
npm run build                                          # for dist/models/pose_landmarker_heavy.task
.venv/bin/python scripts/wimans/poses.py dist/models/pose_landmarker_heavy.task wimans/video poses.json
node scripts/wimans/train.js rssi.json poses.json      # prints the scores above and writes the model
```

## Pipeline

Every 0.5 s, over the last 3 s:

- **WiFi** (6 values): log median round trip, log(p75 / p25), log(p90 / median), mean probe-to-probe change relative to the median, share of spikes above twice the median, share of unanswered probes.
- **Bluetooth** (6 values, devices with ≥ 3 readings in the window): log number of devices, mean and max per-device spread, mean reading-to-reading change, and the mean and minimum offset of each device's window from its own last minute.

The features are standardised, and a k-nearest-neighbour model (k = 7) votes on the movement. Where Bluetooth is among the sources, the WiMANS model's vote (k = 15, standardised per room) multiplies it. The sources (WiFi, or WiFi + Bluetooth) are fixed at the first training recording, and later recordings need the same sources.

## Privacy

Radio passes through walls. Only sense spaces and people who know about it. The router requests carry no data and their responses are ignored. Camera video is processed in the page and never stored or sent; only the landmarks of recorded windows are kept, in your training data. Nothing is uploaded: processing, training data and exports stay on this device.

## Build and deploy

```sh
npm ci
npm test
npm run build
```

The build copies `public/` to `dist/` with MediaPipe's runtime and downloads the full and heavy pose models (about 40 MB, loaded only when the camera teacher starts). For a local preview, run `npm start` (Python 3) and open http://localhost:3000. `.github/workflows/pages.yml` tests, builds and deploys to GitHub Pages on every push to `main`.

Tests cover router discovery and probe timing (with a mocked `fetch`), WiFi and Bluetooth features, source handling, k-NN training and honest scoring on synthetic link timing, the camera teacher's frame gating, window resampling, motion replay and posture scoring, the dataset model (loading the shipped file, untrained use, per-room calibration, reading the Bluetooth part of mixed windows, leaving unknown movements alone, camera motion taking precedence), movement templates and the 3D renderer. In headless Chrome with synthetic Bluetooth adverts (real scanning can't run headless), the app predicted from the WiMANS model before training, then ran two training rounds and a test round with the combined model and its with/without scores. The camera teacher has also run end to end in headless Chrome on a still photo of a person (heavy model, 30 FPS); it hasn't been tried with a person actually moving.

The earlier ESP32 CSI version, with USB/Bluetooth boards and LAN pairing, is in git history at `681128b`.
