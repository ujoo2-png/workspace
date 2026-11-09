// 스냅샷 자르기 (v7.36.0) — 붙여넣은/캡처한 이미지에서 포스터 영역만 드래그로 골라 작게(JPEG) 줄여 data URL로 돌려준다.
// window.openSnapshotCropper(file, {maxW=600, maxH=900}) → Promise<string|null>  (취소하면 null)
// window.cropRect(a, b, w, h) 순수 함수: 드래그 두 점 → 이미지 안으로 보정한 사각형(테스트 가능)
(function () {
  function cropRect(a, b, w, h) {
    const x1 = Math.max(0, Math.min(a.x, b.x)), y1 = Math.max(0, Math.min(a.y, b.y));
    const x2 = Math.min(w, Math.max(a.x, b.x)), y2 = Math.min(h, Math.max(a.y, b.y));
    return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
  }
  function fitSize(w, h, maxW, maxH) {
    const k = Math.min(1, maxW / w, maxH / h);
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했습니다.')); };
      img.src = url;
    });
  }
  async function openSnapshotCropper(file, opts = {}) {
    const maxW = opts.maxW || 600, maxH = opts.maxH || 900;
    const { img, url } = await loadImage(file);
    const NW = img.naturalWidth, NH = img.naturalHeight;
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; URL.revokeObjectURL(url); resolve(v); };
      const out = (r) => {
        const s = fitSize(r.w, r.h, maxW, maxH);
        const c = document.createElement('canvas'); c.width = s.w; c.height = s.h;
        c.getContext('2d').drawImage(img, r.x, r.y, r.w, r.h, 0, 0, s.w, s.h);
        return c.toDataURL('image/jpeg', 0.85);
      };
      window.openModal({
        title: '✂ 스냅샷 자르기', width: '720px',
        contentBuilder(body, close) {
          const view = fitSize(NW, NH, 660, 520);
          const scale = NW / view.w;
          const canvas = document.createElement('canvas'); canvas.width = view.w; canvas.height = view.h;
          canvas.style.cssText = `width:${view.w}px;height:${view.h}px;max-width:100%;cursor:crosshair;touch-action:none;border:1px solid var(--border)`;
          const g = canvas.getContext('2d');
          let a = null, b = null;
          const paint = () => {
            g.clearRect(0, 0, view.w, view.h); g.drawImage(img, 0, 0, view.w, view.h);
            if (a && b) { const r = cropRect(a, b, view.w, view.h); g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, 0, view.w, view.h); g.drawImage(img, r.x * scale, r.y * scale, r.w * scale, r.h * scale, r.x, r.y, r.w, r.h); g.strokeStyle = '#fff'; g.lineWidth = 2; g.strokeRect(r.x, r.y, r.w, r.h); }
          };
          paint();
          const pos = (e) => { const rc = canvas.getBoundingClientRect(); return { x: (e.clientX - rc.left) * (view.w / rc.width), y: (e.clientY - rc.top) * (view.h / rc.height) }; };
          canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); a = pos(e); b = a; paint(); });
          canvas.addEventListener('pointermove', (e) => { if (!a || !canvas.hasPointerCapture(e.pointerId)) return; b = pos(e); paint(); });
          const hint = window.el('div', { class: 'text-muted', style: 'font-size:12px' }, '드래그해서 포스터 부분만 고르세요. 고르지 않으면 전체를 사용합니다. 결과는 가로 600px 이내로 줄여 저장합니다.');
          const apply = window.el('button', { type: 'button', class: 'nm-btn nm-btn--primary snap-apply', onclick: () => {
            const r = a && b ? cropRect(a, b, view.w, view.h) : null;
            const useR = r && r.w > 8 && r.h > 8 ? { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale } : { x: 0, y: 0, w: NW, h: NH };
            finish(out(useR)); close();
          } }, '이 영역으로 사용');
          const all = window.el('button', { type: 'button', class: 'nm-btn', onclick: () => { finish(out({ x: 0, y: 0, w: NW, h: NH })); close(); } }, '전체 사용');
          const cancel = window.el('button', { type: 'button', class: 'nm-btn', onclick: () => { finish(null); close(); } }, '취소');
          body.append(window.el('div', { class: 'stack', style: 'gap:8px' }, [hint, canvas, window.el('div', { class: 'row', style: 'gap:8px; justify-content:flex-end' }, [cancel, all, apply])]));
          // 모달 바깥/× 로 닫혀도 대기하지 않게
          const mo = new MutationObserver(() => { if (!canvas.isConnected) { mo.disconnect(); finish(null); } });
          mo.observe(document.body, { childList: true, subtree: true });
        },
      });
    });
  }
  window.cropRect = cropRect; window.fitSize = fitSize; window.openSnapshotCropper = openSnapshotCropper;
})();
