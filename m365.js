const crypto = require('crypto');
const fs = require('fs');
const OfferEmailParser = require('./offer-email-parser');

const base64url = value => Buffer.from(value).toString('base64url');

function configFromEnv() {
  return {
    tenantId: process.env.M365_TENANT_ID,
    clientId: process.env.M365_CLIENT_ID,
    thumbprint: String(process.env.M365_CERT_THUMBPRINT || '').replace(/\s/g, '').toUpperCase(),
    privateKeyPath: process.env.M365_CERT_PATH || '/run/secrets/m365-private-key.pem',
    mailbox: process.env.M365_MAILBOX || 'citi-offers@yither.com',
    folders: (process.env.M365_FOLDER_PATHS || 'Inbox/Citi Offers/Chris,Inbox/Citi Offers/Janet').split(',').map(value => value.trim()).filter(Boolean)
  };
}

function validateConfig(config) {
  const missing = ['tenantId', 'clientId', 'thumbprint', 'mailbox'].filter(key => !config[key]);
  if (missing.length) throw new Error(`Missing M365 configuration: ${missing.join(', ')}`);
  if (!fs.existsSync(config.privateKeyPath)) throw new Error(`M365 private key not found at ${config.privateKeyPath}`);
}

function createClientAssertion(config) {
  const now = Math.floor(Date.now() / 1000);
  const audience = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', x5t: Buffer.from(config.thumbprint, 'hex').toString('base64url') }));
  const payload = base64url(JSON.stringify({ aud: audience, iss: config.clientId, sub: config.clientId, jti: crypto.randomUUID(), nbf: now - 60, exp: now + 600 }));
  const unsigned = `${header}.${payload}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), fs.readFileSync(config.privateKeyPath));
  return `${unsigned}.${signature.toString('base64url')}`;
}

async function acquireToken(config = configFromEnv()) {
  validateConfig(config);
  const url = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: createClientAssertion(config)
  });
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const result = await response.json();
  if (!response.ok) throw new Error(`Microsoft token request failed: ${result.error_description || result.error || response.status}`);
  return result.access_token;
}

async function graphGet(url, token) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json();
  if (!response.ok) throw new Error(`Microsoft Graph request failed: ${result.error?.message || response.status}`);
  return result;
}

async function findFolder(config, token, folderPath) {
  const parts = folderPath.split('/').filter(Boolean);
  let parentId = null;
  for (const part of parts) {
    const base = parentId
      ? `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/mailFolders/${encodeURIComponent(parentId)}/childFolders`
      : `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/mailFolders`;
    let url = `${base}?includeHiddenFolders=true&$top=100&$select=id,displayName,parentFolderId`;
    let found = null;
    while (url && !found) {
      const page = await graphGet(url, token);
      found = (page.value || []).find(folder => folder.displayName.toLowerCase() === part.toLowerCase());
      url = page['@odata.nextLink'];
    }
    if (!found) throw new Error(`Mailbox folder not found: ${folderPath} (missing ${part})`);
    parentId = found.id;
  }
  return parentId;
}

function htmlToText(value) {
  return String(value || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
}

function classifyMessage(message) {
  const subject = String(message.subject || '');
  const bodyText = htmlToText(message.body?.content || '');
  const combined = `${subject}\n${bodyText}`;
  const sender = String(message.from?.emailAddress?.address || '').toLowerCase();
  if (/promotional apr|promo apr|annual percentage rate|balance transfer|flex loan/i.test(combined)) {
    return { classification: 'non_offer', status: 'ignored', bodyText, parsedOffer: null, reason: 'APR or financing promotion' };
  }
  // Forwarded messages come from the cardholder, so also look for Citi's
  // branding and sender addresses in the forwarded body.
  const hasCitiEvidence = sender.includes('citi') || /@[^\s>]*citi\.com\b|\bcitibank\b|\bciti\s+thankyou\b/i.test(combined);
  if (!hasCitiEvidence) {
    return { classification: 'non_citi', status: 'ignored', bodyText, parsedOffer: null, reason: 'Sender is not recognized as Citi' };
  }
  try {
    const parsedOffer = OfferEmailParser.parseOfferEmail(combined);
    const reminder = /already activated|thank you for activating|check your progress|keep going|you.ve spent/i.test(combined);
    return { classification: reminder ? 'offer_reminder' : 'offer', status: 'review', bodyText, parsedOffer, reason: reminder ? 'Recognized offer reminder' : 'Recognized offer terms' };
  } catch (error) {
    return { classification: 'uncertain', status: 'review', bodyText, parsedOffer: null, reason: error.message };
  }
}

async function syncFolder(pool, config, token, folderPath) {
  const folderId = await findFolder(config, token, folderPath);
  const ownerKey = folderPath.split('/').filter(Boolean).pop().toLowerCase();
  const personResult = await pool.query('SELECT id, name FROM people WHERE LOWER(name) LIKE $1 ORDER BY id LIMIT 1', [`${ownerKey}%`]);
  const personId = personResult.rows[0]?.id || null;
  const state = await pool.query('SELECT * FROM m365_sync_state WHERE folder_path = $1', [folderPath]);
  let url = state.rows[0]?.delta_link || `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mailbox)}/mailFolders/${encodeURIComponent(folderId)}/messages/delta?changeType=created&$top=50&$select=id,internetMessageId,receivedDateTime,subject,from,toRecipients,body`;
  let deltaLink = null;
  let processed = 0;
  while (url) {
    const page = await graphGet(url, token);
    for (const message of page.value || []) {
      if (message['@removed']) continue;
      const classified = classifyMessage(message);
      const bodyHash = crypto.createHash('sha256').update(classified.bodyText).digest('hex');
      let linkedOfferId = null;
      let processingStatus = classified.status;
      if (personId && classified.parsedOffer?.fingerprint) {
        const existing = await pool.query(
          'SELECT id FROM offers WHERE person_id = $1 AND offer_fingerprint = $2 ORDER BY id LIMIT 1',
          [personId, classified.parsedOffer.fingerprint]
        );
        if (existing.rows.length) {
          linkedOfferId = existing.rows[0].id;
          processingStatus = 'linked';
        }
      }
      const inserted = await pool.query(`
        INSERT INTO email_ingestions
          (graph_message_id, internet_message_id, mailbox, folder_path, person_id, received_at, sender, subject, body_text, body_hash,
           classification, processing_status, parsed_offer, offer_fingerprint, linked_offer_id, classification_reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
        ON CONFLICT (graph_message_id) DO NOTHING
      `, [message.id, message.internetMessageId || null, config.mailbox, folderPath, personId, message.receivedDateTime || null,
        message.from?.emailAddress?.address || '', message.subject || '', classified.bodyText, bodyHash,
        classified.classification, processingStatus, JSON.stringify(classified.parsedOffer), classified.parsedOffer?.fingerprint || null,
        linkedOfferId, classified.reason]);
      processed += inserted.rowCount;
    }
    deltaLink = page['@odata.deltaLink'] || deltaLink;
    url = page['@odata.nextLink'] || null;
  }
  await pool.query(`
    INSERT INTO m365_sync_state (folder_path, folder_id, delta_link, last_success_at, last_error, updated_at)
    VALUES ($1,$2,$3,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP)
    ON CONFLICT (folder_path) DO UPDATE SET folder_id=EXCLUDED.folder_id, delta_link=EXCLUDED.delta_link,
      last_success_at=CURRENT_TIMESTAMP, last_error=NULL, updated_at=CURRENT_TIMESTAMP
  `, [folderPath, folderId, deltaLink]);
  return { folderPath, folderId, processed };
}

async function syncAll(pool) {
  const config = configFromEnv();
  const token = await acquireToken(config);
  const results = [];
  for (const folder of config.folders) results.push(await syncFolder(pool, config, token, folder));
  return results;
}

module.exports = { configFromEnv, validateConfig, acquireToken, graphGet, findFolder, classifyMessage, syncAll };
