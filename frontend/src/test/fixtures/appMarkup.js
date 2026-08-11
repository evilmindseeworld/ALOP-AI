/**
 * Representative markup for every component the stylesheet targets.
 *
 * Transcribed from the real JSX, not invented — a fixture that drifts from the
 * app silently stops guarding the parts that drifted. When you add a component
 * or a state class, add it here too.
 *
 * Both themes are rendered side by side rather than crossed into the snapshot's
 * environment matrix, because the theme lives on a `.app-root` class rather
 * than a media query. One pass over this tree therefore covers both.
 */

export const appTree = (theme) => `
<div class="app-root ${theme}">
  <a class="skip-link" href="#transcript">Skip to the conversation</a>

  <div class="bg-layer"></div>
  <div class="bg-overlay"></div>

  <div class="toast">Pro is active</div>

  <div class="camera-overlay">
    <video class="camera-video"></video>
    <canvas></canvas>
    <div class="camera-controls">
      <button class="camera-btn primary">Capture</button>
      <button class="camera-btn secondary">Cancel</button>
    </div>
  </div>

  <div class="cmdk-backdrop">
    <div class="cmdk" role="dialog" aria-modal="true">
      <div class="cmdk-search">
        <span class="cmdk-search-icon">⌘</span>
        <input class="cmdk-input" placeholder="Search chats, or run a command..."/>
        <kbd class="cmdk-kbd">esc</kbd>
      </div>
      <div class="cmdk-list" id="cmdk-list" role="listbox">
        <div class="cmdk-empty">No matches</div>
        <button class="cmdk-item is-active" data-active="true" role="option">
          <span class="cmdk-item-icon">✚</span><span class="cmdk-item-label">New chat</span><span class="cmdk-item-hint">Ctrl N</span>
        </button>
        <button class="cmdk-item" role="option">
          <span class="cmdk-item-icon">💬</span><span class="cmdk-item-label">A chat</span><span class="cmdk-item-hint">Chat</span>
        </button>
      </div>
      <div class="cmdk-footer">
        <span><kbd class="cmdk-kbd">↑</kbd><kbd class="cmdk-kbd">↓</kbd> navigate</span>
        <span><kbd class="cmdk-kbd">↵</kbd> select</span>
        <span>2 results</span>
      </div>
    </div>
  </div>

  <div class="app-shell">
   <div class="app-frame">
    <header class="app-header">
      <button class="icon-btn mobile-only"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
      <button class="icon-btn desktop-only"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
      <div class="brand">
        <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" class="header-logo" alt=""/>
        <h1 class="main-title">ALOP-AI</h1>
      </div>
      <div class="header-actions">
        <button class="cmdk-trigger desktop-only"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg><span>Search</span><kbd>Ctrl K</kbd></button>
        <button class="upgrade-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg> <span class="upgrade-label">Upgrade</span></button>
        <button class="icon-btn admin-btn active"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
        <button class="icon-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
      </div>
    </header>

    <div class="app-body">
      <nav class="sidebar" aria-label="Chats">
        <div class="sidebar-rail" aria-hidden="true">
          <button class="rail-btn rail-new"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
          <button class="rail-btn rail-search"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
          <div class="rail-divider"></div>
          <div class="rail-chats">
            <button class="rail-chat active" aria-label="Pinned chat">P</button>
            <button class="rail-chat" aria-label="Plain chat">P</button>
          </div>
          <div class="rail-foot is-active" aria-hidden="true">
            <svg class="rail-keystone" viewBox="0 0 48 24"><path d="M0 0"/></svg>
          </div>
        </div>

        <div class="sidebar-full">
          <div class="sidebar-header">
            <button class="new-chat-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg> New Chat</button>
            <button class="icon-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
          </div>

          <div class="sidebar-search">
            <svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg>
            <input class="sidebar-search-input" type="text" placeholder="Search chats"/>
            <button class="sidebar-search-clear"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
          </div>

          <div class="chat-list">
            <div class="chat-empty">No chats yet</div>
    <div class="chat-empty is-error" role="status">
      <p class="chat-empty-title">Couldn&rsquo;t load your chats.</p>
      <p class="chat-empty-body">They are safe on the server.</p>
      <button class="chat-empty-retry">Try again</button>
    </div>

            <div class="chat-group">
              <div class="chat-group-label">Pinned</div>
              <div class="chat-item active pinned">
                <button class="chat-title">Pinned chat</button>
                <div class="chat-actions">
                  <button class="chat-action is-on"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
                  <button class="chat-action"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
                  <button class="chat-action is-danger"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
                </div>
              </div>
            </div>

            <div class="chat-group">
              <div class="chat-group-label">Favourites</div>
              <div class="chat-item favorite">
                <input class="custom-input chat-title-input" value="Renaming"/>
                <div class="chat-actions"><button class="chat-action is-on"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button></div>
              </div>
            </div>

            <div class="chat-group">
              <div class="chat-group-label">Recent</div>
              <div class="chat-item"><button class="chat-title">Plain chat</button></div>
            </div>
          </div>

          <div class="sidebar-user">
            <div class="sidebar-user-avatar is-fallback">A</div>
            <div class="sidebar-user-text">
              <span class="sidebar-user-name">Ada Lovelace</span>
              <span class="sidebar-user-plan">Free</span>
            </div>
            <button class="sidebar-upgrade"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
          </div>
        </div>
      </nav>

      <div class="sidebar collapsed"><div class="sidebar-rail"><div class="rail-chats"></div></div><div class="sidebar-full"><div class="chat-list"></div></div></div>
      <div class="sidebar mobileOpen"><div class="sidebar-full"><div class="chat-list"></div></div></div>

      <main class="chat-main">
        <!-- The ornament hangs inside the transcript panel, in the margin the
             centred column creates. It used to be fixed to the window, which
             is where the sidebar and header are. -->
        <div class="earring-wrap earring-left" aria-hidden="true">
          <div class="earring-chain"></div>
          <div class="earring-pivot"><svg class="crescent" width="96" height="132" viewBox="0 0 96 132"><defs><linearGradient><stop/></linearGradient></defs><path d="M0 0"/></svg></div>
        </div>
        <div class="earring-wrap earring-right is-active" aria-hidden="true">
          <div class="earring-chain"></div>
          <div class="earring-pivot"><svg class="crescent" width="96" height="132" viewBox="0 0 96 132"><path d="M0 0"/></svg></div>
        </div>

        <div class="panel-overlay"></div>
        <div class="side-panel">
          <div class="panel-header">
            <div class="panel-title">Settings</div>
            <button class="icon-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
          </div>
          <div class="panel-body">
            <div class="setting-row">
              <div class="setting-label">Appearance</div>
              <div class="theme-toggle active">
                <span class="theme-toggle-label">Sakura Night</span>
                <div class="theme-toggle-switch"></div>
              </div>
            </div>
            <div class="setting-row"><button class="theme-card">Export chat as Markdown</button></div>
            <div class="setting-row"><button class="theme-card is-danger">Delete Chat</button></div>

            <div class="setting-row setting-block">
              <div class="setting-label">What I remember about you</div>
              <div class="setting-note">Couldn't load your memory. <button class="link-button">Retry</button></div>
              <ul class="fact-list">
                <li class="fact-row">
                  <span class="fact-text">The user is a teacher in Dubai.</span>
                  <button class="fact-forget">Forget</button>
                </li>
              </ul>
              <button class="theme-card">Forget everything</button>
            </div>

            <div class="admin-title">3 Users</div>
            <div class="admin-user-card">
              <div class="admin-user-header">
                <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" class="admin-avatar" alt=""/>
                <div><div>Someone</div><div>someone@example.com</div></div>
                <span class="admin-badge pro">pro</span>
                <span class="admin-badge admin">Admin</span>
              </div>
              <div class="msg-actions">
                <button class="msg-action-btn">Suspend</button>
                <button class="msg-action-btn">Delete</button>
              </div>
            </div>
            <div class="admin-user-card">
              <div class="admin-user-header"><span class="admin-badge free">free</span></div>
            </div>

            <div class="plan-state" role="status">
      <p class="plan-state-title">Couldn&rsquo;t load the plans.</p>
      <p class="plan-state-body">This request failed.</p>
      <button class="plan-state-retry">Try again</button>
    </div>
    <div class="plan-grid">
              <div class="plan-col">
                <div class="plan-name">Free</div>
                <ul class="plan-feats"><li>4 models in the council</li></ul>
              </div>
              <div class="plan-col is-pro">
                <div class="plan-name">Pro <span class="plan-badge">Recommended</span></div>
                <ul class="plan-feats"><li><strong>All 7 models</strong></li></ul>
              </div>
            </div>
            <div class="plan-buttons">
              <button class="plan-buy">Monthly — $9</button>
              <button class="plan-buy is-secondary">Yearly — $90</button>
            </div>
            <div class="plan-note">Secure checkout by Stripe.</div>
          </div>
        </div>

        <div class="chat-content">
          <div class="sakura-base" aria-hidden="true"><svg class="sakura-corner sakura-corner-bl" viewBox="0 0 120 76"><path d="M0 0"/></svg><svg class="sakura-keystone" viewBox="0 0 48 24"><path d="M0 0"/></svg><svg class="sakura-corner sakura-corner-br" viewBox="0 0 120 76"><path d="M0 0"/></svg></div>
          <div class="scroll-wrapper">
            <div class="empty-state">
              <div class="sakura-frame" aria-hidden="true"><svg class="sakura-corner sakura-corner-tl" viewBox="0 0 120 76"><path d="M0 0"/></svg><svg class="sakura-corner sakura-corner-tr" viewBox="0 0 120 76"><path d="M0 0"/></svg></div>
              <span class="empty-mark"><svg class="council-rosette" viewBox="0 0 320 320"><path d="M0 0"/></svg><img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" class="empty-logo" alt="ALOP-AI"/></span>
              <h2 class="empty-title text-shimmer">ALOP-AI<span class="empty-title-accent">Assembled.</span></h2>
              <p class="empty-subtitle">Ask the AI Council anything.</p>
              <div class="starter-grid">
                <button class="starter-card">
                  <span class="starter-icon"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></span>
                  <span class="starter-label">Weigh a decision</span>
                  <span class="starter-prompt">Postgres or Mongo?</span>
                </button>
                <button class="starter-card">
                  <span class="starter-icon"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></span>
                  <span class="starter-label">Search the live web</span>
                  <span class="starter-prompt">What changed in React?</span>
                </button>
              </div>
            </div>

            <div class="msg-stream">
            <div class="msg-row user"><span class="sr-only">You asked:</span>
              <div class="msg-content">
                <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" class="msg-attachment" alt="Attached"/>
                <div class="bubble markdown-body"><p>What is this?</p></div>
                <div class="msg-meta"><span class="msg-role">You</span><span>10:04</span></div>
              </div>
            </div>

            <div class="msg-row assistant"><span class="sr-only">The council answered:</span>
              <div class="avatar" aria-hidden="true">AI</div>
              <div class="msg-content">
                <details class="tool-trail" open>
                  <summary class="tool-trail-summary"><svg width="13" height="13" viewBox="0 0 24 24"><path d="M0 0"/></svg><span>Checked 2 sources</span></summary>
                  <ol class="tool-trail-list">
                    <li class="tool-trail-row is-done"><svg width="12" height="12" viewBox="0 0 24 24"><path d="M0 0"/></svg><span class="tool-trail-text">2 results for "OLED burn-in 2026"</span></li>
                    <li class="tool-trail-row is-pending"><svg width="12" height="12" viewBox="0 0 24 24"><path d="M0 0"/></svg><span class="tool-trail-text">read_url: https://rtings.com/monitor</span></li>
                    <li class="tool-trail-row is-failed"><svg width="12" height="12" viewBox="0 0 24 24"><path d="M0 0"/></svg><span class="tool-trail-text">Refused to fetch that URL: resolves to a private address.</span></li>
                  </ol>
                </details>
                <div class="msg-attachment-placeholder"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg> Image attached</div>
                <div class="bubble markdown-body">
                  <h1>Heading one</h1>
                  <h2>Heading two</h2>
                  <h3>Heading three</h3>
                  <p>A paragraph with <a href="#x">a link</a>, <code>inline code</code> and <strong>bold</strong>.</p>
                  <ul><li>First item</li><li>Second item</li></ul>
                  <ol><li>Numbered</li></ol>
                  <blockquote><p>Quoted</p></blockquote>
                  <pre><code>const a = 1;</code></pre>
                  <table><thead><tr><th>Head</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>
                  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="inline"/>
                  <hr/>
                  <div class="code-block-wrapper">
                    <button class="code-copy-btn">Copy</button>
                    <div><pre><code>const a = 1;</code></pre></div>
                  </div>
                  <div class="code-block-wrapper">
                    <button class="code-copy-btn is-copied">Copied</button>
                    <div><pre><code>const a = 1;</code></pre></div>
                  </div>
                  <div class="code-block-wrapper">
                    <pre class="code-block-plain"><code>const a = 1;</code></pre>
                  </div>
                </div>
                <div class="msg-actions is-voted">
                  <button class="msg-action-btn">Copy</button>
                  <button class="msg-action-btn is-copied">Copied</button>
                  <button class="msg-action-btn active"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
                  <button class="msg-action-btn is-down active"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
                </div>
                <div class="msg-meta"><span class="msg-role">ALOP-AI</span><span>10:05</span></div>
              </div>
            </div>

            <div class="msg-row assistant"><span class="sr-only">The council answered:</span>
              <div class="avatar" aria-hidden="true">AI</div>
              <div class="msg-content">
                <div class="bubble markdown-body is-streaming"><p>Half an answ</p></div>
                <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" class="msg-image" alt="Generated"/>
              </div>
            </div>

            <div class="msg-row assistant"><span class="sr-only">The council answered:</span>
              <div class="avatar" aria-hidden="true">AI</div>
              <div class="msg-content">
                <div class="answer-skeleton" role="status" aria-label="4 of 7 answered">
                  <div class="skeleton-block"></div>
                  <div class="skeleton-block"></div>
                  <div class="skeleton-block"></div>
                  <p class="answer-stage">4 of 7 answered</p>
                </div>
              </div>
            </div>

            <div class="msg-row assistant"><span class="sr-only">The council answered:</span>
              <div class="avatar" aria-hidden="true">AI</div>
              <div class="msg-content">
                <div class="bubble markdown-body is-stopped"><p>Interrupted</p></div>
                <span class="msg-stopped-note"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg> Stopped</span>
              </div>
            </div>

            <div class="msg-row assistant"><span class="sr-only">The council answered:</span>
              <div class="avatar" aria-hidden="true">AI</div>
              <div class="msg-content">
                <div class="bubble typing-bubble" role="status">
                  <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                </div>
              </div>
            </div>

            <div class="msg-row assistant"><span class="sr-only">The council answered:</span>
              <div class="avatar" aria-hidden="true">AI</div>
              <div class="msg-content">
                <div class="skeleton-block"></div>
              </div>
            </div>

            <p class="sr-only" role="status">Answer in progress</p>
            </div>
          </div>

          <button class="scroll-down-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>

          <div class="chat-toolbar">
            <button class="chat-toolbar-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg> Regenerate</button>
            <button class="chat-toolbar-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg> Export</button>
          </div>

          <!-- The drop state, rendered alongside the real composer rather than
               on it, so the default state stays covered too. -->
          <div class="input-bar">
            <div class="input-wrapper is-dropping"><textarea class="input-text"></textarea></div>
          </div>

          <div class="input-bar">
            <div class="input-wrapper"><div class="composer-sprigs" aria-hidden="true"><div class="composer-skyline"><svg viewBox="0 0 1040 22"><circle class="composer-sun" cx="330" cy="11" r="10"/><g class="composer-town"><path d="M0 22"/></g></svg></div><svg class="sakura-seal composer-seal" viewBox="0 0 32 32"><rect width="32" height="32"/></svg></div>
              <div class="attachment-preview">
                <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="Attached"/>
                <button aria-label="Remove attached image">×</button>
              </div>
              <div class="file-chips-error" role="status">
      <span>Couldn&rsquo;t load this chat&rsquo;s files. They haven&rsquo;t been deleted.</span>
      <button type="button" class="file-chips-retry">Try again</button>
    </div>
    <ul class="file-chips">
                <li class="file-chip"><svg width="12" height="12" viewBox="0 0 24 24"><path d="M0 0"/></svg><span class="file-chip-name">budget.csv</span><button aria-label="Remove budget.csv">×</button></li>
                <li class="file-chip"><svg width="12" height="12" viewBox="0 0 24 24"><path d="M0 0"/></svg><span class="file-chip-name">a-very-long-attachment-filename-that-must-truncate.md</span><button aria-label="Remove it">×</button></li>
              </ul>
              <textarea class="input-text" rows="1" placeholder="Ask the AI Council anything..."></textarea>
              <div class="input-actions">
                <label class="input-btn"><input type="file"/><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></label>
                <button class="input-btn listening"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
                <button class="input-btn"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
                <div class="input-spacer"></div>
                <span class="input-hint desktop-only"><kbd>Enter</kbd> to send</span>
                <button class="input-btn primary"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
                <button class="input-btn primary is-stop"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
   </div>
  </div>
</div>
`;

