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

const appTree = (theme) => `
<div class="app-root ${theme}">
  <div class="bg-layer"></div>
  <div class="bg-overlay"></div>

  <div class="earring-wrap earring-left" aria-hidden="true">
    <div class="earring-chain"></div>
    <div class="earring-pivot"><svg class="crescent" viewBox="0 0 110 150"><defs><linearGradient><stop/></linearGradient></defs><path d="M0 0"/></svg></div>
  </div>
  <div class="earring-wrap earring-right" aria-hidden="true">
    <div class="earring-chain"></div>
    <div class="earring-pivot"><svg class="crescent" viewBox="0 0 110 150"><path d="M0 0"/></svg></div>
  </div>

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
    <header class="app-header">
      <button class="icon-btn mobile-only"><svg><path d="M0 0"/></svg></button>
      <button class="icon-btn desktop-only"><svg><path d="M0 0"/></svg></button>
      <div class="brand">
        <img class="header-logo" alt=""/>
        <div class="brand-text">
          <h1 class="main-title">ALOP-AI</h1>
          <span class="sub-title">AI Council</span>
        </div>
      </div>
      <div class="header-actions">
        <button class="cmdk-trigger desktop-only"><svg><path d="M0 0"/></svg><span>Search</span><kbd>Ctrl K</kbd></button>
        <button class="upgrade-btn"><svg><path d="M0 0"/></svg> Upgrade</button>
        <button class="icon-btn admin-btn active"><svg><path d="M0 0"/></svg></button>
        <button class="icon-btn"><svg><path d="M0 0"/></svg></button>
      </div>
    </header>

    <div class="app-body">
      <div class="sidebar">
        <div class="sidebar-header">
          <button class="new-chat-btn"><svg><path d="M0 0"/></svg> New Chat</button>
          <button class="icon-btn"><svg><path d="M0 0"/></svg></button>
        </div>
        <div class="chat-list">
          <div class="chat-item active pinned">
            <div class="chat-title">Pinned chat</div>
            <div class="chat-actions">
              <button class="chat-action"><svg><path d="M0 0"/></svg></button>
              <button class="chat-action">✎</button>
            </div>
          </div>
          <div class="chat-item favorite">
            <div class="chat-title"><input class="custom-input" value="Renaming"/></div>
            <div class="chat-actions"><button class="chat-action"><svg><path d="M0 0"/></svg></button></div>
          </div>
          <div class="chat-item"><div class="chat-title">Plain chat</div></div>
        </div>
        <div class="sidebar-footer">ALOP-AI • Council of Minds</div>
      </div>

      <div class="sidebar collapsed"><div class="chat-list"></div></div>
      <div class="sidebar mobile mobileOpen"><div class="chat-list"></div></div>

      <div class="chat-main">
        <div class="panel-overlay"></div>
        <div class="side-panel">
          <div class="panel-header">
            <div class="panel-title">Settings</div>
            <button class="icon-btn"><svg><path d="M0 0"/></svg></button>
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
            <div class="setting-row"><button class="theme-card">Delete Chat</button></div>

            <div class="admin-title">3 Users</div>
            <div class="admin-user-card">
              <div class="admin-user-header">
                <img class="admin-avatar" alt=""/>
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
          <div class="scroll-wrapper">
            <div class="empty-state">
              <img class="empty-logo" alt="ALOP-AI"/>
              <h2 class="empty-title text-shimmer">ALOP-AI</h2>
              <p class="empty-subtitle">Ask the AI Council anything.</p>
              <div class="starter-grid">
                <button class="starter-card">
                  <span class="starter-icon">⚖️</span>
                  <span class="starter-label">Weigh a decision</span>
                  <span class="starter-prompt">Postgres or Mongo?</span>
                </button>
                <button class="starter-card">
                  <span class="starter-icon">🔍</span>
                  <span class="starter-label">Search the live web</span>
                  <span class="starter-prompt">What changed in React?</span>
                </button>
              </div>
            </div>

            <div class="msg-row user">
              <div class="avatar">YOU</div>
              <div class="msg-content">
                <img class="msg-attachment" alt="Attached"/>
                <div class="bubble markdown-body"><p>What is this?</p></div>
                <div class="msg-meta">10:04</div>
              </div>
            </div>

            <div class="msg-row assistant">
              <div class="avatar">AI</div>
              <div class="msg-content">
                <div class="msg-attachment-placeholder"><svg><path d="M0 0"/></svg> Image attached</div>
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
                  <img alt="inline"/>
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
                <div class="msg-actions">
                  <button class="msg-action-btn">Copy</button>
                  <button class="msg-action-btn active"><svg><path d="M0 0"/></svg></button>
                  <button class="msg-action-btn"><svg><path d="M0 0"/></svg></button>
                </div>
                <div class="msg-meta">10:05</div>
              </div>
            </div>

            <div class="msg-row assistant">
              <div class="avatar">AI</div>
              <div class="msg-content">
                <div class="bubble typing-bubble">
                  <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>
                </div>
              </div>
            </div>

            <div class="msg-row assistant">
              <div class="avatar">AI</div>
              <div class="msg-content">
                <div class="skeleton-block"></div>
              </div>
            </div>
          </div>

          <button class="scroll-down-btn"><svg><path d="M0 0"/></svg></button>

          <div class="chat-toolbar">
            <button class="chat-toolbar-btn"><svg><path d="M0 0"/></svg> Regenerate</button>
            <button class="chat-toolbar-btn"><svg><path d="M0 0"/></svg> Export</button>
          </div>

          <div class="input-bar">
            <div class="input-wrapper">
              <div class="attachment-preview">
                <img alt="Attached"/>
                <button aria-label="Remove attached image">×</button>
              </div>
              <textarea class="input-text" placeholder="Ask the AI Council anything..."></textarea>
              <div class="input-actions">
                <label class="input-btn"><input type="file"/><svg><path d="M0 0"/></svg></label>
                <button class="input-btn listening"><svg><path d="M0 0"/></svg></button>
                <button class="input-btn"><svg><path d="M0 0"/></svg></button>
                <button class="input-btn primary"><svg><path d="M0 0"/></svg></button>
                <button class="input-btn primary is-stop"><svg><path d="M0 0"/></svg></button>
              </div>
            </div>
          </div>
        </div>
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
const outsideAppRoot = `
<div class="initial-loader dark">
  <img alt="Loading ALOP-AI"/>
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
    <div class="overlay-icon live"><svg><path d="M0 0"/></svg></div>
    <input class="overlay-input" type="text" placeholder="Ask anything..."/>
    <button class="overlay-action recording">●</button>
    <label class="overlay-action"><input type="file" class="overlay-file-input"/>+</label>
    <button class="overlay-submit">→</button>
  </form>
</div>
`;

/**
 * The full fixture. `#root` is included because `html, body, #root` is styled
 * as a unit, and omitting it would leave that rule unguarded.
 */
export const APP_MARKUP = `<div id="root">${appTree("dark")}${appTree("light")}${outsideAppRoot}</div>`;

export default APP_MARKUP;
