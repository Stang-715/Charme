/** Production component capture rig. Fictional state; never reads personal data. */
import React, {useEffect,useRef} from 'react';
import * as T from 'three';
import {CharmScene} from '../src/renderer/Scene';
import {createRoot} from 'react-dom/client';
import {SceneWidget} from '../src/renderer/SceneWidget';
import {initialState,localDate} from '../src/shared/model';
import {emptySlot} from '../src/shared/library';
import '../src/renderer/style.css';
const q=new URLSearchParams(location.search), state=initialState();
state.onboarded=true;state.settings.scale='large';state.settings.reducedMotion=true;
state.timer.intent=q.get('paused')!=='1';state.timer.remainingMs=27*60000+18*1000;
const ml=Number(q.get('ml')||0);if(ml)state.drinks=[{id:'demo-drink',ml:ml as 350,at:new Date().toISOString(),date:localDate(new Date()),timezone:'UTC'}];
if(q.get('car'))state.settings.charms!.slots.companion=emptySlot('car');
if(q.get('tag')){state.settings.charms!.slots.companion={...emptySlot('tag'),name:'MIRA',nameStyle:q.get('tag') as 'metal'|'neon',nameColor:'#46ffb0'};}
const s={state,blockers:[],error:null,recovered:false,undoTimerUntil:null};
function Solo(){const ref=useRef<HTMLDivElement>(null);useEffect(()=>{const sc=new CharmScene(ref.current!,{appearance:state.settings.appearance!,settings:state.settings,fill:ml/1750,glow:false,reduced:true,editing:false,onPosition:()=>{},onStatus:()=>{}});const timer=setInterval(()=>{const target=sc.objects.get(q.get('solo') as any);if(!(sc as any).ready||!target)return;clearInterval(timer);for(const child of sc.scene.children)if(child instanceof T.Group)child.visible=child===target;const box=new T.Box3().setFromObject(target),c=box.getCenter(new T.Vector3()),size=box.getSize(new T.Vector3());const h=Math.max(size.y,size.x/0.8)*1.25;sc.camera.left=-h*.4;sc.camera.right=h*.4;sc.camera.top=h*.5;sc.camera.bottom=-h*.5;sc.camera.position.set(c.x,c.y,3);sc.camera.lookAt(c.x,c.y,0);sc.camera.updateProjectionMatrix();sc.renderer.render(sc.scene,sc.camera);document.body.dataset.ready='true';},100);return()=>{clearInterval(timer);sc.dispose();}},[]);return <div ref={ref} style={{width:600,height:750}}/>}
createRoot(document.getElementById('root')!).render(q.get('solo')?<Solo/>:<SceneWidget snapshot={s} send={async()=>s}/>);
const style=document.createElement('style');style.textContent='html,body{margin:0;background:transparent!important} .scene-widget{zoom:2}';document.head.append(style);
