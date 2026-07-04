// ============================================================
// OMNIA ADRIATIC LIFEGUARD SERVICE
// Cloud Functions — Diario Giornaliero
// Repository: omnia-diario-functions
// Progetto Firebase: app-segnalazioni-omnia-roseto
// ============================================================

const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule }        = require("firebase-functions/v2/scheduler");
const admin                 = require("firebase-admin");

admin.initializeApp();

// ────────────────────────────────────────────────────────────
// CONFIGURAZIONE
// ────────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = "8638329653:AAHnaN7R0nfnn8SuJOGLLQo0mq9WqrWSO6s";
const REGION = "europe-west1";

const ALL_STATIONS = Array.from({ length: 26 }, (_, i) => `P.${i + 10}`);

const CHK_LABELS = {
  kit_medico: "Kit medico", giubbino: "Giubbino", rullo: "Rullo",
  caschetto: "Caschetto", scalmi_remi: "Scalmi e remi",
  mezzo_marinaio: "Mezzo marinaio", ancora: "Ancora",
  salvagente_pattino: "Salvagente pattino", canotta_rossa: "Canotta rossa",
  fischietto: "Fischietto", pinne_maschera: "Pinne/maschera",
  binocolo: "Binocolo", documenti: "Brevetto/BLSD/Visita",
  salvagente_concessione: "Salvagente concessione",
  bandiere_ok: "Bandiere", limite_acque: "Limiti acque", boa_300m: "Boa 300m",
};

const LIDO_LABELS = {
  salvagente: "N.2 salvagente (sagola ok)",
  bandiere:   "Bandiere verde/gialla/rossa",
  acque:      "Limiti acque sicure in mare",
  boa:        "Boa 300m dietro gli scogli",
};

const LIDI_MAP = {
  "P.10": ["Orsa Minore", "Scirocco"],
  "P.11": ["Ahamar", "Papenoo"],
  "P.12": ["Lido La Vela", "Mirage"],
  "P.13": ["Bagni Marini", "Nettuno"],
  "P.14": ["Bolla Mare", "Lido Luigi"],
  "P.15": ["La Paranzella", "Costa Est"],
  "P.16": ["Celommi", "Lucciola"],
  "P.17": ["Marisella", "Mirella"],
  "P.18": ["Sirenetta", "Mediterraneo", "Ohana"],
  "P.19": ["Lauretta", "Atlantic"],
  "P.20": ["Lido Azzurra", "Circolo Velico"],
  "P.21": ["Aurora", "Moro", "Oltremare"],
  "P.22": ["Bellavista", "Ziaso"],
  "P.23": ["Lido Aragosta"],
  "P.24": ["Riva del Sol", "Luna Rossa"],
  "P.25": ["Onda Blu", "Tropical", "Oasis"],
  "P.26": ["Lido38"],
  "P.27": ["VVF", "Lido Sahara", "BlueBay"],
  "P.28": ["Casa del Mar", "Vista Mare", "Di Matteo"],
  "P.29": ["Maldimare", "Embarcadero"],
  "P.30": ["Bora Bora", "Roses"],
  "P.31": ["Lo Squalo", "Bagni Bruno"],
  "P.32": ["Camping Nino", "Stella Maris"],
  "P.33": ["Camping Surabaia"],
  "P.34": ["Tartaruga", "Narcisi"],
  "P.35": ["Cabana Park", "Altamira", "Baia de Cuba"],
};

// ────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────

function getMancanze(data) {
  const miss = [];
  const chk = data.checklist || {};
  Object.entries(CHK_LABELS).forEach(([k, v]) => {
    if (chk[k] === false) miss.push(v);
  });
  const lc   = data.lidiChecklist || {};
  const lidi = LIDI_MAP[data.postazione] || [];
  lidi.forEach((lido) => {
    Object.entries(LIDO_LABELS).forEach(([k, v]) => {
      if ((lc[lido] || {})[k] === false) miss.push(`${lido}: ${v}`);
    });
  });
  return miss;
}

async function sendTelegram(message) {
  let chatIds = [];
  try {
    const snap = await admin.firestore().collection("config").doc("telegram_diario").get();
    if (snap.exists) chatIds = snap.data().chat_ids || [];
  } catch (e) {
    console.error("Errore lettura config Telegram:", e.message);
    return;
  }
  if (!chatIds.length) { console.log("Nessun Chat ID — skip"); return; }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  for (const chatId of chatIds) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown" }),
      });
      const d = await res.json();
      if (!d.ok) console.error(`Telegram error (${chatId}): ${d.description}`);
      else console.log(`Telegram inviato a ${chatId}`);
    } catch (e) {
      console.error(`Telegram fetch error (${chatId}): ${e.message}`);
    }
  }
}

