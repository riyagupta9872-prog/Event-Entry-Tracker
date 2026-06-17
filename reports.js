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
  let _groupType  = 'all';   // 'all' | 'team' | 'category' | 'reference' | 'bus'
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

    // Deduplicate group values case-insensitively; display the most-common spelling
    const dedupeGroup = (arr) => {
      const freq = {};
      arr.filter(Boolean).forEach(v => {
        const k = v.trim().toLowerCase();
        if (!freq[k]) freq[k] = {};
        freq[k][v.trim()] = (freq[k][v.trim()] || 0) + 1;
      });
      return Object.values(freq)
        .map(spellings => Object.entries(spellings).sort((a, b) => b[1] - a[1])[0][0])
        .sort();
    };
    const teams      = dedupeGroup(_attendees.map(a => a.team));
    const categories = dedupeGroup(_attendees.map(a => a.category));
    const references = dedupeGroup(_attendees.map(a => a.reference));
    const buses      = dedupeGroup(_attendees.map(a => a.boardedBus));

    const totalPay    = _attendees.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
    const totalBusCost = busRoutes.reduce((s, r) => {
      const count = parseInt(r.busCount || 1);
      return s + count * parseFloat(r.cost || 0);
    }, 0);
    const profitLoss = totalPay - totalBusCost - cfg.totalExpense;

    const rawMap = await DB.getConfig('teamCategoryMap');
    const teamCategoryMap = rawMap ? JSON.parse(rawMap) : {};

    return { attendees: _attendees, busRoutes, cfg, teams, categories, references, buses, totalPay, totalBusCost, profitLoss, teamCategoryMap };
  }

  // ── Apply current filters to attendees array ──────────────────────────────
  function applyFilters(attendees) {
    let f = attendees;
    const normStr = s => (s || '').trim().toLowerCase();

    if (_groupType === 'team' && _groupValue)
      f = f.filter(a => normStr(a.team || 'Unassigned') === normStr(_groupValue));
    else if (_groupType === 'category' && _groupValue)
      f = f.filter(a => normStr(a.category || 'Unknown') === normStr(_groupValue));
    else if (_groupType === 'reference' && _groupValue)
      f = f.filter(a => normStr(a.reference || 'Unknown') === normStr(_groupValue));
    else if (_groupType === 'bus' && _groupValue)
      f = f.filter(a => normStr(a.boardedBus || 'No Bus') === normStr(_groupValue));

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

    const field  = groupType === 'team' ? 'team'
                 : groupType === 'category' ? 'category'
                 : groupType === 'bus' ? 'boardedBus'
                 : 'reference';
    const defVal = groupType === 'team' ? 'Unassigned'
                 : groupType === 'bus' ? 'No Bus'
                 : 'Unknown';
    const label  = groupType === 'team' ? 'Team'
                 : groupType === 'category' ? 'Category'
                 : groupType === 'bus' ? 'Bus'
                 : 'Reference';

    // Normalize keys: trim + lowercase for grouping; track original spelling for display
    const map     = {};  // normalizedKey → members[]
    const dispMap = {};  // normalizedKey → { originalSpelling: count }
    attendees.forEach(a => {
      const raw  = ((a[field] || '').trim()) || defVal;
      const key  = raw.toLowerCase();
      if (!map[key])  { map[key] = []; dispMap[key] = {}; }
      map[key].push(a);
      dispMap[key][raw] = (dispMap[key][raw] || 0) + 1;
    });

    // Most-frequent original spelling wins as the display name
    const canonical = key => {
      const entries = Object.entries(dispMap[key] || {}).sort((a, b) => b[1] - a[1]);
      return entries.length ? entries[0][0] : key;
    };

    const rows = Object.entries(map)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, members]) => {
        const s = stats(members);
        return `<tr>
          <td>${canonical(key)}</td>
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
    // Normalize: case-insensitive + trim; display canonical (most-frequent) spelling
    const devCatMap   = {};  // normalizedKey → count
    const catDispMap  = {};  // normalizedKey → { spelling: count }
    attendees.forEach(a => {
      const raw = (a.category || 'Unknown').trim();
      const key = raw.toLowerCase();
      devCatMap[key]  = (devCatMap[key] || 0) + 1;
      if (!catDispMap[key]) catDispMap[key] = {};
      catDispMap[key][raw] = (catDispMap[key][raw] || 0) + 1;
    });
    const catCanonical = key => {
      const entries = Object.entries(catDispMap[key] || {}).sort((a, b) => b[1] - a[1]);
      return entries.length ? entries[0][0] : key;
    };
    const catOrderKeys = [...CATEGORY_ORDER.map(c => c.toLowerCase()).filter(k => devCatMap[k]),
                          ...Object.keys(devCatMap).filter(k => !CATEGORY_ORDER.map(c => c.toLowerCase()).includes(k)).sort()];
    const catBodyRows = catOrderKeys.map(key =>
      `<tr class="pre-data-row"><td>${catCanonical(key)}</td><td style="text-align:center;font-weight:700">${devCatMap[key]}</td></tr>`
    ).join('');
    const catGrand = attendees.length;

    // ── TABLE 2: Team-wise grouped by TEAM'S DEPARTMENT ───────────────────
    // Group by which department the TEAM belongs to (not devotee's category)
    // Count ALL devotees a team brought, regardless of their own category
    // Keys are normalized (lowercase trim) to merge "Anant" / "anant" / " Anant"
    const deptMap = {}; // dept → { normalizedTeamKey → { display, members[] } }
    attendees.forEach(a => {
      const rawTeam  = (a.team || 'Other').trim();
      const teamKey  = rawTeam.toLowerCase();
      const dept     = getTeamDept(rawTeam, savedMap) || 'Unassigned';
      if (!deptMap[dept]) deptMap[dept] = {};
      if (!deptMap[dept][teamKey]) deptMap[dept][teamKey] = { display: rawTeam, members: [], _freq: {} };
      deptMap[dept][teamKey].members.push(a);
      // Track most common original spelling for display
      deptMap[dept][teamKey]._freq[rawTeam] = (deptMap[dept][teamKey]._freq[rawTeam] || 0) + 1;
    });

    const allDepts = [...CATEGORY_ORDER.filter(d => deptMap[d]), ...Object.keys(deptMap).filter(d => !CATEGORY_ORDER.includes(d)).sort()];

    let grandPaid = 0, grandUnpaid = 0, grandTotal = 0;
    let teamBodyRows = '';

    allDepts.forEach(dept => {
      const teamMap = deptMap[dept] || {};
      // Sort normalized keys; display using most-common original spelling
      const teamKeys = Object.keys(teamMap).sort();
      let deptPaid = 0, deptUnpaid = 0, deptTotal = 0;

      teamBodyRows += `<tr class="pre-cat-hdr"><td colspan="4">${dept}</td></tr>`;

      teamKeys.forEach(teamKey => {
        const { members, _freq } = teamMap[teamKey];
        // Pick most-frequent original spelling as display name
        const teamDisplay = Object.entries(_freq || {}).sort((a, b) => b[1] - a[1])[0]?.[0] || teamKey;
        const paid   = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'paid').length;
        const free   = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'free').length;
        const unpaid = members.length - paid - free;
        deptPaid += paid; deptUnpaid += unpaid; deptTotal += members.length;

        teamBodyRows += `<tr class="pre-data-row">
          <td style="padding-left:1.25rem">${teamDisplay}</td>
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
              <button class="rep-filter" data-ft="group" data-val="bus">Bus wise</button>
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
    const { teams, categories, references, buses } = data;
    const groupOptions = { team: teams, category: categories, reference: references, bus: buses || [] };

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

    // Download button:
    // • Specific group value selected (e.g. just "Team Anant") → single sheet
    // • All other cases → "All Attendees" sheet + summary + per-team/category sheets
    document.getElementById('btn-rpt-excel').addEventListener('click', () => {
      const filtered = applyFilters(_attendees);
      if (_groupType !== 'all' && _groupValue) {
        // Drill-down to one specific group — single sheet is correct here
        Export.downloadFiltered(filtered, buildLabel());
      } else {
        // "All" view, or group-type selected but no specific value picked:
        // always output All + sub-sheets so the Excel is complete and useful
        const field = _groupType === 'category' ? 'category'
                    : _groupType === 'bus'       ? 'boardedBus'
                    : _groupType === 'reference' ? 'reference'
                    : 'team'; // default to team breakdown
        Export.downloadFilteredByGroup(filtered, field, buildLabel());
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

  // Cross-event devotee key. Built so:
  //   - Same person across multiple events matches (by full mobile + name prefix)
  //   - Family members sharing a mobile stay separate (name prefix differs)
  //   - Devotees with missing/short mobile still get included (fallback to name)
  //   - As a last resort, a unique per-record id is used so nobody is dropped
  function _normName(s) {
    return (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  }
  function _devoteeKey(p) {
    const mob10 = _mobileKey(p.mobile);
    const nameNorm = _normName(p.name);
    // Use the FULL normalized name (not a prefix) so distinct devotees on the
    // same family phone — "Sunita devi" vs "Sunita verma" — never collapse.
    if (mob10.length === 10) {
      return nameNorm ? `m:${mob10}|n:${nameNorm}` : `m:${mob10}`;
    }
    if (nameNorm) return `n:${nameNorm}`;
    return `id:${p.id || p.attendeeId || Math.random().toString(36).slice(2)}`;
  }
  function _displayMobileFromKey(key, fallback) {
    if (key.startsWith('m:')) return key.slice(2, 12);
    return fallback || '';
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
      // Collapse duplicate participant rows for the same mobile within this
      // event (e.g. re-imports, walk-in created alongside a registration) so a
      // single event contributes at most ONE history entry per devotee.
      // A devotee is considered "present" for the event if ANY of their rows
      // for that event are marked present.
      const perDevoteeInEvent = new Map();
      for (const p of participants) {
        const key = _devoteeKey(p);
        const existing = perDevoteeInEvent.get(key);
        const ps = (p.paymentStatus || '').toLowerCase();
        const amt = parseFloat(p.paymentAmount || 0);
        if (!existing) {
          perDevoteeInEvent.set(key, {
            name: p.name || '', mobile: _mobileKey(p.mobile),
            team: p.team || '', reference: p.reference || '',
            present: p.attendance === 'present',
            paymentStatus: ps || 'unpaid',
            paymentAmount: amt
          });
        } else {
          if (!existing.name && p.name) existing.name = p.name;
          if (!existing.mobile && p.mobile) existing.mobile = _mobileKey(p.mobile);
          if (!existing.team && p.team) existing.team = p.team;
          if (!existing.reference && p.reference) existing.reference = p.reference;
          if (p.attendance === 'present') existing.present = true;
          // Accumulate payment: paid status wins; sum amounts
          if (ps === 'paid' || ps === 'free') existing.paymentStatus = ps;
          existing.paymentAmount = (existing.paymentAmount || 0) + amt;
        }
      }
      for (const [key, info] of perDevoteeInEvent) {
        let entry = map.get(key);
        if (!entry) {
          entry = {
            name: info.name,
            mobile: info.mobile || _displayMobileFromKey(key, ''),
            team: info.team, reference: info.reference, history: []
          };
          map.set(key, entry);
        }
        // Keep latest known name/team/reference (events are processed newest→oldest, so first wins)
        if (!entry.name && info.name) entry.name = info.name;
        if (!entry.team && info.team) entry.team = info.team;
        if (!entry.reference && info.reference) entry.reference = info.reference;
        entry.history.push({
          eventId: evt.id,
          eventName: evt.name || 'Event',
          date: evt.date || evt.createdAt || '',
          present: info.present,
          paymentStatus: info.paymentStatus || 'unpaid',
          paymentAmount: info.paymentAmount || 0
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

  // Lookup helper used by admission flow in app.js. Tries the same composite
  // key the matrix uses; falls back to a mobile-only scan if name isn't
  // available at call time.
  async function getAbsenteeWarning(mobileOrParticipant, nameMaybe) {
    const p = (typeof mobileOrParticipant === 'object' && mobileOrParticipant)
      ? mobileOrParticipant
      : { mobile: mobileOrParticipant, name: nameMaybe };
    const map = await computeRepeatAbsenteeMap();
    let entry = map.get(_devoteeKey(p));
    if (!entry) {
      const mob10 = _mobileKey(p.mobile);
      if (mob10) {
        for (const [k, v] of map) {
          if (k.startsWith(`m:${mob10}`)) { entry = v; break; }
        }
      }
    }
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
      return `<tr class="abs-row" style="cursor:pointer" onclick="Reports.showAbsenteeDetail('${e.mobile}')" title="Tap for details">
        <td><span style="color:var(--accent);font-weight:600">${e.name || '-'}</span></td>
        <td>${e.mobile || '-'}</td>
        <td>${e.team || '-'}</td>
        <td style="text-align:center;font-weight:700;color:#dc2626">${e.consecutive}</td>
        <td style="text-align:center">${e.totalPast}</td>
        <td>${last}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:1.25rem">No devotees absent in ${min}+ consecutive past events.</td></tr>`;

    return `
      <div class="card" style="margin-bottom:1rem">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:.5rem;margin-bottom:.75rem">
          <h3 class="card-title" style="margin:0">Repeat Absentees</h3>
          <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
            <button class="btn-primary" id="rpt-abs-dl" style="font-size:.82rem;padding:.4rem .75rem">&#11015; Absentees Excel</button>
            <button class="btn-secondary" id="rpt-overall-dl" style="font-size:.82rem;padding:.4rem .75rem">&#128203; Overall Report</button>
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
          Devotees who were absent in their most recent consecutive past events (matched by mobile number). The current event is excluded from this on-screen list.
          <span style="color:var(--accent);font-weight:600">Tap any row to see the full absence history.</span>
          <br><span style="font-size:.78rem">The <b>Download Excel</b> button exports <b>every devotee absent in at least one event</b> (current event included) — not just this consecutive-streak subset.</span>
        </p>
        <div class="table-wrap">
          <table class="report-table">
            <thead><tr>
              <th>Name</th><th>Mobile</th><th>Team</th>
              <th style="text-align:center">Consecutive Absent</th>
              <th style="text-align:center">Past Events</th>
              <th>Last Attended</th>
            </tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>`;
  }

  // Tap-to-open detail card for a single absentee. Reads from the cached
  // absentee map (populated by renderRepeatAbsentees) — refreshes from disk if
  // the cache was cleared.
  async function showAbsenteeDetail(mobileKey) {
    let map = _absenteeCache;
    if (!map) map = await computeRepeatAbsenteeMap();
    const e = map.get(mobileKey);
    if (!e) { Helpers.toast('No record found', 'warning'); return; }

    const lastAtt = e.lastAttended
      ? `${e.lastAttended.eventName}${e.lastAttended.date ? ' · ' + Helpers.formatDate(e.lastAttended.date) : ''}`
      : 'Never attended a past event';

    const historyRows = e.history.length
      ? e.history.map((h, idx) => {
          const isStreak = idx < e.consecutive;
          const dot = h.present
            ? '<span style="color:#16a34a;font-weight:700">&#10003;</span>'
            : '<span style="color:#dc2626;font-weight:700">&#10007;</span>';
          const status = h.present
            ? '<span style="color:#15803d;font-weight:600">Present</span>'
            : `<span style="color:#dc2626;font-weight:600">Absent${isStreak ? '' : ''}</span>`;
          return `<tr style="${isStreak ? 'background:#fef2f2' : ''}">
            <td style="text-align:center;width:30px">${dot}</td>
            <td>${h.eventName || '-'}</td>
            <td style="white-space:nowrap;color:var(--text-muted);font-size:.82rem">${h.date ? Helpers.formatDate(h.date) : '-'}</td>
            <td style="text-align:right">${status}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:1rem">No past event history</td></tr>';

    Helpers.modal(`
      <div style="max-width:520px">
        <h3 class="modal-title" style="margin:0 0 .25rem">${e.name || 'Unknown'}</h3>
        <div style="color:var(--text-muted);font-size:.86rem;margin-bottom:1rem">
          ${e.mobile || '-'} ${e.team ? ' &middot; ' + e.team : ''}
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem;margin-bottom:1rem">
          <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:.6rem;text-align:center">
            <div style="font-size:1.4rem;font-weight:800;color:#dc2626">${e.consecutive}</div>
            <div style="font-size:.72rem;color:#991b1b;text-transform:uppercase;letter-spacing:.04em">Consecutive Absent</div>
          </div>
          <div style="background:#f1f5f9;border:1px solid #cbd5e1;border-radius:8px;padding:.6rem;text-align:center">
            <div style="font-size:1.4rem;font-weight:800">${e.totalPast}</div>
            <div style="font-size:.72rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Past Events</div>
          </div>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:.6rem;text-align:center">
            <div style="font-size:1.4rem;font-weight:800;color:#15803d">${e.history.filter(h => h.present).length}</div>
            <div style="font-size:.72rem;color:#166534;text-transform:uppercase;letter-spacing:.04em">Times Present</div>
          </div>
        </div>

        <div style="margin-bottom:.75rem">
          <div style="font-size:.78rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em">Last Attended</div>
          <div style="font-weight:600">${lastAtt}</div>
        </div>

        <div style="font-size:.78rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:.4rem">Event History (newest first)</div>
        <div class="table-wrap" style="max-height:280px;overflow-y:auto">
          <table class="report-table" style="font-size:.86rem">
            <thead><tr>
              <th style="width:30px"></th>
              <th>Event</th>
              <th>Date</th>
              <th style="text-align:right">Status</th>
            </tr></thead>
            <tbody>${historyRows}</tbody>
          </table>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:1rem">
          <button class="btn-secondary" onclick="Helpers.closeModal()">Close</button>
        </div>
      </div>
    `);
  }

  function initRepeatAbsentees(map) {
    const sel = document.getElementById('rpt-abs-min');
    if (sel) {
      sel.addEventListener('change', () => {
        const host = document.getElementById('rpt-absentees-content');
        host.innerHTML = renderRepeatAbsentees(map, sel.value);
        initRepeatAbsentees(map);
      });
    }
    const dl = document.getElementById('rpt-abs-dl');
    if (dl) {
      dl.addEventListener('click', async () => {
        const orig = dl.textContent;
        dl.disabled = true; dl.textContent = 'Building…';
        try { await downloadAllAbsenteesExcel(); }
        finally { dl.disabled = false; dl.textContent = orig; }
      });
    }
    const dlOverall = document.getElementById('rpt-overall-dl');
    if (dlOverall) {
      dlOverall.addEventListener('click', async () => {
        const orig = dlOverall.textContent;
        dlOverall.disabled = true; dlOverall.textContent = 'Building…';
        try { await downloadOverallReport(); }
        finally { dlOverall.disabled = false; dlOverall.textContent = orig; }
      });
    }
  }

  // ── Overall Report ────────────────────────────────────────────────────────
  // Every devotee (from every event's import list) + one column per event with
  // Present/Absent. Blank "—" means the devotee was never registered for that
  // event (i.e. not in the coming list for it) — never counted as absent.
  // Rows with ≥ 3 absences are highlighted in red.
  async function downloadOverallReport() {
    const { events, rows: allRows } = await buildFullAbsenteeMatrix();
    if (!events.length) { Helpers.toast('No events found', 'warning'); return; }
    if (!allRows.length) { Helpers.toast('No devotees found', 'warning'); return; }

    const rows = allRows.slice().sort((a, b) =>
      b.totalAbsent - a.totalAbsent ||
      b.totalRegistered - a.totalRegistered ||
      (a.name || '').localeCompare(b.name || '')
    );

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Overall Report');

    const fixed = [
      { header: 'Sr. No.',       key: 'sr',    width: 7  },
      { header: 'Name',          key: 'name',  width: 26 },
      { header: 'Mobile',        key: 'mob',   width: 14 },
      { header: 'Team',          key: 'team',  width: 16 },
      { header: 'Reference',     key: 'ref',   width: 22 },
      { header: 'Times Present', key: 'tpres', width: 11 },
      { header: 'Times Absent',  key: 'tabs',  width: 11 }
    ];
    // TWO columns per event: Coming (Yes / —) + Attendance (Present/Absent/—)
    const evtColDefs = [];
    events.forEach((e, i) => {
      const dateStr = e.date ? Helpers.formatDate(e.date) : '';
      const base = dateStr ? `${e.name}\n(${dateStr})` : e.name;
      evtColDefs.push({ header: `${base}\nComing`,     key: `c${i}`, width: 12 });
      evtColDefs.push({ header: `${base}\nAttendance`, key: `s${i}`, width: 14 });
    });
    ws.columns = [...fixed, ...evtColDefs];

    // Alternate header shade per event so each event's pair of columns reads
    // as a visual group.
    const hdr = ws.getRow(1);
    hdr.height = 52;
    hdr.eachCell({ includeEmpty: true }, (cell, col) => {
      const relCol = col - fixed.length - 1;
      let bg = 'FF15803D';
      if (relCol >= 0) {
        const evtIdx = Math.floor(relCol / 2);
        bg = evtIdx % 2 === 0 ? 'FF15803D' : 'FF166534';
      }
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FF0F5C2E' } },
        bottom: { style: 'thin', color: { argb: 'FF0F5C2E' } },
        left:   { style: 'thin', color: { argb: 'FF0F5C2E' } },
        right:  { style: 'thin', color: { argb: 'FF0F5C2E' } }
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });

    rows.forEach((r, idx) => {
      const flagged = r.totalAbsent >= 3;
      const rowVals = {
        sr: idx + 1,
        name: r.name || '', mob: r.mobile || '', team: r.team || '', ref: r.reference || '',
        tpres: r.totalPresent, tabs: r.totalAbsent
      };
      events.forEach((e, i) => {
        const s = r.statusById[e.id];
        rowVals[`c${i}`] = s ? 'Yes' : '';
        rowVals[`s${i}`] = s === 'present' ? 'Present' : s === 'absent' ? 'Absent' : '';
      });

      const row = ws.addRow(rowVals);
      row.height = 20;

      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const baseBg = flagged
          ? (idx % 2 === 0 ? 'FFFEF2F2' : 'FFFEE2E2')
          : (idx % 2 === 0 ? 'FFF0FDF4' : 'FFFFFFFF');
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: baseBg } };
        cell.font = { size: 10, color: { argb: flagged ? 'FF7F1D1D' : 'FF111827' } };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFD1FAE5' } },
          bottom: { style: 'thin', color: { argb: 'FFD1FAE5' } },
          left:   { style: 'thin', color: { argb: 'FFD1FAE5' } },
          right:  { style: 'thin', color: { argb: 'FFD1FAE5' } }
        };
        cell.alignment = { vertical: 'middle' };

        if (col === 6 && r.totalPresent > 0) {
          cell.font = { size: 10, bold: true, color: { argb: 'FF15803D' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        if (col === 7 && r.totalAbsent > 0) {
          cell.font = { size: 10, bold: true, color: { argb: flagged ? 'FFB91C1C' : 'FFDC2626' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        // Per-event Coming + Attendance cell styling
        const relCol = col - fixed.length - 1;
        if (relCol >= 0) {
          const isComingCol = (relCol % 2 === 0);
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          const v = cell.value;
          if (isComingCol) {
            if (v === 'Yes') {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0F2FE' } };
              cell.font = { size: 10, bold: true, color: { argb: 'FF075985' } };
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
              cell.font = { size: 9, italic: true, color: { argb: 'FF94A3B8' } };
              cell.value = '—';
            }
          } else {
            if (v === 'Present') {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
              cell.font = { size: 10, bold: true, color: { argb: 'FF15803D' } };
            } else if (v === 'Absent') {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
              cell.font = { size: 10, bold: true, color: { argb: 'FF991B1B' } };
            } else {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
              cell.font = { size: 9, italic: true, color: { argb: 'FF94A3B8' } };
              cell.value = '—';
            }
          }
        }
      });
    });

    ws.views = [{ state: 'frozen', xSplit: 5, ySplit: 1 }];

    ws.addRow([]);
    ws.addRow(['Legend:',
      'Coming = devotee was in the import / registration list for that event (Yes / —)',
      'Attendance: Present = attended, Absent = was coming but did not attend, — = not in the coming list'
    ]);
    ws.lastRow.font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
    ws.addRow(['Row highlight (red):', 'Devotee absent 3 or more times — prioritise follow-up calls.']);
    ws.lastRow.font = { size: 9, italic: true, color: { argb: 'FF991B1B' } };

    const buf = await wb.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    Helpers.downloadBlob(
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `Prerna_OverallReport_${date}.xlsx`
    );
    const flaggedCount = rows.filter(r => r.totalAbsent >= 3).length;
    Helpers.toast(`Overall report ready · ${rows.length} devotees · ${flaggedCount} flagged (3+ absences)`, 'success', 5000);
  }

  // ── Build a full devotee × event attendance matrix across EVERY event
  // (current + past) ────────────────────────────────────────────────────────
  // Returns { events: [{id,name,date}] oldest-first, rows: [{name,mobile,team,
  // reference, totalAbsent, totalPresent, totalRegistered, consecutiveAbsent,
  // statusById: {eventId: 'present'|'absent'}}] }
  async function buildFullAbsenteeMatrix() {
    const currentEid = DB.getCurrentEvent();
    const allEvents = await DB.getEvents();
    // Newest first for iteration / streak math; we'll reverse for display.
    const eventsNewestFirst = [...allEvents].sort((a, b) => {
      const da = a.date || a.createdAt || '';
      const db = b.date || b.createdAt || '';
      return db.localeCompare(da);
    });

    const map = new Map(); // mobileKey -> entry

    try {
    for (const evt of eventsNewestFirst) {
      DB.setCurrentEvent(evt.id);
      let participants = [];
      try { participants = await DB.getAll(DB.STORES.attendees); } catch { participants = []; }

      // Collapse duplicate participant rows for the same person within this
      // event (re-imports, walk-in alongside registration). Family members on
      // the same phone stay separate because the key includes a name prefix.
      // Devotees with missing/short mobile are NOT dropped — they fall back to
      // a name-based key, so the count matches the actual roster.
      const perDevotee = new Map();
      for (const p of participants) {
        const key = _devoteeKey(p);
        const existing = perDevotee.get(key);
        if (!existing) {
          perDevotee.set(key, {
            name: p.name || '', mobile: _mobileKey(p.mobile),
            team: p.team || '', reference: p.reference || '',
            present: p.attendance === 'present'
          });
        } else {
          if (!existing.name && p.name) existing.name = p.name;
          if (!existing.mobile && p.mobile) existing.mobile = _mobileKey(p.mobile);
          if (!existing.team && p.team) existing.team = p.team;
          if (!existing.reference && p.reference) existing.reference = p.reference;
          if (p.attendance === 'present') existing.present = true;
        }
      }

      for (const [key, info] of perDevotee) {
        let entry = map.get(key);
        if (!entry) {
          entry = {
            name: info.name,
            mobile: info.mobile || _displayMobileFromKey(key, ''),
            team: info.team, reference: info.reference,
            statusById: {}
          };
          map.set(key, entry);
        }
        if (!entry.name && info.name) entry.name = info.name;
        if (!entry.team && info.team) entry.team = info.team;
        if (!entry.reference && info.reference) entry.reference = info.reference;
        entry.statusById[evt.id] = info.present ? 'present' : 'absent';
      }
      // Diagnostic — quickly spot per-event drift between raw rows and unique
      // devotees. Open DevTools console to see this.
      console.log(`[Overall Report] ${evt.name || evt.id}: ${participants.length} raw participant rows → ${perDevotee.size} unique devotees`);
    }
    } finally {
      // ALWAYS restore the user's current event, even if an iteration throws.
      // Otherwise localStorage gets stuck pointing at whichever event we last
      // looked at, and the [CURRENT] tag in subsequent exports drifts.
      DB.setCurrentEvent(currentEid);
    }

    // Compute totals + consecutive-absent streak across the registered events
    // only (not registered = streak break neither way — we just skip).
    for (const entry of map.values()) {
      let totalAbsent = 0, totalPresent = 0, totalReg = 0, streak = 0, streakBroken = false;
      for (const evt of eventsNewestFirst) {
        const s = entry.statusById[evt.id];
        if (!s) continue; // not registered for this event
        totalReg += 1;
        if (s === 'present') { totalPresent += 1; streakBroken = true; }
        else { totalAbsent += 1; if (!streakBroken) streak += 1; }
      }
      entry.totalAbsent = totalAbsent;
      entry.totalPresent = totalPresent;
      entry.totalRegistered = totalReg;
      entry.consecutiveAbsent = streak;
    }

    return {
      events: eventsNewestFirst.slice().reverse().map(e => ({
        id: e.id, name: e.name || 'Event', date: e.date || e.createdAt || ''
      })),
      rows: [...map.values()]
    };
  }

  // ── Download FULL Absentees Excel ─────────────────────────────────────────
  // One row per devotee who was absent in at least one event. One column per
  // event (current + past), oldest→newest. Cell value:
  //   'Present' (green) — registered AND attended
  //   'Absent'  (red)   — registered but did not attend
  //   '—' (grey)        — NOT registered for that event (never called absent)
  async function downloadAllAbsenteesExcel() {
    const { events, rows: allRows } = await buildFullAbsenteeMatrix();
    if (!events.length) { Helpers.toast('No events found', 'warning'); return; }

    // Filter: include any devotee with at least 1 absence
    const rows = allRows
      .filter(r => r.totalAbsent > 0)
      .sort((a, b) =>
        b.consecutiveAbsent - a.consecutiveAbsent ||
        b.totalAbsent - a.totalAbsent ||
        (a.name || '').localeCompare(b.name || '')
      );

    if (!rows.length) { Helpers.toast('No absentees found across any event', 'warning'); return; }

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Absentees - All Events');

    const fixed = [
      { header: 'Sr. No.',            key: 'sr',     width: 7  },
      { header: 'Name',               key: 'name',   width: 26 },
      { header: 'Mobile',             key: 'mob',    width: 14 },
      { header: 'Team',               key: 'team',   width: 16 },
      { header: 'Reference',          key: 'ref',    width: 22 },
      { header: 'Total Absent',       key: 'tabs',   width: 11 },
      { header: 'Total Present',      key: 'tpres',  width: 11 },
      { header: 'Total Registered',   key: 'treg',   width: 11 },
      { header: 'Consecutive Absent', key: 'streak', width: 12 }
    ];
    const evtColDefs = events.map((e, i) => {
      const dateStr = e.date ? Helpers.formatDate(e.date) : '';
      const header = dateStr ? `${e.name}\n(${dateStr})` : e.name;
      return { header, key: `e${i}`, width: 22 };
    });
    ws.columns = [...fixed, ...evtColDefs];

    // Header style
    const hdrRow = ws.getRow(1);
    hdrRow.height = 46;
    hdrRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
      cell.border = {
        top:    { style: 'thin', color: { argb: 'FF0F5C2E' } },
        bottom: { style: 'thin', color: { argb: 'FF0F5C2E' } },
        left:   { style: 'thin', color: { argb: 'FF0F5C2E' } },
        right:  { style: 'thin', color: { argb: 'FF0F5C2E' } }
      };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });

    rows.forEach((r, idx) => {
      const rowVals = {
        sr: idx + 1,
        name: r.name || '', mob: r.mobile || '', team: r.team || '', ref: r.reference || '',
        tabs: r.totalAbsent, tpres: r.totalPresent, treg: r.totalRegistered, streak: r.consecutiveAbsent
      };
      events.forEach((e, i) => {
        const s = r.statusById[e.id];
        rowVals[`e${i}`] = s === 'present' ? 'Present' : s === 'absent' ? 'Absent' : '';
      });

      const row = ws.addRow(rowVals);
      row.height = 20;

      row.eachCell({ includeEmpty: true }, (cell, col) => {
        const isOdd = idx % 2 === 0;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isOdd ? 'FFF0FDF4' : 'FFFFFFFF' } };
        cell.font = { size: 10 };
        cell.border = {
          top:    { style: 'thin', color: { argb: 'FFD1FAE5' } },
          bottom: { style: 'thin', color: { argb: 'FFD1FAE5' } },
          left:   { style: 'thin', color: { argb: 'FFD1FAE5' } },
          right:  { style: 'thin', color: { argb: 'FFD1FAE5' } }
        };
        cell.alignment = { vertical: 'middle' };

        if (col === 6 && r.totalAbsent > 0) {
          cell.font = { size: 10, bold: true, color: { argb: 'FFDC2626' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        if (col === 7 && r.totalPresent > 0) {
          cell.font = { size: 10, bold: true, color: { argb: 'FF15803D' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
        if (col === 8) cell.alignment = { horizontal: 'center', vertical: 'middle' };
        if (col === 9 && r.consecutiveAbsent > 0) {
          cell.font = { size: 10, bold: true, color: { argb: 'FFDC2626' } };
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }

        if (col >= fixed.length + 1) {
          const v = cell.value;
          if (v === 'Absent') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            cell.font = { size: 10, bold: true, color: { argb: 'FF991B1B' } };
          } else if (v === 'Present') {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
            cell.font = { size: 10, bold: true, color: { argb: 'FF15803D' } };
          } else {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
            cell.font = { size: 9, italic: true, color: { argb: 'FF94A3B8' } };
            cell.value = '—';
          }
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });
    });

    ws.views = [{ state: 'frozen', xSplit: 5, ySplit: 1 }];

    ws.addRow([]);
    ws.addRow(['Legend:', 'Present = attended', 'Absent = registered but did not attend', '— = not registered for this event (never counted as absent)']);
    ws.lastRow.font = { size: 9, italic: true, color: { argb: 'FF64748B' } };
    ws.addRow(['Includes:', 'Every devotee absent in at least one event across the entire event history (current event included).']);
    ws.lastRow.font = { size: 9, italic: true, color: { argb: 'FF64748B' } };

    const buf = await wb.xlsx.writeBuffer();
    const date = new Date().toISOString().slice(0, 10);
    Helpers.downloadBlob(
      new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      `Prerna_Absentees_AllEvents_${date}.xlsx`
    );
    Helpers.toast(`Downloaded ${rows.length} absentee record${rows.length !== 1 ? 's' : ''}`, 'success');
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
           computeRepeatAbsenteeMap, getAbsenteeWarning, clearAbsenteeCache, showAbsenteeDetail,
           CATEGORY_ORDER, CATEGORY_TEAMS, getTeamDept };
})();
