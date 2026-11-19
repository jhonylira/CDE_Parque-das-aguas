'use strict';
/* Parque das Águas · Mapa técnico
   SVG com coordenadas em metros (UTM 22S): 1 unidade do viewBox = 1 m.
   Isso facilita a barra de escala e a leitura de coordenadas.          */
const {bounds, layers} = window.parque;
const [west, south, east, north] = bounds;
const W = east - west, H = north - south;
const map = document.querySelector('#map');
const render = document.querySelector('#render');
const details = document.querySelector('#details');
const xmlns = 'http://www.w3.org/2000/svg';
const fmt = (n, d = 2) => n.toLocaleString('pt-BR', {minimumFractionDigits: d, maximumFractionDigits: d});

// [título, cor, grupo do painel]
const style = {
  lotes:['Cadastro de lotes','#f0f9ff','Base cadastral'], app:['APP · referência','#82ed9a','Base cadastral'],
  urbanismo:['Urbanismo','#70dcf0','Projeto'], layout:['Implantação','#68bcf8','Projeto'],
  terraplenagem:['Terraplenagem · feições CAD','#ffcd70','Projeto'], infraworks:['InfraWorks','#7caaff','Projeto'],
  legal:['Projeto legal','#e0a4ff','Projeto'], canal:['Canal','#59e6e4','Projeto'],
  devigilli:['Loteamento Devigilli','#d39cff','Loteamentos'], guaramirim:['Loteamento Guaramirim · referência QGIS','#77bcff','Loteamentos'],
  giardino:['Loteamento Parque Giardino','#f998ca','Loteamentos'], via_parque:['Via Parque · 18 m','#e1dbb5','Projeto'],
  micromobilidade:['Micromobilidade · 5 m','#f5ac74','Projeto'], canoagem:['Canal de canoagem','#60d5ed','Canoagem'],
  canoagem_cruzamento:['Canoagem × micromobilidade','#ff784a','Canoagem'], interferencias:['Interferências','#ff6a5e','Análise']
};
const groupOrder = ['Análise','Projeto','Canoagem','Base cadastral','Loteamentos'];
const propLabels = {id:'Identificador',lote:'Lote cadastral',camada:'Camada CAD',handle:'Handle CAD',area_m2:'Área (m²)',area_lote:'Área do lote (m²)',
  porcentagem:'% do lote',status:'Status',fonte:'Fonte',largura_m:'Largura (m)',tipo:'Tipo'};

function svg(tag, attrs, parent = map) {
  const element = document.createElementNS(xmlns, tag);
  for (const [k,v] of Object.entries(attrs)) element.setAttribute(k,v);
  parent.append(element);
  return element;
}
const project = ([x,y]) => [x-west,north-y];
function path(g) {
  const line = points => points.map((p,i) => (i?'L':'M')+project(p).map(n=>n.toFixed(2)).join(' ')).join('');
  switch(g.type) {
    case 'LineString': return line(g.coordinates);
    case 'MultiLineString': return g.coordinates.map(line).join('');
    case 'Polygon': return g.coordinates.map(r=>line(r)+'Z').join('');
    case 'MultiPolygon': return g.coordinates.map(coordinates=>path({type:'Polygon',coordinates})).join('');
    case 'GeometryCollection': return g.geometries.map(path).join('');
    default: return '';
  }
}

