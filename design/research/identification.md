# Research: identifying an unknown plant by experiment

Reader: whoever implements or changes Identify ([../output/identification.md](../output/identification.md)), or wants to know why it identifies the way it does.

**How this was made (2026-10-24):**
- Three research agents worked in parallel: classic and modern methods; safe experiments in open and closed loop; "what is more modern".
- A design panel followed: two proposals, each prototyped in plain JS on the HIL arm's physics (`hil/hil_plant.py`, ±15 % draws, 1 mrad noise, a 4096-count encoder), and two judges who re-ran the prototypes.
- The panel's checks come first. Where they disagree with the research findings, they override them.

The question, in the person's words: "do some research on how you would probably identify this. The methods you named sound reasonable, but I wonder if there's something more modern." The methods named to the person were step, relay, chirp and PRBS experiments, with model fits. Then the decision: experiment first, for a tester who knows no control theory, who gives no model and no grey box; the page eases in; the plant keeps itself safe.

## What the panel's checks corrected

- **Small amplitudes at rest give wrong models that look right.**
  - A multisine at rest on the arm moves it only within its friction regime. Coulomb friction is 0.01 N·m, worth about 0.2 V.
  - The fitted models, with their χ²/dof under weighting by noise plus distortion:

    | Peak | Angle moves | Fitted | χ²/dof |
    |---|---|---|---|
    | 0.15 V | ±0.005 rad | K 0.42, ζ 22 | 0.25 |
    | 0.25 V | ±0.006 rad | K 0.29, ζ 11 | 0.32 |
    | 0.5 V | ±0.048 rad | K 0.20, ζ 1.4 | 2.5 |
    | 1 V | ±0.20 rad | K 0.53, ζ 0.74 | 1.7 |

    The arm's viscous damping is ζ ≈ 0.22.
  - Weighting by noise plus distortion widens the bars until χ² passes the bad models.
  - **So a distortion share above about 30 % must mark a model ✕, whatever χ² says.**
- **The operating point matters as much as the amplitude.** The arm's gravity stiffness mgl·cos θ falls about 14× between 0 and 1.5 rad:

  | | 0 rad | 1.5 rad |
  |---|---|---|
  | Gain | 0.50 rad/V | 7.07 rad/V |
  | Swing frequency | 1.0 Hz | 0.27 Hz |
  | ζ | 0.22 | 0.83 |

  - The research's default of identifying "where it is" (at rest) identifies the hanging arm. The loop runs near horizontal.
  - Identifying along the tester's own reference visits the places of use without asking anyone.
- **"Where should it sit during the test?" cannot be asked.** It is a control question the tester cannot answer.
- **"How far may it move: 10 % of the output's range" is too tight.** It, and a band of the reference range ± 10 %, keep every test in the friction regime. The reference range ± a third of its span gave safe tests with readable responses: over 50 arms, the Nudge moved +0.18 / −0.14 rad at most, in at most 3.4 s, with no back-off.
- **The closed-loop ladder's own record identifies as well as a broadband test, and more safely.** This was measured end to end by E2. Tuning on a model fitted to the ladder's record came within 2–25 % of the best possible cost on the oven, the motor and five arms, with every margin ≥ 0.66. A multisine at the Nudge's amplitude gave poor results on 3 of 5 arms (J 0.33–0.69, against a best of about 0.05).
- **Searching on the plant costs minutes and crosses margins.**
  - Compass search took 22–43 trials and 3–5 min per arm, with 5–9 margin crossings, and its J scattered 0.056–0.29.
  - IFT's gradient experiments left the band on the integrating motor.
  - SafeOpt and safe-UCB stopped expanding on the arm after 3–4 trials.
  - So: identify, tune on the model, verify once.
- **Output-error fits on closed-loop data are biased.** Fitting the model's simulation directly from the measured u ignores the noise the controller feeds back into u. The panel's fix is the replay: simulate the whole closed loop with the controller the page itself ran, from r and the excitation only (closed-loop output error).
- **The 5 min default budget is more than needed.** On the arm the test takes about 45 s without a broadband stage. The oven's ladder took 96 s. 2 min is the default.
- **Grey-box fitting is excluded for the tester.** The research proposed fitting a diagram's physical parameters in v1. The person's decision ("he's not going to give you a gray box") excludes that for the tester. It remains conceivable later as a teaching tool on simulated plants.
- **No need to ask which measurement follows the reference.** The research proposed asking it, but the Controller block's input 2 already says so.
- **The protocol lacks two things:**
  - **output ranges**: today the plant E-stops on its watchdog, its stop key, a lost page or a request, and it clamps only u;
  - **an echo of the u the plant applied**: on hardware, clamps, rate limits and dead bands make it differ from what was sent.

