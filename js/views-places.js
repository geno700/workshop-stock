// Locations page and printable QR labels.
import { html, useState } from './lib.js';
import { db } from './data.js';
import { appBase, toast, useLoad } from './ui.js';

const QR_LIB = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm';

export function Locations({ me }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [locations, items] = await Promise.all([db.listLocations(), db.listItems()]);
    const counts = {};
    items.forEach((i) => {
      if (i.location_id) counts[i.location_id] = (counts[i.location_id] ?? 0) + 1;
    });
    return { locations, counts, unplaced: items.filter((i) => !i.location_id).length };
  });

  if (loading) return html`<p class="state">Loading…</p>`;
  if (error) return html`<p class="state">Something went wrong: ${error.message}</p>`;
  const { locations, counts, unplaced } = data;

  async function rename(loc) {
    const name = prompt('New name for this location', loc.name);
    if (!name || !name.trim() || name.trim() === loc.name) return;
    try {
      await db.renameLocation(loc.id, name);
      toast('Location renamed');
    } catch (err) {
      toast(err.message, true);
    }
    reload();
  }

  async function remove(loc) {
    const n = counts[loc.id] ?? 0;
    const warn = n ? ` Its ${n} item${n === 1 ? '' : 's'} will be left without a location.` : '';
    if (!confirm(`Delete the location "${loc.name}"?${warn}`)) return;
    try {
      await db.deleteLocation(loc.id);
      toast('Location deleted');
    } catch (err) {
      toast(err.message, true);
    }
    reload();
  }

  return html`
    <a class="back" href="#/items">← Items</a>
    <div class="page-head">
      <h1>Locations</h1>
      <a class="btn" href="#/labels/locations">QR labels</a>
    </div>
    <p class="muted" style="margin-bottom:14px">
      Locations are created when you type a new one on an item. Open a location to see what is stored there.
      ${unplaced > 0 && ` ${unplaced} item${unplaced === 1 ? ' has' : 's have'} no location.`}
    </p>
    <div class="card list">
      ${locations.length
        ? locations.map(
            (l) => html`
              <div class="row" key=${l.id}>
                <a class="main" href=${'#/locations/' + l.id}>
                  <div class="title">${l.name}</div>
                  <div class="sub">${counts[l.id] ?? 0} item${(counts[l.id] ?? 0) === 1 ? '' : 's'}</div>
                </a>
                ${me.canEdit && html`<button class="btn small" onClick=${() => rename(l)}>Rename</button>`}
                ${me.isAdmin && html`<button class="btn small danger" onClick=${() => remove(l)}>Delete</button>`}
              </div>
            `,
          )
        : html`<p class="empty">No locations yet.</p>`}
    </div>
  `;
}

// Draws a QR code as an SVG, always black on white so it scans in dark mode and on paper.
function QR({ make, text }) {
  const qr = make(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  const box = `-2 -2 ${n + 4} ${n + 4}`;
  return html`
    <svg viewBox=${box} shape-rendering="crispEdges" role="img" aria-label="QR code">
      <rect x="-2" y="-2" width=${n + 4} height=${n + 4} fill="#fff" />
      <path d=${d} fill="#000" />
    </svg>
  `;
}

export function Labels({ preselect, startMode = 'items' }) {
  const { data, error, loading } = useLoad(async () => {
    const [items, locations, lib] = await Promise.all([db.listItems(), db.listLocations(), import(QR_LIB)]);
    return { items, locations, make: lib.default };
  });
  const [mode, setMode] = useState(startMode);
  const [picked, setPicked] = useState(() => new Set(preselect ? [preselect] : []));
  const [q, setQ] = useState('');
  const [size, setSize] = useState('m');

  if (loading) return html`<p class="state">Loading…</p>`;
  if (error) return html`<p class="state">Could not load the label tools: ${error.message}</p>`;

  const base = appBase();
  const all =
    mode === 'items'
      ? data.items.map((i) => ({
          id: i.id,
          name: i.name,
          sub: [i.location_name, i.specs?.part_no || i.specs?.dimensions || i.specs?.serial].filter(Boolean).join(' · '),
          url: base + '#/items/' + i.id,
        }))
      : data.locations.map((l) => ({ id: l.id, name: l.name, sub: 'Location', url: base + '#/locations/' + l.id }));

  const needle = q.trim().toLowerCase();
  const shown = all.filter((x) => !needle || (x.name + ' ' + x.sub).toLowerCase().includes(needle));
  const chosen = all.filter((x) => picked.has(x.id));

  const toggle = (id) => {
    const next = new Set(picked);
    next.has(id) ? next.delete(id) : next.add(id);
    setPicked(next);
  };
  const switchMode = (m) => {
    setMode(m);
    setPicked(new Set());
    setQ('');
  };
  const chip = (on, label, onClick) => html`<button class=${'chip' + (on ? ' on' : '')} onClick=${onClick}>${label}</button>`;

  return html`
    <div class="no-print">
      <a class="back" href="#/items">← Items</a>
      <div class="page-head">
        <h1>QR labels</h1>
        <button class="btn primary" disabled=${!chosen.length} onClick=${() => print()}>
          Print ${chosen.length} label${chosen.length === 1 ? '' : 's'}
        </button>
      </div>
      <p class="muted" style="margin-bottom:14px">
        Stick a label on a shelf, bin or part. Scanning it with a phone camera opens that item or location in the app.
      </p>
      <div class="filters">
        <div class="chips">
          ${chip(mode === 'items', 'Items', () => switchMode('items'))}
          ${chip(mode === 'locations', 'Locations', () => switchMode('locations'))}
        </div>
        <div class="chips">
          ${chip(size === 's', 'Small', () => setSize('s'))} ${chip(size === 'm', 'Medium', () => setSize('m'))}
          ${chip(size === 'l', 'Large', () => setSize('l'))}
        </div>
      </div>
      <div class="filters">
        <input type="search" placeholder="Search" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <button class="btn" onClick=${() => setPicked(new Set([...picked, ...shown.map((x) => x.id)]))}>Select all shown</button>
        <button class="btn" disabled=${!picked.size} onClick=${() => setPicked(new Set())}>Clear</button>
      </div>
      <div class="card list pick">
        ${shown.length
          ? shown.map(
              (x) => html`
                <label class="row" key=${x.id}>
                  <input type="checkbox" checked=${picked.has(x.id)} onChange=${() => toggle(x.id)} />
                  <div class="main">
                    <div class="title">${x.name}</div>
                    <div class="sub">${x.sub}</div>
                  </div>
                </label>
              `,
            )
          : html`<p class="empty">Nothing to show.</p>`}
      </div>
      ${chosen.length > 0 && html`<h2 style="margin:22px 0 10px">Preview</h2>`}
    </div>

    <div class=${'labels ' + size}>
      ${chosen.map(
        (x) => html`
          <div class="label" key=${x.id}>
            <${QR} make=${data.make} text=${x.url} />
            <div class="label-text">
              <div class="label-name">${x.name}</div>
              <div class="label-sub">${x.sub}</div>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}
