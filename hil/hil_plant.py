#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["websockets>=13"]
# ///
"""Loop Tuner external plant: a DC motor swinging an unbalanced arm, simulated
in real time at 100 Hz on your computer, for Loop Tuner's Live (HIL) mode.

    uv run hil_plant.py             uv installs websockets by itself
    python3 hil_plant.py            with websockets installed (pip install websockets)
    python3 hil_plant.py --check    runs the physics for 3 s, no server, no websockets
    python3 hil_plant.py --describe prints what it tells the page about itself

Then, in Loop Tuner: System library > "HIL: external motor" > Load, and press
Connect under Live. The scope's Run and Stop start and stop this plant. Press
Enter here to E-stop it (its own stop button); Ctrl+C ends it. Its physics
varies from nominal by up to ±15 % (--vary, --seed, --set), and the page is
not told. Options: --port, --rate, --watchdog, --vary, --seed, --set,
--allow-origin, --strict-origin (python3 hil_plant.py --help).

The protocol is JSON-RPC 2.0, one message per WebSocket text frame, at
ws://127.0.0.1:8765 (Loop Tuner's design/output/hil.md has all of it):

  page -> plant  {"jsonrpc": "2.0", "id": 1, "method": "describe"}
                 requests "start", "stop", "reset", "estop", each answered
                 {"jsonrpc": "2.0", "method": "u", "params": {"seq": 42, "u": [3.1, 0]}}
  plant -> page  {"jsonrpc": "2.0", "method": "y", "params": {"seq": 42, "t": 0.42, "y": [1.2, 0.3, 0.8]}}
                 {"jsonrpc": "2.0", "method": "estop", "params": {"reason": "...", "t": 1.23}}
                 {"jsonrpc": "2.0", "method": "status", "params": {...}}  once a second

This script owns the clock: every cycle it integrates the physics, sends the
outputs y and applies each input u from the moment it arrives. It is also the
safety authority: if no u comes for 10 cycles, the page goes away while
running, the page asks for it, or Enter is pressed here, it applies the safe
inputs and latches an emergency stop (E-stop) until the page sends "reset".

To put real hardware behind Loop Tuner, keep the server, the watchdog and the
cycle, and replace Motor with your device's I/O.
"""

import argparse
import asyncio
import json
import math
import random
import re
import sys
import threading
import time

PROTOCOL = "loop-tuner-hil/1"


class Motor:
    """A DC motor (armature resistance R, inductance L, torque and back-EMF
    constant k) turning an arm with an unbalanced mass: gravity pulls with
    m g l sin(angle), angle 0 hanging down, positive counter-clockwise. Viscous
    friction b and Coulomb friction Tc (smoothed around standstill) brake it;
    `load` is an extra torque on the shaft, from a test rig, positive along +angle.
    The page's PID has to beat gravity (it needs integral action to hold the
    arm up) and friction, with the motor's 12 V."""

    R, L, k = 2.0, 4e-3, 0.1        # ohm, H, N·m/A (= V·s/rad)
    J, b = 2.5e-3, 2e-3             # kg·m², N·m·s/rad
    Tc, w_eps = 0.01, 0.01          # N·m, rad/s
    mgl = 0.1                       # N·m: the arm's unbalance
    H = 5e-4                        # s: integration substep (the electrical time constant is 2 ms)

    INPUTS = [
        {"name": "V", "unit": "V", "min": -12.0, "max": 12.0, "safe": 0.0},
        {"name": "load", "unit": "N·m", "min": -0.2, "max": 0.2, "safe": 0.0},
    ]
    OUTPUTS = [
        {"name": "angle", "unit": "rad"},
        {"name": "speed", "unit": "rad/s"},
        {"name": "current", "unit": "A"},
    ]

    # The physical parameters, which the page does not know (see plant_params).
    PHYSICS = {"R": "ohm", "L": "H", "k": "N·m/A", "J": "kg·m²", "b": "N·m·s/rad", "Tc": "N·m", "mgl": "N·m"}

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
        """Integrates `span` seconds with the inputs u held (fixed-step RK4)."""
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


