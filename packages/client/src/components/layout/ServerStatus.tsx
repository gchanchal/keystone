import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';

export function ServerStatus() {
  const [isConnected, setIsConnected] = useState(true);
  const [lastPing, setLastPing] = useState<Date | null>(null);

  useEffect(() => {
    const checkServer = async () => {
      try {
        const response = await fetch('/api/accounts', {
          method: 'HEAD',
          signal: AbortSignal.timeout(5000)
        });
        setIsConnected(response.ok);
        setLastPing(new Date());
      } catch {
        setIsConnected(false);
      }
    };

    // Initial check
    checkServer();

    // Check every 15 seconds
    const interval = setInterval(checkServer, 15000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div
        className={cn(
          'h-2 w-2 rounded-full',
          isConnected
            ? 'bg-green-500 shadow-[0_0_4px_rgba(34,197,94,0.5)]'
            : 'bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.5)] animate-pulse'
        )}
      />
      <span className="opacity-60">
        {isConnected ? 'Server' : 'Offline'}
      </span>
    </div>
  );
}
