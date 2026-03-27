// ===== EXPORT MODULE =====
// Replaces export.js in the original Prerna Festival PWA.
// All function signatures are unchanged so db.js / helper.js / reports.js / app.js
// continue to work without modification.
//
// Google Sheets column order (matches "Devotee Database" sheet exactly):
//   Sr.No | Time Stamp | Name | Mobile Number | Category | Team | Reference |
//   Mode of Payment | Payment Status | Bus Route | Status | Admitted by | Admitted at

const Export = (() => {

  // ── SHARED HEADER & ROW BUILDER ──────────────────────────────────────────
  // This is the canonical 13-column layout that mirrors the Google Sheet.
  const SHEET_HEADER = [
    'Sr. No.',
    'Time Stamp',
    'Name',
    'Mobile Number',
    'Category',
    'Team',
    'Reference',
    'Mode of Payment',
    'Payment Status',
    'Bus Route',
    'Status',
    'Admitted by',
    'Admitted at'
  ];

  // Column widths (characters) aligned to approximate Google Sheets widths
  const SHEET_COL_WIDTHS = [
    { wch: 7  },  // Sr. No.
    { wch: 20 },  // Time Stamp
    { wch: 22 },  // Name
    { wch: 15 },  // Mobile Number
    { wch: 12 },  // Category
    { wch: 12 },  // Team
    { wch: 22 },  // Reference
    { wch: 18 },  // Mode of Payment
    { wch: 15 },  // Payment Status
    { wch: 18 },  // Bus Route
    { wch: 12 },  // Status
    { wch: 22 },  // Admitted by
    { wch: 22 },  // Admitted at
  ];

  // Converts one attendee record into a data row for the sheet.
  // busRoute  - resolved bus route name string (pass '' if unknown)
  // srNo      - 1-based serial number
  function toSheetRow(a, srNo, busRoute) {
    return [
      srNo,
      a.timeStamp || a.createdAt || '',        // Time Stamp (from import or creation)
      a.name        || '',                      // Name
      a.mobile      || '',                      // Mobile Number
      a.category    || '',                      // Category
      a.team        || '',                      // Team
      a.reference   || '',                      // Reference
      a.modeOfPayment || '',                    // Mode of Payment (Cash / RDD_date / Unpaid)
      // Payment Status: use stored value, else derive from paymentAmount
      a.paymentStatus
        || (parseFloat(a.paymentAmount || 0) > 0 ? 'Paid' : 'Unpaid'),
      busRoute,                                 // Bus Route (resolved name)
      a.attendance === 'present' ? 'Present' : '',  // Status
      a.markedBy    || '',                      // Admitted by
      a.entryTime   || ''                       // Admitted at
    ];
  }

  // Applies the yellow header style + data cell borders + conditional row fills.
  // Works with SheetJS (xlsx) cell objects.
  function styleSheet(ws, dataRowCount) {
    const headerStyle = {
      font:      { bold: true, sz: 10, color: { rgb: '000000' } },
      fill:      { fgColor: { rgb: 'FFD966' } },     // Google Sheets yellow
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
    const paidStyle    = { ...cellStyle, fill: { fgColor: { rgb: 'DDEEFF' } } }; // light blue

    const totalCols = SHEET_HEADER.length;
    for (let R = 0; R <= dataRowCount; R++) {
      for (let C = 0; C < totalCols; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[addr]) ws[addr] = { v: '', t: 's' };
        if (R === 0) {
          ws[addr].s = headerStyle;
        } else {
          // Status col (index 10) = 'Present' → green row
          const statusCell = ws[XLSX.utils.encode_cell({ r: R, c: 10 })];
          const isPresent  = statusCell && statusCell.v === 'Present';
          // Payment Status col (index 8) = 'Paid' → blue cell
          const isPaidCell = C === 8 && ws[addr] && ws[addr].v === 'Paid';
          ws[addr].s = isPresent ? presentStyle : (isPaidCell ? paidStyle : cellStyle);
        }
      }
    }
    ws['!rows'] = [
      { hpt: 30 },
      ...Array(dataRowCount).fill({ hpt: 18 })
    ];
    // Freeze header row
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', sqref: 'A2' };
  }

  // Creates one styled attendance sheet (all / present-only / absent-only)
  function makeAttSheet(records, busNameFn, label) {
    const rows = records.map((a, i) => toSheetRow(a, i + 1, busNameFn(a)));
    const ws   = XLSX.utils.aoa_to_sheet([SHEET_HEADER, ...rows]);
    ws['!cols'] = SHEET_COL_WIDTHS;
    styleSheet(ws, rows.length);
    return ws;
  }

  // Adds a sheet to workbook
  function addSheet(wb, name, data, colWidths) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    if (colWidths) ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  // ── HELPER: get report data from Reports module ────────────────────────────
  async function getReportData(type) {
    switch (type) {
      case 'overview':   return Reports.reportOverview();
      case 'payment':    return Reports.reportPayment();
      case 'reference':  return Reports.reportReference();
      case 'transport':  return Reports.reportTransport();
      case 'summary':    return Reports.reportSummary();
      default:           return null;
    }
  }

  // ── EXCEL EXPORT ──────────────────────────────────────────────────────────
  // Called from Reports render buttons: Export.reportToExcel('overview') etc.
  async function reportToExcel(type) {
    const data   = await getReportData(type);
    const summ   = await Reports.reportSummary();
    const cfg    = summ.cfg;
    const wb     = XLSX.utils.book_new();

    // Always fetch full attendee list for the canonical sheet
    const attendees  = await DB.getAll(DB.STORES.attendees);
    const busRoutes  = await DB.getAll(DB.STORES.busRoutes);
    const busNameMap = {};
    busRoutes.forEach(b => { busNameMap[b.id] = b.name; busNameMap[b.name] = b.name; });

    // busNameFn resolves busRoute field (may be name string or id)
    const busNameFn = a => busNameMap[a.busRouteId] || busNameMap[a.busRoute] || a.busRoute || '';

    // ── Sheet 1: Devotee Database  (all attendees, Google Sheets format) ──
    const ws1 = makeAttSheet(attendees, busNameFn, 'Devotee Database');
    XLSX.utils.book_append_sheet(wb, ws1, 'Devotee Database');

    // ── Sheet 2: Present Only ──
    const present = attendees.filter(a => a.attendance === 'present');
    const ws2 = makeAttSheet(present, busNameFn, 'Present Only');
    XLSX.utils.book_append_sheet(wb, ws2, 'Present Only');

    // ── Sheet 3: Absent ──
    const absent = attendees.filter(a => a.attendance !== 'present');
    const ws3 = makeAttSheet(absent, busNameFn, 'Absent');
    XLSX.utils.book_append_sheet(wb, ws3, 'Absent');

    // ── Report-specific sheets ──────────────────────────────────────────────
    if (type === 'overview') {
      const { catMap, teamMap, serviceDevotees, activeDevotees } = data;

      addSheet(wb, 'By Category', [
        ['Category', 'Total Expected', 'Present', 'Absent', 'Rate'],
        ...Object.entries(catMap).map(([c, d]) => [
          c, d.total, d.present, d.total - d.present,
          d.total ? Math.round(d.present / d.total * 100) + '%' : '0%'
        ])
      ], [{ wch: 18 }, { wch: 15 }, { wch: 10 }, { wch: 10 }, { wch: 8 }]);

      addSheet(wb, 'By Team', [
        ['Team', 'Total', 'Present', 'Absent'],
        ...Object.entries(teamMap).sort((a, b) => b[1].total - a[1].total)
          .map(([t, d]) => [t, d.total, d.present, d.total - d.present])
      ], [{ wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 }]);

      addSheet(wb, 'Devotees', [
        ['Type', 'Count'],
        ['Service Devotees',     serviceDevotees.length],
        ['Non-Service Devotees', attendees.length - serviceDevotees.length],
        ['Active Devotees',      activeDevotees.length],
        ['Inactive Devotees',    attendees.length - activeDevotees.length],
      ], [{ wch: 22 }, { wch: 10 }]);
    }

    if (type === 'payment') {
      const { teamPayMap, totalPayment, expected, profitLoss } = data;

      addSheet(wb, 'Payment by Team', [
        ['Team', 'Persons', 'Before Event (₹)', 'After Event (₹)', 'Total (₹)'],
        ...Object.entries(teamPayMap).map(([t, d]) => [t, d.persons, d.before, d.after, d.total]),
        ['TOTAL', Object.values(teamPayMap).reduce((s, d) => s + d.persons, 0), '', '', totalPayment]
      ], [{ wch: 18 }, { wch: 10 }, { wch: 18 }, { wch: 18 }, { wch: 14 }]);

      addSheet(wb, 'Payment Summary', [
        ['Metric', 'Value'],
        ['Total Collected (₹)', totalPayment],
        ['Expected Revenue (₹)', expected],
        ['Profit / Loss (₹)', profitLoss]
      ], [{ wch: 24 }, { wch: 16 }]);
    }

    if (type === 'reference') {
      const { refMap } = data;
      addSheet(wb, 'Reference Performance', [
        ['Reference', 'Persons', 'Total Payment (₹)'],
        ...Object.entries(refMap).sort((a, b) => b[1].total - a[1].total)
          .map(([r, d]) => [r, d.persons, d.total])
      ], [{ wch: 24 }, { wch: 10 }, { wch: 18 }]);
    }

    if (type === 'transport') {
      const { routeMap, totalCost, totalCollection, profitLoss } = data;
      const busRows = Object.values(routeMap).map((r, i) => [
        i + 1, r.name || 'Unknown', r.capacity || '—',
        r.passengers, r.collection, r.cost, r.collection - r.cost
      ]);
      addSheet(wb, 'Bus Routes', [
        ['Sr.', 'Route', 'Capacity', 'Passengers', 'Collection (₹)', 'Bus Cost (₹)', 'P/L (₹)'],
        ...busRows,
        ['', 'TOTAL', '',
          busRows.reduce((s, r) => s + r[3], 0),
          totalCollection, totalCost, profitLoss
        ]
      ], [{ wch: 5 }, { wch: 22 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 12 }]);
    }

    if (type === 'summary') {
      const { totalAttendees, totalPresent, totalWalkIns, totalPayment, totalBusCost, expected, netPL } = data;

      addSheet(wb, 'Event Summary', [
        ['Metric', 'Value'],
        ['Event Name',              cfg.eventName],
        ['Event Date',              cfg.eventDate],
        ['', ''],
        ['── ATTENDANCE ──',        ''],
        ['Total Registered',        totalAttendees],
        ['Total Present',           totalPresent],
        ['Total Absent',            totalAttendees - totalPresent],
        ['Walk-ins',                totalWalkIns],
        ['Attendance Rate',         totalAttendees ? Math.round(totalPresent / totalAttendees * 100) + '%' : '0%'],
        ['', ''],
        ['── FINANCIALS ──',        ''],
        ['Charge Per Person (₹)',   cfg.chargePerPerson],
        ['Expected Revenue (₹)',    expected],
        ['Total Payment Collected (₹)', totalPayment],
        ['Total Bus Cost (₹)',      totalBusCost],
        ['Net Profit / Loss (₹)',   netPL]
      ], [{ wch: 30 }, { wch: 20 }]);
    }

    const eventSlug = (cfg.eventName || 'Report').replace(/\s+/g, '_');
    XLSX.writeFile(wb, `Prerna_${type}_${eventSlug}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Helpers.toast('Excel report downloaded!', 'success');
  }

  // ── CSV EXPORT ───────────────────────────────────────────────────────────
  // Called from Reports render buttons: Export.reportToCsv('overview') etc.
  // Uses the same 13-column Google Sheets column order.
  async function reportToCsv(type) {
    const attendees = await DB.getAll(DB.STORES.attendees);
    const busRoutes = await DB.getAll(DB.STORES.busRoutes);
    const busNameMap = {};
    busRoutes.forEach(b => { busNameMap[b.id] = b.name; busNameMap[b.name] = b.name; });
    const busNameFn = a => busNameMap[a.busRouteId] || busNameMap[a.busRoute] || a.busRoute || '';

    let rows = [];

    if (type === 'overview' || type === 'attendance' || type === 'summary') {
      // Full attendance list in Google Sheets format
      rows = [
        SHEET_HEADER,
        ...attendees.map((a, i) => toSheetRow(a, i + 1, busNameFn(a)))
      ];
    } else if (type === 'payment') {
      const data = await getReportData('payment');
      const { teamPayMap, totalPayment } = data;
      rows = [
        ['Team', 'Persons', 'Before Event (₹)', 'After Event (₹)', 'Total (₹)'],
        ...Object.entries(teamPayMap).map(([t, d]) => [t, d.persons, d.before, d.after, d.total]),
        ['TOTAL', Object.values(teamPayMap).reduce((s, d) => s + d.persons, 0), '', '', totalPayment]
      ];
    } else if (type === 'reference') {
      const { refMap } = await getReportData('reference');
      rows = [
        ['Reference', 'Persons', 'Total Payment (₹)'],
        ...Object.entries(refMap).sort((a, b) => b[1].total - a[1].total)
          .map(([r, d]) => [r, d.persons, d.total])
      ];
    } else if (type === 'transport') {
      const { routeMap, totalCost, totalCollection, profitLoss } = await getReportData('transport');
      rows = [
        ['Route', 'Passengers', 'Collection (₹)', 'Bus Cost (₹)', 'P/L (₹)'],
        ...Object.values(routeMap).map(r => [r.name, r.passengers, r.collection, r.cost, r.collection - r.cost]),
        ['TOTAL',
          Object.values(routeMap).reduce((s, r) => s + r.passengers, 0),
          totalCollection, totalCost, profitLoss
        ]
      ];
    }

    const csv = rows
      .map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n');

    // UTF-8 BOM so Excel opens without encoding issues
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const summ  = await Reports.reportSummary();
    const slug  = (summ.cfg.eventName || type).replace(/\s+/g, '_');
    Helpers.downloadBlob(blob, `Prerna_${type}_${slug}_${new Date().toISOString().slice(0, 10)}.csv`);
    Helpers.toast('CSV downloaded!', 'success');
  }

  // ── PDF EXPORT (print-based) ──────────────────────────────────────────────
  async function reportToPdf(type) {
    const data = await getReportData(type);
    const summ = await Reports.reportSummary();
    const cfg  = summ.cfg;

    const styles = `
      <style>
        body { font-family: Arial, sans-serif; color: #222; padding: 20px; }
        h1 { color: #16a34a; border-bottom: 3px solid #16a34a; padding-bottom: 8px; }
        h2 { color: #15803d; margin-top: 24px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
        th { background: #15803d; color: #ffffff; padding: 8px 10px; text-align: left; }
        td { padding: 7px 10px; border-bottom: 1px solid #ddd; }
        tr:nth-child(even) td { background: #f0fdf4; }
        .total-row td { font-weight: bold; background: #dcfce7; color: #15803d; }
        .meta { color: #888; font-size: 12px; margin-bottom: 20px; }
      </style>
    `;

    let html = `${styles}
      <h1>🌿 Prerna Festival — ${type.charAt(0).toUpperCase() + type.slice(1)} Report</h1>
      <p class="meta">Generated: ${new Date().toLocaleString()} | Event: ${cfg.eventName} | Date: ${cfg.eventDate || '—'}</p>`;

    if (type === 'overview') {
      const { attendees, present, catMap, teamMap } = data;
      html += `<h2>Overall Attendance</h2>
        <table><tr><th>Metric</th><th>Value</th></tr>
          <tr><td>Total Registered</td><td>${attendees.length}</td></tr>
          <tr><td>Present</td><td>${present.length}</td></tr>
          <tr><td>Absent</td><td>${attendees.length - present.length}</td></tr>
          <tr class="total-row"><td>Attendance Rate</td><td>${attendees.length ? Math.round(present.length / attendees.length * 100) : 0}%</td></tr>
        </table>`;
      html += `<h2>Category Breakdown</h2><table><tr><th>Category</th><th>Total</th><th>Present</th><th>Absent</th><th>Rate</th></tr>`;
      Object.entries(catMap).forEach(([c, d]) => {
        html += `<tr><td>${c}</td><td>${d.total}</td><td>${d.present}</td><td>${d.total - d.present}</td><td>${d.total ? Math.round(d.present / d.total * 100) : 0}%</td></tr>`;
      });
      html += `</table><h2>Team Breakdown</h2><table><tr><th>Team</th><th>Total</th><th>Present</th><th>Absent</th></tr>`;
      Object.entries(teamMap).forEach(([t, d]) => {
        html += `<tr><td>${t}</td><td>${d.total}</td><td>${d.present}</td><td>${d.total - d.present}</td></tr>`;
      });
      html += `</table>`;

    } else if (type === 'payment') {
      const { teamPayMap, totalPayment, expected, profitLoss } = data;
      html += `<h2>Team Payment Analysis</h2>
        <table><tr><th>Team</th><th>Persons</th><th>Before Event</th><th>After Event</th><th>Total</th></tr>`;
      Object.entries(teamPayMap).forEach(([t, d]) => {
        html += `<tr><td>${t}</td><td>${d.persons}</td><td>₹${d.before.toLocaleString('en-IN')}</td><td>₹${d.after.toLocaleString('en-IN')}</td><td>₹${d.total.toLocaleString('en-IN')}</td></tr>`;
      });
      html += `<tr class="total-row"><td>TOTAL</td><td></td><td></td><td></td><td>₹${totalPayment.toLocaleString('en-IN')}</td></tr></table>
        <p>Expected: ₹${expected.toLocaleString('en-IN')} &nbsp;|&nbsp; P/L: ₹${profitLoss.toLocaleString('en-IN')}</p>`;

    } else if (type === 'reference') {
      const { refMap } = data;
      html += `<h2>Reference Performance</h2>
        <table><tr><th>Reference</th><th>Persons</th><th>Total Payment</th></tr>`;
      Object.entries(refMap).forEach(([r, d]) => {
        html += `<tr><td>${r}</td><td>${d.persons}</td><td>₹${d.total.toLocaleString('en-IN')}</td></tr>`;
      });
      html += `</table>`;

    } else if (type === 'transport') {
      const { routeMap, totalCost, totalCollection, profitLoss } = data;
      html += `<h2>Bus Route Economics</h2>
        <table><tr><th>Route</th><th>Passengers</th><th>Collection</th><th>Bus Cost</th><th>P/L</th></tr>`;
      Object.values(routeMap).forEach(r => {
        const pl = r.collection - r.cost;
        html += `<tr><td>${r.name}</td><td>${r.passengers}</td><td>₹${r.collection.toLocaleString('en-IN')}</td><td>₹${r.cost.toLocaleString('en-IN')}</td><td style="color:${pl >= 0 ? '#16a34a' : '#dc2626'}">₹${pl.toLocaleString('en-IN')}</td></tr>`;
      });
      html += `<tr class="total-row"><td>TOTAL</td><td>${Object.values(routeMap).reduce((s,r)=>s+r.passengers,0)}</td><td>₹${totalCollection.toLocaleString('en-IN')}</td><td>₹${totalCost.toLocaleString('en-IN')}</td><td>₹${profitLoss.toLocaleString('en-IN')}</td></tr></table>`;

    } else if (type === 'summary') {
      const { totalAttendees, totalPresent, totalWalkIns, totalPayment, totalBusCost, expected, netPL } = data;
      html += `<h2>Event Financial Summary</h2>
        <table><tr><th>Metric</th><th>Value</th></tr>
          <tr><td>Event Name</td><td>${cfg.eventName}</td></tr>
          <tr><td>Event Date</td><td>${cfg.eventDate || '—'}</td></tr>
          <tr><td>Total Registered</td><td>${totalAttendees}</td></tr>
          <tr><td>Total Present</td><td>${totalPresent}</td></tr>
          <tr><td>Absent</td><td>${totalAttendees - totalPresent}</td></tr>
          <tr><td>Walk-ins</td><td>${totalWalkIns}</td></tr>
          <tr><td>Attendance Rate</td><td>${totalAttendees ? Math.round(totalPresent / totalAttendees * 100) : 0}%</td></tr>
          <tr><td>Charge Per Person</td><td>₹${Number(cfg.chargePerPerson).toLocaleString('en-IN')}</td></tr>
          <tr><td>Expected Revenue</td><td>₹${expected.toLocaleString('en-IN')}</td></tr>
          <tr><td>Total Payment Collected</td><td>₹${totalPayment.toLocaleString('en-IN')}</td></tr>
          <tr><td>Total Bus Cost</td><td>₹${totalBusCost.toLocaleString('en-IN')}</td></tr>
          <tr class="total-row"><td>Net Profit / Loss</td><td>₹${netPL.toLocaleString('en-IN')}</td></tr>
        </table>`;
    }

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
    Helpers.toast('PDF print dialog opened', 'success');
  }

  // ── FULL ATTENDEE LIST EXPORT ────────────────────────────────────────────
  // Called from: Export.exportAttendees(filtered?)
  // Produces a 4-sheet workbook in the Google Sheets column format.
  async function exportAttendees(filtered) {
    const allAttendees = filtered || await DB.getAll(DB.STORES.attendees);
    const busRoutes    = await DB.getAll(DB.STORES.busRoutes);
    const summ         = await Reports.reportSummary();
    const cfg          = summ.cfg;

    const busNameMap = {};
    busRoutes.forEach(b => { busNameMap[b.id] = b.name; busNameMap[b.name] = b.name; });
    const busNameFn = a => busNameMap[a.busRouteId] || busNameMap[a.busRoute] || a.busRoute || '';

    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Devotee Database (all) ──
    const ws1 = makeAttSheet(allAttendees, busNameFn, 'Devotee Database');
    XLSX.utils.book_append_sheet(wb, ws1, 'Devotee Database');

    // ── Sheet 2: Present Only ──
    const present = allAttendees.filter(a => a.attendance === 'present');
    const ws2 = makeAttSheet(present, busNameFn, 'Present Only');
    XLSX.utils.book_append_sheet(wb, ws2, 'Present Only');

    // ── Sheet 3: Absent ──
    const absent = allAttendees.filter(a => a.attendance !== 'present');
    const ws3 = makeAttSheet(absent, busNameFn, 'Absent');
    XLSX.utils.book_append_sheet(wb, ws3, 'Absent');

    // ── Sheet 4: Bus-wise Summary ──
    const busMap = {};
    busRoutes.forEach(b => {
      busMap[b.id] = {
        name:    b.name,
        capacity: b.capacity || 0,
        cost:    parseFloat(b.cost || 0),
        cpp:     parseFloat(b.chargePerPassenger || 0),
        total:   0, present: 0
      };
    });
    allAttendees.forEach(a => {
      const key = a.busRouteId || a.busRoute;
      if (key && busMap[key]) {
        busMap[key].total++;
        if (a.attendance === 'present') busMap[key].present++;
      }
    });

    const busRows = Object.values(busMap).map((b, i) => {
      const revenue = b.total * b.cpp;
      const pl      = revenue - b.cost;
      return [i + 1, b.name, b.capacity, b.total, b.present, b.total - b.present, b.cpp, revenue, b.cost, pl];
    });
    const totals = [
      '', 'TOTAL', '',
      busRows.reduce((s, r) => s + r[3], 0),
      busRows.reduce((s, r) => s + r[4], 0),
      busRows.reduce((s, r) => s + r[5], 0),
      '',
      busRows.reduce((s, r) => s + r[7], 0),
      busRows.reduce((s, r) => s + r[8], 0),
      busRows.reduce((s, r) => s + r[9], 0)
    ];
    addSheet(wb, 'Bus Summary', [
      ['Sr.', 'Bus Route', 'Capacity', 'Registered', 'Present', 'Absent', 'Charge/Person (₹)', 'Revenue (₹)', 'Bus Cost (₹)', 'P/L (₹)'],
      ...busRows,
      totals
    ], [
      { wch: 5 }, { wch: 22 }, { wch: 10 }, { wch: 12 },
      { wch: 10 }, { wch: 10 }, { wch: 18 }, { wch: 15 }, { wch: 14 }, { wch: 12 }
    ]);

    const eventSlug = (cfg.eventName || 'Export').replace(/\s+/g, '_');
    XLSX.writeFile(wb, `Prerna_Attendees_${eventSlug}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Helpers.toast('Attendee list exported!', 'success');
  }

  return { reportToExcel, reportToCsv, reportToPdf, exportAttendees };
})();
