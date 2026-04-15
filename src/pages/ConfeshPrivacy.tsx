import { useEffect } from "react";
import { AnimatedSection } from "@/components/AnimatedSection";

export default function ConfeshPrivacy() {
  useEffect(() => {
    document.title = "Confesh Privacy Policy | Bestly LLC";
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", "Privacy policy for Confesh: Unscripted by Bestly LLC.");
    }
  }, []);

  const sections = [
    {
      title: "Information We Collect",
      content: (
        <>
          <p className="text-muted-foreground leading-relaxed mb-4">
            <strong className="text-foreground">Account information:</strong> When you sign in with Apple,
            we receive a unique identifier and optionally your name and email address via Apple private relay.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-4">
            <strong className="text-foreground">Trip data:</strong> Trips and sessions are stored on-device
            and synced via your personal iCloud CloudKit account. We do not have access to your confessionals.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-4">
            <strong className="text-foreground">Video recordings:</strong> Confessional videos are uploaded to
            secure Amazon S3 storage. Videos are accessible only to your trip members via time-limited presigned
            URLs. We do not use video content to train AI models.
          </p>
          <p className="text-muted-foreground leading-relaxed mb-4">
            <strong className="text-foreground">Transcripts:</strong> Audio is transcribed on-device using
            Apple Speech Recognition. Transcript text (not audio) is processed by Anthropic Claude API to
            generate nightly questions and episode summaries.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Invite codes:</strong> Processed through our secure API
            solely to connect trip participants.
          </p>
        </>
      ),
    },
    {
      title: "How We Use Information",
      content: (
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li>To operate the App and generate AI-produced content for your trip</li>
          <li>To sync your trip data across your devices via iCloud</li>
          <li>To send optional local notifications (e.g., "The confessional room is open")</li>
          <li>We do not sell personal information</li>
          <li>We do not use personal information for advertising</li>
        </ul>
      ),
    },
    {
      title: "Data Retention",
      content: (
        <p className="text-muted-foreground leading-relaxed">
          Trip data and videos are retained until you delete the trip. You may delete all data at any
          time from Settings inside the App.
        </p>
      ),
    },
    {
      title: "Third-Party Services",
      content: (
        <ul className="list-disc pl-6 space-y-2 text-muted-foreground">
          <li><strong className="text-foreground">Apple iCloud / CloudKit</strong> — trip metadata sync</li>
          <li><strong className="text-foreground">Amazon Web Services (S3)</strong> — video storage</li>
          <li><strong className="text-foreground">Anthropic</strong> — AI transcript processing (no training use)</li>
        </ul>
      ),
    },
    {
      title: "Children's Privacy",
      content: (
        <p className="text-muted-foreground leading-relaxed">
          Confesh is not directed to children under 17. We do not knowingly collect data from children under 17.
        </p>
      ),
    },
    {
      title: "Contact",
      content: (
        <p className="text-muted-foreground leading-relaxed">
          Bestly LLC<br />
          Email:{" "}
          <a href="mailto:privacy@bestly.tech" className="text-foreground hover:underline">
            privacy@bestly.tech
          </a>
          <br />
          Website:{" "}
          <a href="https://bestly.tech" className="text-foreground hover:underline">
            https://bestly.tech
          </a>
        </p>
      ),
    },
  ];

  return (
    <>
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        <AnimatedSection>
          <header className="mb-12">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              Privacy Policy — Confesh: Unscripted
            </h1>
            <div className="mt-6 text-sm text-muted-foreground space-y-1">
              <p>Effective Date: April 23, 2026</p>
              <p>Last Updated: April 23, 2026</p>
            </div>
          </header>
        </AnimatedSection>

        <div className="prose prose-neutral max-w-none">
          <AnimatedSection delay={80}>
            <p className="text-muted-foreground leading-relaxed mb-12">
              Bestly LLC ("we," "us," or "our") built Confesh: Unscripted as a commercial iOS application.
              This page explains what information we collect and how we use it.
            </p>
          </AnimatedSection>

          {sections.map((section, index) => (
            <AnimatedSection key={section.title} delay={Math.min((index + 2) * 60, 300)}>
              <section className="mb-12">
                <h2 className="text-2xl font-semibold text-foreground mb-4">{section.title}</h2>
                {section.content}
              </section>
            </AnimatedSection>
          ))}
        </div>
      </div>
    </>
  );
}
