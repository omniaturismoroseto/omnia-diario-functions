# Omnia Diario Functions

Firebase Cloud Functions per il **Diario Giornaliero** di Omnia Adriatic Lifeguard Service.

**Progetto Firebase:** `app-segnalazioni-omnia-roseto`  
**Repository separato da:** `appsegnalazioni` (app segnalazioni bagnini)

## Funzioni

| Funzione | Tipo | Trigger |
|---|---|---|
| `onDiarioCreato` | Firestore trigger | Nuovo diario con mancanze → Telegram immediato |
| `promemoriaMattina` | Scheduler | Ogni giorno alle 10:00 (ora di Roma) |
| `promemoriaPomeriggio` | Scheduler | Ogni giorno alle 15:00 (ora di Roma) |

## Deploy

```bash
npm install
firebase deploy --only functions:diario
```

## Configurazione Telegram

Il Chat ID dei destinatari è salvato in Firestore:
`config/telegram_diario` → campo `chat_ids: [array di chat ID]`

Si gestisce dal tab ⚙️ Impostazioni della pagina admin.
