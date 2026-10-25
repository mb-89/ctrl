#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["websockets>=13"]
# ///
"""Loop Tuner external plant: a simulated plant that runs in real time on your
computer and stands in for real hardware in Loop Tuner's Live (HIL) mode.

    uv run hil_plant.py                     a DC motor swinging an arm, 100 Hz
    uv run hil_plant.py --mode reference    the same, with its own controller
    uv run hil_plant.py --plant heater      a heater and a temperature
    python3 hil_plant.py --check            the physics for 3 s, no server
    python3 hil_plant.py --describe         what it tells the page about itself
    python3 hil_plant.py --help             every option

A window opens with a big red STOP (an emergency stop, latched until Reset),
Run/Stop and the state of the link; without a display (or with --no-gui) the
console takes the same commands: s stop, r run, e (or Enter) E-stop, x reset.

Then, in Loop Tuner: System library > a "HIL: ..." system > Load; Plant tab >
Connect; Run. The page's Run and Stop start and stop this plant, and so do
the keys here; the page follows.

Two modes. Control (the default): the page is the controller and sends the
control effort every cycle (plus its reference r and error e, which this
script only logs). Reference (--mode reference): this script runs its own
controller, with its limits and its monitoring, and the page sends the
reference. Log (--mode log): no inputs at all; the plant holds its own
setpoint and the page only records.

The plant the page does not know: each physical parameter differs from
nominal by a random factor within +-15 % (--vary), a new plant each start
unless --seed is given; --show-params prints the true values. The page is
told the ports, their units and full scales, never the physics: it has to
identify the plant, as it would a real one.

The protocol (JSON-RPC 2.0, one message per WebSocket text frame, at
ws://127.0.0.1:8765; the README has it in a paragraph):

  page -> plant  {"jsonrpc": "2.0", "id": 1, "method": "describe"}
                 requests "start" (params {"log": [{"name", "unit"}]}),
                 "stop", "reset", "estop", each answered
                 {"jsonrpc": "2.0", "method": "u", "params": {"seq": 42, "u": [3.1, 0], "log": [1.5, 0.2]}}
  plant -> page  {"jsonrpc": "2.0", "method": "y", "params": {"seq": 42, "t": 0.42, "y": [1.2, 0.3, 0.8]}}
                 {"jsonrpc": "2.0", "method": "estop", "params": {"reason": "...", "t": 1.23}}
                 {"jsonrpc": "2.0", "method": "running", "params": {"running": false, "by": "plant", "reason": "..."}}
                 {"jsonrpc": "2.0", "method": "status", "params": {...}}  once a second

This script owns the clock: every cycle it integrates the physics, sends the
outputs y and applies each input u from the moment it arrives. It is also the
safety authority: it clamps every input to its limits, and if no u comes for
10 cycles, the page goes away while running, an output leaves its safe range,
or STOP is pressed (here or on the page), it applies the safe inputs, stops
the run and latches an emergency stop (E-stop) until Reset.

To put real hardware behind Loop Tuner, keep the server, the cycle, the
watchdog and the window, and replace a plant class (Motor, Heater) with your
device's I/O: PORTS describe it, advance() applies the inputs for a span of
time, outputs() reads the measurements.
"""

import argparse
import asyncio
import csv
import json
import math
import os
import random
import re
import sys
import threading
import time

PROTOCOL = "loop-tuner-hil/1"


def port(name, unit, lo, hi, **extra):
    return {"name": name, "unit": unit, "min": lo, "max": hi, **extra}


class Motor:
    """A DC motor (armature resistance R, inductance L, torque and back-EMF
    constant k) turning an arm with an unbalanced mass: gravity pulls with
    m g l sin(angle), angle 0 hanging down, positive counter-clockwise. Viscous
    friction b and Coulomb friction Tc (smoothed around standstill) brake it;
    `load` is an extra torque on the shaft, from a test rig, positive along
    +angle. A controller has to beat gravity (it needs integral action to hold
    the arm up) and friction, with the motor's 12 V."""

    NAME = "DC motor with an unbalanced arm (simulated)"
    R, L, k = 2.0, 4e-3, 0.1        # ohm, H, N·m/A (= V·s/rad)
    J, b = 2.5e-3, 2e-3             # kg·m², N·m·s/rad
    Tc, w_eps = 0.01, 0.01          # N·m, rad/s
    mgl = 0.1                       # N·m: the arm's unbalance
    H = 5e-4                        # s: integration substep (the electrical time constant is 2 ms)
    # The physical parameters, which the page is not told (see plant_params).
    PHYSICS = {"R": "ohm", "L": "H", "k": "N·m/A", "J": "kg·m²", "b": "N·m·s/rad", "Tc": "N·m", "mgl": "N·m"}

    # The ports: what drives it (the effort, then test inputs), what it
    # measures, each with its full scale (min ... max).
    EFFORT = port("V", "V", -12.0, 12.0, safe=0.0)
    TESTS = [port("load", "N·m", -0.2, 0.2, safe=0.0, kind="disturbance")]
    OUTPUTS = [port("angle", "rad", -math.pi, math.pi), port("speed", "rad/s", -120.0, 120.0), port("current", "A", -12.0, 12.0)]
    # Its own controller (reference and log modes): a PID on the angle.
    REFERENCE = port("r", "rad", -3.0, 3.0, safe=0.0, measures="angle")
    OWN = {"Kp": 10.0, "Ki": 20.0, "Kd": 0.6, "Tf": 0.01}
    SETPOINT = 1.0                   # rad: what it holds in log mode
    # Monitoring: outside these the plant stops itself (E-stop).
    TRIPS = {"angle": (-2 * math.pi, 2 * math.pi, "the arm turned more than a full turn")}

    def __init__(self, params=None):
        for name, value in (params or {}).items():
            setattr(self, name, value)
        self.i = self.w = self.angle = 0.0

    def rates(self, i, w, angle, V, load):
        di = (V - self.R * i - self.k * w) / self.L
        friction = self.b * w + self.Tc * math.tanh(w / self.w_eps)
        dw = (self.k * i - friction - self.mgl * math.sin(angle) + load) / self.J
        return di, dw, w

    def advance(self, span, u):
        """Integrates `span` seconds with the inputs u = [V, load] held (fixed-step RK4)."""
        if span <= 0:
            return
        n = max(1, math.ceil(span / self.H - 1e-9))
        h = span / n
        V, load = u
        s = (self.i, self.w, self.angle)
        for _ in range(n):
            k1 = self.rates(*s, V, load)
            k2 = self.rates(*(x + 0.5 * h * d for x, d in zip(s, k1)), V, load)
            k3 = self.rates(*(x + 0.5 * h * d for x, d in zip(s, k2)), V, load)
            k4 = self.rates(*(x + h * d for x, d in zip(s, k3)), V, load)
            s = tuple(x + h / 6 * (a + 2 * b + 2 * c + d) for x, a, b, c, d in zip(s, k1, k2, k3, k4))
        self.i, self.w, self.angle = s

    def outputs(self):
        return [self.angle, self.w, self.i]


