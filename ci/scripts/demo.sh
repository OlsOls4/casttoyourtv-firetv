#!/usr/bin/env bash
# Scripted remote-control demo on the VVD: pair screen -> cast via relay -> player with
# subtitles -> "Ask the TV" (5 questions + a phone question) -> resume. Then a second recording
# of the household features driven from the headless phone page: "Stepping out" / "I'm back"
# (recap of exactly the missed stretch), a named viewer asking in French, Translate -> French,
# answer card tied to focus, Back-twice-to-exit. Screenshots + 1080p recordings + device logs.
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
    -d "{\"code\":\"$PAIR_CODE\",\"videoUrl\":\"$API/media/sintel-0-330-480p.mp4\",\"subtitleUrl\":\"$API/media/sintel_en.srt\",\"title\":\"Sintel\",\"startAt\":100}")
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
sleep 10; shot subtitle-e
sleep 11; shot before-ask

echo "::group::Ask the TV"
p select; sleep 2.5; shot ask-open
p select; sleep 5; shot ask-what-did-i-miss
p down select; sleep 5; shot ask-recap
p down select; sleep 5; shot ask-explain
p down select; sleep 5; shot ask-translate
p down select; sleep 5; shot ask-whos-speaking
# Multi-modal: ask a free question from the phone page (voice in real life; typed here, flagged via=voice)
QURL="$API/s/?code=$PAIR_CODE&ask=Why%20is%20she%20looking%20for%20a%20dragon%3F&via=voice"
if [[ -n "${CHROME:-}" ]]; then
  timeout 40 "$CHROME" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=5000 --dump-dom \
    "$QURL&autoask=1" > "$OUT/logs/phone-ask-dom.html" 2>/dev/null || true
  grep -o 'id="ast"[^<]*' "$OUT/logs/phone-ask-dom.html" | tee "$OUT/logs/phone-ask-status.txt" || true
fi
if ! grep -q 'Asked\|Queued' "$OUT/logs/phone-ask-dom.html" 2>/dev/null; then
  curl -s -m 15 -X POST "$API/api/relay" -H 'content-type: application/json' \
    -d '{"code":"'"$PAIR_CODE"'","question":"Why is she looking for a dragon?","via":"voice"}' | tee "$OUT/logs/phone-ask-curl.json"
fi
sleep 7; shot ask-from-phone
p back; sleep 3; shot resumed
echo "::endgroup::"

record.sh stop 2>&1 | tee "$OUT/logs/record-stop.log"
# Snapshot the device log between the two recordings (film paused so the household demo
# starts at the same point in the dialogue).
p playpause
timeout 45 vega exec vda shell loggingctl log > "$OUT/logs/device-log-mid.txt" 2>&1 || true
echo "mid log: $(wc -l < "$OUT/logs/device-log-mid.txt") lines, $(grep -ac CTTV "$OUT/logs/device-log-mid.txt") CTTV"

# ---------------- household features, driven from the phone page (second recording) ----------------
# phone <query> <name> <ok-regex> <fallback-json>: open the sender page headless with an auto action;
# if the page did not confirm, post the same thing straight to the relay.
phone() {
  local f="$OUT/logs/phone-$2.html"
  if [[ -n "${CHROME:-}" ]]; then
    timeout 40 "$CHROME" --headless=new --no-sandbox --disable-gpu --virtual-time-budget=5000 --dump-dom \
      "$API/s/?code=$PAIR_CODE&$1" > "$f" 2>/dev/null || true
  fi
  local st; st=$(grep -o 'id="[ao]st"[^<]*' "$f" 2>/dev/null | tr '\n' ' ')
  echo "phone $2: $st" | tee -a "$OUT/logs/phone-actions.txt"
  if ! grep -qE "$3" "$f" 2>/dev/null; then
    echo "phone $2: page did not confirm, posting to relay" | tee -a "$OUT/logs/phone-actions.txt"
    curl -s -m 15 -X POST "$API/api/relay" -H 'content-type: application/json' -d "$4" | tee -a "$OUT/logs/phone-actions.txt"; echo
  fi
}
echo "::group::Household: stepping out / I'm back, who's asking"
record.sh start "$OUT/demo-household.webm" 2>&1 | tee "$OUT/logs/record2-start.log"
T0=$SECONDS
p playpause; sleep 1
phone "name=Sam&lang=en&event=away&autoevent=1" sam-away 'Got it' '{"code":"'"$PAIR_CODE"'","event":"away","name":"Sam","lang":"en"}'
sleep 2; shot hh-sam-stepped-out
sleep 14; shot hh-while-sam-away
phone "name=Sam&lang=en&event=back&autoevent=1" sam-back 'Welcome back|Queued' '{"code":"'"$PAIR_CODE"'","event":"back","name":"Sam","lang":"en"}'
sleep 6; shot hh-sam-welcome-back
p back; sleep 3
phone "name=Mia&lang=fr&via=voice&ask=Pourquoi%20cherche-t-elle%20un%20dragon%20%3F&autoask=1" mia-ask 'Asked|Queued' '{"code":"'"$PAIR_CODE"'","question":"Pourquoi cherche-t-elle un dragon ?","via":"voice","name":"Mia","lang":"fr"}'
sleep 6; shot hh-mia-asked-in-french
p down; sleep 1.5; shot hh-focus-moved-clears-answer
p down down; sleep 0.5; p select; sleep 5; shot hh-translate-to-french
p back; sleep 2.5; shot hh-resumed
p back; sleep 0.3; shot hh-back-once-toast
p back; sleep 3; shot hh-back-to-pair
record.sh stop 2>&1 | tee "$OUT/logs/record2-stop.log"
echo "household demo length $((SECONDS-T0))s"
echo "::endgroup::"

