(async function(){
  const elVal = document.getElementById('value');
  const sb = window.supabaseClient;
  if (!sb) return;

  const CFG = window.APP_CONFIG || {};
  const padToFives = !!CFG.DISPLAY_PAD_TO_FIVES;
  const extraPad = Number.isFinite(CFG.DISPLAY_EXTRA_PAD_MINUTES) ? CFG.DISPLAY_EXTRA_PAD_MINUTES : 5;
  const applyToManual = CFG.DISPLAY_APPLY_TO_MANUAL !== false;

  function biasUp(minutes){
    if (minutes == null) return null;
    let n = Math.max(0, Math.round(minutes));
    if (padToFives){
      const snapped = Math.ceil(n / 5) * 5;
      n = snapped + (extraPad || 0);
      if (n === 0) n = 5;
    }
    return n;
  }

  async function fetchSettings(){
    const { data, error } = await sb.from('settings').select('*').limit(1).single();
    if (error) return null;
    return data;
  }

  async function fetchRecent(){
    const N = CFG.AVERAGE_LAST_N || 10;
    const minutes = CFG.AVERAGE_WINDOW_MINUTES || 120;
    const since = new Date(Date.now() - minutes*60*1000).toISOString();
    const { data, error } = await sb
      .from('handoffs')
      .select('duration_seconds,end_time')
      .not('end_time','is',null)
      .gte('end_time', since)
      .order('end_time', { ascending:false })
      .limit(N);
    if (error) { console.error(error); return []; }
    return data || [];
  }

  function computeAverage(durations){
    const mins = durations.map(d => (d.duration_seconds || 0)/60).filter(v => v>0);
    if (!mins.length) return null;
    return mins.reduce((a,b)=>a+b,0)/mins.length;
  }

  function render(settings, durations){
    if (!settings || settings.display_on === false){
      elVal.textContent = "--";
      return;
    }

    if (settings.manual_minutes != null){
      const raw = Math.max(0, Math.round(settings.manual_minutes));
      const shown = applyToManual ? biasUp(raw) : raw;
      elVal.textContent = String(shown);
      return;
    }

    const avg = computeAverage(durations);
    if (avg == null){
      elVal.textContent = "--";
      return;
    }
    const shown = biasUp(avg);
    elVal.textContent = String(shown);
  }

  async function refresh(){
    const [settings, recent] = await Promise.all([fetchSettings(), fetchRecent()]);
    render(settings, recent);
  }

  refresh();

  try {
    sb.channel('realtime:handoffs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'handoffs' }, refresh)
      .subscribe();
    sb.channel('realtime:settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, refresh)
      .subscribe();
  } catch (e) {
    console.warn('Realtime not available', e);
  }

  setInterval(refresh, 30000);
})();
