export type Status = 'pending' | 'running' | 'done' | 'error';
export type GenerationState = 'running' | 'paused' | 'complete' | 'waiting';
export type LessonDetail = 'concise' | 'standard' | 'detailed';
export type ModelPhase='queued'|'connecting'|'thread'|'starting'|'waiting'|'receiving'|'done'|'error'|'cancelled';
export type ModelActivity=Exclude<ModelPhase,'queued'|'done'|'error'|'cancelled'>;
export type ModelEventType='thread-created'|'request-sent'|'rpc-accepted'|'turn-started'|'item-started'|'reasoning'|'content'|'completed'|'upstream-error'|'local-error'|'cancelled'|'interrupt-sent'|'interrupt-confirmed'|'cleanup-pending'|'transport-closed'|'parsing'|'validation-failed'|'page-saved'|'saved';
export interface ModelEvent {type:ModelEventType;code?:string;httpStatus?:number;willRetry?:boolean;page?:number}
export interface TraceEvent extends ModelEvent {atMs:number;count:number}
export interface ModelTrace {id:string;bookId:string;kind:'lesson'|'index'|'overview'|'question'|'review'|'probe';pages:number[];model:string;createdAt:string;phase:ModelPhase;lastPhase?:ModelActivity|'queued';elapsedMs:number;phaseMs:number;marks:Partial<Record<ModelPhase,number>>;failure?:'timeout'|'network'|'quota'|'auth'|'other';events?:TraceEvent[]}
export type ProbeMode='text'|'page'|'direct';
export interface ProbeResult {mode?:ProbeMode;status:'idle'|'running'|'done'|'error'|'cancelled';traceId?:string;model?:string;page?:number;matched?:boolean;error?:string}
export interface ProbeState extends ProbeResult {canDirect?:boolean;history?:ProbeResult[];records?:ModelTrace[]}
export interface TransportSnapshot {lines:number;invalidLines:number;unmatchedReplies:number;pendingRPCs:number;processRunning:boolean;lastInputAt?:string;events:Record<string,number>}
export interface GenerationDiagnostics {records:ModelTrace[];transport?:TransportSnapshot;preparation?:{count:number;textReady:boolean;images:number;indexed:number;lessons:number;mapComplete:boolean;paused:boolean;started:boolean};limit:number}
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
export interface ReviewView { positions:Record<string,{x:number;y:number}>; viewport:{x:number;y:number;zoom:number}; expanded:string[]; selected?:string; panel?:import('./panel-layout').InfoPanel; toolsOpen?:boolean }
export interface ReviewRecord { status:'running'|'done'|'paused'|'error'; stage:string; completedChunks:number; totalChunks:number; sourceVersion:string; model:string; chunks:ConceptGraph[]; mergeLevels?:ConceptGraph[][]; completedMerges?:number; totalMerges?:number; phase?:'extract'|'merge'|'finalize'|'done'; validationFailure?:{stage:string;error:string;attempts:number;at:string;output?:string}; request?:{state:'queued'|'running'|'receiving';queuedAt:string;startedAt?:string;lastResponseAt?:string}; error?:string; graph?:ConceptGraph & {generationId:string;sourceVersion:string;createdAt:string;model:string}; view?:ReviewView }
export interface LibraryGroup {id:string;name:string}
export interface BookSummary {groupId?:string; id: string; name: string; count: number; currentPage: number; completed: number; createdAt: string; generationPaused:boolean; generationState:GenerationState; pauseReason?:string }
export interface ModelOption { id: string; name: string; isDefault: boolean }
export interface AuthState { connected: boolean; label: string; error?: string; models: ModelOption[] }
export interface UpdateState { status:'unsupported'|'idle'|'checking'|'current'|'available'|'downloading'|'ready'|'installing'|'error'; version?:string; percent?:number; error?:string }
export interface AppState extends StudySettings { books: BookSummary[]; groups:LibraryGroup[]; active?: Book; auth: AuthState; activity: string; version:string; runtime:RuntimeStatus; update:UpdateState }
export interface StudyAPI {
  createGroup(name:string):Promise<string>;
  renameGroup(id:string,name:string):Promise<void>;
  deleteGroup(id:string):Promise<void>;
  moveBooks(ids:string[],groupId:string|null):Promise<void>;
  state(id?: string): Promise<AppState>;
  diagnostics(id?:string):Promise<GenerationDiagnostics>;
  exportDiagnostics(id?:string):Promise<string>;
  probeState():Promise<ProbeState>;
  startProbe(mode:ProbeMode,id?:string,page?:number):Promise<void>;
  cancelProbe():Promise<void>;
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
