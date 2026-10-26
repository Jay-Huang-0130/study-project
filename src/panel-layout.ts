export interface InfoPanel {x:number;y:number;width:number;height:number;fontSize:number;open:boolean}
export function clampPanel(panel:InfoPanel,bounds:{width:number;height:number}):InfoPanel{
  const width=Math.min(Math.max(280,panel.width),Math.max(280,bounds.width-24)),height=Math.min(Math.max(160,panel.height),Math.max(160,bounds.height-24));
  return {...panel,width,height,x:Math.max(12,Math.min(panel.x,bounds.width-width-12)),y:Math.max(12,Math.min(panel.y,bounds.height-(panel.open?height:48)-12)),fontSize:Math.max(12,Math.min(26,Math.round(panel.fontSize)))};
}
