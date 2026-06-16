import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import satori from 'satori';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root      = path.join(__dirname, '..');
const fontsDir  = path.join(root, 'public', 'fonts');
const outDir    = path.join(root, 'public', 'previews');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

function readFont(name) {
  const buf = fs.readFileSync(path.join(fontsDir, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
const boldAB    = readFont('Inter-Bold.woff');
const regularAB = readFont('Inter-Regular.woff');
const fonts = [
  { name: 'Inter', data: boldAB,    weight: 700, style: 'normal' },
  { name: 'Inter', data: regularAB, weight: 400, style: 'normal' },
];

const RED  = '#e63946';
const GOLD = '#ffa500';
const NAVY = '#0d1420';
const DARK = '#1a1428';
const BODY = 'rgba(255,255,255,0.55)';

async function render(el, name) {
  try {
    const svg  = await satori(el, { width: 1080, height: 1080, fonts });
    const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
    fs.writeFileSync(path.join(outDir, name), jpeg);
    console.log('Saved ' + name + ' (' + Math.round(jpeg.length / 1024) + ' KB)');
  } catch(err) {
    console.error('FAILED ' + name + ':', err.message ?? String(err));
  }
}

const circles = [100,180,260,340,420,500].map(r => ({
  type:'circle',
  props:{ cx:'540', cy:'540', r:String(r), fill:'none', stroke:RED, strokeWidth:'1', opacity:'0.12' }
}));

function opt(letter, text) {
  return { type:'div', props:{ style:{
    display:'flex', alignItems:'center', gap:'20px',
    padding:'18px 24px', background:'rgba(255,255,255,0.05)',
    border:'1.5px solid rgba(255,255,255,0.10)', borderRadius:'12px'
  }, children:[
    { type:'div', props:{ style:{
        display:'flex', alignItems:'center', justifyContent:'center',
        width:'52px', height:'52px', borderRadius:'8px',
        background:'rgba(255,255,255,0.12)', flexShrink:0
      }, children:{ type:'div', props:{ style:{ color:'white', fontSize:'26px', fontWeight:'700' }, children:letter } } } },
    { type:'div', props:{ style:{ color:'rgba(255,255,255,0.80)', fontSize:'28px', lineHeight:'1.4' }, children:text } },
  ]}};
}

function bullet(text) {
  return { type:'div', props:{ style:{ display:'flex', alignItems:'flex-start', gap:'18px' }, children:[
    { type:'div', props:{ style:{ width:'12px', height:'12px', borderRadius:'50%', background:RED, flexShrink:'0', marginTop:'10px' } } },
    { type:'div', props:{ style:{ color:BODY, fontSize:'28px', lineHeight:'1.5', flex:'1' }, children:text } },
  ]}};
}

function goldHeader(label) {
  return { type:'div', props:{ style:{ display:'flex', alignItems:'center', justifyContent:'center', gap:'20px', marginBottom:'16px' }, children:[
    { type:'div', props:{ style:{ height:'2px', width:'70px', background:GOLD + '50' } } },
    { type:'div', props:{ style:{ color:GOLD, fontSize:'28px', fontWeight:'700', letterSpacing:'5px' }, children:label } },
    { type:'div', props:{ style:{ height:'2px', width:'70px', background:GOLD + '50' } } },
  ]}};
}

function watermark() {
  return { type:'div', props:{ style:{ display:'flex', alignItems:'center', justifyContent:'center', gap:'10px', marginTop:'16px' }, children:[
    { type:'div', props:{ style:{ color:RED, fontSize:'20px' }, children:'♥' } },
    { type:'div', props:{ style:{ color:RED + '66', fontSize:'20px', letterSpacing:'4px', fontWeight:'700' }, children:'@interventional_heart' } },
  ]}};
}

const ecgPoints = '0,66 66,66 90,66 102,18 114,114 126,66 180,66 264,66 288,66 300,12 312,120 324,66 378,66 462,66 486,66 498,9 510,117 522,66 576,66 672,66 696,66 708,18 720,114 732,66 786,66 900,66 1080,66';

// ── 1. ECG QUIZ ───────────────────────────────────────────────────────────────
await render({
  type:'div', props:{ style:{ width:'1080px', height:'1080px', background:NAVY,
    position:'relative', display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:'Inter' }, children:[
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, height:'8px', background:RED } } },
    { type:'div', props:{ style:{ position:'absolute', bottom:0, left:0, right:0, height:'8px', background:RED } } },
    { type:'svg', props:{ viewBox:'0 0 1080 1080', style:{ position:'absolute', top:0, left:0, width:'1080px', height:'1080px' }, children:circles } },
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, bottom:0,
        display:'flex', flexDirection:'column', padding:'50px 60px' }, children:[
      goldHeader('⚡ ECG CHALLENGE'),
      { type:'div', props:{ style:{ height:'110px', background:RED + '08', border:'1.5px solid ' + RED + '22',
          borderRadius:'14px', marginBottom:'4px', position:'relative', overflow:'hidden', flexShrink:0, display:'flex' }, children:[
        { type:'div', props:{ style:{ position:'absolute', top:'8px', left:'14px', color:RED + '55', fontSize:'20px' }, children:'25mm/s · 10mm/mV' } },
        { type:'svg', props:{ viewBox:'0 0 1080 132', style:{ width:'1080px', height:'110px', position:'absolute', top:0, left:0 }, children:[
          ...[1,2,3,4,5].map(i => ({ type:'line', props:{ x1:String(i*180), y1:'0', x2:String(i*180), y2:'132', stroke:RED + '30', strokeWidth:'1' } })),
          { type:'polyline', props:{ points:ecgPoints, fill:'none', stroke:RED, strokeWidth:'5', strokeLinecap:'round', strokeLinejoin:'round' } },
        ]}},
      ]}},
      { type:'div', props:{ style:{ flex:'1', display:'flex', alignItems:'center', justifyContent:'center' }, children:{
        type:'div', props:{ style:{ color:'white', fontSize:'48px', fontWeight:'700', textAlign:'center', lineHeight:'1.3' },
        children:'45-year-old male. HR 170, wide QRS complex. What is the rhythm?' }
      }}},
      { type:'div', props:{ style:{ display:'flex', flexDirection:'column', gap:'12px' }, children:[
        opt('A','Ventricular Tachycardia'),
        opt('B','SVT with aberrancy'),
        opt('C','Wolff-Parkinson-White Syndrome'),
        opt('D','Atrial Flutter 2:1 block'),
      ]}},
      { type:'div', props:{ style:{ display:'flex', flexDirection:'column', alignItems:'center', paddingTop:'22px', gap:'4px' }, children:[
        { type:'div', props:{ style:{ color:RED, fontSize:'26px', fontWeight:'700' }, children:'🎯 Post your interpretation below' } },
      ]}},
      { type:'div', props:{ style:{ display:'flex', justifyContent:'center', paddingTop:'6px' }, children:{ type:'div', props:{ style:{ color:RED, fontSize:'24px' }, children:'♥' } }}},
    ]}},
  ]}
}, 'ecg-quiz.jpg');

