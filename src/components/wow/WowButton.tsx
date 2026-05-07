import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { MagneticButton } from "./MagneticButton";

type Variant = "primary" | "ghost" | "light";

const STYLES: Record<Variant, string> = {
  primary:
    "wow-bg-indigo wow-text-paper hover:-translate-y-[1px] focus-visible:ring-[hsl(var(--wow-indigo-light))] focus-visible:ring-offset-[hsl(var(--wow-ink))]",
  ghost:
    "border wow-border bg-transparent wow-text-paper hover:wow-bg-elev focus-visible:ring-[hsl(var(--wow-indigo-light))]",
  light:
    "bg-[hsl(var(--wow-indigo-deep))] text-[hsl(var(--wow-paper))] hover:-translate-y-[1px] focus-visible:ring-[hsl(var(--wow-indigo-deep))] focus-visible:ring-offset-2",
};

type Common = {
  variant?: Variant;
  withArrow?: boolean;
  magnetic?: boolean;
  children: ReactNode;
  className?: string;
};

type AsLink = Common & { to: string; href?: never };
type AsAnchor = Common & { href: string; to?: never; target?: string; rel?: string };
type AsButton = Common & ButtonHTMLAttributes<HTMLButtonElement> & { to?: never; href?: never };

type Props = AsLink | AsAnchor | AsButton;

/**
 * WowButton — site-wide CTA primitive in the new visual language.
 * - Three variants: primary (filled indigo), ghost (outlined), light (deep indigo on cream).
 * - Optional MagneticButton wrap.
 * - Optional trailing arrow that translates on hover.
 * - Renders as <Link>, <a>, or <button> depending on props.
 */
export const WowButton = forwardRef<HTMLElement, Props>(function WowButton(props, ref) {
  const {
    variant = "primary",
    withArrow = true,
    magnetic = true,
    children,
    className = "",
    ...rest
  } = props;

  const base =
    "group inline-flex items-center justify-center rounded-md px-8 py-4 text-base font-medium transition-transform duration-200 wow-ease focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2";
  const cls = `${base} ${STYLES[variant]} ${className}`;

  const inner = (
    <>
      {children}
      {withArrow && (
        <ArrowRight className="ml-2 h-4 w-4 transition-transform duration-200 wow-ease group-hover:translate-x-0.5" />
      )}
    </>
  );

  let element: ReactNode;
  if ("to" in rest && rest.to) {
    element = (
      <Link ref={ref as never} to={rest.to} className={cls}>
        {inner}
      </Link>
    );
  } else if ("href" in rest && rest.href) {
    const { href, target, rel } = rest;
    element = (
      <a ref={ref as never} href={href} target={target} rel={rel} className={cls}>
        {inner}
      </a>
    );
  } else {
    const { ...btnRest } = rest as ButtonHTMLAttributes<HTMLButtonElement>;
    element = (
      <button ref={ref as never} className={cls} {...btnRest}>
        {inner}
      </button>
    );
  }

  return magnetic ? <MagneticButton>{element}</MagneticButton> : <>{element}</>;
});
