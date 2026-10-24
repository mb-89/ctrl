# 2026-10-24 · Record = screen, Auto Scale rule, Input tab layout

Reader: anyone who needs the person's own words on these points. Verbatim; transcribed speech, typos kept. Said after seeing v2 (the oscilloscope with the Input tab).

> Okay, so about the record and sweep time, you can skip that. The record and sweep time is always as long as how we set the OSCE. So it will always sweep over the whole OSCE. I guess the auto scale we will see later. Like if we have a, the auto scale probably needs, it either scales with, if we have a more complex input signal, it needs to show the whole input signal, one period, right? If we, I guess that's what the auto scale does. And in a case like this, the input signal itself is very, I guess in a case where the input signal itself, yeah, we're gonna have, I'm not sure how we do the auto scale with a signal like this. I feel like this idea of, having, I guess if we don't have a reaction signal, then we will never go under one, we will never go under 1 second, I suppose. Or let's say if we don't have a reaction signal, then we stop at 1/2 a second after the last change as a fallback rule. I guess that's okay. Or I guess, let's say we stop at 1 second after the last change, and then we round to the milliseconds per division, how it, wherever it makes sense, right? Then for the input, I guess I like it. The only thing is, I don't like the idea that the signal list is below the rest. If you put this next to the entry, and make it not eat up, like it doesn't need so much vertical space, right? So if you put it next to the entry, to the right of it, then the whole tab becomes a little bit less high. And then that means we don't have a scroll bar anymore at the top. And we also, I don't want a scroll bar at the tabs. So I guess work all of that in. And for the signals, I like it, but the idea would be, okay, you can map everything to it that you want. Yeah, okay. Just, yeah, that's good. I'll keep it like that. So basically, the step, the new step thing would become a bit smaller. It's, it doesn't need so much space. And the signal list would also become a bit smaller and move to the left of the entry.

## Follow-up (while the above was being worked on)

> And I guess do it like that. For the input signal under the waveforms, just add the overall length of the input signal. Just add the period of the input signal, right? And then that defines the length of the input signal, and that would also be used by the autoscaler. I guess that's the right choice.

## Follow-up 2

> And then I feel like, okay, we have the knobs where we can set up all the values per division, position, scale. But if we click on the numbers, we should also be able to edit this by hand, right?

## Follow-up 3

> And then I don't really want the upper and lower tab to change their sizes when you switch tabs, right? I want the user to be able to set the sizes themselves. They should be able to move the separator by themselves, but it doesn't change if you switch a tab. Also, the separator between the run control and the OSC, that should also be something the user can set.

## Follow-up 4

> And then zooming with the mouse wheel inside the plot should also work. It should just use, it should just set the same controls, right? So dragging up and down moves everything, right? Up and down. I guess if you select a single line, for example, by its marker or by clicking on it, you can also drag that line, right? And I guess if you have a line selected and then you use mouse wheel, then you would zoom that in and out. Also, yeah, so mouse wheel, I guess, would zoom both vertical and horizontal. Think about how you can do it. So if you, let's say you go outside of the plot to the x-axis and you mouse scroll there, you only scroll the x-axis. If you go outside of the plot on the y-axis and scroll there, you only scroll the y-axis. Yeah, so that should all also work. And then if you, I guess, click and move only to the right or only to the up and down, you can also like mark an area of the, panel, and then you would only show that, but I guess that would be a shift click. So think about how we can introduce this also. It should look like an OSCE, but obviously where we can improve over OSCEs, we should bake that in, just not in the look, but in the behavior itself.

## Follow-up 5

> And then I feel like the pulse and the square, you can probably make that one button, right? By adding a, I guess, number of repetitions to the square, which is by default as much as, by default it's not limited, but you could limit it. And then you have space for one more button, which I just would say would be a function button. So arbitrary would load from a file. Arbitrary would load from a file, but we could also just have a function button, X as a function of time, and then you can enter a term.

> Well, I guess y as a function of time, but you get it.

## Follow-up 6

> Yeah, and I guess the length thing we would keep, we would call it period, and we would put it under the waveform, not in its own line. But yeah, you get it. And yeah, it shouldn't, I mean, I don't mind if it's eval, but usually there is a differentiation between eval and something that just parses functions. I feel like, I think Python has that. So maybe you can use something like this. Think about it. If it's not a lot of effort to build it yourself, that's fine.
