import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  type QueryCommandInput,
  type ScanCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { getConfig } from '../config';
import {
  type Receipt,
  type CreateReceiptInput,
  type UpdateReceiptInput,
  type ReceiptQueryFilters,
  type ReceiptQueryResult,
  validateReceipt,
  validateCreateReceiptInput,
  validateUpdateReceiptInput,
} from '../types/receipt';

export class DynamoDBError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'DynamoDBError';
  }
}

export class ReceiptNotFoundError extends DynamoDBError {
  constructor(receiptId: string) {
    super(`Receipt not found: ${receiptId}`, 'RECEIPT_NOT_FOUND', 404);
    this.name = 'ReceiptNotFoundError';
  }
}

export class ReceiptValidationError extends DynamoDBError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'ReceiptValidationError';
  }
}

export class OptimisticLockError extends DynamoDBError {
  constructor(receiptId: string) {
    super(`Receipt has been modified by another process: ${receiptId}`, 'OPTIMISTIC_LOCK_ERROR', 409);
    this.name = 'OptimisticLockError';
  }
}

let documentClient: DynamoDBDocumentClient | null = null;

function getDocumentClient(): DynamoDBDocumentClient {
  if (!documentClient) {
    const config = getConfig();
    const client = new DynamoDBClient({
      region: config.aws.region,
      credentials: {
        accessKeyId: config.aws.accessKeyId,
        secretAccessKey: config.aws.secretAccessKey,
      },
      endpoint: config.dynamodb.endpoint,
    });
    documentClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertEmptyValues: true,
      },
    });
  }
  return documentClient;
}

export function resetDocumentClient(): void {
  documentClient = null;
}

function getTableName(): string {
  return getConfig().dynamodb.tableReceipts;
}

function generateReceiptId(): string {
  return `receipt_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

export async function createReceipt(input: CreateReceiptInput): Promise<Receipt> {
  if (!validateCreateReceiptInput(input)) {
    throw new ReceiptValidationError('Invalid receipt input data');
  }

  const now = getCurrentTimestamp();
  const receiptId = generateReceiptId();

  const receipt: Receipt = {
    receiptId,
    userId: input.userId,
    metadata: input.metadata,
    lineItems: input.lineItems,
    images: input.images,
    ocrResult: input.ocrResult,
    categories: [],
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  const client = getDocumentClient();
  try {
    await client.send(
      new PutCommand({
        TableName: getTableName(),
        Item: receipt,
        ConditionExpression: 'attribute_not_exists(receiptId)',
      })
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      throw new DynamoDBError(`Receipt already exists: ${receiptId}`, 'RECEIPT_EXISTS', 409);
    }
    throw new DynamoDBError(
      `Failed to create receipt: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'CREATE_FAILED'
    );
  }

  return receipt;
}

