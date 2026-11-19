import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const host=document.querySelector('#viewport');
const status=document.querySelector('#viewer-status');
const statusText=document.querySelector('#viewer-status-text');
const select=document.querySelector('#station');
const output=document.querySelector('#station-label');
const follow=document.querySelector('#follow');
const button=id=>document.getElementById(id);
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
const nextPaint=()=>new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));

// Detalhe do local (cartão no canto da cena)
const detail=button('site-detail');
const detailText=button('site-detail-text');
function showDetail(text){detailText.textContent=text;detail.hidden=false;}
function hideDetail(){detail.hidden=true;}
button('site-detail-close').onclick=hideDetail;

async function start(){
  const asset=window.parque3d;
  if(!asset) throw new Error('Arquivo da maquete indisponível');
  const renderer=new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  host.prepend(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','Vista interativa da maquete');
  const scene=new THREE.Scene();
  scene.background=new THREE.Color('#e3ebeb');
  scene.fog=new THREE.FogExp2('#e3ecef',.00019);
  const sky=new THREE.Mesh(
    new THREE.SphereGeometry(7700,24,16),
    new THREE.ShaderMaterial({
      side:THREE.BackSide,depthWrite:false,
      uniforms:{horizon:{value:new THREE.Color('#e3ecef')},zenith:{value:new THREE.Color('#80abc7')}},
      vertexShader:'varying vec3 ray; void main(){ray=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader:`uniform vec3 horizon;uniform vec3 zenith;varying vec3 ray;
        void main(){float h=pow(clamp(normalize(ray).y,0.0,1.0),0.55);
        gl_FragColor=vec4(mix(horizon,zenith,h),1.);
        #include <colorspace_fragment>
        }`,
    }),
  );
  sky.frustumCulled=false;
  sky.renderOrder=-20;
  scene.add(sky);
  let dirty=true;
  let updatePins=()=>{};
  const skyToggle=button('sky');
  skyToggle.onchange=()=>{sky.visible=skyToggle.checked;dirty=true;};
  const camera=new THREE.PerspectiveCamera(44,1,.25,12500);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.enableDamping=true;
  controls.minDistance=5;
  controls.maxDistance=3600;
  controls.maxPolarAngle=Math.PI*.49;
  scene.add(new THREE.HemisphereLight('#eff6ff','#8a947c',1.56));
  const light=new THREE.DirectionalLight('#fff4df',1.65);
  light.position.set(-400,700,200);
  light.shadow.mapSize.set(2048,2048);
  light.shadow.bias=-.00014;
  light.shadow.normalBias=.28;
  scene.add(light,light.target);
  const sunOffset=light.position.clone();
  let style='realistic';
  function frameShadows(){
    const radius=THREE.MathUtils.clamp(camera.position.distanceTo(controls.target)*.64,65,1650);
    light.target.position.copy(controls.target);
    light.position.copy(controls.target).addScaledVector(sunOffset,Math.max(1,radius/400));
    const shadow=light.shadow.camera;
    shadow.left=shadow.bottom=-radius;
    shadow.right=shadow.top=radius;
    shadow.near=.5;
    shadow.far=light.position.distanceTo(light.target.position)+radius*1.6;
    shadow.updateProjectionMatrix();
  }

  // ---------- Câmera com transição suave ----------
  // "tween" guarda origem, destino e instante inicial. A cada quadro o
  // loop de renderização interpola posição e alvo com uma curva de easing.
  let tween=null;
  const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; // easeInOutCubic
  function pose(position,target,animate=true){
    hideDetail();
    if(!animate||reducedMotion){
      tween=null;
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();dirty=true;
      return;
    }
    const distance=camera.position.distanceTo(position)+controls.target.distanceTo(target);
    tween={
      p0:camera.position.clone(),t0:controls.target.clone(),
      p1:position.clone(),t1:target.clone(),
      start:performance.now(),
      duration:THREE.MathUtils.clamp(500+distance*.35,700,1600),
    };
    dirty=true;
  }
  function stepTween(now){
    if(!tween) return;
    const k=Math.min(1,(now-tween.start)/tween.duration);
    const e=ease(k);
    camera.position.lerpVectors(tween.p0,tween.p1,e);
    controls.target.lerpVectors(tween.t0,tween.t1,e);
    // Arco suave: sobe um pouco no meio do trajeto para não atravessar o terreno.
    camera.position.y+=Math.sin(Math.PI*e)*Math.min(260,tween.p0.distanceTo(tween.p1)*.12);
    if(k===1) tween=null;
    dirty=true;
  }

  const overview=(animate)=>pose(new THREE.Vector3(630,750,1730),new THREE.Vector3(0,0,0),animate);
  const plan=()=>pose(new THREE.Vector3(0,2300,.01),new THREE.Vector3(0,0,0));
  overview(false);
  const resize=()=>{
    const w=host.clientWidth,h=host.clientHeight;
    if(!w||!h) return;
    camera.setViewOffset(w,h,w>720&&!button('viewer-panel').hidden?Math.min(110,w*.09):0,0,w,h);
    renderer.setSize(w,h,false);dirty=true;
  };
  new ResizeObserver(resize).observe(host);
  window.addEventListener('parque-panel',resize);
  resize();
  controls.addEventListener('change',()=>{dirty=true;});

  // Bússola: o norte da maquete aponta para -Z; o azimute da câmera gira o ponteiro.
  const compass=button('compass');
  let lastAzimuth=NaN;
  renderer.setAnimationLoop(now=>{
    stepTween(now);
    controls.update();
    if(!dirty)return;
    sky.position.copy(camera.position);
    if(style==='rendered') frameShadows();
    renderer.render(scene,camera);
    updatePins();
    const azimuth=controls.getAzimuthalAngle();
    if(azimuth!==lastAzimuth){compass.style.transform='rotate('+azimuth+'rad)';lastAzimuth=azimuth;}
    dirty=false;
  });

  statusText.textContent='Preparando o modelo…';
  await nextPaint();
  const binary=Uint8Array.from(atob(asset.glb),c=>c.charCodeAt(0)).buffer;
  delete asset.glb;
  statusText.textContent='Montando a cena…';
  await nextPaint();
  const model=await new GLTFLoader().parseAsync(binary,'');
  scene.add(model.scene);dirty=true;
  const materials=new Map();
  const solidCache=new Map();
  function solid(source){
    if(source.name.startsWith('Layout')||(!source.map&&!source.emissiveMap)) return source;
    if(!solidCache.has(source)){
      const material=source.clone();
      material.color.set('#9eae8e');
      material.emissiveMap=null;
      if(material.emissive)material.emissive.set(0);
      // Keep the orthophoto coverage mask while replacing the sampled RGB.
      material.onBeforeCompile=shader=>{
        shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
          '#include <map_fragment>\n diffuseColor.rgb = diffuse;');
      };
      solidCache.set(source,material);
    }
    return solidCache.get(source);
  }
  model.scene.traverse(mesh=>{
    if(!mesh.isMesh) return;
    materials.set(mesh,mesh.material);
    mesh.receiveShadow=true;
    mesh.castShadow=/^(Edifica|Arboriza)/i.test(mesh.name);
  });
  const styles=[...document.querySelectorAll('[data-style]')].filter(el=>el.tagName==='BUTTON');
  function setStyle(next){
    style=next;
    host.dataset.style=next;
    const rendered=next==='rendered';
    renderer.shadowMap.enabled=rendered;
    light.castShadow=rendered;
    renderer.toneMapping=rendered?THREE.ACESFilmicToneMapping:THREE.NoToneMapping;
    renderer.toneMappingExposure=rendered?1.2:1;
    light.intensity=rendered?2.15:1.65;
    for(const [mesh,original] of materials){
      mesh.material=next==='solid'?(Array.isArray(original)?original.map(solid):solid(original)):original;
      for(const material of [mesh.material].flat()) material.needsUpdate=true;
    }
    for(const control of styles) control.setAttribute('aria-pressed',String(control.dataset.style===next));
    dirty=true;
  }
  for(const control of styles) control.onclick=()=>setStyle(control.dataset.style);
  setStyle('realistic');
  const layerInputs=[...document.querySelectorAll('[data-layer]')];
  const layerGroups=new Map(layerInputs.map(input=>{
    const group=model.scene.getObjectByName(input.dataset.layer);
    if(!group) throw new Error('Camada ausente: '+input.dataset.layer);
    return [input.dataset.layer,group];
  }));

  // Legenda: a cor de cada camada vem do atributo data-swatch no HTML
  // (conferida visualmente com a cena; materiais com textura não têm cor única).
  for(const input of layerInputs){
    const color=input.dataset.swatch;
    if(!color) continue;
    const swatch=document.createElement('span');
    swatch.className='swatch';swatch.style.background=color;swatch.setAttribute('aria-hidden','true');
    input.after(swatch);
  }

  const proposalOnly=new Set(['Via','Micromobilidade','Paisagismo','Canoagem','Cruzamento','Equipamentos','Humanizacao','Layout']);
  const existingTerrain=model.scene.getObjectByName('TerrenoExistente');
  // O GLTFLoader troca espaços por "_" nos nomes; por isso a busca aceita as duas formas.
  let proposalTerrain=model.scene.getObjectByName('TerrenoProposta');
  if(!proposalTerrain) model.scene.traverse(obj=>{if(/^MDT[ _]LiDAR/.test(obj.name))proposalTerrain=obj;});
  if(!proposalTerrain||!existingTerrain) throw new Error('Terrenos de comparação ausentes');
  const scenePins=button('scene-pins');
  const layoutPins=button('program-map');
  const pinSelect=button('pin-select');
  const scenarios=[...document.querySelectorAll('[data-scenario]')];
  let scenario='proposal';
  const equipmentInput=layerInputs.find(i=>i.dataset.layer==='Equipamentos');
  const pinViews=[];
  const projected=new THREE.Vector3();
  function refreshScenario(){
    const proposed=scenario==='proposal';
    proposalTerrain.visible=proposed;
    existingTerrain.visible=!proposed;
    for(const input of layerInputs){
      const enabled=proposed||!proposalOnly.has(input.dataset.layer);
      input.disabled=!enabled;
      layerGroups.get(input.dataset.layer).visible=enabled&&input.checked;
    }
    scenePins.hidden=!proposed||!equipmentInput.checked;
    button('program-panel').hidden=!proposed;
    for(const control of scenarios) control.setAttribute('aria-pressed',String(control.dataset.scenario===scenario));
    host.dataset.scenario=scenario;
    dirty=true;
  }
  for(const input of layerInputs)input.addEventListener('change',refreshScenario);
  for(const control of scenarios)control.onclick=()=>{
    stop();
    scenario=control.dataset.scenario;
    hideDetail();
    refreshScenario();
  };

  // ---------- Link compartilhável (#planta, #canoagem, #pino-cafe…) ----------
  function setHash(hash){
    const url=location.pathname+location.search+(hash?'#'+hash:'');
    if(location.hash.slice(1)!==hash) history.replaceState(null,'',url);
  }

  function selectEquipment(id){
    const record=pinViews.find(item=>item.pin.id===id);
    if(!record)return;
    stop();
    activate('');
    const {pin,world}=record;
    pinSelect.value=id;
    if(scenario!=='proposal'){scenario='proposal';}
    equipmentInput.checked=true;
    refreshScenario();
    for(const item of pinViews){
      item.marker.setAttribute('aria-pressed',String(item===record));
      item.planMarker.setAttribute('aria-pressed',String(item===record));
    }
    pose(world.clone().add(new THREE.Vector3(26,35,56)),world);
    showDetail(pin.name+' · Etapa '+pin.phase+' · '+pin.detail+(pin.id==='slalom'?'.':'. Posição indicativa.'));
    setHash('pino-'+id);
  }
  function marker(parent,pin,index){
    const el=document.createElement('button');
    el.type='button';el.className='pin-marker';el.textContent=String(index+1);
    el.dataset.label=pin.name;el.setAttribute('aria-label',pin.name);el.setAttribute('aria-pressed','false');
    el.onclick=()=>selectEquipment(pin.id);
    parent.append(el);
    return el;
  }
  for(const [index,pin] of asset.equipment.entries()){
    const planMarker=marker(layoutPins,pin,index);
    planMarker.title=pin.name;
    planMarker.style.left=(pin.map[0]*100)+'%';
    planMarker.style.top=(pin.map[1]*100)+'%';
    pinViews.push({pin,world:new THREE.Vector3(...pin.world),marker:marker(scenePins,pin,index),planMarker});
    const option=new Option((index+1)+' · '+pin.name,pin.id);
    pinSelect.add(option);
  }
  pinSelect.onchange=()=>selectEquipment(pinSelect.value);
  updatePins=()=>{
    if(scenePins.hidden)return;
    const occupied=[];
    for(const {marker,world} of pinViews){
      projected.copy(world).project(camera);
      const x=(projected.x+1)*host.clientWidth/2;
      const y=(1-projected.y)*host.clientHeight/2;
      const selected=marker.getAttribute('aria-pressed')==='true';
      const visible=projected.z>=-1&&projected.z<=1&&Math.abs(projected.x)<.97&&Math.abs(projected.y)<.95
        &&(selected||occupied.every(p=>Math.hypot(p[0]-x,p[1]-y)>23));
      marker.hidden=!visible;
      if(visible){marker.style.left=x+'px';marker.style.top=y+'px';occupied.push([x,y]);}
    }
  };
  refreshScenario();
  const routes={
    road:{points:asset.path,stations:asset.stations,transition:asset.transition},
    active:{points:asset.activePath,stations:asset.activeStations,transition:asset.activeTransition},
  };
  for(const route of Object.values(routes)) route.points=route.points.map(p=>new THREE.Vector3(...p));
  const routeControl=button('route');
  const speedControl=button('speed');
  let {points:pts,stations,transition}=routes.road;
  let total=stations.at(-1);

  // ---------- Seguir percurso ----------
  // Avança em metros por segundo a cada quadro (requestAnimationFrame),
  // em vez de saltos fixos com setInterval: fica fluido e independente do FPS.
  let timer;          // id do requestAnimationFrame em andamento
  let progress=0;     // posição contínua (0–1000) para não perder frações
  function stop(){
    if(timer) cancelAnimationFrame(timer);
    timer=undefined;follow.setAttribute('aria-pressed','false');follow.textContent='Seguir percurso';
  }
  function at(distance){
    let i=stations.findIndex(s=>s>=distance);
    if(i<1)i=1;
    const f=(distance-stations[i-1])/(stations[i]-stations[i-1]);
    return pts[i-1].clone().lerp(pts[i],THREE.MathUtils.clamp(f,0,1));
  }
  function seek(t,near,animate=false){
    const s=t*total;
    const point=at(s);
    const before=at(Math.max(0,s-18));
    const after=at(Math.min(total,s+18));
    const heading=after.sub(before).normalize();
    const side=new THREE.Vector3(-heading.z,0,heading.x);
    const location=point.clone().addScaledVector(heading,near?-20:-36).addScaledVector(side,near?14:8);
    location.y+=near?11:13;
    const target=point.clone().addScaledVector(heading,near?5:30);
    target.y+=2;
    pose(location,target,animate);
    output.value=Math.round(s).toLocaleString('pt-BR')+' m de '+Math.round(total).toLocaleString('pt-BR')+ ' m · Etapa '+(s<transition?'02':'03');
  }
  function setStation(value,near,animate){
    progress=value;select.value=String(Math.round(value));
    seek(value/1000,near,animate);
  }
  const viewIds=['overview','plan','road','roundabout','canoe'];
  const viewHash={overview:'',plan:'planta',road:'gabarito',roundabout:'rotatoria',canoe:'canoagem'};
  function activate(id){
    for(const key of viewIds)button(key).setAttribute('aria-pressed',String(key===id));
    if(id){
      setHash(viewHash[id]);
      for(const item of pinViews){item.marker.setAttribute('aria-pressed','false');item.planMarker.setAttribute('aria-pressed','false');}
    }
  }
  for(const id of viewIds)button(id).addEventListener('click',()=>activate(id));
  button('overview').onclick=()=>{stop();overview(true);};
  button('roundabout').onclick=()=>{
    stop();
    const target=new THREE.Vector3(...asset.roundaboutTarget);
    pose(target.clone().add(new THREE.Vector3(35,68,93)),target);
    showDetail('Rotatória na Rua David Pacher · conexão conceitual com a Via Parque. Raio externo 14 m, interno 7,2 m.');
  };
  button('plan').onclick=()=>{stop();plan();};
  button('canoe').onclick=()=>{
    stop();
    for(const input of layerInputs.filter(input=>['Canoagem','Cruzamento'].includes(input.dataset.layer))){
      input.checked=true;input.dispatchEvent(new Event('change'));
    }
    const target=new THREE.Vector3(...asset.canoeTarget);
    pose(target.clone().add(new THREE.Vector3(72,236,146)),target);
    showDetail('Sobreposição preliminar com a faixa de 5 m: '+asset.overlap.toLocaleString('pt-BR')+' m² em planta. A continuidade do percurso precisa ser resolvida em projeto.');
  };
  function routeChanged(){
    ({points:pts,stations,transition}=routes[routeControl.value]);
    total=stations.at(-1);
  }
  routeControl.onchange=()=>{stop();routeChanged();setStation(0,false,true);};
  button('road').onclick=()=>{stop();routeControl.value='road';routeChanged();setStation(130,true,true);};
  button('stage-02').onclick=()=>{stop();activate('');setStation(120,false,true);};
  button('stage-03').onclick=()=>{
    stop();activate('');
    setStation(Math.min(990,Math.round((transition+55)/total*1000)),false,true);
  };
  select.oninput=()=>{stop();activate('');setStation(Number(select.value),false,false);};
  follow.onclick=()=>{
    if(timer){stop();return;}
    activate('');
    if(Number(select.value)>=1000) progress=0;
    else progress=Number(select.value);
    follow.setAttribute('aria-pressed','true');follow.textContent='Pausar percurso';
    setStation(progress,false,false);
    let last=performance.now();
    const step=now=>{
      const dt=Math.min(.1,(now-last)/1000);last=now;
      const metersPerSecond=Number(speedControl.value);
      const next=Math.min(1000,progress+metersPerSecond*dt/total*1000);
      setStation(next,false,false);
      if(next>=1000){stop();return;}
      timer=requestAnimationFrame(step);
    };
    timer=requestAnimationFrame(step);
  };
  controls.addEventListener('start',()=>{stop();tween=null;activate('');});

  // ---------- Atalhos de teclado: 1–5 trocam de lugar ----------
  document.addEventListener('keydown',event=>{
    if(event.target.closest('input,select,textarea')||event.ctrlKey||event.metaKey||event.altKey) return;
    const index=Number(event.key)-1;
    if(index>=0&&index<viewIds.length){button(viewIds[index]).click();}
  });

  output.value='0 m de '+Math.round(total).toLocaleString('pt-BR')+' m · Etapa 02';
  status.hidden=true;
  host.dataset.ready='true';

  function applyHash(){
    const hash=decodeURIComponent(location.hash.slice(1));
    if(hash==='canoagem') button('canoe').click();
    else if(hash==='rotatoria') button('roundabout').click();
    else if(hash==='gabarito') button('road').click();
    else if(hash==='planta') button('plan').click();
    else if(hash.startsWith('pino-')) selectEquipment(hash.slice(5));
  }
  applyHash();
  window.addEventListener('hashchange',applyHash);
}

// ---------- Painel ----------
const panel=button('viewer-panel');
const toggle=button('panel-toggle');
function setPanel(open){
  panel.hidden=!open;
  toggle.setAttribute('aria-expanded',String(open));
  document.body.classList.toggle('panel-open',open);
  window.dispatchEvent(new Event('parque-panel'));
}
toggle.onclick=()=>setPanel(panel.hidden);
button('close-panel').onclick=()=>{setPanel(false);toggle.focus();};
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!panel.hidden){setPanel(false);toggle.focus();}
});
// No celular a maquete aparece primeiro; o painel abre pelo botão "Painel".
setPanel(innerWidth>720);

start().catch(error=>{
  console.error(error);
  status.classList.add('is-error');
  statusText.textContent='Não foi possível abrir o 3D neste navegador.';
  status.querySelector('small').textContent='Verifique se o WebGL está ativo ou consulte as outras visualizações:';
  const links=document.createElement('div');
  links.className='actions';
  links.innerHTML='<a href="conceito.html">Página de conceito</a><a href="index.html">Mapa técnico</a>';
  status.append(links);
});
