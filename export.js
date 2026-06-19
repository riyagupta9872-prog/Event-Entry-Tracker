// ===== EXPORT MODULE =====
// Uses ExcelJS for fully-formatted Excel output (SheetJS CE ignores cell styles)
const Export = (() => {

  const SHEET_HEADER = [
    'Sr. No.', 'Name', 'Mobile number', 'Category', 'Reference',
    'Team Name', 'Area / Zone', 'Pickup Point', 'Payment Status', 'Payment Remarks',
    'Mode of Payment', 'Payment Amt.', 'Attendence', 'Admitted by', 'Admitted at',
    'Payment Timing', 'Boarded Bus'
  ];

  const COL_WIDTHS = [7, 26, 14, 13, 22, 16, 14, 18, 14, 28, 16, 13, 18, 20, 22, 16, 18];

  // ── ExcelJS ARGB helper (ExcelJS needs alpha prefix) ──────────────────────
  function argb(hex) { return 'FF' + hex.toUpperCase(); }
  function solidFill(hex) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(hex) } }; }
  function thinBorder(hex) {
    const s = { style: 'thin', color: { argb: argb(hex) } };
    return { top: s, bottom: s, left: s, right: s };
  }

  // ── Colour tokens ──────────────────────────────────────────────────────────
  const C = {
    headerBg:    '15803D', headerBorder: '0F5C2E',
    presentBg:   'DCFCE7', presentText:  '14532D', presentBorder: 'BBF7D0',
    walkinBg:    'DBEAFE', walkinText:   '1E3A5F', walkinBorder:  'BFDBFE',
    unpaidRowBg: 'FFF1F2', unpaidText:   '9F1239', unpaidBorder:  'FECDD3',
    absentBg:    'FFFFFF', absentBorder: 'E2E8F0',
    // Badge fills
    badgeUnpaid: 'DC2626', badgeUnpaidBorder: 'B91C1C',
    badgePaid:   '16A34A', badgePaidBorder:   '15803D',
    badgeFree:   '1D4ED8', badgeFreeBorder:   '1E40AF',
    attPres:     '16A34A', attPresBorder:     '15803D',
    attAbs:      'FED7AA', attAbsText:        '92400E', attAbsBorder: 'FB923C',
  };

  // ── Convert one attendee to a data array ──────────────────────────────────
  function toRow(a, srNo) {
    const ps = a.paymentStatus || (parseFloat(a.paymentAmount || 0) > 0 ? 'paid' : 'unpaid');
    let att = 'Absent';
    if (a.attendance === 'present') att = a.isWalkIn ? 'Present (walk-in)' : 'Present';

    // Payment Timing: paidAtEvent flag = gate collection; paid/free without flag = before event
    let timing = '';
    const psLow = (a.paymentStatus || '').toLowerCase();
    if (a.paidAtEvent) {
      timing = 'On Event Date';
    } else if (psLow === 'paid' || psLow === 'free' || parseFloat(a.paymentAmount || 0) > 0) {
      timing = 'Before Event';
    }

    return [
      srNo,
      a.name           || '',
      a.mobile         || '',
      a.category       || '',
      a.reference      || '',
      a.team           || '',
      a.area           || '',
      a.pickupLocation || '',
      ps,
      a.remarks        || '',
      a.paymentMode    || '',
      parseFloat(a.paymentAmount || 0) || '',
      att,
      a.markedBy       || '',
      a.entryTime ? new Date(a.entryTime).toLocaleString('en-IN') : '',
      timing,
      a.boardedBus || ''
    ];
  }

  // ── Style a header row ─────────────────────────────────────────────────────
  function applyHeaderStyle(row) {
    row.height = 34;
    row.eachCell({ includeEmpty: true }, cell => {
      cell.font      = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
      cell.fill      = solidFill(C.headerBg);
      cell.border    = thinBorder(C.headerBorder);
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
  }

  // ── Style a data row based on attendance + payment ─────────────────────────
  function applyDataRowStyle(row, a) {
    const ps       = (a.paymentStatus || '').toLowerCase();
    const isPresent = a.attendance === 'present';
    const isWalkin  = isPresent && !!a.isWalkIn;
    const isUnpaid  = ps === 'unpaid' || ps === '' || ps === 'partial';
    const isFree    = ps === 'free';

    // Base row colour
    let rowBg, rowText, rowBdr;
    if (isUnpaid)       { rowBg = C.unpaidRowBg; rowText = C.unpaidText;   rowBdr = C.unpaidBorder; }
    else if (isWalkin)  { rowBg = C.walkinBg;    rowText = C.walkinText;   rowBdr = C.walkinBorder; }
    else if (isPresent) { rowBg = C.presentBg;   rowText = C.presentText;  rowBdr = C.presentBorder; }
    else                { rowBg = C.absentBg;    rowText = '1A1A1A';       rowBdr = C.absentBorder; }

    row.height = 20;

    row.eachCell({ includeEmpty: true }, (cell, col) => {
      // Default base style
      cell.fill      = solidFill(rowBg);
      cell.font      = { size: 10, color: { argb: argb(rowText) } };
      cell.border    = thinBorder(rowBdr);
      cell.alignment = { vertical: 'middle' };

      // Col 8 — Payment Status: coloured badge cell
      if (col === 8) {
        if (isUnpaid) {
          cell.fill   = solidFill(C.badgeUnpaid);
          cell.font   = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.border = thinBorder(C.badgeUnpaidBorder);
        } else if (isFree) {
          cell.fill   = solidFill('DBEAFE');
          cell.font   = { bold: true, size: 10, color: { argb: argb(C.badgeFree) } };
          cell.border = thinBorder(C.badgeFreeBorder);
        } else {
          cell.fill   = solidFill('DCFCE7');
          cell.font   = { bold: true, size: 10, color: { argb: argb(C.badgePaid) } };
          cell.border = thinBorder(C.badgePaidBorder);
        }
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }

      // Col 12 — Attendance: coloured badge cell
      if (col === 12) {
        if (isPresent) {
          cell.fill   = solidFill(C.attPres);
          cell.font   = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
          cell.border = thinBorder(C.attPresBorder);
        } else {
          cell.fill   = solidFill(C.attAbs);
          cell.font   = { bold: true, size: 10, color: { argb: argb(C.attAbsText) } };
          cell.border = thinBorder(C.attAbsBorder);
        }
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }

      // Col 15 — Payment Timing: green = Before Event, orange = On Event Date
      if (col === 15) {
        const val = cell.value || '';
        if (val === 'On Event Date') {
          cell.fill   = solidFill('FFF7ED');
          cell.font   = { bold: true, size: 10, color: { argb: argb('C2410C') } };
          cell.border = thinBorder('FED7AA');
        } else if (val === 'Before Event') {
          cell.fill   = solidFill('F0FDF4');
          cell.font   = { bold: true, size: 10, color: { argb: argb('15803D') } };
          cell.border = thinBorder('BBF7D0');
        }
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });
  }

  // ── Build a styled attendance worksheet and append to workbook ────────────
  function addAttSheet(wb, sheetName, records) {
    const ws = wb.addWorksheet(sheetName);

    // Define columns (sets widths + adds header row)
    ws.columns = COL_WIDTHS.map((w, i) => ({
      header: SHEET_HEADER[i], key: `c${i}`, width: w
    }));

    applyHeaderStyle(ws.getRow(1));

    records.forEach((a, idx) => {
      const dataRow = toRow(a, idx + 1);
      const row = ws.addRow(dataRow);
      applyDataRowStyle(row, a);
    });

    // Freeze header row
    ws.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];
    return ws;
  }

  // ── Build a styled summary worksheet ─────────────────────────────────────
  function addSummarySheet(wb, sheetName, groupLabel, groups) {
    const ws = wb.addWorksheet(sheetName);
    ws.columns = [
      { header: groupLabel,         key: 'grp',     width: 24 },
      { header: 'Total',            key: 'total',   width: 9  },
      { header: 'Present',          key: 'present', width: 11 },
      { header: 'Absent',           key: 'absent',  width: 11 },
      { header: 'Paid',             key: 'paid',    width: 9  },
      { header: 'Unpaid',           key: 'unpaid',  width: 11 },
      { header: 'Free',             key: 'free',    width: 9  },
      { header: 'Amount Collected', key: 'amt',     width: 22 },
    ];
    applyHeaderStyle(ws.getRow(1));

    let totals = { total: 0, present: 0, paid: 0, unpaid: 0, free: 0, amt: 0 };

    groups.forEach(([key, members], idx) => {
      const present = members.filter(m => m.attendance === 'present').length;
      const paid    = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'paid').length;
      const unpaid  = members.filter(m => !m.paymentStatus || m.paymentStatus.toLowerCase() === 'unpaid').length;
      const free    = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'free').length;
      const amt     = members.reduce((s, m) => s + parseFloat(m.paymentAmount || 0), 0);
      totals.total += members.length; totals.present += present;
      totals.paid += paid; totals.unpaid += unpaid; totals.free += free; totals.amt += amt;

      const row = ws.addRow([key, members.length, present, members.length - present, paid, unpaid, free, amt]);
      row.height = 20;
      const bg = idx % 2 === 0 ? 'F0FDF4' : 'FFFFFF';
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill      = solidFill(bg);
        cell.font      = { size: 10 };
        cell.border    = thinBorder('D1FAE5');
        cell.alignment = { vertical: 'middle' };
      });
      // Highlight non-zero Unpaid column red
      if (unpaid > 0) {
        const uc = row.getCell(6);
        uc.fill = solidFill('FEE2E2');
        uc.font = { size: 10, bold: true, color: { argb: argb('991B1B') } };
      }
      // Highlight Amount column green
      const ac = row.getCell(8);
      ac.font = { size: 10, bold: amt > 0, color: { argb: argb('15803D') } };
    });

    // Totals row
    const totRow = ws.addRow([
      'TOTAL', totals.total, totals.present, totals.total - totals.present,
      totals.paid, totals.unpaid, totals.free, totals.amt
    ]);
    totRow.height = 24;
    totRow.eachCell({ includeEmpty: true }, cell => {
      cell.fill      = solidFill('DCFCE7');
      cell.font      = { bold: true, size: 10, color: { argb: argb('14532D') } };
      cell.border    = thinBorder('86EFAC');
      cell.alignment = { vertical: 'middle' };
    });

    ws.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];
    return ws;
  }

  // ── Safe sheet name helper ─────────────────────────────────────────────────
  function safeSheetName(raw, usedNames) {
    let name = String(raw || 'Sheet').replace(/[\\\/\?\*\[\]:]/g, '').trim().slice(0, 31);
    if (!name) name = 'Sheet';
    let candidate = name;
    let i = 2;
    while (usedNames.has(candidate.toLowerCase())) { candidate = name.slice(0, 28) + ` ${i++}`; }
    usedNames.add(candidate.toLowerCase());
    return candidate;
  }

  // ── Trigger browser file download ─────────────────────────────────────────
  async function saveWorkbook(wb, filename) {
    const buffer = await wb.xlsx.writeBuffer();
    const blob   = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url    = URL.createObjectURL(blob);
    const a      = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
  }

  // ── Load event name slug for filenames ─────────────────────────────────────
  async function getEventSlug() {
    const summ = await Reports.reportSummary();
    return (summ.cfg.eventName || 'Event').replace(/\s+/g, '_');
  }

  // ── PUBLIC: Multi-sheet download grouped by a field (team/category/reference) ─
  // Sheet 1: All Attendees (combined) → Sheet 2: Summary → Sheet 3+: one per group
  async function downloadFilteredByGroup(attendees, groupField, label) {
    if (!attendees || !attendees.length) {
      Helpers.toast('No records match this filter', 'warning');
      return;
    }
    const slug   = await getEventSlug();
    const wb     = new ExcelJS.Workbook();
    const used   = new Set();
    const date   = new Date().toISOString().slice(0, 10);
    const defVal = groupField === 'team' ? 'Unassigned' : groupField === 'boardedBus' ? 'No Bus' : 'Unknown';
    const prefix = groupField === 'team' ? 'Team'
                 : groupField === 'category' ? 'Category'
                 : groupField === 'boardedBus' ? 'Bus'
                 : 'Reference';
    const sumLbl = groupField === 'team' ? 'Team Name'
                 : groupField === 'category' ? 'Category'
                 : groupField === 'boardedBus' ? 'Bus'
                 : 'Reference';

    // Normalize group keys (case-insensitive, trimmed) but display canonical name
    const groupMap = {};   // normalizedKey → members[]
    const dispMap  = {};   // normalizedKey → { displayName: count }
    attendees.forEach(a => {
      const raw  = ((a[groupField] || '').trim()) || defVal;
      const key  = raw.toLowerCase();
      if (!groupMap[key]) { groupMap[key] = []; dispMap[key] = {}; }
      groupMap[key].push(a);
      dispMap[key][raw] = (dispMap[key][raw] || 0) + 1;
    });

    // Canonical display name = most frequent original spelling
    const canonicalName = key => {
      const entries = Object.entries(dispMap[key] || {}).sort((a, b) => b[1] - a[1]);
      return entries.length ? entries[0][0] : key;
    };

    const sorted = Object.entries(groupMap)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, members]) => [canonicalName(key), members]);

    // Sheet 1: combined "All Attendees"
    addAttSheet(wb, safeSheetName('All Attendees', used), attendees);
    // Sheet 2: summary (count per group)
    addSummarySheet(wb, safeSheetName(`${prefix} Summary`, used), sumLbl, sorted);
    // Sheet 3+: one sheet per group
    sorted.forEach(([displayName, members]) =>
      addAttSheet(wb, safeSheetName(`${prefix} - ${displayName}`, used), members)
    );

    await saveWorkbook(wb, `Prerna_${label || prefix + 'wise'}_${slug}_${date}.xlsx`);
    Helpers.toast(`Downloaded: All + ${sorted.length} ${prefix.toLowerCase()} sheet${sorted.length !== 1 ? 's' : ''}!`, 'success');
  }

  // ── PUBLIC: Download any filtered list as single-sheet Excel ──────────────
  async function downloadFiltered(attendees, label) {
    if (!attendees || !attendees.length) {
      Helpers.toast('No records match this filter', 'warning');
      return;
    }
    const slug = await getEventSlug();
    const wb   = new ExcelJS.Workbook();
    const used = new Set();
    addAttSheet(wb, safeSheetName(label || 'Report', used), attendees);
    await saveWorkbook(wb, `Prerna_${label || 'Report'}_${slug}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Helpers.toast('Excel downloaded!', 'success');
  }

  // ── PUBLIC: Full export from Attendees page (All + sub-filter sheets) ──────
  async function exportAttendees(filtered) {
    const allAtts = filtered || await DB.getAll(DB.STORES.attendees);
    const slug    = await getEventSlug();
    const wb      = new ExcelJS.Workbook();
    const used    = new Set();

    addAttSheet(wb, safeSheetName('All Attendees', used), allAtts);

    const present    = allAtts.filter(a => a.attendance === 'present');
    const absent     = allAtts.filter(a => a.attendance !== 'present');
    const paid       = allAtts.filter(a => (a.paymentStatus || '').toLowerCase() === 'paid');
    const unpaid     = allAtts.filter(a => !a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid');
    const free       = allAtts.filter(a => (a.paymentStatus || '').toLowerCase() === 'free');
    const presUnpaid = allAtts.filter(a => a.attendance === 'present' &&
                         (!a.paymentStatus || a.paymentStatus.toLowerCase() === 'unpaid'));

    if (present.length)    addAttSheet(wb, safeSheetName('Present', used), present);
    if (absent.length)     addAttSheet(wb, safeSheetName('Absent', used), absent);
    if (paid.length)       addAttSheet(wb, safeSheetName('Paid', used), paid);
    if (unpaid.length)     addAttSheet(wb, safeSheetName('Unpaid', used), unpaid);
    if (free.length)       addAttSheet(wb, safeSheetName('Free', used), free);
    if (presUnpaid.length) addAttSheet(wb, safeSheetName('Present & Unpaid', used), presUnpaid);

    await saveWorkbook(wb, `Prerna_Attendees_${slug}_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Helpers.toast('Attendee list exported!', 'success');
  }

  // ── PUBLIC: Group-based multi-sheet export ─────────────────────────────────
  async function exportAttendeesByGroup(groupBy) {
    const allAtts = await DB.getAll(DB.STORES.attendees);
    const slug    = await getEventSlug();
    const wb      = new ExcelJS.Workbook();
    const used    = new Set();
    const date    = new Date().toISOString().slice(0, 10);

    if (groupBy === 'all') {
      addAttSheet(wb, safeSheetName('All Attendees', used), allAtts);
      await saveWorkbook(wb, `Prerna_All_${slug}_${date}.xlsx`);
      Helpers.toast('Downloaded!', 'success');
      return;
    }

    const field  = groupBy === 'team' ? 'team' : 'category';
    const defVal = groupBy === 'team' ? 'Unassigned' : 'Unknown';
    const prefix = groupBy === 'team' ? 'Team' : 'Dept';

    const groups  = {};
    const dispMap = {};
    allAtts.forEach(a => {
      const raw  = ((a[field] || '').trim()) || defVal;
      const key  = raw.toLowerCase();
      if (!groups[key])  { groups[key] = []; dispMap[key] = {}; }
      groups[key].push(a);
      dispMap[key][raw] = (dispMap[key][raw] || 0) + 1;
    });

    const canonicalName = key => {
      const entries = Object.entries(dispMap[key] || {}).sort((a, b) => b[1] - a[1]);
      return entries.length ? entries[0][0] : key;
    };

    const sorted = Object.entries(groups)
      .sort((a, b) => b[1].length - a[1].length)
      .map(([key, members]) => [canonicalName(key), members]);

    const summaryLabel = groupBy === 'team' ? 'Team Name' : 'Category';

    // Sheet 1: All combined
    addAttSheet(wb, safeSheetName('All Attendees', used), allAtts);
    addSummarySheet(wb, safeSheetName(`${prefix} Summary`, used), summaryLabel, sorted);
    sorted.forEach(([displayName, members]) =>
      addAttSheet(wb, safeSheetName(`${prefix} - ${displayName}`, used), members)
    );

    await saveWorkbook(wb, `Prerna_${prefix}wise_${slug}_${date}.xlsx`);
    Helpers.toast(`Downloaded: All + ${sorted.length} ${groupBy === 'team' ? 'team' : 'category'} sheets!`, 'success');
  }

  // ── PUBLIC: Export currently filtered/visible rows from Attendees page ─────
  async function exportAttendeesFiltered() {
    const allAtts = await DB.getAll(DB.STORES.attendees);
    const search  = (document.getElementById('attendees-search')?.value || '').toLowerCase();
    const teamVal = document.getElementById('attendees-filter-team')?.value || '';
    const catVal  = document.getElementById('attendees-filter-cat')?.value || '';
    const attVal  = document.getElementById('attendees-filter-att')?.value || '';

    let f = allAtts;
    if (search)  f = f.filter(a => Helpers.searchFilter(a, search));
    if (teamVal) f = f.filter(a => a.team === teamVal);
    if (catVal)  f = f.filter(a => a.category === catVal);
    if (attVal)  f = f.filter(a => attVal === 'present' ? a.attendance === 'present' : a.attendance !== 'present');

    if (!f.length) { Helpers.toast('No records in current view', 'warning'); return; }

    const label = [teamVal, catVal, attVal].filter(Boolean).join('_') || 'Filtered';
    await downloadFiltered(f, label);
  }

  // ── PUBLIC: Gate Collections sheet — all paidAtEvent records ─────────────
  async function downloadGateCollections() {
    const allAtts = await DB.getAll(DB.STORES.attendees);
    const gatePaid = allAtts.filter(a => a.paidAtEvent);

    if (!gatePaid.length) {
      Helpers.toast('No gate collections found', 'warning');
      return;
    }

    const slug = await getEventSlug();
    const wb   = new ExcelJS.Workbook();
    const ws   = wb.addWorksheet('Gate Collections');

    const HEADERS = [
      'Sr. No.', 'Collected By', 'Name', 'Mobile', 'Team',
      'Reference', 'Amount (₹)', 'Mode', 'Remarks', 'Entry Time'
    ];
    const WIDTHS = [7, 20, 26, 14, 18, 20, 13, 10, 28, 22];

    ws.columns = WIDTHS.map((w, i) => ({ header: HEADERS[i], key: `c${i}`, width: w }));
    applyHeaderStyle(ws.getRow(1));

    // Sort by collector name then entry time
    const sorted = [...gatePaid].sort((a, b) => {
      const ca = (a.collectedBy || '').toLowerCase();
      const cb = (b.collectedBy || '').toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return (a.entryTime || '') < (b.entryTime || '') ? -1 : 1;
    });

    // Track subtotals per collector for summary rows
    const byCollector = {};
    sorted.forEach(a => {
      const who = a.collectedBy || 'Unknown';
      if (!byCollector[who]) byCollector[who] = [];
      byCollector[who].push(a);
    });

    let sr = 1;
    Object.entries(byCollector).forEach(([collector, list]) => {
      // Collector header row
      const hdr = ws.addRow([`Collected by: ${collector}`, '', '', '', '', '', '', '', '', '', '']);
      hdr.height = 22;
      hdr.eachCell({ includeEmpty: true }, cell => {
        cell.fill      = solidFill('F0FDF4');
        cell.font      = { bold: true, size: 10, color: { argb: argb('15803D') } };
        cell.border    = thinBorder('BBF7D0');
        cell.alignment = { vertical: 'middle' };
      });

      list.forEach(a => {
        const row = ws.addRow([
          sr++,
          a.collectedBy   || '',
          a.name          || '',
          a.mobile        || '',
          a.team          || '',
          a.reference     || '',
          parseFloat(a.paymentAmount || 0) || '',
          (a.paymentMode || '').toUpperCase(),
          a.remarks       || '',
          a.entryTime ? new Date(a.entryTime).toLocaleString('en-IN') : ''
        ]);
        row.height = 20;
        const isCash = (a.paymentMode || '').toLowerCase() === 'cash';
        const bg = isCash ? 'FFF7ED' : 'EFF6FF';
        const bdr = isCash ? 'FED7AA' : 'BFDBFE';
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          cell.fill   = solidFill(bg);
          cell.font   = { size: 10 };
          cell.border = thinBorder(bdr);
          cell.alignment = { vertical: 'middle' };
          // Amount col bold green
          if (col === 8 && cell.value) {
            cell.font = { bold: true, size: 10, color: { argb: argb('15803D') } };
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
          }
          // Mode col badge
          if (col === 9) {
            cell.font = { bold: true, size: 10, color: { argb: isCash ? argb('92400E') : argb('1E40AF') } };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
          }
        });
      });

      // Subtotal row
      const subtotal = list.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
      const sub = ws.addRow(['', `Total — ${collector}`, '', '', '', '', '', subtotal, '', '', '']);
      sub.height = 20;
      sub.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.fill   = solidFill('DCFCE7');
        cell.font   = { bold: true, size: 10, color: { argb: argb('14532D') } };
        cell.border = thinBorder('86EFAC');
        cell.alignment = { vertical: 'middle' };
        if (col === 8) cell.alignment = { horizontal: 'right', vertical: 'middle' };
      });

      // Blank separator
      const blank = ws.addRow([]);
      blank.height = 6;
    });

    // Grand total row
    const grandTotal = gatePaid.reduce((s, a) => s + parseFloat(a.paymentAmount || 0), 0);
    const gt = ws.addRow(['', 'GRAND TOTAL', '', '', '', '', '', grandTotal, '', '', '']);
    gt.height = 26;
    gt.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.fill   = solidFill('15803D');
      cell.font   = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.border = thinBorder('0F5C2E');
      cell.alignment = { vertical: 'middle' };
      if (col === 8) cell.alignment = { horizontal: 'right', vertical: 'middle' };
    });

    ws.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];
    const date = new Date().toISOString().slice(0, 10);
    await saveWorkbook(wb, `Prerna_GateCollections_${slug}_${date}.xlsx`);
    Helpers.toast(`Downloaded ${gatePaid.length} gate collections`, 'success');
  }

  // ── PRE-EVENT: Category-wise Excel ────────────────────────────────────────
  async function downloadPreEventCategoryExcel(attendees) {
    const CATEGORY_ORDER = Reports.CATEGORY_ORDER;
    const cats = {};
    attendees.forEach(a => {
      const cat = (a.category || 'Unknown').trim();
      cats[cat] = (cats[cat] || 0) + 1;
    });
    const allCats = [...CATEGORY_ORDER.filter(c => cats[c]), ...Object.keys(cats).filter(c => !CATEGORY_ORDER.includes(c)).sort()];
    const slug = await getEventSlug();
    const wb   = new ExcelJS.Workbook();
    const ws   = wb.addWorksheet('Category Wise');

    ws.columns = [
      { header: 'Category', key: 'cat', width: 22 },
      { header: 'Number of Devotees', key: 'n', width: 22 }
    ];
    applyHeaderStyle(ws.getRow(1));

    let grand = 0;
    allCats.forEach((cat, i) => {
      const n = cats[cat] || 0; grand += n;
      const row = ws.addRow([cat, n]);
      row.height = 20;
      const bg = i % 2 === 0 ? 'F0FDF4' : 'FFFFFF';
      row.eachCell(cell => {
        cell.fill = solidFill(bg); cell.font = { size: 10 };
        cell.border = thinBorder('D1FAE5'); cell.alignment = { vertical: 'middle' };
      });
      row.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    });
    const totRow = ws.addRow(['Grand Total', grand]);
    totRow.height = 24;
    totRow.eachCell(cell => {
      cell.fill = solidFill('15803D'); cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.border = thinBorder('0F5C2E'); cell.alignment = { vertical: 'middle' };
    });
    totRow.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];
    await saveWorkbook(wb, `Prerna_CategoryWise_${slug}_${new Date().toISOString().slice(0,10)}.xlsx`);
    Helpers.toast('Category report downloaded!', 'success');
  }

  // ── PRE-EVENT: Team-wise grouped by TEAM'S DEPARTMENT Excel ─────────────
  // Correct logic: group teams by which dept they BELONG TO,
  // count ALL devotees brought by each team (ignore devotee's own category)
  async function downloadPreEventTeamExcel(attendees, teamCategoryMap) {
    const savedMap    = teamCategoryMap || {};
    const CATEGORY_ORDER = Reports.CATEGORY_ORDER;

    // Build dept → { team → members[] } using team's DEPARTMENT (not devotee category)
    const deptMap = {};
    attendees.forEach(a => {
      const team = (a.team || 'Other').trim();
      const dept = Reports.getTeamDept(team, savedMap) || 'Unassigned';
      if (!deptMap[dept]) deptMap[dept] = {};
      if (!deptMap[dept][team]) deptMap[dept][team] = [];
      deptMap[dept][team].push(a);
    });
    const allCats = [...CATEGORY_ORDER.filter(d => deptMap[d]), ...Object.keys(deptMap).filter(d => !CATEGORY_ORDER.includes(d)).sort()];

    const slug = await getEventSlug();
    const wb   = new ExcelJS.Workbook();
    const ws   = wb.addWorksheet('Team Wise');

    ws.columns = [
      { header: 'Team', key: 'team', width: 24 },
      { header: 'Paid', key: 'paid', width: 10 },
      { header: 'Unpaid', key: 'unpaid', width: 10 },
      { header: 'Total', key: 'total', width: 10 }
    ];
    applyHeaderStyle(ws.getRow(1));

    let grandPaid = 0, grandUnpaid = 0, grandTotal = 0;

    allCats.forEach(cat => {
      const teamMap = deptMap[cat];
      const teams = Object.keys(teamMap).sort();

      // Department header row (merged across 4 cols)
      const catHdr = ws.addRow([cat, '', '', '']);
      catHdr.height = 22;
      catHdr.eachCell({ includeEmpty: true }, cell => {
        cell.fill = solidFill('166534'); cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
        cell.border = thinBorder('14532D'); cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      ws.mergeCells(`A${catHdr.number}:D${catHdr.number}`);

      let catPaid = 0, catUnpaid = 0, catTotal = 0;
      teams.forEach((team, i) => {
        const members = teamMap[team];
        const paid   = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'paid').length;
        const free   = members.filter(m => (m.paymentStatus || '').toLowerCase() === 'free').length;
        const unpaid = members.length - paid - free;
        catPaid += paid; catUnpaid += unpaid; catTotal += members.length;

        const row = ws.addRow([team, paid, unpaid, members.length]);
        row.height = 20;
        const bg = i % 2 === 0 ? 'F0FDF4' : 'FFFFFF';
        row.eachCell({ includeEmpty: true }, (cell, col) => {
          cell.fill = solidFill(bg); cell.font = { size: 10 };
          cell.border = thinBorder('D1FAE5'); cell.alignment = { vertical: 'middle' };
          if (col === 2) { cell.font = { size: 10, bold: true, color: { argb: argb('15803D') } }; cell.alignment = { horizontal: 'center', vertical: 'middle' }; }
          if (col === 3) { cell.font = { size: 10, bold: true, color: { argb: argb('DC2626') } }; cell.alignment = { horizontal: 'center', vertical: 'middle' }; }
          if (col === 4) { cell.font = { size: 10, bold: true }; cell.alignment = { horizontal: 'center', vertical: 'middle' }; }
        });
      });

      const sub = ws.addRow(['Sub-Total', catPaid, catUnpaid, catTotal]);
      sub.height = 22;
      sub.eachCell({ includeEmpty: true }, (cell, col) => {
        cell.fill = solidFill('DCFCE7'); cell.font = { bold: true, size: 10, color: { argb: argb('14532D') } };
        cell.border = thinBorder('86EFAC'); cell.alignment = { vertical: 'middle' };
        if (col > 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      grandPaid += catPaid; grandUnpaid += catUnpaid; grandTotal += catTotal;
    });

    const gt = ws.addRow(['TOTAL', grandPaid, grandUnpaid, grandTotal]);
    gt.height = 26;
    gt.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.fill = solidFill('15803D'); cell.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      cell.border = thinBorder('0F5C2E'); cell.alignment = { vertical: 'middle' };
      if (col > 1) cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    ws.views = [{ state: 'frozen', ySplit: 1, activeCell: 'A2' }];
    await saveWorkbook(wb, `Prerna_TeamWise_${slug}_${new Date().toISOString().slice(0,10)}.xlsx`);
    Helpers.toast('Team report downloaded!', 'success');
  }

  return { downloadFiltered, downloadFilteredByGroup, exportAttendees, exportAttendeesByGroup, exportAttendeesFiltered, downloadGateCollections, downloadPreEventCategoryExcel, downloadPreEventTeamExcel };
})();
