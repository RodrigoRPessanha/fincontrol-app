import React from 'react';
import { getStatusBadge } from '@/lib/utils';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
  status: string;
  className?: string;
  customLabel?: string;
}

export function StatusBadge({ status, className, customLabel }: StatusBadgeProps) {
  const badgeInfo = getStatusBadge(status);
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border',
        badgeInfo.bg,
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5 opacity-80" />
      {customLabel || badgeInfo.label}
    </span>
  );
}