/**
 * Two things here render OUTSIDE `.app-root`, and that is load-bearing.
 *
 * `InitialLoader` and `OverlayAssistant` are siblings of the app shell, not
 * descendants — so every token they consume must be reachable from `:root`.
 * Moving a token down onto `.app-root` silently breaks them, which the cascade
 * snapshot flags and a reviewer would not.
 *
 * `OverlayAssistant` also carries no theme class at all: the overlay window is
 * always dark, whatever the main window is set to.
 */
export const outsideAppRoot = `
<!-- The render-error screen. It replaces the whole tree rather than sitting
     inside it, so it belongs here and not in appTree. Present so crash.css is
     covered by the cascade snapshot and cannot rot unnoticed — it is the one
     screen nobody sees until the day it matters. -->
<div class="crash-root" role="alert">
  <div class="crash-card">
    <h1 class="crash-title">Something broke on our side.</h1>
    <p class="crash-body">This screen failed to draw.</p>
    <p class="crash-detail">TypeError: x is not a function</p>
    <div class="crash-actions">
      <button class="crash-btn primary">Reload</button>
      <button class="crash-btn">Start a new chat</button>
    </div>
    <p class="crash-ref">Reference <code>abc123</code></p>
  </div>
</div>

<div class="initial-loader dark">
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" alt="Loading ALOP-AI"/>
  <div class="skeleton-block"></div>
</div>

<div class="overlay-root">
  <div class="overlay-answer-stack">
    <div class="overlay-answer-card">
      <div class="overlay-answer-text markdown-body"><p>An answer.</p></div>
      <button class="overlay-tts-btn">▶</button>
    </div>
  </div>
  <div class="overlay-thumb-pill">Image attached<button>×</button></div>
  <form class="overlay-bar">
    <div class="overlay-drag-handle">⠿</div>
    <div class="overlay-icon live"><svg width="16" height="16" viewBox="0 0 24 24"><path d="M0 0"/></svg></div>
    <input class="overlay-input" type="text" placeholder="Ask anything..."/>
    <button class="overlay-action recording">●</button>
    <label class="overlay-action"><input type="file" class="overlay-file-input"/>+</label>
    <button class="overlay-submit">→</button>
  </form>
</div>

<!-- The sign-in page. It renders INSTEAD of the app rather than over it, and
     it lived outside the App.css manifest until signin.css joined — which is
     why it kept a deleted wood-grain palette for months with nothing to say so.
     Transcribed from SignInPage.jsx; a Clerk-rendered form is represented by
     the wrapper only, since its inner markup is theirs and changes on their
     schedule. -->
<div class="signin-root">
  <div class="signin-noise"></div>
  <div class="signin-orb signin-orb-1"></div>
  <div class="signin-orb signin-orb-2"></div>
  <div class="sakura-frame">
    <svg class="sakura-corner sakura-corner-tl" viewBox="0 0 120 76"><path d="M0 0"/></svg>
  </div>

  <div class="signin-wrap">
    <div class="signin-down" role="alert">
    <h1 class="signin-down-title">Sign-in isn&rsquo;t responding.</h1>
    <p class="signin-down-body">We can&rsquo;t reach the service that signs you in.</p>
    <button class="signin-down-retry">Reload</button>
  </div>

  <div class="signin-brand">
      <img src="data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" class="signin-logo-mark" alt=""/>
      <span class="signin-logo-text">ALOP-AI</span>
    </div>

    <div class="signin-grid">
      <section class="signin-thesis">
        <h1 class="signin-title">Seven answers.<span class="signin-title-accent">One reply.</span></h1>
        <ol class="council-ladder">
          <li class="council-row"><span class="council-temp">0.3</span><span class="council-name">kimi-k2.7-code</span></li>
          <li class="council-row is-pro"><span class="council-temp">0.8</span><span class="council-name">minimax-m3</span><span class="council-tag">Pro</span></li>
        </ol>
        <p class="council-resolve">One reply, reconciled.</p>
        <p class="signin-tagline">They disagree on purpose.</p>
      </section>

      <section class="signin-card">
        <div class="signin-card-inner"></div>
        <p class="signin-plan">3 models free. All 7 on Pro.</p>
        <p class="signin-legal">
          By continuing you confirm you are at least 13 years old (16 in the EEA and UK) and agree
          to our <a href="/terms.html">Terms</a> and <a href="/privacy.html">Privacy Policy</a>.
        </p>
      </section>
    </div>
  </div>
</div>
`;

/**
 * The full fixture. `#root` is included because `html, body, #root` is styled
 * as a unit, and omitting it would leave that rule unguarded.
 */
export const APP_MARKUP = `<div id="root">${appTree("dark")}${appTree("light")}${outsideAppRoot}</div>`;

export default APP_MARKUP;
