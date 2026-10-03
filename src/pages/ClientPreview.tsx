/**
 * /preview/:slug — renders a studio website preview for a logged-in client.
 *
 * If the visitor has a valid Supabase session (i.e. they are signed into the
 * partner portal) the preview HTML is fetched from studio_preview_docs and
 * rendered directly in a full-screen iframe — no password, no extra gate.
 *
 * Anyone not signed in is redirected to /partner so they can sign in with
 * their passkey, and are sent back here automatically afterwards.
 */
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { BrandLoader } from "@/components/BrandLoader";

export default function ClientPreview() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // 1. Must be signed in.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        // Redirect to partner sign-in; return here after.
        navigate(`/partner?return=/preview/${slug}`, { replace: true });
        return;
      }

      // 2. Fetch the preview HTML.
      const { data, error: err } = await supabase
        .from("studio_preview_docs")
        .select("html, title")
        .eq("slug", slug ?? "")
        .maybeSingle();

      if (err) { setError("Could not load the preview."); return; }
      if (!data) { setError("Preview not found."); return; }
      setHtml(data.html);
    })();
  }, [slug, navigate]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center text-center p-8">
        <div>
          <p className="text-lg font-medium text-red-500">{error}</p>
          <a href="/partner" className="mt-4 inline-block text-sm text-blue-500 underline">Back to portal</a>
        </div>
      </div>
    );
  }

  if (!html) {
    return (
      <div className="flex h-screen items-center justify-center">
        <BrandLoader />
      </div>
    );
  }

  // Render the preview HTML in a sandboxed full-screen iframe.
  const blob = new Blob([html], { type: "text/html" });
  const src = URL.createObjectURL(blob);

  return (
    <iframe
      src={src}
      className="fixed inset-0 w-full h-full border-0"
      title="Website preview"
      sandbox="allow-scripts allow-same-origin"
    />
  );
}
