import { categorizeReceipt, getDefaultRules, addCustomRule, CategorizationRule } from './categorize';
import { ReceiptMetadata, ReceiptLineItem, ReceiptOcrResult } from '../types/receipt';

describe('Categorization Service', () => {
  const sampleMetadata: ReceiptMetadata = {
    merchantName: 'Starbucks Coffee',
    merchantAddress: '123 Main St',
    transactionDate: '2024-01-15',
    subtotal: 8.50,
    tax: 0.75,
    total: 9.25,
    currency: 'USD',
  };

  const sampleLineItems: ReceiptLineItem[] = [
    { description: 'Grande Latte', quantity: 1, unitPrice: 5.50, total: 5.50 },
    { description: 'Blueberry Muffin', quantity: 1, unitPrice: 3.00, total: 3.00 },
  ];

  const sampleOcrResult: ReceiptOcrResult = {
    rawText: 'Starbucks Coffee\nGrande Latte $5.50\nBlueberry Muffin $3.00\nSubtotal $8.50\nTax $0.75\nTotal $9.25',
    confidence: 95,
    extractedFields: { Merchant: 'Starbucks Coffee', Total: '$9.25' },
    lineItems: sampleLineItems,
    processingTimeMs: 1000,
    engine: 'textract',
  };

  describe('categorizeReceipt', () => {
    it('should categorize food & dining receipts', () => {
      const result = categorizeReceipt(sampleMetadata, sampleLineItems, sampleOcrResult);

      expect(result.categories).toHaveLength(1);
      expect(result.categories[0].name).toBe('Food & Dining');
      expect(result.categories[0].source).toBe('rule');
      expect(result.categories[0].confidence).toBe(0.85);
    });

    it('should categorize transportation receipts (Uber)', () => {
      const uberMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Uber Ride',
        total: 25.00,
      };
      const uberLineItems: ReceiptLineItem[] = [
        { description: 'UberX Ride', quantity: 1, unitPrice: 25.00, total: 25.00 },
      ];

      const result = categorizeReceipt(uberMetadata, uberLineItems);

      expect(result.categories[0].name).toBe('Transportation');
    });

    it('should categorize gas station receipts', () => {
      const gasMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Shell Gas Station',
        total: 45.00,
      };
      const gasLineItems: ReceiptLineItem[] = [
        { description: 'Regular Unleaded', quantity: 15, unitPrice: 3.00, total: 45.00 },
      ];

      const result = categorizeReceipt(gasMetadata, gasLineItems);

      expect(result.categories[0].name).toBe('Transportation');
    });

    it('should categorize shopping receipts (Amazon)', () => {
      const amazonMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Amazon.com',
        total: 89.99,
      };
      const amazonLineItems: ReceiptLineItem[] = [
        { description: 'Wireless Headphones', quantity: 1, unitPrice: 89.99, total: 89.99 },
      ];

      const result = categorizeReceipt(amazonMetadata, amazonLineItems);

      expect(result.categories[0].name).toBe('Shopping');
    });

    it('should categorize entertainment receipts (Netflix)', () => {
      const netflixMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Netflix.com',
        total: 15.99,
      };
      const netflixLineItems: ReceiptLineItem[] = [
        { description: 'Standard Plan', quantity: 1, unitPrice: 15.99, total: 15.99 },
      ];

      const result = categorizeReceipt(netflixMetadata, netflixLineItems);

      expect(result.categories[0].name).toBe('Entertainment');
    });

    it('should categorize health receipts (CVS Pharmacy)', () => {
      const cvsMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'CVS Pharmacy',
        total: 32.50,
      };
      const cvsLineItems: ReceiptLineItem[] = [
        { description: 'Prescription', quantity: 1, unitPrice: 25.00, total: 25.00 },
        { description: 'Vitamins', quantity: 1, unitPrice: 7.50, total: 7.50 },
      ];

      const result = categorizeReceipt(cvsMetadata, cvsLineItems);

      expect(result.categories[0].name).toBe('Health & Wellness');
    });

    it('should categorize travel receipts (Hotel)', () => {
      const hotelMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Marriott Hotel',
        total: 299.00,
      };
      const hotelLineItems: ReceiptLineItem[] = [
        { description: 'Deluxe Room - 2 Nights', quantity: 1, unitPrice: 299.00, total: 299.00 },
      ];

      const result = categorizeReceipt(hotelMetadata, hotelLineItems);

      expect(result.categories[0].name).toBe('Travel');
    });

    it('should categorize utilities receipts', () => {
      const utilityMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Comcast Xfinity',
        total: 89.99,
      };
      const utilityLineItems: ReceiptLineItem[] = [
        { description: 'Internet Service', quantity: 1, unitPrice: 89.99, total: 89.99 },
      ];

      const result = categorizeReceipt(utilityMetadata, utilityLineItems);

      expect(result.categories[0].name).toBe('Utilities');
    });

    it('should categorize education receipts', () => {
      const eduMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'University Bookstore',
        total: 150.00,
      };
      const eduLineItems: ReceiptLineItem[] = [
        { description: 'Textbook - Calculus', quantity: 1, unitPrice: 150.00, total: 150.00 },
      ];

      const result = categorizeReceipt(eduMetadata, eduLineItems);

      expect(result.categories[0].name).toBe('Education');
    });

    it('should categorize business receipts (AWS)', () => {
      const awsMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Amazon Web Services',
        total: 125.50,
      };
      const awsLineItems: ReceiptLineItem[] = [
        { description: 'EC2 Instances', quantity: 1, unitPrice: 125.50, total: 125.50 },
      ];

      const result = categorizeReceipt(awsMetadata, awsLineItems);

      expect(result.categories[0].name).toBe('Business');
    });

    it('should default to "Other" for unrecognized merchants', () => {
      const unknownMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Unknown Merchant XYZ',
        total: 50.00,
      };
      const unknownLineItems: ReceiptLineItem[] = [
        { description: 'Mystery Item', quantity: 1, unitPrice: 50.00, total: 50.00 },
      ];

      const result = categorizeReceipt(unknownMetadata, unknownLineItems);

      expect(result.categories[0].name).toBe('Other');
      expect(result.categories[0].confidence).toBe(0.3);
    });

    it('should categorize individual line items', () => {
      const mixedMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Walmart Supercenter',
        total: 100.00,
      };
      const mixedLineItems: ReceiptLineItem[] = [
        { description: 'Groceries - Milk & Bread', quantity: 1, unitPrice: 10.00, total: 10.00 },
        { description: 'Electronics - USB Cable', quantity: 1, unitPrice: 15.00, total: 15.00 },
        { description: 'Clothing - T-Shirt', quantity: 2, unitPrice: 12.50, total: 25.00 },
      ];

      const result = categorizeReceipt(mixedMetadata, mixedLineItems);

      expect(result.categorizedLineItems).toHaveLength(3);
      expect(result.categorizedLineItems[0].category).toBe('Food & Dining');
      expect(result.categorizedLineItems[1].category).toBe('Shopping');
      expect(result.categorizedLineItems[2].category).toBe('Shopping');
    });

    it('should include line item categories in the categories list', () => {
      const mixedMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Walmart Supercenter',
        total: 100.00,
      };
      const mixedLineItems: ReceiptLineItem[] = [
        { description: 'Groceries - Milk & Bread', quantity: 1, unitPrice: 10.00, total: 10.00 },
        { description: 'Electronics - USB Cable', quantity: 1, unitPrice: 15.00, total: 15.00 },
      ];

      const result = categorizeReceipt(mixedMetadata, mixedLineItems);

      const categoryNames = result.categories.map((c) => c.name);
      expect(categoryNames).toContain('Food & Dining');
      expect(categoryNames).toContain('Shopping');
    });

    it('should use custom rules when provided', () => {
      const customRule: CategorizationRule = {
        id: 'custom_crypto',
        name: 'Cryptocurrency',
        patterns: ['coinbase', 'binance', 'kraken', 'crypto'],
        categoryId: 'cat_crypto',
        categoryName: 'Cryptocurrency',
        priority: 20,
      };

      const cryptoMetadata: ReceiptMetadata = {
        ...sampleMetadata,
        merchantName: 'Coinbase',
        total: 1000.00,
      };
      const cryptoLineItems: ReceiptLineItem[] = [
        { description: 'Bitcoin Purchase', quantity: 1, unitPrice: 1000.00, total: 1000.00 },
      ];

      const result = categorizeReceipt(cryptoMetadata, cryptoLineItems, undefined, [customRule]);

      expect(result.categories[0].name).toBe('Cryptocurrency');
      expect(result.categories[0].confidence).toBe(0.85);
    });

    it('should prioritize higher priority rules', () => {
      const highPriorityRule: CategorizationRule = {
        id: 'high_priority_food',
        name: 'Premium Dining',
        patterns: ['starbucks'],
        categoryId: 'cat_premium_food',
        categoryName: 'Premium Dining',
        priority: 100,
      };

      const result = categorizeReceipt(sampleMetadata, sampleLineItems, sampleOcrResult, [highPriorityRule]);

      expect(result.categories[0].name).toBe('Premium Dining');
    });

    it('should work without OCR result', () => {
      const result = categorizeReceipt(sampleMetadata, sampleLineItems);

      expect(result.categories[0].name).toBe('Food & Dining');
    });

    it('should work with empty line items', () => {
      const result = categorizeReceipt(sampleMetadata, [], sampleOcrResult);

      expect(result.categories[0].name).toBe('Food & Dining');
      expect(result.categorizedLineItems).toHaveLength(0);
    });
  });

  describe('getDefaultRules', () => {
    it('should return all default rules', () => {
      const rules = getDefaultRules();

      expect(rules.length).toBeGreaterThan(5);
      expect(rules.some((r) => r.name === 'Food & Dining')).toBe(true);
      expect(rules.some((r) => r.name === 'Transportation')).toBe(true);
      expect(rules.some((r) => r.name === 'Shopping')).toBe(true);
    });

    it('should return a copy (not the original array)', () => {
      const rules1 = getDefaultRules();
      const rules2 = getDefaultRules();

      expect(rules1).not.toBe(rules2);
    });
  });

  describe('addCustomRule', () => {
    it('should prepend custom rule to default rules', () => {
      const customRule: CategorizationRule = {
        id: 'test_custom',
        name: 'Test Category',
        patterns: ['test'],
        categoryId: 'cat_test',
        categoryName: 'Test Category',
        priority: 50,
      };

      const rules = addCustomRule(customRule);

      expect(rules[0]).toEqual(customRule);
      expect(rules.length).toBe(getDefaultRules().length + 1);
    });
  });
});