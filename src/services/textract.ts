import { TextractClient, AnalyzeDocumentCommand, DetectDocumentTextCommand, type AnalyzeDocumentCommandInput, type DetectDocumentTextCommandInput, type Block, type DocumentMetadata } from '@aws-sdk/client-textract';
import { awsCredentials, getConfig } from '../config';
import { AppError } from '../utils/errors';

export class TextractError extends AppError {
  constructor(message: string, code: string, statusCode: number = 500) {
    super(message, code, statusCode);
    this.name = 'TextractError';
  }
}

export class TextractThrottledError extends TextractError {
  constructor(message = 'Textract request was throttled') {
    super(message, 'THROTTLED', 429);
    this.name = 'TextractThrottledError';
  }
}

export class TextractValidationError extends TextractError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
    this.name = 'TextractValidationError';
  }
}

let textractClient: TextractClient | null = null;

function getTextractClient(): TextractClient {
  if (!textractClient) {
    const config = getConfig();
    textractClient = new TextractClient({
      region: config.textract.region,
      credentials: awsCredentials(config),
    });
  }
  return textractClient;
}

export function resetTextractClient(): void {
  textractClient = null;
}

export interface TextractDetectTextInput {
  documentBytes: Buffer;
}

export interface TextractAnalyzeDocumentInput {
  documentBytes: Buffer;
  featureTypes: ('TABLES' | 'FORMS')[];
}

export interface TextractBlock {
  BlockType: string;
  Id: string;
  Text?: string;
  Confidence?: number;
  Geometry?: {
    BoundingBox: {
      Width: number;
      Height: number;
      Left: number;
      Top: number;
    };
    Polygon?: Array<{ X: number; Y: number }>;
  };
  Relationships?: Array<{
    Type: string;
    Ids: string[];
  }>;
  EntityTypes?: string[];
  SelectionStatus?: string;
  Page?: number;
  ColumnIndex?: number;
  RowIndex?: number;
  ColumnSpan?: number;
  RowSpan?: number;
}

export interface TextractResponse {
  Blocks: TextractBlock[];
  DocumentMetadata?: {
    Pages: number;
  };
  AnalyzeDocumentModelVersion?: string;
}

function mapBlock(block: Block): TextractBlock {
  return {
    BlockType: block.BlockType || '',
    Id: block.Id || '',
    Text: block.Text,
    Confidence: block.Confidence,
    Geometry: block.Geometry
      ? {
          BoundingBox: {
            Width: block.Geometry.BoundingBox?.Width || 0,
            Height: block.Geometry.BoundingBox?.Height || 0,
            Left: block.Geometry.BoundingBox?.Left || 0,
            Top: block.Geometry.BoundingBox?.Top || 0,
          },
          Polygon: block.Geometry.Polygon?.map((p) => ({ X: p.X || 0, Y: p.Y || 0 })),
        }
      : undefined,
    Relationships: block.Relationships?.map((r) => ({
      Type: r.Type || '',
      Ids: r.Ids || [],
    })),
    EntityTypes: block.EntityTypes,
    SelectionStatus: block.SelectionStatus,
    Page: block.Page,
    ColumnIndex: block.ColumnIndex,
    RowIndex: block.RowIndex,
    ColumnSpan: block.ColumnSpan,
    RowSpan: block.RowSpan,
  };
}

function mapDocumentMetadata(meta: DocumentMetadata | undefined): { Pages: number } | undefined {
  if (!meta || meta.Pages === undefined) return undefined;
  return { Pages: meta.Pages };
}

export async function detectDocumentText(input: TextractDetectTextInput): Promise<TextractResponse> {
  if (!input.documentBytes || input.documentBytes.length === 0) {
    throw new TextractValidationError('documentBytes is required and must not be empty');
  }

  const commandInput: DetectDocumentTextCommandInput = {
    Document: {
      Bytes: input.documentBytes,
    },
  };

  const client = getTextractClient();
  const command = new DetectDocumentTextCommand(commandInput);

  try {
    const result = await client.send(command);
    return {
      Blocks: (result.Blocks || []).map(mapBlock),
      DocumentMetadata: mapDocumentMetadata(result.DocumentMetadata),
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'ThrottlingException' || error.name === 'TooManyRequestsException') {
        throw new TextractThrottledError();
      }
      if (error.name === 'InvalidParameterException' || error.name === 'ValidationException') {
        throw new TextractValidationError(error.message);
      }
    }
    throw new TextractError(
      `Textract detect document text failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'DETECT_TEXT_FAILED'
    );
  }
}

export async function analyzeDocument(input: TextractAnalyzeDocumentInput): Promise<TextractResponse> {
  if (!input.documentBytes || input.documentBytes.length === 0) {
    throw new TextractValidationError('documentBytes is required and must not be empty');
  }
  if (!input.featureTypes || input.featureTypes.length === 0) {
    throw new TextractValidationError('featureTypes must include at least one of TABLES or FORMS');
  }

  const commandInput: AnalyzeDocumentCommandInput = {
    Document: {
      Bytes: input.documentBytes,
    },
    FeatureTypes: input.featureTypes,
  };

  const client = getTextractClient();
  const command = new AnalyzeDocumentCommand(commandInput);

  try {
    const result = await client.send(command);
    return {
      Blocks: (result.Blocks || []).map(mapBlock),
      DocumentMetadata: mapDocumentMetadata(result.DocumentMetadata),
      AnalyzeDocumentModelVersion: result.AnalyzeDocumentModelVersion,
    };
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'ThrottlingException' || error.name === 'TooManyRequestsException') {
        throw new TextractThrottledError();
      }
      if (error.name === 'InvalidParameterException' || error.name === 'ValidationException') {
        throw new TextractValidationError(error.message);
      }
    }
    throw new TextractError(
      `Textract analyze document failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'ANALYZE_DOCUMENT_FAILED'
    );
  }
}

