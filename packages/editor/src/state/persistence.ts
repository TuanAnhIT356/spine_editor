import type { SpineJson } from '@spine-editor/core';
import type { ImageAsset } from './store.js';

export interface ProjectPayload {
  format: 'spine-editor-project';
  version: 1;
  spine: SpineJson;
  assets: ImageAsset[];
}

const DB_NAME = 'spine-editor';
const STORE = 'projects';
const AUTOSAVE_KEY = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export async function saveAutosave(payload: ProjectPayload): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(payload, AUTOSAVE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write failed'));
  });
  db.close();
}

export async function loadAutosave(): Promise<ProjectPayload | undefined> {
  const db = await openDb();
  const result = await new Promise<ProjectPayload | undefined>((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(AUTOSAVE_KEY);
    req.onsuccess = () => resolve(req.result as ProjectPayload | undefined);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
  });
  db.close();
  return result;
}

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadDataUrl(filename: string, dataUrl: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsText(file);
  });
}

/** Reads an image file into an asset (name without extension + dimensions). */
export async function loadImageAsset(file: File): Promise<ImageAsset> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
    reader.readAsDataURL(file);
  });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const name = file.name.replace(/\.[^.]+$/, '');
  return { name, dataUrl, width: img.naturalWidth, height: img.naturalHeight };
}
