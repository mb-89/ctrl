# One Servo motor, its errors as switches

Reader: the agent who builds the Servo motor component, rebuilds the motor examples or the PUMA's motors on it, or adds an effect to it. The person's words are in [input 18](../input/2026-10-25-18-servo-motor-detail.md); the research, with sources, is in [../research/servo.md](../research/servo.md). This is the plan, not yet built. Where the code and this page differ later, the code and [decisions.md](decisions.md) win.

The person: "make them high detail toggles in our servo motor ... the servo motor can also run speed controlled ... we show them in the spectrogram thing, but we could also just increase the level of the servos of the robot, and then the same errors would show up in the robot too ... it would also be reuse."

## 0. Bottom line

**One built-in component, Servo motor: a subsystem of primitives with a mask, used by every motor in the library.** It is the drive, the torque the motor makes, its friction and ripple, the gear and the encoder. The inertia it turns is not part of it. That belongs to whatever integrates the mechanism: a plain Shaft for a lone motor, the arm's M(q) for the PUMA. Its mechanical side is **motion in, torque out**: the output shaft's θ and ω come in, and the torque τ at the output shaft goes out. That is the one form that fits a lone motor and a robot joint without duplicating any physics (§2.2).

- **Ports.** In u (the command: V for a voltage drive, A for a current drive), θ and ω. Out τ, θ measured and ω measured. Inside are Sinks for the current i, the motor-shaft torque τm and, for a current drive, the voltage v the drive needs.
- **Uses.** *Speed control*, *position control* and *torque control* are not modes of the motor. They are which output the loop reads (ω measured, or θ measured) and what it commands. *Voltage or current drive* is a mask choice, resolved when the system compiles.
- **Every non-ideality is a switch on the mask, with its own parameters:**
  - Coulomb friction;
  - torque ripple and cogging (orders per motor turn);
  - torque noise;
  - the current loop's lag;
  - the supply's voltage limit;
  - the encoder's coupling resonance, angle errors (1×, 2×, …), counts and delay;
  - speed measured from the angle.

  A switch that is off is not compiled at all, so the plain motor is exactly the plain motor. A switch that is on, with its size at the neutral value (an amplitude of 0, a lag of 0, a limit of ∞), gives the same run bit for bit, as SPICE's added parameters do. Effects without a representable neutral value (counts, a resonance, a filtered derivative) are exact through their switch alone.
- **Detail levels later** are named sets of these switches: "Ideal", "+ friction", "+ drive", "+ encoder", "+ ripple" (§6). No levels machinery is needed now.
- **Measured on a prototype built from today's primitives** (§10):
  - The encoder example rebuilt reproduces main's traces to 2.2·10⁻¹² relative (7·10⁻¹⁰ rad/s of 311 rad/s), with the same steps and the same rms speed error to 13 digits. The reason is known exactly: the friction moved from the rotor's transfer function into the motor. With it put back, the run is bit for bit.
  - The DC motor examples (position, following a sine, the three sliding-mode laws) agree to 1.4·10⁻¹⁴ relative or better; even the relay switches at the same samples.
  - On a PUMA joint 2 (geared 107.8:1, current drive, gravity), raising all switches moves the joint torque by 2.7 N·m rms and 11.8 N·m at peak, and the path error from 0.21 to 1.78 mrad rms. Coulomb friction makes most of the path error; the encoder's counts make the largest torque noise (1.7 N·m rms).
- **What it needs first:** a minimal mask (numbers, toggles and choices; formula parameters in the names of the mask) and **switches resolved at compile time**. The second is not optional. An off branch that is compiled sets the step through its poles, and the run then differs (measured: 2 substeps against 1).

## 1. On the canvas

A block faced **Servo motor**, with a second line from its mask: "voltage drive, G 1" or "current drive, G 107.8 · friction, ripple, encoder". Double-click opens it like any subsystem (no black boxes, [transparent-models.md](transparent-models.md)):

```
 u ──►[drive ▾]──────────────────── i ──►[K]── τe ─►(Σ)─ τm ─►[G]──► Out τ
   voltage: (V − K·ωm) → 1/(L·s + R)          ▲   ▲   ▲
   current: clamp ±imax → [current loop]      │   │   └─ [viscous b] ◄─ ωm
                                              │   └───── [Coulomb ⏻] ◄─ ωm
 θ ──►[G]── θm ─►[ripple and cogging ⏻]─►[torque noise ⏻]┘
 ω ──►[G]── ωm
 θm ─►[coupling ⏻]─►[errors ⏻]─►[counts ⏻]─►[delay ⏻]─►[1/G]──┬────────► Out θ measured
                                                              └─►[speed from angle ⏻]─► Out ω measured
                                                     (off: ω itself, an ideal tachometer)
 Sinks: i (A), tau_m (N·m), v (V, current drive: R·i + K·ωm)
```

