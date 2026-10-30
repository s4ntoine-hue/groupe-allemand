/* Backend for the hosted site: Supabase stands in for the services the app used inside Claude
   (shared database, member identity, file storage, downloads, AI import).
   It exposes the same window.claude.use(name) interface, so app.js stays close to the original. */
(function () {
  const $ = s => document.querySelector(s);
  let sb = null, session = null, config = null;

  /* ---------- Database: one table "docs" (collection, id, data) ---------- */
  const listeners = new Map(); // collection -> Set of refresh functions
  let channel = null, refreshTimer = null;
  const newId = () => Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  const wrapErr = error => {
    const e = new Error(error.message || "db");
    e.code = error.code === "42501" || /row-level security/i.test(error.message || "") ? "not_granted" : error.code;
    return e;
  };
  async function fetchCollection(coll) {
    const { data, error } = await sb.from("docs").select("id, data").eq("collection", coll);
    if (error) throw wrapErr(error);
    return data;
  }
  function ensureChannel() {
    if (channel) return;
    channel = sb.channel("docs-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "docs" }, payload => {
        const coll = (payload.new && payload.new.collection) || (payload.old && payload.old.collection);
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          // Deletes may not carry the collection name: refresh everything in that case.
          for (const [c, fns] of listeners) if (!coll || c === coll) fns.forEach(f => f());
        }, 150);
      })
      .subscribe();
  }
  function listen(coll, fn) {
    if (!listeners.has(coll)) listeners.set(coll, new Set());
    listeners.get(coll).add(fn);
    ensureChannel();
    fn();
    return () => listeners.get(coll).delete(fn);
  }
  const refreshNow = coll => (listeners.get(coll) || []).forEach(f => f());

  function docRef(coll, id) {
    return {
      async set(data) {
        const { error } = await sb.from("docs").upsert({ collection: coll, id, data, updated_at: new Date().toISOString() }, { onConflict: "collection,id" });
        if (error) throw wrapErr(error);
        refreshNow(coll);
      },
      async update(patch) {
        const { data: row, error: e1 } = await sb.from("docs").select("data").eq("collection", coll).eq("id", id).maybeSingle();
        if (e1) throw wrapErr(e1);
        if (!row) { const e = new Error("not found"); e.code = "not_found"; throw e; }
        const { data: done, error } = await sb.from("docs").update({ data: { ...row.data, ...patch }, updated_at: new Date().toISOString() })
          .eq("collection", coll).eq("id", id).select("id");
        if (error) throw wrapErr(error);
        if (!done || !done.length) { const e = new Error("not allowed"); e.code = "not_granted"; throw e; }
        refreshNow(coll);
      },
      async delete() {
        const { data: done, error } = await sb.from("docs").delete().eq("collection", coll).eq("id", id).select("id");
        if (error) throw wrapErr(error);
        if (!done || !done.length) { const e = new Error("not allowed"); e.code = "not_granted"; throw e; }
        refreshNow(coll);
      },
      onSnapshot(onNext, onError) {
        return listen(coll, async () => {
          try {
            const { data, error } = await sb.from("docs").select("data").eq("collection", coll).eq("id", id).maybeSingle();
            if (error) throw error;
            onNext({ exists: !!data, data: () => (data ? data.data : undefined) });
          } catch (e) { if (onError) onError(e); }
        });
      },
    };
  }
  const db = {
    collection(coll) {
      return {
        doc: id => docRef(coll, id),
        async add(data) {
          const id = newId();
          const { error } = await sb.from("docs").insert({ collection: coll, id, data });
          if (error) throw wrapErr(error);
          refreshNow(coll);
          return { id };
        },
        onSnapshot(onNext, onError) {
          return listen(coll, async () => {
            try {
              const rows = await fetchCollection(coll);
              onNext({ docs: rows.map(r => ({ id: r.id, data: () => r.data })) });
            } catch (e) { if (onError) onError(e); }
          });
        },
      };
    },
    doc(path) { const [coll, id] = path.split("/"); return docRef(coll, id); },
  };

  /* ---------- Identity ---------- */
  const user = {
    async id() { return session.user.id; },
    async isOwner() { const { data } = await sb.rpc("is_admin"); return !!data; },
    async profiles() { return {}; }, // names come from the profiles collection
  };

  /* ---------- Files (Ressources tab) ---------- */
  const assets = {
    async upload(file) {
      const path = `${session.user.id}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, "_")}`;
      const { error } = await sb.storage.from("ressources").upload(path, file, { contentType: file.type || undefined });
      if (error) throw error;
      return { id: path, url: sb.storage.from("ressources").getPublicUrl(path).data.publicUrl };
    },
  };

  /* ---------- Downloads (.ics) ---------- */
  const downloads = {
    async save({ filename, data }) {
      const url = URL.createObjectURL(new Blob([data], { type: "text/calendar" }));
      const a = document.createElement("a");
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    },
  };

  /* ---------- AI import (only if the site owner set an API key) ---------- */
  const toBase64 = file => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file);
  });
  async function sample(prompt, opts = {}) {
    const images = await Promise.all((opts.images || []).map(async f => ({ type: f.type, data: await toBase64(f) })));
    const res = await fetch("/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token },
      body: JSON.stringify({ prompt, images }),
    });
    if (!res.ok) { const e = new Error("import"); e.code = res.status === 429 ? "rate_limited" : res.status === 401 ? "not_granted" : "failed"; throw e; }
    return res.json();
  }
  sample.limits = async () => ({ images: true });

  window.claude = {
    async use(name) {
      if (name === "db") return db;
      if (name === "user") return user;
      if (name === "assets") return assets;
      if (name === "downloads") return downloads;
      if (name === "sample") return config.importEnabled ? sample : null;
      return null;
    },
  };

  /* ---------- Sign in ---------- */
  function showLogin(msg) {
    const o = $("#overlay");
    o.hidden = false; o.onclick = null;
    o.innerHTML = `<form class="sheet" id="login" aria-label="Connexion">
      <h2>Bienvenue dans le groupe d'allemand</h2>
      <p class="hint">Connectez-vous pour voir le planning et publier. Première visite ? Choisissez « Créer mon compte ».</p>
      <div class="field"><label for="lg-email">Adresse e-mail</label><input id="lg-email" type="email" required autocomplete="email"></div>
      <div class="field"><label for="lg-pass">Mot de passe (6 caractères minimum)</label><input id="lg-pass" type="password" required minlength="6" autocomplete="current-password"></div>
      <p class="err" id="lg-err">${msg || ""}</p>
      <div class="foot"><button type="button" class="btn" id="lg-new">Créer mon compte</button><button class="btn primary" id="lg-go">Se connecter</button></div></form>`;
    const go = async create => {
      const email = $("#lg-email").value.trim(), password = $("#lg-pass").value;
      if (!email || password.length < 6) { $("#lg-err").textContent = "Indiquez votre e-mail et un mot de passe d'au moins 6 caractères."; return; }
      $("#lg-err").textContent = create ? "Création du compte…" : "Connexion…";
      const { data, error } = create ? await sb.auth.signUp({ email, password }) : await sb.auth.signInWithPassword({ email, password });
      if (error) {
        $("#lg-err").textContent = /already registered/i.test(error.message) ? "Ce compte existe déjà : cliquez sur « Se connecter »."
          : /invalid login/i.test(error.message) ? "E-mail ou mot de passe incorrect."
          : "Échec : " + error.message;
        return;
      }
      if (create && !data.session) { $("#lg-err").textContent = "Compte créé. Ouvrez l'e-mail de confirmation, puis connectez-vous."; return; }
    };
    $("#login").onsubmit = e => { e.preventDefault(); go(false); };
    $("#lg-new").onclick = () => go(true);
    $("#lg-email").focus();
  }

  async function boot() {
    try { config = await (await fetch("/api/config")).json(); } catch { config = null; }
    if (!config || !config.supabaseUrl || !config.supabaseAnonKey) {
      $("#status").hidden = false;
      $("#status").textContent = "Le site n'est pas encore relié à sa base de données (codes Supabase manquants dans Vercel).";
      return;
    }
    sb = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    let started = false;
    const onSession = s => {
      session = s;
      if (!s) { if (started) location.reload(); else showLogin(); return; }
      if (started) return;
      started = true;
      const o = $("#overlay"); o.hidden = true; o.innerHTML = "";
      window.currentUserEmail = s.user.email || "";
      $("#account").hidden = false; $("#btn-logout").onclick = () => sb.auth.signOut();
      window.startApp();
    };
    sb.auth.onAuthStateChange((_event, s) => onSession(s));
  }
  boot();
})();
