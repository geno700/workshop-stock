// Shared constants, formatters and small hooks.
import { useState, useEffect } from './lib.js';
import { config } from '../config.js';

export const KINDS = {
  raw: { label: 'Raw stock', fields: [['grade', 'Material / grade'], ['dimensions', 'Dimensions']] },
  component: { label: 'Component', fields: [['part_no', 'Part number'], ['spec', 'Specs']] },
  consumable: { label: 'Consumable', fields: [['spec', 'Type / spec']] },
  tool: { label: 'Tool', fields: [['serial', 'Serial / asset no.'], ['condition', 'Condition']] },
};

export const UNITS = ['pcs', 'm', 'mm', 'kg', 'g', 'm²', 'L', 'sheet', 'roll', 'box', 'set'];

export const MOVE_LABELS = { in: 'Added', out: 'Taken', adjust: 'Recount', checkout: 'Borrowed', return: 'Returned' };

export const ROLES = {
  pending: 'Waiting for approval',
  viewer: 'Viewer (read only)',
  member: 'Member (add and take stock)',
  admin: 'Admin (everything)',
};

export const fmtNum = (n) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export const fmtMoney = (n) =>
  Number(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
  (config.currency ? ' ' + config.currency : '');

export function fmtDate(iso) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} ${time}`;
}

export const isLow = (item) => Number(item.min_quantity) > 0 && Number(item.quantity) <= Number(item.min_quantity);

export const go = (path) => {
  location.hash = path;
};

export function toast(message, bad = false) {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (bad ? ' bad' : '');
  el.textContent = message;
  host.append(el);
  setTimeout(() => el.remove(), bad ? 5000 : 2500);
}

// Runs an async loader and tracks { data, error, loading }; reload() runs it again.
export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fn().then(
      (data) => live && setState({ data, loading: false }),
      (error) => live && setState({ error, loading: false }),
    );
    return () => {
      live = false;
    };
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