// ────────────────────────────────────────────────────────────
// 1) DIARIO CREATO → notifica immediata
// ────────────────────────────────────────────────────────────
exports.onDiarioCreato = onDocumentCreated(
  { document: "diariogiornaliero/{docId}", region: REGION, retry: true },
  async (event) => {
    const data     = event.data.data();
    const docId    = event.params.docId;
    const mancanze = getMancanze(data);
    const dt       = data.dataOra?.toDate ? data.dataOra.toDate() : new Date(data.dataOra);
    const ora      = dt.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" });

    let msg;
    if (mancanze.length > 0) {
      msg = `⚠️ Mancanze — ${data.postazione}\n` +
            `🕐 Ore ${ora} · ${data.bagnino || "Bagnino"}\n` +
            `🏖 ${(LIDI_MAP[data.postazione] || []).join(", ")}\n\n` +
            mancanze.map((m) => `• ${m}`).join("\n");
    } else {
      msg = `✅ Diario compilato — ${data.postazione}\n` +
            `🕐 Ore ${ora} · ${data.bagnino || "Bagnino"}\n` +
            `🏖 ${(LIDI_MAP[data.postazione] || []).join(", ")}\n` +
            `Checklist completa`;
    }

    try {
      await sendTelegram(msg);
      await admin.firestore().collection("diarioLog").doc(docId).set({
        postazione: data.postazione, bagnino: data.bagnino,
        mancanze: mancanze.length, notificato: true,
        ts: admin.firestore.FieldValue.serverTimestamp(),
      });
      console.log(`Notifica: ${data.postazione}, ${mancanze.length} mancanze`);
    } catch (err) {
      console.error(`Errore notifica ${docId}:`, err.message);
      throw err;
    }
    return null;
  }
);

// ────────────────────────────────────────────────────────────
// 2) PROMEMORIA MATTINA — 10:00
// ────────────────────────────────────────────────────────────
exports.promemoriaMattina = onSchedule(
  { schedule: "0 10 * * *", timeZone: "Europe/Rome", region: REGION },
  async () => { await inviaPromemoria("mattina", 6, 14, "10:00"); }
);

// ────────────────────────────────────────────────────────────
// 3) SECONDO PROMEMORIA MATTINA — 12:00
// ────────────────────────────────────────────────────────────
exports.promemoriaMattina2 = onSchedule(
  { schedule: "0 12 * * *", timeZone: "Europe/Rome", region: REGION },
  async () => { await inviaPromemoria("mattina", 6, 14, "12:00"); }
);

// ────────────────────────────────────────────────────────────
// 4) PROMEMORIA POMERIGGIO — 15:00
// ────────────────────────────────────────────────────────────
exports.promemoriaPomeriggio = onSchedule(
  { schedule: "0 15 * * *", timeZone: "Europe/Rome", region: REGION },
  async () => { await inviaPromemoria("pomeriggio", 14, 20, "15:00"); }
);

// ────────────────────────────────────────────────────────────
// 5) SECONDO PROMEMORIA POMERIGGIO — 17:00
// ────────────────────────────────────────────────────────────
exports.promemoriaPomeriggio2 = onSchedule(
  { schedule: "0 17 * * *", timeZone: "Europe/Rome", region: REGION },
  async () => { await inviaPromemoria("pomeriggio", 14, 20, "17:00"); }
);

// ────────────────────────────────────────────────────────────
// HELPER PROMEMORIA
// ────────────────────────────────────────────────────────────
async function inviaPromemoria(turno, hStart, hEnd, oraRem) {
  const snap = await admin.firestore().collection("diariogiornaliero").limit(1000).get();

  const todayRoma = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const compiled = new Set(
    snap.docs.map((d) => d.data()).filter((d) => {
      if (!d.dataOra) return false;
      const dt = d.dataOra.toDate ? d.dataOra.toDate() : new Date(d.dataOra);

      const dateRoma = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(dt);
      if (dateRoma !== todayRoma) return false;

      if (d.giornataintera === true) return true;

      const hourRoma = parseInt(new Intl.DateTimeFormat("en-US", {
        timeZone: "Europe/Rome", hour: "numeric", hour12: false,
      }).format(dt));
      return hourRoma >= hStart && hourRoma < hEnd;
    }).map((d) => d.postazione).filter(Boolean)
  );

  const missing  = ALL_STATIONS.filter((p) => !compiled.has(p));
  const oggi     = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date());
  const label    = turno === "mattina" ? "Mattina (09-14)" : "Pomeriggio (14-19:30)";

  let msg;
  if (!missing.length) {
    msg = `🎉 Diario ${label}\n📅 ${oggi} ore ${oraRem}\n\nTutte le 26 postazioni hanno compilato. Ottimo lavoro!`;
  } else {
    msg = `⏰ Diario ${label}\n📅 ${oggi} ore ${oraRem}\n\n` +
          `${missing.length} postazioni non hanno ancora compilato:\n` +
          missing.map((p) => `• ${p} (${(LIDI_MAP[p] || []).join(", ")})`).join("\n") +
          `\n\n✅ Compilate: ${compiled.size}/26`;
  }

  await sendTelegram(msg);
  console.log(`Promemoria ${turno} ${oraRem}: ${missing.length} mancanti`);
}