class Heater:
    """A heater warming a thermal mass C that loses heat to the room (at Ta)
    through a conductance G; the heater gives up to Pmax at 100 %, and the
    thermometer lags by tau. Exact for a lumped body."""

    NAME = "Heater and thermal mass (simulated)"
    C, G, Pmax, tau, Ta = 10.0, 2.0, 160.0, 1.0, 20.0   # J/K, W/K, W, s, °C
    PHYSICS = {"C": "J/K", "G": "W/K", "Pmax": "W", "tau": "s", "Ta": "°C"}
    EFFORT = port("P", "%", 0.0, 100.0, safe=0.0)
    TESTS = []
    OUTPUTS = [port("T", "°C", 0.0, 120.0)]
    REFERENCE = port("r", "°C", 20.0, 100.0, safe=20.0, measures="T")
    OWN = {"Kp": 6.0, "Ki": 1.5, "Kd": 0.0, "Tf": 0.1}
    SETPOINT = 50.0
    TRIPS = {"T": (-50.0, 110.0, "over-temperature")}

    def __init__(self, params=None):
        for name, value in (params or {}).items():
            setattr(self, name, value)
        self.T = self.Ts = self.Ta

    def advance(self, span, u):
        if span <= 0:
            return
        n = max(1, math.ceil(span / 0.01 - 1e-9))
        h = span / n
        P = u[0]
        for _ in range(n):
            dT = (self.Pmax * P / 100.0 - self.G * (self.T - self.Ta)) / self.C
            dTs = (self.T - self.Ts) / self.tau
            self.T += h * dT
            self.Ts += h * dTs

    def outputs(self):
        return [self.Ts]


PLANTS = {"motor": Motor, "heater": Heater}


class Stats:
    """Mean and maximum of what happened in the last second."""

    def __init__(self):
        self.values = []

    def add(self, v):
        self.values.append(v)

    def take(self):
        v, self.values = self.values, []
        return {"mean": round(sum(v) / len(v), 3) if v else None, "max": round(max(v), 3) if v else None}


class OwnController:
    """The plant's own controller (reference and log modes): a PID on the
    measured output, derivative on the measurement, filtered by Tf; its
    output clamped to the effort's limits, the integral held at a limit."""

    def __init__(self, gains, effort, dt):
        self.g, self.lo, self.hi, self.dt = gains, effort["min"], effort["max"], dt
        self.reset()

    def reset(self):
        self.i = 0.0
        self.y_prev = None
        self.d = 0.0

    def step(self, r, y):
        g, dt = self.g, self.dt
        e = r - y
        if self.y_prev is not None and g["Kd"]:
            a = dt / (g["Tf"] + dt)
            self.d += a * ((y - self.y_prev) / dt - self.d)
        self.y_prev = y
        u = g["Kp"] * e + self.i - g["Kd"] * self.d
        ui = self.i + g["Ki"] * e * dt
        if self.lo < g["Kp"] * e + ui - g["Kd"] * self.d < self.hi:
            self.i = ui
        return min(self.hi, max(self.lo, u))


