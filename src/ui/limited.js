// A limited environment: a file preview (SharePoint's, for one) shows the page
// in a sandbox without storage, downloads or workers. The page's HTML carries a
// warning right below the header; the check below runs inline before the first
// paint (build.mjs puts this module's code there) and hides the warning where
// the environment is full. Where no script runs, the warning stays.
// design/output/instrument.md, "A limited environment"; the research in
// design/research/limited-environment.md.

// What each finding stops, as the warning lists it.
const REASONS = {
  sandbox: 'sandboxed by the site showing it',
  storage: 'no storage: nothing is saved, no autosave',
  downloads: 'downloads blocked: Save and Export do not work',
  workers: 'no background workers: slower, no live plant',
};

// Probes the environment. Every probe is guarded: a probe that throws reads as
// a missing feature, never as an error of the page.
export function limitedProbe(w = window) {
  const tryOr = (f, fallback) => { try { return f(); } catch { return fallback; } };
  const storageOk = (name) => tryOr(() => {
    const s = w[name], k = '__lt-probe';
    s.setItem(k, '1');
    const ok = s.getItem(k) === '1';
    s.removeItem(k);
    return ok;
  }, false);
  // The frame's sandbox attribute, where the parent lets us read it (only a
  // same-origin parent does); null where it cannot be read or is not set.
  const sandbox = tryOr(() => w.frameElement?.getAttribute('sandbox') ?? null, null);
  return {
    host: tryOr(() => !!w.__ltHost, false),
    localStorage: storageOk('localStorage'),
    sessionStorage: storageOk('sessionStorage'),
    opaqueOrigin: tryOr(() => w.location.origin === 'null' || w.origin === 'null', false),
    file: tryOr(() => w.location.protocol === 'file:', false),
    // A parent of another origin makes reading top throw: framed all the same.
    framed: tryOr(() => w.top !== w.self, true),
    downloads: sandbox === null ? null : /(^|\s)allow-downloads(\s|$)/.test(sandbox),
    workers: tryOr(() => {
      const url = w.URL.createObjectURL(new w.Blob([''], { type: 'text/javascript' }));
      try { new w.Worker(url).terminate(); } finally { w.URL.revokeObjectURL(url); }
      return true;
    }, false),
  };
}

// The decision, from the probes alone. A known host is never limited. A
// sandbox shows as an opaque origin; a file opened directly has one too, so
// that counts only framed or served from a site. Missing storage alone, in a
// page of its own, is a private window or a browser setting, not a preview:
// it counts only framed.
export function limitedVerdict(p) {
  if (p.host) return { limited: false, reasons: [] };
  const found = {
    sandbox: p.opaqueOrigin && (p.framed || !p.file),
    storage: !p.localStorage && p.framed,
    downloads: p.downloads === false,
    workers: !p.workers,
  };
  const reasons = Object.keys(found).filter((k) => found[k]);
  return { limited: reasons.length > 0, reasons };
}

// Runs inline, before the first paint: marks the document so the stylesheet
// hides the warning where the page has all it needs.
export function markLimited(w = window) {
  const v = limitedVerdict(limitedProbe(w));
  w.document.documentElement.classList.add(v.limited ? 'lt-limited' : 'lt-full');
  return v;
}

// At start: lists what was found in the warning. It stays visible: there is
// no hiding it.
export function explainLimited(doc, v) {
  const box = doc.getElementById('lt-limited');
  doc.documentElement.classList.toggle('lt-limited', v.limited);
  doc.documentElement.classList.toggle('lt-full', !v.limited);
  if (!box || !v.limited) return;
  const list = doc.getElementById('lt-limited-why');
  if (list) list.textContent = `Found here: ${v.reasons.map((r) => REASONS[r]).join('; ')}.`;
}

// The page's start: the verdict, shown, and a getter for it. A policy that
// forbids workers (worker-src 'none') lets one be made and fails it later, so
// a worker is also started and, if it fails, the verdict is made again.
export function startLimited(w = window) {
  const probe = limitedProbe(w);
  let v = limitedVerdict(probe);
  explainLimited(w.document, v);
  if (probe.workers) {
    try {
      const url = w.URL.createObjectURL(new w.Blob(['postMessage(1)'], { type: 'text/javascript' }));
      const worker = new w.Worker(url);
      const done = (ok) => {
        worker.terminate(); w.URL.revokeObjectURL(url);
        if (!ok) { v = limitedVerdict({ ...probe, workers: false }); explainLimited(w.document, v); }
      };
      worker.onmessage = () => done(true);
      worker.onerror = () => done(false);
    } catch { /* the probe saw it work: nothing new to learn */ }
  }
  return () => structuredClone(v);
}
