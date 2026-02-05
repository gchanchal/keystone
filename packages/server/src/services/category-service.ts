import { db, categories } from '../db/index.js';
import { eq, like, or } from 'drizzle-orm';

interface CategoryRule {
  patterns: RegExp[];
  categoryName: string;
}

const categoryRules: CategoryRule[] = [
  {
    patterns: [/SALARY/i, /PAYROLL/i, /WAGES/i],
    categoryName: 'Salary',
  },
  {
    patterns: [/INTEREST/i, /DIVIDEND/i, /BONUS/i],
    categoryName: 'Investment Returns',
  },
  {
    patterns: [/RENT/i, /LEASE/i],
    categoryName: 'Rental Income',
  },
  {
    patterns: [/SWIGGY/i, /ZOMATO/i, /RESTAURANT/i, /CAFE/i, /FOOD/i, /DOMINOS/i, /PIZZA/i, /BURGER/i],
    categoryName: 'Food & Dining',
  },
  {
    patterns: [/UBER/i, /OLA/i, /RAPIDO/i, /PETROL/i, /FUEL/i, /PARKING/i, /METRO/i, /IRCTC/i, /RAILWAY/i],
    categoryName: 'Transportation',
  },
  {
    patterns: [/AMAZON/i, /FLIPKART/i, /MYNTRA/i, /AJIO/i, /MEESHO/i, /SHOPPING/i],
    categoryName: 'Shopping',
  },
  {
    patterns: [/NETFLIX/i, /PRIME VIDEO/i, /HOTSTAR/i, /SPOTIFY/i, /YOUTUBE/i, /INOX/i, /PVR/i, /MOVIE/i],
    categoryName: 'Entertainment',
  },
  {
    patterns: [/ELECTRICITY/i, /WATER/i, /GAS/i, /INTERNET/i, /BROADBAND/i, /JIO/i, /AIRTEL/i, /VI /i, /BSNL/i],
    categoryName: 'Bills & Utilities',
  },
  {
    patterns: [/HOSPITAL/i, /PHARMACY/i, /MEDICAL/i, /DOCTOR/i, /CLINIC/i, /APOLLO/i, /FORTIS/i, /PHARMA/i],
    categoryName: 'Healthcare',
  },
  {
    patterns: [/SCHOOL/i, /COLLEGE/i, /UNIVERSITY/i, /UDEMY/i, /COURSERA/i, /FEES/i, /TUITION/i],
    categoryName: 'Education',
  },
  {
    patterns: [/FLIGHT/i, /HOTEL/i, /BOOKING/i, /GOIBIBO/i, /MAKEMYTRIP/i, /CLEARTRIP/i, /AIRBNB/i],
    categoryName: 'Travel',
  },
  {
    patterns: [/SALON/i, /SPA/i, /GYM/i, /FITNESS/i, /BEAUTY/i],
    categoryName: 'Personal Care',
  },
  {
    patterns: [/INSURANCE/i, /LIC/i, /HDFC LIFE/i, /ICICI PRUDENTIAL/i, /POLICY/i],
    categoryName: 'Insurance',
  },
  {
    patterns: [/TAX/i, /GST/i, /TDS/i, /INCOME TAX/i],
    categoryName: 'Taxes',
  },
  {
    patterns: [/BANK CHARGE/i, /ANNUAL FEE/i, /SERVICE CHARGE/i, /SMS ALERT/i, /AMC/i],
    categoryName: 'Bank Charges',
  },
];

export async function suggestCategory(narration: string): Promise<string | null> {
  // Try to match against rules
  for (const rule of categoryRules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(narration)) {
        // Find the category ID
        const category = await db
          .select()
          .from(categories)
          .where(eq(categories.name, rule.categoryName))
          .limit(1);

        if (category[0]) {
          return category[0].id;
        }
        break;
      }
    }
  }

  return null;
}

export async function autoCategorizeTransactions(
  transactions: Array<{ id: string; narration: string }>
): Promise<Map<string, string>> {
  const categoryMap = new Map<string, string>();

  for (const txn of transactions) {
    const categoryId = await suggestCategory(txn.narration);
    if (categoryId) {
      categoryMap.set(txn.id, categoryId);
    }
  }

  return categoryMap;
}

export async function searchCategories(query: string) {
  return db
    .select()
    .from(categories)
    .where(
      or(
        like(categories.name, `%${query}%`),
        like(categories.type, `%${query}%`)
      )
    );
}