class Plant:
    def __init__(self, args):
        self.args = args
        self.rate = args.rate
        self.dt = 1.0 / args.rate
        self.Model = PLANTS[args.plant]
        self.model = self.Model(plant_params(args))
        self.mode = args.mode
        M = self.Model
        if self.mode == "control":
            self.inputs = [dict(M.EFFORT, kind="effort")] + M.TESTS
            self.outputs = list(M.OUTPUTS)
        elif self.mode == "reference":
            self.inputs = [dict(M.REFERENCE, kind="reference")] + M.TESTS
            self.outputs = list(M.OUTPUTS) + [dict(M.EFFORT, kind="effort")]
        else:  # log: no inputs; it holds its own setpoint and reports it
            self.inputs = []
            self.outputs = list(M.OUTPUTS) + [dict(M.EFFORT, kind="effort"), dict(M.REFERENCE, name="setpoint")]
        for o in self.outputs:
            o.pop("safe", None)
            o.pop("measures", None)
        self.own = OwnController(M.OWN, M.EFFORT, self.dt) if self.mode != "control" else None
        self.measured = [o["name"] for o in M.OUTPUTS].index(M.REFERENCE["measures"])
        self.setpoint = args.setpoint if args.setpoint is not None else M.SETPOINT
        self.safe = [p["safe"] for p in self.inputs]
        self.u = list(self.safe)          # the inputs applied now
        self.effort = M.EFFORT["safe"]    # the effort the own controller applies
        self.pending = []                 # (arrival time, u) received since the last cycle
        self.client = None                # the one connected page
        self.origin = None
        self.running = False              # sending y and taking u
        self.estop_reason = None          # latched E-stop, until "reset"
        self.k = 0                        # cycle counter since this script started
        self.k_start = 0                  # cycle of the last "start": seq = k - k_start
        self.since_u = 0                  # cycles without a new u (the watchdog)
        self.sent = {}                    # seq -> when its y was sent, for the round trip
        self.late = 0                     # cycles that began without a new u
        self.overruns = 0                 # cycles skipped because the computer stalled
        self.dropped = 0                  # y not sent because the page did not read them
        self.jitter, self.rtt = Stats(), Stats()
        self.last_rate, self.last_jitter, self.last_rtt = 0.0, {"mean": None, "max": None}, {"mean": None, "max": None}
        self.log_names, self.log_values = [], []
        self.last_take = None
        self.writer = Log(args.log, self) if args.log else None
        self.bench = Bench(args.bench) if args.bench else None
        self.loop = None
        self.done = None                  # set to end the script (bench, window closed)

    # ---- the page

    def origin_ok(self, origin):
        """A browser says which page opened the connection. Allowed: no Origin
        (scripts), localhost, every --allow-origin, and "null", which a page
        opened from a file sends (Loop Tuner's usual case). Other web sites are
        refused, since WebSockets have no CORS. But a sandboxed frame on any
        web site also sends "null": with --strict-origin it is refused too
        (then serve the page from localhost). For real hardware, use that."""
        allowed = self.args.allow_origin
        if origin is None or "*" in allowed or origin in allowed or (origin == "null" and not self.args.strict_origin):
            return True
        return re.fullmatch(r"https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?", origin) is not None

    async def handler(self, ws):
        origin = ws.request.headers.get("Origin")
        if not self.origin_ok(origin):
            say(f"refused a page from {origin}: start with --allow-origin {origin} to allow it")
            await ws.close(1008, "origin not allowed; see the plant's console")
            return
        if self.client is not None:
            await ws.close(1013, "busy: another page is connected")
            return
        self.client, self.origin = ws, origin or "no origin"
        say(f"page connected ({self.origin})")
        self.event("page connected")
        try:
            async for text in ws:
                await self.on_message(ws, text)
        except Exception as err:  # a broken connection ends like a closed one
            say(f"connection error: {err}")
        finally:
            if self.client is ws:
                self.client, self.origin = None, None
                if self.running:
                    self.trip("connection lost")
                self.set_running(False, "page", "the page went away")
                say("page disconnected")
                self.event("page disconnected")

    async def on_message(self, ws, text):
        try:
            msg = json.loads(text)
        except ValueError:
            await self.reply(ws, None, error=(-32700, "parse error: not JSON"))
            return
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
            await self.reply(ws, msg.get("id") if isinstance(msg, dict) else None, error=(-32600, "invalid request"))
            return
        method, params, rid = msg["method"], msg.get("params") or {}, msg.get("id")
        if method == "u":
            self.take_u(params)
            return
        handlers = {"describe": self.describe, "start": self.start, "stop": self.stop, "reset": self.reset, "estop": self.manual_estop}
        if method not in handlers:
            if rid is not None:
                await self.reply(ws, rid, error=(-32601, f"no method {method}; methods: {', '.join(handlers)}, u"))
            return
        try:
            result = handlers[method](params)
        except RuntimeError as err:
            await self.reply(ws, rid, error=(-32000, str(err)))
            return
        if rid is not None:
            await self.reply(ws, rid, result=result)

    async def reply(self, ws, rid, result=None, error=None):
        msg = {"jsonrpc": "2.0", "id": rid}
        if error:
            msg["error"] = {"code": error[0], "message": error[1]}
        else:
            msg["result"] = result
        await ws.send(json.dumps(msg))

    def describe(self, _params=None):
        d = {
            "protocol": PROTOCOL,
            "name": self.Model.NAME + ("" if self.mode == "control" else f", {self.mode} mode"),
            "mode": self.mode,
            "rate_hz": self.rate,
            "watchdog_cycles": self.args.watchdog,
            "inputs": self.inputs,
            "outputs": self.outputs,
            "running": self.running,
            "estop": self.estop_reason,
        }
        if self.args.slew:
            d["slew"] = self.args.slew / 100
        return d

    def start(self, params=None, by="page"):
        if self.estop_reason:
            raise RuntimeError(f"E-stop latched ({self.estop_reason}); send reset first")
        log = (params or {}).get("log")
        if isinstance(log, list) and all(isinstance(x, dict) and isinstance(x.get("name"), str) for x in log):
            self.log_names = [(x["name"], str(x.get("unit", ""))) for x in log[:16]]
        elif by == "page":
            self.log_names = []
        self.log_values = [None] * len(self.log_names)
        if not self.running:
            self.k_start = self.k              # the next cycle is seq 0, t 0
            self.since_u = 0
            self.sent.clear()
            self.u = list(self.safe)
            self.last_take = None
            if self.own:
                self.own.reset()
            self.set_running(True, by, "")
            if self.bench:
                self.bench.begin()
        return {"rate_hz": self.rate}

    def stop(self, _params=None, by="page", reason="stopped by the page"):
        self.u = list(self.safe)
        self.effort = self.Model.EFFORT["safe"]
        self.pending.clear()
        self.set_running(False, by, reason)
        return {}

    def reset(self, _params=None, by="page"):
        was = self.estop_reason
        self.estop_reason = None
        self.since_u = 0
        if was:
            say(f"E-stop reset by the {by} (was: {was})")
            self.event(f"reset by the {by}")
            # The page hears at once (its E-stop from the plant clears too).
            self.notify("status", self.status_params())
        return {}

    def manual_estop(self, params):
        self.trip(str(params.get("reason") or "pressed on the page"))
        return {}

    def set_running(self, on, by, reason):
        """Every change of running is told to the page, so its Run/Stop key
        follows the plant's (and the window's)."""
        if self.running == on:
            return
        self.running = on
        say(("started" if on else "stopped") + f" by the {by}" + (f": {reason}" if reason else ""))
        self.event(("start" if on else "stop") + f" by the {by}" + (f" ({reason})" if reason else ""))
        self.notify("running", {"running": on, "by": by, "reason": reason, "t": self.t()})

    # ---- the keys at the plant (the window or the console)

    def plant_run(self):
        if self.estop_reason:
            say(f"E-stop latched ({self.estop_reason}): Reset first")
        elif self.client is None and self.mode != "log":
            say("no page connected: connect Loop Tuner first, or use --mode log")
        else:
            self.start({}, by="plant")

    def plant_stop(self):
        self.stop(by="plant", reason="stop pressed at the plant")

    def plant_reset(self):
        self.reset(by="plant")

    def take_u(self, params):
        """A new input, from the moment it arrives. Ignored while stopped or
        E-stopped; clamped to each input's limits (and to --slew); a bad value
        is the safe one. The log values that come with it are only written to
        the log file."""
        if not self.running or self.estop_reason:
            return
        u = params.get("u")
        if not isinstance(u, list) or len(u) != len(self.inputs):
            return
        now = time.perf_counter()
        clean = []
        for i, (v, spec) in enumerate(zip(u, self.inputs)):
            ok = isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
            x = min(spec["max"], max(spec["min"], v)) if ok else spec["safe"]
            if self.args.slew and self.last_take is not None:
                most = self.args.slew / 100 * (spec["max"] - spec["min"]) * (now - self.last_take)
                prev = self.pending[-1][1][i] if self.pending else self.u[i]
                x = min(prev + most, max(prev - most, x))
            clean.append(x)
        log = params.get("log")
        if isinstance(log, list) and len(log) == len(self.log_names):
            self.log_values = [v if isinstance(v, (int, float)) and not isinstance(v, bool) else None for v in log]
        sent = self.sent.pop(params.get("seq"), None)
        if sent is not None:
            self.rtt.add(1000 * (now - sent))
            if self.bench:
                self.bench.rtt.append(1000 * (now - sent))
        self.pending.append((now, clean))
        self.last_take = now
        self.since_u = 0

    # ---- safety

    def t(self):
        return round((self.k - self.k_start) * self.dt, 6) if self.running else None

    def trip(self, reason):
        """Emergency stop: safe inputs now, the run stops, latched until Reset."""
        if self.estop_reason:
            return
        self.estop_reason = reason
        say(f"E-STOP: {reason}; safe inputs applied, latched until Reset")
        self.event(f"E-STOP: {reason}")
        self.notify("estop", {"reason": reason, "t": self.t()})
        self.stop(by="plant", reason=f"E-STOP: {reason}")

    def monitor(self, y):
        for j, o in enumerate(self.Model.OUTPUTS):
            lo, hi, why = self.Model.TRIPS.get(o["name"], (None, None, None))
            if lo is not None and not lo <= y[j] <= hi:
                self.trip(f"{why} ({o['name']} {y[j]:.3g} {o['unit']})")
                return

    async def shutdown(self, reason):
        """Ctrl+C or the window closed: safe inputs, and the page hears why
        before the connection closes (an E-stop if it was running), not just a
        lost connection."""
        self.u = list(self.safe)
        if self.writer:
            self.event("shut down")
            self.writer.close()
        ws, self.client = self.client, None
        if ws is None:
            return
        try:
            if self.running:
                self.estop_reason = reason
                msg = {"jsonrpc": "2.0", "method": "estop", "params": {"reason": reason, "t": self.t()}}
                await asyncio.wait_for(ws.send(json.dumps(msg)), 0.5)
            await asyncio.wait_for(ws.close(1001, reason), 0.5)
        except Exception:  # the page may be gone already
            pass

    def notify(self, method, params):
        """Sends a notification without ever blocking the cycle: if the page is
        not reading (its buffer is full), the message is dropped and counted."""
        ws = self.client
        if ws is None:
            return
        if ws.transport is not None and ws.transport.get_write_buffer_size() > 65536:
            self.dropped += 1
            return
        task = asyncio.ensure_future(ws.send(json.dumps({"jsonrpc": "2.0", "method": method, "params": params})))
        task.add_done_callback(lambda f: f.cancelled() or f.exception())  # a closed page is handled by handler()

    def event(self, text):
        if self.writer:
            self.writer.row(text)

    # ---- the cycle

    def applied(self):
        """The plant's inputs in its model's order: [effort, tests...]."""
        if self.mode == "control":
            return self.u
        return [self.effort] + list(self.u[1:]) if self.inputs else [self.effort] + [p["safe"] for p in self.Model.TESTS]

    def cycle(self, now, last, span):
        """One cycle: the physics over the last `span` seconds, each u applied
        from the moment it arrived; the plant's own controller; the watchdog
        and the monitoring; then y."""
        at = 0.0
        for arrived, u in self.pending:
            off = min(max(arrived - last, 0.0), span)
            self.model.advance(off - at, self.applied())
            self.u, at = u, off
        self.model.advance(span - at, self.applied())
        had_u = bool(self.pending)
        self.pending.clear()
        y = self.model.outputs()
        if self.own:
            r = self.setpoint if self.mode == "log" else self.u[0]
            self.effort = self.own.step(r, y[self.measured]) if self.running and not self.estop_reason else self.Model.EFFORT["safe"]
            y = y + [self.effort] + ([self.setpoint] if self.mode == "log" else [])
        self.last_y = y
        if self.running:
            self.monitor(y)
        if not self.running:
            return
        seq = self.k - self.k_start
        # The watchdog counts y the page left unanswered: cycles this script
        # skipped itself (a stalled computer) sent no y, so they do not count.
        if seq > 0 and not had_u and self.client is not None:
            self.since_u += 1
            if not self.estop_reason:
                self.late += 1
        if self.client is not None and self.since_u >= self.args.watchdog and not self.estop_reason:
            self.trip(f"no u for {self.since_u} cycles")
            return
        self.sent[seq] = time.perf_counter()
        self.sent.pop(seq - 50, None)
        if self.writer:
            self.writer.row("", seq * self.dt, y)
        self.notify("y", {"seq": seq, "t": round(seq * self.dt, 6), "y": [round(v, 6) for v in y]})

    async def run(self):
        """The real-time loop: deadlines are absolute (start + k·dt), so sleep
        errors never add up; a stall longer than 5 cycles is skipped over in
        one physics step, and the skipped cycles show as a gap in seq. With
        --spin, the last milliseconds before a deadline are waited out by
        yielding to the event loop, for operating systems with coarse timers."""
        t0 = time.perf_counter()
        last = t0
        next_status = t0 + 1.0
        cycles = 0
        spin = self.args.spin / 1000
        while not self.done.is_set():
            deadline = t0 + self.k * self.dt
            wait = deadline - time.perf_counter() - spin
            if wait > 0:
                await asyncio.sleep(wait)
            while spin and time.perf_counter() < deadline:
                await asyncio.sleep(0)
            now = time.perf_counter()
            skip = int((now - deadline) / self.dt) if now - deadline > 5 * self.dt else 0
            if skip:
                self.overruns += skip
                self.k += skip
                deadline = t0 + self.k * self.dt
            late_ms = 1000 * (now - deadline)
            self.jitter.add(late_ms)
            if self.bench and self.running:
                self.bench.cycle(now, late_ms, skip)
            self.cycle(now, last, (skip + 1) * self.dt)
            last = now
            cycles += 1
            self.k += 1
            if now >= next_status:
                self.status(cycles / (now - next_status + 1.0))
                cycles = 0
                next_status = now + 1.0
            if self.bench and self.bench.over(now):
                self.bench.report(self)
                self.stop(by="plant", reason="the bench run is over")
                self.done.set()

    def status_params(self):
        return {"t": self.t(), "rate_hz": round(self.last_rate, 2), "jitter_ms": self.last_jitter, "rtt_ms": self.last_rtt, "mode": self.mode,
                "late": self.late, "overruns": self.overruns, "dropped": self.dropped, "running": self.running, "estop": self.estop_reason}

    def status(self, rate):
        jitter, rtt = self.jitter.take(), self.rtt.take()
        self.last_rate, self.last_jitter, self.last_rtt = rate, jitter, rtt
        self.notify("status", self.status_params())
        if self.writer:
            self.writer.flush()
        if CONSOLE["quiet"]:
            return
        # The console: one line rewritten every second in a terminal, a new line every 5 s otherwise.
        tty = sys.stdout.isatty()
        if tty or self.k % round(5 * self.rate) < self.rate:
            print(f"\r{self.state_text():<34.34} {rate:7.1f} Hz  jitter {fmt_ms(jitter)}  round trip {fmt_ms(rtt)}  late {self.late}  "
                  f"{self.reading()}   ", end="" if tty else "\n", flush=True)

    def state_text(self):
        if self.estop_reason:
            return f"E-STOP ({self.estop_reason})"
        return "running" if self.running else "stopped, page connected" if self.client else "no page"

    def reading(self):
        y = getattr(self, "last_y", None) or self.model.outputs()
        return "  ".join(f"{o['name']} {v:+.3g} {o['unit']}" for o, v in zip(self.outputs, y))


