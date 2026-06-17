import * as fs from 'fs';
import * as path from 'path';
import * as ejs from 'ejs';
import { Exporter, ExportContext } from './base';

export class HtmlExporter extends Exporter {
  constructor(context: ExportContext) {
    super(context);
  }

  async export(): Promise<string> {
    const templatePath = this.getTemplatePath();
    
    if (!fs.existsSync(templatePath)) {
      throw new Error(`Template not found: ${templatePath}`);
    }

    const templateContent = fs.readFileSync(templatePath, 'utf-8');
    const data = this.prepareTemplateData();

    return ejs.render(templateContent, data, {
      rmWhitespace: false
    });
  }

  private getTemplatePath(): string {
    if (this.context.outputConfig.template) {
      return path.resolve(this.context.outputConfig.template);
    }

    const theme = this.context.outputConfig.theme || 'light';
    const possiblePaths = [
      path.join(process.cwd(), 'templates', `html-${theme}.ejs`),
      path.join(__dirname, '..', '..', 'templates', `html-${theme}.ejs`),
      path.join(__dirname, '..', '..', 'templates', 'html.ejs')
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return path.join(__dirname, '..', '..', 'templates', 'html.ejs');
  }

  private prepareTemplateData(): any {
    const theme = this.context.outputConfig.theme || 'light';
    
    return {
      title: this.getTitle(),
      description: this.getDescription(),
      version: this.getVersion(),
      generatedBy: this.getGeneratedBy(),
      generatedAt: this.context.metadata.generatedAt,
      generatedAtFormatted: this.formatDate(this.context.metadata.generatedAt),
      database: {
        name: this.context.metadata.databaseName,
        type: this.context.metadata.databaseType,
        version: this.context.metadata.version
      },
      statistics: {
        tableCount: this.context.metadata.tables.length,
        columnCount: this.context.metadata.tables.reduce((sum, t) => sum + t.columns.length, 0)
      },
      tables: this.context.metadata.tables.map(table => this.prepareTableData(table)),
      theme,
      includeTableOfContents: this.shouldIncludeTableOfContents(),
      includeForeignKeys: this.shouldIncludeForeignKeys(),
      includeIndexes: this.shouldIncludeIndexes(),
      helper: {
        formatConstraints: (constraints: any[]) => this.getConstraintsDisplay(constraints),
        formatDescription: (column: any) => this.getFinalDescription(column),
        escapeHtml: (text: string) => this.escapeHtml(text),
        createAnchorId: (text: string) => this.createAnchorId(text),
        isPrimaryKey: (column: any) => column.constraints.some((c: any) => c.type === 'PRIMARY KEY'),
        isForeignKey: (column: any) => column.constraints.some((c: any) => c.type === 'FOREIGN KEY'),
        getForeignKeyInfo: (column: any) => {
          const fk = column.constraints.find((c: any) => c.type === 'FOREIGN KEY');
          return fk ? { table: fk.foreignTable, column: fk.foreignColumn } : null;
        },
        hasBusinessDescription: (item: any) => !!item.businessDescription,
        getConstraintBadge: (type: string) => this.getConstraintBadge(type)
      }
    };
  }

  private prepareTableData(table: any): any {
    return {
      ...table,
      anchorId: this.createAnchorId(table.name),
      description: table.businessDescription || table.comment,
      hasDescription: !!(table.businessDescription || table.comment),
      hasBusinessDescription: !!table.businessDescription,
      primaryKeyText: table.primaryKey?.join(', ') || '',
      hasPrimaryKey: table.primaryKey && table.primaryKey.length > 0,
      hasForeignKeys: this.shouldIncludeForeignKeys() && table.foreignKeys.length > 0,
      hasIndexes: this.shouldIncludeIndexes() && table.indexes.length > 0
    };
  }

  private getConstraintBadge(type: string): { class: string; text: string } {
    const badgeMap: Record<string, { class: string; text: string }> = {
      'PRIMARY KEY': { class: 'badge-primary', text: '主键' },
      'FOREIGN KEY': { class: 'badge-foreign', text: '外键' },
      'UNIQUE': { class: 'badge-unique', text: '唯一' },
      'NOT NULL': { class: 'badge-notnull', text: '非空' },
      'DEFAULT': { class: 'badge-default', text: '默认' },
      'CHECK': { class: 'badge-check', text: '检查' }
    };
    return badgeMap[type] || { class: 'badge-default', text: type };
  }
}
