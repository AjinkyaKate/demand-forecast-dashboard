/**
 * A small CSV reader for sales exports: handles quoted fields, embedded
 * newlines, a UTF-8 BOM, and comma, semicolon, tab or pipe delimiters
 * (picked from the header line). No dependency, no streaming: a POS export
 * for a few stores is a few megabytes at most.
 */

export type ParsedCsv = {
  delimiter: string;
  columns: string[];
  rows: string[][];
};

const DELIMITERS = [",", ";", "\t", "|"];

function detectDelimiter(headerLine: string): string {
  let best = ",";
  let bestCount = -1;
  for (const d of DELIMITERS) {
    const count = headerLine.split(d).length - 1;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

export function parseCsv(text: string, maxRows = Infinity): ParsedCsv {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const firstBreak = text.search(/\r?\n/);
  const delimiter = detectDelimiter(firstBreak === -1 ? text : text.slice(0, firstBreak));

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // Skip fully blank lines.
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      quoted = true;
      i++;
      continue;
    }
    if (c === delimiter) {
      endField();
      i++;
      continue;
    }
    if (c === "\n" || c === "\r") {
      endRow();
      if (c === "\r" && text[i + 1] === "\n") i++;
      i++;
      if (rows.length > maxRows) break;
      continue;
    }
    field += c;
    i++;
  }
  if (field !== "" || row.length) endRow();

  const columns = (rows.shift() ?? []).map((c) => c.trim());
  return { delimiter, columns, rows: rows.slice(0, maxRows) };
}
