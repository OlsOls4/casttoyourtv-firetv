#!/usr/bin/env bash
# Scripted remote-control demo on the VVD: pair screen -> cast via relay -> player with
# subtitles -> "Ask the TV" (5 questions) -> resume -> back. Screenshots + 1080p recording.
set -uo pipefail
export PATH="$HOME/vega/bin:$PATH"
OUT=${OUT:-$PWD/artifacts}; mkdir -p "$OUT/shots" "$OUT/logs"
PACKAGE_ID=${PACKAGE_ID:-com.olsols4.casttoyourtv}
APP_ID=${APP_ID:-$PACKAGE_ID.main}
VPKG=${VPKG:-$(cat "$OUT/vpkg-path.txt")}
API=${API_BASE:-https://casttoyourtv-firetv.vercel.app}
n=0
T0=$SECONDS
shot() { n=$((n+1)); local f; f=$(printf '%s/shots/%02d-%s.png' "$OUT" "$n" "$1"); screenshot.sh "$f" >/dev/null 2>&1 || echo "shot $1 failed"; echo "[$((SECONDS-T0))s] shot $(basename "$f")"; }
p() { PRESS_GAP=${GAP:-0.4} press.sh "$@"; }

echo "::group::developer mode (inputd-cli)"
enable-devmode.sh 2>&1 | tee "$OUT/logs/devmode.log"
echo "::endgroup::"

echo "::group::VVD network check"
timeout 25 vega exec vda shell "curl -s -m 10 $API/api/health || wget -qO- $API/api/health" 2>&1 | tee "$OUT/logs/vvd-network.txt" || true
echo "::endgroup::"

shot launcher
record.sh start "$OUT/demo-console.webm" 2>&1 | tee "$OUT/logs/record-start.log"
T0=$SECONDS

echo "::group::run app"
vega run-app "$VPKG" "$APP_ID" -d VirtualDevice 2>&1 | tee "$OUT/logs/run-app.log" || {
  vega device install-app --packagePath "$VPKG" -d VirtualDevice 2>&1 | tee -a "$OUT/logs/run-app.log"
  vega device launch-app --appName "$APP_ID" -d VirtualDevice 2>&1 | tee -a "$OUT/logs/run-app.log"; }
echo "::endgroup::"
sleep 13; shot pair-screen
p right; sleep 1.2; shot pair-focus-newcode
p left;  sleep 1.2; shot pair-focus-demo

echo "::group::cast from the web sender (code $PAIR_CODE)"
SENDER="$API/s/?code=$PAIR_CODE&start=100"
CHROME=$(command -v google-chrome || command -v chromium || true)
CAST=none
if [[ -n "$CHROME" ]]; then
  n=$((n+1)); SP=$(printf '%s/shots/%02d-sender-phone.png' "$OUT" "$n")
  # 1) phone-sized screenshot of the sender page, prefilled from the QR link
  timeout 40 "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=430,932 \
    --virtual-time-budget=4000 --screenshot="$SP" "$SENDER" >/dev/null 2>&1 || true
  # 2) the same page with autosend=1 actually casts to the TV through the relay
  timeout 40 "$CHROME" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=6000 --dump-dom \
    "$SENDER&autosend=1" > "$OUT/logs/sender-dom.html" 2>/dev/null || true
  grep -o 'id="st"[^<]*' "$OUT/logs/sender-dom.html" | tee "$OUT/logs/sender-status.txt" || true
  grep -q 'Sent' "$OUT/logs/sender-dom.html" && CAST=sender-page
fi
if [[ "$CAST" == none ]]; then
  resp=$(curl -s -m 15 -X POST "$API/api/relay" -H 'content-type: application/json' \
    -d "{\"code\":\"$PAIR_CODE\",\"videoUrl\":\"$API/media/sintel-0-330-480p.mp4\",\"subtitleUrl\":\"$API/media/sintel_en.srt\",\"title\":\"Sintel (Blender Foundation, CC BY)\",\"startAt\":100}")
  echo "$resp" | tee "$OUT/logs/relay-post.json"
  if echo "$resp" | grep -q '"tvOnline":true'; then CAST=relay-curl
  else echo "TV not seen on relay: pressing Select on 'Play the demo film'"; CAST=button; p select; fi
fi
echo "cast path: $CAST"; echo "$CAST" > "$OUT/logs/cast-path.txt"
echo "::endgroup::"

sleep 5;  shot player-start
sleep 6;  shot subtitle-a
sleep 7;  shot subtitle-b
sleep 9;  shot subtitle-c
sleep 9;  shot subtitle-d
sleep 10; shot before-ask

echo "::group::Ask the TV"
p select; sleep 2.5; shot ask-open
p select; sleep 5; shot ask-what-did-i-miss
p down select; sleep 5; shot ask-recap
p down select; sleep 5; shot ask-explain
p down select; sleep 5; shot ask-translate
p down select; sleep 5; shot ask-whos-speaking
p back; sleep 5; shot resumed
p back; sleep 3; shot back-to-pair
echo "::endgroup::"

record.sh stop 2>&1 | tee "$OUT/logs/record-stop.log"
sleep 4
echo "demo length $((SECONDS-T0))s"
timeout 40 vega exec vda shell "loggingctl log | tail -n 6000" > "$OUT/logs/device-log.txt" 2>&1 || true
grep -aE "CTTV|w3cmedia|casttoyourtv" "$OUT/logs/device-log.txt" > "$OUT/logs/app-log.txt" 2>/dev/null || true
tail -40 "$OUT/logs/app-log.txt" 2>/dev/null || true

if [[ -s "$OUT/demo-console.webm" ]]; then
  ffmpeg -y -loglevel error -i "$OUT/demo-console.webm" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart "$OUT/ask-the-tv-demo.mp4" || true
fi
ffmpeg -y -loglevel error -pattern_type glob -i "$OUT/shots/*.png" -vf "scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:color=0x0B0F1A,tile=4x6:padding=6:color=0x0B0F1A" -frames:v 1 "$OUT/contact-sheet.png" || true
ls -la "$OUT" "$OUT/shots"
