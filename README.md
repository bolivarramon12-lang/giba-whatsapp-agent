# Agente WhatsApp — Las Espadas (GIBA)

Servicio que recibe mensajes de WhatsApp, identifica al comensal por su número de teléfono,
consulta el catálogo de sucursales en Google Sheets, y responde de forma natural usando Claude.
La conversación (memoria) de cada comensal se guarda en la hoja "Conversaciones".

## Qué hace

1. Meta envía el mensaje entrante al webhook (`POST /webhook`).
2. El servicio busca el historial del número en la hoja **Conversaciones**.
3. Lee el catálogo de sucursales de la hoja **Catalogo Sucursales** (con caché de 5 min).
4. Le pasa todo el contexto a Claude (Haiku) para generar una respuesta humana.
5. Envía la respuesta por WhatsApp y guarda el mensaje nuevo en el historial.
6. Si el comensal pide un asesor, avisa por WhatsApp al número configurado.
7. Si el comensal reporta una queja o sugerencia, la guarda en la hoja **Quejas**.

## 1. Prepara tu hoja de Google Sheets

Usa la misma hoja donde ya tienes "Catalogo Sucursales" (Ciudad/Estado/Sucursal/Direccion/Telefono/Promociones).

Agrega una pestaña nueva llamada **Conversaciones** con estos encabezados en la fila 1:

```
Telefono | Nombre | Historial | Ciudad | Estado | UltimaActualizacion
```

El "Estado" se llena solo: en cuanto el bot detecta la ciudad del comensal, la busca en el
catálogo de sucursales y guarda el Estado correspondiente — no hace falta pedírselo aparte.

Agrega otra pestaña llamada **Quejas** con estos encabezados en la fila 1:

```
Fecha | Telefono | Nombre | Ciudad | Detalle
```

## 2. Crea una cuenta de servicio de Google (para que el bot pueda leer/escribir Sheets)

1. Ve a https://console.cloud.google.com/ → crea un proyecto (o usa uno existente).
2. Habilita la API de "Google Sheets API".
3. Ve a "Credenciales" → "Crear credenciales" → "Cuenta de servicio".
4. Dentro de la cuenta de servicio, genera una clave nueva en formato JSON y descárgala.
5. Abre tu hoja de Google Sheets → botón "Compartir" → comparte con el correo de la cuenta
   de servicio (algo como `nombre@proyecto.iam.gserviceaccount.com`) con permiso de **Editor**.
6. El contenido completo de ese archivo JSON va en la variable `GOOGLE_SERVICE_ACCOUNT_JSON`
   (todo en una sola línea).

## 3. Consigue tu API key de Anthropic

1. Entra a https://console.anthropic.com/ → API Keys → crea una nueva key.
2. Cárgale algo de crédito (con Haiku, el gasto de un bot de este volumen es bajo, unos
   centavos de dólar por cada cientos de mensajes).

## 4. Variables de entorno

Copia `.env.example` a `.env` y llena cada valor:

- `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`: los mismos que ya usas en tus módulos HTTP de Make.
- `WHATSAPP_VERIFY_TOKEN`: cualquier texto secreto que tú inventes (lo usarás al configurar el webhook en Meta).
- `ANTHROPIC_API_KEY`: la key del paso 3.
- `GOOGLE_SERVICE_ACCOUNT_JSON`: el JSON del paso 2, en una sola línea.
- `SHEET_ID`: el ID de tu hoja (está en la URL, entre `/d/` y `/edit`).
- `SHEET_QUEJAS`: nombre de la pestaña de quejas y sugerencias (por defecto `Quejas`).
- `ASESOR_WHATSAPP_NUMERO`: el número del colaborador de Atención al Cliente.

## 5. Prueba local (opcional, requiere Node.js instalado)

```bash
npm install
npm start
```

## 6. Desplegar gratis en Render

1. Sube esta carpeta a un repositorio de GitHub.
2. Entra a https://render.com/ → "New" → "Web Service" → conecta el repositorio.
3. Configura:
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: **Free**
4. En la pestaña "Environment", agrega todas las variables del paso 4.
5. Al desplegar, Render te da una URL pública, por ejemplo:
   `https://giba-whatsapp-agent.onrender.com`

Nota: en el plan gratuito, el servicio "duerme" tras ~15 minutos sin recibir tráfico y tarda
unos segundos en despertar con el siguiente mensaje. Para un bot de WhatsApp esto es aceptable
(el comensal solo nota unos segundos extra en la primera respuesta tras un rato de inactividad).

## 7. Conectar el webhook en Meta for Developers

1. Ve a tu app de Meta → WhatsApp → Configuration.
2. En "Webhook", pon la URL: `https://tu-servicio.onrender.com/webhook`
3. En "Verify token", pon el mismo valor que pusiste en `WHATSAPP_VERIFY_TOKEN`.
4. Suscríbete al campo `messages`.

## 8. Apagar (o dejar en paralelo) el flujo actual de Make

Este servicio reemplaza toda la lógica de Router/reglas de palabra clave que ya tenías en Make.
Puedes desactivar el escenario de Make cuando confirmes que este servicio responde bien, o
dejarlos en paralelo en modo de prueba usando un número de WhatsApp distinto mientras validas.

## Siguientes pasos sugeridos

- Migrar la lógica de "silencio mientras el asesor atiende" (ya la tenías en Make) a este servicio.
- Agregar el resto de sucursales/promociones especiales al catálogo en Sheets.
- Una vez validado, solicitar el número de producción de WhatsApp (salir del modo de prueba de Meta).
