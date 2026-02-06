import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Wallet,
  Car,
  ArrowLeftRight,
  GitCompare,
  Upload,
  TrendingUp,
  HandCoins,
  FileBarChart,
  Settings,
  X,
  ChevronDown,
  ChevronRight,
  CreditCard,
  KeyRound,
  LineChart,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ServerStatus } from './ServerStatus';

// Personal section items
const personalItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/performance', icon: LineChart, label: 'Performance' },
  { to: '/investments', icon: TrendingUp, label: 'Investments' },
  { to: '/loans', icon: HandCoins, label: 'Expenses & Income' },
  { to: '/credit-cards', icon: CreditCard, label: 'Credit Cards' },
  { to: '/transactions', icon: ArrowLeftRight, label: 'Transactions' },
  { to: '/accounts', icon: Building2, label: 'Accounts' },
];

// GearUp Mods section items
const gearupItems = [
  { to: '/gearup', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/reconciliation', icon: GitCompare, label: 'Reconciliation' },
  { to: '/reports', icon: FileBarChart, label: 'Reports' },
];

// Standalone items
const standaloneItems = [
  { to: '/uploads', icon: Upload, label: 'Upload Center' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const location = useLocation();

  // Determine which section is active based on current path
  const isPersonalPath = ['/', '/accounts', '/transactions', '/credit-cards', '/investments', '/performance', '/loans'].some(
    path => path === '/' ? location.pathname === '/' : location.pathname.startsWith(path)
  );
  const isGearupPath = ['/gearup', '/reconciliation', '/reports'].some(
    path => location.pathname.startsWith(path)
  );

  // Expand state - default expand based on current path
  const [personalExpanded, setPersonalExpanded] = useState(true);
  const [gearupExpanded, setGearupExpanded] = useState(isGearupPath);

  const renderNavItem = (item: { to: string; icon: any; label: string }) => (
    <NavLink
      key={item.to}
      to={item.to}
      onClick={onClose}
      end={item.to === '/' || item.to === '/gearup'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
        )
      }
    >
      <item.icon className="h-4 w-4" />
      {item.label}
    </NavLink>
  );

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r bg-card transition-transform duration-200 lg:static lg:translate-x-0',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md">
              <KeyRound className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold bg-gradient-to-r from-amber-600 to-orange-600 bg-clip-text text-transparent">KeyStone</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex flex-1 flex-col justify-between overflow-y-auto">
          <nav className="space-y-2 p-4">
            {/* Personal Section */}
            <div className="space-y-1">
              <button
                onClick={() => setPersonalExpanded(!personalExpanded)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isPersonalPath
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
                    : 'text-foreground hover:bg-accent'
                )}
              >
                <div className="flex items-center gap-3">
                  <Wallet className="h-5 w-5" />
                  Personal
                </div>
                {personalExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {personalExpanded && (
                <div className="ml-4 space-y-1 border-l pl-3">
                  {personalItems.map(renderNavItem)}
                </div>
              )}
            </div>

            {/* GearUp Mods Section */}
            <div className="space-y-1">
              <button
                onClick={() => setGearupExpanded(!gearupExpanded)}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                  isGearupPath
                    ? 'bg-orange-50 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300'
                    : 'text-foreground hover:bg-accent'
                )}
              >
                <div className="flex items-center gap-3">
                  <Car className="h-5 w-5" />
                  GearUp Mods
                </div>
                {gearupExpanded ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
              </button>
              {gearupExpanded && (
                <div className="ml-4 space-y-1 border-l pl-3">
                  {gearupItems.map(renderNavItem)}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="my-2 border-t" />

            {/* Standalone items */}
            {standaloneItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                  )
                }
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Server Status */}
          <div className="border-t p-4">
            <ServerStatus />
          </div>
        </div>
      </aside>
    </>
  );
}
