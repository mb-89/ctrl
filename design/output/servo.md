# One Servo motor, its errors as switches

Reader: the agent who builds the Servo motor component, rebuilds the motor examples or the PUMA's motors on it, builds the backlash example, or adds an effect to it. The person's words are in [input 18](../input/2026-10-25-18-servo-motor-detail.md) and their answers in [input 23](../input/2026-10-25-23-servo-answers-backlash.md); the research, with sources, is in [../research/servo.md](../research/servo.md). **Built** (2026-10-25, branch `feat/servo`; [§15](#15-built-measured-deviations)): every step; the PUMA's joints on a rigid shaft ([§15.6](#156-the-pumas-joints-built-step-7)), the coupled one left for them. The rest of this page is the plan it was built from; where the code and this page differ, the code, §15 and [decisions.md](decisions.md) win.

The person, later ([input 24](../input/2026-10-25-24-backlash-fix-gear-stiffness.md)): "The backlash example should also offer the industrial fix ... make it a bit slower, because 50 Hertz running at our [HIL] with 100 Hertz is ... critical. And ... make it configurable."

The person: "make them high detail toggles in our servo motor ... the servo motor can also run speed controlled ... we could also just increase the level of the servos of the robot, and then the same errors would show up in the robot too ... it would also be reuse." And, answering this page: "put the rotor's inertia into the motor. That's where they belong ... set the stiffness ... and the backlash ... to non-problematic values first. But especially backlash is an interesting thing for us ... we should have one example that exemplifies a backlash simulation."

## 0. Bottom line

**One built-in component, Servo motor: a subsystem of primitives with a mask, used by every motor in the library.** It is the drive, the torque the motor makes, its friction and ripple, **its rotor (the rotor's inertia is inside, where it belongs)**, the gear with its stiffness and backlash, and the encoder on the motor shaft. What it turns is outside: a load, or a robot link.

- **Two ways to connect the output shaft** (the mask choice `shaft`), with one physics inside:
  - **free**: the shaft carries a load torque (In 2, τ_L). Used by a lone motor whose only load is its own rotor and a torque, which are the library's DC motor examples and the encoder example. There is nothing for a spring to couple to, so there is no gear spring and no backlash. A spring with nothing on its far end transmits exactly the applied torque.
  - **coupled**: the shaft drives an inertia that something else integrates (a load arm, a PUMA link). The load's θ and ω come in (In 2, 3), and the gear's torque τ goes out. In between is an elastic gear (stiffness k, damping c) and, as a switch, its backlash (play β).
- **Ports.** In u (V or A, by `drive`), then τ_L (free) or θ and ω (coupled). Out τ, θ measured, ω measured, and ω (the motor's true speed at the output). Inside are Sinks for the current i, the torques τe (K·i) and τm (the net torque on the rotor), the gear's deflection δ and, for a current drive, the voltage v the drive needs.
- **Speed, position or torque control is not a mode**: it is which output the loop reads and what it commands. Voltage or current drive is the mask choice `drive`.
- **Every non-ideality is a switch on the mask**, with its own parameters, kept while it is off:
  - Coulomb friction;
  - torque ripple and cogging;
  - torque noise;
  - the current loop's lag;
  - the supply limit;
  - **backlash**;
  - the encoder's coupling resonance, angle errors, counts and delay;
  - speed measured from the angle.

  A switch that is off is not compiled, so the motor is exactly the motor without it. Switched on with its size at the neutral value (an amplitude of 0, a lag of 0, a play of 0), it gives the same run bit for bit.
- **Defaults, as the person set them**:
  - the robot opens with Coulomb friction on and every other error off, at realistic sizes (the user raises them);
  - the encoder example keeps its exaggerated errors, so they show in the spectrogram;
  - the gear's stiffness starts non-problematic and is configurable (k, c). On the robot its resonance is 20 Hz, below the 50 Hz Nyquist frequency of a 100 Hz HIL cycle (input 24), and four times the axis loops' 5 Hz;
  - backlash starts off, at 0.
- **A new example, Gear backlash**: a small motor on a current drive turns a load arm through a 20:1 gearhead with 1° of play, and the position loop reads the load's encoder. The loop hunts: the load rattles in the play at about 31 Hz, ±10.5 mrad, with PID or PD. Reading the motor's encoder stops the hunting, but leaves the load wherever it came to rest in the play. **The industrial fix, the dual loop** (position from the load's encoder, damping from the motor's speed), holds the load to 0.13 mrad with no hunting. Its notes say that the Servo motor simulates backlash, and how (§7.4).
- **Measured on a prototype from today's primitives** (§10):
  - the DC motor examples (free shaft, rotor inside) reproduce main to 1.4·10⁻¹⁴ relative;
  - the encoder example reproduces main to 6.1·10⁻¹², because the motor now owns its friction (shown exact when it is put back);
  - on a PUMA joint 2 with an elastic gear at 20 Hz, the path error grows from 1.78 to 2.82 mrad rms; the loops, tuned as if rigid, now see the gear (at 50 Hz: 1.83; at 10 Hz: 8.53). The joint torque now leaves out the rotor's own acceleration torque (4.9 N·m rms, which was inside before). Backlash under gravity only shifts the path (+1.3 mrad at 15′); without gravity it knocks: torque spikes of up to 25 N·m.
- **What it needs first:**
  - a minimal mask (numbers, toggles, choices; formulas in the mask's names);
  - **switches resolved at compile time** (a compiled off branch changed the step: 2 substeps against 1);
  - for the coupled shaft, **a step bound that sees integrator loops** ([detail-levels.md](detail-levels.md) §5's eigenvalue bound). The gear's resonance is a loop of Integrators and Gains, which today's per-block bound does not see. The prototype stands in for it.

## 1. On the canvas

A block faced **Servo motor**, with a second line from its mask: "voltage drive, free shaft" or "current drive, G 107.8, coupled · friction". Double-click opens it like any subsystem (no black boxes, [transparent-models.md](transparent-models.md)):

```
 u ─►[drive ▾]──────── i ─►[K]─ τe ─►(Σ)─ τm ─►(Σ)─►[rotor 1/Jm]─ ωm ─►[∫]─ θm
   voltage: (V − K·ωm) → 1/(L·s + R)      ▲ ▲ ▲         ▲ −τ/G  (free: −τ_L/G)
   current: clamp ±imax → [current loop ⏻]│ │ └ [viscous b] ◄ ωm
                                         │ └── [Coulomb ⏻] ◄ ωm
 θm ─►[ripple and cogging ⏻]─►[torque noise ⏻]┘

 coupled shaft, the gear:
 δ = θm/G − θ,  δ̇ = ωm/G − ω ─► δ + (c/k)·δ̇ ─►[backlash ⏻: dead zone ±β/2]─►[k]─┬─► Out τ
                                                                               └─►[1/G] → rotor (−)
 encoder on the motor shaft:
 θm ─►[coupling ⏻]─►[errors ⏻]─►[counts ⏻]─►[delay ⏻]─►[1/G]──┬────────► Out θ measured
                                                              └─►[speed from angle ⏻]─► Out ω measured
 ωm ─►[1/G] ─► Out ω (and ω measured when that switch is off: an ideal tachometer)
 Sinks: i, tau_e, tau_m, delta (coupled), v (current drive)
```

- Each ⏻ is a **Switch** whose position is the mask's toggle. Off, its input passes through and the effect's blocks are not compiled. The group stays visible, drawn faint and labelled "off".
- **`shaft` free** replaces the gear group by one Gain 1/G from In 2 (τ_L) into the rotor's sum, and Out τ then reads τ_L.
- **Selected, the block shows its mask** in the Parameters panel:
  - the motor (R, L, K, b, Jm, G and, for a current drive, imax);
  - the shaft (the choice; k and c when coupled);
  - one row per switch: a toggle, with the effect's fields folded under it, greyed while off.
- Switches never change ports. `shaft` does (3 inputs coupled, 2 free), as a Controller's `inputs` does.

## 2. Ports and uses

### 2.1 Ports

| Port | Name | Unit | Notes |
|---|---|---|---|
| In 1 | u | V or A | The command. Its label follows `drive`: "V" or "i*" |
| In 2 | τ_L (free) · θ (coupled) | N·m · rad | Free: the load torque at the output. Coupled: the load's angle at the output |
| In 3 | ω (coupled only) | rad/s | The load's speed at the output |
| Out 1 | τ | N·m | Coupled: the gear's torque on the load, k·dz(δ + (c/k)·δ̇). Free: τ_L. The person's torque |
| Out 2 | θ measured | rad | The motor encoder's angle referred to the output (θm/G). With the encoder switches off it is θm/G exactly |
| Out 3 | ω measured | rad/s | Speed from the angle when that switch is on; otherwise Out 4 |
| Out 4 | ω | rad/s | The motor's true speed at the output, ωm/G |

There is no algebraic loop. The rotor's integrators sit between u and every output, and τ (coupled) goes straight through only from the load's θ and ω, which the load's integrators produce.

### 2.2 Why the rotor is inside, and why two shafts

The rotor's inertia belongs to the motor (the person: "That's where they belong"). The causal question is what the motor connects to:
- **To nothing but a torque** (a lone motor; a load torque d brakes it): the motor integrates its rotor and takes τ_L in. That is main's DC motor (1/(J·s + b) with the load torque into its sum). J is the rotor's Jm, and the load's inertia, if any, is lumped in it. No spring is involved.
- **To another inertia** (a load arm, a robot link): two integrated bodies cannot be joined rigidly in a causal diagram without an algebraic loop. They are joined by the gear's stiffness, which is physical: every gear and coupling has one. The motor integrates its rotor, the load integrates itself, and the gear's torque goes both ways.

**Measured: why the lone motors are not coupled.** Coupling the library's lone motors to a load through a 100 Hz gear (J split in halves) changes their runs:
- the position examples change by up to 0.9 % of a signal's peak;
- the relay's switching moves (V 200 %, i 113 %);
- super-twisting's V changes by 18 %;
- they run 4–5 times slower.

The free shaft keeps them as they are (1.4·10⁻¹⁴) and is the right physics for a motor without a separate load.

**The robot changes accordingly.** The arm's mass matrix no longer carries the armature G²·Jm. It moves into the six motors, so [robot.md](robot.md)'s Inverse dynamics' `armature` input is 0 for the plant. The controller's model keeps it: the controller still models the rotor, because the plant has one.

### 2.3 Drive: voltage or current

`drive` is a mask choice: the Switch "drive" with two branches, of which only the chosen one is compiled.
- **voltage**: u is V. Then the supply limit (a switch), V − K·ωm, and the armature 1/(L·s + R) gives i. This is main's DC motor.
- **current**: u is i*. Then ±imax, and the current loop's lag (a switch; off is an ideal current source) gives i. The voltage the drive needs, v = R·i + K·ωm, is a Sink (it leaves out L·di/dt, which the Sink's description says).

Everything after i is shared. A PI current loop over the R–L armature is later (§13).

### 2.4 Speed, position and torque control

- **Speed-controlled** (the encoder example): the Controller reads Out 3, ω measured.
- **Position-controlled** (the DC motor examples): it reads Out 2, θ measured, the motor's encoder.
- **Torque-controlled** (the PUMA's axis loops): it commands i* through a current drive.
- **Position from the load** (the backlash example): it reads the load's own encoder, which is the load's angle outside the component.

A cascade reads several. None of these is a setting of the motor.

## 3. Parameters (the mask)

Physical inputs only. Nothing computable is stored: no τ = J/b, no reflected inertia, no resonance frequency. Blocks read these names through formulas: the armature's den `["L", "R"]`, the rotor's K `"1/Jm"`, the gear's `"1/G"` and `"c/k"`, the counts' step `"2*pi/N"`, the dead zone's `"beta/2"`.

| Key | Label | Unit | DC motor examples | Notes |
|---|---|---|---|---|
| `drive` | Drive | choice | voltage | voltage · current |
| `R` | Armature resistance | Ω | 1 | |
| `L` | Armature inductance | H | 0.01 | 0 allowed (the armature becomes 1/R) |
| `K` | Torque and back-EMF constant | N·m/A = V·s/rad | 0.5 | One number for main's equal Kt and Ke |
| `b` | Viscous friction at the motor | N·m·s/rad | 0.1 | |
| `Jm` | Rotor inertia | kg·m² | 0.02 | At the motor. A lone motor's lumped load inertia is included |
| `G` | Gear ratio | motor turns per output turn | 1 | Sign allowed (the PUMA's motor directions) |
| `imax` | Current limit | A | – | Current drive |
| `shaft` | Output shaft | choice | free | free · coupled |
| `k` | Gear stiffness | N·m/rad at the output | – | Coupled |
| `c` | Gear damping | N·m·s/rad at the output | – | Coupled |

**Non-problematic stiffness.** The library's coupled uses set k and c so that the two-mass resonance sits about ten times above the loop's bandwidth, with ζ about 0.1:
- ωr² = k·(1/(G²·Jm) + 1/J_L);
- 2ζ·ωr = c·(1/(G²·Jm) + 1/J_L).

Defaults:
- **PUMA joints: 20 Hz** (k = 1.72·10⁴ N·m/rad, c = 27 N·m·s/rad on joint 2). The person: 50 Hz is critical next to a 100 Hz HIL cycle, whose Nyquist frequency it is (input 24). 20 Hz is four times the axis loops' 5 Hz.
- **The backlash example: 50 Hz** (k = 439 N·m/rad, c = 0.28), so that its hunting is the play's alone. At 20 Hz its load-encoder loop is unstable even without play (§7.4), which is a lesson of its own, kept as a try-this.

These are inputs typed once. The formula is how the values were chosen, written in the example's comment, not something the page computes. **Configurable**: k and c are mask fields. A later convenience, not stored, is a "set from fr, ζ" helper in the mask panel that types k and c from a resonance frequency and a damping.

## 4. The switches

Each is a toggle on the mask (`kind: 'toggle'`) with its fields. **Off** is the motor without it, bit for bit, for every row: its branch is not compiled. **Neutral on** is the value at which the effect, switched on, still reproduces the motor without it bit for bit (✓: measured).

| Switch | Blocks inside | Fields | Neutral on | Shows in |
|---|---|---|---|---|
| `coulomb` Coulomb friction | Function on ωm: Tc⁺ for ωm ≥ 0, Tc⁻ below, smoothed by tanh(ωm/ωs) | Tc⁺, Tc⁻ (N·m, motor), ωs (rad/s) | Tc± = 0 ✓ | Position hold, reversals; most of the robot's path error |
| `ripple` Torque ripple and cogging | Function on θm: Σ A_k·sin(k·θm + φ_k) | orders k (per motor turn), A_k (N·m), φ_k | A_k = 0 ✓ | Spectrogram lines at k·ω/2π; at the robot's link ×G |
| `torqueNoise` Torque noise | Noise | σ (N·m), seed | σ = 0 ✓ | Broadband floor |
| `currentLoop` Current loop (current drive) | 1/(τc·s + 1) | τc (s) | τc = 0 ✓ | Torque lag; the step |
| `vlimit` Supply limit (voltage drive) | Saturation ±Vmax | Vmax (V) | Vmax = inf | Speed limited at high speed |
| `backlash` **Backlash** (coupled) | Function: dead zone of width β on δ + (c/k)·δ̇ | β (rad at the output, the total play) | β = 0 ✓ (the dead zone of width 0 is the identity, exactly) | Hunting, the load's offset, knocks in τ (§7.3, §7.4) |
| `coupling` Encoder coupling resonance | ωc²/(s² + 2ζc·ωc·s + ωc²) on θm | ωc (rad/s), ζc | none; exact off | A horizontal spectrogram line |
| `encErrors` Encoder angle errors | Function: u + Σ e_k·sin(k·u + φ_k) | orders k (per motor turn), e_k (rad, motor), φ_k | e_k = 0 ✓ | 1× eccentricity, 2× tilt; N× interpolation |
| `counts` Encoder counts | Quantizer 2π/N | N (counts per motor turn) | none; exact off | Quantisation, worst through a derivative |
| `encDelay` Measurement delay | Dead time | T_d (s) | T_d = 0 | Phase lag |
| `speedFromAngle` Speed from the angle | s/(T_f·s + 1) on θ measured | T_f (s) | none; off is an ideal tachometer | Every encoder error, amplified by frequency |

**How the backlash works.** The gear's torque is τ = k·dz(δ + (c/k)·δ̇, β/2): a spring and a damper while the teeth touch, nothing in the play. δ = θm/G − θ is the gear's deflection.
- Putting the damper inside the dead zone's argument means contact begins and ends where the spring force plus the damping force crosses zero. So the teeth never pull each other back as they part, which a damper added outside the dead zone would do. That is the known flaw of the naive model. Modelica's ElastoBacklash avoids it differently: it limits the damping torque so that the total never pulls (research §4).
- It also needs only today's one-input Function block. With β = 0 it is k·δ + c·δ̇, the elastic gear.
- What it does not model: the impact's sound, or restitution beyond what c gives. It is valid while the contact lasts several steps. At k = 439 N·m/rad on 0.018 kg·m² that holds for steps below about 2 ms.

**The order of the encoder chain** (coupling, errors, counts, delay) is main's. Ripple and encoder errors take θm, the motor's own angle, so their orders are per motor turn, as on a datasheet. On the robot, a 6× motor ripple is 6·G per joint turn. **The encoder example's resonance is the encoder's coupling** (sensor side, as main computes it). The two-mass resonance between rotor and load is now the coupled shaft itself.

**Not switches:**
- stiction and Stribeck (they need a stick state, §13);
- current-sensor offset and gain (PMSM orders; this is a DC motor);
- the inertia (it is a parameter);
- the gear's stiffness (a coupled shaft always has one; rigid is the free shaft).

## 5. Torque and current as signals; the step

- **Torques.** τ (Out 1) is the torque in the gear, the person's torque: in the robot it is τ_j ([input 15](../input/2026-10-25-15-puma-torques.md)). Inside, τe = K·i is the motor's electromagnetic torque and τm is the net torque on the rotor.
  - The robot's shares then read clearly. Electromagnetic G·τe minus the rotor's acceleration G²·Jm·q̈m minus friction is what reaches the link as τ.
  - Ripple and friction also get their own Sinks (`tau_ripple`, `tau_friction`), so robot.md's friction share is read from the motor.
- **Names.** Sinks inside are named per instance by the block's path ("Motor 2/i").
- **The step:**
  - an off switch adds nothing (it is not compiled);
  - the current loop's pole took the PUMA joint from 1 to 3 substeps at a 0.5 ms record;
  - the coupled gear's resonance (ωr) and its damping (c·(1/Jr + 1/J_L)) must bound the step. They are a loop of two Integrators through Gains, invisible to today's per-block bound. The coupled shaft therefore **requires the eigenvalue step bound** ([detail-levels.md](detail-levels.md) §5). The prototype stands in for it with an unused lag at ωr, inside the component, so the step plan sees the mode. At 50 Hz the PUMA joint and the backlash example still step at 1 substep of 0.5 ms; a stiffer gear costs steps in proportion.

## 6. Detail levels, later: a level is a named set of switches

When [detail-levels.md](detail-levels.md) is built, the Servo motor needs no second diagram. A level is a named set of switch values over the one diagram:

| Level | Switches on | For |
|---|---|---|
| 1 Ideal | none | Designing and tuning |
| 2 + friction | coulomb | Position hold, reversals (the robot's default) |
| 3 + backlash | + backlash | Hunting, knocks, the load's offset |
| 4 + drive | + currentLoop or vlimit | Torque fidelity, speed limits |
| 5 + encoder | + counts, encErrors, encDelay, speedFromAngle | What the loop measures |
| 6 + ripple | + ripple, torqueNoise, coupling | The spectrogram, the torque ripple |

- `levels: [{ name, switches }]` on the component fits detail-levels' rules: ordered, named, identical ports, one parameter set, neutral values reproducing the level below.
- `shaft` is not a level. It is how the motor is connected and changes ports.
- Until levels exist, the switches are set one by one, and each example sets its own.

## 7. The uses

### 7.1 Encoder errors and torque ripple (speed-controlled, free shaft)

The example becomes r → Controller "PI speed" (reads ω measured) → Servo motor (free, no load torque) → the Sinks speed (Out 4), speed_m (Out 3) and V. Main's two first-order blocks, read as physics, are:
- armature K 1, τ 2 ms: R = 1 Ω, L = 2 mH;
- "inertia and friction" K 200, τ 0.2 s: b = 0.005 N·m·s/rad, Jm = 0.001 kg·m²;
- K = 0.1.

The switches keep their exaggerated sizes, which the person accepted for this example:
- ripple 6×, 0.05 N·m;
- torque noise σ 0.02, seed 7;
- coupling 439.8 rad/s, ζ 0.02 (69.996 Hz; the field is in rad/s so the traces do not move);
- encoder errors 1× 0.02 rad at 0.5 and 2× 0.01 rad at 1;
- speed from the angle, T_f 1 ms.

**Measured** (run as the page runs it):

| Signal | Largest difference from main | Relative |
|---|---|---|
| r | 0 | 0 |
| speed_m | 7.0·10⁻¹⁰ rad/s | 2.2·10⁻¹² |
| speed | 8.0·10⁻¹¹ rad/s | 2.6·10⁻¹³ |
| V | 2.9·10⁻¹⁰ V | 6.1·10⁻¹² |

- Same steps (5 substeps). The rms speed error is 2.181480780500966 against main's …1016 (the test's bound is 2.18149).
- **The reason, proven:** the motor owns its friction (−b·ωm into the rotor's sum) where main has it in the rotor's 1/(J·s + b). With b put back into a transfer function, the run is main's bit for bit (`why.mjs`).
- Test tolerance: 10⁻⁹ relative. The spectrogram and sampling tests are unchanged.

### 7.2 The DC motor examples (position-controlled, free shaft)

DC motor position control, Following a sine and DC motor, sliding mode use the Servo motor with every switch off: free, R 1, L 10 mH, K 0.5, b 0.1, Jm 0.02, G 1, the load torque d into In 2. **Measured** over every variant:

| System · variants | Largest relative difference | Substeps |
|---|---|---|
| DC motor, position control · all four | 2.6·10⁻¹⁶ … 7.4·10⁻¹⁵ | 1 (as main) |
| Following a sine · all four | 1.2·10⁻¹⁵ … 1.4·10⁻¹⁴ | 1 |
| DC motor, sliding mode · all three | 1.8·10⁻¹⁶ … 5.7·10⁻¹⁵ | 1 |

- The relay switches at the same samples. Test tolerance: 10⁻¹².
- The sliding-mode try-this "triple J (rotor den [0.06, 0.1])" becomes "set Jm to 0.06 on Motor's mask".

### 7.3 The PUMA's six joints (current drive, coupled, each with its own data)

"Motor drives" opens to Motor 1 … Motor 6 ([robot.md](robot.md) §4). Each is a Servo motor with `drive: current` and `shaft: coupled`: θ and ω from the arm's q_j and q̇_j, τ_j into the arm. The group's mask holds per-joint lists, and each motor's fields pick its joint (`G: "G[j]"`). The data ([research/robot.md](../research/robot.md) §3):

| Field | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| G | −62.6111 | 107.815 | −53.7063 | 76.0364 | 71.923 | 76.686 |
| Jm (kg·m²) | 200e-6 | 200e-6 | 200e-6 | 33e-6 | 33e-6 | 33e-6 |
| K (N·m/A) | 0.227 | 0.228 | 0.238 | 0.0675 | 0.0718 | 0.0534 |
| b (N·m·s/rad, motor) | 1.48e-3 | 0.817e-3 | 1.38e-3 | 71.2e-6 | 82.6e-6 | 36.7e-6 |
| Tc⁺ / Tc⁻ (N·m, motor) | 0.435 / 0.395 | 0.126 / 0.0709 | 0.105 / 0.132 | 11.2e-3 / 16.9e-3 | 9.26e-3 / 14.5e-3 | 3.96e-3 / 10.5e-3 |
| imax (A) | 8.83 | 8.77 | 8.74 | 4.42 | 4.42 | 4.49 |
| R (Ω) | 2.1 | 2.1 | 2.1 | 6.7 | 6.7 | 6.7 |
| N (counts per motor turn) | 1 000 | 800 | 1 000 | 1 000 | 1 000 | 500 |
| k, c | for 20 Hz, ζ 0.1 at the start pose's link inertia (§3) | | | | | |

**Defaults** (the person, input 23):
- Coulomb friction on (robot.md's results assume it);
- every other switch off, its fields at realistic sizes: ripple 1 % of K·imax at 6×; encoder errors 20″ (1×) and 10″ (2×) at the motor; the counts above; the current loop at 400 Hz; torque noise 0.002 N·m;
- backlash off. Its field is at 3′ (a premium gearhead, research §4), so switching it on gives a realistic play. The user exaggerates any of these if they want.

The robot's Encoder speed observer reads Out 2, the motor encoders, as on the real arm.

**Measured** on one joint: PUMA joint 2's motor, link 2.04 kg·m², rotor G²·Jm = 2.32 kg·m², gravity 35.7·cos q N·m. A position PID on θ measured gives i*, tuned for 30 rad/s with speed, acceleration and gravity fed forward. r = 0.3·sin(2π·0.5·t) rad, a 0.5 ms record, read from 1 s on. Δτ is taken against the row named in brackets.

| Case | rms τ (N·m) | rms Δτ (N·m) | peak Δτ (N·m) | rms error (mrad) | peak error (mrad) | substeps |
|---|---|---|---|---|---|---|
| rigid, Coulomb (the first design: G²·Jm on the arm) | 36.12 | – | – | 1.78 | 4.12 | 1 |
| elastic 50 Hz, Coulomb [rigid] | 35.17 | 4.96 | 8.53 | 1.83 | 4.35 | 1 |
| elastic 10 Hz, Coulomb [rigid] | 35.16 | 5.13 | 12.1 | 8.53 | 14.05 | 1 |
| **elastic 20 Hz, Coulomb (the default)** [rigid] | 35.17 | 4.99 | 8.82 | 2.82 | 6.35 | 1 |
| + backlash 3′, gravity [elastic] | 35.17 | 0.003 | 0.005 | 3.15 | 6.79 | 1 |
| + backlash 15′, gravity [elastic] | 35.17 | 0.016 | 0.024 | 4.65 | 8.53 | 1 |
| elastic, no gravity (as joint 1) | 4.40 | – | – | 1.95 | 4.43 | 1 |
| + backlash 3′, no gravity [no gravity] | 4.43 | 0.45 | 3.09 | 2.24 | 4.87 | 1 |
| + backlash 15′, no gravity [no gravity] | 4.64 | 1.37 | 9.95 | 3.71 | 6.60 | 1 |
| elastic + realistic ripple, encoder, counts, current loop, noise [elastic] | 35.17 | 0.45 | 1.82 | 2.82 | 6.38 | 3 |

- **Elastic against rigid.** At 50 Hz the path is nearly unchanged (+0.06 mrad rms). At the 20 Hz default it grows by 1 mrad, because the PID was tuned for a rigid joint and the gear now sits four times above its bandwidth; at 10 Hz it is 8.5 mrad. The design layer, designing the axis loops on the plant that runs, sees the gear (robot.md §5). The torque differs by the rotor's own acceleration torque, G²·Jm·q̈ (4.86 N·m rms expected, 4.96 measured): before, τ was the motor's torque at the output, rotor included; now it is the gear's torque on the link. The rotor's share is the motor's τm, a Sink.
- **Backlash under gravity**: the teeth stay on one flank. The torque hardly changes; the path shifts by the play the motor's encoder cannot see (the error grows by about β/2: 0.3 mrad at 3′, 1.8 at 15′).
- **Backlash without gravity** (joint 1, or the wrist): the gear crosses its play at every reversal, and the torque knocks (10 N·m peaks at 15′ on the 20 Hz gear; 25 N·m on a 50 Hz one, whose stiffer teeth hit harder). This is what "the same errors in the robot's torques" means for backlash.
- **Realistic errors** move the torque by 0.45 N·m rms and the path by 0.002 mrad. The user raises them to see more.

### 7.4 A new example: Gear backlash

The example the person asked for: "one example that exemplifies a backlash simulation".

- **System:**
  - a small motor on a current drive: R 1 Ω, L 1 mH, K 0.05, b 1e-5, Jm 2e-5 kg·m², imax 5 A;
  - a 20:1 gearhead with 1° of play (17.45 mrad), k 439 N·m/rad and c 0.28 (50 Hz, ζ 0.1);
  - a load arm of 0.01 kg·m², no gravity, on a bearing with a little friction (viscous 0.005 N·m·s/rad, Coulomb 0.02 N·m: 0.4 % of the drive's 5 N·m). Without it the load coasts freely in the play and nothing can stop it there;
  - an encoder on the load (its angle θ_L) and the motor's own (Out 2).
- **Control:** a Switch "feedback from" (load encoder · motor encoder) feeds the Controller's y; its third input is the motor's speed (Out 3, ω measured). Three variants:
  - PID (Kp 16, Ki 100, Kd 0.76, Tf 3 ms, ±5 A; for 30 rad/s);
  - PD (the same without Ki);
  - **Dual loop**, the industrial fix (state feedback, i* = Kp·(r − θ_L) − Kd·ωm/G with the PD's gains): position from the load's encoder, damping from the motor's speed. The play cannot cut the damping off, because the motor's speed is on the motor's side of the gap. Industrial drives do the same with a speed loop on the motor encoder inside a position loop on the load encoder (dual-loop feedback). A cascade variant with an inner PI speed loop is the later, fuller form (§13).
- **Reference:** r steps 0 ↔ 1 rad every 1.25 s.
- **Scope:** opens on the load error e = r − θ_L, the gear torque τ, the deflection δ (Out of the motor's Sink) and i. A view shows the motor's mark and the load arm's, the gap between them drawn.
- **XY view:** δ across, τ up, shows the play as the flat part between two springs.

**Measured** (prototype; holds = the last 0.5 s of each step):

| Case | e p-p within a hold (mrad) | largest \|e\| in holds (mrad) | τ sign changes per s | peak \|θm/G − θ_L\| (mrad) |
|---|---|---|---|---|
| PID, load encoder, no backlash | 0.65 | 0.50 | 2 | 11.0 (the spring's wind-up) |
| **PID, load encoder, backlash 1°** | **20.6** | 10.5 | 62 | 32.4 |
| PD, load encoder, backlash 1° | 20.3 | 10.2 | 62 | 30.5 |
| PID, load encoder, backlash 0.25° | 5.12 | 2.69 | 61 | 14.6 |
| PID, motor encoder, no backlash | 0.67 | 0.50 | 2 | 11.0 |
| PID, motor encoder, backlash 1° | 0.00 | 0.63 | 0 | 24.5 |
| Dual loop, no backlash | 0.00 | 0.01 | 0 | 11.0 |
| **Dual loop, backlash 1°** | **0.12** | **0.13** | 0 | 27.7 |
| Dual loop, backlash 0.25° | 0.10 | 0.11 | 0 | 15.9 |

- **Motor encoder**: no hunting, but the load is where it came to rest in the play: 0.63 mrad off here, anywhere up to β/2 = 8.7 mrad. Without the bearing's friction it was exactly β/2 (8.72 mrad), on the side it came from.
- **At 20 Hz** (k = 70 N·m/rad, the robot's default): the load-encoder PID is unstable even without play (e p-p 228 mrad), because the resonance is too close to the loop, on the far side of the spring from the motor. The motor-encoder PID and the dual loop still hold (0.46 and 0.37 mrad). A try-this, not the default: it is a resonance lesson, not a backlash one.

**The notes the example carries** (draft): "A motor turns a load arm through a gearhead with 1° of play (backlash). The Servo motor simulates it: its rotor and the load are two bodies joined by the gear's stiffness, and between the teeth there is a gap where no torque passes (open Motor: the Backlash switch, β). The controller holds the load's angle with its own encoder. Every step ends in hunting: the motor crosses the gap, knocks the load, overshoots, crosses back, and the load rattles about ±10 mrad, about 31 times a second (τ changes sign 62 times a second). Drop the integral (PD): it still hunts. That is backlash inside a loop, not bad tuning. Flip 'feedback from' to the motor encoder: the hunting stops, but the motor's encoder cannot see the play, so the load stays wherever it came to rest in it, up to half the play (8.7 mrad) away. Now pick Dual loop, the industrial fix: position from the load's encoder, damping from the motor's speed, which the play cannot cut off. The load holds to 0.13 mrad and nothing rattles. Set β to 0.25°: the hunting shrinks with it. Set β to 0: every variant settles. Press XY (δ across, τ up): the flat part is the play. Try the gear at 20 Hz (Motor's k to 70): the load-encoder PID goes unstable even without play, and the dual loop still holds."

The hunting with PD as well as PID shows it is not integral windup. In the prototype the limit cycle's frequency stayed at about 31 Hz for PD and PID alike, and its amplitude scaled with β. Its frequency comes from the gear's spring and the loop's gains (not researched further). The dual loop removes it because its damping term never passes through the gap.

## 8. What it needs (and a minimal mask first)

From [transparent-models.md](transparent-models.md) §1.4 and [detail-levels.md](detail-levels.md) §2.3 and §5:
1. **The mask**: `mask` and `params` on a subsystem, and number fields as formulas in the mask names.
2. **Field kinds `toggle` and `choice`.** A Switch's `position` may be a formula in them. This is the one exception to transparent-models' refusal of formulas in integer fields.
3. **Transfer-function coefficients as formulas** (`den: ["L", "R"]`).
4. **`inf`** (Vmax) and **`tanh`** in formula.js.
5. **Mask lists** for ripple and error orders and the PUMA's per-joint data. Until they exist: three fixed order slots each.
6. **Compile-time switches**: a Switch whose position is a constant after the mask is resolved compiles as a wire. Blocks that reach only its unselected inputs are not compiled, and Sinks fed only from there read "off".
7. **A choice that changes ports** (`shaft`): ports are derived from the resolved mask, as a Controller's from `inputs`.
8. **The eigenvalue step bound** for the coupled shaft (detail-levels §5: a finite-difference Jacobian at the start state, its largest |λ|). It is not needed for the free shaft, which today's bound handles exactly as main.

**Built** (2026-10-25, branch `feat/model-foundations`, by transparent-models.md's definitions): items 1 (masks, formula parameters, mask fields with `min` and `max`), 3 (formulas in `num` and `den`, entry by entry), 4 (`inf`; `tanh` was already a function) and 8 (the eigenvalue step bound in `el.bound`: a loop of two Integrators through Gains now bounds the step, so the coupled shaft's stand-in lag can go), and the Integrator with `x0`, `min`, `max`, `unit`, `angle`. Not built: item 2 (field kinds `toggle` and `choice`; a mask field is a number today, and an integer field, such as a Switch's `position`, refuses a formula), item 6 (compile-time switches) and item 7 (ports from the resolved mask). Those are this plan's step 1.

**A minimal mask can come first, and should.** Items 1, 2, 3, 6 and 7 are enough for the free shaft, the encoder example and the motor examples. Item 8 comes before the backlash example and the robot's motors.

## 9. A library component, and how a project stores a use

- **Built-in components** ship in the page, in `src/core/components.js`. Each is an id, a version, a mask, a diagram and, later, levels. The Servo motor is the first. The Plant tab's library lists them under **Components**.
- **My blocks** are the same thing made in a project (a group with a mask, "Make component"), stored in the project's `components` map. This page needs only the format; making them in the page is later.
- **A use is stored by reference**, never as a copy of the insides:

  ```json
  { "id": "motor", "type": "subsystem", "name": "Motor", "component": "servo-motor@1",
    "params": { "drive": "current", "imax": 5, "R": 1, "L": 0.001, "K": 0.05, "b": 1e-5, "Jm": 2e-5, "G": 20,
                "shaft": "coupled", "k": 438.6, "c": 0.2793, "backlash": 1, "beta": 0.017453 } }
  ```

  - `normalizeDiagram` resolves `component` from the built-in table (or the project's `components`) into the diagram it compiles and opens, so it stays openable.
  - Mask values left out take the component's defaults; a switch's default is off.
  - Saving writes back only `component` and `params`.
  - Opening a use shows its insides read-only, with "Edit a copy", which makes a My block (a copy in `components`, referenced the same way).
- **Versions.** A change to a built-in component that alters a result is a new version. The old version stays, so saved projects run as saved.
- [project-format.md](project-format.md) gets a `components` section (still `loop-tuner/2`).

## 10. The prototype

In [`design/prototypes/servo/`](../prototypes/servo/), built from today's primitives. The mask is emulated in JS (numbers baked in, as formulas resolve at compile time).
- `servo.mjs`: `servoMotor(id, params, { switches })` builds the component. Off effects are left out (the compile-time resolution), or built behind Switch blocks with `switches: true`.
  - `Jm > 0` puts the rotor inside, with `shaft` free or coupled.
  - `Jm = 0` is the first design (the rotor left to the mechanism), kept so the first measurements rerun.
  - The coupled gear carries the step-bound stand-in (§5).
- `encoder.mjs`, `why.mjs`, `motors.mjs`, `joint.mjs`: the first design's measurements, all reproduced with the rotor inside and a free shaft.
- `free.mjs`: §7.1 and §7.2 with the rotor inside, free shaft.
- `rotor.mjs`: the lone motors coupled to a load at 100 Hz (§2.2's "why not": up to 0.9 %, the relay 200 %, 4–5 times slower). It exports `gearFor(fr, ζ, Jr, JL)`, the k and c of §3.
- `backlash.mjs`: §7.3 (the joint, rigid against elastic, backlash, realistic errors) and §7.4 (the backlash example).

Run each with `node design/prototypes/servo/<name>.mjs` (`backlash.mjs` takes about 4 s). They change nothing in `src/`, and `npm test` does not run them.

## 11. Implementation steps (each one agent; `npm test` green after each)

0. **Record.** decisions.md (§14); this page's README row (done with this plan).
1. **The minimal mask and compile-time switches** (§8 items 1, 2, 3, 6, 7).
   - `mask` and `params` through `normalizeDiagram` and the project format; formulas (`core/formula.js`, as transparent-models step 2; whichever plan reaches it first builds it); Switch positions from toggles and choices; ports from the resolved mask; tf coefficients as formulas; `inf`, `tanh`.
   - Pruning of off branches and their Sinks.
   - The mask panel: fields, toggles folding their fields, choices; Open.
   - Tests §12.1. No library change.
2. **Components and references** (§9).
   - `src/core/components.js` with `servo-motor@1`; `component` resolved on load and saved back as a reference; refusals; read-only opening, Edit a copy.
   - The library's Components group.
   - Tests §12.2.
3. **The DC motor examples on the component** (free shaft).
   - `motorDiagram` uses it; the sliding-mode notes' try-this changes.
   - Tests §12.4 (10⁻¹² against main's recorded signals).
4. **The encoder example on the component** (free shaft, its switches).
   - Notes: "flexible coupling"; a try-this "open Motor and switch the 6× ripple off".
   - Tests §12.4 (10⁻⁹; the spectrogram and sampling tests unchanged).
5. **The eigenvalue step bound** (detail-levels §5; shared, whichever plan reaches it first).
   - Every library system's step plan is unchanged (their modes are all seen by today's bound); a two-Integrator spring loop gets its bound.
   - Tests: §12.3's step case.
6. **The coupled shaft and backlash, and the Gear backlash example** (§7.4).
   - The gear group with the dead zone; the example with its Switch, its three variants (PID, PD, Dual loop), the load's bearing friction, views, notes and XY.
   - Tests §12.3 and §12.5.
7. **The robot's Motor drives on the component** (with or after robot.md's step for motors).
   - Six coupled Servo motors with their data. The arm's armature leaves the plant's mass matrix, and the controller's model keeps it. Coulomb on, the rest off at realistic sizes; θ measured to the Encoder speed observer; the torque shares as Sinks.
   - Robot.md's numbers re-measured. With the axis loops designed on the plant that runs, expect the path closer to the rigid model than §7.3's 2.82 mrad, which used gains tuned for a rigid joint.
   - A try-this: "open Motor drives, Motor 1: switch Backlash on (3′) and watch τ1 knock at each reversal; set it to 15′".
8. **Docs sweep.** plant-editor.md, project-format.md, system-library.md (the new example), robot.md §4 (pointing here; the armature moves), detail-levels.md §7 (the motor's levels become §6's switch sets), AGENTS.md, roadmap.md.

## 12. Tests

1. **Mask and switches:**
   - formulas resolve;
   - unknown names are refused, naming the fields;
   - a toggle off removes its branch (compiled nodes, step and result bit for bit those of the diagram without it);
   - a Sink in an off branch reads "off";
   - a choice picks one branch, and `shaft` sets the ports;
   - a formula in a non-Switch integer field is still refused.
2. **Components:**
   - a use saves as `component` + `params` and reloads bit for bit;
   - unknown ids and versions are refused;
   - Edit a copy makes a My block, and the other uses are unchanged.
3. **The Servo motor's physics** (`test/servo.test.mjs`):
   - each switch at its neutral value against off, bit for bit (counts, coupling, speed-from-angle excluded; backlash β = 0 against the elastic gear);
   - each effect's signature:
     - ripple: the order line in τ's spectrum;
     - encoder errors: θ measured − θm/G equals the sum of the orders to 10⁻¹²;
     - counts: steps of 2π/(N·G);
     - Coulomb: the steady torque at ±speed;
     - current loop: i lags i* by τc;
     - voltage limit: the speed saturates at (Vmax − R·i)/K;
     - v = R·i + K·ωm;
   - the energy balance, free shaft with L = 0 and every switch off: V·i = R·i² + d/dt(½Jm·ωm²) + b·ωm² + τ_L·ω;
   - the coupled gear:
     - two-mass resonance and damping as designed (the free response of δ rings at ωr with ζ, to 1 %);
     - the energy balance including ½k·δ²;
     - with backlash, no torque while |δ + (c/k)·δ̇| < β/2, and τ never opposite to that argument's sign (no pulling);
     - the step bound sees ωr (substeps grow as k does).
4. **The examples:** each motor example and variant against main's signals recorded before step 3 (10⁻¹²); the encoder example (10⁻⁹); the spectrogram and sampling tests unchanged.
5. **Gear backlash:**
   - load feedback hunts: in every hold e p-p exceeds 0.8·β, and τ changes sign at least 20 times a second;
   - motor feedback holds still (p-p below 1 mrad) with the load off by β/2 within 5 %;
   - the dual loop holds (p-p below 0.5 mrad, no sign changes in the holds) with 1° of play, and at 20 Hz;
   - β = 0 settles every variant;
   - the hunting amplitude scales with β (0.25° gives about a quarter).
6. **The robot:**
   - switches off and a stiff gear against the rigid reference;
   - with ripple on, the 6·G line in τ_j's spectrum;
   - with backlash and no gravity, the knock at each reversal.

## 13. Not built (and why)

- **A cascade Dual loop** (an inner PI speed loop on the motor encoder, an outer P position loop on the load encoder, as industrial drives run it): it needs a Controller variant with an inner loop or two Controllers in series. The state-feedback Dual loop shows the same fix with today's types.
- **Stiction and Stribeck** need a stick state (Modelica's BearingFriction has one; Simscape smooths, research §4). The tanh smoothing's validity sentence from robot.md applies.
- **A PI current loop over the R–L armature** (`drive: current, PI`): about 0.25 ms steps on the PUMA. Later, for voltage limits in fast moves.
- **The wrist's coupled gears** (motor 6 turns with joint 5): one Servo motor per joint, as Corke's toolbox. Stated in Motor drives' validity sentence.
- **Backlash as a hard stop with restitution** (Simscape Driveline's ideal Backlash, research §4): a stiff contact here instead. Its stiffness k sets the impact's duration, and the run resolves it.
- **PMSM effects** (sensor offset at p, gain mismatch at 2p, flux ripple at 6p): a second component, or a later `motor` choice.
- **Mask lists**: fixed slots until then.
- **Making and editing components in the page**: JSON and the built-in table first.
- **Thermal effects**: no example needs them.

## 14. Interpretations (for the decision log)

- **One component, Servo motor**: the motor, its drive, its rotor, its gear and its encoder. The rotor's inertia is inside, as the person said. The load is outside.
- **Two shafts, one physics**: free (a load torque, a lone motor) and coupled (an inertia through the elastic gear). Interpretation: a lone motor needs no spring, and coupling it costs accuracy and speed for nothing (measured, §2.2). The choice is how it is connected, not a level.
- **The robot's armature moves into the motors**: the arm's plant mass matrix loses G²·Jm, and the controller's model keeps it. Interpretation: the controller should still model the rotor it drives.
- **Non-problematic stiffness**: on the robot 20 Hz with ζ 0.1, below a 100 Hz HIL cycle's Nyquist frequency (the person's "make it a bit slower", input 24) and four times the axis loops' bandwidth. The backlash example's gear stays at 50 Hz so that its hunting is the play's alone (it is not a HIL plant). Both are configurable through k and c. Interpretation: "slower" is the resonance, "configurable" is k and c on the mask. Backlash starts off, at 0 in examples where it is not the subject, and at 3′ (off) in the robot's fields.
- **Error sizes**: exaggerated only in the encoder example; realistic, and off except Coulomb, in the robot (the person: "The user can do this by themselves").
- **The backlash example's fix is a variant**, Dual loop (load position, motor speed), as the person asked. Its load gets a little bearing friction, without which no loop can stop a load inside the play.
- **Backlash** is a switch of the coupled shaft, modelled as a spring and damper in contact and nothing in the gap, without pulling, from one Function block. The Gear backlash example shows it; its notes say the Servo motor simulates it.
- **"High detail toggles"** are switches on the mask, each with fields kept while off. Off is exact because it is not compiled; on with the neutral value is exact where one exists.
- **"Speed controlled"** is which output the loop reads.
- **Encoder example tolerance**: 10⁻⁹ relative, because the motor owns its friction (the cause shown by `why.mjs`).
- **A use is a reference plus mask values**, opened read-only, with Edit a copy into My blocks; built-in components are versioned.

## Open questions

None open with the person now. The person asked (input 24) that questions go through the cloud coordinator, not to them directly: later questions from this design go to the coordinator, which asks the person.

For the coordinator to weigh (interpretations, not blocking):
- At the robot's 20 Hz default, axis loops tuned as if rigid lose 1 mrad of path accuracy (§7.3). That is acceptable if the design layer designs the axis loops on the elastic plant; otherwise raise the default.

## 15. Built, measured, deviations

Built on `feat/servo` (2026-10-25), from main after the model foundations (masks, formulas, the eigenvalue step bound). `npm test`, `npm run test:slow` and `node build.mjs` were green at every commit.

### 15.1 What is built

- **Mask kinds** (`core/diagram.js`): a mask field may be `kind: 'toggle'` (0 or 1) or `kind: 'choice'` with `options` (its 1-based index in formulas), and `under` a toggle (`"coulomb"`) or a choice's option (`"shaft:coupled"`). A Switch's `position` and a Noise block's `seed` take formulas (`maskable` fields; the result must be a whole number); every other integer field still refuses one.
- **Compile-time switches**: a Switch whose position is a formula is a wire once the mask is resolved; what reaches only its other inputs is not compiled (no state, no step bound, not evaluated), and Sinks fed only from there are off: not recorded, listed in `el.off` and a run's `info.off`. The canvas draws what is not compiled faint (`el.offNodes`).
- **Ports from the mask**: an In or Out block may carry `when` (a formula; 0 removes the port). The Servo motor's In 3 has `when: "shaft - 1"`.
- **Components** (`core/components.js`): `servo-motor@1`, the mask of §3 and §4 (three fixed slots for ripple orders and error orders, for want of mask lists) and the diagram of §1, 72 blocks. A use is `{ type: 'subsystem', component, params }`; `normalizeDiagram` puts the mask and insides in; `JSON.stringify` writes the reference and the values that differ from the defaults (`toJSON`); `prefix` renames a use's Sinks. The Plant tab lists it under **Components**, shows toggles as keys carrying their labels and choices as lists, folds the fields under them, opens the insides read-only (an edit inside says so) and offers **Edit a copy**.
- **The examples**: the three DC motor systems (`motorDiagram`, `DC_MOTOR`) and main's observer example *DC motor, speed from an encoder* (merged in after it was built on main's motor), the encoder example (`ENCODER_MOTOR`) and the new **Gear backlash**, with summary and notes per the progressive-disclosure rule ([system-library.md](system-library.md)).
- **The HIL simulator** (`core/hilsim.js`): a system's effects are the toggles that are on in its masks (`effectsOf`), named by their labels, off by setting the toggle to 0; it reads through a Switch a mask set; Sinks that are off are no outputs; outputs the input reaches without a state between are named (`spec.direct`). The encoder's effects are now *Torque ripple and cogging, Torque noise, Encoder coupling resonance, Encoder angle errors, Speed from the angle* (they were *torque ripple, torque noise, shaft resonance, encoder errors*); its varied physics are R, L, K, b, J, ωc, ζc (they were 1/R, L/R, Kt, Ke, 1/b, J/b, ωn, ζ), so its draws for a seed differ from main's.
- **Tests**: `test/switches.test.mjs` (§12.1), `test/servo.test.mjs` (§12.2–12.5), the legacy builders in `test/fixtures/legacy-motors.mjs`.

### 15.2 Measured

| Example · variants | Largest difference from main, relative to the signal's peak | Substeps (main) |
|---|---|---|
| DC motor, position control · all four | 1.6·10⁻¹⁶ … 3.6·10⁻¹⁵ | 1 (1) |
| Following a sine · all four | 1.0·10⁻¹⁵ … 2.6·10⁻¹⁴ | 1 (1) |
| DC motor, sliding mode · all three | 2.0·10⁻¹⁶ … 4.9·10⁻¹⁵ | 1 (1) |
| Encoder errors and torque ripple · PI speed, Off | 8.5·10⁻¹², 2.5·10⁻¹⁴ | 5 (5) |
| DC motor, speed from an encoder (main's observer example, merged in later) · all three | 2.0·10⁻¹⁶ … 8.0·10⁻¹⁵; its Luenberger and Kalman designs the same | 1 (1) |

- Tests hold the motors to 10⁻¹² and the encoder to 10⁻⁹ (§7.1's reason: the motor owns its friction).
- **Fingerprints** (`test/fixtures/library-fingerprints.json`): only these four change (the rounding above, and the motor's Sinks i, τe, τm, τf, τr, v join the signals), and Gear backlash is new; every other system is bit for bit.
- **The design layer** designs the motor examples as before: the Analysis tab's numbers at rest for every variant of the four systems (stable, gain margins, phase margin, crossover, Ms, Mt, ζmin, the slowest pole, the plant's order; the PID + feedforward's computed Kv 1.7 and plant inverse [0, 0.7, 0.042]) are identical to six digits before and after.
- **Each switch at its neutral value** is the switch off, bit for bit: Coulomb Tc± 0, ripple amplitudes 0, torque noise σ 0, supply limit Vmax inf, encoder errors 0, delay T_d 0, current loop τc 0, backlash β 0. The effects' signatures, the free shaft's energy balance, the gear's resonance (to 1 %) and energy, and backlash never pulling are tested.
- **Gear backlash** (holds: the last half second of each step; 0.5 ms record, 1 substep):

| Case | e p-p in a hold (mrad) | largest \|e\| (mrad) | τ sign changes per s |
|---|---|---|---|
| PID, load encoder | 20.58 | 10.45 | 62 |
| PD, load encoder | 20.34 | 10.17 | 62 |
| PID, motor encoder | 0.00 | 0.63 | 0 |
| PD, motor encoder | 0.00 | 4.66 | 0 |
| Dual loop, load encoder | 0.12 | 0.13 | 0 |
| Dual loop, β at a quarter | about a quarter of PID's p-p (tested) | | |

  The prototype's numbers (§7.4), to the digits shown.
- **Runs** take longer: the motor examples 8–13 ms against main's 4–14 ms per 5 s run in Node (more nodes: the mask's zero gains and sums, five more Sinks recorded); the encoder 61 against 43 ms.
- **Checked in Chromium** (headless, 1440 × 900): the encoder example opens on its spectrogram as before; selecting Motor shows its mask (Drive, R … G, Output shaft, the toggles); switching Coulomb on unfolds Tcp, Tcn, ωs and the face reads "voltage drive, free shaft · Coulomb friction"; opening Motor shows its insides with what is off faint, read-only; Gear backlash hunts on the scope (δ, τ and i rattle at about 31 Hz after each step) and the Dual loop holds; no console errors.

### 15.3 Deviations from this plan, and interpretations

- **Sink names**: τf and τr are `tau_f` and `tau_r` (a signal name has at most 12 characters, and a prefixed `m2_tau_friction` would not fit). Interpretation.
- **Per-instance names**: a use's `prefix` (`m2_` makes `m2_i`), not the path ("Motor 2/i", §5): a name with `/` cannot be read in a view's text or a formula. Interpretation.
- **v**, the drive's voltage, is a Sink in both drives: for a current drive R·i + K·ωm (§2.3), for a voltage drive the voltage applied (u after the supply limit). A Sink fed only from the current branch could not be told apart, structurally, from the encoder's output, which the same rule would have switched off; a drive Switch in front of v makes it exact. Interpretation.
- **τr** (ripple and noise) reads 0 when both are off, rather than off: its zero Gain stays compiled (it feeds the torque sum). A Gain of 0 depends on nothing in a model (`model.f` and the structural reduction), so the rotor's angle no longer joins a speed model through it.
- **The mask panel**: a number field is named by its key (what formulas read), its label, unit and range below; a toggle is a key carrying its label ("Coulomb friction: on"); fields under an off toggle or another option are folded away (hidden), not greyed. Interpretation (the labels did not fit the panel's label column).
- **Edit a copy** makes the use the project's own masked subsystem, inline; the project's `components` map (My blocks used by reference) is not built (§13 left making components in the page for later). The library's `My blocks` group keeps saving subsystems whole.
- **Faint, not labelled**: what is not compiled is drawn faint; a separate "off" label is not drawn.
- **No stand-in lag** for the coupled shaft's step: the eigenvalue step bound (main) sees the gear (the coupled shaft's tests check that a stiffer gear takes more substeps).
- **Fixed order slots**: three for ripple (`kr1, Ar1, pr1` …) and three for encoder errors (`ke1, Ae1, pe1` …), until mask lists exist.
- **The controller's input names**: a Controller reading a Servo motor names the input by its Out block, "θ measured", where it read "angle" (the old Integrator's name); a design names u after the outermost Sink on it (V, not the motor's v).
- **State feedback's tag is blue** (it was slate, which main gave Deadbeat while State feedback was on no card): the Dual loop puts it back on a card, and blue is the one tone no controller tag has.
- **DC motor, deadbeat** (main's, merged in later) keeps the Transfer function motor (`motorBlock`): its controller measures the current, which the Servo motor has as a Sink, not an Out.
- **The library's tags** ignore what a mask switched off and the Switches a mask sets (the Servo motor's Dead time, Saturation and Switch blocks would otherwise tag every motor Nonlinear with a Dead time).
- **The HIL simulator's sample-for-sample test** leaves out the outputs the input reaches without a state between (Gear backlash's i, τe, τm, v on an ideal current drive): the plant reports them with the input of the cycle that ended, the page records them after the new one, so no record of the page is that value.
- **Gear backlash**: the error Sink is `e_L` (a view's text reads `e` as Euler's number); the scope opens on δ, τ, e_L, i (so XY is δ across, τ up); a Sink `omega_m` records the motor's speed (the HIL simulator needs a Sink on each measurement), and `i_ref` the controller's i*. At rest the teeth are in the play, so the linearised loop for PID and PD sees no gear (the Analysis tab draws no margins for them); the Dual loop's reads the motor's speed and analyses (phase margin 88°).
- **The guard on stored gains** allows the Dual loop (state feedback holding a PD's hand gains) beside `pid`, `off`, `slidingMode`, `superTwisting`.
- **A variant made in code** (Auto-tune's step test) keeps its law through the mask's resolution; the model compile reads the diagram as given (an Equations block in a mask kept its names only so).

### 15.4 Left

- The PUMA on the coupled shaft (§15.6): its axis loops cannot be designed through it yet.
- *DC motor with an unbalanced arm* (the HIL simulator's default plant, with Coulomb friction and gravity) and *Variable gain against anti-windup* (a torque-driven axis) keep their own motor blocks: neither was in this plan; both could be Servo motors (a voltage drive with Coulomb on and the arm's gravity outside; a current drive with the current loop as the torque drive's lag).
- Detail levels as named switch sets (§6), when [detail-levels.md](detail-levels.md) is built.
- The project's `components` map and making components in the page; mask lists; a "set from fr, ζ" helper; the cascade dual loop (§13).

### 15.5 The PUMA's joints (step 7): how they switch

`feat/puma` builds *Motor drives* from six masked subsystems `m1 … m6` (`motor(j)` in `src/core/pumasystem.js`): In i*, In q̇; a current limit, kt, Coulomb and viscous friction from the block `friction` on G·q̇, τ = G·(kt·i − τf); its rotor's G²·Jm on the Arm's mass matrix (`armature: PUMA560.armature`). To use the Servo motor instead (§7.3):

1. **Each motor** becomes `componentUse('servo-motor@1', { id: 'm' + n, name: 'Motor ' + n, prefix: 'm' + n + '_', params })` with `drive: 'current'`, `shaft: 'coupled'`, `R`, `K` (= kt), `b` (= B), `Jm`, `G` (with its sign), `imax` from `PUMA560.drive`, `coulomb: 1` with `Tcp`, `Tcn`, `ws`, and `k`, `c` for 20 Hz with ζ 0.1 at the start pose: with J_L = M(q0)_jj of the arm **without** the armature and Jr = G²·Jm, k = ωr²/(1/Jr + 1/J_L) and c = 2ζ·ωr/(1/Jr + 1/J_L), ωr = 2π·20 (§3; typed once as inputs, the formula in a comment). Every other switch off, its fields at the realistic sizes of §7.3 (ripple 1 % of K·imax at 6×, errors 20″ and 10″, the counts of §7.3, the current loop at 400 Hz, torque noise 0.002 N·m, backlash 3′).
2. **Its ports**: In 1 i* (from `di:j`), In 2 the joint angle q_j, In 3 q̇_j (from a demux of the Arm's q, Out 1, and of q̇, Out 2); Out 1 τ_j into the mux. *Motor drives* gains an input q (the Arm's Out 1, wired `arm` → `drives:2`).
3. **The Arm's plant mass matrix loses the armature**: `massMatrix` and `torqueSplit` in the Arm take `armature` 0 (the rotors are inside the motors now); the controller's `inverseDynamics` keeps `PUMA560.armature` (§2.2).
4. **Signals**: the currents become `m1_i … m6_i` (the scope's channel 4 `i2` becomes `m2_i`), the friction `m1_tau_f …` at the motor shaft (×G at the joint, where `tauF1 …` were); τe, τm, δ per motor too. The joint torque `tau` is the gears' torque on the links, which no longer includes the rotors' acceleration torque (§7.3: about 4.9 N·m rms on joint 2).
5. **Measured, then**: robot.md's numbers again; with the axis loops designed on the plant that runs, the path should come closer to the rigid model than §7.3's 2.82 mrad. A try-this for the notes: "open Motor drives, select Motor 1: switch Backlash on (3′) and watch τ1 knock at each reversal; set β to 15′".
6. **The HIL simulator** then lists the six motors' Coulomb toggles as the PUMA's effects (`effectsOf`, "Coulomb friction" six times; a name per motor needs the use's name in the effect's name, a one-line change in `effectsOf` if wanted).

### 15.6 The PUMA's joints, built (step 7)

Built after `feat/puma` landed (main 6bd3852), on `feat/servo` restarted from it.

- **The six motors are Servo motors** (`motor(j)` in `src/core/pumasystem.js`): `componentUse('servo-motor@1', { prefix: 'm' + n + '_' })` on a current drive, R, K (kt), b, Jm, G (with its sign), imax from the drive table, **Coulomb friction on**, every other effect off at the realistic sizes of §7.3 (ripple 1 % of kt·imax at 6×; errors 20″ and 10″; counts 1000, 800, 1000, 1000, 1000, 500; the current loop at 400 Hz; noise 0.002 N·m, seed 7 + j; backlash 3′; k and c for 20 Hz with ζ 0.1 at the start pose, `PUMA_GEAR`).
- **A third shaft, rigid** (`shaft: 'rigid'`, servo-motor@1's third option, no new version: the two others are unchanged bit for bit): the rotor turns with the joint, θm = G·q and ωm = G·q̇ come in, τ = G·τm goes out, and the rotor's inertia G²·Jm stays on the Arm's mass matrix. **Interpretation**: §15.5 planned the coupled shaft, but the gate was "every effect off matches today's run to rounding", which an elastic gear cannot (it is a different plant: the prototype measured +1 mrad on one joint, §7.3); and the coupled shaft cannot run on the PUMA yet (below). So the PUMA's motors are rigid, and the elastic gear stays a choice for when the design layer can design through it.
- **The controller reads the motors' encoders** (PUMA 560's new Out 2, *q measured*: each motor's θ measured, muxed), as on the real arm; the tool's pose and the 3D view read the arm's true q (Out 1). So an encoder's error moves the tool.
- **Signals**: the currents are `m1_i … m6_i` (they were `i1 … i6`), the friction at the motor shaft `m1_tau_f …` (×G at the joint; `tauF1 …` at the joint before); each motor also has `_tau_e`, `_tau_m`, `_tau_r`, `_v`. The scope's channels (e_a, e_b, τ2, τ3) and the view's bindings (q, the paths) are unchanged.
- **Every effect off equals the run before the swap**, over the 10 s period at 1 ms: the path error within 5.5·10⁻¹³ mm (rms 0.0165522 mm both), the joint torques within 7.2·10⁻¹¹ N·m (relative 1.8·10⁻¹¹), the currents within 4.7·10⁻¹² A, the joint angles within 9·10⁻¹⁶ rad; the same step (1 substep). `test/puma.test.mjs` still holds the compiled PUMA to the loop written plainly (10⁻¹²) and to three periods alike. Every other library system runs bit for bit; the PUMA's fingerprint changes (its new Sinks and the rounding).
- **The effects show in the robot** (the person, input 18: "increase the level of the servos of the robot, and then the same errors would show up in the robot too"); path error e rms (mm) and τ2, τ3 rms (N·m) over the period, 0.0166, 33.68, 5.30 with every effect off:

| Switched on (realistic size unless said) | e rms | e peak | τ2 rms | τ3 rms | substeps |
|---|---|---|---|---|---|
| Ripple, Motor 2 | 0.0538 | 0.224 | 33.71 | 5.30 | 1 |
| Ripple, Motor 1 | 0.0394 | 0.162 | 33.68 | 5.30 | 1 |
| Ripple, all six | 0.101 | 0.484 | 33.71 | 5.34 | 1 |
| Ripple, all six, 10 % | 1.05 | 3.86 | 35.93 | 8.42 | 1 |
| Encoder counts, Motor 2, N 100 | 0.0339 | 0.143 | 76.44 | 5.37 | 1 |
| Encoder counts, all six | 0.0174 | 0.0442 | 34.70 | 6.15 | 1 |
| Encoder angle errors, all six | 0.0167 | 0.0370 | 33.68 | 5.30 | 1 |
| Encoder angle errors, all six, ×10 | 0.0218 | 0.0446 | 33.68 | 5.30 | 1 |
| Torque noise, all six | 0.0203 | 0.0455 | 33.68 | 5.30 | 1 |
| Current loop (400 Hz), all six | 0.264 | 1.49 | 33.69 | 5.30 | 6 |

  The encoder's angle errors are small at the joint: they are per motor turn, divided by the gear (60 to 108). The notes carry the try-this (ripple and counts on Motor 2), not a variant: the motors are opened and switched, which is the point. `test/servo.test.mjs` holds the ripple and counts rows to their effect.
- **What the swap needed elsewhere**:
  - **The vector width pass forces one decision at a time** (`vectors.js`), a block with state before an In port nothing feeds a width to yet, and a Finite difference observer last: forcing all at once fixed the controller's input q to 1 element before the encoders' Mux gave it 6. Every other system is bit for bit.
  - **A finite difference looks through a sensor** (`diagram.js`, `sensed`): a measurement read through Gains whose product is 1, quantizers, noise and one-input Equations stands for the state it measures, as a design on the nominal plant takes it (θ measured = (G·q)/G, with its counts and errors). A dead time or a resonance still does not.
  - **speedPI's b behind a lag** (`design.js`): with the current loop on, ẏ does not move with u at the instant; b is then taken through the lags u drives, Σ A_sj·B_j/(−A_jj), the gain well below the lag's corner (without it the design refused and the arm fell).
- **The coupled shaft on the PUMA**: switched on (the Arm's armature 0), the axis servos' design refuses ("ẏ is no state of the plant this lane sees") and the arm falls. The encoder reads θm/G of the rotor's own angle, a state times 1/G, and the look-through carries no scale; and the speed loops would be designed on the rotor's inertia alone, through a 20 Hz spring (the wrist's links, 0.0015 kg·m² against a rotor's 0.19 at the joint, sit on springs of 2–26 N·m/rad). Left: a scaled look-through and speed loops designed on the elastic joint (the plant that runs).

