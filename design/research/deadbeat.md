# Research: deadbeat control

Reader: whoever changes the deadbeat controller type or its example in Loop Tuner. The person's words are in [input 35](../input/2026-10-25-35-deadbeat-and-pugh-matrix.md): "How about something that shows a deadbeat controller? That would also be cool." What was built from this is in [controller-proposal.md](../output/controller-proposal.md) and [system-library.md](../output/system-library.md); the decision in [decisions.md](../output/decisions.md) (v2.9).

Marks: **(textbook)** is from the sources below, from the author's knowledge of them; chapter and section numbers were not checked against the books in this session. **(simulation)** is a run of the repository's own code, held by `test/deadbeat.test.mjs`. **(inference)** is reasoning.

## Bottom line

- **Deadbeat is the discrete controller that puts every closed-loop pole at z = 0.** Its characteristic polynomial is zⁿ, so the loop's error dies out completely in at most n samples: finite settling, which no continuous linear controller has (textbook: Åström and Wittenmark; Franklin, Powell and Workman).
- **It has one knob, the sample time.** Settling is n samples whatever Ts is, so a shorter Ts settles faster and asks for far more input: on the library motor 8 V per rad at Ts = 100 ms, 655 V per rad at 10 ms (simulation).
- **Its costs are large inputs, poor robustness and, in the output form, ripple between samples.** At a limit it is no longer deadbeat. Practice takes a longer Ts, or relaxes it over more samples (textbook: Isermann).
- **Built here: deadbeat state feedback** (`deadbeat`, a designed type; every state measured), with "Update every k" as its sample time k·Ts, its twin `stateFeedback` with the same hold. The output (minimal-prototype and ripple-free) forms and the deadbeat observer are not built (below, Not built).

## What deadbeat is

