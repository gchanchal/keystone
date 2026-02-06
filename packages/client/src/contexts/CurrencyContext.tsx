import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { loansApi } from '@/lib/api';

type Currency = 'INR' | 'USD';

interface CurrencyContextType {
  currency: Currency;
  setCurrency: (currency: Currency) => void;
  exchangeRate: number; // USD to INR rate
  convert: (amount: number, fromCurrency: Currency) => number;
  formatAmount: (amount: number, fromCurrency?: Currency) => string;
}

const CurrencyContext = createContext<CurrencyContextType | undefined>(undefined);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState<Currency>(() => {
    const stored = localStorage.getItem('keystone-currency');
    return (stored as Currency) || 'INR';
  });

  // Fetch exchange rate
  const { data: exchangeRateData } = useQuery({
    queryKey: ['exchange-rate', 'usd-inr'],
    queryFn: () => loansApi.getExchangeRate(),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });

  const exchangeRate = exchangeRateData?.rate || 83.5;

  // Persist currency preference
  const setCurrency = (newCurrency: Currency) => {
    setCurrencyState(newCurrency);
    localStorage.setItem('keystone-currency', newCurrency);
  };

  // Convert amount to display currency
  const convert = (amount: number, fromCurrency: Currency): number => {
    if (fromCurrency === currency) return amount;

    if (fromCurrency === 'USD' && currency === 'INR') {
      return amount * exchangeRate;
    }
    if (fromCurrency === 'INR' && currency === 'USD') {
      return amount / exchangeRate;
    }
    return amount;
  };

  // Format amount in display currency
  const formatAmount = (amount: number, fromCurrency: Currency = 'INR'): string => {
    const convertedAmount = convert(amount, fromCurrency);

    if (currency === 'USD') {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(convertedAmount);
    }

    // INR formatting
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(convertedAmount);
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, exchangeRate, convert, formatAmount }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const context = useContext(CurrencyContext);
  if (context === undefined) {
    throw new Error('useCurrency must be used within a CurrencyProvider');
  }
  return context;
}
