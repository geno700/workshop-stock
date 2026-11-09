// Live data source: Supabase (Postgres + logins). Same API as data-demo.js.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { config } from '../config.js';

const sb = createClient(config.supabaseUrl, config.supabaseAnonKey);

const ok = ({ data, error }) => {
  if (error) throw new Error(error.message);
  return data;
};

const ITEM_SEL = '*, location:locations(name)';
const MOVE_SEL = '*, item:items(name, unit), user:profiles(full_name, email)';

const flatItem = (r) =>
  r && {
    ...r,
    location_name: r.location?.name ?? '',
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
  user_name: m.user?.full_name || m.user?.email || 'Unknown',
});

async function ensureLocation(name) {
  const n = (name ?? '').trim();
  if (!n) return null;
  const found = ok(await sb.from('locations').select('id').ilike('name', n.replace(/[%_\\]/g, '\\$&')).limit(1));
  if (found.length) return found[0].id;
  return ok(await sb.from('locations').insert({ name: n }).select('id').single()).id;
}

export default {
  async getUser() {
    const { data } = await sb.auth.getSession();
    return data.session?.user ?? null;
  },
  onAuthChange(cb) {
    const { data } = sb.auth.onAuthStateChange(() => setTimeout(cb, 0));
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

  async listItems() {
    return ok(await sb.from('items').select(ITEM_SEL).eq('archived', false).order('name')).map(flatItem);
  },
  async getItem(id) {
    return flatItem(ok(await sb.from('items').select(ITEM_SEL).eq('id', id).maybeSingle()));
  },
  async saveItem(f) {
    const fields = {
      name: f.name, kind: f.kind, category: f.category, unit: f.unit, min_quantity: f.min_quantity,
      unit_cost: f.unit_cost, specs: f.specs, notes: f.notes, location_id: await ensureLocation(f.location_name),
    };
    const q = f.id ? sb.from('items').update(fields).eq('id', f.id) : sb.from('items').insert(fields);
    return flatItem(ok(await q.select(ITEM_SEL).single()));
  },
  async archiveItem(id) {
    ok(await sb.from('items').update({ archived: true }).eq('id', id));
  },
  async listLocations() {
    return ok(await sb.from('locations').select('id, name').order('name'));
  },

  async recordMovement({ item_id, type, quantity, reason }) {
    return ok(
      await sb.rpc('record_movement', {
        p_item: item_id, p_type: type, p_quantity: Number(quantity), p_reason: reason ?? null,
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

  async listMovements({ item_id, types, limit = 200 } = {}) {
    let q = sb.from('movements').select(MOVE_SEL).order('created_at', { ascending: false }).limit(limit);
    if (item_id) q = q.eq('item_id', item_id);
    if (types) q = q.in('type', types);
    return ok(await q).map(flatMove);
  },

  async listProfiles() {
    return ok(await sb.from('profiles').select('*').order('created_at'));
  },
  async setRole(id, role) {
    ok(await sb.from('profiles').update({ role }).eq('id', id));
  },
};
