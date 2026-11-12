  function fromText(s){
    // The connector wraps rows in <untrusted-data-ID> ... </untrusted-data-ID>, and names the tag once in the sentence before it.
    const close=s.lastIndexOf("</untrusted-data-");
    if(close>=0){
      const open=s.lastIndexOf("<untrusted-data-",close-1), gt=open>=0?s.indexOf(">",open):-1;
      if(gt>=0&&gt<close){
        const body=s.slice(gt+1,close).trim();
        try{ return JSON.parse(body); }catch(e){}
        const a=body.indexOf("["), b=body.lastIndexOf("]"); if(a>=0&&b>a){ try{ return JSON.parse(body.slice(a,b+1)); }catch(e){} }
      }
    }
    return null;
  }
  function rows(payload){
    const seen=new Set();
    const visit=(x,depth)=>{
      if(depth>6||x==null) return null;
      if(typeof x==="string"){
        if(seen.has(x)) return null; seen.add(x);
        const t=fromText(x); if(Array.isArray(t)) return t;
        const s=x.trim();
        if(s.startsWith("{")||s.startsWith("[")){ try{ return visit(JSON.parse(s),depth+1); }catch(e){} }
        return null;
      }
      if(Array.isArray(x)){
        if(x.length&&x.every(r=>r&&typeof r==="object"&&!Array.isArray(r)&&!("type" in r&&"text" in r))) return x;
        for(const v of x){ const r=visit(v,depth+1); if(r) return r; }
        return x.length===0?x:null;
      }
      if(typeof x==="object"){ for(const v of Object.values(x)){ const r=visit(v,depth+1); if(r) return r; } }
      return null;
    };
    const out=visit(payload,0);
    if(Array.isArray(out)) return out;
    let shape=""; try{ shape=JSON.stringify(payload).slice(0,160); }catch(e){ shape=String(payload).slice(0,160); }
    throw {code:"parse",message:shape};
  }