def fmt_ms(st):
    return f"{st['mean']:.2f}/{st['max']:.2f} ms" if st and st["mean"] is not None else "-"


CONSOLE = {"quiet": False}


def say(text):
    print(("\n" if sys.stdout.isatty() and not CONSOLE["quiet"] else "") + text, flush=True)


class Log:
    """--log FILE: a CSV with a row per cycle while running (t, every output,
    every input applied, what the page sent for the log, such as r and e) and
    a row for each event (start, stop, E-stop, reset, page connected)."""

    def __init__(self, path, plant):
        self.plant = plant
        self.file = open(path, "w", newline="", encoding="utf-8")
        self.csv = csv.writer(self.file)
        self.header = None
        self.t = 0.0

    def columns(self):
        p = self.plant
        unit = lambda x: f"{x['name']} [{x['unit']}]"
        return (["t [s]"] + [unit(o) for o in p.outputs] + [unit(i) for i in p.inputs]
                + [f"{n} [{u}]" for n, u in p.log_names] + ["event"])

    def row(self, event, t=None, y=None):
        p = self.plant
        cols = self.columns()
        if cols != self.header:
            if self.header is not None:
                self.file.write("# columns changed (a new run declared other log values)\n")
            self.csv.writerow(cols)
            self.header = cols
        if t is not None:
            self.t = t
        fmt = lambda v: "" if v is None else f"{v:.6g}"
        y = y if y is not None else ([None] * len(p.outputs))
        u = p.u if p.inputs else []
        self.csv.writerow([f"{self.t:.6f}"] + [fmt(v) for v in y] + [fmt(v) for v in u] + [fmt(v) for v in p.log_values] + [event])

    def flush(self):
        self.file.flush()

    def close(self):
        self.file.close()


