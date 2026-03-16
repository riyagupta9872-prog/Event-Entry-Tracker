// ===== HELPERS =====
const Helpers = (() => {

  // Toast notifications
  function toast(message, type = 'info', duration = 3000) {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.textContent = message;
    c.appendChild(t);
    setTimeout(() => {
      t.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  // Modal
  function modal(contentHTML, onClose) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    content.innerHTML = contentHTML;
    overlay.classList.remove('hidden');
    overlay.onclick = (e) => {
      if (e.target === overlay) { closeModal(); if (onClose) onClose(); }
    };
  }

  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  // Format currency
  function currency(amount) {
    if (!amount && amount !== 0) return '₹0';
    return '₹' + Number(amount).toLocaleString('en-IN');
  }

  // Format date
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // Fuzzy name match
  function similarName(a, b) {
    if (!a || !b) return false;
    const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const na = normalize(a), nb = normalize(b);
    if (na === nb) return true;
    // Levenshtein distance
    const dist = levenshtein(na, nb);
    const maxLen = Math.max(na.length, nb.length);
    return maxLen > 0 && (dist / maxLen) < 0.3;
  }

  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const dp = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0)
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i-1] === b[j-1]
          ? dp[i-1][j-1]
          : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return dp[m][n];
  }

  // Detect duplicates
  function detectDuplicates(records) {
    const duplicateIds = new Set();
    const mobileGroups = {};
    records.forEach((r, i) => {
      const mob = (r.mobile || '').replace(/\D/g, '');
      if (mob.length >= 10) {
        if (!mobileGroups[mob]) mobileGroups[mob] = [];
        mobileGroups[mob].push(i);
      }
    });
    Object.values(mobileGroups).forEach(group => {
      if (group.length > 1) {
        // check name similarity
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            const a = records[group[i]], b = records[group[j]];
            if (similarName(a.name, b.name)) {
              duplicateIds.add(group[i]);
              duplicateIds.add(group[j]);
              records[group[i]]._dupOf = records[group[j]].name;
              records[group[j]]._dupOf = records[group[i]].name;
            }
          }
        }
      }
    });
    return duplicateIds;
  }

  // Payment timing
  function paymentTiming(paymentDate, eventDate) {
    if (!paymentDate || !eventDate) return '';
    const pd = new Date(paymentDate), ed = new Date(eventDate);
    if (isNaN(pd) || isNaN(ed)) return '';
    return pd < ed ? 'Before Event' : 'After Event';
  }

  // Generate attendee ID
  function generateId(prefix = 'PRN') {
    return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
  }

  // Generate QR data
  function qrData(attendee) {
    return JSON.stringify({ id: attendee.id, aid: attendee.attendeeId, name: attendee.name });
  }

  // Debounce
  function debounce(fn, delay) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
  }

  // Download blob
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Build table HTML
  function buildTable(headers, rows, opts = {}) {
    const cls = opts.cls || '';
    let html = `<table class="${cls}"><thead><tr>`;
    headers.forEach(h => { html += `<th>${h}</th>`; });
    html += `</tr></thead><tbody>`;
    rows.forEach(row => {
      const trCls = row._class || '';
      html += `<tr class="${trCls}">`;
      row.cells.forEach(cell => { html += `<td>${cell}</td>`; });
      html += `</tr>`;
    });
    html += `</tbody></table>`;
    return html;
  }

  // Paginate
  function paginate(items, page, size = 50) {
    return items.slice((page - 1) * size, page * size);
  }

  // Search filter
  function searchFilter(item, query) {
    const q = query.toLowerCase();
    return (
      (item.name || '').toLowerCase().includes(q) ||
      (item.mobile || '').includes(q) ||
      (item.team || '').toLowerCase().includes(q) ||
      (item.reference || '').toLowerCase().includes(q) ||
      (item.attendeeId || '').toLowerCase().includes(q)
    );
  }

  return {
    toast, modal, closeModal, currency, formatDate, formatDateTime,
    similarName, detectDuplicates, paymentTiming, generateId, qrData,
    debounce, downloadBlob, buildTable, paginate, searchFilter
  };
})();
