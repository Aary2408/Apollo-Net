import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  Play, Pause, RotateCcw, Radio, Crosshair, ShieldAlert, Route,
  Radar, Activity, Cpu, Satellite, Target, Zap, Wifi, WifiOff
} from "lucide-react";

const BACKEND = (import.meta.env.VITE_BACKEND_URL || "http://127.0.0.1:8000").replace(/\/$/, "");
const WS_URL = import.meta.env.VITE_WS_URL || "ws://127.0.0.1:8000/ws";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const distance = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
const pad = n => String(n).padStart(2,"0");

function makeScenario(count=80) {
  const drones = Array.from({length: count}, (_,i)=>({
    id:`D-${String(i+1).padStart(3,"0")}`,
    x:Math.random()*100, y:Math.random()*100,
    vx:0, vy:0, state:"SEARCH"
  }));
  const survivors = [
    {id:"S-01",x:72,y:67,found:false},
    {id:"S-02",x:34,y:77,found:false},
    {id:"S-03",x:83,y:30,found:false},
    {id:"S-04",x:21,y:35,found:false},
    {id:"S-05",x:58,y:20,found:false}
  ];
  const buildings = Array.from({length:16},(_,i)=>({
    id:i,x:8+Math.random()*84,y:8+Math.random()*84,
    width:5+Math.random()*9,depth:5+Math.random()*9,height:5+Math.random()*18
  }));
  return {drones,survivors,buildings};
}

function TacticalScene({drones, survivors, buildings, path, layers}) {
  const mount = useRef(null);
  const refs = useRef({});

  useEffect(() => {
    const el = mount.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#eef6fc");

    const camera = new THREE.PerspectiveCamera(45, el.clientWidth/el.clientHeight, .1, 1000);
    camera.position.set(0,150,205);

    const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = .08;
    controls.maxPolarAngle = Math.PI/2.05;
    controls.target.set(0,0,0);

    scene.add(new THREE.HemisphereLight(0xc8e8ff,0xb9c9d6,1.55));
    const dl = new THREE.DirectionalLight(0xffffff,1.75);
    dl.position.set(80,160,90); scene.add(dl);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200,200),
      new THREE.MeshStandardMaterial({color:0xeaf3f9,roughness:1,metalness:0})
    );
    ground.rotation.x = -Math.PI/2;
    ground.position.y = -1.15;
    scene.add(ground);

    const grid = new THREE.GridHelper(200,20,0x4e91bd,0x9fc4dd);
    grid.position.y = -1; grid.material.transparent = true; grid.material.opacity=.72;
    scene.add(grid);

    const buildingGroup = new THREE.Group();
    const droneGroup = new THREE.Group();
    const survivorGroup = new THREE.Group();
    const pathGroup = new THREE.Group();
    scene.add(buildingGroup,droneGroup,survivorGroup,pathGroup);
    refs.current = {scene,camera,renderer,controls,grid,buildingGroup,droneGroup,survivorGroup,pathGroup};

    const resize=()=>{
      const w=el.clientWidth,h=el.clientHeight;
      camera.aspect=w/h; camera.updateProjectionMatrix(); renderer.setSize(w,h);
    };
    window.addEventListener("resize",resize);

    let frame;
    const animate=()=>{
      frame=requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene,camera);
    };
    animate();

    return ()=>{
      cancelAnimationFrame(frame);
      window.removeEventListener("resize",resize);
      controls.dispose(); renderer.dispose();
      el.removeChild(renderer.domElement);
    };
  },[]);

  useEffect(()=>{
    const r=refs.current;
    if(!r.renderer)return;
    const {buildingGroup,droneGroup,survivorGroup,pathGroup,grid}=r;
    grid.visible=layers.grid;

    [buildingGroup,droneGroup,survivorGroup,pathGroup].forEach(g=>{
      while(g.children.length){
        const o=g.children.pop();
        o.traverse(n=>{
          n.geometry?.dispose?.();
          n.material?.dispose?.();
        });
      }
    });
    buildingGroup.visible=layers.buildings;
    droneGroup.visible=layers.drones;
    survivorGroup.visible=layers.survivors;
    pathGroup.visible=layers.path;

    const world=(x,y)=>new THREE.Vector3((x-50)*1.8,0,(y-50)*1.8);

    buildings.forEach(b=>{
      const p=world(b.x,b.y);
      const m=new THREE.Mesh(
        new THREE.BoxGeometry(b.width,b.height,b.depth),
        new THREE.MeshStandardMaterial({color:0xb7c7d3,roughness:.82,metalness:.04})
      );
      m.position.set(p.x,b.height/2,p.z); buildingGroup.add(m);
    });

    drones.forEach(d=>{
      const p=world(d.x,d.y);
      const m=new THREE.Mesh(
        new THREE.SphereGeometry(d.state==="SOS"?2.3:1.7,10,10),
        new THREE.MeshStandardMaterial({
          color:d.state==="SOS"?0xf04456:0x167cf0,
          emissive:d.state==="SOS"?0xb91f35:0x0a63c7,
          emissiveIntensity:1.15
        })
      );
      m.position.set(p.x, d.state==="SOS"?5:2.5, p.z);
      droneGroup.add(m);
    });

    survivors.forEach(s=>{
      const p=world(s.x,s.y);
      const m=new THREE.Mesh(
        new THREE.SphereGeometry(3,16,16),
        new THREE.MeshStandardMaterial({color:s.found?0xf04456:0xf5a623,roughness:.55,metalness:.02})
      );
      m.position.set(p.x,4,p.z); survivorGroup.add(m);
      const ring=new THREE.Mesh(
        new THREE.RingGeometry(5,5.7,32),
        new THREE.MeshBasicMaterial({color:s.found?0xf04456:0xf5a623,side:THREE.DoubleSide,transparent:true,opacity:.72})
      );
      ring.rotation.x=-Math.PI/2; ring.position.set(p.x,.2,p.z); survivorGroup.add(ring);
    });

    if(path.length>1){
      const pts=path.map(n=>{const p=world(n.x,n.y);return new THREE.Vector3(p.x,3,p.z)});
      const curve=new THREE.CatmullRomCurve3(pts);
      const geo=new THREE.BufferGeometry().setFromPoints(curve.getPoints(Math.max(30,path.length*5)));
      pathGroup.add(new THREE.Line(geo,new THREE.LineBasicMaterial({color:0x18b978,linewidth:2})));
    }
  },[drones,survivors,buildings,path,layers]);

  return <div ref={mount} className="scene3d"/>;
}