class Bench:
    """--bench SECONDS: measures the next run for that long, prints the
    figures and ends the script."""

    def __init__(self, seconds):
        self.seconds = seconds
        self.t0 = None

    def begin(self):
        self.t0 = time.perf_counter()
        self.late_ms, self.rtt, self.cycles, self.skipped = [], [], 0, 0

    def cycle(self, now, late_ms, skip):
        if self.t0 is None:
            return
        self.late_ms.append(late_ms)
        self.cycles += 1
        self.skipped += skip

    def over(self, now):
        return self.t0 is not None and now - self.t0 >= self.seconds

    def report(self, plant):
        q = lambda v, p: sorted(v)[min(len(v) - 1, int(p * len(v)))] if v else None
        mean = lambda v: sum(v) / len(v) if v else None
        rnd = lambda x: None if x is None else round(x, 3)
        span = time.perf_counter() - self.t0
        res = {
            "rate_set_hz": plant.rate, "rate_hz": round(self.cycles / span, 2), "seconds": round(span, 2),
            "jitter_ms": {"mean": rnd(mean(self.late_ms)), "p99": rnd(q(self.late_ms, 0.99)), "max": rnd(max(self.late_ms, default=None))},
            "rtt_ms": {"mean": rnd(mean(self.rtt)), "p99": rnd(q(self.rtt, 0.99)), "max": rnd(max(self.rtt, default=None))},
            "answered": len(self.rtt), "cycles": self.cycles, "late": plant.late, "dropped": plant.dropped, "skipped": self.skipped,
            "estop": plant.estop_reason,
        }
        say(f"bench: {res['rate_hz']} Hz of {plant.rate:g} over {res['seconds']} s; cycle start late by {res['jitter_ms']['mean']} ms on average "
            f"(99 % within {res['jitter_ms']['p99']}, at most {res['jitter_ms']['max']}); round trip {res['rtt_ms']['mean']} ms "
            f"(99 % within {res['rtt_ms']['p99']}, at most {res['rtt_ms']['max']}); {res['answered']} of {res['cycles']} answered, "
            f"late {res['late']}, dropped {res['dropped']}, skipped {res['skipped']}" + (f"; E-STOP: {res['estop']}" if res["estop"] else ""))
        print("bench-json: " + json.dumps(res), flush=True)


