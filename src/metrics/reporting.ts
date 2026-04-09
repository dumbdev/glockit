import { BenchmarkResult } from '../types';
import { buildHtmlReportTemplate, buildJunitReportTemplate } from '../templates/reporting';

export function generateJunitReport(results: BenchmarkResult): string {
  return buildJunitReportTemplate(results);
}

export function generateHtmlReport(results: BenchmarkResult): string {
  return buildHtmlReportTemplate(results);
}
