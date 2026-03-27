// ===== REPORTS MODULE =====
const Reports = (() => {

  async function getAttendees() {
    return DB.getAll(DB.STORES.attendees);
  }

  async function getConfig() {
    const evt = await DB.getEvent(DB.getCurrentEvent());
    return {
      eventDate: evt?.date || await DB.getConfig('eventDate'),
      chargePerPerson: parseFloat(evt?.chargePerPerson || await DB.getConfig('chargePerPerson') || 0),
      eventName: evt?.name || await DB.getConfig('eventName') || 'Prerna Festival',
      totalExpense: parseFloat(evt?.totalExpense || 0)
    };
  }

  async function getBusRoutes() {
    return DB.getAll(DB.STORES.busRoutes);
  }

  // REPORT 1: Attendance Overview
  async function reportOverview() {
    const attendees = await getAttendees();
    const present = attendees.filter(a => a.attendance === 'present');

    const catMap = {};
    attendees.forEach(a => {
      const cat = a.category || 'Unknown';
      if (!catMap[cat]) catMap[cat] = { total: 0, present: 0 };
      catMap[cat].total++;
      if (a.attendance === 'present') catMap[cat].present++;
    });

    const teamMap = {};
    attendees.forEach(a => {
      const team = a.team || 'Unassigned';
      if (!teamMap[team]) teamMap[team] = { total: 0, present: 0 };
      teamMap[team].total++;
      if (a.attendance === 'present') teamMap[team].present++;
    });

    return { attendees, present, catMap, teamMap };
  }

  // REPORT 2: Payment Analysis
  async function reportPayment() {
    const attendees = await getAttendees();
    const cfg = await getConfig();

    const teamPayMap = {};
    let totalPayment = 0;
    let paidCount = 0, unpaidCount = 0, freeCount = 0;

    attendees.forEach(a => {
      const team = a.team || 'Unassigned';
      const payment = parseFloat(a.paymentAmount || 0);
      const status = (a.paymentStatus || 'unpaid').toLowerCase();
      const mode = a.paymentMode || '-';

      if (!teamPayMap[team]) {
        teamPayMap[team] = { persons: 0, paid: 0, unpaid: 0, free: 0, cash: 0, online: 0, total: 0 };
      }
      teamPayMap[team].persons++;
      teamPayMap[team].total += payment;
      if (status === 'paid') { teamPayMap[team].paid++; paidCount++; }
      else if (status === 'free') { teamPayMap[team].free++; freeCount++; }
      else { teamPayMap[team].unpaid++; unpaidCount++; }

      if (mode === 'cash') teamPayMap[team].cash += payment;
      else if (mode === 'online') teamPayMap[team].online += payment;

      totalPayment += payment;
    });

    const expected = attendees.length * cfg.chargePerPerson;
    const profitLoss = totalPayment - cfg.totalExpense;

    return { teamPayMap, totalPayment, expected, profitLoss, attendees, cfg, paidCount, unpaidCount, freeCount };
  }

  // REPORT 3: Reference Performance
  async function reportReference() {
    const attendees = await getAttendees();
    const refMap = {};

    attendees.forEach(a => {
      const ref = a.reference || 'Unknown';
      const payment = parseFloat(a.paymentAmount || 0);
      const status = (a.paymentStatus || 'unpaid').toLowerCase();
      if (!refMap[ref]) refMap[ref] = { persons: 0, total: 0, paid: 0, unpaid: 0, free: 0 };
      refMap[ref].persons++;
      refMap[ref].total += payment;
      if (status === 'paid') refMap[ref].paid++;
      else if (status === 'free') refMap[ref].free++;
      else refMap[ref].unpaid++;
    });

    return { refMap };
  }

  // REPORT 4: Transportation
  async function reportTransport() {
    const attendees = await getAttendees();
    const busRoutes = await getBusRoutes();

    const routeMap = {};
    busRoutes.forEach(r => {
      routeMap[r.name] = { ...r, passengers: 0, collection: 0 };
    });

    attendees.forEach(a => {
      const route = a.busRoute;
      if (!route) return;
      if (!routeMap[route]) {
        routeMap[route] = { name: route, capacity: 0, cost: 0, chargePerPassenger: 0, passengers: 0, collection: 0 };
      }
      routeMap[route].passengers++;
      routeMap[route].collection += parseFloat(routeMap[route].chargePerPassenger || 0);
    });

    let totalCost = 0, totalCollection = 0;
    Object.values(routeMap).forEach(r => {
      totalCost += parseFloat(r.cost || 0);
      totalCollection += r.collection;
    });

    return { routeMap, totalCost, totalCollection, profitLoss: totalCollection - totalCost };
  }

  // REPORT 5: Overall Summary
  async function reportSummary() {
    const attendees = await getAttendees();
    const cfg = await getConfig();
    const busRoutes = await getBusRoutes();

    const present = attendees.filter(a => a.attendance === 'present');
    const walkIns = attendees.filter(a => a.isWalkIn);
    const duplicates = attendees.filter(a => a.isDuplicate);
    const totalPayment = attendees.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
    const totalBusCost = busRoutes.reduce((s, r) => s + parseFloat(r.cost || 0), 0);
    const expected = attendees.length * cfg.chargePerPerson;
    const paidCount = attendees.filter(a => a.paymentStatus === 'paid').length;
    const unpaidCount = attendees.filter(a => !a.paymentStatus || a.paymentStatus === 'unpaid').length;
    const freeCount = attendees.filter(a => a.paymentStatus === 'free').length;

    return {
      totalAttendees: attendees.length,
      totalPresent: present.length,
      totalWalkIns: walkIns.length,
      totalDuplicates: duplicates.length,
      totalPayment, totalBusCost, expected,
      netPL: totalPayment - cfg.totalExpense - totalBusCost,
      paidCount, unpaidCount, freeCount,
      cfg
    };
  }

  // Render functions
  function renderOverview(data) {
    const { attendees, present, catMap, teamMap } = data;
    const pct = attendees.length ? Math.round((present.length / attendees.length) * 100) : 0;

    let html = `
      <div class="report-dl-bar">
        <span>Attendance Overview Report</span>
        <button class="btn-small success" onclick="Export.reportToExcel('overview')">Excel</button>
        <button class="btn-small" onclick="Export.reportToCsv('overview')">CSV</button>
        <button class="btn-small warning" onclick="Export.reportToPdf('overview')">PDF</button>
      </div>

      <div class="card">
        <h3 class="card-title">Overall Attendance</h3>
        <div class="stats-grid">
          <div class="stat-card primary"><div class="stat-value">${attendees.length}</div><div class="stat-label">Total Expected</div></div>
          <div class="stat-card success"><div class="stat-value">${present.length}</div><div class="stat-label">Present</div></div>
          <div class="stat-card warning"><div class="stat-value">${attendees.length - present.length}</div><div class="stat-label">Absent</div></div>
          <div class="stat-card accent"><div class="stat-value">${pct}%</div><div class="stat-label">Attendance Rate</div></div>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Category-wise Breakdown</h3>
        ${Helpers.buildTable(
          ['Category', 'Total Expected', 'Present', 'Absent', 'Rate'],
          Object.entries(catMap).map(([cat, d]) => ({
            cells: [cat, d.total, d.present, d.total - d.present, Math.round(d.present / d.total * 100) + '%']
          })),
          { cls: 'report-table' }
        )}
      </div>

      <div class="card">
        <h3 class="card-title">Team-wise Breakdown</h3>
        ${Helpers.buildTable(
          ['Team', 'Total', 'Present', 'Absent'],
          Object.entries(teamMap).sort((a,b) => b[1].total - a[1].total).map(([team, d]) => ({
            cells: [team, d.total, d.present, d.total - d.present]
          })),
          { cls: 'report-table' }
        )}
      </div>
    `;
    return html;
  }

  function renderPayment(data) {
    const { teamPayMap, totalPayment, expected, profitLoss, cfg, paidCount, unpaidCount, freeCount } = data;
    const plClass = profitLoss >= 0 ? 'success' : 'danger';

    let rows = Object.entries(teamPayMap).sort((a,b) => b[1].total - a[1].total).map(([team, d]) => ({
      cells: [team, d.persons, d.paid, d.unpaid, d.free, Helpers.currency(d.cash), Helpers.currency(d.online), Helpers.currency(d.total)]
    }));

    return `
      <div class="report-dl-bar">
        <span>Payment Analysis Report</span>
        <button class="btn-small success" onclick="Export.reportToExcel('payment')">Excel</button>
        <button class="btn-small" onclick="Export.reportToCsv('payment')">CSV</button>
        <button class="btn-small warning" onclick="Export.reportToPdf('payment')">PDF</button>
      </div>
      <div class="card">
        <h3 class="card-title">Payment Summary</h3>
        <div class="stats-grid">
          <div class="stat-card accent"><div class="stat-value">${Helpers.currency(totalPayment)}</div><div class="stat-label">Total Collected</div></div>
          <div class="stat-card success"><div class="stat-value">${paidCount}</div><div class="stat-label">Paid</div></div>
          <div class="stat-card warning"><div class="stat-value">${unpaidCount}</div><div class="stat-label">Unpaid</div></div>
          <div class="stat-card info"><div class="stat-value">${freeCount}</div><div class="stat-label">Free</div></div>
          <div class="stat-card ${plClass}"><div class="stat-value">${Helpers.currency(Math.abs(profitLoss))}</div><div class="stat-label">${profitLoss >= 0 ? 'Profit' : 'Loss'}</div></div>
        </div>
      </div>
      <div class="card">
        <h3 class="card-title">Team-wise Payment</h3>
        ${Helpers.buildTable(['Team','Persons','Paid','Unpaid','Free','Cash','Online','Total'], rows, { cls: 'report-table' })}
      </div>
    `;
  }

  function renderReference(data) {
    const { refMap } = data;
    const rows = Object.entries(refMap).sort((a,b) => b[1].persons - a[1].persons).map(([ref, d]) => ({
      cells: [ref, d.persons, d.paid, d.unpaid, d.free, Helpers.currency(d.total)]
    }));

    return `
      <div class="report-dl-bar">
        <span>Reference Performance Report</span>
        <button class="btn-small success" onclick="Export.reportToExcel('reference')">Excel</button>
        <button class="btn-small" onclick="Export.reportToCsv('reference')">CSV</button>
        <button class="btn-small warning" onclick="Export.reportToPdf('reference')">PDF</button>
      </div>
      <div class="card">
        <h3 class="card-title">Reference Performance</h3>
        ${Helpers.buildTable(['Reference','Persons','Paid','Unpaid','Free','Total Payment'], rows, { cls: 'report-table' })}
      </div>
    `;
  }

  function renderTransport(data) {
    const { routeMap, totalCost, totalCollection, profitLoss } = data;
    const rows = Object.values(routeMap).map(r => ({
      cells: [r.name || 'Unknown', r.capacity || '-', r.passengers, Helpers.currency(r.collection), Helpers.currency(r.cost),
        `<span style="color:${r.collection - r.cost >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:600">${Helpers.currency(r.collection - r.cost)}</span>`]
    }));
    rows.push({ _class: 'total-row', cells: ['TOTAL', '', Object.values(routeMap).reduce((s,r) => s+r.passengers, 0),
      Helpers.currency(totalCollection), Helpers.currency(totalCost),
      `<span style="color:${profitLoss >= 0 ? 'var(--success)' : 'var(--danger)'};font-weight:600">${Helpers.currency(profitLoss)}</span>`] });

    return `
      <div class="report-dl-bar">
        <span>Transportation Report</span>
        <button class="btn-small success" onclick="Export.reportToExcel('transport')">Excel</button>
        <button class="btn-small" onclick="Export.reportToCsv('transport')">CSV</button>
        <button class="btn-small warning" onclick="Export.reportToPdf('transport')">PDF</button>
      </div>
      <div class="card">
        <h3 class="card-title">Bus Route Economics</h3>
        ${Helpers.buildTable(['Route','Capacity','Passengers','Collection','Cost','P/L'], rows, { cls: 'report-table' })}
      </div>
    `;
  }

  function renderSummary(data) {
    const { totalAttendees, totalPresent, totalWalkIns, totalPayment, totalBusCost, expected, netPL, paidCount, unpaidCount, freeCount, cfg } = data;

    return `
      <div class="report-dl-bar">
        <span>Event Financial Summary</span>
        <button class="btn-small success" onclick="Export.reportToExcel('summary')">Excel</button>
        <button class="btn-small" onclick="Export.reportToCsv('summary')">CSV</button>
        <button class="btn-small warning" onclick="Export.reportToPdf('summary')">PDF</button>
      </div>
      <div class="card">
        <h3 class="card-title">Overall Event Summary - ${cfg.eventName}</h3>
        ${Helpers.buildTable(['Metric','Value'], [
          { cells: ['Event Name', cfg.eventName] },
          { cells: ['Event Date', Helpers.formatDate(cfg.eventDate)] },
          { cells: ['Total Registered', totalAttendees] },
          { cells: ['Total Present', totalPresent] },
          { cells: ['Walk-ins', totalWalkIns] },
          { cells: ['Attendance Rate', totalAttendees ? Math.round(totalPresent/totalAttendees*100)+'%' : '0%'] },
          { cells: ['Paid', paidCount] },
          { cells: ['Unpaid', unpaidCount] },
          { cells: ['Free', freeCount] },
          { cells: ['Charge Per Person', Helpers.currency(cfg.chargePerPerson)] },
          { cells: ['Expected Revenue', Helpers.currency(expected)] },
          { cells: ['Total Collected', Helpers.currency(totalPayment)] },
          { cells: ['Total Event Expense', Helpers.currency(cfg.totalExpense)] },
          { cells: ['Total Bus Cost', Helpers.currency(totalBusCost)] },
          { _class: 'total-row', cells: ['Net Profit / Loss', Helpers.currency(netPL)] },
        ], { cls: 'report-table' })}
      </div>
    `;
  }

  return {
    reportOverview, reportPayment, reportReference, reportTransport, reportSummary,
    renderOverview, renderPayment, renderReference, renderTransport, renderSummary
  };
})();
