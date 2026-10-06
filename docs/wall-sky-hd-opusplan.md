# Sky HD + Turo card tightening (Oct 5, 2026)

Jared, 7:37 PM, with a photo of the ceiling: "Sky looks super low quality still. Fix this. Make an opusplan to fix, along with tightening up the Turo card with the Apple design skill again. It's still a little sloppy."

## What the photo and a frame grab show

A frame taken straight from the stream the projector plays (`/wall.mp4`, 1920x1080) is sharp. So the encoder and the network are not the problem. The loss happens before encoding, in how the sky is drawn:

1. **The roads are hairlines, squeezed.** Roads and traffic are drawn on canvases inside `#airIn`. That layer is about 3600 logical px wide and gets bent onto the ceiling by a CSS 3D transform. Near the wall the layer is shrunk 2 to 4 times, with no mipmaps. A 2 px line ends up thinner than a pixel and breaks into dashes, which is the dotted streets in the photo.
2. **The ceiling is out of the projector's focus plane.** The focus is set for the wall strip, so anything drawn on the ceiling picks up a few pixels of optical blur. Sub-pixel lines turn to mush; lines 3 px or wider survive.
3. **The sky text is small.** The names under the white dots and the "Home" label end up about 8 to 10 px tall on screen.

## Plan

### Phase 1: draw the lines in screen space (biggest win)
- Move the roads and traffic onto two full-screen canvases (`#airScrR`, `#airScrT`) at device resolution (2x on the Mac).
- Send every vertex through the sky's exact projection: inner coordinates, then the rotation `th`, then `homo(AW, AH, q)`, then the screen. The map stays exactly where it is now; only the drawing changes.
- Line widths become fixed screen pixels, sized for a blurry ceiling:

  | Line | Width |
  |---|---|
  | Freeways | 3.0 to 3.4 px |
  | Arterials | 2.2 px |
  | Secondary | 1.8 px |
  | Local | 1.5 px |
  | Traffic | 4.2 px freeway, 2.8 px arterial |

- The canvases copy `#air`'s opacity every 100 ms, so sky fades still match. They hide in mapping, skit and sheep modes, same as before.
- The canvases sit under `#air` (z 3), so planes and labels stay on top. The old in-layer canvases are hidden.

### Phase 2: sky text that reads on a blurry ceiling
- Raise the sky labels' size and weight, in the HIG spirit of large, bold, high-contrast type.
- Check from a photo.

### Phase 3: optical
- If it is still soft, Jared can set the projector's focus to a point between the strip and the ceiling. That's one press in the Nebula focus menu, and the only step that needs him.

## Turo card tightening (Apple design pass)
- **Week wraps:** a trip that runs past Saturday continues with square ends, the way Apple Calendar shows multi-day events across rows. Today it breaks into two rounded pills.
- **Names:** the guest's name goes on the longest piece of the trip, so a trip starting on a Saturday still shows its name.
- **Spacing:** the weekday row sits closer to the dates (4 px), with more room above the key (10 px). Weekday letters are 13 px semibold with no tracking, like Apple's.

## Done when
- A new frame grab shows solid, continuous roads, with no dashes.
- The calendar renders with continuous trips across week rows.
- The stream holds 58 to 60 fps.
- Jared's next photo looks crisp. If it doesn't, Phase 3.
