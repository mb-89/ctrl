# Research: the Hu–Lin variable-gain controller

Reader: whoever builds or judges the Hu–Lin controller in Loop Tuner and its example. The person's words are in [input 33](../input/2026-10-25-33-hu-lin-controller.md). **Status: done (2026-10-25); built as the designed type `huLin` and the System library's *Variable gain against anti-windup*.**

**Bottom line.** The controller is T. Hu and Z. Lin, "On improving the performance with bounded continuous feedback laws" (IEEE TAC 2002), the continuous form of Wredenhagen and Bélanger's piecewise-linear LQ control: LQR gains on nested invariant ellipsoids, the gain chosen by the ellipsoid the state lies on, so it grows as the error shrinks and the input never saturates; Megretski's level-set rule is the scheduling variable. Built in the page from the plant (discrete LQR at Ts, 30 levels, interpolated). On a servo axis with a torque limit it beats clipped LQR (0.5 % against 11 % overshoot on a large step, never at the limit) and matches a PID with clamping on the large step while settling the small step after it four to six times faster; with Hu and Lin's high gain k = 2 it is the best of all on both steps. On a chain of three integrators, where clipping a high gain opens the loop for good, it is the only one of the two that settles. It has no integral, so a load leaves an offset. **Verdict: a good thing for plants with integrators and a hard input limit whose large steps saturate a stiff loop; offer it as a designed variant beside LQR** (decisions.md, v2.9).

Marks: **(verified)** read in the primary source or its publisher's record; **(secondary)** read in a paper that describes it; **(inference)** our reasoning, not a source.

## The paper the person remembers

T. Hu and Z. Lin, **"On improving the performance with bounded continuous feedback laws"**, *IEEE Transactions on Automatic Control* 47(9), 1570–1575, September 2002, doi:10.1109/TAC.2002.802739; a conference version with the same title at the 41st IEEE CDC, Las Vegas, 2002, vol. 4, 4543–4548, doi:10.1109/CDC.2002.1185091 (verified: Crossref). The abstract (verified, OpenAlex's record of the publisher's abstract):

> We present controller design methods to smooth the discontinuity resulting from a piecewise linear control law which was proposed to improve the convergence performance for systems with input constraints. The continuous control laws designed in this paper are explicit functions of the state and are easily implementable. We also show that the convergence performance can be further improved by using a saturated high-gain feedback law. The efficiency of the proposed methods is illustrated with the PUMA 560 robot model.

Its references (verified, OpenAlex) are the family the person describes: Megretski 1996 (scheduled low gain), Wredenhagen and Bélanger 1994 (piecewise-linear LQ), Wredenhagen 2002 (interpolation functions), Teel 1995 (scheduling a family of H∞ controllers), Suárez, Álvarez-Ramírez and Solís-Daun 1997 (bounded inputs with eigenvalue placement), Hu and Lin 2000 (enlarging the basin of attraction) and their book (*Control Systems with Actuator Saturation: Analysis and Design*, Birkhäuser 2001).

The full text is closed (no open copy found: OpenAlex lists none, the authors' pages carry none). What the law is in detail is therefore taken from the work it smooths and from the papers that describe the same family (below).

## The scheme: the piecewise-linear law it smooths

G. F. Wredenhagen and P. R. Bélanger, "Piecewise-linear LQ control for systems with input constraints", *Automatica* 30(3), 403–416, 1994 (verified: the citation; secondary: the content). The law's gain increases as the error approaches the origin, and input bounds are respected without saturation: a family of LQ gains, each with its positively invariant ellipsoid, the ellipsoids nested; the controller uses the highest LQ gain whose ellipsoid holds the state. Demonstrated on the linearised simple pendulum and the PUMA 560 (secondary, the publisher's abstract as quoted by search). A discrete-time version follows from the discrete Riccati equation (secondary). Switching between ellipsoids makes the law discontinuous: the discontinuity Hu and Lin smooth.

## The continuous form: the low-gain family scheduled on its level set

