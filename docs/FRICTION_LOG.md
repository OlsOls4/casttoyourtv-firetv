# Vega SDK / VVD friction log — "Build, Ship, Shape" hackathon (Fire TV track)

Running log kept while getting the Vega Virtual Device (VVD) to build, boot, run, screenshot,
record and take D-pad input headlessly in GitHub Actions (repo: vega-vvd-ci).
Severity: **High** = blocks the task with no documented way round; **Medium** = costs real time,
workaround exists; **Low** = papercut.

---

## 1. Can't develop at all on an ARM Linux host (or any host without KVM)
- **Task attempted:** Install the Vega SDK in our dev sandbox (Debian, aarch64, no /dev/kvm).
- **Steps:** Read install guide; read `get_vvm.sh`.
- **Expected:** SDK + CLI install on Linux; VVD optional.
- **Actual:** `get_vvm.sh` `determine_platform()` only accepts `Linux x86_64`, `Darwin arm64`, `Darwin x86_64`; everything else → "Unsupported platform". So even *building* a vpkg (no emulator needed) is impossible on Linux ARM (Graviton, Ampere, Raspberry Pi, ARM Chromebooks, many cloud dev boxes / AI-agent sandboxes). The VVD additionally needs KVM.
- **Severity:** High (for us: forced the whole toolchain into CI).
- **Workaround:** Run everything on GitHub-hosted `ubuntu-24.04` x86_64 runners (KVM available after a udev rule).
- **Suggestion:** Ship a linux-aarch64 build of the CLI/SDK (macOS arm64 already exists, so the toolchain is ARM-capable), and/or an official Docker image for build-only use. Document clearly that build ≠ emulator in host requirements.

## 2. No first-party "headless / CI" story for the VVD
- **Task attempted:** Boot VVD on a CI runner and get a non-black screenshot.
- **Steps:** Docs only describe `vega virtual-device start` (+ `--no-gui`, `--no-gl-accel`, `--display-res`) and a GUI window.
- **Expected:** A documented CI recipe (KVM setup, display, screenshot command).
- **Actual:** Nothing in the docs. The only working recipe we found is community work (finloop/vega-virtual-device-action, software-mansion/argent): Xvfb + Mesa llvmpipe, *then kill the CLI-launched emulator and relaunch the binary by hand with `-gpu host`* because the CLI forces `swangle_indirect`, which renders but screenshots come back all black.
- **Severity:** High
- **Workaround:** `scripts/start-vvd.sh` in vega-vvd-ci (2-phase launch).
- **Suggestion:** Add `--gpu <mode>` passthrough (or `--headless-capture`) to `vega virtual-device start`; publish a CI guide + an official GitHub Action.

