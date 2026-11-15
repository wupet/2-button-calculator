(function (root) {
  const EML = (root.EML = root.EML || {});
  const { C } = EML;

  // Constants whose recognised value reads as a discovery ("= e!"); plain
  // numbers get no exclamation mark ("= 2!" would read as a factorial).
  const EXCITING = new Set(['e', 'π', 'i', '−i', 'ln 2', '√2', 'e^e']);

  // Text for the recognizer badge, or '' when the value is not a known constant.
  function badgeText(value) {
    const label = EML.recognize(value);
    if (label === null) return '';
    return '= ' + label + (EXCITING.has(label) ? '!' : '');
  }

  // Presets playback speeds, key presses per second.
  const SPEEDS = [
    { id: 'slow', label: 'Slow', rate: 2 },
    { id: 'medium', label: 'Medium', rate: 8 },
    { id: 'fast', label: 'Fast', rate: 30 },
    { id: 'turbo', label: 'Turbo', rate: 300 },
  ];

  const count = (n) => Number(n).toLocaleString('en-US');

  function init(section) {
    const doc = root.document;
    if (!doc) return;

    const { el } = EML.dom;

    const machine = new EML.RpnMachine();

    // ---- DOM -------------------------------------------------------------------
    const tapeEl = el('div', { class: 'm2-tape mono', role: 'log', 'aria-label': 'Key presses so far' });
    const stackEl = el('ol', { class: 'm2-stack', 'aria-label': 'Stack, newest value last' });
    const msgEl = el('p', { class: 'hint m2-msg', role: 'status', 'aria-live': 'polite' });

    const key1 = el('button', { type: 'button', class: 'keycap m2-key', 'aria-label': 'Push the number 1', text: '1' });
    const keyE = el('button', { type: 'button', class: 'keycap m2-key m2-eml', 'aria-label': 'EML: combine the top two values', text: 'EML' });
    const undoBtn = el('button', { type: 'button', class: 'btn', text: 'Undo' });
    const clearBtn = el('button', { type: 'button', class: 'btn', text: 'Clear' });

    const presetSel = el('select', { id: 'm2-preset', class: 'm2-select' });
    for (const p of EML.presets) presetSel.append(el('option', { value: p.id, text: p.label }));
    presetSel.value = EML.presets[0].id;
    const playBtn = el('button', { type: 'button', class: 'btn primary', text: 'Play' });
    const skipBtn = el('button', { type: 'button', class: 'btn', text: 'Skip to end' });
    const speedSel = el('select', { id: 'm2-speed', class: 'm2-select' });
    for (const s of SPEEDS) speedSel.append(el('option', { value: s.id, text: s.label }));
    speedSel.value = 'medium';
    const pinfoEl = el('p', { class: 'hint m2-pinfo' });

    const valueEl = el('div', { class: 'value m2-value' });
    const badgeEl = el('span', { class: 'm2-badge', hidden: '' });
    const treeBox = el('div', { class: 'm2-tree' });
    const treeMsg = el('p', { class: 'hint m2-treemsg' });
    const fitBtn = el('button', { type: 'button', class: 'btn btn-fit m2-fit', text: 'Fit tree', title: 'Re-centre and zoom to show the whole tree' });

    const calc = el('div', { class: 'card m2-calc' },
      el('h2', { class: 'm2-h', text: 'Build with two buttons' }),
      el('div', { class: 'm2-readout' },
        el('div', { class: 'm2-label', text: 'Tape' }), tapeEl,
        el('div', { class: 'm2-label', text: 'Stack' }), stackEl),
      msgEl,
      el('div', { class: 'm2-keys' }, key1, keyE),
      el('div', { class: 'm2-util' }, undoBtn, clearBtn),
      el('div', { class: 'm2-presets' },
        el('div', { class: 'm2-field' },
          el('label', { for: 'm2-preset', text: 'Build a constant' }), presetSel),
        el('div', { class: 'm2-field' },
          el('label', { for: 'm2-speed', text: 'Speed' }), speedSel),
        el('div', { class: 'm2-playrow' }, playBtn, skipBtn)),
      pinfoEl);

    const treeCard = el('div', { class: 'card m2-treecard' },
      el('div', { class: 'm2-top' },
        el('div', {}, el('div', { class: 'm2-label', text: 'Top of stack' }), valueEl),
        badgeEl),
      treeBox, treeMsg, fitBtn);

    section.textContent = '';
    section.append(el('div', { class: 'panels m2' }, calc, treeCard));

    // ---- state -----------------------------------------------------------------
    let tv = null;
    let play = null; // {tape, pos, timer, label} while a preset is running or paused
    const tapeCache = new Map();
    let error = '';

    const presetById = (id) => EML.presets.find((p) => p.id === id);
    function tapeFor(id) {
      if (!tapeCache.has(id)) tapeCache.set(id, EML.presetTape(presetById(id).call));
      return tapeCache.get(id);
    }

    function renderReadout() {
      tapeEl.textContent = machine.tape;
      tapeEl.scrollTop = tapeEl.scrollHeight;

      const frag = doc.createDocumentFragment();
      machine.stack.forEach((item, i) => {
        frag.append(el('li', {},
          el('span', { class: 'm2-idx', text: String(i + 1) }),
          el('span', { class: 'value', text: C.format(item.value, 10) })));
      });
      stackEl.textContent = '';
      stackEl.append(frag);
      stackEl.scrollTop = stackEl.scrollHeight;
      if (!machine.stack.length) {
        stackEl.append(el('li', { class: 'm2-empty hint', text: '(empty)' }));
      }

      const top = machine.top;
      valueEl.textContent = top ? C.format(top.value, 10) : '—';
      const badge = top ? badgeText(top.value) : '';
      badgeEl.textContent = badge;
      badgeEl.hidden = !badge;

      undoBtn.disabled = machine._history.length === 0;
      clearBtn.disabled = machine.stack.length === 0 && machine.tape === '';

      if (error) {
        msgEl.className = 'error m2-msg';
        msgEl.textContent = error;
      } else {
        msgEl.className = 'hint m2-msg';
        const n = machine.stack.length;
        msgEl.textContent = n === 0
          ? 'Press 1 to put the number 1 on the stack.'
          : n === 1
            ? 'Press 1 again, then EML to combine the top two numbers.'
            : 'EML takes the top two numbers a, b and pushes e^a − ln b. Try 1, 1, EML.';
      }
    }

    function renderTree() {
      const top = machine.top;
      if (!top) {
        treeBox.hidden = true;
        fitBtn.hidden = true;
        treeMsg.textContent = 'The tree of the top value appears here.';
        return;
      }
      // Stack items are raw eml calls, so unfold-all shows only E and 1.
      const r = EML.viewModel.build(top.call, { unfoldAll: true });
      if (r.tooBig) {
        treeBox.hidden = true;
        fitBtn.hidden = true;
        treeMsg.textContent = `Tree too large to draw (${count(r.count)} nodes) — the value is still exact`;
        return;
      }
      treeMsg.textContent = r.count === 1 ? '' : `${count(r.count)} nodes.`;
      treeBox.hidden = false;
      fitBtn.hidden = false;
      if (!tv) tv = new EML.TreeView(treeBox, {});
      tv.render(r.root, null, { fit: true });
    }

    function render(opts = {}) {
      renderReadout();
      if (opts.tree !== false) renderTree();
    }

    // ---- playback --------------------------------------------------------------
    function updatePlayUI() {
      const running = !!(play && play.timer);
      playBtn.textContent = running ? 'Pause' : play ? 'Resume' : 'Play';
      if (play) {
        pinfoEl.textContent = `Pressing ${play.label}: ${count(play.pos)} of ${count(play.tape.length)} key presses`;
      } else {
        const p = presetById(presetSel.value);
        const tape = tapeFor(p.id);
        pinfoEl.textContent = tape
          ? `${p.label} takes ${count(tape.length)} key presses.`
          : `${p.label} is too long to play here.`;
      }
      playBtn.disabled = !tapeFor(presetSel.value) && !play;
      skipBtn.disabled = playBtn.disabled;
    }

    function dropPlay() {
      if (play && play.timer) root.clearTimeout(play.timer);
      play = null;
      updatePlayUI();
    }

    function pressChar(ch) {
      if (ch === '1') machine.push1();
      else machine.pressEml();
    }

    function finishPlay() {
      if (play && play.timer) root.clearTimeout(play.timer);
      play = null;
      updatePlayUI();
      render();
    }

    function tick() {
      if (!play) return;
      const rate = SPEEDS.find((s) => s.id === speedSel.value).rate;
      const interval = Math.max(33, 1000 / rate);
      const n = Math.max(1, Math.round((rate * interval) / 1000));
      for (let i = 0; i < n && play.pos < play.tape.length; i++) pressChar(play.tape[play.pos++]);
      if (play.pos >= play.tape.length) { finishPlay(); return; }
      // Reduced motion: keep the readout live but draw the tree only when done.
      render({ tree: !EML.dom.reduceMotion() });
      updatePlayUI();
      play.timer = root.setTimeout(tick, interval);
    }

    function startPlay() {
      const p = presetById(presetSel.value);
      const tape = tapeFor(p.id);
      if (!tape) return;
      machine.clear();
      error = '';
      play = { tape, pos: 0, timer: null, label: p.label };
      render();
      play.timer = root.setTimeout(tick, 0);
      updatePlayUI();
    }

    playBtn.addEventListener('click', () => {
      if (play && play.timer) {            // pause
        root.clearTimeout(play.timer);
        play.timer = null;
        updatePlayUI();
        render();                          // reduced motion: show the tree on pause
      } else if (play) {                   // resume
        play.timer = root.setTimeout(tick, 0);
        updatePlayUI();
      } else {
        startPlay();
      }
    });

    skipBtn.addEventListener('click', () => {
      if (!play) {
        const p = presetById(presetSel.value);
        const tape = tapeFor(p.id);
        if (!tape) return;
        machine.clear();
        error = '';
        play = { tape, pos: 0, timer: null, label: p.label };
      }
      while (play.pos < play.tape.length) pressChar(play.tape[play.pos++]);
      finishPlay();
    });

    presetSel.addEventListener('change', () => dropPlay());
    speedSel.addEventListener('change', () => { /* picked up by the next tick */ });

    // ---- manual presses (each cancels playback) -------------------------------
    function press1() {
      dropPlay();
      error = '';
      machine.push1();
      render();
    }
    function pressEml() {
      dropPlay();
      error = machine.pressEml() || '';
      render();
    }

    key1.addEventListener('click', press1);
    keyE.addEventListener('click', pressEml);
    undoBtn.addEventListener('click', () => { dropPlay(); error = ''; machine.undo(); render(); });
    clearBtn.addEventListener('click', () => { dropPlay(); error = ''; machine.clear(); render(); });
    fitBtn.addEventListener('click', () => { if (tv) tv.fit(); });

    doc.addEventListener('keydown', (e) => {
      if (section.hidden || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (doc.querySelector('dialog[open]')) return;
      const t = e.target;
      if (t && t.closest && t.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === '1') {
        e.preventDefault();
        press1();
      } else if (e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        pressEml();
      } else if (e.key === 'Enter') {
        // A focused button / link / unfoldable node keeps its native Enter.
        if (t && t.closest && t.closest('button, a, [role="button"]')) return;
        e.preventDefault();
        pressEml();
      }
    });

    section.addEventListener('eml:show', () => { if (tv && !treeBox.hidden) tv.fit(); });
    // Leaving this mode pauses a running preset (it can be resumed on return).
    section.addEventListener('eml:hide', () => {
      if (play && play.timer) {
        root.clearTimeout(play.timer);
        play.timer = null;
        updatePlayUI();
        render();
      }
    });

    render();
    updatePlayUI();
  }

  EML.modeTwo = { init, badgeText, SPEEDS };
})(typeof window !== 'undefined' ? window : globalThis);
