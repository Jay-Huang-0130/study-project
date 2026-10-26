/** One page per deliberate gesture; long pages keep their native scroll first. */
export class PDFWheelPager{
  private last=0;private total=0;private direction=0;private latched=false;private scrolling=false;private until=0;
  handle({now,delta,top,height,viewport,page,count}:{now:number;delta:number;top:number;height:number;viewport:number;page:number;count:number}):'scroll'|'hold'|'next'|'previous'{
    if(!Number.isFinite(delta)||!delta)return 'scroll';
    const idle=now-this.last>200,sign=Math.sign(delta);this.last=now;
    if(idle||sign!==this.direction){this.total=0;this.latched=false;}this.direction=sign;
    if(now<this.until||this.latched)return 'hold';
    const canScroll=sign>0?top+viewport<height-2:top>2;
    if(canScroll){this.total=0;this.scrolling=true;return 'scroll';}
    // A gesture that just scrolled to the edge must finish before it turns a page.
    if(this.scrolling&&!idle)return 'hold';this.scrolling=false;
    if((sign>0&&page>=count)||(sign<0&&page<=1)){this.total=0;return 'hold';}
    this.total+=Math.abs(delta);if(this.total<70)return 'hold';
    this.latched=true;this.until=now+400;this.total=0;return sign>0?'next':'previous';
  }
}
