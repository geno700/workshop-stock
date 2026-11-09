// Picks the data source: Supabase when configured, otherwise the in-browser demo.
import { config } from '../config.js';

// Add ?demo to the address to try the app with sample data even when Supabase is connected.
export const demoMode =
  !(config.supabaseUrl && config.supabaseAnonKey) || new URLSearchParams(location.search).has('demo');

const impl = await (demoMode ? import('./data-demo.js') : import('./data-supabase.js'));

export const db = impl.default;
