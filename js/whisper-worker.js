// Private voice mode: turns recorded speech into text on this device.
// Runs in a background worker so the page stays responsive. Audio is never uploaded;
// only the speech model itself is downloaded (once, then kept by the browser).
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';

const MODEL = 'onnx-community/whisper-tiny.en';

let loading = null;
const files = new Map(); // file name -> { loaded, total }

function report(p) {
  if (p.status !== 'progress' || !p.total) return;
  files.set(p.file, { loaded: p.loaded, total: p.total });
  let loaded = 0;
  let total = 0;
  for (const f of files.values()) {
    loaded += f.loaded;
    total += f.total;
  }
  postMessage({ type: 'progress', percent: Math.floor((loaded / total) * 100) });
}

const load = () =>
  (loading ??= pipeline('automatic-speech-recognition', MODEL, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: report,
  }));

onmessage = async ({ data }) => {
  try {
    const transcriber = await load();
    const out = await transcriber(data.audio);
    postMessage({ type: 'result', id: data.id, text: out.text ?? '' });
  } catch (err) {
    loading = null;
    postMessage({ type: 'error', id: data.id, message: String(err?.message ?? err) });
  }
};
