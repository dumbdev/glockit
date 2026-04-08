import { DataFeederConfig } from '../types';

export function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];

    if (inQuotes) {
      if (char === '"') {
        const nextChar = raw[i + 1];
        if (nextChar === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      continue;
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function parseCsvData(raw: string): Array<Record<string, any>> {
  const rows = parseCsvRows(raw);
  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0].map(h => h.trim());
  const parsedRows: Array<Record<string, any>> = [];

  for (let i = 1; i < rows.length; i++) {
    const values = rows[i].map(v => v.trim());
    if (values.every(v => v === '')) {
      continue;
    }
    const row: Record<string, any> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? '';
    });
    parsedRows.push(row);
  }

  return parsedRows;
}

export function loadDataFeederRows(dataFeeder: DataFeederConfig, platformName: string): Array<Record<string, any>> {
  if (platformName !== 'node') {
    throw new Error('dataFeeder is only supported on the node platform');
  }

  const fs = require('node:fs') as typeof import('node:fs');
  const raw = fs.readFileSync(dataFeeder.path, 'utf8');

  let rows: Array<Record<string, any>>;
  if (dataFeeder.format === 'json') {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('dataFeeder JSON must be an array of objects');
    }
    rows = parsed.filter(row => row && typeof row === 'object');
  } else {
    rows = parseCsvData(raw);
  }

  if (rows.length === 0) {
    throw new Error('dataFeeder produced zero rows');
  }

  return rows;
}
