// CSV 내보내기 헬퍼. 개발계획서 5장 "백업" 통제 항목(정기 백업·CSV 내보내기)을 구현한다.
// 일반 <script>로 로드되며 window.toCsv / window.downloadCsv로 전역 등록한다.
(function () {
  function csvEscape(value) {
    if (value === null || value === undefined) return '';
    const str = Array.isArray(value) ? value.join('|') : String(value);
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
  }

  function toCsv(rows, columns) {
    if (!rows || !rows.length) return columns.map((c) => c.label).join(',') + '\n';
    const header = columns.map((c) => csvEscape(c.label)).join(',');
    const body = rows.map((r) => columns.map((c) => csvEscape(typeof c.value === 'function' ? c.value(r) : r[c.key])).join(',')).join('\n');
    return header + '\n' + body + '\n';
  }

  function downloadCsv(filename, rows, columns) {
    const csv = toCsv(rows, columns);
    // 엑셀에서 한글이 깨지지 않도록 UTF-8 BOM을 붙인다.
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  window.toCsv = toCsv;
  window.downloadCsv = downloadCsv;
})();
