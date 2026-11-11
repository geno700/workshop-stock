// Voice and typed commands: say or type what happened, check the preview, then confirm.
import { html, useState, useEffect, useRef } from './lib.js';
import { db } from './data.js';
import { KINDS, fmtNum, go, toast } from './ui.js';
import { parseCommand } from './voice-parse.js';
import { setItemDraft } from './views-items.js';
import { savedToast } from './undo.js';
import { privateSupported, modelDownloaded, startRecording, transcribe } from './voice-private.js';

// Which speech engine to use: the browser's own (online) one, or the private on-device one.
const ENGINE_KEY = 'workshop-stock-voice-engine';
function savedEngine() {
  let saved = null;
  try {
    saved = localStorage.getItem(ENGINE_KEY);
  } catch {
    // Storage blocked: fall back to the default below.
  }
  if (saved === 'private' && privateSupported) return 'private';
  if (saved === 'builtin' && SpeechRecognition) return 'builtin';
  return SpeechRecognition ? 'builtin' : privateSupported ? 'private' : 'builtin';
}

const SpeechRecognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

const ACTIONS = { out: 'Take', in: 'Add', adjust: 'Recount (set to)', checkout: 'Borrow', return: 'Return' };
const DONE = { out: 'Took', in: 'Added', adjust: 'Count set to', checkout: 'Borrowed', return: 'Returned' };

const EXAMPLES = [
  'take 5 M5 screws for conveyor build',
  'add 10 kg PLA filament',
  'borrow the caliper',
  'count 12 Arduino Nano',
  'where is the cordless drill',
  'new item aluminium sheet 3 mm, 8 sheets, in rack A',
];

const MicIcon = () => html`
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
  </svg>
`;

export function Voice({ me }) {
  const [open, setOpen] = useState(false);
  return html`
    <button class="fab" aria-label="Voice or typed command" title="Voice or typed command" onClick=${() => setOpen(true)}>
      <${MicIcon} />
    </button>
    ${open && html`<${VoiceSheet} me=${me} onClose=${() => setOpen(false)} />`}
  `;
}

