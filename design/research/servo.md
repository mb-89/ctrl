# Servo and DC motor non-idealities: how models carry them

Reader: whoever designs or builds the Servo motor component (design/output/servo.md).

Made on 2026-10-25 from one web sweep of tool documentation, vendor data and the Modelica Standard Library (MSL) source. Marks: **(inference)** is my own reasoning or arithmetic, not a source. **(textbook)** is standard knowledge I could not check against a reachable page this time; the source it would come from is named. Orders are per mechanical revolution unless said otherwise. p is the number of pole pairs, n the speed in rev/s.

## Summary

- Commercial motor blocks are ideal by default. Simscape's DC Motor has no ripple option at all; its PMSM has none either. Ripple and cogging enter only through FEM lookup tables (Simscape FEM-Parameterized PMSM, PLECS Lookup machine).
- Every MSL loss that exists is switched off by a neutral value: friction `PRef = 0`, brush drop `V = 0`, backlash `b = 0`. The code tests for it and drops the term exactly.
- Encoders in Simscape are ideal pulse trains: pulses per revolution is the only error-like parameter. Eccentricity, graduation and interpolation errors are not modelled in any tool I found; they come from vendor data sheets.
- What a spectrogram of speed shows is lines at k·n Hz: 1× (eccentricity, unbalance), 2× (encoder tilt), p and 2p (current-sensor offset and gain), 6p (flux harmonics), LCM(slots, poles) (cogging), plus one fixed resonance line that does not move with speed.

## 1. Cogging and torque ripple

**What.** Cogging is the magnet pulling on the stator teeth. It exists with zero current. Ripple is the current-dependent torque from non-sinusoidal back-EMF or flux.

