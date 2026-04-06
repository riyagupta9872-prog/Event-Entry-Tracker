// ===== EXPORT MODULE =====
const Export = (() => {

  // ── CANONICAL SHEET COLUMNS (matches uploaded sheet format) ──────────────
  const SHEET_HEADER = [
    'Sr. No.',
    'Name',
    'Mobile Number',
    'Category',
    'Team',
    'Reference',
    'Payment Status',
    'Mode of Payment',
    'Amount (₹)',
    'Payment Date',
    'Bus Route',
    'Attendance',
    'Admitted by',
    'Admitted at',
    'Walk-in',
    'Remarks'
  ];

  const SHEET_COL_WIDTHS = [
    { wch: 7  },  // Sr. No.
    { wch: 24 },  // Name
    { wch: 15 },  // Mobile
    { wch: 12 },  // Category
    { wch: 14 },  // Team
    { wch: 22 },  // Reference
    { wch: 14 },  // Payment Status
    { wch: 16 },  // Mode of Payment
    { wch: 12 },  // Amount
    { wch: 13 },  // Payment Date
    { wch: 18 },  // Bus Route
    { wch: 12 },  // Attendance
    { wch: 20 },  // Admitted by
    { wch: 20 },  // Admitted at
    { wch: 8  },  // Walk-in
    { wch: 28 },  // Remarks
  ];

  // Convert one attendee into a data row
  function toSheetRow(a, srNo, busRoute) {
    const payStatus = a.paymentStatus
      || (parseFloat(a.paymentAmount || 0) > 0 ? 'paid' : 'unpaid');
    return [
      srNo,
      a.name          || '',
      a.mobile        || '',
      a.category      || '',
      a.team          || '',
      a.reference     || '',
      payStatus,
      a.paymentMode   || '',
      parseFloat(a.paymentAmount || 0) || '',
      a.paymentDate   || '',
      busRoute,
      a.attendance === 'present' ? 'Present' : 'Absent',
      a.markedBy      || '',
      a.entryTime     ? new Date(a.entryTime).toLocaleString('en-IN') : '',
      a.isWalkIn      ? 'Yes' : '',
      a.remarks       || ''
    ];
  }

  // Style sheet: yellow header, green present rows, red unpaid cells
  function styleSheet(ws, dataRowCount) {
    const headerStyle = {
      font:      { bold: true, sz: 10, color: { rgb: '000000' } },
      fill:      { fgColor: { rgb: 'FFD966' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top:    { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left:   { style: 'thin', color: { rgb: '000000' } },
        right:  { style: 'thin', color: { rgb: '000000' } }
      }
    };
    const cellStyle = {
      font:      { sz: 10 },
      alignment: { vertical: 'center' },
      border: {
        top:    { style: 'thin', color: { rgb: 'CCCCCC' } },
        bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
        left:   { style: 'thin', color: { rgb: 'CCCCCC' } },
        right:  { style: 'thin', color: { rgb: 'CCCCCC' } }
      }
    };
    const presentStyle = { ...cellStyle, fill: { fgColor: { rgb: 'E2EFDA' } } }; // light green
    const absentStyle  = { ...cellStyle, fill: { fgColor: { rgb: 'FFF2CC' } } }; // light yellow
    const paidStyle    = { ...cellStyle, fill: { fgColor: { rgb: 'DDEEFF' } } }; // light blue
    const unpaidStyle  = { ...cellStyle, fill: { fgColor: { rgb: 'FFE0E0' } } }; // light red

    const totalCols = SHEET_HEADER.length;
    for (let R = 0; R <= dataRowCount; R++) {
      const attCell  = ws[XLSX.utils.encode_cell({ r: R, c: 11 })]; // Attendance col
      const payCell  = ws[XLSX.utils.encode_cell({ r: R, c: 6  })]; // Payment Status col
      const isPresent = attCell && attCell.v === 'Present';
      const isUnpaid  = payCell && String(payCell.v).toLowerCase() === 'unpaid';

      for (let C = 0; C < totalCols; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[addr]) ws[addr] = { v: '', t: 's' };
        if (R === 0) {
          ws[addr].s = headerStyle;
        } else if (isPresent) {
          ws[addr].s = presentStyle;
        } else {
          ws[addr].s = isUnpaid ? absentStyle : cellStyle;
          if (C === 6 && isUnpaid) ws[addr].s = unpaidStyle; // highlight unpaid cell itself red
        }
      }
    }
    ws['!rows'] = [{ hpt: 30 }, ...Array(dataRowCount).fill({ hpt: 18 })];
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', sqref: 'A2' };
  }

  // Build a styled attendance sheet from a list of attendees
  function makeAttSheet(records, busNameFn) {
    const rows = records.map((a, i) => toSheetRow(a, i + 1, busNameFn(a)));
    const ws   = XLSX.utils.aoa_to_sheet([SHEET_HEADER, ...rows]);
    ws['!cols'] = SHEET_COL_WIDTHS;
    styleSheet(ws, rows.length);
    return ws;
  }

  // Build a styled summary/count table sheet
  function makeSummarySheet(headers, rows, colWidths) {
    const hStyle = {
      font:      { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
      fill:      { fgColor: { rgb: '15803D' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top:    { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left:   { style: 'thin', color: { rgb: '000000' } },
        right:  { style: 'thin', color: { rgb: '000000' } }
      }
    };
    const cStyle = {
      font: { sz: 10 },
      alignment: { vertical: 'center' },
      border: {
        top:    { style: 'thin', color: { rgb: 'CCCCCC' } },
        bottom: { style: 'thin', color: { rgb: 'CCCCCC' } },
        left:   { style: 'thin', color: { rgb: 'CCCCCC' } },
        right:  { style: 'thin', color: { rgb: 'CCCCCC' } }
      }
    };
    const totalStyle = {
      ...cStyle,
      font: { bold: true, sz: 10 },
      fill: { fgColor: { rgb: 'E2EFDA' } }
    };

    const data = [headers, ...rows.map(r => r.cells)];
    const ws = XLSX.utils.aoa_to_sheet(data);
    if (colWidths) ws['!cols'] = colWidths;

    const numRows = data.length;
    const numCols = headers.length;
    for (let R = 0; R < numRows; R++) {
      const isTotal = rows[R - 1] && rows[R - 1]._total;
      for (let C = 0; C < numCols; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[addr]) ws[addr] = { v: '', t: 's' };
        ws[addr].s = R === 0 ? hStyle : (isTotal ? totalStyle : cStyle);
      }
    }
    ws['!rows'] = [{ hpt: 28 }, ...Array(numRows - 1).fill({ hpt: 18 })];
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', sqref: 'A2' };
    return ws;
  }

  // Safe Excel sheet name: max 31 chars, no invalid chars, unique
  function safeSheetName(raw, usedNames) {
    let name = String(raw || 'Sheet').replace(/[\\\/\?\*\[\]:]/g, '').trim().slice(0, 31);
    if (!name) name = 'Sheet';
    let candidate = name;
    let i = 2;
    while (usedNames.has(candidate.toLowerCase())) {
      candidate = name.slice(0, 28) + ` ${i++}`;
    }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  function cur(n) { return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 }); }

  // ── SHARED SETUP ─────────────────────────────────────────────────────────
  async function setup() {
    const attendees  = await DB.getAll(DB.STORES.attendees);
    const busRoutes  = await DB.getAll(DB.STORES.busRoutes);
    const summ       = await Reports.reportSummary();
    const cfg        = summ.cfg;
    const busNameMap = {};
    busRoutes.forEach(b => { busNameMap[b.id] = b.name; busNameMap[b.name] = b.name; });
    const busNameFn  = a => busNameMap[a.busRouteId] || busNameMap[a.busRoute] || a.busRoute || '';
    return { attendees, busRoutes, busNameMap, busNameFn, cfg };
  }

  // ── BASE SHEETS (always included) ─────────────────────────────────────────
  function addBaseSheets(wb, attendees, busNameFn, usedNames) {
    const allWs = makeAttSheet(attendees, busNameFn);
    XLSX.utils.book_append_sheet(wb, allWs, safeSheetName('All Attendees', usedNames));

    const present = attendees.filter(a => a.attendance === 'present');
    XLSX.utils.book_append_sheet(wb, makeAttSheet(present, busNameFn), safeSheetName('Present', usedNames));

    const absent = attendees.filter(a => a.attendance !== 'present');
    XLSX.utils.book_append_sheet(wb, makeAttSheet(absent, busNameFn), safeSheetName('Absent', usedNames));
  }

  // ── EXCEL EXPORT ──────────────────────────────────────────────────────────
  async function reportToExcel(type) {
    const { attendees, busRoutes, busNameFn, cfg } = await setup();
    const wb    = XLSX.utils.book_new();
    const used  = new Set();

    // ── Base sheets: All / Present / Absent ──
    addBaseSheets(wb, attendees, busNameFn, used);

    // ── Report-specific sheets ────────────────────────────────────────────
    if (type === 'overview') {
      await buildOverviewSheets(wb, attendees, busNameFn, used);
    } else if (type === 'payment') {
      await buildPaymentSheets(wb, attendees, busNameFn, used);
    } else if (type === 'reference') {
      await buildReferenceSheets(wb, attendees, busNameFn, used);
    } else if (type === 'transport') {
      await buildTransportSheets(wb, attendees, busRoutes, busNameFn, used);
    } else if (type === 'summary') {
      await buildSummarySheet(wb, attendees, busRoutes, cfg, used);
    }

    const slug = (cfg.eventName || 'Report').replace(/\s+/g, '_');
    XLSX.writeFile(wb, `Prerna_${type}_${slug}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Helpers.toast('Excel report downloaded!', 'success');
  }

  // ── OVERVIEW: Team sheets + Category summary ──────────────────────────────
  async function buildOverviewSheets(wb, attendees, busNameFn, used) {
    // Group by team
    const teams = {};
    attendees.forEach(a => {
      const t = a.team || 'Unassigned';
      if (!teams[t]) teams[t] = [];
      teams[t].push(a);
    });

    // One sheet per team (members list, same format)
    Object.entries(teams).sort((a, b) => b[1].length - a[1].length).forEach(([team, members]) => {
      const ws = makeAttSheet(members, busNameFn);
      XLSX.utils.book_append_sheet(wb, ws, safeSheetName(`Team - ${team}`, used));
    });

    // Category summary
    const catMap = {};
    attendees.forEach(a => {
      const c = a.category || 'Unknown';
      if (!catMap[c]) catMap[c] = { total: 0, present: 0 };
      catMap[c].total++;
      if (a.attendance === 'present') catMap[c].present++;
    });
    const catRows = Object.entries(catMap).map(([c, d]) => ({
      cells: [c, d.total, d.present, d.total - d.present,
        d.total ? Math.round(d.present / d.total * 100) + '%' : '0%']
    }));

    // Team summary
    const teamRows = Object.entries(teams).sort((a, b) => b[1].length - a[1].length).map(([t, members]) => {
      const present = members.filter(m => m.attendance === 'present').length;
      const paid    = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'paid').length;
      const unpaid  = members.filter(m => !m.paymentStatus || m.paymentStatus.toLowerCase() === 'unpaid').length;
      return { cells: [t, members.length, present, members.length - present, paid, unpaid] };
    });
    teamRows.push({ _total: true, cells: ['TOTAL', attendees.length,
      attendees.filter(a => a.attendance === 'present').length,
      attendees.filter(a => a.attendance !== 'present').length, '', ''] });

    const catWs = makeSummarySheet(
      ['Category', 'Total', 'Present', 'Absent', 'Rate'],
      catRows,
      [{ wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }]
    );
    XLSX.utils.book_append_sheet(wb, catWs, safeSheetName('Category Summary', used));

    const teamSumWs = makeSummarySheet(
      ['Team', 'Total', 'Present', 'Absent', 'Paid', 'Unpaid'],
      teamRows,
      [{ wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }]
    );
    XLSX.utils.book_append_sheet(wb, teamSumWs, safeSheetName('Team Summary', used));
  }

  // ── PAYMENT: Status sheets + Mode sheets + Team payment summary ───────────
  async function buildPaymentSheets(wb, attendees, busNameFn, used) {
    // Paid / Unpaid / Free / Partial — name-level sheets
    const paid    = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid');
    const unpaid  = attendees.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid');
    const free    = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'free');
    const partial = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'partial');
    const cash    = attendees.filter(a => (a.paymentMode || '').toLowerCase() === 'cash');
    const online  = attendees.filter(a => (a.paymentMode || '').toLowerCase() === 'online');

    if (paid.length)    XLSX.utils.book_append_sheet(wb, makeAttSheet(paid,    busNameFn), safeSheetName('Paid', used));
    if (unpaid.length)  XLSX.utils.book_append_sheet(wb, makeAttSheet(unpaid,  busNameFn), safeSheetName('Unpaid', used));
    if (free.length)    XLSX.utils.book_append_sheet(wb, makeAttSheet(free,    busNameFn), safeSheetName('Free', used));
    if (partial.length) XLSX.utils.book_append_sheet(wb, makeAttSheet(partial, busNameFn), safeSheetName('Partial Paid', used));
    if (cash.length)    XLSX.utils.book_append_sheet(wb, makeAttSheet(cash,    busNameFn), safeSheetName('Cash', used));
    if (online.length)  XLSX.utils.book_append_sheet(wb, makeAttSheet(online,  busNameFn), safeSheetName('Online', used));

    // Team-wise payment summary
    const teamMap = {};
    attendees.forEach(a => {
      const t   = a.team || 'Unassigned';
      const amt = parseFloat(a.paymentAmount || 0);
      const ps  = (a.paymentStatus || 'unpaid').toLowerCase();
      const pm  = (a.paymentMode || '').toLowerCase();
      if (!teamMap[t]) teamMap[t] = { persons: 0, paid: 0, unpaid: 0, free: 0, partial: 0, cash: 0, online: 0, total: 0 };
      teamMap[t].persons++;
      teamMap[t].total += amt;
      if (ps === 'paid')    teamMap[t].paid++;
      else if (ps === 'free') teamMap[t].free++;
      else if (ps === 'partial') { teamMap[t].partial++; teamMap[t].paid++; }
      else teamMap[t].unpaid++;
      if (pm === 'cash')   teamMap[t].cash   += amt;
      if (pm === 'online') teamMap[t].online  += amt;
    });

    const totalPayment = attendees.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
    const teamRows = Object.entries(teamMap).sort((a, b) => b[1].total - a[1].total).map(([t, d]) => ({
      cells: [t, d.persons, d.paid, d.unpaid, d.free, `₹${cur(d.cash)}`, `₹${cur(d.online)}`, `₹${cur(d.total)}`]
    }));
    teamRows.push({ _total: true, cells: [
      'TOTAL',
      attendees.length,
      attendees.filter(a => ['paid','partial','free'].includes((a.paymentStatus||'').toLowerCase())).length,
      attendees.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid').length,
      '',
      `₹${cur(cash.reduce((s,a) => s + parseFloat(a.paymentAmount||0), 0))}`,
      `₹${cur(online.reduce((s,a) => s + parseFloat(a.paymentAmount||0), 0))}`,
      `₹${cur(totalPayment)}`
    ]});

    const ws = makeSummarySheet(
      ['Team', 'Persons', 'Paid', 'Unpaid', 'Free', 'Cash Collected', 'Online Collected', 'Total'],
      teamRows,
      [{ wch: 20 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 16 }]
    );
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName('Team Payment Summary', used));
  }

  // ── REFERENCE: One sheet per reference + summary ──────────────────────────
  async function buildReferenceSheets(wb, attendees, busNameFn, used) {
    const refMap = {};
    attendees.forEach(a => {
      const ref = a.reference || 'Unknown';
      if (!refMap[ref]) refMap[ref] = [];
      refMap[ref].push(a);
    });

    // One sheet per reference (all people under that reference)
    Object.entries(refMap).sort((a, b) => b[1].length - a[1].length).forEach(([ref, people]) => {
      XLSX.utils.book_append_sheet(wb, makeAttSheet(people, busNameFn), safeSheetName(`Ref - ${ref}`, used));
    });

    // Reference summary table
    const refRows = Object.entries(refMap).sort((a, b) => b[1].length - a[1].length).map(([ref, people]) => {
      const paid    = people.filter(p => (p.paymentStatus || '').toLowerCase() === 'paid').length;
      const unpaid  = people.filter(p => !p.paymentStatus || p.paymentStatus.toLowerCase() === 'unpaid').length;
      const free    = people.filter(p => (p.paymentStatus || '').toLowerCase() === 'free').length;
      const present = people.filter(p => p.attendance === 'present').length;
      const total   = people.reduce((s, p) => s + parseFloat(p.paymentAmount || 0), 0);
      return { cells: [ref, people.length, present, people.length - present, paid, unpaid, free, `₹${cur(total)}`] };
    });
    refRows.push({ _total: true, cells: [
      'TOTAL', attendees.length,
      attendees.filter(a => a.attendance === 'present').length,
      attendees.filter(a => a.attendance !== 'present').length,
      attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid').length,
      attendees.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid').length,
      attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'free').length,
      `₹${cur(attendees.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0))}`
    ]});

    const ws = makeSummarySheet(
      ['Reference', 'Persons', 'Present', 'Absent', 'Paid', 'Unpaid', 'Free', 'Total Collected'],
      refRows,
      [{ wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 18 }]
    );
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName('Reference Summary', used));
  }

  // ── TRANSPORT: One sheet per bus route + summary ──────────────────────────
  async function buildTransportSheets(wb, attendees, busRoutes, busNameFn, used) {
    // Group attendees by bus route
    const routeAttendees = {};
    attendees.forEach(a => {
      const route = busNameFn(a) || 'No Bus';
      if (!routeAttendees[route]) routeAttendees[route] = [];
      routeAttendees[route].push(a);
    });

    // One sheet per route (passengers list)
    Object.entries(routeAttendees)
      .filter(([r]) => r !== 'No Bus')
      .sort((a, b) => b[1].length - a[1].length)
      .forEach(([route, passengers]) => {
        XLSX.utils.book_append_sheet(wb, makeAttSheet(passengers, busNameFn), safeSheetName(`Bus - ${route}`, used));
      });

    // Route summary table
    const routeMap = {};
    busRoutes.forEach(r => {
      routeMap[r.name] = { name: r.name, capacity: r.capacity || 0, cost: parseFloat(r.cost || 0), cpp: parseFloat(r.chargePerPassenger || 0), passengers: 0, present: 0 };
    });
    attendees.forEach(a => {
      const route = busNameFn(a);
      if (!route) return;
      if (!routeMap[route]) routeMap[route] = { name: route, capacity: 0, cost: 0, cpp: 0, passengers: 0, present: 0 };
      routeMap[route].passengers++;
      if (a.attendance === 'present') routeMap[route].present++;
    });

    const routeRows = Object.values(routeMap).map(r => {
      const revenue = r.passengers * r.cpp;
      const pl      = revenue - r.cost;
      return {
        cells: [r.name, r.capacity || '-', r.passengers, r.present, r.passengers - r.present,
          `₹${cur(r.cpp)}`, `₹${cur(revenue)}`, `₹${cur(r.cost)}`,
          `₹${cur(pl)}`]
      };
    });
    const totalPass = Object.values(routeMap).reduce((s, r) => s + r.passengers, 0);
    const totalRev  = Object.values(routeMap).reduce((s, r) => s + r.passengers * r.cpp, 0);
    const totalCost = Object.values(routeMap).reduce((s, r) => s + r.cost, 0);
    routeRows.push({ _total: true, cells: [
      'TOTAL', '', totalPass,
      Object.values(routeMap).reduce((s, r) => s + r.present, 0),
      totalPass - Object.values(routeMap).reduce((s, r) => s + r.present, 0),
      '', `₹${cur(totalRev)}`, `₹${cur(totalCost)}`, `₹${cur(totalRev - totalCost)}`
    ]});

    const ws = makeSummarySheet(
      ['Route', 'Capacity', 'Registered', 'Present', 'Absent', 'Charge/Person', 'Revenue', 'Bus Cost', 'P/L'],
      routeRows,
      [{ wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }]
    );
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName('Route Summary', used));
  }

  // ── SUMMARY SHEET ─────────────────────────────────────────────────────────
  async function buildSummarySheet(wb, attendees, busRoutes, cfg, used) {
    const present     = attendees.filter(a => a.attendance === 'present').length;
    const paid        = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid').length;
    const unpaid      = attendees.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid').length;
    const free        = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'free').length;
    const walkIns     = attendees.filter(a => a.isWalkIn).length;
    const totalAmt    = attendees.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
    const totalBusCost = busRoutes.reduce((s, r) => s + parseFloat(r.cost || 0), 0);
    const expected    = attendees.length * (cfg.chargePerPerson || 0);
    const netPL       = totalAmt - cfg.totalExpense - totalBusCost;

    const rows = [
      { cells: ['Event Name',              cfg.eventName] },
      { cells: ['Event Date',              cfg.eventDate || '—'] },
      { cells: ['Charge Per Person',       `₹${cur(cfg.chargePerPerson)}`] },
      { cells: ['', ''] },
      { cells: ['— ATTENDANCE —',         ''] },
      { cells: ['Total Registered',        attendees.length] },
      { cells: ['Present',                 present] },
      { cells: ['Absent',                  attendees.length - present] },
      { cells: ['Walk-ins',               walkIns] },
      { cells: ['Attendance Rate',         attendees.length ? Math.round(present / attendees.length * 100) + '%' : '0%'] },
      { cells: ['', ''] },
      { cells: ['— PAYMENTS —',           ''] },
      { cells: ['Paid',                    paid] },
      { cells: ['Unpaid',                  unpaid] },
      { cells: ['Free',                    free] },
      { cells: ['Total Collected',         `₹${cur(totalAmt)}`] },
      { cells: ['Expected Revenue',        `₹${cur(expected)}`] },
      { cells: ['Total Event Expense',     `₹${cur(cfg.totalExpense)}`] },
      { cells: ['Total Bus Cost',          `₹${cur(totalBusCost)}`] },
      { _total: true, cells: ['Net Profit / Loss',    `₹${cur(netPL)}`] },
    ];

    const ws = makeSummarySheet(
      ['Metric', 'Value'],
      rows,
      [{ wch: 28 }, { wch: 20 }]
    );
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName('Event Summary', used));
  }

  // ── CSV EXPORT ────────────────────────────────────────────────────────────
  async function reportToCsv(type) {
    const { attendees, busRoutes, busNameFn, cfg } = await setup();
    const slug = (cfg.eventName || type).replace(/\s+/g, '_');
    let rows = [];

    if (type === 'overview' || type === 'summary') {
      rows = [SHEET_HEADER, ...attendees.map((a, i) => toSheetRow(a, i + 1, busNameFn(a)))];
    } else if (type === 'payment') {
      const paid   = attendees.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid');
      const unpaid = attendees.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid');
      rows = [
        SHEET_HEADER,
        ['--- PAID ---'], ...paid.map((a, i) => toSheetRow(a, i + 1, busNameFn(a))),
        [], ['--- UNPAID ---'], ...unpaid.map((a, i) => toSheetRow(a, i + 1, busNameFn(a)))
      ];
    } else if (type === 'reference') {
      const refMap = {};
      attendees.forEach(a => { const r = a.reference || 'Unknown'; if (!refMap[r]) refMap[r] = []; refMap[r].push(a); });
      rows = [SHEET_HEADER];
      Object.entries(refMap).sort((a, b) => b[1].length - a[1].length).forEach(([ref, people]) => {
        rows.push([`--- ${ref} (${people.length}) ---`]);
        people.forEach((a, i) => rows.push(toSheetRow(a, i + 1, busNameFn(a))));
        rows.push([]);
      });
    } else if (type === 'transport') {
      const busNameMap = {};
      busRoutes.forEach(b => { busNameMap[b.id] = b.name; busNameMap[b.name] = b.name; });
      const routeMap = {};
      attendees.forEach(a => {
        const route = busNameFn(a) || 'No Bus';
        if (!routeMap[route]) routeMap[route] = [];
        routeMap[route].push(a);
      });
      rows = [SHEET_HEADER];
      Object.entries(routeMap).sort((a, b) => b[1].length - a[1].length).forEach(([route, people]) => {
        rows.push([`--- Bus: ${route} (${people.length}) ---`]);
        people.forEach((a, i) => rows.push(toSheetRow(a, i + 1, busNameFn(a))));
        rows.push([]);
      });
    }

    const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    Helpers.downloadBlob(blob, `Prerna_${type}_${slug}_${new Date().toISOString().slice(0, 10)}.csv`);
    Helpers.toast('CSV downloaded!', 'success');
  }

  // ── PDF (print-based) ────────────────────────────────────────────────────
  async function reportToPdf(type) {
    const { attendees, busRoutes, busNameFn, cfg } = await setup();
    const data = await (() => {
      switch(type) {
        case 'overview':  return Reports.reportOverview();
        case 'payment':   return Reports.reportPayment();
        case 'reference': return Reports.reportReference();
        case 'transport': return Reports.reportTransport();
        default:          return Reports.reportSummary();
      }
    })();

    const styles = `<style>
      body { font-family: Arial, sans-serif; color: #222; padding: 20px; font-size: 13px; }
      h1 { color: #15803d; border-bottom: 3px solid #15803d; padding-bottom: 8px; }
      h2 { color: #15803d; margin-top: 24px; font-size: 15px; }
      table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
      th { background: #15803d; color: #fff; padding: 7px 10px; text-align: left; }
      td { padding: 6px 10px; border-bottom: 1px solid #e5e7eb; }
      tr:nth-child(even) td { background: #f0fdf4; }
      .present td { background: #dcfce7 !important; }
      .unpaid td { background: #fef9c3 !important; }
      .total td { font-weight: bold; background: #bbf7d0 !important; }
      .meta { color: #888; font-size: 11px; margin-bottom: 20px; }
      @media print { h2 { page-break-before: auto; } }
    </style>`;

    let html = `${styles}
      <h1>Prerna Festival — ${type.charAt(0).toUpperCase() + type.slice(1)} Report</h1>
      <p class="meta">Generated: ${new Date().toLocaleString('en-IN')} | Event: ${cfg.eventName}</p>`;

    const makeTable = (headers, rows) => {
      let t = `<table><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr>`;
      rows.forEach(r => {
        const cls = r._total ? 'total' : '';
        t += `<tr class="${cls}">${r.cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
      });
      return t + '</table>';
    };

    if (type === 'overview') {
      const { catMap, teamMap } = data;
      html += `<h2>Overall</h2>
        ${makeTable(['Metric','Value'], [
          { cells: ['Total Registered', attendees.length] },
          { cells: ['Present', attendees.filter(a => a.attendance === 'present').length] },
          { cells: ['Absent', attendees.filter(a => a.attendance !== 'present').length] },
          { _total: true, cells: ['Attendance Rate', attendees.length ? Math.round(attendees.filter(a=>a.attendance==='present').length/attendees.length*100)+'%' : '0%'] }
        ])}
        <h2>By Category</h2>
        ${makeTable(['Category','Total','Present','Absent','Rate'],
          Object.entries(catMap).map(([c,d]) => ({ cells: [c, d.total, d.present, d.total-d.present, d.total ? Math.round(d.present/d.total*100)+'%':'0%'] }))
        )}
        <h2>By Team</h2>
        ${makeTable(['Team','Total','Present','Absent'],
          Object.entries(teamMap).sort((a,b)=>b[1].total-a[1].total).map(([t,d]) => ({ cells: [t, d.total, d.present, d.total-d.present] }))
        )}`;

    } else if (type === 'payment') {
      const { teamPayMap, totalPayment, expected, profitLoss, paidCount, unpaidCount, freeCount } = data;
      html += `<h2>Summary</h2>
        ${makeTable(['Metric','Value'], [
          { cells: ['Paid', paidCount] },
          { cells: ['Unpaid', unpaidCount] },
          { cells: ['Free', freeCount] },
          { cells: ['Total Collected', `₹${cur(totalPayment)}`] },
          { cells: ['Expected', `₹${cur(expected)}`] },
          { _total: true, cells: ['Profit / Loss', `₹${cur(profitLoss)}`] }
        ])}
        <h2>Team-wise Payment</h2>
        ${makeTable(['Team','Persons','Paid','Unpaid','Free','Cash','Online','Total'],
          Object.entries(teamPayMap).sort((a,b)=>b[1].total-a[1].total).map(([t,d]) => ({
            cells: [t, d.persons, d.paid, d.unpaid, d.free, `₹${cur(d.cash)}`, `₹${cur(d.online)}`, `₹${cur(d.total)}`]
          }))
        )}`;

    } else if (type === 'reference') {
      const { refMap } = data;
      html += `<h2>Reference Performance</h2>
        ${makeTable(['Reference','Persons','Paid','Unpaid','Free','Total'],
          Object.entries(refMap).sort((a,b)=>b[1].persons-a[1].persons).map(([r,d]) => ({
            cells: [r, d.persons, d.paid, d.unpaid, d.free, `₹${cur(d.total)}`]
          }))
        )}`;

    } else if (type === 'transport') {
      const { routeMap, totalCost, totalCollection, profitLoss } = data;
      html += `<h2>Bus Routes</h2>
        ${makeTable(['Route','Capacity','Passengers','Collection','Bus Cost','P/L'],
          [...Object.values(routeMap).map(r => ({
            cells: [r.name||'?', r.capacity||'-', r.passengers, `₹${cur(r.collection)}`, `₹${cur(r.cost)}`, `₹${cur(r.collection-r.cost)}`]
          })),
          { _total: true, cells: ['TOTAL','', Object.values(routeMap).reduce((s,r)=>s+r.passengers,0), `₹${cur(totalCollection)}`, `₹${cur(totalCost)}`, `₹${cur(profitLoss)}`] }
          ]
        )}`;

    } else {
      const { totalAttendees, totalPresent, totalWalkIns, totalPayment, totalBusCost, expected, netPL, paidCount, unpaidCount, freeCount } = data;
      html += `<h2>Event Summary</h2>
        ${makeTable(['Metric','Value'], [
          { cells: ['Event', cfg.eventName] },
          { cells: ['Date', cfg.eventDate || '—'] },
          { cells: ['Registered', totalAttendees] },
          { cells: ['Present', totalPresent] },
          { cells: ['Absent', totalAttendees - totalPresent] },
          { cells: ['Walk-ins', totalWalkIns] },
          { cells: ['Paid', paidCount] },
          { cells: ['Unpaid', unpaidCount] },
          { cells: ['Free', freeCount] },
          { cells: ['Collected', `₹${cur(totalPayment)}`] },
          { cells: ['Expected', `₹${cur(expected)}`] },
          { cells: ['Event Expense', `₹${cur(cfg.totalExpense)}`] },
          { cells: ['Bus Cost', `₹${cur(totalBusCost)}`] },
          { _total: true, cells: ['Net P/L', `₹${cur(netPL)}`] }
        ])}`;
    }

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 500);
    Helpers.toast('PDF print dialog opened', 'success');
  }

  // ── FULL ATTENDEE EXPORT (from Attendees page) ────────────────────────────
  async function exportAttendees(filtered) {
    const allAtts     = filtered || await DB.getAll(DB.STORES.attendees);
    const busRoutes   = await DB.getAll(DB.STORES.busRoutes);
    const summ        = await Reports.reportSummary();
    const cfg         = summ.cfg;
    const busNameMap  = {};
    busRoutes.forEach(b => { busNameMap[b.id] = b.name; busNameMap[b.name] = b.name; });
    const busNameFn   = a => busNameMap[a.busRouteId] || busNameMap[a.busRoute] || a.busRoute || '';

    const wb   = XLSX.utils.book_new();
    const used = new Set();

    addBaseSheets(wb, allAtts, busNameFn, used);
    await buildPaymentSheets(wb, allAtts, busNameFn, used);
    await buildTransportSheets(wb, allAtts, busRoutes, busNameFn, used);

    const slug = (cfg.eventName || 'Export').replace(/\s+/g, '_');
    XLSX.writeFile(wb, `Prerna_Attendees_${slug}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Helpers.toast('Attendee list exported!', 'success');
  }

  return { reportToExcel, reportToCsv, reportToPdf, exportAttendees };
})();
