/**
 * Bestly Studio use cases (/studio/for/:slug). Copy follows docs/studio-promo/claims.md: no prices, no results,
 * no client names, no mocked screens, a person checks every post. Real estate is photo-based only: never videos,
 * tours or walkthroughs. A number never wraps from its unit: use a no-break space ( ).
 */
export interface StudioUseCase {
  slug: string;
  chip: string;
  /** One line for the card on /studio. */
  line: string;
  title: string;
  audience: string;
  h1: string;
  sub: string;
  icon: string;
  whatWeMake: { title: string; body: string }[];
  steps: { title: string; body: string }[];
  ideas: string[];
  faqs: { q: string; a: string }[];
  seoTitle: string;
  seoDescription: string;
}

export const STUDIO_USE_CASES: StudioUseCase[] = [
  {
    slug: "coaches",
    line: "You film short clips from our scripts. We edit them into posts.",
    chip: "Coaches",
    title: "Coaches, therapists and consultants",
    audience: "coaches, therapists, trainers and consultants",
    h1: "You help people for a living. We handle the posting.",
    sub: "We write and design your social posts, and cut short videos from clips you film on your phone. A person at Bestly checks each one, you approve it on your phone, and we post it.",
    icon: "Briefcase",
    whatWeMake: [
      { title: "Short videos from your clips", body: "Film yourself answering one question. We add captions, music and a cover image, and cut it into a short vertical video." },
      { title: "Swipe posts that teach one thing", body: "A few slides that explain one idea, one habit or one common mistake, in your words." },
      { title: "Scripts to film", body: "Not sure what to say on camera? We write a short script. You read it or say it your own way." },
      { title: "A plan for the month", body: "A calendar of what goes out and when, so you are not deciding each morning what to post." },
    ],
    steps: [
      { title: "Tell us how you talk", body: "On a short video call, tell us who you help and how you explain things. Send us a few clips or notes." },
      { title: "We draft, a person checks", body: "We write the posts and cut the videos. A person at Bestly reads every one before it reaches you." },
      { title: "Approve on your phone", body: "Open your board, read each post, tap Approve or tap Changes. After you approve, we post it." },
    ],
    ideas: [
      "One question your clients ask all the time, answered in a short video",
      "A swipe post: three signs it is time to ask for help",
      "A short script for a first-session explainer, to film in your office",
      "A myth about your field and what is actually true",
      "A note for the week of a holiday that is hard on some people",
    ],
    faqs: [
      { q: "Do I have to be on camera?", a: "No. Swipe posts and image posts need no filming. Short videos are optional, and we write the script if you want one." },
      { q: "Can you keep client details out?", a: "We never need client names or stories. We write general posts about what you do and how you think, and you see every post before it goes out." },
      { q: "What if it does not sound like me?", a: "Tap Changes and say what to fix, the way you would say it out loud. We redo it." },
    ],
    seoTitle: "Social media posts for coaches, therapists and consultants | Bestly Studio",
    seoDescription: "Bestly Studio writes and designs social posts and short videos for coaches, therapists, trainers and consultants. A person checks every post, you approve on your phone, we post.",
  },
  {
    slug: "real-estate",
    line: "Send listing photos and notes. Get swipe posts and image posts.",
    chip: "Real estate",
    title: "Real estate agents",
    audience: "real estate agents",
    h1: "Send listing photos. Get posts back.",
    sub: "Send us your listing photos and a few notes. We turn them into swipe posts and image posts. A person at Bestly checks each one, you approve it on your phone, and we post it.",
    icon: "Home",
    whatWeMake: [
      { title: "Swipe posts for a listing", body: "Your best photos in order, with the key details on the slides: where it is, what it has, how to reach you." },
      { title: "Image posts", body: "One clean picture with a short caption, for a new listing, a price change or an open house." },
      { title: "Posts about you", body: "Introduce yourself, the neighborhoods you work in, or a tip for buyers or sellers." },
      { title: "A plan for the month", body: "A calendar around the dates that matter in your market, so you stay visible between closings." },
    ],
    steps: [
      { title: "Email us photos and notes", body: "Send the listing photos and what you want said to studio@bestly.tech. Or book a call and we plan it with you." },
      { title: "We design, a person checks", body: "We build the swipe posts and image posts. A person at Bestly checks every one before it reaches you." },
      { title: "Approve on your phone", body: "Look at each post the way it will appear, then tap Approve or Changes. After you approve, we post it." },
    ],
    ideas: [
      "Just listed: a swipe post with your best photos and the address",
      "Open house this weekend: one image post with the time and place",
      "Three things to check before you list your home",
      "A neighborhood you know well, in a few photos and a caption",
      "Just sold: a simple post to mark a closing",
      "A short intro post so new followers know who you are",
    ],
    faqs: [
      { q: "Do you make listing videos or tours?", a: "No. For real estate we work from your photos and notes, and we make swipe posts and image posts." },
      { q: "Whose photos do you use?", a: "Yours, or the ones your photographer gives you. You send them, and you only send what you have the right to share." },
      { q: "Can I check the wording on a listing?", a: "Yes. You see every post before it goes out and can tap Changes to fix a price, a detail or a word." },
    ],
    seoTitle: "Social media posts for real estate agents, made from your listing photos | Bestly Studio",
    seoDescription: "Send Bestly Studio your listing photos and notes. We make swipe posts and image posts, a person checks each one, you approve on your phone, and we post.",
  },
  {
    slug: "products",
    line: "Turn your product photos into posts and short videos.",
    chip: "Product shops",
    title: "Product shops",
    audience: "people who make or sell products",
    h1: "You make the product. We make the posts about it.",
    sub: "Send us photos of what you sell. We turn them into image posts, swipe posts and short videos. A person at Bestly checks each one, you approve on your phone, and we post it.",
    icon: "Package",
    whatWeMake: [
      { title: "Image posts for each product", body: "A clear picture, a short caption, and what it is for." },
      { title: "Swipe posts", body: "Front, back, close-up, size, and how it is used, one slide at a time." },
      { title: "Short videos from your clips", body: "Film packing an order or using the product. We add captions, music and a cover image." },
      { title: "A plan around the calendar", body: "Posts planned around holidays and gift seasons your customers shop for." },
    ],
    steps: [
      { title: "Send photos and a few facts", body: "Email product photos with the name and what makes it different. Or book a call and we sort it out together." },
      { title: "We make the posts", body: "We design the posts and cut the videos. A person at Bestly checks every one before it reaches you." },
      { title: "Approve on your phone", body: "See each post the way it will look, tap Approve or Changes. After you approve, we post it." },
    ],
    ideas: [
      "A new product, shown from four angles in one swipe post",
      "How it is made, from clips you film at your bench",
      "A gift idea post for a holiday your customers shop for",
      "One product, three ways to use it",
      "A post answering the question you get most in your messages",
      "Packing an order, as a short video",
    ],
    faqs: [
      { q: "Do I need nice photos?", a: "Clear photos from your phone are a good start. Tell us what you want shown and we design around what you send." },
      { q: "Do you sell my products for me?", a: "No. We make and post your social content. Your shop stays yours." },
      { q: "What if I launch something new?", a: "Send us the photos and the details. We add it to the plan and you approve it before it goes out." },
    ],
    seoTitle: "Social media posts for product shops and makers | Bestly Studio",
    seoDescription: "Bestly Studio turns your product photos into image posts, swipe posts and short videos. A person checks every post, you approve on your phone, and we post.",
  },
  {
    slug: "apps",
    line: "Posts and short videos that explain what your app does.",
    chip: "App makers",
    title: "App and software makers",
    audience: "people who build apps and software",
    h1: "You build the app. We explain it to the world.",
    sub: "Send us screenshots and a few notes about what your app does. We make the posts and short videos that explain it. A person at Bestly checks each one, you approve on your phone, and we post it.",
    icon: "Smartphone",
    whatWeMake: [
      { title: "Swipe posts that explain the app", body: "One problem, then how the app solves it, one screen at a time, in plain words." },
      { title: "Short videos from screen recordings", body: "Record your screen for a few seconds. We add captions, music and a cover image." },
      { title: "Update posts", body: "A clear note on what changed in the new version and why you would care." },
      { title: "A plan around launches", body: "A calendar built around your release dates and the days that matter to your users." },
    ],
    steps: [
      { title: "Send screenshots and notes", body: "Email your screenshots and what the app does, in whatever words you have. We rewrite them for people who have never heard of it." },
      { title: "We make the posts", body: "We design the posts and cut the videos. A person at Bestly checks every one before it reaches you." },
      { title: "Approve on your phone", body: "Read each post the way it will appear, tap Approve or Changes. After you approve, we post it." },
    ],
    ideas: [
      "What the app does, in one sentence and one screen",
      "A swipe post walking through the first thing a new user does",
      "A short screen recording of one feature, with captions",
      "What is new in the latest version",
      "The problem that made you build it, told simply",
    ],
    faqs: [
      { q: "My app is technical. Can you explain it simply?", a: "That is the point. We write for someone who has never heard of your app, and you check every post for accuracy before it goes out." },
      { q: "Do you handle the App Store page?", a: "No. We make your social posts and short videos." },
      { q: "Do I have to film anything?", a: "No. Screenshots and swipe posts need no filming. A short screen recording is optional." },
    ],
    seoTitle: "Social media posts for app and software makers | Bestly Studio",
    seoDescription: "Bestly Studio turns your screenshots and notes into posts and short videos that explain your app. A person checks every post, you approve on your phone, and we post.",
  },
  {
    slug: "local",
    line: "Photos from your day become posts for your shop or trade.",
    chip: "Local business",
    title: "Local businesses",
    audience: "local shops, restaurants, studios and trades",
    h1: "Run the shop. We will keep the feed going.",
    sub: "Send us photos from your day and a few notes. We turn them into posts and short videos. A person at Bestly checks each one, you approve on your phone, and we post it.",
    icon: "Store",
    whatWeMake: [
      { title: "Image posts from your photos", body: "The dish, the finished job, the new display, with a short caption that says what it is." },
      { title: "Swipe posts", body: "Your menu, your services or a before-and-after, one slide at a time." },
      { title: "Short videos from clips you film", body: "A short clip from your phone becomes a short vertical video with captions, music and a cover image." },
      { title: "A plan around your week", body: "Posts planned around holidays, seasons and local dates your customers care about." },
    ],
    steps: [
      { title: "Send what you have", body: "Email photos from the shop with a few notes, like new hours or a special. Or book a call." },
      { title: "We make the posts", body: "We design the posts and cut the videos. A person at Bestly checks every one before it reaches you." },
      { title: "Approve on your phone", body: "Between customers, open your board, tap Approve or Changes. After you approve, we post it." },
    ],
    ideas: [
      "Today's special, as one clean image post",
      "A before-and-after of a finished job, in a swipe post",
      "New hours for the holiday week",
      "Meet the person behind the counter",
      "A short video of how something is made or fixed",
      "A thank-you post to the neighborhood",
    ],
    faqs: [
      { q: "I only have my phone. Is that enough?", a: "Yes. Photos and short clips from your phone are what we work with." },
      { q: "Can you post about a special that ends soon?", a: "Tell us the dates when you send it. You approve each post before it goes out, so you control what is said." },
      { q: "Will it sound like my shop?", a: "Tap Changes and tell us how you would say it. We fix it." },
    ],
    seoTitle: "Social media posts for local shops, restaurants and trades | Bestly Studio",
    seoDescription: "Bestly Studio makes social posts and short videos for local businesses from your photos and notes. A person checks every post, you approve on your phone, and we post.",
  },
  {
    slug: "creators",
    line: "Recut videos you already have and design posts from your ideas.",
    chip: "Creators",
    title: "Creators and personal brands",
    audience: "creators and personal brands",
    h1: "You make the content. We make more of it.",
    sub: "Send us videos and ideas you already have. We recut them into short vertical videos and design posts around them. A person at Bestly checks each one, you approve on your phone, and we post it.",
    icon: "Camera",
    whatWeMake: [
      { title: "Recuts of videos you already have", body: "A long video becomes short vertical clips with captions, music and a cover image." },
      { title: "Swipe posts from your best ideas", body: "Your newsletter, thread or talk, turned into slides." },
      { title: "Scripts for the next video", body: "Send a rough idea. We write a script you can film." },
      { title: "A plan around the calendar", body: "A schedule built around the dates and seasons your audience cares about." },
    ],
    steps: [
      { title: "Send what you already made", body: "Email links, clips and ideas. Or book a call and tell us where you want to go." },
      { title: "We recut and design", body: "We turn it into posts and short videos. A person at Bestly checks every one before it reaches you." },
      { title: "Approve on your phone", body: "Check each post the way it will appear, tap Approve or Changes. After you approve, we post it." },
    ],
    ideas: [
      "The best moment of a long video, as a short vertical clip",
      "Your latest post or article, turned into a swipe post",
      "A script for a video that answers a viewer question",
      "A cover image style that makes your videos look like a set",
      "Behind the scenes of how you make your work",
    ],
    faqs: [
      { q: "Do you replace me?", a: "No. The ideas and the voice stay yours. We do the cutting, captions, design and posting." },
      { q: "Can you use my old videos?", a: "Yes. Send us videos you own and we recut them into shorter ones." },
      { q: "Do I approve everything?", a: "Yes. Nothing is posted until you tap Approve." },
    ],
    seoTitle: "Social media help for creators and personal brands | Bestly Studio",
    seoDescription: "Bestly Studio recuts your videos into short clips and designs posts from your ideas. A person checks every post, you approve on your phone, and we post.",
  },
  {
    slug: "nonprofits",
    line: "Event posts and stories that show the work you do.",
    chip: "Nonprofits",
    title: "Nonprofits and community groups",
    audience: "nonprofits, clubs and community groups",
    h1: "You do the good work. We help people see it.",
    sub: "Send us photos, news and dates. We make the posts and short videos that share them. A person at Bestly checks each one, you approve on your phone, and we post it.",
    icon: "HeartHandshake",
    whatWeMake: [
      { title: "Event posts", body: "Date, time, place and how to join, on one clear image post or a few slides." },
      { title: "Swipe posts about your work", body: "What you do, who you help and how someone can pitch in, in plain words." },
      { title: "Short videos from clips you film", body: "Film a volunteer or a meeting. We add captions, music and a cover image." },
      { title: "A plan around the year", body: "A calendar around your events, drives and the dates your community marks." },
    ],
    steps: [
      { title: "Send your news and photos", body: "Email photos, dates and a few lines about what is happening. Or book a call." },
      { title: "We make the posts", body: "We design the posts and cut the videos. A person at Bestly checks every one before it reaches you." },
      { title: "Approve on your phone", body: "Read each post on your phone, then tap Approve or Changes. After you approve, we post it." },
    ],
    ideas: [
      "Volunteers needed: one image post with the date and how to sign up",
      "Meet a volunteer, in a short video you film on your phone",
      "A swipe post explaining what your group does",
      "A thank-you post after an event",
      "An upcoming meeting, with time and place",
    ],
    faqs: [
      { q: "We are all volunteers. Who approves?", a: "Whoever you pick on your side looks at the posts and taps Approve. Nothing is posted before that." },
      { q: "Can you post about our events?", a: "Yes. Send the details and we make the post. You check the date and place before it goes out." },
      { q: "Do you use photos of people?", a: "Only photos you send us. Please send only photos of people who are fine with being shared." },
    ],
    seoTitle: "Social media posts for nonprofits and community groups | Bestly Studio",
    seoDescription: "Bestly Studio makes social posts and short videos for nonprofits and community groups. A person checks every post, you approve on your phone, and we post.",
  },
];

export const getStudioUseCase = (slug?: string) => STUDIO_USE_CASES.find((u) => u.slug === slug);
