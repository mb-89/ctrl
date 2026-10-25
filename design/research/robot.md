# Research: a PUMA 560 controlled in end-effector coordinates, from a URDF, in 3D

Reader: whoever builds the PUMA example or another robot in Loop Tuner, or wants to know why [../output/robot.md](../output/robot.md) decided what it did. The person's words are in [input 10](../input/2026-10-24-10-sliding-mode-and-triple-swingup.md) ("controls for a … Puma robot … the coordinate systems of the axes … of the end effector … a transformation block … integrate the URDF format … a 3D rendering").

## How this was made

- **Three research passes** (2026-10-24/25), each with a prototype in Node:
  - **Control**: which law, which signals, which gains. It ran Corke's Robotics Toolbox for Python 1.5.0 in a virtual environment to make reference values.
  - **PUMA parameters**: kinematics, inertias, motors, limits, workspace. It cross-checked the sources against each other.
  - **URDF and 3D**: the format, rigid-body algorithms in JavaScript, a renderer without dependencies, with screenshots in headless Chromium.
- **Two designs** were then prototyped on top (A: vector signals first; B: joint space first) and scored by two judges.
- **This file's own checks** (2026-10-25): the merged law, the start pose, the orientation-error trap and the circle placements, re-run on the same prototypes. Node 22.22 on a shared 2.8 GHz Xeon with a load average of 6 to 13, so times are ±30 %.
- **Where the code lives**: the prototypes are in the session scratchpad, listed in the output's §9.

## Summary

- **Control.** A cascade:
  1. a task-space law on the measured pose: v* = v_d + k_x·e, a* = a_d + k_x·(v_d − v);
  2. the damped inverse Jacobian, which gives every axis a speed and an acceleration target: q̇* = J⁺v*, q̈* = J⁺(a* − J̇q̇);
  3. six PI speed loops;
  4. a torque feedforward from inverse dynamics (RNEA).

  It is the person's sketch, the textbooks' two-level structure (Siciliano §8.6.1, Corke) and the most robust scheme tried. With the controller's link masses 20 % low it tracks to 0.19 mm, where resolved acceleration with computed torque reaches 3.4 mm.
- **The PUMA's data.**
  - Kinematics: Corke's toolbox (standard DH, Paul's convention, its named poses and limits).
  - Inertias: Armstrong, Khatib & Burdick 1986, with two corrections (link 4's centre of mass sign, link 3's y offset). One exact regrouping is also needed, because the published link-3 moments are not those of any rigid body.
  - Motors: Corke's measured values (1996, ch. 2).
- **URDF.** One file per robot is the single source for the physics, the controller's model and the picture. Standard DH maps onto URDF joints exactly. Motors, gears and friction stay out of it.
- **Dynamics.** CRBA + RNEA + Cholesky. Forward dynamics costs 4.3 µs for 6 links in JavaScript; ABA pays only beyond about 9 links.
- **Rendering.** Our own WebGL1 renderer of about 400 lines, with a Canvas2D fallback that has to be there. A library (three.js r160 alone is 671 KB) would double the page.
- **The circle.**
  - A horizontal circle of 0.15 m, 2.5 s per turn, through the tool's start point with its centre towards the base, from q0 = [0, 40°, −150°, 0, −70°, 0], with the tool pointing down.
  - It stays 18.5° inside every joint limit, with σ_min ≥ 0.175, joint speeds ≤ 1.21 rad/s and currents ≤ 2.52 A.
  - The shoulder motor's current is the one to show: gravity load plus the circle's frequency and friction harmonics.
- **Measured on the merged law, with speed differenced over Ts as the PUMA did**:

  | Variant | rms error |
  |---|---|
  | model feedforward | 0.049 mm |
  | PI, no model | 1.8 mm |
  | P only, no model | 14 mm, orientation 3.4° (visible in 3D) |

## Findings

### 1. Kinematics

**Standard DH, Corke's `mdl_puma560` (Paul convention; recommended)**

| i | α (rad) | a (m) | d (m) | θ |
|---|---|---|---|---|
| 1 | +π/2 | 0 | 0 | q1 |
| 2 | 0 | 0.4318 | 0 | q2 |
| 3 | −π/2 | 0.0203 | 0.15005 | q3 |
| 4 | +π/2 | 0 | 0.4318 | q4 |
| 5 | −π/2 | 0 | 0 | q5 |
| 6 | 0 | 0 | 0 | q6 |

- The base frame sits at the shoulder. The Python toolbox adds the pedestal, 26.45 in = 0.67183 m from the mounting surface to the shoulder axis; its ETS model uses 0.672 m.
- The flange is 56.25 mm beyond the wrist centre (Corke 1996 Table 2.1, after Lee). The toolbox uses 0.

**Modified DH, Armstrong, Khatib & Burdick 1986 Table A1 (Lee-style; `mdl_puma560akb`)**

| i | α(i−1) | a(i−1) (m) | d(i) (m) |
|---|---|---|---|
| 1 | 0 | 0 | 0 |
| 2 | −90° | 0 | 0.2435 |
| 3 | 0 | 0.4318 | −0.0934 |
| 4 | +90° | −0.0203 | 0.4331 |
| 5 | −90° | 0 | 0 |
| 6 | +90° | 0 | 0 |

- AKB's frame 2 lies in the upper arm's mid-plane and frame 3 in the forearm's. The net shoulder offset is 0.2435 − 0.0934 = 0.1501 m.
- With equal link lengths, q_AKB = q_RTB + (π, π, π, 0, 0, 0) gives the same wrist position and z6 axis, with x6 turned by π about z6 (checked numerically).
- Both zero poses are L-shaped. The toolbox's is "righty" (Paul), AKB's "lefty" (Lee). The toolbox's ETS model has yet another zero: its qz is the DH model's qr.

