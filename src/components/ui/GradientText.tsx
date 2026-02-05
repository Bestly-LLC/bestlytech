import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface GradientTextProps {
  children: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3" | "h4" | "p" | "span";
}

export function GradientText({ 
  children, 
  className, 
  as: Component = "span" 
}: GradientTextProps) {
  return (
    <Component 
      className={cn(
        "bg-clip-text text-transparent bg-gradient-to-r from-[hsl(var(--gradient-start))] to-[hsl(var(--gradient-end))]",
        className
      )}
    >
      {children}
    </Component>
  );
}