class Stats:
    """Mean and maximum of what happened in the last second."""

    def __init__(self):
        self.values = []

    def add(self, v):
        self.values.append(v)

    def take(self):
        v, self.values = self.values, []
        return {"mean": round(sum(v) / len(v), 3) if v else None, "max": round(max(v), 3) if v else None}


class Plant:
    def __init__(self, args):
        self.args = args
        self.rate = args.rate
        self.dt = 1.0 / args.rate
        self.motor = Motor(plant_params(args))
        self.safe = [p["safe"] for p in Motor.INPUTS]
        self.u = list(self.safe)          # the inputs applied now
        self.pending = []                 # (arrival time, u) received since the last cycle
        self.client = None                # the one connected page
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
            print(f"refused a page from {origin}: start with --allow-origin {origin} to allow it")
            await ws.close(1008, "origin not allowed; see the plant's console")
            return
        if self.client is not None:
            await ws.close(1013, "busy: another page is connected")
            return
        self.client = ws
        print(f"page connected ({origin or 'no origin'})")
        try:
            async for text in ws:
                await self.on_message(ws, text)
        except Exception as err:  # a broken connection ends like a closed one
            print(f"connection error: {err}")
        finally:
            self.client = None
            if self.running:
                self.trip("connection lost")
            self.running = False
            print("page disconnected")

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

    def describe(self, _params):
        return {
            "protocol": PROTOCOL,
            "name": "DC motor with an unbalanced arm (simulated)",
            "rate_hz": self.rate,
            "watchdog_cycles": self.args.watchdog,
            "inputs": Motor.INPUTS,
            "outputs": Motor.OUTPUTS,
            "running": self.running,
            "estop": self.estop_reason,
        }

    def start(self, _params):
        if self.estop_reason:
            raise RuntimeError(f"E-stop latched ({self.estop_reason}); send reset first")
        if not self.running:
            self.running = True
            self.k_start = self.k              # the next cycle is seq 0, t 0
            self.since_u = 0
            self.sent.clear()
            print("started")
        return {"rate_hz": self.rate}

    def stop(self, _params):
        if self.running:
            print("stopped")
        self.running = False
        self.u = list(self.safe)
        self.pending.clear()
        return {}

    def reset(self, _params):
        if self.estop_reason:
            print(f"E-stop reset (was: {self.estop_reason})")
        self.estop_reason = None
        self.since_u = 0
        return {}

    def manual_estop(self, params):
        self.trip(str(params.get("reason") or "pressed on the page"))
        return {}

    def take_u(self, params):
        """A new input, from the moment it arrives. Ignored while stopped or
        E-stopped; clamped to each input's limits; a bad value is the safe one."""
        if not self.running or self.estop_reason:
            return
        u = params.get("u")
        if not isinstance(u, list) or len(u) != len(Motor.INPUTS):
            return
        clean = []
        for v, spec in zip(u, Motor.INPUTS):
            ok = isinstance(v, (int, float)) and math.isfinite(v)
            clean.append(min(spec["max"], max(spec["min"], v)) if ok else spec["safe"])
        now = time.perf_counter()
        sent = self.sent.pop(params.get("seq"), None)
        if sent is not None:
            self.rtt.add(1000 * (now - sent))
        self.pending.append((now, clean))
        self.since_u = 0

    # ---- safety

    def trip(self, reason):
        """Emergency stop: safe inputs now, latched until "reset"."""
        if self.estop_reason:
            return
        self.estop_reason = reason
        self.u = list(self.safe)
        self.pending.clear()
        print(f"E-STOP: {reason}; safe inputs applied, latched until the page resets it")
        self.notify("estop", {"reason": reason, "t": round((self.k - self.k_start) * self.dt, 6)})

    async def shutdown(self, reason):
        """Ctrl+C: safe inputs, and the page hears why before the connection
        closes (an E-stop if it was running), not just a lost connection."""
        self.u = list(self.safe)
        ws, self.client = self.client, None
        if ws is None:
            return
        try:
            if self.running:
                self.estop_reason = reason
                msg = {"jsonrpc": "2.0", "method": "estop", "params": {"reason": reason, "t": round((self.k - self.k_start) * self.dt, 6)}}
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

    # ---- the cycle

    def cycle(self, now, last, span):
        """One cycle: the physics over the last `span` seconds, each u applied
        from the moment it arrived; then the watchdog; then y."""
        at = 0.0
        for arrived, u in self.pending:
            off = min(max(arrived - last, 0.0), span)
            self.motor.advance(off - at, self.u)
            self.u, at = u, off
        self.motor.advance(span - at, self.u)
        had_u = bool(self.pending)
        self.pending.clear()
        if not self.running:
            return
        seq = self.k - self.k_start
        # The watchdog counts y the page left unanswered: cycles this script
        # skipped itself (a stalled computer) sent no y, so they do not count.
        if seq > 0 and not had_u:
            self.since_u += 1
            if not self.estop_reason:
                self.late += 1
        if self.since_u >= self.args.watchdog and not self.estop_reason:
            self.trip(f"no u for {self.since_u} cycles")
        self.sent[seq] = time.perf_counter()
        self.sent.pop(seq - 50, None)
        self.notify("y", {"seq": seq, "t": round(seq * self.dt, 6), "y": [round(v, 6) for v in self.motor.outputs()]})

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
        while True:
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
            self.jitter.add(1000 * (now - deadline))
            self.cycle(now, last, (skip + 1) * self.dt)
            last = now
            cycles += 1
            self.k += 1
            if now >= next_status:
                self.status(cycles / (now - next_status + 1.0))
                cycles = 0
                next_status = now + 1.0

    def status(self, rate):
        jitter, rtt = self.jitter.take(), self.rtt.take()
        s = {"t": round((self.k - self.k_start) * self.dt, 3) if self.running else None, "rate_hz": round(rate, 2), "jitter_ms": jitter, "rtt_ms": rtt,
             "late": self.late, "overruns": self.overruns, "dropped": self.dropped, "running": self.running, "estop": self.estop_reason}
        self.notify("status", s)
        # The console: one line rewritten every second in a terminal, a new line every 5 s otherwise.
        tty = sys.stdout.isatty()
        if tty or self.k % round(5 * self.rate) < self.rate:
            state = f"E-STOP ({self.estop_reason})" if self.estop_reason else "running" if self.running else "waiting" if self.client else "no page"
            fmt = lambda st: f"{st['mean']:.2f}/{st['max']:.2f} ms" if st["mean"] is not None else "-"
            print(f"\r{state:<28.28} {rate:6.1f} Hz  jitter {fmt(jitter)}  round trip {fmt(rtt)}  late {self.late}  "
                  f"angle {self.motor.angle:+6.2f} rad  V {self.u[0]:+6.2f}   ", end="" if tty else "\n", flush=True)


