/* global React */
const { useState } = React;

// ===== Header =====
function Header() {
  const [open, setOpen] = useState(false);
  return (
    <header style={{
      position:'sticky', top:0, zIndex:100, background:'rgba(255,255,255,.92)',
      backdropFilter:'blur(8px)', borderBottom:'1px solid var(--grey-200)'
    }}>
      <div style={{maxWidth:1280, margin:'0 auto', display:'flex', alignItems:'center', gap:32, padding:'18px 32px'}}>
        <a href="#" style={{display:'flex', alignItems:'center', textDecoration:'none'}}>
          <img src="../../assets/logos/malomatia-logo.png" alt="malomatia" style={{height:32}} />
        </a>
        <nav style={{display:'flex', gap:28, flex:1, marginLeft:24}}>
          {['Services','Sectors','About','Insights','Careers'].map(l => (
            <a key={l} href={`#${l.toLowerCase()}`} style={{
              fontSize:14, color:'#000', fontWeight:500, textDecoration:'none', letterSpacing:'.01em'
            }}>{l}</a>
          ))}
        </nav>
        <a href="#contact" style={{
          fontSize:13, fontWeight:600, color:'#fff', background:'#CF0A2C',
          padding:'10px 20px', borderRadius:2, textDecoration:'none', letterSpacing:'.02em'
        }}>Get in touch</a>
      </div>
    </header>
  );
}

// ===== Hero =====
function Hero() {
  return (
    <section style={{position:'relative', height:'78vh', minHeight:560, color:'#fff', overflow:'hidden'}}>
      <img src="../../assets/imagery/qatar-skyline-arches.jpg"
        style={{position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:.55}} />
      <div style={{position:'absolute', inset:0,
        background:'linear-gradient(135deg, rgba(0,0,0,.85), rgba(0,0,0,.35) 60%, rgba(207,10,44,.45))'}} />
      <div style={{position:'relative', maxWidth:1280, margin:'0 auto', padding:'0 32px',
        height:'100%', display:'flex', flexDirection:'column', justifyContent:'flex-end', paddingBottom:96}}>
        <div style={{fontSize:13, fontWeight:600, letterSpacing:'.18em', textTransform:'uppercase',
          color:'#CF0A2C', marginBottom:24}}>Corporate Overview · 2025</div>
        <h1 style={{fontFamily:'var(--font-display)', fontWeight:300,
          fontSize:'clamp(56px, 9vw, 124px)', lineHeight:.95, letterSpacing:'-.02em',
          textTransform:'lowercase', margin:0}}>
          reimagining<br/>
          <span style={{color:'#CF0A2C'}}>what's possible</span>
        </h1>
        <p style={{fontSize:'clamp(16px, 1.7vw, 22px)', color:'rgba(255,255,255,.85)',
          marginTop:24, maxWidth:720, fontWeight:300, lineHeight:1.5}}>
          Sparking innovation and championing collaboration to propel Qatar into a new era of digital excellence — anchored in Doha since 2008.
        </p>
        <div style={{display:'flex', gap:14, marginTop:36}}>
          <a href="#services" style={{
            background:'#CF0A2C', color:'#fff', padding:'14px 26px', fontSize:14, fontWeight:600,
            textDecoration:'none', borderRadius:2, letterSpacing:'.02em'
          }}>Explore our services</a>
          <a href="#stories" style={{
            background:'transparent', color:'#fff', padding:'14px 26px', fontSize:14, fontWeight:600,
            textDecoration:'none', borderRadius:2, border:'1px solid rgba(255,255,255,.4)'
          }}>See client stories</a>
        </div>
      </div>
    </section>
  );
}

