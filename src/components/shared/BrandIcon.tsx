import Image from 'next/image';

/** The adjacent FinControl label provides the accessible name. */
export function BrandIcon({ className = 'h-10 w-10' }: { className?: string }) {
  return <Image src="/brand/fincontrol-logo.webp" alt="" aria-hidden="true" width={512} height={512} className={`shrink-0 object-contain ${className}`} />;
}