function PerformanceChart({coverage,active}) {
  const canvas=useRef(null);
  useEffect(()=>{
    const c=canvas.current, box=c.getBoundingClientRect(), dpr=window.devicePixelRatio||1;
    c.width=box.width*dpr;c.height=box.height*dpr;
    const ctx=c.getContext("2d");ctx.setTransform(dpr,0,0,dpr,0,0);
    const w=box.width,h=box.height;
    ctx.clearRect(0,0,w,h);
    ctx.strokeStyle="rgba(80,105,125,.16)";
    for(let i=1;i<5;i++){const y=12+(h-25)*i/5;ctx.beginPath();ctx.moveTo(10,y);ctx.lineTo(w-10,y);ctx.stroke()}
    const draw=(arr,max,color)=>{
      if(arr.length<2)return;
      ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();
      arr.forEach((v,i)=>{
        const x=12+(w-24)*i/119, y=h-12-(h-28)*clamp(v/max,0,1);
        i?ctx.lineTo(x,y):ctx.moveTo(x,y);
      });ctx.stroke();
    };
    draw(coverage,100,"#38d9ff");
    draw(active,Math.max(1,Math.max(...active,1)),"#55e59b");
  },[coverage,active]);
  return <canvas ref={canvas}/>;
}

export default function App(){
  const initial=useMemo(()=>makeScenario(80),[]);
  const [drones,setDrones]=useState(initial.drones);
  const [survivors,setSurvivors]=useState(initial.survivors);
  const [buildings,setBuildings]=useState(initial.buildings);
  const [running,setRunning]=useState(false);
  const [connected,setConnected]=useState(false);
  const [count,setCount]=useState(80);
  const [speed,setSpeed]=useState(1);
  const [coverage,setCoverage]=useState(0);
  const [sos,setSos]=useState(0);
  const [target,setTarget]=useState(null);
  const [path,setPath]=useState([]);
  const [tick,setTick]=useState(0);
  const [missionStart,setMissionStart]=useState(null);
  const [events,setEvents]=useState([]);
  const [layers,setLayers]=useState({grid:true,buildings:true,drones:true,survivors:true,path:true});
  const [chart,setChart]=useState({coverage:[],active:[]});

  const addEvent=(type,message)=>{
    setEvents(e=>[{time:new Date().toLocaleTimeString([],{hour12:false}),type,message},...e].slice(0,60));
  };

  const reset=()=>{
    const s=makeScenario(count);
    setDrones(s.drones);setSurvivors(s.survivors);setBuildings(s.buildings);
    setRunning(false);setCoverage(0);setSos(0);setTarget(null);setPath([]);setTick(0);
    setChart({coverage:[],active:[]});addEvent("SYSTEM","Scenario reset — Ghost Grid online");
  };

  const start=()=>{
    if(!missionStart)setMissionStart(Date.now());
    setRunning(true);
    addEvent("SYSTEM",`Swarm deployment initiated — ${count} scouts`);
    if(connected)fetch(`${BACKEND}/api/control/start`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({drone_count:count})
    }).catch(()=>{});
  };

  useEffect(()=>{
    let ws;
    try{
      ws=new WebSocket(WS_URL);
      ws.onopen=()=>{setConnected(true);addEvent("SYSTEM","FastAPI WebSocket telemetry online")};
      ws.onmessage=e=>{
        try{
          const d=JSON.parse(e.data);
          if(d.drones)setDrones(d.drones);
          if(d.survivors)setSurvivors(d.survivors);
          if(d.metrics){setCoverage(d.metrics.coverage??0);setSos(d.metrics.sos_events??0)}
          if(d.extraction_path)setPath(d.extraction_path);
          if(d.target)setTarget(d.target);
          if(typeof d.running==="boolean")setRunning(d.running);
          if(d.tick!=null)setTick(d.tick);
          if(d.event)addEvent((d.event.type||"SYSTEM").toUpperCase(),d.event.message||"Event received");
        }catch{}
      };
      ws.onerror=()=>setConnected(false);
      ws.onclose=()=>setConnected(false);
    }catch{}
    return()=>ws?.close();
  },[]);

  useEffect(()=>{
    if(!running||connected)return;
    const timer=setInterval(()=>{
      setTick(t=>t+1);
      setDrones(prev=>{
        let found=null;
        const next=prev.map(d=>{
          let ax=(Math.random()-.5)*.9,ay=(Math.random()-.5)*.9;
          for(const o of prev){
            if(o===d)continue;
            const dx=d.x-o.x,dy=d.y-o.y,dd=Math.hypot(dx,dy);
            if(dd>0&&dd<5){ax+=dx/dd*.4;ay+=dy/dd*.4}
          }
          if(target){
            const dx=target.x-d.x,dy=target.y-d.y,dd=Math.hypot(dx,dy)||1;
            ax+=dx/dd*1.15;ay+=dy/dd*1.15;
          }
          const vx=(d.vx*.75+ax*.25)*speed,vy=(d.vy*.75+ay*.25)*speed;
          const nd={...d,vx,vy,x:clamp(d.x+vx*.65,1,99),y:clamp(d.y+vy*.65,1,99),state:target?"SOS":"SEARCH"};
          for(const s of survivors){
            if(!s.found&&distance(nd,s)<2.6)found={drone:nd,s};
          }
          return nd;
        });
        if(found){
          setSurvivors(ss=>ss.map(s=>s.id===found.s.id?{...s,found:true}:s));
          setTarget(found.s);setSos(x=>x+1);
          const p=[];let x=8,y=8;
          while(Math.hypot(found.s.x-x,found.s.y-y)>3){
            p.push({x,y});x+=Math.sign(found.s.x-x)*Math.min(4,Math.abs(found.s.x-x));y+=Math.sign(found.s.y-y)*Math.min(4,Math.abs(found.s.y-y));
          }
          p.push({x:found.s.x,y:found.s.y});setPath(p);
          addEvent("SOS",`${found.drone.id} LOCATED ${found.s.id} — SOS BROADCAST`);
          addEvent("ASTAR",`SAFE EXTRACTION ROUTE CALCULATED — ${p.length} NODES`);
        }
        return next;
      });
      setCoverage(v=>clamp(v+.035*speed,0,100));
    },50);
    return()=>clearInterval(timer);
  },[running,connected,speed,target,survivors]);

  useEffect(()=>{
    setChart(c=>({
      coverage:[...c.coverage,coverage].slice(-120),
      active:[...c.active,drones.length].slice(-120)
    }));
  },[coverage,drones.length]);

  const found=survivors.filter(s=>s.found).length;
  const missionSeconds=missionStart?Math.floor((Date.now()-missionStart)/1000):0;
  const [clock,setClock]=useState(0);
  useEffect(()=>{const t=setInterval(()=>setClock(missionSeconds),250);return()=>clearInterval(t)},[missionSeconds]);

  const toggleLayer=k=>setLayers(l=>({...l,[k]:!l[k]}));

  return <div className="app">
    <header className="topbar">
      <div className="brand"><div className="logo">A</div><div><div className="brandName">APOLLO<span>-NET</span></div><div className="brandSub">HYBRID SWARM COMMAND CENTER</div></div></div>
      <div className="topStatus">
        <div className="statusPill"><span className={`statusDot ${connected?"online":"demo"}`}/>{connected?"BACKEND ONLINE":"LOCAL DEMO"}</div>
        <div className="statusPill"><Wifi size={13}/><b>{connected?"30 FPS":"DEMO"}</b></div>
        <div className="clock">T+ {pad(Math.floor(clock/60))}:{pad(clock%60)}</div>
      </div>
    </header>

    <section className="kpis">
      <Kpi title="ACTIVE SCOUTS" value={drones.length} suffix={` / ${drones.length}`} meta="LIVE TELEMETRY" icon={<Radar/>}/>
      <Kpi title="SURVIVORS" value={found} suffix={` / ${survivors.length}`} progress={survivors.length?found/survivors.length*100:0}/>
      <Kpi title="GRID COVERAGE" value={coverage.toFixed(1)} suffix="%" progress={coverage}/>
      <Kpi title="SOS EVENTS" value={sos} danger meta={target?"ACTIVE TARGET":"NO ACTIVE SIGNAL"} icon={<Target/>}/>
      <Kpi title="EXTRACTION" value={path.length>1?"LOCKED":target?"PLANNING":"STANDBY"} amber meta={path.length>1?`${path.length} NODES`:"A* ROUTE OFFLINE"}/>
    </section>

    <main className="mainGrid">
      <section className="panel mapPanel">
        <div className="panelHeader">
          <div><div className="kicker">LIVE TACTICAL VIEW</div><h2>Ghost Grid / Swarm Theater</h2></div>
          <div className="tools">{Object.keys(layers).map(k=><button key={k} className={layers[k]?"tool active":"tool"} onClick={()=>toggleLayer(k)}>{k==="buildings"?"STRUCTURES":k.toUpperCase()}</button>)}</div>
        </div>
        <div className="scene">
          <TacticalScene drones={drones} survivors={survivors} buildings={buildings} path={path} layers={layers}/>
          <div className="overlay tl">SCENARIO: <b>URBAN DISASTER</b><br/>GRID: <b>100 × 100</b></div>
          <div className="overlay tr">LAT <b>19.076000</b><br/>LON <b>72.877000</b></div>
          <div className="legend"><span>● SCOUT</span><span>● SURVIVOR</span><span>● RESTRICTED</span><span>● RUBBLE</span><span>━ A* EXTRACTION</span></div>
          <div className="scanline"/>
          <div className="compass">N</div>
        </div>
        <div className="mapFooter">
          <Readout label="SWARM STATE" value={running?"ACTIVE":"STANDBY"}/>
          <Readout label="VECTOR MODE" value={target?"SOS ATTRACTION":"EXPLORATION"}/>
          <Readout label="LAST TARGET" value={target?.id||"NONE"}/>
          <Readout label="SIM TICK" value={tick}/>
        </div>
      </section>

      <aside className="side">
        <section className="panel">
          <div className="panelHeader compact"><div><div className="kicker">MISSION CONTROL</div><h2>Command Console</h2></div><Activity size={14}/></div>
          <div className="stateRow"><span>CURRENT STATE</span><b className={running?"green":target?"red":"amber"}>{running?"RUNNING":target?"TARGET LOCKED":"STANDBY"}</b></div>
          <div className="commands">
            <button className="command primary" onClick={start}><span><Play/></span><div><b>DEPLOY SWARM</b><small>Initialize autonomous search</small></div></button>
            <button className="command warning" onClick={()=>{setRunning(false);addEvent("SYSTEM","Swarm movement paused")}}><span><Pause/></span><div><b>PAUSE SWARM</b><small>Hold all agent movement</small></div></button>
            <button className="command danger" onClick={reset}><span><RotateCcw/></span><div><b>RESET SCENARIO</b><small>Clear state and redeploy</small></div></button>
          </div>
          <div className="controls">
            <label>SCOUT COUNT<input type="number" min="5" max="500" value={count} onChange={e=>setCount(clamp(Number(e.target.value)||5,5,500))}/></label>
            <label>SIM SPEED <b>{speed.toFixed(2)}×</b><input type="range" min=".25" max="2" step=".25" value={speed} onChange={e=>setSpeed(Number(e.target.value))}/></label>
          </div>
        </section>

        <section className="panel">
          <div className="panelHeader compact"><div><div className="kicker">TIERED AI ARCHITECTURE</div><h2>Pipeline Status</h2></div><Cpu size={14}/></div>
          <Pipeline running={running} target={target} route={path.length>1}/>
        </section>

        <section className="panel">
          <div className="panelHeader compact"><div><div className="kicker">TARGET INTELLIGENCE</div><h2>Survivor / SOS</h2></div><Crosshair size={14}/></div>
          <div className="targetCard">
            <div className="targetIcon"><Target/></div>
            <div><b>{target?`SURVIVOR ${target.id} LOCKED`:"No target locked"}</b><small>{target?"TARGET CONFIRMED · SOS CONVERGENCE ACTIVE":"Waiting for scout detection event."}</small></div>
            <span className={target?"badge locked":"badge"}>{target?"SOS":"CLEAR"}</span>
          </div>
        </section>

        <section className="panel eventsPanel">
          <div className="panelHeader compact"><div><div className="kicker">SYSTEM LOG</div><h2>Live Events</h2></div><button className="clear" onClick={()=>setEvents([])}>CLEAR</button></div>
          <div className="events">{events.map((e,i)=><div className="event" key={i}><time>{e.time}</time><b className={e.type}>{e.type}</b><span>{e.message}</span></div>)}</div>
        </section>
      </aside>
    </main>

    <section className="bottomGrid">
      <section className="panel chartPanel">
        <div className="panelHeader compact"><div><div className="kicker">PERFORMANCE TELEMETRY</div><h2>Search Performance</h2></div><div className="chartLegend">━ Coverage &nbsp; <i>━</i> Active scouts</div></div>
        <PerformanceChart coverage={chart.coverage} active={chart.active}/>
      </section>
      <section className="panel architecture">
        <div className="panelHeader compact"><div><div className="kicker">HYBRID DECISION MODEL</div><h2>Discovery → Extraction</h2></div></div>
        <div className="flow"><Flow n="01" title="DECENTRALIZED" text="Boids / coverage / avoidance"/><strong>→</strong><Flow n="02" title="SOS SIGNAL" text="Target confirmation"/><strong>→</strong><Flow n="03" title="CENTRALIZED" text="A* shortest safe route"/></div>
      </section>
    </section>

    <footer>APOLLO-NET v4.0 <span>VISION-GUIDED SWARM SEARCH & RESCUE SIMULATION</span><span>BACKEND: {BACKEND.replace("http://","")}</span></footer>
  </div>
}

