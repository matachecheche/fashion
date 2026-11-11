import * as crypto from 'node:crypto';

function canonicalize(value: any): any {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value).sort();
    const result: Record<string, any> = {};
    for (const k of sortedKeys) {
      if (value[k] !== undefined) {
        result[k] = canonicalize(value[k]);
      }
    }
    return result;
  }
  return value;
}

export function calcularOfflinePayloadHash(payload: any): string {
  const canonicalJson = JSON.stringify(canonicalize(payload));
  return crypto.createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}
