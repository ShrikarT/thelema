import React,{useState,useEffect,useRef,useCallback,useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import {PiArrowRight,PiArrowUpRight,PiWallet,PiCheck,PiX,PiWarningCircle,PiArrowClockwise,PiInfo,PiGitBranch,PiCheckCircle,PiFlask,PiLockKey,PiArrowsSplit,PiCaretDown} from 'react-icons/pi';
import {
  api,
  PREVIEW,
  defaults,
  emptyRefs,
  money,
  pct,
  errorText,
  short,
  type Mode,
  type Book,
  type Side,
  type Stats,
  type Quote,
  type ReferencesData,
  type ConfigResponse,
  type WalletState,
  type AnyMarketSnapshot,
  type AnyPositionRow,
  type ActivityRecord,
  type ClipResult
} from './api';
import {connectWallet,sendArcTrade,sendArcPairs,loadArcPositions,sendArcClaim,readWalletBalance} from './wallet';
import type {ArcPositionRow} from '../../../packages/arc/types.ts';

const routeNow=()=>PREVIEW?(location.hash.slice(1)||'/market'):location.pathname;

function toTimestampMs(secondsOrMs: number | bigint | undefined | null): number {
  if (secondsOrMs === undefined || secondsOrMs === null) return 0;
  const n = Number(secondsOrMs);
  if (n === Infinity) return Infinity;
  if (n <= 0 || !Number.isFinite(n)) return 0;
  return n >= 100_000_000 && n < 100_000_000_000 ? n * 1000 : n;
}

function Mark(){return <svg width="30" height="30" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 8h24M20 8v24M10 18l10 10 10-10" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/></svg>;}

interface StatusProps {
  children: React.ReactNode;
  blue?: boolean;
}

function Status({children,blue=false}: StatusProps){return <span className={`status ${blue?'blue':''}`}><i/>{children}</span>;}

interface ErrorBoxProps {
  children: React.ReactNode;
}

function ErrorBox({children}: ErrorBoxProps){return <div className="error-inline" role="alert"><PiWarningCircle/><span>{children}</span></div>;}

interface ExternalProps {
  href: string;
  children: React.ReactNode;
}

function External({href,children}: ExternalProps){return <a href={href} target="_blank" rel="noreferrer noopener">{children}<PiArrowUpRight aria-hidden="true"/></a>;}

interface DialogProps {
  title: string;
  children: React.ReactNode;
  close: () => void;
  menu?: boolean;
  locked?: boolean;
}

function Dialog({title,children,close,menu=false,locked=false}: DialogProps){const ref=useRef<HTMLDialogElement>(null);useEffect(()=>{const prev=document.activeElement as HTMLElement;ref.current?.showModal();return()=>{ref.current?.close();(prev?.isConnected?prev:document.getElementById('main'))?.focus?.({preventScroll:true});};},[]);return <dialog ref={ref} aria-label={title} className={`dialog ${menu?'menu-dialog':''}`} onCancel={e=>{e.preventDefault();if(!locked)close();}} onClick={e=>{if(e.target===ref.current&&!locked)close();}}><div className="dialog-head"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" disabled={locked} onClick={close}><PiX/></button></div>{children}</dialog>;}

interface ModeSwitchProps {
  mode: Mode;
  change: (mode: Mode) => void;
}

function ModeSwitch({mode,change}: ModeSwitchProps){return <div className="segmented mode-switch" aria-label="Execution mode"><button aria-pressed={mode==='sandbox'} onClick={()=>change('sandbox')}>Sandbox</button><button aria-pressed={mode==='arc'} onClick={()=>change('arc')}>Arc Testnet</button></div>;}

interface CommonProps {
  mode: Mode;
  snap: AnyMarketSnapshot | null;
  wallet: WalletState | null;
  config: ConfigResponse;
  refresh: () => Promise<void> | void;
  notify: (msg: string) => void;
}

interface StatsGridProps {
  stats?: Stats | null;
  loading?: boolean;
}

interface WorldsProps {
  stats?: Stats | null;
  compact?: boolean;
}

interface IdentityProps {
  stats?: Stats | null;
  refs: ReferencesData;
  refresh: () => void;
}

type TicketProps = CommonProps & {
  connect: () => Promise<void> | void;
};

type PositionsProps = CommonProps;

interface ActivityProps {
  snap: AnyMarketSnapshot | null;
}

type MarketTabsProps = CommonProps;

type PairsProps = CommonProps;

interface OracleProps {
  snap: AnyMarketSnapshot | null;
  refresh: () => Promise<void> | void;
  notify: (msg: string) => void;
}

type GuideProps = CommonProps & {
  refs: ReferencesData;
};

interface LinkProps {
  to: string;
  children: React.ReactNode;
  className?: string;
}

function App(){
  const [route,setRoute]=useState(routeNow),[mode,setMode]=useState<Mode>('sandbox'),[config,setConfig]=useState<ConfigResponse>(defaults),[ready,setReady]=useState(false),[snap,setSnap]=useState<AnyMarketSnapshot | null>(null),[refs,setRefs]=useState<ReferencesData>(emptyRefs),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [wallet,setWallet]=useState<WalletState | null>(null),[walletBusy,setWalletBusy]=useState(false),[walletError,setWalletError]=useState(''),[menu,setMenu]=useState(false),[reset,setReset]=useState(false),[resetPolicy,setResetPolicy]=useState('untimed'),[toast,setToast]=useState('');
  const modeRef=useRef<Mode>(mode);modeRef.current=mode;const walletRef=useRef<WalletState | null>(wallet);walletRef.current=wallet;
  const go=(path:string)=>{if(PREVIEW)location.hash=path;else history.pushState({},'',path);setRoute(path);setMenu(false);setWalletError('');window.scrollTo(0,0);};
  const Link=useMemo(()=>({to,children,className=''}: LinkProps)=><a className={className} href={PREVIEW?'#'+to:to} aria-current={route===to?'page':undefined} onClick={e=>{if(!e.ctrlKey&&!e.metaKey){e.preventDefault();go(to);}}}>{children}</a>,[route]);
  const refresh=useCallback(async()=>{const requested=modeRef.current;try{const s=await api<AnyMarketSnapshot>('/api/market?mode='+requested);if(requested===modeRef.current){setSnap(s);setError('');if(requested==='arc'&&walletRef.current){const account=walletRef.current.account;try{const balance=await readWalletBalance(config,account);setWallet((prev: WalletState | null)=>prev?.account===account?{...prev,balance}:prev);}catch{setWallet(null);}}}}catch(e){if(requested===modeRef.current){setSnap(null);setError(errorText(e));}}finally{setLoading(false);}},[config]);
  const refreshRefs=useCallback(async()=>{try{setRefs(await api<ReferencesData>('/api/references'));}catch{setRefs({...emptyRefs,spot:{...emptyRefs.spot,error:'Reference request failed. No fallback price is used.'}});}},[]);
  useEffect(()=>{api<ConfigResponse>('/api/config').then(c=>{setConfig(c);setReady(true);refreshRefs();}).catch(e=>{setError(errorText(e));setLoading(false);});const pop=()=>setRoute(routeNow());addEventListener('popstate',pop);addEventListener('hashchange',pop);return()=>{removeEventListener('popstate',pop);removeEventListener('hashchange',pop);};},[refreshRefs]);
 useEffect(()=>{if(!ready)return;setSnap(null);setLoading(true);setError('');refresh();const t=setInterval(refresh,7000);return()=>clearInterval(t);},[ready,mode,refresh]);
 useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(''),8000);return()=>clearTimeout(t);},[toast]);
 useEffect(()=>{const p=window.ethereum;if(!p?.on)return;const resetWallet=()=>{setWallet(null);setWalletError('Wallet account or network changed. Reconnect to verify your balance.');};p.on('accountsChanged',resetWallet);p.on('chainChanged',resetWallet);return()=>{p.removeListener?.('accountsChanged',resetWallet);p.removeListener?.('chainChanged',resetWallet);};},[]);
 useEffect(()=>{document.title=route==='/market'?'THELEMA — sNVDA impact market':route==='/portfolio'?'THELEMA — Your positions':route==='/guide'?'THELEMA — Integration guide':'THELEMA — One event. Two possible worlds.';const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;if(reduced)return;const io=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting)e.target.classList.add('revealed');}),{threshold:.8});document.querySelectorAll('.reveal-word').forEach(n=>io.observe(n));return()=>io.disconnect();},[route]);
 const connect=async()=>{setWalletBusy(true);setWalletError('');try{setWallet(await connectWallet(config));setToast('Arc Testnet wallet connected. ERC20 balance verified at six decimals.');}catch(e){setWalletError(errorText(e));}finally{setWalletBusy(false);}};
 const common={mode,snap,wallet,config,refresh,notify:setToast};
 return <><a href="#main" className="skip-link">Skip to content</a><header className="site-header"><Link to="/" className="brand"><Mark/><span>THELEMA</span></Link><nav className="desktop-nav" aria-label="Main navigation"><Link to="/market">Market</Link><Link to="/portfolio">Positions</Link><Link to="/guide">How it works</Link></nav><div className="header-actions"><span className="testnet-label">Testnet only</span><button className="button small secondary" onClick={connect} disabled={walletBusy}><PiWallet/>{walletBusy?'Connecting…':wallet?short(wallet.account):'Connect wallet'}</button><button className={`menu-button ${menu?'opened':''}`} aria-label="Open navigation" aria-expanded={menu} onClick={()=>setMenu(true)}><span/><span/></button></div></header>
 {menu&&<Dialog title="Explore THELEMA" menu close={()=>setMenu(false)}><nav className="mobile-nav" aria-label="Mobile navigation"><Link to="/market">Market <PiArrowUpRight/></Link><Link to="/portfolio">Positions <PiArrowUpRight/></Link><Link to="/guide">How it works <PiArrowUpRight/></Link></nav></Dialog>}
 {walletError&&<div className="container"><ErrorBox>{walletError}</ErrorBox></div>}
 <main id="main" tabIndex={-1}>
 {route==='/'?<><section className="hero container"><div className="hero-copy"><div className="eyebrow"><i/>A market for what comes next</div><h1>One event.<br/>Two possible worlds.</h1><p className="hero-sub">Look beyond whether it happens.<br/>Explore what it means for the asset.</p><Link to="/market" className="button primary large">Open the market <PiArrowUpRight/></Link><p className="hero-note"><PiFlask/>Research sandbox. Synthetic assets. No real stock.</p></div><div className="hero-product"><div className="product-top"><span className="eyebrow">THELEMA / Market preview</span><Status>Illustrative sandbox</Status></div><div className="product-event"><span className="asset-tag">sNVDA</span><span>AI chips. A policy decision.<br/><strong>Two different price signals.</strong></span><PiGitBranch/></div><Worlds stats={mode==='sandbox'?snap?.stats:undefined} compact/><div className="product-bottom"><span>Derived from sandbox pools</span><strong>{mode==='sandbox'?money(snap?.stats.impact):'—'}<small>conditional gap</small></strong></div></div></section>
 <section className="built-for container"><span>One primitive.<br/>Three integration layers.</span><div><strong>Arc<small>USDC collateral</small></strong><strong>Chainlink CRE<small>Confidential computation</small></strong><strong>The Graph<small>External references</small></strong></div></section>
 <section className="section container"><div className="section-heading"><span className="eyebrow">Make the consequence visible</span><h2>Probability is only<br/>half the conversation.</h2><p>A policy change can be unlikely and still matter. Separate an event’s chance from the asset’s price in each outcome.</p></div><div className="benefits"><article><PiGitBranch/><h3>See both worlds.</h3><p>Read the event probability, the asset price in each world, and the difference between them.</p></article><article><PiArrowsSplit/><h3>Follow the price formation.</h3><p>Trade against constant product pools. Each sandbox fill updates the numbers, not a fixed mockup.</p></article><article><PiLockKey/><h3>Understand the boundaries.</h3><p>Inspect collateral, the payout cap and the residual. Know what is live and what is local.</p></article></div></section>
 <section className="tagline-section"><div className="container"><span className="eyebrow">Think in outcomes</span><h2>{['Don’t','just','ask','if.'].map((w,i)=><span className="reveal-word" style={{transitionDelay:i*90+'ms'}} key={w}>{w} </span>)}<br/>{['Ask','what','changes.'].map((w,i)=><span className="reveal-word" style={{transitionDelay:(i+4)*90+'ms'}} key={w}>{w} </span>)}</h2><p>One synthetic asset. Two conditional valuations.<br/>A clearer way to explore your hypothesis.</p></div></section>
 <section className="section container"><div className="section-heading"><span className="eyebrow">From hypothesis to settlement</span><h2>Try the complete loop.</h2></div><div className="steps">{[['01','Choose your world.','Trade the event probability or the synthetic asset in the YES or NO world.'],['02','Review the quote.','Inspect expected shares, pool fee, price impact and minimum output.'],['03','Resolve and claim.','Use the local oracle to see the winning leg pay and the losing leg pay zero.']].map(([n,h,p])=><article key={n}><span>{n}</span><h3>{h}</h3><p>{p}</p></article>)}</div></section>
 <section className="section container faq-section"><div><span className="eyebrow">Before you start</span><h2>Good questions.<br/>Clear boundaries.</h2></div><FAQ/></section><section className="final-cta container"><div><span className="eyebrow">Your hypothesis starts here</span><h2>What changes in your world?</h2></div><Link to="/market" className="button primary large">Open the market <PiArrowUpRight/></Link></section></>:
 route==='/market'?<div className="container app-container"><div className="app-topline"><div className="breadcrumb">Markets <span>/</span> Technology <span>/</span> sNVDA</div><ModeSwitch mode={mode} change={setMode}/></div><div className="mode-note"><PiFlask/>{mode==='sandbox'?`Local sandbox · ${PREVIEW?'Runs in this file':'Isolated server session'} · No real funds or blockchain transactions`:'Arc Testnet · Public wallet transactions · Real deployment configuration required'}</div><div className="market-heading"><div><div className="market-eyebrow"><span className="asset-tag">sNVDA</span><Status blue>{snap?.status==='settled'?'Settled':snap?.lifecycle==='EVENT_RESOLVED'?'Event resolved':mode==='sandbox'?'Sandbox market':'Arc connection'}</Status></div><h1>Will the US allow advanced AI chip<br className="desktop-break"/> sales to China by 31 December 2026?</h1><div className="market-meta"><span>Synthetic Nvidia index</span><span>{mode==='arc'?'Testnet cutoff: 10 Sep 2026':'31 Dec 2026'}</span><span>{money(snap?.stats?.cap ?? 500)} payout cap</span><span>{mode==='arc'?'September 9/10 testnet schedule':snap?.timing?.policy === 'accelerated-demo' ? 'Accelerated demo schedule' : 'Untimed sandbox'}</span><span>DEMO_ORACLE</span></div></div><div className="balance-box"><span>{mode==='sandbox'?'Sandbox balance':'Wallet USDC'}</span><strong>{money(mode==='sandbox'?snap?.balance:wallet?.balance)}</strong><button className="text-button" onClick={mode==='sandbox'?()=>setReset(true):connect}>{mode==='sandbox'?'Reset sandbox':'Refresh wallet'}<PiArrowClockwise/></button></div></div>{error&&<ErrorBox>{error}</ErrorBox>}<StatsGrid stats={snap?.stats} loading={loading}/><div className="market-grid"><div className="market-main"><section className="panel worlds-panel"><div className="panel-heading"><div><span className="eyebrow">The conditional view</span><h2>Same asset. Different futures.</h2></div><PiGitBranch/></div><Worlds stats={snap?.stats}/><p className="panel-note">Conditional prices come from share midprices divided by outcome probability. They are market signals, not forecasts or guaranteed returns.</p></section><Identity stats={snap?.stats} refs={refs} refresh={refreshRefs}/><MarketTabs {...common}/></div><aside className="trade-column" aria-label="Trade ticket"><Ticket {...common} connect={connect}/><div className="risk-note"><PiInfo/><p><strong>Know the payoff.</strong> Losing shares pay zero. Winning asset shares pay the index up to {money(snap?.stats?.cap ?? 500)}. Remainder is claimable by residual (R) holders.</p></div><div className="mobile-balance"><span>{mode==='sandbox'?'Sandbox balance':'Wallet USDC'}: {money(mode==='sandbox'?snap?.balance:wallet?.balance)}</span>{mode==='sandbox'&&<button className="text-button" onClick={()=>setReset(true)}>Reset sandbox <PiArrowClockwise/></button>}</div></aside></div></div>:
 route==='/portfolio'?<div className="container app-container"><div className="app-topline"><span className="eyebrow">Your market exposure</span><ModeSwitch mode={mode} change={setMode}/></div><div className="page-heading"><h1>Your positions.</h1><p>Track each world separately. Claim only after resolution.</p></div><div className="mode-note"><PiFlask/>{mode==='sandbox'?'All positions and activity below are local simulations.':'Arc holdings require a connected wallet and deployed contracts.'}</div>{error&&<ErrorBox>{error}</ErrorBox>}<div className="portfolio-layout"><section className="panel"><div className="panel-heading"><h2>Holdings</h2><Status>{mode==='sandbox'?'Local sandbox':'Arc Testnet'}</Status></div><Positions {...common}/></section><Pairs {...common}/></div><section className="panel activity-panel"><div className="panel-heading"><h2>Your activity</h2><span className="muted">Sandbox records, not chain transactions</span></div><Activity snap={snap}/></section><button className="button secondary" onClick={()=>go('/market')}>Back to the market <PiArrowRight/></button></div>:
 route==='/guide'?<Guide {...common} refs={refs}/>:
 <section className="container not-found"><span className="eyebrow">404 / An unpriced world</span><h1>This page hasn’t<br/>happened.</h1><p>The market is still here. Find your way back.</p><Link to="/market" className="button primary">Back to the market <PiArrowRight/></Link></section>}
 </main><footer className="footer container"><div><Link to="/" className="brand"><Mark/><span>THELEMA</span></Link><p>Synthetic impact markets.<br/>Testnet only. Unaudited. Not investment advice.</p></div><div className="footer-links"><Link to="/guide">Risks & methodology</Link><External href="https://if.market">Category inspiration</External><span className="muted">No production service or approved legal policies.</span></div><span className="footer-build">Research build / 2026</span></footer>
 {toast&&<div className="toast" role="status"><PiCheckCircle/><span>{toast}{toast.match(/0x[0-9a-fA-F]{64}/)?.[0]&&<External href={config.explorer+'/tx/'+toast.match(/0x[0-9a-fA-F]{64}/)![0]}>View receipt</External>}</span><button className="icon-button" aria-label="Dismiss notification" onClick={()=>setToast('')}><PiX/></button></div>}
 {reset&&<Dialog title="Reset the local sandbox?" close={()=>setReset(false)}><p>This clears simulated positions and restores the original reserves and 5,000 sandbox USDC. No wallet or blockchain is affected.</p><div style={{margin:'16px 0',display:'grid',gap:'8px'}}><label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}><input type="radio" name="timingPolicy" value="untimed" checked={resetPolicy==='untimed'} onChange={()=>setResetPolicy('untimed')}/><span>Untimed local sandbox (instant simulation)</span></label><label style={{display:'flex',alignItems:'center',gap:'8px',cursor:'pointer'}}><input type="radio" name="timingPolicy" value="accelerated-demo" checked={resetPolicy==='accelerated-demo'} onChange={()=>setResetPolicy('accelerated-demo')}/><span>Accelerated demo schedule (60s cutoff, 120s window)</span></label></div><div className="dialog-actions"><button className="button secondary" onClick={()=>setReset(false)}>Keep my sandbox</button><button className="button primary" onClick={async()=>{try{setSnap(await api('/api/sandbox/reset','POST',{timingPolicy:resetPolicy}));setReset(false);setToast(`Sandbox reset (${resetPolicy==='accelerated-demo'?'accelerated demo schedule':'untimed'}). No real funds were moved.`);}catch(e){setToast(errorText(e));}}}>Reset sandbox</button></div></Dialog>}
 </>;
}
function StatsGrid({stats:s,loading}: StatsGridProps){const rows: [string,string,string,string][]=[['Event probability',s?pct(s.p):'—','Binary YES pool midprice','P(event)'],['Asset if YES',money(s?.eYes),'Conditional asset price','E[S | YES]'],['Asset if NO',money(s?.eNo),'Conditional asset price','E[S | NO]'],['Conditional impact',s?.impact==null?'—':(s.impact>=0?'+':'')+money(s.impact),'YES world minus NO world','Δ impact']];return <section className="stats-grid" aria-label="Four market numbers">{rows.map(([h,v,p,n],i)=><article key={h} className={`stat-card ${i===3?'impact-stat':''}`}><div><h2>{h}</h2><span className="notation">{n}</span></div>{loading?<div className="skeleton stat-skeleton" aria-label="Loading"/>:<strong data-testid={'stat-'+i}>{v}</strong>}<p>{p}</p></article>)}</section>;}
function Worlds({stats:s,compact=false}: WorldsProps){return <div className={`worlds ${compact?'compact':''}`}>{(['yes','no'] as const).map(side=><article className={'world world-'+side} key={side}><div className="world-label"><span>{side==='yes'?<PiCheck/>:<PiX/>}{side.toUpperCase()} world</span><span>{s?pct(side==='yes'?s.p:1-s.p):'—'}</span></div><div className="world-price"><span>{side==='yes'?'Asset if policy allows':'Asset if policy does not allow'}</span><strong>{money(s?.[side==='yes'?'eYes':'eNo'])}</strong><small>{s&&s[side==='yes'?'eYes':'eNo']===null?'Hidden near probability extreme':'per synthetic index unit'}</small></div><div className="world-bottom"><span>Conditional asset share</span><span>{money(s?.[side==='yes'?'yesSharePrice':'noSharePrice'])} <small>mid</small></span></div></article>)}<div className="world-divider"><PiGitBranch/></div></div>;}
function Identity({stats:s,refs,refresh}: IdentityProps){
  const ok=s&&refs.spot.status==='live'&&refs.spot.comparable&&refs.spot.value!==null&&refs.spot.value>0,gap=ok&&refs.spot.value!==null?s.impliedSpot-refs.spot.value:null;
  const cross=refs.crossProtocol;
  return <section className="panel identity-panel">
    <div className="panel-heading">
      <div>
        <span className="eyebrow">Independent reference check</span>
        <h2>Does the math reconcile?</h2>
      </div>
      <button className="icon-button" aria-label="Refresh Graph references" onClick={refresh}><PiArrowClockwise/></button>
    </div>
    <div className="identity-formula">
      <span>P × asset if YES</span><b>+</b><span>(1 − P) × asset if NO</span><b>=</b><strong>{money(s?.impliedSpot)}</strong>
    </div>
    <div className="reference-grid">
      <div>
        <label>Our implied index</label>
        <strong>{money(s?.impliedSpot)}</strong>
        <small>Sum of share midprices</small>
      </div>
      <div>
        <label>Graph asset reference</label>
        <strong>{refs.spot.status==='live'?money(refs.spot.value):'Unavailable'}</strong>
        <small>{refs.spot.status==='live'?refs.spot.label:'Configure a live source'}</small>
      </div>
      <div>
        <label>Graph event probability</label>
        <strong>{refs.probability.status==='live'?pct(refs.probability.value):'Unavailable'}</strong>
        <small>{refs.probability.label}</small>
      </div>
    </div>
    {cross&&(
      <div style={{margin:'0 24px 20px',padding:'16px',border:'1px solid var(--border)',borderRadius:'8px',background:'var(--soft)'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'12px',flexWrap:'wrap',gap:'8px'}}>
          <span className="eyebrow" style={{fontSize:'11px'}}>Standardized DEX Reference (Messari Schema)</span>
          <span className={`status ${cross.status==='agreeing'?'blue':''}`} style={{fontSize:'11px'}}>
            {cross.status==='agreeing'&&<PiCheck style={{color:'#155cb0'}}/>}
            {cross.status==='agreeing'?`Agreeing (${cross.disagreementPercent} spread)`:cross.status==='disagreeing'?`Spread Exceeded (${cross.disagreementPercent})`:cross.status==='single_source'?'Single Source Active':'Unavailable'}
          </span>
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))',gap:'12px',marginBottom:'12px'}}>
          <div style={{padding:'12px',background:'#fff',borderRadius:'6px',border:'1px solid var(--border)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <strong style={{fontSize:'12px'}}>{cross.source1.protocol}</strong>
              <span className="muted" style={{fontSize:'11px'}}>{cross.source1.network}</span>
            </div>
            <div style={{fontSize:'18px',fontWeight:600,margin:'6px 0'}}>
              {cross.source1.price!==null?money(cross.source1.price):'—'}
            </div>
            <div className="muted" style={{fontSize:'11px'}}>
              TVL: {cross.source1.tvlUSD?`$${(cross.source1.tvlUSD/1e6).toFixed(2)}M`:'—'} · Vol: {cross.source1.volumeUSD?`$${(cross.source1.volumeUSD/1e9).toFixed(2)}B`:'—'}
            </div>
            {cross.source1.error&&<div style={{color:'var(--error)',fontSize:'11px',marginTop:'4px'}}>{cross.source1.error}</div>}
          </div>
          <div style={{padding:'12px',background:'#fff',borderRadius:'6px',border:'1px solid var(--border)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <strong style={{fontSize:'12px'}}>{cross.source2.protocol}</strong>
              <span className="muted" style={{fontSize:'11px'}}>{cross.source2.network}</span>
            </div>
            <div style={{fontSize:'18px',fontWeight:600,margin:'6px 0'}}>
              {cross.source2.price!==null?money(cross.source2.price):'—'}
            </div>
            <div className="muted" style={{fontSize:'11px'}}>
              TVL: {cross.source2.tvlUSD?`$${(cross.source2.tvlUSD/1e3).toFixed(0)}k`:'—'} · Vol: {cross.source2.volumeUSD?`$${(cross.source2.volumeUSD/1e9).toFixed(2)}B`:'—'}
            </div>
            {cross.source2.error&&<div style={{color:'var(--error)',fontSize:'11px',marginTop:'4px'}}>{cross.source2.error}</div>}
          </div>
        </div>
        <div style={{fontSize:'12px',color:'var(--body)',lineHeight:'1.4'}}>
          {cross.summary}
        </div>
      </div>
    )}
    <div className="reference-note">
      <PiInfo/>
      <span>{gap!==null?`Observed gap ${money(gap)}. Pools are independent; the ${money(s?.cap ?? 500)} payoff cap also affects this comparison.`:refs.spot.status==='live'?'Different assets are not an identity check. This analog is context only.':'No live reference is connected. We show missing data, not a made up price.'}</span>
    </div>
  </section>;
}
function Ticket({mode,snap,wallet,config,connect,refresh,notify}: TicketProps){
 const [book,setBook]=useState<Book>('asset'),[side,setSide]=useState<Side>('yes'),[amount,setAmount]=useState('25'),[privatePath,setPrivate]=useState(false),[slippage,setSlippage]=useState(50),[quote,setQuote]=useState<Quote|null>(null),[original,setOriginal]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setQuote(null);setError('');},[mode,book,side,amount,privatePath,slippage]);
 const isTradingAllowed=useCallback((b:Book,s:Side)=>{
  if(!snap)return false;
  const now=Date.now();
  const cutoffMs = snap.timing?.tradingCutoff ? toTimestampMs(snap.timing.tradingCutoff) : 0;
  if(cutoffMs > 0 && now > cutoffMs)return false;
  if(snap.lifecycle==='PRICE_FIXED'||snap.status==='settled')return false;
  if(b==='binary')return snap.lifecycle==='OPEN';
  if(b==='asset'){
   if(snap.lifecycle==='OPEN')return true;
   if(snap.lifecycle==='EVENT_RESOLVED'){
    const winner=snap.eventYes!==null&&snap.eventYes!==undefined?(snap.eventYes?'yes':'no'):(snap.resolvedOutcome?.toLowerCase());
    return s===winner;
   }
  }
  return false;
 },[snap]);
 const allowed=isTradingAllowed(book,side);
 const getReason=()=>{
  if(!snap)return 'Loading…';
  const now=Date.now();
  const cutoffMs = snap.timing?.tradingCutoff ? toTimestampMs(snap.timing.tradingCutoff) : 0;
  if(cutoffMs > 0 && now > cutoffMs)return 'Trading cutoff reached';
  if(snap.lifecycle==='PRICE_FIXED'||snap.status==='settled')return 'Market settled';
  if(book==='binary'&&snap.lifecycle==='EVENT_RESOLVED')return 'Binary book closed';
  if(book==='asset'&&snap.lifecycle==='EVENT_RESOLVED'&&!allowed)return 'Losing leg frozen';
  return 'Trading frozen';
 };
 const review=async(e:React.FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{let fill=amount;if(privatePath){const r=await api<ClipResult>('/api/clip','POST',{requestedSize:amount,mode});if(!r.allowed)throw Error('The size policy rejected this request.');fill=r.clippedSize;}setQuote(await api<Quote>('/api/'+mode+'/quote','POST',{book,side,amount:fill,slippageBps:slippage}));setOriginal(amount);}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 const confirm=async()=>{if(!quote)return;setBusy(true);setError('');try{if(mode==='sandbox'){await api('/api/sandbox/trade','POST',quote);notify('Sandbox trade filled. No blockchain transaction occurred.');}else{if(!wallet)throw Error('Connect a wallet first.');const hash=await sendArcTrade(quote,config,wallet.account);notify('Arc transaction confirmed: '+hash);}setQuote(null);await refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 const disabled=busy||(mode==='arc'&&(!config.arcReady||!wallet))||!snap||!allowed;
 return <section className="panel trade-ticket"><div className="panel-heading"><h2>Express your view.</h2><span className="trade-mode">{mode==='sandbox'?'SANDBOX':'ARC'}</span></div><form onSubmit={review}><label className="field-label">What are you pricing?</label><div className="segmented book-switch"><button type="button" aria-pressed={book==='binary'} onClick={()=>setBook('binary')}>The event</button><button type="button" aria-pressed={book==='asset'} onClick={()=>setBook('asset')}>The asset</button></div><p className="ticket-caption">{book==='asset'?'Conditional shares of the synthetic index.':'Binary shares that pay $1 if your outcome wins.'}</p><div className="outcome-switch" role="group" aria-label="Choose your outcome">{(['yes','no'] as const).map(s=>{const canTrade=isTradingAllowed(book,s);const isFrozen=!canTrade&&snap?.lifecycle!=='OPEN';return <button type="button" key={s} aria-pressed={side===s} className={`${side===s?'selected '+s:''} ${isFrozen?'frozen':''}`} onClick={()=>setSide(s)}><span>{s==='yes'?<PiCheck/>:<PiX/>}Buy {s.toUpperCase()}{isFrozen?' (frozen)':''}</span><strong>{book==='binary'?snap?pct(s==='yes'?snap.stats.p:1-snap.stats.p):'—':money(snap?.stats[s==='yes'?'yesSharePrice':'noSharePrice'])}</strong></button>;})}</div><label htmlFor="trade-amount" className="field-label">Amount to spend</label><div className="amount-input"><span>$</span><input id="trade-amount" inputMode="decimal" required value={amount} onChange={e=>setAmount(e.target.value)} autoComplete="off" aria-describedby="precision"/><span>USDC</span></div><span className="sr-only" id="precision">Positive decimal with at most six decimal places</span><div className="quick-amounts">{['25','100','250','1000'].map(a=><button key={a} type="button" onClick={()=>setAmount(a)}>${a}</button>)}</div><label className="private-path"><input type="checkbox" checked={privatePath} onChange={e=>setPrivate(e.target.checked)}/><span><strong>{mode==='sandbox'?'Try the local size clip':'Use confidential size'}</strong><small>{mode==='sandbox'?'Demonstrates 1,000 → 50. Not a TEE.':'Requires your CRE endpoint.'}</small></span><PiLockKey/></label><div className="ticket-detail"><span>Pool fee</span><strong>0.30%</strong></div><label className="ticket-detail"><span>Maximum slippage</span><select aria-label="Maximum slippage" value={slippage} onChange={e=>setSlippage(Number(e.target.value))}><option value={10}>0.1%</option><option value={50}>0.5%</option><option value={100}>1.0%</option></select></label>{error&&!quote&&<ErrorBox>{error}</ErrorBox>}<button className="button primary block" disabled={disabled} type="submit">{busy?'Preparing quote…':mode==='arc'&&!config.arcReady?'Deployment not configured':mode==='arc'&&!wallet?'Connect wallet first':!snap?'Loading…':!allowed?getReason():mode==='sandbox'?'Review sandbox trade':'Review Arc trade'}<PiArrowRight/></button>{mode==='arc'&&!wallet&&<button className="button secondary block" type="button" onClick={connect}>Connect Arc wallet <PiWallet/></button>}<p className="ticket-foot">{mode==='sandbox'?'You are trading simulated USDC.':'Each transaction needs your wallet signature.'}</p></form>{quote&&<Dialog title="Review your trade" locked={busy} close={()=>{if(!busy)setQuote(null);}}><Status>{mode==='sandbox'?'Local simulation · no real funds':'Arc Testnet · public fill'}</Status><div className="review-summary"><div><span>{book==='asset'?'Synthetic asset':'Binary event'}</span><strong>{side.toUpperCase()} world</strong></div><strong>{money(quote.amount)}</strong></div>{privatePath&&<div className="reference-note"><PiLockKey/><span>Requested {money(original)} → public fill {money(quote.amount)}. {mode==='sandbox'?'Local clipping only. No enclave was used.':'The public size can reveal the cap.'}</span></div>}<dl className="quote-details">{[['Expected shares',quote.quantity],['Average price',money(quote.averagePrice,4)],['Price impact, including fee',quote.priceImpactPct.toFixed(2)+'%'],['Minimum shares received',(Number(quote.minOutUnits)/1e18).toFixed(6)],['Fee included',money(quote.fee,4)],['Quote valid for','2 minutes']].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><div className="reference-note warning"><PiInfo/>Losing shares pay zero. Winning asset shares are capped at {money(snap?.stats?.cap ?? 500)} per unit.</div>{error&&<ErrorBox>{error}</ErrorBox>}<button className="button primary block" disabled={busy} onClick={confirm}>{busy?'Confirming…':mode==='sandbox'?'Confirm sandbox trade':'Sign in wallet'}<PiArrowUpRight/></button></Dialog>}</section>;
}
function Positions({snap,mode,wallet,config,refresh,notify}: PositionsProps){const [chain,setChain]=useState<ArcPositionRow[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');useEffect(()=>{let cancelled=false;if(mode==='arc'&&wallet&&config?.arcReady)loadArcPositions(config,wallet.account).then(p=>{if(!cancelled)setChain(p);}).catch(e=>{if(!cancelled)setError(errorText(e));});return()=>{cancelled=true;};},[mode,wallet,config,snap?.revision]);const rows: AnyPositionRow[]=(mode==='sandbox'?(snap?.positions||[]):chain).filter(p=>BigInt(p.units)>0n);const claim=async()=>{setBusy(true);setError('');try{if(mode==='sandbox'){const r=await api<{paid:string}>('/api/sandbox/claim','POST',{});notify(`Claimed ${money(r.paid)} sandbox USDC. Losing legs paid zero.`);}else{if(!wallet)throw Error('Connect a wallet first.');await sendArcClaim(config,wallet.account);notify('Arc claim confirmed.');}await refresh();}catch(e){setError(errorText(e));}finally{setBusy(false);}};const canClaim=snap?.status==='settled'||snap?.lifecycle==='EVENT_RESOLVED'||snap?.lifecycle==='PRICE_FIXED';return <>{rows.length?<><div className="table-wrap"><table><thead><tr><th>Position</th><th>Quantity</th><th>{snap?.status==='settled'?'Claimable':'Settlement payoff'}</th></tr></thead><tbody>{rows.map(p=><tr key={p.book+p.side}><td><span className={'outcome-tag '+p.side}>{p.side.toUpperCase()}</span>{p.book==='asset'?(p.side==='residual'?'Residual claim (R)':'sNVDA share'):'Event share'}</td><td>{Number(p.quantity).toLocaleString('en-US',{maximumFractionDigits:4})}</td><td>{p.payout!==null&&p.payout!==undefined?money(p.payout):p.book==='asset'?(p.side==='residual'?`max(0, ${money(snap?.stats?.cap ?? 500)} − S)`:`min(index, ${money(snap?.stats?.cap ?? 500)}) or $0`):'$1 or $0'}</td></tr>)}</tbody></table></div>{canClaim&&<button className="button primary claim-button" disabled={busy} onClick={claim}>{busy?'Claiming…':mode==='sandbox'?'Claim sandbox payout':'Claim on Arc'}<PiArrowRight/></button>}</>:<div className="empty-state"><div className="empty-icon"><PiWallet/></div><h3>No positions yet.</h3><p>{mode==='sandbox'?'Review a trade or split a collateral pair to explore both outcomes.':'Connect a wallet and configure contracts to load holdings.'}</p><Status>{mode==='sandbox'?'Local sandbox':'Deployment required'}</Status></div>}{error&&<ErrorBox>{error}</ErrorBox>}</>;}
function Activity({snap}: ActivityProps){const rows=snap?.history||[];return rows.length?<div className="table-wrap"><table><thead><tr><th>Action</th><th>Amount</th><th>Shares</th><th>Time</th><th>Execution</th></tr></thead><tbody>{rows.slice(0,20).map(r=><tr key={r.id}><td>{r.type==='buy'?`Buy ${(r.side||'').toUpperCase()} · ${r.book==='asset'?'sNVDA':'event'}`:r.type==='split'?'Split pair':r.type==='merge'?'Merge pair':'Claim'}</td><td>{money(r.amount)}</td><td>{r.quantity?Number(r.quantity).toLocaleString('en-US',{maximumFractionDigits:4}):'—'}</td><td>{new Date(r.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</td><td><Status>Local</Status></td></tr>)}</tbody></table></div>:<div className="empty-state"><PiArrowsSplit/><h3>A clean slate.</h3><p>Confirmed sandbox actions will appear here.</p></div>;}
function MarketTabs(props: MarketTabsProps){const [tab,setTab]=useState('positions');return <section className="panel tab-panel"><div className="tabs" role="tablist" aria-label="Market details">{[['positions','Positions'],['activity','Your activity'],['rules','Market rules']].map(([id,label])=><button key={id} id={'tab-'+id} role="tab" aria-selected={tab===id} aria-controls={'panel-'+id} onClick={()=>setTab(id)}>{label}</button>)}</div><div role="tabpanel" id={'panel-'+tab} aria-labelledby={'tab-'+tab}>{tab==='positions'?<Positions {...props}/>:tab==='activity'?<Activity snap={props.snap}/>:<Rules/>}</div></section>;}
function Rules(){return <div className="rules"><p><strong>Event.</strong> An authorized DEMO_ORACLE reports the export outcome. This build does not independently verify government policy.</p><p><strong>Asset.</strong> sNVDA is a synthetic index, not stock or a claim on Nvidia.</p><p><strong>Binary payoff.</strong> The winning leg pays $1; the losing leg pays zero.</p><p><strong>Asset payoff & Residual.</strong> Complete sets mint Y + N + R for collateral equal to the cap ($500 standard). Winning asset leg pays min(oracle index, cap); losing leg pays zero. Residual claim R pays max(0, cap − min(oracle index, cap)). Total payoff per complete set is always exactly the cap.</p><p><strong>Prices.</strong> Midprices are not executable quotes. Conditional values imply a capped payoff, especially when the index exceeds $500.</p><p><strong>Risk.</strong> Owner controlled oracle, unaudited contracts, low liquidity and visible public fills. Do not use production funds.</p></div>;}
function Pairs({snap,mode,wallet,config,refresh,notify}: PairsProps){
 const [book,setBook]=useState<Book>('binary'),[quantity,setQuantity]=useState('1'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const cutoffMs = snap?.timing?.tradingCutoff ? toTimestampMs(snap.timing.tradingCutoff) : 0;
 const cutoffPassed = Boolean(cutoffMs > 0 && Date.now() > cutoffMs);
 const pairsFrozen=busy||snap?.lifecycle!=='OPEN'||cutoffPassed;
 const run=async(action:'split'|'merge')=>{setBusy(true);setError('');try{if(mode==='sandbox')await api('/api/sandbox/pairs','POST',{book,action,quantity});else{if(!wallet)throw Error('Connect a wallet first.');await sendArcPairs(config,wallet.account,{book,action,quantity});}await refresh();notify(`${action==='split'?'Split':'Merged'} ${quantity} ${mode==='sandbox'?'sandbox ':''}pair(s).`);}catch(e){setError(errorText(e));}finally{setBusy(false);}};
 return <section className="panel vault-panel"><div className="panel-heading"><h2>Collateral pairs</h2><PiArrowsSplit/></div><p>Mint complete sets with collateral (Y + N for binary, Y + N + R for asset). Merge complete sets before settlement to unlock collateral.</p><label className="field-label" htmlFor="pair-book">Book</label><select id="pair-book" value={book} onChange={e=>setBook(e.target.value as Book)}><option value="binary">Event · $1 per pair</option><option value="asset">Asset · {money(snap?.stats?.cap ?? 500)} per complete set (Y+N+R)</option></select><label className="field-label" htmlFor="pair-quantity">Number of pairs</label><input id="pair-quantity" className="plain-input" inputMode="decimal" value={quantity} onChange={e=>setQuantity(e.target.value)}/><div className="vault-buttons"><button className="button primary" onClick={()=>run('split')} disabled={pairsFrozen}>Split pair</button><button className="button secondary" onClick={()=>run('merge')} disabled={pairsFrozen}>Merge pair</button></div>{pairsFrozen&&snap?.status!=='open'&&<p className="muted" style={{fontSize:'12px',marginTop:'8px'}}>{snap?.status==='settled'?'Market settled. Collateral pairs cannot be minted or merged.':cutoffPassed?'Trading cutoff reached. Pairs are frozen.':'Pair minting and merging close once the event resolves.'}</p>}{error&&<ErrorBox>{error}</ErrorBox>}<p className="ticket-foot">{mode==='sandbox'?'Simulation only. No real funds.':'Each transaction needs a wallet signature.'}</p></section>;
}
function Oracle({snap,refresh,notify}: OracleProps){
 const [yes,setYes]=useState(true),[spot,setSpot]=useState('200'),[show,setShow]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const resolveEvent=async()=>{setBusy(true);setError('');try{await api('/api/sandbox/resolve-event','POST',{eventYes:yes});await refresh();notify(`Sandbox event resolved as ${yes?'YES':'NO'}. Binary claims unlocked; asset price observation pending.`);}catch(e){setError(errorText(e));}finally{setBusy(false);};};
 const fixPrice=async()=>{setBusy(true);setError('');try{await api('/api/sandbox/fix-price','POST',{spot});await refresh();notify(`Sandbox price fixed at ${money(spot)}. Asset & residual claims unlocked.`);}catch(e){setError(errorText(e));}finally{setBusy(false);};};
 const run=async()=>{setBusy(true);setError('');try{await api('/api/sandbox/settle','POST',{eventYes:yes,spot});await refresh();setShow(false);notify('Sandbox resolved and price fixed. Claim winning positions.');}catch(e){setError(errorText(e));}finally{setBusy(false);};};
 return <section className="panel oracle-panel"><div className="panel-heading"><h2>Oracle lifecycle</h2><Status>{snap?.timing?.policy==='accelerated-demo'?'Accelerated demo schedule':'Local demo oracle'}</Status></div>{snap?.settlement?<div className="settled-summary"><PiCheckCircle/><h3>{snap.settlement.eventYes?'YES':'NO'} world resolved · Settled</h3><p>Reported index {money(snap.settlement.spot)}.<br/>Asset payout {money(snap.settlement.payout)} per winning share{snap.settlement.capped?' · Capped':''}.</p><p>Residual claim payout <strong>{money(snap.settlement.residual)}</strong> per unit.</p><p>Claim from Positions tab. Reset sandbox on the market page to try another scenario.</p></div>:<><p>Simulate separate event resolution and price fixing stages ({snap?.timing?.label||'untimed sandbox policy'}).</p><div style={{margin:'12px 0',padding:'12px',background:'var(--soft)',border:'1px solid var(--border)',borderRadius:'6px',fontSize:'12px'}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:'4px'}}><span className="muted">Schedule</span><strong>{snap?.timing?.label||'Untimed local sandbox'}</strong></div><div className="muted"><small><strong>Rule:</strong> {snap?.timing?.observationRule||'Instant simulation'}</small><br/><small><strong>Source:</strong> {snap?.timing?.priceSource||'Synthetic oracle'}</small></div></div><div className="oracle-fields"><label>Event resolution<select value={String(yes)} onChange={e=>setYes(e.target.value==='true')} disabled={snap?.lifecycle==='EVENT_RESOLVED'}><option value="true">YES</option><option value="false">NO</option></select></label><label>Reported synthetic index<input className="plain-input" inputMode="decimal" value={spot} onChange={e=>setSpot(e.target.value)}/></label></div>{error&&<ErrorBox>{error}</ErrorBox>}<div className="vault-buttons">{snap?.lifecycle!=='EVENT_RESOLVED'&&<button className="button secondary" onClick={resolveEvent} disabled={busy}>1. Resolve event</button>}{snap?.lifecycle==='EVENT_RESOLVED'&&<button className="button primary" onClick={fixPrice} disabled={busy}>2. Fix price & settle</button>}{snap?.lifecycle!=='EVENT_RESOLVED'&&<button className="button primary" onClick={()=>setShow(true)} disabled={busy}>Resolve sandbox</button>}</div></>}{show&&<Dialog title="Resolve this sandbox market?" close={()=>setShow(false)}><p><strong>{yes?'YES':'NO'}</strong> wins with an index of <strong>{money(spot)}</strong>. Trading will stop. You can reset the sandbox later.</p>{error&&<ErrorBox>{error}</ErrorBox>}<button className="button primary block" disabled={busy} onClick={run}>{busy?'Resolving…':'Confirm sandbox resolution'}</button></Dialog>}</section>;
}
function Guide(props: GuideProps){const {mode,config,refs}=props;return <div className="container app-container guide"><div className="page-heading"><span className="eyebrow">Transparent by design</span><h1>Know what’s running.</h1><p>Local exploration works without accounts. Live evidence must come from actual integrations, not a badge.</p></div><div className="integration-grid"><article className="panel"><PiArrowsSplit/><h2>Arc</h2><Status>{config.arcReady?'Addresses configured':'Deployment required'}</Status><p>Public USDC pools, escrow and settlement. ERC20 collateral uses 6 decimals; native gas uses 18.</p><External href="https://docs.arc.network/arc/references/connect-to-arc">Arc setup documentation</External></article><article className="panel"><PiLockKey/><h2>Chainlink CRE</h2><Status>{config.creReady?'Endpoint configured':'Confidential access required'}</Status><p>The enclave applies a secret policy. The public fill can reveal the cap. Local clipping is not TEE evidence.</p><External href="https://docs.chain.link/cre-templates/hello-confidential-workflows">Confidential workflow guide</External></article><article className="panel"><PiGitBranch/><h2>The Graph</h2><Status blue={refs.spot.status==='live'}>{refs.spot.status==='live'?'Reference fetched':'Reference unavailable'}</Status><p>Server side queries keep keys out of the browser. Different asset analogs are never passed off as identity matches.</p><External href="https://thegraph.com/studio">Open Graph Studio</External></article></div><section className="panel guide-equation"><span className="eyebrow">The pricing identity</span><h2>Four numbers. One coherent view.</h2><code>P × E[S | YES] + (1 − P) × E[S | NO] = implied index</code><p>Independent pools set the numbers. They are not pegged to Graph. Conditional prices are hidden below 2% or above 98% YES probability to avoid unstable division. The {money(props.snap?.stats?.cap ?? 500)} payout cap affects what the asset shares represent.</p></section><div className="guide-columns"><section className="panel"><h2>Collateral, not a promise.</h2><Rules/></section>{mode==='sandbox'?<Oracle {...props}/>:<section className="panel"><h2>Arc settlement</h2><p>Only the authorized demo oracle key can settle the deployed contracts. The web server does not hold that key or silently resolve live markets.</p></section>}</div><section className="section faq-section"><div><span className="eyebrow">The details matter</span><h2>Read before<br/>connecting funds.</h2></div><FAQ/></section><section className="risk-banner"><PiWarningCircle/><div><h3>Research software. Not a production financial service.</h3><p>Unaudited contracts. No real stock custody, investment advice, performance promises or approved legal policies. Verify compiled contracts, transactions, oracle controls and confidentiality before public deployment.</p></div></section></div>;}
function FAQ(){return <div className="faq-list">{[['Is sNVDA an actual stock?','No. It is a synthetic index for this demonstration. No Nvidia stock is held in the vault, and no ownership claim is created.'],['Am I using real USDC?','Not in sandbox mode. Balances and transactions are simulated. Arc Testnet mode is separate, needs deployed contracts, and requires a wallet signature for every transaction. Never use mainnet funds.'],['What happens to the losing world and residual?','Losing binary and asset shares pay zero. The winning asset leg pays min(index, cap). Any remainder below the cap is paid to explicit residual claim holders (R), ensuring total collateral across Y + N + R is fully accounted for.'],['Are the four numbers hardcoded?','No. They are calculated from the current pool reserves. Trades change those reserves. The initial sandbox liquidity is illustrative, not historical or live market data.'],['Are the references and private clip live?','Only once the server has verified sources and the required access. Missing Graph data is shown as unavailable. The local size clip is a simulation, not an enclave execution.'],['Can the same design support another asset?','The contracts use an oracle reported index, not a hardcoded real asset. Each additional market still needs a clear event, reliable oracle and correctly labeled reference data.']].map(([q,a])=><details key={q}><summary>{q}<PiCaretDown/></summary><p>{a}</p></details>)}</div>;}
createRoot(document.getElementById('root')!).render(<App/>);
