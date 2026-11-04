import { AnimatedSection } from "@/components/AnimatedSection";
import { SEOHead } from "@/components/SEOHead";

const mail = (a: string) => <a href={`mailto:${a}`} className="text-foreground underline underline-offset-4">{a}</a>;
const li = "text-muted-foreground leading-relaxed";
const strong = "text-foreground";

export default function ScoutRecorderPrivacy() {
  const effectiveDate = "November 4, 2026";

  const sections = [
    { id: "collected", title: "1. What Scout Recorder collects", content: (
      <>
        <p className="mb-4 text-muted-foreground leading-relaxed">Scout Recorder is a Chrome extension that records an online meeting and turns it into written notes. It collects only this, and only when you press Start on a meeting:</p>
        <ul className="list-disc space-y-2 pl-6">
          <li className={li}><strong className={strong}>Meeting audio.</strong> The sound of the meeting tab and your microphone, recorded while you are in the call.</li>
          <li className={li}><strong className={strong}>Live caption text.</strong> The captions the meeting shows, with the speaker names the meeting shows next to each line.</li>
          <li className={li}><strong className={strong}>Meeting title and time.</strong> Read from your own Bestly Cloud calendar, to name the recording and to check the meeting is one you were invited to.</li>
          <li className={li}><strong className={strong}>The meeting link.</strong> The address of the Google Meet, Zoom or Microsoft Teams call you are recording.</li>
          <li className={li}><strong className={strong}>An account key.</strong> A sign-in key made when you connect the extension to your Bestly account. It is kept in the extension's storage on your device.</li>
        </ul>
        <p className="mt-4 text-muted-foreground leading-relaxed">Scout Recorder does not read your browsing history, other tabs, passwords, forms or anything on a website other than the meeting page you start it on.</p>
      </>
    )},
    { id: "use", title: "2. How we use it", content: (
      <p className="text-muted-foreground leading-relaxed">We use it for one thing: to make notes and a written transcript of your meeting. They are saved to your own signed-in Bestly account, and only to that account. We do not use it for advertising, to build a profile of you, or to train any AI.</p>
    )},
    { id: "handled", title: "3. How it is handled and stored", content: (
      <ul className="list-disc space-y-2 pl-6">
        <li className={li}>Everything is sent over HTTPS (encrypted) to Bestly's servers.</li>
        <li className={li}>Audio is stored in a private storage bucket that is not open to the public.</li>
        <li className={li}>Audio is turned into text on Bestly's own computer. No third-party AI service receives it.</li>
        <li className={li}>No ads. No trackers. We do not sell your data.</li>
        <li className={li}>While a call is being recorded, audio waits in your browser's storage on your device until it has been uploaded, so a crash does not lose it.</li>
      </ul>
    )},
    { id: "sharing", title: "4. Who we share it with", content: (
      <p className="text-muted-foreground leading-relaxed">No one outside Bestly. We do not sell, rent or trade it. A Bestly partner sees only the meetings he or she is invited to. We may disclose data if the law requires it. Our hosting provider (Supabase) stores the data for us under a contract that limits it to that purpose.</p>
    )},
    { id: "retention", title: "5. How long we keep it, and how to delete it", content: (
      <p className="text-muted-foreground leading-relaxed">We keep recordings, transcripts and notes until you ask us to delete them. To delete one meeting, or everything tied to you, email {mail("privacy@bestly.tech")} from the address on your Bestly account. We delete it within 30 days. Removing the extension deletes what it stores on your device, and you can disconnect it at any time.</p>
    )},
    { id: "notice", title: "6. The recording notice, and your duty to get consent", content: (
      <>
        <p className="mb-4 text-muted-foreground leading-relaxed">Before it records, Scout Recorder posts "Scout is recording this call for notes" in the meeting chat and shows a banner with a Stop button. If it cannot post that message, it does not record.</p>
        <p className="text-muted-foreground leading-relaxed">You are responsible for following the recording and consent laws that apply to your call. Some places require everyone on a call to agree. The chat message is a notice, not a legal guarantee. If anyone objects, press Stop.</p>
      </>
    )},
    { id: "limited-use", title: "7. Chrome Web Store Limited Use statement", content: (
      <p className="text-muted-foreground leading-relaxed">The use of information received from Google APIs and Chrome will adhere to the <a href="https://developer.chrome.com/docs/webstore/program-policies/limited-use" className="text-foreground underline underline-offset-4" target="_blank" rel="noopener noreferrer">Chrome Web Store User Data Policy</a>, including the Limited Use requirements. Scout Recorder's use of information received from the browser adheres to that policy. We use it only to provide the notes feature described here. We do not transfer it to others except as needed to provide that feature or to obey the law. We do not use or transfer it for advertising. No person at Bestly reads your recordings except with your permission, to keep the service working, for security, or to obey the law.</p>
    )},
    { id: "changes", title: "8. Changes", content: (
      <p className="text-muted-foreground leading-relaxed">If we change this policy we will post the new version here and update the date above.</p>
    )},
    { id: "contact", title: "9. Contact", content: (
      <div className="rounded-lg bg-secondary/30 p-4 text-muted-foreground">
        <p><strong className={strong}>Bestly LLC</strong></p>
        <p>5850 W 3rd St, Ste E PMB1012</p>
        <p>Los Angeles, CA 90036</p>
        <p>Email: {mail("privacy@bestly.tech")}</p>
        <p>Support: <a href="https://www.bestly.tech/contact" className="text-foreground underline underline-offset-4">bestly.tech/contact</a></p>
      </div>
    )},
  ];

  return (
    <>
      <SEOHead
        title="Scout Recorder Privacy Policy | Bestly LLC"
        description="What Scout Recorder collects (meeting audio, captions, meeting title and time, the meeting link, an account key), how it is used and stored, who sees it, and how to delete it."
        path="/scout-recorder/privacy"
      />
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        <AnimatedSection>
          <header className="mb-12">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">Privacy Policy: Scout Recorder by Bestly LLC</h1>
            <p className="mt-6 text-sm text-muted-foreground">Effective date: {effectiveDate}</p>
            <p className="mt-6 text-muted-foreground leading-relaxed">
              Bestly LLC ("Bestly," "we," "us") makes Scout Recorder. This page says what it collects, why, where it goes and how to have it deleted. The short version: it records meetings you choose, makes notes for your own Bestly account, and shares them with no one else.
            </p>
          </header>
        </AnimatedSection>
        {sections.map((s, i) => (
          <AnimatedSection key={s.id} delay={Math.min(i * 40, 240)}>
            <section id={s.id} className="mb-12">
              <h2 className="mb-4 text-2xl font-semibold text-foreground">{s.title}</h2>
              {s.content}
            </section>
          </AnimatedSection>
        ))}
      </div>
    </>
  );
}
