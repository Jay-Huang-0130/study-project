export interface PanelRect {x:number;y:number;width:number;height:number}
export interface InfoPanel extends PanelRect {fontSize:number;open:boolean;maximized?:boolean;normalBounds?:PanelRect}
export type ResizeDirection='n'|'s'|'e'|'w'|'ne'|'nw'|'se'|'sw';
export interface PanelBounds {width:number;height:number}
const rect=(p:PanelRect):PanelRect=>({x:p.x,y:p.y,width:p.width,height:p.height});
export function clampPanel(panel:InfoPanel,bounds:{width:number;height:number}):InfoPanel{
  const width=Math.min(Math.max(280,panel.width),Math.max(280,bounds.width-24)),height=Math.min(Math.max(160,panel.height),Math.max(160,bounds.height-24));
  return {...panel,width,height,x:Math.max(12,Math.min(panel.x,bounds.width-width-12)),y:Math.max(12,Math.min(panel.y,bounds.height-(panel.open?height:48)-12)),fontSize:Math.max(12,Math.min(26,Math.round(panel.fontSize)))};
}

export function defaultPanel(bounds:PanelBounds,fontSize=16):InfoPanel{
  return clampPanel({x:bounds.width-540,y:72,width:520,height:560,fontSize,open:true,maximized:false},bounds);
}
export function fitPanel(panel:InfoPanel,bounds:PanelBounds):InfoPanel{
  // 0.9.0 saved the full rectangle but lost the in-memory restore reference.
  const legacyFull=panel.maximized===undefined&&Math.abs(panel.x-12)<3&&Math.abs(panel.y-12)<3&&panel.width>=bounds.width-27&&panel.height>=bounds.height-27;
  const maximized=panel.maximized??legacyFull;
  return clampPanel({...panel,...(maximized?{x:12,y:12,width:bounds.width-24,height:bounds.height-24}:{}),maximized,normalBounds:panel.normalBounds??rect(maximized?defaultPanel(bounds,panel.fontSize):panel)},bounds);
}
export function restorePanel(panel:InfoPanel,bounds:PanelBounds):InfoPanel{
  const normal=panel.normalBounds??defaultPanel(bounds,panel.fontSize);
  return clampPanel({...panel,...normal,maximized:false,open:true},bounds);
}
export function togglePanelMaximized(panel:InfoPanel,bounds:PanelBounds):InfoPanel{
  const current=fitPanel(panel,bounds);
  if(current.maximized)return restorePanel(current,bounds);
  return fitPanel({...current,maximized:true,open:true,normalBounds:rect(current)},bounds);
}
export function movePanel(panel:InfoPanel,x:number,y:number,bounds:PanelBounds):InfoPanel{
  const next=clampPanel({...panel,x,y,maximized:false},bounds);return {...next,normalBounds:rect(next)};
}
export function resizePanel(panel:InfoPanel,direction:ResizeDirection,dx:number,dy:number,bounds:PanelBounds):InfoPanel{
  const current=clampPanel(panel,bounds),minWidth=Math.min(280,bounds.width-24),minHeight=Math.min(160,bounds.height-24);
  let left=current.x,top=current.y,right=left+current.width,bottom=top+current.height;
  if(direction.includes('e'))right=Math.max(left+minWidth,Math.min(bounds.width-12,right+dx));
  if(direction.includes('w'))left=Math.min(right-minWidth,Math.max(12,left+dx));
  if(direction.includes('s'))bottom=Math.max(top+minHeight,Math.min(bounds.height-12,bottom+dy));
  if(direction.includes('n'))top=Math.min(bottom-minHeight,Math.max(12,top+dy));
  const next=clampPanel({...current,x:left,y:top,width:right-left,height:bottom-top,maximized:false},bounds);
  return {...next,normalBounds:rect(next)};
}
