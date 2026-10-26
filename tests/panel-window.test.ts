import test from 'node:test';
import assert from 'node:assert/strict';
import {fitPanel,togglePanelMaximized,resizePanel,movePanel,defaultPanel,type InfoPanel,type ResizeDirection} from '../src/panel-layout';
const bounds={width:1400,height:850};
const original:InfoPanel={x:600,y:100,width:520,height:560,fontSize:16,open:true};
test('maximized window survives JSON reload and restores original bounds without reverting text changes',()=>{
 const full=togglePanelMaximized(original,bounds);assert.equal(full.maximized,true);assert.equal(full.width,1376);
 const reopened=fitPanel(JSON.parse(JSON.stringify({...full,fontSize:20})),bounds);
 const restored=togglePanelMaximized(reopened,bounds);assert.equal(restored.maximized,false);
 for(const key of ['x','y','width','height'] as const)assert.equal(restored[key],original[key]);assert.equal(restored.fontSize,20);
 const again=togglePanelMaximized(restored,bounds);assert.deepEqual(again.normalBounds,full.normalBounds);
});
test('legacy 0.9.0 full rectangle has a usable restore target, including collapsed reload',()=>{
 const old={x:12,y:12,width:1376,height:826,fontSize:18,open:true};
 for(const open of [true,false]){const migrated=fitPanel({...old,open},bounds);assert.equal(migrated.maximized,true);assert.equal(migrated.open,open);const restored=togglePanelMaximized(migrated,bounds);assert.ok(restored.width<bounds.width*.7);assert.equal(restored.fontSize,18);assert.equal(restored.open,true);}
 assert.ok(defaultPanel(bounds).width<bounds.width*.7);
});
test('maximized window follows canvas resize while preserving its normal rectangle',()=>{
 const full=togglePanelMaximized(original,bounds),small={width:800,height:600};
 const fitted=fitPanel(full,small);assert.equal(fitted.width,776);assert.equal(fitted.height,576);assert.deepEqual(fitted.normalBounds,full.normalBounds);
 const expanded=fitPanel(fitted,bounds),restored=togglePanelMaximized(expanded,bounds);assert.equal(restored.x,600);assert.equal(restored.width,520);
});
test('all eight resize directions preserve opposite edges, enforce bounds, and leave maximized mode',()=>{
 const dirs:ResizeDirection[]=['n','s','e','w','ne','nw','se','sw'];
 for(const dir of dirs){const next=resizePanel(original,dir,30,20,bounds);assert.equal(next.maximized,false);
  assert.equal(next.width,original.width+(dir.includes('e')?30:dir.includes('w')?-30:0));
  assert.equal(next.height,original.height+(dir.includes('s')?20:dir.includes('n')?-20:0));
  if(dir.includes('w'))assert.equal(next.x+next.width,original.x+original.width);
  if(dir.includes('n'))assert.equal(next.y+next.height,original.y+original.height);
 }
 const min=resizePanel(original,'nw',5000,5000,bounds);assert.equal(min.width,280);assert.equal(min.height,160);
 const large=resizePanel(original,'se',5000,5000,bounds);assert.equal(large.x+large.width,1388);assert.equal(large.y+large.height,838);
 const full=togglePanelMaximized(original,bounds),shrunk=resizePanel(full,'se',-400,-250,bounds);assert.equal(shrunk.maximized,false);assert.equal(shrunk.width,976);
 const moved=movePanel(shrunk,-999,-999,bounds);assert.equal(moved.x,12);assert.equal(moved.y,12);assert.equal(moved.normalBounds?.width,976);
});
