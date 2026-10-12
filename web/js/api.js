// relative to the page so the app works under any phosphorus mount path
const BASE = new URL('api/', location.href.split('#')[0].replace(/[^/]*$/, ''));

export const session = {
  get player() {
    try {
      return JSON.parse(localStorage.getItem('tavern.player') ?? localStorage.getItem('rpg.player') ?? 'null');
    } catch {
      return null;
    }
  },
  set player(p) {
    try {
      localStorage.setItem('tavern.player', JSON.stringify(p));
    } catch {
      /* private mode */
    }
  },
};

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export async function api(method, path, body) {
  return request(method, path, { 'content-type': 'application/json' }, body === undefined ? undefined : JSON.stringify(body));
}

// a file sent as it is, its name in a header
export async function upload(path, file) {
  return request('POST', path, { 'content-type': 'application/octet-stream', 'x-filename': encodeURIComponent(file.name) }, file);
}

async function request(method, path, headers, body) {
  const p = session.player;
  if (p?.id) headers['x-player-id'] = p.id;
  const res = await fetch(new URL(path.replace(/^\//, ''), BASE), { method, headers, body });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) throw new ApiError(data?.error ?? `HTTP ${res.status}`, res.status, data?.code);
  return data;
}

export function events(path, handlers) {
  const p = session.player;
  const url = new URL(path.replace(/^\//, ''), BASE);
  if (p?.id) url.searchParams.set('playerId', p.id);
  const es = new EventSource(url);
  for (const [type, fn] of Object.entries(handlers)) es.addEventListener(type, e => fn(JSON.parse(e.data)));
  return es;
}

let rules = null;
export async function getRules() {
  rules ??= api('GET', '/rules').catch(e => {
    rules = null;
    throw e;
  });
  return rules;
}
