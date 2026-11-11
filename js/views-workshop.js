// Workshops: start one, ask to join one with a code, switch between them.
import { html, useState } from './lib.js';
import { db } from './data.js';
import { ROLES, toast, switchWorkshop } from './ui.js';

// Used on the welcome screen, the waiting screen and the Workshops page.
// onChange reloads the list of workshops after something changed.
export function WorkshopManager({ workshops, current, onChange }) {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(fn) {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(err.message, true);
    }
    setBusy(false);
  }

  const create = (e) => {
    e.preventDefault();
    run(async () => {
      const w = await db.createWorkshop(name);
      switchWorkshop(w.id);
    });
  };

  const join = (e) => {
    e.preventDefault();
    run(async () => {
      const w = await db.joinWorkshop(code);
      setCode('');
      const known = workshops.find((x) => x.id === w.id);
      toast(
        known && known.role !== 'pending'
          ? `You are already in ${w.name}`
          : `Request sent to ${w.name}. An admin there needs to approve you.`,
      );
      await onChange();
    });
  };

  const leave = (w) => {
    if (!confirm(`Leave ${w.name}? You will need a new invitation to come back.`)) return;
    run(async () => {
      await db.leaveWorkshop(w.id);
      toast(`You left ${w.name}`);
      if (w.id === current?.id) location.hash = '#/';
      await onChange();
    });
  };

  return html`
    ${workshops.length > 0 &&
    html`<div class="card list" style="margin-bottom:16px">
      ${workshops.map(
        (w) => html`
          <div class="row" key=${w.id}>
            <div class="main">
              <div class="title">${w.name} ${w.id === current?.id && html`<span class="badge">Open now</span>`}</div>
              <div class="sub">${ROLES[w.role] ?? w.role}</div>
            </div>
            <div class="actions">
              ${w.id !== current?.id &&
              w.role !== 'pending' &&
              html`<button class="btn small" onClick=${() => switchWorkshop(w.id)}>Open</button>`}
              ${w.role !== 'admin' &&
              html`<button class="btn small" disabled=${busy} onClick=${() => leave(w)}>
                ${w.role === 'pending' ? 'Cancel request' : 'Leave'}
              </button>`}
            </div>
          </div>
        `,
      )}
    </div>`}

    <form class="card pad form" style="margin-bottom:16px" onSubmit=${join}>
      <h2>Join a workshop</h2>
      <p class="muted small">Ask the workshop's admin for the join code or the invite link.</p>
      <label>
        <span>Join code</span>
        <input required value=${code} onInput=${(e) => setCode(e.target.value)} placeholder="e.g. 4F7A21C9"
          autocapitalize="characters" autocomplete="off" />
      </label>
      <button class="btn primary" disabled=${busy || !code.trim()}>Ask to join</button>
    </form>

    <form class="card pad form" onSubmit=${create}>
      <h2>Start a new workshop</h2>
      <p class="muted small">You become its admin and can invite your team.</p>
      <label>
        <span>Workshop name</span>
        <input required maxlength="80" value=${name} onInput=${(e) => setName(e.target.value)}
          placeholder="e.g. Delta Plastics workshop" />
      </label>
      <button class="btn primary" disabled=${busy || !name.trim()}>Create workshop</button>
    </form>
  `;
}

export function Workshops({ workshops, current, onChange }) {
  return html`
    <div class="page-head"><h1>Workshops</h1></div>
    <div style="max-width:560px">
      <${WorkshopManager} workshops=${workshops} current=${current} onChange=${onChange} />
    </div>
  `;
}
