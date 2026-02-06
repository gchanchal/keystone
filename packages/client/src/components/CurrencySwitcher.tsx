import { DollarSign, IndianRupee } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCurrency } from '@/contexts/CurrencyContext';

export function CurrencySwitcher() {
  const { currency, setCurrency, exchangeRate } = useCurrency();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          {currency === 'INR' ? (
            <IndianRupee className="h-4 w-4" />
          ) : (
            <DollarSign className="h-4 w-4" />
          )}
          {currency}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => setCurrency('INR')}
          className={currency === 'INR' ? 'bg-accent' : ''}
        >
          <IndianRupee className="mr-2 h-4 w-4" />
          INR (₹)
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setCurrency('USD')}
          className={currency === 'USD' ? 'bg-accent' : ''}
        >
          <DollarSign className="mr-2 h-4 w-4" />
          USD ($)
        </DropdownMenuItem>
        <div className="px-2 py-1.5 text-xs text-muted-foreground border-t mt-1 pt-1">
          Rate: $1 = ₹{exchangeRate.toFixed(2)}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
