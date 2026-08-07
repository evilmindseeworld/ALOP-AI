import SidePanel from "../SidePanel";

export default function AdminPanel({
  open,
  onClose,
  users,
  offset = 0,
  hasMore = false,
  onPrevious,
  onNext,
  onSuspend,
  onUnsuspend,
  onDelete,
}) {
  return (
    <SidePanel open={open} title="Admin Dashboard" onClose={onClose}>
      {/* NOT "{users.length} Users". That read as the total user count, and
          once the list is paged it is the size of ONE PAGE — an admin looking
          at a 50-row page of a 4,000-user table would have been told the
          service has 50 users. The range in the pager below says exactly what
          is on screen and claims nothing about the total, which no longer
          costs a count query to know. */}
      <div className="admin-title">Users</div>

      {users.map((u) => (
        <div key={u.id} className="admin-user-card">
          <div className="admin-user-header">
            <img src={u.avatar_url || "https://via.placeholder.com/36"} alt="" className="admin-avatar" />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: "var(--text)" }}>{u.name || "Anonymous"}</div>
              <div style={{ fontSize: 11, color: "var(--text-subtle)" }}>{u.email || "No email"}</div>
            </div>
            <span className={`admin-badge ${u.plan === "pro" ? "pro" : "free"}`}>{u.plan || "free"}</span>
            {u.is_admin && <span className="admin-badge admin">Admin</span>}
          </div>

          {/* Reuses .msg-actions for layout, forced visible — that class hides
              itself until its row is hovered, which is wrong here. */}
          <div className="msg-actions" style={{ justifyContent: "flex-start", marginTop: 8, opacity: 1 }}>
            {u.suspended ? (
              <button onClick={() => onUnsuspend(u.id)} className="msg-action-btn">
                Unsuspend
              </button>
            ) : (
              <button onClick={() => onSuspend(u.id)} className="msg-action-btn">
                Suspend
              </button>
            )}
            <button onClick={() => onDelete(u.id)} className="msg-action-btn" style={{ color: "var(--danger)" }}>
              Delete
            </button>
          </div>
        </div>
      ))}

      <div
        className="msg-actions"
        style={{ justifyContent: "space-between", marginTop: 12, opacity: 1 }}
        aria-label="User pages"
      >
        <button onClick={onPrevious} className="msg-action-btn" disabled={offset === 0}>
          Previous
        </button>
        <span style={{ fontSize: 11, color: "var(--text-subtle)" }}>
          {users.length ? `${offset + 1}-${offset + users.length}` : "No users"}
        </span>
        <button onClick={onNext} className="msg-action-btn" disabled={!hasMore}>
          Next
        </button>
      </div>
    </SidePanel>
  );
}
