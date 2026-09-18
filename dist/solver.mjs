// TrackPlan: deterministic multi-start serial schedule generation,
// no external dependencies.

export const FILES = [
  "01_LINES",
  "02_STATIONS",
  "03_SECTORS",
  "04_LOCATION_SUPPLY",
  "05_BUFFER_LOCATION",
  "06_PARAMETERS",
  "07_PROJECT_DETAILS",
  "08_ACTIVITY_DETAILS",
];

export function parseCSV(text) {
  const out = [];

  let row = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index++) {
    const character = text[index];

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(value);
      value = "";
    }
  }
}