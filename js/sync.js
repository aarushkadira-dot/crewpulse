/* Quorum crew sync client: sign-in and shared data against a Supabase project (auth + REST), no library needed.
   The database enforces every rule (see supabase/schema.sql); this file only talks to it. */
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.QuorumSync = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function create(cfg) {
    var url = String(cfg.url || '').replace(/\/+$/, ''), key = cfg.key || '', store = cfg.storage, f = cfg.fetch || (typeof fetch !== 'undefined' ? fetch.bind(typeof self !== 'undefined' ? self : null) : null);
    var SK = 'quorum-session', ses = null, refreshing = null;
    try { ses = JSON.parse(store.getItem(SK) || 'null'); } catch (e) { ses = null; }
    if (ses && !(ses.access_token && ses.refresh_token && ses.user && ses.user.id)) ses = null;
    var keep = function (s) { ses = s; try { if (s) store.setItem(SK, JSON.stringify(s)); else store.removeItem(SK); } catch (e) {} };
    var msg = function (j, status) { return (j && (j.msg || j.message || j.error_description || j.error)) || (status === 0 ? 'No connection' : 'Request failed (' + status + ')'); };
    function call(path, opt) {
      opt = opt || {};
      var h = { apikey: key, 'Content-Type': 'application/json' };
      if (opt.auth !== false && ses) h.Authorization = 'Bearer ' + ses.access_token; else h.Authorization = 'Bearer ' + key;
      if (opt.prefer) h.Prefer = opt.prefer;
      return f(url + path, { method: opt.method || 'GET', headers: h, body: opt.body == null ? undefined : JSON.stringify(opt.body) }).then(function (r) {
        return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} return r.ok ? { data: j, status: r.status } : { error: { message: msg(j, r.status), status: r.status } }; });
      }, function () { return { error: { message: 'No connection', status: 0 } }; });
    }
    function session(j) { return j && j.access_token ? { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: { id: j.user.id, email: j.user.email } } : null; }
    function refresh() {
      if (!ses) return Promise.resolve(false);
      if (!refreshing) refreshing = call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', auth: false, body: { refresh_token: ses.refresh_token } }).then(function (r) {
        refreshing = null; if (r.error) { if (r.error.status >= 400 && r.error.status < 500) keep(null); return false; } keep(session(r.data)); return !!ses; });
      return refreshing;
    }
    // An authenticated call that renews the session once if it has expired.
    function authed(path, opt) {
      if (!ses) return Promise.resolve({ error: { message: 'Sign in first', status: 401 } });
      var go = function () { return call(path, opt); };
      var pre = ses.expires_at - 60 < Date.now() / 1000 ? refresh() : Promise.resolve(true);
      return pre.then(function () { return go(); }).then(function (r) { if (r.error && r.error.status === 401 && ses) return refresh().then(function (ok) { return ok ? go() : r; }); return r; });
    }
    var enc = encodeURIComponent;
    return {
      configured: !!(url && key),
      user: function () { return ses ? ses.user : null; },
      signUp: function (email, password) { return call('/auth/v1/signup', { method: 'POST', auth: false, body: { email: email, password: password } }).then(function (r) { if (r.error) return r; var s = session(r.data); if (s) keep(s); return { data: { signedIn: !!s } }; }); },
      signIn: function (email, password) { return call('/auth/v1/token?grant_type=password', { method: 'POST', auth: false, body: { email: email, password: password } }).then(function (r) { if (r.error) return r; keep(session(r.data)); return { data: { signedIn: !!ses } }; }); },
      signOut: function () { var p = ses ? call('/auth/v1/logout', { method: 'POST' }) : Promise.resolve(); keep(null); return p.then(function () { return { data: true }; }); },
      rpc: function (fn, args) { return authed('/rest/v1/rpc/' + fn, { method: 'POST', body: args || {} }); },
      select: function (table, query) { return authed('/rest/v1/' + table + '?' + query); },
      upsert: function (table, rows, onConflict) { return authed('/rest/v1/' + table + '?on_conflict=' + enc(onConflict), { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=minimal' }); },
      update: function (table, query, patch) { return authed('/rest/v1/' + table + '?' + query, { method: 'PATCH', body: patch, prefer: 'return=minimal' }); }
    };
  }
  return { create: create };
});