## Summary

- **"More modern" does not mean deep learning.** For a plant that must stay safe and a model people can open, current practice rests on four things:
  1. periodic, low-crest-factor excitation (random-phase multisines) whose frequency response is unbiased under feedback and comes with measured noise and nonlinear-distortion levels (Pintelon & Schoukens; Schoukens & Ljung 2019);
  2. regularised, kernel-based estimation that needs no model order from anyone (Pillonetto, Chen, Ljung and others, 2010–2022; the TC kernel is the default in MATLAB's `impulseest`);
  3. small continuous-time models fitted to the data, so the result reads as gain, lags, a resonance, an integrator and a dead time;
  4. validation on data the model has not seen, before a controller goes live, and a go-live ladder with a fallback (controller validation, safe exploration, safety filters).
- **Data-driven control without a model** (VRFT, unfalsified control, DeePC, Gaussian-process and neural models) breaks the "no black boxes" rule. Only ideas carry over: grow the excitation step by step while the output stays inside limits, and check that a recording is rich enough.
- **Industry eases in the same way**:
  - a short pre-test (time to settle, noise);
  - the smallest amplitude that beats noise and dead band;
  - staying near the operating point, in closed loop when possible;
  - letting the operator abort;
  - simulating before commissioning.

  Sources: Qin & Badgwell 2003; the MathWorks Closed-Loop PID Autotuner; Siemens PID_Compact.
- **For Loop Tuner this means one automatic, eased-in experiment:**
  - Listen;
  - growing doublets (Nudge);
  - a gentle controller built from them (Hold);
  - the tester's reference replayed with a controller asked to be quicker each time (Ease in);
  - a multisine on top of the held loop only when the model is unsure (Shake);
  - a Check on data not fitted.

  Then small continuous-time models are fitted by replaying the closed loop, with a regularised impulse response as the order-free reference. Auto-tune runs on the model; one screened, monitored hand-over goes to the plant.

## Recommendations

1. **Find every amplitude by experiment, never as a fixed share of the input range.**
   - On the arm, 2.1 V (nominal) or 2.4 V (+10 %) sends it over the top. That is 9–10 % of ±12 V, while Auto-tune's step and relay default is 10 % of the range.
   - Grow a push only while the previous one, scaled by how the response grows, is predicted to stay within half the room (the Nudge rule in the design).
2. **Use doublets (+a, −a, rest) for the first pushes.** Their net area is zero, so integrating plants come back. Use a pulse when the input sits at a limit. Classify each response: none, settles, ramps, rings, runs away.
3. **Close the loop as early as possible, with a deliberately gentle controller from the first look.**
   - SIMC with τc = 2(τ + θ) when the plant settles, or 3(θ + τ) when it integrates, and **Ti = 4(τc + θ) always**.
   - Then ease in: each try 30 % quicker (τc × 0.7) on the tester's reference, disturbances held off, stopping on ringing, nearing the edge, no improvement or the budget.
   - This is the person's "start with slow control efforts and then increase this over time". It is also what the Shamsuzzoha–Skogestad setpoint-overshoot method and the MathWorks closed-loop tuner do: never approach the stability limit.
4. **Fit by replaying the closed loop with the controller the page ran** (closed-loop output error).
   - It is consistent under feedback because the replay depends only on r, the excitation and the known law (Landau & Karimi 1997; Forssell & Ljung 1999).
   - Fit small continuous-time structures with a fitted dead time: lag, two lags, resonance, integrator with lag, integrator with resonance.
   - Choose the fewest parameters within 1 point of the best fit on held-out data.
5. **Add a multisine only when the model is unsure, ridden on the held loop, at the u swing of use.**
   - Odd random-phase lines, with one in three odd lines and all even lines left out (detection lines).
   - Average whole periods: Ĝ = Ȳ/Ū is unbiased under feedback.
   - Measure the distortion share and show it.
6. **Keep the kernel estimate as the order-free reference.**
   - TC kernel, hyperparameters by marginal likelihood, decimated to at most about 150 taps.
   - It supplies start values, a ceiling for the parametric fit, and a curve anyone can read.
7. **Validate on a test the model has not seen, at other places**: the reference's steps halved about their middle.
   - Report the fit % against the noise ceiling, plus a residual pattern check.
   - Let the distortion share and the spread between places lower the grade; never χ² alone.
8. **Verify on the plant in screened steps with a prediction monitor.**
   - Interpolate from the proven gentle controller to the result.
   - Screen each step on the model and its uncertainty.
   - Fall back the moment the plant does not behave as predicted.
9. **Extend the protocol**: optional output ranges in `describe` (the plant E-stops beyond them) and `applied` in each `y`. Drop and repeat a period that contains a `seq` gap.
10. **End a runaway with the plant's `stop`, not by holding u.** Holding u₀ does not stop an unstable or integrating plant.

## Methods considered

| Method | Needs | Noise, nonlinearity | Cost in JS | Readable? | Here |
|---|---|---|---|---|---|
| Step / pulse fits: FOPDT (Smith's two points), SOPDT, IPDT (Skogestad 2003) | One response above the noise | Poor on noise (a few points); one amplitude hides nonlinearity | trivial | yes: "reacts after …, settles at …" | First look, from the Nudge's doublets |
| Relay, classic and extended: biased, with an added delay, the FFT of transients, asymmetric (Åström & Hägglund 1984; Shen, Wu & Yu 1996; Li, Eskinat & Luyben 1991; Wang, Hang & Bi 1997) | A loop around r₀ | Good with hysteresis set from the noise; the describing function is −19 … +27 % off on Ku | trivial | yes | Stays an Auto-tune method, run on the model |
| Chirp / swept sine | Open or closed loop | Good SNR per frequency; leaks unless windowed; long at large amplitude at low frequency | FFT | yes (Bode) | Not used: multisine is periodic |
| PRBS / generalised binary noise (Tulleken 1990; Zhu 2001) | Persistently exciting u | Crest factor 1; fixed spectrum | trivial | – | Not used: no shaped band, no detection lines |
| **Random-phase odd multisine, best linear approximation, detection lines** (Schroeder 1970; Pintelon & Schoukens 2012; Schoukens & Ljung 2019) | Whole periods | Exact frequency response from whole periods; noise per line from the period spread; odd and even distortion measured | FFT, 12–20 ms | yes: dots with bars | **Shake**, when needed |
| Welch H1 and coherence | Long records | **Biased under feedback**; use Ĝ = S_yr/S_ur or periodic averaging | 12 ms at N = 6000 | coherence as "how much of y u explains" | Not used: periodic averaging instead |
| Local Polynomial Method (Pintelon et al. 2010; Schoukens et al. 2009) | Non-periodic or short records | Removes transient leakage | moderate | – | Later |
| ARX (least squares) | Any u | **Biased with sensor noise**: 87 % at SNR 30, 33 % at SNR 5, 22 % at SNR 1.8, where OE reached 96–99.6 % | 2 ms | – | Only as a check |
| Output error, LM (prediction-error method) | Any u | Unbiased with white sensor noise in open loop; local minima, so start from a good guess | 5–50 ms per order | yes, as continuous-time parameters | **Core, run as the closed-loop replay** |
| Closed-loop output error, two-stage and projection methods (Landau & Karimi 1997; Van den Hof & Schrama 1993; Forssell & Ljung 2000); refined instrumental variables (Young, Garnier & Gilson 2009) | Known r; the controller known or estimated | Consistent under feedback with an OE model | as OE | yes | **The replay**: the page knows its own law exactly |
| Sanathanan–Koerner, vector fitting, AAA (Gustavsen & Semlyen 1999; Nakatsukasa, Sète & Trefethen 2018) | A frequency response | Robust (vector fitting, AAA); AAA needs no order | < 5 ms | yes | Later; the time-domain replay is enough |
| **Regularised FIR, TC kernel, empirical Bayes** (Chen, Ohlsson & Ljung 2012; Pillonetto et al. 2014; 2022 book) | u, y; a decaying impulse response | **The most robust on short, noisy data** | ≈ 4–15 ms per evaluation at 80–300 taps (one Cholesky) | yes: impulse and step with bands | **Order-free reference, start values** |
| Subspace (N4SID, MOESP) | u, y; an order from the singular values | Mildly biased in closed loop; states without meaning | tens of ms; needs QR and SVD | no | Not used |
| Grey-box physical parameters | A structure | Excellent when the structure is right; partly unidentifiable from one output | 1–2 s | best | Excluded for the tester (the person); later for teaching |
| SINDy with control (Brunton, Proctor & Kutz 2016) | States and derivatives | Noise-sensitive | – | sparse equations | Later at most |
| Safe active learning, SafeOpt (Zimmer, Meister & Nguyen-Tuong 2018; Sui et al. 2015; Berkenkamp, Schoellig & Krause 2016) | A safe start; GP models | – | heavy | no | The idea only (grow while predicted safe) |
| IFT, VRFT, unfalsified control, DeePC (Hjalmarsson et al. 1998; Campi, Lecchini & Savaresi 2002; Safonov & Tsao 1997; Coulson, Lygeros & Dörfler 2019) | Experiments or data, no model | – | – | no model to open | Not used. Willems' lemma (a Hankel rank test) is a useful richness check |
| Neural, Koopman / DMDc, GP state-space | Much data | – | heavy | no | Excluded |

## Measurements (plain JS, Node 22, no dependencies; the repository's `linalg.js` and `spectrum.js`)

**Method costs on the HIL arm (+10 %, with noise):**

| What | Result | Time |
|---|---|---|
| Multisine frequency response, 6 periods, 200 lines | within 0.1 % of the true gain, a standard deviation per line | 20 ms |
| Welch H1 with coherence, N = 6000 | coherence 0.97–0.998 up to 10 Hz, 0.57 at 20 Hz, 0.07 at 39 Hz | 12 ms |
| ARX(3,3) | 92.4 % validation fit | 32 ms |
| OE(2,2) by LM from the ARX start | 99.6 % (the noise floor); 0 of 25 residual lags outside the band, where ARX left 23 | 50 ms |
| TC-kernel FIR, 80 taps, about 100 marginal-likelihood evaluations | – | about 0.4 s |
| TC-kernel FIR, 300 taps | – | 10 s naive; about 2 s with the tridiagonal inverse (130 evaluations × 15 ms); decimate to ≤ 150 taps |

**The TC kernel against plain least squares**, plant 2e^(−0.1s)/((0.5s + 1)(0.1s + 1)), Ts 10 ms, PRBS ±1, 300 taps, impulse-response fit:

| Data | TC | Plain least-squares FIR |
|---|---|---|
| 30 s, SNR 10 | 96.9 % | 7 % |
| 30 s, SNR 3 | 95.6 % | −172 % |
| 15 s, SNR 3 | 94.0 % | −516 % |

The gain comes out within 2 %; step-response fits are 97–99.6 %. At 80 taps the kernel lifted fits from 64 to 83 % at SNR 1.8 and from 86 to 93 % at SNR 5. Chen, Ohlsson & Ljung (2012), over 5 000 test systems, found the TC kernel beating OE with its order chosen by cross-validation (slow systems at low SNR: 60.8 % against 49.6 %).

**A low-order fit:** two lags plus dead time by LM, with a delay grid of 0–30 samples, gave K 1.97 (true 2), τ 0.487 and 0.105 (true 0.5 and 0.1) and the delay exact, from 1 934 simulations in 0.9 s.

**Grey-box (for the record):** with angle, speed and current measured, all seven arm parameters were found within about 1 %. With angle only, J, Tc and mgl came out within ±5 %, but R, L, k and b only within ±40–75 %: only combinations such as k/R can be determined.

**Steps from rest on the nominal arm (8 s each):**

| Step | Final angle | Apparent gain | t63 | What it does |
|---|---|---|---|---|
| 0.05 V | 0.013 rad | 0.26 rad/V | 4.0 s | creeps: friction dominates |
| 0.2 V | 0.060 rad | 0.30 rad/V | 3.5 s | still creeps |
| 0.5 V | 0.24 rad | 0.48 rad/V | 0.29 s | near linear |
| 1.0 V | 0.57 rad | 0.57 rad/V | 0.26 s | rings (8 % overshoot) |
| 1.5 V | 0.94 rad | 0.63 rad/V | 0.27 s | gravity's sin θ shows (14 %) |
| 1.9 V | 1.55 rad | 0.81 rad/V | 0.32 s | near horizontal |
| 2.1 V | 84 rad after 8 s | – | – | **over the top; it spins** |

**The ladder and tuning on its model** (the panel's E2 prototype; J is Auto-tune's cost, scored noise-free on the true plant):

| | Oven | Motor | Tank | Arm (5 plants) |
|---|---|---|---|---|
| Best J (Nelder–Mead on the true plant) | 0.140 | 0.120 | 0.073 | 0.049–0.056 |
| Ladder: tries, plant time | 8, 96 s | 5, 62 s | 6, 56 s | 2–3, 24–35 s |
| Model from the ladder: fit, J tuned on it | 99 %, 0.143 | 97 %, 0.125 | 85 %, 0.220 | 71–77 %, 0.061–0.084 |
| Search on the plant: trials, plant time, J | 21, 213 s, 0.145 | 20, 157 s, 0.120 | 21, 191 s, 0.085 | 22–43, 193–315 s, 0.056–0.29 |

## Pitfalls

- **A fixed share of the input range as the first push** flips the arm. Auto-tune's 10 % default must never be the first live move.
- **Tiny amplitudes lie.** Friction lowers the apparent gain and makes ζ absurd, and χ² can still pass. Measure distortion and grade by it.
- **One place lies too.** A model at rest is not the plant near horizontal. Identify where the loop will run, and show the spread between places.
- **Closed-loop data with direct OE or H1** is biased by the noise fed back. Replay with the known law, or average whole periods.
- **Uncertainty bars from the Jacobian understate the error** when the structure is wrong. Show the spread between places and the distortion beside them, not folded in.
- **The cross-correlation test is valid only under the assumptions it checks** (Douma, Bombois & Van den Hof). Treat it as a hint ("what is left has a pattern"), not a verdict.
- **The TC kernel assumes a decaying impulse response.** Fit integrators on Δy, decimate lightly damped plants to keep n small, and keep n ≲ 150 (the cost is O(n³)).
- **The DFT across a `seq` gap** breaks periodicity. Drop and repeat the period. The time-domain replay can hold u across a gap.
- **u at a limit** breaks every linear method fitted to the sent u. Replay the clamps, and fit to what the plant says it applied.
- **Disturbances during the test**: with the tester's d on, the gentle loop left the band on the tank and came within 5 % of the edge on the arm. Hold every other input during the test.
- **An unstable plant cannot be identified in open loop**, and holding u₀ does not stop it. Send `stop`, and identify later under a controller that holds it.
- **The first closed loop has no fallback.** Its guard is u₀ plus `stop`.
- **Switching variants live rebuilds the diagram** and restarts the controllers. Bumpless switching must happen inside one law.
- **A wall-clock stopping rule** makes results depend on the machine. Use iteration caps and work-unit slices.
- **The page cannot tell when the HIL plant changed**: the variation is drawn per script start. Mark models from an earlier connection and offer a short re-check.
- **Interpolated gains are not guaranteed stable.** Screen each hand-over step on the model and its band before it runs.

## Sources

**Books and surveys**
- L. Ljung, *System Identification: Theory for the User*, 2nd ed., Prentice Hall, 1999.
- R. Pintelon and J. Schoukens, *System Identification: A Frequency Domain Approach*, 2nd ed., Wiley–IEEE Press, 2012.
- J. Schoukens and L. Ljung, "Nonlinear system identification: a user-oriented road map", *IEEE Control Systems Magazine* 39(6), 2019.
- G. Pillonetto, F. Dinuzzo, T. Chen, G. De Nicolao and L. Ljung, "Kernel methods in system identification, machine learning and function estimation: a survey", *Automatica* 50(3), 2014.
- G. Pillonetto, T. Chen, A. Chiuso, G. De Nicolao and L. Ljung, *Regularized System Identification*, Springer, 2022 (open access).
- H. Garnier and L. Wang (eds.), *Identification of Continuous-time Models from Sampled Data*, Springer, 2008.
- R. V. Jategaonkar, *Flight Vehicle System Identification*, 2nd ed., AIAA, 2015.
- M. B. Tischler and R. K. Remple, *Aircraft and Rotorcraft System Identification*, 2nd ed., AIAA, 2012.
- Y. Zhu, *Multivariable System Identification for Process Control*, Pergamon, 2001.

**Regularised and modern estimation**
- T. Chen, H. Ohlsson and L. Ljung, "On the estimation of transfer functions, regularizations and Gaussian processes — revisited", *Automatica* 48(8), 2012.
- T. Chen and L. Ljung, "Implementation of algorithms for tuning parameters in regularized least squares problems in system identification", *Automatica* 49(7), 2013.
- F. P. Carli, T. Chen and L. Ljung, "Maximum entropy kernels for system identification", *IEEE Trans. Automatic Control* 62(3), 2017. The TC kernel's tridiagonal inverse.
- Y. Nakatsukasa, O. Sète and L. N. Trefethen, "The AAA algorithm for rational approximation", *SIAM J. Sci. Comput.* 40(3), 2018.
- B. Gustavsen and A. Semlyen, "Rational approximation of frequency domain responses by vector fitting", *IEEE Trans. Power Delivery* 14(3), 1999.
- C. K. Sanathanan and J. Koerner, "Transfer function synthesis as a ratio of two complex polynomials", *IEEE Trans. Automatic Control* 8(1), 1963.
- A. H. Ribeiro et al., "On the smoothness of nonlinear system identification", *Automatica* 121, 2020. Multiple shooting.
- S. L. Brunton, J. L. Proctor and J. N. Kutz, "Sparse identification of nonlinear dynamics with control (SINDYc)", arXiv:1605.06682, 2016.

**Excitation signals and frequency responses**
- M. R. Schroeder, "Synthesis of low-peak-factor signals and binary sequences with low autocorrelation", *IEEE Trans. Information Theory* 16(1), 1970.
- H. J. A. F. Tulleken, "Generalized binary noise test-signal concept for improved identification-experiment design", *Automatica* 26(1), 1990.
- D. E. Rivera et al., "Constrained multisine input signals for plant-friendly identification of chemical process systems", *J. Process Control* 19, 2009.
- J. Schoukens, G. Vandersteen, K. Barbé and R. Pintelon, "Nonparametric preprocessing in system identification: a powerful tool", *European J. Control* 15(3–4), 2009.
- R. Pintelon, J. Schoukens, G. Vandersteen and K. Barbé, "Estimation of nonparametric noise and FRF models for multivariable systems — Part I: Theory", *Mechanical Systems and Signal Processing* 24(3), 2010. The Local Polynomial Method.
- E. A. Morelli, "Practical multiple-input design for aircraft system identification flight tests", AIAA Aviation Forum, 2021: [NTRS 20210018281](https://ntrs.nasa.gov/citations/20210018281). Orthogonal phase-optimised multisines need no prior model and change only in amplitude between tests.
- J. A. Grauer and M. J. Boucher, "Real-time estimation of bare-airframe frequency responses from closed-loop data and multisine inputs", *J. Guidance, Control, and Dynamics*: [NTRS 20200002414](https://ntrs.nasa.gov/citations/20200002414). Feedback and mixing are resolved by interpolating across harmonics.
- J. A. Grauer and M. J. Boucher, "Aircraft system identification from multisine inputs and frequency responses": [NTRS 20205003364](https://ntrs.nasa.gov/api/citations/20205003364/downloads/jgcd_FRE.pdf).

**Closed-loop identification**
- U. Forssell and L. Ljung, "Closed-loop identification revisited", *Automatica* 35(7), 1999.
- U. Forssell and L. Ljung, "A projection method for closed-loop identification", *IEEE Trans. Automatic Control* 45(11), 2000.
- P. M. J. Van den Hof and R. J. P. Schrama, "An indirect method for transfer function estimation from closed loop data", *Automatica* 29(6), 1993.
- I. D. Landau and A. Karimi, "Recursive algorithms for identification in closed loop: a unified approach and evaluation", *Automatica* 33(8), 1997: [EPFL record](https://infoscience.epfl.ch/record/111967/files/LK99.pdf?version=1). Closed-loop output error.
- P. C. Young, H. Garnier and M. Gilson, "Simple refined IV methods of closed-loop system identification", IFAC SYSID, 2009.
- S. G. Douma, X. Bombois and P. M. J. Van den Hof, on the validity of the standard cross-correlation test for model structure validation (IFAC World Congress 2005; journal version in *Automatica*).

**Relay and step tests, gentle first loops**
- K. J. Åström and T. Hägglund, "Automatic tuning of simple regulators with specifications on phase and amplitude margins", *Automatica* 20(5), 1984.
- S.-H. Shen, J.-S. Wu and C.-C. Yu, "Use of biased-relay feedback for system identification", *AIChE J.* 42(4), 1996.
- W. Li, E. Eskinat and W. L. Luyben, "An improved autotune identification method", *Ind. Eng. Chem. Res.* 30(7), 1991.
- Q.-G. Wang, C.-C. Hang and Q. Bi, "Process frequency response estimation from relay feedback", *Control Engineering Practice* 5(9), 1997.
- S. Majhi and D. P. Atherton, relay autotuning for stable, integrating and unstable processes, *IEE Proc. Control Theory Appl.* 146(5), 1999.
- S. Skogestad, "Simple analytic rules for model reduction and PID controller tuning", *J. Process Control* 13(4), 2003.
- M. Shamsuzzoha and S. Skogestad, "The setpoint overshoot method: a simple and fast closed-loop approach for PID tuning", *J. Process Control* 20(10), 2010.

**Safe experiments, validation and going live**
- S. J. Qin and T. A. Badgwell, "A survey of industrial model predictive control technology", *Control Engineering Practice* 11(7), 2003.
- C. Zimmer, M. Meister and D. Nguyen-Tuong, "Safe active learning for time-series modeling with Gaussian processes", NeurIPS 2018: [proceedings](https://proceedings.neurips.cc/paper/2018/hash/b197ffdef2ddc3308584dce7afa3661b-Abstract.html).
- Y. Sui, A. Gotovos, J. Burdick and A. Krause, "Safe exploration for optimization with Gaussian processes", ICML 2015.
- F. Berkenkamp, A. P. Schoellig and A. Krause, "Safe controller optimization for quadrotors with Gaussian processes", ICRA 2016.
- K. P. Wabersich and M. N. Zeilinger, "A predictive safety filter for learning-based control of constrained nonlinear dynamical systems", *Automatica* 129, 2021.
- B. Hernandez and P. Trodden, "Persistently exciting tube MPC", American Control Conference, 2016: [arXiv:1505.05772](https://arxiv.org/abs/1505.05772). The input splits into a regulating part and an exciting part treated as a disturbance.
- J. Hu, D. Zachariah, T. Wigren and P. Stoica, "Recursive experiment design for closed-loop identification of ARMAX systems with output perturbation limits", [arXiv:2508.18813](https://arxiv.org/abs/2508.18813), 2025.
- M. Gevers, X. Bombois, B. Codrons, G. Scorletti and B. D. O. Anderson, "Model validation for control and controller validation in a prediction error identification framework — Part I", *Automatica* 39(3), 2003.
- X. Bombois, G. Scorletti, M. Gevers, P. M. J. Van den Hof and R. Hildebrand, "Least costly identification experiment for control", *Automatica* 42(10), 2006.
- G. Vinnicombe, "Frequency domain uncertainty and the graph topology", *IEEE Trans. Automatic Control* 38(9), 1993. The ν-gap.

**Data-driven control (not used here)**
- H. Hjalmarsson, M. Gevers, S. Gunnarsson and O. Lequin, "Iterative feedback tuning: theory and applications", *IEEE Control Systems Magazine* 18(4), 1998.
- M. C. Campi, A. Lecchini and S. M. Savaresi, "Virtual reference feedback tuning", *Automatica* 38(8), 2002.
- M. G. Safonov and T.-C. Tsao, "The unfalsified control concept and learning", *IEEE Trans. Automatic Control* 42(6), 1997.
- J. Coulson, J. Lygeros and F. Dörfler, "Data-enabled predictive control: in the shallows of the DeePC", European Control Conference, 2019.
- J. C. Willems, P. Rapisarda, I. Markovsky and B. De Moor, "A note on persistency of excitation", *Systems & Control Letters* 54(4), 2005.

**Products** (vendor documentation; secondary)
- MathWorks, Closed-Loop PID Autotuner: perturbations at [1/10, 1/3, 1, 3, 10]·ωc around the operating point, with the loop kept closed "to maintain safe operation"; MATLAB `impulseest` uses the TC kernel by default.
- Siemens, PID_Compact: refuses or aborts tuning near the setpoint, at an output limit, or when the setpoint moves during tuning.
