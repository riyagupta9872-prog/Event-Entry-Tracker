// ===== REPORTS MODULE =====
const Reports = (() => {

  // ── Known department order and team membership ────────────────────────────
  const CATEGORY_ORDER = ['ICF_Prji', 'ICF_Mtg', 'IYF', 'IGF', 'Balarama Team'];

  const CATEGORY_TEAMS = {
    'IGF':           ['Lalita', 'Visakha', 'Chitralekha', 'Champakalata', 'Tungavidya', 'Indulekha', 'Rangadevi', 'Sudevi'],
    'IYF':           ['Anant', 'Govind', 'Madhav', 'Keshav', 'Janardhan'],
    'ICF_Mtg':       ['Rohini', 'Rukmini', 'Kalindi', 'Satyabhama', 'Jamvanti', 'Lakshmana', 'Kaushal', 'Bhadra'],
    'ICF_Prji':      ['Vasudev', 'Sankarshan', 'Anirudha', 'Pradyuman'],
    'Balarama Team': []
  };

  // Return which department a TEAM belongs to (not the devotee's category)
  function getTeamDept(teamName, extraMap) {
    const lower = (teamName || '').toLowerCase().trim();
    for (const [dept, teams] of Object.entries(CATEGORY_TEAMS)) {
      if (teams.some(t => t.toLowerCase() === lower)) return dept;
    }
    // Fall back to user-saved mappings from import flow
    if (extraMap && extraMap[lower]) return extraMap[lower];
    return null;
  }

  // ── Module-level filter state ─────────────────────────────────────────────
  let _attendees  = [];
  let _groupType  = 'all';   // 'all' | 'team' | 'category' | 'reference'
  let _groupValue = '';      // e.g. 'Anirudha', 'IGF', 'Priya'
  let _payFilter  = 'all';   // 'all' | 'paid' | 'unpaid'
  let _attFilter  = 'all';   // 'all' | 'present' | 'absent'

  // ── Load all data needed for reports ─────────────────────────────────────
  async function reportData() {
    _attendees = await DB.getAll(DB.STORES.attendees);
    const busRoutes = await DB.getAll(DB.STORES.busRoutes);
    const evt = await DB.getEvent(DB.getCurrentEvent());
    const cfg = {
      eventName:      evt?.name || 'Event',
      chargePerPerson: parseFloat(evt?.chargePerPerson || 0),
      totalExpense:   0
    };

    const teams      = [...new Set(_attendees.map(a => a.team).filter(Boolean))].sort();
    const categories = [...new Set(_attendees.map(a => a.category).filter(Boolean))].sort();
    const references = [...new Set(_attendees.map(a => a.reference).filter(Boolean))].sort();

    const totalPay    = _attendees.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
    const totalBusCost = busRoutes.reduce((s, r) => {
      const count = parseInt(r.busCount || 1);
      return s + count * parseFloat(r.cost || 0);
    }, 0);
    const profitLoss = totalPay - totalBusCost - cfg.totalExpense;

    const rawMap = await DB.getConfig('teamCategoryMap');
    const teamCategoryMap = rawMap ? JSON.parse(rawMap) : {};

    return { attendees: _attendees, busRoutes, cfg, teams, categories, references, totalPay, totalBusCost, profitLoss, teamCategoryMap };
  }

  // ── Apply current filters to attendees array ──────────────────────────────
  function applyFilters(attendees) {
    let f = attendees;

    if (_groupType === 'team' && _groupValue)
      f = f.filter(a => (a.team || 'Unassigned') === _groupValue);
    else if (_groupType === 'category' && _groupValue)
      f = f.filter(a => (a.category || 'Unknown') === _groupValue);
    else if (_groupType === 'reference' && _groupValue)
      f = f.filter(a => (a.reference || 'Unknown') === _groupValue);

    if (_payFilter === 'paid')
      f = f.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid');
    else if (_payFilter === 'unpaid')
      f = f.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid');

    if (_attFilter === 'present')
      f = f.filter(a => a.attendance === 'present');
    else if (_attFilter === 'absent')
      f = f.filter(a => a.attendance !== 'present');

    return f;
  }

  // ── Compute counts from an array of attendees ─────────────────────────────
  function stats(list) {
    const paid    = list.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid').length;
    const free    = list.filter(a => (a.paymentStatus || '').toLowerCase() === 'free').length;
    const unpaid  = list.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid').length;
    const present = list.filter(a => a.attendance === 'present').length;
    const absent  = list.length - present;
    const amount  = list.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
    return { total: list.length, present, absent, paid, unpaid, free, amount };
  }

  // ── Counts bar HTML ───────────────────────────────────────────────────────
  function countsBar(s) {
    return `
      <div class="report-counts-bar">
        <div class="rc-item primary">
          <div class="rc-val">${s.total}</div><div class="rc-lbl">Registered</div>
        </div>
        <div class="rc-item success">
          <div class="rc-val">${s.present}</div><div class="rc-lbl">Present</div>
        </div>
        <div class="rc-item warning">
          <div class="rc-val">${s.absent}</div><div class="rc-lbl">Absent</div>
        </div>
        <div class="rc-item accent">
          <div class="rc-val">${s.paid}</div><div class="rc-lbl">Paid</div>
        </div>
        <div class="rc-item danger">
          <div class="rc-val">${s.unpaid}</div><div class="rc-lbl">Unpaid</div>
        </div>
        <div class="rc-item info">
          <div class="rc-val">${Helpers.currency(s.amount)}</div><div class="rc-lbl">Collected</div>
        </div>
      </div>`;
  }

  // ── Group summary table (team/category/reference breakdown) ───────────────
  function groupTable(attendees, groupType) {
    if (groupType === 'all') return '';

    const field    = groupType === 'team' ? 'team' : groupType === 'category' ? 'category' : 'reference';
    const defVal   = groupType === 'team' ? 'Unassigned' : 'Unknown';
    const label    = groupType === 'team' ? 'Team' : groupType === 'category' ? 'Category' : 'Reference';

    const map = {};
    attendees.forEach(a => {
      const key = a[field] || defVal;
      if (!map[key]) map[key] = [];
      map[key].push(a);
    });

    const rows = Object.entries(map)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, members]) => {
        const s = stats(members);
        return `<tr>
          <td>${key}</td>
          <td>${s.total}</td>
          <td>${s.present}</td>
          <td>${s.absent}</td>
          <td>${s.paid}</td>
          <td>${s.unpaid}</td>
          <td>${s.free}</td>
          <td>${Helpers.currency(s.amount)}</td>
        </tr>`;
      });

    if (!rows.length) return '';

    return `
      <div class="card" style="margin-top:1rem">
        <h3 class="card-title">${label}-wise Breakdown</h3>
        <div class="table-wrap">
          <table class="report-table">
            <thead><tr>
              <th>${label}</th><th>Registered</th><th>Present</th><th>Absent</th>
              <th>Paid</th><th>Unpaid</th><th>Free</th><th>Collected</th>
            </tr></thead>
            <tbody>${rows.join('')}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Build a label for the download filename ───────────────────────────────
  function buildLabel() {
    const parts = [];
    if (_groupType !== 'all') {
      parts.push(_groupValue ? `${_groupType}-${_groupValue}` : _groupType);
    }
    if (_payFilter !== 'all') parts.push(_payFilter);
    if (_attFilter !== 'all') parts.push(_attFilter);
    return parts.length ? parts.join('_') : 'All';
  }

  // ── Render Pre Event Reports HTML ─────────────────────────────────────────
  // teamCategoryMap: user-saved unknown-team→dept assignments from Firestore
  function renderPreEventReports(attendees, teamCategoryMap) {
    const savedMap = teamCategoryMap || {};

    // ── TABLE 1: Category-wise (devotee's own category) ───────────────────
    // "Har category ke kitne devotees aa rhe hai" → group by a.category
    const devCatMap = {};
    attendees.forEach(a => {
      const cat = (a.category || 'Unknown').trim();
      devCatMap[cat] = (devCatMap[cat] || 0) + 1;
    });
    const catOrder = [...CATEGORY_ORDER.filter(c => devCatMap[c]), ...Object.keys(devCatMap).filter(c => !CATEGORY_ORDER.includes(c)).sort()];
    const catBodyRows = catOrder.map(cat =>
      `<tr class="pre-data-row"><td>${cat}</td><td style="text-align:center;font-weight:700">${devCatMap[cat]}</td></tr>`
    ).join('');
    const catGrand = attendees.length;

    // ── TABLE 2: Team-wise grouped by TEAM'S DEPARTMENT ───────────────────
    // Group by which department the TEAM belongs to (not devotee's category)
    // Count ALL devotees a team brought, regardless of their own category
    const deptMap = {}; // dept → { teamName → members[] }
    attendees.forEach(a => {
      const team = (a.team || 'Other').trim();
      const dept = getTeamDept(team, savedMap) || 'Unassigned';
      if (!deptMap[dept]) deptMap[dept] = {};
      if (!deptMap[dept][team]) deptMap[dept][team] = [];
      deptMap[dept][team].push(a);
    });

    const allDepts = [...CATEGORY_ORDER.filter(d => deptMap[d]), ...Object.keys(deptMap).filter(d => !CATEGORY_ORDER.includes(d)).sort()];

    let grandPaid = 0, grandUnpaid = 0, grandTotal = 0;
    let teamBodyRows = '';

    allDepts.forEach(dept => {
      const teamMap = deptMap[dept] || {};
      const teams = Object.keys(teamMap).sort();
      let deptPaid = 0, deptUnpaid = 0, deptTotal = 0;

      teamBodyRows += `<tr class="pre-cat-hdr"><td colspan="4">${dept}</td></tr>`;

      teams.forEach(team => {
        const members = teamMap[team];
        const paid   = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'paid').length;
        const free   = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'free').length;
        const unpaid = members.length - paid - free;
        deptPaid += paid; deptUnpaid += unpaid; deptTotal += members.length;

        teamBodyRows += `<tr class="pre-data-row">
          <td style="padding-left:1.25rem">${team}</td>
          <td style="text-align:center;color:#15803d;font-weight:600">${paid}</td>
          <td style="text-align:center;color:#dc2626;font-weight:600">${unpaid}</td>
          <td style="text-align:center;font-weight:700">${members.length}</td>
        </tr>`;
      });

      teamBodyRows += `<tr class="pre-subtotal">
        <td>Sub-Total</td>
        <td style="text-align:center">${deptPaid}</td>
        <td style="text-align:center">${deptUnpaid}</td>
        <td style="text-align:center">${deptTotal}</td>
      </tr>`;

      grandPaid += deptPaid; grandUnpaid += deptUnpaid; grandTotal += deptTotal;
    });

    return `
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:.75rem">
          <h3 class="card-title" style="margin:0">Category wise Report</h3>
          <button class="btn-primary" id="btn-pre-cat-xl" style="font-size:.82rem;padding:.4rem .9rem">&#8595; Download</button>
        </div>
        <div class="table-wrap">
          <table class="report-table pre-rpt-table">
            <thead><tr><th>Category</th><th style="text-align:center">Number of Devotees</th></tr></thead>
            <tbody>
              ${catBodyRows}
              <tr class="pre-grand-total"><td>Grand Total</td><td style="text-align:center">${catGrand}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:.75rem">
          <h3 class="card-title" style="margin:0">Team wise Report</h3>
          <button class="btn-primary" id="btn-pre-team-xl" style="font-size:.82rem;padding:.4rem .9rem">&#8595; Download</button>
        </div>
        <div class="table-wrap">
          <table class="report-table pre-rpt-table">
            <thead><tr><th>Team</th><th style="text-align:center">Paid</th><th style="text-align:center">Unpaid</th><th style="text-align:center">Total</th></tr></thead>
            <tbody>
              ${teamBodyRows}
              <tr class="pre-grand-total">
                <td>TOTAL</td>
                <td style="text-align:center">${grandPaid}</td>
                <td style="text-align:center">${grandUnpaid}</td>
                <td style="text-align:center">${grandTotal}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Wire Pre Event download buttons ───────────────────────────────────────
  function initPreEventReports(attendees, teamCategoryMap) {
    document.getElementById('btn-pre-cat-xl')?.addEventListener('click', () =>
      Export.downloadPreEventCategoryExcel(attendees));
    document.getElementById('btn-pre-team-xl')?.addEventListener('click', () =>
      Export.downloadPreEventTeamExcel(attendees, teamCategoryMap));
  }

  // ── Render the full reports page (initial HTML only) ─────────────────────
  function renderReports(_data) {
    // Reset state on each render
    _groupType = 'all'; _groupValue = ''; _payFilter = 'all'; _attFilter = 'all';

    const optionsHtml = (arr) =>
      '<option value="">— select —</option>' + arr.map(v => `<option>${v}</option>`).join('');

    return `
      <div style="display:flex;gap:.5rem;margin-bottom:1rem">
        <button class="rep-tab active" data-rptab="live">Live Reports</button>
        <button class="rep-tab" data-rptab="preevt">Pre Event Reports</button>
        <button class="rep-tab" data-rptab="absentees">Repeat Absentees</button>
      </div>

      <div id="rpt-live-content">
        <div class="card report-filters-card">

          <div class="filter-section">
            <div class="filter-label">Filter by</div>
            <div class="filter-row">
              <button class="rep-filter active" data-ft="group" data-val="all">All</button>
              <button class="rep-filter" data-ft="group" data-val="team">Team wise</button>
              <button class="rep-filter" data-ft="group" data-val="category">Category wise</button>
              <button class="rep-filter" data-ft="group" data-val="reference">Reference wise</button>
            </div>
            <div id="group-val-wrap" style="display:none;margin-top:.6rem">
              <select id="group-val-select" class="wi-input" style="width:100%;max-width:300px">
                ${optionsHtml([])}
              </select>
            </div>
          </div>

          <div class="filter-section" style="margin-top:.9rem">
            <div class="filter-label">Payment</div>
            <div class="filter-row">
              <button class="rep-filter active" data-ft="pay" data-val="all">All</button>
              <button class="rep-filter" data-ft="pay" data-val="paid">Paid</button>
              <button class="rep-filter" data-ft="pay" data-val="unpaid">Unpaid</button>
            </div>
          </div>

          <div class="filter-section" style="margin-top:.9rem">
            <div class="filter-label">Attendance</div>
            <div class="filter-row">
              <button class="rep-filter active" data-ft="att" data-val="all">All</button>
              <button class="rep-filter" data-ft="att" data-val="present">Present</button>
              <button class="rep-filter" data-ft="att" data-val="absent">Absent</button>
            </div>
          </div>

        </div>

        <div id="report-counts-bar"></div>
        <div id="report-group-table"></div>

        <div style="margin:.75rem 0 1.5rem;display:flex;gap:.75rem;align-items:center;flex-wrap:wrap">
          <button class="btn-primary" id="btn-rpt-excel" style="min-width:180px">&#8595; Download Excel</button>
          <span id="rpt-dl-label" style="color:var(--text-muted);font-size:.85rem"></span>
        </div>
      </div>

      <div id="rpt-preevt-content" class="hidden"></div>
      <div id="rpt-absentees-content" class="hidden"></div>
    `;
  }

  // ── Wire up filter buttons + dropdown after HTML is in DOM ────────────────
  function initReportFilters(data) {
    const { teams, categories, references } = data;
    const groupOptions = { team: teams, category: categories, reference: references };

    // Page-level tab switching (Live Reports ↔ Pre Event Reports)
    document.querySelectorAll('[data-rptab]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-rptab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.rptab;
        document.getElementById('rpt-live-content').classList.toggle('hidden', tab !== 'live');
        const preEl = document.getElementById('rpt-preevt-content');
        preEl.classList.toggle('hidden', tab !== 'preevt');
        const absEl = document.getElementById('rpt-absentees-content');
        absEl.classList.toggle('hidden', tab !== 'absentees');
        if (tab === 'preevt' && !preEl.innerHTML.trim()) {
          preEl.innerHTML = renderPreEventReports(data.attendees, data.teamCategoryMap);
          initPreEventReports(data.attendees, data.teamCategoryMap);
        }
        if (tab === 'absentees' && !absEl.innerHTML.trim()) {
          absEl.innerHTML = '<p style="color:var(--text-muted);padding:1.5rem;text-align:center">Scanning past events…</p>';
          computeRepeatAbsenteeMap().then(map => {
            absEl.innerHTML = renderRepeatAbsentees(map, 2);
            initRepeatAbsentees(map);
          }).catch(err => {
            absEl.innerHTML = `<p style="color:var(--danger);padding:1.5rem">Error: ${err.message}</p>`;
          });
        }
      });
    });

    // Initial render of live counts
    _updateView();

    // Filter button clicks
    document.querySelectorAll('.rep-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        const ft  = btn.dataset.ft;
        const val = btn.dataset.val;

        document.querySelectorAll(`.rep-filter[data-ft="${ft}"]`).forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        if (ft === 'group') {
          _groupType  = val;
          _groupValue = '';
          const wrap = document.getElementById('group-val-wrap');
          const sel  = document.getElementById('group-val-select');
          if (val === 'all') {
            wrap.style.display = 'none';
          } else {
            wrap.style.display = 'block';
            const opts = groupOptions[val] || [];
            sel.innerHTML = '<option value="">— select —</option>' + opts.map(o => `<option>${o}</option>`).join('');
          }
        } else if (ft === 'pay') {
          _payFilter = val;
        } else if (ft === 'att') {
          _attFilter = val;
        }

        _updateView();
      });
    });

    // Group value dropdown
    document.getElementById('group-val-select').addEventListener('change', e => {
      _groupValue = e.target.value;
      _updateView();
    });

    // Download button — multi-sheet when a group type is active with no specific value
    document.getElementById('btn-rpt-excel').addEventListener('click', () => {
      const filtered = applyFilters(_attendees);
      if (_groupType !== 'all' && !_groupValue) {
        const field = _groupType === 'team' ? 'team' : _groupType === 'category' ? 'category' : 'reference';
        Export.downloadFilteredByGroup(filtered, field, buildLabel());
      } else {
        Export.downloadFiltered(filtered, buildLabel());
      }
    });
  }

  // ── Re-render counts + group table based on current filter state ──────────
  function _updateView() {
    const filtered = applyFilters(_attendees);
    const s        = stats(filtered);

    document.getElementById('report-counts-bar').innerHTML  = countsBar(s);
    // groupTable breakdown should reflect the current payment/attendance filters
    document.getElementById('report-group-table').innerHTML = groupTable(filtered, _groupType);

    // Update label
    const lbl = document.getElementById('rpt-dl-label');
    if (lbl) lbl.textContent = `${filtered.length} record${filtered.length !== 1 ? 's' : ''} match current filters`;
  }

  // ── REPEAT ABSENTEES (cross-event) ────────────────────────────────────────
  // Cache: Map<mobileKey, { name, mobile, team, consecutive, totalPast, lastAttended, history: [{eventName, date, present}] }>
  let _absenteeCache = null;
  let _absenteeCacheEventId = null;

  function _mobileKey(m) {
    return (m || '').toString().replace(/\D/g, '').slice(-10);
  }

  // Build cross-event attendance per devotee. Most-recent-past-first event order.
  // Consecutive = absence streak starting from the most recent past event the
  // devotee was registered in, ending when we hit the first 'present' (or no
  // further past registrations).
  async function computeRepeatAbsenteeMap(force) {
    const currentEid = DB.getCurrentEvent();
    if (!force && _absenteeCache && _absenteeCacheEventId === currentEid) return _absenteeCache;

    const allEvents = await DB.getEvents();
    // Past events only, sorted by date descending (fall back to createdAt)
    const pastEvents = allEvents
      .filter(e => e.id !== currentEid)
      .sort((a, b) => {
        const da = a.date || a.createdAt || '';
        const db = b.date || b.createdAt || '';
        return db.localeCompare(da);
      });

    // mobileKey → { name, mobile, team, history: [{eventName, date, present}] }
    const map = new Map();

    for (const evt of pastEvents) {
      DB.setCurrentEvent(evt.id);
      let participants = [];
      try { participants = await DB.getAll(DB.STORES.attendees); } catch { participants = []; }
      for (const p of participants) {
        const key = _mobileKey(p.mobile);
        if (!key) continue;
        let entry = map.get(key);
        if (!entry) {
          entry = { name: p.name || '', mobile: key, team: p.team || '', history: [] };
          map.set(key, entry);
        }
        // Keep latest known name/team (events are processed newest→oldest, so first wins)
        if (!entry.name && p.name) entry.name = p.name;
        if (!entry.team && p.team) entry.team = p.team;
        entry.history.push({
          eventId: evt.id,
          eventName: evt.name || 'Event',
          date: evt.date || evt.createdAt || '',
          present: p.attendance === 'present'
        });
      }
    }
    // Restore current event scope
    DB.setCurrentEvent(currentEid);

    // Compute consecutive-absent count from most recent past event
    for (const entry of map.values()) {
      let streak = 0;
      let lastAttended = null;
      for (const h of entry.history) {
        if (h.present) { lastAttended = h; break; }
        streak += 1;
      }
      entry.consecutive = streak;
      entry.totalPast = entry.history.length;
      entry.lastAttended = lastAttended;
    }

    _absenteeCache = map;
    _absenteeCacheEventId = currentEid;
    return map;
  }

  function clearAbsenteeCache() { _absenteeCache = null; _absenteeCacheEventId = null; }

  // Lookup helper used by admission flow in app.js
  async function getAbsenteeWarning(mobile) {
    const key = _mobileKey(mobile);
    if (!key) return null;
    const map = await computeRepeatAbsenteeMap();
    const entry = map.get(key);
    if (!entry || !entry.consecutive) return null;
    return entry;
  }

  function renderRepeatAbsentees(map, minStreak) {
    const min = Math.max(1, parseInt(minStreak || 2));
    const rows = [...map.values()]
      .filter(e => e.consecutive >= min)
      .sort((a, b) => b.consecutive - a.consecutive || (a.name || '').localeCompare(b.name || ''));

    const body = rows.length ? rows.map(e => {
      const last = e.lastAttended
        ? `${e.lastAttended.eventName}${e.lastAttended.date ? ' (' + Helpers.formatDate(e.lastAttended.date) + ')' : ''}`
        : '<span style="color:var(--text-muted)">Never</span>';
      const recent = e.history.slice(0, e.consecutive).map(h => h.eventName).join(', ');
      return `<tr>
        <td>${e.name || '-'}</td>
        <td>${e.mobile || '-'}</td>
        <td>${e.team || '-'}</td>
        <td style="text-align:center;font-weight:700;color:#dc2626">${e.consecutive}</td>
        <td style="text-align:center">${e.totalPast}</td>
        <td>${last}</td>
        <td style="font-size:.8rem;color:var(--text-muted)">${recent}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:1.25rem">No devotees absent in ${min}+ consecutive past events.</td></tr>`;

    return `
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:.75rem">
          <h3 class="card-title" style="margin:0">Repeat Absentees</h3>
          <div style="display:flex;gap:.5rem;align-items:center">
            <label style="font-size:.85rem;color:var(--text-muted)">Min consecutive</label>
            <select id="rpt-abs-min" class="wi-input" style="width:80px">
              <option value="1"${min===1?' selected':''}>1</option>
              <option value="2"${min===2?' selected':''}>2</option>
              <option value="3"${min===3?' selected':''}>3</option>
              <option value="4"${min===4?' selected':''}>4</option>
              <option value="5"${min===5?' selected':''}>5</option>
            </select>
          </div>
        </div>
        <p style="font-size:.85rem;color:var(--text-muted);margin:0 0 .75rem">
          Devotees who were absent in their most recent consecutive past events (matched by mobile number). The current event is excluded.
        </p>
        <div class="table-wrap">
          <table class="report-table">
            <thead><tr>
              <th>Name</th><th>Mobile</th><th>Team</th>
              <th style="text-align:center">Consecutive Absent</th>
              <th style="text-align:center">Past Events</th>
              <th>Last Attended</th>
              <th>Absent In</th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>`;
  }

  function initRepeatAbsentees(map) {
    const sel = document.getElementById('rpt-abs-min');
    if (!sel) return;
    sel.addEventListener('change', () => {
      const host = document.getElementById('rpt-absentees-content');
      host.innerHTML = renderRepeatAbsentees(map, sel.value);
      initRepeatAbsentees(map);
    });
  }

  // ── Legacy helpers kept for Financial Year page ────────────────────────────
  async function reportSummary() {
    const attendees  = await DB.getAll(DB.STORES.attendees);
    const busRoutes  = await DB.getAll(DB.STORES.busRoutes);
    const evt        = await DB.getEvent(DB.getCurrentEvent());
    const cfg = {
      eventName:       evt?.name || await DB.getConfig('eventName') || 'Prerna Festival',
      chargePerPerson: parseFloat(evt?.chargePerPerson || await DB.getConfig('chargePerPerson') || 0),
      totalExpense:    parseFloat(evt?.totalExpense || 0)
    };
    const present     = attendees.filter(a => a.attendance === 'present');
    const walkIns     = attendees.filter(a => a.isWalkIn);
    const totalPayment = attendees.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
    const totalBusCost = busRoutes.reduce((s, r) => s + parseInt(r.busCount || 1) * parseFloat(r.cost || 0), 0);
    const paidCount   = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid').length;
    const unpaidCount = attendees.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid').length;
    const freeCount   = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'free').length;

    return {
      totalAttendees: attendees.length, totalPresent: present.length,
      totalWalkIns: walkIns.length, totalPayment, totalBusCost,
      expected: attendees.length * cfg.chargePerPerson,
      netPL: totalPayment - cfg.totalExpense - totalBusCost,
      paidCount, unpaidCount, freeCount, cfg
    };
  }

  return { reportData, renderReports, initReportFilters, reportSummary, renderPreEventReports,
           computeRepeatAbsenteeMap, getAbsenteeWarning, clearAbsenteeCache,
           CATEGORY_ORDER, CATEGORY_TEAMS, getTeamDept };
})();