// ===== Stats Strip =====
function StatsStrip() {
  const stats = [
    {n:'2008', l:'Established · QIA-owned', accent:true},
    {n:'500+', l:'Projects delivered'},
    {n:'2,200+', l:'Specialists'},
    {n:'7+', l:'Sectors served'},
  ];
  return (
    <section style={{borderBottom:'1px solid var(--grey-200)'}}>
      <div style={{maxWidth:1280, margin:'0 auto', padding:'56px 32px',
        display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:32}}>
        {stats.map((s,i) => (
          <div key={i} style={{borderLeft: i===0 ? 'none' : '1px solid var(--grey-200)', paddingLeft: i===0 ? 0 : 24}}>
            <div style={{fontFamily:'var(--font-display)', fontSize:'clamp(48px, 5vw, 80px)',
              lineHeight:.95, color: s.accent ? '#CF0A2C' : '#000', fontWeight:400, letterSpacing:'-.01em'}}>{s.n}</div>
            <div style={{fontSize:11, fontWeight:600, letterSpacing:'.14em', textTransform:'uppercase',
              color:'var(--fg-2)', marginTop:14}}>{s.l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ===== Services =====
function Services() {
  const [active, setActive] = useState('All');
  const cats = ['All','Cybersecurity','Cloud','Data & AI','BPO'];
  const services = [
    {icon:'shield-check', t:'Cybersecurity', d:"Qatar's largest SOC, 100K+ assets monitored 24/7. Exclusive Microsoft Cloud Security Partner.", cat:'Cybersecurity'},
    {icon:'cloud', t:'Cloud Solutions', d:'Migration, hybrid and multi-cloud architectures, ongoing optimisation across the largest workloads.', cat:'Cloud'},
    {icon:'server', t:'IT Managed Services', d:'24/7 NOC, network and data centre operations across mission-critical national infrastructure.', cat:'Cloud'},
    {icon:'code', t:'Application Development', d:'Custom software, system integration, continuous modernisation aligned to evolving needs.', cat:'Data & AI'},
    {icon:'layout-grid', t:'Enterprise Applications', d:'Oracle, SAP and Jaggaer ERP/CRM transformations for government and enterprise.', cat:'Data & AI'},
    {icon:'brain-circuit', t:'Data & AI', d:'Strategy, dashboards, AI-powered automation. National platforms incl. Customs, SAB, TASMU.', cat:'Data & AI'},
    {icon:'headphones', t:'Contact Centre', d:'Qatar\u2019s largest COPC-certified centre. 1.2M+ monthly transactions, scaled to 1,000+ for FIFA 2022.', cat:'BPO'},
    {icon:'git-branch', t:'Business Process Outsourcing', d:'Back-office, customer engagement, RPA-led smart operations and KPO at national scale.', cat:'BPO'},
  ];
  const filtered = active === 'All' ? services : services.filter(s => s.cat === active);
  return (
    <section id="services" style={{padding:'96px 32px', background:'#fff'}}>
      <div style={{maxWidth:1280, margin:'0 auto'}}>
        <div style={{fontSize:12, fontWeight:600, letterSpacing:'.18em', textTransform:'uppercase',
          color:'#CF0A2C'}}>Our Core Services</div>
        <h2 style={{fontSize:'clamp(36px, 4vw, 56px)', fontWeight:600, letterSpacing:'-.02em',
          lineHeight:1.1, margin:'14px 0 32px', maxWidth:880}}>
          Driving Government &amp; Enterprise<br/>with full-spectrum ICT.
        </h2>
        <div style={{display:'flex', gap:8, marginBottom:40, flexWrap:'wrap'}}>
          {cats.map(c => (
            <button key={c} onClick={() => setActive(c)} style={{
              fontFamily:'var(--font-sans)', fontSize:12, fontWeight:500,
              padding:'6px 14px', borderRadius:999,
              background: active === c ? '#000' : 'transparent',
              color: active === c ? '#fff' : '#4A4A4A',
              border: '1px solid ' + (active === c ? '#000' : 'var(--grey-300)'),
              cursor:'pointer', letterSpacing:'.02em'
            }}>{c}</button>
          ))}
        </div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:18}}>
          {filtered.map((s,i) => (
            <article key={s.t} style={{
              background: i === 0 ? '#000' : '#FAFAFA',
              color: i === 0 ? '#fff' : '#000',
              padding:'32px 26px', minHeight:240, display:'flex', flexDirection:'column',
              borderRadius:2, transition:'transform .25s, box-shadow .25s', cursor:'pointer'
            }} onMouseOver={e => e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,.08)'}
               onMouseOut={e => e.currentTarget.style.boxShadow='none'}>
              <i data-lucide={s.icon} style={{width:30, height:30, stroke:'#CF0A2C', strokeWidth:1.5, fill:'none'}} />
              <h3 style={{fontSize:18, fontWeight:600, marginTop:'auto', marginBottom:8}}>{s.t}</h3>
              <p style={{fontSize:13, lineHeight:1.55, color: i === 0 ? '#999' : '#4A4A4A', margin:0}}>{s.d}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

// ===== Sectors =====
function Sectors() {
  const sectors = [
    {icon:'landmark', t:'Government', d:'7 ministries · 12 authorities'},
    {icon:'fuel', t:'Oil & Gas', d:'Mission-critical infrastructure'},
    {icon:'heart-pulse', t:'Healthcare', d:'HMC · MoPH · national platforms'},
    {icon:'building-2', t:'Banking', d:'Core systems &amp; security'},
    {icon:'truck', t:'Logistics', d:'Customs · ports · supply chain'},
    {icon:'graduation-cap', t:'Education', d:'MoEHE distance-learning at scale'},
  ];
  return (
    <section id="sectors" style={{padding:'96px 32px', background:'#000', color:'#fff'}}>
      <div style={{maxWidth:1280, margin:'0 auto'}}>
        <div style={{fontSize:12, fontWeight:600, letterSpacing:'.18em', textTransform:'uppercase', color:'#CF0A2C'}}>
          Our Clients per Sector
        </div>
        <h2 style={{fontSize:'clamp(36px, 4vw, 56px)', fontWeight:600, letterSpacing:'-.02em',
          lineHeight:1.1, margin:'14px 0 56px', maxWidth:980, color:'#fff'}}>
          Trusted by leading organizations driving{' '}
          <span style={{color:'#CF0A2C', fontFamily:'var(--font-display)', fontWeight:400, textTransform:'lowercase'}}>qatar's</span> digital future.
        </h2>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:32}}>
          {sectors.map(s => (
            <div key={s.t} style={{borderTop:'1px solid rgba(255,255,255,.15)', paddingTop:24}}>
              <i data-lucide={s.icon} style={{width:32, height:32, stroke:'#CF0A2C', strokeWidth:1.5, fill:'none'}} />
              <div style={{fontSize:24, fontWeight:600, marginTop:16}}>{s.t}</div>
              <div style={{fontSize:14, color:'#999', marginTop:6}} dangerouslySetInnerHTML={{__html:s.d}} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ===== Featured Success Story =====
function FeaturedStory() {
  return (
    <section id="stories" style={{display:'grid', gridTemplateColumns:'1fr 1fr', minHeight:560}}>
      <div style={{position:'relative', backgroundImage:'url(../../assets/imagery/server-cables.jpg)',
        backgroundSize:'cover', backgroundPosition:'center'}}>
        <div style={{position:'absolute', inset:0,
          background:'linear-gradient(to right, rgba(0,0,0,.4), rgba(0,0,0,.7))'}} />
        <div style={{position:'absolute', left:48, bottom:48, color:'#fff'}}>
          <div style={{fontSize:11, letterSpacing:'.16em', textTransform:'uppercase',
            color:'rgba(255,255,255,.7)', fontWeight:600}}>Client</div>
          <div style={{fontFamily:'var(--font-display)', fontWeight:300, fontSize:48, lineHeight:1.05,
            textTransform:'uppercase', letterSpacing:'-.01em', marginTop:12}}>
            General Authority<br/>of Customs
          </div>
        </div>
      </div>
      <div style={{padding:'72px 56px', display:'flex', flexDirection:'column', background:'#fff'}}>
        <div style={{fontSize:12, fontWeight:600, letterSpacing:'.18em', textTransform:'uppercase', color:'#CF0A2C'}}>
          Featured success story
        </div>
        <h3 style={{fontSize:36, fontWeight:600, letterSpacing:'-.02em', lineHeight:1.1, margin:'14px 0 32px'}}>
          Al Nadeeb Platform<br/>
          <span style={{color:'#777', fontWeight:400}}>end-to-end digital customs</span>
        </h3>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:24, marginTop:'auto'}}>
          {[
            {n:'600%', l:'Platform growth', a:true},
            {n:'100%', l:'Uptime', a:true},
            {n:'5×', l:'Faster incident response'},
            {n:'27', l:'Integrations'},
          ].map(s => (
            <div key={s.l}>
              <div style={{fontFamily:'var(--font-display)', fontSize:64, lineHeight:.9,
                color: s.a ? '#CF0A2C' : '#000', fontWeight:400}}>{s.n}</div>
              <div style={{fontSize:11, fontWeight:600, letterSpacing:'.14em',
                textTransform:'uppercase', color:'#4A4A4A', marginTop:10}}>{s.l}</div>
            </div>
          ))}
        </div>
        <a href="#" style={{marginTop:32, fontSize:13, fontWeight:600, color:'#CF0A2C',
          textDecoration:'none', letterSpacing:'.02em'}}>Read the full case study →</a>
      </div>
    </section>
  );
}

// ===== Leadership =====
function Leadership() {
  const team = [
    {n:'Khalid Al Kubaisi', r:'Chief Executive Officer'},
    {n:'Ilkka Kivela', r:'Chief Strategy & Transformation Officer'},
    {n:'Vivek Sharma', r:'Chief Finance Officer'},
  ];
  return (
    <section style={{padding:'96px 32px', background:'#FAFAFA'}}>
      <div style={{maxWidth:1280, margin:'0 auto'}}>
        <div style={{fontSize:12, fontWeight:600, letterSpacing:'.18em', textTransform:'uppercase', color:'#CF0A2C'}}>
          Leadership
        </div>
        <h2 style={{fontSize:'clamp(32px, 3.5vw, 48px)', fontWeight:600, letterSpacing:'-.02em',
          lineHeight:1.1, margin:'14px 0 48px', maxWidth:880}}>
          Decades of national-scale delivery experience.
        </h2>
        <div style={{display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:32}}>
          {team.map((t,i) => (
            <div key={t.n}>
              <div style={{aspectRatio:'1/1', background:'#D9D9D9',
                backgroundImage:'url(../../assets/imagery/portrait-mono.jpg)',
                backgroundSize:'cover', backgroundPosition:'top', filter:'grayscale(1)'}} />
              <div style={{fontSize:20, fontWeight:600, marginTop:16}}>{t.n}</div>
              <div style={{fontSize:13, color:'#777', letterSpacing:'.04em', textTransform:'uppercase',
                fontWeight:600, marginTop:4}}>{t.r}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ===== Quote Banner =====
function QuoteBanner() {
  return (
    <section style={{padding:'96px 32px', background:'#CF0A2C', color:'#fff'}}>
      <div style={{maxWidth:1100, margin:'0 auto', textAlign:'left'}}>
        <div style={{fontSize:12, fontWeight:600, letterSpacing:'.18em', textTransform:'uppercase',
          color:'rgba(255,255,255,.85)', marginBottom:32}}>From the CEO</div>
        <p style={{fontFamily:'var(--font-display)', fontWeight:300,
          fontSize:'clamp(28px, 3.6vw, 56px)', lineHeight:1.2, letterSpacing:'-.01em', margin:0}}>
          <span style={{opacity:.7}}>“</span>At malomatia, we boldly reimagine what's possible.
          Sparking innovation and championing collaboration to propel Qatar into a new era of digital excellence.<span style={{opacity:.7}}>”</span>
        </p>
        <div style={{display:'flex', alignItems:'center', gap:20, marginTop:36}}>
          <div style={{width:48, height:1, background:'rgba(255,255,255,.6)'}} />
          <div>
            <div style={{fontSize:18, fontWeight:600}}>Khalid Al Kubaisi</div>
            <div style={{fontSize:12, color:'rgba(255,255,255,.85)', letterSpacing:'.04em',
              textTransform:'uppercase', fontWeight:600, marginTop:4}}>Chief Executive Officer</div>
          </div>
        </div>
      </div>
    </section>
  );
}

// ===== Footer =====
function Footer() {
  return (
    <footer id="contact" style={{background:'#000', color:'#fff', padding:'72px 32px 32px'}}>
      <div style={{maxWidth:1280, margin:'0 auto'}}>
        <div style={{display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr', gap:48,
          paddingBottom:48, borderBottom:'1px solid rgba(255,255,255,.15)'}}>
          <div>
            <img src="../../assets/logos/malomatia-logo-light-on-black.png" alt="malomatia" style={{height:32}} />
            <p style={{fontSize:14, color:'#BFBFBF', lineHeight:1.6, marginTop:18, maxWidth:360}}>
              Qatar's national IT services partner. Together, we shape the next chapter of Qatar's digital transformation.
            </p>
            <div style={{marginTop:24, display:'flex', gap:12}}>
              <a href="#" style={{color:'#fff'}}><i data-lucide="linkedin" style={{width:18, height:18, strokeWidth:1.5}}/></a>
              <a href="#" style={{color:'#fff'}}><i data-lucide="twitter" style={{width:18, height:18, strokeWidth:1.5}}/></a>
              <a href="#" style={{color:'#fff'}}><i data-lucide="youtube" style={{width:18, height:18, strokeWidth:1.5}}/></a>
            </div>
          </div>
          <div>
            <h5 style={{fontSize:11, letterSpacing:'.14em', textTransform:'uppercase',
              color:'#999', margin:'0 0 14px', fontWeight:600}}>Services</h5>
            <ul style={{listStyle:'none', padding:0, margin:0}}>
              {['Cybersecurity','Cloud','Data & AI','Managed Services','BPO'].map(x => (
                <li key={x} style={{fontSize:13, color:'#BFBFBF', marginBottom:8}}>{x}</li>
              ))}
            </ul>
          </div>
          <div>
            <h5 style={{fontSize:11, letterSpacing:'.14em', textTransform:'uppercase',
              color:'#999', margin:'0 0 14px', fontWeight:600}}>Company</h5>
            <ul style={{listStyle:'none', padding:0, margin:0}}>
              {['About','Leadership','Sectors','Insights','Careers'].map(x => (
                <li key={x} style={{fontSize:13, color:'#BFBFBF', marginBottom:8}}>{x}</li>
              ))}
            </ul>
          </div>
          <div>
            <h5 style={{fontSize:11, letterSpacing:'.14em', textTransform:'uppercase',
              color:'#999', margin:'0 0 14px', fontWeight:600}}>Doha HQ</h5>
            <ul style={{listStyle:'none', padding:0, margin:0, fontSize:13, color:'#BFBFBF', lineHeight:1.7}}>
              <li>Marabea Tower, Lusail</li>
              <li>P.O. Box 24069</li>
              <li>+974 4499 2826</li>
              <li>malomatia.com</li>
            </ul>
          </div>
        </div>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center',
          paddingTop:24, fontSize:12, color:'#777'}}>
          <div>© 2025 malomatia · 100% owned by the Qatar Investment Authority</div>
          <div style={{fontFamily:'var(--font-display)', fontStyle:'italic', fontSize:13, color:'#BFBFBF'}}>
            excel with IT
          </div>
        </div>
      </div>
    </footer>
  );
}

// Export to window so the host HTML can use them.
Object.assign(window, { Header, Hero, StatsStrip, Services, Sectors, FeaturedStory, Leadership, QuoteBanner, Footer });
