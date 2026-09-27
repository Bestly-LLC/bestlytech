import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Inside a section tab (SectionTabs): drop the title block, keep the actions as a compact row. */
  embedded?: boolean;
}

export function PageHeader({ title, description, actions, embedded }: PageHeaderProps) {
  if (embedded) {
    return actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null;
  }
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4">
      <div className="min-w-0">
        {title && <h1 className="text-[2rem] sm:text-3xl font-bold text-white leading-[1.1] tracking-[-0.015em] bento:tracking-[-0.025em] sm:bento:text-[2.75rem]">
          {title}
        </h1>}
        {description && (
          <p className={`text-[0.9375rem] sm:text-sm text-white/60 ${title ? "mt-1.5" : ""}`}>{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}
