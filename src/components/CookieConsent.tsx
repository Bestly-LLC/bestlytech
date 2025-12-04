import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export function CookieConsent() {
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem("bestly-cookie-consent");
    if (!consent) {
      setShowBanner(true);
    }
  }, []);

  const acceptCookies = () => {
    localStorage.setItem("bestly-cookie-consent", "accepted");
    setShowBanner(false);
  };

  const declineCookies = () => {
    localStorage.setItem("bestly-cookie-consent", "declined");
    setShowBanner(false);
  };

  if (!showBanner) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background p-4 shadow-lg md:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex-1">
            <p className="text-sm text-muted-foreground leading-relaxed">
              We use essential cookies to ensure our website functions properly. We do not use tracking or advertising cookies. 
              By continuing to use this site, you consent to our use of essential cookies. 
              Learn more in our{" "}
              <Link to="/privacy-policy" className="text-foreground underline underline-offset-4 hover:text-primary">
                Privacy Policy
              </Link>
              .
            </p>
          </div>
          <div className="flex gap-3 shrink-0">
            <Button variant="outline" size="sm" onClick={declineCookies}>
              Decline
            </Button>
            <Button size="sm" onClick={acceptCookies}>
              Accept
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
