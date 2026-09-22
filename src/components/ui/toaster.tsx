import { useToast } from "@/hooks/use-toast";
import { Toast, ToastAction, ToastClose, ToastDescription, ToastProvider, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { copyForClaude } from "@/lib/copyForClaude";

export function Toaster() {
  const { toasts } = useToast();

  return (
    <ToastProvider>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action ?? (props.variant === "destructive" && (
              <ToastAction
                altText="Copy this error"
                onClick={(e) => { e.preventDefault(); copyForClaude(String(title ?? "Error"), typeof description === "string" ? description : null, { Type: "error" }); }}
              >
                Copy
              </ToastAction>
            ))}
            <ToastClose />
          </Toast>
        );
      })}
      <ToastViewport />
    </ToastProvider>
  );
}
