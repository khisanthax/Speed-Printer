import type { Bundle, Summary } from './domain';
export class Helper {
  token='';
  async call<T>(path: string, data?: unknown): Promise<T> {
    const r=await fetch(`http://127.0.0.1:8377${path}`,{method:data===undefined?'GET':'POST',headers:{Authorization:`Bearer ${this.token}`,...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)});
    const result=await r.json(); if(!r.ok) throw new Error(result.error||`Helper returned ${r.status}`); return result as T;
  }
  slice(bundle: Bundle, model: string) { return this.call<{id:string}>('/slice',{bundle,model}); }
  job(id:string) {return this.call<{state:string;result?:Summary;error?:string}>(`/jobs/${id}`);}
}