def plant_params(args):
    """The plant this run simulates: by default every physical parameter
    differs from the nominal one by a random factor within ±15 % (--vary), so
    the page, which is not told, has to identify it as it would a real one.
    --seed gives the same plant again; --set fixes a parameter."""
    Model = PLANTS[args.plant]
    rng = random.Random(args.seed)
    params = {}
    for name in Model.PHYSICS:
        params[name] = getattr(Model, name) * (1 + args.vary * rng.uniform(-1, 1))
    for item in args.set:
        name, _, value = item.partition("=")
        if name not in Model.PHYSICS:
            sys.exit(f"--set {item}: one of {', '.join(Model.PHYSICS)}")
        params[name] = float(value)
    return params


def check(args):
    """--check: 3 s of the nominal physics without a server. The motor under a
    PD at 100 Hz rises to about 1.2 rad (gravity leaves an offset without
    integral action); its own PID (reference mode) holds 1.5 rad; the heater's
    own PI reaches 50 °C."""
    if args.plant == "heater":
        m, own = Heater(), OwnController(Heater.OWN, Heater.EFFORT, 0.01)
        for _ in range(3000):
            m.advance(0.01, [own.step(50.0, m.outputs()[0])])
        print(f"T {m.Ts:.2f} °C after 30 s of its own PI towards 50 °C")
        return 0 if 48 < m.Ts < 52 else 1
    m = Motor()
    for _ in range(300):
        V = max(-12.0, min(12.0, 6 * (1.5 - m.angle) - 0.6 * m.w))
        m.advance(0.01, [V, 0.0])
    print(f"angle {m.angle:.3f} rad, speed {m.w:.3f} rad/s, current {m.i:.3f} A after 3 s of PD control towards 1.5 rad")
    ok = 1.0 < m.angle < 1.4
    m, own = Motor(), OwnController(Motor.OWN, Motor.EFFORT, 0.01)
    for _ in range(300):
        m.advance(0.01, [own.step(1.5, m.angle), 0.0])
    print(f"angle {m.angle:.3f} rad after 3 s of its own PID (reference mode) towards 1.5 rad")
    return 0 if ok and abs(m.angle - 1.5) < 0.02 else 1


