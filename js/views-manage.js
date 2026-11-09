// Projects, suppliers and CSV import.
import { html, useState } from './lib.js';
import { db } from './data.js';
import { KINDS, UNITS, fmtNum, fmtMoney, moveCost, go, toast, useLoad, parseCSV, toCSV, download } from './ui.js';
import { MovementList, exportMoves } from './views-other.js';
import { ITEM_CSV } from './views-items.js';

const Loading = () => html`<p class="state">Loading…</p>`;
const Failed = ({ error }) => html`<p class="state">Something went wrong: ${error.message}</p>`;

// ---------------------------------------------------------------- projects

export function Projects({ me }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [projects, moves] = await Promise.all([db.listProjects(), db.listMovements({ with_project: true, limit: 2000 })]);
    const cost = {};
    moves.forEach((m) => {
      // An undone withdrawal comes back as an 'in' on the same project, so it cancels out.
      const sign = m.type === 'out' ? 1 : m.type === 'in' ? -1 : 0;
      cost[m.project_id] = (cost[m.project_id] ?? 0) + sign * moveCost(m);
    });
    return { projects, cost };
  });
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  const { projects, cost } = data;

  async function add(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await db.saveProject({ name });
      setName('');
      toast('Project added');
    } catch (err) {
      toast(err.message, true);
    }
    setBusy(false);
    reload();
  }

  const row = (p) => html`
    <a class="row" href=${'#/projects/' + p.id} key=${p.id}>
      <div class="main">
        <div class="title">${p.name} ${p.status === 'done' && html`<span class="badge">Done</span>`}</div>
        <div class="sub">Material used</div>
      </div>
      <div class="qty">${fmtMoney(cost[p.id] ?? 0)}</div>
    </a>
  `;
  const active = projects.filter((p) => p.status === 'active');
  const done = projects.filter((p) => p.status !== 'active');

  return html`
    <div class="page-head"><h1>Projects</h1></div>
    <p class="muted" style="margin-bottom:14px">
      When you take stock you can pick a project. Each project then shows the material it used and what it cost.
    </p>
    ${me.canEdit &&
    html`<form class="filters" onSubmit=${add}>
      <input placeholder="New project or job name" value=${name} onInput=${(e) => setName(e.target.value)} style="flex:1 1 220px" />
      <button class="btn primary" disabled=${busy || !name.trim()}>Add project</button>
    </form>`}
    <div class="card list">
      ${active.length ? active.map(row) : html`<p class="empty">No active projects.</p>`}
    </div>
    ${done.length > 0 &&
    html`<div class="section">
      <h2>Finished</h2>
      <div class="card list">${done.map(row)}</div>
    </div>`}
  `;
}

