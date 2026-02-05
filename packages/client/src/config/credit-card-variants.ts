// Credit Card Variants Configuration
// Contains styling information for popular Indian credit cards

export interface CardVariant {
  id: string;
  name: string;
  bank: string;
  gradient: string;
  textColor?: 'light' | 'dark';
  network?: 'visa' | 'mastercard' | 'rupay' | 'amex' | 'diners';
  tier?: 'entry' | 'premium' | 'super-premium' | 'ultra-premium';
}

// HDFC Bank Cards
const hdfcCards: CardVariant[] = [
  {
    id: 'hdfc-regalia',
    name: 'Regalia',
    bank: 'HDFC',
    gradient: 'from-slate-900 via-slate-800 to-amber-900',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'hdfc-regalia-gold',
    name: 'Regalia Gold',
    bank: 'HDFC',
    gradient: 'from-amber-600 via-yellow-500 to-amber-400',
    textColor: 'dark',
    network: 'visa',
    tier: 'super-premium',
  },
  {
    id: 'hdfc-infinia',
    name: 'Infinia',
    bank: 'HDFC',
    gradient: 'from-zinc-900 via-neutral-800 to-zinc-700',
    network: 'visa',
    tier: 'ultra-premium',
  },
  {
    id: 'hdfc-diners-black',
    name: 'Diners Club Black',
    bank: 'HDFC',
    gradient: 'from-black via-zinc-900 to-neutral-800',
    network: 'diners',
    tier: 'ultra-premium',
  },
  {
    id: 'hdfc-millennia',
    name: 'Millennia',
    bank: 'HDFC',
    gradient: 'from-violet-900 via-purple-800 to-fuchsia-700',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'hdfc-moneyback',
    name: 'MoneyBack',
    bank: 'HDFC',
    gradient: 'from-blue-800 via-blue-700 to-blue-600',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'hdfc-moneyback-plus',
    name: 'MoneyBack+',
    bank: 'HDFC',
    gradient: 'from-indigo-900 via-indigo-800 to-blue-700',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'hdfc-freedom',
    name: 'Freedom',
    bank: 'HDFC',
    gradient: 'from-emerald-800 via-green-700 to-teal-600',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'hdfc-swiggy',
    name: 'Swiggy',
    bank: 'HDFC',
    gradient: 'from-orange-600 via-orange-500 to-amber-500',
    network: 'mastercard',
    tier: 'entry',
  },
  {
    id: 'hdfc-tata-neu',
    name: 'Tata Neu Infinity',
    bank: 'HDFC',
    gradient: 'from-purple-900 via-violet-800 to-indigo-700',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'hdfc-6e-rewards',
    name: '6E Rewards',
    bank: 'HDFC',
    gradient: 'from-indigo-900 via-blue-800 to-indigo-600',
    network: 'visa',
    tier: 'premium',
  },
];

// ICICI Bank Cards
const iciciCards: CardVariant[] = [
  {
    id: 'icici-amazon-pay',
    name: 'Amazon Pay',
    bank: 'ICICI',
    gradient: 'from-zinc-900 via-neutral-800 to-amber-700',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'icici-coral',
    name: 'Coral',
    bank: 'ICICI',
    gradient: 'from-rose-700 via-pink-600 to-rose-500',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'icici-rubyx',
    name: 'Rubyx',
    bank: 'ICICI',
    gradient: 'from-red-900 via-rose-800 to-red-700',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'icici-sapphiro',
    name: 'Sapphiro',
    bank: 'ICICI',
    gradient: 'from-blue-900 via-indigo-800 to-blue-700',
    network: 'visa',
    tier: 'super-premium',
  },
  {
    id: 'icici-emeralde',
    name: 'Emeralde',
    bank: 'ICICI',
    gradient: 'from-emerald-900 via-green-800 to-emerald-700',
    network: 'visa',
    tier: 'ultra-premium',
  },
  {
    id: 'icici-manchester-united',
    name: 'Manchester United',
    bank: 'ICICI',
    gradient: 'from-red-800 via-red-700 to-red-600',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'icici-makemytrip',
    name: 'MakeMyTrip',
    bank: 'ICICI',
    gradient: 'from-red-600 via-orange-500 to-red-500',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'icici-platinum',
    name: 'Platinum',
    bank: 'ICICI',
    gradient: 'from-slate-700 via-slate-600 to-gray-500',
    network: 'visa',
    tier: 'entry',
  },
];

