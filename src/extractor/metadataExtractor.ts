import { createDatabaseConnector } from '../db';
import { DatabaseConfig, ScanConfig, DatabaseMetadata, ColumnInfo, TableInfo } from '../types';

export class MetadataExtractor {
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  async extract(scanConfig?: ScanConfig): Promise<DatabaseMetadata> {
    const connector = createDatabaseConnector(this.config);
    const metadata = await connector.scanDatabase(scanConfig);
    
    return this.enhanceMetadata(metadata);
  }

  private enhanceMetadata(metadata: DatabaseMetadata): DatabaseMetadata {
    const enhancedTables = metadata.tables.map(table => this.enhanceTableInfo(table, metadata.tables));
    return {
      ...metadata,
      tables: enhancedTables
    };
  }

  private enhanceTableInfo(table: TableInfo, allTables: TableInfo[]): TableInfo {
    const enhancedColumns = table.columns.map(column => 
      this.enhanceColumnInfo(column, table, allTables)
    );

    return {
      ...table,
      columns: enhancedColumns
    };
  }

  private enhanceColumnInfo(column: ColumnInfo, table: TableInfo, allTables: TableInfo[]): ColumnInfo {
    const constraints = [...column.constraints];
    
    if (table.primaryKey?.includes(column.name) && 
        !constraints.some(c => c.type === 'PRIMARY KEY')) {
      constraints.push({
        name: `${table.name}_${column.name}_pk`,
        type: 'PRIMARY KEY'
      });
    }

    const autoIncrement = this.detectAutoIncrement(column, table);
    if (autoIncrement && !column.comment) {
      column.comment = autoIncrement;
    }

    const foreignKeyInfo = this.getForeignKeyDetails(column, table, allTables);
    if (foreignKeyInfo && !constraints.some(c => c.type === 'FOREIGN KEY')) {
      constraints.push({
        name: `${table.name}_${column.name}_fkey`,
        type: 'FOREIGN KEY',
        foreignTable: foreignKeyInfo.table,
        foreignColumn: foreignKeyInfo.column
      });
    }

    return {
      ...column,
      dataType: this.formatDataType(column),
      constraints
    };
  }

  private detectAutoIncrement(column: ColumnInfo, table: TableInfo): string | undefined {
    if (table.primaryKey?.includes(column.name)) {
      if (column.dataType.toLowerCase().includes('serial') || 
          column.dataType.toLowerCase().includes('identity') ||
          column.default?.toLowerCase().includes('nextval') ||
          (column.dataType === 'INTEGER' && this.config.type === 'sqlite')) {
        return '自增主键';
      }
    }
    
    if (column.default?.toLowerCase().includes('auto_increment')) {
      return '自增字段';
    }
    
    return undefined;
  }

  private getForeignKeyDetails(
    column: ColumnInfo, 
    table: TableInfo, 
    allTables: TableInfo[]
  ): { table: string; column: string } | undefined {
    if (!column.name.toLowerCase().includes('_id') && !column.name.toLowerCase().endsWith('id')) {
      return undefined;
    }

    const fkFromConstraints = table.foreignKeys.find(fk => fk.columnName === column.name);
    if (fkFromConstraints) {
      return {
        table: fkFromConstraints.foreignTableName,
        column: fkFromConstraints.foreignColumnName
      };
    }

    const columnNameWithoutSuffix = column.name
      .replace(/_id$/, '')
      .replace(/Id$/, '');
    
    const possibleTableNames = [
      columnNameWithoutSuffix,
      this.pluralize(columnNameWithoutSuffix),
      this.singularize(columnNameWithoutSuffix)
    ];

    for (const possibleTableName of possibleTableNames) {
      const referencedTable = allTables.find(t => 
        t.name.toLowerCase() === possibleTableName.toLowerCase()
      );
      
      if (referencedTable) {
        const referencedColumn = referencedTable.columns.find(c => 
          c.name.toLowerCase() === 'id' || 
          referencedTable.primaryKey?.includes(c.name)
        );
        
        if (referencedColumn) {
          return {
            table: referencedTable.name,
            column: referencedColumn.name
          };
        }
      }
    }

    return undefined;
  }

  private formatDataType(column: ColumnInfo): string {
    let type = column.dataType;
    
    if (column.characterMaximumLength) {
      type = `${type}(${column.characterMaximumLength})`;
    } else if (column.numericPrecision !== undefined && column.numericScale !== undefined) {
      type = `${type}(${column.numericPrecision},${column.numericScale})`;
    } else if (column.numericPrecision !== undefined) {
      type = `${type}(${column.numericPrecision})`;
    }
    
    return type;
  }

  private pluralize(word: string): string {
    const lowerWord = word.toLowerCase();
    if (lowerWord.endsWith('y') && !'aeiou'.includes(lowerWord[lowerWord.length - 2])) {
      return word.slice(0, -1) + 'ies';
    }
    if (lowerWord.endsWith('s') || lowerWord.endsWith('x') || lowerWord.endsWith('z') || 
        lowerWord.endsWith('ch') || lowerWord.endsWith('sh')) {
      return word + 'es';
    }
    return word + 's';
  }

  private singularize(word: string): string {
    const lowerWord = word.toLowerCase();
    if (lowerWord.endsWith('ies')) {
      return word.slice(0, -3) + 'y';
    }
    if (lowerWord.endsWith('es') && (lowerWord.endsWith('ses') || lowerWord.endsWith('xes') || 
        lowerWord.endsWith('zes') || lowerWord.endsWith('ches') || lowerWord.endsWith('shes'))) {
      return word.slice(0, -2);
    }
    if (lowerWord.endsWith('s') && !lowerWord.endsWith('ss')) {
      return word.slice(0, -1);
    }
    return word;
  }
}
