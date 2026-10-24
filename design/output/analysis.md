# Tab 5, Analysis

Reader: whoever changes the Analysis tab or the loop analysis in `src/core/analysis.js`.

The person asked for the diagrams control engineers read before tuning: root locus, the Ortskurve (Nyquist), Bode with margins, stability diagrams, and an X–Y plot of the error over the reference ([input](../input/2026-10-24-09-analysis-autotune-triple-swingup.md)). Research, thresholds and sources: [../research/analysis.md](../research/analysis.md).

## What it shows

- **Left, the key numbers**, each with a word and a mark (✓ good, ! fair, ✕ poor), never colour alone:
  - stability (closed-loop poles inside the unit circle);
  - the gain interval (the factors by which the loop gain may change before it crosses −1, both sides for an open-loop unstable plant), the phase margin at the crossover, the delay margin in ms and samples;
  - Ms = max |S| (good ≤ 1.4, fair ≤ 2) and Mt = max |T|;
  - the slowest pole's time constant and the least damping ratio ζ;
  - Nyquist's P (open-loop poles outside), N (encirclements of −1) and Z = N + P;
  - the linear step's overshoot, settling time (2 %) and final value;
  - notes: the operating point, the variant, Ts, dead time in samples, the model's warnings, and that the analysis is linear (u inside its limits; the prefilter is outside the loop).
- **Right, four plots** in the scope's dark style:
  - **Root locus**, s-plane (s = ln z / Ts) or z-plane: open-loop poles ×, closed-loop poles ●, and the closed-loop poles for the loop gain scaled ×0.01 … ×100. The s view shows where the loop works: poles up to ten times the crossover (or the slowest pole); faster ones are counted, not drawn. ζ = 0.7 rays; the unit circle in z.
  - **Bode** of the open loop L: magnitude and unwrapped phase, the crossings marked, PM and the GMs that bound the gain interval labelled; the axis ends just below the Nyquist frequency π/Ts.
  - **Nyquist** (Ortskurve) of L for positive frequencies (solid) and negative (dashed), the radius compressed above 1 (1 + ln |L|) so integrators fit while −1 stays put; the unit circle, −1, and the Ms circle (|1 + L| = 1/Ms). It opens on the region around −1.
  - **Step r → y** of the linear closed loop.
- **Linked**: hovering the Bode plot marks that frequency on the Nyquist curve and reads out |L| and ∠L. The wheel zooms the locus and Nyquist plot; a double-click restores the automatic view.
- **The X–Y plot** is the scope's XY mode with Δ ([instrument.md](instrument.md)), not a diagram here: it needs no linear model.

## Where the numbers come from

- **The loop** is cut at the Controller's output u: L(z) = −u_c / v with the plant input u_p = v and r = 0 (`openLoop`). Negative feedback: the loop is stable when 1 + L has no zero on or outside the unit circle.
- **The plant** is the plant the block sees, linearised at an operating point: at rest (origin), the start state, or the state at the scope's time (cursor, sweep, or the right edge). It comes from the design layer (`linearizeBlock`, [designs.md](designs.md)) through `app.loopModel(path, op)`; until that is merged the tab says so.
- **Discrete, as simulated**: the plant is discretised with a zero-order hold at the controller's Ts (`discretePlant`), so the margins include the sampling delay; dead time on a measurement becomes round(delay / Ts) unit delays, exact in discrete time.
- **The controller** is its law's own linear model, `linear(p, Ts, at)` in `controllers.js`: PID (integral, filtered derivative), state feedback, the scheduled PI at the operating point's y, and the swing-up where it catches (it refuses where it pumps energy). The relay has none.
- **Margins** (`loopMargins`): every gain crossing gives a phase margin and a delay margin ((∠L + 180°) mod 360° / ωc); every −180° crossing gives a gain factor; Ms and Mt over the frequency grid (400 log-spaced points up to π/Ts).
- **Poles**: eigenvalues of the closed loop's state matrix; the root locus is the same for k·L.

## Code

- `src/core/analysis.js`: `discretePlant`, `openLoop`, `closedLoop`, `sOf`, `respondAt`, `frequencyData`, `loopMargins`, `locus`, `stepResponse`, `analyzeLoop`. Tests: `test/analysis.test.mjs` (continuous margins reproduced at fast sampling, the locus crossing at the gain margin, an unstable plant's P/N/Z, every linear law against its `step()`, exact dead time, textbook final values).
- `src/ui/analysis.js` (the tab), `src/ui/plots.js` (small plots in the scope's style).

## Not built yet

- Dragging the gain marker on the locus to scale the gains; the gang of four (S, T, PS, CS); Nichols; disk margins; frequency response measured from the simulation or the external plant (research §9–§12).
- Overlaying the run's own step on the linear one.
