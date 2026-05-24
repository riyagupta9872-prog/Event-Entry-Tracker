// ===== MAIN APP =====
const App = (() => {
  let currentUser = null;
  let currentPage = 'attendance';
  let scannerStream = null;
  let allAttendees = [];
  let _dashAttendees = []; // snapshot for pop-cards
  let liveUnsubscribe = null; // Firestore real-time listener
  const PAGE_SIZE = 100;

  // Return the department for a team name — delegates to Reports module
  function getCategoryForTeam(teamName) {
    return Reports.getTeamDept(teamName, null);
  }

  // Module-level sidebar helpers (needed by enterApp and nav items alike)
  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('show');
  }
  function openSidebar() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('show');
  }

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
    document.getElementById('btn-menu').addEventListener('click', () => {
      document.getElementById('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
    });
    document.getElementById('btn-sidebar-close').addEventListener('click', closeSidebar);
    document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
    document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') Helpers.closeModal(); });

    // Nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        navigate(item.dataset.page);
        closeSidebar();
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
      let msg;
      if (err.code === 'auth/user-not-found') msg = 'No account with this email';
      else if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') msg = 'Incorrect password';
      else if (err.code === 'auth/invalid-email') msg = 'Invalid email';
      else if (err.code === 'auth/too-many-requests') msg = 'Too many attempts, try later';
      else if (err.code === 'auth/network-request-failed') msg = 'Network error — check your internet connection';
      else if (err.code === 'auth/user-disabled') msg = 'This account has been disabled';
      else msg = `Login failed: ${err.message || err.code || 'Unknown error'}`;
      console.error('[Firebase login error]', err);
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
      // First user registered becomes admin; all others are volunteers by default
      const existingUsers = await firestore.collection('users').limit(1).get();
      const role = existingUsers.empty ? 'admin' : 'volunteer';
      await DB.setUserProfile(cred.user.uid, { name, email, role, createdAt: new Date().toISOString() });
    } catch (err) {
      let msg;
      if (err.code === 'auth/email-already-in-use') msg = 'Email already in use';
      else if (err.code === 'auth/weak-password') msg = 'Password too weak (min 6 characters)';
      else if (err.code === 'auth/invalid-email') msg = 'Invalid email format';
      else if (err.code === 'auth/network-request-failed') msg = 'Network error — check your internet connection';
      else if (err.code === 'auth/operation-not-allowed') msg = 'Email/Password sign-up is disabled in Firebase Console';
      else msg = `Registration failed: ${err.message || err.code || 'Unknown error'}`;
      console.error('[Firebase register error]', err);
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
    } catch (err) {
      console.error('[Firebase reset error]', err);
      let msg = 'Could not send reset email';
      if (err.code === 'auth/user-not-found') msg = 'No account with this email';
      else if (err.code === 'auth/invalid-email') msg = 'Invalid email format';
      else if (err.code === 'auth/network-request-failed') msg = 'Network error — check your internet connection';
      else if (err.message) msg = `Reset failed: ${err.message}`;
      Helpers.toast(msg, 'error', 5000);
    }
  }

  async function enterApp() {
    document.getElementById('sidebar-username').textContent = currentUser.name;
    document.getElementById('sidebar-avatar').textContent = currentUser.name[0].toUpperCase();

    const isAdmin = currentUser.role === 'admin';
    document.getElementById('sidebar-role').textContent = isAdmin ? 'Tap to edit profile' : 'Volunteer';

    // Make sidebar profile card clickable for admins
    const userBtn = document.getElementById('sidebar-user-btn');
    const editIcon = document.getElementById('sidebar-edit-icon');
    if (isAdmin) {
      editIcon.style.display = '';
      userBtn.style.cursor = 'pointer';
      userBtn.onclick = () => { closeSidebar(); showMyAccountModal(); };
      userBtn.onmouseenter = () => { userBtn.style.background = 'var(--bg-card2)'; };
      userBtn.onmouseleave = () => { userBtn.style.background = ''; };
    } else {
      editIcon.style.display = 'none';
      userBtn.style.cursor = 'default';
      userBtn.onclick = null;
    }

    document.querySelectorAll('.admin-only, .admin-page').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });

    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('screen-app').classList.remove('hidden');

    await loadEventSelector();
    await ensureSessionSetup();
    navigate('attendance');
  }

  // ===== LOGIN-TIME SESSION SETUP (event + bus) =====
  // Asked once per browser session (clearing on logout). User must pick which
  // festival they are checking in for and which bus they are stationed at;
  // both selections feed into the admission flow's bus tagging.
  function _sessionSetupDone() {
    return sessionStorage.getItem('prerna_session_setup_done') === '1';
  }
  function _markSessionSetupDone() {
    sessionStorage.setItem('prerna_session_setup_done', '1');
  }
  function _clearSessionSetup() {
    sessionStorage.removeItem('prerna_session_setup_done');
  }

  async function ensureSessionSetup() {
    if (_sessionSetupDone()) return;
    if (!_cachedEvents || _cachedEvents.length === 0) {
      _markSessionSetupDone();
      return;
    }
    await showSessionSetupModal();
  }

  async function showSessionSetupModal() {
    let buses = [];
    try { buses = await DB.getAll(DB.STORES.buses); } catch { buses = []; }

    const activeEid = DB.getCurrentEvent();
    const myBus = getMyBus();

    const evtOptions = _cachedEvents.map(e =>
      `<option value="${e.id}" ${e.id === activeEid ? 'selected' : ''}>${e.name}${e.date ? ' — ' + Helpers.formatDate(e.date) : ''}</option>`
    ).join('');

    const busOptions = buses.length
      ? '<option value="">— select a bus —</option>' + buses.map(b =>
          `<option value="${b.name.replace(/"/g,'&quot;')}" ${b.name === myBus ? 'selected' : ''}>${b.name}${b.coordinator ? ' · ' + b.coordinator : ''}</option>`
        ).join('')
      : '';

    const busBlock = buses.length
      ? `<label style="display:block;margin-top:.85rem;font-size:.88rem;font-weight:600">Your Bus</label>
         <select id="ss-bus" class="wi-input" style="width:100%">${busOptions}</select>
         <p style="font-size:.78rem;color:var(--text-muted);margin:.4rem 0 0">All devotees you admit will be tagged to this bus.</p>`
      : `<p style="margin-top:.85rem;padding:.6rem;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;font-size:.85rem;color:#92400e">No buses configured yet. Add buses from Settings to enable bus tagging.</p>`;

    Helpers.modal(`
      <h3 class="modal-title">Start of Shift</h3>
      <p style="color:var(--text-muted);font-size:.88rem;margin:0 0 1rem">
        You must select your festival${buses.length ? ' and bus' : ''} before entering the app.
      </p>
      <label style="display:block;font-size:.88rem;font-weight:600">Festival / Event</label>
      <select id="ss-event" class="wi-input" style="width:100%">${evtOptions}</select>
      ${busBlock}
      <div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1.25rem">
        <button class="btn-primary" id="ss-confirm">Continue</button>
      </div>
    `);

    // Lock the modal: prevent overlay-click and ESC from dismissing it.
    const overlay = document.getElementById('modal-overlay');
    overlay.onclick = null; // wipe Helpers.modal's default close handler
    const swallowOverlay = (e) => { if (e.target === overlay) e.stopPropagation(); };
    overlay.addEventListener('click', swallowOverlay, true);
    const swallowEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); } };
    document.addEventListener('keydown', swallowEsc, true);

    return new Promise(resolve => {
      document.getElementById('ss-confirm').onclick = async () => {
        const newEid = document.getElementById('ss-event').value;
        const newBus = document.getElementById('ss-bus')?.value || '';
        if (!newEid) {
          Helpers.toast('Please select a festival', 'error');
          return;
        }
        if (buses.length && !newBus) {
          Helpers.toast('Please select your bus to continue', 'error');
          return;
        }
        if (newEid !== DB.getCurrentEvent()) {
          DB.setCurrentEvent(newEid);
          allAttendees = [];
          attendanceInited = false;
          _absenteeMap = null;
          Reports.clearAbsenteeCache();
          const active = _cachedEvents.find(e => e.id === newEid);
          const btn = document.getElementById('event-selector-btn');
          if (btn && active) btn.textContent = active.name;
          startLiveSync();
        }
        setMyBus(newBus);
        _markSessionSetupDone();
        overlay.removeEventListener('click', swallowOverlay, true);
        document.removeEventListener('keydown', swallowEsc, true);
        Helpers.closeModal();
        resolve();
      };
    });
  }

  function handleLogout() {
    _clearSessionSetup();
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
        allAttendees = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
        updateAdmitCountersFromCache();
        // Re-render the attendance list whenever data changes
        if (currentPage === 'attendance') {
          const q = document.getElementById('att-search')?.value;
          renderAllAttendance(q);
        }
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

  // ===== MY BUS (admission-page bus selector) =====
  function _myBusKey() { return `prerna_my_bus_${DB.getCurrentEvent() || 'default'}`; }
  function getMyBus()   { return localStorage.getItem(_myBusKey()) || ''; }
  function setMyBus(name) {
    if (name) localStorage.setItem(_myBusKey(), name);
    else       localStorage.removeItem(_myBusKey());
  }

  async function initMyBusPicker() {
    const buses = await DB.getAll(DB.STORES.buses);
    const bar   = document.getElementById('my-bus-bar');
    const pills = document.getElementById('my-bus-pills');
    if (!bar || !pills) return;

    if (!buses.length) { bar.classList.add('hidden'); return; }

    bar.classList.remove('hidden');
    const active = getMyBus();
    pills.innerHTML = buses.map(b =>
      `<button class="my-bus-pill ${b.name === active ? 'active' : ''}" onclick="App._selectMyBus('${b.name.replace(/'/g,"\\'")}', this)">${b.name}</button>`
    ).join('');
  }

  function _selectMyBus(name, btn) {
    const wasActive = btn.classList.contains('active');
    document.querySelectorAll('.my-bus-pill').forEach(p => p.classList.remove('active'));
    if (wasActive) {
      setMyBus('');
    } else {
      btn.classList.add('active');
      setMyBus(name);
    }
  }

  // ===== EVENT MANAGEMENT =====
  let _cachedEvents = [];

  async function loadEventSelector() {
    const events = await DB.getEvents();
    _cachedEvents = events;
    const activeId = DB.getCurrentEvent();
    const btn = document.getElementById('event-selector-btn');

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

    if (!activeId || !events.find(e => e.id === activeId)) {
      DB.setCurrentEvent(events[0].id);
    }

    const active = events.find(e => e.id === DB.getCurrentEvent()) || events[0];
    if (btn) btn.textContent = active.name;

    startLiveSync();
  }

  function showEventPicker() {
    const activeId = DB.getCurrentEvent();
    let filtered = _cachedEvents;

    const renderList = (query) => {
      const q = (query || '').toLowerCase().trim();
      filtered = q ? _cachedEvents.filter(e => e.name.toLowerCase().includes(q) || (e.date && e.date.includes(q))) : _cachedEvents;
      const list = document.getElementById('evt-picker-list');
      if (!list) return;
      if (filtered.length === 0) {
        list.innerHTML = '<li class="event-picker-empty">No events found</li>';
        return;
      }
      list.innerHTML = filtered.map(e => `
        <li class="event-picker-item ${e.id === activeId ? 'active' : ''}" onclick="App._pickEvent('${e.id}')">
          <span>${e.name}</span>
          ${e.date ? `<span class="evt-date">${Helpers.formatDate(e.date)}</span>` : ''}
        </li>`).join('');
    };

    Helpers.modal(`
      <h3 class="modal-title">Choose Event</h3>
      <input id="evt-picker-search" class="event-picker-search" type="text" placeholder="Search events…" oninput="App._filterEvents(this.value)" />
      <ul id="evt-picker-list" class="event-picker-list"></ul>
    `);

    renderList('');

    // Focus search after modal renders
    setTimeout(() => {
      const inp = document.getElementById('evt-picker-search');
      if (inp) inp.focus();
    }, 50);
  }

  function _filterEvents(query) {
    const activeId = DB.getCurrentEvent();
    const q = (query || '').toLowerCase().trim();
    const filtered = q ? _cachedEvents.filter(e => e.name.toLowerCase().includes(q) || (e.date && e.date.includes(q))) : _cachedEvents;
    const list = document.getElementById('evt-picker-list');
    if (!list) return;
    if (filtered.length === 0) {
      list.innerHTML = '<li class="event-picker-empty">No events found</li>';
      return;
    }
    list.innerHTML = filtered.map(e => `
      <li class="event-picker-item ${e.id === activeId ? 'active' : ''}" onclick="App._pickEvent('${e.id}')">
        <span>${e.name}</span>
        ${e.date ? `<span class="evt-date">${Helpers.formatDate(e.date)}</span>` : ''}
      </li>`).join('');
  }

  function _pickEvent(id) {
    Helpers.closeModal();
    if (id === DB.getCurrentEvent()) return;
    DB.setCurrentEvent(id);
    allAttendees = [];
    attendanceInited = false;
    _absenteeMap = null;
    Reports.clearAbsenteeCache();
    const active = _cachedEvents.find(e => e.id === id);
    const btn = document.getElementById('event-selector-btn');
    if (btn && active) btn.textContent = active.name;
    startLiveSync();
    navigate(currentPage);
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
    allAttendees = [];
    attendanceInited = false;
    Helpers.closeModal();
    Helpers.toast('Event created!', 'success');
    await loadEventSelector();
    navigate('dashboard');
  }

  // Pages volunteers are allowed to access
  const VOLUNTEER_PAGES = ['attendance', 'walkin', 'mybus'];

  // ===== NAVIGATION =====
  function navigate(page) {
    // Permission guard — volunteers can only access admission and walk-in
    if (currentUser?.role !== 'admin' && !VOLUNTEER_PAGES.includes(page)) {
      Helpers.toast('Access restricted. Contact your admin.', 'error');
      page = 'attendance';
    }

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
      settings: 'Settings', financial: 'Financial Year',
      mybus: 'My Bus'
    };
    document.getElementById('page-title').textContent = titles[page] || page;
    currentPage = page;

    switch (page) {
      case 'dashboard': initDashboard(); break;
      case 'import': initImport(); break;
      case 'attendance': initAttendance(); initMyBusPicker(); break;
      case 'walkin': initWalkin(); break;
      case 'attendees': initAttendees(); break;
      case 'reports': initReports(); break;
      case 'settings': initSettings(); break;
      case 'financial': initFinancial(); break;
      case 'mybus': initMyBus(); break;
    }
  }

  // ===== MY BUS PAGE (volunteer-facing report of their boarded bus) =====
  async function initMyBus() {
    const host = document.getElementById('mybus-content');
    const isAdmin = currentUser?.role === 'admin';
    host.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">Loading…</p>';

    try {
      const [all, buses] = await Promise.all([
        DB.getAll(DB.STORES.attendees),
        DB.getAll(DB.STORES.buses).catch(() => [])
      ]);
      const present = all.filter(a => a.attendance === 'present');

      if (isAdmin) {
        // Admin: every bus's roster aggregated, regardless of which volunteer marked them.
        host.innerHTML = renderAllBuses(present, buses);
      } else {
        const myBus = getMyBus();
        if (!myBus) {
          host.innerHTML = `
            <div class="card" style="text-align:center;padding:2rem">
              <h3 class="card-title" style="margin:0 0 .5rem">No bus selected</h3>
              <p style="color:var(--text-muted);margin:0 0 1rem">Pick the bus you are stationed at to see every devotee admitted to it — across all volunteers marking attendance for the same bus.</p>
              <button class="btn-primary" onclick="App.showSessionSetupModal()">Select Bus</button>
            </div>`;
          return;
        }
        const onBus = present.filter(a => (a.boardedBus || '') === myBus);
        host.innerHTML = renderMyBus(myBus, onBus);
      }
    } catch (err) {
      host.innerHTML = `<p style="color:var(--danger);padding:2rem">Error: ${err.message}</p>`;
    }
  }

  // Bus-wise department breakdown (IGF / ICF_Prji / ICF_Mtg / IYF / Balarama Team)
  function _deptBreakdown(list) {
    const deptOrder = Reports.CATEGORY_ORDER;
    const counts = {};
    list.forEach(a => {
      let dept = Reports.getTeamDept(a.team, null);
      if (!dept) dept = (a.category || 'Unassigned').trim() || 'Unassigned';
      counts[dept] = (counts[dept] || 0) + 1;
    });
    const ordered = [
      ...deptOrder.filter(d => counts[d]),
      ...Object.keys(counts).filter(d => !deptOrder.includes(d)).sort()
    ];
    return { counts, ordered };
  }

  function _renderBusCard(busName, list, opts = {}) {
    const total   = list.length;
    const walkIns = list.filter(a => a.isWalkIn).length;
    const regs    = total - walkIns;
    const { counts: deptCounts, ordered: depts } = _deptBreakdown(list);

    const deptChips = depts.length
      ? depts.map(d => `<span class="dept-chip"><b>${deptCounts[d]}</b> ${d}</span>`).join('')
      : '<span style="color:var(--text-muted);font-size:.85rem">No devotees yet</span>';

    const rowsHtml = list.length
      ? list.map((a, i) => `
          <tr>
            <td style="text-align:center;color:var(--text-muted)">${i + 1}</td>
            <td>${a.name || '-'} ${a.isWalkIn ? '<span class="badge walkin" style="font-size:.7rem">WI</span>' : ''}</td>
            <td>${a.mobile || '-'}</td>
            <td>${a.team || '-'}</td>
            <td>${a.category || '-'}</td>
            <td style="font-size:.78rem;color:var(--text-muted)">${Helpers.formatDateTime(a.entryTime)}</td>
            <td style="font-size:.78rem;color:var(--text-muted)">${a.markedBy || '-'}</td>
          </tr>`).join('')
      : `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:1rem">No devotees boarded yet</td></tr>`;

    const tableId = `bus-tbl-${(busName || 'none').replace(/[^a-z0-9]/gi, '_')}`;
    const collapsible = opts.collapsible !== false;
    const expandedDefault = !!opts.expanded;
    const display = expandedDefault ? '' : 'none';
    const caret = expandedDefault ? '&#9662;' : '&#9656;';

    const headerClick = collapsible
      ? `onclick="App._toggleBusTable('${tableId}', this)" style="cursor:pointer"`
      : '';

    return `
      <div class="card" style="margin-bottom:1rem">
        <div ${headerClick} style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
          <h3 class="card-title" style="margin:0">
            ${collapsible ? `<span class="bus-caret" style="font-size:.85rem;margin-right:.35rem">${caret}</span>` : ''}
            &#128652; ${busName}
          </h3>
          <div style="display:flex;gap:.5rem;align-items:center">
            <span style="font-size:.85rem;color:var(--text-muted)">${total} boarded · ${regs} reg · ${walkIns} walk-in</span>
            ${opts.refreshBtn ? `<button class="btn-ghost" onclick="event.stopPropagation();App.initMyBus()" style="font-size:.82rem">&#8634;</button>` : ''}
          </div>
        </div>
        <div class="bus-chips" style="display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.6rem">${deptChips}</div>
        <div id="${tableId}" class="table-wrap" style="margin-top:.75rem;display:${display}">
          <table class="report-table">
            <thead><tr>
              <th style="width:40px">#</th><th>Name</th><th>Mobile</th>
              <th>Team</th><th>Category</th><th>Boarded At</th><th>Marked By</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  function _toggleBusTable(id, headerEl) {
    const t = document.getElementById(id);
    if (!t) return;
    const isHidden = t.style.display === 'none';
    t.style.display = isHidden ? '' : 'none';
    const caret = headerEl.querySelector('.bus-caret');
    if (caret) caret.innerHTML = isHidden ? '&#9662;' : '&#9656;';
  }

  function renderMyBus(busName, list) {
    const total   = list.length;
    const walkIns = list.filter(a => a.isWalkIn).length;
    const regs    = total - walkIns;
    const { counts: deptCounts, ordered: depts } = _deptBreakdown(list);
    const deptRows = depts.map(d =>
      `<tr><td>${d}</td><td style="text-align:center;font-weight:700">${deptCounts[d]}</td></tr>`
    ).join('') || `<tr><td colspan="2" style="text-align:center;color:var(--text-muted);padding:1rem">No devotees admitted yet</td></tr>`;

    const rowsHtml = list.length
      ? list.map((a, i) => `
          <tr>
            <td style="text-align:center;color:var(--text-muted)">${i + 1}</td>
            <td>${a.name || '-'} ${a.isWalkIn ? '<span class="badge walkin" style="font-size:.7rem">WI</span>' : ''}</td>
            <td>${a.mobile || '-'}</td>
            <td>${a.team || '-'}</td>
            <td>${a.category || '-'}</td>
            <td style="font-size:.78rem;color:var(--text-muted)">${Helpers.formatDateTime(a.entryTime)}</td>
            <td style="font-size:.78rem;color:var(--text-muted)">${a.markedBy || '-'}</td>
          </tr>`).join('')
      : `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:1.25rem">No devotees boarded yet</td></tr>`;

    return `
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
          <h3 class="card-title" style="margin:0">&#128652; ${busName}</h3>
          <button class="btn-ghost" onclick="App.initMyBus()" style="font-size:.82rem">&#8634; Refresh</button>
        </div>
        <p style="font-size:.78rem;color:var(--text-muted);margin:.4rem 0 0">Shows everyone admitted to this bus across all volunteers stationed here.</p>
        <div class="report-counts-bar" style="margin-top:.75rem">
          <div class="rc-item primary"><div class="rc-val">${total}</div><div class="rc-lbl">Total Boarded</div></div>
          <div class="rc-item success"><div class="rc-val">${regs}</div><div class="rc-lbl">Registered</div></div>
          <div class="rc-item accent"><div class="rc-val">${walkIns}</div><div class="rc-lbl">Walk-ins</div></div>
        </div>
      </div>

      <div class="card" style="margin-bottom:1rem">
        <h3 class="card-title" style="margin:0 0 .75rem">Department-wise (IGF / ICF / IYF / Balarama)</h3>
        <div class="table-wrap">
          <table class="report-table">
            <thead><tr><th>Department</th><th style="text-align:center">Devotees</th></tr></thead>
            <tbody>${deptRows}</tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title" style="margin:0 0 .75rem">All Devotees on this Bus</h3>
        <div class="table-wrap">
          <table class="report-table">
            <thead><tr>
              <th style="width:40px">#</th><th>Name</th><th>Mobile</th>
              <th>Team</th><th>Category</th><th>Boarded At</th><th>Marked By</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderAllBuses(presentList, configuredBuses) {
    // Group every present attendee by their boardedBus value (or "Not Boarded
    // on a Bus" when blank). Also seed the result with every bus that admins
    // configured in Settings, so empty buses are still visible.
    const groups = new Map();
    (configuredBuses || []).forEach(b => groups.set(b.name, []));
    presentList.forEach(a => {
      const key = (a.boardedBus || '').trim() || '— Not assigned to a bus —';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    });

    const totalBoarded = presentList.filter(a => (a.boardedBus || '').trim()).length;
    const totalUnassigned = presentList.length - totalBoarded;

    const sortedEntries = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));

    const summary = `
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem">
          <h3 class="card-title" style="margin:0">&#128652; All Buses (Admin View)</h3>
          <button class="btn-ghost" onclick="App.initMyBus()" style="font-size:.82rem">&#8634; Refresh</button>
        </div>
        <p style="font-size:.8rem;color:var(--text-muted);margin:.4rem 0 0">Every bus aggregated across all volunteers. Tap any bus header to expand its devotee list.</p>
        <div class="report-counts-bar" style="margin-top:.75rem">
          <div class="rc-item primary"><div class="rc-val">${groups.size}</div><div class="rc-lbl">Buses</div></div>
          <div class="rc-item success"><div class="rc-val">${totalBoarded}</div><div class="rc-lbl">Boarded</div></div>
          <div class="rc-item accent"><div class="rc-val">${totalUnassigned}</div><div class="rc-lbl">No Bus Tag</div></div>
        </div>
      </div>`;

    // Quick comparison table — one row per bus
    const compareRows = sortedEntries.map(([name, list]) => {
      const walkIns = list.filter(a => a.isWalkIn).length;
      const { counts } = _deptBreakdown(list);
      const deptStr = Object.entries(counts).sort((a,b)=>b[1]-a[1])
        .map(([d,n]) => `${d}: ${n}`).join(' · ') || '—';
      return `<tr>
        <td><b>${name}</b></td>
        <td style="text-align:center;font-weight:700">${list.length}</td>
        <td style="text-align:center">${list.length - walkIns}</td>
        <td style="text-align:center">${walkIns}</td>
        <td style="font-size:.78rem;color:var(--text-muted)">${deptStr}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:1rem">No buses configured</td></tr>`;

    const compareCard = `
      <div class="card" style="margin-bottom:1rem">
        <h3 class="card-title" style="margin:0 0 .75rem">Bus-wise Summary</h3>
        <div class="table-wrap">
          <table class="report-table">
            <thead><tr>
              <th>Bus</th>
              <th style="text-align:center">Total</th>
              <th style="text-align:center">Registered</th>
              <th style="text-align:center">Walk-ins</th>
              <th>Department Split</th>
            </tr></thead>
            <tbody>${compareRows}</tbody>
          </table>
        </div>
      </div>`;

    const busCards = sortedEntries
      .map(([name, list]) => _renderBusCard(name, list, { collapsible: true, expanded: false }))
      .join('');

    return summary + compareCard + busCards;
  }

  // ===== DASHBOARD =====
  async function initDashboard() {
    try {
      const attendees  = await DB.getAll(DB.STORES.attendees);
      const busRoutes  = await DB.getAll(DB.STORES.busRoutes);
      const present   = attendees.filter(a => a.attendance === 'present');
      const absent    = attendees.filter(a => a.attendance !== 'present');
      const paid      = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid');
      const unpaid    = attendees.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid');
      const free      = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'free');
      const walkins   = attendees.filter(a => a.isWalkIn);
      const dups      = attendees.filter(a => a.isDuplicate && !a.dupResolved);
      const totalPay  = attendees.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
      const totalBusCost = busRoutes.reduce((s, r) => s + parseInt(r.busCount || 1) * parseFloat(r.cost || 0), 0);
      const profitLoss   = totalPay - totalBusCost;
      const plClass      = profitLoss >= 0 ? 'success' : 'danger';

      // ── Attendance + Payment counts ──────────────────────────────────────
      const pct = attendees.length ? Math.round(present.length / attendees.length * 100) : 0;

      // Store attendees snapshot for pop cards
      _dashAttendees = attendees;

      document.getElementById('dash-counts').innerHTML = `
        <div class="dash-counts-grid">
          <div class="dash-count-col dash-count-clickable" onclick="App.showCountList('all','All Registered')">
            <div class="dash-count-head">Total <span class="dash-tap-hint">tap to view</span></div>
            <div class="dash-count-big">${attendees.length}</div>
            <div class="dash-count-sub">${walkins.length} walk-in&nbsp;&nbsp;${dups.length > 0 ? `<span style="color:var(--danger)">${dups.length} dup</span>` : ''}</div>
          </div>
          <div class="dash-count-col">
            <div class="dash-count-head">Attendance</div>
            <div class="dash-count-row dash-count-clickable" onclick="App.showCountList('present','Present')"><span class="dc-label success">Present</span><span class="dc-num">${present.length}</span></div>
            <div class="dash-count-row dash-count-clickable" onclick="App.showCountList('absent','Absent')"><span class="dc-label warning">Absent</span><span class="dc-num">${absent.length}</span></div>
            <div class="dash-count-pct">${pct}% attended</div>
            <div class="dash-progress" style="margin-top:.4rem">
              <div class="dash-progress-fill" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="dash-count-col">
            <div class="dash-count-head">Payment</div>
            <div class="dash-count-row dash-count-clickable" onclick="App.showCountList('paid','Paid')"><span class="dc-label accent">Paid</span><span class="dc-num">${paid.length}</span></div>
            <div class="dash-count-row dash-count-clickable" onclick="App.showCountList('unpaid','Unpaid')"><span class="dc-label danger">Unpaid</span><span class="dc-num">${unpaid.length}</span></div>
            <div class="dash-count-row dash-count-clickable" onclick="App.showCountList('free','Free')"><span class="dc-label info">Free</span><span class="dc-num">${free.length}</span></div>
          </div>
          <div class="dash-count-col dash-count-clickable" onclick="App.showCountList('walkin','Walk-ins')">
            <div class="dash-count-head">Collected <span class="dash-tap-hint">walk-ins</span></div>
            <div class="dash-count-big" style="color:var(--accent)">${Helpers.currency(totalPay)}</div>
            <div class="dash-count-sub">${walkins.length} walk-in</div>
          </div>
        </div>`;

      // ── Bus Occupancy (live count per bus, visible to all) ───────────────
      const occCard = document.getElementById('dash-bus-occ-card');
      const occEl   = document.getElementById('dash-bus-occupancy');
      const buses   = await DB.getAll(DB.STORES.buses);
      if (occCard && occEl && buses.length) {
        occCard.style.display = '';
        const busCoordHead  = await DB.getConfig('busCoordinatorHead') || '';
        const boardedCounts = {};
        attendees.filter(a => a.attendance === 'present' && a.boardedBus).forEach(a => {
          boardedCounts[a.boardedBus] = (boardedCounts[a.boardedBus] || 0) + 1;
        });
        const tiles = buses.map(b => {
          const cap   = parseInt(b.capacity) || 0;
          const count = boardedCounts[b.name] || 0;
          const pct   = cap ? Math.min(100, Math.round(count / cap * 100)) : 0;
          const full  = cap && count >= cap;
          return `<div class="bus-occ-tile">
            <div class="bus-occ-header">
              <span class="bus-occ-name">${b.name}</span>
              <span class="bus-occ-count">${count}${cap ? '/' + cap : ''}</span>
            </div>
            ${b.coordinator ? `<div class="bus-occ-coordinator">&#128100; ${b.coordinator}</div>` : ''}
            ${cap ? `<div class="bus-occ-bar-wrap"><div class="bus-occ-bar-fill${full ? ' full' : ''}" style="width:${pct}%"></div></div>` : ''}
          </div>`;
        }).join('');
        occEl.innerHTML = `<div class="bus-occ-grid">${tiles}</div>` +
          (busCoordHead ? `<div class="bus-occ-head">&#128081; Bus Coordinator Head: <strong>${busCoordHead}</strong></div>` : '') +
          `<div style="text-align:right;margin-top:.5rem"><button class="btn-ghost" style="font-size:.78rem" onclick="App.openBusManageModal()">&#9881; Manage Buses</button></div>`;
      } else if (occCard) {
        occCard.style.display = buses.length === 0 ? '' : 'none';
        if (occEl && buses.length === 0) {
          occEl.innerHTML = `<p style="color:var(--text-muted);font-size:.85rem;margin-bottom:.5rem">No buses configured yet.</p>
            <button class="btn-secondary" style="font-size:.85rem" onclick="App.openBusManageModal()">+ Configure Buses</button>`;
          occCard.style.display = '';
        }
      }

      // ── Bus Routes (financial P&L) ───────────────────────────────────────
      const busRows = busRoutes.map(r => {
        const count    = parseInt(r.busCount || 1);
        const cost     = parseFloat(r.cost || 0);
        const subtotal = count * cost;
        return `<tr>
          <td>${r.name || '—'}</td>
          <td style="text-align:center">${count}</td>
          <td style="text-align:right">${Helpers.currency(cost)}</td>
          <td style="text-align:right;font-weight:600">${Helpers.currency(subtotal)}</td>
          <td style="text-align:center">
            <button class="btn-ghost" style="padding:.2rem .6rem;font-size:.75rem" onclick="App.deleteBusRouteFromDash('${r.id}')">✕</button>
          </td>
        </tr>`;
      }).join('');

      document.getElementById('dash-buses').innerHTML = `
        <table class="report-table" style="margin-bottom:.5rem">
          <thead><tr><th>Bus / Route</th><th>No. of Buses</th><th>Cost/Bus</th><th>Subtotal</th><th></th></tr></thead>
          <tbody>${busRows || '<tr><td colspan="5" style="color:var(--text-muted);text-align:center">No buses configured</td></tr>'}</tbody>
          <tfoot><tr style="font-weight:700;background:var(--surface-hover)">
            <td colspan="3">Total Bus Cost</td>
            <td style="text-align:right">${Helpers.currency(totalBusCost)}</td><td></td>
          </tfoot>
        </table>
        <button class="btn-ghost" style="font-size:.85rem" onclick="App.showAddBusModal()">+ Add Bus</button>`;

      // ── P&L ──────────────────────────────────────────────────────────────
      document.getElementById('dash-pl').innerHTML = `
        <table class="report-table" style="max-width:420px">
          <tr><td>Total Collection</td><td style="text-align:right;color:var(--accent);font-weight:600">${Helpers.currency(totalPay)}</td></tr>
          <tr><td>Bus Expense</td><td style="text-align:right">${Helpers.currency(totalBusCost)}</td></tr>
          <tr style="font-weight:700;font-size:1.05rem">
            <td>${profitLoss >= 0 ? 'Profit' : 'Loss'}</td>
            <td style="text-align:right;color:var(--${plClass})">${Helpers.currency(Math.abs(profitLoss))}</td>
          </tr>
        </table>`;

      // ── Event Day Collections (cashier reconciliation) ──────────────────
      const edcEl = document.getElementById('dash-edc');
      if (edcEl) {
        const gatePaid = attendees.filter(a => a.paidAtEvent);
        const edcBadge = document.getElementById('dash-edc-badge');
        if (edcBadge) edcBadge.textContent = gatePaid.length ? `${gatePaid.length} person${gatePaid.length !== 1 ? 's' : ''} · ${Helpers.currency(gatePaid.reduce((s,a) => s + parseFloat(a.paymentAmount || 0), 0))}` : '';

        if (!gatePaid.length) {
          edcEl.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">No event-day collections yet</p>';
        } else {
          // Group by collector (volunteer who collected)
          const byCollector = {};
          gatePaid.forEach(a => {
            const who = a.collectedBy || 'Unknown';
            if (!byCollector[who]) byCollector[who] = [];
            byCollector[who].push(a);
          });

          const collectorRows = Object.entries(byCollector).map(([collector, list]) => {
            const total = list.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
            const personList = list.map(a =>
              `<div class="edc-person">
                <div>
                  <div style="font-weight:500;font-size:.88rem">${a.name}</div>
                  <div style="font-size:.75rem;color:var(--text-muted)">${a.mobile || ''} · ${a.team || a.reference || ''}</div>
                  ${a.remarks ? `<div style="font-size:.72rem;color:var(--text-muted);font-style:italic">${a.remarks}</div>` : ''}
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <div style="font-weight:600;font-size:.88rem">${Helpers.currency(a.paymentAmount || 0)}</div>
                  <span class="edc-mode ${(a.paymentMode||'').toLowerCase()}">${(a.paymentMode||'').toUpperCase()}</span>
                </div>
              </div>`
            ).join('');
            return `
              <div class="edc-collector-block">
                <div class="edc-collector-header" onclick="const b=this.nextElementSibling;b.classList.toggle('hidden');this.querySelector('.edc-chev').style.transform=b.classList.contains('hidden')?'':'rotate(180deg)'" style="cursor:pointer;user-select:none">
                  <span class="edc-collector-name">Collected by: <strong>${collector}</strong></span>
                  <div style="display:flex;align-items:center;gap:.6rem">
                    <span class="edc-collector-total">${Helpers.currency(total)}</span>
                    <span class="edc-chev" style="font-size:.7rem;color:var(--text-muted);transition:transform .2s;display:inline-block">&#9660;</span>
                  </div>
                </div>
                <div class="edc-person-list hidden">${personList}</div>
              </div>`;
          }).join('');

          const grandTotal = gatePaid.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
          edcEl.innerHTML = `
            <div class="edc-grand-total">
              <span>Total Collected at Gate</span>
              <span style="color:var(--accent);font-weight:700">${Helpers.currency(grandTotal)}</span>
            </div>
            ${collectorRows}`;
        }
      }


    } catch(e) { console.error('Dashboard error', e); }
  }

  // ── Pop-card: show filtered attendee list from dashboard count tiles ────────
  function showCountList(filter, title) {
    const list = _dashAttendees.filter(a => {
      if (filter === 'all')     return true;
      if (filter === 'present') return a.attendance === 'present';
      if (filter === 'absent')  return a.attendance !== 'present';
      if (filter === 'paid')    return (a.paymentStatus || '').toLowerCase() === 'paid';
      if (filter === 'unpaid')  return !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid';
      if (filter === 'free')    return (a.paymentStatus || '').toLowerCase() === 'free';
      if (filter === 'walkin')  return !!a.isWalkIn;
      return true;
    });

    if (!list.length) {
      Helpers.toast(`No records for "${title}"`, 'info');
      return;
    }

    const rows = list.map(a => {
      const ps = (a.paymentStatus || 'unpaid').toLowerCase();
      const psBadge = ps === 'paid' ? 'present' : ps === 'free' ? 'before' : 'unpaid';
      const attBadge = a.attendance === 'present' ? 'present' : 'absent-badge';
      const attLabel = a.attendance === 'present' ? 'Present' : 'Absent';
      return `<div class="pop-list-row">
        <div class="pop-list-main">
          <div class="pop-list-name">${a.name}${a.isWalkIn ? ' <span class="badge walkin">WI</span>' : ''}</div>
          <div class="pop-list-meta">${a.mobile || ''}${a.team ? ' · ' + a.team : ''}${a.category ? ' · ' + a.category : ''}</div>
        </div>
        <div class="pop-list-badges">
          <span class="badge ${attBadge}">${attLabel}</span>
          <span class="badge ${psBadge}">${ps}</span>
        </div>
      </div>`;
    }).join('');

    Helpers.modal(`
      <div class="pop-list-header">
        <div class="pop-list-title">${title}</div>
        <div class="pop-list-count">${list.length} person${list.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="pop-list-body">${rows}</div>
      <div style="margin-top:1rem;text-align:right">
        <button class="btn-ghost" onclick="Helpers.closeModal()">Close</button>
      </div>
    `);
  }

  // ===== IMPORT =====
  let importData = null;
  let importHeaders = null;

  // Template with headers + 2 sample rows so user knows exact format
  const TEMPLATE_HEADERS = [
    'Name', 'Mobile Number', 'Category', 'Reference', 'Team Name',
    'Pickup Point', 'Payment Status', 'Payment Remarks', 'Mode of Payment',
    'Payment Amt.'
  ];

  const TEMPLATE_SAMPLE = [
    ['Riya Gupta', '9876543210', 'IGF', 'Radha Mataji', 'Balaram',
     'Rohini Sec 3', 'Paid', 'Paid to Riya on 15 March', 'Cash', '500'],
    ['Amit Kumar', '8765432109', 'IYF', 'Krishna Prabhu', 'Champaklata',
     'Dwarka', 'Unpaid', '', '', '']
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
        ['Reference', 'No', 'Any text', 'Who referred this person (counselor name)'],
        ['Team Name', 'No', 'Any text', 'Team/group name'],
        ['Pickup Point', 'No', 'Any text', 'Where they will be picked up'],
        ['Payment Status', 'No', 'Paid / Unpaid / Free', 'Auto-detects: Yes=Paid, NA=Free'],
        ['Payment Remarks', 'No', 'Any text', 'Who paid, when, to whom — e.g. "Paid to Riya 20 March"'],
        ['Mode of Payment', 'No', 'Cash / Online / UPI', 'How they paid'],
        ['Payment Amt.', 'No', 'Number (rupees)', 'Amount received'],
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

  let _importInited = false;

  function initImport() {
    // Reset state on every visit so previous upload doesn't linger
    importData = null;
    importHeaders = null;
    document.getElementById('column-mapping-section').classList.add('hidden');
    const preview = document.getElementById('import-preview');
    if (preview) preview.classList.add('hidden');

    if (_importInited) return; // attach listeners only once
    _importInited = true;

    const zone = document.getElementById('upload-zone');
    const fileInput = document.getElementById('file-input');

    zone.ondragover  = e => { e.preventDefault(); zone.classList.add('dragover'); };
    zone.ondragleave = () => zone.classList.remove('dragover');
    zone.ondrop      = e => { e.preventDefault(); zone.classList.remove('dragover'); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); };
    zone.onclick     = () => fileInput.click();
    fileInput.onchange = e => { if (e.target.files[0]) processFile(e.target.files[0]); };

    document.getElementById('btn-confirm-import').onclick = confirmImport;
    document.getElementById('btn-cancel-import').onclick  = () => {
      document.getElementById('column-mapping-section').classList.add('hidden');
      importData = null;
      importHeaders = null;
    };
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

  // Parse amount — handles "1,500", "1500.50", "₹ 500", etc.
  function parseAmount(val) {
    if (!val && val !== 0) return 0;
    const cleaned = String(val).replace(/[₹,\s]/g, '');
    return parseFloat(cleaned) || 0;
  }

  // Normalize mobile — keep digits only, take last 10
  function normalizeMobile(val) {
    const digits = String(val || '').replace(/\D/g, '');
    return digits.length > 10 ? digits.slice(-10) : digits;
  }

  async function confirmImport() {
    if (!importData || !importHeaders) { Helpers.toast('Please upload a file first', 'error'); return; }

    const mapping = {};
    document.querySelectorAll('[data-field]').forEach(sel => {
      if (sel.value !== '') mapping[sel.dataset.field] = parseInt(sel.value);
    });
    if (!('name' in mapping)) { Helpers.toast('Name column is required', 'error'); return; }
    if (!('mobile' in mapping)) { Helpers.toast('Mobile Number column is required', 'error'); return; }

    const btn = document.getElementById('btn-confirm-import');
    btn.disabled = true;
    btn.textContent = 'Processing...';

    try {
      const eventDate = await DB.getConfig('eventDate');

      const records = importData.map(row => {
        const r = {
          attendance: 'absent', isWalkIn: false,
          paymentStatus: 'unpaid', paymentMode: '', paymentAmount: 0,
          paymentDate: '', remarks: '', serviceStatus: '', activeStatus: ''
        };

        SYSTEM_FIELDS.forEach(f => {
          if (f.key in mapping) {
            let val = row[mapping[f.key]];
            if (val instanceof Date) val = val.toISOString().slice(0, 10);
            r[f.key] = (val !== undefined && val !== null) ? String(val).trim() : '';
          }
        });

        // Normalize mobile — digits only, last 10 digits
        r.mobile = normalizeMobile(r.mobile);

        // Normalize payment amount — handle commas and currency symbols
        r.paymentAmount = parseAmount(r.paymentAmount);

        // Normalize payment status
        const ps = (r.paymentStatus || '').toLowerCase().trim();
        if (!ps || ps === '-' || ps === 'n/a' || ps === 'na') {
          r.paymentStatus = 'unpaid';
        } else if (['paid', 'yes', 'done', 'received', 'completed', 'haan', 'ha', 'p'].includes(ps)) {
          r.paymentStatus = 'paid';
        } else if (['free', 'complimentary', 'nil', 'no charge', 'exempt', 'f'].includes(ps)) {
          r.paymentStatus = 'free';
        } else if (ps.includes('partial') || ps.includes('advance') || ps.includes('part')) {
          r.paymentStatus = 'partial';
        } else if (['unpaid', 'no', 'pending', 'due', 'nhi', 'nahi', 'u'].includes(ps)) {
          r.paymentStatus = 'unpaid';
        } else if (!isNaN(parseAmount(ps)) && parseAmount(ps) > 0) {
          // Column has an amount number instead of status text
          r.paymentAmount = r.paymentAmount || parseAmount(ps);
          r.paymentStatus = 'paid';
        } else {
          // Unknown — preserve as remark, mark unpaid
          if (ps) r.remarks = (r.remarks ? r.remarks + '; ' : '') + 'Pay status: ' + r.paymentStatus;
          r.paymentStatus = 'unpaid';
        }

        // Normalize payment mode
        const pm = (r.paymentMode || '').toLowerCase().trim();
        if (pm.includes('cash') || pm.includes('hand') || pm.includes('naqd')) {
          r.paymentMode = 'cash';
        } else if (pm.includes('online') || pm.includes('upi') || pm.includes('gpay') ||
                   pm.includes('phonepe') || pm.includes('paytm') || pm.includes('neft') ||
                   pm.includes('rtgs') || pm.includes('imps') || pm.includes('bank') ||
                   pm.includes('transfer')) {
          r.paymentMode = 'online';
        } else if (pm === '-' || pm === '') {
          r.paymentMode = '';
        }
        // else keep original value if unrecognised

        // Auto-correct: amount > 0 but status still unpaid → mark paid
        if (r.paymentAmount > 0 && r.paymentStatus === 'unpaid') r.paymentStatus = 'paid';
        // Auto-correct: status is paid but no amount and no mode — leave as-is (pre-paid, amount unknown)

        r.paymentTiming = Helpers.paymentTiming(r.paymentDate, eventDate);
        r.attendeeId    = Helpers.generateId();
        r.createdAt     = new Date().toISOString();

        // Auto-assign category from team name if category is missing
        if (!r.category && r.team) {
          const guessed = getCategoryForTeam(r.team);
          if (guessed) r.category = guessed;
        }

        return r;
      }).filter(r => r.name && r.name.length > 0);

      if (!records.length) {
        Helpers.toast('No valid records found. Check that Name column has data.', 'error');
        btn.disabled = false; btn.textContent = 'Confirm Import';
        return;
      }

      const dupIds = Helpers.detectDuplicates(records);
      records.forEach((r, i) => { r.isDuplicate = dupIds.has(i); });

      const isReplace = document.getElementById('import-mode-replace')?.checked;
      btn.textContent = isReplace ? 'Replacing data...' : `Uploading ${records.length} records...`;

      if (isReplace) {
        await DB.clearStore(DB.STORES.attendees);
        allAttendees = [];
        attendanceInited = false;
      }

      await DB.bulkAdd(DB.STORES.attendees, records);
      await DB.log('import', `${isReplace ? 'Replaced' : 'Imported'} ${records.length} records (${dupIds.size} dups)`, currentUser?.email);

      document.getElementById('column-mapping-section').classList.add('hidden');
      showImportPreview(records, dupIds.size);
      Helpers.toast(`✓ ${records.length} records imported${dupIds.size ? `, ${dupIds.size} duplicates flagged` : ''}`, 'success');

      // Detect teams not in the predefined list — load saved map then prompt
      checkAndSaveUnknownTeams(records);

    } catch (err) {
      console.error('Import error:', err);
      Helpers.toast('Import failed: ' + (err.message || 'Check Firestore rules or connection'), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Confirm Import';
    }
  }

  async function checkAndSaveUnknownTeams(records) {
    // Load saved team→category mappings from this event's config
    const savedMapRaw = await DB.getConfig('teamCategoryMap');
    const savedMap    = savedMapRaw ? JSON.parse(savedMapRaw) : {};

    // Collect teams that aren't in the predefined list and not already mapped
    const allKnown = Object.values(Reports.CATEGORY_TEAMS).flat().map(t => t.toLowerCase());
    const unknownTeams = [...new Set(
      records
        .map(r => (r.team || '').trim())
        .filter(t => t && t !== 'Other' && !allKnown.includes(t.toLowerCase()) && !savedMap[t.toLowerCase()])
    )];

    if (!unknownTeams.length) return;

    // Show a modal to assign categories for unknown teams
    const selects = unknownTeams.map(t => `
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.5rem;flex-wrap:wrap">
        <span style="flex:1;min-width:120px;font-weight:500">${t}</span>
        <select class="wi-input unknown-team-cat" data-team="${t}" style="flex:1;min-width:130px">
          <option value="">— select category —</option>
          ${Object.keys(Reports.CATEGORY_TEAMS).map(c => `<option value="${c}">${c}</option>`).join('')}
          <option value="Other">Other</option>
        </select>
      </div>`).join('');

    Helpers.modal(`
      <h3 class="modal-title">&#128690; New Teams Found</h3>
      <p style="font-size:.82rem;color:var(--text-secondary);margin-bottom:.75rem">
        ${unknownTeams.length} team${unknownTeams.length > 1 ? 's' : ''} not in the predefined list. Assign ${unknownTeams.length > 1 ? 'their categories' : 'a category'} — this will be remembered for future imports.
      </p>
      ${selects}
      <div class="modal-actions" style="margin-top:1rem">
        <button class="btn-primary" id="btn-save-team-cats">Save &amp; Apply</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Skip</button>
      </div>
    `);

    document.getElementById('btn-save-team-cats').onclick = async () => {
      const newMap = { ...savedMap };
      document.querySelectorAll('.unknown-team-cat').forEach(sel => {
        if (sel.value) newMap[sel.dataset.team.toLowerCase()] = sel.value;
      });
      await DB.setConfig('teamCategoryMap', JSON.stringify(newMap));

      // Apply the new categories to any records that still lack one
      const affected = records.filter(r => {
        const t = (r.team || '').trim().toLowerCase();
        return newMap[t] && !r.category;
      });
      for (const r of affected) {
        r.category = newMap[(r.team || '').toLowerCase()];
        await DB.put(DB.STORES.attendees, r);
        const idx = allAttendees.findIndex(x => x.id === r.id);
        if (idx >= 0) allAttendees[idx] = { ...allAttendees[idx], ...r };
      }

      Helpers.closeModal();
      Helpers.toast('Team categories saved!', 'success');
    };
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
    searchInput.oninput = Helpers.debounce(render, 300);
    filterSelect.onchange = render;
    render();
    preview.scrollIntoView({ behavior: 'smooth' });
  }

  // ===== ATTENDANCE (ADMISSION) — PRD: <2 seconds, ONE TAP =====
  let attendanceInited = false;

  let _attFilter = 'all'; // module-level so renderAllAttendance can always read it

  function initAttendance() {
    updateAdmitCountersFromCache();
    primeAbsenteeMap();
    renderAllAttendance(); // always show full list on enter

    if (attendanceInited) return;
    attendanceInited = true;

    const searchInput = document.getElementById('att-search');
    searchInput.addEventListener('input', Helpers.debounce(() => {
      renderAllAttendance(searchInput.value);
    }, 150));

    // Quick filter tabs
    document.querySelectorAll('.att-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.att-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        _attFilter = tab.dataset.filter;
        renderAllAttendance(document.getElementById('att-search').value);
      });
    });

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

  // Render full attendance list with optional search + active tab filter
  function renderAllAttendance(query) {
    let list = allAttendees.slice();

    // Apply tab filter
    if (_attFilter === 'unpaid')  list = list.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid');
    else if (_attFilter === 'absent')  list = list.filter(a => a.attendance !== 'present');
    else if (_attFilter === 'present') list = list.filter(a => a.attendance === 'present');

    // Apply search
    if (query && query.trim()) list = list.filter(a => Helpers.searchFilter(a, query.trim()));

    const info = document.getElementById('att-list-info');
    if (info) info.textContent = `${list.length} of ${allAttendees.length} shown`;

    renderAttendanceResults(list.slice(0, 100));
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

  // Cross-event absentee warning: prime the cache when entering attendance page
  let _absenteeMap = null;
  function primeAbsenteeMap() {
    Reports.computeRepeatAbsenteeMap()
      .then(map => {
        _absenteeMap = map;
        // Re-render results so badges appear once the data lands
        if (currentPage === 'attendance') {
          const q = document.getElementById('att-search')?.value;
          renderAllAttendance(q);
        }
      })
      .catch(() => {});
  }
  function _mobileKey(m) { return (m || '').toString().replace(/\D/g, '').slice(-10); }
  function _nameNorm(s) { return (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, ''); }
  // Map keys are composite (e.g. "m:9876543210|n:priyanka") since the absentee
  // matrix dedupes by mobile + full name. Try the composite key first, then
  // fall back to mobile-only and name-only scans so existing devotees still
  // hit even if the spelling drifted slightly between events.
  function getAbsenteeInfo(mobileOrParticipant, nameMaybe) {
    if (!_absenteeMap) return null;
    const p = (typeof mobileOrParticipant === 'object' && mobileOrParticipant)
      ? mobileOrParticipant
      : { mobile: mobileOrParticipant, name: nameMaybe };
    const mob10 = _mobileKey(p.mobile);
    const nameN = _nameNorm(p.name);

    let entry = null;
    if (mob10 && nameN) entry = _absenteeMap.get(`m:${mob10}|n:${nameN}`);
    if (!entry && mob10) entry = _absenteeMap.get(`m:${mob10}`);
    if (!entry && mob10) {
      for (const [k, v] of _absenteeMap) {
        if (k.startsWith(`m:${mob10}`)) { entry = v; break; }
      }
    }
    if (!entry && nameN) entry = _absenteeMap.get(`n:${nameN}`);

    return (entry && entry.consecutive >= 1) ? entry : null;
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
      const absInfo = getAbsenteeInfo(a);
      const absBadge = absInfo
        ? `<div class="att-payment-badge" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d;margin-top:.2rem">&#9888; Absent in last ${absInfo.consecutive} event${absInfo.consecutive>1?'s':''}</div>`
        : '';

      if (isPres) {
        // Already admitted — green tick, show who admitted, NO re-admit
        return `
          <div class="att-result-card status-already-present" onclick="App.showDetail('${a.id}')" data-id="${a.id}">
            <div class="att-check-mark">&#10003;</div>
            <div class="att-result-info">
              <div class="att-name">${a.name}</div>
              <div class="att-meta">${a.mobile || ''} · ${a.team || ''}</div>
              <div class="att-payment-badge status-already-present">Admitted by ${a.markedBy || '?'} at ${Helpers.formatDateTime(a.entryTime)}</div>
              ${absBadge}
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
            ${absBadge}
          </div>
          <div class="att-admit-btn ${ps.cls}">${admitLabel}</div>
        </div>`;
    }).join('');
  }

  // INSTANT ADMIT — one tap, no modal for paid/free; payment collection for unpaid/partial
  async function instantAdmit(id, ackedAbsentee) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    if (a.attendance === 'present') {
      Helpers.toast(`Already admitted by ${a.markedBy}`, 'warning');
      return;
    }

    // Cross-event repeat-absentee alert (skipped once the user confirms)
    if (!ackedAbsentee) {
      const abs = getAbsenteeInfo(a);
      if (abs) {
        showAbsenteeWarning(a, abs);
        return;
      }
    }

    const ps = (a.paymentStatus || '').toLowerCase();
    const isUnpaid = ps === 'unpaid' || ps === 'partial' || ps === '';

    if (isUnpaid) {
      // Show payment collection panel before admitting
      showPaymentCollect(a);
      return;
    }

    await doAdmit(a);
  }

  // Modal warning shown before admitting a devotee with a cross-event absence streak
  function showAbsenteeWarning(a, abs) {
    const absentList = abs.history.slice(0, abs.consecutive).map(h =>
      `<li>${h.eventName}${h.date ? ' <span style="color:var(--text-muted);font-size:.8rem">· ' + Helpers.formatDate(h.date) + '</span>' : ''}</li>`
    ).join('');
    const lastAtt = abs.lastAttended
      ? `${abs.lastAttended.eventName}${abs.lastAttended.date ? ' (' + Helpers.formatDate(abs.lastAttended.date) + ')' : ''}`
      : 'Never attended any past event';

    Helpers.modal(`
      <h3 class="modal-title" style="color:#92400e">&#9888; Repeat Absentee Alert</h3>
      <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:8px;padding:.85rem;margin-bottom:.75rem">
        <div style="font-weight:700;font-size:1.05rem">${a.name}</div>
        <div style="color:var(--text-muted);font-size:.85rem">${a.mobile || ''} · ${a.team || ''}</div>
        <div style="margin-top:.5rem;font-size:.95rem">
          Was <b>absent in the last ${abs.consecutive} consecutive past event${abs.consecutive>1?'s':''}</b>.
        </div>
      </div>
      <div style="font-size:.88rem;margin-bottom:.4rem"><b>Absent in:</b></div>
      <ul style="margin:0 0 .75rem 1.2rem;padding:0;font-size:.88rem">${absentList}</ul>
      <div style="font-size:.88rem;margin-bottom:1rem"><b>Last attended:</b> ${lastAtt}</div>
      <div style="display:flex;gap:.5rem;justify-content:flex-end">
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
        <button class="btn-primary" onclick="Helpers.closeModal();App.instantAdmit('${a.id}', true)">Admit Anyway</button>
      </div>
    `);
  }

  // Show bottom panel to collect payment info for unpaid attendees
  function showPaymentCollect(a) {
    const panel = document.getElementById('payment-collect-panel');
    document.getElementById('pc-name').textContent = a.name;
    document.getElementById('pc-attendee-id').value = a.id;
    document.getElementById('pc-amount').value = a.paymentAmount > 0 ? a.paymentAmount : '';
    document.getElementById('pc-remarks').value = '';
    document.getElementById('pc-mode-cash').checked = true;
    document.getElementById('pc-screenshot-wrap').style.display = 'none';
    document.getElementById('pc-screenshot').value = '';
    document.getElementById('pc-screenshot-preview').innerHTML = '';
    panel.classList.remove('hidden');
    document.getElementById('pc-amount').focus();
  }

  // Actually perform the admission (shared by instant and payment-collect flow)
  async function doAdmit(a, extraPayment) {
    a.attendance = 'present';
    a.entryTime  = new Date().toISOString();
    a.markedBy   = currentUser?.name || 'Unknown';
    const myBus  = getMyBus();
    if (myBus) a.boardedBus = myBus;

    if (extraPayment && extraPayment.collected) {
      // Payment was collected at the gate — mark as PAID
      a.paymentStatus  = 'paid';
      a.paidAtEvent    = true;                            // event-day collection flag
      a.collectedBy    = currentUser?.name || 'Unknown'; // volunteer who collected
      if (extraPayment.amount > 0)     a.paymentAmount = extraPayment.amount;
      if (extraPayment.paymentMode)    a.paymentMode   = extraPayment.paymentMode;
      if (extraPayment.remarks)        a.remarks       = extraPayment.remarks;
      if (extraPayment.screenshotUrl)  a.screenshotUrl = extraPayment.screenshotUrl;
    }

    await DB.put(DB.STORES.attendees, a);
    await DB.log('checkin', `${a.name} checked in${extraPayment?.collected ? ' (paid at gate)' : ''}`, currentUser?.email);
    Helpers.toast(`${a.name} admitted!`, 'success');

    // Update local cache unconditionally so counters + search are immediately accurate
    const idx = allAttendees.findIndex(x => x.id === a.id);
    if (idx >= 0) {
      allAttendees[idx] = { ...allAttendees[idx], ...a };
    }
    const q = document.getElementById('att-search')?.value;
    if (q) searchAttendeesFromCache(q);
    updateAdmitCountersFromCache();
  }

  // Called from payment-collect panel submit
  // skip=true → admit without recording payment (still shows unpaid in reports)
  async function submitPaymentCollect(skip) {
    const id = document.getElementById('pc-attendee-id').value;
    const a  = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;

    document.getElementById('payment-collect-panel').classList.add('hidden');

    if (skip) {
      // Admit without marking paid — person stays unpaid in reports
      await doAdmit(a);
      return;
    }

    const amount  = parseFloat(document.getElementById('pc-amount').value) || 0;
    const remarks = document.getElementById('pc-remarks').value.trim();
    const mode    = document.getElementById('pc-mode-online').checked ? 'online' : 'cash';
    const screenshotInput = document.getElementById('pc-screenshot');

    let screenshotUrl = '';
    if (mode === 'online' && screenshotInput.files && screenshotInput.files[0]) {
      screenshotUrl = await readFileAsDataUrl(screenshotInput.files[0]);
    }

    await doAdmit(a, { collected: true, amount, paymentMode: mode, remarks, screenshotUrl });
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
    a.paymentMode   = document.getElementById('m-pay-mode').value;
    a.remarks       = document.getElementById('m-pay-remarks').value.trim();
    a.paymentDate   = a.paymentDate || new Date().toISOString().slice(0, 10);
    await DB.put(DB.STORES.attendees, a);
    await DB.log('payment', `Payment updated: ${a.name} → ${a.paymentStatus}`, currentUser?.email);

    // Keep local cache consistent
    const idx = allAttendees.findIndex(x => x.id === a.id);
    if (idx >= 0) allAttendees[idx] = { ...allAttendees[idx], ...a };

    Helpers.closeModal();
    Helpers.toast('Payment updated', 'success');
    const q = document.getElementById('att-search')?.value;
    if (q) searchAttendeesFromCache(q);
    updateAdmitCountersFromCache();
  }

  async function unmarkAttendance(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    a.attendance = 'absent';
    a.entryTime  = null;
    a.markedBy   = null;
    await DB.put(DB.STORES.attendees, a);

    // Keep local cache consistent
    const idx = allAttendees.findIndex(x => x.id === a.id);
    if (idx >= 0) allAttendees[idx] = { ...allAttendees[idx], ...a };

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

      filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
      document.getElementById('attendees-count').textContent = `${filtered.length} attendees`;

      const rows = filtered.slice(0, PAGE_SIZE).map((a, i) => {
        const payBadge = a.paymentStatus === 'paid'
          ? `<span class="badge present">Paid</span>`
          : a.paymentStatus === 'free'
            ? `<span class="badge before">Free</span>`
            : `<span class="badge unpaid">Unpaid</span>`;
        const attVal  = a.attendance === 'present'
          ? (a.isWalkIn ? 'Present (walk-in)' : 'Presnt')
          : 'Absent';
        const attBadge = a.attendance === 'present'
          ? `<span class="badge present">${attVal}</span>`
          : `<span class="badge absent">Absent</span>`;
        const rowCls = a.isDuplicate && !a.dupResolved ? 'duplicate-row' : a.isWalkIn ? 'walkin-row' : '';
        const nameTags = (a.isDuplicate && !a.dupResolved ? ' <span class="badge dup">dup</span>' : '') + (a.isWalkIn ? ' <span class="badge walkin">WI</span>' : '');
        return `<tr class="${rowCls}">
          <td class="att-col-sr">${i + 1}</td>
          <td class="att-col-name att-sticky-name">${a.name}${nameTags}</td>
          <td class="att-col-mobile">${a.mobile || '-'}</td>
          <td class="att-col-cat">${a.category || '-'}</td>
          <td class="att-col-ref">${a.reference || '-'}</td>
          <td class="att-col-team">${a.team || '-'}</td>
          <td class="att-col-pickup">${a.pickupLocation || '-'}</td>
          <td class="att-col-ps">${payBadge}</td>
          <td class="att-col-remarks">${a.remarks || '-'}</td>
          <td class="att-col-mode">${a.paymentMode || '-'}</td>
          <td class="att-col-amt">${a.paymentAmount > 0 ? a.paymentAmount : '-'}</td>
          <td class="att-col-att">${attBadge}</td>
          <td class="att-col-by">${a.markedBy || '-'}</td>
          <td class="att-col-at">${a.entryTime ? new Date(a.entryTime).toLocaleString('en-IN') : '-'}</td>
          <td class="att-col-action">
            <button class="btn-small" onclick="App.showDetail('${a.id}')">View</button>
            ${a.isDuplicate && !a.dupResolved ? `<button class="btn-small warning" onclick="App.resolveDuplicate('${a.id}')">Resolve</button>` : ''}
          </td>
        </tr>`;
      }).join('');

      document.getElementById('attendees-table-wrap').innerHTML = `
        <div class="att-table-scroll">
          <table class="att-table">
            <thead>
              <tr>
                <th class="att-col-sr">Sr. No.</th>
                <th class="att-col-name att-sticky-name">Name</th>
                <th class="att-col-mobile">Mobile number</th>
                <th class="att-col-cat">Category</th>
                <th class="att-col-ref">Reference</th>
                <th class="att-col-team">Team Name</th>
                <th class="att-col-pickup">Pickup Point</th>
                <th class="att-col-ps">Payment Status</th>
                <th class="att-col-remarks">Payment Remarks</th>
                <th class="att-col-mode">Mode of Payment</th>
                <th class="att-col-amt">Payment Amt.</th>
                <th class="att-col-att">Attendence</th>
                <th class="att-col-by">Admitted by</th>
                <th class="att-col-at">Admitted at</th>
                <th class="att-col-action">Actions</th>
              </tr>
            </thead>
            <tbody>${rows || '<tr><td colspan="15" style="text-align:center;color:var(--text-muted);padding:2rem">No attendees found</td></tr>'}</tbody>
          </table>
        </div>`;
    };

    // Use oninput assignment (not addEventListener) so re-entering this page doesn't stack handlers
    const debouncedRender = Helpers.debounce(renderFiltered, 200);
    search.oninput  = debouncedRender;
    teamSel.oninput = debouncedRender;
    catSel.oninput  = debouncedRender;
    attSel.oninput  = debouncedRender;
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
    loadReport();
  }

  async function loadReport() {
    const el = document.getElementById('report-content');
    el.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">Loading...</p>';
    try {
      const data = await Reports.reportData();
      el.innerHTML = Reports.renderReports(data);
      Reports.initReportFilters(data);
    } catch (err) {
      el.innerHTML = `<p style="color:var(--danger);padding:2rem">Error: ${err.message}</p>`;
    }
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

  // ===== SETTINGS — menu only, each option opens a modal =====
  function initSettings() {
    document.getElementById('smenu-event').onclick      = openEventConfigModal;
    document.getElementById('smenu-users').onclick      = openTeamAccessModal;
    document.getElementById('smenu-buses').onclick      = openBusRoutesModal;
    document.getElementById('smenu-bus-manage').onclick = openBusManageModal;
    document.getElementById('smenu-danger').onclick     = openDangerZoneModal;
  }

  async function openEventConfigModal() {
    const evt = await DB.getEvent(DB.getCurrentEvent());
    Helpers.modal(`
      <h3 class="modal-title">&#128197; Event Configuration</h3>
      <div class="input-group" style="margin-bottom:.75rem">
        <label class="settings-label">Event Name</label>
        <input type="text" id="m-cfg-name" class="wi-input" value="${(evt?.name || '').replace(/"/g,'&quot;')}" style="width:100%" placeholder="e.g. Prerna 2025" />
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label class="settings-label">Event Date</label>
        <input type="date" id="m-cfg-date" class="wi-input" value="${evt?.date || ''}" style="width:100%" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1.25rem">
        <div>
          <label class="settings-label">Charge Per Person (&#8377;)</label>
          <input type="number" id="m-cfg-charge" class="wi-input" value="${evt?.chargePerPerson || 0}" min="0" style="width:100%" />
        </div>
        <div>
          <label class="settings-label">Other Expense Budget (&#8377;)</label>
          <input type="number" id="m-cfg-expense" class="wi-input" value="${evt?.totalExpense || 0}" min="0" style="width:100%" />
        </div>
      </div>
      <div class="modal-actions" style="margin-bottom:1rem">
        <button class="btn-primary" onclick="App.saveEventConfig()">Save Changes</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin-bottom:1rem">
      <div style="display:flex;gap:.75rem;flex-wrap:wrap">
        <button class="btn-secondary" onclick="App.showCreateEventModal()">+ New Event</button>
        <button class="btn-danger" id="m-btn-del-evt">Delete This Event</button>
      </div>
    `);
    document.getElementById('m-btn-del-evt').onclick = async () => {
      const evtName = document.getElementById('m-cfg-name')?.value || 'this event';
      Helpers.modal(`
        <h3 class="modal-title" style="color:var(--danger)">Delete Event?</h3>
        <p style="color:var(--text-secondary);margin-bottom:.75rem">Permanently deletes <strong>${evtName}</strong> and all its data. Cannot be undone.</p>
        <p style="color:var(--text-secondary);margin-bottom:.5rem">Type <strong>DELETE</strong> to confirm:</p>
        <input type="text" id="m-del-evt-confirm" class="wi-input" placeholder="DELETE" style="width:100%;margin-bottom:1rem" autofocus />
        <div class="modal-actions">
          <button class="btn-danger" id="m-confirm-del-evt">Delete Event</button>
          <button class="btn-ghost" onclick="App.openEventConfigModal()">Back</button>
        </div>
      `);
      document.getElementById('m-confirm-del-evt').onclick = async () => {
        if ((document.getElementById('m-del-evt-confirm').value || '').trim() !== 'DELETE') {
          Helpers.toast('Type DELETE exactly', 'error'); return;
        }
        const btn = document.getElementById('m-confirm-del-evt');
        btn.disabled = true; btn.textContent = 'Deleting...';
        try {
          await DB.deleteEvent(DB.getCurrentEvent());
          DB.setCurrentEvent(null);
          allAttendees = []; attendanceInited = false;
          Helpers.closeModal();
          await loadEventSelector();
          Helpers.toast('Event deleted', 'success');
          navigate('attendance');
        } catch (err) {
          btn.disabled = false; btn.textContent = 'Delete Event';
          Helpers.toast('Error: ' + (err.message || 'Permission denied'), 'error');
        }
      };
    };
  }

  async function saveEventConfig() {
    const name      = document.getElementById('m-cfg-name').value;
    const date      = document.getElementById('m-cfg-date').value;
    const charge    = parseFloat(document.getElementById('m-cfg-charge').value) || 0;
    const expense   = parseFloat(document.getElementById('m-cfg-expense').value) || 0;
    await DB.updateEvent(DB.getCurrentEvent(), { name, date, chargePerPerson: charge, totalExpense: expense, financialYear: date ? Helpers.getFinancialYear(date) : '' });
    await DB.setConfig('eventName', name);
    await DB.setConfig('eventDate', date);
    await DB.setConfig('chargePerPerson', charge);
    await loadEventSelector();
    Helpers.closeModal();
    Helpers.toast('Event saved!', 'success');
  }

  async function openTeamAccessModal() {
    Helpers.modal(`
      <h3 class="modal-title">&#128101; Team &amp; Access</h3>
      <p style="font-size:.78rem;color:var(--text-muted);margin-bottom:.75rem">Manage who can use this app and their permissions.</p>
      <div id="users-list"></div>
      <button class="btn-secondary" style="margin-top:.75rem;width:100%" onclick="App.showAddUserModal()">+ Invite User</button>
    `);
    await renderUsers();
  }

  async function openBusRoutesModal() {
    Helpers.modal(`
      <h3 class="modal-title">&#128652; Bus Routes (Financial)</h3>
      <div id="bus-routes-list" style="margin-bottom:.25rem"></div>
      <div id="bus-add-inline" style="display:none;background:var(--bg-card2);border-radius:var(--radius-sm);padding:.85rem;margin-top:.75rem">
        <div class="input-group" style="margin-bottom:.5rem">
          <label class="settings-label">Route Name</label>
          <input id="m-route-name" type="text" class="wi-input" style="width:100%" placeholder="e.g. Rajkot North" />
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem">
          <div><label class="settings-label">No. of Buses</label><input id="m-route-count" type="number" value="1" min="1" class="wi-input" style="width:100%" /></div>
          <div><label class="settings-label">Cost per Bus (&#8377;)</label><input id="m-route-cost" type="number" class="wi-input" style="width:100%" /></div>
        </div>
        <div class="input-group" style="margin-bottom:.75rem">
          <label class="settings-label">Capacity (seats)</label>
          <input id="m-route-cap" type="number" class="wi-input" style="width:100%" />
        </div>
        <div style="display:flex;gap:.5rem">
          <button class="btn-primary" style="flex:1" onclick="App.saveBusRoute()">Save Route</button>
          <button class="btn-ghost" onclick="document.getElementById('bus-add-inline').style.display='none'">Cancel</button>
        </div>
      </div>
      <button class="btn-secondary" id="m-btn-show-add-bus" style="margin-top:.75rem;width:100%">+ Add Bus Route</button>
    `);
    document.getElementById('m-btn-show-add-bus').onclick = () => {
      document.getElementById('bus-add-inline').style.display = 'block';
      document.getElementById('m-route-name').focus();
    };
    await renderBusRoutes();
  }

  function openDangerZoneModal() {
    Helpers.modal(`
      <h3 class="modal-title" style="color:var(--danger)">&#9888; Danger Zone</h3>
      <div class="settings-action-row">
        <div>
          <div class="settings-action-title">Clear Attendance</div>
          <div class="settings-action-desc">Unmark everyone as present. Payment data stays.</div>
        </div>
        <button class="btn-danger" id="m-btn-clr-att">Clear</button>
      </div>
      <div class="settings-action-row">
        <div>
          <div class="settings-action-title">Re-import (Replace Data)</div>
          <div class="settings-action-desc">Delete all participants and re-upload a fresh sheet.</div>
        </div>
        <button class="btn-danger" id="m-btn-reimport">Clear &amp; Re-import</button>
      </div>
      <div class="settings-action-row">
        <div>
          <div class="settings-action-title">Delete All Data</div>
          <div class="settings-action-desc">Wipes all participants, buses, logs. Cannot be undone.</div>
        </div>
        <button class="btn-danger" id="m-btn-del-all">Delete All</button>
      </div>
    `);

    document.getElementById('m-btn-clr-att').onclick = () => {
      Helpers.modal(`
        <h3 class="modal-title" style="color:var(--danger)">Clear All Attendance?</h3>
        <p style="color:var(--text-secondary);margin-bottom:1.25rem">Unmarks everyone as present. Payment data stays intact.</p>
        <div class="modal-actions">
          <button class="btn-danger" id="m-confirm-clr-att">Yes, Clear</button>
          <button class="btn-ghost" onclick="App.openDangerZoneModal()">Back</button>
        </div>
      `);
      document.getElementById('m-confirm-clr-att').onclick = async () => {
        Helpers.closeModal();
        Helpers.toast('Clearing attendance...', 'info');
        try {
          const all = await DB.getAll(DB.STORES.attendees);
          if (!all.length) { Helpers.toast('No records to clear', 'warning'); return; }
          for (const a of all) { a.attendance = 'absent'; a.entryTime = null; a.markedBy = null; await DB.put(DB.STORES.attendees, a); }
          allAttendees = []; attendanceInited = false;
          Helpers.toast(`Attendance cleared for ${all.length} records`, 'success');
        } catch (err) { Helpers.toast('Error: ' + (err.message || 'Permission denied'), 'error'); }
      };
    };

    document.getElementById('m-btn-reimport').onclick = () => {
      Helpers.modal(`
        <h3 class="modal-title" style="color:var(--danger)">Clear &amp; Re-import?</h3>
        <p style="color:var(--text-secondary);margin-bottom:1.25rem">Deletes <strong>all participant data</strong> for this event, then takes you to Import.</p>
        <div class="modal-actions">
          <button class="btn-danger" id="m-confirm-reimport">Yes, Clear Data</button>
          <button class="btn-ghost" onclick="App.openDangerZoneModal()">Back</button>
        </div>
      `);
      document.getElementById('m-confirm-reimport').onclick = async () => {
        Helpers.closeModal();
        try {
          await DB.clearStore(DB.STORES.attendees);
          await DB.clearStore(DB.STORES.auditLog);
          allAttendees = []; attendanceInited = false;
          Helpers.toast('Data cleared. Upload your new sheet.', 'success');
          navigate('import');
        } catch (err) { Helpers.toast('Error: ' + (err.message || 'Permission denied'), 'error'); }
      };
    };

    document.getElementById('m-btn-del-all').onclick = () => {
      Helpers.modal(`
        <h3 class="modal-title" style="color:var(--danger)">Delete All Data?</h3>
        <p style="color:var(--text-secondary);margin-bottom:.75rem">Permanently deletes <strong>all participants, buses and logs</strong> for this event. The event itself stays.</p>
        <p style="color:var(--text-secondary);margin-bottom:.5rem">Type <strong>DELETE</strong> to confirm:</p>
        <input type="text" id="m-del-all-input" class="wi-input" placeholder="DELETE" style="width:100%;margin-bottom:1rem" autofocus />
        <div class="modal-actions">
          <button class="btn-danger" id="m-confirm-del-all">Delete All Data</button>
          <button class="btn-ghost" onclick="App.openDangerZoneModal()">Back</button>
        </div>
      `);
      document.getElementById('m-confirm-del-all').onclick = async () => {
        if ((document.getElementById('m-del-all-input').value || '').trim() !== 'DELETE') {
          Helpers.toast('Type DELETE exactly', 'error'); return;
        }
        const btn = document.getElementById('m-confirm-del-all');
        btn.disabled = true; btn.textContent = 'Deleting...';
        try {
          await DB.clearStore(DB.STORES.attendees);
          await DB.clearStore(DB.STORES.busRoutes);
          await DB.clearStore(DB.STORES.auditLog);
          allAttendees = []; attendanceInited = false;
          Helpers.closeModal();
          Helpers.toast('All data deleted', 'success');
        } catch (err) {
          btn.disabled = false; btn.textContent = 'Delete All Data';
          Helpers.toast('Error: ' + (err.message || 'Permission denied'), 'error');
        }
      };
    };
  }

  function showMyAccountModal() {
    Helpers.modal(`
      <h3 class="modal-title">&#128100; My Account</h3>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Full Name</label>
        <input type="text" id="m-profile-name" value="${(currentUser?.name || '').replace(/"/g,'&quot;')}" />
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Email</label>
        <input type="email" id="m-profile-email" value="${currentUser?.email || ''}" disabled style="opacity:.6" />
      </div>
      <p style="font-size:.8rem;color:var(--text-muted);margin-bottom:.75rem">Role: <strong>${currentUser?.role === 'admin' ? 'Administrator' : 'Volunteer'}</strong></p>
      <button class="btn-primary" id="m-btn-save-profile" style="width:100%">Save Profile</button>
      <hr style="margin:1rem 0;border:none;border-top:1px solid var(--border)">
      <label style="font-size:.85rem;font-weight:600;display:block;margin-bottom:.5rem">Change Password</label>
      <div class="pw-wrap" style="margin-bottom:.75rem">
        <input type="password" id="m-new-password" placeholder="Min 6 characters" style="width:100%;padding:.7rem 2.5rem .7rem .9rem;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--radius-sm);color:var(--text-primary);font-size:.9rem" />
        <button type="button" id="m-pw-toggle" class="pw-toggle">&#128065;</button>
      </div>
      <button class="btn-secondary" id="m-btn-change-pw" style="width:100%">Change Password</button>
    `);
    document.getElementById('m-btn-save-profile').onclick = async () => {
      const name = document.getElementById('m-profile-name').value.trim();
      if (!name) { Helpers.toast('Name required', 'error'); return; }
      await DB.setUserProfile(currentUser.uid, { name });
      currentUser.name = name;
      document.getElementById('sidebar-username').textContent = name;
      document.getElementById('sidebar-avatar').textContent = name[0].toUpperCase();
      Helpers.toast('Profile saved', 'success');
      Helpers.closeModal();
    };
    document.getElementById('m-btn-change-pw').onclick = async () => {
      const pw = document.getElementById('m-new-password').value;
      if (!pw || pw.length < 6) { Helpers.toast('Min 6 characters', 'error'); return; }
      try {
        await auth.currentUser.updatePassword(pw);
        document.getElementById('m-new-password').value = '';
        Helpers.toast('Password changed!', 'success');
      } catch (err) {
        if (err.code === 'auth/requires-recent-login') Helpers.toast('Please re-login first', 'warning');
        else Helpers.toast('Failed: ' + err.message, 'error');
      }
    };
    document.getElementById('m-pw-toggle').onclick = () => {
      const inp = document.getElementById('m-new-password');
      const isPass = inp.type === 'password';
      inp.type = isPass ? 'text' : 'password';
      document.getElementById('m-pw-toggle').innerHTML = isPass ? '&#128584;' : '&#128065;';
    };
  }

  async function renderBusRoutes() {
    const routes = await DB.getAll(DB.STORES.busRoutes);
    document.getElementById('bus-routes-list').innerHTML = routes.map(r => {
      const count = parseInt(r.busCount || 1);
      const cost  = parseFloat(r.cost || 0);
      return `<div class="bus-route-row">
        <div class="bus-route-info">
          <div class="bus-route-name">${r.name}</div>
          <div class="bus-route-meta">${count} bus${count !== 1 ? 'es' : ''} &nbsp;·&nbsp; ${Helpers.currency(cost)}/bus &nbsp;·&nbsp; Total: ${Helpers.currency(count * cost)} &nbsp;·&nbsp; Capacity: ${r.capacity || '—'}</div>
        </div>
        <button class="btn-small danger" onclick="App.deleteBusRoute('${r.id}')">✕</button>
      </div>`;
    }).join('') || '<p style="color:var(--text-muted);font-size:.85rem">No routes configured</p>';
  }

  function showAddBusRouteModal() {
    Helpers.modal(`<h3 class="modal-title">Add Bus Route</h3>
      <div class="input-group" style="margin-bottom:.75rem"><label>Route Name</label><input id="m-route-name" type="text" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>No. of Buses</label><input id="m-route-count" type="number" value="1" min="1" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Cost per Bus (₹)</label><input id="m-route-cost" type="number" /></div>
      <div class="input-group" style="margin-bottom:.75rem"><label>Capacity (seats)</label><input id="m-route-cap" type="number" /></div>
      <div class="modal-actions"><button class="btn-primary" onclick="App.saveBusRoute()">Save</button><button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button></div>`);
  }

  async function saveBusRoute() {
    const name     = document.getElementById('m-route-name').value.trim();
    if (!name) { Helpers.toast('Name required', 'error'); return; }
    const busCount = parseInt(document.getElementById('m-route-count')?.value) || 1;
    const cost     = parseFloat(document.getElementById('m-route-cost')?.value) || 0;
    const capacity = parseInt(document.getElementById('m-route-cap')?.value) || 0;
    await DB.add(DB.STORES.busRoutes, { name, busCount, cost, capacity, chargePerPassenger: 0 });
    Helpers.toast('Bus route added', 'success');
    const inlineForm = document.getElementById('bus-add-inline');
    if (inlineForm) {
      inlineForm.style.display = 'none';
      ['m-route-name','m-route-cost','m-route-cap'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.getElementById('m-route-count').value = '1';
      renderBusRoutes();
    } else {
      Helpers.closeModal();
    }
    if (currentPage === 'dashboard') initDashboard();
  }

  // ===== BUS MANAGEMENT (live boarding — separate from financial bus routes) =====
  async function openBusManageModal() {
    const busCoordHead = await DB.getConfig('busCoordinatorHead') || '';
    Helpers.modal(`
      <h3 class="modal-title">&#128652; Bus Management</h3>
      <div style="display:grid;grid-template-columns:1fr auto;gap:.5rem;align-items:end;margin-bottom:1rem">
        <div>
          <label class="settings-label">Bus Coordinator Head</label>
          <input id="m-bus-coord-head" type="text" class="wi-input" style="width:100%" placeholder="Overall head name" value="${(busCoordHead).replace(/"/g,'&quot;')}" />
        </div>
        <button class="btn-secondary" style="white-space:nowrap" onclick="App._saveBusCoordHead()">Save</button>
      </div>
      <hr style="border:none;border-top:1px solid var(--border);margin-bottom:.75rem">
      <div id="bus-manage-list" style="margin-bottom:.5rem"></div>
      <div id="bus-add-form" style="display:none;background:var(--bg-card2);border-radius:var(--radius-sm);padding:.85rem;margin-top:.5rem">
        <div class="input-group" style="margin-bottom:.5rem">
          <label class="settings-label">Bus Name</label>
          <input id="m-bus-name" type="text" class="wi-input" style="width:100%" placeholder="e.g. Bus 1" />
        </div>
        <div class="input-group" style="margin-bottom:.5rem">
          <label class="settings-label">Coordinator Name</label>
          <input id="m-bus-coordinator" type="text" class="wi-input" style="width:100%" placeholder="Name of coordinator for this bus" />
        </div>
        <div class="input-group" style="margin-bottom:.75rem">
          <label class="settings-label">Capacity (seats)</label>
          <input id="m-bus-capacity" type="number" class="wi-input" style="width:100%" placeholder="e.g. 50" />
        </div>
        <div style="display:flex;gap:.5rem">
          <button class="btn-primary" style="flex:1" onclick="App.saveBus()">Add Bus</button>
          <button class="btn-ghost" onclick="document.getElementById('bus-add-form').style.display='none'">Cancel</button>
        </div>
      </div>
      <button class="btn-secondary" id="m-btn-show-add-bus-new" style="margin-top:.5rem;width:100%">+ Add Bus</button>
    `);
    document.getElementById('m-btn-show-add-bus-new').onclick = () => {
      document.getElementById('bus-add-form').style.display = 'block';
      document.getElementById('m-bus-name').focus();
    };
    await renderBusManageList();
  }

  async function renderBusManageList() {
    const buses = await DB.getAll(DB.STORES.buses);
    const el = document.getElementById('bus-manage-list');
    if (!el) return;
    el.innerHTML = buses.map(b => `
      <div class="bus-route-row">
        <div class="bus-route-info">
          <div class="bus-route-name">${b.name}</div>
          <div class="bus-route-meta">&#128100; ${b.coordinator || '—'} &nbsp;·&nbsp; Capacity: ${b.capacity || '—'}</div>
        </div>
        <button class="btn-small danger" onclick="App.deleteBus('${b.id}')">✕</button>
      </div>`).join('') || '<p style="color:var(--text-muted);font-size:.85rem">No buses added yet</p>';
  }

  async function saveBus() {
    const name        = (document.getElementById('m-bus-name')?.value || '').trim();
    if (!name) { Helpers.toast('Bus name required', 'error'); return; }
    const coordinator = (document.getElementById('m-bus-coordinator')?.value || '').trim();
    const capacity    = parseInt(document.getElementById('m-bus-capacity')?.value) || 0;
    await DB.add(DB.STORES.buses, { name, coordinator, capacity });
    Helpers.toast(`${name} added`, 'success');
    document.getElementById('bus-add-form').style.display = 'none';
    ['m-bus-name','m-bus-coordinator','m-bus-capacity'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    await renderBusManageList();
    if (currentPage === 'dashboard') initDashboard();
    if (currentPage === 'attendance') initMyBusPicker();
  }

  async function deleteBus(id) {
    await DB.deleteRecord(DB.STORES.buses, id);
    await renderBusManageList();
    if (currentPage === 'dashboard') initDashboard();
    if (currentPage === 'attendance') initMyBusPicker();
  }

  async function _saveBusCoordHead() {
    const name = (document.getElementById('m-bus-coord-head')?.value || '').trim();
    await DB.setConfig('busCoordinatorHead', name);
    Helpers.toast('Saved', 'success');
    if (currentPage === 'dashboard') initDashboard();
  }

  async function deleteBusRoute(id) {
    await DB.deleteRecord(DB.STORES.busRoutes, id);
    renderBusRoutes();
    if (currentPage === 'dashboard') initDashboard();
  }

  // Called from dashboard bus table (not Settings page)
  function showAddBusModal() { showAddBusRouteModal(); }
  async function deleteBusRouteFromDash(id) { await deleteBusRoute(id); }

  async function renderUsers() {
    const snap = await firestore.collection('users').get();
    const users = snap.docs.map(doc => ({ uid: doc.id, ...doc.data() }))
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    document.getElementById('users-list').innerHTML = users.length ? users.map(u => {
      const isYou = u.uid === currentUser?.uid;
      const isAdmin = u.role === 'admin';
      const roleBadge = isAdmin
        ? `<span class="badge present" style="font-size:.7rem">Admin</span>`
        : `<span class="badge before" style="font-size:.7rem">Volunteer</span>`;
      const actionBtn = isYou
        ? `<span style="font-size:.72rem;color:var(--text-muted);padding:.25rem .5rem">You</span>`
        : isAdmin
          ? `<button class="btn-small warning" onclick="App.toggleUserRole('${u.uid}','${u.role}')">Make Volunteer</button>`
          : `<button class="btn-small" onclick="App.toggleUserRole('${u.uid}','${u.role}')">Make Admin</button>`;
      return `<div class="user-row">
        <div class="user-row-avatar">${((u.name || u.email || '?')[0]).toUpperCase()}</div>
        <div class="user-row-info">
          <div class="user-row-name">${u.name || '—'}</div>
          <div class="user-row-meta">${u.email}</div>
        </div>
        ${roleBadge}
        ${actionBtn}
      </div>`;
    }).join('') : '<p style="color:var(--text-muted);font-size:.85rem;padding:.5rem 0">No users found</p>';
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

  // ── OCR Attendance Sheet ──────────────────────────────────────────────────

  function openOcrModal() {
    Helpers.modal(`
      <h3 class="modal-title">&#128247; Scan Attendance Sheet</h3>
      <p style="font-size:.82rem;color:var(--text-secondary);margin-bottom:.75rem">
        Take a photo of your handwritten attendance sheet. The app will read the names and match them to registered attendees.
      </p>
      <div id="ocr-upload-area">
        <label style="display:block;border:2px dashed var(--border);border-radius:var(--radius-sm);padding:1.5rem;text-align:center;cursor:pointer;color:var(--text-muted);background:var(--bg-card2)" id="ocr-drop-label">
          <div style="font-size:2rem;margin-bottom:.4rem">&#128247;</div>
          <div style="font-weight:500;margin-bottom:.25rem">Tap to upload photo</div>
          <div style="font-size:.78rem">or use camera on mobile</div>
          <input type="file" id="ocr-file-input" accept="image/*" capture="environment" hidden />
        </label>
        <div id="ocr-preview" style="margin-top:.75rem;display:none">
          <img id="ocr-img" style="max-width:100%;border-radius:var(--radius-sm);border:1px solid var(--border)" />
        </div>
        <button class="btn-primary" id="ocr-run-btn" style="width:100%;margin-top:.75rem;display:none">&#128269; Extract Names</button>
      </div>
      <div id="ocr-processing" style="display:none;text-align:center;padding:1.5rem 0;color:var(--text-muted)">
        <div style="font-size:1.5rem;margin-bottom:.5rem">&#8987;</div>
        <div>Reading handwriting... this takes a few seconds</div>
      </div>
      <div id="ocr-review" style="display:none"></div>
    `);

    let _base64 = '';
    document.getElementById('ocr-drop-label').onclick = () => document.getElementById('ocr-file-input').click();
    document.getElementById('ocr-file-input').onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        _base64 = ev.target.result.split(',')[1];
        document.getElementById('ocr-img').src = ev.target.result;
        document.getElementById('ocr-preview').style.display = 'block';
        document.getElementById('ocr-run-btn').style.display = 'block';
      };
      reader.readAsDataURL(file);
    };
    document.getElementById('ocr-run-btn').onclick = async () => {
      if (!_base64) return;
      document.getElementById('ocr-upload-area').style.display = 'none';
      document.getElementById('ocr-processing').style.display = 'block';
      try {
        const lines = await runOcr(_base64);
        const matches = matchOcrToAttendees(lines, allAttendees);
        document.getElementById('ocr-processing').style.display = 'none';
        document.getElementById('ocr-review').style.display = 'block';
        document.getElementById('ocr-review').innerHTML = renderOcrReview(matches);
        _updateOcrConfirmBtn();
      } catch (err) {
        document.getElementById('ocr-processing').style.display = 'none';
        document.getElementById('ocr-upload-area').style.display = 'block';
        Helpers.toast(err.message || 'OCR failed', 'error');
      }
    };
  }

  async function runOcr(base64Image) {
    if (typeof Tesseract === 'undefined') throw new Error('OCR library not loaded. Check your internet connection and reload.');
    // Show a progress update inside the processing div
    const proc = document.getElementById('ocr-processing');
    if (proc) proc.innerHTML = '<div style="font-size:1.5rem;margin-bottom:.5rem">&#8987;</div><div>Reading handwriting... this takes a few seconds</div>';

    const dataUrl = 'data:image/jpeg;base64,' + base64Image;
    const result  = await Tesseract.recognize(dataUrl, 'eng', {
      logger: m => {
        if (proc && m.status === 'recognizing text') {
          const pct = Math.round((m.progress || 0) * 100);
          proc.innerHTML = `<div style="font-size:1.5rem;margin-bottom:.5rem">&#8987;</div><div>Reading handwriting... ${pct}%</div>`;
        }
      }
    });
    const text = result?.data?.text || '';
    if (!text.trim()) throw new Error('No text detected in the image. Try a clearer, well-lit photo.');
    // Split into lines, remove empty / very short lines and obvious non-name noise
    return text.split('\n').map(l => l.trim()).filter(l => l.length >= 2);
  }

  function matchOcrToAttendees(lines, attendees) {
    const high = [], medium = [], low = [];
    lines.forEach(rawText => {
      let best = null, bestScore = 0;
      attendees.forEach(a => {
        const score = Helpers.similarName(rawText, a.name);
        if (score > bestScore) { bestScore = score; best = a; }
      });
      const entry = { rawText, match: best, score: bestScore };
      if (bestScore >= 0.75) high.push(entry);
      else if (bestScore >= 0.40) medium.push(entry);
      else low.push(entry);
    });
    return { high, medium, low };
  }

  function renderOcrReview({ high, medium, low }) {
    const row = (e, checked, group) => `
      <label class="ocr-match-row" style="display:flex;align-items:center;gap:.6rem;padding:.45rem .5rem;border-radius:6px;cursor:pointer;background:var(--bg-card2);margin-bottom:.3rem">
        <input type="checkbox" class="ocr-chk" data-id="${e.match?.id || ''}" data-group="${group}" ${checked ? 'checked' : ''} ${!e.match ? 'disabled' : ''} onchange="App._updateOcrConfirmBtn()" />
        <div style="flex:1;min-width:0">
          <div style="font-size:.82rem;color:var(--text-muted)">"${e.rawText}"</div>
          ${e.match
            ? `<div style="font-weight:500;font-size:.9rem">${e.match.name} <span style="font-weight:400;color:var(--text-muted);font-size:.78rem">${e.match.team ? `[${e.match.team}]` : ''}</span></div>`
            : `<div style="color:var(--text-muted);font-size:.85rem">No match found</div>`}
        </div>
        <div style="font-size:.75rem;color:${group==='high'?'var(--success)':group==='medium'?'#d97706':'var(--text-muted)'}">${Math.round(e.score*100)}%</div>
      </label>`;

    let html = '';
    if (high.length) {
      html += `<div style="font-size:.78rem;font-weight:600;color:var(--success);margin:.75rem 0 .4rem">&#10003; HIGH CONFIDENCE — ${high.length} name${high.length!==1?'s':''} (auto-selected)</div>`;
      html += high.map(e => row(e, true, 'high')).join('');
    }
    if (medium.length) {
      html += `<div style="font-size:.78rem;font-weight:600;color:#d97706;margin:.75rem 0 .4rem">&#9888; POSSIBLE MATCH — review these ${medium.length}</div>`;
      html += medium.map(e => row(e, false, 'medium')).join('');
    }
    if (low.length) {
      html += `<div style="font-size:.78rem;font-weight:600;color:var(--text-muted);margin:.75rem 0 .4rem">&#10067; NOT RECOGNISED — ${low.length} line${low.length!==1?'s':''}</div>`;
      html += low.map(e => row(e, false, 'low')).join('');
    }
    if (!high.length && !medium.length && !low.length) {
      html = '<div style="text-align:center;color:var(--text-muted);padding:1rem">No names could be extracted. Try a clearer photo.</div>';
    }
    html += `<button class="btn-primary" id="ocr-confirm-btn" style="width:100%;margin-top:1rem" onclick="App.confirmOcrMarks()">Mark 0 People Present</button>`;
    return html;
  }

  function _updateOcrConfirmBtn() {
    const count = document.querySelectorAll('.ocr-chk:checked').length;
    const btn   = document.getElementById('ocr-confirm-btn');
    if (btn) btn.textContent = `Mark ${count} People Present`;
  }

  async function confirmOcrMarks() {
    const checkboxes = [...document.querySelectorAll('.ocr-chk:checked')];
    const ids = [...new Set(checkboxes.map(c => c.dataset.id).filter(Boolean))];
    if (!ids.length) { Helpers.toast('No people selected', 'error'); return; }

    const btn = document.getElementById('ocr-confirm-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Marking...'; }

    let count = 0;
    for (const id of ids) {
      const a = allAttendees.find(x => x.id === id);
      if (!a || a.attendance === 'present') continue;
      a.attendance = 'present';
      a.entryTime  = new Date().toISOString();
      a.markedBy   = currentUser?.name || 'Unknown';
      await DB.put(DB.STORES.attendees, a);
      const idx = allAttendees.findIndex(x => x.id === id);
      if (idx >= 0) allAttendees[idx] = { ...allAttendees[idx], ...a };
      count++;
    }
    await DB.log('checkin', `OCR scan: ${count} attendee${count!==1?'s':''} marked present`, currentUser?.email);
    updateAdmitCountersFromCache();
    Helpers.closeModal();
    Helpers.toast(`${count} people marked present via OCR scan!`, 'success');
  }

  return {
    init, navigate,
    downloadTemplate,
    instantAdmit, submitPaymentCollect, unmarkAttendance, showDetail, showPaymentUpdate, savePaymentUpdate,
    resolveDuplicate, acceptDuplicate, deleteDuplicate,
    saveBusRoute, deleteBusRoute, toggleUserRole,
    showAddBusModal, deleteBusRouteFromDash,
    showEventPicker, _filterEvents, _pickEvent, showSessionSetupModal,
    initMyBus, _toggleBusTable,
    _selectMyBus, _saveBusCoordHead,
    openBusManageModal, saveBus, deleteBus,
    showCreateEventModal, createEvent,
    showCountList,
    initAttendees,
    // Settings modals
    openEventConfigModal, saveEventConfig,
    openTeamAccessModal,
    openBusRoutesModal,
    openDangerZoneModal,
    showAddUserModal,
    showMyAccountModal,
    // OCR
    openOcrModal, confirmOcrMarks, _updateOcrConfirmBtn,
    closeSidebarPublic: closeSidebar
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
