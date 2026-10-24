# Tab 5, Analysis

Reader: whoever changes the Analysis tab or the loop analysis in `src/core/analysis.js`.

The person asked for the diagrams control engineers read before tuning: root locus, the Ortskurve (Nyquist), Bode with margins, stability diagrams, and an X–Y plot of the error over the reference ([input](../input/2026-10-24-09-analysis-autotune-triple-swingup.md)). Research, thresholds and sources: [../research/analysis.md](../research/analysis.md).

**Status**: built and tested; the 2026-10-24 review's findings are fixed. It shows its numbers once the design layer gives it the plant a block sees (`app.loopModel`, from the `feat/designs` branch, not merged yet); until then every controlled system shows a note saying so.

## What it shows

- **Left, the key numbers**, each with a word and a mark (✓ good, ! fair, ✕ poor), never colour alone. Only a stable loop is graded: an unstable one has no margins to grade.
  - the verdict: **stable** (every closed-loop pole inside the unit circle), **marginal** (none outside, but one on the circle: a free integrator or an undamped mode, which neither dies away nor grows), or **unstable** (how many are outside);
  - the gain interval: the factors by which the loop gain may change before a closed-loop pole crosses the unit circle, both sides for an open-loop unstable plant. For an unstable loop the row reads **Stable for** gain ×a … ×b instead: the gains at which it would be stable (or none);
  - the phase margin at the crossover; the delay margin in ms and samples (— for an unstable loop, which has no dead time to spare);
  - Ms = max |S| (good ≤ 1.4, fair ≤ 2) and Mt = max |T|;
  - the slowest pole's time constant (τ = ∞ on the circle; "grows" for an unstable pole) and the least damping ratio ζ;
  - Nyquist's P (open-loop poles outside), N (encirclements of −1) and Z = N + P; open-loop poles on the circle (integrators) are in neither P nor Z and are counted beside them;
  - the linear step's overshoot and settling time (2 %), both against its final value, and the final value itself: the closed loop's DC gain. A response still outside the band at the end of its window says "not settled in T s";
  - notes: the operating point, the variant, Ts, for Scope time the instant and where it came from, dead time in samples (fractions too), the model's warnings, and that the analysis is linear (u inside its limits; the prefilter is outside the loop).
