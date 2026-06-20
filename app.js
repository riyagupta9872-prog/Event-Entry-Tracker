// ===== MAIN APP =====
const App = (() => {
  let currentUser = null;
  let currentPage = 'attendance';
  let scannerStream = null;
  let allAttendees = [];
  let _dashAttendees = []; // snapshot for pop-cards
  let liveUnsubscribe = null; // Firestore real-time listener
  let _busesConfigured = false; // set by initMyBusPicker; used by doAdmit to warn
  let _dashStaticCache = null; // { eid, ts, areaCfgBuses, areaCfgAreas, evtDoc } — 30s TTL
  const PAGE_SIZE = 100;
  const normBus = s => (s || '').trim().toLowerCase(); // normalize bus names for matching

  // Debounced page refresh called from onSnapshot — batches rapid Firestore updates
  const _debouncedPageRefresh = Helpers.debounce(() => {
    if (currentPage === 'attendance' || currentPage === 'walkin') {
      renderAllAttendance(document.getElementById('att-search')?.value);
    }
    if (currentPage === 'dashboard') initDashboard();
  }, 200);

  // Return the department for a team name — delegates to Reports module
  function getCategoryForTeam(teamName) {
    return Reports.getTeamDept(teamName, null);
  }

  // Sidebar stubs — sidebar removed; kept so any legacy calls don't throw
  function closeSidebar() {}
  function openSidebar() {}

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

    document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target.id === 'modal-overlay') Helpers.closeModal(); });

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
    const isAdmin = currentUser.role === 'admin';

    // Top bar user avatar
    const avatarBtn = document.getElementById('topbar-user-avatar');
    if (avatarBtn) {
      avatarBtn.textContent = currentUser.name[0].toUpperCase();
      avatarBtn.title = `${currentUser.name} (${isAdmin ? 'Admin' : 'Volunteer'})`;
    }

    // Show/hide admin-only elements
    document.querySelectorAll('.admin-only, .admin-page').forEach(el => {
      el.style.display = isAdmin ? '' : 'none';
    });

    document.getElementById('screen-login').classList.add('hidden');
    document.getElementById('screen-app').classList.remove('hidden');

    await loadEventSelector();
    switchTab('home');
  }

  // ===== LOGIN-TIME SESSION SETUP (event + area + bus) =====
  // Stored in localStorage so it persists across refreshes (not re-asked every visit).
  // Only re-shown when:
  //   1. First login ever (no event stored)
  //   2. A new "current event" was set by admin since last visit
  //   3. Volunteer has no area stored for the current event (new requirement)
  function _getSetupKey() { return `prerna_setup_v2_${DB.getCurrentEvent() || ''}`; }
  function _sessionSetupDone() {
    const isAdmin = currentUser?.role === 'admin';
    const eid = DB.getCurrentEvent();
    if (!eid) return false;
    if (isAdmin) return localStorage.getItem(`prerna_setup_admin_${eid}`) === '1';
    // Volunteers need both a valid event AND an area stored (if areas configured — checked async)
    return localStorage.getItem(`prerna_setup_vol_${eid}`) === '1';
  }
  function _markSessionSetupDone() {
    const eid = DB.getCurrentEvent();
    const isAdmin = currentUser?.role === 'admin';
    if (isAdmin) localStorage.setItem(`prerna_setup_admin_${eid}`, '1');
    else         localStorage.setItem(`prerna_setup_vol_${eid}`, '1');
  }
  function _clearSessionSetup() {
    // Clear all setup flags on logout so next person is asked fresh
    const eid = DB.getCurrentEvent();
    if (eid) {
      localStorage.removeItem(`prerna_setup_admin_${eid}`);
      localStorage.removeItem(`prerna_setup_vol_${eid}`);
    }
  }

  async function ensureSessionSetup() {
    if (!_cachedEvents || _cachedEvents.length === 0) return;

    // Check if the admin has marked a "current event" that differs from what's stored
    const currentMarked = _cachedEvents.find(e => e.isCurrentEvent);
    if (currentMarked && currentMarked.id !== DB.getCurrentEvent()) {
      // New current event — reset this event's setup flag so volunteers are prompted
      const old = DB.getCurrentEvent();
      DB.setCurrentEvent(currentMarked.id);
      if (old) localStorage.removeItem(`prerna_setup_vol_${old}`);
    }

    if (_sessionSetupDone()) return;
    await showSessionSetupModal();
  }

  // ── SESSION SETUP WIZARD ────────────────────────────────────────────────
  // Step 1: Financial Year → Step 2: Event → Step 3: Area (volunteers only)
  // Bus selection is deferred to Gate tab entry.
  let _ssWizard = { fy: null, eventId: null, area: null, areas: [], bus: null, buses: [], resolve: null };

  function _ssInjectStyles() {
    if (document.getElementById('ss-wizard-style')) return;
    const s = document.createElement('style');
    s.id = 'ss-wizard-style';
    s.textContent = `
      .ss-wizard-header{margin-bottom:1rem}
      .ss-step-label{font-size:.7rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:.25rem}
      .ss-wizard-title{font-size:1.1rem;font-weight:700;color:var(--text);margin:0 0 .2rem}
      .ss-wizard-sub{font-size:.82rem;color:var(--text-muted);margin:0}
      .ss-cards{display:flex;flex-direction:column;gap:.5rem;margin-top:.85rem}
      .ss-card{width:100%;text-align:left;padding:.75rem 1rem;border:1.5px solid var(--border);border-radius:10px;background:var(--bg-card);cursor:pointer;transition:.15s;-webkit-tap-highlight-color:transparent}
      .ss-card:active,.ss-card:hover{border-color:var(--accent);background:#f0fdf4}
      .ss-card-selected{border-color:var(--accent)!important;background:#f0fdf4!important;}
      .ss-card-title{font-weight:600;font-size:.95rem;color:var(--text)}
      .ss-card-sub{font-size:.78rem;color:var(--text-muted);margin-top:.15rem}
      .ss-area-grid{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:.75rem}
      .ss-area-pill{padding:.5rem 1rem;border-radius:20px;border:1.5px solid var(--border);background:var(--bg-card2);font-size:.88rem;cursor:pointer;transition:.15s;-webkit-tap-highlight-color:transparent}
      .ss-area-pill.active{background:var(--accent);color:#fff;border-color:var(--accent)}
    `;
    document.head.appendChild(s);
  }

  function _ssLockModal(overlay) {
    overlay.onclick = null;
    const swallowOverlay = e => { if (e.target === overlay) e.stopPropagation(); };
    const swallowEsc = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); } };
    overlay.addEventListener('click', swallowOverlay, true);
    document.addEventListener('keydown', swallowEsc, true);
    return () => {
      overlay.removeEventListener('click', swallowOverlay, true);
      document.removeEventListener('keydown', swallowEsc, true);
    };
  }

  async function showSessionSetupModal() {
    _ssInjectStyles();
    let areas = [], buses = [];
    try {
      const raw = await DB.getConfig('areas');
      areas = raw ? JSON.parse(raw).map(a => typeof a === 'string' ? a : a.name).filter(Boolean) : [];
    } catch { areas = []; }
    try { buses = await DB.getAll(DB.STORES.buses); } catch { buses = []; }
    _ssWizard.areas = areas;
    _ssWizard.buses = buses;
    _ssWizard.fy = null; _ssWizard.eventId = null;
    _ssWizard.area = getMyArea(); _ssWizard.bus = getMyBus();

    const overlay = document.getElementById('modal-overlay');
    const cleanup = _ssLockModal(overlay);

    return new Promise(resolve => {
      _ssWizard.resolve = () => { cleanup(); resolve(); };
      _ssRenderStep1();
    });
  }

  function _ssRenderStep1() {
    // Always show event confirmation so user can verify or change
    // Pre-select the current event if one exists
    const currentEvent = _cachedEvents.find(e => e.isCurrentEvent) || null;
    const allEvents    = [..._cachedEvents].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    if (currentEvent) {
      // Pre-select it in wizard state, but still show the screen for manual confirmation
      _ssWizard.fy      = currentEvent.financialYear || 'Other';
      _ssWizard.eventId = currentEvent.id;
    }

    const esc = Helpers.escapeHtml;
    const cards = allEvents.map(e => {
      const isSel = e.id === _ssWizard.eventId;
      return `<button class="ss-card${isSel ? ' ss-card-selected' : ''}" onclick="App._ssPickEvent('${esc(e.id)}')">
        <div class="ss-card-title">${esc(e.name)}${e.isCurrentEvent ? ' ⭐' : ''}</div>
        <div class="ss-card-sub">${e.date ? Helpers.formatDate(e.date) : ''}${isSel ? ' · selected' : ''}</div>
      </button>`;
    }).join('');

    Helpers.modal(`
      <div class="ss-wizard-header">
        <div class="ss-step-label">Gate Entry Setup</div>
        <h3 class="ss-wizard-title">Confirm Event</h3>
        <p class="ss-wizard-sub">Current event is pre-selected. Tap another to change.</p>
      </div>
      <div class="ss-cards">${cards}</div>
      ${_ssWizard.eventId ? `<button class="btn-primary" style="width:100%;margin-top:1rem"
        onclick="App._ssConfirmEvent()">Continue ›</button>` : ''}
    `);
  }

  function _ssPickFY(fy) {
    // kept for legacy; no longer called from new flow
    _ssWizard.fy = fy;
  }

  function _ssPickEvent(eventId) {
    _ssWizard.eventId = eventId;
    const e = _cachedEvents.find(ev => ev.id === eventId);
    if (e) _ssWizard.fy = e.financialYear || 'Other';
    // Update card highlights and show/ensure Continue button
    document.querySelectorAll('.ss-card').forEach(c => c.classList.remove('ss-card-selected'));
    const clicked = [...document.querySelectorAll('.ss-card')].find(c =>
      c.querySelector('.ss-card-title')?.textContent.startsWith(e?.name || '')
    );
    if (clicked) clicked.classList.add('ss-card-selected');
    // Ensure Continue button exists
    let cont = document.getElementById('ss-event-continue');
    if (!cont) {
      cont = document.createElement('button');
      cont.id = 'ss-event-continue';
      cont.className = 'btn-primary';
      cont.style.cssText = 'width:100%;margin-top:1rem';
      cont.textContent = 'Continue ›';
      cont.onclick = () => App._ssConfirmEvent();
      document.getElementById('modal-content')?.appendChild(cont);
    }
    cont.disabled = false;
  }

  async function _ssConfirmEvent() {
    if (!_ssWizard.eventId) { Helpers.toast('Please select an event', 'error'); return; }
    const isAdmin = currentUser?.role === 'admin';
    const areas   = _ssWizard.areas;
    if (!isAdmin && areas.length > 0) {
      _ssRenderStep3(); // volunteer → area → bus
    } else {
      await _ssRenderBusStep(); // admin → bus
    }
  }

  function _ssRenderStep3() {
    const areas = _ssWizard.areas;
    const current = _ssWizard.area || '';
    const pills = areas.map(a => `
      <button class="ss-area-pill${normBus(a) === normBus(current) ? ' active' : ''}"
        onclick="App._ssPickArea(this, '${Helpers.escapeHtml(a)}')">${Helpers.escapeHtml(a)}</button>
    `).join('');
    Helpers.modal(`
      <div class="ss-wizard-header">
        <div class="ss-step-label">Step 3 of 3</div>
        <h3 class="ss-wizard-title">Select Your Area</h3>
        <p class="ss-wizard-sub">Only attendees from your area will appear in the Gate list.</p>
      </div>
      <div class="ss-area-grid">${pills}</div>
      <button class="btn-primary" id="ss-area-confirm" style="width:100%;margin-top:1.25rem" onclick="App._ssConfirmArea()"
        ${current ? '' : 'disabled'}>Continue ›</button>
    `);
  }

  function _ssPickArea(btn, area) {
    _ssWizard.area = area;
    document.querySelectorAll('.ss-area-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const confirmBtn = document.getElementById('ss-area-confirm');
    if (confirmBtn) confirmBtn.disabled = false;
  }

  async function _ssConfirmArea() {
    if (!_ssWizard.area) { Helpers.toast('Please select your area', 'error'); return; }
    await _ssRenderBusStep();
  }

  async function _ssRenderBusStep() {
    const allBuses = _ssWizard.buses;
    const areaName = _ssWizard.area;
    const isAdmin  = currentUser?.role === 'admin';
    // Show only buses for the selected area; if no areas, show all
    const visible = areaName
      ? allBuses.filter(b => normBus(b.area) === normBus(areaName))
      : allBuses;
    if (!visible.length) { await _ssFinish(); return; } // no buses configured — skip
    const current = _ssWizard.bus || '';
    const pills = visible.map(b => `
      <button class="ss-area-pill${normBus(b.name) === normBus(current) ? ' active' : ''}"
        onclick="App._ssPickBus(this,'${Helpers.escapeHtml(b.name)}')">${Helpers.escapeHtml(b.name)}</button>
    `).join('');
    Helpers.modal(`
      <div class="ss-wizard-header">
        <div class="ss-step-label">Last Step</div>
        <h3 class="ss-wizard-title">Select Your Bus</h3>
        <p class="ss-wizard-sub">${isAdmin
          ? 'Select if you are doing bus seva. Skip if you are just checking reports.'
          : 'Pre-selected in Gate &amp; My Bus for this session.'}</p>
      </div>
      <div class="ss-area-grid">${pills}</div>
      <button class="btn-primary" id="ss-bus-confirm" style="width:100%;margin-top:1.25rem"
        onclick="App._ssConfirmBus()"${current ? '' : ' disabled'}>Let's Go ›</button>
      ${isAdmin ? `<button class="btn-ghost" style="width:100%;margin-top:.5rem;color:var(--text-muted)"
        onclick="App._ssSkipBus()">Skip — entering without bus seva</button>` : ''}
    `);
  }

  function _ssPickBus(btn, busName) {
    _ssWizard.bus = busName;
    document.querySelectorAll('.ss-area-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const confirmBtn = document.getElementById('ss-bus-confirm');
    if (confirmBtn) confirmBtn.disabled = false;
  }

  async function _ssConfirmBus() {
    if (!_ssWizard.bus) { Helpers.toast('Please select your bus', 'error'); return; }
    await _ssFinish();
  }

  async function _ssSkipBus() {
    _ssWizard.bus = null;
    localStorage.removeItem(_myBusKey()); // clear any previously saved bus
    await _ssFinish();
  }

  async function _ssFinish() {
    const newEid = _ssWizard.eventId || DB.getCurrentEvent();
    if (!newEid) { Helpers.toast('No event selected', 'error'); return; }
    if (newEid !== DB.getCurrentEvent()) {
      DB.setCurrentEvent(newEid);
      allAttendees = []; attendanceInited = false;
      _absenteeMap = null; Reports.clearAbsenteeCache();
      const active = _cachedEvents.find(e => e.id === newEid);
      const btn = document.getElementById('event-selector-btn');
      if (btn && active) btn.textContent = active.name + (active.isCurrentEvent ? ' ★' : '');
    }
    if (_ssWizard.area !== null) setMyArea(_ssWizard.area);
    if (_ssWizard.bus) setMyBus(_ssWizard.bus);
    startLiveSync();
    _markSessionSetupDone();
    Helpers.closeModal();
    _ssWizard.resolve?.();
  }

  // Legacy stubs — no longer used by wizard but kept for any lingering onclick refs
  async function _ssOnEventChange(newEid) {
    try {
      const [newBuses, areasRaw] = await Promise.all([
        DB.getAll(DB.STORES.buses).catch(() => []),
        DB.getConfig('areas').catch(() => null)
      ]);
      const newAreasRaw = areasRaw ? JSON.parse(areasRaw) : [];
      // Areas may be objects {id,name,...} or legacy strings — always extract name
      const newAreaNames = newAreasRaw.map(a => typeof a === 'string' ? a : a.name);
      DB.setCurrentEvent(prevEid); // restore until confirmed

      // Re-render area pills
      const areaWrap = document.getElementById('ss-area-pills');
      if (areaWrap && newAreaNames.length) {
        areaWrap.innerHTML = newAreaNames.map(name => `
          <button type="button" class="ss-area-pill"
            data-area="${Helpers.escapeHtml(name)}"
            onclick="document.querySelectorAll('.ss-area-pill').forEach(p=>p.classList.remove('active'));this.classList.add('active');document.getElementById('ss-area-val').value=this.dataset.area;App._ssAreaSelected(this.dataset.area)">
            ${Helpers.escapeHtml(name)}
          </button>`).join('');
        const areaVal = document.getElementById('ss-area-val');
        if (areaVal) areaVal.value = '';
      }
      // Re-render bus dropdown (show all buses for new event; filters when area is tapped)
      const busSel = document.getElementById('ss-bus');
      if (busSel) {
        busSel.innerHTML = newBuses.length
          ? '<option value="">— select a bus —</option>' + newBuses.map(b =>
              `<option value="${Helpers.escapeHtml(b.name)}">${Helpers.escapeHtml(b.name)}${b.coordinator ? ' · ' + b.coordinator : ''}</option>`
            ).join('')
          : '<option value="">No buses configured</option>';
      }
    } catch { DB.setCurrentEvent(prevEid); }
  }

  // Re-renders the bus dropdown in session setup modal when volunteer picks an area
  function _ssAreaSelected(areaName) {
    const busSel = document.getElementById('ss-bus');
    if (!busSel) return;
    // We can't access the modal's bus closure, so re-fetch from cached attendees proxy:
    // Instead rely on global buses list via a re-fetch. Since buses are few, this is fast.
    DB.getAll(DB.STORES.buses).then(allBuses => {
      const pool = areaName ? _busesForArea(allBuses, areaName) : allBuses;
      busSel.innerHTML = pool.length
        ? '<option value="">— select a bus —</option>' + pool.map(b =>
            `<option value="${Helpers.escapeHtml(b.name)}">${Helpers.escapeHtml(b.name)}${b.coordinator ? ' · ' + b.coordinator : ''}</option>`
          ).join('')
        : '<option value="">No buses for this area yet</option>';
    }).catch(() => {});
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
  // Volunteers see only their area (+ records with no area tag for backward compat).
  // Admins see everything.
  function startLiveSync() {
    stopLiveSync();
    try {
      const eid = DB.getCurrentEvent();
      if (!eid) return;
      const col = firestore.collection('events').doc(eid).collection('participants');
      const myArea = getMyArea();
      const isAdmin = currentUser?.role === 'admin';

      // Always fetch all participants, filter client-side for volunteers.
      // Firestore 'in' with null crashes — client filter is simpler and equally fast.
      liveUnsubscribe = col.onSnapshot(snap => {
        let docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (!isAdmin && myArea) {
          docs = docs.filter(a => !a.area || a.area === '' || normBus(a.area) === normBus(myArea));
        }
        allAttendees = docs.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
        updateAdmitCountersFromCache();
        _debouncedPageRefresh();
      });
    } catch {}
  }

  function stopLiveSync() {
    if (liveUnsubscribe) { liveUnsubscribe(); liveUnsubscribe = null; }
  }

  function updateAdmitCountersFromCache() {
    const present = allAttendees.filter(a => a.attendance === 'present');
    const myBus  = getMyBus();
    const myName = currentUser?.name || '';

    // Gate 6-count bar
    const gcOverall  = document.getElementById('gc-overall');
    const gcMyBus    = document.getElementById('gc-mybus');
    const gcPresent  = document.getElementById('gc-present');
    const gcWalkin   = document.getElementById('gc-walkin');
    const gcCollect  = document.getElementById('gc-collection');
    const gcMyHand   = document.getElementById('gc-myhand');

    if (gcOverall)  gcOverall.textContent  = present.length;
    if (gcMyBus)    gcMyBus.textContent    = myBus ? present.filter(a => normBus(a.boardedBus) === normBus(myBus)).length : '—';
    if (gcPresent)  gcPresent.textContent  = present.filter(a => !a.isWalkIn).length;
    if (gcWalkin)   gcWalkin.textContent   = present.filter(a => !!a.isWalkIn).length;

    const gateColl   = allAttendees.filter(a => a.paidAtEvent || (a.isWalkIn && parseFloat(a.paymentAmount || 0) > 0));
    const totalColl  = gateColl.reduce((s, a) => s + (parseFloat(a.paymentAmount) || 0), 0);
    const myColl     = gateColl.filter(a => (a.collectedBy || a.markedBy) === myName).reduce((s, a) => s + (parseFloat(a.paymentAmount) || 0), 0);
    if (gcCollect)  gcCollect.textContent  = totalColl > 0 ? '₹' + totalColl.toLocaleString('en-IN') : '₹0';
    if (gcMyHand)   gcMyHand.textContent   = myColl > 0   ? '₹' + myColl.toLocaleString('en-IN')   : '₹0';
  }

  // ===== AREA (zone) selection — stored per event in localStorage =====
  let _myBusAreaFilter = ''; // admin My Bus page filter — '' means all areas

  function _myAreaKey() { return `prerna_my_area_${DB.getCurrentEvent() || 'default'}`; }
  function getMyArea()  { return localStorage.getItem(_myAreaKey()) || ''; }
  function setMyArea(name) {
    if (name) localStorage.setItem(_myAreaKey(), name);
    else       localStorage.removeItem(_myAreaKey());
  }

  async function _loadAreas() {
    try {
      const raw = await DB.getConfig('areas');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      // Migrate old format (plain strings) to full objects
      return parsed.map((a, i) => typeof a === 'string'
        ? { id: `a${Date.now()}${i}`, name: a, perPersonCharge: 0, busCount: 0, perBusCost: 0, coordinator: '', capacity: 0 }
        : a
      );
    } catch { return []; }
  }

  async function _saveAreas(areas) {
    await DB.setConfig('areas', JSON.stringify(areas));
    _dashStaticCache = null;
  }

  function _busesForArea(allBuses, areaName) {
    if (!areaName) return allBuses;
    return allBuses.filter(b => normBus(b.area) === normBus(areaName));
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

    if (!buses.length) { bar.classList.add('hidden'); _busesConfigured = false; return; }

    _busesConfigured = true;
    window._cachedBusesForPicker = buses; // used by _promptSelectBusThenAdmit
    bar.classList.remove('hidden');
    const active = getMyBus();

    // Warn visually if buses exist but none is selected yet
    const label = bar.querySelector('.my-bus-label');
    if (!active) {
      bar.style.background = '#fef3c7';
      bar.style.borderBottom = '2px solid #fcd34d';
      if (label) label.innerHTML = '&#9888; Select your bus:';
    } else {
      bar.style.background = '';
      bar.style.borderBottom = '';
      if (label) label.innerHTML = 'Your Bus: <a href="#" onclick="App._changeBusSetup();return false" style="font-size:.72rem;color:var(--accent);margin-left:.35rem;text-decoration:underline">change</a>';
    }

    // Volunteers only see buses in their area; admins see all
    const myArea = getMyArea();
    const isAdmin = currentUser?.role === 'admin';
    const visibleBuses = (!isAdmin && myArea) ? _busesForArea(buses, myArea) : buses;

    pills.innerHTML = visibleBuses.map(b =>
      `<button class="my-bus-pill ${normBus(b.name) === normBus(active) ? 'active' : ''}" onclick="App._selectMyBus('${b.name.replace(/'/g,"\\'")}', this)">${b.name}</button>`
    ).join('');
  }

  function _selectMyBus(name, btn) {
    const wasActive = btn.classList.contains('active');
    document.querySelectorAll('.my-bus-pill').forEach(p => p.classList.remove('active'));
    const bar   = document.getElementById('my-bus-bar');
    const label = bar?.querySelector('.my-bus-label');
    if (wasActive) {
      setMyBus('');
      if (bar)   { bar.style.background = '#fef3c7'; bar.style.borderBottom = '2px solid #fcd34d'; }
      if (label)   label.innerHTML = '&#9888; Select your bus:';
    } else {
      btn.classList.add('active');
      setMyBus(name);
      if (bar)   { bar.style.background = ''; bar.style.borderBottom = ''; }
      if (label)   label.textContent = 'Your Bus:';
    }
  }

  async function _changeBusSetup() {
    _clearSessionSetup();
    await showSessionSetupModal();
    initMyBusPicker();
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
    if (btn) btn.textContent = active.name + (active.isCurrentEvent ? ' ★' : '');

    startLiveSync();
  }

  function _buildEventPickerList(eventsToShow) {
    const activeId = DB.getCurrentEvent();
    if (!eventsToShow.length) return '<li class="event-picker-empty">No events found</li>';

    // Sort: current-event first, then by date desc
    const sorted = eventsToShow.slice().sort((a, b) => {
      if (a.isCurrentEvent && !b.isCurrentEvent) return -1;
      if (!a.isCurrentEvent && b.isCurrentEvent) return 1;
      return (b.date || '').localeCompare(a.date || '');
    });

    // Group by FY
    const fyGroups = {};
    sorted.forEach(e => {
      const fy = e.financialYear || 'Other';
      if (!fyGroups[fy]) fyGroups[fy] = [];
      fyGroups[fy].push(e);
    });

    return Object.entries(fyGroups).map(([fy, evts]) => {
      const rows = evts.map(e => `
        <li class="event-picker-item ${e.id === activeId ? 'active' : ''}" onclick="App._pickEvent('${e.id}')">
          <span>${Helpers.escapeHtml(e.name)}${e.isCurrentEvent ? ' <span style="font-size:.72rem;background:#16a34a;color:#fff;border-radius:4px;padding:1px 5px;vertical-align:middle">Current</span>' : ''}</span>
          ${e.date ? `<span class="evt-date">${Helpers.formatDate(e.date)}</span>` : ''}
        </li>`).join('');
      return `<li style="padding:.35rem .75rem;font-size:.75rem;font-weight:700;color:var(--text-muted);background:var(--bg-card2);letter-spacing:.06em;pointer-events:none">FY ${fy}</li>${rows}`;
    }).join('');
  }

  function showEventPicker() {
    const isAdmin = currentUser?.role === 'admin';
    Helpers.modal(`
      <h3 class="modal-title">Choose Event</h3>
      <input id="evt-picker-search" class="event-picker-search" type="text" placeholder="Search events…" oninput="App._filterEvents(this.value)" />
      <ul id="evt-picker-list" class="event-picker-list">${_buildEventPickerList(_cachedEvents)}</ul>
      ${isAdmin ? `<div style="padding:.6rem .75rem 0;border-top:1px solid var(--border);margin-top:.5rem">
        <button class="btn-secondary" style="width:100%;font-size:.85rem" onclick="App.showCreateEventModal()">+ Create New Event</button>
      </div>` : ''}
    `);
    setTimeout(() => { const inp = document.getElementById('evt-picker-search'); if (inp) inp.focus(); }, 50);
  }

  function _filterEvents(query) {
    const q = (query || '').toLowerCase().trim();
    const filtered = q ? _cachedEvents.filter(e => e.name.toLowerCase().includes(q) || (e.date && e.date.includes(q))) : _cachedEvents;
    const list = document.getElementById('evt-picker-list');
    if (list) list.innerHTML = _buildEventPickerList(filtered);
  }

  function _pickEvent(id) {
    Helpers.closeModal();
    if (id === DB.getCurrentEvent()) return;
    DB.setCurrentEvent(id);
    allAttendees = [];
    attendanceInited = false;
    _absenteeMap = null;
    _dashStaticCache = null;
    Reports.clearAbsenteeCache();
    const active = _cachedEvents.find(e => e.id === id);
    const btn = document.getElementById('event-selector-btn');
    if (btn && active) btn.textContent = active.name + (active.isCurrentEvent ? ' ★' : '');
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
  const VOLUNTEER_PAGES = ['attendance', 'walkin', 'mybus', 'dashboard'];

  // Page → bottom nav tab mapping
  const PAGE_TO_TAB = {
    dashboard: 'home', attendance: 'gate', walkin: 'gate',
    mybus: 'mybus', manage: 'manage',
    settings: 'setup', import: 'setup', attendees: 'setup',
    reports: 'reports', financial: 'reports'
  };

  // ===== NAVIGATION =====
  function navigate(page) {
    // Permission guard — volunteers can only access their pages
    if (currentUser?.role !== 'admin' && !VOLUNTEER_PAGES.includes(page)) {
      Helpers.toast('Access restricted. Contact your admin.', 'error');
      page = 'attendance';
    }

    if (currentPage === 'attendance' && page !== 'attendance') stopScanner();

    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.remove('hidden');

    // Sync bottom nav active state
    const activeTab = PAGE_TO_TAB[page] || 'home';
    document.querySelectorAll('.bnav-item').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === activeTab);
    });

    const titles = {
      dashboard: '', import: '/ Import',
      attendance: '', walkin: '/ Walk-ins',
      attendees: '/ Attendees', reports: '',
      settings: '', financial: '/ Financial',
      mybus: '', manage: ''
    };
    const titleEl = document.getElementById('page-title');
    if (titleEl) titleEl.textContent = titles[page] !== undefined ? titles[page] : '';
    currentPage = page;

    switch (page) {
      case 'dashboard': initDashboard(); break;
      case 'import': initImport(); break;
      case 'attendance':
        startLiveSync(); // start data stream immediately; setup runs in parallel
        ensureSessionSetup().then(() => { initAttendance(); initMyBusPicker(); });
        break;
      case 'walkin': initWalkin(); break;
      case 'attendees': initAttendees(); break;
      case 'reports': initReports(); break;
      case 'settings': initSettings(); break;
      case 'financial': initFinancial(); break;
      case 'mybus': initMyBus(); break;
      case 'manage': initManage(); break;
    }
  }

  // ===== TAB SWITCHING =====
  let _gateUnlocked = false;
  let _walkinSubmitting = false;

  function switchTab(tab) {
    const tabPageMap = {
      home: 'dashboard',
      gate: 'attendance',
      mybus: 'mybus',
      manage: 'manage',
      setup: 'settings',
      reports: 'reports'
    };
    navigate(tabPageMap[tab] || 'dashboard');
  }

  function checkGateLock() {
    const eid = DB.getCurrentEvent();
    const event = (_cachedEvents || []).find(e => e.id === eid);
    const eventDate = event?.date; // 'YYYY-MM-DD'
    const today = new Date().toISOString().slice(0, 10);

    const lockScreen = document.getElementById('gate-lock-screen');
    const gateContent = document.getElementById('gate-content');
    if (!lockScreen || !gateContent) return;

    const isLocked = !_gateUnlocked && eventDate && today < eventDate;

    lockScreen.classList.toggle('hidden', !isLocked);
    gateContent.classList.toggle('hidden', !!isLocked);

    if (isLocked) {
      const dateEl = document.getElementById('gate-lock-date');
      if (dateEl) dateEl.textContent = Helpers.formatDate(eventDate);
      const countEl = document.getElementById('gate-lock-countdown');
      if (countEl) {
        const diff = Math.ceil((new Date(eventDate + 'T00:00:00') - new Date()) / (1000 * 60 * 60 * 24));
        countEl.textContent = diff > 0 ? `${diff} day${diff !== 1 ? 's' : ''} to go` : 'Opens today!';
      }
    }
  }

  // Bus required screen — shown on Gate tab when gate is open but no bus selected
  async function checkBusRequired() {
    const busScreen   = document.getElementById('gate-bus-screen');
    const gateContent = document.getElementById('gate-content');
    if (!busScreen || !gateContent) return false;

    const myBus = getMyBus();
    if (myBus) {
      busScreen.classList.add('hidden');
      gateContent.classList.remove('hidden');
      return false; // not blocked
    }

    // Show bus selection screen, hide gate content
    busScreen.classList.remove('hidden');
    gateContent.classList.add('hidden');

    let buses = [];
    try { buses = await DB.getAll(DB.STORES.buses); } catch {}
    const myArea = getMyArea();
    const pool = myArea ? _busesForArea(buses, myArea) : buses;
    const optionsEl = document.getElementById('gate-bus-options');
    if (optionsEl) {
      if (pool.length) {
        optionsEl.innerHTML = pool.map(b => `
          <button onclick="App._gateBusPick('${Helpers.escapeHtml(b.name)}')"
            style="width:100%;padding:.75rem 1rem;border:1.5px solid var(--border);border-radius:10px;background:var(--bg-card);font-size:.95rem;font-weight:600;text-align:left;cursor:pointer;-webkit-tap-highlight-color:transparent">
            🚌 ${Helpers.escapeHtml(b.name)}${b.coordinator ? `<span style="font-size:.78rem;color:var(--text-muted);font-weight:400;display:block">${Helpers.escapeHtml(b.coordinator)}</span>` : ''}
          </button>`).join('');
      } else {
        optionsEl.innerHTML = `<p style="color:var(--text-muted);font-size:.85rem">No buses configured. Ask admin to add buses in Setup.</p>`;
      }
    }
    return true; // blocked
  }

  function _gateBusPick(busName) {
    setMyBus(busName);
    const busScreen   = document.getElementById('gate-bus-screen');
    const gateContent = document.getElementById('gate-content');
    if (busScreen)   busScreen.classList.add('hidden');
    if (gateContent) gateContent.classList.remove('hidden');
    initMyBusPicker();
    updateAdmitCountersFromCache();
    Helpers.toast(`Bus set: ${busName}`, 'success');
  }

  // Reports sub-tab switcher (Reports vs Financial Year)
  function _reportSubTab(which) {
    navigate(which === 'financial' ? 'financial' : 'reports');
  }


  // ===== GATE LOCK HELPERS =====
  function _gateAdminUnlock() {
    _gateUnlocked = true;
    checkGateLock();
  }

  function _gateShowList(filter) {
    const myBus  = getMyBus();
    const myName = currentUser?.name || '';
    const present = allAttendees.filter(a => a.attendance === 'present');

    let list, title;
    switch (filter) {
      case 'overall':    list = present;                                              title = 'All Present';        break;
      case 'mybus':      list = myBus ? present.filter(a => normBus(a.boardedBus) === normBus(myBus)) : [];  title = `My Bus — ${myBus || 'None'}`;  break;
      case 'present':    list = present.filter(a => !a.isWalkIn);                    title = 'Registered Present'; break;
      case 'walkin':     list = present.filter(a => !!a.isWalkIn);                   title = 'Walk-in Present';    break;
      case 'collection': list = allAttendees.filter(a => a.paidAtEvent || (a.isWalkIn && parseFloat(a.paymentAmount || 0) > 0)); title = 'Gate Collections'; break;
      case 'myhand':     list = allAttendees.filter(a => (a.paidAtEvent || (a.isWalkIn && parseFloat(a.paymentAmount || 0) > 0)) && (a.collectedBy || a.markedBy) === myName); title = 'My Collections'; break;
      default: return;
    }

    if (!list.length) { Helpers.toast(`No entries for "${title}"`, 'info'); return; }

    const esc = Helpers.escapeHtml;
    const isMoney = (filter === 'collection' || filter === 'myhand');
    const rows = list.map(a => {
      const ps = (a.paymentStatus || 'unpaid').toLowerCase();
      const psBadge = ps === 'paid' ? 'present' : ps === 'free' ? 'before' : 'unpaid';
      return `<div class="pop-list-row">
        <div class="pop-list-main">
          <div class="pop-list-name">${esc(a.name)}${a.isWalkIn ? ' <span class="badge walkin">WI</span>' : ''}</div>
          <div class="pop-list-meta">${esc(a.mobile || '')}${a.boardedBus ? ' · ' + esc(a.boardedBus) : ''}${a.area ? ' · ' + esc(a.area) : ''}</div>
        </div>
        <div class="pop-list-badges">
          ${isMoney
            ? `<span class="badge present">₹${(parseFloat(a.paymentAmount)||0).toLocaleString('en-IN')}</span>`
            : `<span class="badge ${psBadge}">${ps}</span>`}
        </div>
      </div>`;
    }).join('');

    Helpers.modal(`
      <div class="pop-list-header">
        <div class="pop-list-title">${title}</div>
        <div class="pop-list-count">${list.length} record${list.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="pop-list-body">${rows}</div>
      <div style="margin-top:1rem;text-align:right">
        <button class="btn-ghost" onclick="Helpers.closeModal()">Close</button>
      </div>
    `);
  }

  // ===== MY BUS PAGE =====
  async function initMyBus() {
    const host    = document.getElementById('mybus-content');
    const isAdmin = currentUser?.role === 'admin';
    host.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">Loading…</p>';

    try {
      const [all, buses, areas] = await Promise.all([
        DB.getAll(DB.STORES.attendees),
        DB.getAll(DB.STORES.buses).catch(() => []),
        _loadAreas()
      ]);
      const present = all.filter(a => a.attendance === 'present');
      const esc = Helpers.escapeHtml;
      let html = '';

      if (isAdmin) {
        // ── ADMIN: all buses, area-grouped, each expanded ──────────────────────
        const configuredNorms = new Set(buses.map(b => normBus(b.name)));

        // Refresh button header
        html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.85rem">
          <p style="margin:0;font-size:.82rem;color:var(--text-muted)">Bus-wise attendance record · all areas</p>
          <button class="btn-ghost" onclick="App.initMyBus()" style="font-size:.82rem">&#8634; Refresh</button>
        </div>`;

        if (areas.length) {
          areas.forEach(area => {
            const areaBuses = buses.filter(b => normBus(b.area) === normBus(area.name));
            const aPresent  = present.filter(a => normBus(a.area) === normBus(area.name)).length;
            const aReg      = all.filter(a => normBus(a.area) === normBus(area.name)).length;
            html += `<div style="margin-bottom:.4rem;padding:.45rem .75rem;background:var(--bg-card2);border-radius:8px;display:flex;align-items:center;gap:.75rem;border:1px solid var(--border)">
              <span>&#128205;</span>
              <span style="font-weight:700;font-size:.92rem">${esc(area.name)}</span>
              <span style="font-size:.8rem;color:var(--text-muted)">${aReg} reg · <strong style="color:var(--accent)">${aPresent} present</strong></span>
            </div>`;
            if (areaBuses.length) {
              areaBuses.forEach(b => {
                const onB = present.filter(a => normBus(a.boardedBus) === normBus(b.name));
                html += _renderBusCard(b.name, onB, { collapsible: true, expanded: false });
              });
            } else {
              html += `<p style="font-size:.82rem;color:var(--text-muted);padding:.25rem .75rem .75rem">No buses configured for this area</p>`;
            }
          });
        }

        // Buses with no area
        const unassigned = buses.filter(b => !b.area || !b.area.trim());
        if (unassigned.length) {
          html += `<div style="padding:.4rem .75rem;background:#fef3c7;border-radius:8px;border:1px solid #fcd34d;font-size:.82rem;color:#92400e;margin-bottom:.4rem">&#9888; Buses not assigned to any area</div>`;
          unassigned.forEach(b => {
            const onB = present.filter(a => normBus(a.boardedBus) === normBus(b.name));
            html += _renderBusCard(b.name, onB, { collapsible: true, expanded: false });
          });
        }

        // Ghost buses — boarded but not in configured list
        const allBoardedNorms = [...new Set(present.filter(a => a.boardedBus).map(a => normBus(a.boardedBus)))];
        allBoardedNorms.filter(n => !configuredNorms.has(n)).forEach(n => {
          const onB = present.filter(a => normBus(a.boardedBus) === n);
          html += _renderBusCard(onB[0]?.boardedBus || n, onB, { collapsible: true, expanded: true });
        });

        if (!buses.length && !allBoardedNorms.length) {
          html += '<p style="color:var(--text-muted);padding:2rem;text-align:center">No buses configured yet.</p>';
        }

        // Warn if records have corrupt area ("[object Object]") from a past import bug
        const brokenCount = all.filter(a => a.area === '[object Object]').length;
        if (brokenCount > 0) {
          const areaOptions = areas.map(a => {
            const n = typeof a === 'string' ? a : (a.name || '');
            return `<option value="${Helpers.escapeHtml(n)}">${Helpers.escapeHtml(n)}</option>`;
          }).join('');
          html += `<div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:10px;padding:.85rem 1rem;margin-top:1rem">
            <div style="font-weight:700;color:#92400e;margin-bottom:.4rem">&#9888; ${brokenCount} records have a corrupt area tag</div>
            <div style="font-size:.82rem;color:#78350f;margin-bottom:.65rem">These were imported before a bug fix — their area shows as "[object Object]". Reassign them to the correct area below.</div>
            <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
              <select id="repair-area-sel" style="flex:1;min-width:150px;padding:.35rem .5rem;border-radius:6px;border:1px solid #fcd34d">
                <option value="">— Select area —</option>${areaOptions}
              </select>
              <button class="btn-primary" style="flex-shrink:0" onclick="App._repairBrokenArea()">Fix ${brokenCount} records</button>
            </div>
          </div>`;
        }

      } else {
        // ── VOLUNTEER: only their assigned seva bus ─────────────────────────────
        const myBus  = getMyBus();
        const myArea = getMyArea();

        if (myBus) {
          const onBus = present.filter(a => normBus(a.boardedBus) === normBus(myBus));
          html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem">
            ${myArea ? `<span style="font-size:.82rem;color:var(--text-muted)">&#128205; ${esc(myArea)}</span>` : '<span></span>'}
            <button class="btn-ghost" onclick="App.initMyBus()" style="font-size:.82rem">&#8634; Refresh</button>
          </div>`;
          html += renderMyBus(myBus, onBus);
        } else {
          html += `
            <div class="card" style="text-align:center;padding:2rem;margin-bottom:1rem">
              <h3 class="card-title" style="margin:0 0 .5rem">No bus selected</h3>
              <p style="color:var(--text-muted);margin:0 0 1rem">Select the bus you are on seva for to see its record.</p>
              <button class="btn-primary" onclick="App.showSessionSetupModal()">Select Bus</button>
            </div>`;
        }
      }

      host.innerHTML = html;
    } catch (err) {
      host.innerHTML = `<p style="color:var(--danger);padding:2rem">Error: ${err.message}</p>`;
    }
  }

  function _myBusFilterArea(areaName) {
    _myBusAreaFilter = areaName;
    initMyBus();
  }

  async function _repairBrokenArea() {
    const areaName = document.getElementById('repair-area-sel')?.value;
    if (!areaName) { Helpers.toast('Select an area first', 'error'); return; }
    const all = await DB.getAll(DB.STORES.attendees);
    const broken = all.filter(a => a.area === '[object Object]');
    if (!broken.length) { Helpers.toast('No broken records found', 'info'); return; }
    Helpers.toast(`Fixing ${broken.length} records…`, 'info');
    const BATCH = 400;
    for (let i = 0; i < broken.length; i += BATCH) {
      const slice = broken.slice(i, i + BATCH);
      await Promise.all(slice.map(a => DB.put(DB.STORES.attendees, { ...a, area: areaName })));
    }
    allAttendees = allAttendees.map(a => a.area === '[object Object]' ? { ...a, area: areaName } : a);
    Helpers.toast(`Fixed ${broken.length} records → ${areaName}`, 'success');
    initMyBus();
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
  // Cache buses/areas/event doc — these rarely change during an event; 30s TTL
  async function _getDashStaticData() {
    const eid = DB.getCurrentEvent();
    const now = Date.now();
    if (_dashStaticCache?.eid === eid && (now - (_dashStaticCache.ts || 0)) < 30000) {
      return _dashStaticCache;
    }
    const [areaCfgBuses, areaCfgAreas, evtDoc] = await Promise.all([
      DB.getAll(DB.STORES.buses).catch(() => []),
      _loadAreas().catch(() => []),
      DB.getEvent(eid).catch(() => null)
    ]);
    _dashStaticCache = { eid, ts: now, areaCfgBuses, areaCfgAreas, evtDoc };
    return _dashStaticCache;
  }

  async function initDashboard() {
    try {
      const attendees  = allAttendees.length ? allAttendees : await DB.getAll(DB.STORES.attendees);
      const { areaCfgBuses, areaCfgAreas, evtDoc } = await _getDashStaticData();
      const present   = attendees.filter(a => a.attendance === 'present');
      const absent    = attendees.filter(a => a.attendance !== 'present');
      const paid      = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid');
      const unpaid    = attendees.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid');
      const free      = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'free');
      const walkins   = attendees.filter(a => a.isWalkIn);
      const dups      = attendees.filter(a => a.isDuplicate && !a.dupResolved);
      // Walk-ins collected at gate — classify as gate regardless of paidAtEvent flag
      const gatePayList  = attendees.filter(a => a.paidAtEvent || (a.isWalkIn && parseFloat(a.paymentAmount || 0) > 0));
      const gatePay      = gatePayList.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
      const prePay       = attendees.filter(a => !a.isWalkIn && !a.paidAtEvent).reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
      const totalPay     = prePay + gatePay;
      // Bus cost = sum over areas of (buses_in_area × area.perBusCost)
      const totalBusCost = areaCfgAreas.reduce((sum, area) => {
        const n = areaCfgBuses.filter(b => normBus(b.area) === normBus(area.name)).length;
        return sum + n * (parseFloat(area.perBusCost) || 0);
      }, 0);
      const profitLoss   = totalPay - totalBusCost;
      const plClass      = profitLoss >= 0 ? 'success' : 'danger';
      // Is today the event day?
      const eventDateStr = evtDoc?.date || '';
      const todayStr     = new Date().toISOString().slice(0, 10);
      const isEventDay   = !!eventDateStr && eventDateStr === todayStr;
      const isAfterEvent = !!eventDateStr && eventDateStr < todayStr;

      // After event: move P&L card to the very top of the dashboard
      const dashPage  = document.getElementById('page-dashboard');
      const plCardEl  = document.getElementById('dash-pl-card');
      if (dashPage && plCardEl) {
        if (isAfterEvent) dashPage.prepend(plCardEl);
      }

      // ── Attendance + Payment counts ──────────────────────────────────────
      const pct = attendees.length ? Math.round(present.length / attendees.length * 100) : 0;

      // Store attendees snapshot for pop cards
      _dashAttendees = attendees;

      document.getElementById('dash-counts').innerHTML = `
        <div class="dash-counts-grid">
          <div class="dash-count-col color-total dash-count-clickable" onclick="App.showCountList('all','All Registered')">
            <div class="dash-count-head">Total <span class="dash-tap-hint">tap</span></div>
            <div class="dash-count-big">${attendees.length}</div>
            <div class="dash-count-sub">${walkins.length} walk-in${dups.length > 0 ? `&nbsp;·&nbsp;<span style="color:var(--danger)">${dups.length} dup</span>` : ''}</div>
          </div>
          <div class="dash-count-col color-att">
            <div class="dash-count-head">Attendance</div>
            <div class="dash-count-row dash-count-clickable" onclick="App.showCountList('present','Present')"><span class="dc-label success">Present</span><span class="dc-num">${present.length}</span></div>
            <div class="dash-count-row dash-count-clickable" onclick="App.showCountList('absent','Absent')"><span class="dc-label warning">Absent</span><span class="dc-num">${absent.length}</span></div>
            <div class="dash-count-pct">${pct}% attended</div>
            <div class="dash-progress">
              <div class="dash-progress-fill" style="width:${pct}%"></div>
            </div>
          </div>
          <div class="dash-count-col color-pay">
            <div class="dash-count-head">Payment</div>
            <div class="dash-count-row dash-count-clickable" onclick="App.showCountList('paid','Paid')"><span class="dc-label accent">Paid</span><span class="dc-num">${paid.length}</span></div>
            <div class="dash-count-row dash-count-clickable" onclick="App.showCountList('unpaid','Unpaid')"><span class="dc-label danger">Unpaid</span><span class="dc-num">${unpaid.length}</span></div>
            <div class="dash-count-row dash-count-clickable" onclick="App.showCountList('free','Free')"><span class="dc-label info">Free</span><span class="dc-num">${free.length}</span></div>
          </div>
          <div class="dash-count-col color-collect dash-count-clickable" onclick="App.showCountList('walkin','Walk-ins')">
            <div class="dash-count-head">Collected <span class="dash-tap-hint">walk-ins</span></div>
            <div class="dash-count-big" style="color:var(--info)">${Helpers.currency(totalPay)}</div>
            <div class="dash-count-sub">${walkins.length} walk-in</div>
          </div>
        </div>`;

      // ── Bus Occupancy (live count per bus, visible to all) ───────────────
      const occCard = document.getElementById('dash-bus-occ-card');
      const occEl   = document.getElementById('dash-bus-occupancy');
      const buses   = areaCfgBuses;
      // Bus occupancy only shown on event day
      if (occCard) occCard.style.display = 'none';
      if (occCard && occEl && buses.length && isEventDay) {
        occCard.style.display = '';
        const busCoordHead  = await DB.getConfig('busCoordinatorHead') || '';
        const boardedCounts = {};
        let unTagged = 0;
        attendees.filter(a => a.attendance === 'present').forEach(a => {
          const k = normBus(a.boardedBus);
          if (!k) { unTagged += 1; return; }
          boardedCounts[k] = (boardedCounts[k] || 0) + 1;
        });

        const configuredNames = new Set(buses.map(b => normBus(b.name)));
        // Any boardedBus value that doesn't match a currently configured bus
        // → these are usually previously-renamed/deleted buses. Surface them
        // so the dashboard total matches My Bus and reality.
        const orphanEntries = Object.entries(boardedCounts)
          .filter(([name]) => !configuredNames.has(name))
          .sort((a, b) => b[1] - a[1]);

        const configuredTiles = buses.map(b => {
          const cap   = parseInt(b.capacity) || 0;
          const count = boardedCounts[normBus(b.name)] || 0;
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

        const orphanTiles = orphanEntries.map(([name, count]) => `
          <div class="bus-occ-tile" style="border-color:#f59e0b;background:#fffbeb">
            <div class="bus-occ-header">
              <span class="bus-occ-name" style="color:#92400e">${name}</span>
              <span class="bus-occ-count" style="color:#92400e">${count}</span>
            </div>
            <div class="bus-occ-coordinator" style="color:#92400e">&#9888; bus no longer configured</div>
          </div>`).join('');

        const untaggedTile = unTagged > 0 ? `
          <div class="bus-occ-tile" style="border-color:#94a3b8;background:#f8fafc">
            <div class="bus-occ-header">
              <span class="bus-occ-name" style="color:#475569">— No bus tag —</span>
              <span class="bus-occ-count" style="color:#475569">${unTagged}</span>
            </div>
            <div class="bus-occ-coordinator" style="color:#64748b">admitted without selecting a bus</div>
          </div>` : '';

        const orphanTotal = orphanEntries.reduce((s, [, n]) => s + n, 0);
        const reconNote = (orphanTotal + unTagged > 0) ? `
          <p style="font-size:.78rem;color:#92400e;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;padding:.5rem .6rem;margin-top:.6rem">
            &#9888; ${orphanTotal + unTagged} present devotee${orphanTotal + unTagged !== 1 ? 's' : ''} not in any currently-configured bus
            ${orphanTotal ? ` — ${orphanTotal} tagged with a renamed/deleted bus` : ''}${unTagged ? `${orphanTotal ? ',' : ''} ${unTagged} admitted without a bus selected` : ''}.
            Open <b>My Bus</b> to see the full list.
          </p>` : '';

        occEl.innerHTML = `<div class="bus-occ-grid">${configuredTiles}${orphanTiles}${untaggedTile}</div>` +
          reconNote +
          (busCoordHead ? `<div class="bus-occ-head">&#128081; Bus Coordinator Head: <strong>${busCoordHead}</strong></div>` : '');
      }

      // ── P&L ──────────────────────────────────────────────────────────────
      document.getElementById('dash-pl').innerHTML = `
        <table class="report-table" style="max-width:420px">
          ${prePay > 0 ? `<tr style="color:var(--text-muted)"><td style="padding-left:.25rem">↳ Pre-event (imported)</td><td style="text-align:right">${Helpers.currency(prePay)}</td></tr>` : ''}
          ${gatePay > 0 ? `<tr style="color:var(--text-muted)"><td style="padding-left:.25rem">↳ At gate</td><td style="text-align:right">${Helpers.currency(gatePay)}</td></tr>` : ''}
          <tr style="border-top:2px solid var(--border)"><td><strong>Total Collection</strong></td><td style="text-align:right;color:var(--accent);font-weight:600">${Helpers.currency(totalPay)}</td></tr>
          <tr><td>Bus Expense</td><td style="text-align:right">${Helpers.currency(totalBusCost)}</td></tr>
          <tr style="font-weight:700;font-size:1.05rem;border-top:2px solid var(--border)">
            <td>${profitLoss >= 0 ? 'Profit' : 'Loss'}</td>
            <td style="text-align:right;color:var(--${plClass})">${Helpers.currency(Math.abs(profitLoss))}</td>
          </tr>
        </table>`;

      // ── Event Day Collections (cashier reconciliation) ──────────────────
      const edcEl = document.getElementById('dash-edc');
      if (edcEl) {
        const gatePaid = gatePayList;
        const edcBadge = document.getElementById('dash-edc-badge');
        if (edcBadge) edcBadge.textContent = gatePaid.length ? `${gatePaid.length} person${gatePaid.length !== 1 ? 's' : ''} · ${Helpers.currency(gatePay)}` : '';

        if (!gatePaid.length) {
          edcEl.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">No event-day collections yet</p>';
        } else {
          // Group by collector (volunteer who collected)
          const byCollector = {};
          gatePaid.forEach(a => {
            const who = a.collectedBy || a.markedBy || 'Unknown';
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


      // ── Registration Summary ──────────────────────────────────────────────
      const regSummaryEl = document.getElementById('dash-reg-summary');
      if (regSummaryEl && attendees.length) {
        const rawTcMap = await DB.getConfig('teamCategoryMap');
        const tcMap = rawTcMap ? JSON.parse(rawTcMap) : {};
        const CAT_ORDER = Reports.CATEGORY_ORDER;
        const esc = Helpers.escapeHtml;

        // ── 1. Category-wise: devotee's OWN category field ──────────────────
        const catBuckets = {};
        attendees.forEach(a => {
          const raw = (a.category || 'Unknown').trim();
          const key = raw.toLowerCase();
          if (!catBuckets[key]) catBuckets[key] = { display: raw, n: 0, _freq: {} };
          catBuckets[key].n++;
          catBuckets[key]._freq[raw] = (catBuckets[key]._freq[raw] || 0) + 1;
        });
        const catChipColors = {
          icf_prji: { bg: '#fef3c7', tc: '#92400e' },
          icf_mtg:  { bg: '#dbeafe', tc: '#1e40af' },
          iyf:      { bg: '#fce7f3', tc: '#9d174d' },
          igf:      { bg: '#dcfce7', tc: '#166534' },
          'balarama team': { bg: '#ede9fe', tc: '#5b21b6' }
        };
        const catKeys = [...CAT_ORDER.map(c => c.toLowerCase()).filter(k => catBuckets[k]),
                         ...Object.keys(catBuckets).filter(k => !CAT_ORDER.map(c=>c.toLowerCase()).includes(k)).sort()];
        const catChips = catKeys.map(k => {
          const { n, _freq } = catBuckets[k];
          const disp = Object.entries(_freq).sort((a,b)=>b[1]-a[1])[0][0];
          const col = catChipColors[k] || { bg: '#f1f5f9', tc: '#475569' };
          return `<span class="rs-cat-chip" style="background:${col.bg};color:${col.tc};cursor:pointer"
              onclick="App._showCatDetail('${esc(k)}','${esc(disp)}')">
            ${esc(disp)} <span class="rs-chip-n">${n}</span>
          </span>`;
        }).join('');

        // ── 2. Team-wise: grouped by team's DEPARTMENT ──────────────────────
        const deptBuckets = {};
        attendees.forEach(a => {
          const rawTeam = (a.team || 'Other').trim();
          const teamKey = rawTeam.toLowerCase();
          const dept = Reports.getTeamDept(rawTeam, tcMap) || 'Unassigned';
          if (!deptBuckets[dept]) deptBuckets[dept] = {};
          if (!deptBuckets[dept][teamKey]) deptBuckets[dept][teamKey] = { display: rawTeam, paid: 0, unpaid: 0, total: 0, _freq: {} };
          const t = deptBuckets[dept][teamKey];
          t.total++;
          t._freq[rawTeam] = (t._freq[rawTeam] || 0) + 1;
          const ps = (a.paymentStatus || '').toLowerCase();
          if (ps === 'paid') t.paid++;
          else if (ps !== 'free') t.unpaid++;
        });

        const allDepts = [...CAT_ORDER.filter(d => deptBuckets[d]),
                          ...Object.keys(deptBuckets).filter(d => !CAT_ORDER.includes(d)).sort()];
        let grandPaid = 0, grandUnpaid = 0, grandTotal = 0;
        let tableRows = '';

        allDepts.forEach((dept, di) => {
          const teamMap = deptBuckets[dept];
          const teamKeys = Object.keys(teamMap).sort();
          let dp = 0, du = 0, dt = 0;
          teamKeys.forEach(tk => { dp += teamMap[tk].paid; du += teamMap[tk].unpaid; dt += teamMap[tk].total; });
          grandPaid += dp; grandUnpaid += du; grandTotal += dt;
          const gid = 'rdg' + di;

          tableRows += `<tr class="rs-dept-hdr" onclick="App._toggleRegDept('${gid}')">
            <td style="display:flex;align-items:center;justify-content:space-between">
              <span>${esc(dept)}</span>
              <span id="${gid}-chev" style="font-size:.6rem;color:#166534;transition:transform .2s;display:inline-block">&#9660;</span>
            </td>
            <td style="text-align:center;color:#15803d">${dp}</td>
            <td style="text-align:center;color:#dc2626">${du}</td>
            <td style="text-align:center">${dt}</td>
          </tr>`;

          teamKeys.forEach(tk => {
            const { _freq, paid: p, unpaid: u, total: tot } = teamMap[tk];
            const disp = Object.entries(_freq).sort((a,b)=>b[1]-a[1])[0][0];
            tableRows += `<tr class="pre-data-row ${gid}-team" style="display:none">
              <td style="padding-left:1.5rem">${esc(disp)}</td>
              <td style="text-align:center;color:#15803d;font-weight:600">${p}</td>
              <td style="text-align:center;color:#dc2626;font-weight:600">${u}</td>
              <td style="text-align:center;font-weight:700">${tot}</td>
            </tr>`;
          });
        });

        regSummaryEl.innerHTML = `
          <div style="margin-bottom:.35rem;font-size:.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">By Registration Category</div>
          <div class="rs-cat-chips">${catChips}</div>
          <div style="margin-bottom:.4rem;font-size:.75rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em">By Team (tap to expand)</div>
          <div class="table-wrap">
            <table class="report-table pre-rpt-table">
              <thead><tr>
                <th>Category / Team</th>
                <th style="text-align:center">Paid</th>
                <th style="text-align:center">Unpaid</th>
                <th style="text-align:center">Total</th>
              </tr></thead>
              <tbody>${tableRows}</tbody>
              <tfoot><tr class="pre-grand-total">
                <td>Grand Total</td>
                <td style="text-align:center">${grandPaid}</td>
                <td style="text-align:center">${grandUnpaid}</td>
                <td style="text-align:center">${grandTotal}</td>
              </tr></tfoot>
            </table>
          </div>`;

        App._toggleRegDept = (gid) => {
          const rows = document.querySelectorAll(`.${gid}-team`);
          const chev = document.getElementById(gid + '-chev');
          const opening = rows.length && rows[0].style.display === 'none';
          rows.forEach(r => r.style.display = opening ? '' : 'none');
          if (chev) chev.style.transform = opening ? 'rotate(180deg)' : '';
        };

        App._showCatDetail = (catKey, catLabel) => {
          const list = attendees.filter(a => (a.category || 'Unknown').trim().toLowerCase() === catKey);
          const paidList   = list.filter(a => (a.paymentStatus||'').toLowerCase() === 'paid');
          const unpaidList = list.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid');
          const freeList   = list.filter(a => (a.paymentStatus||'').toLowerCase() === 'free');
          const rows = list.map(a => {
            const ps = (a.paymentStatus || 'unpaid').toLowerCase();
            const badge = ps === 'paid' ? 'present' : ps === 'free' ? 'before' : 'unpaid';
            return `<div class="pop-list-row">
              <div class="pop-list-main">
                <div class="pop-list-name">${esc(a.name)}</div>
                <div class="pop-list-meta">${esc(a.mobile||'')}${a.team ? ' · '+esc(a.team) : ''}</div>
              </div>
              <span class="badge ${badge}" style="flex-shrink:0">${ps}</span>
            </div>`;
          }).join('');
          Helpers.modal(`
            <div class="pop-list-header">
              <div class="pop-list-title">${esc(catLabel)}</div>
              <div class="pop-list-count">${list.length} registered</div>
            </div>
            <div style="display:flex;gap:.5rem;margin:.6rem 0;flex-wrap:wrap">
              <span class="badge present" style="font-size:.78rem">Paid: ${paidList.length}</span>
              <span class="badge unpaid" style="font-size:.78rem">Unpaid: ${unpaidList.length}</span>
              ${freeList.length ? `<span class="badge before" style="font-size:.78rem">Free: ${freeList.length}</span>` : ''}
            </div>
            <div class="pop-list-body">${rows}</div>
            <div style="margin-top:1rem;text-align:right">
              <button class="btn-ghost" onclick="Helpers.closeModal()">Close</button>
            </div>`);
        };

      } else if (regSummaryEl) {
        regSummaryEl.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">No registrations yet.</p>';
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

    const esc = Helpers.escapeHtml;
    const rows = list.map(a => {
      const ps = (a.paymentStatus || 'unpaid').toLowerCase();
      const psBadge = ps === 'paid' ? 'present' : ps === 'free' ? 'before' : 'unpaid';
      const attBadge = a.attendance === 'present' ? 'present' : 'absent-badge';
      const attLabel = a.attendance === 'present' ? 'Present' : 'Absent';
      return `<div class="pop-list-row">
        <div class="pop-list-main">
          <div class="pop-list-name">${esc(a.name)}${a.isWalkIn ? ' <span class="badge walkin">WI</span>' : ''}</div>
          <div class="pop-list-meta">${esc(a.mobile || '')}${a.team ? ' · ' + esc(a.team) : ''}${a.category ? ' · ' + esc(a.category) : ''}</div>
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

  // ── Full Registration Report modal ──────────────────────────────────────────
  async function showFullReport() {
    try {
      const attendees = _dashAttendees.length ? _dashAttendees : await DB.getAll(DB.STORES.attendees);
      const rawTcMap  = await DB.getConfig('teamCategoryMap');
      const tcMap     = rawTcMap ? JSON.parse(rawTcMap) : {};
      const html      = Reports.renderPreEventReports(attendees, tcMap);
      Helpers.modal(`
        <div style="max-height:82vh;overflow-y:auto;padding:.25rem 0">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem;position:sticky;top:0;background:#fff;padding:.5rem 0;z-index:1;border-bottom:1px solid var(--border)">
            <h3 style="margin:0;font-size:1rem;font-weight:700">Registration Report</h3>
            <button class="btn-ghost" style="font-size:.8rem;padding:.3rem .6rem" onclick="Helpers.closeModal()">&#x2715; Close</button>
          </div>
          ${html}
        </div>
      `);
      // Re-wire download buttons rendered inside the modal
      Reports.initPreEventReports(attendees, tcMap);
    } catch(e) {
      Helpers.toast('Could not load report', 'error');
    }
  }

  // ── Share registration report as image (WhatsApp / native share) ────────────
  async function shareRegReportAsImage() {
    if (typeof html2canvas === 'undefined') {
      Helpers.toast('Share library not loaded yet, try again', 'warning');
      return;
    }
    Helpers.toast('Preparing image…', 'info', 2000);
    try {
      const attendees = _dashAttendees.length ? _dashAttendees : await DB.getAll(DB.STORES.attendees);
      const rawTcMap  = await DB.getConfig('teamCategoryMap');
      const tcMap     = rawTcMap ? JSON.parse(rawTcMap) : {};
      const eventName = (await DB.getEvent(DB.getCurrentEvent()))?.name || 'Event';
      const html      = Reports.renderPreEventReports(attendees, tcMap);

      // Build an off-screen styled container
      const wrap = document.createElement('div');
      wrap.style.cssText = [
        'position:fixed', 'left:-9999px', 'top:0', 'width:520px',
        'background:#fff', 'padding:1.25rem 1.5rem',
        'font-family:DM Sans,sans-serif', 'font-size:14px', 'color:#1a2e1a'
      ].join(';');
      wrap.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;border-bottom:2px solid #166534;padding-bottom:.6rem">
          <div>
            <div style="font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#166534">PRERNA</div>
            <div style="font-size:1.05rem;font-weight:800;color:#14532d">${Helpers.escapeHtml(eventName)}</div>
          </div>
          <div style="font-size:.75rem;color:#64748b">${new Date().toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</div>
        </div>
        ${html}`;
      document.body.appendChild(wrap);
      // Remove download buttons — irrelevant in image
      wrap.querySelectorAll('button').forEach(b => b.remove());

      const canvas = await html2canvas(wrap, { backgroundColor: '#ffffff', scale: 2, useCORS: true, logging: false });
      document.body.removeChild(wrap);

      canvas.toBlob(async (blob) => {
        if (!blob) { Helpers.toast('Failed to create image', 'error'); return; }
        const file = new File([blob], `${eventName.replace(/\s+/g,'-')}-report.png`, { type: 'image/png' });
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: `${eventName} — Registration Report` });
        } else {
          Helpers.downloadBlob(blob, file.name);
          Helpers.toast('Image downloaded — open WhatsApp and share', 'info');
        }
      }, 'image/png');
    } catch(e) {
      console.error(e);
      Helpers.toast('Could not create image', 'error');
    }
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
    { key: 'area', label: 'Area / Zone' },
    { key: 'paymentStatus', label: 'Payment Status' },
    { key: 'paymentMode', label: 'Mode of Payment' },
    { key: 'paymentAmount', label: 'Payment Amount' },
    { key: 'paymentDate', label: 'Payment Date' },
    { key: 'remarks', label: 'Payment Remarks' },
    { key: 'serviceStatus', label: 'Service/Non-Service Devotee' },
    { key: 'activeStatus', label: 'Active/Inactive/New Devotee' },
    { key: 'pickupLocation', label: 'Pickup Location' }
  ];

  // Smart column name matching aliases
  const FIELD_ALIASES = {
    name: ['name', 'full name', 'naam', 'devotee name', 'participant'],
    mobile: ['mobile', 'phone', 'contact', 'mobile number', 'phone number', 'contact no', 'mob', 'cell'],
    category: ['category', 'cat', 'type', 'group type'],
    reference: ['reference', 'ref', 'counselor', 'referred by', 'counsellor'],
    team: ['team', 'team name', 'group'],
    area: ['area', 'zone', 'area zone', 'zone area', 'area / zone', 'area/zone'],
    paymentStatus: ['payment status', 'pay status', 'payment', 'status', 'paid', 'payment received'],
    paymentMode: ['mode of payment', 'payment mode', 'mode', 'pay mode', 'method'],
    paymentAmount: ['payment amount', 'amount', 'fees', 'charge', 'paid amount', 'received'],
    paymentDate: ['payment date', 'pay date', 'date of payment', 'paid date'],
    remarks: ['remarks', 'payment remarks', 'remark', 'notes', 'comment', 'description'],
    serviceStatus: ['service', 'service devotee', 'service status', 'service or non service', 'devotee type'],
    activeStatus: ['active', 'active status', 'active devotee', 'active or inactive', 'activity'],
    pickupLocation: ['pickup', 'pickup location', 'pickup point', 'pick up']
  };

  async function showColumnMapping() {
    const grid = document.getElementById('column-mapping-grid');
    grid.innerHTML = SYSTEM_FIELDS.map(f => {
      const aliases = FIELD_ALIASES[f.key] || [f.key];
      const autoMatch = importHeaders.findIndex(h => {
        const hl = h.toLowerCase().trim();
        return aliases.some(alias => hl === alias || hl.includes(alias) || alias.includes(hl));
      });
      return `<div class="mapping-row"><label>${f.label}</label><select data-field="${f.key}"><option value="">-- Skip --</option>${importHeaders.map((h, i) => `<option value="${i}" ${i === autoMatch ? 'selected' : ''}>${h}</option>`).join('')}</select></div>`;
    }).join('');

    // Populate area selector if areas are configured for this event
    try {
      const raw = await DB.getConfig('areas');
      const areas = raw ? JSON.parse(raw) : [];
      const areaRow = document.getElementById('import-area-row');
      const areaSel = document.getElementById('import-area-select');
      if (areaRow && areaSel && areas.length) {
        areaSel.innerHTML = '<option value="">— No area (visible to all volunteers) —</option>' +
          areas.map(a => { const n = Helpers.escapeHtml(typeof a === 'string' ? a : (a.name || '')); return `<option value="${n}">${n}</option>`; }).join('');
        areaRow.style.display = '';
      }
    } catch {}

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
        r.createdAt     = new Date().toISOString();
        // Per-row area from Excel column takes priority; fall back to global dropdown
        if (!r.area) r.area = document.getElementById('import-area-select')?.value || '';

        // Auto-assign category from team name if category is missing
        if (!r.category && r.team) {
          const guessed = getCategoryForTeam(r.team);
          if (guessed) r.category = guessed;
        }

        // Normalize category to canonical casing (ICF_prji → ICF_Prji, icf_mtg → ICF_Mtg, etc.)
        if (r.category) {
          const catLow = r.category.toLowerCase().trim();
          const canon = (Reports.CATEGORY_ORDER || []).find(c => c.toLowerCase() === catLow);
          if (canon) r.category = canon;
        }

        return r;
      }).filter(r => r.name && r.name.length > 0);

      if (!records.length) {
        Helpers.toast('No valid records found. Check that Name column has data.', 'error');
        btn.disabled = false; btn.textContent = 'Confirm Import';
        return;
      }

      // Step 1: Flag duplicates within this import batch (same mobile + similar name)
      const dupIds = Helpers.detectDuplicates(records);
      records.forEach((r, i) => { r.isDuplicate = dupIds.has(i); });

      const isReplace = document.getElementById('import-mode-replace')?.checked;

      // Step 2: Check each record against EXISTING Firestore records
      // so re-importing the same file, or overlapping coordinator lists, never creates duplicates.
      // Skip this check in Replace mode (user intentionally wiping the slate).
      let existingInDb = [];
      if (!isReplace) {
        btn.textContent = 'Checking for existing records…';
        const dbRecords = allAttendees.length ? allAttendees : await DB.getAll(DB.STORES.attendees);
        records.forEach(r => {
          const match = dbRecords.find(e => {
            const sameMob = e.mobile && r.mobile && normalizeMobile(String(e.mobile)) === r.mobile;
            return sameMob && Helpers.similarName(e.name, r.name);
          });
          if (match) {
            r._existsInDb   = true;
            r._dbMatchName  = match.name;
          }
        });
        existingInDb = records.filter(r => r._existsInDb);
      }

      // Only write truly new records to Firestore
      const toImport = records.filter(r => !r._existsInDb);

      btn.textContent = isReplace ? 'Replacing data...' : `Uploading ${toImport.length} records...`;

      if (isReplace) {
        await DB.clearStore(DB.STORES.attendees);
        allAttendees = [];
        attendanceInited = false;
      }

      if (toImport.length > 0) {
        await DB.bulkAdd(DB.STORES.attendees, toImport);
      }

      const summary = [
        `${toImport.length} imported`,
        existingInDb.length ? `${existingInDb.length} skipped (already in app)` : '',
        dupIds.size ? `${dupIds.size} duplicates within file flagged` : ''
      ].filter(Boolean).join(' · ');

      await DB.log('import', `${isReplace ? 'Replaced' : 'Imported'} ${toImport.length} records (${existingInDb.length} skipped existing, ${dupIds.size} in-file dups)`, currentUser?.email);

      document.getElementById('column-mapping-section').classList.add('hidden');
      showImportPreview(records, dupIds.size);
      Helpers.toast(`✓ ${summary}`, 'success', 6000);

      // Warn if any imported area values don't match configured areas
      _warnAreaMismatch(toImport);

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

  // After import: warn if area values don't match any configured area name
  async function _warnAreaMismatch(importedRecords) {
    try {
      const configuredAreas = await _loadAreas();
      if (!configuredAreas.length) return;
      const configuredNorms = new Set(configuredAreas.map(a => normBus(a.name)));
      const badAreas = new Set(
        importedRecords
          .map(r => r.area)
          .filter(a => a && a.trim() && !configuredNorms.has(normBus(a)))
      );
      if (badAreas.size) {
        const list = [...badAreas].map(a => `"${a}"`).join(', ');
        Helpers.toast(
          `⚠ ${importedRecords.filter(r => badAreas.has(r.area)).length} records have unknown area (${list}). Check Setup › Areas for the correct spelling.`,
          'warning', 8000
        );
      }
    } catch {}
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
        const rawCat = newMap[(r.team || '').toLowerCase()];
        const catLow = (rawCat || '').toLowerCase().trim();
        const canon = (Reports.CATEGORY_ORDER || []).find(c => c.toLowerCase() === catLow);
        r.category = canon || rawCat;
        await DB.put(DB.STORES.attendees, r);
        const idx = allAttendees.findIndex(x => x.id === r.id);
        if (idx >= 0) allAttendees[idx] = { ...allAttendees[idx], ...r };
      }

      Helpers.closeModal();
      Helpers.toast('Team categories saved!', 'success');
    };
  }

  function showImportPreview(records, dupCount) {
    const existCount  = records.filter(r => r._existsInDb).length;
    const importedCount = records.length - existCount;
    document.getElementById('import-stats-row').innerHTML = `
      <span class="import-stat total">In file: ${records.length}</span>
      <span class="import-stat clean">Imported: ${importedCount}</span>
      ${existCount ? `<span class="import-stat" style="background:#fef3c7;color:#92400e;border-color:#fcd34d">Already in app: ${existCount}</span>` : ''}
      ${dupCount ? `<span class="import-stat dup">In-file dups: ${dupCount}</span>` : ''}`;
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
      if (f === 'exists')     filtered = filtered.filter(r => r._existsInDb);
      if (f === 'clean')      filtered = filtered.filter(r => !r.isDuplicate && !r._existsInDb);
      document.getElementById('preview-table-wrap').innerHTML = Helpers.buildTable(
        ['Name', 'Mobile', 'Team', 'Category', 'Payment', 'Mode', 'Status'],
        filtered.slice(0, 300).map(r => {
          let statusBadge, rowClass;
          if (r._existsInDb) {
            statusBadge = `<span class="badge" style="background:#fef3c7;color:#92400e;border:1px solid #fcd34d">Already in app</span>`;
            rowClass    = 'duplicate-row';
          } else if (r.isDuplicate) {
            statusBadge = `<span class="badge dup">Dup in file</span>`;
            rowClass    = 'duplicate-row';
          } else {
            statusBadge = `<span class="badge present">Imported</span>`;
            rowClass    = '';
          }
          return {
            _class: rowClass,
            cells: [r.name, r.mobile, r.team || '-', r.category || '-',
              `<span class="badge ${r.paymentStatus === 'paid' ? 'present' : r.paymentStatus === 'free' ? 'before' : 'unpaid'}">${r.paymentStatus}</span>`,
              r.paymentMode || '-',
              statusBadge]
          };
        })
      );
    };
    searchInput.oninput = Helpers.debounce(render, 300);
    filterSelect.onchange = render;
    render();
    preview.scrollIntoView({ behavior: 'smooth' });
  }

  function _openWalkin() {
    document.getElementById('walkin-panel').classList.remove('hidden');
    document.getElementById('wi-name')?.focus();
    initWalkinPanel();
  }

  // ===== ATTENDANCE (ADMISSION) — PRD: <2 seconds, ONE TAP =====
  let attendanceInited = false;

  let _attFilter = 'all'; // module-level so renderAllAttendance can always read it

  async function initAttendance() {
    checkGateLock();
    const isLocked = !document.getElementById('gate-content') || document.getElementById('gate-content').classList.contains('hidden');
    if (isLocked) return; // gate lock screen is showing — don't proceed
    const busBlocked = await checkBusRequired();
    if (busBlocked) return; // bus selection screen is showing
    updateAdmitCountersFromCache();
    primeAbsenteeMap();
    renderAllAttendance(document.getElementById('att-search')?.value);

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

    // Walk-in FAB — HTML onclick="App._openWalkin()" handles opening; keep close listener here
    document.getElementById('btn-close-walkin').addEventListener('click', () => {
      document.getElementById('walkin-panel').classList.add('hidden');
    });

    // Admin: keep walk-in panel always open so they can verify the feature works
    if (currentUser?.role === 'admin') _openWalkin();
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
  const ATT_RENDER_LIMIT = 500; // show up to 500 cards; beyond that search is required

  // Relevance-sorted search: exact/prefix match beats contains beats mobile/ID match
  function _relevanceSort(list, q) {
    if (!q) return list;
    const ql = q.toLowerCase();
    const score = a => {
      const nl = (a.name || '').toLowerCase();
      if (nl === ql)              return 0; // exact name match
      if (nl.startsWith(ql))     return 1; // name starts with query
      if (nl.includes(ql))       return 2; // name contains query
      if ((a.mobile || '').includes(q)) return 3; // mobile match
      return 4;
    };
    return list.slice().sort((a, b) => {
      const diff = score(a) - score(b);
      if (diff !== 0) return diff;
      return (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' });
    });
  }

  function renderAllAttendance(query) {
    let list = allAttendees.slice();

    // Apply tab filter
    if (_attFilter === 'unpaid')  list = list.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid');
    else if (_attFilter === 'absent')  list = list.filter(a => a.attendance !== 'present');
    else if (_attFilter === 'present') list = list.filter(a => a.attendance === 'present');

    // Apply search with relevance sorting
    const q = (query || '').trim();
    if (q) {
      list = list.filter(a => Helpers.searchFilter(a, q));
      list = _relevanceSort(list, q);
    }

    const hidden = Math.max(0, list.length - ATT_RENDER_LIMIT);
    const info   = document.getElementById('att-list-info');
    if (info) {
      info.textContent = hidden > 0
        ? `Showing ${ATT_RENDER_LIMIT} of ${list.length} — search by name or mobile to find the rest`
        : `${list.length} of ${allAttendees.length} shown`;
    }

    renderAttendanceResults(list.slice(0, ATT_RENDER_LIMIT));
  }

  // Alias: re-render with the current search query after any admission/payment change
  function searchAttendeesFromCache(q) { renderAllAttendance(q); }

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
    if (_absenteeMap) return; // already loaded for this event; cleared on event switch
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

      const esc = Helpers.escapeHtml;
      if (isPres) {
        // Already admitted — green tick, show who admitted, NO re-admit
        return `
          <div class="att-result-card status-already-present" onclick="App.showDetail('${a.id}')" data-id="${a.id}">
            <div class="att-check-mark">&#10003;</div>
            <div class="att-result-info">
              <div class="att-name">${esc(a.name)}</div>
              <div class="att-meta">${esc(a.mobile || '')} · ${esc(a.team || '')}</div>
              <div class="att-payment-badge status-already-present">Admitted by ${esc(a.markedBy || '?')} at ${Helpers.formatDateTime(a.entryTime)}</div>
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
            <div class="att-name">${esc(a.name)} ${a.isWalkIn ? '<span class="badge walkin">WI</span>' : ''}</div>
            <div class="att-meta">${esc(a.mobile || '')} · ${esc(a.team || '')}</div>
            <div class="att-payment-badge ${ps.cls}">${ps.label}${a.paymentMode ? ' · ' + esc(a.paymentMode) : ''}${a.paymentAmount > 0 ? ' · ' + Helpers.currency(a.paymentAmount) : ''}</div>
            ${absBadge}
          </div>
          <div class="att-admit-btn ${ps.cls}">${admitLabel}</div>
        </div>`;
    }).join('');
  }

  // INSTANT ADMIT — one tap, no modal for paid/free; payment collection for unpaid/partial
  async function instantAdmit(id) {
    // Use in-memory cache first (kept live by onSnapshot), fall back to Firestore only if missing
    const a = allAttendees.find(x => x.id === id) || await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    if (a.attendance === 'present') {
      Helpers.toast(`Already admitted by ${a.markedBy}`, 'warning');
      return;
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

  // Show bottom panel to collect payment info for unpaid attendees
  async function showPaymentCollect(a) {
    const panel = document.getElementById('payment-collect-panel');
    document.getElementById('pc-name').textContent = a.name;
    document.getElementById('pc-attendee-id').value = a.id;
    document.getElementById('pc-amount').value = a.paymentAmount > 0 ? a.paymentAmount : '';
    document.getElementById('pc-remarks').value = '';
    document.getElementById('pc-mode-cash').checked = true;
    document.getElementById('pc-screenshot-wrap').style.display = 'none';
    document.getElementById('pc-screenshot').value = '';
    document.getElementById('pc-screenshot-preview').innerHTML = '';

    // Show past event history above the form
    const histEl = document.getElementById('pc-history');
    histEl.innerHTML = '';
    panel.classList.remove('hidden');
    document.getElementById('pc-amount').focus();

    // Async: fetch history after showing panel — doesn't delay gate flow
    try {
      const absInfo = await Reports.getAbsenteeWarning(a);
      if (absInfo && absInfo.history && absInfo.history.length) {
        // Show ALL absent events — free seva wale bhi, chhuti allowed nahi
        const absentRows = absInfo.history.filter(h => !h.present).slice(0, 5);

        if (absentRows.length > 0) {
          const rows = absentRows.map(h => {
            const ps = (h.paymentStatus || 'unpaid').toLowerCase();
            const isFreeAbsent = ps === 'free';
            const isPaid = ps === 'paid';
            let dueCell;
            if (isPaid) {
              dueCell = `<span style="color:#15803d">paid${h.paymentAmount > 0 ? ' ₹' + h.paymentAmount : ''}</span>`;
            } else if (isFreeAbsent) {
              dueCell = `<span style="color:#b45309;font-weight:700">Fine due ⚠</span>`;
            } else {
              const amt = h.paymentAmount > 0 ? ` ₹${h.paymentAmount}` : '';
              dueCell = `<span style="color:#dc2626;font-weight:700">unpaid${amt}</span>`;
            }
            return `<tr style="border-top:1px solid #fde68a">
              <td style="padding:.3rem .5rem;font-size:.82rem;color:#334155">${h.eventName}</td>
              <td style="padding:.3rem .5rem;font-size:.82rem;color:#dc2626;font-weight:700;white-space:nowrap">✗ Absent</td>
              <td style="padding:.3rem .5rem;font-size:.82rem;white-space:nowrap">${dueCell}</td>
            </tr>`;
          }).join('');

          const fineCount = absentRows.filter(h => (h.paymentStatus || '').toLowerCase() === 'free').length;
          const unpaidCount = absentRows.filter(h => { const ps = (h.paymentStatus || 'unpaid').toLowerCase(); return ps !== 'paid' && ps !== 'free'; }).length;
          const summary = [
            unpaidCount > 0 ? `${unpaidCount} unpaid` : '',
            fineCount > 0   ? `${fineCount} fine due (free sewa absent)` : ''
          ].filter(Boolean).join(' · ');

          histEl.innerHTML = `
            <div style="border:1px solid #f97316;border-radius:7px;margin-bottom:.75rem;overflow:hidden;background:#fff7ed">
              <div style="background:#fed7aa;color:#9a3412;font-weight:700;padding:.4rem .6rem;font-size:.8rem;display:flex;justify-content:space-between;align-items:center">
                <span>&#9888; Absent in ${absentRows.length} past event${absentRows.length > 1 ? 's' : ''}</span>
                <span style="font-size:.75rem;font-weight:400;opacity:.85">${summary}</span>
              </div>
              <table style="width:100%;border-collapse:collapse">
                <thead><tr style="background:#ffedd5">
                  <th style="padding:.25rem .5rem;font-size:.75rem;font-weight:600;text-align:left;color:#9a3412">Event</th>
                  <th style="padding:.25rem .5rem;font-size:.75rem;font-weight:600;text-align:left;color:#9a3412">Status</th>
                  <th style="padding:.25rem .5rem;font-size:.75rem;font-weight:600;text-align:left;color:#9a3412">Recovery</th>
                </tr></thead>
                <tbody>${rows}</tbody>
              </table>
            </div>`;
        }
      }
    } catch { /* absentee map not ready — skip silently */ }
  }

  // Actually perform the admission (shared by instant and payment-collect flow)
  let _pendingAdmit = null;

  function _promptSelectBusThenAdmit(a, extraPayment) {
    const buses  = (window._cachedBusesForPicker || []);
    const myArea = getMyArea();
    const visible = myArea ? buses.filter(b => normBus(b.area) === normBus(myArea)) : buses;
    if (!visible.length) { doAdmit(a, extraPayment); return; }
    const esc = Helpers.escapeHtml;
    const pills = visible.map(b =>
      `<button class="ss-area-pill" onclick="App._gatePickBusAndAdmit('${esc(b.name)}',this)">${esc(b.name)}</button>`
    ).join('');
    _pendingAdmit = { a, extraPayment, chosenBus: '' };
    Helpers.modal(`
      <div style="margin-bottom:.85rem">
        <h3 style="margin:0 0 .25rem;font-size:1rem;font-weight:700">Select bus before admitting</h3>
        <p style="margin:0;font-size:.82rem;color:var(--text-muted)">Which bus is <strong>${esc(a.name)}</strong> boarding?</p>
      </div>
      <div class="ss-area-grid" id="gate-bus-pick-grid">${pills}</div>
      <button class="btn-primary" id="gate-bus-pick-confirm" style="width:100%;margin-top:1.25rem" disabled
        onclick="App._gateConfirmBusAndAdmit()">Admit ›</button>
      <button class="btn-ghost" style="width:100%;margin-top:.4rem" onclick="Helpers.closeModal()">Cancel</button>
    `);
  }

  function _gatePickBusAndAdmit(busName, btn) {
    document.querySelectorAll('#gate-bus-pick-grid .ss-area-pill').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    if (_pendingAdmit) _pendingAdmit.chosenBus = busName;
    const confirm = document.getElementById('gate-bus-pick-confirm');
    if (confirm) confirm.disabled = false;
  }

  async function _gateConfirmBusAndAdmit() {
    if (!_pendingAdmit?.chosenBus) { Helpers.toast('Select a bus first', 'error'); return; }
    const pending = _pendingAdmit;
    _pendingAdmit = null;
    setMyBus(pending.chosenBus);
    initMyBusPicker(); // refresh bus bar to show newly selected bus
    Helpers.closeModal();
    if (pending._isWalkIn) {
      // Re-trigger walk-in submission now that bus is set
      await addWalkIn();
    } else {
      await doAdmit(pending.a, pending.extraPayment);
    }
  }

  async function doAdmit(a, extraPayment) {
    const myBus  = getMyBus();
    const myArea = getMyArea();

    // Hard block: buses exist but none selected — ask first, then retry
    if (!myBus && _busesConfigured) {
      _promptSelectBusThenAdmit(a, extraPayment);
      return;
    }

    a.attendance = 'present';
    a.entryTime  = new Date().toISOString();
    a.markedBy   = currentUser?.name || 'Unknown';
    if (myBus) a.boardedBus = myBus;
    if (myArea && !a.area) a.area = myArea;

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

    // Show admission toast — if absentee history exists, append a brief note for management
    const absInfo = getAbsenteeInfo(a);
    if (absInfo && absInfo.consecutive > 0) {
      const unpaidPast = absInfo.history.filter(h => {
        const ps = (h.paymentStatus || '').toLowerCase();
        return !h.present || (ps !== 'paid' && ps !== 'free');
      }).length;
      const note = unpaidPast > 0
        ? `⚠ Absent ${absInfo.consecutive} past event${absInfo.consecutive > 1 ? 's' : ''} · ${unpaidPast} with dues`
        : `⚠ Absent ${absInfo.consecutive} past event${absInfo.consecutive > 1 ? 's' : ''}`;
      Helpers.toast(`${a.name} admitted · ${note}`, 'warning', 5000);
    } else {
      Helpers.toast(`${a.name} admitted!`, 'success');
    }

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
    const isAdmin = currentUser?.role === 'admin';

    let busOptions = '';
    if (isAdmin && a.attendance === 'present') {
      const buses = await DB.getAll(DB.STORES.buses).catch(() => []);
      if (buses.length) {
        busOptions = `<select id="detail-bus-select" style="font-size:.88rem;padding:.25rem .5rem;border-radius:6px;border:1px solid var(--border);margin-left:.4rem">
          <option value="">— none —</option>
          ${buses.map(b => `<option value="${Helpers.escapeHtml(b.name)}" ${normBus(a.boardedBus) === normBus(b.name) ? 'selected' : ''}>${Helpers.escapeHtml(b.name)}</option>`).join('')}
        </select>
        <button class="btn-ghost" style="font-size:.8rem;padding:.2rem .6rem;margin-left:.3rem" onclick="App.saveBusFromDetail('${a.id}')">Save</button>`;
      }
    }

    Helpers.modal(`
      <div class="admit-confirm-card">
        <div class="admit-status-banner ${ps.cls}"><span class="admit-status-dot ${ps.cls}"></span>${ps.label}</div>
        <h3 class="admit-name">${Helpers.escapeHtml(a.name)}</h3>
        <div class="admit-details">
          <div class="admit-row"><span>Mobile</span><span>${Helpers.escapeHtml(a.mobile || '-')}</span></div>
          <div class="admit-row"><span>Team</span><span>${Helpers.escapeHtml(a.team || '-')}</span></div>
          <div class="admit-row"><span>Category</span><span>${Helpers.escapeHtml(a.category || '-')}</span></div>
          <div class="admit-row"><span>Reference</span><span>${Helpers.escapeHtml(a.reference || '-')}</span></div>
          <div class="admit-row"><span>Payment</span><span class="badge ${a.paymentStatus === 'paid' ? 'present' : a.paymentStatus === 'free' ? 'before' : 'unpaid'}">${a.paymentStatus || 'unpaid'}</span></div>
          <div class="admit-row"><span>Mode</span><span>${Helpers.escapeHtml(a.paymentMode || '-')}</span></div>
          <div class="admit-row"><span>Amount</span><span>${Helpers.currency(a.paymentAmount)}</span></div>
          <div class="admit-row"><span>Remarks</span><span>${Helpers.escapeHtml(a.remarks || '-')}</span></div>
          ${a.serviceStatus ? `<div class="admit-row"><span>Devotee</span><span>${Helpers.escapeHtml(a.serviceStatus)}</span></div>` : ''}
          ${a.activeStatus ? `<div class="admit-row"><span>Activity</span><span>${Helpers.escapeHtml(a.activeStatus)}</span></div>` : ''}
          ${a.attendance === 'present' ? `
            <div class="admit-row"><span>Admitted by</span><span>${Helpers.escapeHtml(a.markedBy || '')}</span></div>
            <div class="admit-row"><span>Time</span><span>${Helpers.formatDateTime(a.entryTime)}</span></div>
            <div class="admit-row"><span>Bus</span><span style="display:flex;align-items:center;flex-wrap:wrap;gap:.25rem">
              ${busOptions || Helpers.escapeHtml(a.boardedBus || '—')}
            </span></div>
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

  async function saveBusFromDetail(id) {
    const sel = document.getElementById('detail-bus-select');
    if (!sel) return;
    const newBus = sel.value;
    await DB.put(DB.STORES.attendees, { id, boardedBus: newBus, updatedAt: new Date().toISOString() });
    const cached = allAttendees.find(x => x.id === id);
    if (cached) cached.boardedBus = newBus;
    await DB.log('busEdit', `Bus updated to "${newBus}" for ${id}`, currentUser?.email);
    Helpers.closeModal();
    Helpers.toast('Bus updated', 'success');
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
    const a = allAttendees.find(x => x.id === id) || await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    if (!confirm(`Remove attendance for ${a.name}?\nThey will need to be re-admitted.`)) return;
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
      let lookupId = null;
      try { const parsed = JSON.parse(input); lookupId = parsed.id; }
      catch { lookupId = input; }
      const found = allAttendees.find(a =>
        String(a.id) === String(lookupId) || a.mobile === input.replace(/\D/g, '')
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
        const found = all.find(a => a.mobile === val || String(a.id) === val);
        if (found && found.attendance !== 'present') {
          const myBusBulk = getMyBus();
          found.attendance = 'present';
          found.entryTime = new Date().toISOString();
          found.markedBy = currentUser?.name + ' (bulk)';
          if (myBusBulk) found.boardedBus = myBusBulk;
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
    if (_walkinSubmitting) return;

    const name    = document.getElementById('wi-name').value.trim();
    const mobile  = document.getElementById('wi-mobile').value.trim();
    const reference = document.getElementById('wi-reference').value.trim();
    const payment = document.getElementById('wi-payment').value;
    const category  = document.getElementById('wi-category').value;
    const payMode   = document.getElementById('wi-paymode').value;
    const remarks   = document.getElementById('wi-remarks')?.value?.trim() || '';
    const fb  = document.getElementById('walkin-feedback');
    const btn = document.getElementById('btn-add-walkin');

    const showErr = (msg) => { fb.className = 'scan-feedback error'; fb.textContent = msg; fb.classList.remove('hidden'); };

    if (!name)   { showErr('Name is required'); return; }
    if (!mobile) { showErr('Mobile is required'); return; }

    const normMob = mobile.replace(/\D/g, '').slice(-10);
    if (normMob.length < 10) { showErr('Enter a valid 10-digit mobile number'); return; }

    // Hard block: already a registered attendee
    const registered = allAttendees.find(a => !a.isWalkIn && a.mobile && a.mobile.toString().replace(/\D/g, '').slice(-10) === normMob);
    if (registered) {
      showErr(`Already registered as "${registered.name}" — admit from the Gate tab`);
      return;
    }

    // Hard block: already a walk-in with same mobile (no bypass)
    const dupWI = allAttendees.find(a => a.isWalkIn && a.mobile && a.mobile.toString().replace(/\D/g, '').slice(-10) === normMob);
    if (dupWI) {
      showErr(`Walk-in already added: "${dupWI.name}" (${dupWI.mobile})`);
      return;
    }

    // Hard block: buses exist but none selected
    if (!getMyBus() && _busesConfigured) {
      _pendingAdmit = {
        a: { name, mobile },
        extraPayment: null,
        chosenBus: '',
        _isWalkIn: true,
        _walkinData: { name, mobile, reference, payment, category, payMode, remarks }
      };
      const buses  = (window._cachedBusesForPicker || []);
      const myArea = getMyArea();
      const visible = myArea ? buses.filter(b => normBus(b.area) === normBus(myArea)) : buses;
      if (visible.length) {
        const esc2 = Helpers.escapeHtml;
        const pills = visible.map(b =>
          `<button class="ss-area-pill" onclick="App._gatePickBusAndAdmit('${esc2(b.name)}',this)">${esc2(b.name)}</button>`
        ).join('');
        Helpers.modal(`
          <div style="margin-bottom:.85rem">
            <h3 style="margin:0 0 .25rem;font-size:1rem;font-weight:700">Select bus before admitting</h3>
            <p style="margin:0;font-size:.82rem;color:var(--text-muted)">Which bus is <strong>${Helpers.escapeHtml(name)}</strong> (walk-in) boarding?</p>
          </div>
          <div class="ss-area-grid" id="gate-bus-pick-grid">${pills}</div>
          <button class="btn-primary" id="gate-bus-pick-confirm" style="width:100%;margin-top:1.25rem" disabled
            onclick="App._gateConfirmBusAndAdmit()">Add Walk-in ›</button>
          <button class="btn-ghost" style="width:100%;margin-top:.4rem" onclick="Helpers.closeModal()">Cancel</button>
        `);
        return;
      }
    }

    // Lock submission — prevents double-tap on slow network
    _walkinSubmitting = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    fb.classList.add('hidden');

    try {
      const now = new Date();
      const paydate    = now.toISOString().slice(0, 10);
      const eventDate  = await DB.getConfig('eventDate');
      const walkinPayAmt    = parseFloat(payment) || 0;
      const walkinPayStatus = walkinPayAmt > 0 ? 'paid' : 'unpaid';
      const record = {
        name, mobile, reference,
        paymentAmount: walkinPayAmt, paymentDate: paydate,
        paymentTiming: Helpers.paymentTiming(paydate, eventDate),
        paymentStatus: walkinPayStatus, paymentMode: payMode || '', remarks,
        team: '', category,
        attendance: 'present', entryTime: now.toISOString(),
        markedBy: currentUser?.name || 'Unknown',
        collectedBy: currentUser?.name || 'Unknown',
        isWalkIn: true, isDuplicate: false, createdAt: now.toISOString(),
        boardedBus: getMyBus() || '',
        area: getMyArea() || '',
        paidAtEvent: walkinPayAmt > 0 || walkinPayStatus === 'paid',
      };

      const newId = await DB.add(DB.STORES.attendees, record);
      // Immediately inject into local cache so re-submission is blocked even before onSnapshot fires
      allAttendees.push({ id: newId, ...record });

      await DB.log('walkin', `Walk-in: ${name} (${mobile})`, currentUser?.email);

      clearWalkinForm();
      document.getElementById('walkin-panel').classList.add('hidden');
      updateAdmitCountersFromCache();
      Helpers.toast(`${name} added as walk-in`, 'success');
    } catch (err) {
      showErr('Failed to add: ' + err.message);
    } finally {
      _walkinSubmitting = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Add & Mark Present'; }
    }
  }

  function clearWalkinForm() {
    ['wi-name','wi-mobile','wi-reference','wi-payment','wi-remarks'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const pm = document.getElementById('wi-paymode'); if (pm) pm.value = '';
  }

  async function renderWalkinList() {
    const all = allAttendees.length ? allAttendees : await DB.getAll(DB.STORES.attendees);
    const walkins = all.filter(a => a.isWalkIn).slice().reverse();
    document.getElementById('walkin-list').innerHTML = walkins.length ? Helpers.buildTable(
      ['Name', 'Mobile', 'Reference', 'Payment', 'Mode', 'Entry'],
      walkins.map(a => ({ _class: 'walkin-row', cells: [a.name, a.mobile, a.reference || '-',
        `<span class="badge ${a.paymentStatus === 'paid' ? 'present' : 'unpaid'}">${a.paymentStatus}</span>`,
        a.paymentMode || '-', Helpers.formatDateTime(a.entryTime)] }))
    ) : '<p style="color:var(--text-muted);padding:1rem">No walk-ins yet</p>';
  }

  // ===== ATTENDEES =====
  const ATTENDEES_LIMIT = 500;
  async function initAttendees() {
    const attendees = allAttendees.length ? allAttendees : await DB.getAll(DB.STORES.attendees);
    attendeesPage = 1;

    // Deduplicate team names case-insensitively; display canonical (most-frequent) spelling
    const teamFreq = {};
    attendees.forEach(a => {
      const raw = (a.team || '').trim();
      if (!raw) return;
      const key = raw.toLowerCase();
      if (!teamFreq[key]) teamFreq[key] = {};
      teamFreq[key][raw] = (teamFreq[key][raw] || 0) + 1;
    });
    const canonicalTeams = Object.values(teamFreq).map(spellings =>
      Object.entries(spellings).sort((a, b) => b[1] - a[1])[0][0]
    ).sort();
    document.getElementById('attendees-filter-team').innerHTML =
      '<option value="">All Teams</option>' + canonicalTeams.map(t => `<option value="${t}">${t}</option>`).join('');

    const normStr = s => (s || '').trim().toLowerCase();
    const search = document.getElementById('attendees-search');
    const teamSel = document.getElementById('attendees-filter-team');
    const catSel = document.getElementById('attendees-filter-cat');
    const attSel = document.getElementById('attendees-filter-att');
    const esc = Helpers.escapeHtml;

    const renderFiltered = () => {
      let filtered = attendees;
      const q = search.value.toLowerCase();
      if (q) filtered = filtered.filter(a => Helpers.searchFilter(a, q));
      if (teamSel.value) filtered = filtered.filter(a => normStr(a.team) === normStr(teamSel.value));
      if (catSel.value)  filtered = filtered.filter(a => normStr(a.category) === normStr(catSel.value));
      if (attSel.value)  filtered = filtered.filter(a => attSel.value === 'present' ? a.attendance === 'present' : a.attendance !== 'present');

      filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));
      const hidden = Math.max(0, filtered.length - ATTENDEES_LIMIT);
      document.getElementById('attendees-count').textContent = hidden > 0
        ? `Showing ${ATTENDEES_LIMIT} of ${filtered.length} — search to narrow down`
        : `${filtered.length} attendee${filtered.length !== 1 ? 's' : ''}`;

      const rows = filtered.slice(0, ATTENDEES_LIMIT).map((a, i) => {
        const payBadge = a.paymentStatus === 'paid'
          ? `<span class="badge present">Paid</span>`
          : a.paymentStatus === 'free'
            ? `<span class="badge before">Free</span>`
            : `<span class="badge unpaid">Unpaid</span>`;
        const attVal  = a.attendance === 'present'
          ? (a.isWalkIn ? 'Present (walk-in)' : 'Present')
          : 'Absent';
        const attBadge = a.attendance === 'present'
          ? `<span class="badge present">${attVal}</span>`
          : `<span class="badge absent">Absent</span>`;
        const rowCls = a.isDuplicate && !a.dupResolved ? 'duplicate-row' : a.isWalkIn ? 'walkin-row' : '';
        const nameTags = (a.isDuplicate && !a.dupResolved ? ' <span class="badge dup">dup</span>' : '') + (a.isWalkIn ? ' <span class="badge walkin">WI</span>' : '');
        return `<tr class="${rowCls}">
          <td class="att-col-sr">${i + 1}</td>
          <td class="att-col-name att-sticky-name">${esc(a.name)}${nameTags}</td>
          <td class="att-col-mobile">${esc(a.mobile || '-')}</td>
          <td class="att-col-cat">${esc(a.category || '-')}</td>
          <td class="att-col-ref">${esc(a.reference || '-')}</td>
          <td class="att-col-team">${esc(a.team || '-')}</td>
          <td class="att-col-pickup">${esc(a.pickupLocation || '-')}</td>
          <td class="att-col-ps">${payBadge}</td>
          <td class="att-col-remarks">${esc(a.remarks || '-')}</td>
          <td class="att-col-mode">${esc(a.paymentMode || '-')}</td>
          <td class="att-col-amt">${a.paymentAmount > 0 ? a.paymentAmount : '-'}</td>
          <td class="att-col-att">${attBadge}</td>
          <td class="att-col-by">${esc(a.markedBy || '-')}</td>
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
    const esc = Helpers.escapeHtml;
    const dupOf = a._dupOf || '(another record with same mobile)';
    Helpers.modal(`
      <h3 class="modal-title">Resolve Duplicate</h3>
      <p style="color:var(--text-secondary);margin-bottom:.5rem">
        <strong>${esc(a.name)}</strong> (${esc(a.mobile || '—')}) appears to match: <strong>${esc(dupOf)}</strong>
      </p>
      <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:1rem">
        "Accept as Unique" keeps this record and removes the duplicate flag.<br>
        "Delete" permanently removes this entry.
      </p>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App.acceptDuplicate('${esc(id)}')">Accept as Unique</button>
        <button class="btn-danger" onclick="App.deleteDuplicate('${esc(id)}')">Delete</button>
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

  // ===== MANAGE PAGE (Attendees / Action / Fine Collection) =====
  let _mngTab = 'attendees';
  let _finesCache = [];

  function initManage() { _manageSubTab(_mngTab); }

  function _manageSubTab(tab) {
    _mngTab = tab;
    document.querySelectorAll('#page-manage > .att-filter-tabs .att-tab').forEach(b =>
      b.classList.toggle('active', b.id === `mng-tab-${tab}`)
    );
    const host = document.getElementById('manage-content');
    host.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:2rem">Loading…</p>';
    if (tab === 'attendees') _initMngAttendees(host);
    else if (tab === 'action') _initMngAction(host);
    else if (tab === 'fines') _initMngFines(host);
  }

  // ── Attendees sub-tab: edit, cancel, add registrations ──────────
  async function _initMngAttendees(host) {
    const attendees = allAttendees.length ? allAttendees : await DB.getAll(DB.STORES.attendees);
    const esc = Helpers.escapeHtml;
    const teamMap = {}, refMap = {};
    attendees.forEach(a => {
      const t = (a.team || '').trim(), r = (a.reference || '').trim();
      if (t && !teamMap[t.toLowerCase()]) teamMap[t.toLowerCase()] = t;
      if (r && !refMap[r.toLowerCase()]) refMap[r.toLowerCase()] = r;
    });
    const teams = Object.values(teamMap).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
    const refs = Object.values(refMap).sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));

    host.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;gap:.5rem">
          <h3 class="card-title" style="margin:0">Manage Registrations</h3>
          <button class="btn-primary" style="font-size:.82rem;padding:.4rem .85rem" onclick="App._showAddReg()">+ Add Registration</button>
        </div>
        <div class="table-controls">
          <input type="text" id="mng-att-search" class="search-input" placeholder="Search..." style="flex:2" />
          <select id="mng-att-team" class="filter-select"><option value="">All Teams</option>${teams.map(t => `<option>${esc(t)}</option>`).join('')}</select>
          <select id="mng-att-ref" class="filter-select"><option value="">All References</option>${refs.map(r => `<option>${esc(r)}</option>`).join('')}</select>
          <select id="mng-att-pay" class="filter-select">
            <option value="">All Payment</option><option value="paid">Paid</option><option value="unpaid">Unpaid</option><option value="free">Free</option>
          </select>
          <select id="mng-att-status" class="filter-select">
            <option value="">All</option><option value="active">Active</option><option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div id="mng-att-count" class="table-count"></div>
        <div id="mng-att-table"></div>
      </div>`;

    const render = () => {
      let filtered = attendees;
      const q = document.getElementById('mng-att-search').value.toLowerCase();
      const team = document.getElementById('mng-att-team').value;
      const ref = document.getElementById('mng-att-ref').value;
      const pay = document.getElementById('mng-att-pay').value;
      const status = document.getElementById('mng-att-status').value;
      if (q) filtered = filtered.filter(a => Helpers.searchFilter(a, q));
      if (team) filtered = filtered.filter(a => normBus(a.team) === normBus(team));
      if (ref) filtered = filtered.filter(a => normBus(a.reference) === normBus(ref));
      if (pay) filtered = filtered.filter(a => (a.paymentStatus || 'unpaid') === pay);
      if (status === 'active') filtered = filtered.filter(a => !a.cancelled);
      if (status === 'cancelled') filtered = filtered.filter(a => a.cancelled);
      filtered.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));

      const limit = 300;
      document.getElementById('mng-att-count').textContent =
        `${filtered.length} registrations` + (filtered.length > limit ? ` (showing ${limit})` : '');

      const rows = filtered.slice(0, limit).map((a, i) => {
        const cancelled = a.cancelled;
        const payBadge = a.paymentStatus === 'paid' ? '<span class="badge present">Paid</span>'
          : a.paymentStatus === 'free' ? '<span class="badge before">Free</span>'
          : '<span class="badge unpaid">Unpaid</span>';
        const tags = (cancelled ? ' <span class="badge" style="background:#fee2e2;color:#dc2626;border:1px solid #fca5a5">Cancelled</span>' : '')
          + (a.isWalkIn ? ' <span class="badge walkin">WI</span>' : '');
        return `<tr style="${cancelled ? 'opacity:.55;' : ''}">
          <td>${i + 1}</td>
          <td style="font-weight:500">${esc(a.name)}${tags}</td>
          <td>${esc(a.mobile || '-')}</td>
          <td>${esc(a.team || '-')}</td>
          <td>${payBadge}${a.paymentAmount > 0 ? ' ₹' + a.paymentAmount : ''}</td>
          <td>${esc(a.area || '-')}</td>
          <td style="white-space:nowrap">
            <button class="btn-small" onclick="App.showDetail('${a.id}')">View</button>
            <button class="btn-small" onclick="App._collectPayment('${a.id}')">Collect</button>
            ${cancelled
              ? `<button class="btn-small success" onclick="App._uncancelReg('${a.id}')">Restore</button>`
              : `<button class="btn-small danger" onclick="App._cancelReg('${a.id}')">Cancel</button>`}
          </td>
        </tr>`;
      }).join('');

      document.getElementById('mng-att-table').innerHTML = `
        <div class="att-table-scroll"><table class="att-table">
          <thead><tr><th>#</th><th>Name</th><th>Mobile</th><th>Team</th><th>Payment</th><th>Area</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)">No registrations</td></tr>'}</tbody>
        </table></div>`;
    };

    const debounced = Helpers.debounce(render, 200);
    ['mng-att-search', 'mng-att-team', 'mng-att-ref', 'mng-att-pay', 'mng-att-status'].forEach(id => {
      document.getElementById(id).oninput = debounced;
    });
    render();
  }

  async function _cancelReg(id) {
    if (!confirm('Cancel this registration?')) return;
    await DB.put(DB.STORES.attendees, { id, cancelled: true, updatedAt: new Date().toISOString() });
    const cached = allAttendees.find(x => x.id === id);
    if (cached) cached.cancelled = true;
    await DB.log('cancel', `Registration cancelled: ${id}`, currentUser?.email);
    Helpers.toast('Registration cancelled', 'success');
    _manageSubTab('attendees');
  }

  async function _uncancelReg(id) {
    await DB.put(DB.STORES.attendees, { id, cancelled: false, updatedAt: new Date().toISOString() });
    const cached = allAttendees.find(x => x.id === id);
    if (cached) cached.cancelled = false;
    await DB.log('uncancel', `Registration restored: ${id}`, currentUser?.email);
    Helpers.toast('Registration restored', 'success');
    _manageSubTab('attendees');
  }

  async function _collectPayment(id) {
    const a = await DB.getById(DB.STORES.attendees, id);
    if (!a) return;
    const esc = Helpers.escapeHtml;
    const existing = parseFloat(a.paymentAmount) || 0;
    Helpers.modal(`
      <h3 class="modal-title">Collect Payment — ${esc(a.name)}</h3>
      ${existing > 0 ? `<p style="font-size:.85rem;color:var(--text-secondary);margin-bottom:.75rem">Already collected: ${Helpers.currency(existing)}</p>` : ''}
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Amount (₹)</label>
        <input id="cp-amt" type="number" min="0" value="${existing || ''}" style="font-size:1.1rem;font-weight:700" />
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Mode</label>
        <select id="cp-mode">
          <option value="cash" ${a.paymentMode === 'cash' ? 'selected' : ''}>Cash</option>
          <option value="online" ${a.paymentMode === 'online' ? 'selected' : ''}>Online</option>
        </select>
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Remarks</label>
        <input id="cp-remarks" type="text" value="${esc(a.remarks || '')}" placeholder="e.g. collected by Riya" />
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App._saveCollectPayment('${a.id}')">Save</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
      </div>`);
  }

  async function _saveCollectPayment(id) {
    const amt = parseFloat(document.getElementById('cp-amt').value) || 0;
    const mode = document.getElementById('cp-mode').value;
    const remarks = document.getElementById('cp-remarks').value.trim();
    const status = amt > 0 ? 'paid' : 'unpaid';
    await DB.put(DB.STORES.attendees, {
      id, paymentAmount: amt, paymentMode: mode, paymentStatus: status,
      remarks, paymentDate: amt > 0 ? new Date().toISOString().slice(0, 10) : '',
      updatedAt: new Date().toISOString()
    });
    const cached = allAttendees.find(x => x.id === id);
    if (cached) { cached.paymentAmount = amt; cached.paymentMode = mode; cached.paymentStatus = status; cached.remarks = remarks; }
    await DB.log('collectPayment', `Payment collected: ${id}, ₹${amt} (${mode})`, currentUser?.email);
    Helpers.closeModal();
    Helpers.toast(amt > 0 ? `₹${amt} collected` : 'Payment cleared', 'success');
    if (_mngTab === 'attendees') _manageSubTab('attendees');
    else if (_mngTab === 'action') _manageSubTab('action');
  }

  async function _showAddReg() {
    const areas = await _loadAreas().catch(() => []);
    const esc = Helpers.escapeHtml;
    const areaOpts = areas.map(a => `<option value="${esc(a.name)}">${esc(a.name)}</option>`).join('');
    Helpers.modal(`
      <h3 class="modal-title">Add Registration</h3>
      <div class="form-grid">
        <div class="input-group"><label>Name *</label><input id="ar-name" /></div>
        <div class="input-group"><label>Mobile *</label><input id="ar-mobile" type="tel" /></div>
        <div class="input-group"><label>Team</label><input id="ar-team" /></div>
        <div class="input-group"><label>Category</label>
          <select id="ar-cat"><option value="">—</option><option>IGF</option><option>IYF</option><option>ICF_MTG</option><option>ICF_PRJI</option></select></div>
        <div class="input-group"><label>Reference</label><input id="ar-ref" /></div>
        <div class="input-group"><label>Area</label>
          <select id="ar-area"><option value="">—</option>${areaOpts}</select></div>
        <div class="input-group"><label>Payment Status</label>
          <select id="ar-pay"><option value="unpaid">Unpaid</option><option value="paid">Paid</option><option value="free">Free</option></select></div>
        <div class="input-group"><label>Amount</label><input id="ar-amt" type="number" min="0" value="0" /></div>
        <div class="input-group"><label>Mode</label>
          <select id="ar-mode"><option value="">—</option><option value="cash">Cash</option><option value="online">Online</option></select></div>
        <div class="input-group"><label>Remarks</label><input id="ar-remarks" /></div>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App._saveAddReg()">Add</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
      </div>`);
  }

  async function _saveAddReg() {
    const name = document.getElementById('ar-name').value.trim();
    const mobile = document.getElementById('ar-mobile').value.trim();
    if (!name || !mobile) { Helpers.toast('Name and mobile required', 'error'); return; }
    const normMob = mobile.replace(/\D/g, '').slice(-10);
    if (normMob.length < 10) { Helpers.toast('Enter valid 10-digit mobile', 'error'); return; }
    const existing = allAttendees.find(a => a.mobile && a.mobile.toString().replace(/\D/g, '').slice(-10) === normMob);
    if (existing) { Helpers.toast(`Mobile already exists: "${existing.name}"`, 'error'); return; }

    const amt = parseFloat(document.getElementById('ar-amt').value) || 0;
    const record = {
      name, mobile,
      team: document.getElementById('ar-team').value.trim(),
      category: document.getElementById('ar-cat').value,
      reference: document.getElementById('ar-ref').value.trim(),
      area: document.getElementById('ar-area').value,
      paymentStatus: document.getElementById('ar-pay').value,
      paymentAmount: amt,
      paymentMode: document.getElementById('ar-mode').value,
      remarks: document.getElementById('ar-remarks').value.trim(),
      attendance: 'absent', isWalkIn: false, isDuplicate: false, cancelled: false,
      createdAt: new Date().toISOString(),
      addedBy: currentUser?.name || 'Unknown',
      paymentDate: amt > 0 ? new Date().toISOString().slice(0, 10) : '',
    };
    const newId = await DB.add(DB.STORES.attendees, record);
    allAttendees.push({ id: newId, ...record });
    await DB.log('addReg', `Registration added: ${name} (${mobile})`, currentUser?.email);
    Helpers.closeModal();
    Helpers.toast(`${name} registered`, 'success');
    _manageSubTab('attendees');
  }

  // ── Action sub-tab: present but unpaid ──────────────────────────
  async function _initMngAction(host) {
    const attendees = allAttendees.length ? allAttendees : await DB.getAll(DB.STORES.attendees);
    const esc = Helpers.escapeHtml;
    const unpaid = attendees.filter(a =>
      a.attendance === 'present' && a.paymentStatus !== 'paid' && a.paymentStatus !== 'free' && !a.cancelled
    ).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));

    const evtDoc = await DB.getEvent(DB.getCurrentEvent()).catch(() => null);
    const charge = parseFloat(evtDoc?.chargePerPerson) || 0;
    const partialAmt = unpaid.reduce((s, a) => s + (parseFloat(a.paymentAmount) || 0), 0);
    const outstanding = charge ? (charge * unpaid.length) - partialAmt : 0;

    host.innerHTML = `
      <div class="card">
        <h3 class="card-title">Present but Unpaid — Follow Up</h3>
        <div class="stats-grid" style="margin-bottom:1rem">
          <div class="stat-card warning"><div class="stat-value">${unpaid.length}</div><div class="stat-label">Unpaid Present</div></div>
          ${charge ? `<div class="stat-card danger"><div class="stat-value">${Helpers.currency(outstanding)}</div><div class="stat-label">Outstanding</div></div>
          <div class="stat-card info"><div class="stat-value">${Helpers.currency(charge)}</div><div class="stat-label">Per Person</div></div>` : ''}
          ${partialAmt ? `<div class="stat-card accent"><div class="stat-value">${Helpers.currency(partialAmt)}</div><div class="stat-label">Partial Collected</div></div>` : ''}
        </div>
        ${unpaid.length === 0
          ? '<p style="text-align:center;color:var(--text-muted);padding:1rem">All present attendees have paid!</p>'
          : `<div class="att-table-scroll"><table class="att-table">
              <thead><tr><th>#</th><th>Name</th><th>Mobile</th><th>Team</th><th>Partial</th><th>Actions</th></tr></thead>
              <tbody>${unpaid.map((a, i) => {
                const partial = parseFloat(a.paymentAmount || 0);
                return `<tr>
                  <td>${i + 1}</td><td style="font-weight:500">${esc(a.name)}</td><td>${esc(a.mobile || '-')}</td>
                  <td>${esc(a.team || '-')}</td><td>${partial > 0 ? Helpers.currency(partial) : '-'}</td>
                  <td style="white-space:nowrap">
                    <button class="btn-small success" onclick="App._collectPayment('${a.id}')">Collect</button>
                    <button class="btn-small" onclick="App.showDetail('${a.id}')">View</button>
                  </td></tr>`;
              }).join('')}</tbody>
            </table></div>`}
      </div>`;
  }

  // ── Fine Collection sub-tab ─────────────────────────────────────
  async function _initMngFines(host) {
    const eid = DB.getCurrentEvent();
    const evtDoc = await DB.getEvent(eid).catch(() => null);
    const esc = Helpers.escapeHtml;

    let fines = [];
    try { fines = await DB.getAll(DB.STORES.fines); } catch {}
    _finesCache = fines;

    const attendees = allAttendees.length ? allAttendees : await DB.getAll(DB.STORES.attendees);
    const absentees = attendees.filter(a => a.attendance !== 'present' && !a.cancelled && !a.isWalkIn);
    const finedIds = new Set(fines.map(f => f.participantId));
    const unfined = absentees.filter(a => !finedIds.has(a.id));

    const pending = fines.filter(f => f.status === 'pending');
    const collected = fines.filter(f => f.status === 'collected');
    const waived = fines.filter(f => f.status === 'waived');
    const totalPending = pending.reduce((s, f) => s + (parseFloat(f.fineAmount) || 0), 0);
    const totalCollected = collected.reduce((s, f) => s + (parseFloat(f.collectedAmount) || 0), 0);

    host.innerHTML = `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.75rem;flex-wrap:wrap;gap:.5rem">
          <h3 class="card-title" style="margin:0">Fine Collection — ${esc(evtDoc?.name || 'Current Event')}</h3>
          ${unfined.length > 0 ? `<button class="btn-primary" style="font-size:.82rem;padding:.4rem .85rem" onclick="App._generateFines()">Generate Fines (${unfined.length} absentees)</button>` : ''}
        </div>
        <div class="stats-grid" style="margin-bottom:1rem">
          <div class="stat-card warning"><div class="stat-value">${pending.length}</div><div class="stat-label">Pending</div></div>
          <div class="stat-card success"><div class="stat-value">${collected.length}</div><div class="stat-label">Collected</div></div>
          <div class="stat-card info"><div class="stat-value">${Helpers.currency(totalCollected)}</div><div class="stat-label">Total Collected</div></div>
          <div class="stat-card danger"><div class="stat-value">${Helpers.currency(totalPending)}</div><div class="stat-label">Outstanding</div></div>
        </div>
        ${fines.length === 0
          ? `<p style="text-align:center;color:var(--text-muted);padding:1rem">${unfined.length > 0
              ? 'No fines generated yet. Click "Generate Fines" to create fine entries for absentees.'
              : 'No absentees found for this event.'}</p>`
          : `<div class="att-filter-tabs" style="margin-bottom:.75rem">
              <button class="att-tab active" onclick="App._filterFines('all',this)">All (${fines.length})</button>
              <button class="att-tab" onclick="App._filterFines('pending',this)">Pending (${pending.length})</button>
              <button class="att-tab" onclick="App._filterFines('collected',this)">Collected (${collected.length})</button>
              ${waived.length ? `<button class="att-tab" onclick="App._filterFines('waived',this)">Waived (${waived.length})</button>` : ''}
            </div>
            <div id="mng-fines-table"></div>`}
      </div>`;

    if (fines.length) _renderFinesTable(fines, 'all');
  }

  function _renderFinesTable(fines, filter) {
    const esc = Helpers.escapeHtml;
    let list = fines;
    if (filter === 'pending') list = fines.filter(f => f.status === 'pending');
    else if (filter === 'collected') list = fines.filter(f => f.status === 'collected');
    else if (filter === 'waived') list = fines.filter(f => f.status === 'waived');
    list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'en', { sensitivity: 'base' }));

    const tbl = document.getElementById('mng-fines-table');
    if (!tbl) return;
    tbl.innerHTML = `
      <div class="att-table-scroll"><table class="att-table">
        <thead><tr><th>#</th><th>Name</th><th>Mobile</th><th>Team</th><th>Fine</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${list.length ? list.map((f, i) => {
          const badge = f.status === 'collected'
            ? `<span class="badge present">Collected ${Helpers.currency(f.collectedAmount)}</span>`
            : f.status === 'waived' ? `<span class="badge before">Waived</span>`
            : `<span class="badge unpaid">Pending</span>`;
          return `<tr>
            <td>${i + 1}</td><td style="font-weight:500">${esc(f.name)}</td>
            <td>${esc(f.mobile || '-')}</td><td>${esc(f.team || '-')}</td>
            <td>${Helpers.currency(f.fineAmount)}</td><td>${badge}</td>
            <td style="white-space:nowrap">${f.status === 'pending'
              ? `<button class="btn-small success" onclick="App._collectFine('${f.id}')">Collect</button>
                 <button class="btn-small warning" onclick="App._waiveFine('${f.id}')">Waive</button>`
              : `<span style="font-size:.75rem;color:var(--text-muted)">${esc(f.collectedBy || f.remarks || '')}</span>`}
            </td></tr>`;
        }).join('') : '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--text-muted)">No fines in this view</td></tr>'}</tbody>
      </table></div>`;
  }

  function _filterFines(filter, btn) {
    if (btn) {
      btn.closest('.att-filter-tabs').querySelectorAll('.att-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
    }
    _renderFinesTable(_finesCache, filter);
  }

  async function _generateFines() {
    const eid = DB.getCurrentEvent();
    const evtDoc = await DB.getEvent(eid).catch(() => null);
    const charge = parseFloat(evtDoc?.chargePerPerson) || 0;
    let fineAmt = charge;
    if (!fineAmt) {
      const input = prompt('Enter fine amount per person (₹):');
      if (!input || isNaN(input) || parseFloat(input) <= 0) { Helpers.toast('Enter a valid amount', 'error'); return; }
      fineAmt = parseFloat(input);
    }

    const attendees = allAttendees.length ? allAttendees : await DB.getAll(DB.STORES.attendees);
    let existing = [];
    try { existing = await DB.getAll(DB.STORES.fines); } catch {}
    const finedIds = new Set(existing.map(f => f.participantId));
    const absentees = attendees.filter(a =>
      a.attendance !== 'present' && !a.cancelled && !a.isWalkIn && !finedIds.has(a.id)
    );
    if (!absentees.length) { Helpers.toast('No new absentees to fine', 'info'); return; }
    if (!confirm(`Generate fines for ${absentees.length} absentees at ${Helpers.currency(fineAmt)} each?`)) return;

    const now = new Date().toISOString();
    const BATCH = 400;
    for (let i = 0; i < absentees.length; i += BATCH) {
      await Promise.all(absentees.slice(i, i + BATCH).map(a => DB.add(DB.STORES.fines, {
        participantId: a.id, name: a.name, mobile: a.mobile || '',
        team: a.team || '', category: a.category || '',
        fineAmount: fineAmt, status: 'pending',
        collectedAmount: 0, collectedAt: null, collectedBy: '', collectedMode: '', remarks: '',
        createdAt: now, eventName: evtDoc?.name || ''
      })));
    }
    await DB.log('finesGenerated', `Generated ${absentees.length} fines at ₹${fineAmt}`, currentUser?.email);
    Helpers.toast(`${absentees.length} fines generated`, 'success');
    _manageSubTab('fines');
  }

  function _collectFine(fineId) {
    const f = _finesCache.find(x => x.id === fineId);
    Helpers.modal(`
      <h3 class="modal-title">Collect Fine${f ? ' — ' + Helpers.escapeHtml(f.name) : ''}</h3>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Amount Collected (₹)</label>
        <input id="fc-amt" type="number" min="0" value="${f?.fineAmount || ''}" />
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Mode</label>
        <select id="fc-mode"><option value="cash">Cash</option><option value="online">Online</option></select>
      </div>
      <div class="input-group" style="margin-bottom:.75rem">
        <label>Remarks</label>
        <input id="fc-remarks" type="text" placeholder="e.g. collected at next event" />
      </div>
      <div class="modal-actions">
        <button class="btn-primary" onclick="App._saveFineColl('${fineId}')">Save</button>
        <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
      </div>`);
  }

  async function _saveFineColl(fineId) {
    const amt = parseFloat(document.getElementById('fc-amt').value);
    if (!amt || amt <= 0) { Helpers.toast('Enter a valid amount', 'error'); return; }
    await DB.put(DB.STORES.fines, {
      id: fineId, status: 'collected', collectedAmount: amt,
      collectedAt: new Date().toISOString(),
      collectedBy: currentUser?.name || 'Unknown',
      collectedMode: document.getElementById('fc-mode').value,
      remarks: document.getElementById('fc-remarks').value.trim()
    });
    await DB.log('fineCollected', `Fine collected: ${fineId}, ₹${amt}`, currentUser?.email);
    Helpers.closeModal(); Helpers.toast('Fine collected', 'success');
    _manageSubTab('fines');
  }

  async function _waiveFine(fineId) {
    const reason = prompt('Reason for waiving (optional):');
    if (reason === null) return;
    await DB.put(DB.STORES.fines, {
      id: fineId, status: 'waived', remarks: reason || 'Waived',
      collectedAt: new Date().toISOString(),
      collectedBy: currentUser?.name || 'Unknown'
    });
    await DB.log('fineWaived', `Fine waived: ${fineId}`, currentUser?.email);
    Helpers.toast('Fine waived', 'info');
    _manageSubTab('fines');
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
    const el = document.getElementById('page-financial-content') || document.getElementById('page-financial');
    el.innerHTML = '<p style="color:var(--text-muted);padding:2rem;text-align:center">Loading...</p>';
    try {
      const events = await DB.getEvents();
      const fyMap = {};
      for (const evt of events) {
        const fy = evt.financialYear || Helpers.getFinancialYear(evt.date || evt.createdAt);
        if (!fyMap[fy]) fyMap[fy] = [];
        const oldEvent = DB.getCurrentEvent();
        DB.setCurrentEvent(evt.id);
        const [participants, buses, areasRaw] = await Promise.all([
          DB.getAll(DB.STORES.attendees),
          DB.getAll(DB.STORES.buses).catch(() => []),
          DB.getConfig('areas').catch(() => null)
        ]);
        DB.setCurrentEvent(oldEvent);

        const areas = areasRaw
          ? JSON.parse(areasRaw).map(a => typeof a === 'string' ? { name: a, perBusCost: 0 } : a)
          : [];

        const totalCollected = participants.reduce((s, p) => s + (parseFloat(p.paymentAmount) || 0), 0);

        // Compute bus cost exactly as the dashboard does: buses per area × area's per-bus cost
        const busCost = areas.reduce((sum, area) => {
          const n = buses.filter(b => normBus(b.area) === normBus(area.name)).length;
          return sum + n * (parseFloat(area.perBusCost) || 0);
        }, 0);

        fyMap[fy].push({ ...evt, participantCount: participants.length,
          presentCount: participants.filter(p => p.attendance === 'present').length,
          totalCollected, busCost, profitLoss: totalCollected - busCost,
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
        const fyExpense = evts.reduce((s, e) => s + e.busCost, 0);
        const fyPL = fyTotal - fyExpense;
        html += `<div style="margin-bottom:1.5rem">
          <h4 style="color:#15803d;margin-bottom:.75rem;display:flex;justify-content:space-between">
            <span>FY ${fy}</span>
            <span style="font-family:var(--font-mono);color:${fyPL >= 0 ? 'var(--success)' : 'var(--danger)'}">${Helpers.currency(fyPL)} ${fyPL >= 0 ? 'Profit' : 'Loss'}</span>
          </h4>
          ${Helpers.buildTable(['Event','Date','Total','Present','Paid','Unpaid','Free','Collected','Bus Cost','P/L'],
            evts.map(e => ({ cells: [
              Helpers.escapeHtml(e.name),
              Helpers.formatDate(e.date) || '-',
              e.participantCount, e.presentCount,
              e.paidCount, e.unpaidCount, e.freeCount,
              Helpers.currency(e.totalCollected),
              Helpers.currency(e.busCost),
              `<span style="color:${e.profitLoss >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:600">${Helpers.currency(e.profitLoss)}</span>`
            ] })),
            { cls: 'report-table' })}
        </div>`;
      }
      el.innerHTML = html + '</div>';
    } catch (err) { el.innerHTML = `<p style="color:var(--danger);padding:2rem">Error: ${err.message}</p>`; }
  }

  // ===== SETTINGS — menu only, each option opens a modal =====
  function _toggleSetupPanel(contentId, chevId) {
    const body = document.getElementById(contentId);
    const chev = document.getElementById(chevId);
    if (!body) return;
    const opening = body.classList.contains('hidden');
    body.classList.toggle('hidden', !opening);
    if (chev) chev.classList.toggle('open', opening);
  }

  async function initSettings() {
    await Promise.all([
      _renderSetupEvent(),
      _renderSetupAreas(),
      _renderSetupTeam(),
      _renderSetupDanger()
    ]);
  }

  // ── Setup: Event section ──────────────────────────────────────────────────
  async function _renderSetupEvent() {
    const el = document.getElementById('setup-event-content');
    if (!el) return;
    const evt = await DB.getEvent(DB.getCurrentEvent());
    const isCurrent = !!evt?.isCurrentEvent;
    const esc = Helpers.escapeHtml;
    el.innerHTML = `
      <div class="setup-field-row col2">
        <div>
          <div class="setup-label">Event Name</div>
          <input id="se-name" class="wi-input" style="width:100%" value="${esc(evt?.name || '')}" placeholder="e.g. Prerna 2025" />
        </div>
        <div>
          <div class="setup-label">Event Date</div>
          <input id="se-date" type="date" class="wi-input" style="width:100%" value="${evt?.date || ''}" />
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.65rem;margin-top:.35rem">
        <label style="display:flex;align-items:center;gap:.45rem;cursor:pointer;font-size:.87rem;font-weight:500;color:${isCurrent ? 'var(--accent)' : 'var(--text-secondary)'}">
          <input type="checkbox" id="se-current" ${isCurrent ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)" />
          &#11088; Mark as Current Event
        </label>
        <button class="btn-primary" onclick="App._saveSetupEvent()">Save</button>
      </div>`;
  }

  async function _saveSetupEvent() {
    const name   = document.getElementById('se-name')?.value.trim();
    const date   = document.getElementById('se-date')?.value;
    const isCurr = document.getElementById('se-current')?.checked || false;
    const eid    = DB.getCurrentEvent();
    if (!name) { Helpers.toast('Event name is required', 'error'); return; }
    if (isCurr) {
      try {
        const allEvts = await DB.getEvents();
        await Promise.all(allEvts.filter(e => e.id !== eid && e.isCurrentEvent).map(e => DB.updateEvent(e.id, { isCurrentEvent: false })));
      } catch {}
    }
    await DB.updateEvent(eid, { name, date, financialYear: date ? Helpers.getFinancialYear(date) : '', isCurrentEvent: isCurr });
    await DB.setConfig('eventName', name);
    await DB.setConfig('eventDate', date);
    await loadEventSelector();
    Helpers.toast('Event saved' + (isCurr ? ' · marked as current' : ''), 'success');
  }

  // ── Setup: Areas & Buses section ─────────────────────────────────────────
  async function _renderSetupAreas() {
    const el = document.getElementById('setup-areas-content');
    if (!el) return;
    const esc = Helpers.escapeHtml;
    const [areas, buses] = await Promise.all([
      _loadAreas().catch(() => []),
      DB.getAll(DB.STORES.buses).catch(() => [])
    ]);

    const totalReg     = allAttendees.length;
    const totalPresent = allAttendees.filter(a => a.attendance === 'present').length;

    const summaryBar = `
      <div class="setup-summary-row">
        <span class="setup-stat-chip sc-green">&#128205; ${areas.length} area${areas.length !== 1 ? 's' : ''}</span>
        <span class="setup-stat-chip sc-blue">&#128652; ${buses.length} bus${buses.length !== 1 ? 'es' : ''}</span>
        <span class="setup-stat-chip sc-purple">&#128101; ${totalReg} registered</span>
        ${totalPresent > 0 ? `<span class="setup-stat-chip sc-orange">&#9989; ${totalPresent} present</span>` : ''}
      </div>`;

    const areaCards = areas.map(area => {
      const aReg      = allAttendees.filter(a => normBus(a.area) === normBus(area.name));
      const aPresent  = aReg.filter(a => a.attendance === 'present').length;
      const areaBuses = buses.filter(b => normBus(b.area) === normBus(area.name));
      // Bus cost comes from actual buses added, not a manual bus-count field
      const actualBusCost = areaBuses.length * (area.perBusCost || 0);

      const busRows = areaBuses.map(b => {
        const onBus = allAttendees.filter(a => a.attendance === 'present' && normBus(a.boardedBus) === normBus(b.name)).length;
        const cap   = parseInt(b.capacity) || 0;
        const pct   = cap ? onBus / cap : 0;
        const badgeCls = !cap ? 'bok' : pct >= 1 ? 'bfull' : pct >= 0.8 ? 'bnear' : 'bok';
        return `<div class="setup-bus-row">
          <span style="font-size:1rem">&#128652;</span>
          <span style="flex:1;font-weight:600;font-size:.85rem">${esc(b.name)}</span>
          ${b.coordinator ? `<span style="font-size:.74rem;color:var(--text-muted);background:#f1f5f9;padding:.1rem .4rem;border-radius:4px">&#128100; ${esc(b.coordinator)}</span>` : ''}
          <span class="bus-occ-badge ${badgeCls}">${onBus}${cap > 0 ? '/' + cap : ''} boarded</span>
          <button data-bid="${esc(b.id)}" onclick="App._setupBusEdit(this.dataset.bid)" class="icon-btn edit" title="Edit bus">&#9998;</button>
          <button data-bid="${esc(b.id)}" onclick="App._setupBusDelete(this.dataset.bid)" class="icon-btn danger" title="Remove bus">&#10005;</button>
        </div>`;
      }).join('');

      const addBusFormId = 'sabf-' + area.id;
      return `
        <div class="setup-area-card">
          <div class="setup-area-header" onclick="App._toggleAreaCard('${esc(area.id)}')">
            <span style="font-size:1.05rem">&#128205;</span>
            <span style="flex:1;font-weight:700;font-size:.95rem;color:var(--text-primary)">${esc(area.name)}</span>
            <span style="font-size:.73rem;color:#15803d;background:#dcfce7;padding:.15rem .5rem;border-radius:10px;font-weight:600;white-space:nowrap">${aReg.length} reg &middot; ${aPresent} present</span>
            <button data-aid="${esc(area.id)}" onclick="event.stopPropagation();App._setupAreaEdit(this.dataset.aid)" class="icon-btn edit" title="Edit area">&#9998;</button>
            <button data-aid="${esc(area.id)}" onclick="event.stopPropagation();App._setupAreaDelete(this.dataset.aid)" class="icon-btn danger" title="Delete area">&#10005;</button>
            <span id="sac-chev-${esc(area.id)}" class="setup-area-chev">&#9660;</span>
          </div>
          <div class="setup-area-meta">
            ${area.coordinator ? `<span>&#128100; <b>${esc(area.coordinator)}</b></span>` : ''}
            <span>&#128652; ${areaBuses.length} bus${areaBuses.length !== 1 ? 'es' : ''}</span>
            ${area.perPersonCharge ? `<span>&#8377;${area.perPersonCharge}/person</span>` : ''}
            ${area.perBusCost ? `<span>&#8377;${(area.perBusCost).toLocaleString('en-IN')}/bus &rarr; <b style="color:var(--text-primary)">&#8377;${actualBusCost.toLocaleString('en-IN')} total</b></span>` : ''}
          </div>
          <div id="sac-body-${esc(area.id)}" class="setup-area-body hidden">
            <div>${areaBuses.length ? busRows : '<div style="padding:.5rem .85rem;font-size:.82rem;color:var(--text-muted);font-style:italic">No buses yet — add one below</div>'}</div>
            <div id="${addBusFormId}" style="display:none;padding:.6rem .85rem;border-top:1px solid var(--border);background:#f8fafc">
              <div style="font-size:.73rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.4rem">Add Bus to ${esc(area.name)}</div>
              <div style="display:grid;grid-template-columns:1fr 1fr 70px auto;gap:.4rem;align-items:end">
                <div><div class="setup-label">Bus Name</div><input id="sabn-${esc(area.id)}" class="wi-input" style="width:100%" placeholder="e.g. RJ-01" /></div>
                <div><div class="setup-label">Coordinator</div><input id="sabc-${esc(area.id)}" class="wi-input" style="width:100%" placeholder="Name" /></div>
                <div><div class="setup-label">Seats</div><input id="sabcap-${esc(area.id)}" type="number" class="wi-input" style="width:100%" placeholder="45" /></div>
                <div style="display:flex;gap:.3rem;padding-bottom:.02rem">
                  <button class="btn-primary" style="font-size:.8rem;padding:.42rem .55rem" data-aid="${esc(area.id)}" data-aname="${esc(area.name)}" onclick="App._setupBusSave(this.dataset.aid,this.dataset.aname)">Add</button>
                  <button class="btn-ghost" style="font-size:.8rem;padding:.42rem .45rem" onclick="document.getElementById('${addBusFormId}').style.display='none'">&#10005;</button>
                </div>
              </div>
            </div>
            <div style="padding:.4rem .85rem;border-top:1px solid #f1f5f9">
              <button onclick="document.getElementById('${addBusFormId}').style.display='';document.getElementById('sabn-${esc(area.id)}').focus()"
                style="width:100%;background:none;border:1px dashed #a7f3d0;border-radius:7px;padding:.35rem;font-size:.81rem;color:var(--accent);cursor:pointer;font-weight:600"
                onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='none'">
                + Add Bus to ${esc(area.name)}
              </button>
            </div>
          </div>
        </div>`;
    }).join('') || `<div style="text-align:center;padding:1.5rem;font-size:.88rem;color:var(--text-muted);background:#f8fafc;border-radius:10px;margin-bottom:.75rem;border:1px dashed var(--border)">No areas yet — add one below ↓</div>`;

    el.innerHTML = `${summaryBar}<div id="setup-area-list">${areaCards}</div>
      <button class="btn-secondary" style="width:100%;margin-top:.25rem" onclick="App._openAddAreaModal()">&#43; Add Area</button>`;

    // wire interactive handlers into App.* so onclick= can find them
    App._toggleAreaCard = (areaId) => {
      const body = document.getElementById('sac-body-' + areaId);
      const chev = document.getElementById('sac-chev-' + areaId);
      if (!body) return;
      const opening = body.classList.contains('hidden');
      body.classList.toggle('hidden', !opening);
      if (chev) chev.classList.toggle('open', opening);
    };

    App._openAddAreaModal = () => {
      Helpers.modal(`
        <h3 class="modal-title">&#43; Add Area</h3>
        <div style="display:flex;flex-direction:column;gap:.6rem;margin-bottom:.85rem">
          <div><div class="setup-label">Area Name *</div><input id="sana-name" class="wi-input" style="width:100%" placeholder="e.g. Rajkot North" /></div>
          <div><div class="setup-label">Area Coordinator</div><input id="sana-coord" class="wi-input" style="width:100%" placeholder="In-charge name" /></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem">
            <div><div class="setup-label">&#8377;/Person</div><input id="sana-charge" type="number" class="wi-input" style="width:100%" placeholder="0" /></div>
            <div><div class="setup-label">&#8377;/Bus Cost</div><input id="sana-buscost" type="number" class="wi-input" style="width:100%" placeholder="0" /></div>
          </div>
          <div style="font-size:.76rem;color:var(--text-muted)">Bus cost is auto-calculated from buses you add to this area.</div>
        </div>
        <div class="modal-actions">
          <button class="btn-primary" onclick="App._setupAreaSave()">Add Area</button>
          <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
        </div>`);
      setTimeout(() => document.getElementById('sana-name')?.focus(), 80);
    };

    App._setupAreaSave = async () => {
      const name = document.getElementById('sana-name')?.value.trim();
      if (!name) { Helpers.toast('Area name required', 'error'); return; }
      const fresh = await _loadAreas().catch(() => []);
      if (fresh.find(a => normBus(a.name) === normBus(name))) { Helpers.toast('Area already exists', 'warning'); return; }
      fresh.push({
        id: 'a' + Date.now(), name,
        coordinator:     document.getElementById('sana-coord')?.value.trim() || '',
        perPersonCharge: parseFloat(document.getElementById('sana-charge')?.value) || 0,
        perBusCost:      parseFloat(document.getElementById('sana-buscost')?.value) || 0
      });
      await _saveAreas(fresh);
      Helpers.closeModal();
      Helpers.toast(`${name} added`, 'success');
      await _renderSetupAreas();
    };

    App._setupAreaDelete = (areaId) => {
      const area = areas.find(a => a.id === areaId);
      if (!area) return;
      Helpers.modal(`
        <h3 class="modal-title" style="color:var(--danger)">Delete Area?</h3>
        <p style="color:var(--text-secondary);margin-bottom:.75rem">Delete <b>${esc(area.name)}</b>? Its buses become unassigned.</p>
        <div class="modal-actions">
          <button class="btn-danger" onclick="App._setupAreaConfirmDelete('${esc(areaId)}')">Delete</button>
          <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
        </div>`);
    };

    App._setupAreaConfirmDelete = async (areaId) => {
      const fresh     = await _loadAreas().catch(() => []);
      const area      = fresh.find(a => a.id === areaId);
      const areaBuses = (await DB.getAll(DB.STORES.buses).catch(() => [])).filter(b => normBus(b.area) === normBus(area?.name || ''));
      for (const b of areaBuses) await DB.put(DB.STORES.buses, { id: b.id, area: '' }).catch(() => {});
      await _saveAreas(fresh.filter(a => a.id !== areaId));
      Helpers.closeModal();
      Helpers.toast('Area deleted', 'success');
      await _renderSetupAreas();
    };

    App._setupAreaEdit = (areaId) => {
      const area = areas.find(a => a.id === areaId);
      if (!area) return;
      Helpers.modal(`
        <h3 class="modal-title">&#9998; Edit — ${esc(area.name)}</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem">
          <div><div class="setup-label">Area Name</div><input id="sae-name" class="wi-input" style="width:100%" value="${esc(area.name)}" /></div>
          <div><div class="setup-label">Coordinator</div><input id="sae-coord" class="wi-input" style="width:100%" value="${esc(area.coordinator || '')}" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.85rem">
          <div><div class="setup-label">&#8377;/Person</div><input id="sae-charge" type="number" class="wi-input" style="width:100%" value="${area.perPersonCharge || 0}" /></div>
          <div><div class="setup-label">&#8377;/Bus Cost</div><input id="sae-buscost" type="number" class="wi-input" style="width:100%" value="${area.perBusCost || 0}" /></div>
        </div>
        <div class="modal-actions">
          <button class="btn-primary" onclick="App._setupAreaUpdate('${esc(areaId)}')">Save</button>
          <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
        </div>`);
    };

    App._setupAreaUpdate = async (areaId) => {
      const fresh = await _loadAreas().catch(() => []);
      const idx   = fresh.findIndex(a => a.id === areaId);
      if (idx < 0) return;
      fresh[idx] = { ...fresh[idx],
        name:            document.getElementById('sae-name')?.value.trim() || fresh[idx].name,
        coordinator:     document.getElementById('sae-coord')?.value.trim() || '',
        perPersonCharge: parseFloat(document.getElementById('sae-charge')?.value) || 0,
        perBusCost:      parseFloat(document.getElementById('sae-buscost')?.value) || 0
      };
      await _saveAreas(fresh);
      Helpers.closeModal();
      Helpers.toast('Area updated', 'success');
      await _renderSetupAreas();
    };

    App._setupBusSave = async (areaId, areaName) => {
      const name  = document.getElementById(`sabn-${areaId}`)?.value.trim();
      const coord = document.getElementById(`sabc-${areaId}`)?.value.trim() || '';
      const cap   = parseInt(document.getElementById(`sabcap-${areaId}`)?.value) || 0;
      if (!name) { Helpers.toast('Bus name required', 'error'); return; }
      await DB.add(DB.STORES.buses, { name, coordinator: coord, area: areaName, capacity: cap });
      Helpers.toast(`${name} added`, 'success');
      await _renderSetupAreas();
    };

    App._setupBusEdit = (busId) => {
      const bus = buses.find(b => b.id === busId);
      if (!bus) return;
      Helpers.modal(`
        <h3 class="modal-title">&#9998; Edit Bus</h3>
        <div style="display:flex;flex-direction:column;gap:.65rem;margin-bottom:.85rem">
          <div><div class="setup-label">Bus Name *</div><input id="sbe-name" class="wi-input" style="width:100%" value="${esc(bus.name)}" /></div>
          <div><div class="setup-label">Coordinator</div><input id="sbe-coord" class="wi-input" style="width:100%" value="${esc(bus.coordinator || '')}" placeholder="In-charge name" /></div>
          <div><div class="setup-label">Seat Capacity</div><input id="sbe-cap" type="number" class="wi-input" style="width:100%" value="${bus.capacity || ''}" placeholder="e.g. 45" /></div>
        </div>
        <div class="modal-actions">
          <button class="btn-primary" onclick="App._setupBusUpdate('${esc(busId)}')">Save Changes</button>
          <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
        </div>`);
    };

    App._setupBusUpdate = async (busId) => {
      const name  = document.getElementById('sbe-name')?.value.trim();
      const coord = document.getElementById('sbe-coord')?.value.trim() || '';
      const cap   = parseInt(document.getElementById('sbe-cap')?.value) || 0;
      if (!name) { Helpers.toast('Bus name required', 'error'); return; }
      const existing = buses.find(b => b.id === busId);
      await DB.put(DB.STORES.buses, { ...existing, name, coordinator: coord, capacity: cap });
      Helpers.closeModal();
      Helpers.toast('Bus updated', 'success');
      await _renderSetupAreas();
    };

    App._setupBusDelete = async (busId) => {
      await DB.deleteRecord(DB.STORES.buses, busId).catch(() => {});
      Helpers.toast('Bus removed', 'success');
      await _renderSetupAreas();
    };
  }

  // ── Setup: Team & Access section ──────────────────────────────────────────
  async function _renderSetupTeam() {
    const el = document.getElementById('setup-team-content');
    if (!el) return;
    el.innerHTML = `<div id="users-list" style="margin-bottom:.65rem"></div>
      <button class="btn-secondary" onclick="App.showAddUserModal()">+ Invite User</button>`;
    await renderUsers();
  }

  // ── Setup: Danger Zone section ────────────────────────────────────────────
  async function _renderSetupDanger() {
    const el = document.getElementById('setup-danger-content');
    if (!el) return;
    el.innerHTML = `
      <p style="font-size:.82rem;color:var(--text-muted);margin-bottom:.75rem">These actions cannot be undone. Proceed with caution.</p>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap">
        <button class="btn-danger" onclick="App._setupClearData()" style="font-size:.85rem">Clear Participant Data</button>
        <button class="btn-danger" onclick="App._setupDeleteEvent()" style="font-size:.85rem">Delete This Event</button>
      </div>`;

    App._setupClearData = () => openDangerZoneModal();
    App._setupDeleteEvent = () => {
      const esc = Helpers.escapeHtml;
      Helpers.modal(`
        <h3 class="modal-title" style="color:var(--danger)">Delete Event?</h3>
        <p style="color:var(--text-secondary);margin-bottom:.75rem">Permanently deletes this event and all its data. Cannot be undone.</p>
        <p style="color:var(--text-secondary);margin-bottom:.5rem">Type <b>DELETE</b> to confirm:</p>
        <input type="text" id="sdel-confirm" class="wi-input" placeholder="DELETE" style="width:100%;margin-bottom:1rem" autofocus />
        <div class="modal-actions">
          <button class="btn-danger" id="sdel-btn">Delete Event</button>
          <button class="btn-ghost" onclick="Helpers.closeModal()">Cancel</button>
        </div>`);
      document.getElementById('sdel-btn').onclick = async () => {
        if ((document.getElementById('sdel-confirm')?.value || '').trim() !== 'DELETE') { Helpers.toast('Type DELETE exactly', 'error'); return; }
        const btn = document.getElementById('sdel-btn');
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

  async function openEventConfigModal() {
    const evt = await DB.getEvent(DB.getCurrentEvent());
    const isCurrent = !!evt?.isCurrentEvent;
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
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:.75rem">
        <div>
          <label class="settings-label">Charge Per Person (&#8377;)</label>
          <input type="number" id="m-cfg-charge" class="wi-input" value="${evt?.chargePerPerson || 0}" min="0" style="width:100%" />
        </div>
        <div>
          <label class="settings-label">Other Expense Budget (&#8377;)</label>
          <input type="number" id="m-cfg-expense" class="wi-input" value="${evt?.totalExpense || 0}" min="0" style="width:100%" />
        </div>
      </div>
      <label style="display:flex;align-items:center;gap:.6rem;padding:.7rem;border-radius:8px;border:1px solid ${isCurrent ? 'var(--accent)' : 'var(--border)'};background:${isCurrent ? '#f0fdf4' : 'transparent'};cursor:pointer;margin-bottom:1.1rem;font-size:.9rem;font-weight:500">
        <input type="checkbox" id="m-cfg-current" ${isCurrent ? 'checked' : ''} style="width:18px;height:18px;accent-color:var(--accent)" />
        <span>&#11088; Mark as Current Event</span>
        <span style="margin-left:auto;font-size:.77rem;color:var(--text-muted);font-weight:400">Volunteers auto-switch to this event on login</span>
      </label>
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
    const name          = document.getElementById('m-cfg-name').value;
    const date          = document.getElementById('m-cfg-date').value;
    const charge        = parseFloat(document.getElementById('m-cfg-charge').value) || 0;
    const expense       = parseFloat(document.getElementById('m-cfg-expense').value) || 0;
    const markCurrent   = document.getElementById('m-cfg-current')?.checked || false;
    const eid           = DB.getCurrentEvent();

    // If marking as current, clear the flag from all other events first
    if (markCurrent) {
      try {
        const allEvts = await DB.getEvents();
        const others = allEvts.filter(e => e.id !== eid && e.isCurrentEvent);
        await Promise.all(others.map(e => DB.updateEvent(e.id, { isCurrentEvent: false })));
      } catch {}
    }

    await DB.updateEvent(eid, {
      name, date, chargePerPerson: charge, totalExpense: expense,
      financialYear: date ? Helpers.getFinancialYear(date) : '',
      isCurrentEvent: markCurrent
    });
    await DB.setConfig('eventName', name);
    await DB.setConfig('eventDate', date);
    await DB.setConfig('chargePerPerson', charge);
    await loadEventSelector();
    Helpers.closeModal();
    Helpers.toast('Event saved!' + (markCurrent ? ' Marked as current event.' : ''), 'success');
  }

  async function openAreasTransportModal() {
    const esc = Helpers.escapeHtml;
    const [areas, buses] = await Promise.all([
      _loadAreas(),
      DB.getAll(DB.STORES.buses).catch(() => [])
    ]);

    const _render = () => {
      // ── Overall summary ──
      const totalReg     = allAttendees.length;
      const totalPresent = allAttendees.filter(a => a.attendance === 'present').length;
      const totalCollect = allAttendees.reduce((s, a) => s + (parseFloat(a.paymentAmount) || 0), 0);
      const summaryBar = `
        <div style="display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;padding:.55rem .75rem;background:var(--accent);color:#fff;border-radius:8px;font-size:.82rem;margin-bottom:1rem">
          <span><b>${areas.length}</b> areas</span>
          <span><b>${buses.length}</b> buses</span>
          <span><b>${totalReg}</b> registered</span>
          <span><b>${totalPresent}</b> present</span>
          <span>Collected: <b>&#8377;${totalCollect.toLocaleString('en-IN')}</b></span>
        </div>`;

      // ── Per-area cards ──
      const areaCards = areas.map(area => {
        const aReg       = allAttendees.filter(a => normBus(a.area) === normBus(area.name));
        const aPresent   = aReg.filter(a => a.attendance === 'present').length;
        const aCollected = aReg.reduce((s, a) => s + (parseFloat(a.paymentAmount) || 0), 0);
        const aExpected  = aReg.length * (area.perPersonCharge || 0);
        const busCost    = (area.busCount || 0) * (area.perBusCost || 0);
        const areaBuses  = buses.filter(b => normBus(b.area) === normBus(area.name));

        const busRows = areaBuses.map(b => {
          const onBus = allAttendees.filter(a => a.attendance === 'present' && normBus(a.boardedBus) === normBus(b.name)).length;
          const cap   = b.capacity || 0;
          const pct   = cap > 0 ? Math.min(100, Math.round(onBus / cap * 100)) : 0;
          const bar   = cap > 0
            ? `<div style="width:70px;height:5px;background:#e2e8f0;border-radius:3px;overflow:hidden;display:inline-block;vertical-align:middle;margin-right:.3rem"><div style="height:100%;width:${pct}%;background:var(--accent)"></div></div>`
            : '';
          return `
            <div style="display:flex;align-items:center;gap:.5rem;padding:.38rem .6rem;border-top:1px solid var(--border);font-size:.83rem">
              <span>&#128652;</span>
              <span style="flex:1;font-weight:500">${esc(b.name)}</span>
              <span style="color:var(--text-muted);font-size:.78rem">${esc(b.coordinator || '')}</span>
              <span style="white-space:nowrap">${bar}<b>${onBus}</b>${cap > 0 ? '/' + cap : ''} boarded</span>
              <button data-bid="${esc(b.id)}" onclick="App._atBusDelete(this.dataset.bid)" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:.9rem;line-height:1;padding:.1rem .25rem" title="Remove">&#10005;</button>
            </div>`;
        }).join('');

        return `
          <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;margin-bottom:.85rem">
            <div style="background:var(--bg-card2);padding:.55rem .7rem;display:flex;align-items:center;gap:.5rem">
              <span>&#128205;</span>
              <span style="flex:1;font-weight:700;font-size:.95rem">${esc(area.name)}</span>
              <span style="font-size:.78rem;color:var(--text-muted)">${aReg.length} reg &middot; ${aPresent} present</span>
              <button data-aid="${esc(area.id)}" onclick="App._atAreaEdit(this.dataset.aid)" style="background:none;border:none;cursor:pointer;font-size:.82rem;padding:.2rem .35rem;color:var(--text-secondary)" title="Edit">&#9998;</button>
              <button data-aid="${esc(area.id)}" onclick="App._atAreaDelete(this.dataset.aid)" style="background:none;border:none;cursor:pointer;font-size:.82rem;padding:.2rem .35rem;color:var(--danger)" title="Delete">&#10005;</button>
            </div>
            <div style="padding:.35rem .7rem;display:flex;flex-wrap:wrap;gap:.6rem 1rem;font-size:.79rem;background:#f8fafc;border-bottom:1px solid var(--border)">
              <span>&#8377;${area.perPersonCharge || 0}/person</span>
              <span>${area.busCount || 0} bus${area.busCount !== 1 ? 'es' : ''} &times; &#8377;${(area.perBusCost || 0).toLocaleString('en-IN')} = <b>&#8377;${busCost.toLocaleString('en-IN')} cost</b></span>
              <span style="color:#15803d">Collected: <b>&#8377;${aCollected.toLocaleString('en-IN')}</b></span>
              <span style="color:#1d4ed8">Expected: <b>&#8377;${aExpected.toLocaleString('en-IN')}</b></span>
            </div>
            <div>${areaBuses.length ? busRows : '<div style="padding:.5rem .7rem;font-size:.82rem;color:var(--text-muted)">No buses added yet</div>'}</div>
            <div id="atbf-${esc(area.id)}" style="display:none;padding:.5rem .65rem;border-top:1px solid var(--border);background:var(--bg-card2)">
              <div style="display:grid;grid-template-columns:1fr 1fr 80px auto;gap:.4rem;align-items:end">
                <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.2rem">Bus Name</div><input id="atbn-${esc(area.id)}" class="wi-input" style="width:100%" placeholder="e.g. Bus RJ-01" /></div>
                <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.2rem">Coordinator</div><input id="atbc-${esc(area.id)}" class="wi-input" style="width:100%" placeholder="Name" /></div>
                <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.2rem">Seats</div><input id="atbcap-${esc(area.id)}" type="number" class="wi-input" style="width:100%" placeholder="45" /></div>
                <div style="display:flex;gap:.3rem;padding-bottom:.02rem">
                  <button class="btn-primary" style="font-size:.8rem;padding:.42rem .6rem;white-space:nowrap" data-aid="${esc(area.id)}" data-aname="${esc(area.name)}" onclick="App._atBusSave(this.dataset.aid,this.dataset.aname)">Save</button>
                  <button class="btn-ghost" style="font-size:.8rem;padding:.42rem .5rem" onclick="document.getElementById('atbf-${esc(area.id)}').style.display='none'">&#10005;</button>
                </div>
              </div>
            </div>
            <div style="padding:.38rem .65rem;border-top:1px solid var(--border)">
              <button onclick="document.getElementById('atbf-${esc(area.id)}').style.display='';document.getElementById('atbn-${esc(area.id)}').focus()"
                style="width:100%;background:none;border:1px dashed var(--border);border-radius:6px;padding:.32rem;font-size:.82rem;color:var(--accent);cursor:pointer">
                + Add Bus to ${esc(area.name)}
              </button>
            </div>
          </div>`;
      }).join('') || `<p style="color:var(--text-muted);text-align:center;padding:1rem 0">No areas yet. Add one below.</p>`;

      // ── Add area form ──
      const addForm = `
        <div style="border:1px dashed var(--border);border-radius:10px;padding:.85rem;margin-top:.25rem">
          <div style="font-size:.88rem;font-weight:700;margin-bottom:.6rem;color:var(--text-secondary)">+ Add New Area</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:.45rem;margin-bottom:.45rem">
            <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.18rem">Area Name *</div><input id="atna-name" class="wi-input" style="width:100%" placeholder="e.g. Rajkot North" /></div>
            <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.18rem">Area Coordinator</div><input id="atna-coord" class="wi-input" style="width:100%" placeholder="In-charge name" /></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.45rem;margin-bottom:.45rem">
            <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.18rem">&#8377; Per Person</div><input id="atna-charge" type="number" class="wi-input" style="width:100%" placeholder="0" oninput="App._atCalcTotal()" /></div>
            <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.18rem">No. of Buses</div><input id="atna-buses" type="number" class="wi-input" style="width:100%" placeholder="0" oninput="App._atCalcTotal()" /></div>
            <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.18rem">&#8377; Per Bus Cost</div><input id="atna-buscost" type="number" class="wi-input" style="width:100%" placeholder="0" oninput="App._atCalcTotal()" /></div>
          </div>
          <div id="atna-calc" style="font-size:.8rem;color:var(--text-muted);margin-bottom:.55rem">Total bus cost: &#8377;0</div>
          <button class="btn-primary" onclick="App._atAreaSave()">Add Area</button>
        </div>`;

      return `<h3 class="modal-title">&#127758; Areas &amp; Transport</h3>${summaryBar}<div id="at-area-list">${areaCards}</div>${addForm}`;
    };

    const _openModal = () => {
      Helpers.modal(_render());
      document.getElementById('modal-content').style.maxWidth = '680px';
      document.getElementById('atna-name').onkeydown = e => { if (e.key === 'Enter') App._atAreaSave(); };
    };
    _openModal();

    App._atCalcTotal = () => {
      const b = parseInt(document.getElementById('atna-buses')?.value) || 0;
      const c = parseFloat(document.getElementById('atna-buscost')?.value) || 0;
      const el = document.getElementById('atna-calc');
      if (el) el.textContent = `Total bus cost: ₹${(b * c).toLocaleString('en-IN')}`;
    };

    App._atAreaSave = async () => {
      const name = document.getElementById('atna-name')?.value.trim();
      if (!name) { Helpers.toast('Area name is required', 'error'); return; }
      if (areas.find(a => normBus(a.name) === normBus(name))) { Helpers.toast('Area already exists', 'warning'); return; }
      areas.push({
        id: 'a' + Date.now(),
        name,
        coordinator:      document.getElementById('atna-coord')?.value.trim() || '',
        perPersonCharge:  parseFloat(document.getElementById('atna-charge')?.value) || 0,
        busCount:         parseInt(document.getElementById('atna-buses')?.value) || 0,
        perBusCost:       parseFloat(document.getElementById('atna-buscost')?.value) || 0
      });
      await _saveAreas(areas);
      Helpers.toast(`${name} added`, 'success');
      _openModal();
    };

    App._atAreaEdit = async (areaId) => {
      const area = areas.find(a => a.id === areaId);
      if (!area) return;
      Helpers.modal(`
        <h3 class="modal-title">&#9998; Edit — ${esc(area.name)}</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem;margin-bottom:.5rem">
          <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.18rem">Area Name</div><input id="atea-name" class="wi-input" style="width:100%" value="${esc(area.name)}" /></div>
          <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.18rem">Coordinator</div><input id="atea-coord" class="wi-input" style="width:100%" value="${esc(area.coordinator || '')}" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:.5rem;margin-bottom:.85rem">
          <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.18rem">&#8377;/Person</div><input id="atea-charge" type="number" class="wi-input" style="width:100%" value="${area.perPersonCharge || 0}" /></div>
          <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.18rem">No. of Buses</div><input id="atea-buses" type="number" class="wi-input" style="width:100%" value="${area.busCount || 0}" /></div>
          <div><div style="font-size:.72rem;color:var(--text-muted);margin-bottom:.18rem">&#8377;/Bus Cost</div><input id="atea-buscost" type="number" class="wi-input" style="width:100%" value="${area.perBusCost || 0}" /></div>
        </div>
        <div class="modal-actions">
          <button class="btn-primary" onclick="App._atAreaUpdate('${esc(areaId)}')">Save</button>
          <button class="btn-ghost" onclick="App.openAreasTransportModal()">Back</button>
        </div>`);
      document.getElementById('modal-content').style.maxWidth = '680px';
    };

    App._atAreaUpdate = async (areaId) => {
      const idx = areas.findIndex(a => a.id === areaId);
      if (idx < 0) return;
      areas[idx] = {
        ...areas[idx],
        name:            document.getElementById('atea-name')?.value.trim() || areas[idx].name,
        coordinator:     document.getElementById('atea-coord')?.value.trim() || '',
        perPersonCharge: parseFloat(document.getElementById('atea-charge')?.value) || 0,
        busCount:        parseInt(document.getElementById('atea-buses')?.value) || 0,
        perBusCost:      parseFloat(document.getElementById('atea-buscost')?.value) || 0
      };
      await _saveAreas(areas);
      Helpers.toast('Area updated', 'success');
      await openAreasTransportModal();
    };

    App._atAreaDelete = (areaId) => {
      const area = areas.find(a => a.id === areaId);
      if (!area) return;
      Helpers.modal(`
        <h3 class="modal-title" style="color:var(--danger)">Delete Area?</h3>
        <p style="color:var(--text-secondary);margin-bottom:.75rem">Delete <b>${esc(area.name)}</b>? Buses in this area will become unassigned.</p>
        <div class="modal-actions">
          <button class="btn-danger" onclick="App._atAreaConfirmDelete('${esc(areaId)}')">Delete</button>
          <button class="btn-ghost" onclick="App.openAreasTransportModal()">Cancel</button>
        </div>`);
    };

    App._atAreaConfirmDelete = async (areaId) => {
      const area = areas.find(a => a.id === areaId);
      const areaBuses = buses.filter(b => normBus(b.area) === normBus(area?.name || ''));
      for (const b of areaBuses) {
        await DB.put(DB.STORES.buses, { id: b.id, area: '' }).catch(() => {});
      }
      areas.splice(areas.findIndex(a => a.id === areaId), 1);
      await _saveAreas(areas);
      Helpers.toast('Area deleted', 'success');
      await openAreasTransportModal();
    };

    App._atBusSave = async (areaId, areaName) => {
      const name  = document.getElementById(`atbn-${areaId}`)?.value.trim();
      const coord = document.getElementById(`atbc-${areaId}`)?.value.trim() || '';
      const cap   = parseInt(document.getElementById(`atbcap-${areaId}`)?.value) || 0;
      if (!name) { Helpers.toast('Bus name required', 'error'); return; }
      await DB.add(DB.STORES.buses, { name, coordinator: coord, area: areaName, capacity: cap });
      Helpers.toast(`${name} added to ${areaName}`, 'success');
      const newBuses = await DB.getAll(DB.STORES.buses).catch(() => []);
      buses.length = 0; buses.push(...newBuses);
      _openModal();
    };

    App._atBusDelete = async (busId) => {
      await DB.deleteRecord(DB.STORES.buses, busId).catch(() => {});
      Helpers.toast('Bus removed', 'success');
      const newBuses = await DB.getAll(DB.STORES.buses).catch(() => []);
      buses.length = 0; buses.push(...newBuses);
      _openModal();
    };
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
      const avEl = document.getElementById('topbar-user-avatar');
      if (avEl) avEl.textContent = name[0].toUpperCase();
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
    _dashStaticCache = null;
    await renderBusManageList();
    if (currentPage === 'dashboard') initDashboard();
    if (currentPage === 'attendance') initMyBusPicker();
  }

  async function deleteBus(id) {
    await DB.deleteRecord(DB.STORES.buses, id);
    _dashStaticCache = null;
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
    if (!el) return;
    el.textContent = navigator.onLine ? '●' : '○';
    el.title = navigator.onLine ? 'Online' : 'Offline';
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

    const myBusOcr = getMyBus();
    let count = 0;
    for (const id of ids) {
      const a = allAttendees.find(x => x.id === id);
      if (!a || a.attendance === 'present') continue;
      a.attendance = 'present';
      a.entryTime  = new Date().toISOString();
      a.markedBy   = currentUser?.name || 'Unknown';
      if (myBusOcr) a.boardedBus = myBusOcr;
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
    init, navigate, switchTab,
    downloadTemplate,
    instantAdmit, submitPaymentCollect, unmarkAttendance, showDetail, showPaymentUpdate, savePaymentUpdate,
    resolveDuplicate, acceptDuplicate, deleteDuplicate,
    saveBusRoute, deleteBusRoute, toggleUserRole,
    showAddBusModal, deleteBusRouteFromDash,
    showEventPicker, _filterEvents, _pickEvent, showSessionSetupModal,
    _ssPickFY, _ssPickEvent, _ssConfirmEvent, _ssPickArea, _ssConfirmArea, _ssOnEventChange, _ssAreaSelected,
    _ssPickBus, _ssConfirmBus, _ssSkipBus,
    _gatePickBusAndAdmit, _gateConfirmBusAndAdmit,
    _gateBusPick,
    initMyBus, _toggleBusTable, _myBusFilterArea, _repairBrokenArea,
    _selectMyBus, _saveBusCoordHead,
    openBusManageModal, saveBus, deleteBus,
    showCreateEventModal, createEvent,
    showCountList, showFullReport, shareRegReportAsImage, _toggleSetupPanel,
    initAttendees,
    // Settings inline sections
    _saveSetupEvent,
    // Settings modals (kept for back-compat / danger zone)
    openEventConfigModal, saveEventConfig, openAreasTransportModal,
    openTeamAccessModal,
    openBusRoutesModal,
    openDangerZoneModal,
    showAddUserModal,
    showMyAccountModal,
    // OCR
    openOcrModal, confirmOcrMarks, _updateOcrConfirmBtn,
    saveBusFromDetail,
    // Gate & report sub-tabs
    _reportSubTab, _gateAdminUnlock, _gateShowList,
    _openWalkin, _changeBusSetup,
    // Manage page
    _manageSubTab, _collectPayment, _saveCollectPayment, _showAddReg, _saveAddReg,
    _cancelReg, _uncancelReg,
    _filterFines, _generateFines, _collectFine, _saveFineColl, _waiveFine,
  };
})();

document.addEventListener('DOMContentLoaded', App.init);
