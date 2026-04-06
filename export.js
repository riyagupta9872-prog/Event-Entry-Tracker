// ===== EXPORT MODULE =====
const Export = (() => {

  // ── SHEET FORMAT (matches the user's original Excel sheet) ────────────────
  //   Sr.No | Name | Mobile | Category | Reference | Team Name | Pickup Point |
  //   Payment Status | Payment Remarks | Mode of Payment | Payment Amt. |
  //   Attendance | Admitted by | Admitted at
  const SHEET_HEADER = [
    'Sr. No.',
    'Name',
    'Mobile number',
    'Category',
    'Reference',
    'Team Name',
    'Pickup Point',
    'Payment Status',
    'Payment Remarks',
    'Mode of Payment',
    'Payment Amt.',
    'Attendence',
    'Admitted by',
    'Admitted at'
  ];

  const SHEET_COL_WIDTHS = [
    { wch: 7  },  // Sr. No.
    { wch: 26 },  // Name
    { wch: 14 },  // Mobile
    { wch: 13 },  // Category
    { wch: 22 },  // Reference
    { wch: 16 },  // Team Name
    { wch: 18 },  // Pickup Point
    { wch: 14 },  // Payment Status
    { wch: 28 },  // Payment Remarks
    { wch: 16 },  // Mode of Payment
    { wch: 13 },  // Payment Amt.
    { wch: 18 },  // Attendance
    { wch: 20 },  // Admitted by
    { wch: 22 },  // Admitted at
  ];

  // ── Convert one attendee to a row ─────────────────────────────────────────
  function toSheetRow(a, srNo) {
    const payStatus = a.paymentStatus || (parseFloat(a.paymentAmount || 0) > 0 ? 'paid' : 'unpaid');

    // Attendance value — matching user's sheet exactly
    let attendance = 'Absent';
    if (a.attendance === 'present') {
      attendance = a.isWalkIn ? 'Present (walk-in)' : 'Presnt';
    }

    return [
      srNo,
      a.name            || '',
      a.mobile          || '',
      a.category        || '',
      a.reference       || '',
      a.team            || '',
      a.pickupLocation  || '',
      payStatus,
      a.remarks         || '',
      a.paymentMode     || '',
      parseFloat(a.paymentAmount || 0) || '',
      attendance,
      a.markedBy        || '',
      a.entryTime ? new Date(a.entryTime).toLocaleString('en-IN') : ''
    ];
  }

  // ── Style the sheet: yellow header, green present, red cell for unpaid ────
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
    const base = {
      font:      { sz: 10 },
      alignment: { vertical: 'center' },
      border: {
        top:    { style: 'thin', color: { rgb: 'DDDDDD' } },
        bottom: { style: 'thin', color: { rgb: 'DDDDDD' } },
        left:   { style: 'thin', color: { rgb: 'DDDDDD' } },
        right:  { style: 'thin', color: { rgb: 'DDDDDD' } }
      }
    };
    const presentStyle = { ...base, fill: { fgColor: { rgb: 'E2EFDA' } } };
    const walkinStyle  = { ...base, fill: { fgColor: { rgb: 'DBEAFE' } } }; // light blue for walk-in
    const absentStyle  = { ...base };
    const unpaidCell   = { ...base, fill: { fgColor: { rgb: 'FFE0E0' } } };

    const totalCols = SHEET_HEADER.length;
    for (let R = 0; R <= dataRowCount; R++) {
      const attCell = ws[XLSX.utils.encode_cell({ r: R, c: 11 })]; // Attendance col
      const payCell = ws[XLSX.utils.encode_cell({ r: R, c: 7  })]; // Payment Status col
      const attVal  = attCell?.v || '';
      const isPresent = attVal === 'Presnt';
      const isWalkin  = attVal === 'Present (walk-in)';
      const isUnpaid  = payCell && String(payCell.v).toLowerCase() === 'unpaid';

      for (let C = 0; C < totalCols; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[addr]) ws[addr] = { v: '', t: 's' };
        if (R === 0) {
          ws[addr].s = headerStyle;
        } else if (isWalkin) {
          ws[addr].s = C === 7 && isUnpaid ? unpaidCell : walkinStyle;
        } else if (isPresent) {
          ws[addr].s = C === 7 && isUnpaid ? unpaidCell : presentStyle;
        } else {
          ws[addr].s = C === 7 && isUnpaid ? unpaidCell : absentStyle;
        }
      }
    }
    ws['!rows']   = [{ hpt: 30 }, ...Array(dataRowCount).fill({ hpt: 18 })];
    ws['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', sqref: 'A2' };
  }

  // ── Build one styled attendance sheet from a list ─────────────────────────
  function makeSheet(records) {
    const rows = records.map((a, i) => toSheetRow(a, i + 1));
    const ws   = XLSX.utils.aoa_to_sheet([SHEET_HEADER, ...rows]);
    ws['!cols'] = SHEET_COL_WIDTHS;
    styleSheet(ws, rows.length);
    return ws;
  }

  // ── Safe sheet name helper ─────────────────────────────────────────────────
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

  // ── Currency helper ────────────────────────────────────────────────────────
  function cur(n) { return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0 }); }

  // ── Load event name for filename ───────────────────────────────────────────
  async function getEventSlug() {
    const summ = await Reports.reportSummary();
    return (summ.cfg.eventName || 'Event').replace(/\s+/g, '_');
  }

  // ── MAIN: Download filtered attendee list as Excel ─────────────────────────
  // Called from Reports page filter + Download button
  async function downloadFiltered(attendees, label) {
    if (!attendees || !attendees.length) {
      Helpers.toast('No records match this filter', 'warning');
      return;
    }
    const slug = await getEventSlug();
    const wb   = XLSX.utils.book_new();
    const used = new Set();
    XLSX.utils.book_append_sheet(wb, makeSheet(attendees), safeSheetName(label || 'Report', used));
    XLSX.writeFile(wb, `Prerna_${label || 'Report'}_${slug}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Helpers.toast('Excel downloaded!', 'success');
  }

  // ── ATTENDEES PAGE: Full export (all attendees, single sheet) ─────────────
  async function exportAttendees(filtered) {
    const allAtts = filtered || await DB.getAll(DB.STORES.attendees);
    const slug    = await getEventSlug();
    const wb      = XLSX.utils.book_new();
    const used    = new Set();
    XLSX.utils.book_append_sheet(wb, makeSheet(allAtts), safeSheetName('All Attendees', used));

    // Also add Present / Absent / Paid / Unpaid filter sheets
    const present = allAtts.filter(a => a.attendance === 'present');
    const absent  = allAtts.filter(a => a.attendance !== 'present');
    const paid    = allAtts.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid');
    const unpaid  = allAtts.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid');
    const free    = allAtts.filter(a => (a.paymentStatus || '').toLowerCase() === 'free');
    const presUnpaid = allAtts.filter(a => a.attendance === 'present' && (!a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid'));

    if (present.length)    XLSX.utils.book_append_sheet(wb, makeSheet(present),    safeSheetName('Present', used));
    if (absent.length)     XLSX.utils.book_append_sheet(wb, makeSheet(absent),     safeSheetName('Absent', used));
    if (paid.length)       XLSX.utils.book_append_sheet(wb, makeSheet(paid),       safeSheetName('Paid', used));
    if (unpaid.length)     XLSX.utils.book_append_sheet(wb, makeSheet(unpaid),     safeSheetName('Unpaid', used));
    if (free.length)       XLSX.utils.book_append_sheet(wb, makeSheet(free),       safeSheetName('Free', used));
    if (presUnpaid.length) XLSX.utils.book_append_sheet(wb, makeSheet(presUnpaid), safeSheetName('Present & Unpaid', used));

    XLSX.writeFile(wb, `Prerna_Attendees_${slug}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Helpers.toast('Attendee list exported!', 'success');
  }

  // ── ATTENDEES PAGE: Group-based multi-sheet export ────────────────────────
  // groupBy: 'all' | 'team' | 'category'
  async function exportAttendeesByGroup(groupBy) {
    const allAtts = await DB.getAll(DB.STORES.attendees);
    const slug    = await getEventSlug();
    const wb      = XLSX.utils.book_new();
    const used    = new Set();
    const date    = new Date().toISOString().slice(0, 10);

    if (groupBy === 'all') {
      // Single sheet — all data
      XLSX.utils.book_append_sheet(wb, makeSheet(allAtts), safeSheetName('All Attendees', used));
      XLSX.writeFile(wb, `Prerna_All_${slug}_${date}.xlsx`);
      Helpers.toast('Downloaded!', 'success');
      return;
    }

    const field  = groupBy === 'team' ? 'team' : 'category';
    const defVal = groupBy === 'team' ? 'Unassigned' : 'Unknown';
    const prefix = groupBy === 'team' ? 'Team' : 'Dept';

    // Group attendees
    const groups = {};
    allAtts.forEach(a => {
      const key = (a[field] || defVal).trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });

    // Sort groups by size descending
    const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

    // Sheet 1: Summary
    const summaryRows = [
      [groupBy === 'team' ? 'Team Name' : 'Category', 'Total', 'Present', 'Absent', 'Paid', 'Unpaid', 'Free', 'Amount Collected']
    ];
    sorted.forEach(([key, members]) => {
      const present = members.filter(m => m.attendance === 'present').length;
      const paid    = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'paid').length;
      const unpaid  = members.filter(m => !m.paymentStatus || m.paymentStatus.toLowerCase() === 'unpaid').length;
      const free    = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'free').length;
      const amt     = members.reduce((s, m) => s + parseFloat(m.paymentAmount || 0), 0);
      summaryRows.push([key, members.length, present, members.length - present, paid, unpaid, free, amt]);
    });

    // Style summary sheet
    const sumWs = XLSX.utils.aoa_to_sheet(summaryRows);
    sumWs['!cols'] = [{ wch: 22 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 18 }];
    const hStyle = {
      font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '15803D' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: { top: { style: 'thin', color: { rgb: '000000' } }, bottom: { style: 'thin', color: { rgb: '000000' } }, left: { style: 'thin', color: { rgb: '000000' } }, right: { style: 'thin', color: { rgb: '000000' } } }
    };
    const cStyle = {
      font: { sz: 10 }, alignment: { vertical: 'center' },
      border: { top: { style: 'thin', color: { rgb: 'DDDDDD' } }, bottom: { style: 'thin', color: { rgb: 'DDDDDD' } }, left: { style: 'thin', color: { rgb: 'DDDDDD' } }, right: { style: 'thin', color: { rgb: 'DDDDDD' } } }
    };
    for (let R = 0; R < summaryRows.length; R++) {
      for (let C = 0; C < 8; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!sumWs[addr]) sumWs[addr] = { v: '', t: 's' };
        sumWs[addr].s = R === 0 ? hStyle : cStyle;
      }
    }
    sumWs['!rows'] = [{ hpt: 28 }, ...Array(summaryRows.length - 1).fill({ hpt: 18 })];
    sumWs['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', sqref: 'A2' };
    XLSX.utils.book_append_sheet(wb, sumWs, safeSheetName(`${prefix} Summary`, used));

    // One sheet per group (full detail rows)
    sorted.forEach(([key, members]) => {
      XLSX.utils.book_append_sheet(wb, makeSheet(members), safeSheetName(`${prefix} - ${key}`, used));
    });

    XLSX.writeFile(wb, `Prerna_${prefix}wise_${slug}_${date}.xlsx`);
    Helpers.toast(`Downloaded ${sorted.length} ${groupBy === 'team' ? 'team' : 'category'} sheets!`, 'success');
  }

  // ── ATTENDEES PAGE: Export only currently filtered/visible rows ────────────
  // Reads current filter state from DOM
  async function exportAttendeesFiltered() {
    const allAtts  = await DB.getAll(DB.STORES.attendees);
    const slug     = await getEventSlug();
    const search   = (document.getElementById('attendees-search')?.value || '').toLowerCase();
    const teamVal  = document.getElementById('attendees-filter-team')?.value || '';
    const catVal   = document.getElementById('attendees-filter-cat')?.value || '';
    const attVal   = document.getElementById('attendees-filter-att')?.value || '';

    let filtered = allAtts;
    if (search)  filtered = filtered.filter(a => Helpers.searchFilter(a, search));
    if (teamVal) filtered = filtered.filter(a => a.team === teamVal);
    if (catVal)  filtered = filtered.filter(a => a.category === catVal);
    if (attVal)  filtered = filtered.filter(a => attVal === 'present' ? a.attendance === 'present' : a.attendance !== 'present');

    if (!filtered.length) { Helpers.toast('No records in current view', 'warning'); return; }

    const label = [teamVal, catVal, attVal].filter(Boolean).join('_') || 'Filtered';
    await downloadFiltered(filtered, label);
  }

  return { downloadFiltered, exportAttendees, exportAttendeesByGroup, exportAttendeesFiltered };
})();