// Axis Bank Cards
const axisCards: CardVariant[] = [
  {
    id: 'axis-flipkart',
    name: 'Flipkart',
    bank: 'Axis',
    gradient: 'from-blue-700 via-blue-600 to-yellow-500',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'axis-ace',
    name: 'ACE',
    bank: 'Axis',
    gradient: 'from-purple-900 via-violet-800 to-purple-700',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'axis-magnus',
    name: 'Magnus',
    bank: 'Axis',
    gradient: 'from-zinc-900 via-neutral-800 to-stone-700',
    network: 'visa',
    tier: 'super-premium',
  },
  {
    id: 'axis-atlas',
    name: 'Atlas',
    bank: 'Axis',
    gradient: 'from-slate-900 via-blue-900 to-indigo-800',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'axis-reserve',
    name: 'Reserve',
    bank: 'Axis',
    gradient: 'from-black via-zinc-900 to-amber-900',
    network: 'visa',
    tier: 'ultra-premium',
  },
  {
    id: 'axis-select',
    name: 'Select',
    bank: 'Axis',
    gradient: 'from-purple-800 via-purple-700 to-fuchsia-600',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'axis-my-zone',
    name: 'MY ZONE',
    bank: 'Axis',
    gradient: 'from-rose-600 via-pink-500 to-orange-400',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'axis-neo',
    name: 'Neo',
    bank: 'Axis',
    gradient: 'from-cyan-700 via-teal-600 to-emerald-500',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'axis-vistara',
    name: 'Vistara',
    bank: 'Axis',
    gradient: 'from-violet-900 via-purple-800 to-pink-700',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'axis-vistara-infinite',
    name: 'Vistara Infinite',
    bank: 'Axis',
    gradient: 'from-black via-violet-900 to-purple-800',
    network: 'visa',
    tier: 'super-premium',
  },
];

// SBI Cards
const sbiCards: CardVariant[] = [
  {
    id: 'sbi-simplyclick',
    name: 'SimplyCLICK',
    bank: 'SBI',
    gradient: 'from-blue-800 via-blue-700 to-cyan-600',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'sbi-simplysave',
    name: 'SimplySAVE',
    bank: 'SBI',
    gradient: 'from-green-800 via-emerald-700 to-teal-600',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'sbi-prime',
    name: 'Prime',
    bank: 'SBI',
    gradient: 'from-slate-900 via-blue-900 to-slate-800',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'sbi-elite',
    name: 'Elite',
    bank: 'SBI',
    gradient: 'from-black via-zinc-900 to-neutral-800',
    network: 'visa',
    tier: 'super-premium',
  },
  {
    id: 'sbi-aurum',
    name: 'Aurum',
    bank: 'SBI',
    gradient: 'from-amber-700 via-yellow-600 to-amber-500',
    textColor: 'dark',
    network: 'visa',
    tier: 'super-premium',
  },
  {
    id: 'sbi-cashback',
    name: 'Cashback',
    bank: 'SBI',
    gradient: 'from-emerald-700 via-green-600 to-lime-500',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'sbi-bpcl',
    name: 'BPCL',
    bank: 'SBI',
    gradient: 'from-yellow-600 via-amber-500 to-orange-500',
    textColor: 'dark',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'sbi-irctc',
    name: 'IRCTC',
    bank: 'SBI',
    gradient: 'from-orange-700 via-orange-600 to-red-500',
    network: 'rupay',
    tier: 'entry',
  },
];

// Kotak Mahindra Bank Cards
const kotakCards: CardVariant[] = [
  {
    id: 'kotak-811',
    name: '811',
    bank: 'Kotak',
    gradient: 'from-red-700 via-rose-600 to-pink-500',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'kotak-league-platinum',
    name: 'League Platinum',
    bank: 'Kotak',
    gradient: 'from-slate-700 via-gray-600 to-slate-500',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'kotak-indigo-6e',
    name: 'Indigo 6E',
    bank: 'Kotak',
    gradient: 'from-indigo-800 via-blue-700 to-indigo-600',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'kotak-zen',
    name: 'Zen',
    bank: 'Kotak',
    gradient: 'from-emerald-800 via-teal-700 to-cyan-600',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'kotak-privy-league',
    name: 'Privy League',
    bank: 'Kotak',
    gradient: 'from-amber-800 via-yellow-700 to-orange-600',
    network: 'visa',
    tier: 'super-premium',
  },
];

