// Dashboard, item list, item detail (with stock in/out) and the item form.
import { html, useState, useMemo } from './lib.js';
import { db } from './data.js';
import { KINDS, UNITS, fmtNum, fmtMoney, isLow, go, toast, useLoad } from './ui.js';
import { MovementList } from './views-other.js';

const Loading = () => html`<p class="state">Loading…</p>`;
const Failed = ({ error }) => html`<p class="state">Something went wrong: ${error.message}</p>`;

function ItemRow({ item }) {
  const sub = [KINDS[item.kind]?.label, item.category, item.location_name].filter(Boolean).join(' · ');
  return html`
    <a class="row" href=${'#/items/' + item.id}>
      <div class="main">
        <div class="title">${item.name} ${isLow(item) && html`<span class="badge low">Low</span>`}</div>
        <div class="sub">${sub}</div>
      </div>
      <div class="qty">
        ${fmtNum(item.quantity)} <small>${item.unit}</small>
        ${item.min_quantity > 0 && html`<span class="min">min ${fmtNum(item.min_quantity)}</span>`}
      </div>
    </a>
  `;
}

export function Dashboard({ me }) {
  const { data, error, loading } = useLoad(async () => {
    const [items, moves] = await Promise.all([db.listItems(), db.listMovements({ limit: 200 })]);
    return { items, moves };
  });
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;

  const { items, moves } = data;
  const low = items.filter(isLow);
  const value = items.reduce((sum, i) => sum + i.quantity * i.unit_cost, 0);
  const weekAgo = Date.now() - 7 * 86400000;
  const recent = moves.filter((m) => new Date(m.created_at).getTime() >= weekAgo).length;

  return html`
    <div class="page-head">
      <h1>Dashboard</h1>
      ${me.canEdit && html`<a class="btn primary" href="#/items/new">Add item</a>`}
    </div>
    <div class="tiles">
      <div class="card tile"><div class="label">Items</div><div class="value">${fmtNum(items.length)}</div></div>
      <div class=${'card tile' + (low.length ? ' alert' : '')}>
        <div class="label">Low stock</div><div class="value">${fmtNum(low.length)}</div>
      </div>
      <div class="card tile"><div class="label">Stock value</div><div class="value">${fmtMoney(value)}</div></div>
      <div class="card tile"><div class="label">Movements, last 7 days</div><div class="value">${fmtNum(recent)}</div></div>
    </div>

    <div class="section">
      <h2>Needs reordering</h2>
      <div class="card list">
        ${low.length
          ? low.map((i) => html`<${ItemRow} item=${i} key=${i.id} />`)
          : html`<p class="empty">Nothing is below its minimum level.</p>`}
      </div>
    </div>

    <div class="section">
      <h2>Recent activity</h2>
      <div class="card"><${MovementList} moves=${moves.slice(0, 8)} showItem=${true} /></div>
    </div>
  `;
}

export function Items({ me }) {
  const { data: items, error, loading } = useLoad(() => db.listItems());
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (items ?? []).filter((i) => {
      if (kind && i.kind !== kind) return false;
      if (lowOnly && !isLow(i)) return false;
      if (!needle) return true;
      const hay = [i.name, i.category, i.location_name, i.notes, ...Object.values(i.specs ?? {})].join(' ').toLowerCase();
      return hay.includes(needle);
    });
  }, [items, q, kind, lowOnly]);

  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;

  const chip = (value, label) =>
    html`<button class=${'chip' + (kind === value ? ' on' : '')} onClick=${() => setKind(value)}>${label}</button>`;

  return html`
    <div class="page-head">
      <h1>Items</h1>
      ${me.canEdit && html`<a class="btn primary" href="#/items/new">Add item</a>`}
    </div>
    <div class="filters">
      <input type="search" placeholder="Search name, category, location, specs" value=${q} onInput=${(e) => setQ(e.target.value)} />
      <div class="chips">
        ${chip('', 'All')} ${Object.entries(KINDS).map(([k, v]) => chip(k, v.label))}
        <button class=${'chip' + (lowOnly ? ' on' : '')} onClick=${() => setLowOnly(!lowOnly)}>Low stock only</button>
      </div>
    </div>
    <div class="card list">
      ${shown.length
        ? shown.map((i) => html`<${ItemRow} item=${i} key=${i.id} />`)
        : html`<p class="empty">${items.length ? 'No items match these filters.' : 'No items yet. Add your first one.'}</p>`}
    </div>
    <p class="muted small" style="margin-top:10px">${shown.length} of ${items.length} items</p>
  `;
}

