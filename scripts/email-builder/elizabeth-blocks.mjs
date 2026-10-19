// Jared's letter to Elizabeth (Centering YOU), the first email built in the Email Builder, as blocks.
// The real board link carries her access token, so it is passed in (seed-elizabeth.mjs reads it from the letter file);
// tests and the offline preview use the placeholder below.
export const PLACEHOLDER_BOARD_LINK = "https://studio.bestly.tech/centering-you?c=EXAMPLE";
export const CALL_LINK = "https://cloud.bestly.tech/call/fyqvdsa4";

export function elizabethDoc(boardLink = PLACEHOLDER_BOARD_LINK) {
  return {
    subject: "Two new things on your board",
    preheader: "Our call is now on your board, and you can send us videos to comment on.",
    blocks: [
      { id: "e1", type: "eyebrow", text: "A note from Jared" },
      { id: "e2", type: "headline", text: "Two new things on your board." },
      { id: "e3", type: "paragraph", text: "Hi Elizabeth," },
      { id: "e4", type: "paragraph", text: "A quick update before our call tomorrow. There are two new things on your board." },
      { id: "e5", type: "subheading", text: "1. Our call is now right on your board" },
      { id: "e6", type: "paragraph", text: "Open your board and tap **Join**. The call opens in a small window, so you can still see your posts while we talk. If it asks to use your camera and microphone, tap **Allow**." },
      { id: "e7", type: "button", label: "Open my board", url: boardLink, style: "solid" },
      { id: "e8", type: "paragraph", text: "If the call doesn't open for any reason, no stress. Use our usual link, the same one as always:" },
      { id: "e9", type: "button", label: "Join our usual call", url: CALL_LINK, style: "outline" },
      { id: "e10", type: "subheading", text: "2. Send us a video to comment on" },
      { id: "e11", type: "paragraph", text: "See a video you'd like to comment on? On your board, tap **Comment on a video**, paste the link and tell us what you want to say. We'll polish your words and send them back. Then one tap copies your comment and opens the video. Just paste and post." },
      { id: "e12", type: "button", label: "Try it on my board", url: boardLink, style: "solid" },
      { id: "e13", type: "paragraph", text: "See you tomorrow," },
      { id: "e14", type: "signature" },
    ],
  };
}