// ────────────────────────────────────────────────────────────
// 6) WEBHOOK TELEGRAM — comandi /mancanti e /stato
// ────────────────────────────────────────────────────────────
const { onRequest } = require("firebase-functions/v2/https");

exports.telegramWebhook = onRequest(
  { region: REGION, invoker: "public", cors: false, timeoutSeconds: 30 },
  async (req, res) => {
    try {
      const body = req.body;
      if (!body || !body.message) { res.status(200).send("OK"); return; }

      const chatId = body.message.chat.id;
      const text   = (body.message.text || "").trim().toLowerCase().split("@")[0];

      if (text === "/mancanze") {
        const snap = await admin.firestore().collection("diariogiornaliero").limit(1000).get();
        const todayRoma = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date());

        const oggi = new Intl.DateTimeFormat("it-IT", {
          timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric",
        }).format(new Date());
        const oraAdesso = new Intl.DateTimeFormat("it-IT", {
          timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit",
        }).format(new Date());

        const docConMancanze = snap.docs.map(d => d.data()).filter(d => {
          if (!d.dataOra) return false;
          const dt = d.dataOra.toDate ? d.dataOra.toDate() : new Date(d.dataOra);
          const dateRoma = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
          }).format(dt);
          return dateRoma === todayRoma && getMancanze(d).length > 0;
        });

        let lines = [];
        lines.push("Mancanze dotazioni - " + oggi + " ore " + oraAdesso);
        lines.push("");

        if (docConMancanze.length === 0) {
          lines.push("Nessuna mancanza segnalata oggi.");
        } else {
          docConMancanze.forEach(d => {
            const mancanze = getMancanze(d);
            const dt = d.dataOra.toDate ? d.dataOra.toDate() : new Date(d.dataOra);
            const ora = new Intl.DateTimeFormat("it-IT", {
              timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit",
            }).format(dt);
            lines.push(d.postazione + " - " + (d.bagnino || "Bagnino") + " ore " + ora + ":");
            mancanze.forEach(m => lines.push("  - " + m));
            lines.push("");
          });
        }

        await fetch("https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: lines.join("\n") }),
        });

      } else if (text === "/mancanti" || text === "/stato") {
        const snap = await admin.firestore().collection("diariogiornaliero").limit(1000).get();

        const todayRoma = new Intl.DateTimeFormat("en-CA", {
          timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
        }).format(new Date());

        const matOk = new Set(), pomOk = new Set();
        snap.docs.map(d => d.data()).forEach(d => {
          if (!d.dataOra || !d.postazione) return;
          const dt = d.dataOra.toDate ? d.dataOra.toDate() : new Date(d.dataOra);
          const dateRoma = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit",
          }).format(dt);
          if (dateRoma !== todayRoma) return;
          if (d.giornataintera === true) { matOk.add(d.postazione); pomOk.add(d.postazione); return; }
          const h = parseInt(new Intl.DateTimeFormat("en-US", {
            timeZone: "Europe/Rome", hour: "numeric", hour12: false,
          }).format(dt));
          if (h >= 6  && h < 14) matOk.add(d.postazione);
          if (h >= 14 && h < 20) pomOk.add(d.postazione);
        });

        const missMat = ALL_STATIONS.filter(p => !matOk.has(p));
        const missPom = ALL_STATIONS.filter(p => !pomOk.has(p));
        const oggi = new Intl.DateTimeFormat("it-IT", {
          timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", year: "numeric",
        }).format(new Date());
        const oraAdesso = new Intl.DateTimeFormat("it-IT", {
          timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit",
        }).format(new Date());

        const sep = "\n";
        let lines = [];
        lines.push("Stato diari - " + oggi + " ore " + oraAdesso);
        lines.push("");
        lines.push("Mattina (09-14): " + matOk.size + "/26");
        if (missMat.length === 0) {
          lines.push("Tutte compilate");
        } else {
          missMat.forEach(p => lines.push("- " + p + " (" + (LIDI_MAP[p]||[]).join(", ") + ")"));
        }
        lines.push("");
        lines.push("Pomeriggio (14-19:30): " + pomOk.size + "/26");
        if (missPom.length === 0) {
          lines.push("Tutte compilate");
        } else {
          missPom.forEach(p => lines.push("- " + p + " (" + (LIDI_MAP[p]||[]).join(", ") + ")"));
        }
        const msg = lines.join(sep);

        await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text: msg }),
        });
      }
    } catch(e) {
      console.error("Webhook error:", e.message);
    }
    res.status(200).send("OK");
  }
);
