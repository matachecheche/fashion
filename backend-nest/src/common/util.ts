import * as crypto from 'node:crypto';

export function generarCodigo(prefijo: string): string {
  const fecha = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${prefijo}-${fecha}-${rand}`;
}

export function normalizarSlug(valor: string): string {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function redondearMoneda(valor: number): number {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

export function sanitizarCeldaFormula(valor: unknown): string | number {
  if (typeof valor === 'number') return valor;
  const texto = String(valor ?? '');
  if (/^[=+\-@]/.test(texto.trim())) {
    return `'${texto}`;
  }
  return texto;
}

export function sanitizarCeldaCsv(valor: unknown): string {
  const seguro = String(sanitizarCeldaFormula(valor ?? ''));
  if (/[",\r\n]/.test(seguro)) {
    return `"${seguro.replace(/"/g, '""')}"`;
  }
  return seguro;
}
