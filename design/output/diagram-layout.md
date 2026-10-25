# The Plant diagram lays itself out: automatic layout and routing

Reader: the agent who builds the self-arranging Plant diagram (ELK vendored into the page, the layout in `src/core`, the new editing gestures in `src/ui/plant.js`), or who later changes how a diagram is drawn. This is the plan, not yet built. It merges two research reports of 2026-10-25 (a library trial on all 11 diagram levels of the System library, and an interaction study with an ELK prototype) and one more measurement made for this plan (§3.9). Where the code and this plan differ later, the code and [decisions.md](decisions.md) win.

The person ([input 11](../input/2026-10-25-11-diagram-auto-layout.md)): "I feel like it's not necessary that we place things in arbitrary positions. Think about if you can have a something like graph with in that sense that's just sorts everything from left to right. And draws the lines automatically. And then you would just drop give that thing enough space so you can drop new elements onto lines, and then they get connected. I guess I don't like the way the lines connect now. Because they sometimes go in weird loops. And you can't drag the lines individually. But I actually if you can find an auto router, I would be fine with that. I'm pretty sure there is an existing solution for something like this, and we don't have to reinvent it." On size ([input 14](../input/2026-10-25-14-puma-notes-size.md)): "If the full HTML is below, I guess, 20 or 30 megabytes, that's sufficient. We don't skimp on anything."

## 0. Bottom line: what the person sees and does

**The page draws the diagram; nobody places a block.** Open the Plant tab and the diagram is laid out left to right in columns:

```
                    ┌──► ▸ u              d ▸ ─┐
                    │                          ▼
  r ▸ ──► Σ ──► C ──●────────────────────────► Σ ──► P ──●──► ▸ y     the main line, straight
          ▲                                              │
          └─────────── noise ◄──── sensor H ◄────────────┘          the return path, mirrored, below
```

- **The main line** runs straight from the first Source to its Sink.
- **Above it**: what comes in from outside (a disturbance d, a second Source) and taps (a Sink recording a signal on the way). This is a preference: a tap that would cross wires there sits below.
- **Below it**: the return path. Its blocks are drawn mirrored (input on the right) and the measurement runs right to left into the Sum from below.
- **Every wire is right-angled.** No wire runs through a block or on top of another wire. A signal that branches is one trunk with a dot at each branch.
- **Columns are 56 px apart**, so every wire has a straight stretch to drop a block on.

**Adding a block is dropping it onto a wire.** Drag a Gain from the library over the wire from the second Σ to P. The wire lights up and a hint says "Insert into Σ → P". Let go: the Gain is wired in (Σ → Gain → P), and in 200 ms the blocks downstream glide one column to the right to make room. Clicking a library item instead inserts it into the selected wire (or after the selected block), so touch and keyboard work too.

**Other edits keep the same idea:**
- **Del** removes a block and joins its neighbours ("joined Σ → P", with Undo). Shift+Del removes it without joining.
- **Wires are drawn by the page and cannot be dragged.** Drag from an output to an input to wire them, as today. Drag along a wire to an input to branch that signal.
- **Dragging a block** onto another wire moves it there. Dragging it up or down in its column reorders it, where the layout leaves that choice open.
- **Flip is gone.** A block on a feedback path is mirrored because of its wires.
- **The same file gives the same picture** on every machine, and Undo returns exactly the picture before.

**The library is ELK, the Eclipse Layout Kernel** (elkjs 0.12.0, EPL-2.0). It is a layered left-to-right layout with right-angled routing that knows ports: which side of a block each sits on, in what order, at what position. It is the existing solution the person expected. Ptolemy II's automatic layout is built on its predecessor (KIELER), and Eclipse Sirius, Sprotty and GLSP use it. It adds 1.6 MB to the page (0.75 → 2.36 MB), well inside the 20 MB the person allows.

Pictures, all from this plan's configuration (session scratch, may be gone):
- every library level and a textbook loop on one sheet: `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/dlay/out/design--all-levels.png`
- one per level, `…/scratchpad/dlay/out/<level>--design.png`, for example `textbook--design.png`, `msd--design.png`, `motor-sub--design.png`, `oven--design.png`, `triple--design.png`
- a block dropped on a main-line wire, `…/scratchpad/dlay/out/<level>--design--insert.png`, for example `msd--design--insert.png`

## 1. Why today's lines loop

`route()` in `src/ui/plant.js` (lines 57–65) knows two cases:
- A forward wire gets one vertical step halfway between its ports.
- A wire that runs backward, or reaches a flipped block, goes 14 px out, down to a lane 34 px below the lower of its two ports, across, and back up.

Nothing avoids the blocks in between, two feedback wires get the same kind of lane and run on top of each other, and bend points are never stored, so a wire cannot be dragged. Measured over the 11 levels as stored today (120 wires):
- 43 crossings;
- 32 wires through blocks;
- 1103 px of wire on top of other wires;
- 9 wires drawn the wrong way;
- 3 pairs of overlapping blocks.

The oven's heater → Σ and chamber → sensor loops were confirmed in the real page (`…/scratchpad/work/out/final/real-page--oven-badly-tuned.png`).

Automatic routing removes the need to drag a wire. The drag gesture on a wire gets a new meaning, a branch (§4).

## 2. The library: ELK Layered, through elkjs 0.12.0

### 2.1 Survey

Sizes are what the page would inline. "Provenance hits" is our provenance test's pattern list run over the library's text. The standalone patterns (`fetch(`, `import(`, `importScripts(`, XMLHttpRequest, sendBeacon) are counted separately.

| Library | Licence | Size (min / gzip) | Synchronous in the page | Provenance hits | Notes |
|---|---|---|---|---|---|
| **elkjs 0.12.0** (the engine file) | EPL-2.0 or GPL-3.0+ | 1558 / 454 KiB | Yes, through its dispatcher (§2.4) | 0 (code and licence text); standalone 0 | Eclipse project since 2017; releases 2025-09, 2026-03, 2026-07 |
| @kazant/flexgraph 1.3.0 | MIT | 41 / 16 KiB | Yes | 1 (its licence banner) | First published 2026-10-09, one author |
| @dagrejs/dagre 3.1.3 | MIT | 47 / 16 KiB | Yes | 0 | No ports, no orthogonal routing |
| obstacle-router 0.1.2 (libavoid in TypeScript) | LGPL-2.1 | 181 / 47 KiB | Yes | 0 | Router only; new (2026-03) |
| @msagl/core 1.1.24 | MIT | 737 / 183 KiB | Yes | 0 | Slow releases |
| libavoid-js 0.5.0-beta.5 | LGPL-2.1+ | 44 KB + 492 KB WebAssembly | Compiles synchronously (7 ms) | A home path and `fetch(`, unless patched | Beta; router only |
| Graphviz (@hpcc-js/wasm-graphviz, @viz-js/viz) | Apache-2.0 / MIT + Graphviz | 801–1505 KiB | No (async) | 2–44, plus `fetch(` | Its orthogonal routing ignores ports |
| @maxgraph/core, @joint/core, @antv/x6 | Apache-2.0 / MPL-2.0 / MIT | 421–423 KiB | Need their own DOM model | 0 | Whole editors |
| webcola, d3-dag, grid-router, klayjs | MIT / EPL-1.0 | 3–113 KiB | Yes | 0–1 | Force layout, DAG only, router only, unmaintained since 2016 |
| yFiles for HTML | Commercial | | | | Best incremental layout; cannot ship in an open single file |

