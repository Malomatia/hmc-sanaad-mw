/* malomatia sample slides */

// Slide 1 — Cover (reimagining what's possible)
function CoverSlide() {
  return (
    <section data-label="Cover" style={{position:'relative', width:'100%', height:'100%',
      background:'#000', color:'#fff', overflow:'hidden'}}>
      <img src="../assets/imagery/qatar-skyline-arches.jpg" style={{
        position:'absolute', inset:0, width:'100%', height:'100%', objectFit:'cover', opacity:.45}} />
      <div style={{position:'absolute', inset:0,
        background:'linear-gradient(135deg, rgba(0,0,0,.85) 0%, rgba(0,0,0,.3) 55%, rgba(207,10,44,.55) 100%)'}} />
      <div style={{position:'absolute', left:80, top:56}}>
        <img src="../assets/logos/malomatia-logo-light-on-black.png" style={{height:36}} />
      </div>
      <div style={{position:'absolute', left:80, bottom:120, right:80}}>
        <div style={{fontSize:16, letterSpacing:'.3em', fontWeight:600, color:'#CF0A2C', textTransform:'uppercase', marginBottom:40}}>
          Corporate Overview · 2025
        </div>
        <div style={{fontFamily:'var(--font-display)', fontWeight:300, textTransform:'lowercase',
          fontSize:180, lineHeight:.9, letterSpacing:'-.03em', color:'#fff'}}>
          reimagining<br/>
          <span style={{color:'#CF0A2C'}}>what's possible</span>
        </div>
        <div style={{fontSize:22, color:'rgba(255,255,255,.75)', marginTop:40,
          maxWidth:900, fontWeight:300, letterSpacing:'.01em'}}>
          malomatia's journey to a knowledge-driven digital economy.
        </div>
      </div>
      <SlideFooter page={1} total={6} />
    </section>
  );
}

// Slide 2 — Section divider / About
function SectionDividerSlide() {
  return (
    <section data-label="Who We Are" style={{position:'relative', width:'100%', height:'100%',
      background:'#CF0A2C', color:'#fff', overflow:'hidden'}}>
      <div style={{position:'absolute', left:80, top:56, display:'flex', alignItems:'center', gap:16}}>
        <img src="../assets/logos/malomatia-logo-light-on-black.png" style={{height:28}} />
      </div>
      <div style={{position:'absolute', top:'50%', left:80, transform:'translateY(-50%)', right:80}}>
        <div style={{fontSize:16, letterSpacing:'.3em', fontWeight:600, color:'rgba(255,255,255,.7)',
          textTransform:'uppercase', marginBottom:40}}>01 · Who We Are</div>
        <div style={{fontFamily:'var(--font-display)', fontWeight:300, fontSize:140, lineHeight:.95,
          letterSpacing:'-.02em'}}>
          A national leader in <br/>
          <span style={{fontStyle:'italic'}}>digital transformation</span> &amp; IT excellence.
        </div>
      </div>
      <SlideFooter page={2} total={6} />
    </section>
  );
}

// Slide 3 — Stats (legacy of trust)
function StatsSlide() {
  const stats = [
    {n:'2008', l:'Established', accent:true},
    {n:'100%', l:'Owned by QIA', accent:true},
    {n:'500+', l:'Projects delivered'},
    {n:'100+', l:'Clients served'},
    {n:'2,200+', l:'Specialists'},
    {n:'7+', l:'Sectors served'},
  ];
  return (
    <section data-label="Stats" style={{position:'relative', width:'100%', height:'100%',
      background:'#fff', color:'#000'}}>
      <SlideMeta label="About malomatia" />
      <SlideBadge />
      <div style={{position:'absolute', left:80, top:180, right:80}}>
        <div style={{fontSize:56, fontWeight:600, letterSpacing:'-.02em', lineHeight:1.1, maxWidth:1100}}>
          A legacy of <span style={{color:'#CF0A2C', fontFamily:'var(--font-display)', fontWeight:400, textTransform:'lowercase'}}>trust</span> &amp; ownership.
        </div>
        <div style={{fontSize:20, color:'#4A4A4A', marginTop:28, maxWidth:1000, lineHeight:1.5, fontWeight:300}}>
          In Qatar's digital transformation market, trust isn't just a brand promise — it's the key to unlocking growth and market leadership.
        </div>
      </div>
      <div style={{position:'absolute', left:80, right:80, top:560,
        display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap:'48px 56px'}}>
        {stats.map((s,i) => (
          <div key={i} style={{borderTop:'1px solid #D9D9D9', paddingTop:24}}>
            <div style={{fontFamily:'var(--font-display)', fontSize:110, lineHeight:.9,
              fontWeight:400, letterSpacing:'-.02em', color: s.accent ? '#CF0A2C' : '#000'}}>{s.n}</div>
            <div style={{fontSize:13, letterSpacing:'.2em', textTransform:'uppercase',
              fontWeight:600, color:'#4A4A4A', marginTop:18}}>{s.l}</div>
          </div>
        ))}
      </div>
      <SlideFooter page={3} total={6} />
    </section>
  );
}