**Into URDF.** Write each standard-DH row as a modified-DH joint: joint i at `origin xyz = (a(i−1), −d(i)·sin α(i−1), d(i)·cos α(i−1))`, `rpy = (α(i−1), 0, 0)`, axis z. Joint 1 goes at (0, 0, 0.67183), and a fixed `flange` at (0, 0, 0.05625). Frame 6 stays at the wrist centre so that link 6's centre of mass (0.032) stays valid.
- Checked over 2 000 random poses: M(q), gravity and the flange pose agree with the DH model.
- With 6-decimal numbers in the XML the residual was 2.8·10⁻⁷ m. Write numbers at full precision so the tests can be tight.

### 2. Inertial parameters

AKB measured them by taking the arm apart (Tables 4–6). Tolerances: masses ±0.01 kg + 1 %; centres of mass ±3 mm. Values marked * were estimated from external dimensions: masses and centres ±25 %, inertias ±50 %.

**In AKB's frames**

| Link | m (kg) | r (m) | Ixx, Iyy, Izz about the centre of mass (kg·m²) | AKB motor and drive, link side (kg·m²) |
|---|---|---|---|---|
| 1 | not measured | – | Izz 0.35 (about the joint axis) | 1.14 ±0.27 |
| 2 | 17.40 | 0.068, 0.006, −0.016 | 0.130, 0.524, 0.539 | 4.71 ±0.54 |
| 3 | 4.80 | 0, −0.070, 0.014 | 0.066, 0.0125, 0.086 | 0.827 ±0.093 |
| 4* | 0.82 | 0, 0, −0.019 | 1.8e-3, 1.8e-3, 1.3e-3 | 0.200 ±0.016 |
| 5* | 0.34 | 0, 0, 0 | 0.30e-3, 0.30e-3, 0.40e-3 | 0.179 ±0.014 |
| 6* | 0.09 | 0, 0, 0.032 | 0.15e-3, 0.15e-3, 0.04e-3 | 0.193 ±0.016 |

**Corrected, in the toolbox's standard frames (the recommended set)**

| Link | m (kg) | r (m) | Ixx, Iyy, Izz (kg·m²) |
|---|---|---|---|
| 1 | 13.0 (Tarn; not a base parameter) | 0, 0, 0 | Iyy 0.35 (about the waist axis) |
| 2 | 17.4 | −0.3638, 0.006, 0.2275 | 0.130, 0.524, 0.539 |
| 3 | 4.8 | −0.0203, **−0.014**, 0.070 | 0.066, 0.086, 0.0125 |
| 4 | 0.82 | 0, **−0.019**, 0 | 1.8e-3, 1.3e-3, 1.8e-3 |
| 5 | 0.34 | 0, 0, 0 | 0.3e-3, 0.4e-3, 0.3e-3 |
| 6 | 0.09 | 0, 0, 0.032 | 0.15e-3, 0.15e-3, 0.04e-3 |

- **What the set reproduces.**
  - AKB's own model, through the joint mapping: gravity to 4·10⁻¹⁴ N·m, M(q) to 2·10⁻⁴ kg·m².
  - 21 of AKB's 23 Table A3 inertial constants and all five gravity constants (g1 −37.2, g2 −8.44, g3 1.02, g4 0.249, g5 −0.0282 N·m), to 3 significant figures, with g = 9.81.
  - With the toolbox's +0.019, gravity is off by up to 0.31 N·m and M by up to 0.054 kg·m².
- **In URDF link frames** the centre of mass is (a_i, 0, 0) + Rx(α_i)·r_i and the inertia Rx(α_i)·I·Rx(α_i)ᵀ, still diagonal:
  - link 2: (0.068, 0.006, 0.2275), 0.13/0.524/0.539;
  - link 3: (0, 0.07, 0.014), 0.066/0.0125/0.086;
  - link 4: (0, 0, −0.019);
  - link 6: (0, 0, 0.032).
- **Link 3's published moments are not a rigid body's.** 0.066 + 0.0125 < 0.086 breaks the triangle inequality Ixx + Iyy ≥ Izz.
  - **Exact fix**: add δ = 0.01 kg·m² to link 3's ixx and iyy (normal to joint 3) and take δ from link 1's izz. Joint 3 is parallel to joint 2, which is normal to the waist axis, so δ·(I − z₃z₃ᵀ) on link 3 adds ½·δ·q̇1², the same as δ on link 1's waist moment.
  - **Result**: 0.076/0.0225/0.086 for link 3 and 0.34 for link 1's izz. M(q) and τ agree with the published set to 1.8·10⁻¹⁵ kg·m² and 7.1·10⁻¹⁵ N·m over 2 000 states. Link 3's rms extents become 0.06 × 0.12 × 0.04 m for 4.8 kg, a plausible forearm.
  - Raising only iyy (an earlier attempt) changes the dynamics slightly.
  - Link 1's Ixx = Iyy = 0.175 are placeholders that keep its tensor valid; only its izz enters.

### 3. Motors and drives

Referred to the motor side. Source: Corke 1996, Tables 2.9, 2.12–2.17 and 2.21; AKB Table 7 where it differs.

