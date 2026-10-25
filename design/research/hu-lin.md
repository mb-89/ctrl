# Research: the Hu–Lin variable-gain controller

Reader: whoever builds or judges the Hu–Lin controller in Loop Tuner and its example. The person's words are in [input 33](../input/2026-10-25-33-hu-lin-controller.md). **Status: research in progress (2026-10-25); the controller and the example are not built yet.**

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

## Where we stopped (2026-10-25) and what comes next

- Not yet found: the exact smoothing Hu and Lin use and the PUMA 560 numbers of the paper (closed text). Next: one more search for a copy or a thesis that restates it; else build the scheme from the sources above and mark the smoothing as ours.
- Next: the designed type (the family from the plant in the page, discrete Riccati at Ts, the nested ellipsoids, ε(x) per sample), the example against PID with clamping and back-calculation and LQR with saturation, the measurements, the verdict.

## Sources

- Hu, Lin, TAC 47(9) 2002, doi:10.1109/TAC.2002.802739; CDC 2002, doi:10.1109/CDC.2002.1185091 (Crossref, OpenAlex).
- Grognard, Sepulchre, Bastin, "Improving the performance of low-gain designs for bounded control of linear systems", *Automatica* 38 (2002), 1777–1782; preprint at perso.uclouvain.be/georges.bastin/paper66.pdf.
- Wredenhagen, Bélanger, *Automatica* 30(3), 1994, 403–416.
- Megretski, IFAC World Congress 1996, 435–440.
- Lin, Saberi, *Systems & Control Letters* 21(3), 1993, 225–239; Lin, *Automatica* 34(7), 1998, 897–905; Saberi, Lin, Teel, *IEEE TAC* 41(3), 1996, 368–378.
- Hu's publication list: faculty.uml.edu/thu/constrained_control.htm.
