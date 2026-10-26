import { Link } from "react-router-dom";
import { AnimatedSection } from "@/components/AnimatedSection";
import { SEOHead } from "@/components/SEOHead";
import type { ReactNode } from "react";

/**
 * Bestly Studio Terms of Service and Privacy Policy (bestly.tech/studio/terms, bestly.tech/studio/privacy).
 * Written 2026-10-26 for the TikTok developer review. Every sentence here describes what Studio does today
 * (checked against studio-social, social_disconnect and the TikTok posting function). If Studio changes, change this page.
 * A number never wraps away from its unit: use a no-break space.
 */
const UPDATED = "October 26, 2026";
const EMAIL_PRIVACY = "privacy@bestly.tech";
const EMAIL_SUPPORT = "support@bestly.tech";
const PHONE = "+1 816-500-7236";

type Section = { id: string; title: string; body: ReactNode };

const P = ({ children }: { children: ReactNode }) => (
  <p className="mb-4 leading-relaxed text-muted-foreground">{children}</p>
);
const UL = ({ children }: { children: ReactNode }) => (
  <ul className="mb-4 list-disc space-y-2 pl-6 text-muted-foreground">{children}</ul>
);
const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} className="text-foreground underline underline-offset-4">{children}</a>
);

const Company = () => (
  <address className="mb-4 not-italic leading-relaxed text-muted-foreground">
    Bestly LLC<br />
    5850 W 3rd St, Ste E PMB1012<br />
    Los Angeles, CA 90036<br />
    Phone: {PHONE}<br />
    Email: <A href={`mailto:${EMAIL_SUPPORT}`}>{EMAIL_SUPPORT}</A>
  </address>
);

