# Controllers, and demos that run 5 seconds (2026-10-24)

> Okay. Looks good. Maybe it's a bit, maybe you can make it so this thing takes 5 seconds and just moves a bit slower. And maybe in the caption now, it doesn't the caption expands and shrinks depending on the number of digits in the numerics. That's also not ideal. That's in the hanging mass diagram. Other than that, that looks very good. The DC motor, not sure why you added the green dot, but I also don't really care. It's okay. We can leave it like that. Inverted pendulum. Yeah, that's good. That shows us the force. And now so the inverted pendulum and the DC controller, that would be something where we add a controller. Like in the DC motor, we can add a controller that's a bit, that's not that good, and that jumps between two reference values. So we see it oscillating, right? And in the card, we should add a controller that's halfway decent so it can stabilize the thing. And then we see basically the control efforts as forces. That would be great, I think. So yeah, in general, just so it doesn't overwhelm, I feel like we should make it so the demo stuff runs in 5 seconds, but other than that, that's very good. So yeah, how about you add controllers? And again, we should have a small controller library where we can flip controllers, like start with PID controllers, then how are they called? The simple matrix controllers, and I'm forgetting the name right now, and then maybe even some more complicated stuff like Lyapunov controllers. Maybe we can figure out a plant that needs a gain scheduler. So yeah, I feel like if we have 2 or 3 plants with increasing complexity of controllers, that would be nice. And then people can play around with the parameters. a vorfilter could also be part of it, and so on.

## Added while this was being built

> And really, if you're going to do two pendulums, then make the other thing a double or triple pendulum.

> Like you can have a simple pendulum for the something simple, and then for the for a more complex controller, you can have a complex, you can have a triple pendulum. And remember, the idea is you can still have a, like if we need to switch to WebAssembly, that's fine for me.

> But it's not a requirement. I'm just saying, if we ever get to the point where this makes sense, let's do it.

> Oh yeah, and I guess for the control systems, you can also add a disturbance, right? That's good. So we can tune for disturbance and for following. Good stuff.