// American Express Cards
const amexCards: CardVariant[] = [
  {
    id: 'amex-membership-rewards',
    name: 'Membership Rewards',
    bank: 'American Express',
    gradient: 'from-emerald-800 via-green-700 to-teal-600',
    network: 'amex',
    tier: 'entry',
  },
  {
    id: 'amex-gold',
    name: 'Gold',
    bank: 'American Express',
    gradient: 'from-amber-600 via-yellow-500 to-amber-400',
    textColor: 'dark',
    network: 'amex',
    tier: 'premium',
  },
  {
    id: 'amex-platinum',
    name: 'Platinum',
    bank: 'American Express',
    gradient: 'from-slate-600 via-gray-500 to-slate-400',
    textColor: 'dark',
    network: 'amex',
    tier: 'super-premium',
  },
  {
    id: 'amex-platinum-travel',
    name: 'Platinum Travel',
    bank: 'American Express',
    gradient: 'from-slate-800 via-zinc-700 to-stone-600',
    network: 'amex',
    tier: 'premium',
  },
  {
    id: 'amex-smartearn',
    name: 'SmartEarn',
    bank: 'American Express',
    gradient: 'from-blue-700 via-indigo-600 to-blue-500',
    network: 'amex',
    tier: 'entry',
  },
];

// RBL Bank Cards
const rblCards: CardVariant[] = [
  {
    id: 'rbl-world-safari',
    name: 'World Safari',
    bank: 'RBL',
    gradient: 'from-orange-700 via-amber-600 to-yellow-500',
    network: 'mastercard',
    tier: 'premium',
  },
  {
    id: 'rbl-shoprite',
    name: 'ShopRite',
    bank: 'RBL',
    gradient: 'from-red-600 via-rose-500 to-pink-500',
    network: 'mastercard',
    tier: 'entry',
  },
  {
    id: 'rbl-platinum-maxima',
    name: 'Platinum Maxima',
    bank: 'RBL',
    gradient: 'from-slate-700 via-gray-600 to-zinc-500',
    network: 'mastercard',
    tier: 'premium',
  },
  {
    id: 'rbl-supercard',
    name: 'SuperCard',
    bank: 'RBL',
    gradient: 'from-purple-700 via-violet-600 to-fuchsia-500',
    network: 'mastercard',
    tier: 'entry',
  },
];

// IndusInd Bank Cards
const indusindCards: CardVariant[] = [
  {
    id: 'indusind-legend',
    name: 'Legend',
    bank: 'IndusInd',
    gradient: 'from-zinc-900 via-neutral-800 to-stone-700',
    network: 'visa',
    tier: 'super-premium',
  },
  {
    id: 'indusind-iconia',
    name: 'Iconia',
    bank: 'IndusInd',
    gradient: 'from-blue-800 via-indigo-700 to-purple-600',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'indusind-platinum',
    name: 'Platinum',
    bank: 'IndusInd',
    gradient: 'from-slate-600 via-gray-500 to-zinc-400',
    textColor: 'dark',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'indusind-tiger',
    name: 'Tiger',
    bank: 'IndusInd',
    gradient: 'from-orange-700 via-amber-600 to-yellow-500',
    network: 'mastercard',
    tier: 'entry',
  },
];

// Yes Bank Cards
const yesCards: CardVariant[] = [
  {
    id: 'yes-first-preferred',
    name: 'First Preferred',
    bank: 'Yes Bank',
    gradient: 'from-blue-900 via-blue-800 to-cyan-700',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'yes-first-exclusive',
    name: 'First Exclusive',
    bank: 'Yes Bank',
    gradient: 'from-slate-900 via-zinc-800 to-neutral-700',
    network: 'visa',
    tier: 'super-premium',
  },
  {
    id: 'yes-marquee',
    name: 'Marquee',
    bank: 'Yes Bank',
    gradient: 'from-amber-700 via-yellow-600 to-orange-500',
    network: 'mastercard',
    tier: 'entry',
  },
];

// IDFC First Bank Cards
const idfcCards: CardVariant[] = [
  {
    id: 'idfc-first-classic',
    name: 'Classic',
    bank: 'IDFC First',
    gradient: 'from-red-700 via-rose-600 to-red-500',
    network: 'visa',
    tier: 'entry',
  },
  {
    id: 'idfc-first-select',
    name: 'Select',
    bank: 'IDFC First',
    gradient: 'from-slate-800 via-zinc-700 to-stone-600',
    network: 'visa',
    tier: 'premium',
  },
  {
    id: 'idfc-first-wealth',
    name: 'Wealth',
    bank: 'IDFC First',
    gradient: 'from-amber-800 via-yellow-700 to-amber-600',
    network: 'visa',
    tier: 'super-premium',
  },
];

