// Picks the data source: Supabase when configured, otherwise the in-browser demo.
import { config } from '../config.js';

export const demoMode = !(config.supabaseUrl && config.supabaseAnonKey);

const impl = await (demoMode ? import('./data-demo.js') : import('./data-supabase.js'));

export const db = impl.default;
