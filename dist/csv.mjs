/**
 * Parse CSV text into string-valued row objects.
 * Blank records are ignored; malformed headers and row widths throw Error.
 * @param {string} text Raw CSV input, optionally prefixed with a UTF-8 BOM.
 * @returns {Array<Record<string, string>>}
 */
export function parseCSV(text) {
  const records = [];
  let fields = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  function finishRecord() {
    fields.push(field);
    if (fields.some((value) => value.trim())) records.push(fields);
    fields = [];
    field = "";
    closedQuote = false;
  }

  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (quoted) {
        quoted = false;
        closedQuote = true;
      } else if (field || closedQuote) {
        throw Error(`Unexpected CSV quote at character ${index + 1}`);
      } else {
        quoted = true;
      }
    } else if (character === "," && !quoted) {
      fields.push(field);
      field = "";
      closedQuote = false;
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index++;
      finishRecord();
    } else if (closedQuote && character !== " " && character !== "\t") {
      throw Error(`Unexpected text after CSV quote at character ${index + 1}`);
    } else {
      if (!closedQuote) field += character;
    }
  }

  if (quoted) throw Error("Unclosed CSV quote");
  if (field || fields.length) finishRecord();

  const headers = (records.shift() || []).map((value) => value.replace(/^\uFEFF/, "").trim());
  if (!headers.length || headers.some((header) => !header))
    throw Error("CSV header is missing or empty");
  if (new Set(headers).size !== headers.length) throw Error("Duplicate CSV columns");

  return records.map((record, index) => {
    if (record.length !== headers.length) {
      throw Error(`CSV row ${index + 2} has ${record.length} columns; expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, column) => [header, record[column].trim()]));
  });
}

/**
 * Serialize row objects as CSV with a header and RFC-style quote escaping.
 * @param {Array<Record<string, unknown>>} rows
 * @param {string[]} [headers] Column order; defaults to the first row's keys.
 * @returns {string}
 */
export function csv(rows, headers = Object.keys(rows[0] || {})) {
  const escapeField = (value) => {
    const text = String(value ?? "");
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${headers.join(",")}\n${rows.map((row) => headers.map((header) => escapeField(row[header])).join(",")).join("\n")}\n`;
}
