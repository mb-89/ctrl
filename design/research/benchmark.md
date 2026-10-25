# Research: the controller benchmark

Reader: whoever builds or changes the benchmark ([../output/benchmark.md](../output/benchmark.md)). It covers two things the design rests on: Pugh's concept selection and how control people judge one controller against another. Gathered on 2026-10-25. Where a source was found only second-hand, it says so.

## 1. Pugh's concept selection

**What it is.** Stuart Pugh (Loughborough, then Strathclyde) described it in the 1980s and in *Total Design: Integrated Methods for Successful Product Engineering* (Addison-Wesley, 1991). It is a matrix: the concepts are the columns, the criteria are the rows. One concept is the **datum** (the reference, often the existing design or the best-known option). Every other concept is marked against the datum on each criterion: **+** (better), **S** (same) or **−** (worse). The method is deliberately not numeric: you only say better or worse than the datum. [Cambridge IfM, controlled convergence](https://www.ifm.eng.cam.ac.uk/research/dmg/tools-and-techniques/controlled-convergence/); [Wikipedia, Stuart Pugh](https://en.wikipedia.org/wiki/Stuart_Pugh); [MIT ESD.33 lecture notes on Pugh concept selection](https://mitocw.ups.edu.ec/courses/engineering-systems-division/esd-33-systems-engineering-summer-2004/lecture-notes/s7_pg_cnpt_slctn.pdf).

**The steps** (as the textbooks teach it; the book itself was found only second-hand):
1. Choose the criteria from the requirements. They must tell the concepts apart; a criterion where everything is S does no work.
2. Choose a datum. Pugh's advice is a strong one: the best concept you know.
3. Mark each concept + / S / − against the datum, criterion by criterion.
4. Count the +, S and − per concept. Read the counts as guidance, not as a score: Pugh warned that the marks "must not be summed algebraically" ([lecture deck quoting Pugh](https://www.slideshare.net/slideshow/pugh-matrix-concept-evaluation-in-design/49669603)). Weighted totals are a later, common variant (Σ weight × (+1, 0, −1)), used in Six Sigma and in Ulrich and Eppinger's concept screening.
5. Look at the strong concepts' − rows: can a concept be improved there, or can two be combined? Add the hybrids.
6. **Iterate**: run the matrix again with the strongest concept as the new datum. Concepts fall away, new ones come in, the set converges ("controlled convergence"). Pugh's point was that analysis and synthesis alternate.

**What is known about how well it works.** Frey, Herder, Wijnia, Subrahmanian, Katsikopoulos and Clausing simulated design teams using the method (*Research in Engineering Design* 20(1): 41–58, 2009, doi 10.1007/s00163-008-0056-z; [TU Delft record](https://research.tudelft.nl/en/publications/the-pugh-controlled-convergence-method-model-based-evaluation-and), [MIT DSpace](https://dspace.mit.edu/handle/1721.1/49448)): a **strong datum helps convergence**, repeated matrices help the experts' opinions converge, and the method did better than one summary criterion or a Borda count under a wide range of assumptions. The criticism: Hazelrigg argued from Arrow's impossibility theorem that rank aggregation over several criteria can be inconsistent ("The implications of Arrow's impossibility theorem on approaches to optimal engineering design", ASME J. Mech. Des. 118: 161–164, 1996; his comment on Frey et al., *Res. Eng. Design* 21: 143–144, 2010). The practical answer, which the design takes: **show the numbers under the marks**, keep the marks relative to one datum, and treat the total as a guide for a person's decision, not a verdict.

**What this means for the benchmark.**
- The marks come from measured numbers, so "better" needs a tolerance: within it, S. Without one, a 0.1 % difference would be a +.
- The datum matters: a weak datum makes everything +. A badly tuned running variant (the oven's, J 1.28) is a weak datum; a PID tuned by the same procedure as the others is a strong one.
- Iterating (step 6) and the hybrids (step 5) are left to the person: the benchmark makes one matrix against one datum, the tuned PID (the person, input 48: "set a good datum and then the others are either plus or minus one … Don't make it too complicated"). Running it again after a change is the iteration.
- Hard requirements are not criteria: a concept that fails one is out, not "−". In controls: a loop that diverges, or is unstable where it runs.

## 2. How control benchmarks judge controllers

### Benchmark plants
- Åström and Hägglund, "Benchmark systems for PID control", IFAC *Digital Control: Past, Present and Future of PID Control*, 2000 ([Lund record](https://lup.lub.lu.se/record/537934)): a set of transfer functions (lag-dominated, delay-dominated, integrating, oscillating, non-minimum-phase …) for testing PID rules. The lesson: judge a method on a spread of plants, not one.
- Wie and Bernstein, "Benchmark problems for robust control design", ACC 1990/1991 (doi 10.23919/ACC.1991.4791727, found second-hand): a two-mass–spring system with uncertain stiffness. Every design is judged on the same plant, the same disturbances and the **same uncertainty range**, and against settling time, effort and robustness at once. That is the shape the benchmark takes: one plant, one experiment, one variation range.

### The criteria in practice

| Criterion | Usual measure | Notes and sources |
|---|---|---|
| Following the reference | IAE, ITAE, ISE of e = r − y after a setpoint step; overshoot; rise and settling time (2 % or 5 %) | ITAE punishes errors that last (Graham and Lathrop 1953). The repo's cost already has IAE/ITAE/ISE ([../output/autotune.md](../output/autotune.md)) |
| Rejecting a disturbance | IAE after a load step at the plant input | For process control the more important one: Åström–Hägglund's MIGO/AMIGO maximise integral gain (≈ minimise IAE for a load step) under a robustness bound; Garpinger and Hägglund minimise IAE for an input load step ([Garpinger, Hägglund, NPCW 2009](https://skoge.folk.ntnu.no/prost/proceedings/npcw09/A-S-Garpinger-O-1.pdf)) |
| Effort | IAE or rms of u, or of u about its mean; peak u | Skogestad's SIMC work and Grimholt–Skogestad weigh input usage alongside IAE (see [autotune.md research](autotune.md)) |
| Actuator wear | **Total variation** of u, Σ\|Δu\| | The standard measure of "how hard on the actuator" (Skogestad 2003 uses TV for input smoothness). It is what separates an ideal sliding mode from its boundary layer (§3 of the design) |
| Saturation | share of time at a limit; windup | A loop that lives at its limit is open; anti-windup decides how it comes back |
| Robustness margins | **Ms** = max\|S\| (≤ 1.4 good, ≤ 2 acceptable), gain margin (> 2), phase margin (> 30–45°), delay margin; Mt | Skogestad and Postlethwaite, *Multivariable Feedback Control*, ch. 2; Åström–Hägglund. Ms bounds both margins: GM ≥ Ms/(Ms − 1), PM ≥ 2 arcsin(1/(2 Ms)). The repo computes them all ([analysis.md research](analysis.md)) |
| Robustness to plant change | The criteria again on perturbed plants (a parameter grid or random draws), worst case and spread; Kharitonov or μ for linear sets | Scenario robustness is what works for nonlinear and switching laws, which have no margins. The person's HIL plant varies by ±15 % (input 10) |
| Noise sensitivity | Noise gain from measurement to u (high-frequency gain of C, \|C(e^{jπ})\| at Nyquist); SDU, the standard deviation of u from measurement noise | Romero Segovia, Hägglund and Åström propose SDU as the noise counterpart of IAE ([Lund](https://www.lunduniversity.lu.se/lup/publication/ed14e22b-d167-491b-a19a-b43a423c4e05)); Garpinger, Åström and Hägglund, "Performance and robustness trade-offs in PID control", *J. Process Control* 24(5): 568–577, 2014, frame load rejection, robustness and noise injection as one trade-off (found via [Åström's slides](https://canal.uned.es/uploads/material/Video/21276/Conferencia_Karl_Astrom.pdf)) |
| Implementation complexity | Number of parameters, measurements needed (full state vs output), whether a model is needed, nonlinear or switching law, sample rate needed | Usually a judgement; here derived from the registry |
| Tuning effort | Experiments or simulations needed; whether a model must be identified first | The repo's methods already report runs |

**The trade-off is the point.** Every source above says the same: load rejection, reference following, robustness, effort and noise pull against each other. A ranking on one number (the tuner's J) hides that. Iterate's J has no robustness term, so tuning to J alone can buy a little IAE with a lot of robustness: the prototype found exactly that (the tank's schedule tuned to Ms 12, phase margin 9°; [benchmark-prototype.md](benchmark-prototype.md)). MIGO's answer, optimise performance subject to Ms ≤ M, is the one the design adopts for tuning.

### Fairness: comparing tuned controllers
- Compare each structure **at its best on the same goal**, not as it happens to be set ([autotune.md research](autotune.md), the reviewer's note: Grimholt–Skogestad compare IAE-optimal controllers at a fixed Ms). Otherwise the benchmark measures the tuning, not the structure.
- The same experiment (reference, disturbance, duration, sampling), the same actuator limits, the same robustness bound, the same tuning budget.
- A structure that needs a measurement the plant does not provide (ẏ, the full state) is not worse: it does not apply, and the benchmark says what it would need.
- Some tasks are not "follow r" at all (a swing-up must bring the pole up); a shared cost cannot judge them (the autotune research reviewer's "per-variant goals").

## 3. What exists in the repository already

- The cost J, Iterate, relay and step tests: `src/core/autotune.js` ([../output/autotune.md](../output/autotune.md)).
- Margins, Ms, poles, the linear step: `analyzeLoop` and `loopModel` ([../output/analysis.md](../output/analysis.md)).
- Designs that compute a controller from the plant (LQR, pole cancellation, feedforward …) and their refusals as sentences: `design.js` and each type's `design` ([../output/designs.md](../output/designs.md)).
- The ±15 % variation (`varyDiagram`) and the identified model's twin diagram (`twinDiagram`): designed in [../output/identification.md](../output/identification.md) §16, not built.
- The metrics of v1 (`src/core/metrics.js`: ITAE, settling, overshoot, uTV, saturation) for the old slot loop; the benchmark's criteria reuse their definitions where they match.
