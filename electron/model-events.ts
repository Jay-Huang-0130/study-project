import type {ModelEvent} from '../src/shared';
const codes=new Set(['contextWindowExceeded','sessionBudgetExceeded','usageLimitExceeded','rateLimitExceeded','flexUnavailable','serverOverloaded','internalServerError','unauthorized','badRequest','sandboxError','other','httpConnectionFailed','responseStreamConnectionFailed','responseStreamDisconnected','responseTooManyFailedAttempts']);
/** Explicit allowlist: never export messages, URLs, arbitrary codes or additionalDetails. */
export function safeError(error:any):Pick<ModelEvent,'code'|'httpStatus'>{
 const info=error?.codexErrorInfo??error?.data?.codexErrorInfo;
 const key=typeof info==='string'?info:info&&typeof info==='object'?Object.keys(info).find(k=>codes.has(k)):undefined;
 const code=key&&codes.has(key)?key:error?.code===-32001?'serverOverloaded':undefined;
 const status=key&&typeof info==='object'?info[key]?.httpStatusCode:undefined;
 return {...(code?{code}:{}),...(Number.isInteger(status)&&status>=100&&status<=599?{httpStatus:status}:{})};
}
export function modelError(raw:any):Error{
 return Object.assign(new Error(typeof raw?.message==='string'?raw.message:'模型請求失敗，請重試。'),{diagnostic:safeError(raw)});
}
