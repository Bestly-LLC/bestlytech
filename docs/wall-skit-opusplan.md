# The Night Shift: a cartoon skit for the Bestly Wall

A short cartoon for the wall. It runs about 100 seconds, with original characters, real voices and speech bubbles, and it fits the 1800 × 300 strip on the ceiling. You start it from **Admin → Wall → Show for friends → Play the skit**. It's built on the same machinery as the friends show (`state.tour`), so Stop, the heartbeat and the iPhone Live Activity all work the same way.

## Goals

- **Feels like a real cartoon.** Characters enter from the edges, talk, react, look at whoever is speaking, and leave. It never cuts abruptly and never has dead air.
- **Real voices, not beeps.** Each character has a different neural voice. The voices are rendered once on the Pi, so playback is instant and nothing depends on the internet.
- **Works with the sound off.** Every line also appears in a speech bubble. At night, or with wall sound off, it's still a complete show.
- **About the wall itself.** The jokes are drawn from what we actually built: the stars switch, the moon flicker bug, plane physics, the Google TV volume guard, the charging bolts, the helicopters.
- **Fits the strip.** The action stays in x 0–1260, and anything higher up stays above y 110 past x 1260, so the TV wedge in the bottom right never hides a character.

## Cast (all original)

| Character | What it is | Voice (Piper, offline) | Color | Personality |
|---|---|---|---|---|
| **Scout** | Bestly's binoculars mascot, with eyes, lids and a mouth | `en_US-amy-medium`, a touch faster | Blue `#0A84FF` | Earnest night-shift guard; knows every setting on the wall |
| **Nimbus** | A small rain cloud | `en_GB-alan-medium`, slowed and deeper | Cool gray | Dry, dramatic, drizzles when annoyed |
| **Pip** | A tiny prop plane from the sky layer | `en_US-ryan-medium`, pitched up and fast | Orange `#FF9F0A` | Hyper, loves physics, enters by looping the loop |
| **Air Unit Seven** | The black-and-white police helicopter | `en_US-joe-medium` through a radio filter with squelch | Black and white, red/blue light bar | Deadpan radio cop; sweeps a spotlight |

## Script ("The Night Shift"; in the daytime it becomes "The Day Shift")

1. Title card: **The Night Shift**, subtitle *A Bestly Wall original*. Stars fade in.
2. Scout rises into frame. *"Night shift, hour three. All quiet on the ceiling."* (Day: *"Day shift. All quiet on the ceiling."*)
3. Scout: *"Car's parked. Doors locked. Lightning bolts only where they belong."*
4. Nimbus drifts in from the left. *"Hello, Scout. They've told me to be partly cloudy. I refuse to be partly anything."*
5. Scout's reply depends on the live weather:
   - Clear: *"It's clear out. You're not even on the forecast."*
   - Cloudy: *"It is cloudy out. For once, you're on the forecast."*
   - Rain: *"It's actually raining. Are you doing that?"*
6. Nimbus: *"Speaking of things that come and go, remember when the moon kept flickering?"*
7. Scout: *"We do not talk about the moon."*
8. Pip loops in from the right. *"Mayday, mayday! Small plane, big dreams! Which way is LAX?"*
9. Scout: *"Nose first, Pip. Your tail follows your nose now. We fixed the physics."*
10. Pip: *"I love physics! Hey, is it always this dark up here?"*
11. Nimbus: *"Someone switched the stars off."*
12. Scout: *"Jared likes a clean sky. Planets off, sun on. It's a whole policy."*
13. The helicopter sweeps in with its spotlight. *"This is Air Unit Seven. We've had reports of a cartoon."*
14. Pip, shaking: *"Officer, I can explain! I entered from the edge of the screen, like you're supposed to!"*
15. Unit Seven: *"Carry on. And keep it down. The neighbors can hear Google TV."*
16. Scout: *"Handled. The wall mutes Google TV in under a second."*
17. Unit Seven: *"Copy that. Air Unit Seven, rolling out."* It exits over everyone's heads.
18. Nimbus: *"Well. That's the most excitement I've had since drizzle."*
19. Pip looks down. *"Hey, what's that glowing rectangle down there?"*
20. Everyone looks down. Scout: *"That's the desk. And that's Jared. Still awake."* (Day: *"Working, as usual."*)
21. Nimbus: *"At this hour? Even I go to bed, and I'm weather."* (Day: *"All day? Even clouds take breaks."*)
22. Pip: *"Should we do the thing?"* Scout: *"Do the thing."*
23. All three together, big bubble: **"Go to bed, Jared!"** (Day: **"Go outside, Jared!"**)
24. Scout: *"Scout, signing off. The wall's got it from here."* Everyone leaves by their own edge, the end card shows, and the wall comes back.

## How it's built

**Voices (Pi, one time).** `/opt/bestly/skit/build.py` installs Piper in a venv, downloads the four voices from `rhasspy/piper-voices`, and renders every line (all variants included) to `/opt/bestly/wall/www/skit/<id>.wav`. It writes `manifest.json` with each line's text, speaker and length. The wall server serves `/skit/*`. Changing a line means editing `LINES` in `build.py` and running it again; the page picks up the new manifest.

**Playback (wall.html).**
- The skit reuses the tour module: `state.tour = {cmd:"skit"}` → `skitStart()`, with `TOUR.phase = "skit"`. Stop, the heartbeat and the Live Activity already understand the tour.
- The timeline is driven by the voice lengths: each beat waits for its line to finish, plus a short beat of silence. There are no hand-tuned timestamps to drift.
- Voices play through WebAudio. Each line goes through an AnalyserNode, and its loudness drives the speaker's mouth (true lip flap). With no audio, the mouth flaps on a timer for the length of the line.
- Per-character voice color:
  - Pip: playback rate 1.2, which pitches him up.
  - Nimbus: playback rate 0.93, deeper.
  - Unit Seven: a 400–3000 Hz band-pass plus soft clipping and squelch noise, so he sounds like he's on a radio.
- Characters are inline SVG with CSS spring transitions:
  - Scout: blinking lids and pupils that follow the speaker.
  - Pip: a spinning prop and a loop-the-loop flown along a parametric path.
  - Air Unit Seven: rotor blur and a spotlight cone.
- Bubbles are rounded, iMessage-style, in each character's color, and always inside the strip.
- A full-strip backdrop (dark navy with its own twinkling stars) keeps the skit readable whatever the sky switches are set to. The board and corner fade out underneath, like the show's captions.

**Sound rules.**
- Voices play whenever wall sound is on, at the admin volume; at night they're softer (60%).
- With wall sound off, the skit is bubbles only.
- If the browser hasn't unlocked audio yet, the page asks the Pi for one corner tap (the same unlock path AirPlay uses).

**Admin.** A **Play the skit** button sits under the show buttons, and Stop ends it.

**Safety nets.**
- Missing voice files: the skit still plays with bubbles and fake lip flap, and the heartbeat reports `tour_err`.
- AirPlay starting mid-skit: the skit stops.
- Mapping or the calibration grid turned on: the skit stops.
- A stale command after a reload (more than 2 minutes old) is ignored.

## Later ideas

- More episodes that rotate: "The Day Shift", "Holiday Special", "Turo Day".
- Live data lines rendered on demand: the real nearest plane's callsign, today's temperature (Piper renders a line in under a second on the Pi 5).
- A sheep cameo that hands off to Sleep mode at the end of the night episode.
