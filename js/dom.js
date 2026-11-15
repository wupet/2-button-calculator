(function (root) {
  const EML = (root.EML = root.EML || {});

  // Small DOM helpers shared by the mode scripts. Everything reads
  // root.document at call time, so this file loads fine without a document.

  // el('div', {class, text, any-attribute}, ...children) -> element. Text goes
  // through textContent, never innerHTML.
  function el(tag, props = {}, ...kids) {
    const node = root.document.createElement(tag);
    for (const k of Object.keys(props)) {
      if (k === 'class') node.className = props[k];
      else if (k === 'text') node.textContent = props[k];
      else node.setAttribute(k, props[k]);
    }
    for (const kid of kids) node.append(kid);
    return node;
  }

  // A <button type="button">.
  function btn(text, cls, props = {}) {
    return el('button', Object.assign({ type: 'button', class: cls, text }, props));
  }

  // Read live on every call, so a change in the OS setting applies without a reload.
  function reduceMotion() {
    return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  EML.dom = { el, btn, reduceMotion };
})(typeof window !== 'undefined' ? window : globalThis);
