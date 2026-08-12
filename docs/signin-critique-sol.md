# Sign-in critique — Sol

## 1. What I looked at

- Branch `main`, local Vite at `http://127.0.0.1:5199/sign-in` and `/sign-up`.
- Live Chrome at exact 1440×900, 1024×900, 768×900 and 320×900 viewports. Clerk mounted in both flows.
- The browser reported `devicePixelRatio = 1.25` before emulation; Windows independently reports `AppliedDPI = 120`. Exact viewport emulation kept DPR at 1.25. I did not use Playwright's DPR-1 default.
- Sakura Night and an emulated light preference. Bamboo Day cannot actually render here: with `prefers-color-scheme: light`, `.signin-root` still resolved `--bg: #0a0a0a`, had no `.app-root.light` ancestor, and Clerk remained pinned to its dark base theme. So this was one rendered theme, not two successful theme checks.
- Current steady-state, the brief Clerk-loading interval on a reload, sign-in, and sign-up. I source-reviewed the 10-second Clerk-down state and the already-signed-in gate; I did not force either into a browser. A Slow 3G reload held the Vite development module graph on a blank pre-React field for over 60 seconds, which is not a fair production measurement, so I do not use it as evidence against `SignInPage`.
- Accessibility tree, seven keyboard stops on sign-in, computed focus styles, and rendered color pairs. I did not complete authentication or run NVDA, because I had no test account. The AX-tree observations below are not a screen-reader certification.
- `gallery.html` does not contain sign-in, sign-up, loading, or down-state frames. That leaves the first screen outside the project's normal two-theme visual comparison.

My plain verdict: the current 1440/1024 steady-state is not “really bad.” It is authored, coherent with the app, and better than a generic auth page. The complaint becomes true at the information order, the collapsed layout, and the states around Clerk.

## 2. The three worst things, ranked

### 1. The product's outcome arrives after its proof, and after the form on narrow screens

At 1440, the headline starts at y=190, but “One reply, reconciled” is at y=684 and the sentence explaining what the visitor receives is at y=725. A stranger learns that several models answer immediately, but must cross seven rows before learning that ALOP-AI returns one reconciled reply rather than seven chats.

The 900px breakpoint makes this worse. At 768, the auth card occupies y=106–613 and the product headline starts at y=637. At 320, the card occupies y=90–593 and the headline starts at y=617. The first consequential choice—Google or identifier—therefore precedes the first product sentence. Visually the card is first, while DOM/AX order remains thesis then card, so sighted and screen-reader users receive opposite sequences.

The ladder itself is worth keeping on desktop. The role names and real companies make “several models” concrete; it is persuasion, not generic decoration. The temperatures are a spec-sheet detail, but the current edit correctly demotes them. The failure is asking the ladder to carry the outcome copy and then putting the whole argument after authentication when the grid collapses.

Real visitor failure: on mobile, “What is this?” is answered after “How would you like to sign in?” On desktop, “What do I get?” is answered roughly 406px after the headline.

### 2. Live sign-up has no route to Terms or Privacy

On `/sign-up`, after Clerk mounted, the live subtree contained zero Terms/Privacy links and zero checkboxes. Its only links were “Sign in” and the Clerk logo. The local comment and test assume Clerk renders a required legal-consent checkbox, but this Clerk configuration did not render one in this browser.

Real visitor failure: someone can create an account without any visible route to either document. This is worse than duplicated consent copy. It is also an example of a test pinning an assumption about third-party markup instead of the user-visible contract.

### 3. The loading slot looks broken until the down-state finally admits failure

While Clerk is not loaded, `.signin-card-loading` reserves 342px (306px below 480px), is empty, and is `aria-hidden`. The surrounding card title, plan note, and legal copy render around a large blank middle. On a current reload I captured that interval before the form arrived.

The ten-second down-state is good: it is calm, specific, and gives a real Reload action. But until second ten, the blank card has no visible or announced distinction between “secure sign-in is loading” and “the form failed to render.”

Real visitor failure: a slow dependency presents as a broken composition, then abruptly becomes an outage. The page already knows which of those states it is in; it should say so without inventing progress.

## 3. The proposal

### Put comprehension before action, and proof after action on narrow screens

Split the current thesis into `signin-intro` and `signin-proof`, with DOM order matching the mobile experience:

