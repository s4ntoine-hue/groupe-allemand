/* Groupe d'allemand: the app itself. backend.js provides window.claude.use() and calls startApp() once signed in. */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const fmtDay = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const fmtLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const fmtShort = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const STORY_COLORS = ["#2b4c9b", "#c8372d", "#1f7a5c", "#7a3fa0", "#b86a12"];
const KIND_LABEL = { bonplan: "Bon plan", info: "Info utile", lien: "Lien ou événement", ressource: "Ressource" };
const LEVELS = ["Débutant (A1-A2)", "Intermédiaire (B1-B2)", "Avancé (C1-C2)", "Germanophone"];

const state = {
  tab: "planning", mode: "15", anchor: startOfToday(), selected: ymd(new Date()),
  events: [], posts: [], stories: [],
  me: null, isOwner: false, db: null, user: null, downloads: null, assets: null, profiles: {}, members: {}, programmes: [], attendance: {}, comments: [], news: null,
  filter: { city: "", radius: 30, hidden: [], hiddenCats: [] },
  seen: new Set(),
};
try { state.seen = new Set(JSON.parse(localStorage.getItem("seenStories") || "[]")); } catch {}
try { const t = localStorage.getItem("tab"); if (t) state.tab = t; } catch {}
try { const f = JSON.parse(localStorage.getItem("filter") || "null"); if (f) Object.assign(state.filter, f); } catch {}
try { const m = localStorage.getItem("calMode"); if (m === "month" || m === "week" || m === "list") state.mode = m; } catch {}

function setStatus(msg) { const el = $("#status"); el.hidden = !msg; el.textContent = msg || ""; }
const nameOf = id => (state.members[id] && state.members[id].displayName) || (state.profiles[id] && state.profiles[id].name) || "Un membre";
const colorOf = id => (state.members[id] && state.members[id].color) || STORY_COLORS[0];
const byLink = id => `<button type="button" class="linkish" data-profile="${esc(id || "")}">${esc(nameOf(id))}</button>`;
const CATS = [
  { id: "cours", label: "Cours" }, { id: "revision", label: "Révision" }, { id: "conversation", label: "Conversation, Stammtisch" },
  { id: "culture", label: "Culture (cinéma, expo, concert)" }, { id: "sortie", label: "Sortie, rencontre" }, { id: "autre", label: "Autre" }];
const catOf = e => CATS.some(c => c.id === e.category) ? e.category : "autre";
const catLabel = id => (CATS.find(c => c.id === id) || CATS[5]).label;
const catStyle = e => `--c: var(--cat-${catOf(e)})`;
function renderLegend() {
  $("#legend").innerHTML = CATS.map(c => `<button type="button" data-cat="${c.id}" style="--c: var(--cat-${c.id})" aria-pressed="${!state.filter.hiddenCats.includes(c.id)}"><i></i>${esc(c.label)}</button>`).join("");
  $("#legend").querySelectorAll("[data-cat]").forEach(b => b.onclick = () => {
    const id = b.dataset.cat, h = state.filter.hiddenCats;
    state.filter.hiddenCats = h.includes(id) ? h.filter(x => x !== id) : [...h, id];
    saveFilter(); render();
  });
}
/* ---------- Participation (Je participe) ---------- */
const goingOf = id => Object.keys(state.attendance).filter(u => state.attendance[u] && state.attendance[u].events && state.attendance[u].events[id]);
const amGoing = id => !!(state.me && state.attendance[state.me] && state.attendance[state.me].events && state.attendance[state.me].events[id]);
const initial = id => esc(nameOf(id).slice(0, 1).toUpperCase());
function facesHtml(id) {
  const g = goingOf(id);
  if (!g.length) return `<span class="faces"><span>Soyez le premier à participer</span></span>`;
  return `<span class="faces">${g.slice(0, 5).map(u => `<i style="background:${esc(colorOf(u))}" title="${esc(nameOf(u))}">${initial(u)}</i>`).join("")}<span>${g.length} participant${g.length > 1 ? "s" : ""}</span></span>`;
}
function goingBtn(e) {
  const g = goingOf(e.id).length, mine = amGoing(e.id), full = e.capacity && g >= e.capacity && !mine;
  return `<button type="button" class="btn small going" data-going="${esc(e.id)}" aria-pressed="${mine}" ${full ? "disabled" : ""}>${mine ? "✓ Je participe" : full ? "Complet" : "Je participe"}</button>`;
}
async function toggleGoing(id) {
  if (!requireDb() || !state.me) return;
  const cur = { ...((state.attendance[state.me] && state.attendance[state.me].events) || {}) };
  if (cur[id]) delete cur[id]; else cur[id] = Date.now();
  state.attendance[state.me] = { events: cur }; render();
  try { await state.db.doc("attendance/" + state.me).set({ events: cur, updatedAt: Date.now() }); }
  catch { setStatus("Votre participation n'a pas pu être enregistrée. Réessayez dans un instant."); }
}
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-going]");
  if (!b) return;
  ev.stopPropagation();
  toggleGoing(b.dataset.going).then(() => { if (!$("#overlay").hidden && $("#overlay [data-going]")) openCalendarMenu(b.dataset.going, state.detailBack); });
});
const placeText = e => e.online ? "En ligne" + (e.place ? " · " + e.place : "") : (e.place || "");

function renderUpcoming() {
  const t = ymd(new Date());
  const lim = new Date(); lim.setDate(lim.getDate() + 90);
  const evs = visibleEvents().filter(e => e.date >= t && e.date <= ymd(lim))
    .sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  const shown = evs.slice(0, state.upLimit || 40);
  const byDay = {};
  shown.forEach(e => (byDay[e.date] = byDay[e.date] || []).push(e));
  const fmtMon = new Intl.DateTimeFormat("fr-FR", { month: "short" });
  const el = $("#upcoming");
  if (!evs.length) { el.innerHTML = `<div class="empty-state"><span>Aucun événement à venir avec ces filtres.</span><button class="btn primary" id="up-add">Proposer un événement</button></div>`; $("#up-add").onclick = () => openEventForm(null, t); return; }
  el.innerHTML = Object.keys(byDay).map(day => {
    const d = parseYmd(day);
    return `<section class="upday"><h3>${esc(fmtLong.format(d))}${day === t ? " · aujourd'hui" : ""}</h3><div class="upcards">${byDay[day].map(e => `
      <article class="upcard" style="${catStyle(e)}">
        <div class="datebox"><small>${esc(fmtDay.format(d))}</small><b>${d.getDate()}</b><small>${esc(fmtMon.format(d))}</small></div>
        <div class="body">
          <span class="time">${esc(e.start || "Toute la journée")}${e.end ? " à " + esc(e.end) : ""} · <span class="cattag">${esc(catLabel(catOf(e)).split(" (")[0])}</span>${e.online ? ' <span class="online">En ligne</span>' : ""}</span>
          <h4><button type="button" data-detail="${esc(e.id)}">${esc(e.title)}</button></h4>
          ${placeText(e) ? `<span class="where">📍 ${esc(placeText(e))}${distanceOf(e) !== null ? " · " + (distanceOf(e) < 1 ? "sur place" : Math.round(distanceOf(e)) + " km") : ""}</span>` : ""}
          <div class="row">${facesHtml(e.id)}${goingBtn(e)}${commentsOf(e.id).length ? `<button type="button" class="linkish hint" data-detail="${esc(e.id)}">💬 ${commentsOf(e.id).length}</button>` : ""}${e.seriesId ? `<span class="repeat">🔁 ${esc(REPEATS[e.repeat])}</span>` : ""}${e.capacity ? `<span class="hint">${Math.max(0, e.capacity - goingOf(e.id).length)} place${e.capacity - goingOf(e.id).length > 1 ? "s" : ""} restante${e.capacity - goingOf(e.id).length > 1 ? "s" : ""}</span>` : ""}</div>
        </div></article>`).join("")}</div></section>`;
  }).join("") + (evs.length > shown.length ? `<button class="btn" id="up-more" style="justify-self:center">Afficher plus (${evs.length - shown.length} restants)</button>` : "");
  el.querySelectorAll("[data-detail]").forEach(b => b.onclick = () => openCalendarMenu(b.dataset.detail));
  if ($("#up-more")) $("#up-more").onclick = () => { state.upLimit = (state.upLimit || 40) + 40; renderUpcoming(); };
}
const canEdit = item => !item.readOnly && (state.isOwner || (state.me && item.authorId === state.me));

