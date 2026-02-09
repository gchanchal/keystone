import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, Package, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { transactionsApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';

interface VyaparItemDetail {
  id: string;
  itemName: string;
  itemCode?: string;
  category?: string;
  quantity?: number;
  unit?: string;
  unitPrice?: number;
  discount?: number;
  tax?: number;
  amount: number;
}

interface ItemDetailsPopoverProps {
  invoiceNumber: string | null;
  transactionType: string;
  partyName?: string;
  date: string;
}

export function ItemDetailsPopover({
  invoiceNumber,
  transactionType,
  partyName,
  date,
}: ItemDetailsPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['vyapar-items', invoiceNumber, date],
    queryFn: () =>
      transactionsApi.getVyaparItems({
        invoiceNumber: invoiceNumber || undefined,
        // If no invoice number, try to match by date (less reliable)
        startDate: !invoiceNumber ? date : undefined,
        endDate: !invoiceNumber ? date : undefined,
        limit: '50',
      }),
    enabled: isOpen && (!!invoiceNumber || !!date),
  });

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
        className="w-80 p-0"
        side="left"
        align="start"
        onMouseEnter={() => !isPinned && setIsOpen(true)}
        onMouseLeave={handleMouseLeave}
      >
        <div className="p-3 border-b bg-muted/50">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium text-sm">{transactionType}</span>
            {invoiceNumber && (
              <span className="text-xs text-muted-foreground">#{invoiceNumber}</span>
            )}
          </div>
          {partyName && (
            <p className="text-xs text-muted-foreground mt-1">{partyName}</p>
          )}
        </div>

        <div className="max-h-64 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Loading items...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No item details found
            </div>
          ) : (
            <div className="divide-y">
              {items.map((item: VyaparItemDetail) => (
                <div key={item.id} className="p-2 hover:bg-muted/30">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.itemName}</p>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {item.quantity && item.quantity > 1 && (
                          <span>Qty: {item.quantity}{item.unit ? ` ${item.unit}` : ''}</span>
                        )}
                        {item.unitPrice && (
                          <span>@ {formatCurrency(item.unitPrice)}</span>
                        )}
                      </div>
                      {item.category && (
                        <span className="inline-block mt-1 px-1.5 py-0.5 text-[10px] bg-muted rounded">
                          {item.category}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-medium whitespace-nowrap">
                      {formatCurrency(item.amount)}
                    </span>
                  </div>
                  {(item.discount || item.tax) && (
                    <div className="flex gap-3 mt-1 text-[10px] text-muted-foreground">
                      {item.discount ? <span>Disc: -{formatCurrency(item.discount)}</span> : null}
                      {item.tax ? <span>Tax: +{formatCurrency(item.tax)}</span> : null}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {items.length > 0 && (
          <div className="p-2 border-t bg-muted/30 flex justify-between items-center">
            <span className="text-xs text-muted-foreground">{items.length} item(s)</span>
            <span className="text-sm font-medium">
              Total: {formatCurrency(items.reduce((sum: number, item: VyaparItemDetail) => sum + item.amount, 0))}
            </span>
          </div>
        )}

        {isPinned && (
          <div className="p-1 border-t text-center">
            <span className="text-[10px] text-muted-foreground">Click outside to close</span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
