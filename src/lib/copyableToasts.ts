/**
 * Every error or warning pop-up (sonner) gets a Copy button, so Jared can paste the exact
 * message to Claude. Patched once at start-up; call sites that set their own action keep it.
 */
import { toast } from "sonner";
import { copyForClaude } from "@/lib/copyForClaude";

type Opts = Parameters<typeof toast.error>[1];
let installed = false;

export function installCopyableToasts() {
  if (installed) return;
  installed = true;
  for (const kind of ["error", "warning"] as const) {
    const original = toast[kind].bind(toast);
    (toast as any)[kind] = (message: unknown, opts?: Opts) => {
      if (opts?.action) return original(message as any, opts);
      const title = typeof message === "string" ? message : String((message as any)?.toString?.() ?? "Error");
      const desc = typeof opts?.description === "string" ? opts.description : undefined;
      return original(message as any, {
        ...opts,
        action: {
          label: "Copy",
          onClick: async () => {
            const ok = await copyForClaude(title, desc, { Type: kind });
            // A short confirm that doesn't itself get a Copy button.
            if (ok) toast.success("Copied. Paste it to Claude.", { duration: 1800 });
          },
        },
      });
    };
  }
}