/* ---------- Festival programmes and distance filter ---------- */
const TOWNS = { "Altkirch": [47.623, 7.240], "Benfeld": [48.370, 7.594], "Bischwiller": [48.766, 7.857], "Brumath": [48.733, 7.711], "Cernay": [47.807, 7.176], "Colmar": [48.079, 7.358],
  "Dorlisheim": [48.524, 7.486], "Erstein": [48.423, 7.663], "Fribourg-en-Brisgau": [47.999, 7.842], "Guebwiller": [47.909, 7.211], "Haguenau": [48.816, 7.790], "Illkirch-Graffenstaden": [48.530, 7.716],
  "Kaysersberg": [48.138, 7.263], "Kembs": [47.689, 7.502], "Lauterbourg": [48.975, 8.178], "Marckolsheim": [48.163, 7.545], "Metz": [49.119, 6.176], "Molsheim": [48.542, 7.492], "Mulhouse": [47.750, 7.336],
  "Munster": [48.041, 7.135], "Mutzig": [48.538, 7.455], "Nancy": [48.692, 6.184], "Obernai": [48.462, 7.482], "Orbey": [48.126, 7.165], "Reichshoffen": [48.933, 7.665], "Ribeauvillé": [48.195, 7.319],
  "Rixheim": [47.749, 7.406], "Saint-Dié-des-Vosges": [48.284, 6.949], "Saint-Louis": [47.590, 7.560], "Sainte-Marie-aux-Mines": [48.247, 7.183], "Sarre-Union": [48.940, 7.090], "Sarrebourg": [48.735, 7.054],
  "Sarreguemines": [49.110, 7.069], "Saverne": [48.741, 7.362], "Schiltigheim": [48.606, 7.749], "Sélestat": [48.259, 7.454], "Soultz-sous-Forêts": [48.936, 7.881], "Strasbourg": [48.573, 7.752],
  "Thann": [47.807, 7.103], "Thionville": [49.358, 6.168], "Villé": [48.341, 7.302], "Wingen-sur-Moder": [48.919, 7.373], "Wissembourg": [49.037, 7.946], "Wittenheim": [47.808, 7.337] };
function kmBetween(a, b) {
  const r = x => x * Math.PI / 180, dLat = r(b[0] - a[0]), dLon = r(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a[0])) * Math.cos(r(b[0])) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
function programmeEvents() {
  const out = [];
  for (const pg of state.programmes) {
    (pg.items || []).forEach((it, i) => out.push({ id: `p_${pg.id}_${i}`, readOnly: true, prog: pg, title: it.t, date: it.d, start: it.s, end: "",
      place: `${it.v}, ${it.c}`, details: (it.e ? "Séance en présence de l'équipe du film. " : "") + (pg.note || ""), team: !!it.e, lat: it.la, lng: it.lo, category: pg.category || "culture" }));
  }
  return out;
}
const REPEATS = { none: "Ne se répète pas", weekly: "Chaque semaine", biweekly: "Toutes les deux semaines", monthly: "Chaque mois" };
function expandEvent(e) {
  if (!e.repeat || e.repeat === "none" || !REPEATS[e.repeat]) return [e];
  const out = [], start = parseYmd(e.date);
  const hardEnd = new Date(); hardEnd.setFullYear(hardEnd.getFullYear() + 1);
  const until = e.repeatUntil ? parseYmd(e.repeatUntil) : hardEnd;
  const end = until < hardEnd ? until : hardEnd;
  const skip = new Set(e.skip || []);
  for (let n = 0; n < 400; n++) {
    const d = e.repeat === "monthly" ? new Date(start.getFullYear(), start.getMonth() + n, start.getDate())
      : new Date(start.getFullYear(), start.getMonth(), start.getDate() + n * (e.repeat === "weekly" ? 7 : 14));
    if (d > end) break;
    if (e.repeat === "monthly" && d.getDate() !== start.getDate()) continue;
    const key = ymd(d);
    if (!skip.has(key)) out.push({ ...e, id: `${e.id}@${key}`, seriesId: e.id, date: key });
  }
  return out;
}
const allEvents = () => state.events.flatMap(expandEvent).concat(programmeEvents());
const seriesOf = e => state.events.find(x => x.id === (e.seriesId || e.id));
const commentsOf = id => state.comments.filter(c => c.eventId === id).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
function distanceOf(e) {
  const home = TOWNS[state.filter.city];
  return home && typeof e.lat === "number" ? kmBetween(home, [e.lat, e.lng]) : null;
}
function visibleEvents() {
  return allEvents().filter(e => {
    if (e.prog && state.filter.hidden.includes(e.prog.id)) return false;
    if ((state.filter.hiddenCats || []).includes(catOf(e))) return false;
    const d = distanceOf(e);
    return d === null || d <= state.filter.radius;
  });
}
function saveFilter() { try { localStorage.setItem("filter", JSON.stringify(state.filter)); } catch {} }
function renderFilters() {
  const sel = $("#flt-city");
  if (sel.options.length === 1) Object.keys(TOWNS).sort((a, b) => a.localeCompare(b, "fr")).forEach(t => sel.add(new Option(t, t)));
  sel.value = TOWNS[state.filter.city] ? state.filter.city : "";
  $("#flt-radius").value = String(state.filter.radius);
  $("#flt-radius").disabled = !sel.value;
  $("#flt-progs").innerHTML = state.programmes.map(pg => `<label><input type="checkbox" data-prog="${esc(pg.id)}" ${state.filter.hidden.includes(pg.id) ? "" : "checked"}>
    <span class="tag" style="background:${esc(pg.color || "#7a3fa0")}">${esc(pg.short || pg.name)}</span></label>`).join("");
  $("#flt-progs").querySelectorAll("[data-prog]").forEach(b => b.onchange = () => {
    state.filter.hidden = b.checked ? state.filter.hidden.filter(x => x !== b.dataset.prog) : [...state.filter.hidden, b.dataset.prog];
    saveFilter(); render();
  });
  const progAll = programmeEvents().filter(e => !state.filter.hidden.includes(e.prog.id));
  const shown = progAll.filter(e => { const d = distanceOf(e); return d === null || d <= state.filter.radius; }).length;
  $("#flt-info").textContent = sel.value && progAll.length ? `${shown} séance${shown > 1 ? "s" : ""} sur ${progAll.length} à moins de ${state.filter.radius} km (à vol d'oiseau)` : "";
}

async function resolveNames(ids) {
  if (!state.user) return;
  const missing = [...new Set(ids.filter(Boolean))].filter(id => !state.profiles[id]);
  if (!missing.length) return;
  try { Object.assign(state.profiles, await state.user.profiles(missing)); render(); } catch {}
}

