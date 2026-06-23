# Only Love — Backend con autenticación real y verificación de correo

Esta versión soluciona el problema de seguridad: **ya no se puede ver la app (`plataforma.html`) sin haber iniciado sesión**, porque el mismo servidor que valida la sesión es el que entrega el archivo.

## Estructura del proyecto

```
backend/
├── server.js          ← servidor Express (auth + sesiones + verificación de correo)
├── package.json
├── .env.example
├── .gitignore
└── public/
    ├── auth.html       ← pantallas públicas: splash, login, registro, verificación, recuperar
    └── plataforma.html        ← la app real (home, chat, perfil, etc.) — PROTEGIDA
```

## Cómo funciona la protección

1. Alguien visita tu dominio → el servidor revisa si tiene una sesión activa (cookie).
2. **Si NO tiene sesión** → lo redirige automáticamente a `auth.html` (no puede ver nada de la app).
3. **Si SÍ tiene sesión** → puede entrar a `plataforma.html` con normalidad.
4. Cuando alguien hace login o termina de registrarse, el servidor crea la sesión y lo manda a `plataforma.html`.
5. Al "Cerrar sesión", el servidor destruye la sesión y vuelve a `auth.html`.

## 1. Instala dependencias

```bash
cd backend
npm install
```

## 2. Configura tu `.env`

```bash
cp .env.example .env
```

Completa:
- `RESEND_API_KEY` — tu clave de Resend
- `FROM_EMAIL` — tu correo remitente verificado
- `SESSION_SECRET` — una frase larga y aleatoria (genera una en https://generate-secret.vercel.app/32)

## 3. Prueba en tu computadora

```bash
npm start
```

Abre `http://localhost:3000` — debería mandarte a `auth.html` automáticamente.

## 4. Despliega TODO en Render (frontend + backend juntos)

Ya no necesitas Vercel — el mismo servidor de Render sirve tanto la interfaz como la API.

1. Sube esta carpeta `backend` completa a tu repositorio de GitHub.
2. En **render.com** → **New → Web Service** → conecta tu repositorio.
3. Configuración:
   - **Root Directory**: `backend` (si tu repo tiene esta carpeta dentro)
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. En **Environment Variables**, agrega las mismas variables de tu `.env`: `RESEND_API_KEY`, `FROM_EMAIL`, `SESSION_SECRET`, `NODE_ENV=production`.
5. Despliega. Render te dará una URL como `https://only-love.onrender.com`.

## 5. Conecta tu dominio

1. En tu servicio de Render, ve a **Settings → Custom Domains** → agrega tu dominio (ej. `onlyloveapp.com`).
2. Render te mostrará los registros DNS a configurar (normalmente un CNAME).
3. Ve a tu proveedor de dominio (Porkbun/Namecheap) y agrega ese registro.
4. Espera a que se verifique (puede tardar minutos a un par de horas).

## 6. Importante sobre Vercel

Ya **no necesitas tu proyecto en Vercel** para esta app — todo vive ahora en Render. Si quieres, puedes eliminar el proyecto de Vercel para no confundirte, o dejarlo sin usar.

## Notas para producción real (más allá de la demo/tesis)

- **`users.json`**: válido para pocos usuarios o una demo académica. Para producción real con muchos usuarios concurrentes, migra a una base de datos (PostgreSQL, MongoDB) — los archivos JSON no soportan bien escrituras simultáneas.
- **Códigos de verificación en memoria**: se pierden si el servidor se reinicia. Para producción, usa Redis o una tabla en base de datos.
- **HTTPS**: Render ya da HTTPS automático, así que las cookies `secure` funcionarán correctamente en producción.
