// The local database for the photo checks (docs/photos-server.md, 11.1): one
// PGlite (Postgres compiled to WebAssembly, in this process) served over the
// Postgres wire protocol, so the REAL server.ts connects to it with
// postgres.js like it does to Neon.
//
// PGlite is a single session: it runs one statement at a time and has one
// transaction state. The published pglite-socket mixes up results after an
// error and can't serve the server's pool of 3 connections. This server
// accepts many TCP clients and shares the one session between them:
//   - each client's extended-protocol messages are buffered until Sync, Flush
//     or a simple Query, and run as ONE batch under runExclusive;
//   - a client that leaves a transaction open keeps the database until it
//     ends (the others wait), so transactions never interleave;
//   - extra ReadyForQuery messages PGlite sends after an error are dropped, so
//     each client gets exactly one per Sync, as from real Postgres.
// Checked with the server's exact pool settings: 0 wrong results in 2,000
// mixed queries. What it can't do: run two statements at once, so races
// (11.5) prove nothing here, and code that queries through `db` while its own
// transaction is open would wait forever (it wouldn't on Neon).
//
//   PORT=5440 node pg-batch-server.mjs          (PGDATA=<dir> keeps the data; default in memory)
//
// Connect with postgres://postgres@localhost:5440/postgres. It must say
// localhost (helpers/db.tsx turns SSL off only for "localhost"). It listens on
// 127.0.0.1 only.
import net from 'node:net'
import { PGlite } from '@electric-sql/pglite'
const port = Number(process.env.PORT || 5440)
const db = await PGlite.create(process.env.PGDATA ? process.env.PGDATA : 'memory://')
let owner = null; const waiters = []
const acquire = (id) => new Promise(res => { if (owner === null || owner === id) { owner = id; res() } else waiters.push([id, res]) })
const release = (id, midCycle = false) => { if (owner !== id || midCycle || db.isInTransaction()) return; owner = null; while (waiters.length && (owner === null)) { const [wid, res] = waiters.shift(); owner = wid; res() } }
let nextId = 1
net.createServer(sock => {
  const id = nextId++; let buf = Buffer.alloc(0); let pending = []; let chain = Promise.resolve(); let started = false
  sock.setNoDelay(true)
  const run = (msg, endsWithSync = true) => { chain = chain.then(async () => {
    await acquire(id)
    try {
      const chunks = []
      await db.runExclusive(() => db.execProtocolRawStream(msg, { onRawData: d => chunks.push(Buffer.from(d)) }))
      // PGlite sends ReadyForQuery right after an ErrorResponse and again for the Sync,
      // and also after an error in a Flush-terminated batch. Real Postgres sends exactly
      // one ReadyForQuery per Sync/Query. Keep only the final one (none after Flush).
      const all = Buffer.concat(chunks); const parts = []; let i = 0, lastZ = -1
      while (i + 5 <= all.length) { const len = 1 + all.readInt32BE(i + 1); parts.push(all.subarray(i, i + len)); if (all[i] === 0x5a) lastZ = parts.length - 1; i += len }
      const out = Buffer.concat(parts.filter((m, k) => m[0] !== 0x5a || (endsWithSync && k === lastZ)))
      if (out.length && sock.writable) sock.write(out)
    }
    catch (e) { console.error('exec error', e) }
    release(id, !endsWithSync) // after Parse/Describe/Flush the client sends Bind/Execute/Sync next; keep the db until then
  }) }
  sock.on('data', d => {
    buf = Buffer.concat([buf, d])
    for (;;) {
      if (!started) { // SSLRequest / StartupMessage (no type byte)
        if (buf.length < 8) return
        const len = buf.readInt32BE(0), code = buf.readInt32BE(4)
        if (buf.length < len) return
        if (code === 80877103) { sock.write('N'); buf = buf.subarray(8); continue }
        started = true; run(new Uint8Array(buf.subarray(0, len))); buf = buf.subarray(len); continue
      }
      if (buf.length < 5) return
      const t = String.fromCharCode(buf[0]); const len = 1 + buf.readInt32BE(1)
      if (buf.length < len) return
      const m = buf.subarray(0, len); buf = buf.subarray(len)
      if (t === 'X') { sock.end(); return }
      pending.push(m)
      if (t === 'S' || t === 'H' || t === 'Q') { run(new Uint8Array(Buffer.concat(pending)), t !== 'H'); pending = [] }
    }
  })
  const done = async () => { await chain; if (owner === id) { if (db.isInTransaction()) await db.exec('ROLLBACK'); owner = null; release(id); if (owner === null && waiters.length) { const [wid, res] = waiters.shift(); owner = wid; res() } } }
  sock.on('close', done); sock.on('error', () => {})
}).listen(port, '127.0.0.1', () => console.log(`batch server ready on :${port} (${process.env.PGDATA || 'in memory'})`))
