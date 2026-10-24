// 1-2-5 sequences, as on a scope's scale knobs.

// The smallest 1-2-5 value that is >= v.
export function ceil125(v) {
  const e = Math.floor(Math.log10(v));
  for (let k = e; k <= e + 1; k++) for (const m of [1, 2, 5]) { const c = Number((m * 10 ** k).toPrecision(3)); if (c >= v * (1 - 1e-9)) return c; }
  return 10 ** (e + 1);
}

// The 1-2-5 step nearest to v, moved dir steps up or down.
export function step125(v, dir) {
  const e = Math.floor(Math.log10(v));
  const ladder = [];
  for (let k = e - 1; k <= e + 1; k++) for (const m of [1, 2, 5]) ladder.push(Number((m * 10 ** k).toPrecision(3)));
  let i = 0;
  for (let j = 0; j < ladder.length; j++) if (Math.abs(Math.log(ladder[j] / v)) < Math.abs(Math.log(ladder[i] / v))) i = j;
  return ladder[Math.max(0, Math.min(ladder.length - 1, i + dir))];
}
