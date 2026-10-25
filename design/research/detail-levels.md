# Research: detail levels, as SPICE has them

Reader: whoever builds detail levels in Loop Tuner, or wants to know why [../output/detail-levels.md](../output/detail-levels.md) decided what it did. The person's words are in [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md), last section ("detail levels … Spice, I think, has that … the interfaces stay more or less the same … the model introduces more calculations and more parameters … if I increase detail level, the control works worse").

## The person's answers (2026-10-25)

The person answered the output's four questions ([input 13](../input/2026-10-25-13-detail-levels-answers.md)). Where this file proposed otherwise, the answers win, and the statements below are marked:
- **A global level with local overrides, not a cap.** A global level applies to every subsystem without an override; a subsystem may override it, above or below; each runs at most the highest level it has; a Clear button removes every override. No separate "Highest".
- **Levels are compared with Single runs; the display does not change.** The proposals for keeping the previous level's run (count only changed runs at every speed, or a slow speed for the example) are dropped.
- **Detail is in the Plant tab**, not the header.
- **The example rings**, as this research chose: the capacitive-load ringing every electrical engineer knows. A two-pole op-amp's oscillation stays a possible later experiment. The ringing frequency against C_L was added by a new check (Sources): at level 3, 727, 541, 374 and 178 kHz at 500 pF, 1 nF, 2.2 nF and 10 nF, with the overshoots and settling times below unchanged.

## Reviewer's corrections

Two independent reviews (2026-10-25) re-ran every level with their own RK4 code, at steps of 10 ns and 1 ns, with no repository code. The headline numbers held: L2's 350 ns rise and 90°, L3's 37.6 % and 33.0° at 519 kHz, L4's 18.7 % and 0.579 V, the phase margins against C_L, the neutral-value and agreement gaps, the two-pole op-amp's oscillation above 7.07 nF (bounded with slew and rails at 383 kHz, 0.19 V p-p), and the datasheet values. What they corrected, and where it is applied in the output:

**Physics and numbers**
1. **L3's settling time sat on a knife-edge.** "Within 2 % after 3.15 µs" (and this file's earlier "3.15, not 3.7") rests on the fourth swing of the ringing at −1.9991 %. R_o 497 Ω instead of 496, R_L 10.1 kΩ or A_OL 88 dB (the datasheet minimum) each move it to 3.7 µs. The 1 % time, 4.0 µs, stays between 4.00 and 4.06 µs for R_o from 490 to 505 Ω and for ±1 % in GBW, C_L and SR (re-checked). L4's large step is the other way round: its 2 % time (3.6 µs) stays within 3.59–3.65 µs, while its 1 % time jumps from 3.78 to 4.33 µs at R_o 497 Ω. The output quotes L3 at 1 % and L4 at 2 %.
2. **L4 was silently wrong near the rails and at large currents.** It had no validity check. Its swing clamp acts on the internal node, so the pin stops at 2.358 V for a 2.4 V input, while the datasheet's 25 mV swing is at the pin. Into a short the model passes (Vs − Vsw)/R_o = 5.0 mA where the datasheet gives 23 mA (at 5.5 V); in circuit it passes at most 9.7 mA, not "about 10 mA (4.95 V across it)", since with R_L the pin cannot go below −2.358 V. "The current limit can never act" is a flaw of the constant R_o, not a property of the part. Applied: L4 checks v_op at ±(Vs − Vsw) ("the pin falls (Vs − Vsw)·R_o/(R_o + R_L) = 0.12 V short") and, instead of i_out at a fixed few mA, the cable it can slew through R_o: C_L·SR·R_o ≤ Vs − Vsw, so C_L up to 8.3 nF. A check on i_out would sit on a knife-edge, because the constant R_o starves a large cable: at 10 nF i_out peaks at 2.42 mA while slewing that cable needs 6 mA (re-checked). The example still reports nothing: i_out peaks at 0.54 mA and v_op at 0.73 V.
3. **L3's new state is the cable voltage v_out,** not the output current. The current (v_op − v_out)/R_o is algebraic and only goes to a Sink.
4. **The 1 kHz sine.** |L2 − L3| ≤ 0.05 mV holds only after the start: from rest it is 0.53 mV at 0.53 µs, because the sine's slope jumps at t = 0. After 10 µs it is 0.0248 mV. The cause is the R_o/R_L divider, (R_o/R_L)·A·f/GBW = 0.0248 mV; the output pole adds about 1.5 µV. So "the loop gain hides the output pole" was not the reason.
5. **R_o → 0 is as stiff as C_L → 0.** At 0.1 Ω the example's 20 µs screen needs 800 k steps by the ∞-norm, and exactly the 400 k cap by the eigenvalue. Applied: R_o has a floor of 1 Ω (40 k steps). The limit is tested at 4, 2 and 1 Ω on a 2 µs screen, where |L3 − L2| ≤ ωT·R_o·C_L·ΔV, the edge's delay R_o·C_L times its slope ωT·ΔV (measured 0.87, 0.92 and 0.95 of the bound; re-checked).
6. **The phase-margin formula had a sign backwards.** It is 180° − atan(ωc/ωd) − atan(ωc·R_p·C_L), R_p = R_o ∥ R_L. The dominant pole adds about +0.0003°, so the number is unchanged.
7. **The datasheet's conditions.** The 45° at 500 pF is a typical value on the front page with no load stated. The 10 kΩ comes from the AC table, which is specified at 60 pF. So R_o = 496 Ω rests on the assumption that the 45° figure is at 10 kΩ; without R_L the fit gives 450 Ω. The 23 mA and the 25 mV (with 0.5 V of input overdrive) are both stated at 5.5 V, while the board runs on 5 V.
8. **The slewing onset.** L4's hard ±SR limit follows LTspice's level 2, whose output current is set to slew·Cout, not Boyle's smooth input pair. "Identical below 95.5 mV" is a property of the hard limit, and the 80 mV "small" step is at 84 % of that threshold. L2 and L3 now say "well inside ±95.5 mV".
9. **The 10 nF experiment ran off the screen.** Channels at 0.1 V/div with offset −0.3 V show −0.1 to 0.7 V; L3 peaks at 0.721 V at 2.2 nF and 0.793 V at 10 nF. Applied: offset −0.4 V (0 to 0.8 V).

