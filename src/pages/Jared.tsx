import { useEffect } from "react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { CalendarDays, ChevronRight, Mail, MessageCircle, Phone, PhoneCall, UserPlus } from "lucide-react";
import jaredHeadshot from "@/assets/jared-headshot.png";
import cookieYetiIcon from "@/assets/cookieyeti-icon.png";
import inventoryproofIcon from "@/assets/inventoryproof-icon.png";
import { SEOHead } from "@/components/SEOHead";
import { Lines } from "@/components/Lines";
import "./jared.css";

/** Tap/scan landing page: NFC card and the QR on the paper card both point here. */

const makes = [
  {
    name: "Bestly Agent",
    line: "AI that answers your business phone and does the work.",
    to: "/agent",
    icon: <PhoneCall className="h-5 w-5" aria-hidden="true" />,
  },
  {
    name: "InventoryProof",
    line: "A home inventory app that lists everything you own, ready for insurance.",
    to: "/inventory-proof",
    image: inventoryproofIcon,
  },
  {
    name: "Cookie Yeti",
    line: "Handles cookie pop-ups for you, so you stop clicking them.",
    to: "/cookie-yeti",
    image: cookieYetiIcon,
  },
];

export default function Jared() {
  // Overscroll and the iOS status bar should be ink, not the site's light default.
  useEffect(() => {
    const root = document.documentElement;
    const prev = root.style.backgroundColor;
    root.style.backgroundColor = "#0a0a0a";
    return () => {
      root.style.backgroundColor = prev;
    };
  }, []);

  return (
    <div className="jc-page" onTouchStart={() => {}}>
      <SEOHead
        title="Jared Best — Founder of Bestly"
        description="Save Jared Best's contact: call, text or email the founder of Bestly, a privacy-first product studio in Los Angeles."
        path="/jared"
      />
      <Helmet>
        <meta name="theme-color" content="#0a0a0a" data-rh="true" />
      </Helmet>

      <div className="jc-dots" aria-hidden="true" />
      <div className="jc-glow" aria-hidden="true" />

      <main className="jc-wrap">
        <section className="jc-card" aria-label="Jared Best">
          <img
            className="jc-photo"
            src={jaredHeadshot}
            alt="Jared Best"
            width={112}
            height={112}
            {...{ fetchpriority: "high" }}
          />
          <h1 className="jc-name">Jared Best</h1>
          <p className="jc-role">Founder &amp; Builder · Bestly</p>

          <a className="jc-btn jc-btn--primary" href="/jared.vcf">
            <UserPlus className="h-5 w-5" aria-hidden="true" />
            Save contact
          </a>

          <a className="jc-btn jc-btn--book" href="/book" target="_blank" rel="noopener">
            <CalendarDays className="h-5 w-5" aria-hidden="true" />
            Book a call
          </a>

          <div className="jc-row">
            <a className="jc-btn jc-btn--sm" href="tel:+18165007236">
              <Phone className="h-[18px] w-[18px]" aria-hidden="true" />
              Call
            </a>
            <a className="jc-btn jc-btn--sm" href="sms:+18165007236">
              <MessageCircle className="h-[18px] w-[18px]" aria-hidden="true" />
              Text
            </a>
            <a className="jc-btn jc-btn--sm" href="mailto:jared@bestly.tech">
              <Mail className="h-[18px] w-[18px]" aria-hidden="true" />
              Email
            </a>
          </div>

          <p className="jc-maya">
            <Lines>Questions anytime? Call Maya, our AI assistant.</Lines>{" "}
            <a className="jc-tel" href="tel:+12136410074">
              (213) 641-0074
            </a>
          </p>
        </section>

        <section className="jc-makes" aria-labelledby="jc-makes-h">
          <h2 id="jc-makes-h" className="jc-eyebrow">
            What Bestly makes
          </h2>
          <ul className="jc-list">
            {makes.map((m) => (
              <li key={m.name}>
                <Link className="jc-item" to={m.to}>
                  <span className="jc-ico">
                    {m.image ? <img src={m.image} alt="" width={40} height={40} /> : m.icon}
                  </span>
                  <span className="jc-copy">
                    <span className="jc-iname">{m.name}</span>
                    <span className="jc-idesc">
                      <Lines>{m.line}</Lines>
                    </span>
                  </span>
                  <ChevronRight className="jc-chev" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <footer className="jc-foot">
          Private by design · <a href="/">bestly.tech</a>
        </footer>
      </main>
    </div>
  );
}
