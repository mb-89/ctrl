import json, numpy as np, roboticstoolbox as rtb
# The reference values of test/robot.test.mjs: python puma560-toolbox.py > puma560-toolbox.json (then add the "about" text).
p = rtb.models.DH.Puma560()
nf = p.nofriction(coulomb=True, viscous=True)
rng = np.random.default_rng(560)
states = [('qz', p.qz), ('qr', p.qr), ('qs', p.qs), ('qn', p.qn)]
for k in range(4):
    lo = np.array([l.qlim[0] for l in p.links]); hi = np.array([l.qlim[1] for l in p.links])
    states.append((f'random{k+1}', lo + (hi - lo) * rng.random(6)))
out = []
for name, q in states:
    q = np.array(q, float)
    qd = rng.uniform(-1.5, 1.5, 6); qdd = rng.uniform(-3, 3, 6)
    out.append(dict(name=name, q=q.tolist(), qd=qd.tolist(), qdd=qdd.tolist(),
      M=nf.inertia(q).tolist(), g=nf.gravload(q).tolist(), tau=nf.rne(q, qd, qdd).tolist(),
      T=p.fkine(q).A.tolist(), J=p.jacob0(q).tolist(),
      friction=[float(l.friction(v)) for l, v in zip(p.links, qd)]))
M0 = nf.inertia(np.zeros(6)); 
print(json.dumps(dict(states=out), indent=None))