| Joint | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Gear ratio G (Corke; the toolbox's signs) | −62.6111 | 107.815 | −53.7063 | 76.03636 | 71.923 | 76.686 |
| G (AKB Table 7) | 62.61 | 107.36 | 53.69 | 76.01 | 71.91 | 76.73 |
| Jm, preferred (kg·m²) | 200e-6 | 200e-6 | 200e-6 | 33e-6 | 33e-6 | 33e-6 |
| G²·Jm, link side (kg·m²) | 0.78 | 2.32 | 0.58 | 0.19 | 0.17 | 0.19 |
| Km, preferred, back-EMF method (N·m/A) | 0.227 | 0.228 | 0.238 | 0.0675 | 0.0718 | 0.0534 |
| B, mean (N·m·s/rad) | 1.48e-3 | 0.817e-3 | 1.38e-3 | 71.2e-6 | 82.6e-6 | 36.7e-6 |
| Coulomb τC, + / − joint velocity (N·m) | 0.435 / −0.395 | 0.126 / −0.0709 | 0.105 / −0.132 | 11.2e-3 / −16.9e-3 | 9.26e-3 / −14.5e-3 | 3.96e-3 / −10.5e-3 |
| Stiction τs, + / − (N·m) | 0.569 / −0.588 | 0.141 / −0.0951 | 0.164 / −0.158 | 14.7e-3 / −21.8e-3 | 5.72e-3 / −13.1e-3 | 5.44e-3 / −9.21e-3 |
| Current-loop maximum (A) | 8.83 | 8.77 | 8.74 | 4.42 | 4.42 | 4.49 |
| Fuse (A) | 4 | 4 | 4 | 2 | 2 | 2 |
| Torque at the current-loop limit, link side (N·m) | 120 | 200 | 110 | 22 | 22 | 21 |
| Torque at the fuse, link side (N·m) | 56 | 97 | 52 | 10 | 10 | 10 |
| Velocity limit, back-EMF, link side (rad/s) | 1.92 | 1.51 | 2.40 | 5.34 | 5.09 | 5.74 |
| Acceleration limit, link side (rad/s²) | 13 | 30 | 55 | 49 | 55 | 48 |

- **Electrical.**
  - Armature resistance: 2.1 Ω for the base motors (low-speed test; Kawasaki and Tarn give 1.6 Ω). For the wrist motors 6.7 Ω (low-speed test), or 5.1 Ω (ARX on joint 6, Corke's preference); Kawasaki gives 3.83 Ω.
  - Inductance about 1 mH (0.83 mH measured on joint 6). The amplifier gives at most 40 V.
  - The Unimate drive is a current amplifier whose loop is flat to about 400 Hz and settles in under 0.5 ms. So an ideal current source with a limit is faithful at a 1 ms step.
- **Wrist coupling** (Corke Table 2.9): θm = G·θl with G45 = −1/G5, G46 = −1/G6, G56 = −13/72. So θm5 = θl4 + G5·θl5 and θm6 = θl4 + (13/72)·G6·θl5 + G6·θl6. The toolbox ignores it.
- **Encoders**: 1 000, 800, 1 000, 1 000, 1 000 and 500 counts per motor revolution. The position servo ran every 924 µs (1 143 Hz) and took setpoints every 28 ms. There was no tachometer: speed came from position differences.
- **The toolbox's sign conventions.** Its negative G1 and G3 encode the motor direction ("negative motor current results in positive motor torque"). That is why its Coulomb pairs for joints 1 and 3 look swapped against Corke's Table 2.12; this is consistent, not an error. Its Python model's comment calls Tc "[−, +]", but `Link.friction` uses Tc[0] for q̇ > 0. A model that takes magnitudes per direction (Tc⁺ for q̇ ≥ 0, Tc⁻ below) avoids the question.

### 4. Joint limits and named poses

| Source | J1 | J2 | J3 | J4 | J5 | J6 |
|---|---|---|---|---|---|---|
| Corke's `mdl_puma560`, citing Wang & Chen 1991 (recommended) | ±160° | −45…225° | −225…45° | −110…170° | ±100° | ±266° |
| Corke 1996 Table 2.1 | ±180° | −170…165° | −160…150° | ±180° | −10…100° | ±180° |
| ARTE `parameters.m` | ±160° | ±110° | ±135° | ±266° | ±100° | ±266° |

Corke 1996 does not state the zero convention for its limits. In the toolbox's convention they would exclude qn and every tool-down pose in front of the robot, so they are probably in another convention. The community URDF (`nimasarli/puma560_description`) uses ±90° placeholders and has no inertial data.

| Pose | q | What it is | Wrist position from the shoulder (m) | Singular? |
|---|---|---|---|---|
| qz | 0 | L shape: upper arm along +x, forearm up | (0.4521, −0.15005, 0.4318) | yes, the wrist (q5 = 0) |
| qr | [0, π/2, −π/2, 0, 0, 0] | READY, arm straight up | (0.0203, −0.150, 0.8636) | the wrist; near the stretched elbow |
| qs | [0, 0, −π/2, 0, 0, 0] | stretched along x | (0.8636, −0.1501, −0.0203) | the wrist; near the stretched elbow |
| qn | [0, π/4, −π, 0, π/4, 0] | nominal | (0.5963, −0.1501, −0.0144) | no; σ_min 0.19 |

MATLAB's toolbox 10 writes qn with q3 = +π, outside J3's range; the Python toolbox uses −π.

### 5. The circle and the start pose

- **The research's first proposal** was a start at [0, 60°, −180°, 0, −60°, 0] with a circle centred on the tool (radius 0.15 m). Over it: q1 −15…16°, q2 41…77°, q3 −205…−148°, q5 −73…−52°, at least 20° from the limits, σ_min 0.168, condition number ≤ 6.8.
  - Peak joint speeds at 2.5 s per turn: 0.88, 0.75, 1.21, 0, 0.48, 0.88 rad/s.
  - Peak link torques: 6.0, 43, 9.0, 0, 0.3, 0.5 N·m.
  - Currents within the fuses, and under 25 V of the 40 V.
  - A vertical circle is not recommended: q5 falls to 12° and the wrist reaches 1.9 rad/s.
- **A circle through the tool from that pose fails.** Design B found that with its centre towards the base q3 reaches −227°, 1.6° beyond the limit. With its centre away, the circle crosses the elbow singularity (σ_min 0, 13.6 mm of error).
- **The recommended start: q0 = [0, 40°, −150°, 0, −70°, 0]** (B's), with the tool pointing down (R = diag(−1, 1, −1)).
  - The flange starts at (0.7296, −0.1500, 0.7264) m above the floor.
  - The circle runs through it with its centre at (0.580, −0.150, 0.726) m.
  - Over it: q1 −15…16°, q2 39…74°, q3 −207…−149°, q4 0, q5 −70…−48°, q6 −15…16°; 18.5° inside every limit; σ_min 0.175…0.256; peak joint speeds 0.88, 0.73, 1.21, 0, 0.50, 0.88 rad/s.
- **Other placements from this pose** (this file's scan):
  - Centred away from the base, or to either side: the circle leaves the arm's reach (σ_min reaches 0).
  - Radius 0.2 m: q3 reaches −222° (3.4° from its limit).
  - A 2 s period: j3 peaks at 1.51 rad/s.
- **Gravity at q0**: 0, 35.71, 7.84, 0, 0, 0 N·m, held by 0, 1.453, 0.614, 0, 0, 0 A.
- **The mass matrix diagonal at q0**: M_ii 4.055, 4.757, 0.910, 0.193, 0.171, 0.194 kg·m² (with the rotors). The plant's acceleration per unit torque, b = (M⁻¹)_ii, is 0.249, 0.226, 1.17, 5.18, 5.85, 5.15 rad/s² per N·m.
- **How much the inertia varies.** M11 varies by a factor of 2.2 over the workspace (2.34 at qr, 5.04 at qs), so a fixed PI's bandwidth varies by about 1.5×. Gains are therefore computed at the start pose.
- **Motor currents, harmonics over one turn** (at the first proposal's pose):
  - i2: DC 1.16 A, 1f 1.15, 3f 0.21, 5f 0.11 A;
  - i1: 1f 2.45, 2f 0.63, 3f 0.55, 4f 0.50 A. Even harmonics appear because friction differs by direction, and Coulomb friction makes i1 nearly a ±2 A square wave.

### 6. Control laws

| Law | Source | What it needs | Prototype (rms error on the circle) |
|---|---|---|---|
| Resolved rate, q̇ = J⁻¹(ẋ_d + K·e) | Whitney 1969; Corke RVC ch. 8 | no dynamics model | drifts without position feedback; ignores the target acceleration; integrated joint references wind up when the arm is blocked (Nakanishi et al. 2008) |
| Closed-loop IK to joint references, then independent joint servos (design B) | Sciavicco & Siciliano; Siciliano §3.7 | J and FK on the reference | B: 0.048 mm with model feedforward; within a few per cent of the cascade in every case. Twice the work per step if continuous |
| Resolved acceleration + computed torque, a* = ẍ_d + K_D·ė + K_P·e, τ = M·J⁻¹(a* − J̇q̇) + h | Luh, Walker & Paul 1980; Siciliano §8.6.3 | the full model in the loop | 0.005 mm exact; **3.4 mm with masses ×0.8; 15 mm without friction compensation** |
| Khatib's operational space, τ = Jᵀ(Λ(a* − J̇q̇) + μ + p) | Khatib 1987 | Λ = J⁻ᵀMJ⁻¹ | the same as the row above for a 6-joint arm with a 6-D task, away from singularities. It differs only with redundancy, force control or near singularities |
| Jacobian-transpose PD + gravity, τ = JᵀK_P·e − K_D·q̇ + g | Takegaki & Arimoto 1981; Siciliano §8.6.2 | g(q) | Lyapunov-stable for regulation; lags on a moving circle |
| **Cascade: task law on the measured pose → J⁺ → PI speed loops + RNEA feedforward** (recommended) | Siciliano §8.6.1; Corke; industry | J, J̇q̇, RNEA for the feedforward only | **0.049 mm**; 0.19 mm with masses ×0.8; feedback alone 1.8 mm |

- **The comparison that decides it.** Nakanishi, Cory, Mistry, Peters & Schaal (IJRR 2008) compared velocity-, acceleration- and force-level laws on a 7-DOF arm (a figure-8 of 0.225 m in 2–4 s). A simplified acceleration-based law was best for tracking, tuning and robustness to model error. Velocity-based laws were "straightforward to implement and achieved overall good performance". Their gains were K_p 50 and K_o 1000 at the acceleration level, 10 and 50 at the velocity level, with a quaternion orientation error.
- **Khosla & Kanade** (IEEE TRA 1989, CMU DD Arm II, 2 ms) found that computed torque beats independent joint control while torques stay unsaturated, and that Coriolis and centrifugal compensation matters even at low speed.
- **Independent joint control** (Siciliano §8.3; Spong; Corke RVC ch. 9) treats each axis as J_eff·q̈ + B_eff·q̇ = G·τ_m − d, with the coupling and gravity as the disturbance d. On the PUMA the rotors dominate the low joints' inertia (G²·Jm 0.78, 2.32, 0.58 kg·m² against links 3.13, 2.04, 0.32 at qz), so the arm is nearly decoupled at low speed.
- **Coulomb friction is large**: Tc × G is about 25 N·m at joint 1 and about 14 N·m at joint 2. Without integral action or friction compensation it dominates the error. The feedforward should use the reference speed's sign, not the measured one, to avoid chatter.
- **Gains.**
  - Task: k_x = 10 1/s.
  - Axis PI: ω_v = 30 rad/s, Kv = 2ω_v/b, Ki = ω_v²/b.
  - Sample at 20× the loop bandwidth or more: Ts = 1 ms (the PUMA servoed at 0.875 ms; Khosla & Kanade at 2 ms; the Franka FCI at 1 kHz).
- **A start without a jump.** Feedforward needs analytic v_d and a_d. Starting a sine at t = 0 jumps the velocity and gave tens of mm of transient. A quintic ramp of the phase rate over 0.5 s gave 0.2 mm (control research). Easing the phase, not the amplitude, keeps the path exactly a circle.

**Measured on the merged law** (A's cascade on B's start pose and circle; Ts = 1 ms; speed from the encoder difference over Ts; gains from b at q0):

| Case | rms / max (mm) | Orientation (°) |
|---|---|---|
| PI + model feedforward | 0.049 / 0.070 | 0.0012 |
| PI, no model | 1.81 / 4.3 | 0.31 |
| P only, no model | 14.4 / 22.1 | 3.4 |
| P only, no model, and no task velocity term | 43.9 / 52 | 3.4 |
| Model feedforward, masses ×0.8 | 0.19 / 0.86 | 0.13 |
| Model feedforward, Ts 10 ms | 0.49 / 0.69 | 0.014 |
| Model feedforward, link 2 2 mm longer in the model | 2.0 / 2.0 | 0.0013 |
| Model feedforward without its friction term | 1.76 / 4.3 | 0.28 |
| PI, no model, ω_v = 60 | 0.47 / 1.28 | 0.09 |
| PI + model feedforward with ideal speed (A's original pose and spiral) | 0.0043 / 0.014 | 0.001 |

The last row is why the speed must be differenced: an ideal speed reading makes the headline ten times better than the real PUMA could be.

### 7. Singularities of the offset PUMA

Checked numerically on the DH model:
- **The wrist**: q5 = 0 (axes 4 and 6 aligned).
- **The elbow**: the arm straight, q3 = −90° + atan(a3/d4) = −87.3°. This is why qr and qs are singular.
- **The shoulder**: the wrist centre at a radial distance d3 = 0.150 m from the waist axis, where the left and right solutions merge (Corke's IK refuses r < |d3|).

How to handle them:
- **Damped least squares**: J⁺ = Jᵀ(JJᵀ + λ²I)⁻¹ (Wampler 1986; Nakamura & Hanafusa 1986), with variable damping λ² = λ_max²(1 − (σ_min/ε)²) below ε (Maciejewski & Klein 1988; Chiaverini 1997; Siciliano §3.5.2).
- **Plain DLS on the full 6×6 J mixes metres and radians.** Through the wrist singularity it gave 8–59 mm of error.
- **Singularity decoupling** (Siciliano §3.3.1; Pieper's spherical wrist) takes the wrist centre exactly from joints 1–3 and damps only the 3×3 wrist block. It gave 0.02 mm, 1–4° of orientation error, and joint speeds of at most 2.6–6 rad/s against 94 rad/s with the plain inverse.
- **Task priority** (Nakamura, Hanafusa & Yoshikawa 1987; Siciliano & Slotine 1991) matters only with redundancy.
- **For the example**: keep the circle away (σ_min ≥ 0.175), show σ_min as a signal, keep DLS as a dormant net, and give singularities an example of their own.
- **A cheap trigger**: 1/‖J⁻¹‖_F ≥ ε is a lower bound on σ_min, so σ_min (4.7 µs by Jacobi on JᵀJ) is computed only when the bound fires or a Sink reads it.

### 8. Orientation error

- **Representations** (Caccavale, Natale, Siciliano & Villani 1998):
  - Euler angles have representation singularities.
  - Angle/axis and the unit quaternion work with the geometric Jacobian.
  - The quaternion error e_o = η·ε_d − η_d·ε − ε_d × ε (Siciliano §3.7.3) is global up to the quaternion's sign.
  - The cross-product form ½Σ(n × n_d + s × s_d + a × a_d) (Luh, Walker & Paul) equals sin θ·k and holds below 90°.
- **The trap at tool-down, measured for this plan.** The tool-down orientation is a half turn, so its quaternion has a scalar part of 0. Taking the quaternions of R and R_d separately, each with its scalar part made ≥ 0 (a common convention), gave the error the wrong sign in 9 847 of 20 000 random rotations within 2° of tool-down: positive feedback. B's prototype saw the wrist turn a full revolution and the tool miss by 103 mm. A prototype extraction that happened to keep its branch showed no flip, so the behaviour depends on the extraction, which is worse.
- **The fix**: take the relative rotation R_e = R_d·Rᵀ first, then its quaternion by Shepperd's method with η_e ≥ 0, and e_o = ε_e. R_e is near the identity, so nothing is in doubt: exact to 2.1·10⁻¹⁷ over the same 20 000 rotations.
- **The angle**: acos((tr(R_dᵀR) − 1)/2) reads 0 for a 10⁻⁹ rad error, while 2·atan2(‖ε_e‖, η_e) reads it exactly.

### 9. URDF

- **Structure** (urdfdom): a tree of links and joints with one root link; urdfdom accepts only version 1.0.
  - Joint types: revolute, continuous, prismatic, fixed, floating, planar.
  - `<origin xyz rpy>` places the child's frame in the parent's, with R = Rz(yaw)·Ry(pitch)·Rx(roll) (`setFromRPY`).
  - A missing `<axis>` is (1, 0, 0), and a missing origin the identity (`joint.cpp`).
  - urdfdom logs an error for a revolute or prismatic joint without `<limit>`.
- **Geometry**: box, cylinder (along local z), sphere and mesh; no capsule (Drake has `drake:capsule`).
  - An inertial origin may carry rpy, which rotates the inertia.
  - Materials come by name or as inline rgba.
  - Joints may carry `<dynamics damping friction>`, `<mimic>` and `<safety_controller>`.
- **No actuators.** ROS `<transmission>` carries `<mechanicalReduction>`. Rotor inertia is not standard: Drake reads `drake:rotor_inertia` and `drake:gear_ratio` "only … for reflected inertia calculations, and not as a torque multiplier", and MuJoCo calls it `armature`. So motors, gears and friction belong in the diagram, and the rotor's reflected inertia on the mass matrix's diagonal.
- **Browser tools.**
  - urdf-loader (three.js) parses with `DOMParser`, applies rpy as a 'ZYX' Euler, scales unit primitives, and turns cylinders by π/2 about x because three.js cylinders stand along y.
  - ros3djs computes no kinematics; it follows ROS TF and is useless standalone.
  - The viewers found (qkrdkwl9090/urdf-viewer, vrtnis robot-web-viewer, URDF-Studio) all build on three.js and urdf-loader.
- **Parsing in the page.** Node has no `DOMParser`, so the page needs its own tag reader (about 35–50 lines) to share code with the tests.
- **Meshes** cannot be fetched by a standalone page.
- **Provenance.** The build strips JavaScript comments, not XML comments, so an embedded URDF must have none.

### 10. Rigid-body dynamics in JavaScript

Allocation-free code for 6 links, on Node 22 (three prototypes; the ranges are theirs):

| Evaluation | µs |
|---|---|
| Forward kinematics (all link poses) | 0.67–1.15 |
| FK + geometric Jacobian | 0.78–1.77 |
| J̇q̇ (RNEA with q̈ = 0 and no gravity) | 0.87–2.3 |
| RNEA | 1.0–2.06 |
| CRBA, M(q) | 2.5–3.8 |
| Forward dynamics: RNEA bias + CRBA + Cholesky | 2.95–5.10 |
| ABA, dense 6×6, unoptimised (the oracle) | 13.6–17.1 |
| σ_min(J), Jacobi on JᵀJ | 4.7 |

- **Why CRBA and not ABA.** Featherstone & Orin (2000) report ABA beating CRBA only beyond about 9 links, and "roughly comparable" at 6. The controller needs M(q) anyway. And M, h and a Solve can be opened as blocks, which ABA cannot.
- **Checks that passed**:
  - against Corke's Robotics Toolbox for Python 1.5.0 (run for this research, pedestal dropped, 8 states): M 8.9·10⁻¹⁶, g 7.1·10⁻¹⁵, τ 7.1·10⁻¹⁵, FK 5.6·10⁻¹⁷, J 2.2·10⁻¹⁶;
  - CRBA against ABA, 1.7·10⁻¹³;
  - RNEA∘FD, 2.8·10⁻¹⁵;
  - J and J̇q̇ against finite differences, 2.8·10⁻¹⁰ and 1.9·10⁻⁹;
  - energy over 5 s of free swing at 1 ms, 2.8·10⁻¹⁰ J against 72 J.
- **Reference values from the toolbox's own tests** (`tests/test_DHRobot.py`), with the toolbox's +0.019 and its rotors:
  - gravload(qn) = [0, 31.6399, 6.0351, 0, 0.0283, 0];
  - inertia(qn) row 1: 3.6594, −0.4044, 0.1006, −0.0025, 0, 0; M22 4.4137, M33 0.9378, M44 0.1925, M55 0.1713, M66 0.1941, M23 0.3509;
  - gravload(qz) = [0, 37.4837, 0.2489, 0, 0, 0].

  With the corrected set: gravload(qn) = [0, 31.4237, 5.8190, 0, 0.0283, 0] and gravload(qs) = [0, 45.7013, 8.4665, …]; M11 3.6329, M12 −0.4075, M13 0.0973, M22 4.3868, M23 0.3240, M33 0.9109.
- **Cost of a run**: 5 s at 1 ms is 20 000 evaluations. The plant alone takes 87–120 ms. A whole loop, as a diagram through a compiler with fast paths, takes 0.3–0.6 s.
- **Step size and friction.** The smoothed Coulomb friction sets the stiffest mode at rest, Tc·G²/(ω_s·J_eff): 213 1/s on joint 1 with ω_s = 2 rad/s at the motor. RK4 at 1 ms was within 2.3·10⁻⁹ rad of a 0.05 ms reference. Modelling the current loop would need about 0.25 ms steps.

### 11. Rendering without dependencies

- **Why our own.** three.js r160 minified is 671 KB against the whole page's 696–751 KB, and loading it from a CDN fails the standalone test.
- **The prototype**:
  - 375 lines, 27 KB, 9.8 KB gzipped;
  - URDF reading and unit meshes, WebGL1 Lambert shading with a headlight;
  - lines as depth-tested screen-space ribbons, dashed by arc length;
  - the Canvas2D fallback, CPU ray picking against analytic primitives;
  - orbit, pan, zoom and WASD/QE flying;
  - theme colours read from the CSS variables; the corner triad.

  It rendered in headless Chromium in both themes and in fallback. Picking hit "base" on the pedestal, "link2" on the upper arm and nothing on empty space. Its JavaScript took about 1.3 ms per frame.
- **Lines need ribbons.** `gl.lineWidth` is stuck at 1: Chromium reports `ALIASED_LINE_WIDTH_RANGE` [1, 1], and three.js documents that WebGL ignores line width.
- **The fallback is required.** Chrome stopped silently falling back to software WebGL (deprecated from Chrome 130; one vendor's policy page gives M139 for when it fails). A context now fails on machines without a usable GPU, which includes some office PCs, VMs and remote desktops. Canvas2D took 45 ms per frame for 2 700 triangles in the headless VM, so it needs coarser meshes. It shows painter's-algorithm artefacts where primitives overlap.
- **Picking on the CPU**: MDN warns that `readPixels` stalls rendering.
- **Not handled by the prototype**: a lost WebGL context (`webglcontextlost`, `webglcontextrestored`).

## Recommendations

1. **Use the cascade**: the task law on the measured pose (FK of the encoders), q̇* = J⁺v* and q̈* = J⁺(a* − J̇q̇) as the transformation, six PI speed loops, and RNEA feedforward with friction by the reference speed. Offer "PI + model feedforward", "PI, no model" and "P only, no model" as variants. Do not offer Khatib's law or resolved acceleration as separate variants; say in the block's text that they are the same law here.
2. **Measure speed as the PUMA did**, the position difference over Ts. Quote the tracking error with that sensor.
3. **Robot data**: Corke's standard DH re-indexed as URDF, with the pedestal (0.67183 m) and the flange (56.25 mm). AKB's inertias with link 4 at −0.019 and link 3 at −0.014. Link 3's moments regrouped with link 1's waist moment (δ = 0.01), so the parser can refuse non-physical inertias. Link 1's mass 13 kg. Corke's preferred motor values. The toolbox's (Wang & Chen's) limits.
4. **Start at q0 = [0, 40°, −150°, 0, −70°, 0]** with the tool down. Draw a horizontal circle of 0.15 m, 2.5 s per turn, through the tool's start point with its centre towards the base, with the phase rate eased in over 0.5 s.
5. **Take the orientation error from the relative rotation's quaternion** (η ≥ 0), and the displayed angle from atan2. Test at tool-down.
6. **Dynamics**: CRBA + RNEA + Cholesky, rotors as armature on M's diagonal, ABA only as a test oracle. Motors with an ideal current source and a limit, and friction as published (motor side, per direction, smoothed with a stated validity).
7. **Our own WebGL1 renderer** with ribbons, a required Canvas2D fallback, CPU picking and context-loss handling; CAD navigation as decided. No library.
8. **Our own XML reader**, shared by the page and the tests. Refuse floating, planar and (for now) prismatic joints, Xacro, and non-physical inertias, each with a sentence. Draw meshes as primitives, and put no XML comments in the embedded URDF.
9. **Show the shoulder motor's current (i2).** The waist current (i1) is the alternative for a friction comb.
10. **Keep singularities out of the prime example.** Show σ_min, keep DLS dormant, and give singularity decoupling its own example later.

## Pitfalls

- **The quaternion sign at tool-down** (§8): about half of all small errors get the wrong sign when R and R_d are converted separately. The tool missed by 103 mm in B's prototype.
- **acos for the angle** reads 0 below about 10⁻⁸ rad.
- **The obvious start pose** puts q3 1.6° past its limit on a circle through the tool; from the recommended pose, circles away from or beside the base leave the reach. Check placements on the kinematics before offering them.
- **Link 3's published moments are non-physical** (0.066 + 0.0125 < 0.086). A strict parser refuses them, and a lax one ships a body that cannot exist. Regroup them, and do not just raise one moment.
- **The toolbox's link-4 centre of mass has the wrong sign** (+0.019). Gravity is then off by up to 0.31 N·m.
- **`mdl_puma560akb.m`** has link 3's Izz as 0.066 (AKB says 0.086, confirmed by its constant I6), Jm3 299e-6 (AKB's 0.827 kg·m² gives 287e-6) and Jm6 35e-6 (Corke gives 33e-6).
- **AKB's Table A3 constants I1 = 1.43 and I3 = 1.38** do not follow from AKB's own Tables 4–6 (they give 1.553 and 1.602), so AKB's simplified a11 is low by up to 0.38 kg·m².
- **The shoulder offset d3**: 0.15005 m in the toolbox, 0.1254 m in Corke 1996 Table 2.1, 0.1501 in AKB. And d4 is 0.4318 against AKB's 0.4331. Pick one source per model.
- **Motor inertia**: Corke's 0.78/2.32/0.58 kg·m² (link side) against AKB's 1.14/4.71/0.83. Joint 2 differs by a factor of 2, and Corke calls AKB's anomalous. Tarn and Kawasaki give 18–20e-6 for the wrist motors.
- **Torque constants vary by source**: Corke 0.227/0.228/0.238/0.0675/0.0718/0.0534; Armstrong-derived 0.189/0.219/0.202/0.075/0.066/0.066; Paul 0.255/0.220/0.239/0.078/0.070/0.079; Kawasaki 0.253/0.095. Take one source (Corke's).
- **Friction across sources**: Corke's Coulomb values are 27/13.6/5.6/0.85/0.67/0.30 N·m on the link side, against AKB's break-away torques of 6.3/5.5/2.6/1.3/1.0/1.2 N·m. These are different robots and different methods.
- **Coulomb friction as sign(q̇) in fixed-step RK4** is wrong at the reversals a circle produces. Smooth it (tanh over ω_s) and say what that misses: a joint creeps under a steady load below ω_s instead of sticking.
- **Ideal speed sensing** made a 0.0043 mm headline out of a 0.049 mm loop.
- **A sine started at t = 0** jumps the velocity: tens of mm of transient with feedforward. Ease the phase.
- **Easing the amplitude** draws a spiral, not the circle the person sees dashed.
- **Plain DLS on the full Jacobian** mixes metres and radians (8–59 mm through the wrist singularity).
- **The toolbox ignores the wrist's gear coupling.** Motor 6 sees (13/72)·G6·q̇5 on this circle.
- **Joint `<dynamics friction>` in a URDF plus motor friction counts friction twice.**
- **rpy order**: urdfdom's R = Rz·Ry·Rx about fixed axes, and a three.js Euler must be 'ZYX'.
- **Cylinders** stand along z in URDF and along y in three.js.
- **`gl.lineWidth`** is 1 on Chromium.
- **Software WebGL is gone** from Chrome, so a canvas fallback is required. Headless checks need `--enable-unsafe-swiftshader`.
- **XML comments survive the build's comment stripping**, so an embedded URDF must have none.
- **MATLAB toolbox 10's qn** has q3 = +π, outside J3's range.

## Sources

Checked online, or read in full where noted:
- Armstrong, Khatib & Burdick, "The explicit dynamic model and inertial parameters of the PUMA 560 arm", ICRA 1986, pp. 510–518, DOI 10.1109/ROBOT.1986.1087644. PDF: https://authors.library.caltech.edu/records/rmwaa-ysc96 (the Stanford copy returned HTTP 503).
- Corke, *Visual Control of Robots* (1996), chapter 2 (Tables 2.1, 2.3, 2.4, 2.9, 2.12–2.17, 2.21; §2.3.2.3 inductance; §2.3.3 the current loop): https://docs.petercorke.com/pdf/blue-book.pdf ; https://petercorke.com/books/the-blue-book/
- Corke's Robotics Toolbox for MATLAB, `models/mdl_puma560.m` and `mdl_puma560akb.m`: https://github.com/petercorke/robotics-toolbox-matlab
- Corke's Robotics Toolbox for Python 1.5.0, `models/{DH,ETS,URDF}/Puma560.py`, `tests/test_DHRobot.py` and `ikine_a` (installed and run locally to make the reference values): https://github.com/petercorke/robotics-toolbox-python
- ARTE, `robots/UNIMATE/puma560/parameters.m`: https://github.com/4rtur1t0/ARTE
- PUMA/Unimate controller (1 143 Hz joint loop, 28 ms setpoints, current amplifier, speed from position differences): https://tams.informatik.uni-hamburg.de/lectures/2016ss/vorlesung/itr/doc/ItR_Lecture_09.pdf
- Siciliano, Sciavicco, Villani & Oriolo, *Robotics: Modelling, Planning and Control*, Springer 2009 (section numbers checked against the front matter): https://link.springer.com/content/pdf/bfm:978-1-84628-642-1/1
- Luh, Walker & Paul, "Resolved-acceleration control of mechanical manipulators", IEEE TAC 25(3):468–474, 1980 (citation): https://scholars.lib.ntu.edu.tw/bitstream/123456789/154693/1/07.pdf
- Khatib, "A unified approach for motion and force control of robot manipulators: the operational space formulation", IEEE J. Robotics & Automation 3(1):43–53, 1987: https://colab.ws/articles/10.1109/JRA.1987.1087068
- Nakanishi, Cory, Mistry, Peters & Schaal, "Operational space control: a theoretical and empirical comparison", IJRR 27(6):737–757, 2008 (read in full): https://is.mpg.de/publications/nakanishi_ijrr_2008
- Caccavale, Natale, Siciliano & Villani, "Resolved-acceleration control of robot manipulators: a critical review with experiments", Robotica 16:565–573, 1998: https://www.cambridge.org/core/journals/robotica/article/resolvedacceleration-control-of-robot-manipulators-a-critical-review-with-experiments/1DA8BFE6631B5709AFA96039A4F65C0F
- Wampler 1986 and Nakamura & Hanafusa 1986 (damped least squares): https://link.springer.com/chapter/10.1007/978-94-015-9064-8_48
- Buss, an introduction to damped least squares: https://courses.cs.washington.edu/courses/cse599j/12sp/papers/DampedLeastSquares.pdf
- Chiaverini, IEEE TRA 13(3):398–410, 1997 (citation via secondary sources): https://www.cambridge.org/core/journals/robotica/article/an-online-task-modification-method-for-singularity-avoidance-of-robot-manipulators/3DD493BDB30B7C45BD7ECF23D8D43754
- Whitney, "Resolved motion rate control", IEEE Trans. Man-Machine Systems 10(2):47–53, 1969: https://ntrs.nasa.gov/citations/19890010493
- Paul, Shimano & Mayer, "Kinematic control equations for simple manipulators", IEEE SMC 11(6):449–455, 1981: https://www.scientific.net/AMM.456.252
- Khosla & Kanade, "Real-time implementation and evaluation of computed-torque scheme", IEEE TRA 5(2):245–253, 1989: https://www.ri.cmu.edu/publications/real-time-implementation-and-evaluation-of-computed-torque-scheme
- Takegaki & Arimoto 1981 (citation): https://robogaku.jp/en/history/integration/I-2005-2.html
- Franka FCI at 1 kHz: https://support.franka.de/docs/requirements
- urdfdom (`urdf_parser/src/joint.cpp`, `link.cpp`, `model.cpp`) and urdfdom_headers `pose.h`: https://github.com/ros/urdfdom (wiki.ros.org/urdf/XML could not be fetched; the conventions come from the code)
- Drake parsing (rotor inertia, gear ratio, capsule): https://drake.mit.edu/doxygen_cxx/group__multibody__parsing.html
- MuJoCo `armature`: https://mujoco.readthedocs.io/en/stable/XMLreference.html#body-joint-armature
- urdf-loader v0.12.7 (`src/URDFLoader.js`, `urdf-viewer-element.js`): https://github.com/gkjohnson/urdf-loaders
- ros3djs (`src/urdf/Urdf.js`): https://github.com/RobotWebTools/ros3djs
- Other viewers: https://github.com/qkrdkwl9090/urdf-viewer ; https://www.sourcepulse.org/projects/27366930
- three.js on line width: https://threejs.org/docs/pages/LineBasicMaterial.html
- MDN, WebGL best practices (`readPixels`): https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
- Chrome's removal of the software WebGL fallback: https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM/m/oLrB5up_BwAJ ; https://chromium.googlesource.com/chromium/src/+/798e59c5275d4131797e8ea2e96e6c6000256b58/docs/gpu/swiftshader.md ; https://developer.samsung.com/browser/policy/enable-unsafe-swift-shader.html
- Featherstone & Orin, "Robot dynamics: equations and algorithms", ICRA 2000: https://royfeatherstone.org/papers/icra00.pdf
- Featherstone, *Rigid Body Dynamics Algorithms*, Springer 2008; the ABA operation count from https://royfeatherstone.org/papers/sparse.pdf (seen in a search snippet, not read in full)

Cited but not accessed: Corke & Armstrong-Hélouvry, ICRA 1994 (DOI 10.1109/ROBOT.1994.351360) and the Robotica 1995 meta-study (torque constants); Wang & Chen 1991 (limits); Paul & Zhang, IJRR 5(2):32–44, 1986 (closed-form IK); Maciejewski & Klein 1988; Nakamura, Hanafusa & Yoshikawa 1987; Siciliano & Slotine 1991; Yoshikawa 1985 (manipulability); Yuan 1988 (quaternion error); Karnopp 1985 (stick–slip); Walker & Orin 1982 (CRBA); Featherstone 1983 (ABA); Craig, *Introduction to Robotics*, chs. 4, 7, 9, 10 (from memory); Spong, *Robot Modeling and Control* (independent joint control, from memory).
