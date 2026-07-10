/**
 * Client for the opt-in Python backend (server/). The access token lives only
 * in memory; the refresh token is an httpOnly cookie the browser sends to
 * /api/auth/* — on 401 we silently refresh once and retry.
 */
import { create } from 'zustand';
import type { ProjectPayload } from '../state/persistence.js';

export interface ServerUser {
  id: number;
  email: string;
}

export interface ProjectSummary {
  id: number;
  name: string;
  thumbnail: string;
  created_at: string;
  updated_at: string;
}

export interface ProjectFull extends ProjectSummary {
  data: ProjectPayload;
}

export interface ApiKeyInfo {
  provider: string;
  last4: string;
  created_at: string;
}

interface AuthOut {
  access_token: string;
  user: ServerUser;
}

interface ServerState {
  user: ServerUser | null;
  /** Server project this editor session is bound to (autosave target). */
  projectId: number | null;
  projectName: string;
  setUser: (user: ServerUser | null) => void;
  bindProject: (id: number | null, name?: string) => void;
}

export const useServer = create<ServerState>((set) => ({
  user: null,
  projectId: null,
  projectName: '',
  setUser: (user) => set(user ? { user } : { user: null, projectId: null, projectName: '' }),
  bindProject: (projectId, projectName = '') => set({ projectId, projectName }),
}));

const URL_KEY = 'spine-server-url';
export const DEFAULT_SERVER_URL = 'http://localhost:8100';

export function serverUrl(): string {
  return localStorage.getItem(URL_KEY) ?? DEFAULT_SERVER_URL;
}

export function setServerUrl(url: string): void {
  localStorage.setItem(URL_KEY, url.replace(/\/$/, ''));
}

let accessToken: string | null = null;

async function request<T>(path: string, init?: RequestInit, allowRetry = true): Promise<T> {
  const res = await fetch(serverUrl() + path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  });
  if (res.status === 401 && allowRetry && !path.startsWith('/api/auth/')) {
    if (await tryRefresh()) return request<T>(path, init, false);
  }
  if (!res.ok) {
    let detail: unknown;
    try {
      detail = ((await res.json()) as { detail?: unknown }).detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(typeof detail === 'string' ? detail : (res.statusText ?? `HTTP ${res.status}`));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function acceptSession(out: AuthOut): void {
  accessToken = out.access_token;
  useServer.getState().setUser(out.user);
}

/** Restores the session from the refresh cookie; false when logged out/offline. */
export async function tryRefresh(): Promise<boolean> {
  try {
    acceptSession(await request<AuthOut>('/api/auth/refresh', { method: 'POST' }, false));
    return true;
  } catch {
    accessToken = null;
    useServer.getState().setUser(null);
    return false;
  }
}

export async function checkHealth(): Promise<boolean> {
  try {
    const out = await request<{ status: string }>('/api/health', undefined, false);
    return out.status === 'ok';
  } catch {
    return false;
  }
}

export async function login(email: string, password: string): Promise<void> {
  const body = JSON.stringify({ email, password });
  acceptSession(await request<AuthOut>('/api/auth/login', { method: 'POST', body }, false));
}

export async function registerAccount(email: string, password: string): Promise<void> {
  const body = JSON.stringify({ email, password });
  acceptSession(await request<AuthOut>('/api/auth/register', { method: 'POST', body }, false));
}

export async function logout(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST' }, false);
  } finally {
    accessToken = null;
    useServer.getState().setUser(null);
  }
}

export async function forgotPassword(email: string): Promise<void> {
  await request('/api/auth/forgot', { method: 'POST', body: JSON.stringify({ email }) }, false);
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const body = JSON.stringify({ token, password });
  await request('/api/auth/reset', { method: 'POST', body }, false);
}

export function listProjects(): Promise<ProjectSummary[]> {
  return request('/api/projects');
}

export function createProject(
  name: string,
  data: ProjectPayload,
  thumbnail: string,
): Promise<ProjectFull> {
  return request('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, data, thumbnail }),
  });
}

export function getProject(id: number): Promise<ProjectFull> {
  return request(`/api/projects/${id}`);
}

export function updateProject(
  id: number,
  patch: { name?: string; data?: ProjectPayload; thumbnail?: string },
): Promise<ProjectSummary> {
  return request(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
}

export function deleteProject(id: number): Promise<void> {
  return request(`/api/projects/${id}`, { method: 'DELETE' });
}

export interface ProviderInfo {
  name: string;
  supports_transparent: boolean;
  approx_cost_usd: number;
  has_key: boolean;
}

export interface GalleryEntry {
  id: number;
  provider: string;
  prompt: string;
  size: string;
  transparent: boolean;
  created_at: string;
}

export interface GalleryImage extends GalleryEntry {
  data_url: string;
}

export function listProviders(): Promise<ProviderInfo[]> {
  return request('/api/generate/providers');
}

export function generateImage(
  provider: string,
  prompt: string,
  size: string,
  transparent: boolean,
): Promise<GalleryImage> {
  return request('/api/generate', {
    method: 'POST',
    body: JSON.stringify({ provider, prompt, size, transparent }),
  });
}

export function listGallery(): Promise<GalleryEntry[]> {
  return request('/api/generate');
}

export function getGalleryImage(id: number): Promise<GalleryImage> {
  return request(`/api/generate/${id}`);
}

export function deleteGalleryImage(id: number): Promise<void> {
  return request(`/api/generate/${id}`, { method: 'DELETE' });
}

export interface SplitPart {
  name: string;
  data_url: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SplitResult {
  width: number;
  height: number;
  parts: SplitPart[];
}

export interface PoseLandmarks {
  landmarks: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
  bbox: { x: number; y: number; width: number; height: number } | null;
}

export function removeBackground(
  image: string,
  provider = 'local',
  tolerance = 24,
): Promise<{ data_url: string }> {
  return request('/api/segment/remove-bg', {
    method: 'POST',
    body: JSON.stringify({ image, provider, tolerance }),
  });
}

export function splitParts(image: string, minArea = 64, crop = true): Promise<SplitResult> {
  return request('/api/segment/parts', {
    method: 'POST',
    body: JSON.stringify({ image, min_area: minArea, crop }),
  });
}

export function estimatePose(image: string): Promise<PoseLandmarks> {
  return request('/api/segment/pose', { method: 'POST', body: JSON.stringify({ image }) });
}

export function listKeys(): Promise<ApiKeyInfo[]> {
  return request('/api/keys');
}

export function setKey(provider: string, key: string): Promise<ApiKeyInfo> {
  return request(`/api/keys/${provider}`, { method: 'PUT', body: JSON.stringify({ key }) });
}

export function deleteKey(provider: string): Promise<void> {
  return request(`/api/keys/${provider}`, { method: 'DELETE' });
}