// ---------- Vista (viewBox), escala e zoom ----------
let view = [0,0,W,H];
const scaleBox = document.querySelector('#map-scale');
function pxPerMeter() {
  // preserveAspectRatio padrão (xMidYMid meet): vale a menor das razões.
  return Math.min(map.clientWidth / view[2], map.clientHeight / view[3]) || 1;
}
function updateScale() {
  const ppm = pxPerMeter();
  const target = 110 / ppm;                       // ~110 px de barra
  const pow = 10 ** Math.floor(Math.log10(target));
  const nice = [1,2,5,10].map(m => m*pow).filter(v => v <= target).pop() || pow;
  scaleBox.querySelector('.bar').style.width = Math.round(nice*ppm) + 'px';
  scaleBox.querySelector('.label').textContent = nice >= 1000 ? fmt(nice/1000, nice%1000?1:0)+' km' : fmt(nice, nice<1?1:0)+' m';
}
function update() {
  map.setAttribute('viewBox',view.join(' '));
  map.querySelectorAll('.mark').forEach(marker=>marker.setAttribute('r',String(Math.max(0.55,8*view[2]/W))));
  updateScale();
}
function reset(){ view = [0,0,W,H]; update(); }
function zoomAt(factor, cx = view[0]+view[2]/2, cy = view[1]+view[3]/2) {
  const w = view[2]*factor;
  if (w < 10 || w > W*2) return;
  view = [cx-(cx-view[0])*factor, cy-(cy-view[1])*factor, w, view[3]*factor];
  update();
}
function show(mode) {
  map.toggleAttribute('hidden', mode!=='map');
  render.hidden = mode==='map';
  if (mode!=='map') {
    render.src = mode+'.jpg';
    render.alt = mode==='planta'?'Planta renderizada da maquete':'Vista oblíqua da maquete';
  }
  document.querySelectorAll('button[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
  ['zoom-in','zoom-out','reset'].forEach(id=>document.getElementById(id).hidden=mode!=='map');
}

// ---------- Detalhes de feição ----------
let picked;
function describe(title, props, color) {
  const rows = Object.entries(props||{}).filter(([,v])=>v!==null&&v!=='').map(([k,v])=>{
    const value = typeof v === 'number' ? (k==='porcentagem' ? fmt(v*100,3)+' %' : fmt(v, Number.isInteger(v)?0:2)) : String(v);
    return '<dt>'+(propLabels[k]||k)+'</dt><dd>'+value.replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]))+'</dd>';
  }).join('');
  details.innerHTML = '<p><span class="swatch fill" style="background:'+color+';display:inline-block;margin-right:.4rem;vertical-align:-1px"></span><strong>'+title+'</strong></p>'+(rows?'<dl>'+rows+'</dl>':'');
}
function pick(element) {
  picked?.classList.remove('is-picked');
  picked = element; element?.classList.add('is-picked');
}

// ---------- Construção das camadas ----------
// Filtro que torna transparente o preto puro (pixels sem dado da ortofoto):
// alfa = 20·(R+G+B) − 0,1 → só valores quase zero ficam invisíveis.
const defs = svg('defs',{});
const nodata = svg('filter',{id:'nodata','color-interpolation-filters':'sRGB'},defs);
svg('feColorMatrix',{type:'matrix',values:'1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  20 20 20 0 -0.1'},nodata);
const ortho = svg('image',{href:'ortofoto.jpg',width:W,height:H,preserveAspectRatio:'none',filter:'url(#nodata)'});
const groupsBox = document.querySelector('#controls');
const panelGroups = new Map();
for (const name of groupOrder) {
  const box = document.createElement('div');
  box.className = 'layer-group';
  const h = document.createElement('h3');
  h.textContent = name;
  const all = document.createElement('button');
  all.type = 'button';
  all.textContent = 'alternar';
  all.setAttribute('aria-label','Alternar todas as camadas de '+name);
  all.addEventListener('click',()=>{
    const inputs=[...box.querySelectorAll('input')];
    const turnOn=inputs.some(i=>!i.checked);
    inputs.forEach(i=>{ if(i.checked!==turnOn){ i.checked=turnOn; i.dispatchEvent(new Event('change')); } });
  });
  h.append(all);
  box.append(h);
  panelGroups.set(name, box);
}
const occButtons = [];
let occCount = 0;
for (const [key,[title,color,groupName]] of Object.entries(style)) {
  if (!layers[key]?.length) continue;
  const group = svg('g',{'data-layer':key});
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type='checkbox';
  input.checked=key!=='guaramirim';
  if(!input.checked) group.setAttribute('display','none');
  input.addEventListener('change',()=>group.setAttribute('display',input.checked?'inline':'none'));
  const swatch=document.createElement('span');
  const filled = key==='interferencias'||key==='canoagem_cruzamento';
  swatch.className='swatch'+(filled?' fill':'');
  swatch.style.background=color;
  label.append(input,swatch,title);
  panelGroups.get(groupName).append(label);
  for (const entry of layers[key]) {
    const isClash=key==='interferencias';
    const el = svg('path',{d:path(entry.geometry),fill:filled?color:'none','fill-rule':'evenodd',stroke:color,
      'stroke-width':isClash?1.8:key==='lotes'?.75:1.25,'vector-effect':'non-scaling-stroke'},group);
    if (filled) el.classList.add('filled');
    el.__info = {title, props:entry.properties, color};
    if(!isClash) continue;
    occCount++;
    const points=entry.geometry.coordinates[0].map(project);
    const x=(Math.min(...points.map(p=>p[0]))+Math.max(...points.map(p=>p[0])))/2;
    const y=(Math.min(...points.map(p=>p[1]))+Math.max(...points.map(p=>p[1])))/2;
    const marker=svg('circle',{cx:x,cy:y,r:8,fill:'transparent',stroke:color,'stroke-width':1.5,
      'vector-effect':'non-scaling-stroke',class:'mark'},group);
    const p=entry.properties;
    const button=document.createElement('button');
    button.className='occ';
    button.type='button';
    button.setAttribute('aria-pressed','false');
    button.innerHTML='<span class="dot" aria-hidden="true"></span><strong></strong><span class="area"></span><small></small>';
    button.querySelector('strong').textContent=p.id;
    button.querySelector('.area').textContent=fmt(p.area_m2)+' m²';
    button.querySelector('small').textContent='Lote '+p.lote+' · '+p.camada+' '+p.handle+' · '+(p.status||'Triagem');
    function select(){
      show('map');
      input.checked=true;
      group.setAttribute('display','inline');
      view=[x-27,y-27*H/W,54,54*H/W]; update();
      occButtons.forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
      pick(el);
      describe(p.id+' · '+p.camada+' '+p.handle+' · lote '+p.lote+' · '+fmt(p.area_m2)+' m²', p, color);
    }
    button.addEventListener('click',select);
    marker.addEventListener('click',select);
    occButtons.push(button);
    document.querySelector('#occurrences').append(button);
  }
}
for (const box of panelGroups.values()) if (box.querySelector('label')) groupsBox.append(box);
document.querySelector('#occ-count').textContent = occCount || '';

