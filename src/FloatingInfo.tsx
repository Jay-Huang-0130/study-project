import {useEffect,useRef,useState,type CSSProperties,type ReactNode,type PointerEvent} from 'react';
import {ChevronDown,ChevronUp,Maximize2,Minimize2,Grip,RotateCcw} from 'lucide-react';
import {clampPanel,defaultPanel,fitPanel,movePanel,resizePanel,restorePanel,togglePanelMaximized,type InfoPanel,type ResizeDirection} from './panel-layout';

export function FloatingInfo({value,onChange,onCommit,children}:{value:InfoPanel;onChange:(value:InfoPanel)=>void;onCommit:(value:InfoPanel)=>void;children:ReactNode}){
 const element=useRef<HTMLElement>(null),latest=useRef(value),bounds=useRef({width:1200,height:700}),initial=useRef(true),cleanupGesture=useRef<(()=>void)|undefined>(undefined);latest.current=value;
 const callbacks=useRef({onChange,onCommit});callbacks.current={onChange,onCommit};
 const update=(next:InfoPanel,commit=true)=>{const safe=clampPanel(next,bounds.current);latest.current=safe;callbacks.current.onChange(safe);if(commit)callbacks.current.onCommit(safe);};
 useEffect(()=>{
  const parent=element.current?.parentElement;if(!parent)return;
  const resize=()=>{bounds.current={width:parent.clientWidth,height:parent.clientHeight};const start=initial.current&&latest.current.x<0?{...latest.current,x:parent.clientWidth-latest.current.width-20,y:72}:latest.current;initial.current=false;update(fitPanel(start,bounds.current));};
  const observer=new ResizeObserver(resize);observer.observe(parent);resize();
  return()=>{observer.disconnect();cleanupGesture.current?.();};
 },[]);
 const toggleMax=()=>update(togglePanelMaximized(latest.current,bounds.current));
 const gesture=(event:PointerEvent<HTMLElement>,kind:'move'|ResizeDirection)=>{
  if(event.button!==0||(kind==='move'&&(event.target as HTMLElement).closest('button,input,select')))return;
  event.preventDefault();event.stopPropagation();cleanupGesture.current?.();
  const target=event.currentTarget,start={...latest.current},x=event.clientX,y=event.clientY,parent=element.current!.parentElement!.getBoundingClientRect();
  const restored=restorePanel(start,bounds.current),grab=Math.max(0,Math.min(1,(x-parent.left-start.x)/start.width));
  const moveStart=start.maximized?movePanel(restored,x-parent.left-restored.width*grab,y-parent.top-Math.min(42,Math.max(8,y-parent.top-start.y)),bounds.current):start;
  let moved=false;target.setPointerCapture(event.pointerId);
  const move=(e:globalThis.PointerEvent)=>{const dx=e.clientX-x,dy=e.clientY-y;if(!moved&&Math.abs(dx)+Math.abs(dy)<4)return;moved=true;update(kind==='move'?movePanel(moveStart,moveStart.x+dx,moveStart.y+dy,bounds.current):resizePanel(start,kind,dx,dy,bounds.current),false);};
  const cleanup=()=>{target.removeEventListener('pointermove',move);target.removeEventListener('pointerup',stop);target.removeEventListener('pointercancel',stop);target.removeEventListener('lostpointercapture',stop);if(target.hasPointerCapture(event.pointerId))target.releasePointerCapture(event.pointerId);cleanupGesture.current=undefined;};
  const stop=()=>{cleanup();if(moved)callbacks.current.onCommit(latest.current);};
  cleanupGesture.current=cleanup;target.addEventListener('pointermove',move);target.addEventListener('pointerup',stop);target.addEventListener('pointercancel',stop);target.addEventListener('lostpointercapture',stop);
 };
 const directions:ResizeDirection[]=['n','s','e','w','ne','nw','se','sw'];
 const labels:Record<ResizeDirection,string>={n:'上側',s:'下側',e:'右側',w:'左側',ne:'右上角',nw:'左上角',se:'右下角',sw:'左下角'};
 return <section ref={element} className={`floating-info ${value.open?'':'collapsed'} ${value.maximized?'maximized':''}`} aria-label="概念資訊卡" style={{left:value.x<0?undefined:value.x,right:value.x<0?20:undefined,top:value.y,width:value.width,height:value.open?value.height:48,'--reading-font':`${value.fontSize}px`} as CSSProperties}>
  <header className="floating-info-header" title="拖曳移動視窗；雙擊放大或還原" onPointerDown={e=>gesture(e,'move')} onDoubleClick={e=>{if(!(e.target as HTMLElement).closest('button'))toggleMax();}}><Grip size={15}/><strong>概念詳情</strong><div><button aria-label="縮小資訊卡文字" disabled={value.fontSize<=12} onClick={()=>update({...latest.current,fontSize:latest.current.fontSize-1})}>A−</button><button aria-label="放大資訊卡文字" disabled={value.fontSize>=26} onClick={()=>update({...latest.current,fontSize:latest.current.fontSize+1})}>A＋</button><button aria-label="重設資訊卡位置與大小" title="重設位置與大小" onClick={()=>update(defaultPanel(bounds.current,latest.current.fontSize))}><RotateCcw size={14}/></button><button aria-label={value.maximized?'還原資訊卡':'放大資訊卡'} title={value.maximized?'還原視窗大小':'最大化視窗'} onClick={toggleMax}>{value.maximized?<Minimize2 size={14}/>:<Maximize2 size={14}/>}</button><button aria-label={value.open?'收起概念詳情':'展開概念詳情'} title={value.open?'收起視窗':'展開視窗'} onClick={()=>update({...latest.current,open:!latest.current.open})}>{value.open?<ChevronDown size={16}/>:<ChevronUp size={16}/>}</button></div></header>
  {value.open&&<>{children}{directions.map(direction=><button key={direction} className={`info-resize-handle resize-${direction}`} aria-label={direction==='se'?'調整資訊卡大小':`調整資訊卡${labels[direction]}大小`} title={`拖曳${labels[direction]}調整大小`} onPointerDown={e=>gesture(e,direction)} onKeyDown={e=>{if(!e.key.startsWith('Arrow'))return;e.preventDefault();update(resizePanel(latest.current,direction,e.key==='ArrowRight'?24:e.key==='ArrowLeft'?-24:0,e.key==='ArrowDown'?24:e.key==='ArrowUp'?-24:0,bounds.current));}}>{direction==='se'&&<Grip size={15}/>}</button>)}</>}
 </section>;
}

export function FitFormula({children}:{children:ReactNode}){
 const outer=useRef<HTMLDivElement>(null),inner=useRef<HTMLDivElement>(null);const [fit,setFit]=useState(true),[layout,setLayout]=useState({scale:1,height:60});
 useEffect(()=>{const parent=outer.current,content=inner.current;if(!parent||!content)return;const measure=()=>{const scale=fit?Math.min(1,Math.max(1,parent.clientWidth-4)/Math.max(1,content.scrollWidth)):1;setLayout(previous=>previous.scale===scale&&previous.height===Math.ceil(content.offsetHeight*scale)?previous:{scale,height:Math.ceil(content.offsetHeight*scale)});};const observer=new ResizeObserver(measure);observer.observe(parent);observer.observe(content);measure();return()=>observer.disconnect();},[fit,children]);
 return <><button className="formula-fit-toggle" onClick={()=>setFit(v=>!v)}>{fit?'公式原始大小':'公式適合寬度'}</button><div ref={outer} className={`review-formula ${fit?'fit-formula':''}`} style={fit?{height:layout.height+8}:undefined}><div ref={inner} className="formula-natural" style={fit?{transform:`scale(${layout.scale})`,transformOrigin:'left top'}:undefined}>{children}</div></div></>;
}
