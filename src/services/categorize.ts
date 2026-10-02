import { ReceiptLineItem, ReceiptCategory, ReceiptMetadata, ReceiptOcrResult } from '../types/receipt';

export interface CategorizationRule {
  id: string;
  name: string;
  patterns: string[];
  categoryId: string;
  categoryName: string;
  priority: number;
}

export interface CategorizationResult {
  categories: ReceiptCategory[];
  categorizedLineItems: ReceiptLineItem[];
}

const DEFAULT_RULES: CategorizationRule[] = [
  {
    id: 'food_dining',
    name: 'Food & Dining',
    patterns: [
      'restaurant', 'cafe', 'coffee', 'bakery', 'pizza', 'burger', 'sandwich',
      'grill', 'bistro', 'diner', 'eatery', 'kitchen', 'food', 'meal',
      'lunch', 'dinner', 'breakfast', 'brunch', 'takeout', 'delivery',
      'uber eats', 'doordash', 'grubhub', 'postmates',
      'starbucks', 'mcdonald', 'subway', 'chipotle', 'panera',
      'grocery', 'supermarket', 'market', 'whole foods', 'trader joe',
      'kroger', 'safeway', 'publix', 'aldi', 'walmart', 'target',
      'costco', 'sam club', 'bj'
    ],
    categoryId: 'cat_food',
    categoryName: 'Food & Dining',
    priority: 10,
  },
  {
    id: 'transportation',
    name: 'Transportation',
    patterns: [
      'uber', 'lyft', 'taxi', 'cab', 'ride',
      'gas', 'fuel', 'shell', 'exxon', 'bp', 'chevron', 'mobil', 'speedway',
      'parking', 'toll', 'metro', 'subway', 'bus', 'train', 'amtrak',
      'flight', 'airline', 'airport', 'baggage',
      'car rental', 'hertz', 'avis', 'enterprise', 'budget',
      'maintenance', 'oil change', 'tire', 'repair', 'mechanic',
      'uber*', 'lyft*', 'parking*', 'meter'
    ],
    categoryId: 'cat_transport',
    categoryName: 'Transportation',
    priority: 10,
  },
  {
    id: 'shopping',
    name: 'Shopping',
    patterns: [
      'amazon', 'ebay', 'etsy', 'shopify',
      'store', 'shop', 'boutique', 'outlet', 'mall',
      'clothing', 'apparel', 'shoes', 'fashion',
      'electronics', 'best buy', 'apple store', 'microsoft store',
      'home depot', 'lowes', 'ikea', 'wayfair',
      'target', 'walmart', 'costco', 'sams club',
      'cvs', 'walgreens', 'rite aid', 'pharmacy',
      'department store', 'nordstrom', 'macys', 'bloomingdales'
    ],
    categoryId: 'cat_shopping',
    categoryName: 'Shopping',
    priority: 9,
  },
  {
    id: 'entertainment',
    name: 'Entertainment',
    patterns: [
      'netflix', 'spotify', 'hulu', 'disney+', 'hbo', 'apple tv', 'prime video',
      'movie', 'cinema', 'theater', 'theatre', 'amc', 'regal', 'cinemark',
      'concert', 'ticket', 'stubhub', 'ticketmaster', 'eventbrite',
      'game', 'gaming', 'steam', 'playstation', 'xbox', 'nintendo',
      'bowling', 'arcade', 'mini golf', 'escape room',
      'museum', 'zoo', 'aquarium', 'park', 'disney', 'universal'
    ],
    categoryId: 'cat_entertainment',
    categoryName: 'Entertainment',
    priority: 9,
  },
  {
    id: 'health_wellness',
    name: 'Health & Wellness',
    patterns: [
      'pharmacy', 'drugstore', 'cvs', 'walgreens', 'rite aid',
      'doctor', 'physician', 'clinic', 'hospital', 'urgent care',
      'dentist', 'dental', 'orthodontist',
      'vision', 'optical', 'eye', 'glasses', 'contacts',
      'gym', 'fitness', 'yoga', 'pilates', 'crossfit', 'planet fitness',
      'massage', 'spa', 'wellness', 'therapy', 'counseling',
      'vitamin', 'supplement', 'prescription', 'medication'
    ],
    categoryId: 'cat_health',
    categoryName: 'Health & Wellness',
    priority: 10,
  },
  {
    id: 'travel',
    name: 'Travel',
    patterns: [
      'hotel', 'motel', 'inn', 'marriott', 'hilton', 'hyatt', 'ihg', 'choice',
      'airbnb', 'vrbo', 'booking.com', 'expedia', 'kayak', 'priceline',
      'flight', 'airline', 'delta', 'united', 'american', 'southwest', 'jetblue',
      'rental car', 'hertz', 'avis', 'enterprise', 'national', 'budget',
      'cruise', 'carnival', 'royal caribbean', 'norwegian',
      'travel', 'vacation', 'trip'
    ],
    categoryId: 'cat_travel',
    categoryName: 'Travel',
    priority: 10,
  },
  {
    id: 'utilities',
    name: 'Utilities',
    patterns: [
      'electric', 'electricity', 'power', 'utility', 'pge', 'con ed', 'edison',
      'gas', 'natural gas', 'water', 'sewer', 'trash', 'waste', 'recycling',
      'internet', 'cable', 'comcast', 'xfinity', 'verizon', 'att', 'spectrum',
      'phone', 'mobile', 'cellular', 't-mobile', 'sprint', 'mint mobile',
      'streaming', 'subscription'
    ],
    categoryId: 'cat_utilities',
    categoryName: 'Utilities',
    priority: 10,
  },
  {
    id: 'education',
    name: 'Education',
    patterns: [
      'tuition', 'university', 'college', 'school', 'course', 'class',
      'textbook', 'bookstore', 'amazon textbook', 'chegg', 'coursehero',
      'udemy', 'coursera', 'edx', 'skillshare', 'masterclass',
      'training', 'certification', 'exam', 'test prep', 'kaplan', 'princeton review'
    ],
    categoryId: 'cat_education',
    categoryName: 'Education',
    priority: 9,
  },
  {
    id: 'personal_care',
    name: 'Personal Care',
    patterns: [
      'salon', 'barber', 'hair', 'nail', 'spa', 'massage',
      'beauty', 'cosmetic', 'makeup', 'skincare', 'sephora', 'ulta',
      'dry clean', 'laundry', 'tailor', 'alteration',
      'gym', 'fitness', 'personal trainer'
    ],
    categoryId: 'cat_personal',
    categoryName: 'Personal Care',
    priority: 8,
  },
  {
    id: 'business',
    name: 'Business',
    patterns: [
      'office', 'supplies', 'staples', 'office depot', 'office max',
      'software', 'saas', 'subscription', 'license', 'aws', 'azure', 'gcp',
      'github', 'gitlab', 'atlassian', 'jira', 'confluence', 'slack', 'zoom',
      'adobe', 'microsoft 365', 'google workspace', 'notion', 'figma',
      'freelance', 'contractor', 'consulting', 'legal', 'accounting',
      'quickbooks', 'xero', 'freshbooks', 'wave'
    ],
    categoryId: 'cat_business',
    categoryName: 'Business',
    priority: 9,
  },
];

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function matchesPattern(text: string, pattern: string): boolean {
  const normalizedText = normalizeText(text);
  const normalizedPattern = normalizeText(pattern);
  return normalizedText.includes(normalizedPattern);
}