- **Right, four plots** in the scope's dark style:
  - **Root locus**, s-plane (s = ln z / Ts) or z-plane: open-loop poles ×, closed-loop poles ●, and the closed-loop poles for the loop gain scaled ×0.01 … ×100. The s view shows where the loop works: poles up to ten times the crossover (or the slowest pole); faster ones are counted, not drawn, and so are poles at z = 0 (|z| < 10⁻³: a dead-time chain, a derivative's previous measurement), which s = ln z / Ts would put thousands of rad/s out. ζ = 0.7 rays; the unit circle in z.
  - **Bode** of the open loop L: magnitude and unwrapped phase, the crossings marked, PM and the GMs that bound the gain interval labelled. The axis runs from a decade below the loop's slowest pole to just below the Nyquist frequency π/Ts; a crossing at an end of the band (z = 1 or z = −1) is marked at that end.
  - **Nyquist** (Ortskurve) of L for positive frequencies (solid) and negative (dashed), the radius compressed above 1 (1 + ln |L|) so integrators fit while −1 stays put; the unit circle, −1, and the Ms circle (|1 + L| = 1/Ms). It opens on the region around −1.
  - **Step r → y** of the linear closed loop, to twice its settling time, with its final value dashed when that is not 1.
- **Linked**: hovering the Bode plot marks that frequency on the Nyquist curve and reads out |L| and ∠L (the unwrapped phase the curve shows). The wheel zooms the locus and Nyquist plot about the pointer, up to zoom in as on the scope; a double-click restores the automatic view.
- **Scope time** follows the scope: the state under the cursor (or where it last pointed), at the sweep while the scope runs (the tab recomputes up to four times a second), else at the right edge of the screen.
- **The X–Y plot** is the scope's XY mode with Δ ([instrument.md](instrument.md)), not a diagram here: it needs no linear model.

## Where the numbers come from

- **The loop** is cut at the Controller's output u: L(z) = −u_c / v with the plant input u_p = v and r = 0 (`openLoop`). Negative feedback: the loop is stable when 1 + L has no zero on or outside the unit circle.
- **The plant** is the plant the block sees, linearised at an operating point: at rest (origin), the start state, or the state at the scope's time. It comes from the design layer (`linearizeBlock`, [designs.md](designs.md)) through `app.loopModel(path, op)`; until that is merged the tab says so.
- **Discrete, as simulated**: the plant is discretised with a zero-order hold at the controller's Ts (`discretePlant`), so the margins include the sampling delay. Dead time on a measurement is exact: whole samples are a chain of unit delays; a fraction f of a sample more is the modified z-transform (the measurement is the plant (1 − f)·Ts after a sample instant, under the input held since then, read one delay later). Checked against a continuous-time simulation of the sampled loop: the critical gains agree to four digits. Measurements the controller does not read get no chain.
- **The controller** is its law's own linear model, `linear(p, Ts, at)` in `controllers.js`: PID (integral, filtered derivative), state feedback, the scheduled PI at the operating point's y, and the swing-up where it catches (it refuses where it pumps energy). The relay has none.
- **Frequency response** (`frequencyData`): every path round the loop passes a measurement, so the shortest delay chain among the measurements read is a factor z^−d of the whole loop; it is taken out and its phase added back exactly (−ω·d·Ts), so long dead times unwrap right. The grid: 400 log-spaced points from 0.1 × the slowest pole's |s| (open or closed loop; integrators and z = 0 left out), lower while |L| still moves towards 1, at least two decades below π/Ts, refined where the phase moves more than 45° between points.
- **Margins** (`loopMargins`): every gain crossing gives a phase margin and a delay margin ((∠L + 180°) mod 360° / ωc); every −180° crossing gives a gain factor. Both are solved exactly between grid points. L is real at the ends of the band, z = 1 (ω = 0) and z = −1 (ω = π/Ts): a negative value there is a crossing of −1 too (a first-order plant under P, an unstable pole under P, the pendulum's catch loop). Ms and Mt over the grid.
- **The gain interval** (`gainRange`): stability can change only at those crossing gains (and where 1 + k·D = 0). The stretches between them are checked on the closed-loop poles, outwards from the tuned gain until stability changes; the root locus's gains catch a change the grid missed, which is then found by bisection.
- **Poles**: the open loop's state matrix is block triangular (plant, delay chains, controller), so its poles are found block by block: a plant integrator and a controller integrator stay two simple poles at z = 1, and a delay chain sits exactly at 0. The closed-loop poles are the eigenvalues of its state matrix; the root locus is the same for k·L. A pole within 10⁻⁷ of |z| = 1 is on the circle; poles closer than 10⁻⁴ to each other are judged by their mean, because eig returns a repeated pole split by about eps^(1/m) and their mean is accurate (`poleSides`).
- **The step** (`stepInfo`): the closed loop from r to y as one state space; the final value from (I − A) x = B; the window is ten time constants of the slowest closed-loop pole, stepped sample by sample for the first 20 000 samples and then exactly in strides of 2^p samples (A^M and its input sum), so a slow loop at a fast Ts costs the same.

## Code

- `src/core/analysis.js`: `discretePlant`, `openLoop`, `openLoopPoles`, `closedLoop`, `poleSides`, `sOf`, `sPlanePoint`, `respondAt`, `frequencyData`, `phaseAt`, `loopMargins`, `gainRange`, `locus`, `stepResponse`, `closedLoopModel`, `stepInfo`, `analyzeLoop`. Tests: `test/analysis.test.mjs` (continuous margins reproduced at fast sampling, the locus crossing at the gain margin, an unstable plant's P/N/Z, every linear law against its `step()`, exact dead time, textbook final values; from the review: crossings at z = 1 and z = −1 including the library pendulum's catch loop and 1/(s − 1) under P, a slow crossover at fast sampling, the DC-gain final value and an unsettled window, poles on the circle in neither P nor Z, a marginal loop, fractional dead time against the modified z-transform's closed form, a long dead time's phase and crossings, z = 0 off the s-plane, an unstable loop's stable gains).
- `src/ui/analysis.js` (the tab), `src/ui/plots.js` (small plots in the scope's style).

## Not built yet

- Dragging the gain marker on the locus to scale the gains; the gang of four (S, T, PS, CS); Nichols; disk margins; frequency response measured from the simulation or the external plant (research §9–§12).
- Overlaying the run's own step on the linear one.
- The root locus costs one eigenvalue solve per gain (121); a loop with a long dead time (100 delay states) takes seconds. A Web Worker, or fewer gains for large loops, would keep the page responsive.
- A long dead time's Nyquist curve spirals faster than its points draw it; the numbers are exact, the drawing is not.