export async function getReceipt(receiptId: string, userId: string): Promise<Receipt> {
  const client = getDocumentClient();
  try {
    const result = await client.send(
      new GetCommand({
        TableName: getTableName(),
        Key: { receiptId, userId },
      })
    );

    if (!result.Item) {
      throw new ReceiptNotFoundError(receiptId);
    }

    if (!validateReceipt(result.Item)) {
      throw new DynamoDBError('Invalid receipt data in database', 'DATA_CORRUPTION', 500);
    }

    return result.Item;
  } catch (error) {
    if (error instanceof ReceiptNotFoundError) throw error;
    if (error instanceof DynamoDBError) throw error;
    throw new DynamoDBError(
      `Failed to get receipt: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'GET_FAILED'
    );
  }
}

export async function updateReceipt(
  receiptId: string,
  userId: string,
  input: UpdateReceiptInput
): Promise<Receipt> {
  if (!validateUpdateReceiptInput(input)) {
    throw new ReceiptValidationError('Invalid update input data');
  }

  const client = getDocumentClient();

  const current = await getReceipt(receiptId, userId);
  const newVersion = current.version + 1;
  const now = getCurrentTimestamp();

  const updateExpressions: string[] = [];
  const expressionAttributeNames: Record<string, string> = {};
  const expressionAttributeValues: Record<string, unknown> = {};

  updateExpressions.push('#version = :newVersion');
  expressionAttributeNames['#version'] = 'version';
  expressionAttributeValues[':newVersion'] = newVersion;

  updateExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';
  expressionAttributeValues[':updatedAt'] = now;

  if (input.metadata) {
    updateExpressions.push('#metadata = :metadata');
    expressionAttributeNames['#metadata'] = 'metadata';
    expressionAttributeValues[':metadata'] = input.metadata;
  }

  if (input.lineItems) {
    updateExpressions.push('#lineItems = :lineItems');
    expressionAttributeNames['#lineItems'] = 'lineItems';
    expressionAttributeValues[':lineItems'] = input.lineItems;
  }

  if (input.ocrResult) {
    updateExpressions.push('#ocrResult = :ocrResult');
    expressionAttributeNames['#ocrResult'] = 'ocrResult';
    expressionAttributeValues[':ocrResult'] = input.ocrResult;
  }

  if (input.categories) {
    updateExpressions.push('#categories = :categories');
    expressionAttributeNames['#categories'] = 'categories';
    expressionAttributeValues[':categories'] = input.categories;
  }

  if (input.status) {
    updateExpressions.push('#status = :status');
    expressionAttributeNames['#status'] = 'status';
    expressionAttributeValues[':status'] = input.status;
  }

  try {
    const result = await client.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { receiptId, userId },
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ConditionExpression: '#version = :currentVersion',
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: {
          ...expressionAttributeValues,
          ':currentVersion': current.version,
        },
        ReturnValues: 'ALL_NEW',
      })
    );

    if (!result.Attributes) {
      throw new ReceiptNotFoundError(receiptId);
    }

    if (!validateReceipt(result.Attributes)) {
      throw new DynamoDBError('Invalid receipt data after update', 'DATA_CORRUPTION', 500);
    }

    return result.Attributes;
  } catch (error) {
    if (error instanceof ReceiptNotFoundError) throw error;
    if (error instanceof DynamoDBError) throw error;
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      throw new OptimisticLockError(receiptId);
    }
    throw new DynamoDBError(
      `Failed to update receipt: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'UPDATE_FAILED'
    );
  }
}

export async function deleteReceipt(receiptId: string, userId: string): Promise<void> {
  const client = getDocumentClient();
  try {
    await client.send(
      new DeleteCommand({
        TableName: getTableName(),
        Key: { receiptId, userId },
        ConditionExpression: 'attribute_exists(receiptId)',
      })
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
      throw new ReceiptNotFoundError(receiptId);
    }
    throw new DynamoDBError(
      `Failed to delete receipt: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'DELETE_FAILED'
    );
  }
}

export async function queryReceipts(filters: ReceiptQueryFilters): Promise<ReceiptQueryResult> {
  const client = getDocumentClient();

  const {
    userId,
    startDate,
    endDate,
    status,
    categoryId,
    minAmount,
    maxAmount,
    limit = 50,
    lastEvaluatedKey,
  } = filters;

  const keyConditionExpression = 'userId = :userId';
  const expressionAttributeValues: Record<string, unknown> = {
    ':userId': userId,
  };
  const expressionAttributeNames: Record<string, string> = {};

  const filterExpressions: string[] = [];

  if (startDate) {
    filterExpressions.push('#createdAt >= :startDate');
    expressionAttributeNames['#createdAt'] = 'createdAt';
    expressionAttributeValues[':startDate'] = startDate;
  }

  if (endDate) {
    filterExpressions.push('#createdAt <= :endDate');
    expressionAttributeNames['#createdAt'] = 'createdAt';
    expressionAttributeValues[':endDate'] = endDate;
  }

  if (status) {
    filterExpressions.push('#status = :status');
    expressionAttributeNames['#status'] = 'status';
    expressionAttributeValues[':status'] = status;
  }

  if (categoryId) {
    filterExpressions.push('contains(#categories, :categoryId)');
    expressionAttributeNames['#categories'] = 'categories';
    expressionAttributeValues[':categoryId'] = categoryId;
  }

  if (minAmount !== undefined) {
    filterExpressions.push('#total >= :minAmount');
    expressionAttributeNames['#total'] = 'metadata.total';
    expressionAttributeValues[':minAmount'] = minAmount;
  }

  if (maxAmount !== undefined) {
    filterExpressions.push('#total <= :maxAmount');
    expressionAttributeNames['#total'] = 'metadata.total';
    expressionAttributeValues[':maxAmount'] = maxAmount;
  }

  const queryInput: QueryCommandInput = {
    TableName: getTableName(),
    KeyConditionExpression: keyConditionExpression,
    ExpressionAttributeValues: expressionAttributeValues,
    Limit: limit,
    ScanIndexForward: false,
  };

  if (Object.keys(expressionAttributeNames).length > 0) {
    queryInput.ExpressionAttributeNames = expressionAttributeNames;
  }

  if (filterExpressions.length > 0) {
    queryInput.FilterExpression = filterExpressions.join(' AND ');
  }

  if (lastEvaluatedKey) {
    queryInput.ExclusiveStartKey = lastEvaluatedKey;
  }

  try {
    const result = await client.send(new QueryCommand(queryInput));

    const items = (result.Items || []).filter(validateReceipt);

    return {
      items,
      lastEvaluatedKey: result.LastEvaluatedKey,
      count: items.length,
    };
  } catch (error) {
    throw new DynamoDBError(
      `Failed to query receipts: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'QUERY_FAILED'
    );
  }
}

