export type Status = 'pending' | 'running' | 'done' | 'error';
export type GenerationState = 'running' | 'paused' | 'complete' | 'waiting';
export type LessonDetail = 'concise' | 'standard' | 'detailed';
export interface StudySettings { paused:boolean; model:string; aiConcurrency:number; pdfWorkers:number; lessonDetail:LessonDetail; uiScale:number; readingFontSize:number }
export interface OutlineEntry { title:string; page:number; children:OutlineEntry[] }
export interface RuntimeStatus { activeLessons:number; indexing:boolean; modelActive:number; modelQueued:number; pdfWorkers:number }
export interface Message { id: string; question: string; answer: string; status: Status; error?: string; createdAt: string; kind: 'question' | 'exercise'; sourcePages?: number[]; generationId?:string }
export interface Page { number: number; text: string; width: number; height: number; imageReady: boolean; lesson: string; status: Status; error?: string; mapVersion?: string; model?: string; messages: Message[]; generationId?: string; contextPages?: number; contextComplete?: boolean; lessonDetail?:LessonDetail }
export interface PageMap { page: number; topic: string; summary: string; terms: string[]; relatedPages: number[]; density?:'brief'|'normal'|'dense' }
export interface BookMap { version: string; overview: string; terms: string[]; pages: PageMap[]; complete?: boolean }
export interface Book {
  id: string; name: string; count: number; currentPage: number; createdAt: string;
  extraction: Status; extractionError?: string; extracted: number; textReady?: boolean;
  mapStatus: Status; mapError?: string; mapChunks: PageMap[][]; map?: BookMap;
  generationPaused?:boolean; pauseReason?:string; generationStarted?:boolean;
  review?:ReviewRecord; reviewStale?:boolean;
  pages: Page[];
}
export interface ReviewSource { page:number; kind:'text'|'visual'; quote:string }
export type ConceptKind='topic'|'term'|'concept'|'formula'|'method';
export interface ConceptNode { id:string; kind:ConceptKind; label:string; fullName:string; summary:string; detail:string; formula:string; symbols:{symbol:string;meaning:string;unit:string}[]; conditions:string[]; sources:ReviewSource[] }
export interface ConceptEdge { id:string; source:string; target:string; relation:'contains'|'defines'|'uses'|'compares'|'depends'|'example'; label:string; detail:string; sources:ReviewSource[] }
export interface ConceptGraph { title:string; rootId:string; nodes:ConceptNode[]; edges:ConceptEdge[] }
export interface ReviewView { positions:Record<string,{x:number;y:number}>; viewport:{x:number;y:number;zoom:number}; expanded:string[]; selected?:string }
export interface ReviewRecord { status:'running'|'done'|'paused'|'error'; stage:string; completedChunks:number; totalChunks:number; sourceVersion:string; model:string; chunks:ConceptGraph[]; mergeLevels?:ConceptGraph[][]; completedMerges?:number; totalMerges?:number; phase?:'extract'|'merge'|'finalize'|'done'; validationFailure?:{stage:string;error:string;attempts:number;at:string;output?:string}; request?:{state:'queued'|'running'|'receiving';queuedAt:string;startedAt?:string;lastResponseAt?:string}; error?:string; graph?:ConceptGraph & {generationId:string;sourceVersion:string;createdAt:string;model:string}; view?:ReviewView }
export interface BookSummary { id: string; name: string; count: number; currentPage: number; completed: number; createdAt: string; generationPaused:boolean; generationState:GenerationState; pauseReason?:string }
export interface ModelOption { id: string; name: string; isDefault: boolean }
export interface AuthState { connected: boolean; label: string; error?: string; models: ModelOption[] }
export interface UpdateState { status:'unsupported'|'idle'|'checking'|'current'|'available'|'downloading'|'ready'|'installing'|'error'; version?:string; percent?:number; error?:string }
export interface AppState extends StudySettings { books: BookSummary[]; active?: Book; auth: AuthState; activity: string; version:string; runtime:RuntimeStatus; update:UpdateState }
export interface StudyAPI {
  state(id?: string): Promise<AppState>;
  importPDF(): Promise<string | null>;
  navigate(id: string, page: number): Promise<void>;
  login(): Promise<void>;
  refreshAuth(): Promise<void>;
  logout(): Promise<void>;
  settings(settings: Partial<StudySettings>): Promise<void>;
  retry(id: string, page?: number): Promise<void>;
  ask(id: string, page: number, question: string, kind?: 'question' | 'exercise'): Promise<void>;
  deleteMessage(id:string,page:number,messageId:string):Promise<void>;
  deleteBook(id:string):Promise<void>;
  generation(id:string,paused:boolean):Promise<void>;
  exercise(id: string, start: number, end: number, count: number): Promise<void>;
  fullscreen(): Promise<void>;
  dataFolder(): Promise<void>;
  checkUpdate():Promise<void>;
  installUpdate():Promise<void>;
  generateReview(id:string,restart?:boolean):Promise<void>;
  cancelReview(id:string):Promise<void>;
  saveReviewView(id:string,view:ReviewView):Promise<void>;
  onChange(callback: () => void): () => void;
  onDelta(callback: (event: { bookId: string; page: number; messageId?: string; generationId?: string; text: string }) => void): () => void;
}
declare global { interface Window { study: StudyAPI } }