export function ProjectDetail({ me, id }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [projects, moves] = await Promise.all([db.listProjects(), db.listMovements({ project_id: id, limit: 1000 })]);
    return { project: projects.find((p) => p.id === id), moves };
  }, [id]);

  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  const { project, moves } = data;
  if (!project) return html`<p class="state">This project does not exist. <a href="#/projects"><u>Back to projects</u></a></p>`;

  const used = {};
  moves
    .filter((m) => m.type === 'out' || m.type === 'in')
    .forEach((m) => {
      const sign = m.type === 'out' ? 1 : -1;
      const u = (used[m.item_id] ??= { id: m.item_id, name: m.item_name, unit: m.unit, quantity: 0, cost: 0 });
      u.quantity = Math.round((u.quantity + sign * Number(m.quantity)) * 1e6) / 1e6;
      u.cost += sign * moveCost(m);
    });
  const lines = Object.values(used).filter((l) => l.quantity > 0).sort((a, b) => b.cost - a.cost);
  const total = lines.reduce((sum, l) => sum + l.cost, 0);

  async function update(fields, message) {
    try {
      await db.saveProject({ id, ...fields });
      toast(message);
    } catch (err) {
      toast(err.message, true);
    }
    reload();
  }
  function rename() {
    const name = prompt('Project name', project.name);
    if (name && name.trim() && name.trim() !== project.name) update({ name }, 'Project renamed');
  }

  return html`
    <a class="back" href="#/projects">← Projects</a>
    <div class="page-head">
      <h1>${project.name} ${project.status === 'done' && html`<span class="badge">Done</span>`}</h1>
      <div class="actions">
        <button class="btn" onClick=${() => exportMoves(moves, 'project-' + project.name.replace(/[^\w-]+/g, '-'))}>Export CSV</button>
        ${me.canEdit && html`<button class="btn" onClick=${rename}>Rename</button>`}
        ${me.canEdit &&
        (project.status === 'active'
          ? html`<button class="btn" onClick=${() => update({ status: 'done' }, 'Project marked as finished')}>Mark finished</button>`
          : html`<button class="btn" onClick=${() => update({ status: 'active' }, 'Project reopened')}>Reopen</button>`)}
      </div>
    </div>

    <div class="tiles" style="grid-template-columns:1fr 1fr">
      <div class="card tile"><div class="label">Material cost</div><div class="value">${fmtMoney(total)}</div></div>
      <div class="card tile"><div class="label">Different items used</div><div class="value">${lines.length}</div></div>
    </div>
    <p class="muted small" style="margin-top:8px">Costs use each item's current cost per unit.</p>

    <div class="section">
      <h2>Material used</h2>
      <div class="card list">
        ${lines.length
          ? lines.map(
              (l) => html`
                <a class="row" href=${'#/items/' + l.id} key=${l.id}>
                  <div class="main">
                    <div class="title">${l.name}</div>
                    <div class="sub">${fmtNum(l.quantity)} ${l.unit}</div>
                  </div>
                  <div class="qty">${fmtMoney(l.cost)}</div>
                </a>
              `,
            )
          : html`<p class="empty">Nothing taken for this project yet. Pick it when you take stock from an item.</p>`}
      </div>
    </div>

    <div class="section">
      <h2>Movements</h2>
      <div class="card"><${MovementList} moves=${moves} showItem=${true} /></div>
    </div>
  `;
}

// ---------------------------------------------------------------- suppliers

const NO_SUPPLIER = { name: '', contact: '', phone: '', email: '', notes: '' };