**Simulation and tests**
10. **The step bound used the ∞-norm,** which depends on how states are scaled; transfer functions are realised in companion form. On main it would make the encoder example 200× finer (1.99·10⁵ against 1000, hitting the step cap) and the triple pendulum's run change (363 against 50.2, breaking transparent-models' migration test). Applied: the largest eigenvalue magnitude of the Jacobian (`eig` in `linalg.js`), with Quantizer as identity and Noise as 0, joined to the block bounds by max. No library system's step changes. The op-amp needs ≤ 80 ns at L2 and ≤ 140 ns at L3 and L4 (|λ| = 3.56·10⁶ 1/s against an ∞-norm of 6.28·10⁶).
11. **The bound must reach every compile.** It lived only in `simulateSystem`; Live (`live.js`), the v1 loop path (`sim.js`) and the design layer's `Model.bound` take steps from `el.bound`. Applied: computed at compile, folded into `el.bound`; the end-of-run re-check stays in `simulateSystem`.
12. **Step inputs inside RK4.** The Step signal is `t >= time`, and 99e-8 + 1e-8 is exactly 1e-6, so the last RK4 stage before an edge already sees the new value and the response runs about h/6 early. At 10 ns the gap to the exact response is 1.05·10⁻² of the step for L2 and 4.0·10⁻³ for L3; at 1 ms/div (79.4 ns) it is 35 mV, 8 % of the step, at the sample on the edge. So "equals the exact step response to 10⁻⁶" could not pass. Applied: compare from the simulated state one record step after each edge (measured ≤ 10⁻⁷; re-checked), and bound the edge sample by ωT·h/6.
13. **L4's slope while slewing** is SR − (2π·GBW/A0)·v_op, not SR: 2.3·10⁻⁶ to 1.8·10⁻⁵ below it on this step, 6.5·10⁻⁵ at the 2.475 V limit. A test against SR to 10⁻⁶ fails.
14. **The literal guard** would have flagged the example's own formulas (the 10 and 20 of `10^(AOL/20)`, the 20 of `1/(20*pi*GBW*Ro)`, the 1e12 in a sentence). Applied: it reads block parameters and their formula text and allows 0, ±1, 2, 10 and 20; sentences print with SI prefixes and need no unit constants.
15. **The structure guard** "each level has more blocks than the one below" is false for the motor (a gain 1/R against a transfer function) and the carts (b and c set to 0 against formulas). Applied: more states or more mask parameters read by blocks.
16. **Independent checks per level.** "Simulation equals the linearised level" uses the model's own equations, so it checks the integration, not the physics. Added: an energy balance for L3 and L4 (residual 3.5·10⁻⁶ and 1.1·10⁻⁶ of the energy delivered, Simpson over 10 ns records) and Kirchhoff's current law at the pin as a charge balance (8.9·10⁻⁵ and 2.0·10⁻⁵ of C_L·0.5 V) (both measured for this revision).
17. **"L2 → L1 as GBW grows"**: L2 tends to v_in·A0/(1 + A0), not v_in, and on steps the edge sample differs by the whole step at any GBW. Applied: "as GBW and AOL grow", on the 1 kHz sine (0.500 mV at 1 MHz, 0.050 mV at 10 MHz).
18. **Level 1 had no machine check of "much slower than 1 MHz".** Applied: a rate mode for Valid range, |Δu|/Δt between record samples; level 1 checks v_in against the slew rate. It catches every step on the 20 µs screen (8 V/µs) and passes the 1 kHz sine (3.1·10⁻³ V/µs); the sentence says slower signals near the bandwidth are not caught.