// All cards combined
export const CREDIT_CARD_VARIANTS: CardVariant[] = [
  ...hdfcCards,
  ...iciciCards,
  ...axisCards,
  ...sbiCards,
  ...kotakCards,
  ...amexCards,
  ...rblCards,
  ...indusindCards,
  ...yesCards,
  ...idfcCards,
];

// Group by bank for easy selection
export const CARDS_BY_BANK: Record<string, CardVariant[]> = {
  'HDFC': hdfcCards,
  'ICICI': iciciCards,
  'Axis': axisCards,
  'SBI': sbiCards,
  'Kotak': kotakCards,
  'American Express': amexCards,
  'RBL': rblCards,
  'IndusInd': indusindCards,
  'Yes Bank': yesCards,
  'IDFC First': idfcCards,
};

// Get card variant by ID
export function getCardVariant(cardId: string): CardVariant | undefined {
  return CREDIT_CARD_VARIANTS.find(card => card.id === cardId);
}

// Get cards for a specific bank
export function getCardsForBank(bankName: string): CardVariant[] {
  const normalizedBank = bankName.toLowerCase().trim();

  // Match bank name variants
  if (normalizedBank.includes('hdfc')) return CARDS_BY_BANK['HDFC'];
  if (normalizedBank.includes('icici')) return CARDS_BY_BANK['ICICI'];
  if (normalizedBank.includes('axis')) return CARDS_BY_BANK['Axis'];
  if (normalizedBank.includes('sbi') || normalizedBank.includes('state bank')) return CARDS_BY_BANK['SBI'];
  if (normalizedBank.includes('kotak')) return CARDS_BY_BANK['Kotak'];
  if (normalizedBank.includes('amex') || normalizedBank.includes('american express')) return CARDS_BY_BANK['American Express'];
  if (normalizedBank.includes('rbl')) return CARDS_BY_BANK['RBL'];
  if (normalizedBank.includes('indusind')) return CARDS_BY_BANK['IndusInd'];
  if (normalizedBank.includes('yes')) return CARDS_BY_BANK['Yes Bank'];
  if (normalizedBank.includes('idfc')) return CARDS_BY_BANK['IDFC First'];

  return [];
}

// Get gradient for a card (fallback to bank gradient if card not found)
export function getCardGradient(bankName: string, cardName?: string | null): string {
  if (cardName) {
    const card = CREDIT_CARD_VARIANTS.find(
      c => c.name.toLowerCase() === cardName.toLowerCase() &&
           bankName.toLowerCase().includes(c.bank.toLowerCase())
    );
    if (card) return card.gradient;
  }

  // Fallback bank gradients
  const normalizedBank = bankName.toLowerCase();
  if (normalizedBank.includes('hdfc')) return 'from-blue-900 via-blue-800 to-blue-700';
  if (normalizedBank.includes('icici')) return 'from-orange-600 via-orange-500 to-amber-500';
  if (normalizedBank.includes('axis')) return 'from-purple-900 via-purple-700 to-pink-600';
  if (normalizedBank.includes('sbi')) return 'from-blue-600 via-blue-500 to-cyan-500';
  if (normalizedBank.includes('kotak')) return 'from-red-700 via-red-600 to-red-500';
  if (normalizedBank.includes('amex')) return 'from-slate-700 via-slate-600 to-slate-500';
  if (normalizedBank.includes('rbl')) return 'from-orange-700 via-orange-600 to-yellow-500';
  if (normalizedBank.includes('indusind')) return 'from-red-800 via-red-700 to-orange-600';
  if (normalizedBank.includes('yes')) return 'from-blue-800 via-blue-700 to-blue-600';
  if (normalizedBank.includes('idfc')) return 'from-red-700 via-red-600 to-red-500';

  return 'from-gray-800 via-gray-700 to-gray-600';
}

// Network logos/icons
export const CARD_NETWORKS = ['Visa', 'Mastercard', 'RuPay', 'American Express', 'Diners Club'] as const;
export type CardNetwork = typeof CARD_NETWORKS[number];
