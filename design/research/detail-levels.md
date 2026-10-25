# Research: detail levels, as SPICE has them

Reader: whoever builds detail levels in Loop Tuner, or wants to know why [../output/detail-levels.md](../output/detail-levels.md) decided what it did. The person's words are in [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md), last section ("detail levels … Spice, I think, has that … the interfaces stay more or less the same … the model introduces more calculations and more parameters … if I increase detail level, the control works worse").

This synthesis was made on 2026-10-24 from three research threads:
- how SPICE handles model detail;
- how other tools do it (Simulink, Simscape, Modelica, PLECS, Amesim, Verilog configurations, SystemC TLM);
- which example shows the point.

Every number about the example was then checked again with a separate RK4 script.

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
  - chosen per subsystem, capped globally;
  - one parameter set on the subsystem's mask;
  - each level states and checks its validity;
  - a design may pin a lower level than runs, so "design simple, run detailed" shows the degradation.
- **First example: an op-amp follower driving a cable.** An MCP6001-class part on ±2.5 V drives 1 nF ∥ 10 kΩ (simulation):
  - At the gain–bandwidth level it is perfect: phase margin 90°, no overshoot, 10–90 % in 350 ns.
  - Add the op-amp's output resistance driving the cable: phase margin 33°, 37.6 % overshoot, ringing for 3.2 µs.
  - Add slewing: large steps reshape (18.7 % instead of 37.6 % on a 0.42 V step).
  - It runs with no new primitive beyond those openable physics needs anyway.

## What the checks corrected

The three threads' numbers were re-run (`dlv/check*.mjs`). These changed:

1. **The current limit never acts.**
   - With a resistive R_o = 496 Ω and ±2.5 V rails, the output can pass at most about 10 mA: 4.95 V across R_o.
   - The MCP6001's short-circuit limit is 23 mA. At 50 nF the simulated peak was 4.5 mA, not the 23 mA ramp at I_sc/C_L that "the current limit starts to matter above C_L ≈ I_sc/SR = 38 nF" predicted.
   - The large-signal level therefore models slewing and the output swing only, and says why the current limit is left out.
2. **With a load resistor in the loop, C_L → 0 does not return the level below.**
   - At C_L = 1 pF the output-resistance level and the gain–bandwidth level are still 26 mV apart on a 1.45 V step, because R_L and R_o form a divider inside the loop (loop gain −4.7 %).
   - The neutral parameter is R_o → 0: 8.7 mV apart at 1 Ω, 0.9 mV at 0.1 Ω.
3. **Settling.** The output-resistance level settles within 2 % 3.15 µs after a small step (4.0 µs within 1 %), not 3.7 µs.
4. **The per-block step bound does not hurt the default screen; it hurts a wider one.**
   - Without a Controller block the record step is the screen / 2000: 10 ns on a 20 µs screen, finer than the 80 ns the 6.3·10⁶ 1/s loop needs.
   - At 1 ms/div the record step is 5 µs and RK4 runs at λh = 31, where it is unstable (the limit is 2.8).
   - So the Jacobian bound is still a prerequisite, for a screen the person can choose rather than for the example as shipped.
5. **One scale for both steps.** A 50 mV step and a 1.45 V step cannot be read on one channel of 8 divisions: the small step's 19 mV of ringing is a tenth of a division. Steps of 80 mV (below the 95.5 mV slew threshold) and then to 0.5 V both read at 0.1 V/div.
6. **The comparison between levels needs slow motion.**
   - Earlier runs fade once per sweep. At 1× a 20 µs screen sweeps every frame, so the previous level's run would be gone in five frames.
   - At 4·10⁻⁶× the screen sweeps in 5 s and the faded run stays about 25 s.
7. **Near the rails the large-signal level is pessimistic.**
   - Clamping the op-amp's internal node at the swing limit, with R_o and 10 kΩ after it, leaves the pin at 2.358 V for a 2.4 V input.
   - The datasheet promises 25 mV from the rail. The constant R_o overstates the drop at DC: a CMOS rail-to-rail output's impedance changes with frequency (Green).
   - The level says so.
8. **The calibration.**
   - R_o = 496 Ω gives 44.997° at the datasheet's 500 pF ∥ 10 kΩ (simulation of the linear loop), so the 45° point is reproduced.
   - It gives 80.5° at the datasheet's own 60 pF test load, where the datasheet says 90° typical. A constant R_o cannot fit both.
   - Without the 10 kΩ load the same 45° point gives 450 Ω (inference, closed form), which is why the example keeps the datasheet's load.