// Slide 4 — Big quote
function QuoteSlide() {
  return (
    <section data-label="CEO Quote" style={{position:'relative', width:'100%', height:'100%',
      background:'#000', color:'#fff'}}>
      <SlideMeta label="From the CEO" />
      <div style={{position:'absolute', top:'50%', left:160, right:160, transform:'translateY(-50%)'}}>
        <div style={{fontFamily:'var(--font-display)', fontSize:260, lineHeight:.7, color:'#CF0A2C',
          opacity:.4, marginBottom:-20, fontWeight:300}}>“</div>
        <div style={{fontFamily:'var(--font-display)', fontWeight:300, fontSize:70, lineHeight:1.2,
          letterSpacing:'-.01em'}}>
          At malomatia, we boldly reimagine what's possible — <span style={{color:'#CF0A2C'}}>sparking innovation</span> and championing collaboration to propel Qatar into a new era of digital excellence.
        </div>
        <div style={{display:'flex', alignItems:'center', gap:24, marginTop:48}}>
          <div style={{width:56, height:1, background:'rgba(255,255,255,.5)'}} />
          <div>
            <div style={{fontSize:22, fontWeight:600}}>Khalid Al Kubaisi</div>
            <div style={{fontSize:13, color:'rgba(255,255,255,.65)', letterSpacing:'.2em',
              textTransform:'uppercase', fontWeight:600, marginTop:6}}>Chief Executive Officer</div>
          </div>
        </div>
      </div>
      <SlideFooter page={4} total={6} />
    </section>
  );
}

// Slide 5 — Services grid
function ServicesSlide() {
  const services = [
    {i:'shield', t:'Cybersecurity', d:'Qatar\u2019s largest SOC; exclusive MS Cloud Security Partner'},
    {i:'cloud', t:'Cloud Solutions', d:'Migration · hybrid/multi-cloud · ongoing optimisation'},
    {i:'server', t:'IT Managed Services', d:'24/7 NOC · network &amp; data-centre reliability'},
    {i:'code', t:'Application Development', d:'Custom apps · integration · continuous modernisation'},
    {i:'grid', t:'Enterprise Applications', d:'Oracle · SAP · Jaggaer at government scale'},
    {i:'cpu', t:'Data &amp; AI', d:'Strategy · dashboards · AI-powered automation'},
    {i:'headphones', t:'Contact Centre', d:'COPC-certified · 1.2M+ monthly transactions'},
    {i:'workflow', t:'BPO', d:'Smart operations · RPA · KPO at national scale'},
  ];
  return (
    <section data-label="Services" style={{position:'relative', width:'100%', height:'100%', background:'#fff'}}>
      <SlideMeta label="Our Core Services" />
      <SlideBadge />
      <div style={{position:'absolute', left:80, top:180, right:80}}>
        <div style={{fontSize:56, fontWeight:600, letterSpacing:'-.02em', lineHeight:1.1, maxWidth:1280}}>
          Driving government &amp; enterprise with <span style={{color:'#CF0A2C', fontFamily:'var(--font-display)', fontWeight:400, textTransform:'lowercase'}}>full-spectrum ICT.</span>
        </div>
      </div>
      <div style={{position:'absolute', left:80, right:80, top:380,
        display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gridTemplateRows:'repeat(2, 1fr)', gap:20}}>
        {services.map((s,i) => (
          <div key={s.t} style={{
            padding:'32px 28px', borderRadius:2, minHeight:240,
            background: i === 0 ? '#CF0A2C' : '#FAFAFA', color: i === 0 ? '#fff' : '#000',
            display:'flex', flexDirection:'column'
          }}>
            <div style={{width:40, height:40, border:`1.5px solid ${i===0?'#fff':'#CF0A2C'}`,
              display:'flex', alignItems:'center', justifyContent:'center', borderRadius:2,
              fontFamily:'var(--font-display)', fontSize:22, fontWeight:400,
              color: i===0?'#fff':'#CF0A2C'}}>{String(i+1).padStart(2,'0')}</div>
            <div style={{fontSize:22, fontWeight:600, marginTop:'auto'}} dangerouslySetInnerHTML={{__html:s.t}}/>
            <div style={{fontSize:13, lineHeight:1.55, marginTop:8,
              color: i === 0 ? 'rgba(255,255,255,.8)' : '#4A4A4A'}} dangerouslySetInnerHTML={{__html:s.d}}/>
          </div>
        ))}
      </div>
      <SlideFooter page={5} total={6} />
    </section>
  );
}

