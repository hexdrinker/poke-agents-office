#!/usr/bin/env node
// Watches Claude Code's own session records (~/.claude) and relays them to the browser over SSE.
// No hooks needed: live sessions come from sessions/*.json, activity from the transcript .jsonl files.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PORT) || 7777;
const ROOT = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude');
const POLL_MS = 250;   // tail transcripts this often: Claude Code appends a line per finished message
const SCAN_EVERY = 4;  // ...and look for started/ended sessions every 4th tick (1s)
const HISTORY = 30; // events replayed from a transcript that was already running when we started
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);

// Game graphics are never committed: fetched once from their source repos, then served from .cache/.
const UPSTREAM = {
  '/pret/': 'https://raw.githubusercontent.com/pret/pokefirered/master/',
  '/pmd/': 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite/',
};
const CACHE = path.join(__dirname, '.cache');
const TYPES = { '.png': 'image/png', '.woff2': 'font/woff2', '.xml': 'text/xml', '.txt': 'text/plain' };
const inflight = new Map();

const clients = new Set();
const log = []; // ponytail: in-memory replay buffer, lost on restart
const seats = new Map(); // pid -> { sessionId, cwd }; one pokémon per Claude process, so /clear keeps it
const files = new Map(); // transcript path -> { offset, rest, seat, sub, tools }
let firstPoll = true;

const short = (s, n = 60) => (s && String(s).length > n ? String(s).slice(0, n) + '…' : s);
const firstLine = s => String(s).trim().split('\n').find(l => l.trim()) || '';
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const ls = d => { try { return fs.readdirSync(d); } catch { return []; } };
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

function emit(ev) {
  log.push(ev);
  if (log.length > 3000) log.shift();
  const line = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) c.write(line);
}

function detailOf(name, i = {}) {
  if (name === 'AskUserQuestion') return i.questions?.[0]?.question;
  if (name === 'TodoWrite') return i.todos?.find(t => t.status === 'in_progress')?.content ?? i.todos?.[0]?.content;
  return i.description ?? (i.file_path && path.basename(i.file_path)) ?? i.command ?? i.pattern ?? i.query ?? i.url ?? i.subject ?? i.plan;
}

// One transcript record -> zero or more office events.
function convert(r, f) {
  const base = { t: Date.parse(r.timestamp) || Date.now(), session: f.seat, cwd: r.cwd,
                 agentId: f.sub?.agentId, parentToolId: f.sub?.toolUseId, agentType: f.sub?.agentType };
  const content = r.message?.content, out = [];
  if (r.type === 'assistant' && Array.isArray(content)) {
    for (const b of content) {
      if (b.type === 'text' && b.text?.trim()) out.push({ ...base, event: 'Say', detail: short(firstLine(b.text)) });
      if (b.type === 'tool_use') {
        f.tools.set(b.id, b.name);
        out.push({ ...base, event: 'PreToolUse', tool: b.name, toolId: b.id, detail: short(detailOf(b.name, b.input)),
                   agentType: b.input?.subagent_type ?? base.agentType });
      }
    }
    if (r.message.stop_reason === 'end_turn') out.push({ ...base, event: 'Stop' });
  } else if (r.type === 'user' && !r.isMeta) {
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    for (const b of blocks) {
      if (b.type === 'tool_result')
        out.push({ ...base, event: 'PostToolUse', tool: f.tools.get(b.tool_use_id), toolId: b.tool_use_id, error: b.is_error === true,
                   async: r.toolUseResult?.isAsync === true });
      // command echoes and reminders start with a tag; a subagent's first message is its task, not a prompt
      else if (b.type === 'text' && !f.sub && b.text && !b.text.trimStart().startsWith('<'))
        out.push({ ...base, event: 'UserPromptSubmit', detail: short(firstLine(b.text)) });
    }
  }
  return out;
}

function track(file, seat, sub, fromEnd) {
  if (files.has(file)) return;
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return; }
  const f = { offset: 0, rest: '', seat, sub, tools: new Map() };
  files.set(file, f);
  if (fromEnd === 'skip') { f.offset = size; return; }
  if (fromEnd === 'summary') { // already running: count its work for the level, replay only the tail
    const evs = readNew(file, f);
    const toolCount = evs.slice(0, -HISTORY).filter(e => e.event === 'PreToolUse').length; // the tail is replayed below
    emit({ t: Date.now(), session: seat, event: 'Init', toolCount, cwd: evs.find(e => e.cwd)?.cwd });
    evs.slice(-HISTORY).forEach(emit);
  }
}

