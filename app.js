// ===== MAIN APP =====
const App = (() => {
  let currentUser = null; // { uid, name, email, role }
  let currentPage = 'attendance';
  let scannerStream = null;
  let allAttendees = [];
  let attendeesPage = 1;
  const PAGE_SIZE = 100;

  // ===== INIT =====
  async function init() {
    await DB.open();

    // Firebase Auth state listener — handles persistent login
    auth.onAuthStateChanged(async (firebaseUser) => {
      const splash = document.getElementById('splash');
      splash.style.opacity = '0';
      setTimeout(() => { splash.style.display = 'none'; }, 500);

      if (firebaseUser) {
        const profile = await DB.getUserProfile(firebaseUser.uid);
        if (profile) {
          currentUser = { uid: firebaseUser.uid, email: firebaseUser.email, ...profile };
        } else {
          // Profile doesn't exist yet (first login after migration)
          currentUser = { uid: firebaseUser.uid, email: firebaseUser.email, name: firebaseUser.email.split('@')[0], role: 'admin' };
          await DB.setUserProfile(firebaseUser.uid, { name: currentUser.name, role: currentUser.role, email: currentUser.email });
        }
        await enterApp();
      } else {
        document.getElementById('screen-login').classList.remove('hidden');
        document.getElementById('screen-app').classList.add('hidden');
        document.getElementById('login-email').focus();
      }
    });

    // Login events
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
    document.getElementById('btn-register').addEventListener('click', handleRegister);
    document.getElementById('btn-forgot-pw').addEventListener('click', handleForgotPassword);
    document.getElementById('btn-logout').addEventListener('click', handleLogout);

    // Password eye toggles
    document.querySelectorAll('.pw-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const input = btn.previousElementSibling;
        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';
        btn.textContent = isPassword ? '🙈' : '👁';
      });
    });

    // Login tab switching
    document.getElementById('tab-login').addEventListener('click', () => switchLoginTab('login'));
    document.getElementById('tab-register').addEventListener('click', () => switchLoginTab('register'));

    // Sidebar
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

  function switchLoginTab(tab) {
    document.getElementById('login-form-panel').classList.toggle('hidden', tab !== 'login');
    document.getElementById('register-form-panel').classList.toggle('hidden', tab !== 'register');
    document.getElementById('tab-login').classList.toggle('active', tab === 'login');
    document.getElementById('tab-register').classList.toggle('active', tab !== 'login');
    document.getElementById('login-error').classList.add('hidden');
  }

  // ===== AUTH (Firebase) =====
  async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');

    if (!email || !password) {
      errEl.textContent = 'Please enter email and password';
      errEl.classList.remove('hidden'); return;
    }

    try {
      errEl.classList.add('hidden');
      document.getElementById('btn-login').disabled = true;
      document.getElementById('btn-login').textContent = 'Signing in...';
      await auth.signInWithEmailAndPassword(email, password);
      // onAuthStateChanged will handle the rest
    } catch (err) {
      let msg = 'Login failed';
      if (err.code === 'auth/user-not-found') msg = 'No account found with this email';
      else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = 'Incorrect password';
      else if (err.code === 'auth/invalid-email') msg = 'Invalid email address';
      else if (err.code === 'auth/too-many-requests') msg = 'Too many attempts. Try again later';
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    } finally {
      document.getElementById('btn-login').disabled = false;
      document.getElementById('btn-login').textContent = 'Sign In';
    }
  }

  async function handleRegister() {
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const errEl = document.getElementById('login-error');

    if (!name || !email || !password) {
      errEl.textContent = 'All fields are required';
      errEl.classList.remove('hidden'); return;
    }
    if (password.length < 6) {
      errEl.textContent = 'Password must be at least 6 characters';
      errEl.classList.remove('hidden'); return;
    }

    try {
      errEl.classList.add('hidden');
      document.getElementById('btn-register').disabled = true;
      document.getElementById('btn-register').textContent = 'Creating account...';
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await DB.setUserProfile(cred.user.uid, { name, email, role: 'admin', createdAt: new Date().toISOString() });
      // onAuthStateChanged handles entry
    } catch (err) {
      let msg = 'Registration failed';
      if (err.code === 'auth/email-already-in-use') msg = 'An account with this email already exists';
      else if (err.code === 'auth/weak-password') msg = 'Password is too weak (min 6 characters)';
      else if (err.code === 'auth/invalid-email') msg = 'Invalid email address';
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    } finally {
      document.getElementById('btn-register').disabled = false;
      document.getElementById('btn-register').textContent = 'Create Account';
    }
  }

  async function handleForgotPassword() {
    const email = document.getElementById('login-email').value.trim();
    if (!email) {
      Helpers.toast('Enter your email first, then click Forgot Password', 'warning');
      document.getElementById('login-email').focus();
      return;
    }
    try {
      await auth.sendPasswordResetEmail(email);
      Helpers.toast('Password reset email sent! Check your inbox.', 'success', 5000);
    } catch (err) {
      if (err.code === 'auth/user-not-found') Helpers.toast('No account found with this email', 'error');
      else Helpers.toast('Could not send reset email. Try again.', 'error');
    }
  }

  async function enterApp() {
    // Update sidebar UI
    document.getElementById('sidebar-username').textContent = currentUser.name;
    document.getElementById('sidebar-role').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Volunteer';
    document.getElementById('sidebar-avatar').textContent = currentUser.name[0].toUpperCase();

    // Show/hide admin elements
    document.querySelectorAll('.admin-only, .admin-page').forEach(el => {
      el.style.display = currentUser.role === 'admin' ? '' : 'none';
    });

    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('screen-app').classList.remove('hidden');

    // Load events and set active event
    await loadEventSelector();

    // Navigate to attendance (main purpose)
    navigate('attendance');
  }

  function handleLogout() {
    currentUser = null;
    stopScanner();
    auth.signOut();
    // onAuthStateChanged handles UI
    document.getElementById('login-password').value = '';
    document.getElementById('login-email').value = '';
  }

  // ===== EVENT MANAGEMENT =====
  async function loadEventSelector() {
    const events = await DB.getEvents();
    const selector = document.getElementById('event-selector');
    const activeId = DB.getCurrentEvent();

    if (events.length === 0) {
      // No events, create a default one
      const id = await DB.createEvent({
        name: 'Prerna Festival 2025',
        date: '',
        chargePerPerson: 0,
        totalExpense: 0,
        financialYear: Helpers.getFinancialYear(new Date().toISOString()),
        createdBy: currentUser?.uid || ''
      });
      DB.setCurrentEvent(id);
      await loadEventSelector();
      return;
    }

    selector.innerHTML = events.map(e =>
      `<option value="${e.id}" ${e.id === activeId ? 'selected' : ''}>${e.name}${e.date ? ' (' + Helpers.formatDate(e.date) + ')' : ''}</option>`
    ).join('');

    // Set active event
    if (!activeId || !events.find(e => e.id === activeId)) {
      DB.setCurrentEvent(events[0].id);
      selector.value = events[0].id;
    }

    // Event change handler
    selector.onchange = () => {
      DB.setCurrentEvent(selector.value);
      navigate(currentPage); // reload current page with new event
    };
  }

  function showCreateEventModal() {
    Helpers.modal(`
      <h3 class="modal-title">Create New Event</h3>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Event Name</label>
        <input id="m-evt-name" type="text" placeholder="e.g. Prerna Festival 2026" />
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Event Date</label>
        <input id="m-evt-date" type="date" />
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Charge Per Person (₹)</label>
        <input id="m-evt-charge" type="number" placeholder="0" min="0" />
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Total Expense Budget (₹)</label>
        <input id="m-evt-expense" type="number" placeholder="0" min="0" />
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App.createEvent()">Create Event</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
      </div>
    `);
  }

  async function createEvent() {
    const name = document.getElementById('m-evt-name').value.trim();
    const date = document.getElementById('m-evt-date').value;
    const charge = parseFloat(document.getElementById('m-evt-charge').value) || 0;
    const expense = parseFloat(document.getElementById('m-evt-expense').value) || 0;

    if (!name) { Helpers.toast('Event name required', 'error'); return; }

    const fy = date ? Helpers.getFinancialYear(date) : Helpers.getFinancialYear(new Date().toISOString());
    const id = await DB.createEvent({
      name, date, chargePerPerson: charge, totalExpense: expense,
      financialYear: fy, createdBy: currentUser?.uid || ''
    });

    DB.setCurrentEvent(id);
    Helpers.closeModal();
    Helpers.toast('Event created!', 'success');
    await loadEventSelector();
    navigate('attendance');
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
      attendees: 'Attendees', reports: 'Reports',
      settings: 'Settings', financial: 'Financial Year'
    };
    document.getElementById('page-title').textContent = titles[page] || page;
    currentPage = page;

    switch (page) {
      case 'dashboard': initDashboard(); break;
      case 'import': initImport(); break;
      case 'attendance': initAttendance(); break;
      case 'walkin': initWalkin(); break;
      case 'attendees': initAttendees(); break;
      case 'reports': initReports(); break;
      case 'settings': initSettings(); break;
      case 'financial': initFinancial(); break;
    }
  }

  // ===== DASHBOARD =====
  async function initDashboard() {
    try {
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
    } catch (err) {
      if (err.message === 'No event selected') {
        document.getElementById('page-dashboard').innerHTML = '<div class="card"><h3 class="card-title">No Event Selected</h3><p>Create or select an event to get started.</p></div>';
      }
    }
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
    { key: 'name', label: 'Name *', required: true },
    { key: 'mobile', label: 'Mobile Number *', required: true },
    { key: 'category', label: 'Category' },
    { key: 'reference', label: 'Reference' },
    { key: 'team', label: 'Team Name' },
    { key: 'paymentStatus', label: 'Payment Status' },
    { key: 'paymentMode', label: 'Mode of Payment' },
    { key: 'paymentAmount', label: 'Payment Amount' },
    { key: 'paymentDate', label: 'Payment Date' },
    { key: 'remarks', label: 'Remarks' },
    { key: 'busRoute', label: 'Bus Route' }
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
      const r = { attendance: 'absent', isWalkIn: false, paymentStatus: 'unpaid', paymentMode: '', remarks: '' };
      SYSTEM_FIELDS.forEach(f => {
        if (f.key in mapping) {
          let val = row[mapping[f.key]];
          if (val instanceof Date) val = val.toISOString().slice(0, 10);
          r[f.key] = val !== undefined ? String(val).trim() : '';
        }
      });

      // Normalize payment status
      const ps = (r.paymentStatus || '').toLowerCase().trim();
      if (ps === 'paid' || ps === 'yes' || ps === 'done') r.paymentStatus = 'paid';
      else if (ps === 'free' || ps === 'complimentary' || ps === 'na') r.paymentStatus = 'free';
      else r.paymentStatus = 'unpaid';

      // Normalize payment mode
      const pm = (r.paymentMode || '').toLowerCase().trim();
      if (pm.includes('cash')) r.paymentMode = 'cash';
      else if (pm.includes('online') || pm.includes('upi') || pm.includes('neft') || pm.includes('gpay') || pm.includes('phonepe')) r.paymentMode = 'online';

      r.attendeeId = Helpers.generateId();
      r.paymentTiming = Helpers.paymentTiming(r.paymentDate, eventDate);
      r.paymentAmount = parseFloat(r.paymentAmount) || 0;
      return r;
    }).filter(r => r.name);

    // Detect duplicates
    const dupIds = Helpers.detectDuplicates(records);
    records.forEach((r, i) => { r.isDuplicate = dupIds.has(i); });

    // Clear and bulk add
    Helpers.toast('Importing ' + records.length + ' records...', 'info');
    await DB.clearStore(DB.STORES.attendees);
    await DB.bulkAdd(DB.STORES.attendees, records);
    await DB.log('import', `Imported ${records.length} records (${dupIds.size} duplicates)`, currentUser?.email);

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
        ['Name', 'Mobile', 'Team', 'Category', 'Payment', 'Mode', 'Status'],
        filtered.slice(0, 200).map(r => ({
          _class: r.isDuplicate ? 'duplicate-row' : '',
          cells: [
            r.name, r.mobile, r.team || '-', r.category || '-',
            `<span class="badge ${r.paymentStatus === 'paid' ? 'present' : r.paymentStatus === 'free' ? 'before' : 'unpaid'}">${r.paymentStatus}</span>`,
            r.paymentMode || '-',
            r.isDuplicate ? `<span class="badge dup">Dup: ${r._dupOf || ''}</span>` : '<span class="badge present">Clean</span>'
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

    setTimeout(() => searchInput.focus(), 100);
  }

  async function updateAdmitCounters() {
    try {
      const all = await DB.getAll(DB.STORES.attendees);
      const present = all.filter(a => a.attendance === 'present');
      const el1 = document.getElementById('admit-count-present');
      const el2 = document.getElementById('admit-count-total');
      if (el1) el1.textContent = present.length;
      if (el2) el2.textContent = all.length;
    } catch {}
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
    const ps = (a.paymentStatus || '').toLowerCase();
    if (ps === 'paid' || ps === 'free') return { color: 'green', label: ps === 'free' ? 'Free' : 'Paid', cls: 'status-paid' };
    // Fallback: check amount
    const amt = parseFloat(a.paymentAmount || 0);
    if (amt > 0) return { color: 'green', label: 'Paid', cls: 'status-paid' };
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
        <div class="att-result-card ${ps.cls}" onclick="App.showAdmitConfirm('${a.id}')" data-id="${a.id}">
          <div class="att-status-indicator ${ps.cls}"></div>
          <div class="att-result-info">
            <div class="att-name">${a.name} ${a.isWalkIn ? '<span class="badge walkin">Walk-in</span>' : ''}</div>
            <div class="att-meta">${a.mobile || '-'} · ${a.team || '-'} · ${a.attendeeId || ''}</div>
            <div class="att-payment-badge ${ps.cls}">${ps.label}${isPres ? ` by ${a.markedBy || '?'} at ${Helpers.formatDateTime(a.entryTime)}` : (a.paymentMode ? ' · ' + a.paymentMode : '')}</div>
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
        <button class="btn-danger admit-btn" onclick="App.unmarkAttendance('${a.id}');Helpers.closeModal()">Undo Check-in</button>
      `;
    } else {
      actionHtml = `<button class="btn-primary admit-btn ${ps.cls}" onclick="App.markAttendance('${a.id}');Helpers.closeModal()">Confirm & Mark Present</button>`;
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
          <div class="admit-row"><span>Payment</span><span class="badge ${a.paymentStatus === 'paid' ? 'present' : a.paymentStatus === 'free' ? 'before' : 'unpaid'}">${a.paymentStatus || 'unpaid'}</span></div>
          <div class="admit-row"><span>Mode</span><span>${a.paymentMode || '-'}</span></div>
          <div class="admit-row"><span>Amount</span><span>${Helpers.currency(a.paymentAmount)}</span></div>
          <div class="admit-row"><span>Remarks</span><span>${a.remarks || '-'}</span></div>
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
    await DB.log('checkin', `${attendee.name} checked in`, currentUser?.email);
    Helpers.toast(`${attendee.name} checked in!`, 'success');

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
      let attendeeId = null;
      try {
        const parsed = JSON.parse(input);
        attendeeId = parsed.id || parsed.aid;
      } catch { attendeeId = input; }

      const all = await DB.getAll(DB.STORES.attendees);
      const found = all.find(a =>
        String(a.id) === String(attendeeId) ||
        a.attendeeId === attendeeId ||
        a.mobile === input.replace(/\D/g, '')
      );

      if (!found) {
        feedback.className = 'scan-feedback error';
        feedback.textContent = `Not found: "${input}"`;
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
        `<p style="margin-top:1rem;color:var(--success)">Marked ${matched} attendees present. ${notFound} not found.</p>`;
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
        <tr><td style="color:var(--text-muted);padding:.4rem">Payment Status</td><td><span class="badge ${a.paymentStatus === 'paid' ? 'present' : a.paymentStatus === 'free' ? 'before' : 'unpaid'}">${a.paymentStatus || 'unpaid'}</span></td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Payment Mode</td><td>${a.paymentMode || '-'}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Amount</td><td>${Helpers.currency(a.paymentAmount)}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Remarks</td><td>${a.remarks || '-'}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Bus Route</td><td>${a.busRoute || '-'}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Attendance</td><td><span class="badge ${a.attendance}">${a.attendance || 'absent'}</span></td></tr>
        ${a.attendance === 'present' ? `<tr><td style="color:var(--text-muted);padding:.4rem">Entry Time</td><td>${Helpers.formatDateTime(a.entryTime)}</td></tr>
        <tr><td style="color:var(--text-muted);padding:.4rem">Marked By</td><td>${a.markedBy}</td></tr>` : ''}
        ${a.isDuplicate ? `<tr><td style="color:var(--danger);padding:.4rem">Duplicate</td><td>Matches: ${a._dupOf}</td></tr>` : ''}
      </table>
      <div class="modal-actions">
        ${a.attendance !== 'present' ? `<button class="btn-primary" onclick="App.markAttendance('${a.id}');Helpers.closeModal()">Mark Present</button>` : ''}
        <button class="btn-ghost" onclick="Helpers.closeModal()">Close</button>
      </div>
    `);
  }

  // ===== WALK-IN =====
  function initWalkin() { renderWalkinList(); }

  function initWalkinPanel() {
    DB.getAll(DB.STORES.attendees).then(all => {
      const teams = [...new Set(all.map(a => a.team).filter(Boolean))];
      document.getElementById('team-list').innerHTML = teams.map(t => `<option value="${t}">`).join('');
    });
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
    const payStatus = document.getElementById('wi-paystatus').value;
    const payMode = document.getElementById('wi-paymode').value;
    const remarks = document.getElementById('wi-remarks')?.value?.trim() || '';
    const fb = document.getElementById('walkin-feedback');

    if (!name || !mobile) {
      fb.className = 'scan-feedback error';
      fb.textContent = 'Name and Mobile are required';
      fb.classList.remove('hidden'); return;
    }

    const eventDate = await DB.getConfig('eventDate');
    const record = {
      name, mobile, reference,
      paymentAmount: parseFloat(payment) || 0,
      paymentDate: paydate,
      paymentTiming: Helpers.paymentTiming(paydate, eventDate),
      paymentStatus: payStatus || 'unpaid',
      paymentMode: payMode || '',
      remarks,
      team, category, busRoute,
      attendeeId: Helpers.generateId('WI'),
      attendance: 'present',
      entryTime: new Date().toISOString(),
      markedBy: currentUser?.name,
      isWalkIn: true,
      isDuplicate: false
    };

    await DB.add(DB.STORES.attendees, record);
    await DB.log('walkin', `Walk-in: ${name}`, currentUser?.email);

    fb.className = 'scan-feedback success';
    fb.textContent = `${name} added and checked in!`;
    fb.classList.remove('hidden');
    setTimeout(() => fb.classList.add('hidden'), 3000);

    clearWalkinForm();
    document.getElementById('walkin-panel').classList.add('hidden');
    updateAdmitCounters();
    Helpers.toast(`Walk-in ${name} registered!`, 'success');
  }

  function clearWalkinForm() {
    ['wi-name','wi-mobile','wi-reference','wi-payment','wi-team','wi-busroute','wi-remarks'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const cat = document.getElementById('wi-category');
    if (cat) cat.value = '';
    const ps = document.getElementById('wi-paystatus');
    if (ps) ps.value = 'unpaid';
    const pm = document.getElementById('wi-paymode');
    if (pm) pm.value = '';
    const pd = document.getElementById('wi-paydate');
    if (pd) pd.value = new Date().toISOString().slice(0, 10);
  }

  async function renderWalkinList() {
    const all = await DB.getAll(DB.STORES.attendees);
    const walkins = all.filter(a => a.isWalkIn).reverse();
    const el = document.getElementById('walkin-list');
    el.innerHTML = walkins.length ? Helpers.buildTable(
      ['Name', 'Mobile', 'Reference', 'Team', 'Payment', 'Mode', 'Entry'],
      walkins.map(a => ({
        _class: 'walkin-row',
        cells: [a.name, a.mobile, a.reference, a.team || '-',
          `<span class="badge ${a.paymentStatus === 'paid' ? 'present' : a.paymentStatus === 'free' ? 'before' : 'unpaid'}">${a.paymentStatus}</span>`,
          a.paymentMode || '-', Helpers.formatDateTime(a.entryTime)]
      }))
    ) : '<p style="color:var(--text-muted);padding:1rem">No walk-ins yet</p>';
  }

  // ===== ATTENDEES =====
  async function initAttendees() {
    allAttendees = await DB.getAll(DB.STORES.attendees);
    attendeesPage = 1;

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
        ['ID', 'Name', 'Mobile', 'Team', 'Category', 'Payment', 'Mode', 'Status', 'Actions'],
        filtered.slice(0, PAGE_SIZE).map(a => ({
          _class: a.isDuplicate && !a.dupResolved ? 'duplicate-row' : a.isWalkIn ? 'walkin-row' : '',
          cells: [
            `<span style="font-family:var(--font-mono);font-size:.75rem">${a.attendeeId}</span>`,
            a.name + (a.isDuplicate && !a.dupResolved ? ' <span class="badge dup">dup</span>' : '') + (a.isWalkIn ? ' <span class="badge walkin">WI</span>' : ''),
            a.mobile,
            a.team || '-',
            a.category || '-',
            `<span class="badge ${a.paymentStatus === 'paid' ? 'present' : a.paymentStatus === 'free' ? 'before' : 'unpaid'}">${a.paymentStatus || 'unpaid'}</span>`,
            a.paymentMode || '-',
            `<span class="badge ${a.attendance === 'present' ? 'present' : 'absent'}">${a.attendance || 'absent'}</span>`,
            `<button class="btn-small" onclick="App.showAttendeeDetail('${a.id}')">View</button>
             <button class="btn-small ${a.attendance === 'present' ? 'danger' : 'success'}" onclick="${a.attendance === 'present' ? `App.unmarkAttendance('${a.id}')` : `App.markAttendance('${a.id}')`}; App.initAttendees()">
             ${a.attendance === 'present' ? 'Undo' : 'Admit'}</button>
             ${a.isDuplicate && !a.dupResolved ? `<button class="btn-small warning" onclick="App.resolveDuplicate('${a.id}')">Resolve</button>` : ''}`
          ]
        }))
      );

      if (!document.getElementById('export-att-btn')) {
        const btn = document.createElement('button');
        btn.id = 'export-att-btn';
        btn.className = 'btn-secondary';
        btn.textContent = 'Export All';
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
        <button class="btn-primary" onclick="App.acceptDuplicate('${id}')">Accept as Unique</button>
        <button class="btn-danger" onclick="App.deleteDuplicate('${id}')">Remove This Entry</button>
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

  // ===== FINANCIAL YEAR =====
  async function initFinancial() {
    const el = document.getElementById('page-financial');
    el.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">Loading financial data...</p>';

    try {
      const events = await DB.getEvents();

      // Group by FY
      const fyMap = {};
      for (const evt of events) {
        const fy = evt.financialYear || Helpers.getFinancialYear(evt.date || evt.createdAt);
        if (!fyMap[fy]) fyMap[fy] = [];

        // Get participant data for this event
        const oldEvent = DB.getCurrentEvent();
        DB.setCurrentEvent(evt.id);
        const participants = await DB.getAll(DB.STORES.attendees);
        DB.setCurrentEvent(oldEvent);

        const totalCollected = participants.reduce((s, p) => s + (parseFloat(p.paymentAmount) || 0), 0);
        const totalExpected = participants.length * (parseFloat(evt.chargePerPerson) || 0);
        const expense = parseFloat(evt.totalExpense) || 0;
        const profitLoss = totalCollected - expense;

        fyMap[fy].push({
          ...evt,
          participantCount: participants.length,
          presentCount: participants.filter(p => p.attendance === 'present').length,
          totalCollected,
          totalExpected,
          expense,
          profitLoss,
          paidCount: participants.filter(p => p.paymentStatus === 'paid').length,
          unpaidCount: participants.filter(p => p.paymentStatus === 'unpaid').length,
          freeCount: participants.filter(p => p.paymentStatus === 'free').length
        });
      }

      // Sort FYs descending
      const sortedFYs = Object.keys(fyMap).sort().reverse();

      let html = '<div class="card"><h3 class="card-title">Financial Year Overview</h3>';

      if (sortedFYs.length === 0) {
        html += '<p style="color:var(--text-muted)">No events found. Create an event to get started.</p>';
      }

      for (const fy of sortedFYs) {
        const evts = fyMap[fy];
        const fyTotal = evts.reduce((s, e) => s + e.totalCollected, 0);
        const fyExpense = evts.reduce((s, e) => s + e.expense, 0);
        const fyPL = fyTotal - fyExpense;

        html += `
          <div style="margin-bottom:1.5rem">
            <h4 style="color:#15803d;margin-bottom:.75rem;display:flex;align-items:center;justify-content:space-between">
              <span>FY ${fy}</span>
              <span style="font-family:var(--font-mono);font-size:.9rem;color:${fyPL >= 0 ? 'var(--success)' : 'var(--danger)'}">
                Net: ${Helpers.currency(fyPL)} ${fyPL >= 0 ? '(Profit)' : '(Loss)'}
              </span>
            </h4>
            <div class="stats-grid" style="margin-bottom:.75rem">
              <div class="stat-card accent"><div class="stat-value" style="font-size:1.2rem">${Helpers.currency(fyTotal)}</div><div class="stat-label">Total Collected</div></div>
              <div class="stat-card warning"><div class="stat-value" style="font-size:1.2rem">${Helpers.currency(fyExpense)}</div><div class="stat-label">Total Expense</div></div>
              <div class="stat-card ${fyPL >= 0 ? 'success' : 'danger'}"><div class="stat-value" style="font-size:1.2rem">${Helpers.currency(Math.abs(fyPL))}</div><div class="stat-label">${fyPL >= 0 ? 'Profit' : 'Loss'}</div></div>
            </div>
            ${Helpers.buildTable(
              ['Event', 'Date', 'Participants', 'Present', 'Paid', 'Unpaid', 'Free', 'Collected', 'Expense', 'P/L'],
              evts.map(e => ({
                cells: [
                  e.name,
                  Helpers.formatDate(e.date) || '-',
                  e.participantCount,
                  e.presentCount,
                  e.paidCount,
                  e.unpaidCount,
                  e.freeCount,
                  Helpers.currency(e.totalCollected),
                  Helpers.currency(e.expense),
                  `<span style="color:${e.profitLoss >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:600">${Helpers.currency(e.profitLoss)}</span>`
                ]
              })),
              { cls: 'report-table' }
            )}
          </div>
        `;
      }

      html += '</div>';
      el.innerHTML = html;
    } catch (err) {
      el.innerHTML = `<p style="color:var(--danger);padding:2rem">Error: ${err.message}</p>`;
    }
  }

  // ===== SETTINGS =====
  async function initSettings() {
    // Event config
    const evt = await DB.getEvent(DB.getCurrentEvent());
    if (evt) {
      document.getElementById('cfg-event-name').value = evt.name || '';
      document.getElementById('cfg-event-date').value = evt.date || '';
      document.getElementById('cfg-charge-per-person').value = evt.chargePerPerson || '';
      document.getElementById('cfg-total-expense').value = evt.totalExpense || '';
    }

    document.getElementById('btn-save-event-cfg').onclick = async () => {
      const name = document.getElementById('cfg-event-name').value;
      const date = document.getElementById('cfg-event-date').value;
      const charge = document.getElementById('cfg-charge-per-person').value;
      const expense = document.getElementById('cfg-total-expense').value;
      const fy = date ? Helpers.getFinancialYear(date) : '';

      await DB.updateEvent(DB.getCurrentEvent(), {
        name, date,
        chargePerPerson: parseFloat(charge) || 0,
        totalExpense: parseFloat(expense) || 0,
        financialYear: fy
      });

      await DB.setConfig('eventName', name);
      await DB.setConfig('eventDate', date);
      await DB.setConfig('chargePerPerson', charge);
      Helpers.toast('Configuration saved!', 'success');
      await loadEventSelector();
    };

    // Profile section
    if (currentUser) {
      document.getElementById('profile-name').value = currentUser.name || '';
      document.getElementById('profile-email').value = currentUser.email || '';
      document.getElementById('profile-role').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Volunteer';
    }

    document.getElementById('btn-save-profile').onclick = async () => {
      const name = document.getElementById('profile-name').value.trim();
      if (!name) { Helpers.toast('Name is required', 'error'); return; }
      await DB.setUserProfile(currentUser.uid, { name });
      currentUser.name = name;
      document.getElementById('sidebar-username').textContent = name;
      document.getElementById('sidebar-avatar').textContent = name[0].toUpperCase();
      Helpers.toast('Profile updated!', 'success');
    };

    document.getElementById('btn-change-pw').onclick = async () => {
      const newPw = document.getElementById('new-password').value;
      if (!newPw || newPw.length < 6) { Helpers.toast('Password must be at least 6 characters', 'error'); return; }
      try {
        await auth.currentUser.updatePassword(newPw);
        document.getElementById('new-password').value = '';
        Helpers.toast('Password changed!', 'success');
      } catch (err) {
        if (err.code === 'auth/requires-recent-login') {
          Helpers.toast('Please log out and log back in, then try again', 'warning');
        } else {
          Helpers.toast('Failed to change password: ' + err.message, 'error');
        }
      }
    };

    renderBusRoutes();
    renderUsers();

    document.getElementById('btn-add-bus-route').onclick = showAddBusRouteModal;
    document.getElementById('btn-add-user').onclick = showAddUserModal;

    document.getElementById('btn-clear-attendance').onclick = async () => {
      if (confirm('Clear ALL attendance records? This cannot be undone.')) {
        const all = await DB.getAll(DB.STORES.attendees);
        for (const a of all) {
          a.attendance = 'absent'; a.entryTime = null; a.markedBy = null;
          await DB.put(DB.STORES.attendees, a);
        }
        Helpers.toast('All attendance cleared', 'warning');
      }
    };

    document.getElementById('btn-clear-all').onclick = async () => {
      if (confirm('RESET ALL DATA for this event? This will delete all participants.')) {
        await DB.clearStore(DB.STORES.attendees);
        await DB.clearStore(DB.STORES.busRoutes);
        await DB.clearStore(DB.STORES.auditLog);
        Helpers.toast('All data reset', 'warning');
        navigate('dashboard');
      }
    };
  }

  async function renderBusRoutes() {
    const routes = await DB.getAll(DB.STORES.busRoutes);
    const el = document.getElementById('bus-routes-list');
    el.innerHTML = routes.map(r => `
      <div class="bus-route-row">
        <div class="bus-route-info">
          <div class="bus-route-name">Bus: ${r.name}</div>
          <div class="bus-route-meta">Capacity: ${r.capacity} | Cost: ${Helpers.currency(r.cost)} | Charge/Person: ${Helpers.currency(r.chargePerPassenger)}</div>
        </div>
        <button class="btn-small danger" onclick="App.deleteBusRoute('${r.id}')">X</button>
      </div>
    `).join('') || '<p style="color:var(--text-muted);font-size:.85rem">No bus routes configured</p>';
  }

  function showAddBusRouteModal() {
    Helpers.modal(`
      <h3 class="modal-title">Add Bus Route</h3>
      <div class="input-group" style="margin-bottom:.75rem"><label>Route Name</label><input id="m-route-name" type="text" placeholder="e.g. North Route" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Capacity</label><input id="m-route-cap" type="number" placeholder="50" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Bus Cost</label><input id="m-route-cost" type="number" placeholder="5000" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Charge Per Passenger</label><input id="m-route-charge" type="number" placeholder="100" /></div>
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
    // Show Firebase users from Firestore (admin can add volunteers)
    const snap = await firestore.collection('users').get();
    const users = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
    const el = document.getElementById('users-list');
    el.innerHTML = users.map(u => `
      <div class="bus-route-row">
        <div class="bus-route-info">
          <div class="bus-route-name">${u.name}</div>
          <div class="bus-route-meta">${u.email} | ${u.role}</div>
        </div>
        ${u.uid !== currentUser?.uid ? `<button class="btn-small danger" onclick="App.toggleUserRole('${u.uid}','${u.role}')">${u.role === 'admin' ? 'Make Volunteer' : 'Make Admin'}</button>` : '<span class="badge present">You</span>'}
      </div>
    `).join('');
  }

  function showAddUserModal() {
    Helpers.modal(`
      <h3 class="modal-title">Invite User</h3>
      <p style="color:var(--text-secondary);font-size:.85rem;margin-bottom:1rem">
        Ask the person to register on the login page with their email. Once registered, you can change their role here.
      </p>
      <button class="btn-ghost" onclick="Helpers.closeModal()">OK</button>
    `);
  }

  async function toggleUserRole(uid, currentRole) {
    const newRole = currentRole === 'admin' ? 'volunteer' : 'admin';
    await DB.setUserProfile(uid, { role: newRole });
    Helpers.toast(`Role changed to ${newRole}`, 'success');
    renderUsers();
  }

  // ===== NETWORK STATUS =====
  function updateNetworkStatus() {
    const el = document.getElementById('sync-status');
    if (navigator.onLine) {
      el.textContent = 'Online';
      el.className = 'sync-status online';
    } else {
      el.textContent = 'Offline';
      el.className = 'sync-status offline';
    }
  }

  // ===== PUBLIC API =====
  return {
    init, navigate,
    markAttendance, unmarkAttendance, showAttendeeDetail, showAdmitConfirm,
    resolveDuplicate, acceptDuplicate, deleteDuplicate,
    saveBusRoute, deleteBusRoute, toggleUserRole,
    showCreateEventModal, createEvent,
    initAttendees
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
