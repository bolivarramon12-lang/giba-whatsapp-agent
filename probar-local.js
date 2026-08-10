/**
 * Prueba el agente desde la terminal, SIN necesidad de WhatsApp ni de Meta.
 * Simula ser un comensal escribiendo mensajes.
 *
 *   node probar-local.js
 *
 * Requiere que .env tenga ANTHROPIC_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON y SHEET_ID.
 * (No requiere WHATSAPP_TOKEN.)
 */
require("dotenv").config();
const readline = require("readline");
const { getCatalogoSucursales } = require("./src/sheets");
const { generarRespuesta } = require("./src/claude");

const TELEFONO_PRUEBA = "5216141111111";
let historial = [];

async function main() {
  console.log("Cargando catálogo de sucursales desde Google Sheets...\n");
  let catalogo;
  try {
    catalogo = await getCatalogoSucursales();
    console.log(`Catálogo cargado: ${catalogo.length} sucursales.`);
    console.log("Ciudades detectadas:", catalogo.map((s) => s.Ciudad).join(", "), "\n");
  } catch (err) {
    console.error("ERROR leyendo Google Sheets:", err.message);
    console.error("Revisa SHEET_ID, el nombre de la pestaña y que la hoja esté compartida");
    console.error("con el correo de la cuenta de servicio como Editor.\n");
    process.exit(1);
  }

  console.log(`Simulando conversación con el número ${TELEFONO_PRUEBA}.`);
  console.log('Escribe mensajes como si fueras el comensal. Usa "salir" para terminar.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const preguntar = () => {
    rl.question("Comensal > ", async (texto) => {
      if (texto.trim().toLowerCase() === "salir") {
        rl.close();
        return;
      }
      try {
        const { texto: respuesta, requiereAsesor } = await generarRespuesta({
          historial,
          mensajeNuevo: texto,
          catalogo,
        });
        console.log(`\nBot > ${respuesta}\n`);
        if (requiereAsesor) {
          console.log("   [Se dispararía el aviso de asesor por WhatsApp]\n");
        }
        historial.push({ role: "user", content: texto });
        historial.push({ role: "assistant", content: respuesta });
        historial = historial.slice(-12);
      } catch (err) {
        console.error("ERROR llamando a Claude:", err.message, "\n");
      }
      preguntar();
    });
  };

  preguntar();
}

main();