# ---- the keys at the plant

COMMANDS = "s: stop, r: run, e or Enter: E-STOP, x: reset, q: quit"


def console_keys(loop, plant):
    """The console's keys, one command per line: the same as the window's."""
    try:
        for line in sys.stdin:
            c = line.strip().lower()[:1]
            act = {"": lambda: plant.trip("STOP pressed at the plant"), "e": lambda: plant.trip("STOP pressed at the plant"),
                   "s": plant.plant_stop, "r": plant.plant_run, "x": plant.plant_reset, "q": plant.done.set}.get(c)
            if act:
                loop.call_soon_threadsafe(act)
            else:
                say(COMMANDS)
    except (OSError, ValueError):  # no console
        pass


def window(plant, title):
    """The plant's window: a big red STOP (an E-stop, latched until Reset),
    Run/Stop, Reset and the state of the link. Returns a function that runs
    it (in the main thread, the server beside it), or None where there is no
    display (or no tkinter: uv's Python has it; some system Pythons do not)."""
    try:
        import tkinter as tk
    except ImportError:
        return None
    if sys.platform.startswith("linux") and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        return None
    try:
        root = tk.Tk()
    except tk.TclError:
        return None
    call = lambda fn, *a: plant.loop and plant.loop.call_soon_threadsafe(fn, *a)
    root.title(title)
    root.configure(padx=14, pady=12)
    root.minsize(380, 0)
    big = ("Helvetica", 30, "bold")
    stop = tk.Label(root, text="STOP", font=big, fg="white", bg="#c8102e", padx=40, pady=22, cursor="hand2", relief="raised", bd=4)
    stop.grid(row=0, column=0, columnspan=2, sticky="ew")
    stop.bind("<Button-1>", lambda e: call(plant.trip, "STOP pressed at the plant"))
    run = tk.Button(root, text="Run", width=12, command=lambda: call(plant.plant_stop if plant.running else plant.plant_run))
    run.grid(row=1, column=0, sticky="ew", pady=(10, 4), padx=(0, 4))
    reset = tk.Button(root, text="Reset", width=12, command=lambda: call(plant.plant_reset))
    reset.grid(row=1, column=1, sticky="ew", pady=(10, 4), padx=(4, 0))
    state = tk.Label(root, font=("Helvetica", 13, "bold"), anchor="w")
    state.grid(row=2, column=0, columnspan=2, sticky="ew", pady=(6, 0))
    info = tk.Label(root, font=("Courier", 11), anchor="w", justify="left")
    info.grid(row=3, column=0, columnspan=2, sticky="ew")
    keys = tk.Label(root, text="Space or Esc: STOP · R: run/stop · X: reset", fg="#555555", anchor="w")
    keys.grid(row=4, column=0, columnspan=2, sticky="ew", pady=(6, 0))
    root.columnconfigure(0, weight=1)
    root.columnconfigure(1, weight=1)
    for key in ("<space>", "<Escape>"):
        root.bind(key, lambda e: call(plant.trip, "STOP pressed at the plant"))
    root.bind("<r>", lambda e: call(plant.plant_stop if plant.running else plant.plant_run))
    root.bind("<x>", lambda e: call(plant.plant_reset))

    def refresh():
        if plant.done.is_set():
            root.destroy()
            return
        run.config(text="Stop" if plant.running else "Run")
        reset.config(state="normal" if plant.estop_reason else "disabled")
        if plant.estop_reason:
            state.config(text=f"E-STOP: {plant.estop_reason}", fg="#c8102e")
        else:
            state.config(text="Running" if plant.running else "Stopped", fg="#1b7f3a" if plant.running else "#333333")
        page = ("page: opened from a file" if plant.origin == "null" else f"page: {plant.origin}") if plant.client else "no page connected"
        info.config(text=f"{page}\n{plant.last_rate:.1f} Hz · jitter {fmt_ms(plant.last_jitter)} · round trip {fmt_ms(plant.last_rtt)}\n"
                         f"late {plant.late} · dropped {plant.dropped} · {plant.mode} mode\n{plant.reading()}")
        root.after(200, refresh)

    def close():
        call(plant.done.set)

    root.protocol("WM_DELETE_WINDOW", close)

    def mainloop():
        refresh()
        try:
            root.mainloop()
        except KeyboardInterrupt:
            call(plant.done.set)
    return mainloop


async def serve(args, plant, ready=None):
    from websockets.asyncio.server import serve as ws_serve
    plant.loop = asyncio.get_running_loop()
    plant.done = asyncio.Event()
    async with ws_serve(plant.handler, args.host, args.port, max_size=2 ** 20):
        varied = f"varied by up to ±{args.vary:.0%} (seed {args.seed}; the same plant again: --seed {args.seed})" if args.vary else "nominal (--vary 0)"
        say(f"Loop Tuner external plant: {plant.describe()['name']}; {varied}; the page is not told the physics.")
        if args.show_params:
            say("this plant: " + ", ".join(f"{n} {getattr(plant.model, n):.4g} {u}" for n, u in plant.Model.PHYSICS.items()))
        say(f"listening on ws://{args.host}:{args.port} at {args.rate:g} Hz; watchdog {args.watchdog} cycles"
            + (f"; logging to {args.log}" if args.log else "") + (f"; bench: {args.bench:g} s from the next Run" if args.bench else "") + ".")
        say("In Loop Tuner: System library > a HIL system > Load; Plant tab > Connect; then Run.")
        if ready:
            ready(plant)
        task = asyncio.ensure_future(plant.run())
        try:
            await plant.done.wait()
        finally:
            task.cancel()
            await plant.shutdown("the plant was shut down")


