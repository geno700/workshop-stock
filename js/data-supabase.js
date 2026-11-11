// Live data source: Supabase (Postgres + logins). Same API as data-demo.js.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { config } from '../config.js';

// A password-reset link brings the person back with this marker in the address.
let recovery = location.hash.includes('type=recovery');

const sb = createClient(config.supabaseUrl, config.supabaseAnonKey);

const ok = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

// The workshop the person is working in. Every query below is limited to it.
let ws = null;
const here = () => {
  if (!ws) throw new Error('Choose a workshop first');
  return ws;
};

const ITEM_SEL = '*, location:locations(name), supplier:suppliers(name, phone)';
const MOVE_SEL = '*, item:items(name, unit, unit_cost), user:profiles(full_name, email), project:projects(name)';

const flatItem = (r) =>
  r && {
    ...r,
    location_name: r.location?.name ?? '',
    supplier_name: r.supplier?.name ?? '',
    supplier_phone: r.supplier?.phone ?? '',
    quantity: Number(r.quantity),
    min_quantity: Number(r.min_quantity),
    unit_cost: Number(r.unit_cost),
    specs: r.specs ?? {},
  };

const flatMove = (m) => ({
  ...m,
  quantity: Number(m.quantity),
  delta: Number(m.delta),
  balance_after: Number(m.balance_after),
  item_name: m.item?.name ?? 'Deleted item',
  unit: m.item?.unit ?? '',
  unit_cost: Number(m.item?.unit_cost ?? 0),
  project_name: m.project?.name ?? '',
  user_name: m.user?.full_name || m.user?.email || 'Unknown',
});

async function ensureLocation(name) {
  const n = (name ?? '').trim();
  if (!n) return null;
  const found = ok(
    await sb.from('locations').select('id').eq('workshop_id', here()).ilike('name', n.replace(/[%_\\]/g, '\\$&')).limit(1),
  );
  if (found.length) return found[0].id;
  return ok(await sb.from('locations').insert({ name: n, workshop_id: here() }).select('id').single()).id;
}

