// ===== EXPORT MODULE =====
// Uses ExcelJS for fully-formatted Excel output (SheetJS CE ignores cell styles)
const Export = (() => {

  const SHEET_HEADER = [
    'Sr. No.', 'Name', 'Mobile number', 'Category', 'Reference',
    'Team Name', 'Pickup Point', 'Payment Status', 'Payment Remarks',
    'Mode of Payment', 'Payment Amt.', 'Attendence', 'Admitted by', 'Admitted at'
  ];

  const COL_WIDTHS = [7, 26, 14, 13, 22, 16, 18, 14, 28, 16, 13, 18, 20, 22];

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
    if (a.attendance === 'present') att = a.isWalkIn ? 'Present (walk-in)' : 'Presnt';
    return [
      srNo,
      a.name           || '',
      a.mobile         || '',
      a.category       || '',
      a.reference      || '',
      a.team           || '',
      a.pickupLocation || '',
      ps,
      a.remarks        || '',
      a.paymentMode    || '',
      parseFloat(a.paymentAmount || 0) || '',
      att,
      a.markedBy       || '',
      a.entryTime ? new Date(a.entryTime).toLocaleString('en-IN') : ''
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
      row.eachCell({ includeEmpty: true }, (cell, col) => {
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

    const groups = {};
    allAtts.forEach(a => {
      const key = (a[field] || defVal).trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(a);
    });

    const sorted = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
    const summaryLabel = groupBy === 'team' ? 'Team Name' : 'Category';

    addSummarySheet(wb, safeSheetName(`${prefix} Summary`, used), summaryLabel, sorted);
    sorted.forEach(([key, members]) =>
      addAttSheet(wb, safeSheetName(`${prefix} - ${key}`, used), members)
    );

    await saveWorkbook(wb, `Prerna_${prefix}wise_${slug}_${date}.xlsx`);
    Helpers.toast(`Downloaded ${sorted.length} ${groupBy === 'team' ? 'team' : 'category'} sheets!`, 'success');
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

  return { downloadFiltered, exportAttendees, exportAttendeesByGroup, exportAttendeesFiltered };
})();
