# THELEMA — demo video script

ETHOnline wants **2–4 minutes**, **≥720p**, **your voice**. Record like the [web3torrent demo](https://www.youtube.com/watch?v=T0jY6BqNS3w): calm, show the product, name the stack, stop.

No music. No stock footage. You talking over the app.

Live site: https://thelema.onrender.com  
Repo: https://github.com/ShrikarT/thelema

Read the **SAY** lines out loud. Do the **DO** lines. Ignore the timestamps if you run long — finish under 4:00.

---

## How to record

1. Open the PPT (`docs/THELEMA.pptx`) on a second screen for slides 1–2 and 7–8 only.
2. Chrome, 1280×800 or larger, logged into the wallet you used on Arc Testnet. Sandbox is fine if the wallet path is slow — say so.
3. OBS / QuickTime, 1080p, mic close, room quiet.
4. Cut: title slide → app → three-partner slide → thanks. That is the whole video.

Hard cuts. No zoom spam.

---

## 0:00–0:20 · Title

**ON SCREEN:** Slide 1.

**SAY**

Hi. I’m Shrikar. This is THELEMA.

Prediction markets tell you if something happens.
We tell you what that does to an asset.

Same event. Two world prices. One vault of USDC.

---

## 0:20–0:40 · The idea

**ON SCREEN:** Slide 2.

**SAY**

Take China authorizing AI-chip exports.

A yes/no book only prices the headline.
THELEMA also prices NVIDIA in the world where it happens, and in the world where it doesn’t.

The gap is the impact. That’s the product.

---

## 0:40–1:40 · Live book

**ON SCREEN:** App. Markets → China AI-chip book. Ticket visible.

**DO**

- Click **Trade** / open `sNVDA`.
- Point at **If happens** and **If it doesn’t**.
- Point at **P**, then **Impact**.
- Set Long → Impact → If happens → **50** USDC.
- Place the trade. Wait for the toast.

**SAY**

Here’s a live book.

Left side is the event. Right side is the ticket.

If happens is this price.
If it doesn’t is this one.
Probability is this.

None of these are typed in. They come out of the pool reserves.

I’m buying fifty dollars of the happens world.

Fill lands. Probability moves. Volume was zero before I traded. Now it isn’t.

Losing shares pay zero. Winning shares pay the min of the index and the cap.

---

## 1:40–2:10 · Clip

**DO**

- Type **1000** in the size field.
- Watch it clip to 50, or say the toast if it already clipped on submit.

**SAY**

If I ask for a thousand dollars, it does not go on-chain as a thousand.

Chainlink CRE holds a private max notional.
The fill you see is fifty.
The chain never learns the number I typed.

That workflow is compiled to WASM. We ran the official simulator. There is no live TEE in production yet. I’m not going to pretend there is.

---

## 2:10–2:35 · Vault

**DO**

- Scroll to Position / Worlds.
- Point at USDC, YES, NO, residual.

**SAY**

Collateral is Arc native USDC. The precompile. Not a wrapped IOU.

Deposit C. You mint yes, no, and residual.
On the winning world the share pays min of S and C.
The residual holds the rest.
Yes plus no plus residual always equals C.

No liquidation engine. The vault cannot go insolvent by construction.

---

## 2:35–2:50 · The Graph

**DO**

- Point at the Graph / independent reference panel if it’s on the page. If it isn’t, stay on the ticket and say this anyway.

**SAY**

The Graph is a second tape, not the settlement oracle.

Uniswap V3 and SushiSwap, same Messari pool schema, WETH on Arbitrum.
If they agree, we say agreeing. If they’re stale, we fail closed.

It does not price NVIDIA. sNVDA is a synthetic index. Not the stock.

---

## 2:50–3:10 · Close

**ON SCREEN:** Slide 7, then 8.

**SAY**

Three partners. One loop.

Arc holds the USDC.
Chainlink clips the size.
The Graph checks the outside world.

Contracts are on Arc Testnet. Unaudited. Not a broker.

Live at thelema.onrender.com.
Code at github.com/ShrikarT/thelema.

Thanks.

---

## If you only have 2 minutes

Cut the Graph beat. Keep: idea → one trade → clip → vault → close.

## If a click fails

Do not apologize for more than one sentence. Switch to Sandbox, say “same math, local book,” and keep going.

## Words to never say

- “revolutionary”
- “we leverage”
- “AI-powered”
- fake volume, fake traders, fake TVL
- “live TEE” (it is not)
- “this is NVIDIA stock” (it is not)
