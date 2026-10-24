/* ═══════════════════════════════════════════════════════════
   keyframes.js — values that change over time (ccl13, 0.39.0)
   window.SenotelKeys

   CapCut's keyframe diamond: set a thing one way at one moment and another
   way at a later moment, and it moves between them by itself. A keyframe
   holds EVERY keyframable value of its item at that moment (as CapCut's
   does), so one tap of the diamond marks the whole look.

     item.kf = { "<path>": [[t, value, ease], ...] }   sorted by t

   t is seconds from the item's own start, so moving the item on the
   timeline takes its keyframes with it. A path is a property name or one
   level into an object ("x", "mask.s"). The ease of a keyframe shapes the
   way out of it, toward the next one.
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  "use strict";

  const EASES = [["linear", "Linear"], ["in", "Ease in"], ["out", "Ease out"], ["smooth", "Smooth"]];
  const EASE = {
    linear: (p) => p,
    in: (p) => p * p * p,
    out: (p) => 1 - Math.pow(1 - p, 3),
    smooth: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2)
  };
  const EPS = 1 / 60;   // two keyframes closer than a frame are the same moment

  function get(item, path) {
    const i = path.indexOf(".");
    if (i < 0) return item[path];
    const o = item[path.slice(0, i)];
    return o ? o[path.slice(i + 1)] : undefined;
  }
  function set(item, path, v) {
    const i = path.indexOf(".");
    if (i < 0) { item[path] = v; return; }
    const k = path.slice(0, i);
    if (!item[k]) return;
    item[k][path.slice(i + 1)] = v;
  }

  // the value of one keyframed path at t
  function valueAt(list, t) {
    if (!list || !list.length) return undefined;
    if (t <= list[0][0]) return list[0][1];
    const last = list[list.length - 1];
    if (t >= last[0]) return last[1];
    for (let i = 0; i < list.length - 1; i++) {
      const a = list[i], b = list[i + 1];
      if (t >= a[0] && t <= b[0]) {
        if (typeof a[1] !== "number" || typeof b[1] !== "number") return a[1];   // on/off values step
        const span = b[0] - a[0];
        const p = span > 0 ? (t - a[0]) / span : 1;
        return a[1] + (b[1] - a[1]) * (EASE[a[2]] || EASE.linear)(p);
      }
    }
    return last[1];
  }

  const has = (item) => !!(item && item.kf && Object.keys(item.kf).some((k) => item.kf[k] && item.kf[k].length));

  /* The item as it is at t: a copy with its keyframed values in place (and
     its nested objects copied too, so the item itself is never touched). */
  function view(item, t) {
    if (!has(item)) return item;
    const out = Object.assign({}, item);
    Object.keys(item.kf).forEach((path) => {
      const v = valueAt(item.kf[path], t);
      if (v === undefined) return;
      const i = path.indexOf(".");
      if (i >= 0) {
        const k = path.slice(0, i);
        if (!item[k]) return;
        if (out[k] === item[k]) out[k] = Object.assign({}, item[k]);
      }
      set(out, path, v);
    });
    return out;
  }

  // every moment that has a keyframe, in order
  function times(item) {
    if (!has(item)) return [];
    const all = [];
    Object.keys(item.kf).forEach((p) => (item.kf[p] || []).forEach((k) => {
      if (!all.some((x) => Math.abs(x - k[0]) < EPS)) all.push(k[0]);
    }));
    return all.sort((a, b) => a - b);
  }
  const keyAt = (item, t) => times(item).find((x) => Math.abs(x - t) < EPS);

  function easeAt(item, t) {
    if (!has(item)) return "linear";
    for (const p of Object.keys(item.kf)) {
      const k = (item.kf[p] || []).find((x) => Math.abs(x[0] - t) < EPS);
      if (k) return k[2] || "linear";
    }
    return "linear";
  }

  /* Write the item's present values for every path as a keyframe at t
     (replacing one that is already there). */
  function mark(item, t, paths, ease) {
    if (!item.kf) item.kf = {};
    const at = keyAt(item, t);
    const tt = at != null ? at : Math.max(0, t);
    const e = ease || (at != null ? easeAt(item, at) : "linear");
    paths.forEach((p) => {
      const v = get(item, p);
      if (v === undefined || v === null) return;
      const list = item.kf[p] || (item.kf[p] = []);
      const i = list.findIndex((k) => Math.abs(k[0] - tt) < EPS);
      if (i >= 0) list[i] = [tt, v, e];
      else { list.push([tt, v, e]); list.sort((a, b) => a[0] - b[0]); }
    });
    return tt;
  }

  function unmark(item, t) {
    if (!has(item)) return;
    Object.keys(item.kf).forEach((p) => {
      item.kf[p] = item.kf[p].filter((k) => Math.abs(k[0] - t) >= EPS);
      if (!item.kf[p].length) delete item.kf[p];
    });
    if (!Object.keys(item.kf).length) delete item.kf;
  }

  function setEase(item, t, ease) {
    if (!has(item)) return;
    Object.keys(item.kf).forEach((p) => item.kf[p].forEach((k) => { if (Math.abs(k[0] - t) < EPS) k[2] = ease; }));
  }

  /* Set the item's own values to what its keyframes say at t, so an edit
     starts from what is on screen. */
  function settle(item, t) {
    if (!has(item)) return;
    Object.keys(item.kf).forEach((p) => {
      const v = valueAt(item.kf[p], t);
      if (v !== undefined) set(item, p, v);
    });
  }

  /* After an edit: if a keyframed item's values no longer match its
     keyframes at t, keep the change as a keyframe at t (CapCut's way: on a
     keyframe it edits that one, between two it adds one). True if it did. */
  function capture(item, t, paths) {
    if (!has(item)) return false;
    const changed = paths.some((p) => {
      const v = get(item, p);
      if (v === undefined || v === null) return false;
      const k = item.kf[p] ? valueAt(item.kf[p], t) : undefined;
      if (k === undefined) return true;
      return typeof v === "number" ? Math.abs(v - k) > 1e-6 : v !== k;
    });
    if (!changed) return false;
    mark(item, t, paths);
    return true;
  }

  // drop keyframes past an item's (new) length, and move them with a trim of its start
  function shift(item, dt, len) {
    if (!has(item)) return;
    Object.keys(item.kf).forEach((p) => {
      item.kf[p] = item.kf[p].map((k) => [k[0] - dt, k[1], k[2]]).filter((k) => k[0] >= -EPS && (len == null || k[0] <= len + EPS));
      if (!item.kf[p].length) delete item.kf[p];
    });
    if (!Object.keys(item.kf).length) delete item.kf;
  }

  global.SenotelKeys = { EASES, EASE, EPS, get, set, valueAt, has, view, times, keyAt, easeAt, mark, unmark, setEase, settle, capture, shift };
})(typeof window !== "undefined" ? window : globalThis);
