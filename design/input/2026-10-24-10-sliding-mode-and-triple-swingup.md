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

## Added while this was being built: a histogram of amplitudes for the spectrogram

> And I guess something that would be useful for the spectrogram, although I'm not sure where to put it, would be a histogram of the amplitudes where you can select the cutoff. I mean, so see how PyQt graph does it, where I can select which amplitudes I want to show, because I feel like the amplitudes we see in the spectrogram are not clear enough because there's too much noise. And if we could like cut off lower amplitudes, then we would reduce that noise. I just wonder where we put that, but yeah, figure it out.

## Added while this was being built: identification before auto-tune and analysis; a HIL plant we do not know

> So about the autotune, I feel like the autotune, it said it had 92 runs. So it doesn't really have anything to do with the simulation running in the plot. How would that work for a hill system? Like, just, I want to be, the autotune, if that worked, like, I feel like in a hill system, it has to be different, right? Because we don't have any information about the plant, we don't have any I guess we're going to have to introduce a identification feature also, right? Maybe between controller and autotune we have an identification, and I guess then the autotune should also work for hill systems. And then the analysis is currently, it doesn't show anything. Needs to plant a block seeds. Okay, it comes with the design layer. Okay. So I feel like the analysis over a hill system would also need, I guess, an identification feature. So after controller, before autotune and analysis would come identification, maybe. And then we can simulate, like put the identification, identify the plant that we have modeled actually. And in the hill, we can start the hill with a, with variations, I guess. There's a, maybe we should actually always do that. So the hill that we, that our hill simulator will always have some variation up to like 15% or so. So we don't really, we don't know, in general, we don't know what plant the hill is running, right? We can set it on the hill side. It's going to have a command line interface, so we can set the plant that is running, but the other side doesn't know it, so we have to identify it. Does that make sense?

> do some research on how you would probably identify this. The methods you named sound reasonable, but I wonder if there's something more modern.

## Added while this was being built: no provenance in the HTML

> Also, one more thing that you can just check and make sure that it's incorporated. I want no provenance information about the where this tool is coming from in the HTML. Right? The idea is I'm building this in my free time just out of interest, but I will use this as an example at work on how quickly you can build something like this with LLMs. And so I don't want this associated, the HTML should not be associated with my private GitHub, or should in any way, it shouldn't be like I'm gonna clone my private GitHub on my work PC. I'm gonna rebuild the HTML, and then I don't want this to have any provenance information. So it's not clear to that it's coming from outside of work. This is not critical here. We're not doing anything work related, but our company is not too keen on that stuff.

## Added while this was being built: identification is experiment first, for a tester who knows no control theory

> About the competing designs, it will be experiment first. Like, you can ask some general questions about the system, but really the expectation is the system saves itself from any, like, you can start with slow control efforts and then increase this over time. Like, you don't have to give it 100% straight from the beginning. So you can ease into it, but the responsibility of saving, of keeping the system safe is with the plant. And so you need to assume that somebody's using the system who has no idea of control theory. He doesn't know if this thing is integrating or not. He doesn't know anything. So you have a, I guess, normalized control effort. Well, I guess we can have limits on the control effort, and we can have limits on the actual values and reference values. That, I guess, that information we do have. That should be like in the, yeah. And then you ease into it and you do it via experiment. Assume that the guy who uses that is a tester who is not really familiar with control theory. So he's not going to give you a model. He's not going to give you a gray box.

## Added while this was being built: a diagram of what the controller does; feedforward in the standard controller

> And then I guess for now it's okay if we don't have configurable controllers, but I would still like to have a small diagram of what the controller does in the corner that's still open. For example, I wonder if our controllers really have a good feed forward. So set point weight, is that the feed forward? Like, I'm not sure. I wonder if autotune currently goes only over the current control architecture, right? It doesn't go over all. I guess that's okay. I just feel like with feed forward, the PID controller would be much better. There's no reason. Yeah, we know, if we know that the reference value changes, we can apply a feed forward to it instantly. So that should be part of a, that's part of a standard controller in general, I feel.

> So yeah, you usually, yeah, I would also assume that you have a set point. You have a set point feed forward, if that makes sense. You have an position and acceleration feed forward, if that makes sense. I feel like in badly tuned controllers, you can still set that to a bad value. But yeah, nobody that does serious control theory does it without feed forward. So our controllers need to support it.

> And yeah, anti-windup is also a feature that we can have in, and then for one example where we want it badly tuned, we can flip it off. But again, that's also something I would consider just state of the art, so it needs to be in.

## Added while this was being built: the page always sends the effort; the reference goes along for the plant's log

> About reference mode, I feel like what is you? Is you the effort? We should never say, like, we are. Normally, we would send the reference value and we would send. Wait. No, I guess maybe I was wrong about the reference mode. We know the reference in our system. We should send it to the other system so they can log it on their side. But yeah, obviously, we are always sending the control effort. Yeah, I was tripping there. Sorry.

## Added while this was being built: both HIL modes, settled

> Okay, maybe I have to revise myself again about the reference mode. If we want to be tuning the controllers, then obviously we are always going to be sending the control effort, but that's not all we want to do. We may just want to use that thing to log data, and then we would send reference values. So we need both modes. It's just like the reference mode, obviously, I feel like we should then display something in the controllers, that the controllers are not in the loop. And also the auto-tuning is not in the loop. And yeah, I guess we can identify to some extent with a reference mode. So yeah, it should be in. The hill mode should support it. Write that down so we find it later, so we don't make that same mistake again of going back and forward on this.

## Added while this was being built: Live controls in the plant panel; a clear plant download

> Okay, I feel like for the hill example, the plant script is not clear enough. I'm not sure if I want the hill stuff in the Ostsee controls. Just put them in the plant controls in the bottom right corner. And make it clear, like, yeah, that's too small, the download button for the script. I guess I'm not gonna test it today. But yeah, you can still fix that.

(Transcription: "Ostsee controls" is "oscilloscope controls", the Run Control panel; "hill" is HIL.)