// ── 2. REGULAR QUIZ ───────────────────────────────────────────────────────────
await render({
  type:'div', props:{ style:{ width:'1080px', height:'1080px', background:NAVY,
    position:'relative', display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:'Inter' }, children:[
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, height:'8px', background:RED } } },
    { type:'div', props:{ style:{ position:'absolute', bottom:0, left:0, right:0, height:'8px', background:RED } } },
    { type:'svg', props:{ viewBox:'0 0 1080 1080', style:{ position:'absolute', top:0, left:0, width:'1080px', height:'1080px' }, children:circles } },
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, bottom:0,
        display:'flex', flexDirection:'column', padding:'50px 60px' }, children:[
      goldHeader('CARDIOLOGY — CHALLENGE'),
      { type:'div', props:{ style:{ height:'2px', background:'rgba(255,255,255,0.08)', marginBottom:'20px' } } },
      { type:'div', props:{ style:{ flex:'1', display:'flex', alignItems:'center', justifyContent:'center' }, children:{
        type:'div', props:{ style:{ color:'white', fontSize:'52px', fontWeight:'700', textAlign:'center', lineHeight:'1.3' },
        children:'A patient with STEMI undergoes primary PCI. Which antiplatelet agent is preferred?' }
      }}},
      { type:'div', props:{ style:{ display:'flex', flexDirection:'column', gap:'14px' }, children:[
        opt('A','Aspirin + Clopidogrel'),
        opt('B','Aspirin + Ticagrelor'),
        opt('C','Aspirin alone'),
        opt('D','Warfarin + Aspirin'),
      ]}},
      { type:'div', props:{ style:{ display:'flex', flexDirection:'column', alignItems:'center', paddingTop:'24px', gap:'6px' }, children:[
        { type:'div', props:{ style:{ color:RED, fontSize:'28px', fontWeight:'700' }, children:'🎯 Comment your answer' } },
        { type:'div', props:{ style:{ color:'rgba(255,255,255,0.45)', fontSize:'22px' }, children:'before seeing the next post!' } },
      ]}},
      { type:'div', props:{ style:{ display:'flex', justifyContent:'center', paddingTop:'8px' }, children:{ type:'div', props:{ style:{ color:RED, fontSize:'24px' }, children:'♥' } }}},
    ]}},
  ]}
}, 'quiz.jpg');

