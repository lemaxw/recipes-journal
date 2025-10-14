// admin.js — uploads (local or AWS), save/delete
// Local/Remote switch helpers
const $ = (id)=> document.getElementById(id);


function isLocal() {
  return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
}

function apiBase() {
  if (isLocal()) return window.location.origin;                // local Express
  return "https://1i82efecb8.execute-api.us-east-1.amazonaws.com/prod";
}

// Require auth on load in prod
document.addEventListener('DOMContentLoaded', async () => {
  if (isLocal()) return;
  const auth = await import('/assets/admin_auth.js');
  await auth.ensureLogin();        // redirects if not logged in
  auth.setWhoFromToken();          // optional whoami
});


function setStatus(msg){ $('status').textContent = msg; }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }


// Dynamic import of auth only for remote
let ensureLogin = async ()=>{};

// Simple invoker: JWT, no SigV4
async function invoke(path, body) {
  if (isLocal()) {
    const r = await fetch(apiBase() + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
    return r.json();
  }
  const auth = await import('/assets/admin_auth.js');
  const idToken = await auth.ensureLogin();
  const r = await fetch(apiBase() + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`${path} failed: ${r.status}`);
  return r.json();
}

async function fileToWebP(file, quality=0.9, maxW=1600){
  const img = new Image();
  const reader = new FileReader();
  const buf = await new Promise((res)=>{ reader.onload = ()=> res(reader.result); reader.readAsDataURL(file); });
  img.src = buf; await img.decode();
  const scale = Math.min(1, maxW / img.naturalWidth);
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = Object.assign(document.createElement('canvas'), { width:w, height:h });
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise(res=> canvas.toBlob(res, 'image/webp', quality));
  return new File([blob], file.name.replace(/\.[^.]+$/, '.webp'), { type: 'image/webp' });
}
function lines(val){ return val.split(/\r?\n/).map(s=>s.trim()).filter(Boolean); }

async function localUpload(key, file){
  const form = new FormData(); form.append('file', file);
  const r = await fetch(`${apiBase()}/upload?key=${encodeURIComponent(key)}`, { method:'POST', body: form });
  if(!r.ok) throw new Error('upload failed'); return r.json();
}
async function presignPut(key, contentType){ return invoke('/upload-url', { key, contentType }); }
async function uploadFile(presigned, file){
  const r = await fetch(presigned.url, { method: presigned.method || 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if(!r.ok) throw new Error('upload failed');
}

$('btnUpload').addEventListener('click', async ()=>{
  try{
    if (!isLocal()) { const mod = await import('./admin_auth.js'); await mod.ensureLogin(); }
    setStatus('Converting & uploading...');
    const rid = $('rid').value.trim(); const cat = $('cat').value.trim();
    if(!rid || !cat) throw new Error('Recipe ID and Category are required');
    const baseKey = `images/recipes/${rid}/`;

    const files = { thumb: $('fThumb').files[0] || null, hero: [...$('fHero').files], steps: [...$('fSteps').files] };
    const out = { thumb:null, hero:[], steps:[] };
    if(files.thumb){ out.thumb = await fileToWebP(files.thumb, 0.9, 800); }
    for(const f of files.hero){ out.hero.push(await fileToWebP(f, 0.95, 1600)); }
    for(const f of files.steps){ out.steps.push(await fileToWebP(f, 0.9, 1600)); }

    if(out.thumb){
      const key = `${baseKey}thumb.webp`;
      if (isLocal()) await localUpload(key, out.thumb); else { const ps = await presignPut(key, out.thumb.type); await uploadFile(ps, out.thumb); }
    }
    const heroKeys = [];
    for(let i=0;i<out.hero.length;i++){
      const key = `${baseKey}hero-${i+1}.webp`;
      if (isLocal()) await localUpload(key, out.hero[i]); else { const ps = await presignPut(key, out.hero[i].type); await uploadFile(ps, out.hero[i]); }
      heroKeys.push(key); await sleep(25);
    }
    const stepObjs = [];
    const capsRu = lines($('capRu').value); const capsHe = lines($('capHe').value);
    for(let i=0;i<out.steps.length;i++){
      const key = `${baseKey}step-${i+1}.webp`;
      if (isLocal()) await localUpload(key, out.steps[i]); else { const ps = await presignPut(key, out.steps[i].type); await uploadFile(ps, out.steps[i]); }
      stepObjs.push({ src: key, name: { ru: capsRu[i] || '', he: capsHe[i] || '' } });
      await sleep(15);
    }

    const recipeJson = {
      id: rid, category: cat,
      title: { ru: $('titleRu').value, he: $('titleHe').value },
      summary: { ru: $('sumRu').value, he: $('sumHe').value },
      price: ( $('priceAmt').value ? { amount: Number($('priceAmt').value), currency: $('priceCur').value || 'GEL' } : undefined ),
      images: { thumb: out.thumb ? `${baseKey}thumb.webp` : undefined, hero: heroKeys.length ? heroKeys : (out.thumb ? `${baseKey}thumb.webp` : undefined), steps: stepObjs },
      tags: $('tags').value ? $('tags').value.split(',').map(s=>s.trim()).filter(Boolean) : [],
      date: new Date().toISOString().slice(0,10)
    };
    const indexPatch = { id: rid, category: cat, title: recipeJson.title, summary: recipeJson.summary, images: { thumb: recipeJson.images.thumb || heroKeys[0] }, price: recipeJson.price, tags: recipeJson.tags };

    await invoke('/save-recipe', { recipeJson, indexPatch });
    setStatus('✅ Uploaded and saved!');
  }catch(err){ console.error(err); setStatus('❌ ' + err.message); }
});

$('btnDeleteRecipe').addEventListener('click', async ()=>{
  try{
    const id = $('delId').value.trim(); if(!id) throw new Error('Provide recipe ID');
    const delImgs = $('delImgs').checked;
    if(!confirm(`Delete recipe "${id}"? ${delImgs? 'This will also delete images.':''}`)) return;
    await invoke('/delete-recipe', { id, deleteImages: delImgs });
    setStatus('🗑️ Recipe deleted');
  }catch(err){ console.error(err); setStatus('❌ ' + err.message); }
});

$('btnDeleteObject').addEventListener('click', async ()=>{
  try{
    const key = $('delKey').value.trim(); if(!key) throw new Error('Provide object key');
    if(!confirm(`Delete object ${key}?`)) return;
    await invoke('/delete-object', { key });
    setStatus('🗑️ Object deleted');
  }catch(err){ console.error(err); setStatus('❌ ' + err.message); }
});

['fThumb','fHero','fSteps'].forEach(id=>{
  $(id).addEventListener('change', async ()=>{
    const box = document.getElementById('preview'); box.innerHTML = '';
    const files = [ ...($('fHero').files || []), ...($('fSteps').files || []) ];
    for(const f of files){
      const url = URL.createObjectURL(f);
      const img = new Image(); img.src = url; img.onload = ()=> URL.revokeObjectURL(url);
      box.append(img);
    }
  });
});

// Hook login/logout buttons safely
document.getElementById("btnLogin")?.addEventListener("click", async ()=>{
  if (isLocal()) {
    alert("Local mode: login skipped");
  } else {
    const mod = await import("./admin_auth.js");
    mod.ensureLogin();
  }
});
document.getElementById("btnLogout")?.addEventListener("click", async ()=>{
  if (isLocal()) {
    alert("Local mode: logout skipped");
  } else {
    const mod = await import("./admin_auth.js");
    mod.logout();
  }
});
