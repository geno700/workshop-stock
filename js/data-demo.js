// Demo data source: everything lives in this browser's localStorage.
// Mirrors the API of data-supabase.js so the rest of the app doesn't care which is in use.

const KEY = 'workshop-stock-demo-v3';
const ME = 'demo-user';

const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2);

const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

function seed() {
  const s = {
    profiles: [
      { id: ME, email: 'you@demo.local', full_name: 'You (demo)', role: 'admin', created_at: daysAgo(40) },
      { id: 'p2', email: 'sara@demo.local', full_name: 'Sara', role: 'member', created_at: daysAgo(30) },
      { id: 'p3', email: 'omar@demo.local', full_name: 'Omar', role: 'viewer', created_at: daysAgo(12) },
      { id: 'p4', email: 'new.person@demo.local', full_name: 'New person', role: 'pending', created_at: daysAgo(1) },
    ],
    locations: [],
    items: [],
    movements: [],
    projects: [
      { id: 'pr1', name: 'Conveyor build', status: 'active', notes: '', created_at: daysAgo(20) },
      { id: 'pr2', name: 'Student kits', status: 'active', notes: '', created_at: daysAgo(10) },
      { id: 'pr3', name: 'Machine enclosure', status: 'done', notes: '', created_at: daysAgo(30) },
    ],
    suppliers: [
      { id: 'su1', name: 'Delta Metals', contact: 'Hany', phone: '+20 100 000 0001', email: 'sales@deltametals.example', notes: '', created_at: daysAgo(40) },
      { id: 'su2', name: 'RoboParts', contact: 'Mona', phone: '+20 100 000 0002', email: 'orders@roboparts.example', notes: 'Ships in 3 days', created_at: daysAgo(40) },
    ],
  };
  const SUPPLIER = { 'Sheet metal': 'su1', 'Bar stock': 'su1', Motors: 'su2', Controllers: 'su2', Bearings: 'su2' };
  const PROJECT = {
    'Enclosure panels': 'pr3', 'Machine guard': 'pr3', 'Shafts for conveyor': 'pr1', 'Frame assembly': 'pr1',
    'Frame welding': 'pr1', 'Student kits': 'pr2', 'Sorting demo': 'pr2',
  };
  const loc = (name) => {
    let l = s.locations.find((x) => x.name === name);
    if (!l) s.locations.push((l = { id: uid(), name }));
    return l.id;
  };
  const add = (f, qty, moves = []) => {
    const item = {
      id: uid(), archived: false, notes: '', specs: {}, min_quantity: 0, unit_cost: 0, category: '',
      ...f, location_id: loc(f.location), supplier_id: SUPPLIER[f.category] ?? null, quantity: 0,
      created_at: daysAgo(35), updated_at: daysAgo(35),
    };
    delete item.location;
    s.items.push(item);
    const mv = (type, q, reason, who, d) => {
      const delta = type === 'out' || type === 'checkout' ? -q : q;
      item.quantity += delta;
      s.movements.push({
        id: uid(), item_id: item.id, type, quantity: q, delta, balance_after: item.quantity,
        reason, project_id: type === 'out' ? PROJECT[reason] ?? null : null, user_id: who, created_at: daysAgo(d),
      });
    };
    mv('in', qty, 'Initial stock', ME, 35);
    moves.forEach((m) => mv(...m));
  };

  add({ name: 'Aluminium sheet 6061', kind: 'raw', category: 'Sheet metal', unit: 'sheet', min_quantity: 3, unit_cost: 85,
    location: 'Rack A', specs: { grade: '6061-T6', dimensions: '2000 × 1000 × 3 mm' } }, 8,
    [['out', 2, 'Enclosure panels', 'p2', 9], ['out', 1, 'Bracket prototypes', ME, 2]]);
  add({ name: 'Mild steel round bar Ø20', kind: 'raw', category: 'Bar stock', unit: 'm', min_quantity: 6, unit_cost: 4.5,
    location: 'Rack A', specs: { grade: 'S235', dimensions: 'Ø20 mm' } }, 18,
    [['out', 7.5, 'Shafts for conveyor', 'p2', 6], ['out', 6, 'Jig pins', ME, 1]]);
  add({ name: 'Acrylic sheet clear', kind: 'raw', category: 'Plastic sheet', unit: 'sheet', min_quantity: 2, unit_cost: 42,
    location: 'Rack B', specs: { grade: 'PMMA cast', dimensions: '1220 × 610 × 5 mm' } }, 6,
    [['out', 1, 'Machine guard', 'p2', 4]]);
  add({ name: 'PLA filament black 1.75', kind: 'raw', category: 'Filament', unit: 'kg', min_quantity: 2, unit_cost: 19,
    location: 'Rack B', specs: { grade: 'PLA', dimensions: '1.75 mm' } }, 5,
    [['out', 1.4, 'Sensor housings', ME, 8], ['out', 2.1, 'Gripper fingers', 'p2', 3]]);
  add({ name: 'NEMA 17 stepper motor', kind: 'component', category: 'Motors', unit: 'pcs', min_quantity: 4, unit_cost: 11,
    location: 'Drawer cabinet', specs: { part_no: '17HS4401', spec: '1.7 A, 40 N·cm' } }, 12,
    [['out', 3, 'XY table build', 'p2', 10]]);
  add({ name: 'Arduino Nano', kind: 'component', category: 'Controllers', unit: 'pcs', min_quantity: 3, unit_cost: 6.5,
    location: 'Drawer cabinet', specs: { part_no: 'A000005', spec: 'ATmega328P' } }, 6,
    [['out', 2, 'Sorting demo', ME, 7], ['out', 2, 'Student kits', 'p2', 2]]);
  add({ name: 'M5 × 16 socket cap screw', kind: 'component', category: 'Fasteners', unit: 'pcs', min_quantity: 100, unit_cost: 0.05,
    location: 'Drawer cabinet', specs: { part_no: 'DIN 912', spec: 'A2 stainless' } }, 500,
    [['out', 64, 'Frame assembly', 'p2', 5]]);
  add({ name: 'Bearing 608ZZ', kind: 'component', category: 'Bearings', unit: 'pcs', min_quantity: 10, unit_cost: 0.8,
    location: 'Drawer cabinet', specs: { part_no: '608ZZ', spec: '8 × 22 × 7 mm' } }, 40);
  add({ name: 'Cutting disc 125 mm', kind: 'consumable', category: 'Abrasives', unit: 'pcs', min_quantity: 10, unit_cost: 1.2,
    location: 'Tool wall', specs: { spec: '1.0 mm, inox' } }, 25,
    [['out', 9, 'Weekly use', 'p2', 6], ['out', 8, 'Weekly use', 'p2', 1]]);
  add({ name: 'Welding wire ER70S-6 0.8', kind: 'consumable', category: 'Welding', unit: 'kg', min_quantity: 5, unit_cost: 3.4,
    location: 'Chemical cabinet', specs: { spec: '15 kg spool' } }, 30,
    [['out', 6, 'Frame welding', ME, 11]]);
  add({ name: 'Digital caliper 150 mm', kind: 'tool', category: 'Measuring', unit: 'pcs', min_quantity: 1, unit_cost: 35,
    location: 'Tool wall', specs: { serial: 'CAL-003', condition: 'Good' } }, 3,
    [['checkout', 1, 'Shaft inspection', 'p2', 3]]);
  add({ name: 'Cordless drill 18 V', kind: 'tool', category: 'Power tools', unit: 'pcs', min_quantity: 1, unit_cost: 140,
    location: 'Tool wall', specs: { serial: 'DRL-01', condition: 'Good' } }, 2);
  return s;
}

