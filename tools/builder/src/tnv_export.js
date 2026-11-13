/* Company and Brand Facts from The Night Ventures, written by the app's own export code.
   build.py copies sectionMarkdown.js, and the constants it needs from api.js, into the two marked places below.
   Only the database reads differ: `supabase` here is an adapter that runs them through the viewer's Supabase connection. */
window.TNVExport=(()=>{
  const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  // The export code reads with supabase.from(table).select(columns).eq(column, id).maybeSingle(). Same call shape, run as SQL.
  const supabase={from(table){ let cols="*", where=null; const q={
    select(c){ cols=String(c); return q; },
    eq(c,v){ where=[String(c),String(v)]; return q; },
    async maybeSingle(){
      if(!/^[a-z_]+$/.test(table)||!/^[a-z0-9_,\s]+$/i.test(cols)||!where||!/^[a-z_]+$/.test(where[0])||!UUID.test(where[1])) throw {code:"bad_query",message:table};
      const r=await TNV.sql(`select ${cols.replace(/\s+/g," ").trim()} from public.${table} where ${where[0]}='${where[1]}'::uuid limit 1`);
      return {data:r[0]||null,error:null}; } }; return q; } };
  const downloadMarkdown=()=>{};

/*@APP_API@*/

/*@APP_SECTION_MARKDOWN@*/

  /* The two documents for one company, as the Export button names and writes them: [Company, Brand Facts]. */
  async function load(companyId){
    if(!UUID.test(companyId)) throw {code:"bad_id"};
    const pb=(await TNV.sql(`select brand_facts from public.aeo_playbook where company_id='${companyId}'::uuid limit 1`))[0];
    const company=await buildSectionMarkdown("company",companyId,{});
    const brand=await buildSectionMarkdown("brand",companyId,{playbook:{brand_facts:normalizeBrandFacts(pb&&pb.brand_facts)}});
    return [company,brand];
  }
  return {load};
})();
