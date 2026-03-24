import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, XCircle, Loader2, MailX } from "lucide-react";

type State = "loading" | "valid" | "already_unsubscribed" | "invalid" | "success" | "error";

const EmailUnsubscribe = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const [state, setState] = useState<State>("loading");
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    if (!token) {
      setState("invalid");
      return;
    }
    const validate = async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const res = await fetch(
          `${supabaseUrl}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: anonKey } }
        );
        const data = await res.json();
        if (data.valid === false && data.reason === "already_unsubscribed") {
          setState("already_unsubscribed");
        } else if (data.valid) {
          setState("valid");
        } else {
          setState("invalid");
        }
      } catch {
        setState("invalid");
      }
    };
    validate();
  }, [token]);

  const handleUnsubscribe = async () => {
    if (!token) return;
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("handle-email-unsubscribe", {
        body: { token },
      });
      if (error) throw error;
      if (data?.success) {
        setState("success");
      } else if (data?.reason === "already_unsubscribed") {
        setState("already_unsubscribed");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardContent className="pt-8 pb-8 text-center space-y-4">
          {state === "loading" && (
            <>
              <Loader2 className="h-10 w-10 animate-spin text-muted-foreground mx-auto" />
              <p className="text-muted-foreground">Validating your request...</p>
            </>
          )}
          {state === "valid" && (
            <>
              <MailX className="h-12 w-12 text-primary mx-auto" />
              <h1 className="text-xl font-bold text-foreground">Unsubscribe from emails</h1>
              <p className="text-muted-foreground text-sm">
                Are you sure you want to stop receiving emails from Cookie Yeti? You'll no longer get order confirmations, subscription updates, or account notifications.
              </p>
              <Button onClick={handleUnsubscribe} disabled={processing} className="w-full">
                {processing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Confirm Unsubscribe
              </Button>
            </>
          )}
          {state === "success" && (
            <>
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto" />
              <h1 className="text-xl font-bold text-foreground">You've been unsubscribed</h1>
              <p className="text-muted-foreground text-sm">
                You won't receive any more emails from Cookie Yeti. If you change your mind, you can re-subscribe at any time.
              </p>
            </>
          )}
          {state === "already_unsubscribed" && (
            <>
              <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto" />
              <h1 className="text-xl font-bold text-foreground">Already unsubscribed</h1>
              <p className="text-muted-foreground text-sm">
                You've already unsubscribed from Cookie Yeti emails. No further action is needed.
              </p>
            </>
          )}
          {state === "invalid" && (
            <>
              <XCircle className="h-12 w-12 text-destructive mx-auto" />
              <h1 className="text-xl font-bold text-foreground">Invalid link</h1>
              <p className="text-muted-foreground text-sm">
                This unsubscribe link is invalid or has expired. If you need help, contact support@bestly.tech.
              </p>
            </>
          )}
          {state === "error" && (
            <>
              <XCircle className="h-12 w-12 text-destructive mx-auto" />
              <h1 className="text-xl font-bold text-foreground">Something went wrong</h1>
              <p className="text-muted-foreground text-sm">
                We couldn't process your request. Please try again or contact support@bestly.tech.
              </p>
              <Button onClick={handleUnsubscribe} variant="outline" className="w-full">
                Try Again
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default EmailUnsubscribe;
