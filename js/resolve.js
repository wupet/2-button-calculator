(function (root) {
  const EML = (root.EML = root.EML || {});

  // Step resolver over a visible tree (see view-model.js). Resolves positions
  // from the leaves up, one level per step; a folded blob is one position.
  class Resolver {
    constructor(vroot, evalNode) {
      this.vroot = vroot;
      this.evalNode = evalNode;
      this.values = new Map();
      this.history = [];
      // Post-order list of all positions, and per-position height.
      this.order = [];
      this.heights = new Map();
      const stack = [{ v: vroot, i: 0 }];
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.i < top.v.children.length) {
          stack.push({ v: top.v.children[top.i++], i: 0 });
          continue;
        }
        stack.pop();
        const v = top.v;
        let h;
        if (v.kind === 'one' || v.kind === 'var') h = 0;
        else {
          h = 0;
          for (const c of v.children) h = Math.max(h, this.heights.get(c));
          h += 1;
        }
        this.heights.set(v, h);
        this.order.push(v);
      }
      this.totalSteps = this.heights.get(vroot);
      this.reset();
    }

    get stepIndex() { return this.history.length; }

    get done() { return this.values.has(this.vroot.path); }

    _leaves() {
      for (const v of this.order) {
        if (v.kind === 'one' || v.kind === 'var') this.values.set(v.path, this.evalNode(v.call.root));
      }
    }

    frontier() {
      return this.order.filter((v) => !this.values.has(v.path)
        && v.children.every((c) => this.values.has(c.path)));
    }

    step() {
      const f = this.frontier();
      if (!f.length) return [];
      const vals = f.map((v) => this.evalNode(v.call.root));
      f.forEach((v, i) => this.values.set(v.path, vals[i]));
      this.history.push(f);
      return f;
    }

    back() {
      const f = this.history.pop();
      if (f) for (const v of f) this.values.delete(v.path);
    }

    reset() {
      this.values.clear();
      this.history = [];
      this._leaves();
    }
  }

  EML.Resolver = Resolver;
})(typeof window !== 'undefined' ? window : globalThis);
