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

const MENSAJE_BIENVENIDA = `Bienvenido a Las Espadas Brazilian Steakhouse, estoy aquí para ayudarte con:

- Horarios
- Ubicaciones
- Reservaciones
- Quejas y/o Sugerencias
- Promociones
- Hablar con uno de nuestros agentes

¡Estamos para atenderte!`;

// Cuánto tiempo se queda el bot en silencio tras escalar a un asesor humano,
// por si nadie borra la marca "EnAtencion" manualmente en Sheets.
const ATENCION_TTL_MS = 24 * 60 * 60 * 1000;

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

    // Si un asesor está atendiendo a este comensal, el bot guarda silencio.
    // Se activa solo al escalar (más abajo) y se desactiva sola tras
    // ATENCION_TTL_MS, o antes si alguien borra la celda "EnAtencion" en Sheets.
    const pausadoPorAsesor =
      conversacion.enAtencion &&
      Date.now() - new Date(conversacion.enAtencion).getTime() < ATENCION_TTL_MS;

    if (pausadoPorAsesor) {
      await guardarConversacion({
        rowNumber: conversacion.rowNumber,
        telefono,
        nombre: nombre || conversacion.nombre,
        historial: [...conversacion.historial, { role: "user", content: texto }],
        ciudad: conversacion.ciudad,
        estado: conversacion.estado,
        enAtencion: conversacion.enAtencion,
      });
      return;
    }

    const esConversacionNueva = conversacion.historial.length === 0;
    if (esConversacionNueva) {
      await enviarMensaje(telefono, MENSAJE_BIENVENIDA);
    }

    const { texto: respuesta, requiereAsesor, ciudadDetectada, queja } = await generarRespuesta({
      historial: conversacion.historial,
      mensajeNuevo: texto,
      catalogo,
    });

    await enviarMensaje(telefono, respuesta);

    // El mensaje de bienvenida se manda aparte (fijo, sin pasar por Claude),
    // pero se guarda junto con la respuesta para que quede registro completo
    // del turno en el historial.
    const respuestaGuardada = esConversacionNueva
      ? `${MENSAJE_BIENVENIDA}\n\n${respuesta}`
      : respuesta;

    const nuevoHistorial = [
      ...conversacion.historial,
      { role: "user", content: texto },
      { role: "assistant", content: respuestaGuardada },
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
      // Al escalar, se marca la hora para que el bot quede en silencio con
      // este comensal. Para reactivarlo antes de que expire solo, borra el
      // valor de la columna "EnAtencion" en la hoja Conversaciones.
      enAtencion: requiereAsesor ? new Date().toISOString() : "",
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
