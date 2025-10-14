/* Minimal static router + RU/HE bilingual rendering
   Data contract (S3 JSON):
   - /data/categories.json -> [{ id, name:{ru,he}, cover }]
   - /data/recipes/index.json -> [
        { id, category, title:{ru,he}, summary:{ru,he}, images:{thumb}, price:{amount,currency} }
     ]
   - /data/recipes/<id>.json -> full record; supports:
     images.steps:
       - ["images/.../step-1.webp", ...]  OR
       - [{"src":"images/.../step-1.webp","name":{"ru":"Название","he":"שם"}} , ...]
     images.hero:
       - "images/.../hero.webp" OR ["images/.../hero-1.webp", ...] (single is fine; no auto-rotate)
     price: { "amount": Number, "currency": "GEL"|"ILS"|... }
*/
const state = {
  lang: localStorage.getItem('lang') || 'ru',
  categories: [],
  recipesIndex: [],
};

const tUI = {
  ru: {
    categories: 'Категории', ingredients: 'Ингредиенты', steps: 'Шаги / Галерея',
    search: 'Поиск', back: 'Назад', minutes:'мин', recipe:'Рецепт',
    gallery:'Галерея', close:'Закрыть', price:'Цена'
  },
  he: {
    categories: 'קטגוריות', ingredients: 'מרכיבים', steps: 'שלבים / גלריה',
    search: 'חיפוש', back: 'חזרה', minutes:'דק׳', recipe:'מתכון',
    gallery:'גלריה', close:'סגור', price:'מחיר'
  },
};

