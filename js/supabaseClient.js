(() => {
  if (!window.APP_CONFIG) { console.error('Missing APP_CONFIG. Copy config.example.js to config.js'); return; }
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Fill SUPABASE_URL and SUPABASE_ANON_KEY in config.js');
    return;
  }
  window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
})();