function readNew(file, f) {
  let buf;
  try {
    if (fs.statSync(file).size === f.offset) return []; // nothing new: skip opening the file
    const fd = fs.openSync(file, 'r'), size = fs.fstatSync(fd).size;
    if (size < f.offset) f.offset = 0; // rewritten
    buf = Buffer.alloc(size - f.offset);
    fs.readSync(fd, buf, 0, buf.length, f.offset);
    fs.closeSync(fd);
    f.offset = size;
  } catch { return []; }
  const lines = (f.rest + buf.toString('utf8')).split('\n');
  f.rest = lines.pop(); // keep a partially written line for next time
  const out = [];
  for (const l of lines) {
    if (!l.trim()) continue;
    try { out.push(...convert(JSON.parse(l), f)); } catch {}
  }
  return out;
}

const transcripts = new Map(); // sessionId -> transcript path, so we search the project folders once
function findTranscript(sessionId) {
  if (transcripts.has(sessionId)) return transcripts.get(sessionId);
  for (const p of ls(path.join(ROOT, 'projects'))) {
    const file = path.join(ROOT, 'projects', p, sessionId + '.jsonl');
    if (fs.existsSync(file)) { transcripts.set(sessionId, file); return file; }
  }
}

let tick = 0;
function poll() {
  if (tick++ % SCAN_EVERY === 0) scan();
  for (const [file, f] of files) readNew(file, f).forEach(emit);
}

function scan() {
  const now = new Map();
  for (const name of ls(path.join(ROOT, 'sessions'))) {
    if (!name.endsWith('.json')) continue;
    const s = readJson(path.join(ROOT, 'sessions', name));
    if (s?.pid && s.sessionId && alive(s.pid)) now.set(String(s.pid), s);
  }

  for (const [seat, s] of now) {
    const prev = seats.get(seat);
    if (!prev) emit({ t: Date.now(), session: seat, event: 'SessionStart', cwd: s.cwd });
    const file = findTranscript(s.sessionId);
    if (file) {
      track(file, seat, null, firstPoll ? 'summary' : null);
      // subagents live next to the transcript: <sessionId>/subagents/agent-<id>.jsonl (+ .meta.json)
      const dir = path.join(file.slice(0, -'.jsonl'.length), 'subagents');
      for (const n of ls(dir)) {
        if (!n.endsWith('.jsonl')) continue;
        const meta = readJson(path.join(dir, n.replace('.jsonl', '.meta.json'))) || {};
        track(path.join(dir, n), seat, { agentId: n.slice(6, -6), toolUseId: meta.toolUseId, agentType: meta.agentType },
              firstPoll ? 'skip' : null);
      }
    }
  }
  for (const seat of seats.keys()) if (!now.has(seat)) emit({ t: Date.now(), session: seat, event: 'SessionEnd' });
  seats.clear();
  for (const [seat, s] of now) seats.set(seat, s);

  for (const [file, f] of files) if (!now.has(f.seat)) files.delete(file);
  firstPoll = false;
}


async function cached(rel, source) {
  const file = path.join(CACHE, rel);
  try { return await fs.promises.readFile(file); } catch {}
  if (!inflight.has(file)) // several tiles ask for the same tileset at once: download it once
    inflight.set(file, (async () => {
      const r = await fetch(source);
      if (!r.ok) throw Object.assign(new Error(source), { status: r.status === 404 ? 404 : 502 });
      const buf = Buffer.from(await r.arrayBuffer());
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, buf);
      return buf;
    })().finally(() => inflight.delete(file)));
  return inflight.get(file);
}

setInterval(poll, POLL_MS);
poll();

http.createServer((req, res) => {
  // DNS-rebinding guard: only answer requests addressed to localhost.
  if (!HOSTS.has(req.headers.host)) { res.statusCode = 403; return res.end(); }
  const url = req.url.split('?')[0];

  if (url === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    for (const ev of log) res.write(`data: ${JSON.stringify(ev)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  const prefix = Object.keys(UPSTREAM).find(p => url.startsWith(p));
  if (prefix || url.startsWith('/vendor/')) {
    const rel = decodeURIComponent(url.slice(1));
    if (!/^[\w./-]+$/.test(rel) || rel.split('/').includes('..')) { res.statusCode = 400; return res.end(); }
    res.setHeader('Content-Type', TYPES[path.extname(rel)] || 'application/octet-stream');
    if (!prefix) return fs.createReadStream(path.join(__dirname, rel)).on('error', () => { res.statusCode = 404; res.end(); }).pipe(res);
    cached(rel, UPSTREAM[prefix] + rel.slice(prefix.length - 1))
      .then(buf => res.end(buf))
      .catch(e => { res.statusCode = e.status || 502; res.end(); });
    return;
  }

  if (url === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return fs.createReadStream(path.join(__dirname, 'index.html')).pipe(res);
  }

  res.statusCode = 404;
  res.end();
}).listen(PORT, '127.0.0.1', () => console.log(`poke-agents-office → http://127.0.0.1:${PORT}  (watching ${ROOT})`));
