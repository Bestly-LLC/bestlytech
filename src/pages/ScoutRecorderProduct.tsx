import { Link } from "react-router-dom";
import { AnimatedSection } from "@/components/AnimatedSection";
import { SEOHead } from "@/components/SEOHead";

const steps = [
  { n: "1", title: "Add it to Chrome and sign in", body: "Install Scout Recorder, then sign in to your Bestly account with a passkey (Face ID, Touch ID or a security key). There is no password." },
  { n: "2", title: "Open your meeting and press Start", body: "Join your Google Meet, Zoom or Microsoft Teams call in Chrome. If it is on your Bestly Cloud calendar, Scout Recorder spots it. Press Start, or use the shortcut Alt+Shift+R." },
  { n: "3", title: "Leave the call. Your notes appear.", body: "Scout Recorder saves the audio and the live captions. A short while later the written transcript and notes show up in your Bestly account." },
];

export default function ScoutRecorderProduct() {
  return (
    <>
      <SEOHead
        title="Scout Recorder | Bestly LLC"
        description="Scout Recorder is a Chrome extension that records your Google Meet, Zoom or Teams call and turns it into written notes in your Bestly account. Everyone on the call is told."
        path="/scout-recorder"
      />
      <div className="mx-auto max-w-3xl px-6 py-16 lg:px-8 lg:py-24">
        <AnimatedSection>
          <header className="text-center">
            <img src="/scout-mark.svg" alt="" width={88} height={88} className="mx-auto mb-6 rounded-[22px]" />
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Scout Recorder</h1>
            <p className="mx-auto mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground">
              Scout Recorder is a Chrome extension. It records your online meeting and turns it into written notes, so you can stop typing while people talk.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">Works with Google Meet, Zoom and Microsoft Teams, in Chrome.</p>
          </header>
        </AnimatedSection>

        <AnimatedSection delay={60}>
          <section className="mt-16" aria-labelledby="how">
            <h2 id="how" className="text-2xl font-semibold text-foreground">How it works</h2>
            <ol className="mt-6 space-y-4">
              {steps.map((s) => (
                <li key={s.n} className="flex gap-4 rounded-2xl border border-border p-5">
                  <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-muted text-lg font-semibold text-foreground">{s.n}</span>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">{s.title}</h3>
                    <p className="mt-1 leading-relaxed text-muted-foreground">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </AnimatedSection>

        <AnimatedSection delay={100}>
          <section className="mt-14" aria-labelledby="who">
            <h2 id="who" className="text-2xl font-semibold text-foreground">Who it is for</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Scout Recorder is made for the Bestly team and Bestly partners. It records only the meetings you are invited to. A partner can record only a meeting that is on their own Bestly Cloud calendar, and sees only their own notes. Your notes go to your own Bestly account and nowhere else.
            </p>
          </section>
        </AnimatedSection>

        <AnimatedSection delay={140}>
          <section className="mt-14 rounded-2xl bg-muted p-6" aria-labelledby="told">
            <h2 id="told" className="text-2xl font-semibold text-foreground">Everyone on the call is told</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Before it records a single second, Scout Recorder posts this in the meeting chat: <strong className="text-foreground">"Scout is recording this call for notes."</strong> It also shows a banner on your screen with a Stop button. If it cannot post that message, it does not record.
            </p>
          </section>
        </AnimatedSection>

        <AnimatedSection delay={180}>
          <section className="mt-14" aria-labelledby="priv">
            <h2 id="priv" className="text-2xl font-semibold text-foreground">Your privacy</h2>
            <p className="mt-3 leading-relaxed text-muted-foreground">
              Audio is sent over HTTPS to Bestly's own servers and turned into text on Bestly's own computer. No outside AI company hears it. No ads. We never sell it.{" "}
              <Link to="/scout-recorder/privacy" className="text-foreground underline underline-offset-4">Read the privacy policy</Link>.
            </p>
          </section>
        </AnimatedSection>

        <AnimatedSection delay={220}>
          <section className="mt-16 border-t border-border pt-10" aria-labelledby="more">
            <h2 id="more" className="text-2xl font-semibold text-foreground">More from Bestly</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <Link to="/cloud" className="flex min-h-[44px] flex-col rounded-2xl border border-border p-5 transition hover:bg-muted">
                <span className="text-lg font-semibold text-foreground">Bestly Cloud</span>
                <span className="mt-1 text-muted-foreground">Your own private cloud for files, calendar and mail. The calendar Scout Recorder reads from.</span>
              </Link>
              <Link to="/cookie-yeti" className="flex min-h-[44px] flex-col rounded-2xl border border-border p-5 transition hover:bg-muted">
                <span className="text-lg font-semibold text-foreground">Cookie Yeti</span>
                <span className="mt-1 text-muted-foreground">Closes cookie pop-ups for you and picks the most private choice.</span>
              </Link>
            </div>
          </section>
        </AnimatedSection>
      </div>
    </>
  );
}
