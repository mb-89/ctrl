// Fingerprints of every library system's simulation in the page (simulateSystem
// of its diagram and signals over one period, at its own record step): a hash
// of the bits of every recorded signal. test/core.test.mjs holds the library
// to them, so a change to the core that alters any system's run is caught.
//   node tools/library-fingerprints.mjs   -> prints the JSON for test/fixtures/library-fingerprints.json
import { SYSTEM_LIBRARY } from '../src/core/systems.js';
import { normalizeDiagram } from '../src/core/diagram.js';
import { simulateSystem } from '../src/core/sim.js';
import { defaultSampleTime } from '../src/core/project.js';

export function fingerprint(sys) {
  const d = normalizeDiagram(sys.plant.diagram);
  const duration = Math.max(...Object.values(sys.input.signals).map((s) => s.period), 1);
  const sim = { duration, sampleTime: sys.sim?.sampleTime ?? defaultSampleTime(duration) };
  const out = simulateSystem(d, sys.input.signals, sim);
  let h = 2166136261 >>> 0;
  const names = Object.keys(out.signals).sort();
  for (const n of names) {
    const b = new Uint32Array(Float64Array.from(out.signals[n]).buffer);
    for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i], 16777619) >>> 0;
  }
  return { samples: out.t.length, signals: names.join(','), hash: h.toString(16) };
}

export const libraryFingerprints = () => Object.fromEntries(SYSTEM_LIBRARY.filter((s) => !JSON.stringify(s.plant).includes('"external"')).map((s) => [s.name, fingerprint(s)]));

if (process.argv[1]?.endsWith('library-fingerprints.mjs')) console.log(JSON.stringify(libraryFingerprints(), null, 2));