```jsx
<div className="signin-grid">
  <section className="signin-intro">
    <h1 className="signin-title">Ask once. Several models answer.</h1>
    <p className="signin-tagline">They disagree on purpose. You get what they agreed on, and where they didn’t.</p>
  </section>
  <section className="signin-card">…Clerk…</section>
  <section className="signin-proof" aria-labelledby="council-proof-title">
    <h2 id="council-proof-title" className="sr-only">How the council is composed</h2>
    <p id="council-scale" className="sr-only">Seven seats, ordered from lower to higher sampling temperature. Each item starts with its temperature.</p>
    <ol className="council-ladder" aria-describedby="council-scale">…</ol>
    <p className="council-resolve">One reply, reconciled. <Seal … /></p>
  </section>
</div>
```

Use these areas and keep the current 380px card:

```css
.signin-grid { grid-template-areas: "intro card" "proof card"; column-gap: clamp(32px, 6vw, 88px); row-gap: 16px; }
.signin-intro { grid-area: intro; align-self: end; }
.signin-card { grid-area: card; align-self: center; }
.signin-proof { grid-area: proof; align-self: start; }
@media (max-width: 900px) {
  .signin-grid { grid-template-areas: "intro" "card" "proof"; row-gap: 24px; }
  .signin-intro, .signin-proof { width: min(100%, 34rem); }
}
```

This keeps the seal closing the ladder, preserves the ornament argument, and puts the existing plain-language tagline directly under the headline. Do not duplicate the headline or invent a new sales paragraph.

### Own the legal links in both flows

Do not condition the existence of legal links on Clerk markup. Replace the sign-up age-only branch with:

```jsx
<p className="signin-legal">
  By creating an account you agree to our <a href="/terms.html" …>Terms</a> and <a href="/privacy.html" …>Privacy Policy</a>.
  You must be at least 13 years old to use ALOP-AI (16 in the EEA and UK).
</p>
```

Change the test contract: both flows must expose both document links; sign-up must also expose the age statement. Do not test that our links are absent because Clerk is expected to supply them.

### Make waiting honest after a short grace period

Keep the reserved height. After 700ms of `!isLoaded`, render this inside the slot:

```jsx
<div className="signin-card-loading" role="status">Preparing secure sign-in…</div>
```

```css
.signin-card-loading { min-height: 342px; display: grid; place-items: center; color: var(--text-muted); font-size: var(--text-sm); text-align: center; }
```

Use a timer for the 700ms grace period, not an entrance animation. No spinner, shimmer, fake form, or rotating status verbs. The still state is the good state and the sentence is literally true.

### Close the theme and gallery gap as a follow-up

Pass the saved `alop-dark-mode` choice through the signed-out gate and render `.signin-root.app-root.dark` or `.signin-root.app-root.light`. Replace Clerk's hardcoded `baseTheme: "dark"`/hex variables with the matching base theme and CSS token values. Then add gallery frames for sign-in, sign-up, loading and down in both themes. Until that exists, describe sign-in honestly as Sakura Night-only.

Accessibility record for the current edit: the live outline is now correctly one H1 (“Ask once…”) then one H2 (“Sign in”/“Create your account”). Keyboard order is Google → identifier → Continue → Sign up → Clerk logo → Terms → Privacy; all seven had a visible 1.6px pink outline, and the input retained its 3px halo without clipping. Plan/legal text measured 5.41:1 on the card; legal links measured 9.15:1. The council exposes a seven-item list, but each item is currently announced starting with an unexplained decimal, then role, company, and optional “Pro”; the hidden scale description above makes that current experience intelligible without changing the visual texture.

## 4. My surprise

Turn “3 models free. All 7 on Pro.” into a tiny council seat-meter immediately above the same sentence: seven 14×2px bars in `--ornament-mist`, with `m.free` seats at `opacity: var(--ornament-a-mid)` and Pro-only seats at `opacity: var(--ornament-a-faint)`. Keep the existing sentence for accessibility and mark the bars `aria-hidden`.

It is specific to this product, makes the plan note scannable, and uses mist because brand pink at the same visibility would read as highlighter. Cost: seven spans (or one inline SVG), roughly 15 CSS lines, and four new gallery frames to prove it does not compete with the form. If it competes, delete it; the form wins.

## 5. What I would not do

- I would not delete the council ladder for benefit cards, testimonials, or a conventional marketing hero. The desktop proof is the authored part.
- I would not replace or reimplement Clerk, nor add custom OAuth/input/error handling around it.
- I would not restore branches, torii, drifting orbs, or another design family. The lattice, crescents, seal, and warm surface already read as one hand.
- I would not increase pink ornament alpha to make the page feel richer. At the real DPR, `--lattice-line` resolves to 2 device pixels and reads cleanly; the material is not the current problem.
- I would not animate loading or manufacture step-by-step progress. One honest status sentence is enough.
