// The PUMA 560: its robot description (URDF) and its drives, as published.
// These are physics inputs, not results: everything else (gravity torques,
// gains, the circle's place) is computed from them in the page.
//
// Kinematics: the standard Denavit–Hartenberg table of the arm (Paul's
// convention, with the pedestal of 0.67183 m and a flange 56.25 mm beyond the
// wrist centre), written as URDF joints: joint i sits at
// xyz (a_{i−1}, −d_i·sin α_{i−1}, d_i·cos α_{i−1}), rpy (α_{i−1}, 0, 0), axis z.
// Inertias: the arm's measured link masses, centres of mass and moments,
// moved into the URDF's link frames, with link 4's centre of mass at −0.019
// and link 3's at −0.014 (corrected signs), and link 1's mass 13 kg (it does
// not enter the dynamics: link 1 turns about its own axis through its mass).
// The published moments of link 3 (0.066, 0.0125, 0.086 kg·m² in its frame)
// are no rigid body's: 0.066 + 0.0125 < 0.086. Adding δ = 0.01 to its two
// moments normal to joint 3 and taking δ from link 1's moment about the
// waist leaves the dynamics exactly as published: joint 3 is parallel to
// joint 2, which is normal to the waist, so δ·(I − z₃z₃ᵀ) on link 3 adds
// ½·δ·q̇1² of kinetic energy, the same as δ on link 1's waist moment. Link 1's
// two other moments (0.175) only keep its tensor physical.
// Limits: the joint ranges as published for the arm; effort is the torque at
// the fuse, velocity the back-EMF limit, both at the joint.
// Shapes: our own boxes and cylinders, in the link frames.

const U = `<robot name="puma560">
<material name="body"><color rgba="0.86 0.84 0.78 1"/></material>
<material name="dark"><color rgba="0.32 0.34 0.37 1"/></material>
<material name="tool"><color rgba="0.85 0.27 0.2 1"/></material>
<link name="base">
<visual><origin xyz="0 0 0.015"/><geometry><box size="0.42 0.42 0.03"/></geometry><material name="dark"/></visual>
<visual><origin xyz="0 0 0.31"/><geometry><cylinder radius="0.11" length="0.56"/></geometry><material name="body"/></visual>
</link>
<joint name="j1" type="revolute"><parent link="base"/><child link="link1"/><origin xyz="0 0 0.67183"/><axis xyz="0 0 1"/>
<limit lower="-2.792526803190927" upper="2.792526803190927" effort="56" velocity="1.92"/></joint>
<link name="link1">
<inertial><mass value="13"/><inertia ixx="0.175" iyy="0.175" izz="0.34" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 -0.04"/><geometry><cylinder radius="0.1" length="0.08"/></geometry><material name="dark"/></visual>
<visual><origin xyz="0 0.08 0" rpy="1.5707963267948966 0 0"/><geometry><cylinder radius="0.1" length="0.2"/></geometry><material name="body"/></visual>
</link>
<joint name="j2" type="revolute"><parent link="link1"/><child link="link2"/><origin rpy="1.5707963267948966 0 0"/><axis xyz="0 0 1"/>
<limit lower="-0.7853981633974483" upper="3.9269908169872414" effort="97" velocity="1.51"/></joint>
<link name="link2">
<inertial><origin xyz="0.068 0.006 0.2275"/><mass value="17.4"/><inertia ixx="0.13" iyy="0.524" izz="0.539" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 0.065"/><geometry><cylinder radius="0.09" length="0.08"/></geometry><material name="dark"/></visual>
<visual><origin xyz="0.2159 0 0.065"/><geometry><box size="0.4318 0.15 0.07"/></geometry><material name="body"/></visual>
<visual><origin xyz="0.4318 0 0.065"/><geometry><cylinder radius="0.075" length="0.07"/></geometry><material name="body"/></visual>
</link>
<joint name="j3" type="revolute"><parent link="link2"/><child link="link3"/><origin xyz="0.4318 0 0.15005"/><axis xyz="0 0 1"/>
<limit lower="-3.9269908169872414" upper="0.7853981633974483" effort="52" velocity="2.4"/></joint>
<link name="link3">
<inertial><origin xyz="0 0.07 0.014"/><mass value="4.8"/><inertia ixx="0.076" iyy="0.0225" izz="0.086" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 0"/><geometry><cylinder radius="0.065" length="0.08"/></geometry><material name="dark"/></visual>
<visual><origin xyz="0.0102 0.18 0"/><geometry><box size="0.085 0.36 0.07"/></geometry><material name="body"/></visual>
</link>
<joint name="j4" type="revolute"><parent link="link3"/><child link="link4"/><origin xyz="0.0203 0.4318 0" rpy="-1.5707963267948966 0 0"/><axis xyz="0 0 1"/>
<limit lower="-1.9198621771937625" upper="2.9670597283903604" effort="10" velocity="5.34"/></joint>
<link name="link4">
<inertial><origin xyz="0 0 -0.019"/><mass value="0.82"/><inertia ixx="0.0018" iyy="0.0018" izz="0.0013" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 -0.055"/><geometry><cylinder radius="0.042" length="0.07"/></geometry><material name="dark"/></visual>
</link>
<joint name="j5" type="revolute"><parent link="link4"/><child link="link5"/><origin rpy="1.5707963267948966 0 0"/><axis xyz="0 0 1"/>
<limit lower="-1.7453292519943295" upper="1.7453292519943295" effort="10" velocity="5.09"/></joint>
<link name="link5">
<inertial><mass value="0.34"/><inertia ixx="0.0003" iyy="0.0003" izz="0.0004" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><geometry><cylinder radius="0.038" length="0.09"/></geometry><material name="body"/></visual>
</link>
<joint name="j6" type="revolute"><parent link="link5"/><child link="link6"/><origin rpy="-1.5707963267948966 0 0"/><axis xyz="0 0 1"/>
<limit lower="-4.642575810304916" upper="4.642575810304916" effort="10" velocity="5.74"/></joint>
<link name="link6">
<inertial><origin xyz="0 0 0.032"/><mass value="0.09"/><inertia ixx="0.00015" iyy="0.00015" izz="0.00004" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 0.038125"/><geometry><cylinder radius="0.03" length="0.03625"/></geometry><material name="dark"/></visual>
</link>
<joint name="flange" type="fixed"><parent link="link6"/><child link="flange"/><origin xyz="0 0 0.05625"/></joint>
<link name="flange">
<visual><geometry><sphere radius="0.012"/></geometry><material name="tool"/></visual>
</link>
</robot>
`;

