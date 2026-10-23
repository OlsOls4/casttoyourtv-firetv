// Vega Media Controls: the system transport (remote media keys, Alexa "pause" / "rewind",
// the system media UI) drives our player through a KeplerMediaControlHandler, registered with
// VideoPlayer.setMediaControlFocus() as in Amazon's vega-video-sample.
import { KeplerMediaControlHandler } from '@amazon-devices/react-native-w3cmedia';

export type Transport = {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seekTo: (seconds: number) => void;
  seekBy: (delta: number) => void;
};

type TimeValue = { seconds?: number; nanoseconds?: number } | undefined;
const secs = (v: TimeValue) => Number(v?.seconds || 0) + Number(v?.nanoseconds || 0) / 1e9;
const log = (what: string) => console.log(`[CTTV] media control: ${what}`);

export class CttvMediaControls extends KeplerMediaControlHandler {
  private tr: Transport;
  constructor(tr: Transport) {
    super();
    this.tr = tr;
  }
  async handlePlay() {
    log('play');
    this.tr.play();
  }
  async handlePause() {
    log('pause');
    this.tr.pause();
  }
  async handleStop() {
    log('stop');
    this.tr.pause();
  }
  async handleTogglePlayPause() {
    log('togglePlayPause');
    this.tr.toggle();
  }
  async handleStartOver() {
    log('startOver');
    this.tr.seekTo(0);
  }
  async handleFastForward() {
    log('fastForward');
    this.tr.seekBy(10);
  }
  async handleRewind() {
    log('rewind');
    this.tr.seekBy(-10);
  }
  async handleSeek(position: any) {
    log(`seek ${secs(position).toFixed(1)}s`);
    this.tr.seekTo(secs(position));
  }
  async handleSkipForward(delta: any) {
    log('skipForward');
    this.tr.seekBy(secs(delta) || 10);
  }
  async handleSkipBackward(delta: any) {
    log('skipBackward');
    this.tr.seekBy(-(secs(delta) || 10));
  }
}
