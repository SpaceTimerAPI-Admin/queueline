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
  const qrCount = document.getElementById('qrCount');
  const btnGenQRs = document.getElementById('btnGenQRs');
  const btnPrint = document.getElementById('btnPrint');
  const qrWrap = document.getElementById('qrWrap');

  envNote.textContent = location.hostname;

  async function getSettings(){
    const { data } = await sb.from('settings').select('*').limit(1).single();
    return data;
  }
  async function upsertSettings(patch){
    const existing = await getSettings();
    if (!existing){
      const { data, error } = await sb.from('settings').insert({ id: 1, ...patch }).select().single();
      if (error) console.error(error);
      return data;
    } else {
      const { data, error } = await sb.from('settings').update(patch).eq('id', existing.id).select().single();
      if (error) console.error(error);
      return data;
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
  try {
    sb.channel('realtime:settings').on('postgres_changes', { event:'*', schema:'public', table:'settings' }, refresh).subscribe();
  } catch(e){}

  btnOn.onclick = () => upsertSettings({ display_on: true });
  btnOff.onclick = () => upsertSettings({ display_on: false });
  btnSetManual.onclick = () => {
    const v = manualVal.value === '' ? null : Math.max(0, parseInt(manualVal.value,10)||0);
    upsertSettings({ manual_minutes: v });
  };
  btnClearManual.onclick = () => upsertSettings({ manual_minutes: null });

  // --- Scanner (pairing) ---
  let stream = null;
  let rafId = null;
  let scanning = false;
  let barcodeDetector = ('BarcodeDetector' in window) ? new BarcodeDetector({ formats: ['qr_code'] }) : null;

  async function startCamera(){
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      preview.srcObject = stream;
      await preview.play();
      scanning = true;
      scanMsg.textContent = "Scanning… point the camera at a QR code";
      tick();
    }catch(e){
      console.error(e);
      scanMsg.textContent = "Camera failed. On iOS Safari, allow camera access.";
    }
  }
  function stopCamera(){
    scanning = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (preview) preview.pause();
    if (stream){ stream.getTracks().forEach(t=>t.stop()); }
    scanMsg.textContent = "Camera stopped.";
  }
  btnStartScan.onclick = startCamera;
  btnStopScan.onclick = stopCamera;

  async function handleDecoded(token){
    scanMsg.textContent = "Scanned: " + token + " — saving…";
    const { data, error } = await sb.rpc('record_scan', { p_token: token });
    if (error){
      console.error(error);
      scanMsg.textContent = "Error saving scan. Try again.";
    } else {
      if (data && data.completed){
        const mins = Math.round((data.duration_seconds||0)/60);
        scanMsg.textContent = "Handoff completed for " + token + ". Duration: " + mins + " min.";
      } else {
        scanMsg.textContent = "Started handoff for " + token + ". Hand this ticket to the guest.";
      }
    }
  }

  async function tick(){
    if (!scanning) return;
    if (barcodeDetector){
      try{
        const barcodes = await barcodeDetector.detect(document.getElementById('preview'));
        if (barcodes && barcodes.length){
          const token = (barcodes[0].rawValue || '').trim();
          if (token){
            scanning = false;
            await handleDecoded(token);
            scanning = true;
          }
        }
      }catch(e){}
    }
    rafId = requestAnimationFrame(tick);
  }

  // --- QR generation & print (optional fallback cards) ---
  function makeId(n){ return 'QT-' + String(n).padStart(3,'0'); }
  async function generate(){
    qrWrap.innerHTML = '';
    const count = Math.max(1, Math.min(60, parseInt(qrCount.value,10)||12));
    for (let i=1;i<=count;i++){
      const id = makeId(i);
      const div = document.createElement('div');
      div.className = 'qr';
      const canvas = document.createElement('canvas');
      div.appendChild(canvas);
      const small = document.createElement('small');
      small.textContent = id;
      div.appendChild(small);
      qrWrap.appendChild(div);
      await QRCode.toCanvas(canvas, id, { width: 320, margin: 2 });
    }
    window.print();
  }
  btnGenQRs.onclick = generate;
  btnPrint.onclick = () => window.print();
})();

