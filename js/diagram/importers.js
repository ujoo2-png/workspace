// Mermaid / draw.io / Excalidraw 가져오기 (v7.32.0). 순수 함수 — 결과: { type, data, ledger[] }
// ledger = 무엇이 옮겨졌고 무엇이 사라졌는지 정직하게 알려 주는 목록(fidelity ledger).
(function (root) {
  'use strict';
  const unq = (s) => String(s == null ? '' : s).replace(/^["'`]|["'`]$/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/<[^>]+>/g, '').trim();
  const kindOf = (open) => (open === '{' ? 'decision' : open === '([' || open === '((' ? 'start' : 'default');

  function fromMermaid(src) {
    const text = String(src || '').replace(/%%.*$/gm, '').trim(); const ledger = [];
    if (/^sequenceDiagram/m.test(text)) {
      const actors = new Map(); const msgs = [];
      const act = (id, label) => { if (!actors.has(id)) actors.set(id, { id, label: label || id }); else if (label) actors.get(id).label = label; };
      for (const line of text.split(/\r?\n/).slice(1)) { const l = line.trim(); let m;
        if ((m = l.match(/^(?:participant|actor)\s+(\S+)(?:\s+as\s+(.+))?$/))) act(m[1], unq(m[2]));
        else if ((m = l.match(/^(\S+?)\s*(-->>|->>|-->|->|--x|-x)\s*(\S+?)\s*:\s*(.*)$/))) { act(m[1]); act(m[3]); msgs.push({ from: m[1], to: m[3], label: unq(m[4]), dashed: m[2].startsWith('--') }); }
        else if (l && !/^(autonumber|title|end)\b/.test(l)) ledger.push({ level: 'lost', msg: `지원하지 않는 구문 건너뜀: ${l.slice(0, 40)}` }); }
      ledger.unshift({ level: 'ok', msg: `참여자 ${actors.size}개 · 메시지 ${msgs.length}개를 시퀀스로 옮겼습니다.` });
      return { type: 'sequence', data: { title: 'Mermaid 시퀀스', actors: [...actors.values()], messages: msgs }, ledger };
    }
    const lines = text.split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean); let dir = 'TB';
    const head = lines[0] && lines[0].match(/^(?:flowchart|graph)\s+(TB|TD|BT|LR|RL)?/i); if (!head) return { type: 'flowchart', data: { title: 'Mermaid', nodes: [], edges: [] }, ledger: [{ level: 'lost', msg: 'flowchart/graph 또는 sequenceDiagram 만 지원합니다.' }] };
    dir = (head[1] || 'TB').toUpperCase() === 'LR' || (head[1] || '').toUpperCase() === 'RL' ? 'LR' : 'TB';
    const nodes = new Map(); const edges = [];
    const NODE = /^([A-Za-z0-9_ㄱ-힝]+)(?:(\(\[|\(\(|\[\[|\[|\(|\{)(.*?)(\]\)|\)\)|\]\]|\]|\)|\}))?/;
    const parseNode = (tok) => { const m = tok.trim().match(NODE); if (!m) return null; const id = m[1]; if (m[3] != null) { const k = kindOf(m[2]); const ex = nodes.get(id); nodes.set(id, { id, label: unq(m[3]), kind: k === 'default' ? (ex && ex.kind) || undefined : k }); } else if (!nodes.has(id)) nodes.set(id, { id, label: id }); return id; };
    for (const l of lines.slice(1)) {
      if (/^(subgraph|end|classDef|class |style|linkStyle|click)\b/.test(l)) { ledger.push({ level: 'lost', msg: `스타일·그룹 구문 생략: ${l.slice(0, 30)}` }); continue; }
      const parts = l.split(/\s*(-->|---|-\.->|==>|--[>o]|-\.-)\s*(?:\|([^|]*)\|\s*)?/); // [n, arrow, label, n, arrow, label, n...]
      let prev = parseNode(parts[0]);
      for (let i = 1; i + 2 < parts.length + 1 && prev; i += 3) { const arrow = parts[i], lab = parts[i + 1]; const to = parseNode(parts[i + 2] || ''); if (!to) break; edges.push({ from: prev, to, label: lab ? unq(lab) : undefined, dashed: /\./.test(arrow) || undefined, arrow: arrow !== '---' }); prev = to; }
    }
    ledger.unshift({ level: 'ok', msg: `노드 ${nodes.size}개 · 연결 ${edges.length}개를 플로차트로 옮겼습니다.` });
    return { type: 'flowchart', data: { title: 'Mermaid 플로차트', direction: dir, nodes: [...nodes.values()], edges }, ledger };
  }

  function fromDrawio(xml) {
    const s = String(xml || ''); const ledger = []; const nodes = new Map(); const edges = [];
    const attr = (tag, k) => { const m = tag.match(new RegExp(`\\b${k}="([^"]*)"`)); return m ? m[1] : null; };
    for (const m of s.matchAll(/<mxCell\b[^>]*?>/g)) { const t = m[0]; const id = attr(t, 'id'); const val = unq(attr(t, 'value') || '');
      if (attr(t, 'vertex') === '1') { const style = attr(t, 'style') || ''; nodes.set(id, { id, label: val || id, kind: /rhombus/.test(style) ? 'decision' : /ellipse/.test(style) ? 'start' : undefined }); }
      else if (attr(t, 'edge') === '1') { edges.push({ from: attr(t, 'source'), to: attr(t, 'target'), label: val || undefined }); } }
    const ok = edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)); if (ok.length < edges.length) ledger.push({ level: 'lost', msg: `끝점이 없는 선 ${edges.length - ok.length}개는 제외했습니다.` });
    ledger.unshift({ level: 'ok', msg: `도형 ${nodes.size}개 · 연결 ${ok.length}개를 가져왔습니다. 위치·색·크기는 엔진이 다시 배치합니다(원본 좌표 미사용).` });
    return { type: 'flowchart', data: { title: 'draw.io 가져오기', direction: 'TB', nodes: [...nodes.values()], edges: ok }, ledger };
  }

  function fromExcalidraw(json) {
    const ledger = []; let doc; try { doc = typeof json === 'string' ? JSON.parse(json) : json; } catch { return { type: 'flowchart', data: { title: 'Excalidraw', nodes: [], edges: [] }, ledger: [{ level: 'lost', msg: 'JSON을 읽지 못했습니다.' }] }; }
    const els = (doc.elements || []).filter((e) => !e.isDeleted); const nodes = new Map(); const edges = []; const texts = new Map();
    for (const e of els) if (e.type === 'text' && e.containerId) texts.set(e.containerId, unq(e.text));
    for (const e of els) if (['rectangle', 'ellipse', 'diamond'].includes(e.type)) nodes.set(e.id, { id: e.id, label: texts.get(e.id) || '(이름 없음)', kind: e.type === 'diamond' ? 'decision' : e.type === 'ellipse' ? 'start' : undefined });
    for (const e of els) if (e.type === 'arrow' || e.type === 'line') { const a = e.startBinding && e.startBinding.elementId, b = e.endBinding && e.endBinding.elementId; if (a && b && nodes.has(a) && nodes.has(b)) edges.push({ from: a, to: b, label: texts.get(e.id) }); else ledger.push({ level: 'lost', msg: '도형에 붙지 않은 화살표 1개는 제외했습니다.' }); }
    const free = els.filter((e) => e.type === 'text' && !e.containerId).length; if (free) ledger.push({ level: 'lost', msg: `도형 밖 자유 텍스트 ${free}개는 제외했습니다.` });
    ledger.unshift({ level: 'ok', msg: `도형 ${nodes.size}개 · 연결 ${edges.length}개를 가져왔습니다. 손그림 모양·좌표는 사라지고 엔진이 재배치합니다.` });
    return { type: 'flowchart', data: { title: 'Excalidraw 가져오기', direction: 'TB', nodes: [...nodes.values()], edges }, ledger };
  }

  function detect(text) { const t = String(text || '').trim(); if (/^[{\[]/.test(t) && /"elements"/.test(t)) return 'excalidraw'; if (/<mxfile|<mxGraphModel|<mxCell/i.test(t)) return 'drawio'; return 'mermaid'; }
  function importAny(text, kind) { const k = kind && kind !== 'auto' ? kind : detect(text); return { kind: k, ...(k === 'excalidraw' ? fromExcalidraw(text) : k === 'drawio' ? fromDrawio(text) : fromMermaid(text)) }; }
  const api = { fromMermaid, fromDrawio, fromExcalidraw, detect, importAny };
  root.DiagramImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
