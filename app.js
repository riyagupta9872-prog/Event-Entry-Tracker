// ===== MAIN APP =====
const App = (() => {
  let currentUser = null;
  let currentPage = 'dashboard';
  let scannerStream = null;
  let offlineQueue = [];
  let allAttendees = [];
  let attendeesPage = 1;
  const PAGE_SIZE = 100;

  // ===== INIT =====
  async function init() {
    await DB.open();
    await initDefaultUsers();
    await initDefaultConfig();

    // Splash → check saved session or show Login
    setTimeout(async () => {
      const splash = document.getElementById('splash');
      splash.style.opacity = '0';
      setTimeout(async () => {
        splash.style.display = 'none';
        const saved = localStorage.getItem('prerna_session');
        if (saved) {
          try {
            const sess = JSON.parse(saved);
            const user = await DB.getById(DB.STORES.users, sess.username);
            if (user) {
              await loginUser(user);
              return;
            }
          } catch {}
        }
        document.getElementById('screen-login').classList.remove('hidden');
        document.getElementById('login-username').focus();
      }, 500);
    }, 1800);

    // Events
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
    document.getElementById('btn-logout').addEventListener('click', handleLogout);
    document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
    document.getElementById('btn-sidebar-close').addEventListener('click', () => document.getElementById('sidebar').classList.remove('open'));
    document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') Helpers.closeModal(); });

    // Nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        navigate(item.dataset.page);
        document.getElementById('sidebar').classList.remove('open');
      });
    });

    // Network status
    updateNetworkStatus();
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
  }

  async function initDefaultUsers() {
    const users = await DB.getAll(DB.STORES.users);
    if (users.length === 0) {
      await DB.put(DB.STORES.users, { username: 'admin', password: 'admin123', role: 'admin', name: 'Administrator' });
      await DB.put(DB.STORES.users, { username: 'volunteer', password: 'vol123', role: 'volunteer', name: 'Volunteer' });
    }
  }

  async function initDefaultConfig() {
    const name = await DB.getConfig('eventName');
    if (!name) {
      await DB.setConfig('eventName', 'Prerna Festival 2025');
      await DB.setConfig('chargePerPerson', '0');
    }
  }

  // ===== AUTH =====
  async function handleLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const role = document.getElementById('login-role').value;
    const errEl = document.getElementById('login-error');

    if (!username || !password) {
      errEl.textContent = 'Please enter username and password';
      errEl.classList.remove('hidden'); return;
    }

    const user = await DB.getById(DB.STORES.users, username);
    if (!user || user.password !== password) {
      errEl.textContent = 'Invalid username or password';
      errEl.classList.remove('hidden'); return;
    }
    if (user.role !== role) {
      errEl.textContent = `This account has role: ${user.role}`;
      errEl.classList.remove('hidden'); return;
    }

    currentUser = user;
    errEl.classList.add('hidden');
    localStorage.setItem('prerna_session', JSON.stringify({ username: user.username }));
    await loginUser(user);
  }

  async function loginUser(user) {
    currentUser = user;

    // Update UI
    document.getElementById('sidebar-username').textContent = user.name;
    document.getElementById('sidebar-role').textContent = user.role === 'admin' ? 'Administrator' : 'Volunteer';
    document.getElementById('sidebar-avatar').textContent = user.name[0].toUpperCase();

    // Show/hide admin elements
    document.querySelectorAll('.admin-only, .admin-page').forEach(el => {
      el.style.display = user.role === 'admin' ? '' : 'none';
    });

    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('screen-app').classList.remove('hidden');
    navigate('attendance');
    await DB.log('login', `User logged in`, user.username);
  }

  function handleLogout() {
    currentUser = null;
    localStorage.removeItem('prerna_session');
    stopScanner();
    document.getElementById('screen-app').classList.add('hidden');
    document.getElementById('screen-login').classList.remove('hidden');
    document.getElementById('login-password').value = '';
    document.getElementById('login-username').value = '';
  }

  // ===== NAVIGATION =====
  function navigate(page) {
    if (currentPage === 'attendance' && page !== 'attendance') stopScanner();

    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.page === page);
    });

    const titles = {
      dashboard: 'Dashboard', import: 'Import Excel',
      attendance: 'Attendance', walkin: 'Walk-in Entry',
      attendees: 'Attendees', reports: 'Reports', settings: 'Settings'
    };
    document.getElementById('page-title').textContent = titles[page] || page;
    currentPage = page;

    // Init page
    switch (page) {
      case 'dashboard': initDashboard(); break;
      case 'import': initImport(); break;
      case 'attendance': initAttendance(); break;
      case 'walkin': initWalkin(); break;
      case 'attendees': initAttendees(); break;
      case 'reports': initReports(); break;
      case 'settings': initSettings(); break;
    }
  }

  // ===== DASHBOARD =====
  async function initDashboard() {
    const attendees = await DB.getAll(DB.STORES.attendees);
    const present = attendees.filter(a => a.attendance === 'present');
    const walkins = attendees.filter(a => a.isWalkIn);
    const dups = attendees.filter(a => a.isDuplicate && !a.dupResolved);
    const totalPay = attendees.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);

    document.getElementById('stat-total').textContent = attendees.length;
    document.getElementById('stat-present').textContent = present.length;
    document.getElementById('stat-pending').textContent = attendees.length - present.length;
    document.getElementById('stat-payment').textContent = Helpers.currency(totalPay);
    document.getElementById('stat-duplicates').textContent = dups.length;
    document.getElementById('stat-walkins').textContent = walkins.length;

    const pct = attendees.length ? Math.round((present.length / attendees.length) * 100) : 0;
    document.getElementById('dash-progress-bar').style.width = pct + '%';
    document.getElementById('dash-progress-pct').textContent = pct + '%';

    // Category breakdown
    const catMap = {};
    attendees.forEach(a => {
      const cat = a.category || 'Unknown';
      if (!catMap[cat]) catMap[cat] = { total: 0, present: 0 };
      catMap[cat].total++;
      if (a.attendance === 'present') catMap[cat].present++;
    });
    const breakdown = document.getElementById('dash-category-breakdown');
    breakdown.innerHTML = Object.entries(catMap).map(([cat, d]) => `
      <div class="mini-row"><span>${cat}</span><span>${d.present}/${d.total}</span></div>
    `).join('');

    // Recent activity
    const logs = await DB.getAll(DB.STORES.auditLog);
    const recent = logs.slice(-8).reverse();
    const actEl = document.getElementById('dash-activity');
    actEl.innerHTML = recent.length ? recent.map(l => `
      <div class="activity-item">
        <div class="activity-dot ${l.action === 'checkin' ? 'green' : l.action === 'import' ? 'blue' : 'orange'}"></div>
        <span>${l.details}</span>
        <span class="activity-time">${Helpers.formatDateTime(l.timestamp)}</span>
      </div>
    `).join('') : '<p style="color:var(--text-muted);font-size:.85rem">No recent activity</p>';
  }

  // ===== IMPORT =====
  let importData = null;
  let importHeaders = null;

  function initImport() {
    const zone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');

    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('dragover');
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    });
    zone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });
    document.getElementById('btn-confirm-import').addEventListener('click', confirmImport);
    document.getElementById('btn-cancel-import').addEventListener('click', () => {
      document.getElementById('column-mapping-section').classList.add('hidden');
      importData = null; importHeaders = null;
    });
  }

  async function processFile(file) {
    Helpers.toast('Processing file...', 'info');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (raw.length < 2) { Helpers.toast('File appears empty', 'error'); return; }
        importHeaders = raw[0].map(h => String(h).trim());
        importData = raw.slice(1).filter(row => row.some(c => c !== ''));
        showColumnMapping();
      } catch (err) {
        Helpers.toast('Error reading file: ' + err.message, 'error');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const SYSTEM_FIELDS = [
    { key: 'name', label: 'Name ★', required: true },
    { key: 'mobile', label: 'Mobile ★', required: true },
    { key: 'team', label: 'Team' },
    { key: 'category', label: 'Category' },
    { key: 'reference', label: 'Reference' },
    { key: 'paymentAmount', label: 'Payment Amount' },
    { key: 'paymentDate', label: 'Payment Date' },
    { key: 'pickupLocation', label: 'Pickup Location' },
    { key: 'busRoute', label: 'Bus Route' },
    { key: 'serviceDevotee', label: 'Service Devotee' },
    { key: 'activeDevotee', label: 'Active Devotee' }
  ];

  function showColumnMapping() {
    const grid = document.getElementById('column-mapping-grid');
    grid.innerHTML = SYSTEM_FIELDS.map(f => {
      const autoMatch = importHeaders.findIndex(h =>
        h.toLowerCase().replace(/[^a-z]/g, '') === f.key.toLowerCase().replace(/[^a-z]/g, '') ||
        h.toLowerCase().includes(f.key.toLowerCase().replace(/([A-Z])/g, ' $1').trim().toLowerCase())
      );
      return `
        <div class="mapping-row">
          <label>${f.label}</label>
          <select data-field="${f.key}">
            <option value="">-- Skip --</option>
            ${importHeaders.map((h, i) => `<option value="${i}" ${i === autoMatch ? 'selected' : ''}>${h}</option>`).join('')}
          </select>
        </div>
      `;
    }).join('');
    document.getElementById('column-mapping-section').classList.remove('hidden');
    document.getElementById('column-mapping-section').scrollIntoView({ behavior: 'smooth' });
  }

  async function confirmImport() {
    const mapping = {};
    document.querySelectorAll('[data-field]').forEach(sel => {
      if (sel.value !== '') mapping[sel.dataset.field] = parseInt(sel.value);
    });

    if (!('name' in mapping) || !('mobile' in mapping)) {
      Helpers.toast('Name and Mobile columns are required', 'error'); return;
    }

    const eventDate = await DB.getConfig('eventDate');
    const records = importData.map(row => {
      const r = { attendance: 'absent', isWalkIn: false };
      SYSTEM_FIELDS.forEach(f => {
        if (f.key in mapping) {
          let val = row[mapping[f.key]];
          if (val instanceof Date) val = val.toISOString().slice(0, 10);
          r[f.key] = val !== undefined ? String(val).trim() : '';
        }
      });
      r.attendeeId = Helpers.generateId();
      r.paymentTiming = Helpers.paymentTiming(r.paymentDate, eventDate);
      return r;
    }).filter(r => r.name);

    // Detect duplicates
    const dupIds = Helpers.detectDuplicates(records);
    records.forEach((r, i) => {
      r.isDuplicate = dupIds.has(i);
    });

    // Clear and bulk add
    await DB.clearStore(DB.STORES.attendees);
    await DB.bulkAdd(DB.STORES.attendees, records);
    await DB.log('import', `Imported ${records.length} records (${dupIds.size} duplicates)`, currentUser?.username);

    // Show preview
    showImportPreview(records, dupIds.size);
    document.getElementById('column-mapping-section').classList.add('hidden');
    Helpers.toast(`Imported ${records.length} records`, 'success');
  }

  function showImportPreview(records, dupCount) {
    const statsRow = document.getElementById('import-stats-row');
    statsRow.innerHTML = `
      <span class="import-stat total">Total: ${records.length}</span>
      <span class="import-stat clean">Clean: ${records.length - dupCount}</span>
      <span class="import-stat dup">Duplicates: ${dupCount}</span>
    `;

    const preview = document.getElementById('import-preview');
    preview.classList.remove('hidden');

    const searchInput = document.getElementById('preview-search');
    const filterSelect = document.getElementById('preview-filter');

    const render = () => {
      const q = searchInput.value.toLowerCase();
      const f = filterSelect.value;
      let filtered = records;
      if (q) filtered = filtered.filter(r => Helpers.searchFilter(r, q));
      if (f === 'duplicates') filtered = filtered.filter(r => r.isDuplicate);
      if (f === 'clean') filtered = filtered.filter(r => !r.isDuplicate);

      const wrap = document.getElementById('preview-table-wrap');
      wrap.innerHTML = Helpers.buildTable(
        ['Name', 'Mobile', 'Team', 'Category', 'Payment', 'Bus Route', 'Status'],
        filtered.slice(0, 200).map(r => ({
          _class: r.isDuplicate ? 'duplicate-row' : '',
          cells: [
            r.name,
            r.mobile,
            r.team || '-',
            r.category || '-',
            r.paymentAmount ? Helpers.currency(r.paymentAmount) : '-',
            r.busRoute || '-',
            r.isDuplicate ? `<span class="badge dup">⚠️ Dup: ${r._dupOf || ''}</span>` : '<span class="badge present">Clean</span>'
          ]
        }))
      );
      if (filtered.length > 200) {
        wrap.innerHTML += `<p style="color:var(--text-muted);padding:0.5rem;font-size:.8rem">Showing first 200 of ${filtered.length} results</p>`;
      }
    };

    searchInput.addEventListener('input', Helpers.debounce(render, 300));
    filterSelect.addEventListener('change', render);
    render();
    preview.scrollIntoView({ behavior: 'smooth' });
  }

  // ===== ATTENDANCE =====
  let attendanceInited = false;
  function initAttendance() {
    updateAdmitCounters();

    if (attendanceInited) return;
    attendanceInited = true;

    const searchInput = document.getElementById('att-search');
    searchInput.addEventListener('input', Helpers.debounce(() => searchAttendees(searchInput.value), 200));
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchAttendees(searchInput.value); });

    // QR toggle
    const scanBtn = document.getElementById('btn-toggle-scan');
    scanBtn.addEventListener('click', () => {
      const section = document.getElementById('att-scan-section');
      const isHidden = section.classList.contains('hidden');
      section.classList.toggle('hidden');
      scanBtn.classList.toggle('active', isHidden);
      if (isHidden) initScanner(); else stopScanner();
    });

    document.getElementById('btn-manual-scan').addEventListener('click', () => {
      const id = document.getElementById('manual-scan-id').value.trim();
      if (id) markByIdOrQr(id);
    });
    document.getElementById('manual-scan-id').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('btn-manual-scan').click();
    });

    // Walk-in FAB
    document.getElementById('btn-fab-walkin').addEventListener('click', () => {
      document.getElementById('walkin-panel').classList.remove('hidden');
      document.getElementById('wi-name').focus();
      initWalkinPanel();
    });
    document.getElementById('btn-close-walkin').addEventListener('click', () => {
      document.getElementById('walkin-panel').classList.add('hidden');
    });

    document.getElementById('btn-add-walkin').addEventListener('click', addWalkIn);

    const bulkFile = document.getElementById('bulk-att-file');
    bulkFile.addEventListener('change', e => { if (e.target.files[0]) processBulkAttendance(e.target.files[0]); });

    // Auto-focus search
    setTimeout(() => searchInput.focus(), 100);
  }

  async function updateAdmitCounters() {
    const all = await DB.getAll(DB.STORES.attendees);
    const present = all.filter(a => a.attendance === 'present');
    const el1 = document.getElementById('admit-count-present');
    const el2 = document.getElementById('admit-count-total');
    if (el1) el1.textContent = present.length;
    if (el2) el2.textContent = all.length;
  }

  async function searchAttendees(query) {
    if (!query || query.length < 1) {
      document.getElementById('att-search-results').innerHTML = '';
      return;
    }
    const all = await DB.getAll(DB.STORES.attendees);
    const results = all.filter(a => Helpers.searchFilter(a, query)).slice(0, 30);
    renderAttendanceResults(results);
  }

  function getPaymentStatus(a) {
    if (a.attendance === 'present') return { color: 'red', label: 'Already Present', cls: 'status-already-present' };
    const amt = parseFloat(a.paymentAmount || 0);
    if (amt > 0 || a.category === 'Free' || a.paymentTiming === 'Free') return { color: 'green', label: 'Paid', cls: 'status-paid' };
    return { color: 'yellow', label: 'Not Paid', cls: 'status-unpaid' };
  }

  function renderAttendanceResults(results) {
    const el = document.getElementById('att-search-results');
    if (!results.length) {
      el.innerHTML = '<p style="color:var(--text-muted);padding:1rem">No attendees found</p>';
      return;
    }
    el.innerHTML = results.map(a => {
      const ps = getPaymentStatus(a);
      const isPres = a.attendance === 'present';
      return `
        <div class="att-result-card ${ps.cls}" onclick="App.showAdmitConfirm(${a.id})" data-id="${a.id}">
          <div class="att-status-indicator ${ps.cls}"></div>
          <div class="att-result-info">
            <div class="att-name">${a.name} ${a.isWalkIn ? '<span class="badge walkin">Walk-in</span>' : ''}</div>
            <div class="att-meta">${a.mobile || '-'} · ${a.team || '-'} · ${a.attendeeId || ''}</div>
            <div class="att-payment-badge ${ps.cls}">${ps.label}${isPres ? ` by ${a.markedBy || '?'} at ${Helpers.formatDateTime(a.entryTime)}` : (parseFloat(a.paymentAmount||0) > 0 ? ' - '+Helpers.currency(a.paymentAmount) : '')}</div>
          </div>
          <div class="att-arrow">&#8250;</div>
        </div>
      `;
    }).join('');
  }

  async function showAdmitConfirm(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    const ps = getPaymentStatus(a);
    const isPres = a.attendance === 'present';

    let actionHtml = '';
    if (isPres) {
      actionHtml = `
        <div class="admit-warning status-already-present">
          Already marked present by <strong>${a.markedBy || 'Unknown'}</strong> at ${Helpers.formatDateTime(a.entryTime)}
        </div>
        <button class="btn-danger admit-btn" onclick="App.unmarkAttendance(${a.id});Helpers.closeModal()">Undo Check-in</button>
      `;
    } else {
      actionHtml = `<button class="btn-primary admit-btn ${ps.cls}" onclick="App.markAttendance(${a.id});Helpers.closeModal()">Confirm & Mark Present</button>`;
    }

    Helpers.modal(`
      <div class="admit-confirm-card">
        <div class="admit-status-banner ${ps.cls}">
          <span class="admit-status-dot ${ps.cls}"></span>
          ${ps.label}
        </div>
        <h3 class="admit-name">${a.name}</h3>
        <div class="admit-details">
          <div class="admit-row"><span>Mobile</span><span>${a.mobile || '-'}</span></div>
          <div class="admit-row"><span>Team</span><span>${a.team || '-'}</span></div>
          <div class="admit-row"><span>Category</span><span>${a.category || '-'}</span></div>
          <div class="admit-row"><span>Reference</span><span>${a.reference || '-'}</span></div>
          <div class="admit-row"><span>Payment</span><span>${Helpers.currency(a.paymentAmount)} ${a.paymentTiming ? '('+a.paymentTiming+')' : ''}</span></div>
          <div class="admit-row"><span>ID</span><span style="font-family:var(--font-mono);font-size:.8rem">${a.attendeeId}</span></div>
        </div>
        <div class="admit-actions">
          ${actionHtml}
          <button class="btn-ghost admit-btn" onclick="Helpers.closeModal()">Cancel</button>
        </div>
      </div>
    `);
  }

  async function markAttendance(id) {
    const attendee = await DB.getById(DB.STORES.attendees, id);
    if (!attendee) return;
    if (attendee.attendance === 'present') {
      Helpers.toast(`${attendee.name} is already checked in by ${attendee.markedBy}`, 'warning');
      return;
    }
    attendee.attendance = 'present';
    attendee.entryTime = new Date().toISOString();
    attendee.markedBy = currentUser?.name || 'Unknown';
    await DB.put(DB.STORES.attendees, attendee);
    await DB.log('checkin', `${attendee.name} checked in`, currentUser?.username);
    Helpers.toast(`${attendee.name} checked in!`, 'success');

    // Refresh results & counters
    const q = document.getElementById('att-search')?.value;
    if (q) searchAttendees(q);
    updateAdmitCounters();
  }

  async function unmarkAttendance(id) {
    const attendee = await DB.getById(DB.STORES.attendees, id);
    if (!attendee) return;
    attendee.attendance = 'absent';
    attendee.entryTime = null;
    attendee.markedBy = null;
    await DB.put(DB.STORES.attendees, attendee);
    Helpers.toast(`Attendance removed for ${attendee.name}`, 'warning');
    const q = document.getElementById('att-search')?.value;
    if (q) searchAttendees(q);
    updateAdmitCounters();
  }

  async function markByIdOrQr(input) {
    const feedback = document.getElementById('scan-feedback');
    try {
      // Try JSON QR
      let attendeeId = null;
      try {
        const parsed = JSON.parse(input);
        attendeeId = parsed.id || parsed.aid;
      } catch {
        // Try direct ID or number
        attendeeId = input;
      }

      const all = await DB.getAll(DB.STORES.attendees);
      const found = all.find(a =>
        String(a.id) === String(attendeeId) ||
        a.attendeeId === attendeeId ||
        a.mobile === input.replace(/\D/g, '')
      );

      if (!found) {
        feedback.className = 'scan-feedback error';
        feedback.textContent = `❌ Attendee not found: "${input}"`;
        feedback.classList.remove('hidden');
        return;
      }

      document.getElementById('manual-scan-id').value = '';
      showAdmitConfirm(found.id);
    } catch (err) {
      feedback.className = 'scan-feedback error';
      feedback.textContent = `Error: ${err.message}`;
      feedback.classList.remove('hidden');
    }
  }

  // QR Scanner
  function initScanner() {
    if (scannerStream) return;
    const video = document.getElementById('scanner-video');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        scannerStream = stream;
        video.srcObject = stream;
        startQrLoop(video);
      })
      .catch(() => {
        Helpers.toast('Camera access denied. Use manual entry below.', 'warning');
      });
  }

  function stopScanner() {
    if (scannerStream) {
      scannerStream.getTracks().forEach(t => t.stop());
      scannerStream = null;
    }
  }

  let qrLoopActive = false;
  function startQrLoop(video) {
    if (qrLoopActive) return;
    qrLoopActive = true;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    async function loop() {
      if (!scannerStream) { qrLoopActive = false; return; }
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        try {
          // Use BarcodeDetector if available
          if ('BarcodeDetector' in window) {
            const detector = new BarcodeDetector({ formats: ['qr_code'] });
            const codes = await detector.detect(canvas);
            if (codes.length > 0) {
              await markByIdOrQr(codes[0].rawValue);
              qrLoopActive = false;
              setTimeout(() => startQrLoop(video), 2000);
              return;
            }
          }
        } catch {}
      }
      if (scannerStream) requestAnimationFrame(loop);
      else qrLoopActive = false;
    }
    requestAnimationFrame(loop);
  }

  async function processBulkAttendance(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
      const all = await DB.getAll(DB.STORES.attendees);
      let matched = 0, notFound = 0;
      for (const row of rows.slice(1)) {
        const val = String(row[0] || '').trim();
        if (!val) continue;
        const found = all.find(a => a.attendeeId === val || a.mobile === val || String(a.id) === val);
        if (found && found.attendance !== 'present') {
          found.attendance = 'present';
          found.entryTime = new Date().toISOString();
          found.markedBy = currentUser?.name + ' (bulk)';
          await DB.put(DB.STORES.attendees, found);
          matched++;
        } else if (!found) notFound++;
      }
      document.getElementById('bulk-att-result').innerHTML =
        `<p style="margin-top:1rem;color:var(--success)">✅ Marked ${matched} attendees present. ${notFound} not found.</p>`;
      Helpers.toast(`Bulk: ${matched} checked in`, 'success');
    };
    reader.readAsArrayBuffer(file);
  }

  async function showAttendeeDetail(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    Helpers.modal(`
      <h3 class="modal-title">Attendee Detail</h3>
      <table style="width:100%;font-size:.9rem">
        <tr><td style="color:var(--text-muted);padding:.4rem">ID</td><td>${a.attendeeId}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Name</td><td>${a.name}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Mobile</td><td>${a.mobile}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Team</td><td>${a.team || '-'}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Category</td><td>${a.category || '-'}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Reference</td><td>${a.reference || '-'}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Payment</td><td>${Helpers.currency(a.paymentAmount)} (${a.paymentTiming || 'N/A'})</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Bus Route</td><td>${a.busRoute || '-'}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Attendance</td><td><span class="badge ${a.attendance}">${a.attendance || 'absent'}</span></td></tr>
        ${a.attendance === 'present' ? `<tr><td style="color:var(--text-muted);padding:.4rem">Entry Time</td><td>${Helpers.formatDateTime(a.entryTime)}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Volunteer</td><td>${a.markedBy}</td></tr>` : ''}
        ${a.isDuplicate ? `<tr><td style="color:var(--danger);padding:.4rem">⚠️ Duplicate</td><td>Matches: ${a._dupOf}</td></tr>` : ''}
      </table>
      <div class="modal-actions">
        ${a.attendance !== 'present' ? `<button class="btn-primary" onclick="App.markAttendance(${a.id});Helpers.closeModal()">✅ Mark Present</button>` : ''}
        <button class="btn-ghost" onclick="Helpers.closeModal()">Close</button>
      </div>
    `);
  }

  // ===== WALK-IN =====
  function initWalkin() {
    renderWalkinList();
  }

  function initWalkinPanel() {
    // Populate team datalist
    DB.getAll(DB.STORES.attendees).then(all => {
      const teams = [...new Set(all.map(a => a.team).filter(Boolean))];
      document.getElementById('team-list').innerHTML = teams.map(t => `<option value="${t}">`).join('');
    });
    // Set today's date
    document.getElementById('wi-paydate').value = new Date().toISOString().slice(0, 10);
  }

  async function addWalkIn() {
    const name = document.getElementById('wi-name').value.trim();
    const mobile = document.getElementById('wi-mobile').value.trim();
    const reference = document.getElementById('wi-reference').value.trim();
    const payment = document.getElementById('wi-payment').value;
    const paydate = document.getElementById('wi-paydate').value;
    const team = document.getElementById('wi-team').value.trim();
    const category = document.getElementById('wi-category').value;
    const busRoute = document.getElementById('wi-busroute').value.trim();
    const fb = document.getElementById('walkin-feedback');

    if (!name || !mobile) {
      fb.className = 'scan-feedback error';
      fb.textContent = 'Name and Mobile are required';
      fb.classList.remove('hidden'); return;
    }

    const eventDate = await DB.getConfig('eventDate');
    const record = {
      name, mobile, reference, paymentAmount: parseFloat(payment),
      paymentDate: paydate, paymentTiming: Helpers.paymentTiming(paydate, eventDate),
      team, category, busRoute,
      attendeeId: Helpers.generateId('WI'),
      attendance: 'present',
      entryTime: new Date().toISOString(),
      markedBy: currentUser?.name,
      isWalkIn: true,
      isDuplicate: false
    };

    await DB.add(DB.STORES.attendees, record);
    await DB.log('walkin', `Walk-in: ${name}`, currentUser?.username);

    fb.className = 'scan-feedback success';
    fb.textContent = `✅ ${name} added and checked in!`;
    fb.classList.remove('hidden');
    setTimeout(() => fb.classList.add('hidden'), 3000);

    clearWalkinForm();
    document.getElementById('walkin-panel').classList.add('hidden');
    updateAdmitCounters();
    Helpers.toast(`Walk-in ${name} registered!`, 'success');
  }

  function clearWalkinForm() {
    ['wi-name','wi-mobile','wi-reference','wi-payment','wi-team','wi-busroute'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const cat = document.getElementById('wi-category');
    if (cat) cat.value = '';
    const pd = document.getElementById('wi-paydate');
    if (pd) pd.value = new Date().toISOString().slice(0, 10);
  }

  async function renderWalkinList() {
    const all = await DB.getAll(DB.STORES.attendees);
    const walkins = all.filter(a => a.isWalkIn).reverse();
    const el = document.getElementById('walkin-list');
    el.innerHTML = walkins.length ? Helpers.buildTable(
      ['Name', 'Mobile', 'Reference', 'Team', 'Payment', 'Entry Time'],
      walkins.map(a => ({
        _class: 'walkin-row',
        cells: [a.name, a.mobile, a.reference, a.team || '-', Helpers.currency(a.paymentAmount), Helpers.formatDateTime(a.entryTime)]
      }))
    ) : '<p style="color:var(--text-muted);padding:1rem">No walk-ins yet</p>';
  }

  // ===== ATTENDEES =====
  async function initAttendees() {
    allAttendees = await DB.getAll(DB.STORES.attendees);
    attendeesPage = 1;

    // Populate team filter
    const teams = [...new Set(allAttendees.map(a => a.team).filter(Boolean))].sort();
    const teamFilter = document.getElementById('attendees-filter-team');
    teamFilter.innerHTML = '<option value="">All Teams</option>' + teams.map(t => `<option value="${t}">${t}</option>`).join('');

    const search = document.getElementById('attendees-search');
    const teamSel = document.getElementById('attendees-filter-team');
    const catSel = document.getElementById('attendees-filter-cat');
    const attSel = document.getElementById('attendees-filter-att');

    const renderFiltered = () => {
      const q = search.value.toLowerCase();
      const team = teamSel.value;
      const cat = catSel.value;
      const att = attSel.value;

      let filtered = allAttendees;
      if (q) filtered = filtered.filter(a => Helpers.searchFilter(a, q));
      if (team) filtered = filtered.filter(a => a.team === team);
      if (cat) filtered = filtered.filter(a => a.category === cat);
      if (att) filtered = filtered.filter(a => (att === 'present' ? a.attendance === 'present' : a.attendance !== 'present'));

      document.getElementById('attendees-count').textContent = `Showing ${Math.min(filtered.length, PAGE_SIZE)} of ${filtered.length} attendees`;

      const wrap = document.getElementById('attendees-table-wrap');
      wrap.innerHTML = Helpers.buildTable(
        ['ID', 'Name', 'Mobile', 'Team', 'Category', 'Payment', 'Timing', 'Bus', 'Status', 'Actions'],
        filtered.slice(0, PAGE_SIZE).map(a => ({
          _class: a.isDuplicate && !a.dupResolved ? 'duplicate-row' : a.isWalkIn ? 'walkin-row' : '',
          cells: [
            `<span style="font-family:var(--font-mono);font-size:.75rem">${a.attendeeId}</span>`,
            a.name + (a.isDuplicate && !a.dupResolved ? ' <span class="badge dup">dup</span>' : '') + (a.isWalkIn ? ' <span class="badge walkin">WI</span>' : ''),
            a.mobile,
            a.team || '-',
            a.category || '-',
            Helpers.currency(a.paymentAmount),
            a.paymentTiming ? `<span class="badge ${a.paymentTiming === 'Before Event' ? 'before' : 'after'}">${a.paymentTiming}</span>` : '-',
            a.busRoute || '-',
            `<span class="badge ${a.attendance === 'present' ? 'present' : 'absent'}">${a.attendance || 'absent'}</span>`,
            `<button class="btn-small" onclick="App.showAttendeeDetail(${a.id})">View</button>
             <button class="btn-small ${a.attendance === 'present' ? 'danger' : 'success'}" onclick="${a.attendance === 'present' ? `App.unmarkAttendance(${a.id})` : `App.markAttendance(${a.id})`}; App.initAttendees()">
             ${a.attendance === 'present' ? 'Undo' : '✅'}</button>
             ${a.isDuplicate && !a.dupResolved ? `<button class="btn-small warning" onclick="App.resolveDuplicate(${a.id})">Resolve</button>` : ''}`
          ]
        }))
      );

      // Export button
      if (!document.getElementById('export-att-btn')) {
        const btn = document.createElement('button');
        btn.id = 'export-att-btn';
        btn.className = 'btn-secondary';
        btn.textContent = '⬇ Export All';
        btn.style.marginBottom = '1rem';
        btn.onclick = () => Export.exportAttendees(filtered);
        const countEl = document.getElementById('attendees-count');
        countEl.parentNode.insertBefore(btn, countEl);
      }
    };

    [search, teamSel, catSel, attSel].forEach(el => el.addEventListener('input', Helpers.debounce(renderFiltered, 200)));
    renderFiltered();
  }

  async function resolveDuplicate(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    Helpers.modal(`
      <h3 class="modal-title">Resolve Duplicate</h3>
      <p style="color:var(--text-secondary);margin-bottom:1rem">${a.name} (${a.mobile}) appears to be a duplicate of: <strong>${a._dupOf}</strong></p>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App.acceptDuplicate(${id})">Accept as Unique</button>
        <button class="btn-danger" onclick="App.deleteDuplicate(${id})">Remove This Entry</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
      </div>
    `);
  }

  async function acceptDuplicate(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    a.dupResolved = true;
    await DB.put(DB.STORES.attendees, a);
    Helpers.closeModal();
    Helpers.toast('Marked as unique', 'success');
    initAttendees();
  }

  async function deleteDuplicate(id) {
    await DB.deleteRecord(DB.STORES.attendees, id);
    Helpers.closeModal();
    Helpers.toast('Duplicate removed', 'success');
    initAttendees();
  }

  // ===== REPORTS =====
  function initReports() {
    document.querySelectorAll('.rep-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.rep-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        loadReport(tab.dataset.report);
      });
    });
    loadReport('overview');
  }

  async function loadReport(type) {
    const el = document.getElementById('report-content');
    el.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">Loading report...</p>';
    try {
      let html = '';
      switch (type) {
        case 'overview': html = Reports.renderOverview(await Reports.reportOverview()); break;
        case 'payment': html = Reports.renderPayment(await Reports.reportPayment()); break;
        case 'reference': html = Reports.renderReference(await Reports.reportReference()); break;
        case 'transport': html = Reports.renderTransport(await Reports.reportTransport()); break;
        case 'summary': html = Reports.renderSummary(await Reports.reportSummary()); break;
      }
      el.innerHTML = html;
    } catch (err) {
      el.innerHTML = `<p style="color:var(--danger);padding:2rem">Error loading report: ${err.message}</p>`;
    }
  }

  // ===== SETTINGS =====
  async function initSettings() {
    // Load event config
    document.getElementById('cfg-event-name').value = await DB.getConfig('eventName') || '';
    document.getElementById('cfg-event-date').value = await DB.getConfig('eventDate') || '';
    document.getElementById('cfg-charge-per-person').value = await DB.getConfig('chargePerPerson') || '';

    document.getElementById('btn-save-event-cfg').onclick = async () => {
      await DB.setConfig('eventName', document.getElementById('cfg-event-name').value);
      await DB.setConfig('eventDate', document.getElementById('cfg-event-date').value);
      await DB.setConfig('chargePerPerson', document.getElementById('cfg-charge-per-person').value);

      // Recalculate payment timing for all attendees
      const eventDate = document.getElementById('cfg-event-date').value;
      if (eventDate) {
        const all = await DB.getAll(DB.STORES.attendees);
        for (const a of all) {
          a.paymentTiming = Helpers.paymentTiming(a.paymentDate, eventDate);
          await DB.put(DB.STORES.attendees, a);
        }
      }
      Helpers.toast('Configuration saved!', 'success');
    };

    renderBusRoutes();
    renderUsers();

    document.getElementById('btn-add-bus-route').onclick = showAddBusRouteModal;
    document.getElementById('btn-add-user').onclick = showAddUserModal;

    document.getElementById('btn-clear-attendance').onclick = () => {
      if (confirm('Clear ALL attendance records? This cannot be undone.')) {
        DB.getAll(DB.STORES.attendees).then(async all => {
          for (const a of all) {
            a.attendance = 'absent'; a.entryTime = null; a.markedBy = null;
            await DB.put(DB.STORES.attendees, a);
          }
          Helpers.toast('All attendance cleared', 'warning');
        });
      }
    };

    document.getElementById('btn-clear-all').onclick = () => {
      if (confirm('RESET ALL DATA? This will delete all attendees and settings.')) {
        DB.clearStore(DB.STORES.attendees).then(() => {
          DB.clearStore(DB.STORES.busRoutes);
          DB.clearStore(DB.STORES.auditLog);
          Helpers.toast('All data reset', 'warning');
          navigate('dashboard');
        });
      }
    };
  }

  async function renderBusRoutes() {
    const routes = await DB.getAll(DB.STORES.busRoutes);
    const el = document.getElementById('bus-routes-list');
    el.innerHTML = routes.map(r => `
      <div class="bus-route-row">
        <div class="bus-route-info">
          <div class="bus-route-name">🚌 ${r.name}</div>
          <div class="bus-route-meta">Capacity: ${r.capacity} · Cost: ₹${r.cost} · Charge/Person: ₹${r.chargePerPassenger}</div>
        </div>
        <button class="btn-small danger" onclick="App.deleteBusRoute(${r.id})">✕</button>
      </div>
    `).join('') || '<p style="color:var(--text-muted);font-size:.85rem">No bus routes configured</p>';
  }

  function showAddBusRouteModal() {
    Helpers.modal(`
      <h3 class="modal-title">Add Bus Route</h3>
      <div class="input-group" style="margin-bottom:.75rem"><label>Route Name</label><input id="m-route-name" type="text" placeholder="e.g. North Route" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Capacity</label><input id="m-route-cap" type="number" placeholder="50" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Bus Cost (₹)</label><input id="m-route-cost" type="number" placeholder="5000" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Charge Per Passenger (₹)</label><input id="m-route-charge" type="number" placeholder="100" /></div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App.saveBusRoute()">Save Route</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
      </div>
    `);
  }

  async function saveBusRoute() {
    const name = document.getElementById('m-route-name').value.trim();
    if (!name) { Helpers.toast('Route name required', 'error'); return; }
    await DB.add(DB.STORES.busRoutes, {
      name,
      capacity: parseInt(document.getElementById('m-route-cap').value) || 0,
      cost: parseFloat(document.getElementById('m-route-cost').value) || 0,
      chargePerPassenger: parseFloat(document.getElementById('m-route-charge').value) || 0
    });
    Helpers.closeModal();
    Helpers.toast('Bus route added', 'success');
    renderBusRoutes();
  }

  async function deleteBusRoute(id) {
    await DB.deleteRecord(DB.STORES.busRoutes, id);
    renderBusRoutes();
    Helpers.toast('Route removed', 'warning');
  }

  async function renderUsers() {
    const users = await DB.getAll(DB.STORES.users);
    const el = document.getElementById('users-list');
    el.innerHTML = users.map(u => `
      <div class="bus-route-row">
        <div class="bus-route-info">
          <div class="bus-route-name">👤 ${u.name}</div>
          <div class="bus-route-meta">${u.username} · ${u.role}</div>
        </div>
        ${u.username !== 'admin' ? `<button class="btn-small danger" onclick="App.deleteUser('${u.username}')">✕</button>` : ''}
      </div>
    `).join('');
  }

  function showAddUserModal() {
    Helpers.modal(`
      <h3 class="modal-title">Add User</h3>
      <div class="input-group" style="margin-bottom:.75rem"><label>Full Name</label><input id="m-user-name" type="text" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Username</label><input id="m-user-un" type="text" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Password</label><input id="m-user-pw" type="password" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Role</label>
        <select id="m-user-role"><option value="volunteer">Volunteer</option><option value="admin">Admin</option></select></div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App.saveUser()">Add User</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
      </div>
    `);
  }

  async function saveUser() {
    const name = document.getElementById('m-user-name').value.trim();
    const username = document.getElementById('m-user-un').value.trim();
    const password = document.getElementById('m-user-pw').value;
    const role = document.getElementById('m-user-role').value;
    if (!name || !username || !password) { Helpers.toast('All fields required', 'error'); return; }
    await DB.put(DB.STORES.users, { username, password, name, role });
    Helpers.closeModal();
    Helpers.toast('User added', 'success');
    renderUsers();
  }

  async function deleteUser(username) {
    await DB.deleteRecord(DB.STORES.users, username);
    renderUsers();
    Helpers.toast('User removed', 'warning');
  }

  // ===== NETWORK STATUS =====
  function updateNetworkStatus() {
    const el = document.getElementById('sync-status');
    if (navigator.onLine) {
      el.textContent = '● Online';
      el.className = 'sync-status online';
      processOfflineQueue();
    } else {
      el.textContent = '● Offline';
      el.className = 'sync-status offline';
    }
  }

  function processOfflineQueue() {
    if (offlineQueue.length === 0) return;
    document.getElementById('offline-badge').classList.add('hidden');
    offlineQueue = [];
  }

  // ===== PUBLIC API =====
  return {
    init, navigate,
    markAttendance, unmarkAttendance, showAttendeeDetail, showAdmitConfirm,
    resolveDuplicate, acceptDuplicate, deleteDuplicate,
    saveBusRoute, deleteBusRoute, deleteUser, saveUser,
    initAttendees
  };
})();

// Init on load
document.addEventListener('DOMContentLoaded', App.init);
