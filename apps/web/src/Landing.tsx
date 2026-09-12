import React, {useState} from 'react';
import {PiArrowUpRight, PiArrowRight, PiArrowsSplit, PiCheck, PiGlobeHemisphereWest, PiLockKey, PiTrendUp, PiWaveSine} from 'react-icons/pi';
import {money, pct, type Stats} from './api';

export interface NavigationLinkProps {
  to: string;
  children: React.ReactNode;
  className?: string;
}

export type NavigationLink = React.ComponentType<NavigationLinkProps>;

export function Landing({Link, stats, faq}: {Link: NavigationLink; stats?: Stats; faq: React.ReactNode}) {
  const [world, setWorld] = useState<'yes' | 'no'>('yes');
  const conditional = world === 'yes' ? stats?.eYes : stats?.eNo;

  return <div className="landing-page">
    <section className="landing-hero" aria-labelledby="hero-heading">
      <img className="hero-art" src="/assets/tanker-hero.webp" alt="An engraved ocean tanker crossing open water" fetchPriority="high"/>
      <div className="hero-art-credit">A WORLD IN MOTION / 001</div>
      <div className="landing-hero-content">
        <span className="landing-kicker"><span className="signal-dot"/> A new perspective on prediction markets</span>
        <h1 id="hero-heading">Trade the impact.<br/>Not just the odds.</h1>
        <p>A policy shift. A rate cut. A world that changes.<br className="desktop-break"/> Price what it means for an asset, before it happens.</p>
        <Link to="/market" className="button hero-cta">Explore markets <PiArrowUpRight/></Link>
        <span className="hero-reassurance"><PiCheck/> Start in the sandbox. No wallet needed.</span>
      </div>
      <div className="hero-coordinate" aria-hidden="true"><span>ONE EVENT</span><PiArrowsSplit/><span>TWO POSSIBLE WORLDS</span></div>
      <div className="hero-caption"><PiGlobeHemisphereWest/><span>The world doesn’t move in a straight line.<br/><strong>Your thinking shouldn’t either.</strong></span></div>
      <div className="hero-sample">
        <div className="hero-sample-top"><span>sNVDA / AI policy</span><span className="sample-label">Sandbox preview</span></div>
        <div className="hero-sample-prices"><div><span><i className="yes-dot"/> If it happens</span><strong>{money(stats?.eYes)}</strong></div><div><span><i className="no-dot"/> If it doesn’t</span><strong>{money(stats?.eNo)}</strong></div></div>
        <div className="hero-sample-bottom"><span>One synthetic asset. Two prices.</span><PiArrowUpRight/></div>
      </div>
    </section>

    <section className="infrastructure-strip" aria-label="THELEMA infrastructure">
      <span>Built for a different<br/><strong>kind of market.</strong></span>
      <div><span className="partner-wordmark arc-wordmark">arc</span><small>USDC collateral</small></div>
      <div><span className="partner-wordmark"><span className="chainlink-symbol" aria-hidden="true"/>Chainlink</span><small>CRE size policy</small></div>
      <div><span className="partner-wordmark"><span className="graph-symbol" aria-hidden="true">◌</span>The Graph</span><small>Independent references</small></div>
      <span className="infrastructure-note">Three integrations.<br/>One complete loop.</span>
    </section>

    <section className="landing-section product-story" id="the-idea">
      <div className="story-intro"><span className="eyebrow">01 / Beyond yes or no</span><h2>The event is only<br/>half the story.</h2><p>Most markets ask if something will happen. THELEMA asks what that event does to an asset.</p><p>The same asset. A price in each world. The difference is the impact.</p><Link to="/market" className="text-link">See the market in action <PiArrowUpRight/></Link></div>
      <div className="scenario-demo">
        <div className="scenario-demo-top"><span className="asset-monogram">N</span><div><span className="eyebrow">AI policy × sNVDA</span><h3>What if the rules change?</h3></div><span className="sample-label">Sandbox</span></div>
        <div className="scenario-toggle" aria-label="Explore a possible world">
          <button aria-pressed={world === 'yes'} onClick={() => setWorld('yes')}><i className="yes-dot"/> If it happens</button>
          <button aria-pressed={world === 'no'} onClick={() => setWorld('no')}><i className="no-dot"/> If it doesn’t</button>
        </div>
        <div className={`scenario-value ${world}`}><span>Conditional sNVDA price</span><strong>{money(conditional)}</strong><p>{world === 'yes' ? 'The world where qualifying AI chip exports are authorized.' : 'The world where a general authorization does not arrive.'}</p></div>
        <div className="scenario-branch" aria-hidden="true"><span/><PiArrowsSplit/><span/></div>
        <div className="scenario-demo-footer"><div><span>Event probability</span><strong>{pct(stats?.p)}</strong></div><div><span>Priced impact</span><strong>{money(stats?.impact)}</strong></div></div>
        <p className="illustration-note">Derived from simulated pool reserves. Not a live forecast.</p>
      </div>
    </section>

    <section className="landing-section landing-benefits" aria-label="Why impact markets">
      <article><span className="benefit-symbol"><PiArrowsSplit/></span><span className="eyebrow">A fuller picture</span><h3>See the consequence.</h3><p>Separate the chance of an event from the price of an asset in each outcome.</p></article>
      <article><span className="benefit-symbol"><PiTrendUp/></span><span className="eyebrow">Prices, not promises</span><h3>Follow your conviction.</h3><p>Trade against public AMM pools. Your fill changes the prices, not a decorative chart.</p></article>
      <article><span className="benefit-symbol"><PiLockKey/></span><span className="eyebrow">Clear by design</span><h3>Know what’s at stake.</h3><p>Inspect the collateral, payout cap and losing outcome before you confirm a trade.</p></article>
    </section>

    <section className="landing-manifesto tagline-section">
      <span className="eyebrow">A different way to see what’s next</span>
      <h2>{['Don’t', 'just', 'ask', 'if.'].map((word, i) => <span className="reveal-word" style={{transitionDelay: `${i * 80}ms`}} key={word}>{word}{' '}</span>)}<br/>{['Ask', 'what', 'changes.'].map((word, i) => <span className="reveal-word" style={{transitionDelay: `${(i + 4) * 80}ms`}} key={word}>{word}{' '}</span>)}</h2>
      <div className="asset-universe"><span>Equities</span><i/><span>Crypto</span><i/><span>Commodities</span><i/><span>FX</span><i/><span>Indices</span></div>
      <p>One primitive for any priced asset.<br/>Start with one synthetic market.</p>
      <PiWaveSine className="manifesto-wave" aria-hidden="true"/>
    </section>

    <section className="landing-section landing-how" id="how-it-works">
      <div className="landing-section-heading"><div><span className="eyebrow">02 / From a view to a position</span><h2>Think it through.<br/>Then trade it.</h2></div><p>Explore the complete loop in the sandbox.<br/>Connect a wallet only when you choose Arc Testnet.</p></div>
      <div className="landing-steps">{[
        ['01', 'Find your catalyst.', 'Choose an event and explore the synthetic asset in each possible world.'],
        ['02', 'Make your call.', 'Pick an outcome. Review your shares, price impact, pool fee and minimum output.'],
        ['03', 'Reality picks a world.', 'The winning leg pays. The losing leg pays zero. Asset payouts stay within the cap.']
      ].map(([n, title, text]) => <article key={n}><span className="step-number">{n}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>

    <section className="landing-section landing-faq"><div><span className="eyebrow">03 / No fine print thinking</span><h2>A little clarity<br/>goes a long way.</h2><p>A research product, with real boundaries.<br/>Here’s what to know before you start.</p></div>{faq}</section>
    <section className="landing-final"><span className="eyebrow">Your next perspective</span><h2>The future has sides.<br/>Explore both.</h2><Link to="/market" className="button hero-cta">Explore markets <PiArrowUpRight/></Link><span>Testnet only. Synthetic assets. No real stock custody.</span></section>
  </div>;
}
