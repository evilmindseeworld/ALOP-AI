/**
 * Loading placeholders.
 *
 * `InitialLoader` covers the moment before Clerk resolves, when it is not yet
 * known whether to show the app or the sign-in page. `AppSkeleton` covers the
 * first chat fetch, and mirrors the real layout closely enough that nothing
 * jumps when the data lands.
 */

export const InitialLoader = () => (
  <div className="initial-loader dark">
    <img src="/logo.png" alt="Loading ALOP-AI" />
    <div className="skeleton-block" style={{ width: "120px", height: "10px", marginTop: "10px" }} />
  </div>
);

export const AppSkeleton = () => (
  <div className="app-root dark">
    <div className="bg-layer" />
    <div className="bg-overlay" />
    <div className="app-shell">
      <header className="app-header">
        <div className="skeleton-block" style={{ width: "40px", height: "40px", borderRadius: "12px", flexShrink: 0 }} />
        <div style={{ marginLeft: "10px", gap: "8px", display: "flex", flexDirection: "column" }}>
          <div className="skeleton-block" style={{ width: "140px", height: "16px" }} />
          <div className="skeleton-block" style={{ width: "180px", height: "12px" }} />
        </div>
        <div style={{ flex: 1 }} />
        <div className="skeleton-block" style={{ width: "40px", height: "40px", borderRadius: "12px" }} />
      </header>

      <div className="app-body">
        <div className="sidebar">
          <div className="skeleton-block" style={{ height: "42px", marginBottom: "14px", borderRadius: "12px" }} />
          {Array.from({ length: 6 }, (_, i) => (
            <div
              key={i}
              className="skeleton-block"
              style={{ height: "42px", marginBottom: "8px", borderRadius: "12px" }}
            />
          ))}
        </div>

        <div className="chat-main">
          <div className="scroll-wrapper">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className={`msg-row ${i % 2 === 0 ? "assistant" : "user"}`}>
                <div
                  className="skeleton-block"
                  style={{ width: "36px", height: "36px", borderRadius: "10px", flexShrink: 0 }}
                />
                <div className="msg-content" style={{ gap: "10px", display: "flex", flexDirection: "column" }}>
                  <div className="skeleton-block" style={{ height: "16px", width: "70%" }} />
                  <div className="skeleton-block" style={{ height: "16px", width: "85%" }} />
                </div>
              </div>
            ))}
          </div>
          <div className="input-bar" style={{ display: "flex", alignItems: "center" }}>
            <div className="skeleton-block" style={{ height: "24px", flex: 1, borderRadius: "8px" }} />
          </div>
        </div>
      </div>
    </div>
  </div>
);
