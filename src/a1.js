export function columnToLetter(index) {
  let value = index + 1;
  let label = "";

  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }

  return label;
}

export function cellA1(rowIndex, colIndex) {
  return `${columnToLetter(colIndex)}${rowIndex + 1}`;
}

export function quoteSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

export function rangeA1(sheetName, startRow, startCol, endRow, endCol) {
  return `${quoteSheetName(sheetName)}!${cellA1(startRow, startCol)}:${cellA1(
    endRow,
    endCol,
  )}`;
}

export function singleCellA1(sheetName, rowIndex, colIndex) {
  return `${quoteSheetName(sheetName)}!${cellA1(rowIndex, colIndex)}`;
}