def main():
    p = argparse.ArgumentParser(description="Loop Tuner external plant (HIL demo): a simulated plant in real time, for Live mode.")
    p.add_argument("--plant", choices=sorted(PLANTS), default="motor", help="which plant: motor (a DC motor swinging an unbalanced arm; the default) or heater")
    p.add_argument("--mode", choices=["control", "reference", "log"], default="control",
                   help="control: the page sends the control effort (the default); reference: this plant runs its own controller and the page sends the reference; "
                        "log: no inputs, the plant holds its own setpoint and the page records")
    p.add_argument("--setpoint", type=float, default=None, help="--mode log: the setpoint it holds (default: 1 rad, 50 °C)")
    p.add_argument("--host", default="127.0.0.1", help="address to listen on (default 127.0.0.1: this computer only)")
    p.add_argument("--port", type=int, default=8765, help="port (default 8765)")
    p.add_argument("--rate", type=float, default=100.0, help="cycle rate in Hz (default 100; up to 200 measured sound with the default watchdog; at 500 or 1000 raise --watchdog and expect late cycles)")
    p.add_argument("--watchdog", type=int, default=10, help="E-stop after this many cycles without u (default 10)")
    p.add_argument("--slew", type=float, default=0.0, metavar="PCT",
                   help="limit how fast each input may change, in %% of its range per second (default 0: no limit; the page ramps in at 10 %%/s itself)")
    p.add_argument("--vary", type=float, default=0.15, metavar="F",
                   help="each physical parameter differs from nominal by a random factor within ±F, unknown to the page (default 0.15; 0: the nominal plant)")
    p.add_argument("--seed", type=int, default=None, help="seed for --vary: the same plant again (default: a new one each start; it is printed)")
    p.add_argument("--set", action="append", default=[], metavar="NAME=VALUE",
                   help="fix a physical parameter (motor: " + ", ".join(Motor.PHYSICS) + "; heater: " + ", ".join(Heater.PHYSICS) + ")")
    p.add_argument("--show-params", action="store_true", help="print the plant's true physical parameters (the page is never told)")
    p.add_argument("--log", metavar="FILE.csv", help="write every cycle (t, outputs, inputs, r and e from the page) and every event to a CSV file")
    p.add_argument("--bench", type=float, default=0.0, metavar="SECONDS",
                   help="measure the next run for SECONDS (rate, jitter, round trip, late, dropped), print the figures and end")
    p.add_argument("--no-gui", action="store_true", help="no window: the console takes the commands (s, r, e, x, q)")
    p.add_argument("--allow-origin", action="append", default=[], metavar="ORIGIN",
                   help="also accept pages from this origin, e.g. https://example.org ('*' accepts any page)")
    p.add_argument("--strict-origin", action="store_true",
                   help="also refuse pages with Origin null: a page opened from a file sends it, but so does a sandboxed frame on any web site "
                        "(serve the page from localhost then; recommended for real hardware)")
    p.add_argument("--spin", type=float, default=2.0 if sys.platform == "win32" else 0.0, metavar="MS",
                   help="wait out the last MS milliseconds of each cycle actively, for coarse OS timers (default: 2 on Windows, else 0)")
    p.add_argument("--check", action="store_true", help="run 3 s of the nominal physics without a server and exit")
    p.add_argument("--describe", action="store_true", help="print the answer to describe (JSON) and exit")
    args = p.parse_args()
    if args.seed is None:
        args.seed = random.randrange(10000)
    if args.check:
        sys.exit(check(args))
    plant = Plant(args)
    if args.describe:
        print(json.dumps(plant.describe(), ensure_ascii=False))
        return
    try:
        import websockets  # noqa: F401
    except ImportError:
        sys.exit("hil_plant.py needs websockets 13 or newer:\n  uv run hil_plant.py        (installs it by itself)\n  pip install 'websockets>=13' && python3 hil_plant.py")
    title = f"Loop Tuner plant: {plant.describe()['name']}"
    gui = None if args.no_gui else window(plant, title)
    try:
        if gui:
            # The window needs the main thread; the server runs beside it.
            CONSOLE["quiet"] = True
            started, box = threading.Event(), {}
            server = threading.Thread(target=lambda: box.setdefault("err", run_server(args, plant, started)), daemon=True)
            server.start()
            started.wait(10)
            if box.get("err") or not server.is_alive():
                sys.exit(box.get("err") or "the server did not start")
            say("The window has the STOP, Run/Stop and Reset keys; closing it ends the plant.")
            gui()
            server.join(3)
            return
        if not args.no_gui:
            say("No window here (no display, or no tkinter): this console takes the commands.")
        say("Console: " + COMMANDS)
        asyncio.run(serve(args, plant, ready=lambda pl: threading.Thread(target=console_keys, args=(pl.loop, pl), daemon=True).start()))
    except KeyboardInterrupt:
        print("\nstopped: the plant applies its safe inputs")
    except OSError as err:
        sys.exit(f"cannot listen on {args.host}:{args.port}: {err}")


def run_server(args, plant, started):
    try:
        asyncio.run(serve(args, plant, ready=lambda pl: started.set()))
    except OSError as err:
        return f"cannot listen on {args.host}:{args.port}: {err}"
    finally:
        started.set()
    return None


if __name__ == "__main__":
    main()
