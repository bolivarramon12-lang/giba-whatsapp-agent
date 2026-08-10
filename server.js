require("dotenv").config();
const express = require("express");
const { extraerMensajeEntrante, enviarMensaje } = require("./src/whatsapp");
const {
  getCatalogoSucursales,
  getConversacion,
  guardarConversacion,
  guardarQueja,
} = require("./src/sheets");
const { generarRespuesta } = require("./src/claude");

const app = express();
app.use(express.json());

const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const ASESOR_WHATSAPP_NUMERO = process.env.ASESOR_WHATSAPP_NUMERO;

// Meta reenvía el mismo mensaje si tardamos en responder. Guardamos los IDs ya
// procesados para no contestarle dos veces al comensal.
const mensajesProcesados = new Map();
const DEDUP_TTL_MS = 10 * 60 * 1000;

function yaProcesado(id) {
  const ahora = Date.now();
  for (const [k, t] of mensajesProcesados) {
    if (ahora - t > DEDUP_TTL_MS) mensajesProcesados.delete(k);
  }
  if (mensajesProcesados.has(id)) return true;
  mensajesProcesados.set(id, ahora);
  return false;
}

// Cache simple del catálogo en memoria para no leer Sheets en cada mensaje
let catalogoCache = { data: [], actualizado: 0 };
const CATALOGO_TTL_MS = 5 * 60 * 1000; // 5 minutos

async function getCatalogoConCache() {
  const ahora = Date.now();
  if (ahora - catalogoCache.actualizado > CATALOGO_TTL_MS) {
    catalogoCache.data = await getCatalogoSucursales();
    catalogoCache.actualizado = ahora;
  }
  return catalogoCache.data;
}

// 1) Verificación del webhook (Meta la llama una sola vez al configurarlo)
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// 2) Recepción de mensajes reales
app.post("/webhook", async (req, res) => {
  // Responder rápido a Meta; el procesamiento sigue en segundo plano
  res.sendStatus(200);

  const entrante = extraerMensajeEntrante(req.body);
  if (!entrante) return; // notificación de estado u otro evento, se ignora

  if (yaProcesado(entrante.id)) return;

  const { telefono, nombre, texto } = entrante;

  try {
    const [conversacion, catalogo] = await Promise.all([
      getConversacion(telefono),
      getCatalogoConCache(),
    ]);

    // Si el asesor está atendiendo a este comensal, el bot guarda silencio.
    // (Esta bandera la puedes poner tú manualmente en Sheets, columna "ciudad" no aplica;
    // si ya migraste la lógica de "en_atencion" desde Make, se puede añadir aquí igual.)

    const { texto: respuesta, requiereAsesor, ciudadDetectada, queja } = await generarRespuesta({
      historial: conversacion.historial,
      mensajeNuevo: texto,
      catalogo,
    });

    await enviarMensaje(telefono, respuesta);

    const nuevoHistorial = [
      ...conversacion.historial,
      { role: "user", content: texto },
      { role: "assistant", content: respuesta },
    ];

    // Si Claude detectó la ciudad en este turno, buscamos su Estado en el
    // catálogo para no tener que preguntárselo aparte al comensal.
    let ciudad = conversacion.ciudad;
    let estado = conversacion.estado;
    if (ciudadDetectada) {
      const sucursal = catalogo.find(
        (s) => s.Ciudad.toLowerCase() === ciudadDetectada.toLowerCase()
      );
      ciudad = sucursal ? sucursal.Ciudad : ciudadDetectada;
      estado = sucursal ? sucursal.Estado : estado;
    }

    await guardarConversacion({
      rowNumber: conversacion.rowNumber,
      telefono,
      nombre: nombre || conversacion.nombre,
      historial: nuevoHistorial,
      ciudad,
      estado,
    });

    if (queja) {
      await guardarQueja({
        telefono,
        nombre: nombre || conversacion.nombre,
        ciudad,
        detalle: queja,
      });
    }

    if (requiereAsesor && ASESOR_WHATSAPP_NUMERO) {
      await enviarMensaje(
        ASESOR_WHATSAPP_NUMERO,
        `✅ Comensal solicita hablar con un asesor.\nNombre: ${nombre || "(sin nombre)"}\nTeléfono: ${telefono}\nÚltimo mensaje: ${texto}`
      );
    }
  } catch (err) {
    console.error("Error procesando mensaje entrante:", err);
  }
});

app.get("/", (req, res) => res.send("Agente WhatsApp Las Espadas — activo"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor escuchando en puerto ${PORT}`));