# Lifecycle: Home sends the app to the background (expect "[CTTV] lifecycle background" in the log).
p home; sleep 4; shot lifecycle-home

# phone-sized screenshots of the new sender sections (dummy code, no auto action)
if [[ -n "${CHROME:-}" ]]; then
  timeout 40 "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=430,1240 --virtual-time-budget=3000 \
    --screenshot="$OUT/shots/98-phone-household.png" "$API/s/?code=$PAIR_CODE&view=remote&name=Mia&lang=fr&ask=Pourquoi%20cherche-t-elle%20un%20dragon%20%3F" >/dev/null 2>&1 || true
  timeout 40 "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=430,1240 --virtual-time-budget=5000 \
    --screenshot="$OUT/shots/97-phone-stepped-out.png" "$API/s/?code=SHOT01&view=remote&name=Sam&lang=en&event=away&autoevent=1" >/dev/null 2>&1 || true
fi
# phone-sized screenshot of the sender with the question filled in (outside the recording)
[[ -n "${CHROME:-}" ]] && timeout 40 "$CHROME" --headless=new --no-sandbox --disable-gpu --hide-scrollbars --window-size=430,932 \
  --virtual-time-budget=3000 --screenshot="$OUT/shots/99-phone-ask.png" "$QURL" >/dev/null 2>&1 || true
sleep 4
echo "demo length $((SECONDS-T0))s"
# loggingctl gets its arguments directly (a quoted pipeline reaches it as bogus args and prints its help).
timeout 60 vega exec vda shell loggingctl log > "$OUT/logs/device-log.txt" 2>&1 || true
cat "$OUT/logs/device-log-mid.txt" "$OUT/logs/device-log.txt" 2>/dev/null | grep -a "CTTV" | awk '!seen[$0]++' > "$OUT/logs/app-log.txt" || true
echo "::group::app log ([CTTV])"; cat "$OUT/logs/app-log.txt"; echo "::endgroup::"
# Real playback check: the subtitle clock must not be hiding a decoder regression.
if ! grep -qa "\[CTTV\] decoder playing" "$OUT/logs/app-log.txt"; then
  if [[ -s "$OUT/logs/app-log.txt" ]]; then echo "::warning::no '[CTTV] decoder playing' log line: video may not have decoded"; else echo "::warning::no [CTTV] log lines captured from the device"; fi
  echo "PLAYBACK: not confirmed" > "$OUT/logs/playback-check.txt"
else
  echo "PLAYBACK: confirmed ($(grep -a -m1 'decoder playing' "$OUT/logs/app-log.txt"))" | tee "$OUT/logs/playback-check.txt"
fi
grep -qa "decoder not advancing" "$OUT/logs/app-log.txt" && echo "::warning::decoder stalled at some point (subtitle clock engaged)"

if [[ -s "$OUT/demo-console.webm" ]]; then
  ffmpeg -y -loglevel error -i "$OUT/demo-console.webm" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart "$OUT/ask-the-tv-demo.mp4" || true
fi
if [[ -s "$OUT/demo-household.webm" ]]; then
  ffmpeg -y -loglevel error -i "$OUT/demo-household.webm" -c:v libx264 -preset veryfast -crf 23 -pix_fmt yuv420p -movflags +faststart "$OUT/household-demo.mp4" || true
fi
python3 -c "import PIL" 2>/dev/null || python3 -m pip install -q --user --break-system-packages pillow >/dev/null 2>&1 || true
python3 "$(dirname "$0")/contact_sheet.py" "$OUT/shots" "$OUT/contact-sheet.png" || true
ls -la "$OUT" "$OUT/shots"