Z. Lin and A. Saberi (1993) and Lin (1998): the low-gain family P(ε) from AᵀP + PA − PBBᵀP = −Q(ε), Q(ε) > 0 increasing, Q → 0 as ε → 0 (usually Q = εI); for a plant with no eigenvalue in the open right half-plane P(ε) → 0, A − BBᵀP(ε) is Hurwitz and dP/dε > 0 (secondary: Grognard, Sepulchre and Bastin, *Automatica* 38, 2002, sect. 2, read in full).

For one ε, the largest level set of V = xᵀP(ε)x inside which |BᵀP(ε)x| ≤ 1 holds is xᵀP(ε)x ≤ 1/(BᵀP(ε)B) (Cauchy–Schwarz); inside it the linear law never saturates and V falls, so it is invariant.

**Megretski's scheduling** (A. Megretski, "L2 BIBO output feedback stabilization with saturated control", 13th IFAC World Congress, San Francisco, 1996, 435–440; secondary, quoted in Grognard et al., eq. (4)): choose at every state the largest ε that still puts x inside its own ellipsoid,

  ε(x) = max{ ε ∈ (0, 1] : (xᵀP(ε)x)(BᵀP(ε)B) ≤ 1 },  u = −BᵀP(ε(x)) x.

Then x lies on the boundary of the guaranteed region of attraction, |u| ≤ 1 everywhere, and V(x, ε(x)) decreases along the solutions in the whole state space; far away ε is small, and it rises as the state approaches the origin (secondary, Grognard et al.). This is the person's controller: the gain grows as the error shrinks, the input stays near its limit and never saturates, the loop is never opened. **The scheduling variable is ε(x)**, the level of the nested ellipsoid the state lies on.

Grognard et al. compare it, on the double integrator ẋ1 = x2, ẋ2 = u, |u| ≤ 1, Q(ε) = diag(ε⁴, 2ε²) (u = −ε²x1 − √3 ε x2), from (−10, 0): 10.25 s to reach the local ellipsoid T(1) with Megretski's schedule, 6.79 s with theirs, 5.64 s time-optimal (verified in their paper, sect. 5). Raising the gain by k > 1 with saturation, u = −sat(k BᵀP x), keeps the region (the infinite gain margin of Riccati laws; Saberi, Lin and Teel 1996); k → ∞ is a sliding mode along BᵀPx = 0 (verified, Grognard et al. sect. 2). This is the "saturated high-gain feedback" of Hu and Lin's abstract (inference).

## What we could not read, and what we decided

