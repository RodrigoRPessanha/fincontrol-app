import { CircleHelp } from 'lucide-react';

export function ContextualHelp({ slug, label }: { slug: string; label: string }) {
  return <a href={`/ajuda/${slug}`} target="_blank" rel="noopener noreferrer" title={`${label} (nova aba)`} className="inline-flex min-h-11 items-center gap-2 rounded-lg py-2 text-sm font-medium text-emerald-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 dark:text-emerald-400"><CircleHelp aria-hidden="true" className="h-4 w-4 shrink-0" />{label}<span className="sr-only"> (nova aba)</span></a>;
}
