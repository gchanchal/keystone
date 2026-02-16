import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { MessageSquare, Send, Trash2, X, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { businessAccountingApi } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import type { BusinessTransaction } from '@/types';

interface TransactionNote {
  id: string;
  transactionId: string;
  userId: string;
  note: string;
  createdByEmail: string | null;
  createdAt: string;
}

interface TransactionNotesModalProps {
  transaction: BusinessTransaction;
  onClose: () => void;
}

export function TransactionNotesModal({ transaction, onClose }: TransactionNotesModalProps) {
  const queryClient = useQueryClient();
  const [newNote, setNewNote] = useState('');

  // Determine transaction type (vyapar or bank)
  const transactionType: 'vyapar' | 'bank' = transaction.accountName === 'Vyapar' ? 'vyapar' : 'bank';

  // Fetch notes for this transaction
  const { data: notes = [], isLoading } = useQuery<TransactionNote[]>({
    queryKey: ['transaction-notes', transaction.id, transactionType],
    queryFn: () => businessAccountingApi.getTransactionNotes(transaction.id, transactionType),
  });

  // Add note mutation
  const addNoteMutation = useMutation({
    mutationFn: (note: string) => businessAccountingApi.addTransactionNote(transaction.id, note, transactionType),
    onSuccess: () => {
      setNewNote('');
      queryClient.invalidateQueries({ queryKey: ['transaction-notes', transaction.id] });
      queryClient.invalidateQueries({ queryKey: ['transaction-note-counts'] });
    },
  });

  // Delete note mutation
  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => businessAccountingApi.deleteTransactionNote(transaction.id, noteId, transactionType),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['transaction-notes', transaction.id] });
      queryClient.invalidateQueries({ queryKey: ['transaction-note-counts'] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newNote.trim()) {
      addNoteMutation.mutate(newNote.trim());
    }
  };

  return (
    <Dialog open={true} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Transaction Notes
          </DialogTitle>
        </DialogHeader>

        {/* Transaction Info */}
        <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Date:</span>
            <span className="font-medium">{format(new Date(transaction.date), 'dd MMM yyyy')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Party:</span>
            <span className="font-medium">{transaction.vendorName || transaction.narration}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Amount:</span>
            <span className={`font-medium ${transaction.transactionType === 'credit' ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(transaction.amount)}
            </span>
          </div>
          {transaction.reference && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice #:</span>
              <span className="font-medium">{transaction.reference}</span>
            </div>
          )}
        </div>

        {/* Notes List */}
        <div className="flex-1 overflow-y-auto space-y-3 min-h-[150px]">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : notes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No notes yet</p>
              <p className="text-xs">Add a note to track reconciliation status</p>
            </div>
          ) : (
            notes.map((note) => (
              <div key={note.id} className="bg-background border rounded-lg p-3 group">
                <div className="flex justify-between items-start gap-2">
                  <p className="text-sm whitespace-pre-wrap flex-1">{note.note}</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                    onClick={() => deleteNoteMutation.mutate(note.id)}
                    disabled={deleteNoteMutation.isPending}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                  <span>{format(new Date(note.createdAt), 'dd MMM yyyy, HH:mm')}</span>
                  {note.createdByEmail && (
                    <>
                      <span>by</span>
                      <span className="font-medium">{note.createdByEmail}</span>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add Note Form */}
        <form onSubmit={handleSubmit} className="border-t pt-3 mt-3">
          <div className="flex gap-2">
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Add a note (e.g., 'Pending payment follow-up on 15th')"
              className="min-h-[60px] resize-none flex-1"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!newNote.trim() || addNoteMutation.isPending}
              className="h-[60px] w-[60px]"
            >
              {addNoteMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
