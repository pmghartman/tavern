export class Hub {
  constructor() {
    this.clients = new Map();
    this.timer = setInterval(() => this.ping(), 20000);
    this.timer.unref?.();
    this.onPresence = null;
  }

  add(campaignId, player, res) {
    const set = this.clients.get(campaignId) ?? new Set();
    this.clients.set(campaignId, set);
    const client = { player, res };
    set.add(client);
    res.on('close', () => {
      set.delete(client);
      this.onPresence?.(campaignId);
    });
    this.onPresence?.(campaignId);
    return client;
  }

  send(res, type, data) {
    try {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      /* closed */
    }
  }

  broadcast(campaignId, type, data) {
    for (const c of this.clients.get(campaignId) ?? []) this.send(c.res, type, data);
  }

  presence(campaignId) {
    const seen = new Map();
    for (const c of this.clients.get(campaignId) ?? []) if (c.player) seen.set(c.player.id, { id: c.player.id, name: c.player.name });
    return [...seen.values()];
  }

  onlineCount(campaignId) {
    return this.presence(campaignId).length;
  }

  ping() {
    for (const set of this.clients.values()) for (const c of set) {
      try {
        c.res.write(': ping\n\n');
      } catch {
        /* closed */
      }
    }
  }

  close() {
    clearInterval(this.timer);
    for (const set of this.clients.values()) for (const c of set) c.res.end();
    this.clients.clear();
  }
}
