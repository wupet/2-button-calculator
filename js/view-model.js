(function (root) {
  const EML = (root.EML = root.EML || {});

  // View model: turns a recipe CallNode tree plus fold state into the tree of
  // visible positions (VNodes). No DOM.
  //   VNode = { path, call, kind: 'one'|'var'|'eml'|'blob', label, children }
  // Paths: root ''; blob/eml children `${path}/${i}`; an unfolded node's body
  // is built at `${path}>`.
  const viewModel = (EML.viewModel = {});

  viewModel.build = (rootCall, opts = {}, cap = 1500) => {
    const unfolded = opts.unfolded || new Set();
    const unfoldAll = !!opts.unfoldAll;
    let count = 0;
    let rootV = null;
    // Explicit stack: unfolded call chains can be deep.
    const stack = [{ call: rootCall, path: '', parent: null }];
    while (stack.length) {
      const { call: c0, path: p0, parent } = stack.pop();
      let call = c0;
      let path = p0;
      // Descend through unfolded bodies; each level appends '>' to the path.
      while (call.body !== null && (unfoldAll || unfolded.has(path))) {
        call = call.body;
        path += '>';
      }
      const v = { path, call, kind: 'blob', label: call.label, children: [] };
      if (call.body === null) {
        v.kind = call.prim === 'eml' ? 'eml' : call.prim === 'var' ? 'var' : 'one';
      }
      if (++count > cap) return { tooBig: true, count: EML.dag.K(rootCall.root) };
      if (parent) parent.children.push(v); else rootV = v;
      if (v.kind === 'eml' || v.kind === 'blob') {
        const args = call.args;
        // Push in reverse so children are built (and numbered) left to right.
        for (let i = args.length - 1; i >= 0; i--) {
          stack.push({ call: args[i], path: `${path}/${i}`, parent: v });
        }
      }
    }
    return { root: rootV, count };
  };
})(typeof window !== 'undefined' ? window : globalThis);
