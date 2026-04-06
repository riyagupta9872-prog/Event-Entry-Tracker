// ===== MAIN APP =====
const App = (() => {
  let currentUser = null;
  let currentPage = 'attendance';
  let scannerStream = null;
  let allAttendees = [];
  let attendeesPage = 1;
  let liveUnsubscribe = null; // Firestore real-time listener
  const PAGE_SIZE = 100;

  // ===== INIT =====
  async function init() {
    await DB.open();

    auth.onAuthStateChanged(async (firebaseUser) => {
      const splash = document.getElementById('splash');
      splash.style.opacity = '0';
      setTimeout(() => { splash.style.display = 'none'; }, 500);

      if (firebaseUser) {
        const profile = await DB.getUserProfile(firebaseUser.uid);
        if (profile) {
          currentUser = { uid: firebaseUser.uid, email: firebaseUser.email, ...profile };
        } else {
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
        btn.textContent = isPassword ? '\u{1F648}' : '\u{1F441}';
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

  // ===== AUTH =====
  async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    if (!email || !password) { errEl.textContent = 'Please enter email and password'; errEl.classList.remove('hidden'); return; }
    try {
      errEl.classList.add('hidden');
      document.getElementById('btn-login').disabled = true;
      document.getElementById('btn-login').textContent = 'Signing in...';
      await auth.signInWithEmailAndPassword(email, password);
    } catch (err) {
      let msg = 'Login failed';
      if (err.code === 'auth/user-not-found') msg = 'No account with this email';
      else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = 'Incorrect password';
      else if (err.code === 'auth/invalid-email') msg = 'Invalid email';
      else if (err.code === 'auth/too-many-requests') msg = 'Too many attempts, try later';
      errEl.textContent = msg; errEl.classList.remove('hidden');
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
    if (!name || !email || !password) { errEl.textContent = 'All fields required'; errEl.classList.remove('hidden'); return; }
    if (password.length < 6) { errEl.textContent = 'Password must be 6+ characters'; errEl.classList.remove('hidden'); return; }
    try {
      errEl.classList.add('hidden');
      document.getElementById('btn-register').disabled = true;
      const cred = await auth.createUserWithEmailAndPassword(email, password);
      await DB.setUserProfile(cred.user.uid, { name, email, role: 'admin', createdAt: new Date().toISOString() });
    } catch (err) {
      let msg = 'Registration failed';
      if (err.code === 'auth/email-already-in-use') msg = 'Email already in use';
      else if (err.code === 'auth/weak-password') msg = 'Password too weak';
      errEl.textContent = msg; errEl.classList.remove('hidden');
    } finally {
      document.getElementById('btn-register').disabled = false;
      document.getElementById('btn-register').textContent = 'Create Account';
    }
  }

  async function handleForgotPassword() {
    const email = document.getElementById('login-email').value.trim();
    if (!email) { Helpers.toast('Enter email first', 'warning'); return; }
    try {
      await auth.sendPasswordResetEmail(email);
      Helpers.toast('Password reset email sent!', 'success', 5000);
    } catch { Helpers.toast('Could not send reset email', 'error'); }
  }

  async function enterApp() {
    document.getElementById('sidebar-username').textContent = currentUser.name;
    document.getElementById('sidebar-role').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Volunteer';
    document.getElementById('sidebar-avatar').textContent = currentUser.name[0].toUpperCase();

    document.querySelectorAll('.admin-only, .admin-page').forEach(el => {
      el.style.display = currentUser.role === 'admin' ? '' : 'none';
    });

    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('screen-app').classList.remove('hidden');

    await loadEventSelector();
    navigate('attendance');
  }

  function handleLogout() {
    currentUser = null;
    stopScanner();
    stopLiveSync();
    auth.signOut();
    document.getElementById('login-password').value = '';
    document.getElementById('login-email').value = '';
  }

  // ===== REAL-TIME SYNC (Firestore onSnapshot) =====
  function startLiveSync() {
    stopLiveSync();
    try {
      const eid = DB.getCurrentEvent();
      if (!eid) return;
      const col = firestore.collection('events').doc(eid).collection('participants');
      liveUnsubscribe = col.onSnapshot(snap => {
        allAttendees = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        updateAdmitCountersFromCache();
        // Re-render search if active
        const q = document.getElementById('att-search')?.value;
        if (q && currentPage === 'attendance') searchAttendeesFromCache(q);
      });
    } catch {}
  }

  function stopLiveSync() {
    if (liveUnsubscribe) { liveUnsubscribe(); liveUnsubscribe = null; }
  }

  function updateAdmitCountersFromCache() {
    const present = allAttendees.filter(a => a.attendance === 'present');
    const el1 = document.getElementById('admit-count-present');
    const el2 = document.getElementById('admit-count-total');
    if (el1) el1.textContent = present.length;
    if (el2) el2.textContent = allAttendees.length;
  }

  // ===== EVENT MANAGEMENT =====
  async function loadEventSelector() {
    const events = await DB.getEvents();
    const selector = document.getElementById('event-selector');
    const activeId = DB.getCurrentEvent();

    if (events.length === 0) {
      const id = await DB.createEvent({
        name: 'Prerna Festival 2025', date: '', chargePerPerson: 0, totalExpense: 0,
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

    if (!activeId || !events.find(e => e.id === activeId)) {
      DB.setCurrentEvent(events[0].id);
      selector.value = events[0].id;
    }

    selector.onchange = () => {
      DB.setCurrentEvent(selector.value);
      startLiveSync();
      navigate(currentPage);
    };

    startLiveSync();
  }

  function showCreateEventModal() {
    Helpers.modal(`
      <h3 class="modal-title">Create New Event</h3>
      <div class="input-group" style="margin-bottom:.75rem"><label>Event Name</label><input id="m-evt-name" type="text" placeholder="e.g. Prerna Festival 2026" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Event Date</label><input id="m-evt-date" type="date" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Charge Per Person</label><input id="m-evt-charge" type="number" placeholder="0" min="0" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Total Expense Budget</label><input id="m-evt-expense" type="number" placeholder="0" min="0" /></div>
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
    const id = await DB.createEvent({ name, date, chargePerPerson: charge, totalExpense: expense, financialYear: fy, createdBy: currentUser?.uid || '' });
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
      attendance: 'Admission', walkin: 'Walk-ins',
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
      const attendees = allAttendees.length ? allAttendees : await DB.getAll(DB.STORES.attendees);
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
      document.getElementById('dash-category-breakdown').innerHTML = Object.entries(catMap).map(([cat, d]) =>
        `<div class="mini-row"><span>${cat}</span><span>${d.present}/${d.total}</span></div>`
      ).join('');

      const logs = await DB.getAll(DB.STORES.auditLog);
      const recent = logs.slice(-8).reverse();
      document.getElementById('dash-activity').innerHTML = recent.length ? recent.map(l =>
        `<div class="activity-item"><div class="activity-dot ${l.action === 'checkin' ? 'green' : 'orange'}"></div><span>${l.details}</span><span class="activity-time">${Helpers.formatDateTime(l.timestamp)}</span></div>`
      ).join('') : '<p style="color:var(--text-muted);font-size:.85rem">No activity yet</p>';
    } catch {}
  }

  // ===== IMPORT =====
  let importData = null;
  let importHeaders = null;

  // Template with headers + 2 sample rows so user knows exact format
  const TEMPLATE_HEADERS = [
    'Name', 'Mobile Number', 'Category', 'Reference', 'Team',
    'Payment Status', 'Mode of Payment', 'Payment Amount', 'Payment Date',
    'Payment Remarks', 'Service/Non-Service Devotee', 'Active/Inactive/New Devotee',
    'Bus Route', 'Pickup Location'
  ];

  const TEMPLATE_SAMPLE = [
    ['Riya Gupta', '9876543210', 'IGF', 'Radha Mataji', 'Balaram',
     'Paid', 'Cash', '500', '2025-03-15',
     'Paid to Riya on 15 March', 'Service', 'Active',
     'North Route', 'Rohini Sec 3'],
    ['Amit Kumar', '8765432109', 'IYF', 'Krishna Prabhu', 'Champaklata',
     'Unpaid', '', '', '',
     '', 'Non-Service', 'New',
     '', 'Dwarka']
  ];

  function downloadTemplate(format) {
    if (format === 'csv') {
      const rows = [TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE];
      const csv = rows.map(r => r.map(c => `"${(c || '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      Helpers.downloadBlob(blob, 'Prerna_Import_Template.csv');
      Helpers.toast('CSV template downloaded', 'success');
    } else {
      const wb = XLSX.utils.book_new();
      const wsData = [TEMPLATE_HEADERS, ...TEMPLATE_SAMPLE];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      // Set column widths
      ws['!cols'] = TEMPLATE_HEADERS.map(h => ({ wch: Math.max(h.length + 4, 18) }));

      XLSX.utils.book_append_sheet(wb, ws, 'Participant Data');

      // Instructions sheet
      const instrData = [
        ['PRERNA FESTIVAL — Import Template Instructions'],
        [''],
        ['Column', 'Required', 'Accepted Values', 'Notes'],
        ['Name', 'YES', 'Any text', 'Full name of the participant'],
        ['Mobile Number', 'YES', '10-digit number', 'Used for duplicate detection'],
        ['Category', 'No', 'IGF / IYF / ICF_MTG / ICF_PRJI', 'Leave blank if unknown'],
        ['Reference', 'No', 'Any text', 'Who referred this person'],
        ['Team', 'No', 'Any text', 'Team/group name from your structure'],
        ['Payment Status', 'No', 'Paid / Unpaid / Partial / Free', 'Auto-detects: Yes=Paid, NA=Free, number=amount'],
        ['Mode of Payment', 'No', 'Cash / Online / UPI', 'How they paid'],
        ['Payment Amount', 'No', 'Number (rupees)', 'If amount > 0 and status blank, auto-marks as Paid'],
        ['Payment Date', 'No', 'Date (YYYY-MM-DD)', 'When payment was received'],
        ['Payment Remarks', 'No', 'Any text', 'Who paid, when, to whom — e.g. "Paid to Riya 20 March"'],
        ['Service/Non-Service', 'No', 'Service / Non-Service', 'Devotee type for reporting'],
        ['Active/Inactive/New', 'No', 'Active / Inactive / New', 'Devotee activity status'],
        ['Bus Route', 'No', 'Route name', 'Must match bus routes configured in Settings'],
        ['Pickup Location', 'No', 'Any text', 'Where they will be picked up'],
        [''],
        ['IMPORTANT NOTES:'],
        ['1. Row 1 must have column headers (already filled in the template)'],
        ['2. Start entering data from Row 2'],
        ['3. Only Name and Mobile are required — everything else is optional'],
        ['4. Column order does not matter — system will auto-detect or you can map manually'],
        ['5. Duplicates are detected by same Mobile + similar Name (case-insensitive)'],
      ];
      const ws2 = XLSX.utils.aoa_to_sheet(instrData);
      ws2['!cols'] = [{ wch: 28 }, { wch: 10 }, { wch: 35 }, { wch: 50 }];
      XLSX.utils.book_append_sheet(wb, ws2, 'Instructions');

      XLSX.writeFile(wb, 'Prerna_Import_Template.xlsx');
      Helpers.toast('Excel template downloaded', 'success');
    }
  }

  function initImport() {
    const zone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('dragover'); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); });
    zone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });
    document.getElementById('btn-confirm-import').addEventListener('click', confirmImport);
    document.getElementById('btn-cancel-import').addEventListener('click', () => { document.getElementById('column-mapping-section').classList.add('hidden'); importData = null; });
  }

  async function processFile(file) {
    Helpers.toast('Processing...', 'info');
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (raw.length < 2) { Helpers.toast('File empty', 'error'); return; }
        importHeaders = raw[0].map(h => String(h).trim());
        importData = raw.slice(1).filter(row => row.some(c => c !== ''));
        showColumnMapping();
      } catch (err) { Helpers.toast('Error: ' + err.message, 'error'); }
    };
    reader.readAsArrayBuffer(file);
  }

  // PRD Section 3: Import columns
  const SYSTEM_FIELDS = [
    { key: 'name', label: 'Name *', required: true },
    { key: 'mobile', label: 'Mobile Number *', required: true },
    { key: 'category', label: 'Category' },
    { key: 'reference', label: 'Reference' },
    { key: 'team', label: 'Team' },
    { key: 'paymentStatus', label: 'Payment Status' },
    { key: 'paymentMode', label: 'Mode of Payment' },
    { key: 'paymentAmount', label: 'Payment Amount' },
    { key: 'paymentDate', label: 'Payment Date' },
    { key: 'remarks', label: 'Payment Remarks' },
    { key: 'serviceStatus', label: 'Service/Non-Service Devotee' },
    { key: 'activeStatus', label: 'Active/Inactive/New Devotee' },
    { key: 'busRoute', label: 'Bus Route' },
    { key: 'pickupLocation', label: 'Pickup Location' }
  ];

  // Smart column name matching aliases
  const FIELD_ALIASES = {
    name: ['name', 'full name', 'naam', 'devotee name', 'participant'],
    mobile: ['mobile', 'phone', 'contact', 'mobile number', 'phone number', 'contact no', 'mob', 'cell'],
    category: ['category', 'cat', 'type', 'group type'],
    reference: ['reference', 'ref', 'counselor', 'referred by', 'counsellor'],
    team: ['team', 'team name', 'group', 'zone', 'area'],
    paymentStatus: ['payment status', 'pay status', 'payment', 'status', 'paid', 'payment received'],
    paymentMode: ['mode of payment', 'payment mode', 'mode', 'pay mode', 'method'],
    paymentAmount: ['payment amount', 'amount', 'fees', 'charge', 'paid amount', 'received'],
    paymentDate: ['payment date', 'pay date', 'date of payment', 'paid date'],
    remarks: ['remarks', 'payment remarks', 'remark', 'notes', 'comment', 'description'],
    serviceStatus: ['service', 'service devotee', 'service status', 'service or non service', 'devotee type'],
    activeStatus: ['active', 'active status', 'active devotee', 'active or inactive', 'activity'],
    busRoute: ['bus route', 'bus', 'route', 'transport'],
    pickupLocation: ['pickup', 'pickup location', 'pickup point', 'pick up']
  };

  function showColumnMapping() {
    const grid = document.getElementById('column-mapping-grid');
    grid.innerHTML = SYSTEM_FIELDS.map(f => {
      const aliases = FIELD_ALIASES[f.key] || [f.key];
      const autoMatch = importHeaders.findIndex(h => {
        const hl = h.toLowerCase().trim();
        return aliases.some(alias => hl === alias || hl.includes(alias) || alias.includes(hl));
      });
      return `<div class="mapping-row"><label>${f.label}</label><select data-field="${f.key}"><option value="">-- Skip --</option>${importHeaders.map((h, i) => `<option value="${i}" ${i === autoMatch ? 'selected' : ''}>${h}</option>`).join('')}</select></div>`;
    }).join('');
    document.getElementById('column-mapping-section').classList.remove('hidden');
    document.getElementById('column-mapping-section').scrollIntoView({ behavior: 'smooth' });
  }

  async function confirmImport() {
    const mapping = {};
    document.querySelectorAll('[data-field]').forEach(sel => {
      if (sel.value !== '') mapping[sel.dataset.field] = parseInt(sel.value);
    });
    if (!('name' in mapping) || !('mobile' in mapping)) { Helpers.toast('Name and Mobile required', 'error'); return; }

    const eventDate = await DB.getConfig('eventDate');
    const records = importData.map(row => {
      const r = { attendance: 'absent', isWalkIn: false, paymentStatus: 'unpaid', paymentMode: '', remarks: '', serviceStatus: '', activeStatus: '' };
      SYSTEM_FIELDS.forEach(f => {
        if (f.key in mapping) {
          let val = row[mapping[f.key]];
          if (val instanceof Date) val = val.toISOString().slice(0, 10);
          r[f.key] = val !== undefined ? String(val).trim() : '';
        }
      });

      // Normalize payment status — PRD: paid / unpaid / partial / free
      const ps = (r.paymentStatus || '').toLowerCase().trim();
      if (!ps || ps === '' || ps === '-') {
        // Payment status column empty — derive from amount
        r.paymentStatus = 'unpaid';
      } else if (ps === 'paid' || ps === 'yes' || ps === 'done' || ps === 'received' || ps === 'completed' || ps === 'haan' || ps === 'ha') {
        r.paymentStatus = 'paid';
      } else if (ps === 'free' || ps === 'complimentary' || ps === 'na' || ps === 'n/a' || ps === 'nil' || ps === 'no charge' || ps === 'exempt') {
        r.paymentStatus = 'free';
      } else if (ps.includes('partial') || ps.includes('part') || ps.includes('advance') || ps.includes('some')) {
        r.paymentStatus = 'partial';
      } else if (ps === 'unpaid' || ps === 'no' || ps === 'pending' || ps === 'due' || ps === 'nhi' || ps === 'nahi') {
        r.paymentStatus = 'unpaid';
      } else if (!isNaN(parseFloat(ps))) {
        // Payment status column has a number (it's actually the amount)
        r.paymentAmount = parseFloat(ps);
        r.paymentStatus = parseFloat(ps) > 0 ? 'paid' : 'unpaid';
      } else {
        // Unknown value — store as remark and mark unpaid
        r.remarks = (r.remarks ? r.remarks + '; ' : '') + 'Payment: ' + r.paymentStatus;
        r.paymentStatus = 'unpaid';
      }

      // Normalize mode — handle many variations
      const pm = (r.paymentMode || '').toLowerCase().trim();
      if (pm.includes('cash') || pm.includes('naqd') || pm.includes('hand')) r.paymentMode = 'cash';
      else if (pm.includes('online') || pm.includes('upi') || pm.includes('neft') || pm.includes('gpay') || pm.includes('phonepe') || pm.includes('paytm') || pm.includes('rtgs') || pm.includes('imps') || pm.includes('bank') || pm.includes('transfer')) r.paymentMode = 'online';
      else if (pm && pm !== '-' && pm !== '') {
        // If mode column has something like "RDD_date" or custom text, keep it
        r.paymentMode = r.paymentMode;
      }

      r.attendeeId = Helpers.generateId();
      r.paymentTiming = Helpers.paymentTiming(r.paymentDate, eventDate);
      r.paymentAmount = parseFloat(r.paymentAmount) || 0;

      // If amount > 0 but status is still unpaid, auto-correct to paid
      if (r.paymentAmount > 0 && r.paymentStatus === 'unpaid') r.paymentStatus = 'paid';
      r.createdAt = new Date().toISOString();
      return r;
    }).filter(r => r.name);

    const dupIds = Helpers.detectDuplicates(records);
    records.forEach((r, i) => { r.isDuplicate = dupIds.has(i); });

    Helpers.toast('Importing ' + records.length + ' records...', 'info');
    await DB.clearStore(DB.STORES.attendees);
    await DB.bulkAdd(DB.STORES.attendees, records);
    await DB.log('import', `Imported ${records.length} records (${dupIds.size} dups)`, currentUser?.email);

    showImportPreview(records, dupIds.size);
    document.getElementById('column-mapping-section').classList.add('hidden');
    Helpers.toast(`Imported ${records.length} records`, 'success');
  }

  function showImportPreview(records, dupCount) {
    document.getElementById('import-stats-row').innerHTML = `
      <span class="import-stat total">Total: ${records.length}</span>
      <span class="import-stat clean">Clean: ${records.length - dupCount}</span>
      <span class="import-stat dup">Duplicates: ${dupCount}</span>`;
    const preview = document.getElementById('import-preview');
    preview.classList.remove('hidden');
    const searchInput = document.getElementById('preview-search');
    const filterSelect = document.getElementById('preview-filter');
    const render = () => {
      let filtered = records;
      const q = searchInput.value.toLowerCase();
      const f = filterSelect.value;
      if (q) filtered = filtered.filter(r => Helpers.searchFilter(r, q));
      if (f === 'duplicates') filtered = filtered.filter(r => r.isDuplicate);
      if (f === 'clean') filtered = filtered.filter(r => !r.isDuplicate);
      document.getElementById('preview-table-wrap').innerHTML = Helpers.buildTable(
        ['Name', 'Mobile', 'Team', 'Category', 'Payment', 'Mode', 'Status'],
        filtered.slice(0, 200).map(r => ({
          _class: r.isDuplicate ? 'duplicate-row' : '',
          cells: [r.name, r.mobile, r.team || '-', r.category || '-',
            `<span class="badge ${r.paymentStatus === 'paid' ? 'present' : r.paymentStatus === 'free' ? 'before' : 'unpaid'}">${r.paymentStatus}</span>`,
            r.paymentMode || '-',
            r.isDuplicate ? `<span class="badge dup">Dup</span>` : '<span class="badge present">OK</span>']
        }))
      );
    };
    searchInput.addEventListener('input', Helpers.debounce(render, 300));
    filterSelect.addEventListener('change', render);
    render();
    preview.scrollIntoView({ behavior: 'smooth' });
  }

  // ===== ATTENDANCE (ADMISSION) — PRD: <2 seconds, ONE TAP =====
  let attendanceInited = false;

  function initAttendance() {
    updateAdmitCountersFromCache();
    if (attendanceInited) return;
    attendanceInited = true;

    const searchInput = document.getElementById('att-search');
    searchInput.addEventListener('input', Helpers.debounce(() => {
      const q = searchInput.value;
      if (allAttendees.length) searchAttendeesFromCache(q);
      else searchAttendees(q);
    }, 150));

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

    // Payment collect panel (for unpaid admission)
    document.getElementById('btn-pc-cancel').addEventListener('click', () => {
      document.getElementById('payment-collect-panel').classList.add('hidden');
    });
    document.getElementById('btn-pc-skip').addEventListener('click', () => App.submitPaymentCollect(true));
    document.getElementById('btn-pc-submit').addEventListener('click', () => App.submitPaymentCollect());
    document.getElementById('pc-mode-online').addEventListener('change', () => {
      document.getElementById('pc-screenshot-wrap').style.display = 'block';
    });
    document.getElementById('pc-mode-cash').addEventListener('change', () => {
      document.getElementById('pc-screenshot-wrap').style.display = 'none';
      document.getElementById('pc-screenshot').value = '';
      document.getElementById('pc-screenshot-preview').innerHTML = '';
    });
    document.getElementById('pc-screenshot').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        document.getElementById('pc-screenshot-preview').innerHTML =
          `<img src="${ev.target.result}" style="max-width:100%;max-height:160px;border-radius:8px;margin-top:.5rem" />`;
      };
      reader.readAsDataURL(file);
    });

    const bulkFile = document.getElementById('bulk-att-file');
    if (bulkFile) bulkFile.addEventListener('change', e => { if (e.target.files[0]) processBulkAttendance(e.target.files[0]); });

    setTimeout(() => searchInput.focus(), 100);
  }

  // Search from live cache (instant, no Firestore round-trip)
  function searchAttendeesFromCache(query) {
    if (!query || query.length < 1) {
      document.getElementById('att-search-results').innerHTML = '';
      return;
    }
    const results = allAttendees.filter(a => Helpers.searchFilter(a, query)).slice(0, 30);
    renderAttendanceResults(results);
  }

  async function searchAttendees(query) {
    if (!query || query.length < 1) { document.getElementById('att-search-results').innerHTML = ''; return; }
    const all = await DB.getAll(DB.STORES.attendees);
    renderAttendanceResults(all.filter(a => Helpers.searchFilter(a, query)).slice(0, 30));
  }

  function getPaymentStatus(a) {
    if (a.attendance === 'present') return { label: 'Already Present', cls: 'status-already-present' };
    const ps = (a.paymentStatus || '').toLowerCase();
    if (ps === 'paid' || ps === 'free') return { label: ps === 'free' ? 'Free' : 'Paid', cls: 'status-paid' };
    if (ps === 'partial') return { label: 'Partial', cls: 'status-unpaid' };
    const amt = parseFloat(a.paymentAmount || 0);
    if (amt > 0) return { label: 'Paid', cls: 'status-paid' };
    return { label: 'Unpaid', cls: 'status-unpaid' };
  }

  // PRD Section 8: ONE-TAP ADMISSION
  // - Paid/Free → green card, tap = instant admit
  // - Unpaid/Partial (no amount) → yellow card, tap = collect payment info then admit
  // - Already present → shows green tick + "Admitted by X", tap shows detail, NO double marking
  function renderAttendanceResults(results) {
    const el = document.getElementById('att-search-results');
    if (!results.length) { el.innerHTML = '<p style="color:var(--text-muted);padding:1rem;text-align:center">No results</p>'; return; }

    el.innerHTML = results.map(a => {
      const ps = getPaymentStatus(a);
      const isPres = a.attendance === 'present';

      if (isPres) {
        // Already admitted — green tick, show who admitted, NO re-admit
        return `
          <div class="att-result-card status-already-present" onclick="App.showDetail('${a.id}')" data-id="${a.id}">
            <div class="att-check-mark">&#10003;</div>
            <div class="att-result-info">
              <div class="att-name">${a.name}</div>
              <div class="att-meta">${a.mobile || ''} · ${a.team || ''}</div>
              <div class="att-payment-badge status-already-present">Admitted by ${a.markedBy || '?'} at ${Helpers.formatDateTime(a.entryTime)}</div>
            </div>
          </div>`;
      }

      const isUnpaid = (ps.cls === 'status-unpaid') && !(parseFloat(a.paymentAmount) > 0);
      const admitLabel = isUnpaid ? 'COLLECT' : 'ADMIT';

      // Not yet admitted — tap to admit (paid/free: instant; unpaid: collect payment)
      return `
        <div class="att-result-card ${ps.cls}" onclick="App.instantAdmit('${a.id}')" data-id="${a.id}">
          <div class="att-result-info">
            <div class="att-name">${a.name} ${a.isWalkIn ? '<span class="badge walkin">WI</span>' : ''}</div>
            <div class="att-meta">${a.mobile || ''} · ${a.team || ''} · ${a.attendeeId || ''}</div>
            <div class="att-payment-badge ${ps.cls}">${ps.label}${a.paymentMode ? ' · ' + a.paymentMode : ''}${a.paymentAmount > 0 ? ' · ' + Helpers.currency(a.paymentAmount) : ''}</div>
          </div>
          <div class="att-admit-btn ${ps.cls}">${admitLabel}</div>
        </div>`;
    }).join('');
  }

  // INSTANT ADMIT — one tap, no modal for paid/free; payment collection for unpaid/partial
  async function instantAdmit(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    if (a.attendance === 'present') {
      Helpers.toast(`Already admitted by ${a.markedBy}`, 'warning');
      return;
    }
    const ps = (a.paymentStatus || '').toLowerCase();
    const amt = parseFloat(a.paymentAmount || 0);
    const isUnpaid = (ps === 'unpaid' || ps === 'partial') && amt <= 0;

    if (isUnpaid) {
      // Show payment collection panel before admitting
      showPaymentCollect(a);
      return;
    }

    await doAdmit(a);
  }

  // Show bottom panel to collect payment info for unpaid attendees
  function showPaymentCollect(a) {
    const panel = document.getElementById('payment-collect-panel');
    document.getElementById('pc-name').textContent = a.name;
    document.getElementById('pc-attendee-id').value = a.id;
    document.getElementById('pc-remarks').value = '';
    document.getElementById('pc-mode-cash').checked = true;
    document.getElementById('pc-screenshot-wrap').style.display = 'none';
    document.getElementById('pc-screenshot').value = '';
    document.getElementById('pc-screenshot-preview').innerHTML = '';
    panel.classList.remove('hidden');
    document.getElementById('pc-remarks').focus();
  }

  // Actually perform the admission (shared by instant and payment-collect flow)
  async function doAdmit(a, extraPayment) {
    a.attendance = 'present';
    a.entryTime = new Date().toISOString();
    a.markedBy = currentUser?.name || 'Unknown';
    if (extraPayment) {
      if (extraPayment.remarks) a.remarks = extraPayment.remarks;
      if (extraPayment.paymentMode) a.paymentMode = extraPayment.paymentMode;
      if (extraPayment.screenshotUrl) a.screenshotUrl = extraPayment.screenshotUrl;
    }
    await DB.put(DB.STORES.attendees, a);
    await DB.log('checkin', `${a.name} checked in`, currentUser?.email);
    Helpers.toast(`${a.name} admitted!`, 'success');

    const q = document.getElementById('att-search')?.value;
    if (q) {
      const idx = allAttendees.findIndex(x => x.id === a.id);
      if (idx >= 0) {
        allAttendees[idx].attendance = 'present';
        allAttendees[idx].entryTime = a.entryTime;
        allAttendees[idx].markedBy = a.markedBy;
      }
      searchAttendeesFromCache(q);
    }
    updateAdmitCountersFromCache();
  }

  // Called from payment-collect panel submit (skip=true = no payment info needed)
  async function submitPaymentCollect(skip) {
    const id = document.getElementById('pc-attendee-id').value;
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;

    document.getElementById('payment-collect-panel').classList.add('hidden');

    if (skip) {
      await doAdmit(a);
      return;
    }

    const remarks = document.getElementById('pc-remarks').value.trim();
    const mode = document.getElementById('pc-mode-online').checked ? 'online' : 'cash';
    const screenshotInput = document.getElementById('pc-screenshot');

    let screenshotUrl = '';
    if (mode === 'online' && screenshotInput.files && screenshotInput.files[0]) {
      screenshotUrl = await readFileAsDataUrl(screenshotInput.files[0]);
    }

    await doAdmit(a, { remarks, paymentMode: mode, screenshotUrl });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.readAsDataURL(file);
    });
  }

  // Show detail modal — only used for already-admitted or viewing full info
  async function showDetail(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    const ps = getPaymentStatus(a);

    Helpers.modal(`
      <div class="admit-confirm-card">
        <div class="admit-status-banner ${ps.cls}"><span class="admit-status-dot ${ps.cls}"></span>${ps.label}</div>
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
          ${a.serviceStatus ? `<div class="admit-row"><span>Devotee</span><span>${a.serviceStatus}</span></div>` : ''}
          ${a.activeStatus ? `<div class="admit-row"><span>Activity</span><span>${a.activeStatus}</span></div>` : ''}
          ${a.attendance === 'present' ? `
            <div class="admit-row"><span>Admitted by</span><span>${a.markedBy}</span></div>
            <div class="admit-row"><span>Time</span><span>${Helpers.formatDateTime(a.entryTime)}</span></div>
          ` : ''}
        </div>
        <div class="admit-actions">
          ${a.attendance === 'present'
            ? `<button class="btn-danger admit-btn" onclick="App.unmarkAttendance('${a.id}');Helpers.closeModal()">Undo Admission</button>`
            : `<button class="btn-primary admit-btn" onclick="App.instantAdmit('${a.id}');Helpers.closeModal()">Admit Now</button>`}
          <button class="btn-secondary admit-btn" onclick="App.showPaymentUpdate('${a.id}')">Update Payment</button>
          <button class="btn-ghost admit-btn" onclick="Helpers.closeModal()">Close</button>
        </div>
      </div>
    `);
  }

  // PRD: Volunteer can update payment at gate
  async function showPaymentUpdate(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    Helpers.modal(`
      <h3 class="modal-title">Update Payment — ${a.name}</h3>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Payment Status</label>
        <select id="m-pay-status">
          <option value="unpaid" ${a.paymentStatus === 'unpaid' ? 'selected' : ''}>Unpaid</option>
          <option value="paid" ${a.paymentStatus === 'paid' ? 'selected' : ''}>Paid</option>
          <option value="partial" ${a.paymentStatus === 'partial' ? 'selected' : ''}>Partial Paid</option>
          <option value="free" ${a.paymentStatus === 'free' ? 'selected' : ''}>Free</option>
        </select>
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Amount</label>
        <input id="m-pay-amt" type="number" value="${a.paymentAmount || 0}" min="0" />
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Mode</label>
        <select id="m-pay-mode">
          <option value="" ${!a.paymentMode ? 'selected' : ''}>-</option>
          <option value="cash" ${a.paymentMode === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="online" ${a.paymentMode === 'online' ? 'selected' : ''}>Online</option>
        </select>
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Remarks (who paid, when)</label>
        <input id="m-pay-remarks" type="text" value="${a.remarks || ''}" placeholder="e.g. Paid to Riya on 20 March" />
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App.savePaymentUpdate('${a.id}')">Save</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
      </div>
    `);
  }

  async function savePaymentUpdate(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    a.paymentStatus = document.getElementById('m-pay-status').value;
    a.paymentAmount = parseFloat(document.getElementById('m-pay-amt').value) || 0;
    a.paymentMode = document.getElementById('m-pay-mode').value;
    a.remarks = document.getElementById('m-pay-remarks').value.trim();
    a.paymentDate = a.paymentDate || new Date().toISOString().slice(0, 10);
    await DB.put(DB.STORES.attendees, a);
    await DB.log('payment', `Payment updated: ${a.name} → ${a.paymentStatus}`, currentUser?.email);
    Helpers.closeModal();
    Helpers.toast('Payment updated', 'success');
    const q = document.getElementById('att-search')?.value;
    if (q) searchAttendeesFromCache(q);
  }

  async function unmarkAttendance(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    a.attendance = 'absent';
    a.entryTime = null;
    a.markedBy = null;
    await DB.put(DB.STORES.attendees, a);
    Helpers.toast(`Attendance removed for ${a.name}`, 'warning');
    const q = document.getElementById('att-search')?.value;
    if (q) searchAttendeesFromCache(q);
    updateAdmitCountersFromCache();
  }

  async function markByIdOrQr(input) {
    const feedback = document.getElementById('scan-feedback');
    try {
      let attendeeId = null;
      try { const parsed = JSON.parse(input); attendeeId = parsed.id || parsed.aid; }
      catch { attendeeId = input; }
      const found = allAttendees.find(a =>
        String(a.id) === String(attendeeId) || a.attendeeId === attendeeId || a.mobile === input.replace(/\D/g, '')
      );
      if (!found) {
        feedback.className = 'scan-feedback error'; feedback.textContent = `Not found: "${input}"`; feedback.classList.remove('hidden');
        return;
      }
      document.getElementById('manual-scan-id').value = '';
      if (found.attendance === 'present') {
        Helpers.toast(`Already admitted by ${found.markedBy}`, 'warning');
      } else {
        await instantAdmit(found.id);
      }
    } catch (err) {
      feedback.className = 'scan-feedback error'; feedback.textContent = err.message; feedback.classList.remove('hidden');
    }
  }

  // QR Scanner
  function initScanner() {
    if (scannerStream) return;
    const video = document.getElementById('scanner-video');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => { scannerStream = stream; video.srcObject = stream; startQrLoop(video); })
      .catch(() => Helpers.toast('Camera denied, use manual entry', 'warning'));
  }

  function stopScanner() {
    if (scannerStream) { scannerStream.getTracks().forEach(t => t.stop()); scannerStream = null; }
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
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        try {
          if ('BarcodeDetector' in window) {
            const codes = await new BarcodeDetector({ formats: ['qr_code'] }).detect(canvas);
            if (codes.length > 0) { await markByIdOrQr(codes[0].rawValue); qrLoopActive = false; setTimeout(() => startQrLoop(video), 2000); return; }
          }
        } catch {}
      }
      if (scannerStream) requestAnimationFrame(loop); else qrLoopActive = false;
    }
    requestAnimationFrame(loop);
  }

  async function processBulkAttendance(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const wb = XLSX.read(e.target.result, { type: 'array' });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      const all = await DB.getAll(DB.STORES.attendees);
      let matched = 0, notFound = 0;
      for (const row of rows.slice(1)) {
        const val = String(row[0] || '').trim();
        if (!val) continue;
        const found = all.find(a => a.attendeeId === val || a.mobile === val || String(a.id) === val);
        if (found && found.attendance !== 'present') {
          found.attendance = 'present'; found.entryTime = new Date().toISOString(); found.markedBy = currentUser?.name + ' (bulk)';
          await DB.put(DB.STORES.attendees, found); matched++;
        } else if (!found) notFound++;
      }
      document.getElementById('bulk-att-result').innerHTML = `<p style="margin-top:1rem;color:var(--success)">Marked ${matched} present. ${notFound} not found.</p>`;
      Helpers.toast(`Bulk: ${matched} admitted`, 'success');
    };
    reader.readAsArrayBuffer(file);
  }

  // ===== WALK-IN =====
  function initWalkin() { renderWalkinList(); }

  function initWalkinPanel() {
    // No-op: team and date are auto-set on submit, no pre-population needed
  }

  async function addWalkIn() {
    const name = document.getElementById('wi-name').value.trim();
    const mobile = document.getElementById('wi-mobile').value.trim();
    const reference = document.getElementById('wi-reference').value.trim();
    const payment = document.getElementById('wi-payment').value;
    const category = document.getElementById('wi-category').value;
    const busRoute = document.getElementById('wi-busroute').value.trim();
    const payStatus = document.getElementById('wi-paystatus').value;
    const payMode = document.getElementById('wi-paymode').value;
    const remarks = document.getElementById('wi-remarks')?.value?.trim() || '';
    const fb = document.getElementById('walkin-feedback');

    if (!name || !mobile) { fb.className = 'scan-feedback error'; fb.textContent = 'Name and Mobile required'; fb.classList.remove('hidden'); return; }

    const now = new Date();
    const paydate = now.toISOString().slice(0, 10);
    const eventDate = await DB.getConfig('eventDate');
    const record = {
      name, mobile, reference, paymentAmount: parseFloat(payment) || 0, paymentDate: paydate,
      paymentTiming: Helpers.paymentTiming(paydate, eventDate),
      paymentStatus: payStatus || 'unpaid', paymentMode: payMode || '', remarks,
      team: '', category, busRoute, attendeeId: Helpers.generateId('WI'),
      attendance: 'present', entryTime: now.toISOString(), markedBy: currentUser?.name || 'Unknown',
      isWalkIn: true, isDuplicate: false, createdAt: now.toISOString()
    };

    await DB.add(DB.STORES.attendees, record);
    await DB.log('walkin', `Walk-in: ${name}`, currentUser?.email);

    fb.className = 'scan-feedback success'; fb.textContent = `${name} added!`; fb.classList.remove('hidden');
    setTimeout(() => fb.classList.add('hidden'), 2000);
    clearWalkinForm();
    document.getElementById('walkin-panel').classList.add('hidden');
    updateAdmitCountersFromCache();
    Helpers.toast(`${name} registered & admitted`, 'success');
  }

  function clearWalkinForm() {
    ['wi-name','wi-mobile','wi-reference','wi-payment','wi-busroute','wi-remarks'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const ps = document.getElementById('wi-paystatus'); if (ps) ps.value = 'unpaid';
    const pm = document.getElementById('wi-paymode'); if (pm) pm.value = '';
  }

  async function renderWalkinList() {
    const all = await DB.getAll(DB.STORES.attendees);
    const walkins = all.filter(a => a.isWalkIn).reverse();
    document.getElementById('walkin-list').innerHTML = walkins.length ? Helpers.buildTable(
      ['Name', 'Mobile', 'Reference', 'Payment', 'Mode', 'Entry'],
      walkins.map(a => ({ _class: 'walkin-row', cells: [a.name, a.mobile, a.reference || '-',
        `<span class="badge ${a.paymentStatus === 'paid' ? 'present' : 'unpaid'}">${a.paymentStatus}</span>`,
        a.paymentMode || '-', Helpers.formatDateTime(a.entryTime)] }))
    ) : '<p style="color:var(--text-muted);padding:1rem">No walk-ins yet</p>';
  }

  // ===== ATTENDEES =====
  async function initAttendees() {
    const attendees = allAttendees.length ? allAttendees : await DB.getAll(DB.STORES.attendees);
    attendeesPage = 1;

    const teams = [...new Set(attendees.map(a => a.team).filter(Boolean))].sort();
    document.getElementById('attendees-filter-team').innerHTML = '<option value="">All Teams</option>' + teams.map(t => `<option value="${t}">${t}</option>`).join('');

    const search = document.getElementById('attendees-search');
    const teamSel = document.getElementById('attendees-filter-team');
    const catSel = document.getElementById('attendees-filter-cat');
    const attSel = document.getElementById('attendees-filter-att');

    const renderFiltered = () => {
      let filtered = attendees;
      const q = search.value.toLowerCase();
      if (q) filtered = filtered.filter(a => Helpers.searchFilter(a, q));
      if (teamSel.value) filtered = filtered.filter(a => a.team === teamSel.value);
      if (catSel.value) filtered = filtered.filter(a => a.category === catSel.value);
      if (attSel.value) filtered = filtered.filter(a => attSel.value === 'present' ? a.attendance === 'present' : a.attendance !== 'present');

      document.getElementById('attendees-count').textContent = `${filtered.length} attendees`;
      document.getElementById('attendees-table-wrap').innerHTML = Helpers.buildTable(
        ['Name', 'Mobile', 'Team', 'Category', 'Payment', 'Mode', 'Status', 'Actions'],
        filtered.slice(0, PAGE_SIZE).map(a => ({
          _class: a.isDuplicate && !a.dupResolved ? 'duplicate-row' : a.isWalkIn ? 'walkin-row' : '',
          cells: [
            a.name + (a.isDuplicate && !a.dupResolved ? ' <span class="badge dup">dup</span>' : '') + (a.isWalkIn ? ' <span class="badge walkin">WI</span>' : ''),
            a.mobile, a.team || '-', a.category || '-',
            `<span class="badge ${a.paymentStatus === 'paid' ? 'present' : a.paymentStatus === 'free' ? 'before' : 'unpaid'}">${a.paymentStatus || 'unpaid'}</span>`,
            a.paymentMode || '-',
            `<span class="badge ${a.attendance === 'present' ? 'present' : 'absent'}">${a.attendance || 'absent'}</span>`,
            `<button class="btn-small" onclick="App.showDetail('${a.id}')">View</button>
             ${a.isDuplicate && !a.dupResolved ? `<button class="btn-small warning" onclick="App.resolveDuplicate('${a.id}')">Resolve</button>` : ''}`
          ]
        }))
      );
    };

    [search, teamSel, catSel, attSel].forEach(el => el.addEventListener('input', Helpers.debounce(renderFiltered, 200)));
    renderFiltered();
  }

  async function resolveDuplicate(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    Helpers.modal(`
      <h3 class="modal-title">Resolve Duplicate</h3>
      <p style="color:var(--text-secondary);margin-bottom:1rem">${a.name} (${a.mobile}) matches: <strong>${a._dupOf}</strong></p>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App.acceptDuplicate('${id}')">Accept as Unique</button>
        <button class="btn-danger" onclick="App.deleteDuplicate('${id}')">Delete</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
      </div>
    `);
  }
  async function acceptDuplicate(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    a.dupResolved = true; await DB.put(DB.STORES.attendees, a);
    Helpers.closeModal(); Helpers.toast('Marked unique', 'success'); initAttendees();
  }
  async function deleteDuplicate(id) {
    await DB.deleteRecord(DB.STORES.attendees, id);
    Helpers.closeModal(); Helpers.toast('Removed', 'success'); initAttendees();
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
    el.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">Loading...</p>';
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
    } catch (err) { el.innerHTML = `<p style="color:var(--danger);padding:2rem">Error: ${err.message}</p>`; }
  }

  // ===== FINANCIAL YEAR =====
  async function initFinancial() {
    const el = document.getElementById('page-financial');
    el.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">Loading...</p>';
    try {
      const events = await DB.getEvents();
      const fyMap = {};
      for (const evt of events) {
        const fy = evt.financialYear || Helpers.getFinancialYear(evt.date || evt.createdAt);
        if (!fyMap[fy]) fyMap[fy] = [];
        const oldEvent = DB.getCurrentEvent();
        DB.setCurrentEvent(evt.id);
        const participants = await DB.getAll(DB.STORES.attendees);
        DB.setCurrentEvent(oldEvent);

        const totalCollected = participants.reduce((s, p) => s + (parseFloat(p.paymentAmount) || 0), 0);
        const expense = parseFloat(evt.totalExpense) || 0;
        fyMap[fy].push({ ...evt, participantCount: participants.length,
          presentCount: participants.filter(p => p.attendance === 'present').length,
          totalCollected, expense, profitLoss: totalCollected - expense,
          paidCount: participants.filter(p => p.paymentStatus === 'paid').length,
          unpaidCount: participants.filter(p => !p.paymentStatus || p.paymentStatus === 'unpaid').length,
          freeCount: participants.filter(p => p.paymentStatus === 'free').length
        });
      }

      const sortedFYs = Object.keys(fyMap).sort().reverse();
      let html = '<div class="card"><h3 class="card-title">Financial Year Overview</h3>';
      for (const fy of sortedFYs) {
        const evts = fyMap[fy];
        const fyTotal = evts.reduce((s, e) => s + e.totalCollected, 0);
        const fyExpense = evts.reduce((s, e) => s + e.expense, 0);
        const fyPL = fyTotal - fyExpense;
        html += `<div style="margin-bottom:1.5rem">
          <h4 style="color:#15803d;margin-bottom:.75rem;display:flex;justify-content:space-between">
            <span>FY ${fy}</span>
            <span style="font-family:var(--font-mono);color:${fyPL >= 0 ? 'var(--success)' : 'var(--danger)'}">${Helpers.currency(fyPL)} ${fyPL >= 0 ? 'Profit' : 'Loss'}</span>
          </h4>
          ${Helpers.buildTable(['Event','Date','Total','Present','Paid','Unpaid','Free','Collected','Expense','P/L'],
            evts.map(e => ({ cells: [e.name, Helpers.formatDate(e.date) || '-', e.participantCount, e.presentCount,
              e.paidCount, e.unpaidCount, e.freeCount, Helpers.currency(e.totalCollected), Helpers.currency(e.expense),
              `<span style="color:${e.profitLoss >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:600">${Helpers.currency(e.profitLoss)}</span>`] })),
            { cls: 'report-table' })}
        </div>`;
      }
      el.innerHTML = html + '</div>';
    } catch (err) { el.innerHTML = `<p style="color:var(--danger);padding:2rem">Error: ${err.message}</p>`; }
  }

  // ===== SETTINGS =====
  async function initSettings() {
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
      await DB.updateEvent(DB.getCurrentEvent(), {
        name, date, chargePerPerson: parseFloat(charge) || 0,
        totalExpense: parseFloat(expense) || 0,
        financialYear: date ? Helpers.getFinancialYear(date) : ''
      });
      await DB.setConfig('eventName', name);
      await DB.setConfig('eventDate', date);
      await DB.setConfig('chargePerPerson', charge);
      Helpers.toast('Saved!', 'success');
      await loadEventSelector();
    };

    if (currentUser) {
      document.getElementById('profile-name').value = currentUser.name || '';
      document.getElementById('profile-email').value = currentUser.email || '';
      document.getElementById('profile-role').textContent = currentUser.role === 'admin' ? 'Administrator' : 'Volunteer';
    }

    document.getElementById('btn-save-profile').onclick = async () => {
      const name = document.getElementById('profile-name').value.trim();
      if (!name) { Helpers.toast('Name required', 'error'); return; }
      await DB.setUserProfile(currentUser.uid, { name });
      currentUser.name = name;
      document.getElementById('sidebar-username').textContent = name;
      document.getElementById('sidebar-avatar').textContent = name[0].toUpperCase();
      Helpers.toast('Profile saved', 'success');
    };

    document.getElementById('btn-change-pw').onclick = async () => {
      const pw = document.getElementById('new-password').value;
      if (!pw || pw.length < 6) { Helpers.toast('Min 6 characters', 'error'); return; }
      try {
        await auth.currentUser.updatePassword(pw);
        document.getElementById('new-password').value = '';
        Helpers.toast('Password changed!', 'success');
      } catch (err) {
        if (err.code === 'auth/requires-recent-login') Helpers.toast('Please re-login first', 'warning');
        else Helpers.toast('Failed: ' + err.message, 'error');
      }
    };

    renderBusRoutes();
    renderUsers();
    document.getElementById('btn-add-bus-route').onclick = showAddBusRouteModal;
    document.getElementById('btn-add-user').onclick = showAddUserModal;

    document.getElementById('btn-clear-attendance').onclick = async () => {
      if (confirm('Clear ALL attendance?')) {
        const all = await DB.getAll(DB.STORES.attendees);
        for (const a of all) { a.attendance = 'absent'; a.entryTime = null; a.markedBy = null; await DB.put(DB.STORES.attendees, a); }
        Helpers.toast('Attendance cleared', 'warning');
      }
    };

    document.getElementById('btn-clear-all').onclick = async () => {
      if (confirm('RESET ALL DATA for this event?')) {
        await DB.clearStore(DB.STORES.attendees);
        await DB.clearStore(DB.STORES.busRoutes);
        await DB.clearStore(DB.STORES.auditLog);
        Helpers.toast('Data reset', 'warning');
        navigate('dashboard');
      }
    };
  }

  async function renderBusRoutes() {
    const routes = await DB.getAll(DB.STORES.busRoutes);
    document.getElementById('bus-routes-list').innerHTML = routes.map(r =>
      `<div class="bus-route-row"><div class="bus-route-info"><div class="bus-route-name">${r.name}</div><div class="bus-route-meta">Capacity: ${r.capacity} | Cost: ${Helpers.currency(r.cost)}</div></div><button class="btn-small danger" onclick="App.deleteBusRoute('${r.id}')">X</button></div>`
    ).join('') || '<p style="color:var(--text-muted);font-size:.85rem">No routes</p>';
  }

  function showAddBusRouteModal() {
    Helpers.modal(`<h3 class="modal-title">Add Bus Route</h3>
      <div class="input-group" style="margin-bottom:.75rem"><label>Route Name</label><input id="m-route-name" type="text" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Capacity</label><input id="m-route-cap" type="number" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Bus Cost</label><input id="m-route-cost" type="number" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Charge/Passenger</label><input id="m-route-charge" type="number" /></div>
      <div class="modal-actions"><button class="btn-primary" onclick="App.saveBusRoute()">Save</button><button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button></div>`);
  }

  async function saveBusRoute() {
    const name = document.getElementById('m-route-name').value.trim();
    if (!name) { Helpers.toast('Name required', 'error'); return; }
    await DB.add(DB.STORES.busRoutes, { name, capacity: parseInt(document.getElementById('m-route-cap').value) || 0, cost: parseFloat(document.getElementById('m-route-cost').value) || 0, chargePerPassenger: parseFloat(document.getElementById('m-route-charge').value) || 0 });
    Helpers.closeModal(); Helpers.toast('Route added', 'success'); renderBusRoutes();
  }

  async function deleteBusRoute(id) { await DB.deleteRecord(DB.STORES.busRoutes, id); renderBusRoutes(); }

  async function renderUsers() {
    const snap = await firestore.collection('users').get();
    const users = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
    document.getElementById('users-list').innerHTML = users.map(u =>
      `<div class="bus-route-row"><div class="bus-route-info"><div class="bus-route-name">${u.name}</div><div class="bus-route-meta">${u.email} | ${u.role}</div></div>${u.uid !== currentUser?.uid ? `<button class="btn-small" onclick="App.toggleUserRole('${u.uid}','${u.role}')">${u.role === 'admin' ? 'Make Vol' : 'Make Admin'}</button>` : '<span class="badge present">You</span>'}</div>`
    ).join('');
  }

  function showAddUserModal() {
    Helpers.modal(`<h3 class="modal-title">Invite User</h3><p style="color:var(--text-secondary);font-size:.85rem;margin-bottom:1rem">Ask them to register on the login page. Then change their role here.</p><button class="btn-ghost" onclick="Helpers.closeModal()">OK</button>`);
  }

  async function toggleUserRole(uid, role) {
    await DB.setUserProfile(uid, { role: role === 'admin' ? 'volunteer' : 'admin' });
    Helpers.toast('Role changed', 'success'); renderUsers();
  }

  function updateNetworkStatus() {
    const el = document.getElementById('sync-status');
    el.textContent = navigator.onLine ? 'Online' : 'Offline';
    el.className = 'sync-status ' + (navigator.onLine ? 'online' : 'offline');
  }

  return {
    init, navigate,
    downloadTemplate,
    instantAdmit, submitPaymentCollect, unmarkAttendance, showDetail, showPaymentUpdate, savePaymentUpdate,
    resolveDuplicate, acceptDuplicate, deleteDuplicate,
    saveBusRoute, deleteBusRoute, toggleUserRole,
    showCreateEventModal, createEvent,
    initAttendees
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
