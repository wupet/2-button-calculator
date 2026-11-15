(function (root) {
  const EML = (root.EML = root.EML || {});

  const ARXIV = 'https://arxiv.org/abs/2603.21852';

  const TEMPLATE = `
    <div class="ex-head">
      <h2 id="explainer-title">What is EML?</h2>
      <button type="button" class="btn" data-close>Close</button>
    </div>
    <div class="ex-body">
      <section>
        <h3>One operator</h3>
        <p>A scientific calculator has dozens of buttons: sin, cos, &radic;, ln, +, &times;, &pi;&hellip;
          A recent paper shows that a single two-input operator, together with the number&nbsp;1, can rebuild
          all of them.</p>
        <p class="ex-big">eml(x, y) = e<sup>x</sup> &minus; ln&#8239;y</p>
      </section>

      <section>
        <h3>Why the constant 1</h3>
        <p>Because ln&nbsp;1&nbsp;=&nbsp;0. Feed the operator a&nbsp;1 in the second slot and the
          logarithm vanishes, leaving a plain exponential. Everything else is built from that trick.</p>
      </section>

      <section>
        <h3>Watch it work</h3>
        <p>Drag the slider. Each line builds a familiar function out of nothing but <code>eml</code> and&nbsp;1,
          and the result is compared with the browser&rsquo;s own maths.</p>
        <div class="ex-live">
          <div class="ex-slider">
            <label for="ex-x">x = <output id="ex-x-out">2.00</output></label>
            <input id="ex-x" type="range" min="0.1" max="5" step="0.01" value="2">
          </div>
          <div class="ex-row">
            <div class="ex-expr">e = eml(1, 1)</div>
            <dl class="ex-vals"><dt>eml</dt><dd id="ex-e-eml"></dd><dt>Math.E</dt><dd id="ex-e-ref"></dd></dl>
            <div class="ex-match" id="ex-e-match"></div>
          </div>
          <div class="ex-row">
            <div class="ex-expr">e<sup>x</sup> = eml(x, 1)</div>
            <dl class="ex-vals"><dt>eml</dt><dd id="ex-exp-eml"></dd><dt>Math.exp</dt><dd id="ex-exp-ref"></dd></dl>
            <div class="ex-match" id="ex-exp-match"></div>
          </div>
          <div class="ex-row">
            <div class="ex-expr">ln&#8239;x = eml(1, eml(eml(1, x), 1))</div>
            <dl class="ex-vals"><dt>eml</dt><dd id="ex-ln-eml"></dd><dt>Math.log</dt><dd id="ex-ln-ref"></dd></dl>
            <div class="ex-match" id="ex-ln-match"></div>
          </div>
        </div>
      </section>

      <section>
        <h3>Like a NAND gate</h3>
        <p>In digital electronics, NAND is &ldquo;universal&rdquo;: every logic circuit can be wired from
          NAND gates alone. EML plays that role for continuous maths. It is one repeated building block, and
          the paper&rsquo;s point is that nothing else is needed.</p>
      </section>

      <section>
        <h3>The whole grammar</h3>
        <p class="ex-big">S &rarr; 1 &#124; eml(S, S)</p>
        <p>A valid expression is either the number&nbsp;1 or <code>eml</code> of two valid expressions.
          That is the entire language. In the Two-button mode you type exactly that: a <b>1</b> key and
          an <b>EML</b> key.</p>
      </section>

      <section>
        <h3>Why complex numbers show up</h3>
        <p>Getting &minus;1, <i>i</i> and &pi; takes a detour: ln(&minus;1) = <i>i</i>&pi;. So the middle of a
          calculation can be a complex number even when the final answer is real. This page shows complex
          values as <code>a + bi</code> wherever they appear.</p>
      </section>

      <section>
        <h3>Caveats</h3>
        <ul>
          <li>Numbers are ordinary floating point. Big intermediate values can overflow, and tiny
            rounding errors are possible.</li>
          <li>ln of a complex number uses the principal branch, so results near the branch cut (the negative
            real axis) depend on that choice.</li>
          <li>Pure EML expressions get long fast. That is why the Scientific mode lets you fold them into
            named pieces.</li>
        </ul>
      </section>

      <section>
        <h3>Source</h3>
        <p>Odrzywo&#322;ek, <cite>All elementary functions from a single operator</cite>.
          <a href="${ARXIV}" target="_blank" rel="noopener noreferrer">arXiv:2603.21852</a></p>
      </section>
    </div>`;

  const C = () => EML.C;

  // 12 significant digits, with a clean zero for values that are numerically zero.
  const fmt = (v) => {
    if (!Number.isFinite(v)) return String(v);
    if (Math.abs(v) < 1e-12) return '0';
    return String(Number(v.toPrecision(12)));
  };

  const compare = (a, b) => {
    const diff = Math.abs(a - b);
    const ok = diff <= 1e-11 * Math.max(1, Math.abs(b));
    return { ok, text: ok ? 'matches' : 'differ by ' + diff.toExponential(1) };
  };

  let built = false;

  function build(dlg) {
    dlg.innerHTML = TEMPLATE;
    const q = (id) => dlg.querySelector('#' + id);
    const slider = q('ex-x');
    const one = () => C().cx(1);

    const show = (id, eml, ref) => {
      q(id + '-eml').textContent = fmt(eml);
      q(id + '-ref').textContent = fmt(ref);
      const m = compare(eml, ref);
      const el = q(id + '-match');
      el.textContent = (m.ok ? '✓ ' : '✗ ') + m.text;
      el.classList.toggle('off', !m.ok);
    };

    const update = () => {
      const x = Number(slider.value);
      const cx = C().cx;
      const eml = C().eml;
      q('ex-x-out').textContent = x.toFixed(2);
      show('ex-e', eml(one(), one()).re, Math.E);
      show('ex-exp', eml(cx(x), one()).re, Math.exp(x));
      // ln x = eml(1, eml(eml(1, x), 1))
      const ln = eml(one(), eml(eml(one(), cx(x)), one()));
      show('ex-ln', ln.re, Math.log(x));
    };

    slider.addEventListener('input', update);
    update();

    // A backdrop click is one where both the press and the click land on the
    // dialog element itself. A press inside (e.g. dragging the slider) that is
    // released over the backdrop must not close it.
    let pressOnBackdrop = false;
    dlg.addEventListener('pointerdown', (ev) => { pressOnBackdrop = ev.target === dlg; });
    dlg.addEventListener('click', (ev) => {
      const backdrop = ev.target === dlg && pressOnBackdrop;
      pressOnBackdrop = false;
      if (backdrop || ev.target.closest('[data-close]')) dlg.close();
    });
  }

  EML.explainer = {
    open() {
      const dlg = root.document.getElementById('explainer');
      if (!dlg) return;
      if (!built) {
        build(dlg);
        built = true;
      }
      if (!dlg.open) dlg.showModal();
      const body = dlg.querySelector('.ex-body');
      if (body) body.scrollTop = 0;
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