export function extractRawText(blocks: TextractBlock[]): string {
  return blocks
    .filter((block) => block.BlockType === 'LINE' && block.Text)
    .map((block) => block.Text!)
    .join('\n');
}

export function extractKeyValuePairs(blocks: TextractBlock[]): Record<string, string> {
  const keyMap = new Map<string, TextractBlock>();
  const valueMap = new Map<string, TextractBlock>();
  const blockMap = new Map<string, TextractBlock>();

  for (const block of blocks) {
    blockMap.set(block.Id, block);
    if (block.BlockType === 'KEY_VALUE_SET') {
      if (block.EntityTypes?.includes('KEY')) {
        keyMap.set(block.Id, block);
      } else if (block.EntityTypes?.includes('VALUE')) {
        valueMap.set(block.Id, block);
      }
    }
  }

  const extracted: Record<string, string> = {};

  for (const [keyId, keyBlock] of keyMap.entries()) {
    const valueId = keyBlock.Relationships?.find((r) => r.Type === 'VALUE')?.Ids[0];
    if (valueId && valueMap.has(valueId)) {
      const valueBlock = valueMap.get(valueId)!;
      const keyText = getTextFromBlock(keyBlock, blockMap);
      const valueText = getTextFromBlock(valueBlock, blockMap);
      if (keyText && valueText) {
        extracted[keyText.trim()] = valueText.trim();
      }
    }
  }

  return extracted;
}

function getTextFromBlock(block: TextractBlock, blockMap: Map<string, TextractBlock>): string {
  const childIds = block.Relationships?.find((r) => r.Type === 'CHILD')?.Ids || [];
  return childIds
    .map((id) => blockMap.get(id)?.Text)
    .filter((text): text is string => typeof text === 'string')
    .join(' ');
}

export function extractTables(blocks: TextractBlock[]): Array<{
  rows: Array<Array<{ text: string; confidence: number }>>;
}> {
  const blockMap = new Map<string, TextractBlock>();
  for (const block of blocks) {
    blockMap.set(block.Id, block);
  }

  const tableBlocks = blocks.filter((b) => b.BlockType === 'TABLE');
  const tables: Array<{ rows: Array<Array<{ text: string; confidence: number }>> }> = [];

  for (const table of tableBlocks) {
    const rows = new Map<number, Map<number, TextractBlock>>();

    const cellIds = table.Relationships?.find((r) => r.Type === 'CHILD')?.Ids || [];
    for (const cellId of cellIds) {
      const cell = blockMap.get(cellId);
      if (cell && cell.BlockType === 'CELL') {
        const rowIndex = cell.RowIndex || 1;
        const colIndex = cell.ColumnIndex || 1;
        if (!rows.has(rowIndex)) rows.set(rowIndex, new Map());
        rows.get(rowIndex)!.set(colIndex, cell);
      }
    }

    const sortedRowIndices = Array.from(rows.keys()).sort((a, b) => a - b);
    const tableRows: Array<Array<{ text: string; confidence: number }>> = [];

    for (const rowIndex of sortedRowIndices) {
      const rowMap = rows.get(rowIndex)!;
      const sortedColIndices = Array.from(rowMap.keys()).sort((a, b) => a - b);
      const row: Array<{ text: string; confidence: number }> = [];

      for (const colIndex of sortedColIndices) {
        const cell = rowMap.get(colIndex)!;
        const cellText = getTextFromBlock(cell, blockMap);
        row.push({
          text: cellText,
          confidence: cell.Confidence || 0,
        });
      }
      tableRows.push(row);
    }

    tables.push({ rows: tableRows });
  }

  return tables;
}

export function isTextractEnabled(): boolean {
  return getConfig().textract.enabled;
}