// ── 3. EDUCATIONAL ────────────────────────────────────────────────────────────
await render({
  type:'div', props:{ style:{ width:'1080px', height:'1080px', background:DARK,
    position:'relative', display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:'Inter' }, children:[
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, height:'8px', backgroundImage:'linear-gradient(90deg,' + RED + ',#ff6b35,' + GOLD + ')' } } },
    { type:'div', props:{ style:{ position:'absolute', bottom:0, left:0, right:0, height:'8px', backgroundImage:'linear-gradient(90deg,' + RED + ',#ff6b35,' + GOLD + ')' } } },
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, bottom:0, width:'18px', background:RED } } },
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, bottom:0, display:'flex', flexDirection:'column', padding:'60px 56px' }, children:[
      goldHeader('📚 Educational'),
      { type:'div', props:{ style:{ height:'2px', background:'rgba(255,255,255,0.08)', marginBottom:'28px' } } },
      { type:'div', props:{ style:{ color:'white', fontSize:'50px', fontWeight:'700', textAlign:'center', lineHeight:'1.2', marginBottom:'36px' },
        children:'5 Signs of Silent Heart Attack You Must Know' }},
      { type:'div', props:{ style:{ display:'flex', flexDirection:'column', gap:'18px', flex:'1' }, children:[
        bullet('Unusual fatigue lasting days — not just tiredness'),
        bullet('Jaw, neck or shoulder discomfort with no clear cause'),
        bullet('Shortness of breath with minimal exertion'),
        bullet('Cold sweats and nausea without fever'),
        bullet('Indigestion that does not respond to antacids'),
      ]}},
      { type:'div', props:{ style:{ height:'2px', background:RED + '40', marginTop:'20px' } } },
      watermark(),
    ]}},
  ]}
}, 'educational.jpg');

// ── 4. MYTH vs FACT ───────────────────────────────────────────────────────────
await render({
  type:'div', props:{ style:{ width:'1080px', height:'1080px', background:DARK,
    position:'relative', display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:'Inter' }, children:[
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, height:'8px', backgroundImage:'linear-gradient(90deg,' + RED + ',#ff6b35,' + GOLD + ')' } } },
    { type:'div', props:{ style:{ position:'absolute', bottom:0, left:0, right:0, height:'8px', backgroundImage:'linear-gradient(90deg,' + RED + ',#ff6b35,' + GOLD + ')' } } },
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, bottom:0, width:'18px', background:RED } } },
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, bottom:0, display:'flex', flexDirection:'column', padding:'60px 56px' }, children:[
      goldHeader('MYTH vs FACT'),
      { type:'div', props:{ style:{ height:'2px', background:'rgba(255,255,255,0.08)', marginBottom:'28px' } } },
      { type:'div', props:{ style:{ display:'flex', flexDirection:'column', alignItems:'center', gap:'18px',
          padding:'28px', background:RED + '12', border:'1.5px solid ' + RED + '40', borderRadius:'14px', marginBottom:'20px' }, children:[
        { type:'div', props:{ style:{ color:'#fca5a5', fontSize:'24px', fontWeight:'700', letterSpacing:'4px' }, children:'✕ COMMON MYTH' } },
        { type:'div', props:{ style:{ color:'white', fontSize:'42px', fontWeight:'700', textAlign:'center', lineHeight:'1.25' }, children:'Young people cannot have heart attacks' }},
      ]}},
      { type:'div', props:{ style:{ display:'flex', flexDirection:'column', alignItems:'center', gap:'18px',
          padding:'28px', background:'rgba(34,197,94,0.08)', border:'1.5px solid rgba(34,197,94,0.35)', borderRadius:'14px', flex:'1' }, children:[
        { type:'div', props:{ style:{ color:'#86efac', fontSize:'24px', fontWeight:'700', letterSpacing:'4px' }, children:'✓ THE FACT' } },
        { type:'div', props:{ style:{ color:'rgba(255,255,255,0.85)', fontSize:'34px', textAlign:'center', lineHeight:'1.4' },
          children:'1 in 5 heart attacks occurs under 40. Rising risk factors: obesity, smoking, stress. Know the signs and act early.' }},
      ]}},
      watermark(),
    ]}},
  ]}
}, 'myth-fact.jpg');

