// The embedded app browser may disable DOM fullscreen. Relay only this one
// explicit window action to the existing native loopback application.
export class NativeWindowBridge {
 constructor({fetcher=fetch,base=process.env.FOCUS_NATIVE_ORIGIN||'http://127.0.0.1:8765'}={}){this.fetcher=fetcher;this.base=base;this.pending=null}
 async metrics(){
  const home=await this.fetcher(this.base+'/',{signal:AbortSignal.timeout(2000),redirect:'error'});const html=await home.text();
  const token=html.match(/name="dashboard-token" content="([a-f0-9]{64})"/)?.[1];if(!token)throw Error('unavailable');
  const response=await this.fetcher(this.base+'/api/metrics',{headers:{'X-Dashboard-Token':token},signal:AbortSignal.timeout(2000),redirect:'error'});
  if(!response.ok)throw Error('unavailable');return response.json();
 }
 toggle(){
  if(this.pending)return this.pending;
  this.pending=this.perform().finally(()=>this.pending=null);return this.pending;
 }
 async perform(){
  try{
   const home=await this.fetcher(this.base+'/',{signal:AbortSignal.timeout(2000),redirect:'error'});
   if(!home.ok)throw Error('unavailable');
   const html=await home.text();if(html.length>262144)throw Error('unavailable');
   const token=html.match(/name="dashboard-token" content="([a-f0-9]{64})"/)?.[1];if(!token)throw Error('unavailable');
   const response=await this.fetcher(this.base+'/api/window/fullscreen',{method:'POST',headers:{'X-Dashboard-Token':token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(3000),redirect:'error'});
   await response.body?.cancel();if(!response.ok)throw Error('unavailable');
   return{ok:true,target:'native-window'};
  }catch{throw Error('独立副屏未连接，请先打开副屏应用')}
 }
}
