import { AnimatedHeading } from '@/components/motion/animated-heading';

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  /** Page-level actions, aligned to the right on wide screens. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <AnimatedHeading text={title} className="text-xl font-semibold tracking-tight" />
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}
