/**
 * Pre-flight environment check for InstaPilot AI.
 *
 * Runs automatically before `npm run dev` and `npm run db:push`, and as the first
 * step of start-all.bat — so there is exactly one implementation of this logic.
 *
 * Exists because a fresh clone has no .env (it is gitignored, correctly), and the
 * Prisma CLI reads .env ONLY — never .env.local, which Next.js prefers. Without
 * this, the first command a new user runs dies with a bare Prisma P1012,
 * "Environment variable not found: DATABASE_URL", which says nothing about the
 * actual cause: the file was never created.
 *
 * @author Yati Bhardwaj
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const localPath = resolve(root, '.env.local');
const examplePath = resolve(root, '.env.example');

const SUGGESTED_DB_URL = 'postgresql://instapilot:instapilot_secret@localhost:5432/instapilot_db';

/** Must live in .env specifically — the Prisma CLI reads no other file. */
const PRISMA_REQUIRED = ['DATABASE_URL'];
/** Must be readable by the running server: .env, .env.local or the host environment. */
const BOOT_REQUIRED = ['ATTRIBUTION_ACK'];
/** Needed to log in. Generated on first seed, so these should never be blank in practice. */
const LOGIN_REQUIRED = ['APP_ACCESS_KEY', 'SESSION_SECRET'];
/** Needed before the AI features work, but they do not block boot or login. */
const SOFT_REQUIRED = [
  'GROK_API_KEY',
  'GEMINI_API_KEY',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_UPLOAD_PRESET',
];

/** Minimal .env parser — no dependency, since this runs before anything is guaranteed installed. */
function parseEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    // Strip an inline comment, but only on unquoted values. The leading-anchor
    // alternative matters: `KEY=          # note` leaves the value starting at the
    // '#', so a whitespace-only anchor would read the comment itself as the value
    // and report a blank key as configured.
    if (!/^["']/.test(value)) value = value.replace(/(?:^|\s)#.*$/, '').trim();
    value = value.replace(/^(["'])([\s\S]*)\1$/, '$2');
    out[match[1]] = value;
  }
  return out;
}

function bail(lines) {
  console.error('\n' + lines.join('\n') + '\n');
  process.exit(1);
}

/**
 * Create .env from .env.example, filling in the two values that have no "correct"
 * answer a human needs to supply: the session signing secret and the dashboard
 * login key. Both are just random strings, so asking someone to invent them is
 * friction that only produces an opaque 500 at the login screen when they skip it.
 */
function seedEnvFile() {
  let text = readFileSync(examplePath, 'utf8');
  const generated = {};
  const values = {
    SESSION_SECRET: randomBytes(32).toString('hex'),
    APP_ACCESS_KEY: randomBytes(9).toString('base64url'),
  };
  for (const [key, value] of Object.entries(values)) {
    // Only fill a key the example leaves blank — never overwrite a real value.
    const blankLine = new RegExp('^(' + key + ')=[ \\t]*(#.*)?$', 'm');
    if (!blankLine.test(text)) continue;
    text = text.replace(blankLine, (_match, name, comment) =>
      name + '=' + value + (comment ? '    ' + comment : ''),
    );
    generated[key] = value;
  }
  writeFileSync(envPath, text, 'utf8');
  return generated;
}

if (!existsSync(envPath)) {
  if (!existsSync(examplePath)) {
    bail([
      '  x  No .env and no .env.example found in ' + root,
      '     This does not look like a complete InstaPilot AI checkout.',
    ]);
  }
  const generated = seedEnvFile();
  const notes = ['', '  i  No .env file was found, so one has been created from .env.example.'];
  if (generated.APP_ACCESS_KEY) {
    notes.push(
      '',
      '     Your dashboard login key has been generated for you:',
      '',
      '         ' + generated.APP_ACCESS_KEY,
      '',
      '     It is saved in .env as APP_ACCESS_KEY - change it there any time.',
    );
  }
  notes.push(
    '',
    '     The AI features stay switched off until you add your own API keys to',
    '     .env. Everything else is ready to run.',
    '',
  );
  console.log(notes.join('\n'));
}

const fromEnv = parseEnvFile(envPath);
const fromLocal = parseEnvFile(localPath);

// What the running server actually sees: Next.js layers .env.local over .env, and
// real host environment variables win over both.
const effective = { ...fromEnv, ...fromLocal, ...process.env };

// DATABASE_URL is the special case: Prisma reads .env and nothing else, so having
// it only in .env.local is not enough.
const missingDb = PRISMA_REQUIRED.filter((key) => !fromEnv[key] && !process.env[key]);
if (missingDb.length) {
  bail([
    '  x  ' + missingDb.join(', ') + ' is missing or empty in .env',
    '',
    ...(fromLocal.DATABASE_URL
      ? [
          '     It is set in .env.local, but the Prisma CLI never reads that file.',
          '     Copy the same line into .env:',
          '',
          '       DATABASE_URL=' + fromLocal.DATABASE_URL,
          '',
        ]
      : [
          '     This value matches the credentials in docker-compose.yml:',
          '',
          '       DATABASE_URL=' + SUGGESTED_DB_URL,
          '',
        ]),
    '     Then run this command again.',
  ]);
}

// Both files present but pointing at different databases is the silent-empty-database
// trap: db:push writes the schema to one while the app reads the other.
if (fromLocal.DATABASE_URL && fromEnv.DATABASE_URL && fromLocal.DATABASE_URL !== fromEnv.DATABASE_URL) {
  bail([
    '  x  DATABASE_URL differs between .env and .env.local.',
    '',
    '     .env        ' + fromEnv.DATABASE_URL,
    '     .env.local  ' + fromLocal.DATABASE_URL,
    '',
    '     Prisma reads .env, Next.js prefers .env.local, so the schema would be',
    '     pushed to one database while the running app reads another - and the app',
    '     would then report missing tables. Make them identical, or delete',
    '     .env.local and keep .env as the single source.',
  ]);
}

const missingBoot = BOOT_REQUIRED.filter((key) => !effective[key]);
if (missingBoot.length) {
  bail([
    '  x  Missing required value: ' + missingBoot.join(', '),
    '',
    '     ATTRIBUTION_ACK="https://github.com/ys941"   see COPYRIGHT.md',
    '',
    '     The server refuses to start without it. Add it to .env and rerun.',
  ]);
}

// These are generated on first seed, so reaching here means someone blanked them by
// hand. Stop now rather than at the login screen, where the failure surfaces as an
// opaque HTTP 500 from the login route.
const missingLogin = LOGIN_REQUIRED.filter((key) => !effective[key]);
if (missingLogin.length) {
  bail([
    '  x  Missing required value: ' + missingLogin.join(', '),
    '',
    '     Without these the server starts but nobody can log in.',
    '     SESSION_SECRET can be any long random string; APP_ACCESS_KEY is',
    '     whatever you want to type at the login screen. Fill both in .env.',
  ]);
}

const missingSoft = SOFT_REQUIRED.filter((key) => !effective[key]);
if (missingSoft.length) {
  console.warn(
    '\n  !  Not set yet: ' +
      missingSoft.join(', ') +
      '\n     The dashboard runs, but AI features stay disabled until you add these to .env.\n',
  );
}