Confirmed and kept:
- L3 and L4 agree bit for bit below the slew threshold SR/(2π·GBW) = 95.5 mV (a 90 mV step: 0 difference; 100 mV: 0.63 mV).
- With its limits at infinity, L4 equals L3 bit for bit.
- A 1 kHz, 0.5 V sine differs between the ideal and the gain–bandwidth level by 0.500 mV (A·f/GBW = 0.5 mV).
- The phase margins: 22.6° at 2.2 nF, 10.7° at 10 nF.
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
| **Simulink Control Design** | – | `linearize(…, blocksub)`, slTuner `BlockSubs` | – | Copy: linearising with a substitute model, the precedent for designing on a different level than runs |
| **Simscape** | ports may change with fidelity (thermal port H on the detailed level only) | a Fidelity parameter on the block; the Semiconductor Switch Selector changes fidelity "without replacing a block or reentering parameter values" | "Parameter values that are common to both blocks carry over" | Copy: pick the lowest fidelity that answers the question; "To simulate in real time, use the equivalent model … To validate the results, use the detailed model". Avoid: compiled insides (black box), conditional ports |
| **Modelica `replaceable … constrainedby`** | the redeclared type "shall be a subtype of the constraining type" (§7.3.2) | `choicesAllMatching` drop-down | modifiers in the constraining clause "are automatically applied … in any subsequent redeclaration" | Copy: a checked interface, shared modifiers. Modelica.Fluid.System's system-wide defaults are a precedent for a global setting with local override |
| **Amesim** | the component keeps its icon | per component in Submodel mode; **Premier submodel** applies "the simplest mathematical models for all components" | – | Copy: the global "simplest" switch (our Detail ≤ 1) |
| **Verilog-2001 configs, Cadence Hierarchy Editor** | fixed by the design | a global ordered view list with a stop view; per-instance override | – | Copy: global default plus per-instance choice; a table of what each instance runs |
| **SystemC TLM-2.0** | sockets and the base protocol fixed | coding style: loosely timed (speed) or approximately timed (accuracy) | – | Copy: detail as "points along a spectrum" behind a fixed interface |
| **Validity frames** (Zeigler's experimental frame; Van Acker et al.) | – | – | – | Copy: a model carries the range where it is valid |

### The capacitive-load trap (the example's physics)

- **The mechanism.** The output resistance R_o and the load C_L add a pole at 1/(2π·R_o·C_L). For "conservative phase margin" it should be "at least a decade above the circuit's closed loop bandwidth" (King, AD 31-2).
  - Renesas (R34AN0011EU): it "reduces this phase margin … overshoot, ringing, and at worst … self-sustaining oscillations".
  - The follower is the worst case, since capacitive-load drive grows with the noise gain.
- **TI's Tim Green** (Stability Part 8): a CMOS rail-to-rail output's Z_O "will look capacitive at Low and Medium Frequencies", and a macromodel's A_OL is wrong when it is driven into saturation. So a resistive R_o is a simplification, and the level must say so.
- **The MCP6001 datasheet** (DS20001733L):
  - GBWP 1.0 MHz; phase margin 90° typical (G = +1, C_L 60 pF, R_L 10 kΩ); "a 45° phase margin (typical) with a 500 pF capacitive load".
  - SR 0.6 V/µs; A_OL 88 dB minimum, 112 dB typical.
  - Swing within 25 mV of the rails (V_DD 5.5 V); I_SC ±23 mA (5.5 V); V_OS ±4.5 mV maximum.
  - An isolation-resistor section with its gain-error caveat.
- **Real oscillation needs a second pole below the GBW.**
  - For a two-pole op-amp plus R_o·C_L, the gain margin is (fp2 + f_L)/GBW (inference, closed form, confirmed numerically).
  - With the Boyle/Modelica 741-like set (A0 2·10⁵, GBW 1 MHz, fp2 2 MHz, R_o 75 Ω) the gain margin is at least 6 dB for any C_L. With fp2 = 0.7 MHz it oscillates above C_L = 7.1 nF.
  - There a model without limits grows without bound (outside its validity), while the large-signal level settles into a bounded limit cycle at about 385 kHz (simulation, first thread).
  - Kept as a possible second experiment, not the example.

### Candidate examples

| Candidate | What raising the level does | Cost | Verdict |
|---|---|---|---|
| **Op-amp follower and a cable** (MCP6001 class, 1 nF ∥ 10 kΩ) | Gain–bandwidth: perfect (90°). + R_o into C_L: 33°, 37.6 % overshoot. + slewing: large steps reshape | 0, 1, 2, 2 states; the same 2000 record steps at every level on a 20 µs screen (h ≤ 80 ns needed) | **Chosen**: it makes the person's point at once. Weakness: no Controller block, so Controller, Auto-tune and Analysis do not apply; µs time scale |
| DC motor, armature as a level | No inductance: a sampled relay looks perfect. With L/R = 10 ms it chatters at 62.5 Hz with about 10 A of ripple (sliding-mode research) | ms scale, cheap | **Second**: shows it with a Controller block and the design layer. It needs only the motor's mask |
| Analog PI on an op-amp, motor speed loop | GBW changes the speed by 0.0007 rad/s; rails and slew wind up the capacitor; offset leaves 0.16 rad/s | stiff (760 krad/s inside a 3 Hz loop); 50× the steps | Rejected: the expensive level changes nothing |
| Motor driver board, digital PI (DRV8871) | Averaged bridge, then 20 kHz PWM, then dead time: no overshoot at any level; slower, not worse | 6–200× the steps | Rejected: PWM is invisible to a speed loop |
| Sensor board (tacho, anti-alias filter, ADC) | Phase margin 76° → 32.5° only when the filter corner is near the crossover | cheap | Partly: the op-amp is incidental |

## Recommendations

1. **Levels on any subsystem.**
   - Each level is `{ name, adds, valid, requires?, diagram }`, chosen by a 1-based `level`.
   - A global `sim.detail`: a cap, or "max".
   - The level that runs is min(chosen, cap).
   - Levels are fixed at compile (Simulink's update diagram).
   - Only the running level compiles; every level normalises ("analyze all choices").
2. **Identical ports, strictly (PLECS, not Simulink's flexible interface).**
   - Ports are the device's terminals at its most detailed level.
   - Extra quantities are Sinks inside the levels that model them.
   - A scope channel showing one at a lower level draws nothing and says "not modelled at L1"; it never draws 0.
   - Port edits apply to every level.
3. **No change of causality.** In a block diagram an ideal source driving a capacitor needs a derivative, and a Thevenin output into a resistive load is an algebraic loop. So the subsystem with levels is the op-amp stage with its feedback and load.
4. **One parameter set on the subsystem's mask** (SPICE `.subckt` parameters, Modelica constraining modifiers, the Simscape selector). The panel marks which level uses each parameter and greys those the running level does not.
5. **Validity, stated and checked.** A sentence per level, parameter ranges (`requires`), and a Valid range block on signals. The run reports the first violation and names the level that models it, after binning and validity frames, without choosing the level automatically.
6. **Neutral values give the level below** (SPICE's defaults): bit for bit where representable, a bounded limit otherwise.
7. **Design on less detail than runs** (`blocksub`). A designed variant may pin `designDetail`. The design layer compiles the plant it sees at min(running, pin). `plantKey` keys on the seen levels only. The Controller tab names what the design does not know (the `adds` of the levels between).
8. **A Jacobian step bound before any stiff level ships** (the sliding-mode research's Recommendation 9): the ∞-norm of a finite-difference Jacobian at the start state, combined with the per-block bounds.
9. **The example: the op-amp follower and a cable**, 20 µs at 2 µs/div, played at 4·10⁻⁶×, opening at level 1. Second: the motor's armature as a level.

## Pitfalls

- **An ideal op-amp inside its feedback loop is an algebraic loop** in a block diagram. SPICE and Modelica solve it as simultaneous equations; Loop Tuner refuses it. Level 1 of the stage is a wire, not an infinite gain.
- **Clamping after an integrator winds it up.** Rails need an integrator whose state is held at the limit (Simulink's "Limit output"), the counterpart of Boyle's diode clamps.
- **A step bound from each block's own poles misses loops through integrators.** It is 0 for an Integrator. A fast loop then diverges as soon as the record step grows (a wider screen), or silently goes wrong near RK4's limit.
- **Too many steps.** A detailed level on a long screen can exceed the step cap (the op-amp at 10 ms/div needs 1.25 M steps of 80 ns). Say which level needs what; an implicit solver is the real fix.
- **Missing signals must not read 0.** Simulink and PLECS ground inactive outputs; for physics that is a lie.
- **Designs that re-design on every level hide the degradation.** Without a pinned design level, raising the level re-designs the controller on the detailed plant, so the person's experiment never shows.
- **A level outside its validity can look right.**
  - Without the slew limit, a 1.45 V step at the output-resistance level shows the same 37.6 % ringing as a small one.
  - With an input of 2.4 V, it peaks at 3.30 V on a ±2.5 V supply.
  - Each level must say where it stops being true.
- **Large steps hide small-signal ringing.** The same circuit overshoots 18.7 % on a 0.42 V step and 37.6 % on an 80 mV step (simulation). Show both, or the trap is missed.
- **A constant R_o is a simplification.** It cannot fit both datasheet phase-margin points (60 pF and 500 pF), and it overstates the drop near the rails.
- **Neutral values are not always representable.** R_o = 0 or C_L = 0 make 1/R_o or 1/C_L infinite. Test those as limits with a bound, and keep C_L above a floor (1 pF), so the level never gets stiffer than a screen can afford.
- **Datasheet drift.** Name the part and revision, not a family ("the 741").
- **The faded comparison is per sweep.** A fast sweep erases the previous level's run before it can be compared.

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
- The checks above: `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/dlv/` (`opamp.mjs`, the four levels and the loop's margins; `check.mjs` to `check5.mjs`).
- The datasheet text: `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/dl/mcp6001.txt`.
