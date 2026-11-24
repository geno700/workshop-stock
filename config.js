// App settings. Leave the two Supabase values empty to run in demo mode
// (sample data, saved only in this browser). See README.md for setup.
export const config = {
  // Shared Supabase project "github apps" (also used by the residential and home finance apps).
  supabaseUrl: 'https://gzvknfvqyqfynainxgur.supabase.co',
  // Publishable key: safe to be public. Never put a secret key here.
  supabaseAnonKey: 'sb_publishable_M7QzNvmL2Tto6-QnkTr0rQ_-Y0ueJok',
  // Public address of the app. QR labels point here.
  appUrl: 'https://algebratronics.com/workshop-stock/',
  workshopName: 'Workshop Stock',
  // Shown after money values, e.g. 'EGP', 'USD', '€'. Leave empty for plain numbers.
  currency: '',
};