The full text of Hu and Lin 2002 is closed: no copy was found (OpenAlex: closed access, no repository copy; the authors' pages list it without a file; the CDC version likewise). So the paper's exact smoothing formula and its PUMA 560 numbers are not known here. What is known for sure is its abstract, its references and the two works it builds on, which say what the law does. Our build therefore follows those and marks what is ours:

- **The family** (as Lin's low gain, Megretski and Wredenhagen–Bélanger): LQR for weights ε·Q and R, ε from a lowest level up to 1. **Ours:** discrete (the discrete Riccati equation at the Controller's Ts, on the plant the page linearises at its origin, as the `lqr` type does), since every controller here runs at Ts; Wredenhagen and Bélanger name the discrete version too (secondary).
- **The ellipsoid of each level** (exact, inference from Cauchy–Schwarz): on xᵀPx ≤ c the largest |K·x| is √(c·K P⁻¹ Kᵀ), so the error lies inside where eᵀ S e ≤ ū², S = P·(K P⁻¹ Kᵀ), ū the room the limits leave. Under its own linear law V = xᵀPx falls (the discrete Riccati equation's Lyapunov property), so the ellipsoid is invariant: a trajectory that starts inside stays inside and never saturates. The ellipsoids are nested (S grows with ε); the design checks it and warns if not.
- **The scheduling variable** is the level of the ellipsoid the error lies on: Megretski's ε(x), the largest ε whose ellipsoid holds x. The person's "when the error is big, a smaller gain; as it gets smaller, a bigger and bigger gain": exactly this.
- **Continuity** (Hu and Lin's point): **ours** is a linear interpolation between the two levels around the error, in the quadratic form (0 on level j's boundary, 1 on level j + 1's), so the gain is a continuous function of the state; with 30 levels over four decades neighbours differ by 37 % in ε. A test checks that with 200 levels it matches Megretski's exact ε(x) (by bisection on a Riccati iteration of the test's own) to 3 %, and that along trajectories from inside the lowest ellipsoid u never reaches the limit (double and triple integrator, 40 starts each). Not proven by us for the interpolated law in general; on every trajectory measured it held.
- **The saturated high gain** of the abstract: u = sat(k·K(ε)·e), k ≥ 1 (the parameter `k`). Riccati laws have an infinite gain margin, so k > 1 keeps the region (Saberi, Lin and Teel 1996, quoted by Grognard et al.); it trades a little time at the limit for speed.
- **Tracking**: the theory regulates to the origin. **Ours:** the error is taken from where the plant rests with the tracked measurement at r (ys·r, held by us·r, from the linear model), and ū is the room the limits leave around us·r.
- **Refused** (with sentences): no limits ("without a limit its gain would simply be the highest"); every refusal of LQR (a state not measured, not at rest, a kink, not stabilisable); no rest for the tracked measurement.

## The missing scheduling variable, and how we compute it

The person ([input 34](../input/2026-10-25-34-hu-lin-scheduling-variable.md)): "everything was in the paper except the calculation of one variable, but that was an important scheduling variable ... back then we were able to [reproduce it], but that last variable was something that we had to figure out." Without the paper's text we cannot say which symbol it is. In the scheme every other quantity has a formula: the gains and the ellipsoids come from Riccati equations at a given ε, and the law is the gain at ε. **The one quantity defined only implicitly is the scheduling variable itself: the level ε(x) of the ellipsoid the state lies on**, Megretski's ε(x) = max{ε : x inside the ellipsoid of ε} (inference: it is the variable the abstract's "explicit functions of the state" has to make explicit, and the one Grognard et al. say needs care, "efficient constructions ... that do not require the online solution of (2)").

**Derivation.** For one level, with u = −K x and V = xᵀPx, the largest |u| on {V ≤ c} is √(c·K P⁻¹ Kᵀ) (Cauchy–Schwarz in the metric of P). So x lies in the ellipsoid on which the linear law cannot exceed ū exactly when

  g(x, ε) = xᵀ S(ε) x ≤ ū²,  S(ε) = P(ε) · (K(ε) P(ε)⁻¹ K(ε)ᵀ),

which for continuous LQR with R = 1 is Megretski's (xᵀPx)(bᵀPb) ≤ 1. The scheduling variable is ε(x) = max{ε ∈ [ε_low, 1] : g(x, ε) ≤ ū²}.
- **It is well defined and found by bisection**: for the low-gain family dP/dε ≥ 0 (Lin 1998), and when the ellipsoids are nested (S(ε) grows with ε, which the design checks at its levels) g grows with ε, so the set of admissible ε is an interval and its upper end is the unique root of g(x, ε) = ū², or 1 if g(x, 1) ≤ ū².
- **It never falls along a trajectory** (why the loop stays closed): inside the ellipsoid of ε the linear law with that ε does not saturate, and V(ε) falls under it (the Riccati equation's Lyapunov inequality, continuous or discrete), so the state stays inside that ellipsoid; the largest admissible ε at the next instant is at least the present one. ε therefore climbs monotonically to 1 and u never reaches the limit. In discrete time this holds sample by sample for the switched law (each level a fixed gain).
- **In the page** no Riccati equation is solved while running: the design solves it at 30 levels (log-spaced from ε_low to 1) and stores S and K for each; the law evaluates g at the levels (a quadratic form each), takes the highest level whose ellipsoid holds the error, and interpolates linearly in g between that level and the next. That makes ε(x) an explicit, continuous function of the state, which is what the abstract claims for Hu and Lin's law (their formula unknown here; ours is marked as an interpretation).

**How we know it is right.**
- *Against a published number*: the only figures for this scheduling variable we could read are Grognard, Sepulchre and Bastin's for Megretski's rule on the double integrator (Q(ε) = diag(ε⁴, ε²), |u| ≤ 1, from (−10, 0)): 10.25 s to reach the local ellipsoid T(1), 5.64 s time-optimal. Computing ε(x) by the bisection above (P(ε) in closed form, [[√3ε³, ε²], [ε², √3ε]]) gives 10.52 s (2.6 % longer), with ε never falling and |u| at most 0.577; the time-optimal entry into the same T(1) is 5.54 s (1.8 % shorter). No single bound or target level reproduces both of their numbers at once (a scan of the bound from 0.5 to 1), so the remaining few percent are a detail of their setup we cannot see, not the variable. A test holds the 10.25 s to 3 %.
- *Against the exact rule*: with 200 levels the page's interpolated gain matches the gain at the exact ε(x) (bisection on the test's own Riccati iteration) to 3 % at five states from near to far (a test).
- *Its consequences*: along 40 trajectories each of the double and triple integrator from the edge of the lowest ellipsoid, u never reaches the limit and the error dies away; the gain grows monotonically and continuously as the error shrinks (tests). The example and the measurements below.
- *The paper's own plant* (PUMA 560) and figures: not reproduced, their numbers being in the closed text.

## The plant

The paper's plant, the PUMA 560, cannot be reproduced honestly: its numbers are in the closed text (the library's own PUMA is a nonlinear six-axis arm, not the linearised joint model the paper would have used). So the example is a library plant where saturation matters: a **servo axis**, a torque drive (lag 20 ms, ±6 N·m) turning a rotor (J 0.02 kg·m², b 0.1 N·m·s/rad), every state measured (angle, speed, torque). Close to the library's DC motor (same rotor), but driven by torque: the motor's back-EMF damps it so strongly that clipping does it little harm (below), while a torque drive leaves a chain of integrators with a lag, the kind of plant where clipping a stiff loop hurts.

## Measured (simulation, `simulateSystem`, record 0.5 ms; Controller Ts 2 ms)

Weights Q = [1000, 0, 0] (the angle), R = 1 for the variable gain and for clipped LQR (the same gain near r: K = [30.1, 1.38, 0.94]); PID Kp 16, Ki 4, Kd 1.2, Tf 5 ms, the best of a grid on a 0.2 rad step (2.1 % overshoot, 0.48 s); back-calculation's Tt by the library's rule √(Ti·Td) = 0.55 s. Reference: 5 rad at 0.25 s, back 0.5 rad at 2.75 s (measured before the library's r also went back to 0 at 4.25 s, inputs 50–52; nothing before 4.25 s moved). Settling to 2 % of the step; "at limit" is the time u sits at ±6 N·m.

| Variant | 5 rad: overshoot, settling, IAE | at limit, peak \|u\| | 0.5 rad back: overshoot, settling | ∫u² dt (large, small) |
|---|---|---|---|---|
| Variable gain (Hu–Lin), k 1 | 0.5 %, 0.37 s, 1.03 | 0 s, 4.9 N·m | 3.2 %, 0.21 s | 2.9, 0.5 |
| Variable gain, k 2 | 0.0 %, 0.33 s, 0.88 | 0.08 s, 6 | 0.2 %, 0.14 s | 4.4, 0.9 |
| LQR, clipped | 11.1 %, 0.38 s, 0.84 | 0.31 s, 6 | 5.4 %, 0.19 s | 11.8, 1.5 |
| PID, clamping | 0.7 %, 0.36 s, 0.88 | 0.24 s, 6 | 0.0 %, 1.31 s | 9.8, 2.1 |
| PID, back-calculation | not settled in 2.5 s, 1.68 | 0.22 s, 6 | passes r by 0.26 rad, not settled | 9.0, 2.1 |
| PID, no anti-windup | 3.9 %, not settled in 2.5 s, 1.14 | 0.25 s, 6 | 0.0 %, not settled | 10.1, 2.1 |

- **J ± 20 %** (the rotor's inertia, the plant changed, the designs recomputed for it): the variable gain keeps 0.5 % and 0.34–0.40 s; clipped LQR 9.7–12.2 %; clamping 0.7–0.8 % but its small step settles in 0.5–2.2 s.
- **Small step alone** (0.2 rad): variable gain 5.3 %, 0.18 s (k 2: 0.4 %, 0.11 s); clipped LQR 5.7 %, 0.18 s (the same law, nothing saturates); PID 2.1 %, 0.49 s.
- **Large step** (20 rad, beyond the lowest ellipsoid's reach of 17 rad): variable gain 0.1 %, 0.73 s, 0.02 s at the limit; k 2 0.0 %, 0.64 s; clipped LQR 8 %, 0.74 s; clamping 0.9 %, 0.56 s; back-calculation and no anti-windup not settled in 4.75 s.
- **Back-calculation** is the worst here because the P part alone is far past the limit during the large step: tracking pulls the integral to cancel it, and Ki = 4 takes seconds to bring it back. With Tt = Ti = 4 s it behaves (1.9 %, 0.34 s); with Tt ≤ 0.2 s it is worse. A finding about the rule of thumb on this plant, not about back-calculation in general.
- **Load torque** 1 N·m: the variable gain and LQR hold the shaft 0.064 rad off r (state feedback, no integral; the torque measurement fights the load: (1 + K₃)/K₁); the PID's integral removes it.
- **The DC motor** (the library's, back-EMF damped), Q = [100, 0, 0], ±12 V: the variable gain never touches the limit and settles about 7 % later than clipped LQR (0.42 against 0.40 s on a 4 rad step); neither overshoots (0–0.4 %). Clipping does little harm on a damped plant, so the variable gain buys little there.
- **A chain of three integrators**, |u| ≤ 1, Ts 10 ms: with Q = [100, 0, 0] clipped LQR diverges on steps of 1, 5 and 20 (it oscillates to 60–150 and grows: the loop opens and never closes again), the variable gain settles with 0.5–2.5 % overshoot and never reaches the limit inside its reach. With Q = [1, 0, 0] clipped LQR still diverges on the 20 step. This is the case the theory is for (Sussmann and Yang: no saturated linear law holds a triple integrator globally) and a test.

## Verdict

- **Good where clipping hurts**: plants with integrators (positioning axes, torque or force driven) and a hard input limit, with steps large enough to saturate a stiff loop. There it gives the stiff loop's small-signal behaviour and a large step without overshoot, from one design, never opening the loop; with k ≈ 2 it uses the limit about as much as a well-tuned anti-windup and settles faster. On a plant that is already well damped (the back-EMF motor) it buys little.
- **Not a replacement for an integral**: it is state feedback, so a constant load leaves an offset; every state must be measured (or estimated: a Kalman Observer); it needs a model (the page has one) and finite limits.
- **Against "a proper anti-windup"**: a PID with clamping is as good on the large step itself, but carries integral it gathered into the next step (1.3 s against 0.21 s here); back-calculation depends on Tt and its rule of thumb failed here.
- **How it could be offered elsewhere**: as it is, a designed variant beside LQR (any system whose LQR runs can run it with the same Q, R); an option on the `lqr` type ("schedule the gain under the limits") would be the same law; a variant in other examples (the pendulum's LQR catch has no integrator but a nonlinear plant: the ellipsoids hold only for the linearised model, untested). An integral state (LQI) under the same schedule would remove the load offset: not built.

## Sources

- Hu, Lin, TAC 47(9) 2002, doi:10.1109/TAC.2002.802739; CDC 2002, doi:10.1109/CDC.2002.1185091 (Crossref, OpenAlex).
- Grognard, Sepulchre, Bastin, "Improving the performance of low-gain designs for bounded control of linear systems", *Automatica* 38 (2002), 1777–1782; preprint at perso.uclouvain.be/georges.bastin/paper66.pdf.
- Wredenhagen, Bélanger, *Automatica* 30(3), 1994, 403–416.
- Megretski, IFAC World Congress 1996, 435–440.
- Lin, Saberi, *Systems & Control Letters* 21(3), 1993, 225–239; Lin, *Automatica* 34(7), 1998, 897–905; Saberi, Lin, Teel, *IEEE TAC* 41(3), 1996, 368–378.
- Hu's publication list: faculty.uml.edu/thu/constrained_control.htm.
- Köse, Jabbari, "Scheduled controllers for linear systems with bounded actuators", *Automatica* 39 (2003), 1377–1387 (the same idea with LMIs; not used).
- Scripts (scratch, not kept): the measurements above re-run with `simulateSystem` on the library entry; `test/hulin.test.mjs` holds the independent Riccati iteration and Megretski's bisection.
