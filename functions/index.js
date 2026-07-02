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

// Tutte le postazioni P.10–P.35
const ALL_STATIONS = Array.from({ length: 26 }, (_, i) => `P.${i + 10}`);

// Etichette checklist postazione
const CHK_LABELS = {
  kit_medico:             "Kit medico",
  giubbino:               "Giubbino",
  rullo:                  "Rullo",
  caschetto:              "Caschetto",
  scalmi_remi:            "Scalmi e remi",
  mezzo_marinaio:         "Mezzo marinaio",
  ancora:                 "Ancora",
  salvagente_pattino:     "Salvagente pattino",
  canotta_rossa:          "Canotta rossa",
  fischietto:             "Fischietto",
  pinne_maschera:         "Pinne/maschera",
  binocolo:               "Binocolo",
  documenti:              "Brevetto/BLSD/Visita",
  salvagente_concessione: "Salvagente concessione",
  bandiere_ok:            "Bandiere",
  limite_acque:           "Limiti acque",
  boa_300m:               "Boa 300m",
};

// Etichette checklist per lido
const LIDO_LABELS = {
  salvagente: "N.2 salvagente (sagola ok)",
  bandiere:   "Bandiere verde/gialla/rossa",
  acque:      "Limiti acque sicure in mare",
  boa:        "Boa 300m dietro gli scogli",
};

// Mappa postazione → lidi
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
  "P.21": ["Aurora", "Moro"],
  "P.22": ["Bellavista", "Oltremare"],
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

/** Calcola tutte le mancanze di un documento diario */
function getMancanze(data) {
  const miss = [];

  // Checklist postazione
  const chk = data.checklist || {};
  Object.entries(CHK_LABELS).forEach(([k, v]) => {
    if (chk[k] === false) miss.push(v);
  });

  // Checklist per lido
  const lc   = data.lidiChecklist || {};
  const lidi = LIDI_MAP[data.postazione] || [];
  lidi.forEach((lido) => {
    Object.entries(LIDO_LABELS).forEach(([k, v]) => {
      if ((lc[lido] || {})[k] === false) miss.push(`${lido}: ${v}`);
    });
  });

  return miss;
}

/** Invia messaggio Telegram a tutti i destinatari configurati in Firestore */
async function sendTelegram(message) {
  let chatIds = [];
  try {
    const snap = await admin
      .firestore()
      .collection("config")
      .doc("telegram_diario")
      .get();
    if (snap.exists) chatIds = snap.data().chat_ids || [];
  } catch (e) {
    console.error("Errore lettura config Telegram:", e.message);
    return;
  }

  if (!chatIds.length) {
    console.log("Nessun Chat ID configurato — skip Telegram");
    return;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;

  for (const chatId of chatIds) {
    try {
      const res = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id:    chatId,
          text:       message,
          parse_mode: "Markdown",
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        console.error(`Telegram error (${chatId}): ${data.description}`);
      } else {
        console.log(`✅ Telegram inviato a ${chatId}`);
      }
    } catch (e) {
      console.error(`Telegram fetch error (${chatId}): ${e.message}`);
    }
  }
}

// ────────────────────────────────────────────────────────────
// 1) DIARIO CREATO → notifica Telegram se ci sono mancanze
// ────────────────────────────────────────────────────────────
exports.onDiarioCreato = onDocumentCreated(
  {
    document: "diariogiornaliero/{docId}",
    region:   REGION,
  },
  async (event) => {
    const data     = event.data.data();
    const mancanze = getMancanze(data);

    if (!mancanze.length) {
      console.log(`Diario ${event.params.docId}: nessuna mancanza`);
      return null;
    }

    const preview = mancanze.slice(0, 4).join(", ");
    const extra   = mancanze.length > 4 ? ` +${mancanze.length - 4} altro` : "";
    const dt      = data.dataOra?.toDate
      ? data.dataOra.toDate()
      : new Date(data.dataOra);
    const ora = dt.toLocaleTimeString("it-IT", {
      hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome",
    });

    const msg =
      `⚠️ *Mancanze segnalate — ${data.postazione}*\n` +
      `🕐 Ore ${ora} · ${data.bagnino || "Bagnino"}\n\n` +
      `${mancanze.map((m) => `• ${m}`).join("\n")}`;

    await sendTelegram(msg);
    console.log(`Push diario: ${data.postazione}, ${mancanze.length} mancanze`);
    return null;
  }
);

// ────────────────────────────────────────────────────────────
// 2) PROMEMORIA MATTINA — 10:00 ora di Roma
// ────────────────────────────────────────────────────────────
exports.promemoriaMattina = onSchedule(
  {
    schedule:  "0 10 * * *",
    timeZone:  "Europe/Rome",
    region:    REGION,
  },
  async () => {
    await inviaPromemoria("mattina", 9, 14);
  }
);

// ────────────────────────────────────────────────────────────
// 3) PROMEMORIA POMERIGGIO — 15:00 ora di Roma
// ────────────────────────────────────────────────────────────
exports.promemoriaPomeriggio = onSchedule(
  {
    schedule:  "0 15 * * *",
    timeZone:  "Europe/Rome",
    region:    REGION,
  },
  async () => {
    await inviaPromemoria("pomeriggio", 14, 19);
  }
);

// ────────────────────────────────────────────────────────────
// HELPER PROMEMORIA
// ────────────────────────────────────────────────────────────
async function inviaPromemoria(turno, hStart, hEnd) {
  // Finestra oraria di oggi in ora di Roma
  const nowRoma = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Europe/Rome" })
  );
  const start = new Date(nowRoma); start.setHours(hStart, 0, 0, 0);
  const end   = new Date(nowRoma); end.setHours(hEnd,   0, 0, 0);

  // Carica tutti i documenti e filtra lato server per evitare problemi di indici
  const snap = await admin
    .firestore()
    .collection("diariogiornaliero")
    .limit(500)
    .get();

  const compiled = new Set(
    snap.docs
      .map((d) => d.data())
      .filter((d) => {
        if (!d.dataOra) return false;
        const dt = d.dataOra.toDate ? d.dataOra.toDate() : new Date(d.dataOra);
        return dt >= start && dt < end;
      })
      .map((d) => d.postazione)
      .filter(Boolean)
  );
  const missing = ALL_STATIONS.filter((p) => !compiled.has(p));

  const oggi       = nowRoma.toLocaleDateString("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
  });
  const labelTurno = turno === "mattina"
    ? "Mattina (09:00–14:00)"
    : "Pomeriggio (14:00–19:00)";
  const oraRem     = turno === "mattina" ? "10:00" : "15:00";

  let msg;
  if (!missing.length) {
    msg =
      `✅ *OMNIA Diario — ${labelTurno}*\n` +
      `📅 ${oggi} ore ${oraRem}\n\n` +
      `Tutte le 26 postazioni hanno compilato\\. Ottimo\\! 🎉`;
  } else {
    msg =
      `⏰ *OMNIA Diario — ${labelTurno}*\n` +
      `📅 ${oggi} ore ${oraRem}\n\n` +
      `*${missing.length} postazioni non hanno ancora compilato:*\n` +
      missing.map((p) => `• ${p}`).join("\n") +
      `\n\n✅ Compilate: ${compiled.size}/26\n` +
      `📋 adriaticlifeguardservice.it/admin\\-diario`;
  }

  await sendTelegram(msg);
  console.log(`Promemoria ${turno}: ${missing.length} mancanti su 26`);
}
