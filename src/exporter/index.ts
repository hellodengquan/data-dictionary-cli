import { Exporter, ExportContext } from './base';
import { JsonExporter } from './jsonExporter';
import { MarkdownExporter } from './markdownExporter';
import { HtmlExporter } from './htmlExporter';
import { ErdSvgExporter, ErdPngExporter } from './erdExporter';
import { OutputConfig } from '../types';

export function createExporter(context: ExportContext): Exporter {
  const format = context.outputConfig.format;

  switch (format) {
    case 'json':
      return new JsonExporter(context);
    case 'markdown':
      return new MarkdownExporter(context);
    case 'html':
      return new HtmlExporter(context);
    case 'erd-svg':
      return new ErdSvgExporter(context);
    case 'erd-png':
      return new ErdPngExporter(context);
    default:
      throw new Error(
        `Unsupported output format: ${format}. ` +
        `Supported formats are: html, markdown, json, erd-svg, erd-png`
      );
  }
}

export { Exporter };
export { JsonExporter };
export { MarkdownExporter };
export { HtmlExporter };
export { ErdSvgExporter, ErdPngExporter };
export type { ExportContext };
