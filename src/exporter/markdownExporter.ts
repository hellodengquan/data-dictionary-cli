import { Exporter, ExportContext } from './base';

export class MarkdownExporter extends Exporter {
  constructor(context: ExportContext) {
    super(context);
  }

  async export(): Promise<string> {
    const sections: string[] = [];

    sections.push(this.generateHeader());
    sections.push(this.generateDatabaseInfo());
    sections.push(this.generateStatistics());
    
    if (this.shouldIncludeTableOfContents()) {
      sections.push(this.generateTableOfContents());
    }

    for (const table of this.context.metadata.tables) {
      sections.push(this.generateTableSection(table));
    }

    sections.push(this.generateFooter());

    return sections.join('\n\n---\n\n');
  }

  private generateHeader(): string {
    const lines: string[] = [];
    
    lines.push(`# ${this.getTitle()}`);
    lines.push('');
    
    const description = this.getDescription();
    if (description) {
      lines.push(description);
      lines.push('');
    }
    
    const version = this.getVersion();
    if (version) {
      lines.push(`**文档版本:** ${version}`);
      lines.push('');
    }
    
    return lines.join('\n');
  }

  private generateDatabaseInfo(): string {
    const lines: string[] = [];
    
    lines.push('## 数据库信息');
    lines.push('');
    lines.push('| 项 | 值 |');
    lines.push('| --- | --- |');
    lines.push(`| 数据库名称 | ${this.escapeMarkdown(this.context.metadata.databaseName)} |`);
    lines.push(`| 数据库类型 | ${this.context.metadata.databaseType.toUpperCase()} |`);
    
    if (this.context.metadata.version) {
      lines.push(`| 数据库版本 | ${this.escapeMarkdown(this.context.metadata.version)} |`);
    }
    
    lines.push(`| 生成时间 | ${this.formatDate(this.context.metadata.generatedAt)} |`);
    
    const generatedBy = this.getGeneratedBy();
    if (generatedBy) {
      lines.push(`| 生成者 | ${this.escapeMarkdown(generatedBy)} |`);
    }
    
    return lines.join('\n');
  }

  private generateStatistics(): string {
    const tableCount = this.context.metadata.tables.length;
    const columnCount = this.context.metadata.tables.reduce((sum, t) => sum + t.columns.length, 0);
    
    const lines: string[] = [];
    
    lines.push('## 统计信息');
    lines.push('');
    lines.push('| 项 | 数量 |');
    lines.push('| --- | --- |');
    lines.push(`| 表数量 | ${tableCount} |`);
    lines.push(`| 字段数量 | ${columnCount} |`);
    
    return lines.join('\n');
  }

  private generateTableOfContents(): string {
    const lines: string[] = [];
    
    lines.push('## 目录');
    lines.push('');
    
    for (let i = 0; i < this.context.metadata.tables.length; i++) {
      const table = this.context.metadata.tables[i];
      const anchor = this.createAnchorId(table.name);
      lines.push(`${i + 1}. [${table.name}](#${anchor})`);
      
      if (table.businessDescription || table.comment) {
        const desc = table.businessDescription || table.comment;
        lines.push(`   - ${this.escapeMarkdown(desc!)}`);
      }
    }
    
    return lines.join('\n');
  }

  private generateTableSection(table: any): string {
    const lines: string[] = [];
    const anchor = this.createAnchorId(table.name);
    
    lines.push(`<a id="${anchor}"></a>`);
    lines.push(`## ${table.name}`);
    lines.push('');
    
    const description = table.businessDescription || table.comment;
    if (description) {
      lines.push(`**说明:** ${this.escapeMarkdown(description)}`);
      lines.push('');
    }
    
    if (table.primaryKey && table.primaryKey.length > 0) {
      lines.push(`**主键:** ${table.primaryKey.join(', ')}`);
      lines.push('');
    }
    
    lines.push('### 字段列表');
    lines.push('');
    lines.push('| 序号 | 字段名 | 数据类型 | 可空 | 默认值 | 约束 | 说明 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    
    for (const column of table.columns) {
      const constraints = this.getConstraintsDisplay(column.constraints);
      const description = this.getFinalDescription(column);
      
      lines.push(
        `| ${column.position} | ${this.escapeMarkdown(column.name)} | ${this.escapeMarkdown(column.dataType)} | ${column.isNullable ? '是' : '否'} | ${this.escapeMarkdown(column.default || '')} | ${this.escapeMarkdown(constraints.join(', '))} | ${this.escapeMarkdown(description)} |`
      );
    }
    
    if (this.shouldIncludeForeignKeys() && table.foreignKeys.length > 0) {
      lines.push('');
      lines.push('### 外键关系');
      lines.push('');
      lines.push('| 外键名 | 字段 | 关联表 | 关联字段 | 删除规则 | 更新规则 |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      
      for (const fk of table.foreignKeys) {
        lines.push(
          `| ${this.escapeMarkdown(fk.name)} | ${this.escapeMarkdown(fk.columnName)} | ${this.escapeMarkdown(fk.foreignTableName)} | ${this.escapeMarkdown(fk.foreignColumnName)} | ${this.escapeMarkdown(fk.deleteRule || '-')} | ${this.escapeMarkdown(fk.updateRule || '-')} |`
        );
      }
    }
    
    if (this.shouldIncludeIndexes() && table.indexes.length > 0) {
      lines.push('');
      lines.push('### 索引');
      lines.push('');
      lines.push('| 索引名 | 字段 | 唯一 | 主键 |');
      lines.push('| --- | --- | --- | --- |');
      
      for (const idx of table.indexes) {
        lines.push(
          `| ${this.escapeMarkdown(idx.name)} | ${this.escapeMarkdown(idx.columns.join(', '))} | ${idx.isUnique ? '是' : '否'} | ${idx.isPrimary ? '是' : '否'} |`
        );
      }
    }
    
    return lines.join('\n');
  }

  private generateFooter(): string {
    const lines: string[] = [];
    
    lines.push('---');
    lines.push('');
    lines.push(`*本文档由数据字典生成工具于 ${this.formatDate(this.context.metadata.generatedAt)} 自动生成*`);
    
    return lines.join('\n');
  }
}