def plant_params(args):
    """The plant this run simulates: by default every physical parameter
    differs from the nominal one by a random factor within ±15 % (--vary), so
    the page, which is not told, has to identify it as it would a real one.
    --seed gives the same plant again; --set fixes a parameter. Printed at
    the start, for whoever runs the plant."""
    rng = random.Random(args.seed)
    params = {}
    for name in Motor.PHYSICS:
        params[name] = getattr(Motor, name) * (1 + args.vary * rng.uniform(-1, 1))
    for item in args.set:
        name, _, value = item.partition("=")
        if name not in Motor.PHYSICS:
            sys.exit(f"--set {item}: one of {', '.join(Motor.PHYSICS)}")
        params[name] = float(value)
    return params


def check():
    """--check: 3 s of physics with a PD at 100 Hz, no server. The arm should
    rise to about 1.2 rad (gravity leaves an offset without integral action)."""
    m = Motor()
    for k in range(300):
        V = max(-12.0, min(12.0, 6 * (1.5 - m.angle) - 0.6 * m.w))
        m.advance(0.01, [V, 0.0])
    print(f"angle {m.angle:.3f} rad, speed {m.w:.3f} rad/s, current {m.i:.3f} A after 3 s of PD control towards 1.5 rad")
    return 0 if 1.0 < m.angle < 1.4 else 1


