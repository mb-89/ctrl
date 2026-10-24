# Sliding mode control; the triple pendulum swing-up (2026-10-24)

> Okay, there's two more things I want you to do, but you can do this overnight. So it's just to burn tokens, I guess. And that is sliding mode control. My understanding is that sliding mode control works not that well because the control effort is so hard on the actuators. So I want you to do a classic, an example for a classic sliding mode control, figure out what plants they are usually used for, make it as an example, implement the controller. Also, I feel like this would probably have a, I'm not sure if we need a new diagram for that or if we can use the X, Y and delta diagram for it. So yeah, see if you can do that and then do a lot of research on this and figure out, are there improvements on sliding mode controllers that are not as hard on the actuators? Like, how is this used in practical terms? And then you can add that as a variation of the control loop. So maybe one that's theoretical, but hard on the actuator, and then one that is more practical.

> And also, what about the swing up of the triple pendulum? Will you do this? Is there anything preventing us from doing that? Is it hard to compute? What's up with that?

## Added while this was being built: no black-box models

> And in general, what I see a lot is that you put like the cart and the three rods, you just put that as a black box model. Think about if you can, I guess an agent can do that, like make these black box models understandable for the user. I want to be able to click into that and see what it's about. Model it in our diagrams. And if you find that there's something you can't model, then add it as a primitive to our diagrams, right? So they shouldn't be black boxes.

## Added while this was being built: one button, semantic styles in one place

> And then maybe some UX thing for the inputs. If I select the R or the D as an input in the input generator, it's really hard to see which one is selected. It's not clear what, it seems black is selected, but that's not clear from the, yeah, it's not clear. In general, it seems like every button looks different. Like the buttons for the channels look different than the run control, looks different than the time, looks different than the buttons down there. See that you put everything through a single master style sheet. There's no need for 5 different types of buttons. Pick one. And this goes, that goes for all the design elements, right? Don't have 5 different styles for everything in our design. Like the styles are supposed to be semantic. And then we choose a semantic style and we change it in one place.

## Added while this was being built: step-response tuning on the DC motor

> Okay, so the step response tuning on the DC motor doesn't seem to work at all. What's up with that? Also, I feel like yeah, check this out. Like, let's see if this is an issue.

## Added while this was being built: time control in the header

> And then I guess when we are talking about the hill system and timing in general, so we're going to have to add time control, and we can probably add that to the header bar. And then normally it is 1x, but we can also increase it to like 5x or 10x or infinite. Like, I guess make it optional how many x you want, allow infinite, like with a -1 would be infinite. And also show how fast the time is actually running. So we can see when, if I set to infinite, I see, okay, it caps out at 20x. And then the fast toggle of the autotune, that would go away. If I want to autotune fast, then I just set the toggle to higher speeds, right? And then obviously for the hill, in hill we are fixed to 1.0. And when we say we allow arbitrarily fast times, the user could also enter 0.1, right? And then it would go slower if they wanted. If they want to simulate something very, very fast. I don't see a reason, but maybe they want it.

## Added while this was being built: filter the System library by tag

> And then I guess when you show the tags in the system library, show all available tags. And if we click on it, we filter for them. So somebody could filter for linear or for non-linear, for like someone would see what feature, and when we click on it, we filter for that. I guess that would be useful.