// ── 5. CLINICAL PEARL ─────────────────────────────────────────────────────────
await render({
  type:'div', props:{ style:{ width:'1080px', height:'1080px', background:DARK,
    position:'relative', display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:'Inter' }, children:[
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, height:'8px', backgroundImage:'linear-gradient(90deg,' + RED + ',#ff6b35,' + GOLD + ')' } } },
    { type:'div', props:{ style:{ position:'absolute', bottom:0, left:0, right:0, height:'8px', backgroundImage:'linear-gradient(90deg,' + RED + ',#ff6b35,' + GOLD + ')' } } },
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, bottom:0, width:'18px', background:RED } } },
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, bottom:0, display:'flex', flexDirection:'column', padding:'60px 56px' }, children:[
      goldHeader('💎 Clinical Pearl'),
      { type:'div', props:{ style:{ height:'2px', background:'rgba(255,255,255,0.07)', marginBottom:'28px' } } },
      { type:'div', props:{ style:{ color:'white', fontSize:'50px', fontWeight:'700', textAlign:'center', lineHeight:'1.2', marginBottom:'36px' },
        children:'Radial access reduces major bleeding by 40% vs femoral in ACS patients' }},
      { type:'div', props:{ style:{ display:'flex', flexDirection:'column', gap:'20px', flex:'1' }, children:[
        bullet('MATRIX trial: radial access cut net adverse events by 17%'),
        bullet('Door-to-balloon time is NOT longer with radial — same efficiency'),
        bullet('Patient comfort is significantly higher — less hematoma, earlier mobilisation'),
        bullet('ACC/AHA 2021 guidelines: radial preferred for ACS PCI (Class I, LOE A)'),
      ]}},
      { type:'div', props:{ style:{ display:'flex', alignItems:'center', justifyContent:'center', gap:'14px', marginTop:'18px' }, children:[
        { type:'div', props:{ style:{ height:'1px', flex:'1', background:'rgba(255,255,255,0.08)' } } },
        { type:'div', props:{ style:{ color:GOLD + '90', fontSize:'20px' }, children:'💎 Save for ward rounds' } },
        { type:'div', props:{ style:{ height:'1px', flex:'1', background:'rgba(255,255,255,0.08)' } } },
      ]}},
      watermark(),
    ]}},
  ]}
}, 'clinical-pearl.jpg');

