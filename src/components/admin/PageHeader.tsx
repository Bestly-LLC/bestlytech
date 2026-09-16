import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 sm:gap-4">
      <div>
        {title && <h1 className="font-display text-2xl sm:text-3xl font-normal text-white leading-[1.05] tracking-[-0.01em]">
          {title}
        </h1>}
        {description && (
          <p className={`text-sm text-white/55 ${title ? "mt-2" : ""}`}>{description}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}