### 2.2 Trial

Six approaches were run on all 11 levels: the mass–spring–damper (msd), the DC motor and its Motor subsystem, sliding mode (smc), the encoder example and its Motor, the tank, the cart–pole, the triple pendulum, the oven and HIL. Chromium 153 headless, median of 20 runs; Graphviz in Node.

**Totals over the 120 wires.** The last row is this plan's configuration (§3.8), measured with the trial's metrics in Node (§3.9).

| | Crossings | Wires through blocks | Wire on wire (px) | Wire ends off their port | Drawn the wrong way | Bends |
|---|---|---|---|---|---|---|
| Today (stored positions, current router) | 43 | 32 | 1103 | 0 | 9 | 287 |
| ELK, plain | 29 | 0 | 0 | 0 | 0 | 194 |
| ELK, return path mirrored | 29 | 0 | 0 | 0 | 0 | 188 |
| FlexGraph | 27 | 0 | 847 | 0 | 0 | 278 |
| dagre + obstacle-router | 81 | 0 | 1534 | 0 | 0 | 255 |
| MSAGL | 40 | 2 | 0 | 99 (+23 leave a port sideways) | 0 | 174 |
| Graphviz, `splines=ortho` | 10 | 84 | – | 92 | – | – |
| **This plan** (ELK, rules of §3) | **31** | **0** | **0** | **0** | **0** | **159** |

**Crossings per level:**

| Level | Today | ELK mirrored (trial) | This plan |
|---|---|---|---|
| msd | 3 | 1 | 1 |
| motor | 1 | 0 | 0 |
| motor subsystem | 1 | 0 | 0 |
| sliding mode | 3 | 0 | 0 |
| encoder | 2 | 0 | 0 |
| encoder subsystem | 3 | 0 | 0 |
| tank | 2 | 0 | 0 |
| cart–pole | 5 | 4 | 3 |
| triple pendulum | 18 | 23 | 26 |
| oven | 2 | 0 | 0 |
| HIL | 3 | 1 | 1 |

**The triple pendulum stays busy in every library.** Its 8 state wires run back to the controller side by side. Best of 8 seeds brings it to 15 crossings in this plan's configuration (9 in the trial's), at 8× the time. The real fix is a vector wire, which [robot.md](robot.md) §2 plans: one wire per group, drawn as a double stroke.

Side-by-side sheets of the trial (today, ELK, ELK mirrored, FlexGraph, dagre + obstacle-router, MSAGL), one per level: `…/scratchpad/work/out/final/compare--<level>.png` (`msd`, `motor`, `motor-sub`, `smc`, `encoder`, `encoder-sub`, `tank`, `cartpole`, `triple`, `oven`, `hil`). Graphviz ignoring ports: `…/scratchpad/work/out/dot-try/motor-sub-dot.png`.

### 2.3 Why ELK, and why not the others

**ELK** is the only library that got everything right on all 11 levels:
- no wire through a block;
- every wire starts and ends on its port, leaving and entering in the port's direction;
- no wire on top of another;
- every feedback wire goes round the blocks.

It honours fixed port positions and sides (`portConstraints FIXED_POS`), gives junction points for branches, takes the order of the blocks as a preference (model order), is deterministic, and runs synchronously. Its costs:
- **Size**: 1.6 MB, inside the person's 20 MB budget (input 14: "don't skimp on anything just because of size").
- **Licence**: EPL-2.0, met by carrying the notice and the licence text and saying where the source is (§9.3).

**FlexGraph is the runner-up.** It is MIT, 41 KB, the fastest (2.5 ms median), honours ports and was the most stable when steered by old positions. It loses on three counts:
- it was 16 days old with one author;
- it gives no junction points;
- it ran 847 px of wire on top of other wires in the triple, and at default spacing it left 68 of 120 wires too short to drop on.

With size no longer a concern, nothing favours it.

**The others lose for these reasons:**
- **dagre + obstacle-router**: dagre ignores ports, so it crosses at Σ inputs (81 crossings). obstacle-router nudges wires off a shared port or lets lanes collapse onto each other, its crossing penalty ran for over 60 s on a 10-block diagram, and it carries LGPL duties.
- **MSAGL**: misses ports (99 wire ends off their port).
- **Graphviz**: its orthogonal routing ignores ports (84 wires through blocks), and it loads asynchronously.
- **libavoid**: routing only, so we would write the layered layout ourselves.
- **The editors** (maxGraph, JointJS, X6): bring their own DOM model.

### 2.4 How it is called: synchronously