let state;
try {
  const raw = localStorage.getItem(KEY);
  state = raw ? JSON.parse(raw) : null;
} catch {
  state = null;
}
if (!state) state = seed();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Storage blocked or full: keep working from memory for this visit.
  }
}
persist();

const copy = (o) => JSON.parse(JSON.stringify(o));
const locName = (id) => state.locations.find((l) => l.id === id)?.name ?? '';
const flatItem = (i) => {
  const s = state.suppliers.find((x) => x.id === i.supplier_id);
  return { ...copy(i), location_name: locName(i.location_id), supplier_name: s?.name ?? '', supplier_phone: s?.phone ?? '' };
};
const person = (id) => {
  const p = state.profiles.find((x) => x.id === id);
  return p ? p.full_name || p.email : 'Unknown';
};
const flatMove = (m) => {
  const item = state.items.find((i) => i.id === m.item_id);
  return {
    ...m, item_name: item?.name ?? 'Deleted item', unit: item?.unit ?? '', unit_cost: item?.unit_cost ?? 0,
    user_name: person(m.user_id), project_name: state.projects.find((p) => p.id === m.project_id)?.name ?? '',
  };
};

function ensureLocation(name) {
  const n = (name ?? '').trim();
  if (!n) return null;
  let l = state.locations.find((x) => x.name.toLowerCase() === n.toLowerCase());
  if (!l) state.locations.push((l = { id: uid(), name: n }));
  return l.id;
}