**Design (applied in the output; the reasons are there)**
19. The global cap (now the global level) did not reach every compile site (the Plant tab's check, Live, the v1 loop, the design layer's model compiles, the CLI), and the acquisition key hashes `simOf(p)`, not `p.sim`. Applied: `applyDetail` and one `runDiagram(project)`; `detail` in `simOf`.
20. Run information never reached the page: the acquisition keeps only `{ t, signals }`, so today's "stiff system" warning is never shown, and `loopTuner.run()` returns nothing. Applied: `info` in the acquisition, `loopTuner.info()`, built with the step bound.
21. Block id paths become ambiguous across levels (variant stores, designs, Auto-tune's probes, `locate`). Applied: Controllers, Observers and live plants are refused inside subsystems with levels; nested paths carry the level (`board@3/opamp`).
22. `plantKey` "with the subsystem's mask" re-designed on edits only other levels read. Applied: the running level's diagram with formulas resolved to numbers, without Valid range blocks or level fields.
23. The Plant tab's check compiled only the running level and outlined errors by name. Applied: it compiles the viewed level; levels that do not compile are marked.
24. Readers of a subsystem's `.diagram` were missing from the migration list (Live's `copyParams`, HIL, Auto-tune, the Controller, Analysis and Auto-tune tabs, the Plant tab, `systemTags`), and a grep for `.diagram` would hit legitimate uses. Applied: listed, and a test loads a subsystem with levels through each.
25. Cut: `adds` (the name says it), `requires` (merged into Valid range as a parameter mode, drawn on the canvas), "Highest" (a question for the person; answered: the global level at its largest number does it), Auto-tune's "Tune on", Analysis's "Plant" choice and "as designed" overlay (the cap, now the global level, does all of these), the Detail table, units on In and Out (unchecked labels), per-level steps on every compile (static counts; the step from the run), and `designDetail` (no shipped example uses it; cap, design and Copy as numbers do the experiment).
26. Mask fields gain `min` and `max`, since the floors of C_L and R_o need them.
27. "A whole load sets the entry's speed" reversed instrument.md's rule and discarded the person's speed. Applied: the faded comparison is proposed through the roadmap's open question (count only changed runs at every speed), with a temporary speed as the fallback; both go to the person. The person answered: neither; levels are compared with Single runs, and nothing changes (input 13).
28. Terminology: "level" already means diagram nesting, the spectrogram's colour levels and the scheduled PI's operating levels, and "badge" a scope channel's badge. Applied: "detail level" in UI text, a "level chip", renamed nesting helpers. One `--warn`/`--bad` pair for both themes.
29. Smaller: Valid range is a Terminator in model mode, not a Sink; compile messages carry the level, state labels do not; deleting to one level gives a plain subsystem; "used from L3" counts blocks only.
30. **Stale statements.** feat/smc is merged (`5b45451`), so the motor's transfer-function form is on main. The first draft is on main as `a7bafdf`; its summary's "nothing is committed" was wrong. feat/designs rewrote large parts of `diagram.js` and `simulateSystem`, so it is merged before this plan is built.

## How this was made

This synthesis was made on 2026-10-24 from three research threads:
- how SPICE handles model detail;
- how other tools do it (Simulink, Simscape, Modelica, PLECS, Amesim, Verilog configurations, SystemC TLM);
- which example shows the point.

Every number about the example was then checked again with a separate RK4 script, and again by the two reviews above.

Marks used below: **(inference)** is reasoning, not a source. **(simulation)** is a plain-Node RK4 run of the model described, with no repository code. Scripts are listed under Sources.

## Summary

- **SPICE's `LEVEL` is a model index, not an order of detail.**
  - ngspice's MOSFET level 1 is Shichman–Hodges, "applicable only to long channel devices". Level 2 has "many convergence problems". Level 3 is "semi-empirical". BSIM3 is 8 or 49, BSIM4 is 14 or 54.
  - What SPICE does get right:
    - **the instance's terminals never change**: `M1 d g s b NMOD` stays while `.model NMOD NMOS LEVEL=…` changes the equations;
    - **parameters whose neutral values switch an effect off**: diode RS = 0, CJO = 0, BV = ∞; BJT VAF = ∞, and "the model automatically simplifies to the simpler Ebers-Moll model when certain parameters are not specified";
    - **validity ranges** (model binning by LMIN, LMAX, WMIN, WMAX).
- **The closest match to what the person described is LTspice's universal op-amp.** Its levels add up and are named for what they add:
  - level 1 is a "single pole" gain block;
  - level 2 is "all the features of level 1 with added slew rate limit, output voltage limit, and output current limit";
  - levels 3a and 3b add a second pole (3b also a delay);
  - level 4 adds "input capacitance, output resistance".

  The pins are the same at every level, and each level says what it is "useful for".
