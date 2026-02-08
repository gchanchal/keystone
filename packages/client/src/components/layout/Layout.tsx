import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { cn } from '@/lib/utils';

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    const stored = localStorage.getItem('keystone-sidebar-collapsed');
    return stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem('keystone-sidebar-collapsed', String(collapsed));
  }, [collapsed]);

  return (
    <div className="flex h-screen">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
      />
      <div className={cn(
        "flex flex-1 flex-col overflow-hidden transition-all duration-200",
        collapsed ? "lg:ml-16" : "lg:ml-0"
      )}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
