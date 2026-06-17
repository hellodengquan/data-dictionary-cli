import { DatabaseMetadata, OutputConfig, BusinessConfig } from '../types';

export interface ExportContext {
  metadata: DatabaseMetadata;
  outputConfig: OutputConfig;
  businessConfig?: BusinessConfig;
}

export abstract class Exporter {
  protected context: ExportContext;

  constructor(context: ExportContext) {
    this.context = context;
  }

  abstract export(): Promise<string>;

  protected getTitle(): string {
    return this.context.outputConfig.title || 
           this.context.businessConfig?.title || 
           `${this.context.metadata.databaseName} 数据字典`;
  }

  protected getDescription(): string | undefined {
    return this.context.businessConfig?.description;
  }

  protected getVersion(): string | undefined {
    return this.context.businessConfig?.version;
  }

  protected getGeneratedBy(): string | undefined {
    return this.context.businessConfig?.generatedBy;
  }

  protected shouldIncludeForeignKeys(): boolean {
    return this.context.outputConfig.includeForeignKeys !== false;
  }

  protected shouldIncludeIndexes(): boolean {
    return this.context.outputConfig.includeIndexes !== false;
  }

  protected shouldIncludeTableOfContents(): boolean {
    return this.context.outputConfig.tableOfContents !== false;
  }

  protected formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  }

  protected getConstraintsDisplay(constraints: any[]): string[] {
    return constraints.map(c => {
      switch (c.type) {
        case 'PRIMARY KEY':
          return '主键';
        case 'FOREIGN KEY':
          return `外键 → ${c.foreignTable}.${c.foreignColumn}`;
        case 'UNIQUE':
          return '唯一';
        case 'NOT NULL':
          return '非空';
        case 'DEFAULT':
          return `默认: ${c.expression}`;
        case 'CHECK':
          return `检查: ${c.expression}`;
        default:
          return c.type;
      }
    });
  }

  protected getFinalDescription(column: any): string {
    return column.businessDescription || column.comment || '';
  }

  protected escapeHtml(text: string): string {
    if (!text) return '';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  protected escapeMarkdown(text: string): string {
    if (!text) return '';
    return text
      .replace(/\|/g, '\\|')
      .replace(/\n/g, '<br>');
  }

  protected createAnchorId(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