- **The closest structure is PLECS's configurable subsystem:** one openable schematic per configuration, and "all subsystem configurations … share the same input, output and physical terminals". **Simulink's Variant Subsystem** adds activation at "update diagram" (only the active choice is built) and a badge on the block.
- **The counter-example is the Modelica Standard Library's op-amps.** IdealOpAmp, OpAmp and OpAmpDetailed have 3, 4 and 5 pins and no shared interface, so swapping one for another means rewiring. The Simscape and Simulink options that let ports change with fidelity (conditional ports, "allow flexible interface") are the same drift. The person wants the opposite.
- **Recommended:**
  - any subsystem may hold ordered, named levels with identical ports, each an ordinary diagram;
  - a global level with local overrides per subsystem (the person's answer; first proposed as a choice per subsystem, capped globally);
  - one parameter set on the subsystem's mask;
  - each level states its validity and checks it with blocks on its canvas;
  - designs see what runs; "design simple, run detailed" is: set the global level low, design or tune, keep the numbers, raise it.
- **First example: an op-amp follower driving a cable.** An MCP6001-class part on ±2.5 V drives 1 nF ∥ 10 kΩ (simulation):
  - At the gain–bandwidth level it is perfect: phase margin 90°, no overshoot, 10–90 % in 350 ns.
  - Add the op-amp's output resistance driving the cable: phase margin 33°, 37.6 % overshoot, within 1 % only after 4.0 µs.
  - Add slewing: large steps reshape (18.7 % instead of 37.6 % on a 0.42 V step).
  - It runs with no new primitive beyond those openable physics needs anyway, plus the Valid range block.

## What the first checks corrected

The three threads' numbers were re-run (`dlv/check*.mjs`). These changed (items 1, 3, 4, 6 and 7 were corrected again by the reviews above):

1. **The current limit.**
   - The MCP6001's short-circuit limit is 23 mA. At 50 nF the simulated peak was 4.5 mA, not the 23 mA ramp at I_sc/C_L that "the current limit starts to matter above C_L ≈ I_sc/SR = 38 nF" predicted.
   - That is because a resistive R_o = 496 Ω passes at most (Vs − Vsw)/R_o = 5.0 mA into a short and 9.7 mA in this circuit: a flaw of the constant R_o, not of the part (Reviewer's corrections 2).
   - The large-signal level therefore models slewing and the output swing only, says why the current limit is left out, and checks that its cable can be slewed through R_o (C_L ≤ 8.3 nF).
2. **With a load resistor in the loop, C_L → 0 does not return the level below.**
   - At C_L = 1 pF the output-resistance level and the gain–bandwidth level are still 26 mV apart on a 1.45 V step, because R_L and R_o form a divider inside the loop (loop gain −4.7 %).
   - The neutral parameter is R_o → 0: 8.7 mV apart at 1 Ω, 0.9 mV at 0.1 Ω on that step. R_o's floor is 1 Ω (Reviewer's corrections 5).
3. **Settling.** The output-resistance level settles within 1 % 4.0 µs after a small step. Its 2 % time, 3.15 µs, is on a knife-edge and is not quoted (Reviewer's corrections 1).
4. **The per-block step bound does not hurt the default screen; it hurts a wider one.**
   - Without a Controller block the record step is the screen / 2000: 10 ns on a 20 µs screen, finer than the 80 ns the 6.3·10⁶ 1/s loop needs.
   - At 1 ms/div the record step is 5 µs and RK4 runs at λh = 31, where it is unstable (the limit is 2.8); levels 2 and 3 diverge within two record steps of the first edge.
   - So a bound that sees integrator loops is still a prerequisite, for a screen the person can choose rather than for the example as shipped. It is the largest eigenvalue, not the ∞-norm (Reviewer's corrections 10).
5. **One scale for both steps.** A 50 mV step and a 1.45 V step cannot be read on one channel of 8 divisions: the small step's 19 mV of ringing is a tenth of a division. Steps of 80 mV (below the 95.5 mV slew threshold) and then to 0.5 V both read at 0.1 V/div.
6. **The comparison between levels needs the previous run to stay.**
   - Earlier runs fade once per sweep at a finite speed. A 20 µs screen sweeps every frame at any speed the page reaches, so the previous level's run would be gone in five frames.
   - At 4·10⁻⁶× the screen sweeps in 5 s and the faded run stays about 25 s. Counting only changed runs at every speed keeps it with no special speed (Reviewer's corrections 27).
   - The person compares levels with Single runs instead, after which earlier runs stay; nothing changes (input 13).
7. **Near the rails the large-signal level is pessimistic.**
   - Clamping the op-amp's internal node at the swing limit, with R_o and 10 kΩ after it, leaves the pin at 2.358 V for a 2.4 V input.
   - The datasheet promises 25 mV from the rail. The constant R_o overstates the drop at DC: a CMOS rail-to-rail output's impedance changes with frequency (Green).
   - The level says so, and its check on v_op reports it in a run.
8. **The calibration.**
   - R_o = 496 Ω gives 44.997° at the datasheet's 500 pF ∥ 10 kΩ (simulation of the linear loop), so the 45° point is reproduced, assuming that point is at the AC table's 10 kΩ (Reviewer's corrections 7).
   - It gives 80.5° at the datasheet's own 60 pF test load, where the datasheet says 90° typical. A constant R_o cannot fit both.
   - Without the 10 kΩ load the same 45° point gives 450 Ω (inference, closed form), which is why the example keeps the datasheet's load.

Confirmed and kept:
- L3 and L4 agree bit for bit below the slew threshold SR/(2π·GBW) = 95.5 mV (a 90 mV step: 0 difference; 100 mV: 0.635 mV). This is a property of the hard slew limit.
- With its limits at infinity, L4 equals L3 bit for bit.
- A 1 kHz, 0.5 V sine differs between the ideal and the gain–bandwidth level by 0.500 mV (A·f/GBW = 0.5 mV).
- The phase margins: 80.5° at 60 pF, 45.0° at 500 pF, 22.6° at 2.2 nF, 10.7° at 10 nF.
- For a two-pole op-amp plus R_o·C_L, the gain margin is (fp2 + f_L)/GBW (also derived in closed form). So an op-amp whose second pole lies above its GBW rings but cannot oscillate with any C_L.

## Findings

### SPICE

1. **The interface is the instance line and its terminals; the model behind it can be swapped.**
   - ngspice: "The LEVEL and VERSION parameters select the specific model. Further model parameters are optional and replace ngspice default values" (manual v43, §7.6.1).
   - Subcircuits fix their external nodes (`.subckt OPAMP 1 2 3 4 …`).
   - Their parameters have defaults a call overrides: `.subckt myfilter in out rval=100k cval=100nF`, called with `rval=1k` (§2.5, §2.9.3).
   - Vendors fix the pin order across a library: "this nodal convention is used throughout in the LTC amplifiers" (Jung, AN48).
2. **Levels are model indices** (Table 7.3; see Summary). The ngspice manual warns, about `altermod`: "There is no checking however of the version and level parameters!" Lesson: named, ordered levels, checked.
3. **Neutral defaults switch effects off** (§7.2.1, §7.3.3); MOS LAMBDA = 0. With the added parameters at neutral values, the richer model is the simpler one.
4. **Selection:**
   - `.LIB file section` (process corners, §2.8);
   - `.if`/`.elseif` on a `.param` around `.model` cards (§2.13), a global switch in effect;
   - binning picks a parameter set by its declared validity range (§3.2.3).

   Modern compact models have "more than 100" parameters and live in separate files.
5. **Behavioural and physical models.** The B-source is an arbitrary expression, the counterpart of the Equations block. New compact models ship as Verilog-A through OSDI and OpenVAF (ngspice 39 onward). Vendor macromodels mix two approaches (Baker, SBOA027):
   - simplification keeps a few transistors (Boyle's input pair);
   - build uses ideal R, L, C and controlled sources: faster but less faithful.

   Many vendor models are encrypted, the black box Loop Tuner forbids.
6. **The Boyle–Cohn–Pederson–Solomon macromodel** (IEEE JSSC SC-9(6), 1974, p. 353; read through Jung's AN48 and DN28 and Baker's SBOA027).
   - Structure: an input pair normalised to unity gain, a gain stage, C2 setting the dominant pole.
   - Key relations: SR = I_EE/C2, GBP = 1/(2π·R_C1·C2).
   - Its input pair limits the current into C2 smoothly, so slewing sets in gradually. LTspice's universal op-amp at level 2 limits it hard, setting its output current to slew·Cout; the example's L4 does the same, so its onset at SR/(2π·GBW) is sharp (inference).
   - It models GBP, SR, phase margin, DC gain, CMRR, offset, bias currents, short-circuit current, swing and R_OUT.
   - It does not model temperature, PSRR, noise, a good AC output resistance, or more than one or two poles.
   - AN48 describes a vendor's own lower level, a "turbo" model "sans limiters", with the warning "a macromodel without any limiters is capable of very high voltages and/or currents!". It also warns that extra poles cost "memory … longer simulation times, and possible convergence issues".
7. **Vendor op-amp models.**
   - TI's Green–Williams–Lis models (2016) target typical datasheet values at room temperature, including Z_O (Alani & Williams, SBOA338).
   - ADI: "SPICE models of op amps don't accurately model open-loop output resistance (RO); so they cannot fully replace empirical design of the compensation network" (King, Analog Dialogue 31-2).
8. **Datasheet values drift between revisions.** TI's µA741 rev. H changed r_o from 75 to 575 Ω and I_SC from ±25 to ±80 mA. Name the source of every parameter set, not just "the 741".

### Other tools

| Tool | Ports across levels | Choosing | Shared parameters | What to copy / avoid |
|---|---|---|---|---|
| **LTspice UniversalOpamp2** | the same 5 pins at every level | per instance (SpiceModel attribute) | Avol, GBW, Slew, ilimit, rail, Vos shared by all levels | Copy: levels that add up, a "useful for" line |
| **PLECS configurable subsystem** | "share the same input, output and physical terminals"; a port added in one schematic appears in all | `Configuration` parameter, maskable | via a mask | Copy: one schematic per level, shown as tabs; ports edited across levels. Probes: "only the probed components from the current configuration are used" |
| **Simulink Variant Subsystem** | the container's set or a subset ("allow flexible interface", on by default); inactive outputs read 0 | per block (label or condition); globally by Variant Manager configurations | variant control variables | Copy: activation at "update diagram", the badge, dimmed inactive choices, "analyze all choices". Avoid: flexible ports, zeros for missing outputs |
| **Simulink Control Design** | – | `linearize(…, blocksub)`, slTuner `BlockSubs` | – | The precedent for designing on a different level than runs; not built until an example needs it |
| **Simscape** | ports may change with fidelity (thermal port H on the detailed level only) | a Fidelity parameter on the block; the Semiconductor Switch Selector changes fidelity "without replacing a block or reentering parameter values" | "Parameter values that are common to both blocks carry over" | Copy: pick the lowest fidelity that answers the question; "To simulate in real time, use the equivalent model … To validate the results, use the detailed model". Avoid: compiled insides (black box), conditional ports |
| **Modelica `replaceable … constrainedby`** | the redeclared type "shall be a subtype of the constraining type" (§7.3.2) | `choicesAllMatching` drop-down | modifiers in the constraining clause "are automatically applied … in any subsequent redeclaration" | Copy: a checked interface, shared modifiers. Modelica.Fluid.System's system-wide defaults are a precedent for a global setting with local override |
| **Amesim** | the component keeps its icon | per component in Submodel mode; **Premier submodel** applies "the simplest mathematical models for all components" | – | Copy: the global "simplest" switch (our Detail 1) |
| **Verilog-2001 configs, Cadence Hierarchy Editor** | fixed by the design | a global ordered view list with a stop view; per-instance override | – | Copy: global default plus per-instance choice |
| **SystemC TLM-2.0** | sockets and the base protocol fixed | coding style: loosely timed (speed) or approximately timed (accuracy) | – | Copy: detail as "points along a spectrum" behind a fixed interface |
| **Validity frames** (Zeigler's experimental frame; Van Acker et al.) | – | – | – | Copy: a model carries the range where it is valid |

### The capacitive-load trap (the example's physics)

- **The mechanism.** The output resistance R_o and the load C_L add a pole at 1/(2π·R_o·C_L). For "conservative phase margin" it should be "at least a decade above the circuit's closed loop bandwidth" (King, AD 31-2).
  - Renesas (R34AN0011EU): it "reduces this phase margin … overshoot, ringing, and at worst … self-sustaining oscillations".
  - The follower is the worst case, since capacitive-load drive grows with the noise gain.
  - The follower's phase margin is 180° − atan(ωc/ωd) − atan(ωc·R_p·C_L), with R_p = R_o ∥ R_L (inference, closed form; confirmed by both reviews).
- **TI's Tim Green** (Stability Part 8): a CMOS rail-to-rail output's Z_O "will look capacitive at Low and Medium Frequencies", and a macromodel's A_OL is wrong when it is driven into saturation. So a resistive R_o is a simplification, and the level must say so.
- **The MCP6001 datasheet** (DS20001733L):
  - GBWP 1.0 MHz; phase margin 90° typical (AC table: G = +1, C_L 60 pF, R_L 10 kΩ to V_DD/2); "a 45° phase margin (typical) with a 500 pF capacitive load" (front page, no load stated).
  - SR 0.6 V/µs; A_OL 88 dB minimum, 112 dB typical.
  - Swing within 25 mV of the rails (V_DD 5.5 V, 0.5 V input overdrive); I_SC ±23 mA (5.5 V), ±6 mA (1.8 V); V_OS ±4.5 mV maximum; quiescent current 100 µA typical.
  - A figure of output headroom against output current (Figure 2-14), 10 µA to 10 mA, whose values are not in the text. The constant R_o cannot follow it.
  - An isolation-resistor section with its gain-error caveat.
- **Real oscillation needs a second pole below the GBW.**
  - For a two-pole op-amp plus R_o·C_L, the gain margin is (fp2 + f_L)/GBW (inference, closed form, confirmed numerically).
  - With the Boyle/Modelica 741-like set (A0 2·10⁵, GBW 1 MHz, fp2 2 MHz, R_o 75 Ω) the gain margin is at least 6 dB for any C_L. With fp2 = 0.7 MHz it oscillates above C_L = 7.07 nF.
  - There a model without limits grows without bound (outside its validity), while the large-signal level settles into a bounded limit cycle at 383 kHz, 0.19 V p-p (simulation, first thread; confirmed by review).
  - Kept as a possible second experiment, not the example.

### Candidate examples

| Candidate | What raising the level does | Cost | Verdict |
|---|---|---|---|
| **Op-amp follower and a cable** (MCP6001 class, 1 nF ∥ 10 kΩ) | Gain–bandwidth: perfect (90°). + R_o into C_L: 33°, 37.6 % overshoot. + slewing: large steps reshape | 0, 1, 2, 2 states; the same 2000 record steps at every level on a 20 µs screen (h ≤ 80 ns needed at L2, 140 ns at L3 and L4) | **Chosen**: it makes the person's point at once. Weakness: no Controller block, so Controller, Auto-tune and Analysis do not apply; µs time scale |
| DC motor, armature as a level | No inductance: a sampled relay looks perfect. With L/R = 10 ms it chatters at 62.5 Hz with about 10 A of ripple (sliding-mode research) | ms scale, cheap | **Second**: shows it with a Controller block and the design layer. It needs only the motor's mask |
| Analog PI on an op-amp, motor speed loop | GBW changes the speed by 0.0007 rad/s; rails and slew wind up the capacitor; offset leaves 0.16 rad/s | stiff (760 krad/s inside a 3 Hz loop); 50× the steps | Rejected: the expensive level changes nothing |
| Motor driver board, digital PI (DRV8871) | Averaged bridge, then 20 kHz PWM, then dead time: no overshoot at any level; slower, not worse | 6–200× the steps | Rejected: PWM is invisible to a speed loop |
| Sensor board (tacho, anti-alias filter, ADC) | Phase margin 76° → 32.5° only when the filter corner is near the crossover | cheap | Partly: the op-amp is incidental |

## Recommendations

1. **Levels on any subsystem.**
   - Each level is `{ name, valid, diagram }`. The name says what it adds.
   - A global level `sim.detail`, and a local override `level` (1-based) on a subsystem.
   - The level that runs is the override, else the global level, at most the highest level the subsystem has; a Clear button removes every override (the person's answer, input 13; first proposed as a cap, min(chosen, cap)).
   - Levels are fixed at compile (Simulink's update diagram).
   - Only the running level compiles; every level normalises ("analyze all choices").
2. **Identical ports, strictly (PLECS, not Simulink's flexible interface).**
   - Ports are the device's terminals at its most detailed level.
   - Extra quantities are Sinks inside the levels that model them.
   - A scope channel showing one at a lower level draws nothing and says "not modelled at L1"; it never draws 0.
   - Port edits apply to every level.
3. **No change of causality.** In a block diagram an ideal source driving a capacitor needs a derivative, and a Thevenin output into a resistive load is an algebraic loop. So the subsystem with levels is the op-amp stage with its feedback and load.
4. **One parameter set on the subsystem's mask** (SPICE `.subckt` parameters, Modelica constraining modifiers, the Simscape selector). The panel marks which level uses each parameter and greys those the running level does not. Floors where a neutral value is also stiff (C_L ≥ 1 pF, R_o ≥ 1 Ω).
5. **Validity, stated and checked on the canvas.** A sentence per level, and Valid range blocks on a signal's value, its rate, or a parameter formula. The run reports the first violation and names the level that models it, after binning and validity frames, without choosing the level automatically. The sentence says what the checks cannot catch.
6. **Neutral values give the level below** (SPICE's defaults): bit for bit where representable, a limit bounded by the physics otherwise.
7. **Designs see what runs.** The experiment is: set the global level low, design or tune, keep the numbers (Copy as numbers, or Auto-tune's result), raise it. Designing on less detail than runs (`blocksub`) waits for an example.
8. **An eigenvalue step bound before any stiff level ships** (the sliding-mode research's Recommendation 9): the largest eigenvalue magnitude of a finite-difference Jacobian at the start state, joined to the per-block bounds, in `el.bound` at compile.
9. **The example: the op-amp follower and a cable**, 20 µs at 2 µs/div, opening at level 1, its levels compared with Single runs (input 13). Second: the motor's armature as a level.

## Pitfalls

- **An ideal op-amp inside its feedback loop is an algebraic loop** in a block diagram. SPICE and Modelica solve it as simultaneous equations; Loop Tuner refuses it. Level 1 of the stage is a wire, not an infinite gain.
- **Clamping after an integrator winds it up.** Rails need an integrator whose state is held at the limit (Simulink's "Limit output"), the counterpart of Boyle's diode clamps.
- **A step bound from each block's own poles misses loops through integrators.** It is 0 for an Integrator. A fast loop then diverges as soon as the record step grows (a wider screen), or silently goes wrong near RK4's limit.
- **A step bound from a matrix norm depends on the states' scaling.** Companion-form transfer functions inflate it 200× (the encoder example). Use the largest eigenvalue.
- **Too many steps.** A detailed level on a long screen can exceed the step cap: the op-amp at 10 ms/div needs 1.26 M steps of 80 ns at level 2 and 712 k of 140 ns at level 3. Say which level needs what; an implicit solver is the real fix.
- **Step inputs inside RK4 stages.** The last stage before an edge sees the new value, so responses start about h/6 early. Compare with exact responses from the state after each edge.
- **A settling time on a knife-edge.** A ringing response's 2 % time can jump by half a microsecond when a swing grazes the band. Quote the band that is robust, and check it against small parameter changes.
- **Missing signals must not read 0.** Simulink and PLECS ground inactive outputs; for physics that is a lie.
- **Designs that re-design on every level hide the degradation.** A live design follows the plant it sees, so raising the level re-designs the controller on the detailed plant, and the person's experiment never shows. Keep the numbers first.
- **A level outside its validity can look right.**
  - Without the slew limit, a 1.45 V step at the output-resistance level shows the same 37.6 % ringing as a small one.
  - With an input of 2.4 V, it peaks at 3.30 V on a ±2.5 V supply.
  - At the large-signal level the same input stops the pin 0.12 V short of the swing, and a large cable is starved by the constant R_o.
  - Each level must say where it stops being true, and check it.
- **Large steps hide small-signal ringing.** The same circuit overshoots 18.7 % on a 0.42 V step and 37.6 % on an 80 mV step (simulation). Show both, or the trap is missed.
- **A constant R_o is a simplification.** It cannot fit both datasheet phase-margin points (60 pF and 500 pF), it overstates the drop near the rails, and it passes a fifth of the part's short-circuit current.
- **Neutral values are not always representable.** R_o = 0 or C_L = 0 make 1/R_o or 1/C_L infinite, and both make the level stiff. Test those as limits with a bound from the physics, and keep floors (C_L ≥ 1 pF, R_o ≥ 1 Ω), so the level never gets stiffer than a screen can afford.
- **Datasheet drift and conditions.** Name the part and revision, not a family ("the 741"), and the conditions of each value (load, supply).
- **The faded comparison is per sweep.** A fast sweep erases the previous level's run before it can be compared. Single runs keep it, which is how the person compares levels (input 13).

## Sources

**SPICE and op-amp macromodels**
- ngspice 43 manual: §2.5 `.SUBCKT`, §2.8 `.LIB`, §2.9.3 subcircuit parameters, §2.13 `.IF`, §3.2.3 binning, §5.1 B-source, §7.2.1 diode, §7.3.3 BJT, §7.6 MOSFET levels (Table 7.3), `altermod`, §9 OSDI: https://ftp.fau.de/gentoo/distfiles/d4/ngspice-43-manual.pdf
- LTspice Universal OpAmp levels: https://ltspicehelpmanual.azurewebsites.net/universalopampmodels.htm ; https://groups.io/g/LTspice/topic/the_universalopamps/105380555 ; https://groups.io/g/LTspice/topic/different_levels_in/74982860 ; `UniversalOpamps2.sub`: https://github.com/evenator/LTSpice-Libraries/blob/master/sub/UniversalOpamps2.sub
- eCircuit Center op-amp models: https://ecircuitcenter.com/OpModels/OpampModels.htm
- Boyle, Cohn, Pederson, Solomon, "Macromodeling of integrated circuit operational amplifiers", IEEE JSSC SC-9(6), 1974, p. 353; through Jung, LT AN48: https://xdevs.com/doc/Linear/AppNotes/AN48%20-%20Using%20the%20LTC%20Op%20Amp%20Macromodels.pdf ; LT DN28: https://docs.ampnuts.ru/analog.com.datasheet/lt1012/related_data/dn028f.pdf ; Baker, Burr-Brown AB-046 / TI SBOA027
- Alani & Williams, TI SBOA338 (Green–Williams–Lis models), 2019
- King, "Op amps driving capacitive loads", Analog Dialogue 31-2, 1997
- Green, "Operational Amplifier Stability, Part 8", TI
- Renesas R34AN0011EU, capacitive loads and op-amp stability
- Microchip MCP6001/1R/1U/2/4 datasheet DS20001733L: https://ww1.microchip.com/downloads/en/DeviceDoc/MCP6001-1R-1U-2-4-1-MHz-Low-Power-Op-Amp-DS20001733L.pdf ; AN884, Driving Capacitive Loads With Op Amps: https://www.microchip.com/en-us/application-notes/drivingcapacitiveloadswithopam
- TI µA741 datasheet, revision H (2026), for the drift between revisions

**Other tools**
- Simulink Variant Subsystem: https://www.mathworks.com/help/simulink/slref/variantsubsystem.html ; https://www.mathworks.com/help/simulink/var/variant-subsystems.html ; visualising variants: https://www.mathworks.com/help/simulink/var/visualize-and-interpret-variant-elements-in-simulink-models.html ; Variant Manager: https://www.mathworks.com/help/simulink/var/variant-management-overview-example.html
- Simulink Control Design, `blocksub` and slTuner: https://www.mathworks.com/help/control/ug/configure-sltuner-interface-with-sampled-system.html
- Simscape Electrical: Converter (Three-Phase) https://www.mathworks.com/help/sps/ref/converterthreephase.html ; fidelity comparison https://www.mathworks.com/help/sps/ug/power-converter-model-fidelity-comparison.html ; semiconductor levels https://www.mathworks.com/help/sps/ug/choose-right-semiconductor-block.html ; Semiconductor Switch Selector https://www.mathworks.com/help/sps/ref/semiconductorswitchselector.html ; Band-Limited Op-Amp https://www.mathworks.com/help/sps/ref/bandlimitedopamp.html (two pages were read only through search summaries; they returned 404)
- Modelica Language Specification §7.3: https://specification.modelica.org/master/inheritance-modification-and-redeclaration.html ; Modelica by Example: https://mbe.modelica.university/components/architectures/replaceable/ ; `choicesAllMatching`: https://doc.modelica.org/om/ModelicaReference.Annotations.choicesAllMatching.html ; MSL op-amps: https://doc.modelica.org/om/Modelica.Electrical.Analog.Ideal.html , https://doc.modelica.org/om/Modelica.Electrical.Analog.Basic.html
- PLECS manual, Configurable Subsystem (Plexim)
- Simcenter Amesim, submodel mode and Premier submodel (Siemens course material, University of Cincinnati)
- IEEE 1364-2001 configurations; Cadence Hierarchy Editor documentation
- IEEE 1666-2011 (SystemC TLM-2.0), loosely and approximately timed coding styles
- Van Acker et al., validity frames; Zeigler, experimental frames
- Tian et al., "Striving for small-signal stability", IEEE Circuits & Devices Magazine, 2001 (loop-gain probes)

**Scripts** (session scratch, may be gone):
- The first threads: `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/levels-check/` (`margins.mjs`, `step.mjs`, `agree.mjs`) and `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/levels/` (`opamp.mjs`, `opamp_screen.mjs`, `motor.mjs`, `sensor.mjs`, `analogpi.mjs`).
- The first checks: `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/dlv/` (`opamp.mjs`, the four levels and the loop's margins; `check.mjs` to `check5.mjs`).
- The first review: `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/dlx/` (`sim.mjs`, the four levels; `main.mjs`, the example; `pm.mjs`, phase margins and sensitivity; `checks.mjs`, `checks2.mjs`; `exact.mjs`, exact responses; `wide.mjs`, 1 ms/div; `twopole.mjs`, the two-pole oscillation).
- The second review: `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/review/` (`jac.mjs`, step bounds of every library system on main; `opamp.mjs`, RK4 of levels 2 to 4).
- This revision's re-checks: `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/dlr/` (`nums.mjs` and `nums2.mjs`, settling robustness, peaks against C_L, eigenvalue steps; `nums3.mjs`, exact responses after each edge; `lim.mjs` and `lim2.mjs`, the R_o limit; `sine.mjs`; `energy.mjs` and `charge.mjs`; `pm.mjs`, closed-form margins).
- The ringing check after the person's answers: `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/dl13/ringing/ringing.mjs` (level 3's closed-loop poles and phase margin per C_L, and an RK4 run of the example at 10 ns: overshoot, ringing frequency from the crossings of the final value, settling; levels 3 and 4 on the second step).
- The datasheet text: `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/dl/mcp6001.txt`.