export default {
  async getUser() {
    return { id: ME, email: 'you@demo.local' };
  },
  onAuthChange() {
    return () => {};
  },
  async signIn() {},
  async signUp() {
    return { needsConfirm: false };
  },
  async signOut() {},
  async getProfile() {
    return copy(state.profiles.find((p) => p.id === ME));
  },

  async listItems() {
    return state.items.filter((i) => !i.archived).map(flatItem).sort((a, b) => a.name.localeCompare(b.name));
  },
  async getItem(id) {
    const i = state.items.find((x) => x.id === id);
    return i ? flatItem(i) : null;
  },
  async saveItem(f) {
    const fields = {
      name: f.name, kind: f.kind, category: f.category, unit: f.unit, min_quantity: f.min_quantity,
      unit_cost: f.unit_cost, specs: f.specs, notes: f.notes, location_id: ensureLocation(f.location_name),
      supplier_id: f.supplier_id || null, updated_at: new Date().toISOString(),
    };
    let item;
    if (f.id) {
      item = state.items.find((x) => x.id === f.id);
      if (!item) throw new Error('Item not found');
      Object.assign(item, fields);
    } else {
      item = { id: uid(), quantity: 0, archived: false, created_at: new Date().toISOString(), ...fields };
      state.items.push(item);
    }
    persist();
    return flatItem(item);
  },
  async archiveItem(id) {
    const item = state.items.find((x) => x.id === id);
    if (item) item.archived = true;
    persist();
  },
  async listLocations() {
    return copy(state.locations).sort((a, b) => a.name.localeCompare(b.name));
  },

  async listProjects() {
    return copy(state.projects).sort((a, b) => b.created_at.localeCompare(a.created_at));
  },
  async saveProject(f) {
    let p = state.projects.find((x) => x.id === f.id);
    if (!p) state.projects.push((p = { id: uid(), status: 'active', notes: '', created_at: new Date().toISOString() }));
    if (f.name !== undefined) p.name = f.name.trim();
    if (f.status !== undefined) p.status = f.status;
    persist();
    return copy(p);
  },
  async listSuppliers() {
    return copy(state.suppliers).sort((a, b) => a.name.localeCompare(b.name));
  },
  async saveSupplier(f) {
    let s = state.suppliers.find((x) => x.id === f.id);
    if (!s) state.suppliers.push((s = { id: uid(), created_at: new Date().toISOString() }));
    Object.assign(s, { name: f.name, contact: f.contact, phone: f.phone, email: f.email, notes: f.notes });
    persist();
    return copy(s);
  },
  async deleteSupplier(id) {
    state.suppliers = state.suppliers.filter((s) => s.id !== id);
    state.items.forEach((i) => {
      if (i.supplier_id === id) i.supplier_id = null;
    });
    persist();
  },

  async recordMovement({ item_id, type, quantity, reason, project_id }) {
    const item = state.items.find((x) => x.id === item_id);
    if (!item) throw new Error('Item not found');
    const q = Number(quantity);
    if (!Number.isFinite(q) || q < 0) throw new Error('Quantity must be zero or more');
    let delta;
    if (type === 'adjust') delta = q - item.quantity;
    else {
      if (q === 0) throw new Error('Quantity must be more than zero');
      delta = type === 'in' || type === 'return' ? q : -q;
    }
    const balance = Math.round((item.quantity + delta) * 1e6) / 1e6;
    if (balance < 0) throw new Error(`Not enough stock: only ${item.quantity} ${item.unit} available`);
    item.quantity = balance;
    item.updated_at = new Date().toISOString();
    const row = {
      id: uid(), item_id, type, quantity: q, delta: Math.round(delta * 1e6) / 1e6, balance_after: balance,
      reason: (reason ?? '').trim() || null, project_id: project_id || null, user_id: ME,
      created_at: new Date().toISOString(),
    };
    state.movements.push(row);
    persist();
    return flatMove(row);
  },
  async renameLocation(id, name) {
    const n = name.trim();
    if (state.locations.some((l) => l.id !== id && l.name.toLowerCase() === n.toLowerCase())) {
      throw new Error('A location with this name already exists');
    }
    const l = state.locations.find((x) => x.id === id);
    if (l) l.name = n;
    persist();
  },
  async deleteLocation(id) {
    state.locations = state.locations.filter((l) => l.id !== id);
    state.items.forEach((i) => {
      if (i.location_id === id) i.location_id = null;
    });
    persist();
  },

  async listMovements({ item_id, types, project_id, with_project, limit = 200 } = {}) {
    return state.movements
      .filter(
        (m) =>
          (!item_id || m.item_id === item_id) &&
          (!types || types.includes(m.type)) &&
          (!project_id || m.project_id === project_id) &&
          (!with_project || m.project_id),
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, limit)
      .map(flatMove);
  },

  async listProfiles() {
    return copy(state.profiles).sort((a, b) => a.created_at.localeCompare(b.created_at));
  },
  async setRole(id, role) {
    const p = state.profiles.find((x) => x.id === id);
    if (p) p.role = role;
    persist();
  },

  resetDemo() {
    state = seed();
    persist();
  },
};
