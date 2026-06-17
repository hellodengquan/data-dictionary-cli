import { DatabaseMetadata, OutputConfig, BusinessConfig, TableInfo, ColumnInfo } from '../types';
import { getI18n, I18nDict, Lang } from '../i18n';

export interface ExportContext {
  metadata: DatabaseMetadata;
  outputConfig: OutputConfig;
  businessConfig?: BusinessConfig;
}

export abstract class Exporter {
  protected context: ExportContext;
  protected lang: Lang;
  protected i18n: I18nDict;

  constructor(context: ExportContext) {
    this.context = context;
    this.lang = (context.outputConfig.lang === 'en' ? 'en' : 'zh') as Lang;
    this.i18n = getI18n(this.lang);
  }

  abstract export(): Promise<string>;

  protected getTitle(): string {
    return this.context.outputConfig.title ||
           this.context.businessConfig?.title ||
           `${this.context.metadata.databaseName} ${this.i18n.titleDefault}`;
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
    const locale = this.lang === 'zh' ? 'zh-CN' : 'en-US';
    return date.toLocaleString(locale, {
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
    const t = this.i18n;
    return constraints.map(c => {
      switch (c.type) {
        case 'PRIMARY KEY': return t.primaryKey;
        case 'FOREIGN KEY': return this.lang === 'zh'
          ? `${t.foreignKey} → ${c.foreignTable}.${c.foreignColumn}`
          : `${t.foreignKey} → ${c.foreignTable}.${c.foreignColumn}`;
        case 'UNIQUE': return t.uniqueKey;
        case 'NOT NULL': return t.notNull;
        case 'DEFAULT': return this.lang === 'zh'
          ? `${t.defaultValue}: ${c.expression}`
          : `${t.defaultValue}: ${c.expression}`;
        case 'CHECK': return this.lang === 'zh'
          ? `${t.checkKey}: ${c.expression}`
          : `${t.checkKey}: ${c.expression}`;
        default: return c.type;
      }
    });
  }

  protected getConstraintBadgeInfo(type: string): { badge: string; text: string } {
    const t = this.i18n;
    switch (type) {
      case 'PRIMARY KEY': return { badge: 'badge-primary', text: t.primaryKey };
      case 'FOREIGN KEY': return { badge: 'badge-foreign', text: t.foreignKey };
      case 'UNIQUE': return { badge: 'badge-unique', text: t.uniqueKey };
      case 'NOT NULL': return { badge: 'badge-notnull', text: t.notNull };
      case 'DEFAULT': return { badge: 'badge-default', text: t.defaultValue };
      case 'CHECK': return { badge: 'badge-check', text: t.checkKey };
      default: return { badge: 'badge-default', text: type };
    }
  }

  protected getFinalDescription(column: ColumnInfo | any): string {
    return column.businessDescription || column.comment || '';
  }

  protected hasBusinessDescription(item: any): boolean {
    return !!item.businessDescription;
  }

  protected isPrimaryKey(column: ColumnInfo | any): boolean {
    return column.constraints?.some((c: any) => c.type === 'PRIMARY KEY');
  }

  protected isForeignKey(column: ColumnInfo | any): { table: string; column: string } | null {
    const fk = column.constraints?.find((c: any) => c.type === 'FOREIGN KEY');
    return fk ? { table: fk.foreignTable, column: fk.foreignColumn } : null;
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

  protected getAllTables(): TableInfo[] {
    return this.context.metadata.tables;
  }

  protected collectForeignKeyRelations(): Array<{
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
    name?: string;
  }> {
    const rels: any[] = [];
    const tables = this.getAllTables();
    const index = new Map(tables.map(t => [t.name.toLowerCase(), t]));

    for (const table of tables) {
      for (const fk of table.foreignKeys || []) {
        const fromCols = fk.columnName.split(',');
        const toCols = fk.foreignColumnName.split(',');
        for (let i = 0; i < fromCols.length; i++) {
          rels.push({
            fromTable: table.name,
            fromColumn: fromCols[i],
            toTable: fk.foreignTableName,
            toColumn: toCols[i] || toCols[0],
            name: fk.name
          });
        }
      }
      for (const col of table.columns) {
        const inFk = (table.foreignKeys || []).some(f => f.columnName.split(',').includes(col.name));
        if (!inFk) {
          const fk = this.isForeignKey(col);
          if (fk && index.has(fk.table.toLowerCase())) {
            rels.push({
              fromTable: table.name,
              fromColumn: col.name,
              toTable: fk.table,
              toColumn: fk.column,
              name: `${table.name}_${col.name}_inferred_fk`
            });
          }
        }
      }
    }

    return rels;
  }
}
