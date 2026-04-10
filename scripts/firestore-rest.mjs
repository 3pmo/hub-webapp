/**
 * firestore-rest.mjs
 * Lightweight Firestore REST client using service account JWT.
 * No external dependencies required.
 */

import https from 'https';
import crypto from 'crypto';
import fs from 'fs';

/**
 * Get an OAuth2 access token for the service account
 */
export async function getAccessToken(serviceAccount) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
    scope: 'https://www.googleapis.com/auth/datastore',
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

  const signer = crypto.createSign('SHA256');
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  const signature = signer.sign(serviceAccount.private_key, 'base64url');

  const jwt = `${encodedHeader}.${encodedPayload}.${signature}`;

  return new Promise((resolve, reject) => {
    const postData = `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`;

    const req = https.request(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': postData.length,
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          const data = JSON.parse(body);
          if (data.access_token) {
            resolve(data.access_token);
          } else {
            reject(new Error(`Failed to get access token: ${body}`));
          }
        });
      }
    );

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

/**
 * Firestore Field Mapper (JS Object -> Firestore REST JSON)
 */
export function toFirestoreFields(obj) {
  const fields = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;

    if (typeof value === 'string') {
      fields[key] = { stringValue: value };
    } else if (typeof value === 'number') {
      if (Number.isInteger(value)) {
        fields[key] = { integerValue: value.toString() };
      } else {
        fields[key] = { doubleValue: value };
      }
    } else if (typeof value === 'boolean') {
      fields[key] = { booleanValue: value };
    } else if (value instanceof Date) {
      fields[key] = { timestampValue: value.toISOString() };
    } else if (Array.isArray(value)) {
      fields[key] = {
        arrayValue: {
          values: value.map(v => {
            if (typeof v === 'string') return { stringValue: v };
            if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
            return { stringValue: String(v) };
          }),
        },
      };
    } else if (typeof value === 'object') {
      // Check if it's a timestamp-like object {seconds, nanoseconds}
      if ('seconds' in value) {
        const date = new Date(value.seconds * 1000 + (value.nanoseconds || 0) / 1e6);
        fields[key] = { timestampValue: date.toISOString() };
      } else {
        fields[key] = { mapValue: { fields: toFirestoreFields(value) } };
      }
    }
  }
  return fields;
}

/**
 * Firestore Field Unmapper (Firestore REST JSON -> JS Object)
 */
export function fromFirestoreFields(fields) {
  const obj = {};
  if (!fields) return obj;
  for (const [key, value] of Object.entries(fields)) {
    if ('stringValue' in value) obj[key] = value.stringValue;
    else if ('integerValue' in value) obj[key] = parseInt(value.integerValue, 10);
    else if ('doubleValue' in value) obj[key] = parseFloat(value.doubleValue);
    else if ('booleanValue' in value) obj[key] = value.booleanValue;
    else if ('timestampValue' in value) obj[key] = value.timestampValue;
    else if ('arrayValue' in value) {
      obj[key] = (value.arrayValue.values || []).map(v => fromFirestoreFields({ val: v }).val);
    } else if ('mapValue' in value) {
      obj[key] = fromFirestoreFields(value.mapValue.fields);
    }
  }
  return obj;
}

/**
 * Execute a REST request
 */
export async function firestoreRequest(projectId, method, path, body = null, token) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}`;
  
  return new Promise((resolve, reject) => {
    const options = {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(url, options, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => (responseBody += chunk));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(responseBody ? JSON.parse(responseBody) : null);
        } else {
          reject(new Error(`Firestore request failed (${res.statusCode}): ${responseBody}`));
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}