elkjs ships `lib/elk-worker.min.js`, the layout engine compiled from Java by GWT. Outside a worker it exports a class `Worker` (the package's "fake worker"). That object has a `dispatcher` whose `saveDispatch` runs a command and posts the reply through `onmessage` in the same call. Only `postMessage` defers to a `setTimeout`. So:

```js
// core: a synchronous layout(graph) from the engine's Worker class.
export function createElk(EngineWorker) {
  let w = null, reply = null, seq = 0;
  return function layout(graph) {
    if (!w) {
      w = new EngineWorker();
      w.onmessage = (e) => { reply = e.data; };
      w.dispatcher.saveDispatch({ data: { id: ++seq, cmd: 'register', algorithms: ['layered'] } });
    }
    reply = null;
    w.dispatcher.saveDispatch({ data: { id: ++seq, cmd: 'layout', graph, layoutOptions: {}, options: {} } });
    if (!reply) throw new Error('layout: the engine did not answer synchronously');
    if (reply.error) throw new Error(`layout: ${reply.error.message ?? reply.error}`);
    return reply.data;   // the same graph, with x, y on blocks and sections on wires
  };
}
```

- Tested in Node 22 and in Chromium 153: the reply arrives within the call (this plan's check, `…/scratchpad/dlay/wrapcheck.cjs`).
- `dispatcher` and `saveDispatch` are not documented API. The version is pinned and a test fails loudly if the reply is not synchronous, so an update cannot break this silently.
- We never use the package's promise API (`elk.bundled.js`). We call no worker URL, and the engine file contains no `new Worker`.

## 3. The picture: the rules

The drawing is a pure function of the level: its blocks, their order in `blocks`, their sizes and ports, and its wires. ELK places and routes; we decide what is feedback and what is mirrored, and which side each port is on.

### 3.1 Back wires, the main line, the return path

Left to its own cycle breaking, ELK started the motor subsystem at "load torque" and put the plant left of r, which is today's "weird loops" again. The other libraries reversed the controller's output wire in 7 of 11 levels. So we classify the wires ourselves, before ELK sees them (about 60 lines, `src/core/layout.js`):

1. **Back wires.** Search depth-first:
   - start from every block without input ports (Sources, In ports) in file order, then from the remaining blocks in file order;
   - take outputs in port order and, per port, wires in file order;
   - a wire into a block still on the search stack is a back wire.
2. **The main line.**
   - It starts at the first Source in file order; in a subsystem at In 1; else at the first block without inputs.
   - From each block it follows, among the forward wires, the one that leads to the longest forward path ending at a Sink or an Out port. In a tie the first wire wins (port order, then file order).
   - It stops at that Sink or Out port. A level without either takes the longest forward path.
3. **The return path.** For each back wire, walk upstream from its source block while the block has exactly one wire in and one wire out and is not on the main line. Those blocks are the return path. A Sink fed only from the return path joins it.

**Measured** (`…/scratchpad/dlay/final.mjs`, `classify`):
- **The person's own flips.** On all 11 levels the mirrored blocks are exactly the ones the person flipped by hand (`flip: true` in `src/core/plants.js`): Ke in both motors, damping c and spring k, torque ripple and torque noise. Nothing else is mirrored.
- **The main lines** run r → controller → … → angle, h, T, x, speed_m, e; V → … → speed in the subsystems; F → … → Epot in the msd. Interpretation: where two outputs compete, the longer path wins, so the msd's line ends at the spring's energy, with x as a tap.
- **The textbook loop** (r, Σ, C, d into a second Σ, P, y, a tap u, sensor H and noise back to Σ) mirrors H and noise.
- **A loop without a tap** (r → Σ → C → P → Σ) mirrors nothing: P stays on the line and its wire goes round below.

Rules tried and dropped:
- **"All outputs go back"** mirrored the whole loop.
- **"At most half the loop"** lost the torque ripple in the encoder.
- **The longest path without "ending at a Sink"** put the textbook's sensor on the main line.

**Mirrored blocks and back wires are handed to ELK reversed.** A back wire, and every wire into or out of a mirrored block, is given to ELK with source and target swapped, so ELK sees no cycle. Its route is reversed back for drawing. A mirrored block's input ports are on its east side and its outputs on its west side, so the measurement runs below the line, right to left. Flip is no longer a control. Precedents:
- Simulink flips a Gain for feedback (Ctrl+I) and rotates a block placed on a line that runs right to left.
- Klauske's Simulink layout routes cycle wires separately.
- LabVIEW turns a cycle into a Feedback Node.

### 3.2 Ports

- **Every block**: inputs on the left, outputs on the right, at today's positions in port order (`geom()` in `plant.js` moves to core), fixed (`elk.portConstraints FIXED_POS`, `elk.port.side`). Mirrored: inputs right, outputs left.
- **Sum**:
  - input 1 enters from the left;
  - any other input fed by a back wire or from the return path enters from below; any other enters from above;
  - ports on one side are spread evenly in port order;
  - each sign is drawn beside its port.

  Precedents: Simulink's round Sum with `|+-`; Klauske's ports on top and bottom. Measured against all inputs on the left: the same 31 crossings, 13 fewer bends (159 against 172), and the textbook picture.
- **A block whose name is drawn above it** (a named Gain or Switch) is handed to ELK 14 px taller, with its ports moved down by 14 px, so no wire runs through its name. This was not in the measurement, which did not count labels.

### 3.3 Bands and order: preferences, not constraints

The blocks are handed to ELK in this order:
1. **above**: every block that is neither on the main line nor on the return path (outside inputs, taps, side branches);
2. the main line;
3. **below**: the return path.

Within each band, file order decides. ELK takes this order as a preference (`considerModelOrder NODES_AND_EDGES`, `crossingCounterNodeInfluence 0.1`): a block out of order costs a tenth of a crossing. The main line's wires get `elk.layered.priority.straightness 10`.

**Measured:**

| Configuration | Crossings | Through blocks | Return blocks below the line | Taps above | Main-line wires without a bend |
|---|---|---|---|---|---|
| Order forced (`forceNodeModelOrder`) | 34 | 3 | 6 of 6 | 15 of 22 | |
| Order as a tie-breaker only | 33 | 0 | 5 of 6 | 11 of 22 | |
| **Order as a preference (0.1), this plan** | **31** | **0** | **6 of 6** | **14 of 22** | **55 of 57** |
| The same without straightness | 27 | 0 | | | 44 of 57 |

- **Forcing the order** sent a wire through a block in three levels: d → Σ through the tap F in the cart–pole and the triple, and int → Σ through the tap "angle" in sliding mode. With a block forced above a Sum in the same column, the route into the Sum's top port ran through that block.
- **Straightness** costs 4 crossings and keeps the main line straight; the line is what the person reads first.

Interpretation: a block that belongs above the line but would cross wires there may sit below it (the motor's disturbance d and the textbook's tap u do).

### 3.4 Columns

- **No Source is pinned to the first column.** Each sits one column before the block it feeds, so a disturbance stands just before the place it enters.
- **In ports go in the first column and Out ports in the last** (`layerConstraint FIRST`, `LAST`), in port order with 1 on top. This is the subsystem's interface, as Simulink's Auto Arrange puts it: "from left to right, starting with inputs and ending with outputs".
- **A tap** sits in the column after its signal.

### 3.5 Branches

A signal that feeds several inputs is one trunk with a dot at each branch point. The dots come from ELK's junction points, drawn r 3 in the wire's colour. Wire on wire was 0 px on every level, so different signals never share a segment.

### 3.6 Spacing: room to drop

56 px between columns. Measured: 120 of 120 wires have a straight horizontal stretch of at least 30 px to drop on; at 36 px it is 98 of 120. Blocks in a column are 28 px apart, wires 10 px apart, and wires keep 14 px from blocks.

### 3.7 Loose blocks and separate parts

- **A block with no wire at all** (just added with nothing selected, or a Source that cannot be inserted) is kept out of ELK and sits in a row under the diagram, in file order, 28 px apart, with its ports open.
- **Separate connected parts** are laid out by ELK one under the other, in the order of their first block in the file (ELK's default `separateConnectedComponents`).

### 3.8 The ELK options

```js
const LAYOUT = {
  'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
  'elk.spacing.nodeNode': '28', 'elk.layered.spacing.nodeNodeBetweenLayers': '56',
  'elk.spacing.edgeNode': '14', 'elk.spacing.edgeEdge': '10',
  'elk.layered.spacing.edgeNodeBetweenLayers': '14', 'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.considerModelOrder.crossingCounterNodeInfluence': '0.1',
  'elk.layered.thoroughness': '20',
  'elk.padding': '[top=20,left=20,bottom=20,right=20]',
};
// per block: 'elk.portConstraints': 'FIXED_POS'; In: 'elk.layered.layering.layerConstraint': 'FIRST'; Out: 'LAST'
// per port: 'elk.port.side': WEST | EAST | NORTH | SOUTH
// per main-line wire: 'elk.layered.priority.straightness': '10'
// randomSeed stays ELK's default (1): the same input always gives the same picture
```

These are not used:
- **Interactive strategies** (they reuse old coordinates, §6);
- **`feedbackEdges`** and model-order cycle breaking (our classification replaces them);
- **wrapping** (§7);
- **thoroughness 50**: 29 crossings instead of 31, at 2–3× the time on the larger levels.

### 3.9 What was measured for this plan, and how

The trial's two configurations differ from this plan. The trial measured all-left Sum ports and model-order cycle breaking; the interaction prototype used bands and Sum ports top and bottom but no metrics. So this plan's configuration was measured on the same 11 levels with the trial's metrics. The scripts are in `…/scratchpad/dlay/`:
- `final.mjs`: the classification and the ELK graph;
- `metrics2.mjs`: the trial's metrics, taught ports on any side;
- `sweep*.mjs`: the option sweeps;
- `pictures.mjs`: pictures, stability and room;
- `results-T20.json`: every number.

Cross-check: run through the same code, the trial's "ELK, return path mirrored" reproduced its 29 crossings and 188 bends exactly.

The results:
- **Totals**: 31 crossings, 0 wires through blocks, 0 px wire on wire, 0 wire ends off their port, 0 drawn the wrong way, 0 overlapping blocks, 159 bends.
- **Wires running right to left**: 30, none through a block, 98 bends in all (at most 8 on one wire, in the triple).
- **The main line**: 55 of 57 main-line wires have no bend.
- **Room to drop**: 120 of 120 wires.
- **Same picture**: two runs give identical coordinates, on every level and the textbook loop.

## 4. Editing when nothing is placed by hand

One gesture is one undo step. The layout runs after the edit is committed and never enters the history. Moving blocks by hand no longer exists, so `app.beginEdit()`/`endEdit()` around block dragging goes away.

| Action | Behaviour | Precedents |
|---|---|---|
| **Drop a block onto a wire** | Dragging from the library uses pointer events, so it works for touch and pen; HTML5 drag and drop does not work on touch. The wire under the pointer (within 8 px, 14 px for touch) is highlighted in the selected-wire style, and a hint names it ("Insert into C → P"). Hit testing uses the drawn polylines, not the DOM. On a shared trunk the hit is every connection through it, so the block goes before the branch; on a single branch it is that connection only. Alt while dragging means "don't insert"; Esc cancels. | Simulink (drop onto a line: both ports join); Node-RED (the wire dashes, the node is spliced); Blender (insert on link, Alt toggles); Dymola Smart Connect |
| **Which ports join** | The incoming signal goes to input 1 (for a Sum, its first `+` input). Output 1 takes over every target that was cut; targets keep their own signs. A Sum's other inputs stay open, read 0 and are named in the panel (the existing warning). A Controller (r, y) or Switch takes the wire on input 1; a block with two outputs (Cart–pole, Observer) continues on output 1. **A Sink or Out port dropped on a wire becomes a tap**: a branch that records the signal, or sends it up out of the subsystem. A Source, In port or Terminator cannot be inserted: it lands with the loose blocks, with a hint. A block dropped on a return-path wire is mirrored, by the rules of §3. | Simulink (a block with one input and one output joins both; a sink dropped on a line connects); Blender (first matching socket) |
| **Click a library item** | With a wire selected: inserted into it. With a block selected: inserted on its output 1's wire. With nothing selected: a loose block. This is the touch and keyboard path. | LabVIEW Quick Drop "insert on wire"; Blueprint Assist (Ctrl+Q); Enso |
| **Wire two ports** | Drag from an output to an input (as today), or from an input back to an output or onto a wire. Drag along any wire to an input: a branch of that signal (wires cannot be moved, so a drag on a wire is free to mean this). An input already wired is replaced, shown dashed while dragging. Nothing moves while the pointer is down; the layout runs on release. Keyboard and touch: the panel lists each input with "from…" (the signals at this level) and each output with "+ to…". | Simulink (Ctrl+drag a line to branch; drag an open input onto a line); Unreal (dragging off a pin offers only blocks that connect) |
| **Delete a block (Del)** | **Joins its neighbours when it sits on one wire**: one wired input, and all wired outputs on one output port. The source then feeds all the old targets; the toast says "joined r → Σ" with Undo. Otherwise the block and its wires go, and the inputs left open are named in the toast; deleting the Sum of a loop opens the loop. A Sink used by a view or a scope channel warns first and names who uses it (input 14; roadmap). **Shift+Del** deletes without joining. Interpretation: in a drawing that closes its gaps at once, the person could not see where to reconnect, and Del should undo a drop; most tools make joining the variant, not the default. | Node-RED (Ctrl-Delete keeps wires); Blueprint Assist (Shift+Del "delete and link"); LabVIEW (Remove and Rewire); Blender (Ctrl+X dissolve) |
| **Delete a wire** | Removes that connection; on a trunk, every connection through it. The input it fed becomes open. | Node-RED, Simulink |
| **Drag a block** | If it sits on one wire: dropped onto another wire, it moves there (joined where it was, inserted where it lands), for example a Saturation from before the plant to after it. Dragged up or down within its column, it swaps with its neighbour (as Alt+↑/↓). Anywhere else it snaps back. | Node-RED (detach and splice); Blueprint Assist (swap) |
| **Choose the order where the layout has a free choice** (which of two branches is on top) | Alt+↑ / Alt+↓, or dragging within the column, swaps the block with its neighbour in `blocks`: one undo step, saved in the file. Bands cannot be crossed (a tap cannot go below the line). Because order is a preference (§3.3), a swap that would add a crossing changes nothing. The page lays out the swapped order first; if the column's order did not change, it does not commit and says "kept: the other order crosses wires" (interpretation). | ELK model order (Domrös et al.: "a tie-breaker, a preference, or a strict constraint") |
| **Group into a subsystem** | Ctrl+G or Group, as today. Select by click, Shift-click, a marquee on the drawn picture, or Shift+arrows along the wires. In ports are numbered by the top-to-bottom order of their outside sources, Out ports by their targets, so the boundary does not cross itself. The subsystem takes the first selected block's place in `blocks`. No positions are computed for the inside any more. | Simulink; Xcos; Enso |
| **Ungroup (Ctrl+Shift+G)**, new | The inner blocks replace the subsystem at its place in `blocks`, In and Out ports dissolve into the wires they stood for. Easy now that no positions must be invented (it was on the roadmap). | Simulink |
| **Open a subsystem** | Double-click, Enter, or Open; the breadcrumb and Esc go back up. The level is laid out when it is first shown (§5.3). | Simulink, Ptolemy |
| **Keyboard** | → downstream (output 1's first target), ← upstream (input 1's source), ↑/↓ the neighbour in the column; Shift extends the selection. Enter: open a subsystem, rename a Source or Sink, or go to the Controller tab. Esc: deselect, then up a level. `/` or a typed letter: Quick insert (search the library; Enter inserts on the selected wire or after the selected block). Del / Shift+Del; Ctrl+G / Ctrl+Shift+G; Alt+↑/↓; Ctrl+Z / Ctrl+Y. | Simulink quick insert; LabVIEW Quick Drop; Blender Shift+A; Unreal Tab |

## 5. Feedback loops, branches and subsystems

### 5.1 Feedback

- **Feedback is found from the wires (§3.1)**, not from a stored flag, so a hand-written file, an agent's file and a library system all draw the same way. Sum signs never change by layout or by insertion.
- **Inserting on the return path** (a filter on the measurement) mirrors the new block with its neighbours.
- **Deleting a return-path block** joins the measurement back to the Sum.
- **Deleting the Sum** opens the loop, and the toast names the open input.
- **A loop made only of pass-through blocks** is still refused by `compileDiagram` with the names of its blocks; the drawing shows it as any other loop.

### 5.2 Branches

- One signal is one trunk with dots.
- Dropping on a trunk inserts before the branch point; dropping on one branch inserts on that branch only.
- Deleting a wire on a trunk removes every connection through it.
- A drag along any wire starts a branch.

### 5.3 Subsystems

- **Each level is laid out on its own** when it is first shown, and cached (§10.4). In ports are pinned to the first column, Out ports to the last, in port order. The subsystem block's size on its parent depends only on its port count, as today.
- **The picture inside is computed, so Ungroup is possible** (§4).
- **2D views are unaffected**: they bind to Source and Sink names, which do not change.
- **The Controller tab's small diagram is unaffected**: one fixed layout per controller type ([controller-proposal.md](controller-proposal.md)).
- **Vector wires** ([robot.md](robot.md) §2): a vector wire is one entry in the file and one edge for ELK, drawn as its double stroke. A wire label (robot.md's frames, "6 · joints") is handed to ELK as an edge label with its text size, so ELK leaves room for it (not measured; check when vector wires are built).

## 6. How much the drawing moves, and animation

**The drawing is a pure function of the level.** ELK's interactive strategies are not used, for three reasons:
- **The picture would depend on its history**, Undo would not return the same picture, and two people would see different drawings of one file.
- **The trial measured it**: steering ELK by the old positions cut the pairs of blocks that change order after an insert from 95 to 40–45, but raised the crossings from 19 to 82.
- **The research on preserving the mental map finds a small effect**: Purchase et al. 2006 found it helps some tasks; Archambault and Purchase 2011 and 2013 found little effect on error or time.

So layout quality comes first, and orientation comes from anchoring and animation.

**Measured for this plan:**
- **Dropping a block on a main-line wire**, at every one of the 57 main-line wires of the 11 levels:
  - the blocks upstream do not move (0 px across, at most 1 px up or down relative to the line) on 10 levels, and move at most 20 px in the triple;
  - the blocks downstream slide right by one column, 90–186 px.
- **The trial's own edit** (a block on the first forward wire, then removing the last Sink):
  - after the insert, 37 of 472 block pairs change their left/right or above/below order (plain ELK in the trial: 95; FlexGraph 65; dagre 163; MSAGL 171);
  - 56 of 106 blocks move more than 10 px, mostly the expected shift right;
  - removing the last Sink changes 16 of 377 pairs (plain ELK: 18).

**Anchoring.** After a layout, the view pans so the block acted on stays where it was on the screen: the dropped block, or the upstream block of a deletion.

**Animation:**
- Blocks glide to their new places in 200 ms, ease-out.
- Wires fade out and are drawn anew at the end.
- New blocks grow in place; deleted ones fade.
- Input during the animation is tested against the final geometry.
- With `prefers-reduced-motion` there is no animation.
- Undo animates back, which shows what changed.

Precedents: Blender's auto-offset is animated; Archambault et al. found animation more accurate than small multiples for "what was added".

## 7. The narrow window

- **Always left to right**, so a system has one picture on every device.
- **No ELK wrapping** (it breaks lines into rows and wrecks loops), and no top-to-bottom direction on phones (the picture would differ between devices).
- **Below 900 px**: the view fits the height at a zoom of at least 0.6; one finger pans sideways; the view follows the selection.
- **Subsystems keep each level small.** Wrapping (`elk.layered.wrapping`) stays available if testing on a phone shows panning is not enough.

## 8. What is stored in the project, and migration

**Positions are computable now, so none is stored.** The only layout input in the file is the order of `blocks` (it already exists): it breaks ties within a column (§3.3) and puts loose blocks in a row. Edits keep it meaningful:
- an inserted block goes into `blocks` right after its upstream block;
- a grouped subsystem takes its first block's place;
- a swap (Alt+↑/↓) swaps two entries.

**No position hint is kept.** Interpretation, for three reasons:
1. Steering by old positions measured worse (crossings 19 → 82, §6).
2. The picture must be the same on every machine and after Undo, and for agents who write files.
3. Stored coordinates would go stale with every edit elsewhere, and would invite hand edits that do nothing.

The view's pan and zoom per level stay in memory only, as today.

**Format** (`loop-tuner/2` stays; nothing is added):
- A diagram block is `id`, `type`, `params`, optional `name`; a subsystem carries its `diagram`.
- `x`, `y` and `flip` are no longer written. In older files they are accepted and ignored: `normalizeDiagram` stops copying them.
- The same holds for subsystems saved in `library` (My blocks).

**Migration:**
- **Saved projects** open and lay themselves out. The person's hand-made placements give way to the computed picture; the mirrored blocks come out the same (§3.1).
- **Library systems** (`src/core/plants.js`, `systems.js`): `x`, `y` and `flip` are deleted from every block, and a test keeps them out. The order of `blocks` is checked once by eye against the pictures, upstream first. Order matters only for ties, and the 11 levels above were measured in their present order.
- **Agents** (CLI, AGENTS.md) no longer invent coordinates. They list blocks upstream first and wire them.
- **Older pages** (an exported HTML from before) given a new file put every block at the origin, on top of each other. Accepted, since an exported page carries its own project. Said in [project-format.md](project-format.md) when this is built.
- **2D views** are bound to Source and Sink names, which are unchanged, so they are unaffected.

## 9. Vendoring

### 9.1 Files in the repository

| Path | What | Bytes | sha256 |
|---|---|---|---|
| `vendor/elkjs-0.12.0/elk-worker.min.js` | The layout engine, byte for byte from the npm tarball (`package/lib/elk-worker.min.js`) | 1 595 334 | `e4f5c51c6f2fd564bb64e52e81c4a85a316ef2f24f8b90e1db5eb886c765b030` |
| `vendor/elkjs-0.12.0/LICENSE.md` | The EPL-2.0 text, from the same tarball | 14 443 | `637e81f4a1b6b4079535c499fca05e238cf7605c1ff5b76d60d7da7ce96700c9` |
| `vendor/elkjs-0.12.0/README.md` | Ours (see below) | | |
| `vendor/manifest.json` | The pinned list, read by the build and by the tests | | |
| `vendor/package.json` | `{ "type": "commonjs" }` | | |

**The README says:**
- the origin: npm `elkjs` 0.12.0, published 2026-07-17, tarball sha256 `c1d7719723e020b10724e3ccbc935696a2884f1e78d361cdd03766309e8e8e2a`, npm integrity `sha512-YZcKynxVxYoKIOEpywEPwCFdg+BTbxQRNf3pbwdDCvc8O3kQD8bmIwSxKU1eOTVc4Xo+VG9Te+575mlfvOrhEQ==`;
- the licence: "EPL-2.0 OR GPL-3.0-or-later", used here under EPL-2.0;
- the source code: eclipse.dev/elk and the project's repository;
- that the file is unmodified, and how it is called (§2.4);
- how to update: replace both files, update the manifest's sizes and hashes, run `npm test`, and look at the pictures again.

**Left out on purpose:**
- the package's `package.json`, which carries an author's e-mail address;
- `elk.bundled.js` (the promise API, 1 609 707 B), which we do not call;
- the 4.8 MB unminified engine.

**Why `vendor/package.json`:** the repository is `"type": "module"`. Without that file, Node's `require()` of the engine loads it as an ES module, where its CommonJS branch never runs, and returns nothing: `Worker` is `undefined`, without an error. This was found while checking this plan. Node tests then load it with `createRequire(import.meta.url)('../vendor/elkjs-0.12.0/elk-worker.min.js').Worker`, with nothing to install.

**The manifest:**

```json
{ "elkjs": { "version": "0.12.0", "licence": "EPL-2.0", "source": "eclipse.dev/elk",
    "files": {
      "vendor/elkjs-0.12.0/elk-worker.min.js": { "bytes": 1595334, "sha256": "e4f5c51c6f2fd564bb64e52e81c4a85a316ef2f24f8b90e1db5eb886c765b030" },
      "vendor/elkjs-0.12.0/LICENSE.md": { "bytes": 14443, "sha256": "637e81f4a1b6b4079535c499fca05e238cf7605c1ff5b76d60d7da7ce96700c9" } },
    "allow": [] } }
```

### 9.2 How the build places it

**Placement:**
- `tools/build.mjs` reads the manifest, checks each file's sha256, and refuses to build on a mismatch.
- It appends the section **inside `lt-script`, at the end of the bundle, after `ui/app.js`**.
- It is not passed through the comment stripper.

**Why there:**
- The live worker (`ui/live.js`) is built from the bundle's text up to the first `\n// ---- ui/` marker, so the engine never enters it. In a worker the engine would set `self.onmessage` and take over the live worker, and the worker would carry 1.6 MB for nothing.
- Export HTML and Copy HTML (`ui/app.js`) rebuild the page from `lt-script`, so the engine travels with every exported page; a separate `<script>` element would be lost there.
- `__ltElk` is a function declaration in the bundle's outer function, so it is hoisted: `ui/plant.js` can call it although it comes later in the text.

**The section:**

```
// ---- vendor/elkjs-0.12.0 (third party)
/*! Eclipse Layout Kernel (elkjs 0.12.0). Copyright (c) Kiel University and others.
    Distributed under the Eclipse Public License 2.0 (SPDX: EPL-2.0 OR GPL-3.0-or-later).
    Its source code is available under that licence at eclipse.dev/elk. Unmodified; the licence follows. */
/*! vendor-begin vendor/elkjs-0.12.0/LICENSE.md
…the file, verbatim…
vendor-end vendor/elkjs-0.12.0/LICENSE.md */
function __ltElk() {
const module = { exports: {} }, exports = module.exports;
//! vendor-begin vendor/elkjs-0.12.0/elk-worker.min.js
…the file, verbatim…
//! vendor-end vendor/elkjs-0.12.0/elk-worker.min.js
return module.exports.Worker;
}
```

- **Section bodies.** A section's body is exactly the text between the newline that ends its begin line and the newline before its end line. The build writes begin line, newline, file, newline, end line, so the body equals the file whatever its last byte is.
- **The page finds the engine** as `typeof __ltElk === 'function' ? __ltElk : null`, the way `ui/live.js` finds `__HIL_FILES`. It calls it once, at the first layout. In the page the engine takes the CommonJS branch because of the wrapper's `module`; it never sees a worker context.
- **Insert by concatenation.** The engine contains `$'` five times. Inserted through `String.prototype.replace` with a string, it would be corrupted; the hash check in the test would catch it.
- **Escaping.** The engine and the licence contain no `</script`, `<script` or `<!--` (checked), so the build's `</script` escaping leaves them as they are; the licence contains no `*/`.
- **One global.** The engine sets one global of its own, `goog` (`$wnd.goog = $wnd.goog || {}`), in the page and in Node. Accepted and asserted as the only one.

### 9.3 The licence notice

EPL-2.0 §3.1 asks, when the program is distributed in any form other than source:
- for a statement that its source code is available under the EPL, and how to obtain it;
- that the program is under the EPL itself, or under a licence meeting §3.1(b).

EPL §3.3 forbids removing notices. Both are met by:
- the notice comment above, at the head of the vendored section in every built page;
- the full EPL text as a comment (14 KB; interpretation: the EPL asks only for the statement for compiled code, but carrying the text costs nothing and leaves no doubt);
- a line in Help, under a new heading **About**: "Diagram layout: Eclipse Layout Kernel (elkjs 0.12.0), Copyright (c) Kiel University and others, under the Eclipse Public License 2.0; its source code is available at eclipse.dev/elk";
- the engine file is unmodified, so every notice it contains stays.

Our own code stays MIT, as `package.json` says. The engine is a separate, unmodified module that our code only calls.

### 9.4 Third-party text and the provenance test

`test/provenance.test.mjs` keeps its `FORBIDDEN` list unchanged. It splits each built page (standalone, hosted, exported) at the vendor markers and checks:
1. Every `vendor-begin` has its `vendor-end`, names a file in the manifest, and appears exactly once in each page. Every manifest file appears.
2. **Each body hashes to the manifest's sha256.** None of our text can hide inside a vendored section; a changed library fails until the manifest is updated, in a reviewed diff.
3. **Our text is everything outside the bodies**, the markers, notice and wrapper included. It gets the full `FORBIDDEN` list, and the standalone page's `/claude/i`, unchanged.
4. **Each body gets the same list minus its entry's `allow` list** of exact strings, per library and version, removed from the body before the check. For elkjs the list is empty: the engine and the EPL text pass every pattern as they are (checked: no host names, e-mail addresses, paths, dates or conversation words).
5. The module markers' existing assertion stays.

`test/standalone.test.mjs` already scans the whole of `lt-script`, so the vendored section included. It passes: no `fetch(`, `import(`, `importScripts(`, XMLHttpRequest or sendBeacon. It gains three assertions:
- the vendored bodies contain no `new Worker`;
- the live worker's text (the bundle up to the first `// ---- ui/` marker) contains no vendor marker;
- our code never names `elk.bundled` or a worker URL for the engine.

## 10. Performance

### 10.1 Size

The page grows from 751 035 B to about 2.36 MB:
- the engine: +1 595 334 B;
- the licence: +14 443 B;
- the notice and wrapper: under 1 KB.

Gzipped, about +460 KiB. The budget is 20 MB (input 14).

### 10.2 Load

Measured in the trial, Chromium:

| | Parse | First layout | At page load |
|---|---|---|---|
| Engine run at load | | | 134 ms |
| Engine wrapped and started on the first layout | 104 ms | +67 ms to initialise | |
| First layout after load (the browser compiling) | | up to about 300 ms | |

The wrapper defers the cost. After the page's first frame, in idle time, the page lays out the current root level once as a warm-up, so the Plant tab opens at warm speed. A page that opens on the Plant tab pays the first layout at once.

### 10.3 Per layout

| Source | Machine | Result |
|---|---|---|
| The trial, ELK with the return path mirrored (the closest to this plan's settings) | Chromium | median over the levels 12 ms; per level 8–44 ms; plain ELK up to 91 ms (the msd) |
| The interaction prototype, by size | Chromium | 12 ms (2 blocks), 30 ms (10), 33 ms (20), 51 ms (40), 133 ms (80) |
| This plan's settings | Node 22, container load average 11–16 on 4 cores | medians 8 ms (tank) to 161 ms (triple), with msd 50, smc 58, cart–pole 61 |
| A Chromium check under that same load | Chromium | motor 68 ms, triple 441 ms |

The last two rows were taken while other work ran on the machine, so they are inflated. **Re-measure on an idle machine** as part of step 2 (§12), with `tools/layout-bench.mjs`. Budget: a median of 100 ms per level in Chromium, which the 200 ms glide hides. If a level exceeds it, move the layout into a Worker made from the page's own text (§13).

### 10.4 Cache

Layouts are kept in a map (the 64 most recent). The key is a canonical string of the level: block ids, types and sizes, port sides, wires, and the order of `blocks`.
- Undo and Redo hit the cache, as does going back to a level.
- A parameter edit that changes no size (a gain, a time constant) draws from the cache.
- An edit that changes a size lays out again: a Switch's input count, a Sum's signs, an External plant's ports, a Controller's inputs.

## 11. Tests

**Unit tests**, `test/layout.test.mjs` (Node; the engine loaded as in §9.1). The numbers are this plan's measurements and may only get better:
1. **Classification** on the 11 library levels:
   - the mirrored blocks are exactly Ke (both motors), c, k, torque ripple and torque noise;
   - the main lines are those of §3.1;
   - the textbook loop mirrors H and noise; the tap-free loop mirrors nothing.
2. **Drawing invariants** on every level:
   - no wire through a block, and no overlapping blocks;
   - every wire starts and ends on its port and leaves and enters in the port's direction;
   - every segment is horizontal or vertical;
   - 0 px of wire on wire between different signals;
   - every mirrored block lies below the main line;
   - In ports in the first column, Out ports in the last.
3. **Quality**:
   - crossings per level at most this plan's (total ≤ 31);
   - bends ≤ 159;
   - every wire has a straight horizontal stretch of at least 30 px;
   - at least 55 of the 57 main-line wires without a bend.
4. **Same picture**: identical coordinates from two runs, and after a JSON round trip of the project.
5. **Stability**: a block dropped on any main-line wire moves no upstream main-line block more than 1 px (20 px in the triple); pairs changing order after the trial's insert ≤ 37 of 472.
6. **The engine**:
   - answers synchronously;
   - `createElk` throws a clear error if it does not;
   - the file's sha256 matches the manifest;
   - after a layout the only new global is `goog`.
7. **A guard**: each level lays out in under 500 ms in Node. This catches a pathological setting; it is not a benchmark.

**Editing** in core, `test/diagram-edit.test.mjs`, pure functions on diagrams:
- insert on a wire: ports, signs kept, a Sink becomes a tap, a Source refused;
- delete with and without joining;
- move to another wire;
- swap within a column (and a swap the layout keeps refused);
- connect and branch;
- group and ungroup round trip: the diagram compiles to the same nodes;
- In and Out numbering.

**Format**:
- `normalizeDiagram` drops `x`, `y`, `flip`;
- no library system carries them;
- an old file with them loads and simulates exactly as before.

**Page**:
- provenance and standalone tests as in §9.4;
- `npm test` passes;
- the page builds.

**Playwright checks** (scripted, not part of `npm test`; Chromium via `/opt/node22/lib/node_modules/playwright`):
- every library system's Plant tab and every subsystem level draws with no console error, and the drawn blocks and wires equal the core's layout;
- in the DC motor, a Gain dragged onto controller → Motor is wired in and the simulation runs;
- Undo restores identical coordinates;
- Del joins;
- a drag along a wire branches;
- a narrow window (390 px) pans;
- `prefers-reduced-motion` does not animate;
- Export HTML contains the vendored section and its notice;
- the HIL system's live worker still starts;
- Help shows the About line.

## 12. Implementation steps

Each step ends with `npm test` passing and a commit.

1. **Vendor the engine.**
   - Add `vendor/elkjs-0.12.0/` (the engine, `LICENSE.md`, our `README.md`), `vendor/manifest.json` and `vendor/package.json`.
   - Test: hashes, sizes, a synchronous layout in Node.
2. **The layout in core**, `src/core/layout.js`:
   - block geometry (`size`, `geom`, moved from `ui/plant.js`), `classify(level)` (§3.1), `elkGraph(level)` (§3.2–3.8), `createElk(EngineWorker)` (§2.4);
   - `layoutLevel(level, elk)`, returning `{ blocks: { id: { x, y, w, h, mirrored, ins, outs } }, wires: [{ index, points, junctions }], width, height }`, and the cache;
   - `tools/layout-bench.mjs`, which prints medians per level in Node and, with `--browser`, in Chromium;
   - tests 1–7 of §11;
   - measure on an idle machine and record the numbers in this document.
3. **The build and the page's tests** (§9.2–9.4):
   - the vendored section;
   - Help › About;
   - the provenance split and the standalone assertions;
   - check the built size and that the live worker's text is unchanged.
4. **Edits in core**, `src/core/diagram-edit.js`: insert on a wire, delete with joining, move to a wire, swap, connect, branch, group, ungroup. Tests as in §11.
5. **Format and library**:
   - `normalizeDiagram` stops copying `x`, `y`, `flip`;
   - strip them from `plants.js` and the systems;
   - update [project-format.md](project-format.md), [plant-editor.md](plant-editor.md) (its Canvas table becomes §4 of this plan; Flip goes) and AGENTS.md.
6. **The Plant tab draws the layout** (`ui/plant.js`):
   - `route()` and block dragging go;
   - blocks at the layout's places, mirrored ones drawn as flipped ones are today;
   - wires as the layout's polylines with arrowheads and junction dots;
   - Sum signs at their ports;
   - loose blocks in their row; the warm-up; anchoring and the 200 ms glide.
7. **The gestures** (§4):
   - pointer-event dragging from the library;
   - wire hit testing and the insert hint;
   - click-to-insert; Del and Shift+Del; branch by dragging a wire; move and swap;
   - Ungroup; the keyboard and Quick insert; the panel's "from…" and "+ to…" lists.
8. **The narrow window** (§7), then the Playwright checks (§11), then the decision log and the README's status.

**Coordination with the branches that touch `src/ui/plant.js`:**
- **feat/design-system** restyles 60 lines of it.
- **feat/designs** changes 12 lines.
- Start from main after whichever of them has merged. Keep their class names.
- `design/output/design-system.md` was not on main when this plan was written, so the new UI uses the existing classes and adds no colour literals:
  - the drop highlight is the selected-wire style;
  - junction dots take the wire's colour (`currentColor`);
  - hints use the existing toast and help text.
- If the design system has landed by then, build from its tokens and components instead.

## 13. Not built

- **Dragging a wire or its bends; placing or pinning a block by hand.** The page owns the drawing (the person: "if you can find an auto router, I would be fine with that").
- **Vector wires** for the triple pendulum's 8 state wires. Planned with [robot.md](robot.md) §2; until then the triple keeps 26 crossings.
- **Best of several seeds** (the triple 26 → 15, the cart–pole 3 → 2, at 8× the time). A pure function still, but slower. Not run in idle time either, since the picture must not change by itself.
- **Thoroughness 50** (31 → 29 crossings, 2–3× the time on the larger levels). Revisit once step 2 measures on an idle machine.
- **Layout in a Worker** (a Blob from the page's own text, as Live does). Only if a level exceeds the budget.
- **Interactive (history-dependent) layout**, ELK wrapping, and a top-to-bottom direction.
- **Signal names on wires** (except robot.md's frame labels), comments on the canvas, copy and paste (roadmap).
- **A CLI command that draws a diagram** for agents (`./runme.sh cli layout --svg`); easy once `layoutLevel` exists.

## 14. Files (session scratch, may be gone)

- **This plan's measurement**, `/tmp/claude-0/-home-user-ctrl/281fed85-1c0b-52ae-b29a-1fd26dd76401/scratchpad/dlay/`:
  - `final.mjs` (classification, ELK graph, synchronous call);
  - `metrics2.mjs`;
  - `sweep.mjs`, `sweep2.mjs`, `sweep3.mjs` (options, bands, influence);
  - `pictures.mjs` (pictures, stability, room);
  - `textbook.mjs` (the textbook loop, determinism);
  - `timing.mjs`, `timing2.mjs`;
  - `wrapcheck.cjs` (the wrapped engine in Chromium: synchronous, one global);
  - `rules.mjs`, `rules2.mjs` (the return-path rules compared);
  - `esmcheck/` (the CommonJS finding);
  - `out/` (pictures, `results-T20.json`).
- **The library trial**, `…/scratchpad/work/`:
  - `model.mjs` (our diagrams as graphs), `semantics.mjs`, `ad/elk.mjs` and the other adapters, `metrics.mjs`, `harness.mjs` (Chromium);
  - `sizes.json`;
  - `out/final/` (every picture, `results.json`).
- **The interaction prototype**, `…/scratchpad/proto/`: `layout.mjs` and `v5-*.png` (the textbook loop, the msd and the oven with bands and Sum ports top and bottom).
- **The npm tarball**: `…/scratchpad/dl-elk/elkjs-0.12.0.tgz`, unpacked in `…/scratchpad/dl-elk/x/package/`.