## 3. No CLI command for screenshot, screen recording or remote-key presses on the VVD
- **Task attempted:** Capture screenshots/video and send D-pad presses from a script.
- **Steps:** Searched docs. VDA reference says `gwsi-tool-screenshooter` "isn't supported" on VVD. `inputd-cli` docs say most commands fail with "Arguments did not match expected patterns" unless developer mode is enabled (which reboots the VVD).
- **Expected:** `vega device screenshot`, `vega device record`, `vega device press <key>` (a community forum request asks for exactly this: community.amazondeveloper.com/t/29258).
- **Actual:** Must use the undocumented Android-emulator console (`screenrecord screenshot`, `screenrecord start/stop`) or emulator gRPC, and `inputd-cli` over `vda shell` after `vsm developer-mode enable`. Key names are non-obvious (select = KEY_ENTER, not KEY_SELECT; home = KEY_HOMEPAGE, not KEY_HOME — per argent's on-device testing).
- **Severity:** Medium-High (blocks automated demo/QA without community knowledge)
- **Workaround:** `scripts/screenshot.sh`, `scripts/record.sh`, `scripts/press.sh`.
- **Suggestion:** First-class `vega device screenshot|record|press` that work identically on VVD and Fire TV dev-mode devices.

## 4. Install guide assumes an interactive desktop
- **Task attempted:** Unattended install.
- **Expected:** Documented `NONINTERACTIVE=true` / version pin flags.
- **Actual:** Docs show only the interactive `curl | bash` with Enter prompts and VS Code checks. `NONINTERACTIVE=true` and `VEGA_SDK_VERSION` exist in the script but aren't documented on the install page.
- **Severity:** Low-Medium
- **Workaround:** Read the 1,900-line installer source.
- **Suggestion:** Document env vars (NONINTERACTIVE, VEGA_SDK_VERSION, SKIP_VVD_INSTALL) on the install page.

## 5. Docs `llms.txt` isn't reachable by non-browser clients
- **Task attempted:** `curl https://developer.amazon.com/docs/llms.txt` (the docs pages advertise it for AI tooling).
- **Actual:** Returns the developer-portal HTML shell (with sign-in JS), not the plain-text index.
- **Severity:** Low
- **Suggestion:** Serve `llms.txt` as `text/plain` without the portal wrapper.

<!-- CI run entries appended below as they happen -->

---
## CI run findings (GitHub Actions, ubuntu-24.04, SDK 0.24.12112 / CLI 1.4.5)

Run 1 (OlsOls4/is-it-working run 39055001658, 478 s total) worked first time **because** we started from the community recipe; the items below are what that recipe works around or what we hit on top of it.

## 6. `vega virtual-device start` gives no control over the GPU mode → black captures
- **Task attempted:** Headless boot with readable frames.
- **Steps:** `vega virtual-device start --gui=false --gl-accel=true`; inspected `/proc/<pid>/cmdline`.
- **Expected:** A flag to choose the renderer (the emulator itself accepts `-gpu host|swiftshader_indirect|…`).
- **Actual:** The CLI's argv has no `-gpu` (resolves to swangle_indirect); its help offers only `--gui`, `--gl-accel`, `--display-res`, `--timeout`, `--path`. We must kill the CLI-launched emulator ~3 s after start and relaunch the binary at `~/vega/sdk/vega-sdk/main/<ver>/vvd/images/tv/vmtools/agent/qemu/linux-x86_64/vega-virtual-device` with `-gpu host` and a hand-built `LD_LIBRARY_PATH`. Fragile: depends on internal paths and process names (`vega-virtual-de`).
- **Severity:** High
- **Workaround:** `scripts/start-vvd.sh`.
- **Suggestion:** `vega virtual-device start --gpu host` (or `--extra-emulator-args`).

## 7. Emulator log is noisy with alarming-but-harmless errors
- **Actual:** Every boot logs `ERROR | Failed to create Vulkan instance`, `ERROR | Color buffer 0 for 0 cannot be found`, `ERROR | Failed to take a screenshot of display: 0`, plus a 40-feature "Please update the emulator" warning, even when everything works. That makes real failures hard to spot in CI logs.
- **Severity:** Low
- **Suggestion:** Downgrade known-benign messages, or document them on the VVD troubleshooting page.

## 8. Default 60 s `--timeout` and no machine-readable readiness signal
- **Actual:** `vega virtual-device start` defaults to a 60 s timeout. The VVD took ~41 s from console-up to first non-black frame on a 4-vCPU runner, so cold starts are near the limit. Readiness has to be inferred (console port open + non-black PNG + `vda devices`). `vega virtual-device status` / `getprop` aren't reliable signals per prior community work.
- **Severity:** Medium
- **Suggestion:** `vega virtual-device wait-ready [--timeout]` that exits 0 once the launcher is interactive.

## 9. inputd-cli docs vs reality
- **Actual:** Docs (0.22 to 0.24) say most `inputd-cli` commands fail on VVD without `vsm developer-mode enable` (which reboots the VVD). On a fresh 0.24 VVD, `inputd-cli get_screen_size` and `button_press KEY_*` worked over `vega exec vda shell` straight away, and the help banner already said "dev-mode inputd cli". Docs are stale or ambiguous, and the reboot step costs time.
- **Severity:** Low-Medium (confusing)
- **Suggestion:** State which commands need developer mode on VVD, per SDK version.

## 10. `gwsi-tool-screenshooter` unsupported on VVD; no recording tool at all
- **Actual:** The documented screenshot tool doesn't work on VVD. The working route is the undocumented emulator console `screenrecord screenshot|start|stop`. It works well (1080p VP9 WebM, ~60 s demo, ~60 MB), but it's capped at 180 s per clip and needs an auth token from `~/.emulator_console_auth_token`.
- **Severity:** Medium
- **Suggestion:** Wrap it as `vega device screenshot` / `vega device record` for VVD.

## 11. x11grab of the VVD window is black
- **Task attempted:** Record the emulator window on Xvfb with ffmpeg as a fallback recorder.
- **Steps:** Dropped `-no-window` from the relaunch argv; `ffmpeg -f x11grab -i :99`.
- **Expected:** The device image inside the emulator window.
- **Actual:** Black frame (42 KB MP4 for 60 s) with a small cursor. The window doesn't render its GL content under Xvfb + llvmpipe.
- **Severity:** Low (console recorder works)
- **Workaround:** Use the emulator-console recorder.

## 12. Installer footprint and cache friction
- **Actual:** `~/vega` is 6.2 GB after install (CLI + SDK + VVD image), about 214 s to install on a runner. Caching it with `actions/cache` failed (`tar exit code 1`) because the running emulator was still writing to the instance dir.
- **Severity:** Low-Medium
- **Workaround:** Stop the VVD before the job ends and exclude `vvd/instances` from the cache.
- **Suggestion:** Publish a build-only SDK download (no VVD image) for build/lint jobs, and an official runner image or Action.

## 13. Hello-world template: positive notes
- `vega project generate --template helloWorld` + `npm install` + `npm run build:release` built `build/x86_64-release/hellovega_x86_64.vpkg` first time, with no manifest edits needed (the `[os.version]` prerequisite on the build page was already satisfied by the template).
- `vega run-app <vpkg> <appId> -d VirtualDevice` installed and launched in ~4 s.

## 14. Node version: docs say 18+, the helloWorld template needs 22.14+
- **Task attempted:** `npm install` in a fresh helloWorld (RN 0.83) project on Node 20 LTS.
- **Expected:** Node 18.x or later is enough, as the install guide says ("Node.js (version 18.x or later)").
- **Actual:** `npm warn EBADENGINE … package: '@amazon-devices/react-native-kepler@4.0.1', required: { node: '>= 22.14.0' }, current: v20.20.2`. The build still passed on Node 20, but the requirement and the docs disagree.
- **Severity:** Medium (a stricter npm/engine-strict setup would fail the install)
- **Workaround:** Use Node 22 in CI.
- **Suggestion:** Update the install page's Node prerequisite per template (rn72 vs RN 0.83), and have the installer's Node check enforce it.

## 15. Build papercuts in the template
- `WARNING: build_number is 0. Provide via --build-number CLI option or in manifest.toml [package] section.` is printed 3× on every build of an untouched template.
- The intermediate output path contains a literal `undefined`: `build/private/kepler/@amazon-devices/hellovega/undefined/vega/x86_64/Release/...`.
- `npm install` on the template prints ~15 deprecation warnings (eslint 8, babel proposal plugins, metro-react-native-babel-preset 0.76 alongside Metro 0.83).
- `build:release` builds all three architectures (x86_64, aarch64, armv7). For a VVD-only CI loop that's wasted time. The docs don't say how to build a single arch from npm scripts.
- **Severity:** Low
  - *Update (run 3):* on Node 22 the EBADENGINE warning is gone. Build and run behave the same.

## Summary of runs
| Run | ID (OlsOls4/is-it-working, branch vega-vvd-spike) | Result | Total |
|---|---|---|---|
| 1 | 39055001658 | ✅ build, boot, launch, 10 screenshots, 60 s WebM/MP4, D-pad OK. Cache save failed (#12), x11grab black (#11) | 478 s |
| 2 | 39055759198 | ✅ composite action + focus walk across all 4 tiles; cache saved (2.1 GB) | 425 s |
| 3 | 39056382695 | ✅ Node 22, warm cache | 227 s |

---
## Building the real app (casttoyourtv-firetv, 17 Oct 2026)

Repo: https://github.com/OlsOls4/casttoyourtv-firetv (React Native for Vega, SDK 0.24, built and run only in GitHub Actions on the VVD).

## 16. `journalctl` refused in the developer-mode shell; the pointer goes to an old "kepler-tv" docs path
- **Task attempted:** Collect the app's `console.log` output from the VVD after a scripted demo (`vega exec vda shell "journalctl --no-pager -n 4000"`).
- **Expected:** Device logs, or a `vega device logs` command.
- **Actual:** `WARNING: journalctl is not supported in developer mode shell. Please use loggingctl instead.` The help text links to `developer.amazon.com/docs/kepler-tv/loggingctl.html` (old Kepler naming). There's no `vega device logs --app <id>` for a quick per-app filter.
- **Severity:** Low
- **Workaround:** `vega exec vda shell "loggingctl log | tail -n 6000"`, then grep for our `[CTTV]` tag.
- **Suggestion:** Add `vega device logs [--app <componentId>] [--follow]` that works the same on VVD and on devices. Update the link in the warning.

## 17. Kepler vs Vega naming inside one API surface
- **Task attempted:** Add video playback with `@amazon-devices/react-native-w3cmedia`.
- **Steps:** Read the 0.21/0.22 playlist and dash.js guides, then the 0.24 API reference.
- **Expected:** One set of component names.
- **Actual:** The older guides import `VegaVideoSurfaceView` / `VegaCaptionsView`, while the 0.24 reference and the official vega-video-sample use `KeplerVideoSurfaceView` / `KeplerCaptionsView` / `KeplerVideoView`. The same mix runs everywhere else: `react-native-kepler` with `build-vega`, a `kepler` key in the template's package.json, and `kepler-*` packages. You can't tell which names are current without trial and error. We used the Kepler* names, which compile and play on SDK 0.24.
- **Severity:** Low-Medium (costs a build cycle when every build happens in CI)
- **Suggestion:** Export both names with a deprecation note, and make every guide match the reference for the selected SDK version.

## 18. Media playback needs ~11 hand-copied manifest entries
- **Task attempted:** Turn the helloWorld template into a video app.
- **Expected:** One command or flag (e.g. `vega project add-capability media`), or a "media" template smaller than the full vega-video-sample.
- **Actual:** You copy 10 `[[wants.service]]` / `[[wants.privilege]]` entries plus an `[[offers.service]] com.amazon.gipc.uuid.*` from the W3C Media README into manifest.toml by hand. Nothing tells you whether one is missing until something fails at runtime. The video sample's manifest is about 300 lines with EPG, IAP and account login mixed in, so it's hard to trim down to "just play an MP4".
- **Severity:** Medium
- **Workaround:** A small Node patch step (first version of `ci/scripts/prepare-app.sh`), then committing the patched manifest.
- **Suggestion:** A `media` template or `add-capability` command, and a manifest linter (`vega project doctor`) that maps each imported `@amazon-devices/*` package to the manifest entries it needs.

## 19. Positive: W3C Media playback works on the headless VVD, and the emulator recorder captures the video surface
- `VideoPlayer` + `KeplerVideoSurfaceView` played a 480p H.264/AAC MP4 straight from a Vercel URL inside the VVD on a GitHub runner (software GL, `-gpu host`). Seek on `loadedmetadata` worked. `screenrecord screenshot`/`start` captured the decoded frames composited with our RN overlay (subtitles + Ask panel). The VVD had outbound internet (fetch to Vercel worked), and `inputd-cli` KEY_ENTER/KEY_DOWN/KEY_BACK drove TouchableOpacity focus and `hardwareBackPress` as expected. The first build and run succeeded first time.
- Papercut: a stray data track (chapters remuxed from the MKV source) made `duration` report 14:48 for a 5:30 file. Our own encoding problem, but a `durationchange`-vs-container note in the docs would help.

### casttoyourtv-firetv CI runs (OlsOls4/casttoyourtv-firetv, ubuntu-24.04, SDK 0.24)
| Run | ID | Result |
|---|---|---|
| 1 | 39059395171 | ✅ first build + VVD run green: pair screen, relay cast, video + subtitles, Ask panel (answer card overflowed → fixed) |
| 2 | 39060337721 | ✅ committed app/, web-sender cast via headless Chrome, unit tests 4/4, compact panel |
| 3 | 39060876853 | ✅ Ask at 2:25 (10 lines known), Sintel credit, 145 s 1080p MP4 |
| 4 | 39061447507 | ✅ same flow, Pillow contact sheet of all 20 steps, 154 s demo |

## 20. No app-level speech-to-text on Vega
- **Task attempted:** "Hold the mic and ask the TV a question" while a film is paused.
- **Steps:** Searched the Vega API reference (Audio Lib, Accessibility, Content Launcher) and the developer community.
- **Expected:** A SpeechRecognizer-style API, or a mic-button event that an app can use for its own questions.
- **Actual:** Vega exposes no app-level STT. Per Amazon's community answers (threads 27863, 29064), dictation only works through the system keyboard when a TextInput is focused. The mic button otherwise goes to Alexa or the Content Launcher, and raw `AudioRecordStream` would mean shipping our own STT.
- **Severity:** Medium (it shaped the product's multi-modal design)
- **Workaround:** Voice questions come from the paired phone (Web Speech API) through our relay. The remote's D-pad chips cover the common questions.
- **Suggestion:** An app-level STT API (press-and-hold mic → transcript callback), or let apps register as a voice target while in the foreground.

## 21. Devpost submission form (not Amazon tooling, but part of shipping)
- "Start project" raised a reCAPTCHA image challenge, and the Join link raised Cloudflare Turnstile, which slows automated or assistive flows.
- The "[Optional] Friction Log" field is a single-line `https://` URL input, even though its helper text asks for a full essay. We host this log in the repo and link it.
- "AWS Builder Mini Challenge: Which AWS services…" is required even when you answer "No" to the AWS mini challenge.
- **Severity:** Low
- **Suggestion:** Make the friction-log field a textarea or file upload, and make the AWS write-up conditional on "Yes".
