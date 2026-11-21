// Harbor City desktop app (Electron). Serves the game from inside the app, keeps the optional
// Anthropic API key encrypted on this PC, and makes Claude calls from the main process only.
const { app, BrowserWindow, protocol, net, ipcMain, Menu, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const GAME_DIR = path.join(__dirname, 'game');
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function writeSettings(s) { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(s)); }

function getKey() {
  const s = readSettings();
  if (!s.key) return '';
  try { return s.enc && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(s.key, 'base64')) : s.key; } catch { return ''; }
}
function setKey(k) {
  const s = readSettings();
  if (!k) { delete s.key; delete s.enc; }
  else if (safeStorage.isEncryptionAvailable()) { s.key = safeStorage.encryptString(k).toString('base64'); s.enc = true; }
  else { s.key = k; s.enc = false; }
  writeSettings(s);
}

const SYSTEM = `You voice one citizen of Harbor City, a fictional coastal city in a video game. The player is talking to them face to face.
Stay in character: their age, job, mood, traits and relationship with the player shape how they talk. Street conversations are short: one to three sentences.
They know ONLY what is in "memories" (each says how they know it: saw / sound = only heard it / heard = someone told them / news / self), the listed places, the conversation so far, and ordinary common knowledge.
- If asked about something not in their memories, they say they don't know or didn't see it. Never invent sightings, vehicles, people, times or places.
- When using a memory, put its id in cited_memory_ids and keep its details (colour, place, time) consistent.
- Hearsay and news should be presented as such ("Lena told me...", "it was on the news..."). Low confidence sounds unsure.
- If the player is rude or threatening, react as this personality would; intent "insulted" for insults, "end_conversation" if they would walk away.
Never mention being an AI, a model or a game. No stage directions, emoji or markdown: reply is only the spoken words.
mood_delta (-0.5..0.5) and affinity_delta (-0.6..0.6) are how this exchange changes their mood and their opinion of the player.`;

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    intent: { type: 'string', enum: ['answer', 'small_talk', 'refuse', 'ask_back', 'end_conversation', 'insulted'] },
    mood_delta: { type: 'number' },
    affinity_delta: { type: 'number' },
    cited_memory_ids: { type: 'array', items: { type: 'string' } },
  },
  required: ['reply', 'intent', 'mood_delta', 'affinity_delta', 'cited_memory_ids'],
  additionalProperties: false,
};

let client = null, clientKey = '';
async function askClaude(payload) {
  const key = getKey();
  if (!key) return null;
  const Anthropic = require('@anthropic-ai/sdk');
  if (!client || clientKey !== key) { client = new Anthropic({ apiKey: key, timeout: 30000, maxRetries: 1 }); clientKey = key; }
  try {
    const resp = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify(payload) }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (resp.stop_reason === 'refusal' || resp.stop_reason === 'max_tokens') return null;
    const text = resp.content.find((b) => b.type === 'text')?.text;
    return text ? JSON.parse(text) : null;
  } catch (e) {
    // any API/network/parse error: the game falls back to its built-in, memory-grounded dialogue
    console.error('Claude request failed:', e?.status || '', e?.message || e);
    return null;
  }
}

ipcMain.handle('has-key', () => !!getKey());
ipcMain.handle('set-key', (_e, k) => { setKey(typeof k === 'string' ? k.trim() : ''); return true; });
ipcMain.handle('ask-claude', (_e, payload) => askClaude(payload));
ipcMain.on('quit', () => app.quit());

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const p = decodeURIComponent(new URL(req.url).pathname);
    const file = path.normalize(path.join(GAME_DIR, p));
    if (!file.startsWith(GAME_DIR)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 1024, minHeight: 600, backgroundColor: '#000000', title: 'Harbor City', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });
  // never navigate away from the game or open external pages inside it
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.loadURL('app://local/index.html');
});
app.on('window-all-closed', () => app.quit());
