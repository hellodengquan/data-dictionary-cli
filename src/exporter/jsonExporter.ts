import { Exporter, ExportContext } from './base';
import { DatabaseMetadata } from '../types';

export class JsonExporter extends Exporter {
  constructor(context: ExportContext) {
    super(context);
  }

  async export(): Promise<string> {
    const output: any = {
      title: this.getTitle(),
      description: this.getDescription(),
      version: this.getVersion(),
      generatedAt: this.context.metadata.generatedAt,
      generatedAtFormatted: this.formatDate(this.context.metadata.generatedAt),
      generatedBy: this.getGeneratedBy(),
      database: {
        name: this.context.metadata.databaseName,
        type: this.context.metadata.databaseType,
        version: this.context.metadata.version
      },
      statistics: {
        tableCount: this.context.metadata.tables.length,
        columnCount: this.context.metadata.tables.reduce((sum, t) => sum + t.columns.length, 0)
      },
      tables: this.formatTables()
    };

    return JSON.stringify(output, null, 2);
  }

  private formatTables(): any[] {
    return this.context.metadata.tables.map(table => {
      const formattedTable: any = {
        name: table.name,
        schema: table.schema,
        comment: table.comment,
        businessDescription: table.businessDescription,
        primaryKey: table.primaryKey,
        columnCount: table.columns.length,
        columns: this.formatColumns(table.columns)
      };

      if (this.shouldIncludeForeignKeys() && table.foreignKeys.length > 0) {
        formattedTable.foreignKeys = table.foreignKeys.map(fk => ({
          name: fk.name,
          column: fk.columnName,
          references: {
            table: fk.foreignTableName,
            column: fk.foreignColumnName
          },
          deleteRule: fk.deleteRule,
          updateRule: fk.updateRule
        }));
      }

      if (this.shouldIncludeIndexes() && table.indexes.length > 0) {
        formattedTable.indexes = table.indexes.map(idx => ({
          name: idx.name,
          columns: idx.columns,
          isUnique: idx.isUnique,
          isPrimary: idx.isPrimary
        }));
      }

      return formattedTable;
    });
  }

  private formatColumns(columns: any[]): any[] {
    return columns.map(column => ({
      name: column.name,
      position: column.position,
      dataType: column.dataType,
      udtName: column.udtName,
      isNullable: column.isNullable,
      default: column.default,
      characterMaximumLength: column.characterMaximumLength,
      numericPrecision: column.numericPrecision,
      numericScale: column.numericScale,
      constraints: column.constraints.map((c: any) => ({
        name: c.name,
        type: c.type,
        expression: c.expression,
        foreignTable: c.foreignTable,
        foreignColumn: c.foreignColumn
      })),
      constraintTypes: column.constraints.map((c: any) => c.type),
      comment: column.comment,
      businessDescription: column.businessDescription,
      description: this.getFinalDescription(column)
    }));
  }
}
