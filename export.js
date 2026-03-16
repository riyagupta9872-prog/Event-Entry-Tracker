// ===== EXPORT MODULE =====
const Export = (() => {

  async function getReportData(type) {
    switch (type) {
      case 'overview': return Reports.reportOverview();
      case 'payment': return Reports.reportPayment();
      case 'reference': return Reports.reportReference();
      case 'transport': return Reports.reportTransport();
      case 'summary': return Reports.reportSummary();
      default: return null;
    }
  }

  // ===== EXCEL EXPORT =====
  async function reportToExcel(type) {
    const data = await getReportData(type);
    const cfg = await Reports.reportSummary();
    const wb = XLSX.utils.book_new();

    if (type === 'overview') {
      const { attendees, present, catMap, teamMap, serviceDevotees, activeDevotees } = data;
      addSheet(wb, 'Overview', [
        ['Metric', 'Value'],
        ['Total Attendees', attendees.length],
        ['Present', present.length],
        ['Absent', attendees.length - present.length],
        ['Attendance Rate', attendees.length ? Math.round(present.length/attendees.length*100)+'%' : '0%'],
      ]);
      addSheet(wb, 'By Category', [
        ['Category', 'Total', 'Present', 'Absent'],
        ...Object.entries(catMap).map(([c, d]) => [c, d.total, d.present, d.total - d.present])
      ]);
      addSheet(wb, 'By Team', [
        ['Team', 'Total', 'Present', 'Absent'],
        ...Object.entries(teamMap).map(([t, d]) => [t, d.total, d.present, d.total - d.present])
      ]);
      addSheet(wb, 'Devotees', [
        ['Type', 'Count'],
        ['Service Devotees', serviceDevotees.length],
        ['Non-Service Devotees', attendees.length - serviceDevotees.length],
        ['Active Devotees', activeDevotees.length],
        ['Inactive Devotees', attendees.length - activeDevotees.length],
      ]);
    } else if (type === 'payment') {
      const { teamPayMap, totalPayment, expected, profitLoss } = data;
      addSheet(wb, 'Payment By Team', [
        ['Team', 'Persons', 'Before Event', 'After Event', 'Total'],
        ...Object.entries(teamPayMap).map(([t, d]) => [t, d.persons, d.before, d.after, d.total]),
        ['TOTAL', Object.values(teamPayMap).reduce((s,d) => s+d.persons,0), '', '', totalPayment]
      ]);
      addSheet(wb, 'Summary', [
        ['Metric', 'Value'],
        ['Total Collected', totalPayment],
        ['Expected Revenue', expected],
        ['Profit/Loss', profitLoss]
      ]);
    } else if (type === 'reference') {
      const { refMap } = data;
      addSheet(wb, 'Reference Performance', [
        ['Reference', 'Persons', 'Total Payment'],
        ...Object.entries(refMap).map(([r, d]) => [r, d.persons, d.total])
      ]);
    } else if (type === 'transport') {
      const { routeMap, totalCost, totalCollection, profitLoss } = data;
      addSheet(wb, 'Bus Routes', [
        ['Route', 'Capacity', 'Passengers', 'Collection', 'Bus Cost', 'Profit/Loss'],
        ...Object.values(routeMap).map(r => [r.name, r.capacity, r.passengers, r.collection, r.cost, r.collection - r.cost]),
        ['TOTAL', '', Object.values(routeMap).reduce((s,r)=>s+r.passengers,0), totalCollection, totalCost, profitLoss]
      ]);
    } else if (type === 'summary') {
      const d = data;
      addSheet(wb, 'Event Summary', [
        ['Metric', 'Value'],
        ['Event Name', d.cfg.eventName],
        ['Event Date', d.cfg.eventDate],
        ['Total Attendees', d.totalAttendees],
        ['Total Present', d.totalPresent],
        ['Walk-ins', d.totalWalkIns],
        ['Total Payment Collected', d.totalPayment],
        ['Total Bus Cost', d.totalBusCost],
        ['Expected Revenue', d.expected],
        ['Net Profit/Loss', d.netPL]
      ]);
    }

    // Full attendee list
    const attendees = await DB.getAll(DB.STORES.attendees);
    addSheet(wb, 'Full Attendee List', [
      ['ID','Name','Mobile','Team','Category','Reference','Payment','Pay Date','Pay Timing','Bus Route','Attendance','Entry Time','Volunteer','Walk-in'],
      ...attendees.map(a => [
        a.attendeeId, a.name, a.mobile, a.team, a.category, a.reference,
        a.paymentAmount, a.paymentDate, a.paymentTiming,
        a.busRoute, a.attendance, a.entryTime, a.markedBy, a.isWalkIn ? 'Yes' : 'No'
      ])
    ]);

    XLSX.writeFile(wb, `Prerna_${type}_report_${new Date().toISOString().slice(0,10)}.xlsx`);
    Helpers.toast('Excel report downloaded!', 'success');
  }

  function addSheet(wb, name, data) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  // ===== CSV EXPORT =====
  async function reportToCsv(type) {
    const data = await getReportData(type);
    let rows = [];

    if (type === 'overview') {
      const { attendees, catMap, teamMap } = data;
      rows = [
        ['=== CATEGORY BREAKDOWN ==='],
        ['Category', 'Total', 'Present', 'Absent'],
        ...Object.entries(catMap).map(([c, d]) => [c, d.total, d.present, d.total - d.present]),
        [],
        ['=== TEAM BREAKDOWN ==='],
        ['Team', 'Total', 'Present', 'Absent'],
        ...Object.entries(teamMap).map(([t, d]) => [t, d.total, d.present, d.total - d.present])
      ];
    } else if (type === 'payment') {
      const { teamPayMap } = data;
      rows = [
        ['Team', 'Persons', 'Before Event', 'After Event', 'Total'],
        ...Object.entries(teamPayMap).map(([t, d]) => [t, d.persons, d.before, d.after, d.total])
      ];
    } else if (type === 'reference') {
      const { refMap } = data;
      rows = [
        ['Reference', 'Persons', 'Total Payment'],
        ...Object.entries(refMap).map(([r, d]) => [r, d.persons, d.total])
      ];
    } else if (type === 'transport') {
      const { routeMap } = data;
      rows = [
        ['Route', 'Passengers', 'Collection', 'Bus Cost', 'Profit/Loss'],
        ...Object.values(routeMap).map(r => [r.name, r.passengers, r.collection, r.cost, r.collection - r.cost])
      ];
    } else if (type === 'summary') {
      rows = [
        ['Metric', 'Value'],
        ['Total Attendees', data.totalAttendees],
        ['Total Present', data.totalPresent],
        ['Total Payment', data.totalPayment],
        ['Total Bus Cost', data.totalBusCost],
        ['Net P/L', data.netPL]
      ];
    }

    const csv = rows.map(r => r.map(c => `"${(c||'').toString().replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    Helpers.downloadBlob(blob, `Prerna_${type}_${new Date().toISOString().slice(0,10)}.csv`);
    Helpers.toast('CSV downloaded!', 'success');
  }

  // ===== PDF EXPORT (print-based) =====
  async function reportToPdf(type) {
    const data = await getReportData(type);
    let html = '';

    const styles = `
      <style>
        body { font-family: Arial, sans-serif; color: #222; padding: 20px; }
        h1 { color: #7b5ea7; border-bottom: 2px solid #c9a227; padding-bottom: 8px; }
        h2 { color: #c9a227; margin-top: 24px; }
        table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
        th { background: #1c1635; color: #f0c040; padding: 8px 10px; text-align: left; }
        td { padding: 7px 10px; border-bottom: 1px solid #ddd; }
        tr:nth-child(even) td { background: #f9f7ff; }
        .total-row td { font-weight: bold; background: #f0ecff; }
        .meta { color: #888; font-size: 12px; margin-bottom: 20px; }
      </style>
    `;

    const cfg = await Reports.reportSummary();
    html = `${styles}<h1>Prerna Festival — ${type.charAt(0).toUpperCase()+type.slice(1)} Report</h1>
    <p class="meta">Generated: ${new Date().toLocaleString()} | Event: ${cfg.cfg.eventName}</p>`;

    if (type === 'overview') {
      const { attendees, present, catMap, teamMap } = data;
      html += `<h2>Overall</h2><table><tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Total</td><td>${attendees.length}</td></tr>
        <tr><td>Present</td><td>${present.length}</td></tr>
        <tr class="total-row"><td>Rate</td><td>${Math.round(present.length/attendees.length*100)}%</td></tr></table>`;
      html += `<h2>By Category</h2><table><tr><th>Category</th><th>Total</th><th>Present</th></tr>`;
      Object.entries(catMap).forEach(([c,d]) => { html += `<tr><td>${c}</td><td>${d.total}</td><td>${d.present}</td></tr>`; });
      html += `</table><h2>By Team</h2><table><tr><th>Team</th><th>Total</th><th>Present</th></tr>`;
      Object.entries(teamMap).forEach(([t,d]) => { html += `<tr><td>${t}</td><td>${d.total}</td><td>${d.present}</td></tr>`; });
      html += `</table>`;
    } else if (type === 'payment') {
      const { teamPayMap, totalPayment, expected, profitLoss } = data;
      html += `<h2>Team Payment Analysis</h2><table><tr><th>Team</th><th>Persons</th><th>Before</th><th>After</th><th>Total</th></tr>`;
      Object.entries(teamPayMap).forEach(([t,d]) => {
        html += `<tr><td>${t}</td><td>${d.persons}</td><td>₹${d.before}</td><td>₹${d.after}</td><td>₹${d.total}</td></tr>`;
      });
      html += `<tr class="total-row"><td>TOTAL</td><td></td><td></td><td></td><td>₹${totalPayment}</td></tr></table>
        <p>Expected: ₹${expected} | P/L: ₹${profitLoss}</p>`;
    } else if (type === 'reference') {
      const { refMap } = data;
      html += `<h2>Reference Performance</h2><table><tr><th>Reference</th><th>Persons</th><th>Total</th></tr>`;
      Object.entries(refMap).forEach(([r,d]) => { html += `<tr><td>${r}</td><td>${d.persons}</td><td>₹${d.total}</td></tr>`; });
      html += `</table>`;
    } else if (type === 'transport') {
      const { routeMap, totalCost, totalCollection, profitLoss } = data;
      html += `<h2>Bus Routes</h2><table><tr><th>Route</th><th>Passengers</th><th>Collection</th><th>Cost</th><th>P/L</th></tr>`;
      Object.values(routeMap).forEach(r => { html += `<tr><td>${r.name}</td><td>${r.passengers}</td><td>₹${r.collection}</td><td>₹${r.cost}</td><td>₹${r.collection-r.cost}</td></tr>`; });
      html += `<tr class="total-row"><td>TOTAL</td><td></td><td>₹${totalCollection}</td><td>₹${totalCost}</td><td>₹${profitLoss}</td></tr></table>`;
    } else if (type === 'summary') {
      const d = data;
      html += `<h2>Event Financial Summary</h2><table>
        <tr><th>Metric</th><th>Value</th></tr>
        <tr><td>Total Attendees</td><td>${d.totalAttendees}</td></tr>
        <tr><td>Present</td><td>${d.totalPresent}</td></tr>
        <tr><td>Walk-ins</td><td>${d.totalWalkIns}</td></tr>
        <tr><td>Total Collected</td><td>₹${d.totalPayment}</td></tr>
        <tr><td>Total Bus Cost</td><td>₹${d.totalBusCost}</td></tr>
        <tr class="total-row"><td>Net P/L</td><td>₹${d.netPL}</td></tr>
      </table>`;
    }

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
    Helpers.toast('PDF print dialog opened', 'success');
  }

  // Full attendee list export
  async function exportAttendees(filtered) {
    const attendees = filtered || await DB.getAll(DB.STORES.attendees);
    const wb = XLSX.utils.book_new();
    addSheet(wb, 'Attendees', [
      ['ID','Name','Mobile','Team','Category','Reference','Payment','Pay Date','Pay Timing','Bus Route','Attendance','Entry Time','Volunteer','Walk-in','Duplicate'],
      ...attendees.map(a => [
        a.attendeeId, a.name, a.mobile, a.team, a.category, a.reference,
        a.paymentAmount, a.paymentDate, a.paymentTiming,
        a.busRoute, a.attendance, a.entryTime, a.markedBy,
        a.isWalkIn ? 'Yes' : 'No', a.isDuplicate ? 'Yes' : 'No'
      ])
    ]);
    XLSX.writeFile(wb, `Prerna_Attendees_${new Date().toISOString().slice(0,10)}.xlsx`);
    Helpers.toast('Attendee list exported!', 'success');
  }

  return { reportToExcel, reportToCsv, reportToPdf, exportAttendees };
})();