// ===== Wait Time Checker =====
;(function(){
  const sb = window.supabaseClient;
  const checkToken = document.getElementById('checkToken');
  const btnCheck = document.getElementById('btnCheck');
  const btnScanCheck = document.getElementById('btnScanCheck');
  const btnStopScanCheck = document.getElementById('btnStopScanCheck');
  const previewCheck = document.getElementById('previewCheck');
  const checkMsg = document.getElementById('checkMsg');
  const checkResult = document.getElementById('checkResult');

  let streamC = null;
  let rafIdC = null;
  let scanningC = false;
  let barcodeDetectorC = ('BarcodeDetector' in window) ? new BarcodeDetector({ formats: ['qr_code'] }) : null;

  function fmt(ts){
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString();
  }
  function fmtMin(sec){
    if (!Number.isFinite(sec)) return '—';
    return Math.round(sec/60) + ' min';
  }

  async function getStatus(token){
    if (!token) return;
    checkMsg.textContent = 'Looking up ' + token + '…';
    let status = null, err = null;
    try {
      const { data, error } = await sb.rpc('get_ticket_status', { p_token: token });
      if (error) err = error;
      status = data;
    } catch(e){ err = e; }
    if (err || !status){
      const { data: openRows } = await sb.from('handoffs')
        .select('*')
        .eq('token', token)
        .is('end_time', null)
        .order('start_time', { ascending: false })
        .limit(1);
      const { data: doneRows } = await sb.from('handoffs')
        .select('*')
        .eq('token', token)
        .not('end_time', 'is', null)
        .order('end_time', { ascending: false })
        .limit(1);
      const open = (openRows && openRows[0]) || null;
      const last = (doneRows && doneRows[0]) || null;
      if (open){
        const elapsed = Math.floor((Date.now() - new Date(open.start_time).getTime())/1000);
        status = { open: true, start_time: open.start_time, elapsed_seconds: elapsed };
      } else if (last){
        status = { open: false, start_time: last.start_time, end_time: last.end_time, duration_seconds: last.duration_seconds };
      } else {
        status = { not_found: true };
      }
    }

    if (status.not_found){
      checkMsg.textContent = 'No records for ' + token + '.';
      checkResult.textContent = '';
      return;
    }
    if (status.open){
      checkMsg.textContent = 'Ticket ' + token + ' is currently in progress.';
      checkResult.innerHTML = 'Started: ' + fmt(status.start_time) + ' • Elapsed: ' + fmtMin(status.elapsed_seconds);
      return;
    }
    checkMsg.textContent = 'Ticket ' + token + ' completed.';
    checkResult.innerHTML = 'Start: ' + fmt(status.start_time) + ' • End: ' + fmt(status.end_time) + ' • Duration: ' + fmtMin(status.duration_seconds);
  }

  async function startCam(){
    try{
      streamC = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      previewCheck.srcObject = streamC;
      await previewCheck.play();
      scanningC = true;
      checkMsg.textContent = 'Scan a ticket QR…';
      tick();
    }catch(e){
      console.error(e);
      checkMsg.textContent = 'Camera failed. Allow camera access.';
    }
  }
  function stopCam(){
    scanningC = false;
    if (rafIdC) cancelAnimationFrame(rafIdC);
    if (previewCheck) previewCheck.pause();
    if (streamC){ streamC.getTracks().forEach(t=>t.stop()); }
    checkMsg.textContent = 'Camera stopped.';
  }
  async function tick(){
    if (!scanningC) return;
    if (barcodeDetectorC){
      try{
        const barcodes = await barcodeDetectorC.detect(previewCheck);
        if (barcodes && barcodes.length){
          const token = (barcodes[0].rawValue || '').trim();
          if (token){
            scanningC = false;
            stopCam();
            checkToken.value = token;
            await getStatus(token);
            return;
          }
        }
      }catch(e){}
    }
    rafIdC = requestAnimationFrame(tick);
  }

  btnCheck && (btnCheck.onclick = () => getStatus(checkToken.value.trim()));
  btnScanCheck && (btnScanCheck.onclick = startCam);
  btnStopScanCheck && (btnStopScanCheck.onclick = stopCam);
})();
