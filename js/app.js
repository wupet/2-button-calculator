(function (root) {
  const EML = (root.EML = root.EML || {});
  const doc = root.document;
  if (!doc) return; // not in a browser (e.g. loaded by a test harness)

  const MODE_KEY = 'eml.mode';
  const LARGE_KEY = 'eml.large';
  const MODULES = { two: 'modeTwo', sci: 'modeSci' };

  const store = {
    get(key) {
      try { return root.localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
      try { root.localStorage.setItem(key, value); } catch (e) { /* storage blocked */ }
    },
  };

  const sections = {
    two: doc.getElementById('mode-two'),
    sci: doc.getElementById('mode-sci'),
  };
  const initialised = { two: false, sci: false };
  let current = null;

  // A mode module's init runs the first time its section is shown, so it can
  // measure a visible container. Every later show fires "eml:show" on the section.
  function setMode(mode) {
    if (!sections[mode]) mode = 'two';
    current = mode;
    for (const key of Object.keys(sections)) {
      sections[key].hidden = key !== mode;
    }
    for (const btn of doc.querySelectorAll('#mode-switch [data-mode]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.mode === mode));
    }
    store.set(MODE_KEY, mode);

    const el = sections[mode];
    if (!initialised[mode]) {
      initialised[mode] = true;
      const mod = EML[MODULES[mode]];
      if (mod && typeof mod.init === 'function') mod.init(el);
    }
    el.dispatchEvent(new CustomEvent('eml:show', { bubbles: false }));
  }

  function setLarge(on) {
    doc.documentElement.classList.toggle('large', on);
    const btn = doc.getElementById('btn-large');
    if (btn) btn.setAttribute('aria-pressed', String(on));
    store.set(LARGE_KEY, on ? '1' : '0');
  }

  EML.app = { setMode, setLarge, get mode() { return current; } };

  for (const btn of doc.querySelectorAll('#mode-switch [data-mode]')) {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  }
  const explain = doc.getElementById('btn-explain');
  if (explain) {
    explain.addEventListener('click', () => {
      if (EML.explainer) EML.explainer.open();
    });
  }
  const large = doc.getElementById('btn-large');
  if (large) {
    large.addEventListener('click', () => setLarge(!doc.documentElement.classList.contains('large')));
  }

  setLarge(store.get(LARGE_KEY) === '1');
  setMode(store.get(MODE_KEY) === 'sci' ? 'sci' : 'two');
})(typeof window !== 'undefined' ? window : globalThis);
