(function (root) {
  const EML = (root.EML = root.EML || {});
  const { C } = EML;

  // ---- Layout constants (SVG user units ~ CSS px at zoom 1) -----------------
  // All sizes are for the default 16px root; layout(vroot, scale) multiplies them
  // so the labels (0.8125rem in CSS) and their boxes grow together in large type.
  const ROW = 64;       // vertical distance between depths
  const GAP = 14;       // minimum horizontal gap between sibling subtrees
  const PAD = 24;       // margin around the whole drawing
  const NODE_H = 28;    // height of blob / chip / leaf boxes
  const CHAR_W = 7.8;   // approx. width of one mono glyph at 13px
  const HIT_H = 44;     // touch target height of an unfoldable blob
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_SCALE = 4;  // max zoom-in, px per user unit

  const displayLabel = (kind, label, hasChildren) =>
    (kind === 'blob' && hasChildren ? label + '(…)' : label);

  // Box size of a drawn position at the given scale.
  function nodeSize(kind, label, hasChildren, k = 1) {
    if (kind === 'eml') return { w: 26 * k, h: 26 * k };
    if (kind === 'one') return { w: 28 * k, h: NODE_H * k };
    const text = displayLabel(kind, label, hasChildren);
    const pad = kind === 'blob' ? 22 : 16;
    return { w: Math.max(28, Math.ceil(text.length * CHAR_W + pad)) * k, h: NODE_H * k };
  }

  // Pure layout: leaves are laid left to right, a parent sits at the mean x of
  // its children, y = depth * row height. Each subtree reserves its bounding
  // extent, so nodes never overlap. Iterative (trees can be deep).
  // scale: the root font size / 16 (1.25 in large type).
  //   -> { nodes: [{path, x, y, kind, label, w, h}], edges: [[from, to]], width, height, scale }
  function layout(vroot, scale = 1) {
    const k = scale > 0 ? scale : 1;
    const row = ROW * k;
    const gap = GAP * k;
    const pad = PAD * k;
    const nodeH = NODE_H * k;
    const list = []; // pre-order
    const stack = [{ v: vroot, depth: 0, parent: -1 }];
    while (stack.length) {
      const { v, depth, parent } = stack.pop();
      const idx = list.length;
      const size = nodeSize(v.kind, v.label, v.children.length > 0, k);
      list.push({ v, depth, parent, kids: [], w: size.w, h: size.h, left: 0, right: 0, offs: [], x: 0 });
      if (parent >= 0) list[parent].kids.push(idx);
      for (let i = v.children.length - 1; i >= 0; i--) {
        stack.push({ v: v.children[i], depth: depth + 1, parent: idx });
      }
    }
    // Bottom-up: relative offsets of children and the subtree extent.
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (!n.kids.length) {
        n.left = -n.w / 2;
        n.right = n.w / 2;
        continue;
      }
      const rel = [];
      let prev = null;
      let prevX = 0;
      for (const k of n.kids) {
        const c = list[k];
        const x = prev ? prevX + prev.right + gap - c.left : 0;
        rel.push(x);
        prev = c;
        prevX = x;
      }
      const mean = rel.reduce((a, b) => a + b, 0) / rel.length;
      n.offs = rel.map((x) => x - mean);
      let left = -n.w / 2;
      let right = n.w / 2;
      n.kids.forEach((k, j) => {
        left = Math.min(left, n.offs[j] + list[k].left);
        right = Math.max(right, n.offs[j] + list[k].right);
      });
      n.left = left;
      n.right = right;
    }

    // Top-down: absolute x.
    const rootN = list[0];
    rootN.x = pad - rootN.left;
    let maxDepth = 0;
    for (const n of list) {
      n.kids.forEach((k, j) => { list[k].x = n.x + n.offs[j]; });
      if (n.depth > maxDepth) maxDepth = n.depth;
    }

    const nodes = [];
    const edges = [];
    for (const n of list) {
      nodes.push({
        path: n.v.path, x: n.x, y: pad + nodeH / 2 + n.depth * row,
        kind: n.v.kind, label: n.v.label, w: n.w, h: n.h,
        hasChildren: n.kids.length > 0,
      });
      for (const k of n.kids) edges.push([n.v.path, list[k].v.path]);
    }
    return {
      nodes,
      edges,
      width: rootN.right - rootN.left + 2 * pad,
      height: maxDepth * row + nodeH + 2 * pad,
      scale: k,
    };
  }

  // Replace every resolved position (other than leaves) by a value chip whose
  // subtree is hidden. Returns a fresh VNode tree; the input is untouched.
  function prune(vroot, resolver) {
    if (!resolver) return vroot;
    const copy = (v) => {
      const leaf = v.kind === 'one' || v.kind === 'var';
      if (!leaf && resolver.values.has(v.path)) {
        return { path: v.path, call: v.call, kind: 'chip', label: C.format(resolver.values.get(v.path), 6), children: [] };
      }
      return { path: v.path, call: v.call, kind: v.kind, label: v.label, children: [] };
    };
    const top = copy(vroot);
    const stack = [{ src: vroot, dst: top }];
    while (stack.length) {
      const { src, dst } = stack.pop();
      if (dst.kind === 'chip') continue;
      for (const c of src.children) {
        const d = copy(c);
        dst.children.push(d);
        stack.push({ src: c, dst: d });
      }
    }
    return top;
  }

  // ---- DOM renderer ----------------------------------------------------------
  class TreeView {
    constructor(container, opts = {}) {
      const doc = root.document;
      this.container = container;
      this.onBlobClick = opts.onBlobClick || null;
      this.onFit = opts.onFit || null;
      this.vb = { x: 0, y: 0, w: 100, h: 100 };
      this.extent = { width: 100, height: 100 };
      this._lastRoot = null;
      this._needFit = false;
      this._pointers = new Map();
      this._pinch = null;
      this._dragged = false;
      this._downAt = null;

      const svg = (this.svg = doc.createElementNS(SVG_NS, 'svg'));
      svg.setAttribute('class', 'tv-svg');
      svg.setAttribute('role', 'group');
      svg.setAttribute('aria-label', 'Expression tree. Drag to pan, pinch or Ctrl+scroll to zoom.');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      this.edgeLayer = doc.createElementNS(SVG_NS, 'g');
      this.edgeLayer.setAttribute('class', 'tv-edges');
      this.nodeLayer = doc.createElementNS(SVG_NS, 'g');
      svg.append(this.edgeLayer, this.nodeLayer);
      container.textContent = '';
      container.append(svg);

      svg.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
      svg.addEventListener('pointerdown', (e) => this._onDown(e));
      svg.addEventListener('pointermove', (e) => this._onMove(e));
      svg.addEventListener('pointerup', (e) => this._onUp(e));
      svg.addEventListener('pointercancel', () => this._reset());
      svg.addEventListener('lostpointercapture', () => this._reset());
      // With touch-action pan-x pan-y one finger belongs to the page. Two
      // fingers are a pinch/pan of the tree: stop the page from also taking it.
      svg.addEventListener('touchmove', (e) => {
        if (e.touches.length >= 2 && e.cancelable) e.preventDefault();
      }, { passive: false });
      // A missed pointerup (released outside the window, tab switch) must not
      // leave a ghost pointer that turns the next click into a pinch.
      if (typeof root.addEventListener === 'function') {
        this._onBlur = () => this._reset();
        root.addEventListener('blur', this._onBlur);
      }

      // Large type changes the root font size: lay the tree out again so the
      // boxes keep fitting their (rem-sized) labels.
      if (typeof root.MutationObserver === 'function' && doc.documentElement) {
        this._mo = new root.MutationObserver(() => {
          if (this._lastArgs && this._scale() !== this.layout.scale) {
            const [v, r, o] = this._lastArgs;
            this.render(v, r, Object.assign({}, o, { fit: true }));
          }
        });
        this._mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
      }

      if (typeof root.ResizeObserver === 'function') {
        this._ro = new root.ResizeObserver(() => this._onResize());
        this._ro.observe(container);
      }
      this._applyVB();
    }

    // Draw the tree. `resolver` (optional) turns resolved positions into value
    // chips; opts.highlight is a Set of paths to ring (the frontier).
    // The view refits only for a new root (or opts.fit); stepping keeps pan/zoom.
    render(vroot, resolver, opts = {}) {
      const doc = root.document;
      const highlight = opts.highlight || new Set();
      this._lastArgs = [vroot, resolver, opts];
      const shown = prune(vroot, resolver || null);
      const lay = layout(shown, this._scale());
      this.layout = lay;
      this.edgeLayer.textContent = '';
      this.nodeLayer.textContent = '';
      const byPath = new Map(lay.nodes.map((n) => [n.path, n]));

      const edgeFrag = doc.createDocumentFragment();
      for (const [a, b] of lay.edges) {
        const p = byPath.get(a);
        const q = byPath.get(b);
        const y1 = p.y + p.h / 2;
        const y2 = q.y - q.h / 2;
        const ym = (y1 + y2) / 2;
        const path = doc.createElementNS(SVG_NS, 'path');
        path.setAttribute('d', `M${p.x} ${y1}C${p.x} ${ym} ${q.x} ${ym} ${q.x} ${y2}`);
        edgeFrag.append(path);
      }
      this.edgeLayer.append(edgeFrag);

      const nodeFrag = doc.createDocumentFragment();
      for (const n of lay.nodes) nodeFrag.append(this._nodeEl(n, highlight.has(n.path)));
      this.nodeLayer.append(nodeFrag);

      this.extent = { width: lay.width, height: lay.height };
      if (vroot !== this._lastRoot || opts.fit) {
        this._lastRoot = vroot;
        this.fit();
      }
    }

    // Root font size / 16: 1 normally, 1.25 in large type.
    _scale() {
      const doc = root.document;
      const px = doc && root.getComputedStyle ? parseFloat(root.getComputedStyle(doc.documentElement).fontSize) : 16;
      return px > 0 ? px / 16 : 1;
    }

    _nodeEl(n, hl) {
      const k = this.layout.scale;
      const doc = root.document;
      const g = doc.createElementNS(SVG_NS, 'g');
      g.setAttribute('class', `tv-node tv-${n.kind}${hl ? ' hl' : ''}`);
      g.setAttribute('transform', `translate(${n.x} ${n.y})`);
      g.dataset.path = n.path;
      const clickable = n.kind === 'blob' && this.onBlobClick;
      if (clickable) {
        g.setAttribute('role', 'button');
        g.setAttribute('tabindex', '0');
        g.setAttribute('aria-label', `${n.label}, unfold`);
        g.addEventListener('click', () => {
          if (!this._dragged) this.onBlobClick(n.path);
        });
        g.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.onBlobClick(n.path);
          }
        });
      }
      const shape = (tag, attrs, cls) => {
        const el = doc.createElementNS(SVG_NS, tag);
        for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
        if (cls) el.setAttribute('class', cls);
        return el;
      };
      if (clickable) {
        // Invisible 44-unit-tall hit area so a fingertip can hit the 28-unit blob.
        g.append(shape('rect', { x: -n.w / 2, y: -HIT_H * k / 2, width: n.w, height: HIT_H * k }, 'tv-hit'));
      }
      if (hl) {
        // Dashed ring: marks the frontier by shape, not by colour alone.
        const o = 5 * k;
        if (n.kind === 'eml') g.append(shape('circle', { r: n.w / 2 + o }, 'tv-ring'));
        else {
          g.append(shape('rect', {
            x: -n.w / 2 - o, y: -n.h / 2 - o, width: n.w + 2 * o, height: n.h + 2 * o, rx: n.h / 2 + o,
          }, 'tv-ring'));
        }
      }
      if (n.kind === 'eml') {
        g.append(shape('circle', { r: n.w / 2 }, 'tv-shape'));
      } else {
        const rx = n.kind === 'blob' ? n.h / 2 : (n.kind === 'chip' ? 6 : 4) * k;
        g.append(shape('rect', { x: -n.w / 2, y: -n.h / 2, width: n.w, height: n.h, rx }, 'tv-shape'));
      }
      const text = shape('text', { 'text-anchor': 'middle', dy: '0.35em' }, 'tv-label');
      text.textContent = n.kind === 'eml' ? 'E' : displayLabel(n.kind, n.label, n.hasChildren);
      g.append(text);
      return g;
    }

    // ---- viewBox management (aspect always matches the container) ----
    _size() {
      const r = this.container.getBoundingClientRect();
      return { w: r.width, h: r.height };
    }

    _applyVB() {
      const { x, y, w, h } = this.vb;
      this.svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    }

    _fitScale() {
      const s = this._size();
      return Math.min(s.w / this.extent.width, s.h / this.extent.height);
    }

    // Frame the whole tree (never magnified beyond 1.5x for tiny trees).
    fit() {
      const s = this._size();
      if (s.w < 2 || s.h < 2) { this._needFit = true; return; } // hidden: retry on resize
      this._needFit = false;
      const scale = Math.min(this._fitScale(), 1.5);
      const w = s.w / scale;
      const h = s.h / scale;
      this.vb = { x: (this.extent.width - w) / 2, y: (this.extent.height - h) / 2, w, h };
      this._lastSize = s;
      this._applyVB();
      if (this.onFit) this.onFit();
    }

    _onResize() {
      if (this._needFit) { this.fit(); return; }
      const s = this._size();
      if (s.w < 2 || s.h < 2) return;
      // Keep the centre and the scale; only the aspect changes.
      const cx = this.vb.x + this.vb.w / 2;
      const cy = this.vb.y + this.vb.h / 2;
      const scale = (this._lastSize ? this._lastSize.w : s.w) / this.vb.w;
      const w = s.w / scale;
      const h = s.h / scale;
      this.vb = { x: cx - w / 2, y: cy - h / 2, w, h };
      this._lastSize = s;
      this._applyVB();
    }

    _zoomAt(clientX, clientY, factor) {
      const s = this._size();
      if (s.w < 2) return;
      const r = this.container.getBoundingClientRect();
      const scale = s.w / this.vb.w;
      const minScale = Math.min(this._fitScale(), 1) * 0.3;
      const next = Math.min(MAX_SCALE, Math.max(minScale, scale * factor));
      if (next === scale) return;
      // Keep the user-space point under the cursor fixed.
      const ux = this.vb.x + ((clientX - r.left) / s.w) * this.vb.w;
      const uy = this.vb.y + ((clientY - r.top) / s.h) * this.vb.h;
      const w = s.w / next;
      const h = s.h / next;
      this.vb = {
        x: ux - ((clientX - r.left) / s.w) * w,
        y: uy - ((clientY - r.top) / s.h) * h,
        w, h,
      };
      this._applyVB();
    }

    _panBy(dxPx, dyPx) {
      const s = this._size();
      if (s.w < 2) return;
      const k = this.vb.w / s.w;
      this.vb.x -= dxPx * k;
      this.vb.y -= dyPx * k;
      this._applyVB();
    }

    // Plain wheel scrolls the page; zoom only with Ctrl/Cmd or a trackpad pinch
    // (which browsers report as a wheel event with ctrlKey set).
    _onWheel(e) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      this._zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * unit * 0.0015));
    }

    _onDown(e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return; // primary button only
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 1) {
        this._dragged = false;
        this._downAt = { x: e.clientX, y: e.clientY };
      } else if (this._pointers.size === 2) {
        this._dragged = true; // a pinch never counts as a click
        this._pinch = this._pinchState();
      }
    }

    _pinchState() {
      const [a, b] = [...this._pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    }

    _onMove(e) {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      // Mouse moving with no button held: the pointerup was missed.
      if (e.pointerType === 'mouse' && e.buttons === 0) { this._reset(); return; }
      if (this._pointers.size >= 2 && this._pinch) {
        p.x = e.clientX;
        p.y = e.clientY;
        const next = this._pinchState();
        this._panBy(next.mx - this._pinch.mx, next.my - this._pinch.my);
        this._zoomAt(next.mx, next.my, next.dist / this._pinch.dist);
        this._pinch = next;
        return;
      }
      // A lone finger scrolls the page (touch-action); only mouse/pen drags pan.
      if (e.pointerType === 'touch') { p.x = e.clientX; p.y = e.clientY; return; }
      if (!this._dragged) {
        if (Math.hypot(e.clientX - this._downAt.x, e.clientY - this._downAt.y) < 5) return;
        this._dragged = true;
        try { this.svg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
        this.svg.classList.add('panning');
      }
      this._panBy(e.clientX - p.x, e.clientY - p.y);
      p.x = e.clientX;
      p.y = e.clientY;
    }

    _onUp(e) {
      this._pointers.delete(e.pointerId);
      this._pinch = null;
      if (this._pointers.size === 1) {
        // Pinch ended with one finger left: continue as a pan from here.
        const [rest] = this._pointers.values();
        this._downAt = { x: rest.x, y: rest.y };
      }
      if (!this._pointers.size) {
        this.svg.classList.remove('panning');
        // Let the click that follows a drag be swallowed, then re-arm.
        const was = this._dragged;
        if (was) root.setTimeout(() => { this._dragged = false; }, 0);
      }
    }

    // Forget every active pointer (cancel, lost capture, window blur).
    _reset() {
      this._pointers.clear();
      this._pinch = null;
      this.svg.classList.remove('panning');
      if (this._dragged) root.setTimeout(() => { this._dragged = false; }, 0);
    }

    destroy() {
      if (this._ro) this._ro.disconnect();
      if (this._mo) this._mo.disconnect();
      if (this._onBlur && typeof root.removeEventListener === 'function') root.removeEventListener('blur', this._onBlur);
    }
  }

  TreeView.layout = layout;
  TreeView.prune = prune;
  EML.TreeView = TreeView;
})(typeof window !== 'undefined' ? window : globalThis);
