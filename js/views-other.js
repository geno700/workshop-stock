// Movement list (shared), full history page and team page.
import { html, useState } from './lib.js';
import { db } from './data.js';
import { MOVE_LABELS, ROLES, fmtQty, shownUnit, fmtNum, fmtDate, toast, ask, useLoad, toCSV, download, today, appBase } from './ui.js';

export function exportMoves(moves, name = 'stock-history') {
  const rows = moves.map((m) => [
    new Date(m.created_at).toLocaleString(), m.item_name, MOVE_LABELS[m.type] ?? m.type, m.delta, m.unit,
    m.balance_after, m.reason ?? '', m.project_name ?? '', m.user_name,
  ]);
  download(
    `${name}-${today()}.csv`,
    toCSV(['date', 'item', 'type', 'change', 'unit', 'balance_after', 'reason', 'project', 'person'], rows),
  );
}

const badgeClass = (type) => (type === 'in' || type === 'return' ? 'in' : type === 'adjust' ? 'adjust' : 'out');

export function MovementList({ moves, showItem = false, undoId = null, onUndo }) {
  if (!moves.length) return html`<p class="empty">No stock movements yet.</p>`;
  return html`
    <div class="list">
      ${moves.map(
        (m) => html`
          <div class="row" key=${m.id}>
            <div class="main">
              <div class="title">
                <span class=${'badge ' + badgeClass(m.type)}>${MOVE_LABELS[m.type] ?? m.type}</span>
                ${' '}${showItem ? html`<a href=${'#/items/' + m.item_id}>${m.item_name}</a>` : m.reason || 'No reason given'}
              </div>
              <div class="sub">
                ${[showItem ? m.reason : null, m.project_name && 'Project: ' + m.project_name, m.user_name, fmtDate(m.created_at)]
                  .filter(Boolean)
                  .join(' · ')}
                ${m.id === undoId && html` · <button class="undo-link" onClick=${onUndo}>Undo</button>`}
              </div>
            </div>
            <div>
              <div class=${'delta ' + (m.delta > 0 ? 'pos' : m.delta < 0 ? 'neg' : '')}>
                ${m.delta > 0 ? '+' : ''}${fmtQty(m.delta, m.unit)} ${shownUnit(m.unit)}
              </div>
              <div class="muted small num" style="text-align:right">now ${fmtQty(m.balance_after, m.unit)}</div>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

export function History() {
  const { data: moves, error, loading } = useLoad(() => db.listMovements({ limit: 500 }));
  const [q, setQ] = useState('');
  const [type, setType] = useState('');

  if (loading) return html`<p class="state">Loading…</p>`;
  if (error) return html`<p class="state">Something went wrong: ${error.message}</p>`;

  const needle = q.trim().toLowerCase();
  const shown = moves.filter(
    (m) =>
      (!type || m.type === type) &&
      (!needle || [m.item_name, m.reason, m.user_name].join(' ').toLowerCase().includes(needle)),
  );
  const chip = (value, label) =>
    html`<button class=${'chip' + (type === value ? ' on' : '')} onClick=${() => setType(value)}>${label}</button>`;

  return html`
    <div class="page-head">
      <h1>History</h1>
      <button class="btn" onClick=${() => exportMoves(shown)}>Export CSV</button>
    </div>
    <div class="filters">
      <input type="search" placeholder="Search item, reason or person" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="chips">
        ${chip('', 'All')} ${chip('in', 'Added')} ${chip('out', 'Taken')} ${chip('adjust', 'Recounts')}
        ${chip('checkout', 'Borrowed')} ${chip('return', 'Returned')}
      </div>
    </div>
    <div class="card"><${MovementList} moves=${shown} showItem=${true} /></div>
    <p class="muted small" style="margin-top:10px">
      ${shown.length} of ${moves.length} movements${moves.length === 500 ? ' (latest 500 loaded)' : ''}
    </p>
  `;
}

export function Team({ me, workshop, onChange }) {
  const { data: people, error, loading, reload } = useLoad(() => db.listProfiles());
  const [code, setCode] = useState(workshop.join_code);

  if (loading) return html`<p class="state">Loading…</p>`;
  if (error) return html`<p class="state">Something went wrong: ${error.message}</p>`;

  const link = appBase() + '?join=' + code;

  async function attempt(fn) {
    try {
      await fn();
    } catch (err) {
      toast(err.message, true);
    }
  }
  const change = (person, role) =>
    attempt(async () => {
      await db.setRole(person.id, role);
      toast(`${person.full_name || person.email} is now: ${ROLES[role]}`);
    }).then(reload);
  const remove = async (person) => {
    const who = person.full_name || person.email;
    if (!(await ask(`Remove ${who} from ${workshop.name}?`, { ok: 'Remove', danger: true }))) return;
    attempt(async () => {
      await db.removeMember(person.id);
      toast(`${who} was removed`);
    }).then(reload);
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied');
    } catch {
      // Copying is blocked here: show the link selected so it can be copied by hand.
      ask('Copy this invite link and send it to your team:', { input: true, value: link, ok: 'Done' });
    }
  };
  const newCode = async () => {
    if (!(await ask('Make a new join code? The old code and invite link will stop working.', { ok: 'Make new code' }))) return;
    attempt(async () => {
      setCode(await db.newJoinCode());
      toast('New join code made');
      onChange();
    });
  };
  const rename = async () => {
    const name = (await ask('Workshop name', { input: true, value: workshop.name, ok: 'Rename' }))?.trim();
    if (!name || name === workshop.name) return;
    attempt(async () => {
      await db.renameWorkshop(name);
      toast('Workshop renamed');
      onChange();
    });
  };

  const waiting = people.filter((p) => p.role === 'pending').length;

  return html`
    <div class="page-head">
      <h1>Team</h1>
      <button class="btn" onClick=${rename}>Rename workshop</button>
    </div>
    <div class="card pad form" style="margin-bottom:16px">
      <h2>Invite people to ${workshop.name}</h2>
      <p class="muted small">
        Send this link, or the join code. They create an account, appear below as waiting, and you choose what they can do.
      </p>
      <dl class="facts">
        <div><dt>Invite link</dt><dd>${link}</dd></div>
        <div><dt>Join code</dt><dd class="join-code">${code}</dd></div>
      </dl>
      <div class="actions">
        <button class="btn primary" onClick=${copyLink}>Copy invite link</button>
        <button class="btn" onClick=${newCode}>New join code</button>
      </div>
    </div>
    ${waiting > 0 && html`<p style="margin-bottom:10px"><strong>${waiting} waiting for approval.</strong></p>`}
    <div class="card list">
      ${people.map(
        (p) => html`
          <div class="row wrap" key=${p.id}>
            <div class="main">
              <div class="title">${p.full_name || p.email} ${p.id === me.id && html`<span class="badge">You</span>`}</div>
              <div class="sub">${p.email}</div>
            </div>
            <div class="actions" style="justify-content:flex-end">
              <select style="width:auto;max-width:100%" value=${p.role} disabled=${p.id === me.id}
                onChange=${(e) => change(p, e.target.value)}>
                ${Object.entries(ROLES).map(([k, label]) => html`<option value=${k}>${label}</option>`)}
              </select>
              ${p.id !== me.id && html`<button class="btn small" onClick=${() => remove(p)}>Remove</button>`}
            </div>
          </div>
        `,
      )}
    </div>
  `;
}