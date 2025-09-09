(async function(){
  const sb = window.supabaseClient;
  const envNote = document.getElementById('envNote');
  const dispDot = document.getElementById('dispDot');
  const dispState = document.getElementById('dispState');
  const btnOn = document.getElementById('btnDispOn');
  const btnOff = document.getElementById('btnDispOff');
  const manualVal = document.getElementById('manualVal');
  const btnSetManual = document.getElementById('btnSetManual');
  const btnClearManual = document.getElementById('btnClearManual');
  const btnStartScan = document.getElementById('btnStartScan');
  const btnStopScan = document.getElementById('btnStopScan');
  const preview = document.getElementById('preview');
  const scanMsg = document.getElementById('scanMsg');

  const checkToken = document.getElementById('checkToken');
  const btnCheck = document.getElementById('btnCheck');
  const btnScanCheck = document.getElementById('btnScanCheck');
  const btnStopScanCheck = document.getElementById('btnStopScanCheck');
  const previewCheck = document.getElementById('previewCheck');
  const checkMsg = document.getElementById('checkMsg');
  const checkResult = document.getElementById('checkResult');

  envNote.textContent = location.hostname;

  // --- Settings ---
  async function getSettings(){
    const { data } = await sb.from('settings').select('*').limit(1).single();
    return data;
  }
  async function upsertSettings(patch){
    const existing = await getSettings();
    if (!existing){
      await sb.from('settings').insert({ id: 1, ...patch });
    } else {
      await sb.from('settings').update(patch).eq('id', existing.id);
    }
  }
  function renderSettings(s){
    const on = !!(s && s.display_on);
    dispDot.classList.toggle('on', on);
    dispDot.classList.toggle('off', !on);
    dispState.textContent = on ? '(on)' : '(off)';
    manualVal.value = s && s.manual_minutes != null ? s.manual_minutes : '';
  }
  async function refresh(){
    const s = await getSettings();
    renderSettings(s);
  }
  refresh();
  sb.channel('realtime:settings')
    .on('postgres_changes',{ event:'*', schema:'public', table:'settings' }, refresh)
    .subscribe();

  btnOn.onclick = () => upsertSettings({ display_on: true });
  btnOff.onclick = () => upsertSettings({ display_on: false });
  btnSetManual.onclick = () => {
    const v = manualVal.value === '' ? null : Math.max(0, parseInt(manualVal.value,10)||0);
    upsertSettings({ manual_minutes: v });
  };
  btnClearManual.onclick = () => upsertSettings({ manual_minutes: null });

  // --- QR Scanner with jsQR ---
  let stream = null;
  let rafId = null;
  let scanning = false;

  async function startCamera(videoEl, onDecoded, msgEl){
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      videoEl.srcObject = stream;
      await videoEl.play();
      scanning = true;
      msgEl.textContent = "Scanning…";
      tick(videoEl, onDecoded, msgEl);
    } catch (e) {
      console.error(e);
      msgEl.textContent = "Camera failed. Allow access.";
    }
  }
  function stopCamera(videoEl, msgEl){
    scanning = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (videoEl) videoEl.pause();
    if (stream){ stream.getTracks().forEach(t=>t.stop()); }
    msgEl.textContent = "Camera stopped.";
  }
  function tick(videoEl, onDecoded, msgEl){
    if (!scanning) return;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(imageData.data, imageData.width, imageData.height);
    if (code) {
      const token = (code.data || '').trim();
      if (token) {
        scanning = false;
        stopCamera(videoEl, msgEl);
        onDecoded(token);
        return;
      }
    }
    rafId = requestAnimationFrame(() => tick(videoEl, onDecoded, msgEl));
  }

  async function handleDecoded(token){
    scanMsg.textContent = "Scanned: " + token + " — saving…";
    const { data, error } = await sb.rpc('record_scan', { p_token: token });
    if (error){
      console.error(error);
      scanMsg.textContent = "Error saving scan.";
    } else {
      if (data && data.completed){
        const mins = Math.round((data.duration_seconds||0)/60);
        scanMsg.textContent = "Completed handoff. Duration: " + mins + " min";
      } else {
        scanMsg.textContent = "Started new handoff.";
      }
    }
  }

  btnStartScan.onclick = () => startCamera(preview, handleDecoded, scanMsg);
  btnStopScan.onclick = () => stopCamera(preview, scanMsg);

  // --- Wait Time Checker ---
  async function checkTicket(token){
    checkMsg.textContent = "Checking…";
    const { data, error } = await sb.rpc('get_ticket_status', { p_token: token });
    if (error){ checkMsg.textContent = "Error"; return; }
    if (data.not_found){ checkMsg.textContent = "No record for " + token; return; }
    if (data.open){
      const mins = Math.round((data.elapsed_seconds||0)/60);
      checkMsg.textContent = "";
      checkResult.textContent = "In progress, elapsed: " + mins + " min";
    } else {
      const mins = Math.round((data.duration_seconds||0)/60);
      checkMsg.textContent = "";
      checkResult.textContent = "Completed, duration: " + mins + " min";
    }
  }

  btnCheck.onclick = () => {
    const token = (checkToken.value||"").trim();
    if (token) checkTicket(token);
  };
  btnScanCheck.onclick = () => startCamera(previewCheck, (token)=>{
    checkToken.value = token;
    checkTicket(token);
  }, checkMsg);
  btnStopScanCheck.onclick = () => stopCamera(previewCheck, checkMsg);

})();
