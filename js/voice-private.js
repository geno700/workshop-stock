// Private voice mode: record from the microphone and transcribe on this device (see whisper-worker.js).

const READY_KEY = 'workshop-stock-speech-model';
const MAX_SECONDS = 20;

export const privateSupported = Boolean(
  navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder && globalThis.Worker && globalThis.AudioContext,
);

// True once the speech model has been downloaded in this browser.
export function modelDownloaded() {
  try {
    return localStorage.getItem(READY_KEY) === '1';
  } catch {
    return false;
  }
}

// Starts recording. Returns { stop, cancel }: stop() resolves to the sound as 16 kHz mono samples.
// onAutoStop is called if the recording reaches the time limit.
export async function startRecording(onAutoStop) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.start();
  const timer = setTimeout(() => onAutoStop?.(), MAX_SECONDS * 1000);

  const finish = () =>
    new Promise((resolve) => {
      clearTimeout(timer);
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        resolve();
      };
      if (recorder.state === 'inactive') recorder.onstop();
      else recorder.stop();
    });

  return {
    async stop() {
      await finish();
      const bytes = await new Blob(chunks, { type: recorder.mimeType }).arrayBuffer();
      if (!bytes.byteLength) throw new Error('Nothing was recorded');
      // Decoding in a 16 kHz context also resamples to what the speech model expects.
      const ctx = new AudioContext({ sampleRate: 16000 });
      try {
        return (await ctx.decodeAudioData(bytes)).getChannelData(0).slice();
      } finally {
        ctx.close();
      }
    },
    cancel: finish,
  };
}

let worker = null;
let nextId = 1;
const waiting = new Map(); // id -> { resolve, reject, onProgress }

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') {
      waiting.forEach((w) => w.onProgress?.(data.percent));
      return;
    }
    const w = waiting.get(data.id);
    waiting.delete(data.id);
    if (!w) return;
    if (data.type === 'result') {
      try {
        localStorage.setItem(READY_KEY, '1');
      } catch {
        // Storage blocked: the download note is simply shown again next time.
      }
      w.resolve(tidy(data.text));
    } else w.reject(new Error(data.message));
  };
  worker.onerror = (e) => {
    waiting.forEach((w) => w.reject(new Error(e.message || 'The speech model could not be loaded')));
    waiting.clear();
    worker.terminate();
    worker = null;
  };
  return worker;
}

// Whisper adds sentence punctuation and notes like [BLANK_AUDIO]; commands read better without them.
const tidy = (text) =>
  text
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '');

// Turns recorded samples into text. onProgress(percent) reports the one-time model download.
export function transcribe(audio, onProgress) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, audio }, [audio.buffer]);
  });
}