def stop_key(loop, plant):
    """The plant's own stop button (the page has its E-STOP): every Enter in
    this window latches an E-stop, which the page's Reset clears."""
    try:
        for _ in sys.stdin:
            loop.call_soon_threadsafe(plant.trip, "stop pressed at the plant")
    except (OSError, ValueError):  # no console
        pass


async def serve_forever(args):
    try:
        from websockets.asyncio.server import serve
    except ImportError:
        sys.exit("hil_plant.py needs websockets 13 or newer:\n  uv run hil_plant.py        (installs it by itself)\n  pip install 'websockets>=13' && python3 hil_plant.py")
    plant = Plant(args)
    async with serve(plant.handler, args.host, args.port, max_size=2 ** 20):
        print(f"Loop Tuner external plant: {plant.describe({})['name']}")
        varied = f"varied up to ±{args.vary:.0%}, seed {args.seed}" if args.vary else "nominal"
        print(f"this plant ({varied}; the page is not told): " + ", ".join(f"{n} {getattr(plant.motor, n):.4g} {u}" for n, u in Motor.PHYSICS.items()))
        print(f"listening on ws://{args.host}:{args.port} at {args.rate:g} Hz; watchdog {args.watchdog} cycles.")
        print("In Loop Tuner: System library > HIL: external motor > Load, then Connect under Live; Run and Stop start and stop this plant.")
        if sys.stdin is not None and sys.stdin.isatty():
            threading.Thread(target=stop_key, args=(asyncio.get_running_loop(), plant), daemon=True).start()
            print("Enter: E-stop (the page's Reset clears it). Ctrl+C: end.")
        else:
            print("Ctrl+C: end.")
        try:
            await plant.run()
        finally:
            await plant.shutdown("the plant was shut down (Ctrl+C)")


def main():
    p = argparse.ArgumentParser(description="Loop Tuner external plant (HIL demo): a DC motor with an unbalanced arm, in real time.")
    p.add_argument("--host", default="127.0.0.1", help="address to listen on (default 127.0.0.1: this computer only)")
    p.add_argument("--port", type=int, default=8765, help="port (default 8765)")
    p.add_argument("--rate", type=float, default=100.0, help="cycle rate in Hz (default 100)")
    p.add_argument("--watchdog", type=int, default=10, help="E-stop after this many cycles without u (default 10)")
    p.add_argument("--allow-origin", action="append", default=[], metavar="ORIGIN",
                   help="also accept pages from this origin, e.g. https://example.org ('*' accepts any page)")
    p.add_argument("--strict-origin", action="store_true",
                   help="also refuse pages with Origin null: a page opened from a file sends it, but so does a sandboxed frame on any web site "
                        "(serve the page from localhost then; recommended for real hardware)")
    p.add_argument("--spin", type=float, default=2.0 if sys.platform == "win32" else 0.0, metavar="MS",
                   help="wait out the last MS milliseconds of each cycle actively, for coarse OS timers (default: 2 on Windows, else 0)")
    p.add_argument("--vary", type=float, default=0.15, metavar="F",
                   help="each physical parameter differs from nominal by a random factor within ±F, unknown to the page (default 0.15; 0: the nominal plant)")
    p.add_argument("--seed", type=int, default=None, help="seed for --vary: the same plant again (default: a new one each start)")
    p.add_argument("--set", action="append", default=[], metavar="NAME=VALUE",
                   help="fix a physical parameter: " + ", ".join(f"{n} [{u}]" for n, u in Motor.PHYSICS.items()))
    p.add_argument("--check", action="store_true", help="run 3 s of the nominal physics without a server and exit")
    p.add_argument("--describe", action="store_true", help="print the answer to describe (JSON) and exit")
    args = p.parse_args()
    if args.seed is None:
        args.seed = random.randrange(10000)
    if args.check:
        sys.exit(check())
    if args.describe:
        print(json.dumps(Plant(args).describe({}), ensure_ascii=False))
        return
    try:
        asyncio.run(serve_forever(args))
    except KeyboardInterrupt:
        print("\nstopped: the plant applies its safe inputs")
    except OSError as err:
        sys.exit(f"cannot listen on {args.host}:{args.port}: {err}")


if __name__ == "__main__":
    main()
