import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Loader2, CheckCircle2 } from "lucide-react";

interface WaitlistFormProps {
  productId: string;
  productName: string;
  className?: string;
  buttonText?: string;
  successMessage?: string;
}

export function WaitlistForm({
  productId,
  productName,
  className,
  buttonText = "Get Notified",
  successMessage = "You're on the list! We'll notify you when we launch.",
}: WaitlistFormProps) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim()) return;
    
    setIsSubmitting(true);

    try {
      // First check if email already exists
      const { data: existing } = await supabase
        .from("waitlist_subscribers")
        .select("id, products")
        .eq("email", email.toLowerCase().trim())
        .maybeSingle();

      if (existing) {
        // Update existing subscriber with new product interest
        const currentProducts = existing.products || [];
        if (!currentProducts.includes(productId)) {
          await supabase
            .from("waitlist_subscribers")
            .update({
              products: [...currentProducts, productId],
            })
            .eq("id", existing.id);
        }
      } else {
        // Insert new subscriber
        const { error } = await supabase
          .from("waitlist_subscribers")
          .insert({
            email: email.toLowerCase().trim(),
            products: [productId],
            source: window.location.pathname,
          });

        if (error) throw error;
      }

      setIsSuccess(true);
      setEmail("");
      toast({
        title: "You're on the list!",
        description: `We'll notify you when ${productName} launches.`,
      });
    } catch (error: any) {
      console.error("Waitlist error:", error);
      toast({
        title: "Something went wrong",
        description: "Please try again later.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isSuccess) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 text-primary">
          <CheckCircle2 className="h-5 w-5" />
          <span className="font-medium">{successMessage}</span>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={className}>
      <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
        <div className="relative flex-1">
          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="pl-10"
            disabled={isSubmitting}
          />
        </div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Joining...
            </>
          ) : (
            buttonText
          )}
        </Button>
      </div>
    </form>
  );
}