// Opacidade da ortofoto
const opacity = document.querySelector('#ortho-opacity');
opacity.addEventListener('input',()=>{
  ortho.setAttribute('opacity', opacity.value/100);
  document.querySelector('#ortho-value').textContent = opacity.value+'%';
});

document.querySelectorAll('button[data-mode]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.mode)));
document.querySelector('#reset').addEventListener('click',reset);
document.querySelector('#zoom-in').addEventListener('click',()=>zoomAt(.65));
document.querySelector('#zoom-out').addEventListener('click',()=>zoomAt(1/.65));

// ---------- Interação: arrastar, pinça, roda e clique ----------
function pointer(event){
  return new DOMPoint(event.clientX,event.clientY).matrixTransform(map.getScreenCTM().inverse());
}
const coords = document.querySelector('#map-coords');
const hint = document.querySelector('.map-hint');
const fadeHint = () => hint?.classList.add('is-faded');
setTimeout(fadeHint, 6000);
const pointers = new Map();   // dedos/cursor ativos
let drag, pinch, moved = 0, downTarget;
map.addEventListener('pointerdown',event=>{
  if(event.target.classList.contains('mark')) return;
  pointers.set(event.pointerId, event);
  map.setPointerCapture(event.pointerId);
  downTarget = event.target; moved = 0;
  if (pointers.size === 1) { drag = pointer(event); map.classList.add('is-dragging'); }
  if (pointers.size === 2) {
    const [a,b] = [...pointers.values()];
    pinch = {dist: Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY)};
    drag = null;
  }
});
map.addEventListener('pointermove',event=>{
  const p = pointer(event);
  coords.textContent = 'E ' + fmt(west+p.x,1) + ' · N ' + fmt(north-p.y,1);
  if (!pointers.has(event.pointerId)) return;
  const prev = pointers.get(event.pointerId);
  moved += Math.hypot(event.clientX-prev.clientX, event.clientY-prev.clientY);
  pointers.set(event.pointerId, event);
  if (pinch && pointers.size === 2) {
    const [a,b] = [...pointers.values()];
    const dist = Math.hypot(a.clientX-b.clientX, a.clientY-b.clientY);
    const mid = pointer({clientX:(a.clientX+b.clientX)/2, clientY:(a.clientY+b.clientY)/2});
    zoomAt(pinch.dist/dist, mid.x, mid.y);
    pinch.dist = dist;
    fadeHint();
    return;
  }
  if (!drag) return;
  view[0]-=p.x-drag.x; view[1]-=p.y-drag.y; update();
  if (moved > 4) fadeHint();
});
function release(event){
  if (!pointers.has(event.pointerId)) return;
  pointers.delete(event.pointerId);
  if (pointers.size < 2) pinch = null;
  if (pointers.size === 0) {
    map.classList.remove('is-dragging');
    // Clique sem arrastar sobre uma feição → mostra os atributos
    if (event.type==='pointerup' && moved < 4 && downTarget?.__info) {
      const {title, props, color} = downTarget.__info;
      occButtons.forEach(b=>b.setAttribute('aria-pressed','false'));
      pick(downTarget);
      describe(title, props, color);
    }
    drag = null;
  } else {
    drag = pointer([...pointers.values()][0]);
  }
}
for (const name of ['pointerup','pointercancel']) map.addEventListener(name,release);
map.addEventListener('pointerleave',()=>{ if(!pointers.size) coords.textContent=''; });
map.addEventListener('wheel',event=>{
  event.preventDefault();
  const p = pointer(event);
  zoomAt(Math.exp(event.deltaY*0.0015), p.x, p.y);
  fadeHint();
},{passive:false});
new ResizeObserver(updateScale).observe(map);
reset();