// Slide 6 — Success story with KPIs
function SuccessStorySlide() {
  return (
    <section data-label="Success Story" style={{position:'relative', width:'100%', height:'100%',
      background:'#fff', display:'grid', gridTemplateColumns:'1fr 1fr'}}>
      <div style={{position:'relative', background:'url(../assets/imagery/server-cables.jpg) center/cover'}}>
        <div style={{position:'absolute', inset:0,
          background:'linear-gradient(to right, rgba(0,0,0,.55), rgba(0,0,0,.82))'}}/>
        <div style={{position:'absolute', left:80, top:56}}>
          <img src="../assets/logos/malomatia-logo-light-on-black.png" style={{height:28}}/>
        </div>
        <div style={{position:'absolute', left:80, bottom:120, color:'#fff'}}>
          <div style={{fontSize:13, letterSpacing:'.22em', color:'rgba(255,255,255,.7)',
            textTransform:'uppercase', fontWeight:600}}>Client</div>
          <div style={{fontFamily:'var(--font-display)', fontWeight:300, fontSize:76, lineHeight:1,
            textTransform:'uppercase', marginTop:16, letterSpacing:'-.01em'}}>
            General Authority<br/>of Customs
          </div>
        </div>
      </div>
      <div style={{padding:'56px 80px', display:'flex', flexDirection:'column', position:'relative'}}>
        <div style={{fontSize:13, letterSpacing:'.22em', color:'#CF0A2C',
          textTransform:'uppercase', fontWeight:600}}>Success Story · A</div>
        <div style={{fontSize:48, fontWeight:600, letterSpacing:'-.02em', lineHeight:1.1, marginTop:24}}>
          Al Nadeeb Platform
        </div>
        <div style={{fontFamily:'var(--font-display)', fontSize:24, color:'#777',
          fontStyle:'italic', fontWeight:400, marginTop:10}}>
          end-to-end digital customs
        </div>
        <div style={{fontSize:13, letterSpacing:'.22em', color:'#4A4A4A',
          textTransform:'uppercase', fontWeight:600, marginTop:56}}>Outcomes</div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:'40px 32px', marginTop:32}}>
          {[
            {n:'600%', l:'Platform growth', a:true},
            {n:'100%', l:'Uptime', a:true},
            {n:'5×', l:'Faster incident resolution'},
            {n:'27', l:'Integrations'},
          ].map(s => (
            <div key={s.l}>
              <div style={{fontFamily:'var(--font-display)', fontSize:90, lineHeight:.9,
                color: s.a ? '#CF0A2C' : '#000', fontWeight:400, letterSpacing:'-.02em'}}>{s.n}</div>
              <div style={{fontSize:12, fontWeight:600, letterSpacing:'.18em',
                textTransform:'uppercase', color:'#4A4A4A', marginTop:14}}>{s.l}</div>
            </div>
          ))}
        </div>
        <SlideFooter page={6} total={6} />
      </div>
    </section>
  );
}

Object.assign(window, { CoverSlide, SectionDividerSlide, StatsSlide, QuoteSlide, ServicesSlide, SuccessStorySlide });