function VoiceSheet({ me, onClose }) {
  const [ctx, setCtx] = useState(null);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [micError, setMicError] = useState('');
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [engine, setEngine] = useState(savedEngine);
  const [status, setStatus] = useState('');
  const rec = useRef(null);
  const tape = useRef(null);
  const finish = useRef(null);
  const input = useRef(null);

  useEffect(() => {
    Promise.all([db.listItems(), db.listProjects(), db.listLocations()]).then(
      ([items, projects, locations]) => setCtx({ items, projects, locations }),
      (err) => setError(err.message),
    );
    input.current?.focus();
    return () => {
      rec.current?.abort();
      tape.current?.cancel();
    };
  }, []);

  function understand(sentence) {
    setError('');
    if (!ctx || !sentence.trim()) return setDraft(null);
    const r = parseCommand(sentence, ctx);
    if (r.intent === 'move') {
      setDraft({
        ...r,
        itemId: r.candidates[0]?.entry.id ?? '',
        qty: r.quantity === null ? '' : String(r.quantity),
        projectId: r.project?.id ?? '',
      });
    } else setDraft(r);
  }

  function chooseEngine(next) {
    if (listening || status) return;
    setEngine(next);
    setMicError('');
    try {
      localStorage.setItem(ENGINE_KEY, next);
    } catch {
      // Storage blocked: the choice lasts for this visit only.
    }
  }

  // Private mode: record, then turn the recording into text on this device.
  async function togglePrivateMic() {
    if (status) return;
    if (!listening) {
      setMicError('');
      setDraft(null);
      try {
        tape.current = await startRecording(() => finish.current?.());
        setListening(true);
      } catch (err) {
        setMicError(
          err.name === 'NotAllowedError'
            ? 'Microphone access was blocked. Allow it in the browser, or type instead.'
            : err.name === 'NotFoundError' ? 'No microphone was found.' : 'Recording could not start: ' + err.message,
        );
      }
      return;
    }
    await finishPrivate();
  }
  async function finishPrivate() {
    const recording = tape.current;
    tape.current = null;
    if (!recording) return;
    setListening(false);
    setStatus('Working out what you said…');
    try {
      const audio = await recording.stop();
      const heard = await transcribe(audio, (percent) => setStatus(`Downloading the speech model: ${percent}%`));
      if (heard) {
        setText(heard);
        understand(heard);
      } else setMicError('I did not hear anything. Tap the microphone and try again.');
    } catch (err) {
      setMicError('Private voice input failed: ' + err.message);
    }
    setStatus('');
  }
  finish.current = finishPrivate;

  function toggleMic() {
    if (engine === 'private') return togglePrivateMic();
    if (listening) return rec.current?.stop();
    setMicError('');
    const r = new SpeechRecognition();
    rec.current = r;
    r.lang = 'en-US';
    r.interimResults = true;
    r.maxAlternatives = 1;
    let heard = '';
    r.onresult = (e) => {
      heard = [...e.results].map((x) => x[0].transcript).join(' ').trim();
      setText(heard);
    };
    r.onerror = (e) => {
      const why = {
        'not-allowed': 'Microphone access was blocked. Allow it in the browser, or type instead.',
        'service-not-allowed': 'Voice input is switched off on this device. Type instead.',
        'no-speech': 'I did not hear anything. Tap the microphone and try again.',
        network: 'Voice recognition needs an internet connection. Type instead.',
        'audio-capture': 'No microphone was found.',
      };
      if (e.error !== 'aborted') setMicError(why[e.error] ?? 'Voice input failed: ' + e.error);
    };
    r.onend = () => {
      setListening(false);
      if (heard) understand(heard);
    };
    try {
      r.start();
      setListening(true);
      setDraft(null);
    } catch (err) {
      setMicError('Voice input could not start: ' + err.message);
    }
  }

  const canSpeak = engine === 'private' ? privateSupported : Boolean(SpeechRecognition);
  const items = ctx?.items ?? [];
  const item = draft?.intent === 'move' ? items.find((i) => i.id === draft.itemId) : null;
  const qty = Number(draft?.qty);
  const qtyOk = draft?.qty !== '' && Number.isFinite(qty) && qty >= 0 && (draft?.type === 'adjust' || qty > 0);
  const after = !item || !qtyOk ? null
    : draft.type === 'adjust' ? qty
    : draft.type === 'in' || draft.type === 'return' ? item.quantity + qty
    : item.quantity - qty;

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      const saved = await db.recordMovement({
        item_id: item.id, type: draft.type, quantity: qty, reason: draft.reason,
        project_id: draft.type === 'out' ? draft.projectId || null : null,
      });
      savedToast(`${DONE[draft.type]} ${fmtNum(qty)} ${item.unit}: ${item.name}`, saved);
      dispatchEvent(new Event('stock-changed'));
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const set = (k) => (e) => setDraft({ ...draft, [k]: e.target.value });
  const suggested = draft?.intent === 'move' ? draft.candidates.map((c) => c.entry) : [];
  const others = items.filter((i) => !suggested.includes(i));

  return html`
    <div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <div class="modal voice">
        <div class="voice-head">
          <h2>Say or type what you did</h2>
          <button class="btn small" onClick=${onClose}>Close</button>
        </div>

        <form class="voice-input" onSubmit=${(e) => { e.preventDefault(); understand(text); }}>
          <input ref=${input} value=${text} placeholder=${listening ? (engine === 'private' ? 'Recording… tap the microphone when done' : 'Listening…') : 'e.g. take 5 M5 screws'}
            onInput=${(e) => setText(e.target.value)} aria-label="Command" />
          ${canSpeak &&
          html`<button type="button" class=${'btn mic' + (listening ? ' on' : '')} onClick=${toggleMic} disabled=${!!status}
            aria-label=${listening ? 'Stop listening' : 'Start listening'}><${MicIcon} /></button>`}
          <button class="btn primary" disabled=${!ctx || !text.trim()}>Go</button>
        </form>
        ${(SpeechRecognition || privateSupported) &&
        html`<div class="engine">
          <div class="chips">
            ${SpeechRecognition &&
            html`<button type="button" class=${'chip' + (engine === 'builtin' ? ' on' : '')} onClick=${() => chooseEngine('builtin')}>
              Built-in voice
            </button>`}
            ${privateSupported &&
            html`<button type="button" class=${'chip' + (engine === 'private' ? ' on' : '')} onClick=${() => chooseEngine('private')}>
              Private voice
            </button>`}
          </div>
          <p class="muted small">
            ${engine === 'private'
              ? 'Your speech stays on this device. Tap the microphone, speak, then tap it again.' +
                (modelDownloaded() ? '' : ' The first use downloads a speech model (about 40 MB).')
              : 'Your speech is sent to your browser\u2019s online speech service to be turned into text.'}
          </p>
        </div>`}
        ${!canSpeak && html`<p class="muted small">This browser has no voice input, so type your command.</p>`}
        ${status && html`<p class="small" role="status">${status}</p>`}
        ${micError && html`<p class="error">${micError}</p>`}
        ${error && html`<p class="error">${error}</p>`}

        ${!draft &&
        html`<div class="muted small">
          <p style="margin-bottom:4px">Examples:</p>
          ${EXAMPLES.map((ex) => html`<button class="example" onClick=${() => { setText(ex); understand(ex); }}>${ex}</button>`)}
        </div>`}

        ${draft?.intent === 'move' && !me.canEdit && html`<p class="error">Viewers can search by voice but cannot change stock.</p>`}

        ${draft?.intent === 'move' &&
        me.canEdit &&
        html`<div class="form">
          <p class="muted small">Check this before saving. Nothing is saved until you confirm.</p>
          <div class="grid2">
            <label>
              <span>Action</span>
              <select value=${draft.type} onChange=${set('type')}>
                ${Object.entries(ACTIONS).map(([k, label]) => html`<option value=${k}>${label}</option>`)}
              </select>
            </label>
            <label>
              <span>Quantity${item ? ` (${item.unit})` : ''}${draft.qtyAssumed ? ', assumed' : ''}</span>
              <input type="number" inputmode="decimal" step="any" min="0" value=${draft.qty}
                onInput=${(e) => setDraft({ ...draft, qty: e.target.value, qtyAssumed: false })} />
            </label>
          </div>
          <label>
            <span>Item${suggested.length ? '' : ', not recognised: choose one'}</span>
            <select value=${draft.itemId} onChange=${set('itemId')}>
              ${!draft.itemId && html`<option value="">Choose an item</option>`}
              ${suggested.length > 0 &&
              html`<optgroup label="Best matches">
                ${suggested.map((i) => html`<option value=${i.id}>${i.name}</option>`)}
              </optgroup>`}
              <optgroup label="All items">${others.map((i) => html`<option value=${i.id}>${i.name}</option>`)}</optgroup>
            </select>
          </label>
          ${draft.type === 'out' &&
          ctx.projects.some((p) => p.status === 'active') &&
          html`<label>
            <span>Project (optional)</span>
            <select value=${draft.projectId} onChange=${set('projectId')}>
              <option value="">No project</option>
              ${ctx.projects.filter((p) => p.status === 'active').map((p) => html`<option value=${p.id}>${p.name}</option>`)}
            </select>
          </label>`}
          <label><span>Reason (optional)</span><input value=${draft.reason} onInput=${set('reason')} /></label>
          ${item &&
          html`<p class=${'voice-stock' + (after !== null && after < 0 ? ' bad' : '')}>
            ${item.kind === 'tool' ? 'Available' : 'In stock'}: ${fmtNum(item.quantity)} ${item.unit}
            ${after !== null && html` → <strong>${fmtNum(after)} ${item.unit}</strong> after`}
            ${after !== null && after < 0 && ' (not enough)'}
          </p>`}
          <div class="actions">
            <button class="btn primary big" disabled=${busy || !item || !qtyOk || after < 0} onClick=${confirm}>Confirm</button>
            <button class="btn big" onClick=${() => { setDraft(null); setText(''); input.current?.focus(); }}>Cancel</button>
          </div>
        </div>`}

        ${draft?.intent === 'find' &&
        html`<div class="card list">
          ${draft.candidates.length
            ? draft.candidates.map(
                ({ entry: i }) => html`
                  <a class="row" href=${'#/items/' + i.id} onClick=${onClose}>
                    <div class="main">
                      <div class="title">${i.name}</div>
                      <div class="sub">${[KINDS[i.kind]?.label, i.location_name || 'No location set'].join(' · ')}</div>
                    </div>
                    <div class="qty">${fmtNum(i.quantity)} <small>${i.unit}</small></div>
                  </a>
                `,
              )
            : html`<p class="empty">Nothing matches "${draft.query}".</p>`}
        </div>`}

        ${draft?.intent === 'new' && !me.canEdit && html`<p class="error">Viewers cannot add items.</p>`}
        ${draft?.intent === 'new' &&
        me.canEdit &&
        html`<div class="form">
          <dl class="facts">
            <div><dt>New item</dt><dd>${draft.draft.name || 'No name heard'}</dd></div>
            <div><dt>Quantity</dt><dd>${fmtNum(draft.draft.quantity)} ${draft.draft.unit}</dd></div>
            <div><dt>Location</dt><dd>${draft.draft.location_name || 'Not given'}</dd></div>
          </dl>
          <div class="actions">
            <button class="btn primary big" onClick=${() => { setItemDraft(draft.draft); go('/items/new?v=' + Date.now()); onClose(); }}>
              Review in the form
            </button>
            <button class="btn big" onClick=${() => { setDraft(null); setText(''); }}>Cancel</button>
          </div>
        </div>`}
      </div>
    </div>
  `;
}
