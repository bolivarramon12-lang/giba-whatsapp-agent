const { google } = require("googleapis");

const SHEET_ID = process.env.SHEET_ID;
const SHEET_CATALOGO = process.env.SHEET_CATALOGO || "Catalogo Sucursales";
const SHEET_CONVERSACIONES = process.env.SHEET_CONVERSACIONES || "Conversaciones";
const MAX_MENSAJES_HISTORIAL = 12; // últimos N mensajes que se guardan por comensal

// Los nombres de hoja con espacios o guiones DEBEN ir entre comillas simples en notación A1.
// Sin esto, un nombre como "Catalogo Sucursales - Las Espadas" rompe la petición.
function rango(nombreHoja, celdas) {
  return `'${nombreHoja.replace(/'/g, "''")}'!${celdas}`;
}

function getAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

async function getSheetsClient() {
  const auth = getAuth();
  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// Convierte una hoja con encabezados en fila 1 a un arreglo de objetos
function rowsToObjects(rows) {
  if (!rows || rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] || "";
    });
    return obj;
  });
}

async function getCatalogoSucursales() {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: rango(SHEET_CATALOGO, "A:F"),
  });
  return rowsToObjects(res.data.values);
}

// Busca (o crea) la fila del comensal en la hoja "Conversaciones" por teléfono
async function getConversacion(telefono) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: rango(SHEET_CONVERSACIONES, "A:E"),
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex((r) => r[0] === telefono);

  if (rowIndex === -1) {
    return { rowNumber: null, telefono, nombre: "", historial: [], ciudad: "" };
  }

  const row = rows[rowIndex];
  let historial = [];
  try {
    historial = JSON.parse(row[2] || "[]");
  } catch {
    historial = [];
  }

  return {
    rowNumber: rowIndex + 1, // 1-based, coincide con la fila real en Sheets
    telefono,
    nombre: row[1] || "",
    historial,
    ciudad: row[3] || "",
  };
}

// Guarda (upsert) la conversación actualizada del comensal
async function guardarConversacion({ rowNumber, telefono, nombre, historial, ciudad }) {
  const sheets = await getSheetsClient();
  const historialRecortado = historial.slice(-MAX_MENSAJES_HISTORIAL);
  const valores = [
    telefono,
    nombre,
    JSON.stringify(historialRecortado),
    ciudad || "",
    new Date().toISOString(),
  ];

  if (rowNumber) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: SHEET_ID,
      range: rango(SHEET_CONVERSACIONES, `A${rowNumber}:E${rowNumber}`),
      valueInputOption: "RAW",
      requestBody: { values: [valores] },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: rango(SHEET_CONVERSACIONES, "A:E"),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [valores] },
    });
  }
}

module.exports = {
  getCatalogoSucursales,
  getConversacion,
  guardarConversacion,
};
