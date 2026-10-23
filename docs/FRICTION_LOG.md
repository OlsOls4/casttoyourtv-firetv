# Vega SDK / VVD friction log: "Build, Ship, Shape" hackathon (Fire TV track)

We kept this log while getting the Vega Virtual Device (VVD) to build, boot, run, screenshot, record and take D-pad input headlessly in GitHub Actions ([OlsOls4/vega-vvd-ci](https://github.com/OlsOls4/vega-vvd-ci)), and then while building the real app ([OlsOls4/casttoyourtv-firetv](https://github.com/OlsOls4/casttoyourtv-firetv)).

**Environment:** GitHub-hosted `ubuntu-24.04` x86_64 runners (4 vCPU / 16 GB), Vega SDK 0.24.12112, Vega CLI 1.4.5, helloWorld template (RN 0.83), Node 20.20.2 at first and then Node 22. Every build and every VVD boot happened in CI, because our dev sandbox is ARM Linux without KVM (see F1).

**Evidence:** Public run IDs are listed in [CI runs](#ci-runs-evidence). Commands, error strings and timings below are copied from those runs' job logs and artifacts.

**Severity scale:**
- **Critical**: Stops the project, with no workaround.
- **High**: Blocks the task, with no documented way round. We needed community knowledge or reverse engineering.
- **Medium**: Costs real time or a CI cycle, but a workaround exists.
- **Low**: A papercut.

The original log used "Medium-High" and "Low-Medium" for some entries. We've now resolved each of those to a single level. None of our issues was Critical: with community help and workarounds, we shipped.

---

## Summary

| ID | Title | Severity | Area | Suggestion (one line) |
|---|---|---|---|---|
| F1 | The SDK/CLI won't install on ARM Linux, so you can't even build a vpkg | **High** | Install / platform support | Ship a linux-aarch64 CLI/SDK (or a build-only Docker image), and document that "build" and "emulator" have different host requirements. |
| F2 | No first-party headless/CI story for the VVD | **High** | VVD / CI | Publish a CI guide and an official GitHub Action. |
| F3 | `vega virtual-device start` can't choose the GPU mode, so captures are black | **High** | VVD / CLI | Add `vega virtual-device start --gpu host` (or `--extra-emulator-args`). |
| F4 | No CLI command for screenshot, recording or remote-key presses | **High** | CLI / automation | Add first-class `vega device screenshot\|record\|press` that work the same on the VVD and on dev-mode devices. |
| F5 | 60 s default `--timeout` and no machine-readable readiness signal | Medium | VVD / CLI | Add `vega virtual-device wait-ready [--timeout]` that exits 0 once the launcher is interactive. |
| F6 | `gwsi-tool-screenshooter` doesn't work on the VVD, and there's no supported recorder | Medium | VVD / tooling | Wrap the emulator-console `screenrecord` as `vega device screenshot` / `record`. |
| F7 | Media playback needs about 11 manifest entries copied by hand | Medium | SDK / manifest | Add a `media` template or `add-capability` command, plus a `vega project doctor` manifest linter. |
| F8 | The docs say Node 18+, but the helloWorld template needs Node 22.14+ | Medium | Docs / templates | Give the Node prerequisite per template, and enforce it in the installer. |
| F9 | No app-level speech-to-text API | Medium | SDK API | Add an app-level STT API: press and hold mic, get a transcript callback. |
| F10 | Kepler and Vega names mixed in one API surface | Medium | SDK API / docs | Export both names with a deprecation note, and keep the guides in line with each SDK version's reference. |
| F11 | 6.2 GB install, 207–214 s per cold install, and the cache save fails | Medium | Install / CI | Publish a build-only SDK download, and an official runner image or Action. |
| F12 | The install guide assumes an interactive desktop | Medium | Install / docs | Document `NONINTERACTIVE`, `VEGA_SDK_VERSION` and `SKIP_VVD_INSTALL` on the install page. |
| F13 | The `inputd-cli` docs say developer mode is needed, but it isn't on 0.24 | Low | Docs | Say which commands need developer mode on the VVD, per SDK version. |
| F14 | `journalctl` is refused and points to an old "kepler-tv" docs link, and there's no `vega device logs` | Low | Tooling / docs | Add `vega device logs [--app <id>] [--follow]`, and fix the link. |
| F15 | The emulator log is full of alarming but harmless ERRORs | Low | VVD | Downgrade known-benign messages, or list them on the troubleshooting page. |
| F16 | Recording the VVD window with `x11grab` comes out black | Low | VVD | Document it, and make the F4 recorder the supported path. |
| F17 | Build papercuts in an untouched helloWorld template | Low | Templates / build | Set `build_number` in the template, fix the `undefined` path segment, and document a single-arch build. |
| F18 | The docs' `llms.txt` isn't reachable by non-browser clients | Low | Docs | Serve `llms.txt` as `text/plain` without the portal wrapper. |
| F19 | The Vega ESLint preset fails `npm run release` on a performance hint, and writes an untracked state file into the project | Low | Templates / lint | Make `kepler/animated` a warning that says which props the native driver supports on Vega, and add `generated/` to the template's `.gitignore`. |

**19 problem entries:** 4 High, 8 Medium, 7 Low, 0 Critical. There are also [2 "what worked well" notes](#what-worked-well) and [1 hackathon-platform note](#hackathon-platform-devpost-not-amazon-tooling).

---

## High

### F1. The SDK/CLI won't install on ARM Linux (or any host without KVM), so you can't even build a vpkg
- **Task attempted:** Install the Vega SDK in our dev sandbox (Debian, aarch64, no `/dev/kvm`) so we could build vpkgs locally.
- **Steps taken:**
  1. Read the install guide.
  2. Read `get_vvm.sh` (the official installer) to see which platforms it accepts.
- **Expected:** The SDK and CLI install on Linux, with the VVD optional. Building a vpkg doesn't need an emulator.
- **Actual:** `get_vvm.sh` `determine_platform()` only accepts `Linux x86_64`, `Darwin arm64` and `Darwin x86_64`. Everything else gets "Unsupported platform". So even *building* a vpkg is impossible on Linux ARM: Graviton, Ampere, Raspberry Pi, ARM Chromebooks, and many cloud dev boxes and AI-agent sandboxes. The VVD also needs KVM.
- **Severity:** High. It forced our whole toolchain (build and emulator) into CI.
- **Workaround used:** Run everything on GitHub-hosted `ubuntu-24.04` x86_64 runners. KVM becomes available there after a udev rule (the "Enable KVM" step in [`action.yml`](https://github.com/OlsOls4/vega-vvd-ci/blob/main/action.yml)).
- **Suggestion:** Ship a linux-aarch64 build of the CLI/SDK. macOS arm64 already exists, so the toolchain is ARM-capable. Or ship an official Docker image for build-only use. Either way, say clearly in the host requirements that building and running the emulator have different requirements.

### F2. No first-party headless/CI story for the VVD
- **Task attempted:** Boot the VVD on a CI runner and get a non-black screenshot.
- **Steps taken:**
  1. Read the VVD docs. They only describe `vega virtual-device start` (with `--no-gui`, `--no-gl-accel`, `--display-res`) and a GUI window.
  2. Searched for a CI recipe and found community work: finloop/vega-virtual-device-action and software-mansion/argent.
  3. Adapted it into a two-phase launch script.
- **Expected:** A documented CI recipe covering KVM setup, display and a screenshot command.
- **Actual:** There's nothing in the docs. The only working recipe is community work:
  - Run Xvfb with Mesa llvmpipe.
  - Then kill the CLI-launched emulator and relaunch the binary by hand with `-gpu host`. The CLI forces `swangle_indirect`, which renders, but screenshots come back all black.
- **Severity:** High
- **Workaround used:** [`scripts/start-vvd.sh`](https://github.com/OlsOls4/vega-vvd-ci/blob/main/scripts/start-vvd.sh) in vega-vvd-ci (115 lines, two-phase launch), packaged as a composite GitHub Action.
- **Suggestion:** Add `--gpu <mode>` passthrough (or `--headless-capture`) to `vega virtual-device start`, and publish a CI guide plus an official GitHub Action.

### F3. `vega virtual-device start` can't choose the GPU mode, so captures are black
- **Task attempted:** A headless VVD boot with readable frames.
- **Steps taken:**
  1. Ran `vega virtual-device start --gui=false --gl-accel=true`.
  2. Read the CLI help (saved as `logs/vvd-start-help.txt` in each run).
  3. Inspected the emulator's `/proc/<pid>/cmdline` (saved as `logs/emulator-argv-phase1.txt`).
- **Expected:** A flag to choose the renderer. The emulator itself accepts `-gpu host|swiftshader_indirect|…`.
- **Actual:** The CLI's argv has no `-gpu`, so the emulator resolves to `swangle_indirect`. The CLI help offers only `--gui`, `--gl-accel`, `--display-res`, `--timeout` and `--path`.
  - We have to kill the CLI-launched emulator about 3 s after start. Then we relaunch `~/vega/sdk/vega-sdk/main/<ver>/vvd/images/tv/vmtools/agent/qemu/linux-x86_64/vega-virtual-device` with `-gpu host` and a hand-built `LD_LIBRARY_PATH`.
  - This is fragile, because it depends on internal paths and process names (`vega-virtual-de`).
  - Every run's `start-vvd.log` shows the kill: `line 77: … Killed nohup vega virtual-device start …`.
- **Severity:** High
- **Workaround used:** `scripts/start-vvd.sh`, phase 2 (relaunch with `-gpu host` on llvmpipe).
- **Suggestion:** Add `vega virtual-device start --gpu host`, or `--extra-emulator-args`.

### F4. No CLI command for screenshot, screen recording or remote-key presses on the VVD
- **Task attempted:** Capture screenshots and video, and send D-pad presses, from a script (automated demo and QA).
- **Steps taken:**
  1. Searched the docs. The VDA reference says `gwsi-tool-screenshooter` "isn't supported" on the VVD.
  2. Read the `inputd-cli` docs. They say most commands fail with "Arguments did not match expected patterns" unless developer mode is enabled, and enabling it reboots the VVD.
  3. Found a community forum request asking for exactly these commands (community.amazondeveloper.com/t/29258).
- **Expected:** `vega device screenshot`, `vega device record` and `vega device press <key>`.
- **Actual:**
  - For capture, you have to use the undocumented Android-emulator console (`screenrecord screenshot`, `screenrecord start/stop`) or emulator gRPC.
  - For keys, you use `inputd-cli` over `vda shell`.
  - The key names aren't obvious: select is `KEY_ENTER`, not `KEY_SELECT`, and home is `KEY_HOMEPAGE`, not `KEY_HOME` (per argent's on-device testing, confirmed in our runs).
- **Severity:** High. It blocks automated demos and QA unless you have community knowledge.
- **Workaround used:** `scripts/screenshot.sh`, `scripts/record.sh` and `scripts/press.sh` (built on `scripts/vvd-console.py`) in vega-vvd-ci.
- **Suggestion:** First-class `vega device screenshot|record|press` commands that work the same on the VVD and on Fire TV devices in dev mode.

---

## Medium

### F5. 60 s default `--timeout` and no machine-readable readiness signal
- **Task attempted:** Boot the VVD and know when it's ready to install and launch an app.
- **Steps taken:**
  1. Read `vega virtual-device start --help` (`-t, --timeoutSeconds, --timeout`, default 60 s).
  2. Timestamped every stage in `start-vvd.sh`: console port open, first non-black PNG, `vda devices` showing `emulator-5554`.
- **Expected:** `start` returns when the device is usable, or there's a documented "ready" signal.
- **Actual:**
  - In vega-vvd-ci runs 1–3, it took **54–61 s from script start to "VVD ready"**, measured on a 4 vCPU runner. That breaks down as:
    - Console up after 12–14 s.
    - First non-black home-screen frame after 52–55 s, so about 40 s from console-up to frame.
    - `vda` seeing the device after 54–61 s.
  - So a cold start sits right at the CLI's 60 s default.
  - Readiness has to be inferred from heuristics. `vega virtual-device status` and `getprop` aren't reliable signals, per earlier community work.
  - The heuristic misfires. In 3 of the 5 casttoyourtv-firetv runs we downloaded, the "non-black frame" check fired at 22–24 s on the **boot splash**, not the launcher. In the first app run, that frame is the saved `boot-progress.png`, 223,367 bytes, against about 1 MB for a home-screen frame.
- **Severity:** Medium
- **Workaround used:** `start-vvd.sh` polls the console port, then grabs screenshots until a non-black PNG appears, then waits for `vda devices`, with `VVD_BOOT_TIMEOUT=480`. `wait-vvd.sh` blocks a background boot until that finishes.
- **Suggestion:** Add `vega virtual-device wait-ready [--timeout]` that exits 0 once the launcher is interactive, and make `start` wait for it by default.

### F6. `gwsi-tool-screenshooter` doesn't work on the VVD, and there's no supported recorder
- **Task attempted:** Capture step screenshots and a full-motion demo video of the app on the VVD.
- **Steps taken:**
  1. Checked the documented on-device tool. The VDA reference says `gwsi-tool-screenshooter` isn't supported on the VVD.
  2. Tried QMP `screendump`. It reads the scanout and always comes back black.
  3. Switched to the emulator console's `screenrecord screenshot|start|stop`, authenticated with `~/.emulator_console_auth_token`.
- **Expected:** A supported screenshot and recording tool for the VVD.
- **Actual:** The only working route is the undocumented emulator console. It works well: 1080p VP9 WebM, a demo of about 60 s comes to about 60 MB. But it's capped at 180 s per clip, and it needs the auth-token handshake.
- **Severity:** Medium
- **Workaround used:** `scripts/vvd-console.py`, `screenshot.sh` and `record.sh` (`--time-limit`, `REC_LIMIT`). The app's 145–154 s demos fit under the cap.
- **Suggestion:** Wrap it as `vega device screenshot` / `vega device record` for the VVD (see F4), and document the 180 s cap.

### F7. Media playback needs about 11 manifest entries copied by hand
- **Task attempted:** Turn the helloWorld template into a video app with `@amazon-devices/react-native-w3cmedia`.
- **Steps taken:**
  1. Added the package.
  2. Read the W3C Media README for the manifest requirements.
  3. Looked at the official vega-video-sample's manifest to compare.
  4. Patched `manifest.toml` in CI.
- **Expected:** One command or flag (for example `vega project add-capability media`), or a "media" template smaller than the full vega-video-sample.
- **Actual:**
  - You copy 10 `[[wants.service]]` / `[[wants.privilege]]` entries, plus an `[[offers.service]] com.amazon.gipc.uuid.*`, from the README into `manifest.toml` by hand.
  - Nothing tells you an entry is missing until something fails at runtime.
  - The video sample's manifest is about 300 lines, with EPG, IAP and account login mixed in. That makes it hard to trim down to "just play an MP4".
- **Severity:** Medium
- **Workaround used:** A small Node patch step (the first version of `ci/scripts/prepare-app.sh` in casttoyourtv-firetv). We then committed the patched manifest (`app/`).
- **Suggestion:** Add a `media` template or an `add-capability` command. Add a manifest linter (`vega project doctor`) that maps each imported `@amazon-devices/*` package to the manifest entries it needs.

### F8. The docs say Node 18+, but the helloWorld template needs Node 22.14+
- **Task attempted:** `npm install` in a fresh helloWorld (RN 0.83) project.
- **Steps taken:**
  1. Ran `vega project generate --template helloWorld`.
  2. Ran `npm install` on Node 20.20.2 LTS (from `actions/setup-node`, vega-vvd-ci run 1).
  3. Read `build.log`.
- **Expected:** Node 18.x or later is enough. The install guide says "Node.js (version 18.x or later)".
- **Actual:** `npm warn EBADENGINE … package: '@amazon-devices/react-native-kepler@4.0.1', required: { node: '>= 22.14.0' }, current: v20.20.2`. The build still passed on Node 20, but the requirement and the docs disagree.
- **Severity:** Medium. A stricter npm or `engine-strict` setup would fail the install.
- **Workaround used:** Node 22 in CI from run 3 onwards. The EBADENGINE warning is gone, and build and run behave the same.
- **Suggestion:** Update the install page's Node prerequisite per template (rn72 vs RN 0.83), and have the installer's Node check enforce it.

### F9. No app-level speech-to-text on Vega
- **Task attempted:** "Hold the mic and ask the TV a question" while a film is paused.
- **Steps taken:**
  1. Searched the Vega API reference: Audio Lib, Accessibility, Content Launcher.
  2. Searched the developer community.
- **Expected:** A SpeechRecognizer-style API, or a mic-button event an app can use for its own questions.
- **Actual:**
  - Vega exposes no app-level STT. Per Amazon's community answers (threads 27863 and 29064), dictation only works through the system keyboard when a TextInput is focused.
  - Otherwise, the mic button goes to Alexa or the Content Launcher.
  - Raw `AudioRecordStream` would mean shipping our own STT.
- **Severity:** Medium. It shaped the product's multi-modal design.
- **Workaround used:** Voice questions come from the paired phone (Web Speech API) through our relay. D-pad question chips on the remote cover the common questions.
- **Suggestion:** Add an app-level STT API (press-and-hold mic, then a transcript callback), or let apps register as a voice target while in the foreground.

### F10. Kepler and Vega names mixed in one API surface
- **Task attempted:** Add video playback with `@amazon-devices/react-native-w3cmedia`.
- **Steps taken:**
  1. Read the 0.21/0.22 playlist and dash.js guides.
  2. Read the 0.24 API reference.
  3. Read the official vega-video-sample.
- **Expected:** One set of component names.
- **Actual:**
  - The older guides import `VegaVideoSurfaceView` / `VegaCaptionsView`.
  - The 0.24 reference and vega-video-sample use `KeplerVideoSurfaceView` / `KeplerCaptionsView` / `KeplerVideoView`.
  - The same mix runs everywhere else: `react-native-kepler` alongside `build-vega`, a `kepler` key in the template's `package.json`, and `kepler-*` packages.
  - You can't tell which names are current without trial and error.
- **Severity:** Medium. It costs a build cycle when every build happens in CI.
- **Workaround used:** We used the `Kepler*` names from the 0.24 reference and vega-video-sample. They compile and play on SDK 0.24.
- **Suggestion:** Export both names with a deprecation note, and make every guide match the reference for the selected SDK version.

### F11. 6.2 GB install, 207–214 s per cold install, and the cache save fails
- **Task attempted:** Cache `~/vega` between CI runs so each run doesn't reinstall the SDK.
- **Steps taken:**
  1. Ran the installer in CI and timed it.
  2. Cached `~/vega` with `actions/cache@v4` (key `vega-sdk-Linux-latest-v1`, vega-vvd-ci run 1).
- **Expected:** A reasonably sized SDK that caches cleanly.
- **Actual:**
  - `~/vega` is 6.2 GB after install (CLI, SDK and VVD image).
  - The install took 214 s (run 1) and 207 s (run 2).
  - The run 1 cache save failed: `Failed to save: "/usr/bin/tar" failed with error: The process '/usr/bin/tar' failed with exit code 1`. The running emulator was still writing to the instance directory.
- **Severity:** Medium
- **Workaround used:** Stop the VVD before the job ends (`stop-vvd.sh`) and exclude `vvd/instances` from the cache.
  - Run 2 saved a 2,041 MB cache.
  - Run 3 restored it in about 49 s: "Vega SDK ready in 0s", 227 s total against 478 s cold.
- **Suggestion:** Publish a build-only SDK download (no VVD image) for build and lint jobs, and an official runner image or Action.

### F12. The install guide assumes an interactive desktop
- **Task attempted:** An unattended, version-pinned SDK install in CI.
- **Steps taken:**
  1. Read the install page. It only shows the interactive `curl | bash`, with Enter prompts and VS Code checks.
  2. Downloaded `get_vvm.sh` and read the installer source (about 1,900 lines) to find out how to skip the prompts.
- **Expected:** Documented `NONINTERACTIVE=true` and version-pin options.
- **Actual:** `NONINTERACTIVE=true` and `VEGA_SDK_VERSION` exist in the script, but the install page doesn't document them.
- **Severity:** Medium. We had to read the installer source before CI could install at all.
- **Workaround used:** Our action's install step sets `NONINTERACTIVE: "true"` and `VEGA_SDK_VERSION: ${{ inputs.sdk-version }}` before running `get_vvm.sh` ([`action.yml`](https://github.com/OlsOls4/vega-vvd-ci/blob/main/action.yml)).
- **Suggestion:** Document the env vars (`NONINTERACTIVE`, `VEGA_SDK_VERSION`, `SKIP_VVD_INSTALL`) on the install page.

---

## Low

### F13. The `inputd-cli` docs don't match what happens
- **Task attempted:** Send D-pad key presses to the VVD with `inputd-cli`.
- **Steps taken:**
  1. Read the `inputd-cli` docs (0.22 to 0.24). They say most commands fail on the VVD without `vsm developer-mode enable`, which reboots the VVD.
  2. Ran `inputd-cli get_screen_size` over `vega exec vda shell` *before* enabling developer mode.
- **Expected:** Per the docs, the command fails until developer mode is on.
- **Actual:**
  - On a fresh 0.24 VVD, `inputd-cli get_screen_size` and `button_press KEY_*` worked straight away (`devmode.log`: "inputd-cli already usable").
  - The help banner already said "dev-mode inputd cli".
  - The docs are stale or ambiguous, and following them adds a reboot.
- **Severity:** Low. It was confusing, but cost no time once we probed first.
- **Workaround used:** `scripts/enable-devmode.sh` probes first, and only enables developer mode (with a reboot and a wait) if the probe fails.
- **Suggestion:** State which commands need developer mode on the VVD, per SDK version.

### F14. `journalctl` is refused in the developer-mode shell, the pointer goes to an old "kepler-tv" docs path, and there's no `vega device logs`
- **Task attempted:** Collect the app's `console.log` output from the VVD after a scripted demo.
- **Steps taken:**
  1. Ran `vega exec vda shell "journalctl --no-pager -n 4000"`.
  2. Followed the warning's advice and switched to `loggingctl`.
- **Expected:** Device logs, or a `vega device logs` command.
- **Actual:** `WARNING: journalctl is not supported in developer mode shell. Please use loggingctl instead.` The help text links to `developer.amazon.com/docs/kepler-tv/loggingctl.html` (old Kepler naming). There's no `vega device logs --app <id>` for a quick per-app filter.
- **Severity:** Low
- **Workaround used:** `vega exec vda shell "loggingctl log | tail -n 6000"`, then grep for our `[CTTV]` tag.
- **Suggestion:** Add `vega device logs [--app <componentId>] [--follow]` that works the same on the VVD and on devices, and update the link in the warning.

### F15. The emulator log is full of alarming but harmless ERRORs
- **Task attempted:** Diagnose VVD boot problems in CI from the emulator log.
- **Steps taken:**
  1. Captured the relaunched emulator's output to `logs/emulator.log` in every run.
  2. Read it while debugging black frames (F3).
- **Expected:** ERROR lines only when something is actually wrong.
- **Actual:** Every boot logs the following, even when everything works:
  - `ERROR | Failed to create Vulkan instance`
  - `ERROR | Color buffer 0 for 0 cannot be found`
  - `ERROR | Failed to take a screenshot of display: 0`
  - A 40-feature "Please update the emulator" warning

  That makes real failures hard to spot in CI logs.
- **Severity:** Low
- **Workaround used:** We treat these strings as known noise, and judge health by readiness checks (console port, non-black PNG, `vda devices`) instead of log errors.
- **Suggestion:** Downgrade known-benign messages, or document them on the VVD troubleshooting page.

### F16. Recording the VVD window with `x11grab` comes out black
- **Task attempted:** Record the emulator window on Xvfb with ffmpeg, as a fallback recorder.
- **Steps taken:**
  1. Dropped `-no-window` from the relaunch argv.
  2. Ran `ffmpeg -f x11grab -i :99` (vega-vvd-ci run 1, `logs/ffmpeg-x11grab.log`).
- **Expected:** The device image inside the emulator window.
- **Actual:** A black frame (a 42 KB MP4 for 60 s) with a small cursor. The window doesn't render its GL content under Xvfb with llvmpipe.
- **Severity:** Low. The console recorder works.
- **Workaround used:** The emulator-console recorder (F6).
- **Suggestion:** Note on the VVD docs that the window can't be captured under Xvfb/llvmpipe, and make the F4 `vega device record` the supported recording path.

### F17. Build papercuts in an untouched helloWorld template
- **Task attempted:** Build the untouched helloWorld template in CI.
- **Steps taken:**
  1. Ran `vega project generate --template helloWorld`.
  2. Ran `npm install`.
  3. Ran `npm run build:release` (vega-vvd-ci runs 1–3, `logs/build.log`).
- **Expected:** A clean build log for an unmodified official template.
- **Actual:**
  - `WARNING: build_number is 0. Provide via --build-number CLI option or in manifest.toml [package] section.` prints 3 times on every build.
  - The intermediate output path contains a literal `undefined`: `build/private/kepler/@amazon-devices/hellovega/undefined/vega/x86_64/Release/...`.
  - `npm install` prints about 15 deprecation warnings: eslint 8, the babel proposal plugins, and metro-react-native-babel-preset 0.76 alongside Metro 0.83.
  - `build:release` builds all three architectures (x86_64, aarch64, armv7). For a VVD-only CI loop that's wasted time, and the docs don't say how to build a single architecture from the npm scripts.
- **Severity:** Low
- **Workaround used:** We ignore the warnings. The 3-arch release build (about 60 s) runs while the VVD boots in the background, so it costs no wall-clock time.
- **Suggestion:** Set `build_number` in the template manifest, fix the `undefined` path segment, update the deprecated dependencies, and document (or add) a single-arch npm script.

### F18. The docs' `llms.txt` isn't reachable by non-browser clients
- **Task attempted:** Fetch the docs index that AI tooling is meant to use. The docs pages advertise `llms.txt`.
- **Steps taken:** Ran `curl https://developer.amazon.com/docs/llms.txt`.
- **Expected:** A plain-text index of the docs.
- **Actual:** It returns the developer-portal HTML shell (with sign-in JS), not the plain-text index.
- **Severity:** Low
- **Workaround used:** None for `llms.txt` itself. We read the individual HTML docs pages instead.
- **Suggestion:** Serve `llms.txt` as `text/plain`, without the portal wrapper.

### F19. The Vega ESLint preset fails `npm run release` on a performance hint, and writes an untracked state file into the project
- **Task attempted:** Make `npm run release` (the template's `lint`, then `test`, then `build:app`) pass from a fresh clone. The round-2 tester found it stopped at lint.
- **Steps taken:** `npm install`, then `npm run lint` (`eslint src test package.json --ext .ts,.tsx` with `plugin:@amazon-devices/eslint-plugin-kepler/kepler`), on 23 Oct 2026.
- **Expected:** Performance advice reported as warnings, and lint leaving the working tree clean.
- **Actual:**
  - `'useNativeDriver' property is set to 'false'. Set useNativeDriver to 'true' to run animations on UI thread for better performance.` from `@amazon-devices/kepler/animated` is an **error**, so 3 animations fail the whole `release` script. The message links to the best-practices page but doesn't say which animated props the native driver supports on Vega, so you can't tell whether flipping it is safe without a device run.
  - Each lint run writes `generated/eslint-plugin-kepler/keplerESLintState.json` (`{"fullyDrawn":{"useReportFullyDrawnFound":false},…}`) into the app folder. The template's `.gitignore` doesn't ignore it, so it shows up as an untracked file to commit by mistake.
- **Severity:** Low
- **Workaround used:** An inline `eslint-disable-next-line @amazon-devices/kepler/animated -- <reason>` on each animation, because the entry was already submitted and we wouldn't change runtime behaviour without a device test. We added `generated/` to `app/.gitignore`. Lint now reports 0 errors.
- **Suggestion:** Make `kepler/animated` a warning (or an error only for props that are known to work natively), list the supported props in the message, and add `generated/` to the template `.gitignore`.

---

## What worked well

### P1. The helloWorld template builds and runs first time
- `vega project generate --template helloWorld`, then `npm install`, then `npm run build:release` built `build/x86_64-release/hellovega_x86_64.vpkg` first time. No manifest edits were needed: the template already satisfied the `[os.version]` prerequisite on the build page.
- `vega run-app <vpkg> <appId> -d VirtualDevice` installed and launched the app in 3–4 s.

### P2. W3C Media playback works on the headless VVD, and the emulator recorder captures the video surface
- `VideoPlayer` with `KeplerVideoSurfaceView` played a 480p H.264/AAC MP4, streamed from a Vercel URL, inside the VVD on a GitHub runner (software GL, `-gpu host`). Seeking on `loadedmetadata` worked.
- `screenrecord screenshot` / `start` captured the decoded frames composited with our RN overlay (subtitles and the Ask panel).
- The VVD had outbound internet: fetches to Vercel worked.
- `inputd-cli` `KEY_ENTER` / `KEY_DOWN` / `KEY_BACK` drove TouchableOpacity focus and `hardwareBackPress` as expected.
- The app's first build and VVD run went green first time.
- One papercut, our own fault: a stray data track (chapters remuxed from the MKV source) made `duration` report 14:48 for a 5:30 file. A note in the docs on `durationchange` vs container duration would help.

---

## Hackathon platform (Devpost, not Amazon tooling)

### H1. The Devpost submission form
- **Task attempted:** Join the hackathon and submit the project on Devpost.
- **Steps taken:**
  1. Clicked Join.
  2. Clicked "Start project".
  3. Filled in the submission form, including the friction-log and AWS mini-challenge fields.
- **Expected:**
  - A low-friction join and submit flow.
  - A friction-log field big enough for a log.
  - Optional questions that are actually optional.
- **Actual:**
  - "Start project" raised a reCAPTCHA image challenge, and the Join link raised Cloudflare Turnstile. Both slow down automated or assistive flows.
  - The "[Optional] Friction Log" field is a single-line `https://` URL input, even though its helper text asks for a full essay.
  - "AWS Builder Mini Challenge: Which AWS services…" is required even when you answer "No" to the AWS mini challenge.
- **Severity:** Low
- **Workaround used:** We host this log in the repo and paste its GitHub URL into the field. We filled the required AWS field anyway.
- **Suggestion:** Make the friction-log field a textarea or a file upload, and make the AWS write-up conditional on answering "Yes".

---

## CI runs (evidence)

### vega-vvd-ci spike (OlsOls4/is-it-working, branch `vega-vvd-spike`, 17 Oct 2026)
Run 1 worked first time **because** we started from the community recipe. The entries above cover what that recipe works around, and what we hit on top of it.

| Run | ID | Result | VVD ready | Total |
|---|---|---|---|---|
| 1 | 39055001658 | ✅ build, boot, launch, 10 screenshots, 60 s WebM/MP4, D-pad OK. The cache save failed (F11) and x11grab came out black (F16). | 61 s | 478 s |
| 2 | 39055759198 | ✅ composite action, plus a focus walk across all 4 tiles. Cache saved (2.1 GB). | 61 s | 425 s |
| 3 | 39056382695 | ✅ Node 22, warm cache | 54 s | 227 s |

### casttoyourtv-firetv (OlsOls4/casttoyourtv-firetv, uses `OlsOls4/vega-vvd-ci`)
| Run | ID | Result |
|---|---|---|
| 1 | 39059395171 | ✅ First build and VVD run green: pair screen, relay cast, video with subtitles, Ask panel. The answer card overflowed, and we fixed it. |
| 2 | 39060337721 | ✅ Committed `app/`, web-sender cast via headless Chrome, unit tests 4/4, compact panel. |
| 3 | 39060876853 | ✅ Ask at 2:25 (10 lines known), Sintel credit, 145 s 1080p MP4. |
| 4 | 39061447507 | ✅ Same flow, a Pillow contact sheet of all 20 steps, 154 s demo. |
| 5 | 39065527987 | ✅ Ask the TV from the phone: voice or typed free questions through the relay (17 Oct). |
| 6 | 39940708302 | ✅ `polish`: who's asking, stepping out / I'm back, answer card follows focus (23 Oct). |
| 7 | 39943056756 | ✅ `mediactl`: Vega Media Controls (`KeplerMediaControlHandler`) builds and runs on the VVD. |
| 8 | 39944283245 | ✅ `polish`: switched to `vega-vvd-ci@v1`, app-filtered device logs. |
| 9 | 39945908768 | ✅ `polish`: README and Vega API table run; real log lines quoted in the README. |
| 10 | 39948956038 | ✅ `main`: pinned `vega-vvd-ci@v1.0.0`; the submitted build. |
| 11 | 39966026242 | ✅ `polish`: round-2 fixes (no model call before dialogue, hedged Gemini/Groq race, Runtime Cache relay, answers on the phone), 76/76 server tests, full VVD demo against the new backend. |
| 12 | 39967499636 | ✅ `main`: the same commit (`f40751b`) on `main`; the phone page confirmed delivery ("Your TV got the question ✓"). |
