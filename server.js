/* ============================================================
   ONLY LOVE — BACKEND (autenticación + verificación de correo)
   ============================================================
   Este servidor hace TODO:
   1) Sirve auth.html (público) y plataforma.html (PROTEGIDO por sesión)
   2) Registro y login de usuarios (con contraseña hasheada)
   3) Verificación de correo con código de 6 dígitos (Resend)
   4) Maneja la sesión del usuario con cookies httpOnly

   ⚠️ ALMACENAMIENTO:
   Los usuarios se guardan en un archivo JSON local (users.json)
   y los códigos de verificación en memoria. Esto es válido para
   un proyecto pequeño o una tesis/demo. Para producción real con
   muchos usuarios, migra a una base de datos (PostgreSQL, MongoDB).
============================================================ */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Resend } = require('resend');

const app = express();
const resend = new Resend(process.env.RESEND_API_KEY);

const PORT = process.env.PORT || 3000;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Only Love <onboarding@resend.dev>';
const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const USERS_FILE = path.join(__dirname, 'users.json');

app.use(express.json());
app.set('trust proxy', 1); // necesario en Render para que las cookies "secure" funcionen

app.use(session({
  secret: process.env.SESSION_SECRET || 'cambia-este-secreto-en-tu-.env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 días
  },
}));

/* ============================================================
   ALMACÉN DE USUARIOS (archivo JSON simple)
============================================================ */
function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
  } catch {
    return {};
  }
}
function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ============================================================
   ALMACÉN TEMPORAL DE CÓDIGOS DE VERIFICACIÓN (en memoria)
============================================================ */
const verificationStore = new Map();
function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

/* ============================================================
   ENVÍO Y VALIDACIÓN DE CÓDIGO DE VERIFICACIÓN DE CORREO
============================================================ */
app.post('/api/send-verification', async (req, res) => {
  const { email } = req.body;
  if (!isValidEmail(email)) {
    return res.status(400).json({ ok: false, error: 'Correo inválido.' });
  }

  const existing = verificationStore.get(email);
  if (existing && Date.now() - existing.lastSentAt < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - existing.lastSentAt)) / 1000);
    return res.status(429).json({ ok: false, error: `Espera ${waitSec}s antes de reenviar.` });
  }

  const code = generateCode();
  verificationStore.set(email, {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    lastSentAt: Date.now(),
    attempts: 0,
  });

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: 'Tu código de verificación — Only Love',
      html: `
        <div style="font-family:sans-serif;max-width:420px;margin:0 auto">
          <h2 style="color:#8A142C">Only Love</h2>
          <p>Tu código de verificación es:</p>
          <p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#8A142C">${code}</p>
          <p style="color:#666;font-size:13px">Este código vence en 10 minutos. Si no solicitaste este código, ignora este correo.</p>
        </div>
      `,
    });
    return res.json({ ok: true, message: 'Código enviado correctamente.' });
  } catch (err) {
    console.error('Error al enviar correo con Resend:', err);
    return res.status(500).json({ ok: false, error: 'No se pudo enviar el correo. Intenta de nuevo.' });
  }
});

app.post('/api/verify-email', (req, res) => {
  const { email, code } = req.body;
  if (!isValidEmail(email) || !code) {
    return res.status(400).json({ ok: false, valid: false, error: 'Datos incompletos.' });
  }

  const record = verificationStore.get(email);
  if (!record) {
    return res.status(400).json({ ok: false, valid: false, error: 'No hay un código pendiente. Solicita uno nuevo.' });
  }
  if (Date.now() > record.expiresAt) {
    verificationStore.delete(email);
    return res.status(400).json({ ok: false, valid: false, error: 'El código expiró. Solicita uno nuevo.' });
  }

  record.attempts += 1;
  if (record.attempts > 5) {
    verificationStore.delete(email);
    return res.status(429).json({ ok: false, valid: false, error: 'Demasiados intentos. Solicita un nuevo código.' });
  }

  if (record.code !== String(code).trim()) {
    return res.status(400).json({ ok: false, valid: false, error: 'Código incorrecto.' });
  }

  record.verified = true; // marcamos el correo como verificado para esta sesión de registro
  return res.json({ ok: true, valid: true, message: 'Correo verificado correctamente.' });
});

/* ============================================================
   REGISTRO — crea el usuario (requiere correo ya verificado)
============================================================ */
app.post('/api/register', async (req, res) => {
  const { name, email, password, phone } = req.body;

  if (!name || !isValidEmail(email) || !password) {
    return res.status(400).json({ ok: false, error: 'Faltan datos obligatorios.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ ok: false, error: 'La contraseña debe tener mínimo 8 caracteres.' });
  }

  const verification = verificationStore.get(email);
  if (!verification || !verification.verified) {
    return res.status(403).json({ ok: false, error: 'Debes verificar tu correo antes de crear la cuenta.' });
  }

  const users = loadUsers();
  if (users[email]) {
    return res.status(409).json({ ok: false, error: 'Ya existe una cuenta con ese correo.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  users[email] = {
    name,
    email,
    phone: phone || '',
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  saveUsers(users);
  verificationStore.delete(email);

  // Inicia sesión automáticamente tras registrarse
  req.session.userEmail = email;
  return res.json({ ok: true, message: 'Cuenta creada correctamente.' });
});

/* ============================================================
   LOGIN
============================================================ */
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  if (!isValidEmail(email) || !password) {
    return res.status(400).json({ ok: false, error: 'Completa correo y contraseña.' });
  }

  const users = loadUsers();
  const user = users[email];
  if (!user) {
    return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos.' });
  }

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) {
    return res.status(401).json({ ok: false, error: 'Correo o contraseña incorrectos.' });
  }

  req.session.userEmail = email;
  return res.json({ ok: true, message: 'Sesión iniciada.' });
});

/* ============================================================
   LOGOUT
============================================================ */
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

/* ============================================================
   SESIÓN ACTUAL (usado por plataforma.html para verificar)
============================================================ */
app.get('/api/session', (req, res) => {
  if (req.session && req.session.userEmail) {
    const users = loadUsers();
    const user = users[req.session.userEmail];
    return res.json({
      authenticated: true,
      user: user ? { name: user.name, email: user.email } : null,
    });
  }
  return res.json({ authenticated: false });
});

/* ============================================================
   MIDDLEWARE DE PROTECCIÓN
   Bloquea el acceso a plataforma.html si no hay sesión activa.
   Esta es la pieza central que soluciona el problema de seguridad:
   nadie puede ver la app sin haber iniciado sesión antes,
   sin importar si conoce la URL directa.
============================================================ */
function requireAuth(req, res, next) {
  if (req.session && req.session.userEmail) {
    return next();
  }
  return res.redirect('/auth.html');
}

/* ============================================================
   ARCHIVOS ESTÁTICOS Y RUTAS PROTEGIDAS
============================================================ */
// plataforma.html SOLO se entrega si hay sesión válida
app.get('/plataforma.html', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'plataforma.html'));
});

// La raíz redirige según el estado de sesión
app.get('/', (req, res) => {
  if (req.session && req.session.userEmail) {
    return res.redirect('/plataforma.html');
  }
  return res.redirect('/auth.html');
});

// El resto de archivos estáticos (auth.html, CSS/JS si los separas, etc.)
// se sirven libremente porque son públicos.
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`✅ Only Love corriendo en http://localhost:${PORT}`);
});
