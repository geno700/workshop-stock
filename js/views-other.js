// Movement list (shared), full history page and team page.
import { html, useState } from './lib.js';
import { db } from './data.js';
import { MOVE_LABELS, ROLES, fmtNum, fmtDate, toast, useLoad, toCSV, download, today } from './ui.js';

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

export function MovementList({ moves, showItem = false }) {
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
              </div>
            </div>
            <div>
              <div class=${'delta ' + (m.delta > 0 ? 'pos' : m.delta < 0 ? 'neg' : '')}>
                ${m.delta > 0 ? '+' : ''}${fmtNum(m.delta)} ${m.unit}
              </div>
              <div class="muted small num" style="text-align:right">now ${fmtNum(m.balance_after)}</div>
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

export function Team({ me }) {
  const { data: people, error, loading, reload } = useLoad(() => db.listProfiles());

  if (loading) return html`<p class="state">Loading…</p>`;
  if (error) return html`<p class="state">Something went wrong: ${error.message}</p>`;

  async function change(person, role) {
    try {
      await db.setRole(person.id, role);
      toast(`${person.full_name || person.email} is now: ${ROLES[role]}`);
    } catch (err) {
      toast(err.message, true);
    }
    reload();
  }

  const waiting = people.filter((p) => p.role === 'pending').length;

  return html`
    <div class="page-head"><h1>Team</h1></div>
    <p class="muted" style="margin-bottom:14px">
      To add someone, send them the link to this app and ask them to create an account. They appear here as
      waiting, and you choose what they can do.
      ${waiting > 0 && html` <strong>${waiting} waiting for approval.</strong>`}
    </p>
    <div class="card list">
      ${people.map(
        (p) => html`
          <div class="row" key=${p.id}>
            <div class="main">
              <div class="title">${p.full_name || p.email} ${p.id === me.id && html`<span class="badge">You</span>`}</div>
              <div class="sub">${p.email}</div>
            </div>
            <select style="width:auto;max-width:55%" value=${p.role} disabled=${p.id === me.id}
              onChange=${(e) => change(p, e.target.value)}>
              ${Object.entries(ROLES).map(([k, label]) => html`<option value=${k}>${label}</option>`)}
            </select>
          </div>
        `,
      )}
    </div>
  `;
}