**State feedback** (textbook: Åström and Wittenmark, on pole placement by state feedback; Franklin, Powell and Workman, on Ackermann's formula). For x⁺ = Φx + Γu with n states and one input, controllable, the law u = −Kx gives x⁺ = (Φ − ΓK)x. Choosing every eigenvalue of Φ − ΓK at 0 makes it nilpotent: (Φ − ΓK)ⁿ = 0, so any initial error is gone after n samples, exactly. Ackermann's formula with the desired polynomial φ(z) = zⁿ:

  K = [0 … 0 1] Wc⁻¹ Φⁿ,   Wc = [Γ, ΦΓ, …, Φⁿ⁻¹Γ].

With a reference r the law is u = kr·r − K·x, kr chosen so the tracked output's static gain is 1. From rest, a step of r is followed in n samples: the state reaches the rest x* that holds y at r, and since x* is an equilibrium of the plant under the constant input that holds it, the state stays there between samples too. **Deadbeat state feedback has no intersample ripple** (inference, checked by simulation at a 1 ms record).

The inputs it uses are the unique sequence u₀ … uₙ₋₁ that moves the plant from rest to x* in n steps (Σ Φⁿ⁻¹⁻ᵏ Γ uₖ = x*, then the input that holds x*): minimum-time control, the fastest any input could do it with one input and n states (textbook: Åström and Wittenmark). The test checks the law's inputs against this sequence, computed independently.

**Output deadbeat, the minimal prototype** (textbook: Ragazzini and Franklin's minimal-prototype design; Franklin, Powell and Workman; Isermann's DB(v)). From the pulse transfer function G(z), the controller D(z) = T(z) / (G(z)(1 − T(z))) makes the closed loop T(z) = z⁻ᵈ (d the plant's delay in samples): y reaches r d samples after a step, at the samples. Because D cancels G, it cancels G's zeros, including the sampling zeros a zero-order hold adds: for relative degree 3 these approach −3.73 and −0.27 as Ts shrinks (textbook: Åström, Hagander and Sternby 1984). A cancelled zero outside the unit circle makes u grow without bound; one inside but near −1 leaves u ringing every sample, and y **ripples between the samples** while it reads exact at them (textbook: Franklin, Powell and Workman, on intersample ripple).

**Ripple-free (output) deadbeat** (textbook: Isermann; Franklin, Powell and Workman). T(z) is made to contain all of G's zeros, so none is cancelled; it then settles in n + d samples instead of d, and u settles too, so the output is still between samples. Because nothing is cancelled it also works for a plant with a zero outside the unit circle, where the minimal prototype must keep that zero in T anyway (or be unstable inside): the textbook minimal prototype assumes a stable plant with its zeros inside the unit circle (inference from the construction). A plant pole outside the unit circle must likewise stay out of D's cancellations.

**Deadbeat observer** (textbook: Åström and Wittenmark; Franklin, Powell and Workman). The dual: L placing every pole of the estimate's error at z = 0, so the estimate is exact after n samples (a finite-memory observer). With a deadbeat controller on its estimates, the loop settles from an unknown start in 2n samples; measurement noise passes into the estimate unfiltered.

## What it costs

- **Input size.** Deadbeat asks whatever it takes. On the library motor (R 1 Ω, L 10 mH, Kt = Ke 0.5, J 0.02 kg·m², b 0.1), a 1 rad step (simulation, `deadbeatDesign`):

  | Ts | settles in | u₀, u₁, u₂ (V) | largest step inside ±12 V |
  |---|---|---|---|
  | 5 ms | 15 ms | 4128, −6430, 2442 | |
  | 10 ms | 30 ms | 655, −815, 229 | 15 mrad |
  | 20 ms | 60 ms | 126, −107, 15 | |
  | 50 ms | 0.15 s | 22, −8.1, 0.12 | |
  | 100 ms | 0.3 s | 8.0, −1.0, 0.0002 | 1.5 rad |

  The input sequence falls roughly as Ts⁻ⁿ for short Ts (inference from Φⁿ and Wc⁻¹; the table agrees). This is the classic statement that deadbeat is too aggressive at short sample times (textbook: Åström and Wittenmark, on choosing the sample time for deadbeat).
- **At a limit it is not deadbeat.** Clipped to ±12 V, the 10 ms design's 655 V becomes 12 V; the law's assumption is broken and the shaft overshoots by 17 %, within 2 % after about 0.22 s, not 30 ms (simulation). Deadbeat under saturation can also limit-cycle or go unstable for large steps (textbook: the anti-windup literature; not seen on this motor).
- **Sensitivity to model error.** All poles at the origin is a fragile spot: the closed loop's poles move fastest away from a multiple pole (inference: an n-fold root moves as the n-th root of a perturbation). Measured (simulation): the 100 ms design on a rotor 20 % heavier overshoots by 6 % and takes 0.63 s to come within 1 mrad; LQR's gains on the same motor do not overshoot. The Analysis tab: gain margin ×1.8 and Ms 2.25 at 100 ms, ×1.24, 18° and Ms 5.19 at 10 ms; the example's LQR has 97° and Ms 1.10.
- **Intersample ripple**, in the output form only (above).
- **Noise and unmodelled dynamics.** Large gains amplify measurement noise and excite anything the model leaves out (inference; the same reason Ms is high).

## How practice tames it

- **A longer sample time** (textbook: Åström and Wittenmark): the first lever. The settling time n·Ts is then chosen as one would choose a closed-loop time constant, and the input follows from it. Built here as "Update every k": the deadbeat runs at k·Ts inside a block that samples at Ts.
- **Relaxed deadbeat over n + k samples** (textbook: Isermann's DB(v + 1)): the first input is prescribed (smaller), and one more sample is allowed; settling in n + 1 samples with a chosen u₀. More generally, a finite-time input of N > n samples chosen for least effort (inference: a least-norm solution of the reachability equation over N steps), or poles placed near, not at, the origin.
- **Poles near the origin, not at it** (pole placement, or LQR with a small R): smooth, robust, no finite settling. The example's LQR stands for this.

## Fit with Loop Tuner

- A designed type (designs-in-the-page.md): its K and kr are computed in the page from the plant the block sees, linearised at its origin and discretised (zero-order hold) at k·Ts; nothing plant-specific is stored. Refusals in sentences: not every state measured, a measurement fed through from u, a dead time (its delayed inputs are states the law does not see), a plant u cannot steer in every state (two identical lags driven alike), and Ackermann's result checked by (Φ − ΓK)ⁿ against Φⁿ (an eigenvalue check fails: a nilpotent matrix's eigenvalues come out near ε^(1/n)).
- Ackermann's formula is numerically poor for many states (textbook: Kautsky, Nichols and Van Dooren 1985 give a robust placement, but for distinct poles only; a multiple pole at 0 is the hard case for any placement). The check above refuses a result that is off; for the library's three states it is exact to rounding.
- The Analysis tab analyses a law updated every k samples at k·Ts, where it is linear (`linear` returns its own Ts; `loopModel` takes it), and says so.

## Not built

- **The output forms** (minimal prototype, ripple-free): they need a controller with its own dynamics in z (a discrete transfer function), which no hand type in the library has yet. Building one is the next step if the person wants to see the ripple; the minimal prototype on the motor would cancel the sampling zero near −3.7 and show u growing without bound (inference).
- **The deadbeat observer**: an Observer variant with its error's poles at z = 0 (the Luenberger observer with placed poles takes poles in s, z = e^(−w·Ts), which never reaches 0).
- **DB(v + 1)** and a least-effort finite-time law.

## Sources

- K. J. Åström and B. Wittenmark, *Computer-Controlled Systems: Theory and Design*, 3rd ed., Prentice Hall, 1997 (Dover reprint 2011): deadbeat by state feedback and by the polynomial approach, deadbeat observers, minimum-time control, the choice of sample time.
- R. Isermann, *Digital Control Systems*, Vol. 1, 2nd ed., Springer, 1989: deadbeat controllers DB(v) and DB(v + 1), their input sizes and sensitivity.
- G. F. Franklin, J. D. Powell and M. L. Workman, *Digital Control of Dynamic Systems*, 3rd ed., Addison-Wesley, 1998: Ackermann's formula, deadbeat by pole placement, intersample ripple, ripple-free design.
- J. R. Ragazzini and G. F. Franklin, *Sampled-Data Control Systems*, McGraw-Hill, 1958: the minimal-prototype design.
- K. J. Åström, P. Hagander and J. Sternby, "Zeros of sampled systems", *Automatica* 20(1), 1984, pp. 31–38: the sampling zeros.
- J. Kautsky, N. K. Nichols and P. Van Dooren, "Robust pole assignment in linear state feedback", *Int. J. Control* 41(5), 1985, pp. 1129–1155.
- This repository: `src/core/design.js` (`deadbeatDesign`), `test/deadbeat.test.mjs`, which holds the (simulation) numbers for 10 ms and 100 ms and the example's; the table's other rows come from the same formula run once by hand (the K and inputs at each Ts).
