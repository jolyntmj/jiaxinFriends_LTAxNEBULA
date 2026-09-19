export const $ = (id) => document.getElementById(id);

export const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );

export const fmt = (x) =>
  Number(x).toLocaleString(undefined, {
    maximumFractionDigits: 1,
  });

export function table(headers, rows) {
  return (
    '<div class="scroll">' +
      "<table>" +
        "<thead>" +
          "<tr>" +
            headers
              .map(
                (header) =>
                  "<th>" + header + "</th>",
              )
              .join("") +
          "</tr>" +
        "</thead>" +
        "<tbody>" +
          rows
            .map(
              (row) =>
                "<tr>" +
                row
                  .map(
                    (cell) =>
                      "<td>" + cell + "</td>",
                  )
                  .join("") +
                "</tr>",
            )
            .join("") +
        "</tbody>" +
      "</table>" +
    "</div>"
  );
}