function setLang(lang){
  state.lang = lang; localStorage.setItem('lang', lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = (lang === 'he') ? 'rtl' : 'ltr';
  document.getElementById('btn-ru').setAttribute('aria-pressed', String(lang==='ru'));
  document.getElementById('btn-he').setAttribute('aria-pressed', String(lang==='he'));
}

// Data loaders
async function loadCategories(){
  if(state.categories.length) return state.categories;
  const res = await fetch('/data/categories.json', {cache:'no-cache'});
  state.categories = await res.json();
  return state.categories;
}
async function loadRecipesIndex(){
  if(state.recipesIndex.length) return state.recipesIndex;
  const res = await fetch('/data/recipes/index.json', {cache:'no-cache'});
  state.recipesIndex = await res.json();
  return state.recipesIndex;
}
async function loadRecipe(id){
  const res = await fetch(`/data/recipes/${id}.json`, {cache:'no-cache'});
  if(!res.ok) throw new Error('Recipe not found');
  return res.json();
}

// Helpers
const text = (obj) => (obj ? obj[state.lang] || obj.ru || obj.he || '' : '');
const el = (tag, attrs={}, html='')=>{ const e = document.createElement(tag); Object.entries(attrs).forEach(([k,v])=> e.setAttribute(k,v)); e.innerHTML = html; return e; };

function formatPrice(price){
  if(!price || typeof price.amount !== 'number') return '';
  // map UI language -> sensible locale for formatting
  const priceCurrency = state.lang === 'he' ? 'שקל' : 'шек';
  return `${price.amount} ${priceCurrency}`;
}

// Simple lightbox
function ensureLightbox(){
  if(document.getElementById('lightbox')) return;
  const lb = el('div', {id:'lightbox', style:`
    position:fixed; inset:0; display:none; align-items:center; justify-content:center;
    background:rgba(0,0,0,.75); z-index:1000; padding:20px;
  `});
  lb.innerHTML = `
    <figure style="max-width: min(1200px, 95vw); max-height: 90vh; margin:0; display:flex; flex-direction:column; gap:10px;">
      <img id="lightbox-img" alt="" style="max-width:100%; max-height:80vh; border-radius:12px; object-fit:contain" />
      <figcaption id="lightbox-cap" style="color:#fff; text-align:center; font-size:1rem;"></figcaption>
      <button id="lightbox-close" aria-label="Close" style="align-self:center; padding:.5rem 1rem; border:1px solid #fff; background:transparent; color:#fff; border-radius:999px; cursor:pointer;">×</button>
    </figure>
  `;
  document.body.append(lb);

  function close(){
    lb.style.display = 'none';
    document.removeEventListener('keydown', onEsc);
  }
  function onEsc(e){ if(e.key === 'Escape') close(); }

  lb.addEventListener('click', (e)=>{ if(e.target.id === 'lightbox' ) close(); });
  lb.querySelector('#lightbox-close').addEventListener('click', close);
  lb.dataset.ready = '1';
}

function openLightbox(src, caption){
  ensureLightbox();
  const lb = document.getElementById('lightbox');
  const img = document.getElementById('lightbox-img');
  const cap = document.getElementById('lightbox-cap');
  img.src = `/${src}`;
  img.alt = caption || '';
  cap.textContent = caption || '';
  lb.style.display = 'flex';
  function onEsc(e){ if(e.key === 'Escape') { lb.style.display='none'; document.removeEventListener('keydown', onEsc);} }
  document.addEventListener('keydown', onEsc);
}

function breadcrumbs(parts){
  const wrap = el('nav', {class:'breadcrumbs', 'aria-label':'breadcrumbs'});
  parts.forEach((p,i)=>{
    const a = el('a', {href:p.href || '#/'}, p.label);
    wrap.append(a);
    if(i < parts.length-1) wrap.append(el('span', {class:'sep'}, '›'));
  });
  return wrap;
}

// Views
async function viewHome(){
  const app = document.getElementById('app'); app.innerHTML = '';
  const cats = await loadCategories();
  app.append(breadcrumbs([{label: text({ru:'Главная', he:'בית'}), href:'#/'}]));

  const h = el('h1', {}, text({ru:'Категории', he:'קטגוריות'}));
  app.append(h);
  const grid = el('section', {class:'grid'});
  cats.forEach(c => {
    const card = el('article', {class:'card'});
    card.innerHTML = `
      <a href="#/category/${c.id}">
        <img src="/${c.cover}" alt="${text(c.name)}" loading="lazy" />
      </a>
      <div class="body">
        <h3 class="title"><a href="#/category/${c.id}">${text(c.name)}</a></h3>
        <p class="muted">${c.count ? c.count : ''}</p>
      </div>`;
    grid.append(card);
  });
  app.append(grid);
}

async function viewCategory(catId){
  const app = document.getElementById('app'); app.innerHTML = '';
  const cats = await loadCategories();
  const cat = cats.find(c=>c.id===catId);
  const list = await loadRecipesIndex();
  const items = list.filter(r => r.category === catId);

  app.append(breadcrumbs([
    {label: text({ru:'Главная', he:'בית'}), href:'#/'},
    {label: text(cat?.name || {ru:catId, he:catId})}
  ]));

  const h = el('h1', {}, text(cat?.name || {ru:catId, he:catId}));
  app.append(h);
  const grid = el('section', {class:'grid'});
  items.forEach(r=>{
    const nm = text(r.title);
    const priceHtml = r.price ? `<span class="price" style="display:inline-block; font-size:.85rem; padding:.15rem .5rem; border-radius:999px; background:#fff; border:1px solid #eee; margin-inline-start:.5rem;">${formatPrice(r.price)}</span>` : '';
    const card = el('article', {class:'card'});
    card.innerHTML = `
      <a href="#/recipe/${r.id}">
        <img src="/${r.images.thumb}" alt="${nm}" loading="lazy" />
      </a>
      <div class="body">
        <h3 class="title"><a href="#/recipe/${r.id}">${nm}</a>${priceHtml}</h3>
        <p class="muted">${text(r.summary || {})}</p>
      </div>`;
    grid.append(card);
  });
  app.append(grid);
}

async function viewRecipe(id){
  const app = document.getElementById('app'); app.innerHTML = '';
  const data = await loadRecipe(id);

  app.append(breadcrumbs([
    {label: text({ru:'Главная', he:'בית'}), href:'#/'},
    {label: text({ru:'Категории', he:'קטגוריות'}), href:`#/category/${data.category}`},
    {label: text(data.title)}
  ]));

  // Hero (single or first)
  const hero = el('section', {class:'recipe-hero'});
  const media = el('div', {class:'media'});
  const heroImgs = Array.isArray(data.images.hero) ? data.images.hero : [data.images.hero || data.images.thumb];
  const imgEl = el('img', {src:`/${heroImgs[0]}`, alt:text(data.title)});
  media.append(imgEl);
  hero.append(media);

  const info = el('div', {class:'info'});
  const priceHtml = data.price ? `<div class="tags"><span class="tag">${tUI[state.lang].price}: ${formatPrice(data.price)}</span></div>` : '';
  info.innerHTML = `
    <h1>${text(data.title)}</h1>
    <div class="muted">${text(data.summary || {})}</div>
    ${priceHtml}
    <div class="tags">
      ${(data.tags||[]).map(tag=>`<span class="tag">${tag}</span>`).join('')}
    </div>
  `;
  hero.append(info);
  app.append(hero);

  // Ingredients
  const ing = el('section', {class:'section'});
  ing.append(el('h2', {}, text({ru:'Ингредиенты', he:'מרכיבים'})));
  const ul = el('ul', {class:'list'});
  (data.ingredients?.[state.lang] || []).forEach(x=> ul.append(el('li', {}, x)) );
  ing.append(ul); app.append(ing);

  // Steps + Gallery (with names + click to open full image)
  const st = el('section', {class:'section'});
  st.append(el('h2', {}, text({ru:'Шаги / Галерея', he:'שלבים / גלריה'})));
  const wrap = el('div', {class:'gallery'});
  const steps = Array.isArray(data.images?.steps) ? data.images.steps : [];

  steps.forEach(item=>{
    let src, name;
    if(typeof item === 'string'){ src = item; name = ''; }
    else { src = item.src; name = text(item.name || {}); }
    const fig = el('figure', {style:'margin:0; display:flex; flex-direction:column; gap:6px;'});
    const thumb = el('img', {src:`/${src}`, alt:name || '', loading:'lazy', style:'cursor:pointer;'});
    thumb.addEventListener('click', ()=> openLightbox(src, name || text(data.title)));
    fig.append(thumb);
    if(name){
      const cap = el('figcaption', {class:'muted'}, name);
      fig.append(cap);
    }
    wrap.append(fig);
  });

  st.append(wrap);
  app.append(st);
}

// Router (fixed)
function parseRoute(){
  const hash = location.hash || '#/';
  let path = hash.startsWith('#/') ? hash.slice(2) : hash.replace(/^#/, '');
  path = path.replace(/\/+$/, '');
  if(!path) return [];
  return path.split('/');
}

async function router(){
  const parts = parseRoute();
  const [a, b] = parts; // e.g. ['category','bakes']
  switch(a){
    case undefined:
      await viewHome();
      break;
    case 'category':
      await viewCategory(b);
      break;
    case 'recipe':
      await viewRecipe(b);
      break;
    default:
      await viewHome();
  }
}

// Search
async function handleSearch(term){
  term = term.trim().toLowerCase();
  if(!term){ router(); return; }
  const app = document.getElementById('app'); app.innerHTML = '';
  const idx = await loadRecipesIndex();
  const res = idx.filter(r =>
    (text(r.title).toLowerCase().includes(term)) ||
    (text(r.summary||{}).toLowerCase().includes(term)) ||
    (r.tags||[]).some(tag => String(tag).toLowerCase().includes(term))
  );
  app.append(breadcrumbs([{label:text({ru:'Поиск', he:'חיפוש'})}]));
  const grid = el('section', {class:'grid'});
  res.forEach(r=>{
    const priceHtml = r.price ? `<span class="price" style="display:inline-block; font-size:.85rem; padding:.15rem .5rem; border-radius:999px; background:#fff; border:1px solid #eee; margin-inline-start:.5rem;">${formatPrice(r.price)}</span>` : '';
    const card = el('article', {class:'card'});
    card.innerHTML = `
      <a href="#/recipe/${r.id}"><img src="/${r.images.thumb}" alt="${text(r.title)}" loading="lazy"></a>
      <div class="body">
        <h3 class="title"><a href="#/recipe/${r.id}">${text(r.title)}</a>${priceHtml}</h3>
        <p class="muted">${text(r.summary || {})}</p>
      </div>`;
    grid.append(card);
  });
  app.append(grid);
}

// Wire UI
document.getElementById('btn-ru').addEventListener('click', ()=>{ setLang('ru'); router(); });
document.getElementById('btn-he').addEventListener('click', ()=>{ setLang('he'); router(); });

const searchInput = document.getElementById('q');
searchInput.addEventListener('input', (e)=> handleSearch(e.target.value));

// boot
setLang(state.lang);
document.getElementById('year').textContent = new Date().getFullYear();
window.addEventListener('hashchange', router);
router();
