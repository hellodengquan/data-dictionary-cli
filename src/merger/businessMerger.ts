import * as fs from 'fs';
import * as path from 'path';
import { DatabaseMetadata, BusinessConfig, BusinessDescription, TableInfo, ColumnInfo } from '../types';

export class BusinessMerger {
  private businessConfig: BusinessConfig;

  constructor(businessConfig: BusinessConfig | string) {
    if (typeof businessConfig === 'string') {
      this.businessConfig = this.loadBusinessConfig(businessConfig);
    } else {
      this.businessConfig = businessConfig;
    }
  }

  private loadBusinessConfig(configPath: string): BusinessConfig {
    const resolvedPath = path.resolve(configPath);
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Business config file not found: ${resolvedPath}`);
    }

    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const ext = path.extname(resolvedPath).toLowerCase();

    if (ext === '.json') {
      return JSON.parse(content);
    } else if (ext === '.yaml' || ext === '.yml') {
      return this.parseYaml(content);
    } else if (ext === '.js') {
      return require(resolvedPath);
    }

    try {
      return JSON.parse(content);
    } catch {
      try {
        return this.parseYaml(content);
      } catch {
        throw new Error(`Unsupported business config format: ${ext}. Supported formats: .json, .yaml, .yml, .js`);
      }
    }
  }

  private parseYaml(content: string): BusinessConfig {
    const lines = content.split('\n');
    const result: any = {};
    const stack: any[] = [];
    let currentObj: any = result;
    let currentIndent = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const indent = line.search(/\S/);
      
      if (indent > currentIndent) {
        stack.push({ obj: currentObj, indent: currentIndent });
        currentIndent = indent;
      } else if (indent < currentIndent) {
        while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
          const popped = stack.pop()!;
          currentObj = popped.obj;
          currentIndent = popped.indent;
        }
      }

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) {
        continue;
      }

      const key = trimmed.substring(0, colonIndex).trim().replace(/^["']|["']$/g, '');
      let value = trimmed.substring(colonIndex + 1).trim();

      if (value === '' || value === '|' || value === '>') {
        const textLines: string[] = [];
        const textIndent = indent + 2;
        i++;
        while (i < lines.length) {
          const textLine = lines[i];
          if (!textLine.trim()) {
            textLines.push('');
            i++;
            continue;
          }
          const textLineIndent = textLine.search(/\S/);
          if (textLineIndent < textIndent) {
            i--;
            break;
          }
          textLines.push(textLine.substring(textIndent));
          i++;
        }
        value = textLines.join('\n');
      } else if (value.startsWith('[') && value.endsWith(']')) {
        try {
          value = JSON.parse(value);
        } catch {
          value = value.substring(1, value.length - 1).split(',').map(v => v.trim());
        }
      } else if (value.startsWith('{') && value.endsWith('}')) {
        try {
          value = JSON.parse(value);
        } catch {
        }
      } else if (value.startsWith('"') && value.endsWith('"')) {
        value = value.substring(1, value.length - 1);
      } else if (value.startsWith("'") && value.endsWith("'")) {
        value = value.substring(1, value.length - 1);
      } else if (value === 'true') {
        value = true;
      } else if (value === 'false') {
        value = false;
      } else if (value === 'null') {
        value = null;
      } else if (!isNaN(Number(value)) && value !== '') {
        value = Number(value);
      }

      if (currentObj) {
        if (key === '-') {
          if (!Array.isArray(currentObj)) {
            const parent = stack[stack.length - 1]?.obj || result;
            const parentKeys = Object.keys(parent);
            const lastKey = parentKeys[parentKeys.length - 1];
            if (!Array.isArray(parent[lastKey])) {
              parent[lastKey] = [];
            }
            parent[lastKey].push(value);
          } else {
            currentObj.push(value);
          }
        } else {
          currentObj[key] = value;
          if (typeof value === 'string' && (value === '' || value === '|' || value === '>')) {
            currentObj[key] = {};
            stack.push({ obj: currentObj, indent: currentIndent });
            currentObj = currentObj[key];
            currentIndent = indent + 2;
          }
        }
      }
    }

    return result as BusinessConfig;
  }

  merge(metadata: DatabaseMetadata): DatabaseMetadata {
    const mergedTables = metadata.tables.map(table => 
      this.mergeTableBusinessInfo(table)
    );

    return {
      ...metadata,
      tables: mergedTables
    };
  }

  private mergeTableBusinessInfo(table: TableInfo): TableInfo {
    const tableBusinessInfo = this.findTableBusinessInfo(table.name);
    
    if (!tableBusinessInfo) {
      return table;
    }

    const mergedColumns = table.columns.map(column => 
      this.mergeColumnBusinessInfo(column, tableBusinessInfo)
    );

    return {
      ...table,
      columns: mergedColumns,
      businessDescription: tableBusinessInfo.description || table.businessDescription
    };
  }

  private mergeColumnBusinessInfo(column: ColumnInfo, tableBusinessInfo: BusinessDescription): ColumnInfo {
    const columnDescription = tableBusinessInfo.columns?.[column.name];
    
    if (!columnDescription) {
      return column;
    }

    return {
      ...column,
      businessDescription: columnDescription
    };
  }

  private findTableBusinessInfo(tableName: string): BusinessDescription | undefined {
    if (!this.businessConfig.tables) {
      return undefined;
    }

    return this.businessConfig.tables.find(t => 
      t.tableName === tableName || 
      t.tableName.toLowerCase() === tableName.toLowerCase()
    );
  }

  getBusinessConfig(): BusinessConfig {
    return this.businessConfig;
  }

  getTitle(): string | undefined {
    return this.businessConfig.title;
  }

  getDescription(): string | undefined {
    return this.businessConfig.description;
  }

  getVersion(): string | undefined {
    return this.businessConfig.version;
  }

  getGeneratedBy(): string | undefined {
    return this.businessConfig.generatedBy;
  }
}
