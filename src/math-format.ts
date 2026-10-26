/** Repair delimiters only; never invent formula symbols or alter stored responses. */
export function normalizeMath(text:string):string{
  const code:string[]=[];
  // Protect fenced code (including unfinished streamed fences) and inline code.
  const mask=(part:string)=>`\uE000${code.push(part)-1}\uE001`;
  const lines=text.split('\n');let value='';
  for(let i=0;i<lines.length;i++){
    const fence=lines[i].match(/^[ \t]*(`{3,}|~{3,})/);
    if(!fence){value+=lines[i]+(i<lines.length-1?'\n':'');continue;}
    const start=i,closing=new RegExp('^[ \\t]*'+fence[1][0]+'{'+fence[1].length+',}[ \\t]*$');
    while(++i<lines.length&&!closing.test(lines[i])){}
    value+=mask(lines.slice(start,Math.min(i+1,lines.length)).join('\n'))+(i<lines.length-1?'\n':'');
  }
  value=value.replace(/(`+)(?!`)([\s\S]*?)\1(?!`)/g,mask);
  value=value.replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g,(_m,body)=>`$$${body}$$`)
    .replace(/(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g,(_m,body)=>`$${body}$`);
  value=value.replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g,(match,body:string,offset:number,source:string)=>{
    const before=source.slice(source.lastIndexOf('\n',offset-1)+1,offset);
    // Markdown tables cannot contain flow blocks; keep their formulas inline.
    if(!body.includes('\n')&&before.includes('|'))return `$${body.trim()}$`;
    const prefix=before.match(/^([ \t]*)(?:(?:[-+*]|\d+[.)])\s+)?/)?.[0]||'';
    const indent=' '.repeat(prefix.replace(/\t/g,'    ').length);
    if(!body.trim())return match;
    const lines=body.trim().split('\n');
    const common=Math.min(...lines.filter(line=>line.trim()).map(line=>line.match(/^ */)![0].length));
    const formula=lines.map(line=>indent+line.slice(common)).join('\n');
    return `\n\n${indent}$$\n${formula}\n${indent}$$\n\n${indent}`;
  });
  // A recognizable, standalone TeX equation with only its closing delimiter.
  value=value.replace(/^([ \t]*)([^\n$]+)\$\$[ \t]*$/gm,(match,indent:string,body:string)=>
    /\\[A-Za-z]+/.test(body)&&/[=<>^_]/.test(body)&&!/[\u3400-\u9fff]/.test(body)?`${indent}$$\n${indent}${body.trim()}\n${indent}$$`:match);
  return value.replace(/\uE000(\d+)\uE001/g,(match,id)=>code[Number(id)]??match);
}
