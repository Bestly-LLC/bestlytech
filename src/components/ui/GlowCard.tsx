import * as React from "react";
import { cn } from "@/lib/utils";

interface GlowCardProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
  glowOnHover?: boolean;
  gradientBorder?: boolean;
}

const GlowCard = React.forwardRef<HTMLDivElement, GlowCardProps>(
  ({ className, children, glowOnHover = true, gradientBorder = true, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "group relative rounded-2xl border border-border bg-card p-6 shadow-sm transition-all duration-500",
          glowOnHover && "hover:shadow-premium hover:-translate-y-1",
          gradientBorder && "gradient-border",
          className
        )}
        {...props}
      >
        {/* Glow effect on hover */}
        {glowOnHover && (
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-[hsl(var(--gradient-start)/0.05)] to-[hsl(var(--gradient-end)/0.05)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        )}
        <div className="relative z-10">{children}</div>
      </div>
    );
  }
);

GlowCard.displayName = "GlowCard";

export { GlowCard };