function categorizeByRules(text: string, merchantName: string, rules: CategorizationRule[]): { categoryId: string; categoryName: string; confidence: number; source: 'rule' | 'ml' | 'manual' } | null {
  const searchText = `${merchantName} ${text}`.toLowerCase();

  const sortedRules = [...rules].sort((a, b) => b.priority - a.priority);

  for (const rule of sortedRules) {
    for (const pattern of rule.patterns) {
      if (matchesPattern(searchText, pattern)) {
        return {
          categoryId: rule.categoryId,
          categoryName: rule.categoryName,
          confidence: 0.85,
          source: 'rule',
        };
      }
    }
  }

  return null;
}

function categorizeLineItemByRules(item: ReceiptLineItem, rules: CategorizationRule[]): { categoryId: string; categoryName: string; confidence: number; source: 'rule' | 'ml' | 'manual' } | null {
  return categorizeByRules(item.description, '', rules);
}

export function categorizeReceipt(
  metadata: ReceiptMetadata,
  lineItems: ReceiptLineItem[],
  ocrResult?: ReceiptOcrResult,
  customRules: CategorizationRule[] = []
): CategorizationResult {
  const allRules = [...customRules, ...DEFAULT_RULES];

  const merchantText = `${metadata.merchantName} ${metadata.merchantAddress || ''} ${metadata.merchantPhone || ''}`;
  const ocrText = ocrResult?.rawText || '';
  const combinedText = `${merchantText} ${ocrText}`;

  const receiptCategory = categorizeByRules(combinedText, metadata.merchantName, allRules) || {
    categoryId: 'cat_other',
    categoryName: 'Other',
    confidence: 0.3,
    source: 'rule' as const,
  };

  const categorizedLineItems: ReceiptLineItem[] = lineItems.map((item) => {
    const itemCategory = categorizeLineItemByRules(item, allRules);
    if (itemCategory) {
      return { ...item, category: itemCategory.categoryName };
    }
    return { ...item, category: receiptCategory.categoryName };
  });

  const categories: ReceiptCategory[] = [
    {
      id: receiptCategory.categoryId,
      name: receiptCategory.categoryName,
      confidence: receiptCategory.confidence,
      source: receiptCategory.source,
    },
  ];

  const uniqueCategories = new Map<string, ReceiptCategory>();
  for (const item of categorizedLineItems) {
    if (item.category) {
      const existing = uniqueCategories.get(item.category);
      if (!existing) {
        uniqueCategories.set(item.category, {
          id: `cat_${item.category.toLowerCase().replace(/\s+/g, '_')}`,
          name: item.category,
          confidence: 0.75,
          source: 'rule',
        });
      }
    }
  }

  for (const cat of uniqueCategories.values()) {
    if (!categories.some((c) => c.id === cat.id)) {
      categories.push(cat);
    }
  }

  return { categories, categorizedLineItems };
}

export function getDefaultRules(): CategorizationRule[] {
  return [...DEFAULT_RULES];
}

export function addCustomRule(rule: CategorizationRule): CategorizationRule[] {
  return [rule, ...DEFAULT_RULES];
}