export type Status = 'pending' | 'running' | 'done' | 'error';
export interface Message { id: string; question: string; answer: string; status: Status; error?: string; createdAt: string; kind: 'question' | 'exercise'; sourcePages?: number[] }
export interface Page { number: number; text: string; width: number; height: number; imageReady: boolean; lesson: string; status: Status; error?: string; mapVersion?: string; model?: string; messages: Message[]; generationId?: string; contextPages?: number; contextComplete?: boolean }
export interface PageMap { page: number; topic: string; summary: string; terms: string[]; relatedPages: number[] }
export interface BookMap { version: string; overview: string; terms: string[]; pages: PageMap[]; complete?: boolean }
export interface Book {
  id: string; name: string; count: number; currentPage: number; createdAt: string;
  extraction: Status; extractionError?: string; extracted: number; textReady?: boolean;
  mapStatus: Status; mapError?: string; mapChunks: PageMap[][]; map?: BookMap;
  pages: Page[];
}
export interface BookSummary { id: string; name: string; count: number; currentPage: number; completed: number; createdAt: string }
export interface ModelOption { id: string; name: string; isDefault: boolean }
export interface AuthState { connected: boolean; label: string; error?: string; models: ModelOption[] }
export interface AppState { books: BookSummary[]; active?: Book; auth: AuthState; paused: boolean; model: string; activity: string }
export interface StudyAPI {
  state(id?: string): Promise<AppState>;
  importPDF(): Promise<string | null>;
  navigate(id: string, page: number): Promise<void>;
  login(): Promise<void>;
  refreshAuth(): Promise<void>;
  logout(): Promise<void>;
  settings(settings: { paused?: boolean; model?: string }): Promise<void>;
  retry(id: string, page?: number): Promise<void>;
  ask(id: string, page: number, question: string, kind?: 'question' | 'exercise'): Promise<void>;
  exercise(id: string, start: number, end: number, count: number): Promise<void>;
  fullscreen(): Promise<void>;
  dataFolder(): Promise<void>;
  onChange(callback: () => void): () => void;
  onDelta(callback: (event: { bookId: string; page: number; messageId?: string; generationId?: string; text: string }) => void): () => void;
}
declare global { interface Window { study: StudyAPI } }