function Kpi({title,value,suffix="",meta="",progress, danger,amber,icon}){
  return <article className="kpi panel"><div className="kicker">{title}</div><div className={`kpiValue ${danger?"danger":amber?"amber":""}`}>{value}<small>{suffix}</small></div>{icon&&<div className="kpiIcon">{icon}</div>}{progress!=null&&<div className="progress"><i style={{width:`${progress}%`}}/></div>} {meta&&<div className="meta">{meta}</div>}</article>
}
function Readout({label,value}){return <div><small>{label}</small><b>{value}</b></div>}
function Flow({n,title,text}){return <div className="flowNode"><small>{n}</small><b>{title}</b><span>{text}</span></div>}
function Pipeline({running,target,route}){
  const rows=[
    ["01","AERIAL IMAGE INPUT","Image ingestion","ONLINE"],
    ["02","COMPUTER VISION","Terrain analysis","ONLINE"],
    ["03","GHOST GRID","Dynamic occupancy map","ONLINE"],
    ["04","SWARM VECTOR ENGINE","Multi-agent navigation",running?"ACTIVE":"STANDBY"],
    ["05","SOS CONVERGENCE","Target attraction",target?"LOCKED":"STANDBY"],
    ["06","A* EXTRACTION","Optimal route planning",route?"ROUTE READY":"STANDBY"]
  ];
  return <div className="pipeline">{rows.map(r=><div className={`step ${r[3]!=="STANDBY"?"on":""}`} key={r[0]}><small>{r[0]}</small><div><b>{r[1]}</b><span>{r[2]}</span></div><em>{r[3]}</em></div>)}</div>
}