// ── 6. CAROUSEL COVER ─────────────────────────────────────────────────────────
await render({
  type:'div', props:{ style:{ width:'1080px', height:'1080px', background:NAVY,
    position:'relative', display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:'Inter' }, children:[
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, height:'10px', background:RED } } },
    { type:'div', props:{ style:{ position:'absolute', bottom:0, left:0, right:0, height:'10px', background:RED } } },
    { type:'svg', props:{ viewBox:'0 0 1080 1080', style:{ position:'absolute', top:0, left:0, width:'1080px', height:'1080px' },
      children:[100,200,310,430,560,700].map(r => ({ type:'circle', props:{ cx:'540', cy:'540', r:String(r), fill:'none', stroke:RED, strokeWidth:'1', opacity:'0.08' } })) }},
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, bottom:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'70px 70px' }, children:[
      goldHeader('👆 SWIPE TO LEARN'),
      { type:'div', props:{ style:{ height:'2px', width:'100%', background:'rgba(255,255,255,0.07)', marginBottom:'40px' } } },
      { type:'div', props:{ style:{ color:'white', fontSize:'72px', fontWeight:'700', textAlign:'center', lineHeight:'1.15', marginBottom:'36px' },
        children:'5 Things Every Doctor Must Know About STEMI Management' }},
      { type:'div', props:{ style:{ display:'flex', flexDirection:'column', gap:'16px', width:'100%', marginBottom:'36px' }, children:[
        ...[
          'Time is muscle — door-to-balloon < 90 minutes',
          'Dual antiplatelet therapy within 12 hours',
          'Radial access preferred over femoral access',
        ].map(t => ({ type:'div', props:{ style:{ display:'flex', alignItems:'flex-start', gap:'16px' }, children:[
          { type:'div', props:{ style:{ width:'10px', height:'10px', borderRadius:'50%', background:RED, flexShrink:0, marginTop:'12px' } } },
          { type:'div', props:{ style:{ color:'rgba(255,255,255,0.55)', fontSize:'28px', lineHeight:'1.4', flex:'1' }, children:t } },
        ]}})),
      ]}},
      { type:'div', props:{ style:{ display:'flex', alignItems:'center', gap:'14px', background:RED + '18', border:'1.5px solid ' + RED + '40', borderRadius:'100px', padding:'16px 36px' }, children:[
        { type:'div', props:{ style:{ color:RED, fontSize:'28px' }, children:'➡️' } },
        { type:'div', props:{ style:{ color:'rgba(255,255,255,0.85)', fontSize:'28px', fontWeight:'600' }, children:'Swipe through all 5 slides' } },
      ]}},
      watermark(),
    ]}},
  ]}
}, 'carousel-cover.jpg');

// ── 7. CAROUSEL CONTENT SLIDE ─────────────────────────────────────────────────
await render({
  type:'div', props:{ style:{ width:'1080px', height:'1080px', background:DARK,
    position:'relative', display:'flex', flexDirection:'column', overflow:'hidden', fontFamily:'Inter' }, children:[
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, height:'8px', background:RED } } },
    { type:'div', props:{ style:{ position:'absolute', bottom:0, left:0, right:0, height:'8px', background:RED } } },
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, bottom:0, width:'18px', background:RED } } },
    { type:'div', props:{ style:{ position:'absolute', top:0, left:0, right:0, bottom:0, display:'flex', flexDirection:'column', padding:'52px 56px' }, children:[
      { type:'div', props:{ style:{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'18px' }, children:[
        { type:'div', props:{ style:{ color:GOLD, fontSize:'24px', fontWeight:'700', letterSpacing:'4px' }, children:'CARDIOLOGY INSIGHT' } },
        { type:'div', props:{ style:{ display:'flex', alignItems:'center', gap:'8px', background:RED + '20', border:'1px solid ' + RED + '40', borderRadius:'8px', padding:'6px 16px' }, children:{
          type:'div', props:{ style:{ color:RED, fontSize:'22px', fontWeight:'700' }, children:'02 / 05' }
        }}},
      ]}},
      { type:'div', props:{ style:{ height:'2px', background:'rgba(255,255,255,0.08)', marginBottom:'32px' } } },
      { type:'div', props:{ style:{ color:'white', fontSize:'58px', fontWeight:'700', lineHeight:'1.2', marginBottom:'36px' },
        children:'Door-to-Balloon Time: Why Every Minute Matters' }},
      { type:'div', props:{ style:{ display:'flex', flexDirection:'column', gap:'22px', flex:'1' }, children:[
        bullet('Each 10-minute delay → 7.5% increase in 30-day mortality'),
        bullet('Culprit artery reperfusion within 12h reduces infarct size by 40%'),
        bullet('Pre-hospital ECG transmission cuts D2B time by 20 minutes'),
        bullet('ACC/AHA target: D2B < 90 min from first medical contact'),
      ]}},
      { type:'div', props:{ style:{ height:'2px', background:RED + '40', marginTop:'24px' } } },
      watermark(),
    ]}},
  ]}
}, 'carousel-slide.jpg');

console.log('\nAll 7 preview cards saved to public/previews/');
