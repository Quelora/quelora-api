🛠️ 1. Instalación
bash
Copiar
Editar
npm init -y
npm install web-push express body-parser
🔐 2. Generar claves VAPID (una vez)
js
Copiar
Editar
// generar-keys.js
const webPush = require('web-push');

const keys = webPush.generateVAPIDKeys();
console.log(keys);
Ejecutá:

bash
Copiar
Editar
node generar-keys.js
Guardá el resultado:

js
Copiar
Editar
{
  publicKey: 'BN8q....',
  privateKey: '3b7j....'
}
🌐 3. Backend (Node.js)
js
Copiar
Editar
// server.js
const express = require('express');
const webPush = require('web-push');
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());

// Claves VAPID
const vapidKeys = {
  publicKey: 'TU_CLAVE_PUBLICA',
  privateKey: 'TU_CLAVE_PRIVADA',
};

webPush.setVapidDetails(
  'mailto:tu@email.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// Endpoint para guardar suscripción del cliente (en la vida real, guardar en BD)
let subscriptions = [];

app.post('/subscribe', (req, res) => {
  const subscription = req.body;
  subscriptions.push(subscription);
  res.status(201).json({ message: 'Suscripción guardada' });
});

// Endpoint para enviar notificación
app.post('/sendNotification', async (req, res) => {
  const payload = JSON.stringify({ title: 'Nuevo post', body: '¡Hola seguidores!' });

  const results = await Promise.allSettled(
    subscriptions.map((sub) => webPush.sendNotification(sub, payload))
  );

  res.json({ success: true, results });
});

app.listen(3000, () => {
  console.log('Servidor Web Push en http://localhost:3000');
});
🧠 4. Frontend (HTML + JS)
html
Copiar
Editar
<!-- index.html -->
<!DOCTYPE html>
<html>
<head>
  <title>Web Push Demo</title>
</head>
<body>
  <h1>Web Push Demo</h1>
  <button id="subscribeBtn">Suscribirse</button>

  <script>
    const publicKey = 'TU_CLAVE_PUBLICA';

    async function subscribeUser() {
      const registration = await navigator.serviceWorker.register('sw.js');

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      });

      await fetch('/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription)
      });

      alert('Suscrito!');
    }

    document.getElementById('subscribeBtn').onclick = subscribeUser;

    // Función para convertir clave base64
    function urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - base64String.length % 4) % 4);
      const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
      const rawData = atob(base64);
      return new Uint8Array([...rawData].map(char => char.charCodeAt(0)));
    }
  </script>
</body>
</html>
🧾 5. Service Worker (sw.js)
js
Copiar
Editar
self.addEventListener('push', function (event) {
  const data = event.data.json();

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'https://via.placeholder.com/128',
    })
  );
});
