import { contextBridge, ipcRenderer } from 'electron';
import type { StudyAPI } from '../src/shared';
const api: StudyAPI = {
  state: id => ipcRenderer.invoke('study:state',id),
  importPDF: () => ipcRenderer.invoke('study:import'),
  navigate: (id,n) => ipcRenderer.invoke('study:navigate',id,n),
  login: () => ipcRenderer.invoke('study:login'),
  refreshAuth: () => ipcRenderer.invoke('study:refreshAuth'),
  logout: () => ipcRenderer.invoke('study:logout'),
  settings: value => ipcRenderer.invoke('study:settings',value),
  retry: (id,n) => ipcRenderer.invoke('study:retry',id,n),
  ask: (id,n,q,kind) => ipcRenderer.invoke('study:ask',id,n,q,kind),
  deleteMessage:(id,n,messageId)=>ipcRenderer.invoke('study:deleteMessage',id,n,messageId),
  deleteBook:id=>ipcRenderer.invoke('study:deleteBook',id),
  exercise: (id,start,end,count) => ipcRenderer.invoke('study:exercise',id,start,end,count),
  fullscreen: () => ipcRenderer.invoke('study:fullscreen'),
  dataFolder: () => ipcRenderer.invoke('study:dataFolder'),
  onChange: callback => { const handler = () => callback(); ipcRenderer.on('study:change',handler); return () => ipcRenderer.removeListener('study:change',handler); },
  onDelta: callback => { const handler = (_: unknown, value: Parameters<Parameters<StudyAPI['onDelta']>[0]>[0]) => callback(value); ipcRenderer.on('study:delta',handler); return () => ipcRenderer.removeListener('study:delta',handler); },
};
contextBridge.exposeInMainWorld('study',api);
