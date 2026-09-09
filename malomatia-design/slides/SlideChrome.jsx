/* malomatia deck — shared slide helpers */
const SlideMeta = ({label}) => (
  <div style={{position:'absolute', top:56, left:80, display:'flex', alignItems:'center', gap:16, zIndex:5}}>
    <img src="../assets/logos/malomatia-logo.png" style={{height:28}} />
    <div style={{width:1, height:24, background:'#D9D9D9'}} />
    <div style={{fontSize:11, letterSpacing:'.22em', fontWeight:600, color:'#4A4A4A', textTransform:'uppercase'}}>{label}</div>
  </div>
);

const SlideFooter = ({page, total}) => (
  <div style={{position:'absolute', bottom:48, left:80, right:80, display:'flex',
    justifyContent:'space-between', alignItems:'center', fontSize:11, letterSpacing:'.2em',
    fontWeight:600, color:'#777', textTransform:'uppercase', zIndex:5}}>
    <span>2025 &nbsp;·&nbsp; Corporate Overview</span>
    <span>{String(page).padStart(2,'0')} / {String(total).padStart(2,'0')}</span>
  </div>
);

const SlideBadge = ({kind='external'}) => (
  <div style={{position:'absolute', top:56, right:80, fontSize:10, letterSpacing:'.18em',
    textTransform:'uppercase', fontWeight:700, padding:'6px 12px',
    background: kind==='external' ? 'transparent' : '#CF0A2C',
    color: kind==='external' ? '#777' : '#fff',
    border: kind==='external' ? '1px solid #D9D9D9' : 'none', zIndex:5}}>
    {kind} use
  </div>
);

Object.assign(window, { SlideMeta, SlideFooter, SlideBadge });