// The drives, motor side unless said otherwise, per joint 1 … 6: gear ratio
// G (motor turns per joint turn; negative where the motor turns against its
// joint, as on joints 1 and 3, so that each direction's friction applies to
// the motor's direction as it was measured), rotor inertia Jm (kg·m²), torque constant
// kt (N·m/A), viscous friction B (N·m·s/rad), Coulomb friction for forward
// and reverse motor speed Tcp, Tcn (N·m, magnitudes), the current loop's
// limit imax and the fuse (A), the armature resistance Ra (Ω) and the
// amplifier's voltage Vmax (V). The current drive is flat to 400 Hz: an
// ideal current source at a 1 ms step. ws (rad/s, motor side) smooths the
// Coulomb step for a fixed-step solver.
const DRIVE = {
  G: [-62.6111, 107.815, -53.7063, 76.0364, 71.923, 76.686],
  Jm: [200e-6, 200e-6, 200e-6, 33e-6, 33e-6, 33e-6],
  kt: [0.227, 0.228, 0.238, 0.0675, 0.0718, 0.0534],
  B: [1.48e-3, 0.817e-3, 1.38e-3, 71.2e-6, 82.6e-6, 36.7e-6],
  Tcp: [0.435, 0.126, 0.105, 11.2e-3, 9.26e-3, 3.96e-3],
  Tcn: [0.395, 0.0709, 0.132, 16.9e-3, 14.5e-3, 10.5e-3],
  ws: 2,
  imax: [8.83, 8.77, 8.74, 4.42, 4.42, 4.49],
  fuse: [4, 4, 4, 2, 2, 2],
  Ra: [2.1, 2.1, 2.1, 6.7, 6.7, 6.7],
  Vmax: 40,
};

// A touch probe on the flange (inputs 40, 41): a stylus 0.1 m long along
// the flange's z axis with a ruby ball of 12 mm radius at its end, whose
// centre is the tool point (the link "tip"). Its mass is the arm's to
// carry: a carbon stylus and its holder, 0.1 kg with the centre of mass at
// 40 mm, a slender rod's inertia (m·L²/12 across, little along it), the
// ball's few grams inside it.
const PROBE = `<material name="ruby"><color rgba="0.8 0.05 0.12 1"/></material>
<joint name="probe" type="fixed"><parent link="flange"/><child link="probe"/></joint>
<link name="probe">
<inertial><origin xyz="0 0 0.04"/><mass value="0.1"/><inertia ixx="0.0000833" iyy="0.0000833" izz="0.000002" ixy="0" ixz="0" iyz="0"/></inertial>
<visual><origin xyz="0 0 0.012"/><geometry><cylinder radius="0.014" length="0.024"/></geometry><material name="dark"/></visual>
<visual><origin xyz="0 0 0.058"/><geometry><cylinder radius="0.004" length="0.07"/></geometry><material name="body"/></visual>
</link>
<joint name="tip" type="fixed"><parent link="probe"/><child link="tip"/><origin xyz="0 0 0.1"/></joint>
<link name="tip">
<visual><geometry><sphere radius="0.012"/></geometry><material name="ruby"/></visual>
</link>
`;

export const PUMA560 = {
  urdf: U,
  drive: DRIVE,
  // The rotors as the joints feel them: G²·Jm on the mass matrix's diagonal.
  armature: DRIVE.G.map((G, i) => G * G * DRIVE.Jm[i]),
  // The tool frame, and a start pose with the tool pointing down, well inside
  // every joint's range and away from the singularities (degrees).
  tool: 'flange',
  // The arm with the probe on its flange: what the library system runs and draws.
  urdfProbe: U.replace('</robot>', `${PROBE}</robot>`),
  start: [0, 40, -150, 0, -70, 0],
};