const MOVE_FORMS = {
  in: { title: 'Add stock', field: 'Quantity to add', button: 'Add stock', placeholder: 'e.g. delivery, purchase' },
  out: { title: 'Take stock', field: 'Quantity to take', button: 'Take stock', placeholder: 'e.g. project or job name' },
  adjust: { title: 'Recount', field: 'Counted quantity now', button: 'Save count', placeholder: 'e.g. stock take' },
};

function MovementDialog({ item, type, onClose, onDone }) {
  const cfg = MOVE_FORMS[type];
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await db.recordMovement({ item_id: item.id, type, quantity: Number(quantity), reason });
      toast('Stock updated');
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return html`
    <div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <form class="modal form" onSubmit=${submit}>
        <div>
          <h2>${cfg.title}</h2>
          <p class="muted small">${item.name}: ${fmtNum(item.quantity)} ${item.unit} in stock</p>
        </div>
        ${error && html`<p class="error">${error}</p>`}
        <label>
          <span>${cfg.field} (${item.unit})</span>
          <input type="number" inputmode="decimal" step="any" min="0" required autofocus
            value=${quantity} onInput=${(e) => setQuantity(e.target.value)} />
        </label>
        <label>
          <span>Reason (optional)</span>
          <input value=${reason} placeholder=${cfg.placeholder} onInput=${(e) => setReason(e.target.value)} />
        </label>
        <div class="actions">
          <button class="btn primary big" disabled=${busy}>${cfg.button}</button>
          <button type="button" class="btn big" onClick=${onClose}>Cancel</button>
        </div>
      </form>
    </div>
  `;
}

export function ItemDetail({ me, id }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [item, moves] = await Promise.all([db.getItem(id), db.listMovements({ item_id: id, limit: 100 })]);
    return { item, moves };
  }, [id]);
  const [dialog, setDialog] = useState(null);

  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  const { item, moves } = data;
  if (!item) return html`<p class="state">This item does not exist. <a href="#/items"><u>Back to items</u></a></p>`;

  async function archive() {
    if (!confirm(`Remove "${item.name}" from the list? Its history is kept.`)) return;
    try {
      await db.archiveItem(item.id);
      toast('Item removed');
      go('/items');
    } catch (err) {
      toast(err.message, true);
    }
  }

  const facts = [
    ['Type', KINDS[item.kind]?.label],
    ['Category', item.category],
    ['Location', item.location_name],
    ...(KINDS[item.kind]?.fields ?? []).map(([key, label]) => [label, item.specs?.[key]]),
    ['Unit cost', item.unit_cost > 0 ? fmtMoney(item.unit_cost) + ' per ' + item.unit : ''],
    ['Value in stock', item.unit_cost > 0 ? fmtMoney(item.unit_cost * item.quantity) : ''],
    ['Notes', item.notes],
  ].filter(([, v]) => v);

  return html`
    <a class="back" href="#/items">← Items</a>
    <div class="page-head">
      <h1>${item.name}</h1>
      ${me.canEdit &&
      html`<div class="actions">
        <a class="btn" href=${'#/items/' + item.id + '/edit'}>Edit</a>
        ${me.isAdmin && html`<button class="btn danger" onClick=${archive}>Remove</button>`}
      </div>`}
    </div>

    <div class="card pad">
      <div class="stock">
        <div>
          <div class="muted small">In stock</div>
          <div class="big">${fmtNum(item.quantity)} <small>${item.unit}</small></div>
        </div>
        <div class="muted small">
          ${isLow(item) && html`<span class="badge low">Low</span>${' '}`}
          ${item.min_quantity > 0 ? `Minimum ${fmtNum(item.min_quantity)} ${item.unit}` : 'No minimum set'}
        </div>
      </div>
      ${me.canEdit &&
      html`<div class="stock-actions">
        <button class="btn primary big" onClick=${() => setDialog('out')}>Take stock</button>
        <button class="btn big" onClick=${() => setDialog('in')}>Add stock</button>
        <button class="btn big" onClick=${() => setDialog('adjust')}>Recount</button>
      </div>`}
    </div>

    <div class="section">
      <h2>Details</h2>
      <div class="card pad">
        <dl class="facts">${facts.map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>
      </div>
    </div>

    <div class="section">
      <h2>History</h2>
      <div class="card"><${MovementList} moves=${moves} /></div>
    </div>

    ${dialog &&
    html`<${MovementDialog} item=${item} type=${dialog} onClose=${() => setDialog(null)}
      onDone=${() => { setDialog(null); reload(); }} />`}
  `;
}

const BLANK = { name: '', kind: 'raw', category: '', unit: 'pcs', min_quantity: '', unit_cost: '', location_name: '', specs: {}, notes: '' };

