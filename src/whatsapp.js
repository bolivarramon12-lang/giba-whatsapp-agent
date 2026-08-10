const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

async function enviarMensaje(telefonoDestino, texto) {
  const url = `https://graph.facebook.com/v20.0/${PHONE_NUMBER_ID}/messages`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: telefonoDestino,
      type: "text",
      text: { body: texto },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Error enviando mensaje de WhatsApp:", err);
  }
  return res.ok;
}

// Extrae el mensaje de texto entrante del payload del webhook de Meta.
// Devuelve null si el evento no es un mensaje de texto de un cliente real
// (por ejemplo, si es una notificación de estado de entrega).
function extraerMensajeEntrante(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const mensaje = value?.messages?.[0];

    if (!mensaje || mensaje.type !== "text") return null;

    const contacto = value.contacts?.[0];

    return {
      id: mensaje.id, // necesario para deduplicar: Meta reenvía si no respondes a tiempo
      telefono: mensaje.from,
      nombre: contacto?.profile?.name || "",
      texto: mensaje.text.body,
    };
  } catch {
    return null;
  }
}

module.exports = { enviarMensaje, extraerMensajeEntrante };
