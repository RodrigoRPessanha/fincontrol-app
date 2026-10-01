import React from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';
import { MobileNav } from '@/components/layout/MobileNav';
import { GlobalErrorBanner } from '@/components/shared/GlobalErrorBanner';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-slate-50 dark:bg-slate-950 overflow-x-hidden">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col pb-20 lg:pb-8 min-w-0 max-w-full overflow-x-hidden">
        <Header />
        <main className="flex-1 px-4 py-6 sm:px-8 max-w-7xl w-full mx-auto min-w-0">
          <GlobalErrorBanner />
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav />
    </div>
  );
}
