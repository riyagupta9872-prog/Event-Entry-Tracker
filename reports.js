// ===== REPORTS MODULE =====
const Reports = (() => {

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

    return { attendees: _attendees, busRoutes, cfg, teams, categories, references, totalPay, totalBusCost, profitLoss };
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

  // ── Render the full reports page (initial HTML only) ─────────────────────
  function renderReports(_data) {
    // Reset state on each render
    _groupType = 'all'; _groupValue = ''; _payFilter = 'all'; _attFilter = 'all';

    const optionsHtml = (arr) =>
      '<option value="">— select —</option>' + arr.map(v => `<option>${v}</option>`).join('');

    return `
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
        <button class="btn-primary" id="btn-rpt-excel" style="min-width:180px">↓ Download Excel</button>
        <span id="rpt-dl-label" style="color:var(--text-muted);font-size:.85rem"></span>
      </div>
    `;
  }

  // ── Wire up filter buttons + dropdown after HTML is in DOM ────────────────
  function initReportFilters(data) {
    const { teams, categories, references } = data;
    const groupOptions = { team: teams, category: categories, reference: references };

    // Initial render
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

    // Download button
    document.getElementById('btn-rpt-excel').addEventListener('click', () => {
      const filtered = applyFilters(_attendees);
      Export.downloadFiltered(filtered, buildLabel());
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

  return { reportData, renderReports, initReportFilters, reportSummary };
})();
