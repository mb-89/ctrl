# One Servo motor, its errors as switches

Reader: the agent who builds the Servo motor component, rebuilds the motor examples or the PUMA's motors on it, builds the backlash example, or adds an effect to it. The person's words are in [input 18](../input/2026-10-25-18-servo-motor-detail.md) and their answers in [input 20](../input/2026-10-25-20-servo-answers-backlash.md); the research, with sources, is in [../research/servo.md](../research/servo.md). This is the plan, not yet built. Where the code and this page differ later, the code and [decisions.md](decisions.md) win.

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
  - the gear's stiffness starts non-problematic (its resonance about ten times above the loop's bandwidth);
  - backlash starts off, at 0.
- **A new example, Gear backlash**: a small motor on a current drive turns a load arm through a 20:1 gearhead with 1° of play, and the position loop reads the load's encoder. The loop hunts: the load rattles in the play at about 31 Hz, ±10.7 mrad, whatever the gains. Read the motor's encoder instead and the hunting stops, but the load sits half the play away from where it should, 8.72 mrad (β/2 = 8.73). Its notes say that the Servo motor simulates backlash, and how (§7.4).
- **Measured on a prototype from today's primitives** (§10):
  - the DC motor examples (free shaft, rotor inside) reproduce main to 1.4·10⁻¹⁴ relative;
  - the encoder example reproduces main to 6.1·10⁻¹², because the motor now owns its friction (shown exact when it is put back);
  - on a PUMA joint 2 with an elastic gear at 50 Hz, the path error barely changes (1.78 → 1.83 mrad rms). The joint torque now leaves out the rotor's own acceleration torque (4.9 N·m rms, which was inside before). Backlash under gravity only shifts the path (+1.3 mrad at 15′); without gravity it knocks: torque spikes of up to 25 N·m.
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

That gives 50 Hz on the PUMA joints (k = 1.07·10⁵ N·m/rad, c = 68 N·m·s/rad on joint 2) and 50 Hz in the backlash example (k = 439 N·m/rad, c = 0.28). These are inputs typed once: the formula is how the values were chosen, written in the example's comment, not something the page computes. The person lowers k to see the resonance.

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
| k, c | for 50 Hz, ζ 0.1 at the start pose's link inertia (§3) | | | | | |

