// Homepage hero rotation — approved by Jared 2026-10-12 8:52 PM.
// Each scene: the small "moment" line, the big "An AI that…" line, and its background image.
// Rotates every 6 s. Copy rule: written for someone who has never heard of us.

export type HeroScene = {
  id: number;
  group: "service" | "sales" | "assistant";
  moment: string;
  line: string;
  image: string; // /hero-scenes/NN.webp
};

const img = (n: number) => `/hero-scenes/${String(n).padStart(2, "0")}.webp`;

export const HERO_SCENES: HeroScene[] = [
  // Customer service
  { id: 1, group: "service", moment: "“Are you open on Thanksgiving?”", line: "An AI that shares your holiday hours, then offers a table for Friday." },
  { id: 2, group: "service", moment: "“I forgot my password.” · 3:07 AM", line: "An AI that walks a locked-out customer back into their account while your team sleeps." },
  { id: 3, group: "service", moment: "“My toilet is overflowing.” · 2:14 AM", line: "An AI that dispatches the on-call plumber, texts the ETA and logs the job." },
  { id: 4, group: "service", moment: "“Do you have anything Tuesday?”", line: "An AI that checks the dentist’s calendar and locks in the 10:30 AM cleaning." },
  { id: 5, group: "service", moment: "“Where’s my order?”", line: "An AI that tracks down the package and sends a live delivery link." },
  { id: 6, group: "service", moment: "“I was charged twice.”", line: "An AI that spots the duplicate, issues the refund and apologizes like a pro." },
  { id: 7, group: "service", moment: "“Do you take my insurance?”", line: "An AI that verifies coverage before the patient hangs up." },
  { id: 8, group: "service", moment: "“My AC died. It’s 98 °F in here.”", line: "An AI that flags the emergency, pages the nearest tech and alerts the crew." },
  { id: 9, group: "service", moment: "“Can I move my haircut to Friday?”", line: "An AI that reschedules the visit and fills the gap from your waitlist." },
  { id: 10, group: "service", moment: "“Is my car ready yet?”", line: "An AI that reads your shop software and gives an honest pickup time." },
  { id: 11, group: "service", moment: "“My dog ate a sock.”", line: "An AI that asks the right questions and rushes urgent cases to your vet." },
  { id: 12, group: "service", moment: "“Can I pay my bill over the phone?”", line: "An AI that takes the payment securely and emails the receipt." },
  { id: 13, group: "service", moment: "“What’s the Wi-Fi password?” · 11:40 PM", line: "An AI that greets late-night guests with the Wi-Fi, door code and checkout time." },
  { id: 14, group: "service", moment: "“Do you have this in a size 10?”", line: "An AI that searches your stock and holds the pair at the counter." },
  { id: 15, group: "service", moment: "“Table for 6 at 7:30?”", line: "An AI that seats the party, notes the birthday and confirms by text." },
  { id: 16, group: "service", moment: "“Hola, ¿tienen citas hoy?”", line: "An AI that switches to Spanish and secures the visit without missing a beat." },
  { id: 17, group: "service", moment: "“I want to speak to a manager.”", line: "An AI that calms the caller, writes you a clean summary and transfers the call." },
  // Sales and leads
  { id: 18, group: "sales", moment: "47 new leads came in overnight.", line: "An AI that rings every one before breakfast and slots the hot ones onto your calendar." },
  { id: 19, group: "sales", moment: "Quote form filled out · 9:52 PM", line: "An AI that phones them back in 60 seconds, while they still care." },
  { id: 20, group: "sales", moment: "“They never answered our proposal.”", line: "An AI that follows up politely until you get a yes or a no." },
  { id: 21, group: "sales", moment: "“Who should we be selling to?”", line: "An AI that finds prospects, ranks them and starts the conversation." },
  { id: 22, group: "sales", moment: "“Is this lead worth my time?”", line: "An AI that qualifies the buyer, scores the deal and updates your CRM." },
  { id: 23, group: "sales", moment: "Last year’s customers went quiet.", line: "An AI that wins them back with a friendly check-in call." },
  { id: 24, group: "sales", moment: "Demo tomorrow at 2 PM.", line: "An AI that reminds the prospect, confirms they’re coming and cuts no-shows." },
  // Personal assistant
  { id: 25, group: "assistant", moment: "“Can you move my 3 PM?”", line: "An AI that reshuffles your day and lets everyone involved know." },
  { id: 26, group: "assistant", moment: "Unknown number. Again.", line: "An AI that screens the call, blocks the spam and puts real people through." },
  { id: 27, group: "assistant", moment: "“What did I miss today?”", line: "An AI that delivers a two-minute recap of every call, text and promise." },
  { id: 28, group: "assistant", moment: "“Remind me to renew the business license.”", line: "An AI that tracks your deadlines and nudges you a week early." },
  { id: 29, group: "assistant", moment: "“Get me a dinner reservation Saturday.”", line: "An AI that calls the restaurant for you and drops the confirmation in your texts." },
  { id: 30, group: "assistant", moment: "“I’m stuck in traffic.”", line: "An AI that tells your 4 PM you’re running 15 minutes late." },
].map((s) => ({ ...s, image: img(s.id) })) as HeroScene[];
