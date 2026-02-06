import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FileSearch,
  Building2,
  User,
  CreditCard,
  Hash,
  MapPin,
  ArrowRightLeft,
  PiggyBank,
  CheckCircle2,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useCurrency } from '@/contexts/CurrencyContext';

interface ProgressStep {
  id: string;
  label: string;
  value?: string | number;
  icon: React.ReactNode;
  status: 'pending' | 'active' | 'done';
}

interface SmartImportProgressProps {
  isOpen: boolean;
  result: any | null;
  onComplete: (accountId: string) => void;
}

export function SmartImportProgress({ isOpen, result, onComplete }: SmartImportProgressProps) {
  const { formatAmount } = useCurrency();
  const [steps, setSteps] = useState<ProgressStep[]>([
    { id: 'analyzing', label: 'Analyzing PDF...', icon: <FileSearch className="h-5 w-5" />, status: 'active' },
  ]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const hasCompletedRef = useRef(false);

  // Reset completed flag when result changes
  useEffect(() => {
    if (!result) {
      hasCompletedRef.current = false;
    }
  }, [result]);

  useEffect(() => {
    if (!result) return;

    // Build steps from result data
    const newSteps: ProgressStep[] = [
      {
        id: 'bank',
        label: 'Bank Detected',
        value: result.account?.bankName || result.metadata?.bankName,
        icon: <Building2 className="h-5 w-5" />,
        status: 'done',
      },
    ];

    if (result.account?.accountNumber) {
      newSteps.push({
        id: 'account',
        label: 'Account Number',
        value: `****${result.account.accountNumber.slice(-4)}`,
        icon: <CreditCard className="h-5 w-5" />,
        status: 'done',
      });
    }

    if (result.account?.accountHolderName || result.metadata?.accountHolderName) {
      newSteps.push({
        id: 'holder',
        label: 'Account Holder',
        value: result.account?.accountHolderName || result.metadata?.accountHolderName,
        icon: <User className="h-5 w-5" />,
        status: 'done',
      });
    }

    if (result.account?.ifscCode || result.metadata?.ifscCode) {
      newSteps.push({
        id: 'ifsc',
        label: 'IFSC Code',
        value: result.account?.ifscCode || result.metadata?.ifscCode,
        icon: <Hash className="h-5 w-5" />,
        status: 'done',
      });
    }

    if (result.account?.branch || result.metadata?.branch) {
      newSteps.push({
        id: 'branch',
        label: 'Branch',
        value: result.account?.branch || result.metadata?.branch,
        icon: <MapPin className="h-5 w-5" />,
        status: 'done',
      });
    }

    if (result.account?.address || result.metadata?.address) {
      newSteps.push({
        id: 'address',
        label: 'Address',
        value: result.account?.address || result.metadata?.address,
        icon: <MapPin className="h-5 w-5" />,
        status: 'done',
      });
    }

    newSteps.push({
      id: 'transactions',
      label: 'Transactions Found',
      value: `${result.transactions?.imported || 0} imported${result.transactions?.duplicates > 0 ? `, ${result.transactions.duplicates} duplicates skipped` : ''}`,
      icon: <ArrowRightLeft className="h-5 w-5" />,
      status: 'done',
    });

    if (result.sweep?.balance > 0) {
      newSteps.push({
        id: 'sweep',
        label: 'Sweep Balance (Linked FD)',
        value: formatAmount(result.sweep.balance),
        icon: <PiggyBank className="h-5 w-5" />,
        status: 'done',
      });
    }

    newSteps.push({
      id: 'balance',
      label: 'Actual Balance',
      value: formatAmount(result.balance?.actual || 0),
      icon: <Sparkles className="h-5 w-5" />,
      status: 'done',
    });

    newSteps.push({
      id: 'complete',
      label: result.accountCreated ? 'Account Created' : 'Account Updated',
      icon: <CheckCircle2 className="h-5 w-5" />,
      status: 'done',
    });

    // Animate steps appearing one by one
    let stepIndex = 0;
    setSteps([{ id: 'analyzing', label: 'Analyzing PDF...', icon: <FileSearch className="h-5 w-5" />, status: 'done' }]);

    const interval = setInterval(() => {
      if (stepIndex < newSteps.length) {
        const nextStep = newSteps[stepIndex];
        if (nextStep) {
          setSteps(prev => [...prev, nextStep]);
          setCurrentStepIndex(stepIndex + 1);
        }
        stepIndex++;
      } else {
        clearInterval(interval);
        // Redirect after showing all steps (only once)
        setTimeout(() => {
          console.log('SmartImportProgress: Animation complete, account id:', result.account?.id);
          if (result.account?.id && !hasCompletedRef.current) {
            hasCompletedRef.current = true;
            console.log('SmartImportProgress: Calling onComplete');
            onComplete(result.account.id);
          } else {
            console.log('SmartImportProgress: Skipped onComplete - already completed or no account id');
          }
        }, 1500);
      }
    }, 400);

    return () => clearInterval(interval);
  }, [result, formatAmount, onComplete]);

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-md rounded-xl border bg-card p-6 shadow-2xl"
      >
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold">Smart Import</h2>
            <p className="text-sm text-muted-foreground">Deep analyzing your statement...</p>
          </div>
        </div>

        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {steps.filter(step => step && step.id).map((step) => (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3 }}
                className={`flex items-center gap-3 rounded-lg p-3 ${
                  step.status === 'done'
                    ? 'bg-green-500/10'
                    : step.status === 'active'
                      ? 'bg-primary/10'
                      : 'bg-muted/50'
                }`}
              >
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                  step.status === 'done'
                    ? 'bg-green-500/20 text-green-600'
                    : step.status === 'active'
                      ? 'bg-primary/20 text-primary'
                      : 'bg-muted text-muted-foreground'
                }`}>
                  {step.status === 'active' ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    step.icon
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{step.label}</p>
                  {step.value && (
                    <p className="text-sm text-muted-foreground truncate">{step.value}</p>
                  )}
                </div>
                {step.status === 'done' && (
                  <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

        {result && steps.length > 5 && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="mt-4 text-center text-sm text-muted-foreground"
          >
            Redirecting to accounts...
          </motion.p>
        )}
      </motion.div>
    </motion.div>
  );
}