export function ItemForm({ me, id }) {
  const { data, error, loading } = useLoad(async () => {
    const [item, items, locations] = await Promise.all([id ? db.getItem(id) : null, db.listItems(), db.listLocations()]);
    return { item, locations, categories: [...new Set(items.map((i) => i.category).filter(Boolean))].sort() };
  }, [id]);
  const [f, setF] = useState(null);
  const [initial, setInitial] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  if (!me.canEdit) return html`<p class="state">You do not have permission to edit items.</p>`;
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  if (id && !data.item) return html`<p class="state">This item does not exist. <a href="#/items"><u>Back to items</u></a></p>`;

  const form = f ?? (data.item ? { ...BLANK, ...data.item, specs: { ...data.item.specs } } : BLANK);
  const set = (k) => (e) => setF({ ...form, [k]: e.target.value });
  const setSpec = (k) => (e) => setF({ ...form, specs: { ...form.specs, [k]: e.target.value } });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    try {
      const keep = Object.fromEntries(
        KINDS[form.kind].fields.map(([k]) => [k, (form.specs[k] ?? '').trim()]).filter(([, v]) => v),
      );
      const saved = await db.saveItem({
        id,
        name: form.name.trim(),
        kind: form.kind,
        category: form.category.trim(),
        unit: form.unit,
        min_quantity: Number(form.min_quantity) || 0,
        unit_cost: Number(form.unit_cost) || 0,
        location_name: form.location_name,
        specs: keep,
        notes: (form.notes ?? '').trim(),
      });
      if (!id && Number(initial) > 0) {
        await db.recordMovement({ item_id: saved.id, type: 'in', quantity: Number(initial), reason: 'Initial stock' });
      }
      toast(id ? 'Item saved' : 'Item added');
      go('/items/' + saved.id);
    } catch (err) {
      setFormError(err.message);
      setBusy(false);
    }
  }

  const back = id ? '#/items/' + id : '#/items';
  return html`
    <a class="back" href=${back}>← Back</a>
    <div class="page-head"><h1>${id ? 'Edit item' : 'Add item'}</h1></div>
    <form class="card pad form" onSubmit=${submit}>
      ${formError && html`<p class="error">${formError}</p>`}
      <label><span>Name</span><input required value=${form.name} onInput=${set('name')} placeholder="e.g. Aluminium sheet 3 mm" /></label>
      <div class="grid2">
        <label>
          <span>Type</span>
          <select value=${form.kind} onChange=${set('kind')}>
            ${Object.entries(KINDS).map(([k, v]) => html`<option value=${k}>${v.label}</option>`)}
          </select>
        </label>
        <label>
          <span>Category</span>
          <input value=${form.category} onInput=${set('category')} list="categories" placeholder="e.g. Sheet metal, Fasteners" />
          <datalist id="categories">${data.categories.map((c) => html`<option value=${c} />`)}</datalist>
        </label>
      </div>
      <div class="grid2">
        ${KINDS[form.kind].fields.map(
          ([k, label]) => html`<label><span>${label}</span><input value=${form.specs[k] ?? ''} onInput=${setSpec(k)} /></label>`,
        )}
      </div>
      <div class="grid2">
        <label>
          <span>Unit</span>
          <select value=${form.unit} onChange=${set('unit')}>
            ${[...new Set([...UNITS, form.unit])].map((u) => html`<option value=${u}>${u}</option>`)}
          </select>
        </label>
        <label>
          <span>Location</span>
          <input value=${form.location_name} onInput=${set('location_name')} list="locations" placeholder="e.g. Rack A, Drawer 3" />
          <datalist id="locations">${data.locations.map((l) => html`<option value=${l.name} />`)}</datalist>
        </label>
      </div>
      <div class="grid2">
        ${!id &&
        html`<label>
          <span>Quantity in stock now</span>
          <input type="number" inputmode="decimal" step="any" min="0" value=${initial} onInput=${(e) => setInitial(e.target.value)} />
        </label>`}
        <label>
          <span>Minimum level (alert when at or below)</span>
          <input type="number" inputmode="decimal" step="any" min="0" value=${form.min_quantity} onInput=${set('min_quantity')} />
        </label>
        <label>
          <span>Cost per unit</span>
          <input type="number" inputmode="decimal" step="any" min="0" value=${form.unit_cost} onInput=${set('unit_cost')} />
        </label>
      </div>
      <label><span>Notes</span><textarea value=${form.notes} onInput=${set('notes')}></textarea></label>
      <div class="actions">
        <button class="btn primary" disabled=${busy}>${id ? 'Save changes' : 'Add item'}</button>
        <a class="btn" href=${back}>Cancel</a>
      </div>
    </form>
  `;
}