function SupplierDialog({ supplier, me, onClose, onDone }) {
  const [f, setF] = useState({ ...NO_SUPPLIER, ...supplier });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await db.saveSupplier({
        id: supplier.id, name: f.name.trim(), contact: (f.contact ?? '').trim(), phone: (f.phone ?? '').trim(),
        email: (f.email ?? '').trim(), notes: (f.notes ?? '').trim(),
      });
      toast('Supplier saved');
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  async function remove() {
    if (!confirm(`Delete the supplier "${supplier.name}"? Items keep their stock but lose this supplier.`)) return;
    try {
      await db.deleteSupplier(supplier.id);
      toast('Supplier deleted');
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }

  return html`
    <div class="overlay" onClick=${(e) => e.target === e.currentTarget && onClose()}>
      <form class="modal form" onSubmit=${submit}>
        <h2>${supplier.id ? 'Edit supplier' : 'Add supplier'}</h2>
        ${error && html`<p class="error">${error}</p>`}
        <label><span>Name</span><input required value=${f.name} onInput=${set('name')} /></label>
        <label><span>Contact person</span><input value=${f.contact ?? ''} onInput=${set('contact')} /></label>
        <div class="grid2">
          <label><span>Phone</span><input type="tel" value=${f.phone ?? ''} onInput=${set('phone')} /></label>
          <label><span>Email</span><input type="email" value=${f.email ?? ''} onInput=${set('email')} /></label>
        </div>
        <label><span>Notes</span><input value=${f.notes ?? ''} onInput=${set('notes')} placeholder="e.g. lead time, minimum order" /></label>
        <div class="actions">
          <button class="btn primary" disabled=${busy}>Save</button>
          <button type="button" class="btn" onClick=${onClose}>Cancel</button>
          ${supplier.id && me.isAdmin && html`<button type="button" class="btn danger" onClick=${remove}>Delete</button>`}
        </div>
      </form>
    </div>
  `;
}

export function Suppliers({ me }) {
  const { data, error, loading, reload } = useLoad(async () => {
    const [suppliers, items] = await Promise.all([db.listSuppliers(), db.listItems()]);
    const counts = {};
    items.forEach((i) => {
      if (i.supplier_id) counts[i.supplier_id] = (counts[i.supplier_id] ?? 0) + 1;
    });
    return { suppliers, counts };
  });
  const [editing, setEditing] = useState(null);

  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;
  const { suppliers, counts } = data;

  return html`
    <a class="back" href="#/items">← Items</a>
    <div class="page-head">
      <h1>Suppliers</h1>
      ${me.canEdit && html`<button class="btn primary" onClick=${() => setEditing({})}>Add supplier</button>`}
    </div>
    <div class="card list">
      ${suppliers.length
        ? suppliers.map(
            (s) => html`
              <div class="row" key=${s.id}>
                <div class="main">
                  <div class="title">${s.name}</div>
                  <div class="sub">
                    ${[s.contact, s.phone, s.email, `${counts[s.id] ?? 0} item${(counts[s.id] ?? 0) === 1 ? '' : 's'}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  ${s.notes && html`<div class="sub">${s.notes}</div>`}
                </div>
                ${me.canEdit && html`<button class="btn small" onClick=${() => setEditing(s)}>Edit</button>`}
              </div>
            `,
          )
        : html`<p class="empty">No suppliers yet. Add one, then choose it on an item.</p>`}
    </div>
    ${editing &&
    html`<${SupplierDialog} supplier=${editing} me=${me} onClose=${() => setEditing(null)}
      onDone=${() => { setEditing(null); reload(); }} />`}
  `;
}

// ---------------------------------------------------------------- CSV import

const SPEC_KEYS = ['grade', 'dimensions', 'part_no', 'spec', 'serial', 'condition'];

function readKind(value) {
  const v = (value ?? '').trim().toLowerCase();
  if (KINDS[v]) return v;
  const match = Object.entries(KINDS).find(([, k]) => k.label.toLowerCase() === v);
  return match ? match[0] : 'raw';
}
const readNum = (value) => {
  const n = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export function ImportItems({ me }) {
  const { data, error, loading } = useLoad(async () => {
    const [items, suppliers] = await Promise.all([db.listItems(), db.listSuppliers()]);
    return { existing: new Set(items.map((i) => i.name.trim().toLowerCase())), suppliers };
  });
  const [plan, setPlan] = useState(null);
  const [progress, setProgress] = useState(null);
  const [fileError, setFileError] = useState('');

  if (!me.canEdit) return html`<p class="state">You do not have permission to import items.</p>`;
  if (loading) return html`<${Loading} />`;
  if (error) return html`<${Failed} error=${error} />`;

  function template() {
    const example = ['Aluminium sheet 3 mm', 'raw', 'Sheet metal', 'sheet', 8, 3, 85, 'Rack A', '', '6061-T6', '2000 x 1000 x 3 mm', '', '', '', '', ''];
    download('stock-import-template.csv', toCSV(ITEM_CSV, [example]));
  }

  async function choose(e) {
    const file = e.target.files[0];
    setPlan(null);
    setFileError('');
    if (!file) return;
    try {
      const rows = parseCSV(await file.text());
      const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
      if (!head.includes('name')) throw new Error('The first row must contain column titles, including "name".');
      const seen = new Set(data.existing);
      const ready = [];
      let duplicates = 0;
      let unnamed = 0;
      rows.forEach((cells) => {
        const r = Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim()]));
        const key = (r.name ?? '').toLowerCase();
        if (!key) return void unnamed++;
        if (seen.has(key)) return void duplicates++;
        seen.add(key);
        ready.push({
          name: r.name,
          kind: readKind(r.type ?? r.kind),
          category: r.category ?? '',
          unit: r.unit || 'pcs',
          quantity: readNum(r.quantity),
          min_quantity: readNum(r.min_quantity),
          unit_cost: readNum(r.unit_cost),
          location_name: r.location ?? '',
          supplier: r.supplier ?? '',
          specs: Object.fromEntries(SPEC_KEYS.filter((k) => r[k]).map((k) => [k, r[k]])),
          notes: r.notes ?? '',
        });
      });
      setPlan({ ready, duplicates, unnamed });
    } catch (err) {
      setFileError(err.message);
    }
    e.target.value = '';
  }

  async function run() {
    const supplierIds = Object.fromEntries(data.suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]));
    let done = 0;
    setProgress(0);
    try {
      for (const row of plan.ready) {
        let supplier_id = null;
        const sKey = row.supplier.toLowerCase();
        if (sKey) {
          supplier_id = supplierIds[sKey] ??= (await db.saveSupplier({ name: row.supplier, contact: '', phone: '', email: '', notes: '' })).id;
        }
        const saved = await db.saveItem({ ...row, supplier_id });
        if (row.quantity > 0) {
          await db.recordMovement({ item_id: saved.id, type: 'in', quantity: row.quantity, reason: 'Imported from CSV' });
        }
        setProgress(++done);
      }
      toast(`${done} item${done === 1 ? '' : 's'} imported`);
      go('/items');
    } catch (err) {
      setProgress(null);
      setPlan(null);
      setFileError(`Stopped after ${done} item${done === 1 ? '' : 's'}: ${err.message}`);
    }
  }

  return html`
    <a class="back" href="#/items">← Items</a>
    <div class="page-head"><h1>Import items from CSV</h1></div>
    <div class="card pad form">
      <p class="muted">
        Use a spreadsheet saved as CSV. The first row must be column titles. Only <strong>name</strong> is required;
        the others are ${ITEM_CSV.slice(1).join(', ')}. Type is one of: ${Object.keys(KINDS).join(', ')}. Common units:
        ${UNITS.join(', ')}.
      </p>
      <div class="actions">
        <button class="btn" onClick=${template}>Download template</button>
      </div>
      <label><span>CSV file</span><input type="file" accept=".csv,text/csv" onChange=${choose} disabled=${progress !== null} /></label>
      ${fileError && html`<p class="error">${fileError}</p>`}
      ${plan &&
      html`<div class="form">
        <p>
          <strong>${plan.ready.length}</strong> new item${plan.ready.length === 1 ? '' : 's'} ready to import.
          ${plan.duplicates > 0 && ` ${plan.duplicates} skipped because an item with that name already exists.`}
          ${plan.unnamed > 0 && ` ${plan.unnamed} skipped because the name is empty.`}
        </p>
        ${plan.ready.length > 0 &&
        html`<div class="card list">
          ${plan.ready.slice(0, 5).map(
            (r) => html`<div class="row">
              <div class="main">
                <div class="title">${r.name}</div>
                <div class="sub">${[KINDS[r.kind].label, r.category, r.location_name, r.supplier].filter(Boolean).join(' · ')}</div>
              </div>
              <div class="qty">${fmtNum(r.quantity)} <small>${r.unit}</small></div>
            </div>`,
          )}
          ${plan.ready.length > 5 && html`<p class="empty">and ${plan.ready.length - 5} more</p>`}
        </div>`}
        <div class="actions">
          <button class="btn primary" disabled=${!plan.ready.length || progress !== null} onClick=${run}>
            ${progress !== null ? `Importing ${progress} of ${plan.ready.length}…` : `Import ${plan.ready.length} items`}
          </button>
        </div>
      </div>`}
    </div>
  `;
}
