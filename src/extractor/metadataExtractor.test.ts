import { MetadataExtractor } from './metadataExtractor';
import { DatabaseConfig, ColumnInfo, TableInfo } from '../types';

describe('MetadataExtractor', () => {
  let extractor: MetadataExtractor;
  let mockConfig: DatabaseConfig;

  beforeEach(() => {
    mockConfig = {
      type: 'sqlite',
      connectionString: 'sqlite://test.db'
    };
    extractor = new MetadataExtractor(mockConfig);
  });

  describe('pluralize', () => {
    const pluralize = (extractor as any).pluralize.bind(extractor);

    it('should pluralize regular words', () => {
      expect(pluralize('user')).toBe('users');
      expect(pluralize('product')).toBe('products');
    });

    it('should pluralize words ending with s, x, z, ch, sh', () => {
      expect(pluralize('bus')).toBe('buses');
      expect(pluralize('box')).toBe('boxes');
      expect(pluralize('church')).toBe('churches');
      expect(pluralize('dish')).toBe('dishes');
    });

    it('should pluralize words ending with y (consonant before)', () => {
      expect(pluralize('category')).toBe('categories');
      expect(pluralize('city')).toBe('cities');
    });

    it('should not change y when vowel before', () => {
      expect(pluralize('boy')).toBe('boys');
      expect(pluralize('toy')).toBe('toys');
    });
  });

  describe('singularize', () => {
    const singularize = (extractor as any).singularize.bind(extractor);

    it('should singularize regular words', () => {
      expect(singularize('users')).toBe('user');
      expect(singularize('products')).toBe('product');
    });

    it('should singularize words ending with ies', () => {
      expect(singularize('categories')).toBe('category');
      expect(singularize('cities')).toBe('city');
    });

    it('should singularize words ending with es', () => {
      expect(singularize('buses')).toBe('bus');
      expect(singularize('boxes')).toBe('box');
      expect(singularize('churches')).toBe('church');
    });
  });

  describe('formatDataType', () => {
    const formatDataType = (extractor as any).formatDataType.bind(extractor);

    it('should format varchar with length', () => {
      const column: Partial<ColumnInfo> = {
        dataType: 'VARCHAR',
        characterMaximumLength: 50
      };
      expect(formatDataType(column)).toBe('VARCHAR(50)');
    });

    it('should format decimal with precision and scale', () => {
      const column: Partial<ColumnInfo> = {
        dataType: 'DECIMAL',
        numericPrecision: 10,
        numericScale: 2
      };
      expect(formatDataType(column)).toBe('DECIMAL(10,2)');
    });

    it('should format integer without parameters', () => {
      const column: Partial<ColumnInfo> = {
        dataType: 'INTEGER'
      };
      expect(formatDataType(column)).toBe('INTEGER');
    });
  });

  describe('detectAutoIncrement', () => {
    const detectAutoIncrement = (extractor as any).detectAutoIncrement.bind(extractor);

    it('should detect sqlite autoincrement primary key', () => {
      const column: Partial<ColumnInfo> = {
        name: 'id',
        dataType: 'INTEGER',
        constraints: [{ name: 'pk', type: 'PRIMARY KEY' }]
      };
      const table: Partial<TableInfo> = {
        primaryKey: ['id']
      };
      expect(detectAutoIncrement(column, table)).toBe('自增主键');
    });

    it('should detect serial type in postgres', () => {
      const postgresExtractor = new MetadataExtractor({
        type: 'postgres',
        connectionString: 'postgres://localhost/test'
      });
      const detectAutoIncrementPg = (postgresExtractor as any).detectAutoIncrement.bind(postgresExtractor);
      
      const column: Partial<ColumnInfo> = {
        name: 'id',
        dataType: 'SERIAL',
        constraints: [{ name: 'pk', type: 'PRIMARY KEY' }]
      };
      const table: Partial<TableInfo> = {
        primaryKey: ['id']
      };
      expect(detectAutoIncrementPg(column, table)).toBe('自增主键');
    });
  });
});