function LegalPage({
  title, intro, sections, other, path, description,
}: {
  title: string; intro: ReactNode; sections: Section[]; other: { to: string; label: string }; path: string; description: string;
}) {
  return (
    <>
      <SEOHead title={`${title} | Bestly Studio`} description={description} path={path} image="/studio/og-studio.jpg" />
      <div className="mx-auto max-w-4xl px-6 py-16 lg:px-8 lg:py-24">
        <AnimatedSection>
          <div className="mb-12">
            <nav className="mb-4">
              <Link to="/studio" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                ← Bestly Studio
              </Link>
            </nav>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">{title}</h1>
            <p className="mt-4 text-muted-foreground">Bestly Studio, by Bestly LLC. Last updated: {UPDATED}</p>
          </div>
        </AnimatedSection>
        <div className="mb-12 rounded-xl border border-border bg-secondary/30 p-6">{intro}</div>
        <div>
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="mb-12">
              <h2 className="mb-4 text-2xl font-semibold text-foreground">{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
        <div className="mt-12 flex flex-col justify-between gap-4 border-t border-border pt-8 sm:flex-row">
          <Link to={other.to} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            {other.label} →
          </Link>
          <Link to="/contact" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            Contact Us →
          </Link>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ Privacy */

const privacy: Section[] = [
  {
    id: "who",
    title: "1. Who we are",
    body: (
      <>
        <P>
          Bestly Studio ("Studio") is a content planning, approval and posting service run by Bestly LLC ("Bestly", "we", "us").
          Businesses that use Studio ("clients") connect their own social media accounts, review each post and its caption on their own
          board, and approve it before it goes out. Bestly also uses Studio for its own brands.
        </P>
        <Company />
        <P>This policy covers Studio only. Bestly's other products are covered by the <A href="/privacy-policy">Bestly Privacy Policy</A>.</P>
      </>
    ),
  },
  {
    id: "collect",
    title: "2. What we collect",
    body: (
      <>
        <P>From a client or the client's staff:</P>
        <UL>
          <li>Name, work email and business name, so we can set up the account and send the board link.</li>
          <li>Brand details you give us, such as colors, tone of voice, things to avoid, and your website address.</li>
          <li>Photos, videos, notes and ideas you send us, and the posts we make from them, including every earlier version of a post.</li>
          <li>Your answers on the board: approved, changes requested, and the notes you write.</li>
        </UL>
        <P>From TikTok, only when you connect your TikTok account:</P>
        <UL>
          <li>Your TikTok open ID and display name (the "user.info.basic" permission). We keep these so Studio can show which account is connected.</li>
          <li>An access token and a refresh token, which let Studio post the videos you approve to that account.</li>
          <li>
            When you open the TikTok posting screen, TikTok tells Studio your nickname, profile picture, the privacy options your account allows,
            which of comments, Duet and Stitch you have turned off, and the longest video your account can post. Studio shows these on the screen
            and does not keep the profile picture.
          </li>
          <li>After you post, the post's status and ID from TikTok, so Studio can show whether it went through.</li>
        </UL>
        <P>
          We do not collect your TikTok password. We do not read your TikTok messages, followers, watch history or anything else on your account.
        </P>
        <P>
          Our website and our hosting providers keep standard technical logs (for example IP address and browser type) for security and reliability.
        </P>
      </>
    ),
  },
  {
    id: "use",
    title: "3. How we use it",
    body: (
      <>
        <UL>
          <li>To make, show and organize your posts, and to put them in front of you for approval.</li>
          <li>
            To post to your TikTok account, and only a video you have approved in Studio, and only after you tap Post on the Studio TikTok posting screen.
            Studio sends nothing to TikTok before that tap.
          </li>
          <li>To keep your TikTok connection working (refreshing the token) and to check whether a post went through.</li>
          <li>To answer your questions and keep Studio secure.</li>
        </UL>
        <P>
          We do not sell your information. We do not use TikTok data for advertising, and we do not use it for anything other than running Studio for you.
          We do not add watermarks, logos or promotional text to your videos.
        </P>
      </>
    ),
  },
  {
    id: "tiktok",
    title: "4. TikTok connection, token storage and posting",
    body: (
      <>
        <UL>
          <li>You connect TikTok yourself, on TikTok's own login page ("Login Kit"). You choose which account, and you can see the permissions TikTok shows you.</li>
          <li>
            Your tokens are stored on our servers in Bestly's database and are used only by Studio's server functions. They are not sent to your browser,
            and they are not visible to other clients or to the public. Our database host encrypts stored data at rest.
          </li>
          <li>Studio uses the permissions you grant for three things: reading your basic profile, uploading a draft to your TikTok, and posting a video you approved.</li>
          <li>
            Each post shows you a preview and asks you to choose who can view it, whether to allow comments, Duet and Stitch, and whether the video promotes your
            own business or a third party. None of these are pre-selected for you. The video is sent to TikTok only when you tap Post.
          </li>
          <li>After you post, TikTok may take a few minutes to process the video before it appears on your profile.</li>
        </UL>
        <P>
          TikTok handles your TikTok account under its own terms and privacy policy. Studio's use of the TikTok API is also governed by TikTok's developer terms.
        </P>
      </>
    ),
  },
  {
    id: "disconnect",
    title: "5. Disconnect TikTok and delete your data",
    body: (
      <>
        <P>You can stop Studio's access to your TikTok at any time, in either of these ways:</P>
        <UL>
          <li>In Studio: open your board, go to Settings, then Your accounts, and tap Disconnect next to TikTok. Studio deletes the stored tokens and open ID right away and holds any TikTok posts that were waiting.</li>
          <li>In TikTok: open Settings and privacy, then Security and permissions, then Apps and services, and remove Bestly Studio.</li>
        </UL>
        <P>
          To have the rest of your data deleted (your account details, posts, uploads and the TikTok display name we kept), email{" "}
          <A href={`mailto:${EMAIL_PRIVACY}?subject=Delete%20my%20Studio%20data`}>{EMAIL_PRIVACY}</A> with the subject "Delete my Studio data" and your business name.
          We delete it within 30{" "}days and reply to confirm. TikTok-specific instructions are also on our{" "}
          <A href="/data-deletion.html#tiktok">data deletion page</A>.
        </P>
        <P>We may keep a record that we owe or are owed money, and anything the law requires us to keep.</P>
      </>
    ),
  },
  {
    id: "share",
    title: "6. Who we share it with",
    body: (
      <>
        <P>We share information only as needed to run Studio:</P>
        <UL>
          <li>Hosting and database providers that run our systems (currently Supabase and Vercel).</li>
          <li>The platforms you connect. A video and its caption go to TikTok, Instagram or another network only when you approve and post to it.</li>
          <li>Software and AI tools we use to draft, design and edit posts. A person at Bestly checks every post.</li>
          <li>Anyone the law requires us to tell, such as in response to a valid legal request.</li>
        </UL>
        <P>If Bestly is ever sold or merged, your information would move with Studio and this policy would continue to apply to it.</P>
      </>
    ),
  },
  {
    id: "keep",
    title: "7. How long we keep it",
    body: (
      <P>
        We keep your account and posts while you use Studio. TikTok tokens are deleted when you disconnect. After you leave, or when you ask, we delete your data
        within 30{" "}days, except what we must keep by law.
      </P>
    ),
  },
  {
    id: "rights",
    title: "8. Your choices and rights",
    body: (
      <P>
        You can ask to see, correct or delete the information we hold about you by emailing <A href={`mailto:${EMAIL_PRIVACY}`}>{EMAIL_PRIVACY}</A>.
        If you live in California, you have the rights described in the <A href="/privacy-policy">Bestly Privacy Policy</A>, including the right to know, delete and correct.
        We do not sell or share personal information for cross-context advertising.
      </P>
    ),
  },
  {
    id: "kids",
    title: "9. Children",
    body: <P>Studio is for businesses and the adults who run them. It is not for anyone under 18, and we do not knowingly collect information from children.</P>,
  },
  {
    id: "changes",
    title: "10. Changes and contact",
    body: (
      <>
        <P>If we change this policy we will update the date above, and tell clients by email if the change is important.</P>
        <P>Questions: <A href={`mailto:${EMAIL_PRIVACY}`}>{EMAIL_PRIVACY}</A>, or write or call:</P>
        <Company />
      </>
    ),
  },
];

export function StudioPrivacy() {
  return (
    <LegalPage
      title="Privacy Policy"
      path="/studio/privacy"
      description="How Bestly Studio handles your information, including what it reads from TikTok, how tokens are stored, and how to disconnect and delete your data."
      other={{ to: "/studio/terms", label: "View the Terms of Service" }}
      intro={
        <p className="mb-0 leading-relaxed text-muted-foreground">
          <strong className="text-foreground">In short:</strong> Studio helps a business plan, approve and post its social videos. You connect your own TikTok account.
          Studio reads your basic profile, and posts a video only after you approve it and tap Post. You can disconnect any time, and we delete what we hold when you ask.
        </p>
      }
      sections={privacy}
    />
  );
}

/* -------------------------------------------------------------------- Terms */

const terms: Section[] = [
  {
    id: "agree",
    title: "1. Agreement",
    body: (
      <>
        <P>
          These terms are between you and Bestly LLC ("Bestly", "we", "us") and cover Bestly Studio ("Studio"), at studio.bestly.tech and bestly.tech/studio.
          By using Studio, or by approving a post on your board, you agree to them. If you use Studio for a business, you confirm you can bind that business.
        </P>
        <Company />
        <P>Bestly's other products are covered by the <A href="/terms-of-service">Bestly Terms of Service</A>. Where these terms differ for Studio, these terms apply.</P>
      </>
    ),
  },
  {
    id: "what",
    title: "2. What Studio does",
    body: (
      <P>
        Studio is a content planning, approval and posting service for businesses. Bestly makes or organizes posts (pictures, swipe posts and short videos), a person at Bestly checks each one,
        and you review it on your own board and approve it or ask for changes. Approved posts can be posted to the social accounts you connect, from one calendar.
        Studio is not a social network and does not sell advertising.
      </P>
    ),
  },
  {
    id: "accounts",
    title: "3. Your accounts and who can use them",
    body: (
      <UL>
        <li>You must be at least 18 and authorized to act for your business.</li>
        <li>You connect only social accounts you own or are allowed to manage. You can disconnect them at any time (see the <A href="/studio/privacy#disconnect">Privacy Policy</A>).</li>
        <li>Keep your board link and sign-in private. Tell us right away if you think someone else has it.</li>
      </UL>
    ),
  },
  {
    id: "tiktok",
    title: "4. TikTok and other platforms",
    body: (
      <>
        <UL>
          <li>When you connect TikTok, you also agree to TikTok's terms. TikTok can limit or remove posts and accounts under its own rules, and we do not control that.</li>
          <li>
            Studio posts to your TikTok only a video you have approved, and only after you tap Post on the Studio TikTok posting screen. Before that tap you choose who can view it,
            whether to allow comments, Duet and Stitch, and whether it promotes your own business or a third party. By posting you agree to TikTok's Music Usage Confirmation and, for branded content, TikTok's Branded Content Policy.
          </li>
          <li>Studio does not add watermarks, logos or promotional text to your videos.</li>
          <li>While TikTok has Bestly Studio in testing, TikTok may limit who can connect and who can see what is posted. We will tell you if that applies to you.</li>
        </UL>
      </>
    ),
  },
  {
    id: "content",
    title: "5. Your content and what you promise",
    body: (
      <>
        <P>
          You keep ownership of the photos, videos, words and brand material you give us and of the posts made for you. You give Bestly permission to store, edit, preview and post that material
          for you, and nothing else.
        </P>
        <P>You promise that you have the rights to what you send us and to what you approve, that it is honest, and that it follows the law and the rules of each platform. You are responsible for what you approve and post. Do not use Studio to post anything unlawful, deceptive, hateful, or that infringes someone else's rights.</P>
        <P>If a post promotes a product or business, you are responsible for using the right disclosure on TikTok and any other platform. Studio gives you the controls; you choose them.</P>
      </>
    ),
  },
  {
    id: "ai",
    title: "6. How posts are made",
    body: (
      <P>
        We use software, including AI tools, to draft, design and edit. A person at Bestly checks every post before it reaches you, and nothing is posted to your accounts until you approve it.
        Where a platform asks for a label on AI-made content, we apply it.
      </P>
    ),
  },
  {
    id: "fees",
    title: "7. Fees",
    body: <P>Studio plans and prices are shown to you before you pay, and are agreed with you in writing or at checkout. If you pay for Studio, you can cancel; cancellation takes effect at the end of the period you paid for unless we agreed otherwise in writing.</P>,
  },
  {
    id: "stop",
    title: "8. Ending use",
    body: (
      <P>
        You can stop using Studio, disconnect any account, or ask us to delete your data at any time. We can pause or end access if these terms are broken or if a platform requires it.
        What happens to your data is described in the <A href="/studio/privacy">Privacy Policy</A>.
      </P>
    ),
  },
  {
    id: "liability",
    title: "9. Limits",
    body: (
      <>
        <P>
          Studio is provided as is. Social platforms change their rules and systems without notice, and we cannot promise a post will be accepted, shown, or reach anyone.
          We do not promise any particular result, such as followers, views or sales.
        </P>
        <P>To the extent the law allows, Bestly is not liable for indirect or consequential losses, and our total liability for any claim is limited to what you paid us for Studio in the 12{" "}months before the claim. Nothing here limits liability that the law does not allow us to limit.</P>
      </>
    ),
  },
  {
    id: "law",
    title: "10. Law, changes and contact",
    body: (
      <>
        <P>These terms are governed by the laws of the State of California, and disputes will be heard in the courts located in Los Angeles County, California.</P>
        <P>If we change these terms, we will update the date above and tell clients by email if the change is important. Questions: <A href={`mailto:${EMAIL_SUPPORT}`}>{EMAIL_SUPPORT}</A>, or write or call:</P>
        <Company />
      </>
    ),
  },
];

export function StudioTerms() {
  return (
    <LegalPage
      title="Terms of Service"
      path="/studio/terms"
      description="The terms for using Bestly Studio: what it does, your accounts, TikTok posting, your content, and how to stop."
      other={{ to: "/studio/privacy", label: "View the Privacy Policy" }}
      intro={
        <p className="mb-0 leading-relaxed text-muted-foreground">
          <strong className="text-foreground">In short:</strong> Studio helps your business plan, approve and post social videos and pictures. You connect your own accounts, you approve every post,
          and you can disconnect any time. You are responsible for what you approve.
        </p>
      }
      sections={terms}
    />
  );
}
