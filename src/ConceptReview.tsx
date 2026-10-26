import {useCallback,useEffect,useMemo,useRef,useState,type ReactNode} from 'react';
import {ReactFlow,Background,Controls,MiniMap,Position,MarkerType,applyNodeChanges,type Node,type Edge,type ReactFlowInstance,type Viewport} from '@xyflow/react';
import dagre from '@dagrejs/dagre';
import {BookOpen,Search,Network,Pause,ArrowLeft,Maximize2} from 'lucide-react';
import type {Book,ConceptGraph,ConceptKind,ReviewSource,ReviewView} from './shared';
import {reviewReady,reviewProgress} from './review-data';
import {Markdown} from './Markdown';
import '@xyflow/react/dist/style.css';
import './review.css';

type FlowNode=Node<{label:ReactNode}>;
const names:Record<ConceptKind,string>={topic:'主題',term:'術語',concept:'觀念',formula:'公式',method:'方法／用法'};
const colors:Record<ConceptKind,string>={topic:'#507a69',term:'#6c8bba',concept:'#8d9e69',formula:'#b58b58',method:'#9980ac'};
export function ConceptReview({book,connected,onSource,onError}:{book:Book;connected:boolean;onSource:(page:number)=>void;onError:(message:string)=>void}){
  const r=book.review,graph=r?.graph,ready=reviewReady(book),busy=r?.status==='running';
  const [confirm,setConfirm]=useState(false),[now,setNow]=useState(Date.now());
  useEffect(()=>{if(!busy)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[busy]);
  const progress=r?reviewProgress(r):undefined,phase=r?.phase??(r&&r.completedChunks>=r.totalChunks?'merge':'extract');
  const request=busy?r?.request:undefined,elapsed=request?Math.max(0,Math.floor((now-Date.parse(request.queuedAt))/1000)):0;
  const silence=request?.lastResponseAt?Math.max(0,Math.floor((now-Date.parse(request.lastResponseAt))/1000)):undefined;
  const duration=(seconds:number)=>`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`;
  const response=request?(request.state==='queued'?'等待 AI 容量':request.state==='receiving'?'正在接收模型內容':'模型正在處理'):'';
  const run=async(fn:()=>Promise<void>)=>{try{await fn();}catch(e){onError(e instanceof Error?e.message:String(e));}};
  return <section className="review-workspace" aria-label="概念複習工作區">
    <div className="review-heading"><div><span className="eyebrow">CONNECT WHAT YOU LEARNED</span><h2>概念複習地圖</h2><p>{graph?`${graph.nodes.length} 個概念 · ${graph.edges.filter(e=>e.relation!=='contains').length} 條知識關聯 · 已保存在本機`:'把整份教材的術語、公式與用法連在一起。'}</p></div><div className="review-generation-actions">{busy?<button className="secondary-button" onClick={()=>void run(()=>window.study.cancelReview(book.id))}><Pause size={15}/>暫停整理</button>:<button className={graph?'secondary-button':'primary-button'} disabled={!ready||!connected} onClick={()=>{if(graph&&r?.status==='done')setConfirm(true);else void run(()=>window.study.generateReview(book.id));}}><Network size={16}/>{graph&&r?.status==='done'?'重新產生概念圖':r?.chunks.length?'繼續生成概念圖':'產生概念圖'}</button>}</div></div>
    {!ready&&<div className="review-notice">先完成整份教材再整理：講稿 {book.pages.filter(p=>p.status==='done').length}/{book.count} 頁 · 原頁圖像 {book.pages.filter(p=>p.imageReady).length}/{book.count} 頁 · 全書脈絡 {book.mapStatus==='done'&&book.map?.complete!==false?'已完成':'尚未完成'}。未完成問答也需先結束。</div>}
    {!connected&&!busy&&<div className="review-notice">離線仍可看已保存的地圖；生成時請先到設定登入 ChatGPT。</div>}
    {book.reviewStale&&<div className="review-notice">講稿或全書脈絡已更新，目前顯示上次保存的地圖。完成教材後可手動重新產生。</div>}
    {r&&r.status!=='done'&&<div className="review-generation-status" role="status"><div className="review-progress"><strong>{busy?r.stage:`已暫停 · ${r.validationFailure?.stage??r.stage}`}</strong><span>整體 {progress!.completed}/{progress!.total} 步</span><progress aria-label="概念圖整體進度" max={progress!.total} value={progress!.completed}/></div><div className="review-step-detail"><span>原頁核對 {r.completedChunks}/{r.totalChunks} 批 · 合併與整合 {progress!.completedMerges}/{progress!.merges} 步</span>{request&&<span>{response} · 此步已等待 {duration(elapsed)}{silence!==undefined&&` · 最近回應 ${duration(silence)}前`}</span>}</div>{request&&elapsed>=120&&<p className="review-slow-hint">這一步較久；可繼續等待，或暫停後手動續作。已完成的核對與合併結果會保留。步數進度不代表剩餘時間。</p>}</div>}
    {!busy&&r&&r.status!=='done'&&<div className="review-notice" role="status">{r.error||r.stage}。已完成的原頁核對與合併結果會保留，按繼續才會再處理。</div>}
    {confirm&&<div className="review-confirm" role="alertdialog" aria-label="確認重新產生概念圖"><span>會重新核對全書並使用模型額度，舊地圖保留到新版本成功。</span><button className="secondary-button" onClick={()=>setConfirm(false)}>取消</button><button className="primary-button" onClick={()=>{setConfirm(false);void run(()=>window.study.generateReview(book.id,true));}}>確認重新產生</button></div>}
    {graph?<ReviewCanvas key={graph.generationId} graph={graph} saved={r?.view} persist={view=>void run(()=>window.study.saveReviewView(book.id,view))} onSource={onSource}/>:<div className="review-empty"><Network size={46}/><h3>{busy?(phase==='extract'?'正在核對原頁概念':phase==='finalize'?'正在整合全書地圖':'正在合併概念與關係'):'從概念看見整份教材'}</h3><p>{busy?(phase==='extract'?'先從原頁擷取術語、公式與來源依據。':phase==='finalize'?'原頁與分層合併已完成，正在整理整份教材的主題與關聯。':'原頁已核對完成；接著去除重複概念、整合跨頁關係，完成後顯示全書地圖。'):'進入這個頁面不會開始生成。按下生成後，會分批對照原頁、合併重複術語，再整理跨主題關係。'}</p><div className="review-feature-list"><span>英文縮寫與全名</span><span>公式、參數與條件</span><span>概念關係與來源頁碼</span></div></div>}
  </section>;
}

function ReviewCanvas({graph:inputGraph,saved,persist,onSource}:{graph:ConceptGraph & {generationId:string};saved?:ReviewView;persist:(view:ReviewView)=>void;onSource:(page:number)=>void}){
  const graph=useMemo(()=>inputGraph,[inputGraph.generationId]);
  const [selected,setSelected]=useState(saved?.selected||graph.rootId),[selectedEdge,setSelectedEdge]=useState<string>();
  const [expanded,setExpanded]=useState(()=>new Set(saved?.expanded||[graph.rootId]));
  const [query,setQuery]=useState(''),[kind,setKind]=useState('all'),[focused,setFocused]=useState(false);
  const [positions,setPositions]=useState(saved?.positions||{}),[nodes,setNodes]=useState<FlowNode[]>([]);
  const details=useRef<HTMLElement>(null);
  useEffect(()=>{details.current?.scrollTo({top:0});},[selected,selectedEdge]);
  const flow=useRef<ReactFlowInstance<FlowNode,Edge>|null>(null),viewport=useRef<Viewport>(saved?.viewport||{x:0,y:0,zoom:1});
  const parents=useMemo(()=>new Map(graph.edges.filter(e=>e.relation==='contains').map(e=>[e.target,e.source])),[graph]);
  const save=(patch:Partial<ReviewView>={})=>persist({positions,viewport:viewport.current,expanded:[...expanded],selected,...patch});
  const toggle=useCallback((id:string)=>setExpanded(previous=>{const next=new Set(previous);next.has(id)?next.delete(id):next.add(id);next.add(graph.rootId);return next;}),[graph.rootId]);
  const visible=useMemo(()=>{
    const allowed=new Set(graph.nodes.filter(n=>kind==='all'||n.kind===kind||n.kind==='topic').map(n=>n.id));
    return graph.nodes.filter(n=>{
      if(!allowed.has(n.id))return false;
      let id=n.id;while(parents.has(id)){id=parents.get(id)!;if(!expanded.has(id))return false;}return true;
    });
  },[graph,parents,expanded,kind]);
  const neighbors=useMemo(()=>new Set([selected,...graph.edges.filter(e=>e.source===selected||e.target===selected).flatMap(e=>[e.source,e.target])]),[graph,selected]);
  const layout=useMemo(()=>{
    const layout=new dagre.graphlib.Graph();layout.setDefaultEdgeLabel(()=>({}));layout.setGraph({rankdir:'LR',nodesep:38,ranksep:95,marginx:32,marginy:32});
    const ids=new Set(visible.map(n=>n.id));for(const n of visible)layout.setNode(n.id,{width:248,height:124});
    for(const e of graph.edges)if(e.relation==='contains'&&ids.has(e.source)&&ids.has(e.target))layout.setEdge(e.source,e.target);
    dagre.layout(layout);return new Map(visible.map(n=>{const p=layout.node(n.id);return[n.id,{x:p.x-124,y:p.y-62}];}));
  },[graph,visible]);
  useEffect(()=>{
    setNodes(visible.map(n=>({id:n.id,position:positions[n.id]||layout.get(n.id)!,sourcePosition:Position.Right,targetPosition:Position.Left,selected:n.id===selected,className:`concept-node concept-${n.kind}`,style:{width:248,opacity:focused&&!neighbors.has(n.id)?.18:1,borderColor:colors[n.kind]},data:{label:<div><div className="concept-node-top"><span style={{color:colors[n.kind]}}>{names[n.kind]}</span>{n.kind==='topic'&&n.id!==graph.rootId&&<button className="nodrag nopan" aria-label={`${expanded.has(n.id)?'收合':'展開'}主題 ${n.label}`} onClick={e=>{e.stopPropagation();toggle(n.id);}}>{expanded.has(n.id)?'−':'＋'}</button>}</div><strong>{n.label}</strong>{n.fullName&&<span className="concept-full-name">{n.fullName}</span>}<small>{n.summary}</small></div>}})));
  },[visible,positions,layout,selected,focused,neighbors,expanded,toggle]);
  useEffect(()=>{if(flow.current)save({expanded:[...expanded]});},[expanded]);
  const edges=useMemo(()=>{
    const ids=new Set(visible.map(n=>n.id));return graph.edges.filter(e=>ids.has(e.source)&&ids.has(e.target)).map(e=>({id:e.id,source:e.source,target:e.target,label:e.label,type:e.relation==='contains'?'smoothstep':'default',animated:false,markerEnd:{type:MarkerType.ArrowClosed},style:{stroke:e.relation==='contains'?'#c0cbbb':'#7d98ab',strokeWidth:e.id===selectedEdge?3:1.4,opacity:focused&&e.source!==selected&&e.target!==selected?.1:e.relation==='contains'?.65:1},labelStyle:{fontSize:11,fill:'#586c60'},labelBgStyle:{fill:'#fafcf8',fillOpacity:.94}}));
  },[graph,visible,focused,selected,selectedEdge]);
  const matches=useMemo(()=>query.trim()?graph.nodes.filter(n=>`${n.label} ${n.fullName} ${n.summary} ${n.formula}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):[],[graph,query]);
  const reveal=(id:string)=>{
    const next=new Set(expanded);let ancestor=id;while(parents.has(ancestor)){ancestor=parents.get(ancestor)!;next.add(ancestor);}setExpanded(next);setKind('all');setSelected(id);setSelectedEdge(undefined);setQuery('');save({expanded:[...next],selected:id});
    setTimeout(()=>void flow.current?.fitView({nodes:[{id}],duration:250,minZoom:.8,maxZoom:1.1}),80);
  };
  const current=graph.nodes.find(n=>n.id===selected)||graph.nodes[0],edge=graph.edges.find(e=>e.id===selectedEdge);
  const connections=graph.edges.filter(e=>e.relation!=='contains'&&(e.source===current.id||e.target===current.id));
  const sources=(items:ReviewSource[])=>items.map((s,i)=><div className="review-source" key={`${s.page}-${i}`}><button onClick={()=>{save();onSource(s.page);}}><BookOpen size={13}/>查看第 {s.page} 頁</button><small>{s.kind==='text'?'原文引用':'圖像依據'}：{s.quote}</small></div>);
  return <div className="review-canvas-layout">
    <div className="review-canvas-main"><div className="review-tools"><div className="review-search"><Search size={16}/><input aria-label="搜尋複習概念" placeholder="搜尋縮寫、全名、中文或公式" value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&matches[0])reveal(matches[0].id);}}/>{query&&<div className="review-search-results">{matches.length?matches.slice(0,10).map(n=><button key={n.id} onClick={()=>reveal(n.id)}><strong>{n.label}</strong><span>{n.fullName}</span></button>):<p>找不到相符概念</p>}</div>}</div><select aria-label="概念類型" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">所有類型</option>{Object.entries(names).filter(([k])=>k!=='topic').map(([k,v])=><option key={k} value={k}>{v}</option>)}</select><button onClick={()=>{setExpanded(new Set(graph.nodes.filter(n=>n.kind==='topic').map(n=>n.id)));setTimeout(()=>void flow.current?.fitView({duration:250,padding:.15}),80);}}>展開全部</button><button onClick={()=>{setExpanded(new Set([graph.rootId]));setTimeout(()=>void flow.current?.fitView({duration:250,padding:.15}),80);}}>收合主題</button><button title="重設排版與視角" aria-label="重設概念圖" onClick={()=>{setPositions({});save({positions:{}});setTimeout(()=>void flow.current?.fitView({duration:250,padding:.15}),80);}}><Maximize2 size={15}/></button></div>
      <div className="review-flow"><ReactFlow<FlowNode,Edge> nodes={nodes} edges={edges} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null} minZoom={.08} maxZoom={2.5} onInit={instance=>{flow.current=instance;if(saved)void instance.setViewport(saved.viewport);else void instance.fitView({padding:.15,maxZoom:1});}} onNodesChange={changes=>setNodes(previous=>applyNodeChanges(changes,previous))} onNodeDragStop={(_,node)=>{const next={...positions,[node.id]:node.position};setPositions(next);save({positions:next});}} onMoveEnd={(_,value)=>{viewport.current=value;save({viewport:value});}} onNodeClick={(_,node)=>{setSelected(node.id);setSelectedEdge(undefined);save({selected:node.id});}} onEdgeClick={(_,edge)=>setSelectedEdge(edge.id)} fitView={!saved} defaultViewport={saved?.viewport} aria-label="互動概念地圖"><Background gap={24} color="#dce4d8"/><MiniMap pannable zoomable nodeColor={n=>colors[graph.nodes.find(x=>x.id===n.id)?.kind||'concept']} position="bottom-right"/><Controls showInteractive={false}/></ReactFlow></div>
      <div className="review-canvas-hint">拖曳空白處平移 · 滾輪縮放 · 拖動節點調整位置 · 點連線查看關係依據</div></div>
    <aside ref={details} className="review-details" aria-label="概念詳情"><span className="eyebrow">{edge?'RELATIONSHIP':'CONCEPT NOTES'}</span>{edge?<><button className="text-button" onClick={()=>setSelectedEdge(undefined)}><ArrowLeft size={14}/>回到概念</button><h3>{edge.label}</h3><p>{graph.nodes.find(n=>n.id===edge.source)?.label} → {graph.nodes.find(n=>n.id===edge.target)?.label}</p><Markdown text={edge.detail} navigate={onSource}/><h4>關係來源</h4>{sources(edge.sources)}</>:<><span className="review-kind" style={{color:colors[current.kind]}}>{names[current.kind]}</span><h3>{current.label}</h3>{current.fullName&&<p className="review-full-name">{current.fullName}</p>}<Markdown text={current.summary+'\n\n'+current.detail} navigate={onSource}/>{current.formula&&<div className="review-formula"><Markdown text={'$$\n'+current.formula+'\n$$'} navigate={onSource}/></div>}{!!current.symbols.length&&<><h4>符號與單位</h4><dl>{current.symbols.map((s,i)=><div key={i}><dt><Markdown text={'$'+s.symbol+'$'} navigate={onSource}/></dt><dd>{s.meaning}{s.unit&&<small>單位：{s.unit}</small>}</dd></div>)}</dl></>}{!!current.conditions.length&&<><h4>使用條件</h4><ul>{current.conditions.map((s,i)=><li key={i}>{s}</li>)}</ul></>}<button className={`review-focus ${focused?'active':''}`} onClick={()=>setFocused(v=>!v)}>{focused?'顯示所有關係':'聚焦這個概念的關係'}</button>{!!connections.length&&<><h4>相關概念</h4>{connections.map(e=>{const target=e.source===current.id?e.target:e.source;return <button className="review-related" key={e.id} onClick={()=>reveal(target)}><span>{e.label}</span><strong>{graph.nodes.find(n=>n.id===target)?.label}</strong></button>;})}</>}<h4>教材依據</h4>{sources(current.sources)}</>}<p className="review-accuracy-note">濃縮整理仍可能有誤；公式與重要關係請點原頁核對。</p></aside>
  </div>;
}
