#!/usr/bin/env node

// Cifrado del directorio de Usuarios y Claves (data/aquarius-usuarios-2026.json). El repo es publico, asi que el
// archivo vive cifrado: el tablero lo cifra al exportar con la llave publica (data/aquarius-usuarios-publica.pem) y
// solo quien tiene la privada (secret AQ_USERS_PRIVATE_KEY, o credentials/ en local) lo puede leer.
// Esquema hibrido compatible con WebCrypto: una llave AES-256-GCM al azar cifra el JSON y RSA-OAEP-SHA256 la envuelve.
// En claro solo queda updatedAt.
//
//   node scripts/usuarios-cifrado.js ver      muestra el directorio descifrado
//   node scripts/usuarios-cifrado.js llaves   genera un par de llaves nuevo y vuelve a cifrar el archivo con el

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'data', 'aquarius-usuarios-2026.json');
const PUBLIC_KEY_FILE = path.join(ROOT, 'data', 'aquarius-usuarios-publica.pem');
const PRIVATE_KEY_FILE = path.join(ROOT, 'credentials', 'aquarius-usuarios-privada.pem');
const ENCRYPTION = 'RSA-OAEP-SHA256/AES-256-GCM';
const OAEP = { padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };

const rel = file => path.relative(ROOT, file).replace(/\\/g, '/');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const isEncrypted = file => file?.encryption === ENCRYPTION;

function privateKey() {
  const pem = process.env.AQ_USERS_PRIVATE_KEY || (fs.existsSync(PRIVATE_KEY_FILE) ? fs.readFileSync(PRIVATE_KEY_FILE, 'utf8') : '');
  // Un secret pegado desde Windows puede traer CRLF.
  return pem.trim() ? pem.replace(/\r\n?/g, '\n') : null;
}

function encrypt(directory, publicKeyPem, updatedAt) {
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', aesKey, iv);
  // Igual que WebCrypto: el tag de GCM va pegado al final del texto cifrado.
  const data = Buffer.concat([cipher.update(JSON.stringify(directory), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  return {
    updatedAt,
    encryption: ENCRYPTION,
    key: crypto.publicEncrypt({ key: publicKeyPem, ...OAEP }, aesKey).toString('base64'),
    iv: iv.toString('base64'),
    data: data.toString('base64'),
  };
}

function decrypt(file, privateKeyPem) {
  const aesKey = crypto.privateDecrypt({ key: privateKeyPem, ...OAEP }, Buffer.from(file.key, 'base64'));
  const data = Buffer.from(file.data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', aesKey, Buffer.from(file.iv, 'base64'));
  decipher.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8');
  return { ...JSON.parse(plain), updatedAt: file.updatedAt };
}

// Para el build: el directorio en claro o, si no se puede leer, { locked } con el motivo. La llave no corta el
// build: sin ella solo se bloquea este modulo y el resto del tablero (y la sincronizacion diaria) se sigue publicando.
function readForBuild() {
  const file = readJson(DATA_FILE);
  if (!isEncrypted(file)) {
    throw new Error(`${rel(DATA_FILE)} no esta cifrado: los nombres quedarian publicos en el repo. Cifralo con "node scripts/usuarios-cifrado.js llaves"`);
  }
  const key = privateKey();
  if (!key) return { updatedAt: file.updatedAt, locked: 'sin-llave' };
  try {
    return decrypt(file, key);
  } catch {
    return { updatedAt: file.updatedAt, locked: 'llave-invalida' };
  }
}

// La llave publica en DER/base64, que es lo que importa WebCrypto ('spki').
function publicKeyBase64() {
  return crypto.createPublicKey(fs.readFileSync(PUBLIC_KEY_FILE, 'utf8')).export({ type: 'spki', format: 'der' }).toString('base64');
}

function generateKeys() {
  const file = fs.existsSync(DATA_FILE) ? readJson(DATA_FILE) : {};
  let directory;
  if (isEncrypted(file)) {
    const key = privateKey();
    if (!key) throw new Error(`hace falta la llave privada actual (AQ_USERS_PRIVATE_KEY o ${rel(PRIVATE_KEY_FILE)}) para volver a cifrar el directorio sin perderlo`);
    directory = decrypt(file, key);
  } else {
    directory = { keyChangedAt: file.keyChangedAt || '', users: Array.isArray(file.users) ? file.users : [] };
  }
  const { updatedAt = new Date().toISOString(), ...content } = directory;
  const pair = crypto.generateKeyPairSync('rsa', {
    modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  fs.mkdirSync(path.dirname(PRIVATE_KEY_FILE), { recursive: true });
  // La privada anterior se guarda aparte: si algo falla a medio camino el archivo se sigue pudiendo abrir.
  if (fs.existsSync(PRIVATE_KEY_FILE)) fs.copyFileSync(PRIVATE_KEY_FILE, PRIVATE_KEY_FILE.replace(/\.pem$/, '.anterior.pem'));
  fs.writeFileSync(PRIVATE_KEY_FILE, pair.privateKey, { mode: 0o600 });
  fs.writeFileSync(PUBLIC_KEY_FILE, pair.publicKey);
  fs.writeFileSync(DATA_FILE, `${JSON.stringify(encrypt(content, pair.publicKey, updatedAt), null, 2)}\n`);
  console.log(`[usuarios] llaves nuevas: ${rel(PUBLIC_KEY_FILE)} (va al repo) y ${rel(PRIVATE_KEY_FILE)} (NO va al repo)`);
  console.log(`[usuarios] ${rel(DATA_FILE)} cifrado de nuevo con ${content.users.length} usuarios`);
  console.log('[usuarios] Copia la llave privada en el secret AQ_USERS_PRIVATE_KEY de GitHub y guarda un respaldo.');
}

function main(command) {
  if (command === 'llaves') return generateKeys();
  if (command === 'ver') {
    const key = privateKey();
    if (!key) throw new Error(`falta la llave privada (AQ_USERS_PRIVATE_KEY o ${rel(PRIVATE_KEY_FILE)})`);
    return console.log(JSON.stringify(decrypt(readJson(DATA_FILE), key), null, 2));
  }
  console.log('Uso: node scripts/usuarios-cifrado.js ver | llaves');
  process.exitCode = 1;
}

if (require.main === module) {
  try {
    main(process.argv[2]);
  } catch (error) {
    console.error('[usuarios] error:', error.message);
    process.exit(1);
  }
}

module.exports = { readForBuild, publicKeyBase64 };
