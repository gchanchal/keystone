import { useState } from 'react';
import { Info, Building2, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, formatDate } from '@/lib/utils';

interface BankDetailsPopoverProps {
  narration: string;
  date: string;
  amount: number;
  transactionType: 'credit' | 'debit';
  balance?: number | null;
  accountName?: string;
  bankName?: string;
}

export function BankDetailsPopover({
  narration,
  date,
  amount,
  transactionType,
  balance,
  accountName,
  bankName,
}: BankDetailsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  const handleMouseEnter = () => {
    if (!isPinned) {
      setIsOpen(true);
    }
  };

  const handleMouseLeave = () => {
    if (!isPinned) {
      setIsOpen(false);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsPinned(!isPinned);
    } else {
      setIsOpen(true);
      setIsPinned(true);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      setIsPinned(false);
    }
    setIsOpen(open);
  };

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
        >
          <Info className="h-3 w-3 mr-1" />
          Details
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[500px] max-w-[90vw] p-0"
        side="right"
        align="start"
        onMouseEnter={() => !isPinned && setIsOpen(true)}
        onMouseLeave={handleMouseLeave}
      >
        <div className="p-3 border-b bg-muted/50">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">Bank Transaction</span>
            <Badge variant={transactionType === 'credit' ? 'default' : 'destructive'} className="text-xs">
              {transactionType === 'credit' ? 'Credit' : 'Debit'}
            </Badge>
          </div>
          {(accountName || bankName) && (
            <p className="text-xs text-muted-foreground mt-1">
              {accountName}{bankName ? ` (${bankName})` : ''}
            </p>
          )}
        </div>

        <div className="p-3 space-y-3">
          {/* Full Narration */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Narration</p>
            <p className="text-sm break-all whitespace-pre-wrap">{narration}</p>
          </div>

          {/* Date and Amount */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Date</p>
              <p className="text-sm">{formatDate(date)}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Amount</p>
              <p className={`text-sm font-medium ${transactionType === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
                {transactionType === 'credit' ? '+' : '-'}{formatCurrency(amount)}
              </p>
            </div>
          </div>

          {/* Balance */}
          {balance !== null && balance !== undefined && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Balance After</p>
              <p className="text-sm font-medium">{formatCurrency(balance)}</p>
            </div>
          )}
        </div>

        {isPinned && (
          <div className="p-1 border-t text-center">
            <span className="text-[10px] text-muted-foreground">Click outside to close</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
