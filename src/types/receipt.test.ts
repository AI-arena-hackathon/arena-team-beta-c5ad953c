import {
  validateReceiptLineItem,
  validateReceiptMetadata,
  validateReceiptImage,
  validateReceiptOcrResult,
  validateReceiptCategory,
  validateReceipt,
  validateCreateReceiptInput,
  validateUpdateReceiptInput,
  Receipt,
  ReceiptLineItem,
  ReceiptMetadata,
  ReceiptImage,
  ReceiptOcrResult,
  ReceiptCategory,
  CreateReceiptInput,
  UpdateReceiptInput,
  RECEIPT_STATUS_VALUES,
  OCR_ENGINE_VALUES,
  CATEGORY_SOURCE_VALUES,
} from './receipt';

describe('Receipt Types Validation', () => {
  const validLineItem: ReceiptLineItem = {
    description: 'Coffee',
    quantity: 2,
    unitPrice: 3.5,
    total: 7.0,
    category: 'Food & Drink',
  };

  const validMetadata: ReceiptMetadata = {
    merchantName: 'Starbucks',
    merchantAddress: '123 Main St',
    merchantPhone: '555-1234',
    transactionDate: '2024-01-15',
    transactionTime: '14:30',
    subtotal: 10.0,
    tax: 1.0,
    tip: 2.0,
    total: 13.0,
    currency: 'USD',
    paymentMethod: 'Visa',
    cardLast4: '1234',
  };

  const validImage: ReceiptImage = {
    s3Key: 'receipts/user123/receipt_123.jpg',
    s3Bucket: 'receipts-bucket',
    contentType: 'image/jpeg',
    size: 102400,
    width: 1920,
    height: 1080,
  };

  const validOcrResult: ReceiptOcrResult = {
    rawText: 'STARBUCKS\nCoffee 2x $3.50\nTotal $13.00',
    confidence: 0.95,
    extractedFields: {
      merchant: 'Starbucks',
      total: '13.00',
      date: '2024-01-15',
    },
    lineItems: [validLineItem],
    processingTimeMs: 1500,
    engine: 'textract',
  };

  const validCategory: ReceiptCategory = {
    id: 'cat_food',
    name: 'Food & Drink',
    confidence: 0.9,
    source: 'rule',
  };

  const validReceipt: Receipt = {
    receiptId: 'receipt_123',
    userId: 'user_456',
    metadata: validMetadata,
    lineItems: [validLineItem],
    images: [validImage],
    ocrResult: validOcrResult,
    categories: [validCategory],
    status: 'completed',
    createdAt: '2024-01-15T14:30:00.000Z',
    updatedAt: '2024-01-15T14:30:00.000Z',
    version: 1,
  };

  const validCreateInput: CreateReceiptInput = {
    userId: 'user_456',
    metadata: validMetadata,
    lineItems: [validLineItem],
    images: [validImage],
    ocrResult: validOcrResult,
  };

  describe('validateReceiptLineItem', () => {
    it('should return true for valid line item', () => {
      expect(validateReceiptLineItem(validLineItem)).toBe(true);
    });

    it('should return true for line item without category', () => {
      const item = { ...validLineItem };
      delete item.category;
      expect(validateReceiptLineItem(item)).toBe(true);
    });

    it('should return false for missing description', () => {
      const item = { ...validLineItem };
      delete (item as Record<string, unknown>).description;
      expect(validateReceiptLineItem(item)).toBe(false);
    });

    it('should return false for non-string description', () => {
      const item = { ...validLineItem, description: 123 };
      expect(validateReceiptLineItem(item)).toBe(false);
    });

    it('should return false for missing quantity', () => {
      const item = { ...validLineItem };
      delete (item as Record<string, unknown>).quantity;
      expect(validateReceiptLineItem(item)).toBe(false);
    });

    it('should return false for non-number quantity', () => {
      const item = { ...validLineItem, quantity: 'two' };
      expect(validateReceiptLineItem(item)).toBe(false);
    });

    it('should return false for missing unitPrice', () => {
      const item = { ...validLineItem };
      delete (item as Record<string, unknown>).unitPrice;
      expect(validateReceiptLineItem(item)).toBe(false);
    });

    it('should return false for missing total', () => {
      const item = { ...validLineItem };
      delete (item as Record<string, unknown>).total;
      expect(validateReceiptLineItem(item)).toBe(false);
    });

    it('should return false for null', () => {
      expect(validateReceiptLineItem(null)).toBe(false);
    });

    it('should return false for non-object', () => {
      expect(validateReceiptLineItem('string')).toBe(false);
    });
  });

  describe('validateReceiptMetadata', () => {
    it('should return true for valid metadata', () => {
      expect(validateReceiptMetadata(validMetadata)).toBe(true);
    });

    it('should return true for minimal valid metadata', () => {
      const minimal = {
        merchantName: 'Test',
        transactionDate: '2024-01-15',
        subtotal: 10,
        tax: 1,
        total: 11,
        currency: 'USD',
      };
      expect(validateReceiptMetadata(minimal)).toBe(true);
    });

    it('should return false for missing merchantName', () => {
      const meta = { ...validMetadata };
      delete (meta as Record<string, unknown>).merchantName;
      expect(validateReceiptMetadata(meta)).toBe(false);
    });

    it('should return false for missing transactionDate', () => {
      const meta = { ...validMetadata };
      delete (meta as Record<string, unknown>).transactionDate;
      expect(validateReceiptMetadata(meta)).toBe(false);
    });

    it('should return false for missing subtotal', () => {
      const meta = { ...validMetadata };
      delete (meta as Record<string, unknown>).subtotal;
      expect(validateReceiptMetadata(meta)).toBe(false);
    });

    it('should return false for missing tax', () => {
      const meta = { ...validMetadata };
      delete (meta as Record<string, unknown>).tax;
      expect(validateReceiptMetadata(meta)).toBe(false);
    });

    it('should return false for missing total', () => {
      const meta = { ...validMetadata };
      delete (meta as Record<string, unknown>).total;
      expect(validateReceiptMetadata(meta)).toBe(false);
    });

    it('should return false for missing currency', () => {
      const meta = { ...validMetadata };
      delete (meta as Record<string, unknown>).currency;
      expect(validateReceiptMetadata(meta)).toBe(false);
    });

    it('should return false for non-string merchantName', () => {
      const meta = { ...validMetadata, merchantName: 123 as any };
      expect(validateReceiptMetadata(meta)).toBe(false);
    });

    it('should return false for non-number subtotal', () => {
      const meta = { ...validMetadata, subtotal: 'ten' };
      expect(validateReceiptMetadata(meta)).toBe(false);
    });

    it('should return false for null', () => {
      expect(validateReceiptMetadata(null)).toBe(false);
    });
  });

  describe('validateReceiptImage', () => {
    it('should return true for valid image', () => {
      expect(validateReceiptImage(validImage)).toBe(true);
    });

    it('should return true for image without width/height', () => {
      const img = { ...validImage };
      delete img.width;
      delete img.height;
      expect(validateReceiptImage(img)).toBe(true);
    });

    it('should return false for missing s3Key', () => {
      const img = { ...validImage };
      delete (img as Record<string, unknown>).s3Key;
      expect(validateReceiptImage(img)).toBe(false);
    });

    it('should return false for missing s3Bucket', () => {
      const img = { ...validImage };
      delete (img as Record<string, unknown>).s3Bucket;
      expect(validateReceiptImage(img)).toBe(false);
    });

    it('should return false for missing contentType', () => {
      const img = { ...validImage };
      delete (img as Record<string, unknown>).contentType;
      expect(validateReceiptImage(img)).toBe(false);
    });

    it('should return false for missing size', () => {
      const img = { ...validImage };
      delete (img as Record<string, unknown>).size;
      expect(validateReceiptImage(img)).toBe(false);
    });

    it('should return false for non-string s3Key', () => {
      const img = { ...validImage, s3Key: 123 };
      expect(validateReceiptImage(img)).toBe(false);
    });

    it('should return false for non-number size', () => {
      const img = { ...validImage, size: 'large' };
      expect(validateReceiptImage(img)).toBe(false);
    });

    it('should return false for null', () => {
      expect(validateReceiptImage(null)).toBe(false);
    });
  });

  describe('validateReceiptOcrResult', () => {
    it('should return true for valid OCR result', () => {
      expect(validateReceiptOcrResult(validOcrResult)).toBe(true);
    });

    it('should return true for tesseract engine', () => {
      const ocr = { ...validOcrResult, engine: 'tesseract' as const };
      expect(validateReceiptOcrResult(ocr)).toBe(true);
    });

    it('should return false for missing rawText', () => {
      const ocr = { ...validOcrResult };
      delete (ocr as Record<string, unknown>).rawText;
      expect(validateReceiptOcrResult(ocr)).toBe(false);
    });

    it('should return false for missing confidence', () => {
      const ocr = { ...validOcrResult };
      delete (ocr as Record<string, unknown>).confidence;
      expect(validateReceiptOcrResult(ocr)).toBe(false);
    });

    it('should return false for missing extractedFields', () => {
      const ocr = { ...validOcrResult };
      delete (ocr as Record<string, unknown>).extractedFields;
      expect(validateReceiptOcrResult(ocr)).toBe(false);
    });

    it('should return false for missing lineItems', () => {
      const ocr = { ...validOcrResult };
      delete (ocr as Record<string, unknown>).lineItems;
      expect(validateReceiptOcrResult(ocr)).toBe(false);
    });

    it('should return false for missing processingTimeMs', () => {
      const ocr = { ...validOcrResult };
      delete (ocr as Record<string, unknown>).processingTimeMs;
      expect(validateReceiptOcrResult(ocr)).toBe(false);
    });

    it('should return false for missing engine', () => {
      const ocr = { ...validOcrResult };
      delete (ocr as Record<string, unknown>).engine;
      expect(validateReceiptOcrResult(ocr)).toBe(false);
    });

    it('should return false for invalid engine', () => {
      const ocr = { ...validOcrResult, engine: 'invalid' };
      expect(validateReceiptOcrResult(ocr)).toBe(false);
    });

    it('should return false for invalid line items', () => {
      const ocr = { ...validOcrResult, lineItems: [{ description: 'test' }] };
      expect(validateReceiptOcrResult(ocr)).toBe(false);
    });

    it('should return false for null', () => {
      expect(validateReceiptOcrResult(null)).toBe(false);
    });
  });

  describe('validateReceiptCategory', () => {
    it('should return true for valid category', () => {
      expect(validateReceiptCategory(validCategory)).toBe(true);
    });

    it('should return true for ml source', () => {
      const cat = { ...validCategory, source: 'ml' as const };
      expect(validateReceiptCategory(cat)).toBe(true);
    });

    it('should return true for manual source', () => {
      const cat = { ...validCategory, source: 'manual' as const };
      expect(validateReceiptCategory(cat)).toBe(true);
    });

    it('should return false for missing id', () => {
      const cat = { ...validCategory };
      delete (cat as Record<string, unknown>).id;
      expect(validateReceiptCategory(cat)).toBe(false);
    });

    it('should return false for missing name', () => {
      const cat = { ...validCategory };
      delete (cat as Record<string, unknown>).name;
      expect(validateReceiptCategory(cat)).toBe(false);
    });

    it('should return false for missing confidence', () => {
      const cat = { ...validCategory };
      delete (cat as Record<string, unknown>).confidence;
      expect(validateReceiptCategory(cat)).toBe(false);
    });

    it('should return false for missing source', () => {
      const cat = { ...validCategory };
      delete (cat as Record<string, unknown>).source;
      expect(validateReceiptCategory(cat)).toBe(false);
    });

    it('should return false for invalid source', () => {
      const cat = { ...validCategory, source: 'invalid' };
      expect(validateReceiptCategory(cat)).toBe(false);
    });

    it('should return false for non-number confidence', () => {
      const cat = { ...validCategory, confidence: 'high' };
      expect(validateReceiptCategory(cat)).toBe(false);
    });

    it('should return false for null', () => {
      expect(validateReceiptCategory(null)).toBe(false);
    });
  });

  describe('validateReceipt', () => {
    it('should return true for valid receipt', () => {
      expect(validateReceipt(validReceipt)).toBe(true);
    });

    it('should return true for receipt without ocrResult', () => {
      const receipt = { ...validReceipt };
      delete receipt.ocrResult;
      expect(validateReceipt(receipt)).toBe(true);
    });

    it('should return true for receipt with empty arrays', () => {
      const receipt = { ...validReceipt, lineItems: [], images: [], categories: [] };
      expect(validateReceipt(receipt)).toBe(true);
    });

    it('should return false for missing receiptId', () => {
      const receipt = { ...validReceipt };
      delete (receipt as Record<string, unknown>).receiptId;
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for missing userId', () => {
      const receipt = { ...validReceipt };
      delete (receipt as Record<string, unknown>).userId;
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for missing metadata', () => {
      const receipt = { ...validReceipt };
      delete (receipt as Record<string, unknown>).metadata;
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for invalid metadata', () => {
      const receipt = { ...validReceipt, metadata: { ...validMetadata, merchantName: 123 } };
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for missing lineItems', () => {
      const receipt = { ...validReceipt };
      delete (receipt as Record<string, unknown>).lineItems;
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for non-array lineItems', () => {
      const receipt = { ...validReceipt, lineItems: 'not an array' as unknown };
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for invalid line item in array', () => {
      const receipt = { ...validReceipt, lineItems: [validLineItem, { description: 'bad' } as any] };
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for missing images', () => {
      const receipt = { ...validReceipt };
      delete (receipt as Record<string, unknown>).images;
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for invalid image in array', () => {
      const receipt = { ...validReceipt, images: [validImage, { s3Key: 'test' } as any] };
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for invalid ocrResult', () => {
      const receipt = { ...validReceipt, ocrResult: { rawText: 'test' } as any };
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for missing categories', () => {
      const receipt = { ...validReceipt };
      delete (receipt as Record<string, unknown>).categories;
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for invalid category in array', () => {
      const receipt = { ...validReceipt, categories: [validCategory, { id: 'bad' } as any] };
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for invalid status', () => {
      const receipt = { ...validReceipt, status: 'invalid' as Receipt['status'] };
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for missing createdAt', () => {
      const receipt = { ...validReceipt };
      delete (receipt as Record<string, unknown>).createdAt;
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for missing updatedAt', () => {
      const receipt = { ...validReceipt };
      delete (receipt as Record<string, unknown>).updatedAt;
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for missing version', () => {
      const receipt = { ...validReceipt };
      delete (receipt as Record<string, unknown>).version;
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for non-number version', () => {
      const receipt = { ...validReceipt, version: '1' as unknown };
      expect(validateReceipt(receipt)).toBe(false);
    });

    it('should return false for null', () => {
      expect(validateReceipt(null)).toBe(false);
    });

    it('should accept all valid status values', () => {
      RECEIPT_STATUS_VALUES.forEach((status) => {
        const receipt = { ...validReceipt, status };
        expect(validateReceipt(receipt)).toBe(true);
      });
    });
  });

  describe('validateCreateReceiptInput', () => {
    it('should return true for valid create input', () => {
      expect(validateCreateReceiptInput(validCreateInput)).toBe(true);
    });

    it('should return true for create input without ocrResult', () => {
      const input = { ...validCreateInput };
      delete input.ocrResult;
      expect(validateCreateReceiptInput(input)).toBe(true);
    });

    it('should return false for missing userId', () => {
      const input = { ...validCreateInput };
      delete (input as Record<string, unknown>).userId;
      expect(validateCreateReceiptInput(input)).toBe(false);
    });

    it('should return false for missing metadata', () => {
      const input = { ...validCreateInput };
      delete (input as Record<string, unknown>).metadata;
      expect(validateCreateReceiptInput(input)).toBe(false);
    });

    it('should return false for missing lineItems', () => {
      const input = { ...validCreateInput };
      delete (input as Record<string, unknown>).lineItems;
      expect(validateCreateReceiptInput(input)).toBe(false);
    });

    it('should return false for missing images', () => {
      const input = { ...validCreateInput };
      delete (input as Record<string, unknown>).images;
      expect(validateCreateReceiptInput(input)).toBe(false);
    });

    it('should return false for invalid metadata', () => {
      const input = { ...validCreateInput, metadata: { ...validMetadata, merchantName: 123 as any } };
      expect(validateCreateReceiptInput(input)).toBe(false);
    });

    it('should return false for invalid line item', () => {
      const input = { ...validCreateInput, lineItems: [validLineItem, { description: 'bad' } as any] };
      expect(validateCreateReceiptInput(input)).toBe(false);
    });

    it('should return false for invalid image', () => {
      const input = { ...validCreateInput, images: [validImage, { s3Key: 'test' } as any] };
      expect(validateCreateReceiptInput(input)).toBe(false);
    });

    it('should return false for invalid ocrResult', () => {
      const input = { ...validCreateInput, ocrResult: { rawText: 'test' } as any };
      expect(validateCreateReceiptInput(input)).toBe(false);
    });

    it('should return false for null', () => {
      expect(validateCreateReceiptInput(null)).toBe(false);
    });
  });

  describe('validateUpdateReceiptInput', () => {
    it('should return true for valid update input with all fields', () => {
      const input: UpdateReceiptInput = {
        metadata: validMetadata,
        lineItems: [validLineItem],
        ocrResult: validOcrResult,
        categories: [validCategory],
        status: 'completed',
      };
      expect(validateUpdateReceiptInput(input)).toBe(true);
    });

    it('should return true for partial update input', () => {
      const input: UpdateReceiptInput = {
        status: 'processing',
      };
      expect(validateUpdateReceiptInput(input)).toBe(true);
    });

    it('should return true for empty update input', () => {
      expect(validateUpdateReceiptInput({})).toBe(true);
    });

    it('should return false for invalid metadata', () => {
      const input: UpdateReceiptInput = {
        metadata: { ...validMetadata, merchantName: 123 as any },
      };
      expect(validateUpdateReceiptInput(input)).toBe(false);
    });

    it('should return false for invalid lineItems', () => {
      const input: UpdateReceiptInput = {
        lineItems: [{ description: 'bad' } as any],
      };
      expect(validateUpdateReceiptInput(input)).toBe(false);
    });

    it('should return false for invalid ocrResult', () => {
      const input: UpdateReceiptInput = {
        ocrResult: { rawText: 'test' } as any,
      };
      expect(validateUpdateReceiptInput(input)).toBe(false);
    });

    it('should return false for invalid categories', () => {
      const input: UpdateReceiptInput = {
        categories: [{ id: 'bad' } as any],
      };
      expect(validateUpdateReceiptInput(input)).toBe(false);
    });

    it('should return false for invalid status', () => {
      const input: UpdateReceiptInput = {
        status: 'invalid' as Receipt['status'],
      };
      expect(validateUpdateReceiptInput(input)).toBe(false);
    });

    it('should accept all valid status values', () => {
      RECEIPT_STATUS_VALUES.forEach((status) => {
        const input: UpdateReceiptInput = { status };
        expect(validateUpdateReceiptInput(input)).toBe(true);
      });
    });

    it('should return false for null', () => {
      expect(validateUpdateReceiptInput(null)).toBe(false);
    });
  });

  describe('Constants', () => {
    it('should have correct RECEIPT_STATUS_VALUES', () => {
      expect(RECEIPT_STATUS_VALUES).toEqual(['pending', 'processing', 'completed', 'failed', 'archived']);
    });

    it('should have correct OCR_ENGINE_VALUES', () => {
      expect(OCR_ENGINE_VALUES).toEqual(['textract', 'tesseract']);
    });

    it('should have correct CATEGORY_SOURCE_VALUES', () => {
      expect(CATEGORY_SOURCE_VALUES).toEqual(['rule', 'ml', 'manual']);
    });
  });
});