export async function scanReceipts(
  userId: string,
  filters: Omit<ReceiptQueryFilters, 'userId'> = {},
  limit = 50
): Promise<ReceiptQueryResult> {
  const client = getDocumentClient();

  const {
    startDate,
    endDate,
    status,
    categoryId,
    minAmount,
    maxAmount,
    lastEvaluatedKey,
  } = filters;

  const expressionAttributeValues: Record<string, unknown> = {
    ':userId': userId,
  };
  const expressionAttributeNames: Record<string, string> = {};
  const filterExpressions: string[] = ['userId = :userId'];

  if (startDate) {
    filterExpressions.push('#createdAt >= :startDate');
    expressionAttributeNames['#createdAt'] = 'createdAt';
    expressionAttributeValues[':startDate'] = startDate;
  }

  if (endDate) {
    filterExpressions.push('#createdAt <= :endDate');
    expressionAttributeNames['#createdAt'] = 'createdAt';
    expressionAttributeValues[':endDate'] = endDate;
  }

  if (status) {
    filterExpressions.push('#status = :status');
    expressionAttributeNames['#status'] = 'status';
    expressionAttributeValues[':status'] = status;
  }

  if (categoryId) {
    filterExpressions.push('contains(#categories, :categoryId)');
    expressionAttributeNames['#categories'] = 'categories';
    expressionAttributeValues[':categoryId'] = categoryId;
  }

  if (minAmount !== undefined) {
    filterExpressions.push('#total >= :minAmount');
    expressionAttributeNames['#total'] = 'metadata.total';
    expressionAttributeValues[':minAmount'] = minAmount;
  }

  if (maxAmount !== undefined) {
    filterExpressions.push('#total <= :maxAmount');
    expressionAttributeNames['#total'] = 'metadata.total';
    expressionAttributeValues[':maxAmount'] = maxAmount;
  }

  const scanInput: ScanCommandInput = {
    TableName: getTableName(),
    FilterExpression: filterExpressions.join(' AND '),
    ExpressionAttributeValues: expressionAttributeValues,
    Limit: limit,
  };

  if (Object.keys(expressionAttributeNames).length > 0) {
    scanInput.ExpressionAttributeNames = expressionAttributeNames;
  }

  if (lastEvaluatedKey) {
    scanInput.ExclusiveStartKey = lastEvaluatedKey;
  }

  try {
    const result = await client.send(new ScanCommand(scanInput));

    const items = (result.Items || []).filter(validateReceipt);

    return {
      items,
      lastEvaluatedKey: result.LastEvaluatedKey,
      count: items.length,
    };
  } catch (error) {
    throw new DynamoDBError(
      `Failed to scan receipts: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'SCAN_FAILED'
    );
  }
}

export async function getReceiptCountByUser(userId: string): Promise<number> {
  const client = getDocumentClient();

  try {
    const result = await client.send(
      new QueryCommand({
        TableName: getTableName(),
        KeyConditionExpression: 'userId = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        Select: 'COUNT',
      })
    );

    return result.Count || 0;
  } catch (error) {
    throw new DynamoDBError(
      `Failed to get receipt count: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'COUNT_FAILED'
    );
  }
}

export async function getReceiptsByStatus(
  userId: string,
  status: Receipt['status'],
  limit = 50
): Promise<ReceiptQueryResult> {
  return queryReceipts({ userId, status, limit });
}