- Each ⏻ is a **Switch** whose position is the mask's toggle. Off, its input passes through and the effect's blocks are not compiled. The effect's group stays visible, drawn faint and labelled "off", so the person sees what could be switched on.
- **Selected, the block shows its mask** in the Parameters panel. First the motor (R, L, K, b, G and, for a current drive, imax). Then one row per switch: a toggle, with the effect's fields folded under it, greyed while it is off. The fields keep their values when the switch goes off, so switching it on again brings back the same calibrated error.
- From outside, the block has three inputs and three outputs, whatever is switched on. Switches never change ports.

## 2. Ports and the three uses

### 2.1 Ports

| Port | Name | Unit | Notes |
|---|---|---|---|
| In 1 | u | V or A | The command. Its label follows `drive`: "V" or "i*" |
| In 2 | θ | rad | Angle of the output shaft (after the gear) |
| In 3 | ω | rad/s | Speed of the output shaft |
| Out 1 | τ | N·m | Torque at the output shaft: G·τm. The person's torque |
| Out 2 | θ measured | rad | The encoder's angle referred to the output (÷G). With the encoder switches off it is θ exactly (G·θ/G is exact for G = 1; for other G to an ulp) |
| Out 3 | ω measured | rad/s | Speed from the angle when that switch is on; otherwise ω |

τ goes straight through from ω (viscous and Coulomb friction), but not from θ or u in a way that closes a loop without a state. The Shaft's integrator (or the arm's) closes the loop, so there is no algebraic loop. The prototype compiles all of them.

### 2.2 Why motion in, torque out (and where the inertia goes)