/* ---------- Rendering ---------- */
function render() {
  const noProfile = state.db && state.me && !state.members[state.me];
  $("#btn-profile").textContent = noProfile ? "✏️ Créer mon profil" : "✏️ Modifier mon profil";
  $("#m-view").hidden = !!noProfile;
  $("#welcome").hidden = !noProfile;
  if (state.me) {
    const email = window.currentUserEmail || "";
    const name = (state.members[state.me] && state.members[state.me].displayName) || email.split("@")[0] || "Mon compte";
    $("#acct-av").textContent = name.slice(0, 1).toUpperCase();
    $("#acct-av").style.background = colorOf(state.me);
    $("#acct-name").textContent = name;
    $("#acct-full").textContent = name;
    $("#acct-email").textContent = email;
    $("#btn-account").setAttribute("aria-label", `Mon compte : ${name}, connecté`);
  }
  document.querySelectorAll(".tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === state.tab)));
  $("#view-planning").hidden = state.tab !== "planning";
  $("#view-list").hidden = state.tab === "planning";
  renderStories();
  if (state.tab === "planning") renderBoard(); else renderList();
}

function todaysEvents() {
  const t = ymd(new Date());
  return visibleEvents().filter(e => e.date === t).sort((a, b) => (a.start || "").localeCompare(b.start || ""));
}
function liveStories() {
  const cutoff = Date.now() - 24 * 3600 * 1000;
  return state.stories.filter(s => (s.createdAt || 0) > cutoff).sort((a, b) => b.createdAt - a.createdAt);
}

function renderReminders() {
  const el = $("#reminders");
  if (!state.me) { el.hidden = true; return; }
  const now = new Date(), t = ymd(now), tm = new Date(now); tm.setDate(tm.getDate() + 1);
  const tom = ymd(tm), hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const mine = allEvents().filter(e => amGoing(e.id) && (e.date === tom || (e.date === t && (!e.start || e.start >= hm))))
    .sort((a, b) => (a.date + (a.start || "")).localeCompare(b.date + (b.start || "")));
  el.hidden = !mine.length;
  if (!mine.length) return;
  el.innerHTML = `<strong>⏰ Rappel : vous participez à</strong>${mine.map(e => `<button type="button" data-remind="${esc(e.id)}"><b>${e.date === t ? "Aujourd'hui" : "Demain"}${e.start ? " " + esc(e.start) : ""}</b>${esc(e.title)}${placeText(e) ? " · " + esc(placeText(e)) : ""}</button>`).join("")}`;
  el.querySelectorAll("[data-remind]").forEach(b => b.onclick = () => openCalendarMenu(b.dataset.remind));
}

function renderStories() {
  renderReminders();
  const el = $("#stories");
  const today = todaysEvents();
  let html = `<button class="story add" id="story-add"><span class="ring"><span class="face">+</span></span><small>Ma story</small></button>`;
  html += `<button class="story ${state.seen.has("today-" + ymd(new Date()) + "-" + today.length) ? "seen" : ""}" data-story="today">
    <span class="ring"><span class="face" style="background:var(--today)">${new Date().getDate()}</span></span><small>Aujourd'hui</small></button>`;
  const nk = "news-" + ((state.news && state.news.updatedAt) || 0);
  html += `<button class="story ${state.seen.has(nk) ? "seen" : ""}" data-story="news-0">
    <span class="ring"><span class="face" style="background:#1d2433;font-size:0.95rem">DE</span></span><small>Nachrichten</small></button>`;
  for (const s of liveStories()) {
    const n = nameOf(s.authorId);
    html += `<button class="story ${state.seen.has(s.id) ? "seen" : ""}" data-story="${esc(s.id)}">
      <span class="ring"><span class="face" style="background:${esc(s.color || STORY_COLORS[0])}">${esc(n.slice(0, 1).toUpperCase())}</span></span><small>${esc(n)}</small></button>`;
  }
  el.innerHTML = html;
  $("#story-add").onclick = () => openStoryForm();
  el.querySelectorAll("[data-story]").forEach(b => b.onclick = () => openStoryViewer(b.dataset.story));
}

const eventsOn = key => visibleEvents().filter(e => e.date === key).sort((a, b) => (a.start || "").localeCompare(b.start || ""));
const fmtMonth = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

function calRange() {
  const a = state.anchor;
  if (state.mode === "month") {
    const first = new Date(a.getFullYear(), a.getMonth(), 1);
    const last = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    const label = fmtMonth.format(first);
    return { gridStart: mondayOf(first), gridEnd: last, inFrom: first, inTo: last, label: label[0].toUpperCase() + label.slice(1) };
  }
  if (state.mode === "week") {
    const mon = mondayOf(a), sun = new Date(mon); sun.setDate(sun.getDate() + 6);
    const isNow = ymd(mon) === ymd(mondayOf(new Date()));
    return { gridStart: mon, gridEnd: sun, inFrom: mon, inTo: sun,
      label: isNow ? `Cette semaine · du ${fmtShort.format(mon)} au ${fmtShort.format(sun)}` : `Semaine du ${fmtShort.format(mon)} au ${fmtShort.format(sun)}` };
  }
  const to = new Date(a); to.setDate(to.getDate() + 14);
  const isNow = ymd(a) === ymd(new Date());
  return { gridStart: mondayOf(a), gridEnd: to, inFrom: a, inTo: to,
    label: isNow ? `Les 15 prochains jours · jusqu'au ${fmtShort.format(to)}` : `Du ${fmtShort.format(a)} au ${fmtShort.format(to)}` };
}

function renderBoard() {
  if (!Array.isArray(state.filter.hiddenCats)) state.filter.hiddenCats = [];
  renderFilters(); renderLegend();
  const listMode = state.mode === "list";
  $("#board").hidden = listMode; $("#dayview").hidden = listMode; $("#upcoming").hidden = !listMode;
  ["#prev", "#next", "#thisweek"].forEach(sel => $(sel).hidden = listMode);
  if (listMode) {
    $("#weeklabel").textContent = "Prochains événements";
    document.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    renderUpcoming();
    return;
  }
  const r = calRange();
  $("#weeklabel").textContent = r.label;
  $("#board").classList.toggle("week", state.mode === "week");
  document.querySelectorAll("[data-mode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
  const t = ymd(new Date());
  const from = ymd(r.inFrom), to = ymd(r.inTo);
  let html = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"].map(d => `<span class="dow">${d}</span>`).join("");
  const end = mondayOf(r.gridEnd); end.setDate(end.getDate() + 6);
  for (const d = new Date(r.gridStart); d <= end; d.setDate(d.getDate() + 1)) {
    const key = ymd(d);
    const evs = eventsOn(key);
    const out = key < from || key > to;
    const label = `${fmtLong.format(d)}, ${evs.length ? evs.length + " événement" + (evs.length > 1 ? "s" : "") : "aucun événement"}`;
    html += `<button class="cell ${key === t ? "today" : ""} ${out ? "out" : ""}" data-day="${key}" aria-pressed="${key === state.selected}" aria-label="${esc(label)}">
      <span class="dnum">${d.getDate()}</span>
      ${evs.slice(0, state.mode === "week" ? 6 : 3).map(e => `<span class="chip${e.prog ? " prog" : ""}" data-ev="${esc(e.id)}" style="${catStyle(e)}">${e.start ? `<b>${esc(e.start)}</b> ` : ""}${esc(e.title)}</span>`).join("")}
      ${evs.length > (state.mode === "week" ? 6 : 3) ? `<span class="more">+${evs.length - (state.mode === "week" ? 6 : 3)} autre${evs.length - (state.mode === "week" ? 6 : 3) > 1 ? "s" : ""}</span>` : ""}
      <span class="dots">${evs.map(e => `<i style="${catStyle(e)}"></i>`).join("")}</span></button>`;
  }
  $("#board").innerHTML = html;
  $("#board").querySelectorAll("[data-day]").forEach(b => b.onclick = ev => {
    const key = b.dataset.day;
    state.selected = key; renderBoard();
    const chip = ev.target.closest("[data-ev]");
    if (chip) openCalendarMenu(chip.dataset.ev, key);
    else if (!eventsOn(key).length) openEventForm(null, key);
    else openDay(key);
  });

  const sel = state.selected, evs = eventsOn(sel);
  const dv = $("#dayview");
  dv.innerHTML = `<header><h3>${esc(fmtLong.format(parseYmd(sel)))}${sel === t ? " · aujourd'hui" : ""}</h3>
      <button class="addday" id="addsel">+ Ajouter un événement ce jour-là</button></header>
    ${evs.length ? `<div class="evs">${evs.map(evCard).join("")}</div>` : `<p style="margin:0;color:var(--muted)">Rien de prévu ce jour-là.</p>`}`;
  $("#addsel").onclick = () => openEventForm(null, sel);
  dv.querySelectorAll("[data-cal]").forEach(b => b.onclick = () => openCalendarMenu(b.dataset.cal));
  dv.querySelectorAll("[data-editev]").forEach(b => b.onclick = () => openEventForm(state.events.find(e => e.id === b.dataset.editev.split("@")[0])));
}

function evCard(e) {
  const time = e.start ? (e.end ? `${e.start} à ${e.end}` : e.start) : "Toute la journée";
  return `<article class="ev" style="${catStyle(e)}">
    <span class="time">${esc(time)} · <span class="cattag">${esc(catLabel(catOf(e)).split(" (")[0])}</span></span>
    <h3>${esc(e.title)}</h3>
    ${e.place ? `<p>📍 ${esc(e.place)}</p>` : ""}
    ${e.details ? `<p>${esc(e.details)}</p>` : ""}
    ${e.prog ? `<span class="meta"><span class="tag" style="background:${esc(e.prog.color || "#7a3fa0")}">${esc(e.prog.short || e.prog.name)}</span>${distanceOf(e) !== null ? (distanceOf(e) < 1 ? ` · sur place` : ` · à ${Math.round(distanceOf(e))} km`) : ""}</span>` : e.authorId ? `<span class="meta">par ${byLink(e.authorId)}</span>` : ""}
    <div class="actions">
      <button class="btn small" data-cal="${esc(e.id)}">Ajouter à mon agenda</button>
      ${canEdit(e) ? `<button class="btn small ghost" data-editev="${esc(e.id)}">Modifier</button>` : ""}
    </div></article>`;
}

function renderList() {
  const items = state.posts.filter(p => p.kind === state.tab).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const el = $("#list");
  if (!items.length) {
    el.innerHTML = `<div class="empty-state" style="grid-column:1/-1">
      <span>Rien ici pour l'instant.</span>
      <button class="btn primary" id="empty-add">Publier le premier</button></div>`;
    $("#empty-add").onclick = () => openPostForm(null, state.tab);
    return;
  }
  el.innerHTML = items.map(p => `<article class="card">
      <h3>${esc(p.title)}</h3>
      ${p.text ? `<p>${esc(p.text)}</p>` : ""}
      ${p.url ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.url.replace(/^https?:\/\//, ""))}</a>` : ""}
      ${p.fileUrl ? `<a class="filelink" href="${esc(p.fileUrl)}" target="_blank" rel="noopener">📄 ${esc(p.fileName || "Document")}</a>` : ""}
      ${p.date ? `<span class="meta">📅 ${esc(fmtLong.format(parseYmd(p.date)))}</span>` : ""}
      <span class="meta">${p.authorId ? `par ${byLink(p.authorId)} ·` : ""} ${esc(fmtShort.format(new Date(p.createdAt || Date.now())))}</span>
      ${canEdit(p) ? `<div class="actions"><button class="btn small ghost" data-editpost="${esc(p.id)}">Modifier</button></div>` : ""}
    </article>`).join("");
  el.querySelectorAll("[data-editpost]").forEach(b => b.onclick = () => openPostForm(state.posts.find(p => p.id === b.dataset.editpost)));
}
const safeUrl = u => /^https?:\/\//i.test(u) ? u : "https://" + u;

/* ---------- Overlays ---------- */
function openOverlay(html) {
  const o = $("#overlay"); o.innerHTML = html; o.hidden = false;
  o.onclick = e => { if (e.target === o) closeOverlay(); };
  const f = o.querySelector("input, textarea, button"); if (f) f.focus();
}
function closeOverlay() { const o = $("#overlay"); o.hidden = true; o.innerHTML = ""; clearTimeout(state.storyTimer); }
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#overlay").hidden) closeOverlay(); });

function requireDb() {
  if (state.db) return true;
  setStatus("Connectez-vous pour publier sur le tableau du groupe.");
  return false;
}

function openChooser() {
  openOverlay(`<div class="sheet" role="dialog" aria-label="Publier">
    <h2>Que voulez-vous publier ?</h2>
    <div style="display:grid;gap:8px">
      <button class="btn" data-k="event">Un événement dans le planning</button>
      <button class="btn" data-k="story">Une story</button>
      <button class="btn" data-k="bonplan">Un bon plan</button>
      <button class="btn" data-k="info">Une info utile</button>
      <button class="btn" data-k="lien">Un lien ou un événement extérieur</button>
      <button class="btn" data-k="ressource">Une ressource (site ou document)</button>
      <button class="btn" data-k="import">Importer des événements depuis une page ou un document</button>
    </div>
    <div class="foot"><button class="btn ghost" id="x">Annuler</button></div></div>`);
  $("#x").onclick = closeOverlay;
  $("#overlay").querySelectorAll("[data-k]").forEach(b => b.onclick = () => {
    const k = b.dataset.k;
    if (k === "event") openEventForm(null, ymd(new Date()));
    else if (k === "import") openImport();
    else if (k === "story") openStoryForm();
    else openPostForm(null, k);
  });
}

function openEventForm(ev, date) {
  if (!requireDb()) return;
  const e = ev || { date, title: "", start: "", end: "", place: "", details: "" };
  openOverlay(`<form class="sheet" id="f" role="dialog" aria-label="Événement">
    <h2>${ev ? "Modifier l'événement" : "Nouvel événement"}</h2>
    <div class="field"><label for="ev-title">Titre</label><input id="ev-title" required maxlength="120" value="${esc(e.title)}" placeholder="Séance de conversation"></div>
    <div class="field"><label for="ev-cat">Catégorie</label><select id="ev-cat">${CATS.map(c => `<option value="${c.id}" ${catOf(e) === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></div>
    <div class="field"><label for="ev-date">Date</label><input id="ev-date" type="date" required value="${esc(e.date)}"></div>
    <div class="row2">
      <div class="field"><label for="ev-start">Début</label><input id="ev-start" type="time" value="${esc(e.start)}"></div>
      <div class="field"><label for="ev-end">Fin</label><input id="ev-end" type="time" value="${esc(e.end)}"></div>
    </div>
    <div class="field"><label for="ev-place">Lieu</label><input id="ev-place" maxlength="160" value="${esc(e.place)}" placeholder="Adresse, salle, café…"></div>
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="ev-online" ${e.online ? "checked" : ""}> Événement en ligne (visio)</label>
    <div class="field"><label for="ev-link">Lien de la visio ou de l'inscription (facultatif)</label><input id="ev-link" maxlength="500" value="${esc(e.link || "")}" placeholder="https://…"></div>
    <div class="row2">
      <div class="field"><label for="ev-repeat">Répétition</label><select id="ev-repeat">${Object.entries(REPEATS).map(([k, v]) => `<option value="${k}" ${(e.repeat || "none") === k ? "selected" : ""}>${v}</option>`).join("")}</select></div>
      <div class="field"><label for="ev-until">Jusqu'au</label><input id="ev-until" type="date" value="${esc(e.repeatUntil || "")}"></div>
    </div>
    ${ev && ev.repeat && ev.repeat !== "none" ? `<p class="hint">Les modifications s'appliquent à toutes les séances de la série.</p>` : ""}
    <div class="field"><label for="ev-cap">Nombre de places (facultatif)</label><input id="ev-cap" type="number" min="1" max="500" value="${esc(e.capacity || "")}" placeholder="Illimité"></div>
    <div class="field"><label for="ev-details">Détails</label><textarea id="ev-details" rows="3" maxlength="1000">${esc(e.details)}</textarea></div>
    <p class="err" id="err"></p>
    <div class="foot">
      ${ev ? `<button type="button" class="btn danger" id="del">Supprimer</button>` : ""}
      <button type="button" class="btn ghost" id="x">Annuler</button>
      <button class="btn primary">${ev ? "Enregistrer" : "Publier"}</button>
    </div></form>`);
  $("#x").onclick = closeOverlay;
  if (ev) $("#del").onclick = () => confirmDelete("events", ev.id);
  $("#f").onsubmit = async evt => {
    evt.preventDefault();
    const data = { category: $("#ev-cat").value, title: $("#ev-title").value.trim(), date: $("#ev-date").value, start: $("#ev-start").value, end: $("#ev-end").value, place: $("#ev-place").value.trim(), details: $("#ev-details").value.trim(),
      online: $("#ev-online").checked, link: $("#ev-link").value.trim(), capacity: Math.max(0, parseInt($("#ev-cap").value, 10) || 0),
      repeat: $("#ev-repeat").value, repeatUntil: $("#ev-until").value };
    if (data.repeat !== "none" && !data.repeatUntil) { const u = parseYmd(data.date || ymd(new Date())); u.setMonth(u.getMonth() + 3); data.repeatUntil = ymd(u); }
    if (data.repeat !== "none" && data.repeatUntil < data.date) { $("#err").textContent = "La date de fin de répétition est avant la première séance."; return; }
    if (!data.title || !data.date) { $("#err").textContent = "Indiquez au moins un titre et une date."; return; }
    if (data.start && data.end && data.end < data.start) { $("#err").textContent = "L'heure de fin est avant l'heure de début."; return; }
    await save("events", ev, data);
  };
}

function openPostForm(post, kind) {
  if (!requireDb()) return;
  const p = post || { kind, title: "", text: "", url: "", date: "" };
  openOverlay(`<form class="sheet" id="f" role="dialog" aria-label="Publication">
    <h2>${post ? "Modifier" : "Publier"} : ${esc(KIND_LABEL[p.kind].toLowerCase())}</h2>
    <div class="field"><label for="p-title">Titre</label><input id="p-title" required maxlength="120" value="${esc(p.title)}"></div>
    <div class="field"><label for="p-text">Texte</label><textarea id="p-text" rows="4" maxlength="2000">${esc(p.text)}</textarea></div>
    <div class="field"><label for="p-url">Lien (facultatif)</label><input id="p-url" maxlength="500" value="${esc(p.url)}" placeholder="https://…"></div>
    ${p.kind === "ressource" && state.assets ? `<div class="field"><label for="p-file">Document (PDF, image…, facultatif)</label><input id="p-file" type="file">${p.fileName ? `<span class="meta">Actuel : ${esc(p.fileName)}</span>` : ""}</div>` : ""}
    ${p.kind === "lien" ? `<div class="field"><label for="p-date">Date de l'événement (facultatif)</label><input id="p-date" type="date" value="${esc(p.date)}"></div>` : ""}
    <p class="err" id="err"></p>
    <div class="foot">
      ${post ? `<button type="button" class="btn danger" id="del">Supprimer</button>` : ""}
      <button type="button" class="btn ghost" id="x">Annuler</button>
      <button class="btn primary">${post ? "Enregistrer" : "Publier"}</button>
    </div></form>`);
  $("#x").onclick = closeOverlay;
  if (post) $("#del").onclick = () => confirmDelete("posts", post.id);
  $("#f").onsubmit = async evt => {
    evt.preventDefault();
    const data = { kind: p.kind, title: $("#p-title").value.trim(), text: $("#p-text").value.trim(), url: $("#p-url").value.trim(), date: $("#p-date") ? $("#p-date").value : "" };
    if (!data.title) { $("#err").textContent = "Indiquez un titre."; return; }
    const file = $("#p-file") && $("#p-file").files[0];
    if (file) {
      if (file.size > 20 * 1024 * 1024) { $("#err").textContent = "Le fichier dépasse 20 Mo."; return; }
      $("#err").textContent = "Envoi du fichier…";
      try { const up = await state.assets.upload(file); data.fileId = up.id; data.fileUrl = up.url; data.fileName = file.name; }
      catch { $("#err").textContent = "Le fichier n'a pas pu être envoyé. Essayez un PDF ou une image."; return; }
    }
    await save("posts", post, data);
  };
}

function openStoryForm() {
  if (!requireDb()) return;
  let color = STORY_COLORS[0];
  openOverlay(`<form class="sheet" id="f" role="dialog" aria-label="Story">
    <h2>Nouvelle story</h2>
    <p style="margin:0;color:var(--muted)">Visible par le groupe pendant 24 heures.</p>
    <div class="field"><label for="s-text">Message</label><textarea id="s-text" rows="4" maxlength="280" required placeholder="Heute Abend Stammtisch, wer kommt?"></textarea></div>
    <div class="field"><label>Couleur</label><div class="swatches">${STORY_COLORS.map((c, i) => `<button type="button" aria-label="Couleur ${i + 1}" aria-pressed="${i === 0}" data-c="${c}" style="background:${c}"></button>`).join("")}</div></div>
    <p class="err" id="err"></p>
    <div class="foot"><button type="button" class="btn ghost" id="x">Annuler</button><button class="btn primary">Publier</button></div></form>`);
  $("#x").onclick = closeOverlay;
  $("#overlay").querySelectorAll("[data-c]").forEach(b => b.onclick = () => {
    color = b.dataset.c;
    $("#overlay").querySelectorAll("[data-c]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
  $("#f").onsubmit = async evt => {
    evt.preventDefault();
    const text = $("#s-text").value.trim();
    if (!text) { $("#err").textContent = "Écrivez un message."; return; }
    await save("stories", null, { text, color });
  };
}

function confirmDelete(coll, id) {
  const foot = $("#overlay .foot");
  foot.innerHTML = `<span style="margin-right:auto">Supprimer définitivement ?</span><button type="button" class="btn ghost" id="no">Non</button><button type="button" class="btn danger" id="yes">Oui, supprimer</button>`;
  $("#no").onclick = closeOverlay;
  $("#yes").onclick = async () => {
    try { await state.db.collection(coll).doc(id).delete(); closeOverlay(); }
    catch (e) { $("#err").textContent = "La suppression a échoué. Vous ne pouvez supprimer que vos propres publications."; }
  };
}

async function save(coll, existing, data) {
  try {
    if (existing) await state.db.collection(coll).doc(existing.id).update({ ...data, updatedAt: Date.now() });
    else await state.db.collection(coll).add({ ...data, authorId: state.me, createdAt: Date.now() });
    closeOverlay();
  } catch (e) {
    $("#err").textContent = e && e.code === "not_granted"
      ? "Vous n'avez pas le droit de publier ici. Demandez à l'organisateur de vous ajouter comme participant."
      : "La publication a échoué. Réessayez dans un instant.";
  }
}

/* ---------- Stories viewer ---------- */
function openStoryViewer(startId) {
  const items = (state.news && state.news.items) || [];
  const newsSlides = items.length ? items.map((it, i) => ({ id: "news-" + i, news: it, n: i })) : [{ id: "news-0", news: null }];
  const list = [{ id: "today" }, ...newsSlides, ...liveStories()];
  let idx = Math.max(0, list.findIndex(s => s.id === startId));
  const show = () => {
    clearTimeout(state.storyTimer);
    const s = list[idx];
    let bg, who, content;
    if (s.id === "today") {
      const evs = todaysEvents();
      bg = "linear-gradient(160deg, #c8372d 0%, #8a1f2b 100%)"; who = "Généré automatiquement · " + fmtLong.format(new Date());
      const deDate = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
      content = `<div><span class="pic" aria-hidden="true">${evs.length ? "📅" : "☕"}</span><span class="kicker">${esc(deDate)}</span>${evs.length
        ? `Heute in der Gruppe<span class="fr">Aujourd'hui dans le groupe</span><ul style="margin-top:14px">${evs.map(e => `<li><b>${esc(e.start || "ganztägig")}</b>${esc(e.title)}${e.place ? " · " + esc(e.place) : ""}</li>`).join("")}</ul>`
        : `Heute ist nichts geplant.<span class="fr">Rien de prévu aujourd'hui.</span><span class="teaser">Zeit für ein paar starke Verben: gehen, ging, gegangen!</span>`}</div>`;
      markSeen("today-" + ymd(new Date()) + "-" + evs.length);
    } else if (s.id.startsWith("news-")) {
      const HUES = ["#2b4c9b", "#1f7a5c", "#7a3fa0", "#b86a12", "#1d6f8a", "#9b2b5a"];
      const hue = (s.news && s.news.color) || HUES[(s.n || 0) % HUES.length];
      bg = `linear-gradient(160deg, ${hue} 0%, #141821 100%)`;
      const deDay = new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", year: "numeric" }).format(new Date((state.news && state.news.updatedAt) || Date.now()));
      const src = (state.news && state.news.source) || "nachrichtenleicht.de";
      who = `Nachrichten · actualité en allemand facile${items.length ? " · " + (s.n + 1) + "/" + items.length : ""}`;
      content = s.news
        ? `<div><span class="pic" aria-hidden="true">${esc(s.news.emoji || "📰")}</span><span class="kicker">Nachrichten · ${esc(deDay)}</span>${esc(s.news.t)}${s.news.teaser ? `<span class="teaser">${esc(s.news.teaser)}</span>` : ""}<a href="${esc(s.news.url)}" target="_blank" rel="noopener">Lire l'article sur ${esc(src)} ↗</a></div>`
        : `<div>L'actualité en allemand facile<span class="teaser">Des articles courts, écrits pour les personnes qui apprennent l'allemand.</span><a href="https://www.nachrichtenleicht.de" target="_blank" rel="noopener">nachrichtenleicht.de ↗</a><br><br><a href="https://learngerman.dw.com" target="_blank" rel="noopener">DW · Langsam gesprochene Nachrichten ↗</a></div>`;
      markSeen("news-" + ((state.news && state.news.updatedAt) || 0));
    } else {
      bg = s.color || STORY_COLORS[0]; who = nameOf(s.authorId);
      content = esc(s.text); markSeen(s.id);
    }
    const mine = s.id !== "today" && !s.id.startsWith("news-") && canEdit(s);
    $("#overlay").innerHTML = `<div class="viewer" role="dialog" aria-label="Story" style="background:${esc(bg)}">
      <div><div class="bars">${list.map((_, i) => `<i class="${i <= idx ? "on" : ""}"></i>`).join("")}</div><div class="who">${esc(who)}</div></div>
      <div class="content">${content}</div>
      <div class="vnav"><button id="vp" ${idx === 0 ? "disabled" : ""}>←</button>
        ${mine ? `<button id="vdel">Supprimer</button>` : ""}
        <button id="vx">Fermer</button><button id="vn">${idx === list.length - 1 ? "Fin" : "→"}</button></div></div>`;
    $("#vp").onclick = () => { if (idx > 0) { idx--; show(); } };
    $("#vn").onclick = next; $("#vx").onclick = closeOverlay;
    if (mine) $("#vdel").onclick = async () => { try { await state.db.collection("stories").doc(s.id).delete(); closeOverlay(); } catch {} };
    state.storyTimer = setTimeout(next, s.id.startsWith("news-") ? 12000 : 7000);
  };
  const next = () => { if (idx < list.length - 1) { idx++; show(); } else closeOverlay(); };
  const o = $("#overlay"); o.hidden = false; o.onclick = e => { if (e.target === o) closeOverlay(); };
  show();
}
function markSeen(id) {
  state.seen.add(id);
  try { localStorage.setItem("seenStories", JSON.stringify([...state.seen].slice(-200))); } catch {}
  renderStories();
}

/* ---------- Add to calendar ---------- */
function evTimes(e) {
  const d = e.date.replace(/-/g, "");
  if (!e.start) {
    const next = parseYmd(e.date); next.setDate(next.getDate() + 1);
    return { allDay: true, start: d, end: ymd(next).replace(/-/g, "") };
  }
  const endT = e.end || addHour(e.start);
  return { allDay: false, start: `${d}T${e.start.replace(":", "")}00`, end: `${d}T${endT.replace(":", "")}00` };
}
const addHour = t => { const [h, m] = t.split(":").map(Number); return `${pad(Math.min(23, h + 1))}:${pad(m)}`; };

const fmtStamp = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function renderComments(id) {
  const el = $("#cmts"); if (!el || el.dataset.for !== id) return;
  const list = commentsOf(id);
  el.innerHTML = list.length ? list.map(c => `<div class="cmt"><i style="background:${esc(colorOf(c.authorId))}">${initial(c.authorId)}</i>
    <div class="bubble"><span class="meta">${byLink(c.authorId)} · ${esc(fmtStamp.format(new Date(c.createdAt || Date.now())))}
      ${state.isOwner || c.authorId === state.me ? ` · <button type="button" class="linkish" data-delcmt="${esc(c.id)}">supprimer</button>` : ""}</span>
      <p>${esc(c.text)}</p></div></div>`).join("") : `<p class="hint">Pas encore de commentaire.</p>`;
  el.querySelectorAll("[data-delcmt]").forEach(b => b.onclick = async () => { try { await state.db.collection("comments").doc(b.dataset.delcmt).delete(); } catch {} });
}

function openDay(key) {
  const evs = eventsOn(key);
  openOverlay(`<div class="sheet" role="dialog" aria-label="Événements du jour">
    <h2>${esc(fmtLong.format(parseYmd(key)))}</h2>
    <p class="hint">${evs.length} événement${evs.length > 1 ? "s" : ""}. Touchez-en un pour voir les détails et l'ajouter à votre agenda.</p>
    <div class="daylist">${evs.map(e => `<button type="button" class="dayrow" data-open="${esc(e.id)}" style="${catStyle(e)}">
      <span class="t">${esc(e.start || "journée")}</span>
      <span><b>${esc(e.title)}</b><small>${esc(catLabel(catOf(e)).split(" (")[0])}${e.place ? " · " + esc(e.place) : ""}${distanceOf(e) !== null ? " · " + (distanceOf(e) < 1 ? "sur place" : Math.round(distanceOf(e)) + " km") : ""}</small></span>
      <span class="go" aria-hidden="true">›</span></button>`).join("")}</div>
    <div class="foot"><button type="button" class="btn" id="addk">+ Ajouter un événement</button><button type="button" class="btn ghost" id="x">Fermer</button></div></div>`);
  $("#x").onclick = closeOverlay;
  $("#addk").onclick = () => openEventForm(null, key);
  $("#overlay").querySelectorAll("[data-open]").forEach(b => b.onclick = () => openCalendarMenu(b.dataset.open, key));
}

function openCalendarMenu(id, backKey) {
  const e = allEvents().find(x => x.id === id); if (!e) return;
  state.detailBack = backKey;
  const t = evTimes(e);
  const g = new URL("https://calendar.google.com/calendar/render");
  g.search = new URLSearchParams({ action: "TEMPLATE", text: e.title, dates: `${t.start}/${t.end}`, details: e.details || "", location: e.place || "", ctz: "Europe/Paris" });
  const o = new URL("https://outlook.live.com/calendar/0/deeplink/compose");
  const iso = (dt, time) => `${dt}T${time || "00:00"}:00`;
  o.search = new URLSearchParams(t.allDay
    ? { subject: e.title, startdt: e.date, allday: "true", body: e.details || "", location: e.place || "" }
    : { subject: e.title, startdt: iso(e.date, e.start), enddt: iso(e.date, e.end || addHour(e.start)), body: e.details || "", location: e.place || "" });
  const maps = e.place ? "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(e.place) : "";
  const dist = distanceOf(e);
  const back = backKey && eventsOn(backKey).length > 1;
  openOverlay(`<div class="sheet" role="dialog" aria-label="Détail de l'événement" style="${catStyle(e)}">
    ${back ? `<button type="button" class="linkish" id="back" style="justify-self:start">‹ Tous les événements du ${esc(fmtShort.format(parseYmd(backKey)))}</button>` : ""}
    <div class="detail">
      <span><span class="cattag">${esc(catLabel(catOf(e)))}</span>${e.prog ? ` <span class="tag" style="background:${esc(e.prog.color || "#7a3fa0")}">${esc(e.prog.short || e.prog.name)}</span>` : ""}</span>
      <h2>${esc(e.title)}</h2>
      <p class="when">${esc(fmtLong.format(parseYmd(e.date)))}${e.start ? " · " + esc(e.start) + (e.end ? " à " + esc(e.end) : "") : " · toute la journée"}</p>
      ${e.place ? `<p>📍 ${esc(e.place)}${dist !== null ? ` <span class="hint" style="display:inline">(${dist < 1 ? "sur place" : "à " + Math.round(dist) + " km"})</span>` : ""} · <a href="${esc(maps)}" target="_blank" rel="noopener">Voir sur la carte</a></p>` : ""}
      ${e.details ? `<p style="white-space:pre-wrap">${esc(e.details)}</p>` : ""}
      ${e.online ? `<p><span class="online">En ligne</span></p>` : ""}
      ${e.link ? `<p>🔗 <a href="${esc(safeUrl(e.link))}" target="_blank" rel="noopener">${e.online ? "Rejoindre la visio" : "Lien de l'événement"}</a></p>` : ""}
      ${e.seriesId ? `<p class="repeat">🔁 ${esc(REPEATS[e.repeat])}${e.repeatUntil ? " jusqu'au " + esc(fmtShort.format(parseYmd(e.repeatUntil))) : ""}</p>` : ""}
      ${e.prog || !e.authorId ? "" : `<p class="hint">Organisé par ${byLink(e.authorId)}</p>`}
    </div>
    <h3 style="font-size:1rem">Qui participe ?</h3>
    <div class="detail">
      ${goingOf(e.id).length ? `<div class="attlist">${goingOf(e.id).map(u => `<button type="button" data-profile="${esc(u)}"><i style="background:${esc(colorOf(u))}">${initial(u)}</i>${esc(nameOf(u))}</button>`).join("")}</div>` : `<p class="hint">Personne pour l'instant.</p>`}
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">${goingBtn(e)}${e.capacity ? `<span class="hint">${goingOf(e.id).length} / ${e.capacity} places</span>` : ""}</div>
    </div>
    <h3 style="font-size:1rem">Commentaires</h3>
    <div class="cmts" id="cmts" data-for="${esc(e.id)}"></div>
    <form class="cmtform" id="cmtform">
      <textarea id="cmt-text" rows="1" maxlength="1000" placeholder="Une question, un covoiturage, un mot pour le groupe…" aria-label="Votre commentaire"></textarea>
      <button class="btn primary small" id="cmt-send">Envoyer</button>
    </form>
    <h3 style="font-size:1rem">Ajouter à mon agenda</h3>
    <div class="calbtns">
      <a class="btn" href="${esc(g.toString())}" target="_blank" rel="noopener">Google Agenda</a>
      <a class="btn" href="${esc(o.toString())}" target="_blank" rel="noopener">Outlook</a>
      ${state.downloads ? `<button type="button" class="btn" id="ics">Apple Calendrier ou autre (fichier .ics)</button>` : ""}
    </div>
    <p class="err" id="err"></p>
    <div class="foot">${canEdit(e) && e.seriesId ? `<button type="button" class="btn danger" id="skip">Annuler cette séance</button>` : ""}${canEdit(e) ? `<button type="button" class="btn" id="edit">${e.seriesId ? "Modifier la série" : "Modifier"}</button>` : ""}<button type="button" class="btn ghost" id="x">Fermer</button></div></div>`);
  $("#x").onclick = closeOverlay;
  if (back) $("#back").onclick = () => openDay(backKey);
  if (canEdit(e)) $("#edit").onclick = () => openEventForm(seriesOf(e));
  if (canEdit(e) && e.seriesId) $("#skip").onclick = async () => {
    const ser = seriesOf(e); if (!ser) return;
    try { await state.db.collection("events").doc(ser.id).update({ skip: [...(ser.skip || []), e.date] }); closeOverlay(); }
    catch { $("#err").textContent = "L'annulation n'a pas pu être enregistrée."; }
  };
  renderComments(e.id);
  $("#cmtform").onsubmit = async evt => {
    evt.preventDefault();
    if (!requireDb() || !state.me) return;
    const text = $("#cmt-text").value.trim(); if (!text) return;
    $("#cmt-send").disabled = true;
    try { await state.db.collection("comments").add({ eventId: e.id, text: text.slice(0, 1000), authorId: state.me, createdAt: Date.now() }); $("#cmt-text").value = ""; }
    catch { $("#err").textContent = "Le commentaire n'a pas pu être publié."; }
    $("#cmt-send").disabled = false;
  };
  $("#cmt-text").onkeydown = k => { if (k.key === "Enter" && !k.shiftKey) { k.preventDefault(); $("#cmtform").requestSubmit(); } };
  if (state.downloads) $("#ics").onclick = async () => {
    const icsEsc = s => String(s || "").replace(/[\;,]/g, m => "\\" + m).replace(/\n/g, "\\n");
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Groupe d'allemand//FR", "BEGIN:VEVENT",
      `UID:${e.id}@groupe-allemand`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
      t.allDay ? `DTSTART;VALUE=DATE:${t.start}` : `DTSTART;TZID=Europe/Paris:${t.start}`,
      t.allDay ? `DTEND;VALUE=DATE:${t.end}` : `DTEND;TZID=Europe/Paris:${t.end}`,
      `SUMMARY:${icsEsc(e.title)}`, e.place ? `LOCATION:${icsEsc(e.place)}` : "", e.details ? `DESCRIPTION:${icsEsc(e.details)}` : "",
      "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(e.title)} demain`, "TRIGGER:-P1D", "END:VALARM",
      ...(t.allDay ? [] : ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(e.title)} dans une heure`, "TRIGGER:-PT1H", "END:VALARM"]),
      "END:VEVENT", "END:VCALENDAR"].filter(Boolean);
    try { await state.downloads.save({ filename: "evenement.ics", data: lines.join("\r\n") }); }
    catch (err) { if (!err || err.code !== "declined") $("#err").textContent = "Le fichier n'a pas pu être enregistré."; }
  };
}

/* ---------- Wiring ---------- */
$("#tabs").onclick = e => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  state.tab = b.dataset.tab; try { localStorage.setItem("tab", state.tab); } catch {}
  render();
};
const shift = dir => {
  const a = state.anchor;
  const step = state.mode === "week" ? 7 : 15;
  state.anchor = state.mode === "month" ? new Date(a.getFullYear(), a.getMonth() + dir, 1) : new Date(a.getFullYear(), a.getMonth(), a.getDate() + step * dir);
  const now = new Date();
  const isCurrentMonth = state.anchor.getMonth() === now.getMonth() && state.anchor.getFullYear() === now.getFullYear();
  const isCurrentWeek = ymd(mondayOf(state.anchor)) === ymd(mondayOf(now));
  state.selected = ymd((state.mode === "month" && isCurrentMonth) || (state.mode === "week" && isCurrentWeek) ? now : state.mode === "week" ? mondayOf(state.anchor) : state.anchor);
  render();
};
$("#prev").onclick = () => shift(-1);
$("#flt-city").onchange = () => { state.filter.city = $("#flt-city").value; saveFilter(); render(); };
$("#flt-radius").onchange = () => { state.filter.radius = +$("#flt-radius").value; saveFilter(); render(); };
$("#next").onclick = () => shift(1);
$("#thisweek").onclick = () => { state.anchor = startOfToday(); state.selected = ymd(new Date()); render(); };
document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
  state.mode = b.dataset.mode; state.anchor = startOfToday(); state.selected = ymd(new Date());
  try { localStorage.setItem("calMode", state.mode); } catch {}
  render();
});
$("#btn-add").onclick = () => { if (requireDb()) openChooser(); };
const acctMenu = open => { $("#acct-menu").hidden = !open; $("#btn-account").setAttribute("aria-expanded", String(open)); };
$("#btn-account").onclick = e => { e.stopPropagation(); acctMenu($("#acct-menu").hidden); };
document.addEventListener("click", e => { if (!e.target.closest("#account")) acctMenu(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape") acctMenu(false); });
$("#btn-profile").onclick = () => { acctMenu(false); if (requireDb()) openProfileForm(); };
$("#m-view").onclick = () => { acctMenu(false); if (state.me) openProfile(state.me); };
$("#welcome-go").onclick = () => { if (requireDb()) openProfileForm(); };
document.addEventListener("click", e => {
  const b = e.target.closest("[data-profile]");
  if (b && b.dataset.profile) { e.stopPropagation(); openProfile(b.dataset.profile); }
});

/* ---------- Import from a page or document ---------- */
let pdfjsReady = null;
function loadPdfJs() {
  if (!pdfjsReady) pdfjsReady = new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    sc.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res(window.pdfjsLib); };
    sc.onerror = () => { pdfjsReady = null; rej(new Error("pdfjs")); };
    document.head.appendChild(sc);
  });
  return pdfjsReady;
}
async function pdfText(file) {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = "";
  for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    out += `\n--- page ${i} ---\n` + tc.items.map(it => it.str + (it.hasEOL ? "\n" : " ")).join("");
  }
  return out;
}

function parseCandidates(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  // Answer cut short: keep every complete object.
  return (text.match(/\{[^{}]*\}/g) || []).map(o => { try { return JSON.parse(o); } catch { return null; } }).filter(Boolean);
}

function importPrompt(today, filter) {
  return `Tu extrais des événements d'un document pour le calendrier d'un groupe d'apprentissage de l'allemand en France. Aujourd'hui nous sommes le ${today}.
Réponds UNIQUEMENT par un tableau JSON, sans texte autour. Chaque élément : {"title": string, "date": "YYYY-MM-DD", "start": "HH:MM" ou "", "end": "HH:MM" ou "", "place": string, "details": string, "category": "cours" | "revision" | "conversation" | "culture" | "sortie" | "autre"}.
Règles : si l'année ou le mois manquent, déduis-les du document et des jours de la semaine, sinon choisis la prochaine date à venir. "place" = lieu (ville et salle si connus). "details" = une phrase courte utile (ex. "Festival Augenblick, séance en présence de l'équipe"), ou "". N'invente rien. Titres en casse normale, pas tout en majuscules.
${filter ? "Ne garde que les événements qui correspondent à : " + filter + "\n" : ""}`;
}

/* Free import: the member runs the instruction in their own Claude or ChatGPT, then pastes the answer back. */
function openManualImport() {
  if (!requireDb()) return;
  openOverlay(`<form class="sheet" id="f" role="dialog" aria-label="Importer par copier-coller">
    <h2>Importer des événements (gratuit)</h2>
    <p class="hint">Vous utilisez votre propre assistant (Claude, ChatGPT…) pour lire le document, puis vous recollez sa réponse ici.</p>
    <div class="field"><label for="mi-filter">Ne garder que… (facultatif)</label><input id="mi-filter" maxlength="200" placeholder="ex. les séances à Strasbourg"></div>
    <p style="margin:0"><b>1.</b> <button type="button" class="btn small primary" id="mi-copy">Copier la consigne</button> <span class="hint" id="mi-copied" style="display:inline"></span></p>
    <p style="margin:0"><b>2.</b> Ouvrez <a href="https://claude.ai/new" target="_blank" rel="noopener">Claude</a> ou <a href="https://chatgpt.com" target="_blank" rel="noopener">ChatGPT</a>, collez la consigne, puis joignez le document (PDF, photo) ou collez le texte de la page web. Envoyez.</p>
    <div class="field"><label for="mi-answer"><b>3.</b> Copiez toute la réponse et collez-la ici</label><textarea id="mi-answer" rows="5" placeholder='[{"title": "…", "date": "2026-11-12", …}]'></textarea></div>
    <p class="err" id="err"></p>
    <div class="foot"><button type="button" class="btn ghost" id="x">Annuler</button><button class="btn primary">Voir les événements</button></div></form>`);
  $("#x").onclick = closeOverlay;
  $("#mi-copy").onclick = async () => {
    const text = importPrompt(ymd(new Date()), $("#mi-filter").value.trim()) + "\nLe document est joint ou collé ci-dessous.\n";
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {}
    if (!ok) {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch {}
      ta.remove();
    }
    if (ok) $("#mi-copied").textContent = "✓ Copiée";
    else { $("#mi-answer").value = text; $("#mi-copied").textContent = "Copiez le texte affiché dans la case 3, puis videz-la."; }
  };
  $("#f").onsubmit = evt => {
    evt.preventDefault();
    const cands = parseCandidates($("#mi-answer").value).filter(c => c && c.title && /^\d{4}-\d{2}-\d{2}$/.test(c.date || ""));
    if (!cands.length) { $("#err").textContent = "Aucun événement reconnu. Vérifiez que vous avez collé toute la réponse, qui commence par [ et finit par ]."; return; }
    showCandidates(cands, false);
  };
}

async function openImport() {
  if (!requireDb()) return;
  const sample = await claude.use("sample");
  if (!sample) { openManualImport(); return; }
  let canImages = false;
  try { canImages = !!(await sample.limits()).images; } catch {}
  openOverlay(`<form class="sheet" id="f" role="dialog" aria-label="Importer des événements">
    <h2>Importer des événements</h2>
    <p class="hint">Claude lit le document ou le texte et vous propose les événements trouvés. Vous choisissez ensuite ceux à ajouter.</p>
    <p class="hint">Ou gratuitement avec votre propre Claude ou ChatGPT : <button type="button" class="linkish" id="manual">import par copier-coller</button>.</p>
    <div class="field"><label for="im-file">Document : PDF${canImages ? ", photo ou capture d'écran" : ""}</label><input id="im-file" type="file" accept="application/pdf${canImages ? ",image/*" : ""}"></div>
    <div class="field"><label for="im-text">Ou collez le texte d'une page web</label><textarea id="im-text" rows="4" placeholder="Sur la page, sélectionnez tout (Ctrl+A), copiez, puis collez ici."></textarea></div>
    <div class="field"><label for="im-filter">Ne garder que… (facultatif)</label><input id="im-filter" maxlength="200" placeholder="ex. les séances à Strasbourg, ou en présence des équipes"></div>
    <p class="err" id="err"></p>
    <div class="foot"><button type="button" class="btn ghost" id="x">Annuler</button><button class="btn primary" id="go">Chercher les événements</button></div></form>`);
  $("#x").onclick = closeOverlay;
  $("#manual").onclick = openManualImport;
  $("#f").onsubmit = async evt => {
    evt.preventDefault();
    const file = $("#im-file").files[0], pasted = $("#im-text").value.trim(), filter = $("#im-filter").value.trim();
    if (!file && !pasted) { $("#err").textContent = "Choisissez un document ou collez du texte."; return; }
    if (!file && /^(https?:\/\/|www\.)\S+$/i.test(pasted)) { $("#err").textContent = "Vous avez collé l'adresse de la page : l'application ne peut pas l'ouvrir elle-même. Ouvrez la page, sélectionnez tout son texte (Ctrl+A ou appui long puis « Tout sélectionner »), copiez-le et collez-le ici."; return; }
    $("#go").disabled = true;
    let text = pasted, images;
    try {
      if (file && file.type === "application/pdf") { $("#err").textContent = "Lecture du PDF…"; text = (await pdfText(file)) + (pasted ? "\n" + pasted : ""); }
      else if (file) images = [file];
    } catch { $("#go").disabled = false; $("#err").textContent = "Ce PDF n'a pas pu être lu. Copiez son texte et collez-le dans le champ ci-dessous."; return; }
    if (text.length > 150000) text = text.slice(0, 150000);
    $("#err").textContent = "Claude cherche les événements…";
    const today = ymd(new Date());
    const prompt = importPrompt(today, filter) + (text ? "\nDOCUMENT :\n" + text : "\nLe document est l'image jointe.");
    let res;
    try { res = await sample(prompt, { images, modelTier: "default", cache: false }); }
    catch (e) {
      $("#go").disabled = false;
      $("#err").textContent = e && e.code === "rate_limited" ? "Trop de demandes pour le moment. Réessayez dans quelques minutes."
        : e && e.code === "not_granted" ? "Votre session a expiré : reconnectez-vous puis réessayez." : "Claude n'a pas pu lire ce document. Essayez avec moins de texte.";
      return;
    }
    const cands = parseCandidates(res.text).filter(c => c && c.title && /^\d{4}-\d{2}-\d{2}$/.test(c.date || ""));
    if (!cands.length) { $("#go").disabled = false; $("#err").textContent = "Aucun événement trouvé dans ce document."; return; }
    showCandidates(cands, res.truncated);
  };
}

function showCandidates(cands, truncated) {
  const known = new Set(state.events.map(e => `${e.date}|${e.start || ""}|${(e.title || "").toLowerCase()}`));
  const rows = cands.map((c, i) => {
    const dup = known.has(`${c.date}|${c.start || ""}|${c.title.toLowerCase()}`);
    const past = c.date < ymd(new Date());
    return `<label class="cand"><input type="checkbox" data-i="${i}" ${dup || past ? "" : "checked"}>
      <span><b>${esc(c.title)}</b>${dup ? " · déjà dans le calendrier" : past ? " · <span style=\"color:var(--today)\">date passée</span>" : ""}
      <small>${esc(fmtLong.format(parseYmd(c.date)))}${c.start ? " · " + esc(c.start) : ""}${c.place ? " · " + esc(c.place) : ""}</small></span></label>`;
  }).join("");
  $("#overlay").innerHTML = `<div class="sheet" role="dialog" aria-label="Événements trouvés">
    <h2>${cands.length} événement${cands.length > 1 ? "s" : ""} trouvé${cands.length > 1 ? "s" : ""}</h2>
    ${truncated ? `<p class="err">Le document était long : la liste est peut-être incomplète. Utilisez « Ne garder que… » pour cibler.</p>` : ""}
    ${cands.every(c => c.date < ymd(new Date())) ? `<p class="err">Toutes les dates trouvées sont déjà passées : la page décrit sans doute une ancienne édition.</p>` : ""}
    <p class="hint">Vérifiez les dates avant d'ajouter. <button type="button" class="linkish" id="all">Tout cocher</button> · <button type="button" class="linkish" id="none">Tout décocher</button></p>
    <div class="cands">${rows}</div>
    <p class="err" id="err"></p>
    <div class="foot"><button type="button" class="btn ghost" id="x">Annuler</button><button type="button" class="btn primary" id="add">Ajouter au calendrier</button></div></div>`;
  const boxes = () => [...$("#overlay").querySelectorAll("[data-i]")];
  const count = () => { const n = boxes().filter(b => b.checked).length; $("#add").textContent = n ? `Ajouter ${n} événement${n > 1 ? "s" : ""}` : "Ajouter au calendrier"; };
  boxes().forEach(b => b.onchange = count); count();
  $("#all").onclick = () => { boxes().forEach(b => b.checked = true); count(); };
  $("#none").onclick = () => { boxes().forEach(b => b.checked = false); count(); };
  $("#x").onclick = closeOverlay;
  $("#add").onclick = async () => {
    const pick = boxes().filter(b => b.checked).map(b => cands[+b.dataset.i]);
    if (!pick.length) { $("#err").textContent = "Cochez au moins un événement."; return; }
    $("#add").disabled = true;
    let done = 0;
    for (const c of pick) {
      try {
        await state.db.collection("events").add({ title: String(c.title).slice(0, 120), date: c.date, start: /^\d{2}:\d{2}$/.test(c.start || "") ? c.start : "", end: /^\d{2}:\d{2}$/.test(c.end || "") ? c.end : "",
          place: String(c.place || "").slice(0, 160), details: String(c.details || "").slice(0, 1000), category: CATS.some(k => k.id === c.category) ? c.category : "autre", authorId: state.me, createdAt: Date.now(), imported: true });
        done++; $("#add").textContent = `Ajout… ${done}/${pick.length}`;
      } catch { break; }
    }
    if (done === pick.length) { closeOverlay(); state.selected = pick[0].date; state.anchor = parseYmd(pick[0].date); render(); }
    else { $("#add").disabled = false; $("#err").textContent = `${done} ajoutés sur ${pick.length}. Les autres n'ont pas pu être enregistrés, réessayez.`; }
  };
}

function openProfile(id) {
  const m = state.members[id] || {};
  const n = nameOf(id);
  openOverlay(`<div class="sheet" role="dialog" aria-label="Profil">
    <div class="pfhead"><span class="avatar" style="background:${esc(colorOf(id))}">${esc(n.slice(0, 1).toUpperCase())}</span>
      <div style="display:grid;gap:4px"><h2>${esc(n)}</h2>${m.level ? `<span class="level">${esc(m.level)}</span>` : ""}</div></div>
    ${m.city ? `<p style="margin:0">📍 ${esc(m.city)}</p>` : ""}
    ${m.about ? `<p style="margin:0;white-space:pre-wrap">${esc(m.about)}</p>` : `<p style="margin:0;color:var(--muted)">Ce membre n'a pas encore rempli son profil.</p>`}
    <div class="foot">${id === state.me ? `<button class="btn" id="pedit">Modifier mon profil</button>` : ""}<button class="btn ghost" id="x">Fermer</button></div></div>`);
  $("#x").onclick = closeOverlay;
  if (id === state.me) $("#pedit").onclick = openProfileForm;
}

function openProfileForm() {
  if (!state.me) { setStatus("Impossible de vous identifier. Reconnectez-vous."); return; }
  const m = state.members[state.me] || {};
  let color = m.color || STORY_COLORS[0];
  openOverlay(`<form class="sheet" id="f" role="dialog" aria-label="Mon profil">
    <h2>${state.members[state.me] ? "Mon profil" : "Créer mon profil"}</h2>
    <div class="field"><label for="pf-name">Nom affiché</label><input id="pf-name" required maxlength="40" value="${esc(m.displayName || (state.profiles[state.me] && state.profiles[state.me].name) || "")}"></div>
    <div class="field"><label for="pf-level">Niveau d'allemand</label><select id="pf-level"><option value="">Non précisé</option>${LEVELS.map(l => `<option ${m.level === l ? "selected" : ""}>${esc(l)}</option>`).join("")}</select></div>
    <div class="field"><label for="pf-city">Ville (facultatif)</label><input id="pf-city" maxlength="60" value="${esc(m.city || "")}"></div>
    <div class="field"><label for="pf-about">Quelques mots sur vous</label><textarea id="pf-about" rows="3" maxlength="400" placeholder="Pourquoi j'apprends l'allemand, ce que j'aime…">${esc(m.about || "")}</textarea></div>
    <div class="field"><label>Couleur</label><div class="swatches">${STORY_COLORS.map((c, i) => `<button type="button" aria-label="Couleur ${i + 1}" aria-pressed="${c === color}" data-c="${c}" style="background:${c}"></button>`).join("")}</div></div>
    <p class="err" id="err"></p>
    <div class="foot"><button type="button" class="btn ghost" id="x">Annuler</button><button class="btn primary">Enregistrer</button></div></form>`);
  $("#x").onclick = closeOverlay;
  $("#overlay").querySelectorAll("[data-c]").forEach(b => b.onclick = () => {
    color = b.dataset.c;
    $("#overlay").querySelectorAll("[data-c]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
  });
  $("#f").onsubmit = async evt => {
    evt.preventDefault();
    const data = { displayName: $("#pf-name").value.trim(), level: $("#pf-level").value, city: $("#pf-city").value.trim(), about: $("#pf-about").value.trim(), color, updatedAt: Date.now() };
    if (!data.displayName) { $("#err").textContent = "Indiquez un nom."; return; }
    try { await state.db.doc("profiles/" + state.me).set(data); closeOverlay(); }
    catch { $("#err").textContent = "Le profil n'a pas pu être enregistré. Réessayez dans un instant."; }
  };
}

render();

window.startApp = async () => {
  const [db, user, downloads, assets] = await Promise.all([claude.use("db"), claude.use("user"), claude.use("downloads"), claude.use("assets")]);
  state.db = db; state.user = user; state.downloads = downloads; state.assets = assets;
  if (user) {
    try { state.me = await user.id(); } catch {}
    try { state.isOwner = await user.isOwner(); } catch {}
  }
  if (!db) { setStatus("Connectez-vous pour voir et publier sur le tableau du groupe."); render(); return; }
  const listen = (coll, key) => db.collection(coll).onSnapshot(
    snap => { state[key] = snap.docs.map(d => ({ id: d.id, ...d.data() })); resolveNames(state[key].map(x => x.authorId)); render(); },
    () => setStatus("Le tableau n'a pas pu être chargé. Rechargez la page dans un instant."));
  listen("events", "events"); listen("posts", "posts"); listen("stories", "stories");
  db.doc("news/current").onSnapshot(snap => { state.news = snap.exists ? snap.data() : null; renderStories(); }, () => {});
  db.collection("comments").onSnapshot(snap => {
    state.comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    resolveNames(state.comments.map(c => c.authorId));
    const open = $("#cmts"); if (open) renderComments(open.dataset.for);
    if (state.mode === "list" && state.tab === "planning") renderUpcoming();
  }, () => {});
  db.collection("attendance").onSnapshot(snap => {
    state.attendance = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
    resolveNames(Object.keys(state.attendance)); render();
  }, () => {});
  db.collection("programmes").onSnapshot(snap => {
    state.programmes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    render();
  }, () => {});
  db.collection("profiles").onSnapshot(snap => {
    state.members = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]));
    render();
  }, () => {});
  render();
};