**Defaults** (the person, input 20):
- Coulomb friction on (robot.md's results assume it);
- every other switch off, its fields at realistic sizes: ripple 1 % of K·imax at 6×; encoder errors 20″ (1×) and 10″ (2×) at the motor; the counts above; the current loop at 400 Hz; torque noise 0.002 N·m;
- backlash off. Its field is at 3′ (a premium gearhead, research §4), so switching it on gives a realistic play. The user exaggerates any of these if they want.

The robot's Encoder speed observer reads Out 2, the motor encoders, as on the real arm.

**Measured** on one joint: PUMA joint 2's motor, link 2.04 kg·m², rotor G²·Jm = 2.32 kg·m², gravity 35.7·cos q N·m. A position PID on θ measured gives i*, tuned for 30 rad/s with speed, acceleration and gravity fed forward. r = 0.3·sin(2π·0.5·t) rad, a 0.5 ms record, read from 1 s on. Δτ is taken against the row named in brackets.

| Case | rms τ (N·m) | rms Δτ (N·m) | peak Δτ (N·m) | rms error (mrad) | peak error (mrad) | substeps |
|---|---|---|---|---|---|---|
| rigid, Coulomb (the first design: G²·Jm on the arm) | 36.12 | – | – | 1.78 | 4.12 | 1 |
| **elastic 50 Hz, Coulomb (the default)** [rigid] | 35.17 | 4.96 | 8.53 | 1.83 | 4.35 | 1 |
| + backlash 3′, gravity [elastic] | 35.17 | 0.003 | 0.005 | 1.96 | 4.79 | 1 |
| + backlash 15′, gravity [elastic] | 35.17 | 0.016 | 0.024 | 3.09 | 6.53 | 1 |
| elastic, no gravity (as joint 1) | 4.36 | – | – | 1.80 | 4.11 | 1 |
| + backlash 3′, no gravity [no gravity] | 4.42 | 0.71 | 8.40 | 2.08 | 4.54 | 1 |
| + backlash 15′, no gravity [no gravity] | 4.84 | 2.03 | 25.3 | 3.52 | 6.28 | 1 |
| elastic + realistic ripple, encoder, counts, current loop, noise [elastic] | 35.19 | 1.24 | 4.31 | 1.84 | 4.37 | 3 |

- **Elastic against rigid.** The path is nearly unchanged (+0.06 mrad rms). The torque differs by the rotor's own acceleration torque, G²·Jm·q̈ (4.86 N·m rms expected, 4.96 measured): before, τ was the motor's torque at the output, rotor included; now it is the gear's torque on the link. The rotor's share is the motor's τm, a Sink.
- **Backlash under gravity**: the teeth stay on one flank. The torque hardly changes; the path shifts by the play the motor's encoder cannot see (the error grows by about β/2: 0.4 mrad at 3′, 2.2 at 15′).
- **Backlash without gravity** (joint 1, or the wrist): the gear crosses its play at every reversal, and the torque knocks (25 N·m peaks at 15′). This is what "the same errors in the robot's torques" means for backlash.
- **Realistic errors** move the torque by 1.2 N·m rms and the path by 0.01 mrad. The user raises them to see more.

### 7.4 A new example: Gear backlash

The example the person asked for: "one example that exemplifies a backlash simulation".

- **System:**
  - a small motor on a current drive: R 1 Ω, L 1 mH, K 0.05, b 1e-5, Jm 2e-5 kg·m², imax 5 A;
  - a 20:1 gearhead with 1° of play (17.45 mrad), k 439 N·m/rad and c 0.28 (50 Hz, ζ 0.1);
  - a load arm of 0.01 kg·m², no gravity;
  - an encoder on the load (its angle θ_L) and the motor's own (Out 2).
- **Control:** a Switch "feedback from" (load encoder · motor encoder) feeds a Controller: PID (Kp 16, Ki 100, Kd 0.76, Tf 3 ms, ±5 A; for 30 rad/s), and PD (the same without Ki).
- **Reference:** r steps 0 ↔ 1 rad every 1.25 s.
- **Scope:** opens on the load error e = r − θ_L, the gear torque τ, the deflection δ (Out of the motor's Sink) and i. A view shows the motor's mark and the load arm's, the gap between them drawn.
- **XY view:** δ across, τ up, shows the play as the flat part between two springs.

**Measured** (prototype; holds = the last 0.5 s of each step):

| Case | e p-p within a hold (mrad) | largest \|e\| in holds (mrad) | τ sign changes per s | peak \|θm/G − θ_L\| (mrad) |
|---|---|---|---|---|
| PID, load encoder, no backlash | 0.41 | 0.41 | 0 | 10.9 (the spring's wind-up) |
| **PID, load encoder, backlash 1°** | **21.0** | 10.7 | 63 | 32.7 |
| PD, load encoder, backlash 1° | 20.7 | 10.3 | 62 | 32.5 |
| PID, motor encoder, no backlash | 0.40 | 0.40 | 0 | 10.9 |
| **PID, motor encoder, backlash 1°** | 0.41 | **8.72** | 0 | 27.7 |
| PID, load encoder, backlash 0.25° | 5.49 | 2.91 | 62 | 15.3 |

**The notes the example carries** (draft): "A motor turns a load arm through a gearhead with 1° of play (backlash). The Servo motor simulates it: its rotor and the load are two bodies joined by the gear's stiffness, and between the teeth there is a gap where no torque passes (open Motor: the Backlash switch, β). The controller holds the load's angle with its own encoder. Every step ends in hunting: the motor crosses the gap, knocks the load, overshoots, crosses back, and the load rattles about ±11 mrad, about 31 times a second (τ changes sign 63 times a second). Lower the gains or drop the integral (PD): it still hunts. That is backlash inside a loop, not bad tuning. Flip 'feedback from' to the motor encoder: the hunting stops, but the load now sits half the play away from where it should, 8.7 mrad (β/2), on the side it came from. Set β to 0.25°: the hunting shrinks with it. Set β to 0: both encoders agree. Press XY (δ across, τ up): the flat part is the play."

The hunting with PD as well as PID shows it is not integral windup. In the prototype the limit cycle's frequency stayed at about 31 Hz for PD and PID alike, and its amplitude scaled with β. Its frequency comes from the gear's spring and the loop's gains (not researched further).

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
   - The gear group with the dead zone; the example with its Switch, variants, views, notes and XY.
   - Tests §12.3 and §12.5.
7. **The robot's Motor drives on the component** (with or after robot.md's step for motors).
   - Six coupled Servo motors with their data. The arm's armature leaves the plant's mass matrix, and the controller's model keeps it. Coulomb on, the rest off at realistic sizes; θ measured to the Encoder speed observer; the torque shares as Sinks.
   - Robot.md's numbers re-measured; expect the path within about 0.1 mrad of the rigid model at 50 Hz (§7.3).
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
   - β = 0 settles both;
   - the hunting amplitude scales with β (0.25° gives about a quarter).
6. **The robot:**
   - switches off and a stiff gear against the rigid reference;
   - with ripple on, the 6·G line in τ_j's spectrum;
   - with backlash and no gravity, the knock at each reversal.

## 13. Not built (and why)

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
- **Non-problematic stiffness**: the two-mass resonance about ten times above the loop's bandwidth with ζ 0.1 (50 Hz on the PUMA and in the backlash example). Backlash starts off, at 0 in examples where it is not the subject, and at 3′ (off) in the robot's fields.
- **Error sizes**: exaggerated only in the encoder example; realistic, and off except Coulomb, in the robot (the person: "The user can do this by themselves").
- **Backlash** is a switch of the coupled shaft, modelled as a spring and damper in contact and nothing in the gap, without pulling, from one Function block. The Gear backlash example shows it; its notes say the Servo motor simulates it.
- **"High detail toggles"** are switches on the mask, each with fields kept while off. Off is exact because it is not compiled; on with the neutral value is exact where one exists.
- **"Speed controlled"** is which output the loop reads.
- **Encoder example tolerance**: 10⁻⁹ relative, because the motor owns its friction (the cause shown by `why.mjs`).
- **A use is a reference plus mask values**, opened read-only, with Edit a copy into My blocks; built-in components are versioned.

## Open questions for the person

1. **The backlash example's controller**: it hunts with PID and PD alike on the load encoder. Should it also offer a fix as a variant (a dual-loop: speed from the motor encoder, position from the load encoder, which is the industrial answer), or leave the fix as a try-this (switch to the motor encoder)?
2. **The PUMA's gear stiffness**: 50 Hz is a "non-problematic" choice, not a measured one. Robot joints with harmonic drives resonate at about 10–30 Hz (research §3); the PUMA's spur gears were not measured in the sources we have. Keep 50 Hz, or start the robot lower and let the loops show it?
