import * as fs from 'fs';
import * as path from 'path';
import { MetadataExtractor } from './extractor/metadataExtractor';
import { BusinessMerger } from './merger/businessMerger';
import { createExporter, ExportContext } from './exporter';
import { 
  GeneratorConfig, 
  DatabaseMetadata, 
  BusinessConfig,
  OutputConfig,
  DatabaseConfig,
  ScanConfig
} from './types';

export class DataDictionaryGenerator {
  private config: GeneratorConfig;

  constructor(config: GeneratorConfig) {
    this.config = this.normalizeConfig(config);
  }

  private normalizeConfig(config: GeneratorConfig): GeneratorConfig {
    return {
      ...config,
      scan: {
        includeViews: false,
        ...config.scan
      },
      output: {
        includeForeignKeys: true,
        includeIndexes: true,
        tableOfContents: true,
        theme: 'light',
        ...config.output
      },
      business: config.business || {}
    };
  }

  async generate(): Promise<string> {
    const extractor = new MetadataExtractor(this.config.database);
    let metadata = await extractor.extract(this.config.scan);

    if (this.config.business && Object.keys(this.config.business).length > 0) {
      const merger = new BusinessMerger(this.config.business);
      metadata = merger.merge(metadata);
    }

    const exportContext: ExportContext = {
      metadata,
      outputConfig: this.config.output,
      businessConfig: this.config.business
    };

    const exporter = createExporter(exportContext);
    const content = await exporter.export();

    if (this.config.output.outputPath) {
      this.writeOutput(content, this.config.output.outputPath);
    }

    return content;
  }

  private writeOutput(content: string, outputPath: string): void {
    const resolvedPath = path.resolve(outputPath);
    const dir = path.dirname(resolvedPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(resolvedPath, content, 'utf-8');
  }

  getConfig(): GeneratorConfig {
    return this.config;
  }

  static fromConfigFile(configPath: string): DataDictionaryGenerator {
    const resolvedPath = path.resolve(configPath);
    
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Config file not found: ${resolvedPath}`);
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    let config: GeneratorConfig;

    if (ext === '.json') {
      const content = fs.readFileSync(resolvedPath, 'utf-8');
      config = JSON.parse(content);
    } else if (ext === '.js') {
      config = require(resolvedPath);
    } else {
      throw new Error(`Unsupported config format: ${ext}. Supported formats: .json, .js`);
    }

    return new DataDictionaryGenerator(config);
  }
}

export default DataDictionaryGenerator;

export * from './types';
export { MetadataExtractor } from './extractor/metadataExtractor';
export { BusinessMerger } from './merger/businessMerger';
export { createExporter } from './exporter';
export { createDatabaseConnector } from './db';
