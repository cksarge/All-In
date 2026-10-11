// Minimal stand-in for Supabase Auth + PostgREST, backed by the local Postgres
// that has the real All In SQL loaded. Test-only.
const http = require('http');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 55432, user: 'postgres', database: 'postgres', max: 10 });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (sub) => `${b64({ alg: 'none' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.x`;
const subFrom = (req) => {
  const a = req.headers['authorization'] || '';
  try {
    return JSON.parse(Buffer.from(a.split(' ')[1].split('.')[1], 'base64url').toString()).sub || null;
  } catch {
    return null;
  }
};
const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'access-control-expose-headers': '*',
};
const send = (res, status, body, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...cors, ...extra });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

async function asUser(sub, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${sub ? 'authenticated' : 'anon'}`);
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [sub || '']);
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const lit = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return `'{${v.map((x) => (typeof x === 'number' ? x : `"${String(x).replace(/["\\]/g, '')}"`)).join(',')}}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};
const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad identifier ' + s);
  return s;
};

async function userJson(id) {
  const { rows } = await pool.query('select id, email, raw_user_meta_data from auth.users where id = $1', [id]);
  const u = rows[0];
  return { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: u.raw_user_meta_data, identities: [{ id: u.id }], created_at: new Date().toISOString() };
}

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') return send(res, 204);
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    try {
      // --- Auth ---
      if (p === '/auth/v1/token') {
        const { rows } = await pool.query('select id from auth.users where email = $1', [body.email]);
        if (!rows[0]) return send(res, 400, { code: 'invalid_credentials', error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
        const user = await userJson(rows[0].id);
        return send(res, 200, { access_token: token(user.id), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user });
      }
      if (p === '/auth/v1/user') {
        const sub = subFrom(req);
        return sub ? send(res, 200, await userJson(sub)) : send(res, 401, { msg: 'no' });
      }
      if (p === '/auth/v1/logout') return send(res, 204);

      const sub = subFrom(req);
      // --- RPC ---
      const rpc = p.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
      if (rpc) {
        const fn = ident(rpc[1]);
        const args = Object.entries(body).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(', ');
        const { rows: ret } = await pool.query(
          "select t.typname from pg_proc p join pg_namespace n on n.oid = p.pronamespace join pg_type t on t.oid = p.prorettype where n.nspname = 'public' and p.proname = $1 limit 1",
          [fn],
        );
        if (!ret[0]) return send(res, 404, { code: 'PGRST202', message: 'function not found' });
        const r = await asUser(sub, (c) => c.query(`select public.${fn}(${args})::text as r`));
        const v = r.rows[0].r;
        const type = ret[0].typname;
        if (type === 'void') return send(res, 204);
        if (v === null) return send(res, 200, null);
        return send(res, 200, type === 'jsonb' || type === 'json' ? JSON.parse(v) : type === 'text' ? v : JSON.parse(v));
      }
      // --- Tables (GET only, simple filters) ---
      const tbl = p.match(/^\/rest\/v1\/([a-z_0-9]+)$/);
      if (tbl && req.method === 'GET') {
        const t = ident(tbl[1]);
        let cols = '*';
        const where = [];
        let order = '';
        let limit = '';
        for (const [k, v] of url.searchParams) {
          if (k === 'select') cols = v.trim() === '*' ? '*' : v.split(',').map((c) => ident(c.trim())).join(', ');
          else if (k === 'order') {
            const [col, dir] = v.split('.');
            order = ` order by ${ident(col)} ${dir === 'desc' ? 'desc' : 'asc'}`;
          } else if (k === 'limit') limit = ` limit ${parseInt(v, 10)}`;
          else {
            const m = v.match(/^(eq|neq|gt|lt)\.(.*)$/);
            if (m) where.push(`${ident(k)} ${{ eq: '=', neq: '<>', gt: '>', lt: '<' }[m[1]]} ${m[2] === 'true' || m[2] === 'false' ? m[2] : lit(m[2])}`);
          }
        }
        const sql = `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) as r from (select ${cols} from public.${t}${where.length ? ' where ' + where.join(' and ') : ''}${order}${limit}) x`;
        const r = await asUser(sub, (c) => c.query(sql));
        const rows = r.rows[0].r;
        if ((req.headers['accept'] || '').includes('vnd.pgrst.object')) {
          if (rows.length === 0) return send(res, 406, { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' });
          return send(res, 200, rows[0]);
        }
        return send(res, 200, rows);
      }
      return send(res, 404, { message: 'not mocked: ' + p });
    } catch (e) {
      return send(res, 400, { message: e.message, code: e.code, details: e.detail || null, hint: e.hint || null });
    }
  })
  .listen(54321, () => console.log('mini-supabase on :54321'));