**Orders.**
- Cogging: LCM(slots, poles) per revolution. 6 slots, 8 poles: 24 ([US 6703753](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6703753)). 9 slots, 8 poles: 72, a 5° period ([JMAG JAC040](https://www.jmag-international.com/catalog/40_spmmotor_coggingtorque/)). 12 slots with 10 or 14 poles: 60 and 84 ([Japan Servo, via JPC](https://catalog.e-jpc.com/Asset/BLDC-technology-overview.pdf)). A larger LCM gives smaller cogging. The LCM order is the fundamental and dominates speed variation; its multiples are harmonics.
- Electrical ripple of a three-phase PMSM: 6 and 12 per electrical period, so 6p and 12p per revolution (textbook: the 5th and 7th flux harmonics both land on 6 in the dq frame). An 8-pole servo (p = 4): 24 and 48.
- Brushed DC commutator ripple: LCM(brushes, commutator segments) per revolution. 2 brushes, 3 segments: 6 ([TI SLVAFO8A](https://www.ti.com/document-viewer/lit/html/SLVAFO8/GUID-B13574A5-E75E-413E-8CED-161FF7F50AE6)).

**Magnitudes.**
- Brushed DC, ideal coil model, peak to peak: 14 % (3 coils), 5 % (5), 2.5 % (7), 1.5 % (9), 1 % (11) ([20-sim Servo Motor Editor](https://www.20sim.com/webhelp/toolboxes_mechatronics_toolbox_servo_motor_editor_theory_basic_principles_brush_dc_motors.php)).
- A brush servo data sheet lists cogging 0.2–0.5 oz-in against 12–53 oz-in continuous: about 1–2 % (inference from [CMC Torquemaster 2100](https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/38/Torquemaster-Brush-servo-2100.pdf)).
- Slotless motors: cogging is "eliminated" because there are no teeth ([Motion Control Tips](https://www.motioncontroltips.com/whats-the-difference-between-slotted-and-slotless-motors/)). Skewed slotted servos: typically 0.5–2 % of rated torque; unskewed 2–5 % (textbook, no data sheet found that states a percent).

**How tools carry it.**
- Simscape DC Motor: no ripple parameter. Options are field type, parameterisation (equivalent circuit, stall torque and no-load speed, rated load), thermal port, faults ([MathWorks DC Motor](https://www.mathworks.com/help/sps/ref/dcmotor.html)).
- Simscape PMSM: "Modeling fidelity" is `Constant Ld, Lq and PM` (default) or `Tabulated Ld, Lq and PM` (lookup over id, iq). That is saturation, not ripple: no angle axis ([MathWorks PMSM](https://www.mathworks.com/help/sps/ref/pmsm.html)).
- Simscape FEM-Parameterized PMSM: flux and torque tables over current and rotor angle, e.g. T(iD, iQ, θ) with θ = 0…30° for p = 4. Cogging and ripple are whatever the table holds; there is no separate cogging parameter ([MathWorks FEM PMSM](https://mathworks.com/help/sps/ref/femparameterizedpmsm.html)). The defaults are zero tables.
- PLECS Lookup PMSM: flux tables from FEA for saturation and cross-saturation; the demo page says nothing about cogging ([Plexim demo](https://docs.plexim.com/plecs-demos/motor-drives/look-up-table-based-pmsm/)).
- MSL DC machines: no cogging or commutator ripple (checked in the source, section 8).

**For the component (inference).** One term Tc·sin(k·θ + φ) per order, amplitude 0 by default, is exact at its neutral value and keeps the order visible as a number.

## 2. Encoder errors

**Orders and magnitudes.**
- Eccentricity: 1× per revolution. HEIDENHAIN: ΔF = ±412·e/D arc-seconds, e in µm, D the graduation diameter in mm; about 5″ per µm on their typical disc ([Machine Design, "Getting the right angle"](https://www.machinedesign.com/archive/article/21814707/getting-the-right-angle)). D = 100 mm, e = 5 µm: ±20.6″ (inference).
- Tilt and out-of-roundness of the disc or shaft: 2× per revolution (textbook). Renishaw's REXM cancels eccentricity with two opposed readheads; graduation error and SDE remain ([Renishaw REXM release](https://renishaw.com/media/doc/es/61b70a31d88741c9800d2e258ac570c9.doc)).
- Graduation errors: system accuracy grades ±1, ±2, ±5″ for angle encoders; ERP 880 graduation ±0.9″ over 180 000 signal periods ([Machine Design](https://www.machinedesign.com/archive/article/21814707/getting-the-right-angle)). Line-to-line errors repeat N× per revolution.
- Interpolation (sub-divisional, SDE) error: repeats every signal period, so N× per revolution and its multiples. HEIDENHAIN: within ±2 % of the signal period, typically ±1 % ([HEIDENHAIN, position error within one signal period](https://content.heidenhain.de/presentation/LMG/en/index/N10D1C/N10DA0/N10EB5.html); [LIDA 400 note](https://www.heidenhain.us/wp-content/uploads/14-LIDA4000ResultingLinearError.pdf)). ERP 880: ±0.1″ per period. Renishaw VIONiC linear: < ±15 nm typical ([Renishaw](https://www.renishaw.com/en/38976.aspx)). A 2048-line motor encoder has a 632.8″ period, so 1 % is ±6.3″ (inference).
- Sin/cos channel errors (arctan decoding): an offset in sin or cos gives an error at the signal fundamental, 1× per line period ([US 5463393](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5463393)). Amplitude mismatch and quadrature (phase) error turn the Lissajous circle into an ellipse and give 2× per line period; 3rd/4th-harmonic distortion of the signals gives 4× per period (textbook: expand atan2 of the distorted pair; [Motion Control Tips on Lissajous figures](https://www.motioncontroltips.com/what-do-lissajous-figures-tell-us-about-encoder-output)).
- Quantisation: a quadrature encoder of L lines gives N = 4L counts ([EmbeddedRelated](https://www.embeddedrelated.com/showarticle/158.php)). Speed from a difference over Ts has resolution 2π/(N·Ts). 2500 lines, Ts = 1 ms: 0.63 rad/s, 6 rpm. 20-bit, Ts = 125 µs: 0.048 rad/s, 0.46 rpm (inference). Ellis treats this as velocity "resolution noise" that the speed loop's Kp amplifies (textbook: Ellis, *Control System Design Guide*, ch. on feedback devices; not reached). Merry et al. improve estimates 54 % with edge time stamps ([TU/e](https://research.tue.nl/en/publications/velocity-and-acceleration-estimation-for-optical-incremental-enco/)).

**Position error to speed error (inference).** An error Δθ·sin(k·θ) seen at speed ω reads as a speed ripple of amplitude k·ω·Δθ at k·n Hz. At 1000 rpm (ω = 105 rad/s): eccentricity 20″ (1×) gives 0.010 rad/s, 0.01 %. Interpolation 6.3″ at 2× per line on 2048 lines (k = 4096) gives 13 rad/s, 12 %, but at 68 kHz, so a 1–10 kHz sampled loop sees it only aliased. Small angle errors at high order are large speed errors.

**How tools carry it.** Simscape Incremental Shaft Encoder has three parameters: pulses per revolution (default 2), output amplitude (5 V), index offset (0°). No noise, eccentricity or interpolation error; it is not linearisable and MathWorks points to the ideal sensor for control design ([MathWorks](https://www.mathworks.com/help/sps/ref/incrementalshaftencoder.html)). The Resolver block is an ideal transformer scaled by sin/cos of p·θ ([MathWorks Resolver](https://www.mathworks.com/help/sps/ref/resolver.html)). I found no tool that ships "encoder with errors"; users add them by hand.

## 3. Shaft compliance and two-mass resonance

**Formulas** (motor JM, load JL, shaft stiffness K):
- anti-resonance ωa = √(K/JL), set by the load alone;
- resonance ωr = √(K·(JM + JL)/(JM·JL)) = ωa·√(1 + JL/JM)
([Kollmorgen, "Using Bode plots to improve performance"](https://www.kollmorgen.com/sites/default/files/Using%20Bode%20Plots%20to%20Improve%20Performance.pdf), PDF returned 403, formulas from the search excerpt; the same in [Siemens Sizer FAQ](https://support.industry.siemens.com/cs/attachments/79684499/FAQ-BE2890C2_Sizer_Traegheitsveraeltnis_en_V1.pdf)). Below ωa the plant is the total inertia; the gap between the two grows with JL/JM ([Automate](https://www.automate.org/motion-control/industry-insights/understanding-the-mysteries-of-inertia-mismatch/boa)).

**Typical numbers.**
- Servo with a bellows or disc coupling: 50–500 Hz is the usual band (textbook, Ellis). Example: JM = JL = 1e-4 kg·m², K = 500 N·m/rad: fa = 356 Hz, fr = 503 Hz (inference).
- Harmonic drive: three-segment stiffness. CSG-14-50: K1 0.34, K2 0.47, K3 0.57 ×10⁴ N·m/rad with breaks at 2 and 6.9 N·m; CSG-17-50: K1 0.81, K2 1.1, K3 1.3 ×10⁴ ([Harmonic Drive CSG-14-50](https://www.harmonicdrive.net/products/component-sets/cup-type/csg-2a-lw/csg-14-50-2a-r-bb-lw); [CSF/CSG catalogue](https://www.harmonicdrive.net/_hd/content/documents/csf-csg.pdf)). CSG-17 at K1 driving a 1 kg·m² link: fa = 14 Hz; with a 3e-5 kg·m² motor through 50:1 (0.075 kg·m² reflected), fr = 54 Hz (inference). This is the 10–30 Hz range of robot joints.
- Stiffness is softer at low torque, so the resonance moves with load; bearing clearance and rotation angle shift it too ([JAMDSM 2022](https://doaj.org/article/e9c4cb1978d04a748e320f05e44314b8)).

**Tools.** Simscape Rotational Spring-Damper (K, D) and MSL `SpringDamper` are linear; MSL `ElastoBacklash` with b = 0 reduces to one (section 4). Neither carries the harmonic drive's piecewise stiffness; that needs a table or three segments.

## 4. Backlash and friction

**Backlash models.**
- Dead zone (pure kinematic gap): no torque inside ±b/2, rigid contact outside. Discontinuous; good for position-error studies.
- Elastic backlash: a spring-damper that engages after the gap. MSL `ElastoBacklash` (c, d, b, phi_rel0): flange torque 0 inside |φ| < b/2, else c·φ_contact + min(c·φ_contact, d·φ̇), and never a pulling torque, so no sticking. With b < 1e-10 rad (b = 0, the default) it becomes a plain spring-damper ([MSL source](https://raw.githubusercontent.com/modelica/ModelicaStandardLibrary/master/Modelica/Mechanics/Rotational/Components/ElastoBacklash.mo); [doc](https://doc.modelica.org/om/Modelica.Mechanics.Rotational.Components.ElastoBacklash.html)). `ElastoBacklash2` adds a torque jump at contact ([doc](https://doc.modelica.org/om/Modelica.Mechanics.Rotational.Components.ElastoBacklash2.html)).
- Simscape Driveline Simple Gear: "Enable backlash" switch, off by default (since R2023a; before, a "Backlash model" dropdown). Linear backlash 1e-3 mm at base radius 0.1 m, transition region 1e-4 mm, stiffness 1e6 N/m, damping 1e3 N/(m/s), four hard-stop models including restitution 0.7. Meshing losses default to "No meshing losses – suitable for HIL", then constant (0.8), load-, temperature- or both-dependent efficiency ([MathWorks Simple Gear](https://www.mathworks.com/help/sdl/ref/simplegear.html)).

**Magnitudes.**
- Planetary servo gearheads: 1–3 arcmin (premium), ≤ 8 (value), 10–15 (standard industrial) ([Wittenstein](https://www.wittenstein-group.com/en-us/products/servo-gearboxes); [ABB/Baldor](https://new.abb.com/motors-generators/nema-low-voltage-ac-motors/ac-servo-motors/precision-servo-gearboxes)). Plain spur gears: 10–30 arcmin (textbook).
- Harmonic drive: near-zero backlash; "lost motion" at ±3 % rated torque is the quoted figure, and wind-up is the larger error: about 5.3 arcmin at T2 for CSG 20–32 ([humanoid.guide](https://humanoid.guide/?p=19167)). Standard accuracy 1.5 arcmin (CSG-14). Integrated actuators claim < 20″ ([RobotShop listing](https://www.robotshop.com/products/honpine-direct-drive-high-precision-high-torque-robot-joint-motor-harmonic-actuator)).

**Friction models and who offers them.** The reference survey is Armstrong-Hélouvry, Dupont & Canudas de Wit, *Automatica* 30(7), 1083–1138, 1994, [doi:10.1016/0005-1098(94)90209-7](https://doi.org/10.1016/0005-1098(94)90209-7) (full text not reached; it defines the static, Coulomb, viscous and Stribeck terms and pre-sliding displacement used below).
- Simscape Rotational Friction: T = √(2e)·(T_brk − T_C)·exp(−(ω/ω_St)²)·ω/ω_St + T_C·tanh(ω/ω_Coul) + f·ω, with ω_St = ω_brk/√2 and ω_Coul = ω_brk/10. Defaults: breakaway 25 N·m at 0.1 rad/s, Coulomb 20 N·m, viscous 0.001 ([MathWorks](https://www.mathworks.com/help/simscape/ref/rotationalfriction.html)). Viscous, Coulomb, Stribeck and tanh smoothing in one block; no true stiction state. T_brk = T_C removes the Stribeck hump exactly; T_C = 0 leaves pure viscous.
- MSL `BearingFriction`: table tau_pos(w), and `peak` ≥ 1 for static friction = peak·tau(0). A real stuck/sliding state machine with events, so true stiction ([doc](https://doc.modelica.org/om/Modelica.Mechanics.Rotational.Components.BearingFriction.html)).
- MSL machine `Friction` loss: tau = tauRef·(|w|/wRef)^power_w (default exponent 2, linear below 0.001·wRef); `PRef = 0` (default) gives tau = 0 ([MSL source](https://raw.githubusercontent.com/modelica/ModelicaStandardLibrary/master/Modelica/Electrical/Machines/Losses/Friction.mo)).
- PUMA 560 (Corke's data, motor side): viscous B 1.48e-3, 0.817e-3, 1.38e-3 N·m·s/rad on joints 1–3; Coulomb [+0.395, −0.435], [0.126, −0.071], [0.132, −0.105] N·m, asymmetric; gear ratios 62.6, 107.8, 53.7, 76.0, 71.9, 76.7; motor inertia 200e-6 (joints 1–3) and 33e-6 kg·m² (4–6). Joint 1 Coulomb at the link: 0.395·62.6 = 24.7 N·m (inference). The file ships with Coulomb set to 0 and the values commented out ([ROBOOP puma560_motor.m](https://roboop.sourceforge.io/roboop_doxy/puma560__motor_8m_source.html); origin [Armstrong, Khatib & Burdick 1986](https://ai.stanford.edu/manips/publications/pdfs/Armstrong_1986.pdf)).

## 5. Current loop

- Bandwidth: Kollmorgen AKD 2.5–4 kHz (small drives) and 2–3 kHz (16 kW); velocity loop up to 600–1000 Hz; position loop 1–250 Hz (reseller listings, e.g. [Wake Industrial AKD-P00306](https://www.wakeindustrial.com/buy/kollmorgen/akd-servo-drive-series/AKD-P00306-NBEC-0000); the [Kollmorgen page](https://www.kollmorgen.com/en-us/products/drives/servo/akd) gives no number). So 1–3 kHz is the typical servo figure.
- PUMA 560: analog current loops on the UNIMATE boards ([ISR Lisbon](https://isr.tecnico.ulisboa.pt/wp-content/uploads/2015/05/703_iclab96-4.pdf)); PUMA has no tachometers, speed comes from encoder differences ([US 4894598](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4894598)). I found no published PUMA current-loop bandwidth. The ~400 Hz figure in the brief is **unverified**.
- PWM and computation delay: sampled at the PWM rate fs, the loop delay is about 1.5/fs (one computation period plus half a PWM period, textbook). At 16 kHz, 94 µs: 68° of phase at 2 kHz (inference). This is what caps the bandwidth at roughly fs/10.
- Voltage limit: available di/dt = (V_max − Ke·ω − R·i)/L. As speed rises the back-EMF eats the margin; at the base speed the current loop saturates and torque falls (textbook). Simscape's DC Motor and PMSM have no limit of their own; it is the converter's.
- Current-sensor offset: a DC offset on a phase current is, in the rotor frame, a ripple at the electrical frequency, so torque ripple at p per revolution. Gain mismatch between phases: ripple at 2× electrical, 2p per revolution ([Energies 2025 review](https://www.mdpi.com/1996-1073/18/6/1367); [US 11378597](https://patents.google.com/patent/US11378597)). Large offsets can make torque oppose the command (same patent). No motor block models it; it belongs to the sensor.

## 6. Sensor noise and delays

- Measurement delay: encoder transmission and filtering, typically 10–60 µs for serial encoders (textbook).
- Computation delay: one control period Ts if output is applied at the next tick.
- Sample-and-hold (ZOH): an average delay of Ts/2; total at least 1.5·Ts per sampled loop (textbook; the sliding-mode note used the Ts/2 hold delay too).
- Noise: quantisation (section 2) dominates at low speed; analog sin/cos and current-sensor noise add white noise. In the speed loop, Kp·noise reaches the current command and shows as broadband floor in the spectrogram.
- A pure delay τ adds phase −360°·f·τ: at 500 Hz crossover, 250 µs total costs 45° (inference).

## 7. Which effects matter where

| Effect | Order / frequency | Speed loop (spectrogram) | Position loop | Robot joint torque (geared, current drive) |
|---|---|---|---|---|
| Cogging | LCM(slots, poles)·n | High: line moving with speed, largest at low speed | Medium: ripple in hold, worse with low stiffness | Low at the link: divided by the gear ratio, filtered by the gear |
| Flux ripple | 6p·n, 12p·n | High: second set of speed-proportional lines | Low | Low to medium |
| Commutator ripple (brushed) | LCM(brushes, segments)·n | High for few segments (14 % at 3) | Low | Medium (PUMA's brushed motors) |
| Current offset / gain | p·n, 2p·n | High: lowest-order electrical lines | Medium | Medium |
| Encoder eccentricity / tilt | 1·n, 2·n | Medium: low lines, also from unbalance | High: direct position error ±20″ | Medium if encoder is on the motor: divided by the gear |
| Interpolation / line error | N·n, 2N·n (often aliased) | High when near the sample rate: aliased lines | Low: < 10″ | Low |
| Quantisation | broadband, step 2π/(N·Ts) | High at low speed | Low with fine encoders | Medium: velocity from differences (PUMA) |
| Shaft / gear compliance | fixed fa, fr (50–500 Hz servo; 10–30 Hz HD) | High: a line that does not move with speed | High: limits bandwidth | High: the joint's main limit |
| Backlash | limit cycle, reversal | Low unless load reverses | High: hunting, ±b/2 | High under gravity reversal |
| Coulomb / Stribeck / stiction | at reversals, stick-slip | Medium: distortion near zero speed | High: steady error, stick-slip | High: 25 N·m at PUMA joint 1 |
| Current-loop bandwidth, delay | 1–3 kHz | Medium: phase at crossover | Low | Medium: torque fidelity |
| Voltage limit | at high speed | Medium: saturation at speed | Low | Medium in fast moves |

All "relevance" judgements are inference from the orders and magnitudes above.

## 8. How tools structure fidelity

- **Simscape: options and block variants.** "Modeling option" adds a thermal port; "Model parameterization" changes which numbers you enter (circuit, stall/no-load, rated point), not the physics ([DC Motor](https://www.mathworks.com/help/sps/ref/dcmotor.html)). "Modeling fidelity" switches constant to tabulated inductances ([PMSM](https://www.mathworks.com/help/sps/ref/pmsm.html)). Higher fidelity is a different block (FEM-Parameterized PMSM, Simple Gear with a backlash switch). Faults are added by "Add fault". MathWorks advises not to use more detail than needed.
- **Modelica: conditional components and neutral values.** `useSupport = false` (default) removes the support flange and inserts a `Fixed`; `useThermalPort = false` removes the thermal port, and `useHeatPort = false` sends loss to an internal fixed temperature ([MSL PartialBasicMachine source](https://raw.githubusercontent.com/modelica/ModelicaStandardLibrary/master/Modelica/Electrical/Machines/Interfaces/PartialBasicMachine.mo); [ConditionalHeatPort doc](https://doc.modelica.org/Modelica%203.2.3/Resources/helpWSM/Modelica/Modelica.Magnetic.FluxTubes.Interfaces.ConditionalHeatPort.html)). A component declared `if cond` vanishes with its equations. Losses use neutral parameters tested in code: friction `PRef = 0` sets tau = 0, brush `V = 0` ([BrushParameters](https://raw.githubusercontent.com/modelica/ModelicaStandardLibrary/master/Modelica/Electrical/Machines/Losses/BrushParameters.mo)), backlash `b < 1e-10` becomes a spring-damper.
- **SPICE: neutral defaults.** Each model parameter defaults to the value that removes its effect: series resistance RS = 0, junction capacitance CJO = 0, transit time TT = 0, breakdown BV = ∞ (textbook: ngspice manual, [ngspice docs](https://ngspice.sourceforge.io/docs.html), not fetched). A bare `.model D D` is the ideal Shockley diode.
- **Which give "a parameter at its neutral value removes the effect exactly".** MSL (checked in the source for friction, brush, backlash), Simscape Rotational Friction (T_brk = T_C, T_C = 0, f = 0), Simscape Simple Gear (backlash off, "No meshing losses"), SPICE. Not exactly: a Simscape hard-stop or Stribeck smoothing still changes a tiny region near zero by its tolerance (inference). FEM blocks default to zero tables, which is neutral.

**For the component (inference).** Follow MSL: each non-ideality is a parameter whose neutral value (0, or off) is tested and removes the term, plus a conditional port only where a new signal appears (thermal, encoder output).

## Sources

- https://www.mathworks.com/help/sps/ref/dcmotor.html
- https://www.mathworks.com/help/sps/ref/pmsm.html
- https://mathworks.com/help/sps/ref/femparameterizedpmsm.html
- https://www.mathworks.com/help/sps/ref/incrementalshaftencoder.html
- https://www.mathworks.com/help/sps/ref/resolver.html
- https://www.mathworks.com/help/simscape/ref/rotationalfriction.html
- https://www.mathworks.com/help/sdl/ref/simplegear.html
- https://docs.plexim.com/plecs-demos/motor-drives/look-up-table-based-pmsm/
- https://raw.githubusercontent.com/modelica/ModelicaStandardLibrary/master/Modelica/Mechanics/Rotational/Components/ElastoBacklash.mo
- https://doc.modelica.org/om/Modelica.Mechanics.Rotational.Components.ElastoBacklash.html
- https://doc.modelica.org/om/Modelica.Mechanics.Rotational.Components.ElastoBacklash2.html
- https://doc.modelica.org/om/Modelica.Mechanics.Rotational.Components.BearingFriction.html
- https://raw.githubusercontent.com/modelica/ModelicaStandardLibrary/master/Modelica/Electrical/Machines/Losses/Friction.mo
- https://raw.githubusercontent.com/modelica/ModelicaStandardLibrary/master/Modelica/Electrical/Machines/Losses/BrushParameters.mo
- https://raw.githubusercontent.com/modelica/ModelicaStandardLibrary/master/Modelica/Electrical/Machines/Interfaces/PartialBasicMachine.mo
- https://doc.modelica.org/Modelica%203.2.3/Resources/helpWSM/Modelica/Modelica.Magnetic.FluxTubes.Interfaces.ConditionalHeatPort.html
- https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6703753
- https://www.jmag-international.com/catalog/40_spmmotor_coggingtorque/
- https://catalog.e-jpc.com/Asset/BLDC-technology-overview.pdf
- https://www.ti.com/document-viewer/lit/html/SLVAFO8/GUID-B13574A5-E75E-413E-8CED-161FF7F50AE6
- https://www.20sim.com/webhelp/toolboxes_mechatronics_toolbox_servo_motor_editor_theory_basic_principles_brush_dc_motors.php
- https://e2e.ti.com/cfs-file/__key/communityserver-discussions-components-files/38/Torquemaster-Brush-servo-2100.pdf
- https://www.motioncontroltips.com/whats-the-difference-between-slotted-and-slotless-motors/
- https://www.machinedesign.com/archive/article/21814707/getting-the-right-angle
- https://renishaw.com/media/doc/es/61b70a31d88741c9800d2e258ac570c9.doc
- https://www.renishaw.com/en/38976.aspx
- https://content.heidenhain.de/presentation/LMG/en/index/N10D1C/N10DA0/N10EB5.html
- https://www.heidenhain.us/wp-content/uploads/14-LIDA4000ResultingLinearError.pdf
- https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/5463393
- https://www.motioncontroltips.com/what-do-lissajous-figures-tell-us-about-encoder-output
- https://www.embeddedrelated.com/showarticle/158.php
- https://research.tue.nl/en/publications/velocity-and-acceleration-estimation-for-optical-incremental-enco/
- https://www.kollmorgen.com/sites/default/files/Using%20Bode%20Plots%20to%20Improve%20Performance.pdf (403; used via search excerpt)
- https://support.industry.siemens.com/cs/attachments/79684499/FAQ-BE2890C2_Sizer_Traegheitsveraeltnis_en_V1.pdf
- https://www.automate.org/motion-control/industry-insights/understanding-the-mysteries-of-inertia-mismatch/boa
- https://www.harmonicdrive.net/products/component-sets/cup-type/csg-2a-lw/csg-14-50-2a-r-bb-lw
- https://www.harmonicdrive.net/_hd/content/documents/csf-csg.pdf
- https://doaj.org/article/e9c4cb1978d04a748e320f05e44314b8
- https://humanoid.guide/?p=19167
- https://www.robotshop.com/products/honpine-direct-drive-high-precision-high-torque-robot-joint-motor-harmonic-actuator
- https://www.wittenstein-group.com/en-us/products/servo-gearboxes
- https://new.abb.com/motors-generators/nema-low-voltage-ac-motors/ac-servo-motors/precision-servo-gearboxes
- https://doi.org/10.1016/0005-1098(94)90209-7 (Armstrong-Hélouvry et al. 1994; full text not reached)
- https://roboop.sourceforge.io/roboop_doxy/puma560__motor_8m_source.html
- https://ai.stanford.edu/manips/publications/pdfs/Armstrong_1986.pdf
- https://isr.tecnico.ulisboa.pt/wp-content/uploads/2015/05/703_iclab96-4.pdf
- https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/4894598
- https://www.kollmorgen.com/en-us/products/drives/servo/akd
- https://www.wakeindustrial.com/buy/kollmorgen/akd-servo-drive-series/AKD-P00306-NBEC-0000
- https://www.mdpi.com/1996-1073/18/6/1367
- https://patents.google.com/patent/US11378597
- https://ngspice.sourceforge.io/docs.html (not fetched)
- Not reached, used as textbook knowledge: G. Ellis, *Control System Design Guide* (4th ed., 2012), chapters on resonance and feedback devices.
