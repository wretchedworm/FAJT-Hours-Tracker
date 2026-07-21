// Supabase connection details.
//
// Paste the two values from your Supabase project here:
//   Supabase dashboard -> Project Settings -> Data API
//     url      = "Project URL"
//     anonKey  = "anon public" API key
//
// Until these are filled in the app runs exactly as before: local-only,
// one device, no sync. Nothing breaks — it just does not sync.
//
// The anon key is safe to commit publicly. It grants no access on its own;
// the row-level security policy in supabase-setup.sql is what protects data,
// and your records sit under an ID derived from your passcode, which is never
// sent anywhere.

globalThis.FAJT_CONFIG = {
  url: "",
  anonKey: "",
};