A causal block diagram has to put the rotor's inertia somewhere.
- **A lone motor** (the library's motor examples) integrates it. Main's Motor has 1/(J·s + b) inside, so the motor has torque in and speed out.
- **A robot joint** cannot: the rotor's reflected inertia G²·Jm sits on the arm's mass matrix ([robot.md](robot.md) §4: "Inverse dynamics has `armature` (G²·Jm)"). The joint's acceleration is known only after M(q) is solved for all six joints at once.

A motor that integrates its own rotor would need a compliant coupling to every joint. That adds a stiff mode the PUMA plan does not have, and rigidity can only be approached, never reached exactly. So the component takes the shaft's motion in and gives its torque out, and the inertia is wherever the mechanics is:
- **Lone motor:** the **Shaft** group, three primitives drawn beside it: Σ (τ − τ_L) → Integrator "rotor and load inertia" (K = 1/J) → ω → Integrator "angle" → θ, both fed back. The library inserts Servo motor and Shaft together as the template **Servo motor on a shaft**, inside a group named Motor, so the outside looks like main's Motor (V and load torque in, speed out). J is the rotor's inertia plus the load's.
- **Robot joint:** the arm. θ = q_j and ω = q̇_j come from the arm, τ goes to it, and G²·Jm is on M(q)'s diagonal.

Friction is the motor's: viscous b and Coulomb, at the motor speed. So the Shaft is a pure inertia, and no physics number is in both places. That is the one difference from main's motor (b moved from the rotor's denominator into a Gain), and it is where the 10⁻¹² in §7.1 comes from.

### 2.3 Drive: voltage or current

`drive` is a mask choice. Inside, it is the Switch "drive" with two branches, of which only the chosen one is compiled:
- **voltage**: u is the terminal voltage V. Then the supply limit ±Vmax (a switch), V − K·ωm, and the armature 1/(L·s + R) gives i. This is main's DC motor.
- **current**: u is the current command i*. Then the current limit ±imax, and the current loop's lag 1/(τc·s + 1) (a switch; off is an ideal current source) gives i. The voltage the drive needs at that current, v = R·i + K·ωm, is a Sink. The robot plan's voltage check reads it. Its L·di/dt part is left out, which the Sink's description says.

The physics after i (K, friction, ripple, gear, encoder) is shared by both drives. Nothing is built twice. A drive with its own PI current loop over the voltage armature (a third choice, `current, PI`) is later (§13): it needs about 0.25 ms steps on the PUMA (research/robot.md).

### 2.4 Speed, position and torque control

- **Speed-controlled** (the encoder example): the Controller reads Out 3, ω measured, and commands V.
- **Position-controlled** (the DC motor examples): it reads Out 2, θ measured.
- **Torque-controlled** (the PUMA's axis loops): it commands i* through a current drive, and τ is the result.

A cascade reads both outputs. None of these is a setting of the motor.

## 3. Parameters (the mask)

Physical inputs only. Nothing computable is stored: no τ = J/b, no reflected inertia, no 1/R. The library's blocks read these names through formulas: the armature's den is `["L", "R"]`, the gear's K is `"G"`, the encoder's 1/G is `"1/G"`, the counts' step is `"2*pi/N"`.

| Key | Label | Unit | Plain motor (DC motor examples) | Notes |
|---|---|---|---|---|
| `drive` | Drive | choice | voltage | voltage · current |
| `R` | Armature resistance | Ω | 1 | |
| `L` | Armature inductance | H | 0.01 | 0 is allowed: the armature becomes 1/R (`polyTrim`), as detail-levels' L1 |
| `K` | Torque and back-EMF constant | N·m/A = V·s/rad | 0.5 | One number: main's Kt and Ke, equal in SI units, become one |
| `b` | Viscous friction at the motor | N·m·s/rad | 0.1 | |
| `G` | Gear ratio | motor turns per output turn | 1 | Sign allowed (the PUMA's motor directions) |
| `imax` | Current limit | A | – | Current drive only |

The Shaft's J (and a load's J_L, or the arm's armature term) is not on this mask. It is the mechanism's (§2.2). The template's group carries J beside the Servo motor's fields.

## 4. The switches

Each switch is a toggle on the mask (`kind: 'toggle'`, 0 or 1) with its fields. **Exact off** means that the toggle off is the plain motor bit for bit, which holds for every row, because the branch is not compiled. **Neutral on** is the value at which the effect, switched on, still reproduces the plain motor bit for bit (measured where marked ✓).

| Switch | Blocks inside | Fields | Neutral on | Shows in |
|---|---|---|---|---|
| `coulomb` Coulomb friction | Equations on ωm: Tc⁺ for ωm ≥ 0, Tc⁻ below, smoothed by tanh(ωm/ωs) | Tc⁺, Tc⁻ (N·m, motor side), ωs (rad/s) | Tc⁺ = Tc⁻ = 0 ✓ | Position hold, reversals; the robot's torque and path (most of the path error, §7.3) |
| `ripple` Torque ripple and cogging | Equations on θm: Σ A_k·sin(k·θm + φ_k) | a list of orders k (per motor turn), A_k (N·m), φ_k (rad) | every A_k = 0 ✓ | Spectrogram lines at k·ω/2π; at the robot's link ×G |
| `torqueNoise` Torque noise | Noise | σ (N·m), seed | σ = 0 ✓ | Broadband floor |
| `currentLoop` Current loop (current drive) | Transfer function 1/(τc·s + 1) | τc (s) | τc = 0 ✓ (`polyTrim`: a gain of 1) | Torque phase lag; the step it needs (§5) |
| `vlimit` Supply limit (voltage drive) | Saturation ±Vmax | Vmax (V) | Vmax = inf (needs `inf`, detail-levels §2.3) | Speed limited by back-EMF at high speed |
| `coupling` Encoder coupling resonance | Transfer function ωc²/(s² + 2ζc·ωc·s + ωc²) on θm | ωc (rad/s), ζc | none (ωc → ∞); exact off | A horizontal spectrogram line; the orders flare where they cross it |
| `encErrors` Encoder angle errors | Equations on the encoder angle: u + Σ e_k·sin(k·u + φ_k) | a list of orders k (per motor turn), e_k (rad, motor side), φ_k | every e_k = 0 ✓ | 1× eccentricity, 2× tilt or out-of-round; sin/cos interpolation at N× and 2N× (research §2) |
| `counts` Encoder counts | Quantizer 2π/N | N (counts per motor turn, after interpolation) | none (N → ∞); exact off | Quantisation noise, worst at low speed and through a derivative |
| `encDelay` Measurement delay | Dead time | T_d (s) | T_d = 0 (the delay node passes its input) | Phase lag in the loop |
| `speedFromAngle` Speed from the angle | Transfer function s/(T_f·s + 1) on θ measured | T_f (s) | none (T_f → 0 is a pure derivative, not ω); off is an ideal tachometer | Every encoder error, amplified by frequency; the encoder example's speed_m |

- **Order of the encoder chain** (coupling, then errors, then counts, then delay): the disk turns behind its coupling, the errors are the disk's, the counts are of the erroneous angle, and the delay acts on what is counted. Main's example has the same order (shaft resonance, then the 1× and 2× function).
- **Ripple and the encoder errors take their angle from θm = G·θ**, so their orders are per motor turn, as on the datasheet. On the robot, a 6× motor ripple is 6·G per joint turn: 97 Hz at the joint's peak speed in §7.3. That is why the same errors look different in the robot.
- **Coupling resonance, not a two-mass shaft.** Main's example puts the 70 Hz resonance between the rotor and the encoder, with no reaction on the rotor. That is the encoder disk on its own flexible coupling (its inertia does not load the rotor), a known effect (research §3), and that is what it is called here. A two-mass resonance between the motor and its load (it also shows in the torque) is a later switch (§13). The example's text changes "the encoder sits behind a flexible shaft" to "the encoder sits on a flexible coupling".
- **Not switches**: the inertia (the mechanism's), backlash and shaft compliance (they need the rotor's own state, §13), stiction and Stribeck (a stick state, §13), current-sensor offset and gain (PMSM orders p and 2p; this is a DC motor).

## 5. Torque and current as signals; the step

- τ (Out 1) is a signal wherever the component is used. In the robot it is τ_j, the person's torque ([input 15](../input/2026-10-25-15-puma-torques.md)). Inside, the Sinks i, tau_m and v are named per instance by the block's path ("Motor 2/i"), as Sinks inside subsystems are today.
- The torque's shares (electromagnetic K·i, ripple, friction) can be Sinks as well. The plan adds `tau_ripple` and `tau_friction` inside, so the robot's "friction share" ([robot.md](robot.md) §0) is read from the motor and not recomputed.
- **The step.** Each switch adds what its blocks add:
  - the current loop's pole 1/τc took the PUMA joint from 1 to 3 substeps at a 0.5 ms record (the 400 Hz loop, §7.3);
  - the coupling's pole is the encoder example's 5 substeps today;
  - an off switch adds nothing, because it is not compiled. That is why compile-time resolution is required (§0).

## 6. Detail levels, later: a level is a named set of switches

When [detail-levels.md](detail-levels.md) is built, the Servo motor needs no second diagram. A level is a named set of switch values over the one diagram:

| Level | Switches on | For |
|---|---|---|
| 1 Ideal | none | Designing and tuning |
| 2 + friction | coulomb | Position hold, reversals |
| 3 + drive | + currentLoop or vlimit | Torque fidelity, speed limits |
| 4 + encoder | + counts, encErrors, encDelay, speedFromAngle | What the loop measures |
| 5 + ripple | + ripple, torqueNoise, coupling | The spectrogram, the robot's torque ripple |

- A level stored this way is `levels: [{ name, switches: { … } }]` on the component, beside its mask. That fits detail-levels' rules: ordered, named, identical ports (switches never change ports), one parameter set, neutral values reproducing the level below.
- A local override per block and the global level apply as designed there.
- Until then, the switches are set one by one on the mask, and an example sets the ones it needs.

**Interpretation:** "increase the level of the servos of the robot" becomes, now, switching the same switches on in Motor drives (one row of toggles for all six joints, or per joint), and, later, raising the global level.

## 7. The uses

### 7.1 Encoder errors and torque ripple (speed-controlled)

The example becomes: r → Controller "PI speed" (reads ω measured) → Servo motor on a shaft → the Sinks speed (the Shaft's ω), speed_m (ω measured) and V. Main's two first-order blocks, read as physics, are:
- armature K 1, τ 2 ms: R = 1 Ω, L = 2 mH;
- "inertia and friction" K 200, τ 0.2 s: b = 1/200 = 0.005 N·m·s/rad, J = τ·b = 0.001 kg·m²;
- Kt = Ke = 0.1: K = 0.1.

Switches on:

| Switch | Fields | Main's block |
|---|---|---|
| ripple | k 6, A 0.05 N·m | `0.05*sin(6*u)` |
| torqueNoise | σ 0.02 N·m, seed 7 | Noise σ 0.02, seed 7 |
| coupling | ωc 439.8 rad/s, ζc 0.02 | Second order ωn 439.8, ζ 0.02 |
| encErrors | 1×: 0.02 rad at 0.5; 2×: 0.01 rad at 1 | `u + 0.02*sin(u + 0.5) + 0.01*sin(2*u + 1)` |
| speedFromAngle | T_f 1 ms | s/(0.001·s + 1) |

ωc stays 439.8 rad/s (69.996 Hz) rather than 2π·70: the field is in rad/s, so the traces do not move. **Measured** (prototype, Node 22, run as the page runs it: `normalizeProject`, `applySystem`, `autoTimebase`, `evaluateSystem`):

| Signal | Largest difference from main | Relative |
|---|---|---|
| r | 0 | 0 |
| speed_m | 7.0·10⁻¹⁰ rad/s | 2.2·10⁻¹² |
| speed | 8.0·10⁻¹¹ rad/s | 2.6·10⁻¹³ |
| V | 2.9·10⁻¹⁰ V | 6.1·10⁻¹² |

- Same steps (5 substeps of the 1 ms record).
- rms speed error after 0.5 s: 2.181480780500966 against main's 2.181480780501016 (the test's bound is 2.18149).
- **The reason, proven:** with the friction put back into the rotor's 1/(J·s + b) and the motor's b set to 0, the rebuilt example is main's bit for bit (`why.mjs`). The equation is the same; its floating-point operations run in another order, and the loop amplifies the rounding to 10⁻¹².
- **Tolerance for the test:** 10⁻⁹ relative on every signal. The spectrogram test and the sampling test keep their bounds unchanged.
- Built with the Switch blocks compiled (all branches present, positions chosen), the run is the same as with the switches resolved, because this example's off branches add no faster pole.

### 7.2 The DC motor examples (position-controlled)

DC motor position control, Following a sine and DC motor, sliding mode use the Servo motor on a shaft with every switch off: R 1, L 10 mH, K 0.5, b 0.1, G 1, J 0.02. **Measured** with every variant of each:

| System · variant | Largest relative difference | Substeps |
|---|---|---|
| DC motor, position control · P, PD, PID with prefilter, Off | 4.4·10⁻¹⁶ … 7.4·10⁻¹⁵ | 1 (as main) |
| Following a sine · P, PD, PID, PID + feedforward | 1.2·10⁻¹⁵ … 1.4·10⁻¹⁴ | 1 |
| DC motor, sliding mode · Relay, Boundary layer, Super-twisting | 1.8·10⁻¹⁶ … 5.7·10⁻¹⁵ | 1 |

The relay, the most sensitive, switches at the same samples. Tolerance for the test: 10⁻¹² relative. The motor's views and notes are unchanged. The sliding-mode notes' try-this ("open Motor and triple J (rotor den [0.06, 0.1])") becomes "set J to 0.06 on Motor's mask".

### 7.3 The PUMA's six joints (current drive, geared, each with its own data)

[robot.md](robot.md) §4 already has the shape: "Motor drives" opens to Motor 1 … Motor 6. Each becomes a Servo motor with `drive: current`, its θ and ω from the arm's q_j and q̇_j, and its τ into the arm. The Motor drives group carries a mask of per-joint lists. Each Servo motor's fields are formulas that pick its joint (`G: "G[j]"`, `imax: "imax[j]"`), so the data is typed once per joint ([research/robot.md](../research/robot.md) §3):

| Field | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| G | −62.6111 | 107.815 | −53.7063 | 76.0364 | 71.923 | 76.686 |
| K (N·m/A) | 0.227 | 0.228 | 0.238 | 0.0675 | 0.0718 | 0.0534 |
| b (N·m·s/rad, motor) | 1.48e-3 | 0.817e-3 | 1.38e-3 | 71.2e-6 | 82.6e-6 | 36.7e-6 |
| Tc⁺ / Tc⁻ (N·m, motor) | 0.435 / 0.395 | 0.126 / 0.0709 | 0.105 / 0.132 | 11.2e-3 / 16.9e-3 | 9.26e-3 / 14.5e-3 | 3.96e-3 / 10.5e-3 |
| imax (A) | 8.83 | 8.77 | 8.74 | 4.42 | 4.42 | 4.49 |
| R (Ω) | 2.1 | 2.1 | 2.1 | 6.7 | 6.7 | 6.7 |
| N (counts per motor turn) | 1 000 | 800 | 1 000 | 1 000 | 1 000 | 500 |

- Jm (200e-6 ×3, 33e-6 ×3) stays with the arm's armature term, as robot.md has it.
- Robot.md's own Friction block and Saturation become the Servo motor's `coulomb` switch, its viscous b and its current limit. The plain PUMA (switches off) loses its Coulomb friction, so the robot example switches `coulomb` on by default. That keeps robot.md's measured 0.049 mm.
- The encoder: the robot's Encoder speed observer now reads Out 2, θ measured, so encoder errors and counts reach the controller as on the real arm.

**Measured** on one joint in the prototype:
- the joint is PUMA joint 2's motor, a link of 2.04 kg·m² plus G²·Jm = 2.32, and gravity 35.7·cos q N·m;
- a position PID on θ measured gives i*, tuned for 30 rad/s, with speed, acceleration and gravity fed forward;
- r = 0.3·sin(2π·0.5·t) rad, a 0.5 ms record, read from 1 s on.

The sizes switched on:
- Coulomb from the table;
- ripple 6×, 0.02 N·m at the motor (1 % of K·imax), 2.16 N·m at the link;
- torque noise 0.005 N·m;
- current loop 400 Hz;
- encoder errors 1× 0.002 rad and 2× 0.001 rad at the motor (exaggerated, as in the encoder example, so that they show);
- 1 000 counts (58 µrad at the joint).

| Case | rms τ (N·m) | rms Δτ against off (N·m) | peak Δτ (N·m) | rms error (mrad) | peak error (mrad) | peak i* (A) | substeps |
|---|---|---|---|---|---|---|---|
| all off | 36.08 | 0 | 0 | 0.214 | 0.382 | 2.05 | 1 |
| Coulomb only | 36.12 | 1.50 | 8.74 | 1.777 | 4.120 | 2.67 | 1 |
| ripple only | 36.12 | 1.61 | 2.82 | 0.247 | 0.603 | 2.06 | 1 |
| torque noise only | 36.09 | 0.55 | 1.99 | 0.213 | 0.380 | 2.05 | 1 |
| current loop only | 36.08 | 0.017 | 0.037 | 0.213 | 0.382 | 2.05 | 3 |
| encoder errors only | 36.09 | 0.37 | 1.03 | 0.213 | 0.383 | 2.07 | 1 |
| counts only | 36.12 | 1.69 | 5.12 | 0.214 | 0.386 | 2.20 | 1 |
| all on | 36.19 | 2.73 | 11.85 | 1.779 | 4.128 | 2.84 | 3 |

- With every switch on at its neutral value (counts off), the run is the switches-off run bit for bit.
- With the Switch blocks compiled and all off, it is not: 2 substeps against 1, because the coupling branch's unused pole sets the step. That measurement is why switches are resolved at compile time.
- The torques show the same errors as the encoder example, at robot orders: the ripple at 6·G per joint turn, the encoder's counts as torque noise through the derivative. The path shows mainly the friction.

## 8. What it needs from transparent-models (and a minimal mask first)

From [transparent-models.md](transparent-models.md) §1.4 and [detail-levels.md](detail-levels.md) §2.3:
1. **The mask**: `mask: [{ key, label, unit, kind }]` and `params` on a subsystem; inner number fields as formulas in the mask names; the refusals.
2. **Two field kinds beyond numbers:** `toggle` (0/1) and `choice` (`drive`: voltage, current). A Switch's `position` may be a formula in them (`"1 + coulomb"`, `"drive"`). Transparent-models refuses formulas in integer fields; this one exception is for Switch positions that read a toggle or a choice.
3. **Transfer-function coefficients as formulas** (`den: ["L", "R"]`), as detail-levels needs for the same motor.
4. **`inf`** for Vmax, and **`tanh`** in formula.js (the prototype writes it with `exp`).
5. **Lists in the mask** (the orders of ripple and of the encoder errors; the PUMA's per-joint data), indexed in formulas (`A[k]`, `G[j]`). A list field is new. Until it exists, the component has a fixed number of order slots: three ripple orders and three encoder-error orders, each with its own k, amplitude and phase. Main's examples need one and two.
6. **Compile-time switches** (new here): a Switch whose position is a constant after the mask is resolved is compiled as a wire. Every block whose outputs reach only its unselected inputs is not compiled, and neither are Sinks fed only from there. They read "off", and a scope channel on one shows "off". The data is untouched, so the person can switch the effect back on.

**A minimal mask can come first, and should.** Items 1, 2, 3 and 6, with numbers only (no lists, no Equations block), are enough for the Servo motor with fixed order slots, the encoder example and the motor examples. Transparent-models' Equations block (several inputs) is not needed: every effect here is a function of one signal (θm, ωm or the encoder angle), which today's Function block computes. When Equations lands, the Function blocks inside migrate with it, bit for bit (its §1.2).

## 9. A library component, and how a project stores a use

- **Built-in components** ship in the page, in `src/core/components.js`. Each is an id, a version, a mask, a diagram and its levels (later). The Servo motor is the first, and the Shaft template's group is its companion. Examples and the robot use them; the Plant tab's library lists them under **Components**.
- **My blocks** are the same thing, made by the person in a project (a group with a mask, "Make component"). They are stored in the project's `components` map and listed in the library under **My blocks**. Their ids are the project's own. This page needs only the format; making and editing them in the page is later.
- **A use is stored by reference**, never as a copy of the insides:

  ```json
  { "id": "motor", "type": "subsystem", "name": "Motor", "component": "servo-motor@1",
    "params": { "drive": "voltage", "R": 1, "L": 0.002, "K": 0.1, "b": 0.005, "G": 1,
                "ripple": 1, "ripple1k": 6, "ripple1A": 0.05, "torqueNoise": 1, "torqueStd": 0.02, "torqueSeed": 7,
                "coupling": 1, "wc": 439.8, "zc": 0.02, "encErrors": 1, "err1k": 1, "err1A": 0.02, "err1p": 0.5,
                "err2k": 2, "err2A": 0.01, "err2p": 1, "speedFromAngle": 1, "Tf": 0.001 } }
  ```

  - `normalizeDiagram` resolves `component` from the built-in table (or the project's `components`) into the diagram it compiles and opens. So it stays openable.
  - A mask value left out takes the component's default, and a switch's default is off.
  - Saving writes back only `component` and `params`.
  - Opening a component's use shows its insides **read-only**, with "Edit a copy". Edit a copy turns the use into a My block (a copy in `components`, referenced the same way), never an inline copy, so its other uses can follow it.
- **Versions.** `@1` is the component's version.
  - A change to a built-in component that alters a result is a new version. The old version stays in the table, so a saved project runs as it was saved.
  - The library's examples move to the new version deliberately, with their tests.
  - An unknown id or version is refused with a sentence naming what is there.
- This is the format addition (still `loop-tuner/2`; [project-format.md](project-format.md) gets a `components` section).

## 10. The prototype

On this branch, in [`design/prototypes/servo/`](../prototypes/servo/), built from today's primitives (Inport, Outport, Gain, Sum, Transfer function, Function, Saturation, Quantizer, Noise, Dead time, Switch, Integrator, Sink). The mask is emulated in JS: numbers baked into the blocks, which is what formula parameters resolve to at compile time.
- `servo.mjs`: `servoMotor(id, params, { switches })` builds the component. Off effects are left out (the compile-time resolution of §8.6), or, with `switches: true`, built behind Switch blocks. `shaft(sid, J, load)` builds the Shaft.
- `encoder.mjs`: §7.1, both ways of building the switches.
- `why.mjs`: friction back in the rotor's denominator: bit for bit.
- `motors.mjs`: §7.2, every variant.
- `joint.mjs`: the DC motor position example (§7.2) and the PUMA-like joint (§7.3), with the neutral-value and Switch-block checks.

Run each with `node design/prototypes/servo/<name>.mjs`; together they take under 2 s. They import `src/core/` and change nothing in it. `npm test` does not run them.

## 11. Implementation steps (each one agent; `npm test` green after each)

0. **Record.** decisions.md: the interpretations in §14. This page's row in the output README (done with this plan).
1. **The minimal mask and compile-time switches** (§8 items 1, 2, 3, 6; numbers, toggles, choices; no lists).
   - `mask` and `params` through `normalizeDiagram` and the project format; formulas in number fields (`core/formula.js`, as transparent-models step 2 designs it; whichever plan reaches it first builds it); Switch `position` from a toggle or choice; tf coefficients as formulas; `inf`, `tanh`.
   - The pruning of off branches and their Sinks ("off").
   - The mask panel: fields, toggles folding their fields, a choice; Open.
   - Tests: §12.1. No library change.
2. **Components and references** (§9).
   - `src/core/components.js` with `servo-motor@1` and the Shaft template; `component` on a subsystem resolved on load; saving back as a reference; refusals; read-only opening and Edit a copy (into `components`).
   - The library's Components group.
   - Tests: §12.2.
3. **The DC motor examples on the component.**
   - `motorDiagram` uses Servo motor on a shaft. The sliding-mode notes' try-this changes to J on the mask.
   - Tests: §12.3 (10⁻¹² against signals recorded from main before the change).
4. **The encoder example on the component.**
   - Its switches as in §7.1; the notes say "flexible coupling", and the switches name each effect, so "open Motor and switch the 6× ripple off" becomes a try-this.
   - Tests: §12.4 (10⁻⁹ against main's recorded signals; the spectrogram and sampling tests unchanged).
5. **The robot's Motor drives on the component** (with or after [robot.md](robot.md)'s step for motors).
   - Six Servo motors, current drive, the per-joint data (until mask lists exist: six instances with their numbers in their own params, which is still one component and data per use), Coulomb on by default, θ measured to the Encoder speed observer, the torque shares as Sinks.
   - Robot.md's numbers re-measured (0.049 mm expected unchanged within its own tolerance).
   - A try-this: "open Motor drives, switch ripple and the encoder on: τ2 and τ3 ripple, the path barely moves; switch Coulomb off: the error falls".
6. **Docs sweep.** plant-editor.md (masks, components, My blocks), project-format.md (`components`, `component`, `params`), system-library.md, robot.md §4 (pointing here), detail-levels.md §7 (the DC motor's levels become the switch sets of §6), AGENTS.md (building with a component in JSON), roadmap.md.

Later, when detail levels are built: `levels` as named switch sets (§6).

## 12. Tests

1. **Mask and switches:**
   - a formula in a field resolves;
   - an unknown name is refused, naming the fields;
   - a toggle off removes its branch: the compiled nodes, the step and the result are bit for bit those of the diagram without the branch;
   - a Sink in an off branch reads "off";
   - a choice picks one branch;
   - a formula in a non-Switch integer field is still refused.
2. **Components:**
   - a use saves as `component` + `params` only;
   - it reloads to the same compiled system bit for bit;
   - an unknown id or version is refused;
   - Edit a copy makes a My block, and the other uses are unchanged;
   - a project with a My block round-trips.
3. **The Servo motor's physics** (`test/servo.test.mjs`):
   - every switch at its neutral value against off, bit for bit (counts, coupling and speed-from-angle excluded);
   - each effect's signature:
     - ripple: the order line at k·ω/2π in the torque spectrum;
     - encoder errors: θ measured − θ equals e_k·sin(k·G·θ + φ_k) to 10⁻¹²;
     - counts: steps of 2π/(N·G);
     - Coulomb: the steady torque at ±speed is G·(b·ωm + Tc±) to the tanh's tail;
     - current loop: i lags i* by τc;
     - voltage limit: speed saturates at (Vmax − R·i)/K;
     - a current drive's v is R·i + K·ωm;
   - the energy balance, as the sliding-mode tests have it: V·i = R·i² + τm·ωm with L = 0 and every switch off.
4. **The examples:** each motor example and variant against main's signals recorded before step 3 (10⁻¹²), the encoder example (10⁻⁹), the existing spectrogram and sampling tests unchanged.
5. **The robot:** the joint torques with switches off against robot.md's plain motor model; with ripple on, the 6·G-per-joint-turn line in τ_j's spectrum.

## 13. Not built (and why)

- **Two-mass shaft and backlash.** They need the rotor's own state: Jm integrated inside, a spring k and damper c (and a dead zone of width β, which today's Function block can compute) between θm/G and θ, with τ the spring's torque. The ports stay the same (θ and ω in, τ out), but the rotor's inertia then leaves the mechanism (the Shaft's J, the arm's armature term), which is a second place to change. Rigidity has no representable neutral (k → ∞). Design it when an example needs it, with the mechanism reading the switch. Not prototyped.
- **Stiction and Stribeck** need a stick state (Modelica's BearingFriction has one; Simscape's Rotational Friction smooths instead, research §4). The tanh smoothing's validity sentence from robot.md applies.
- **A PI current loop over the R–L armature** (`drive: current, PI`): about 0.25 ms steps on the PUMA. Later, for the voltage-limit effects in fast moves.
- **PMSM effects** (current-sensor offset at p and gain mismatch at 2p per turn, flux ripple at 6p): this is a DC motor. A PMSM is a second component, or a later choice of `motor`.
- **Mask lists** (any number of orders; per-joint data in one list): fixed slots until then.
- **Making and editing components in the page** (Make component, mask editing): JSON and the built-in table first.
- **Thermal effects** (R with temperature, copper loss heating): no example needs them.

## 14. Interpretations (for the decision log)

- **One component, Servo motor, with motion in and torque out.** The inertia is the mechanism's (a Shaft for a lone motor, the arm's mass matrix for the robot). That is the only form in which one model serves both, with no physics in two places. Interpretation: the person's "servo motor model" is the motor, its drive and its encoder, not the load it turns.
- **"High detail toggles" are switches on the mask**, one per effect, each with its own fields. Off is exact because it is not compiled; on with the neutral value is exact where one exists. Interpretation: a switch keeps its numbers while off.
- **"Speed controlled" is not a mode.** The loop reads ω measured instead of θ measured. The drive (voltage or current) is the one mask choice.
- **The encoder example's "flexible shaft" is the encoder's coupling** (sensor side), which is what main computes. A two-mass shaft is a later switch.
- **"Increase the level of the servos of the robot"**: now the same switches on Motor drives; later a detail level is a named set of these switches.
- **Encoder example tolerance:** 10⁻⁹ relative, not bit for bit, because the motor owns its friction. The cause is shown exactly by `why.mjs`.
- **A use is a reference plus mask values** (`component`, `params`), opened read-only with Edit a copy into My blocks; built-in components are versioned.

## Open questions for the person

1. **Robot default**: the plain PUMA keeps Coulomb friction on (robot.md's results assume it). Should the robot open with more switched on (ripple, encoder) to show the errors, or plain, with a try-this?
2. **Realistic or visible sizes**: the encoder example's errors are large (0.02 rad is about 70 arcmin; real encoders are ±1–20 arcseconds, research §2), so they show. For the robot, real sizes or the same visible ones?
3. **Two-mass shaft and backlash** (§13): wanted soon? They are the effects that matter most for a robot joint's torque (research §7), but they move the rotor's inertia into the motor.