export default {
  async getUser() {
    const { data } = await sb.auth.getSession();
    return data.session?.user ?? null;
  },
  onAuthChange(cb) {
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') recovery = true;
      setTimeout(cb, 0);
    });
    return () => data.subscription.unsubscribe();
  },
  async signIn(email, password) {
    ok(await sb.auth.signInWithPassword({ email, password }));
  },
  async signUp(email, password, fullName) {
    const data = ok(
      await sb.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName }, emailRedirectTo: location.origin + location.pathname },
      }),
    );
    return { needsConfirm: !data.session };
  },
  async signOut() {
    await sb.auth.signOut();
  },
  async getProfile() {
    const user = await this.getUser();
    if (!user) return null;
    return ok(await sb.from('profiles').select('*').eq('id', user.id).maybeSingle());
  },

  // Password reset: email a link, then set the new password after the link is opened.
  async sendPasswordReset(email) {
    ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }));
  },
  inRecovery: () => recovery,
  async setPassword(password) {
    ok(await sb.auth.updateUser({ password }));
    recovery = false;
  },

  // ---- workshops
  async listWorkshops() {
    const user = await this.getUser();
    if (!user) return [];
    const rows = ok(
      await sb.from('memberships').select('role, created_at, workshop:workshops(id, name, join_code)')
        .eq('user_id', user.id).order('created_at'),
    );
    return rows.filter((r) => r.workshop).map((r) => ({ ...r.workshop, role: r.role }));
  },
  useWorkshop(id) {
    ws = id;
  },
  async createWorkshop(name) {
    return ok(await sb.rpc('create_workshop', { p_name: name }));
  },
  async joinWorkshop(code) {
    return ok(await sb.rpc('join_workshop', { p_code: code }));
  },
  async renameWorkshop(name) {
    ok(await sb.from('workshops').update({ name: name.trim() }).eq('id', here()));
  },
  async newJoinCode() {
    return ok(await sb.rpc('new_join_code', { p_workshop: here() }));
  },
  async leaveWorkshop(id) {
    const user = await this.getUser();
    const gone = ok(await sb.from('memberships').delete().eq('workshop_id', id).eq('user_id', user.id).select('user_id'));
    if (!gone.length) throw new Error('An admin cannot leave their own workshop');
  },

  async listItems() {
    return ok(
      await sb.from('items').select(ITEM_SEL).eq('workshop_id', here()).eq('archived', false).order('name'),
    ).map(flatItem);
  },
  async getItem(id) {
    return flatItem(ok(await sb.from('items').select(ITEM_SEL).eq('workshop_id', here()).eq('id', id).maybeSingle()));
  },
  async saveItem(f) {
    const fields = {
      name: f.name, kind: f.kind, category: f.category, unit: f.unit, min_quantity: f.min_quantity,
      unit_cost: f.unit_cost, specs: f.specs, notes: f.notes, location_id: await ensureLocation(f.location_name),
      supplier_id: f.supplier_id || null,
    };
    const q = f.id
      ? sb.from('items').update(fields).eq('id', f.id)
      : sb.from('items').insert({ ...fields, workshop_id: here() });
    return flatItem(ok(await q.select(ITEM_SEL).single()));
  },
  async archiveItem(id) {
    ok(await sb.from('items').update({ archived: true }).eq('id', id));
  },
  async listLocations() {
    return ok(await sb.from('locations').select('id, name').eq('workshop_id', here()).order('name'));
  },

  async listProjects() {
    return ok(
      await sb.from('projects').select('*').eq('workshop_id', here()).order('created_at', { ascending: false }),
    );
  },
  async saveProject(f) {
    const fields = {};
    if (f.name !== undefined) fields.name = f.name.trim();
    if (f.status !== undefined) fields.status = f.status;
    const q = f.id
      ? sb.from('projects').update(fields).eq('id', f.id)
      : sb.from('projects').insert({ ...fields, workshop_id: here() });
    return ok(await q.select('*').single());
  },
  async listSuppliers() {
    return ok(await sb.from('suppliers').select('*').eq('workshop_id', here()).order('name'));
  },
  async saveSupplier(f) {
    const fields = { name: f.name, contact: f.contact, phone: f.phone, email: f.email, notes: f.notes };
    const q = f.id
      ? sb.from('suppliers').update(fields).eq('id', f.id)
      : sb.from('suppliers').insert({ ...fields, workshop_id: here() });
    return ok(await q.select('*').single());
  },
  async deleteSupplier(id) {
    ok(await sb.from('suppliers').delete().eq('id', id));
  },

  async recordMovement({ item_id, type, quantity, reason, project_id }) {
    return ok(
      await sb.rpc('record_movement', {
        p_item: item_id, p_type: type, p_quantity: Number(quantity), p_reason: reason ?? null,
        p_project: project_id || null,
      }),
    );
  },
  async renameLocation(id, name) {
    const { error } = await sb.from('locations').update({ name: name.trim() }).eq('id', id);
    if (error) throw new Error(error.code === '23505' ? 'A location with this name already exists' : error.message);
  },
  async deleteLocation(id) {
    ok(await sb.from('locations').delete().eq('id', id));
  },

  async listMovements({ item_id, types, project_id, with_project, limit = 200 } = {}) {
    let q = sb.from('movements').select(MOVE_SEL).eq('workshop_id', here())
      .order('created_at', { ascending: false }).limit(limit);
    if (item_id) q = q.eq('item_id', item_id);
    if (types) q = q.in('type', types);
    if (project_id) q = q.eq('project_id', project_id);
    if (with_project) q = q.not('project_id', 'is', null);
    return ok(await q).map(flatMove);
  },

  // ---- team of the current workshop
  async listProfiles() {
    const rows = ok(
      await sb.from('memberships').select('role, created_at, user:profiles(id, email, full_name)')
        .eq('workshop_id', here()).order('created_at'),
    );
    return rows.filter((r) => r.user).map((r) => ({ ...r.user, role: r.role, created_at: r.created_at }));
  },
  async setRole(id, role) {
    ok(await sb.from('memberships').update({ role }).eq('workshop_id', here()).eq('user_id', id));
  },
  async removeMember(id) {
    ok(await sb.from('memberships').delete().eq('workshop_id', here()).eq('user_id', id));
  },
};
